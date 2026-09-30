// GET  /api/admin/tenants/[tenantId]/payment-providers
// POST /api/admin/tenants/[tenantId]/payment-providers
//
// GET  — lists every TenantPaymentProvider for this tenant, ACTIVE first,
//        with MID last-4 masked and the assignedByAdminEmail resolved from
//        the linked application (if any). Read is open to any admin (the
//        middleware already blocks unauthenticated callers).
//
// POST — "Switch provider" flow. Creates a new ACTIVE row for a given
//        (tenantId, capability, processor). If another provider is already
//        ACTIVE for the same (tenantId, capability), it is flipped to
//        INACTIVE first, so the partial unique index doesn't fire. Role
//        gate: SUPER_ADMIN + COMPLIANCE.
//
// Same audit + encryption patterns as mark-provider-approved so the POS
// router sees a single active provider per capability.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { kybEncryptJson, maskTail } from "@/lib/kyb-crypto";
import { logAdminAction } from "@/lib/admin-audit";
import { ALLOWED_PROCESSORS } from "@/lib/providers/registry";

const WRITE_ROLES = new Set(["SUPER_ADMIN", "COMPLIANCE"]);
const ALLOWED_CAPABILITIES = new Set(["CARD", "INTERAC", "GIFT_CARD", "ACH"]);

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;

  const rows = await prisma.tenantPaymentProvider.findMany({
    where: { tenantId },
    orderBy: [
      // ACTIVE first, then most recently touched.
      { status: "asc" }, // ACTIVE sorts before INACTIVE lexicographically as well
      { updatedAt: "desc" },
    ],
    include: {
      application: {
        select: {
          id: true,
          legalName: true,
          reviewedByAdminEmail: true,
          approvedAt: true,
        },
      },
    },
  });

  return NextResponse.json({
    providers: rows.map((r) => ({
      id: r.id,
      processor: r.processor,
      capability: r.capability,
      status: r.status,
      externalMidMasked: maskTail(r.externalMid, 4),
      // Client uses this for tab-scoped grouping ("CARD is filled by GP").
      capabilityGroup: r.capability,
      applicationId: r.applicationId,
      applicationLegalName: r.application?.legalName ?? null,
      assignedByAdminEmail: r.application?.reviewedByAdminEmail ?? null,
      assignedAt: r.activatedAt ?? r.createdAt,
      activatedAt: r.activatedAt,
      suspendedAt: r.suspendedAt,
      updatedAt: r.updatedAt,
      hasFeeSchedule: !!r.feeScheduleJson,
    })),
  });
}

// Credential validation is dispatched to the per-provider module in
// src/lib/providers/<processor>/admin.ts via PROVIDER_REGISTRY. Adding a
// new provider = create src/lib/providers/<name>/admin.ts + register it in
// src/lib/providers/registry.ts. This file stays provider-agnostic.
import { PROVIDER_REGISTRY, type ProviderCode } from "@/lib/providers/registry";

function validateCredentials(
  processor: ProviderCode,
  raw: unknown
): { ok: true; creds: unknown } | { ok: false; error: string } {
  const mod = PROVIDER_REGISTRY[processor];
  if (!mod) {
    return { ok: false, error: `Unknown processor '${processor}'` };
  }
  return mod.validateCredentials(raw);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const role = request.headers.get("x-admin-role") || "";
  const adminUserId = request.headers.get("x-admin-user-id") || "";
  if (!WRITE_ROLES.has(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!adminUserId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { tenantId } = await params;

  let body: {
    processor?: string;
    capability?: string;
    providerReferenceId?: string;
    credentials?: unknown;
    feeSchedule?: { percentBps?: number; fixedCents?: number } | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const processor = String(body.processor || "").toUpperCase();
  const capability = String(body.capability || "").toUpperCase();
  const providerReferenceId = String(body.providerReferenceId || "").trim();

  if (!ALLOWED_PROCESSORS.has(processor)) {
    return NextResponse.json(
      { error: `processor must be one of: ${Array.from(ALLOWED_PROCESSORS).join(", ")}` },
      { status: 400 }
    );
  }
  if (!ALLOWED_CAPABILITIES.has(capability)) {
    return NextResponse.json(
      { error: "capability must be CARD | INTERAC | GIFT_CARD | ACH" },
      { status: 400 }
    );
  }
  if (!providerReferenceId) {
    return NextResponse.json(
      { error: "providerReferenceId is required" },
      { status: 400 }
    );
  }

  const check = validateCredentials(processor as ProviderCode, body.credentials);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const credentialsEnc = kybEncryptJson(check.creds);
  if (!credentialsEnc) {
    return NextResponse.json(
      { error: "Failed to encrypt credentials — is KYB_ENCRYPTION_KEY set?" },
      { status: 500 }
    );
  }

  const now = new Date();
  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Flip any currently-ACTIVE row for this (tenant, capability) to
      //    INACTIVE so the partial unique index doesn't reject the insert.
      await tx.tenantPaymentProvider.updateMany({
        where: {
          tenantId,
          capability: capability as "CARD" | "INTERAC" | "GIFT_CARD" | "ACH",
          status: "ACTIVE",
        },
        data: {
          status: "SUSPENDED",
          suspendedAt: now,
          suspensionReason: `Superseded by admin ${adminUserId} switching to ${processor}`,
        },
      });

      // 2. Either insert a brand-new row OR (if a row already exists for
      //    the exact same (tenant, capability, processor)) reactivate it
      //    with fresh credentials. The (tenant, capability, processor)
      //    unique index makes plain `create` fail on re-onboarding of the
      //    same processor — upsert is the friendly path.
      const provider = await tx.tenantPaymentProvider.upsert({
        where: {
          tenantId_capability_processor: {
            tenantId,
            capability: capability as "CARD" | "INTERAC" | "GIFT_CARD" | "ACH",
            processor: processor as ProviderCode,
          },
        },
        create: {
          tenantId,
          processor: processor as ProviderCode,
          capability: capability as "CARD" | "INTERAC" | "GIFT_CARD" | "ACH",
          externalMid: providerReferenceId,
          credentialsEnc,
          feeScheduleJson: body.feeSchedule ?? undefined,
          status: "ACTIVE",
          activatedAt: now,
        },
        update: {
          externalMid: providerReferenceId,
          credentialsEnc,
          feeScheduleJson: body.feeSchedule ?? undefined,
          status: "ACTIVE",
          activatedAt: now,
          suspendedAt: null,
          suspensionReason: null,
        },
      });
      return provider;
    });

    await logAdminAction({
      adminUserId,
      action: "tenant.switch_payment_provider",
      resourceType: "tenant_payment_provider",
      resourceId: result.id,
      after: {
        tenantId,
        processor,
        capability,
        providerReferenceId,
      },
      request,
    });

    return NextResponse.json({
      success: true,
      provider: {
        id: result.id,
        processor: result.processor,
        capability: result.capability,
        externalMidMasked: maskTail(result.externalMid, 4),
        status: result.status,
        activatedAt: result.activatedAt,
      },
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P2002") {
      return NextResponse.json(
        {
          error:
            "Another provider is already ACTIVE for this tenant + capability. Deactivate it first, then retry.",
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: (err as Error).message || "Failed to switch provider" },
      { status: 500 }
    );
  }
}
