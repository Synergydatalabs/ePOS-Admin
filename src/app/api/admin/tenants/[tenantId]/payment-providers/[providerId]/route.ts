// PATCH /api/admin/tenants/[tenantId]/payment-providers/[providerId]
//
// Body: { status: "ACTIVE" | "SUSPENDED", suspensionReason?: string }
//
// Simple status flip — used by the tenant Payment Providers tab's
// "Deactivate" button and by an internal recover-a-mistakenly-deactivated
// switch. Guarded by the partial unique index: you can't flip to ACTIVE
// while another provider covers the same capability.
//
// Role gate: SUPER_ADMIN + COMPLIANCE.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { logAdminAction } from "@/lib/admin-audit";

const WRITE_ROLES = new Set(["SUPER_ADMIN", "COMPLIANCE"]);
const ALLOWED_STATUSES = new Set(["ACTIVE", "SUSPENDED"]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; providerId: string }> }
) {
  const role = request.headers.get("x-admin-role") || "";
  const adminUserId = request.headers.get("x-admin-user-id") || "";
  if (!WRITE_ROLES.has(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!adminUserId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { tenantId, providerId } = await params;

  let body: { status?: string; suspensionReason?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const status = String(body.status || "").toUpperCase();
  if (!ALLOWED_STATUSES.has(status)) {
    return NextResponse.json(
      { error: "status must be 'ACTIVE' or 'SUSPENDED'" },
      { status: 400 }
    );
  }

  const provider = await prisma.tenantPaymentProvider.findUnique({
    where: { id: providerId },
    select: { id: true, tenantId: true, status: true, capability: true, processor: true },
  });
  if (!provider || provider.tenantId !== tenantId) {
    return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  }
  if (provider.status === status) {
    return NextResponse.json({
      success: true,
      provider: { id: provider.id, status: provider.status },
      unchanged: true,
    });
  }

  const now = new Date();
  try {
    const updated = await prisma.tenantPaymentProvider.update({
      where: { id: providerId },
      data:
        status === "ACTIVE"
          ? {
              status: "ACTIVE",
              activatedAt: now,
              suspendedAt: null,
              suspensionReason: null,
            }
          : {
              status: "SUSPENDED",
              suspendedAt: now,
              suspensionReason: body.suspensionReason?.trim() || null,
            },
    });

    await logAdminAction({
      adminUserId,
      action: "tenant.set_payment_provider_status",
      resourceType: "tenant_payment_provider",
      resourceId: providerId,
      before: { status: provider.status },
      after: {
        status: updated.status,
        capability: updated.capability,
        processor: updated.processor,
        suspensionReason: updated.suspensionReason,
      },
      request,
    });

    return NextResponse.json({
      success: true,
      provider: {
        id: updated.id,
        status: updated.status,
        activatedAt: updated.activatedAt,
        suspendedAt: updated.suspendedAt,
        suspensionReason: updated.suspensionReason,
      },
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P2002") {
      return NextResponse.json(
        {
          error:
            "Cannot flip to ACTIVE — another provider is already ACTIVE for the same tenant + capability. Deactivate it first.",
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: (err as Error).message || "Failed to update provider status" },
      { status: 500 }
    );
  }
}
