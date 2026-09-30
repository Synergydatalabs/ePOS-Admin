// POST /api/admin/applications/[id]/mark-provider-approved
//
// Body: {
//   processor:            "GP" | "MONERIS",
//   capability:           "CARD" | "INTERAC" | "GIFT_CARD" | "ACH",
//   providerReferenceId:  string,          // MID / store_id / etc.
//   credentials: {                         // shape depends on processor
//     app_id?: string; app_key?: string; account_name?: string;   // GP
//     store_id?: string; api_token?: string;                       // Moneris
//   },
//   feeSchedule?: { percentBps?: number; fixedCents?: number },   // optional
// }
//
// Role gate: SUPER_ADMIN or COMPLIANCE. Refuses unless the current status
// is FORWARDED (already handed to the processor).
//
// Creates a TenantPaymentProvider row (status ACTIVE) with credentials
// AES-GCM encrypted at rest. The partial unique index on
// (tenantId, capability) WHERE status='ACTIVE' guarantees at most one
// active provider per capability — if a duplicate slot exists we return
// a clean 409 rather than a raw Postgres error.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { logAdminAction } from "@/lib/admin-audit";
import { kybEncryptJson } from "@/lib/kyb-crypto";

const APPROVE_ROLES = new Set(["SUPER_ADMIN", "COMPLIANCE"]);
const ALLOWED_PROCESSORS = new Set(["GP", "MONERIS"]);
const ALLOWED_CAPABILITIES = new Set(["CARD", "INTERAC", "GIFT_CARD", "ACH"]);

interface CredsGp {
  app_id: string;
  app_key: string;
  account_name?: string;
}
interface CredsMoneris {
  store_id: string;
  api_token: string;
}

function validateCredentials(
  processor: "GP" | "MONERIS",
  raw: unknown
): { ok: true; creds: CredsGp | CredsMoneris } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "credentials must be an object" };
  }
  const r = raw as Record<string, unknown>;
  if (processor === "GP") {
    const app_id = String(r.app_id || "").trim();
    const app_key = String(r.app_key || "").trim();
    const account_name = r.account_name ? String(r.account_name).trim() : undefined;
    if (!app_id || !app_key) {
      return { ok: false, error: "GP requires credentials.app_id and credentials.app_key" };
    }
    return { ok: true, creds: { app_id, app_key, account_name } };
  }
  // MONERIS
  const store_id = String(r.store_id || "").trim();
  const api_token = String(r.api_token || "").trim();
  if (!store_id || !api_token) {
    return { ok: false, error: "Moneris requires credentials.store_id and credentials.api_token" };
  }
  return { ok: true, creds: { store_id, api_token } };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const role = request.headers.get("x-admin-role") || "";
  const adminUserId = request.headers.get("x-admin-user-id") || "";
  if (!APPROVE_ROLES.has(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!adminUserId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;

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
    return NextResponse.json({ error: "processor must be 'GP' or 'MONERIS'" }, { status: 400 });
  }
  if (!ALLOWED_CAPABILITIES.has(capability)) {
    return NextResponse.json(
      { error: "capability must be CARD | INTERAC | GIFT_CARD | ACH" },
      { status: 400 }
    );
  }
  if (!providerReferenceId) {
    return NextResponse.json(
      { error: "providerReferenceId (MID / store_id / etc.) is required" },
      { status: 400 }
    );
  }

  const check = validateCredentials(processor as "GP" | "MONERIS", body.credentials);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  const app = await prisma.merchantApplication.findUnique({
    where: { id },
    select: {
      id: true,
      tenantId: true,
      status: true,
      legalName: true,
    },
  });
  if (!app) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }
  if (app.status !== "FORWARDED") {
    return NextResponse.json(
      { error: `Cannot mark provider-approved from status ${app.status}. Must be FORWARDED.` },
      { status: 409 }
    );
  }

  const credentialsEnc = kybEncryptJson(check.creds);
  if (!credentialsEnc) {
    return NextResponse.json(
      { error: "Failed to encrypt credentials — is KYB_ENCRYPTION_KEY set?" },
      { status: 500 }
    );
  }

  const adminEmail = await prisma.adminUser
    .findUnique({ where: { id: adminUserId }, select: { email: true } })
    .then((r) => r?.email ?? null);

  const now = new Date();
  try {
    const result = await prisma.$transaction(async (tx) => {
      const provider = await tx.tenantPaymentProvider.create({
        data: {
          tenantId: app.tenantId,
          applicationId: app.id,
          processor: processor as "GP" | "MONERIS",
          capability: capability as "CARD" | "INTERAC" | "GIFT_CARD" | "ACH",
          externalMid: providerReferenceId,
          credentialsEnc,
          feeScheduleJson: body.feeSchedule ?? undefined,
          status: "ACTIVE",
          activatedAt: now,
        },
      });
      const updated = await tx.merchantApplication.update({
        where: { id: app.id },
        data: {
          status: "LIVE",
          approvedAt: now,
          reviewedByAdminEmail: adminEmail,
          processorReferenceId: providerReferenceId,
          lastAdminActionAt: now,
        },
      });
      await tx.applicationEvent.create({
        data: {
          applicationId: id,
          fromStatus: "FORWARDED",
          toStatus: "LIVE",
          actorType: "ADMIN",
          actorId: adminUserId,
          note: `Provider approved — ${processor} ${capability} · MID ${providerReferenceId}`,
        },
      });
      return { provider, updated };
    });

    await logAdminAction({
      adminUserId,
      action: "kyb.mark_provider_approved",
      resourceType: "merchant_application",
      resourceId: id,
      before: { status: "FORWARDED" },
      after: {
        status: "LIVE",
        providerId: result.provider.id,
        processor,
        capability,
        providerReferenceId,
      },
      request,
    });

    return NextResponse.json({
      success: true,
      application: {
        id: result.updated.id,
        status: result.updated.status,
        approvedAt: result.updated.approvedAt,
        processorReferenceId: result.updated.processorReferenceId,
      },
      provider: {
        id: result.provider.id,
        processor: result.provider.processor,
        capability: result.provider.capability,
        externalMid: result.provider.externalMid,
        status: result.provider.status,
        activatedAt: result.provider.activatedAt,
      },
    });
  } catch (err) {
    // Prisma unique violation (partial index → duplicate ACTIVE for same
    // tenant+capability, OR the (tenant, capability, processor) key already
    // has a matching row). Return 409 with a clear message rather than the
    // raw Postgres 23505 code.
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
      { error: (err as Error).message || "Failed to mark provider-approved" },
      { status: 500 }
    );
  }
}
