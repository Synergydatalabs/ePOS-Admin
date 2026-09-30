// POST /api/admin/tenants/[tenantId]/payment-providers/[providerId]/reveal
//
// Returns the decrypted credentials JSON + the plaintext MID for one
// TenantPaymentProvider row. Same audit-logging pattern as the KYB reveal
// endpoint: every unmask writes an AdminAuditLog row with the field name
// but never the plaintext.
//
// Role gate: SUPER_ADMIN + COMPLIANCE only.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { kybDecryptJson } from "@/lib/kyb-crypto";
import { logAdminAction } from "@/lib/admin-audit";

const REVEAL_ROLES = new Set(["SUPER_ADMIN", "COMPLIANCE"]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; providerId: string }> }
) {
  const role = request.headers.get("x-admin-role") || "";
  const adminUserId = request.headers.get("x-admin-user-id") || "";
  if (!REVEAL_ROLES.has(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!adminUserId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { tenantId, providerId } = await params;

  const provider = await prisma.tenantPaymentProvider.findUnique({
    where: { id: providerId },
    select: {
      id: true,
      tenantId: true,
      processor: true,
      capability: true,
      externalMid: true,
      credentialsEnc: true,
    },
  });
  if (!provider || provider.tenantId !== tenantId) {
    return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  }

  let credentials: unknown;
  try {
    credentials = kybDecryptJson(provider.credentialsEnc);
  } catch (err) {
    return NextResponse.json(
      { error: `Decrypt failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }

  await logAdminAction({
    adminUserId,
    action: "tenant.reveal_payment_provider_credentials",
    resourceType: "tenant_payment_provider",
    resourceId: providerId,
    // Record which resource was unmasked and which fields exist, never
    // the plaintext values — the audit log itself should not become a
    // secondary secret store.
    after: {
      processor: provider.processor,
      capability: provider.capability,
      hasCredentials: !!credentials,
      credentialFieldNames: credentials && typeof credentials === "object"
        ? Object.keys(credentials as Record<string, unknown>)
        : [],
    },
    request,
  });

  return NextResponse.json({
    id: provider.id,
    processor: provider.processor,
    capability: provider.capability,
    externalMid: provider.externalMid,
    credentials,
  });
}
