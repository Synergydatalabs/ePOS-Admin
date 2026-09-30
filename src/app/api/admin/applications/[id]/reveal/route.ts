// POST /api/admin/applications/[id]/reveal
// Body: { field: "taxId" | "bankInfo" }
// Returns the DECRYPTED value for the requested field and writes an
// AdminAuditLog row (action=kyb.reveal_pii) so every unmask is traceable
// back to the admin who did it.
//
// SUPER_ADMIN and COMPLIANCE only — SUPPORT / SALES / FINANCE cannot
// unmask PII by design. Bank info returns the full parsed JSON, tax ID
// returns the raw string.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { kybDecrypt } from "@/lib/kyb-crypto";
import { logAdminAction } from "@/lib/admin-audit";

const REVEAL_ROLES = new Set(["SUPER_ADMIN", "COMPLIANCE"]);
const REVEALABLE_FIELDS = new Set(["taxId", "bankInfo"]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const role = request.headers.get("x-admin-role");
  const adminUserId = request.headers.get("x-admin-user-id");
  if (!role || !adminUserId || !REVEAL_ROLES.has(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;

  let body: { field?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const field = body.field?.trim();
  if (!field || !REVEALABLE_FIELDS.has(field)) {
    return NextResponse.json(
      { error: "field must be one of: taxId, bankInfo" },
      { status: 400 }
    );
  }

  const app = await prisma.merchantApplication.findUnique({
    where: { id },
    select: { taxIdEnc: true, bankInfoEnc: true },
  });
  if (!app) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  let value: unknown = null;
  try {
    if (field === "taxId") {
      value = kybDecrypt(app.taxIdEnc);
    } else {
      const plain = kybDecrypt(app.bankInfoEnc);
      if (plain) {
        try {
          value = JSON.parse(plain);
        } catch {
          // Not JSON — return the raw string so the reviewer can still see it.
          value = plain;
        }
      }
    }
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error)?.message || "Decrypt failed" },
      { status: 500 }
    );
  }

  // Audit — fire-and-forget so a broken audit write doesn't block the
  // reveal, but any error is still logged to the server console.
  await logAdminAction({
    adminUserId,
    action: "kyb.reveal_pii",
    resourceType: "merchant_application",
    resourceId: id,
    // Only record WHICH field was revealed, never the value itself — the
    // audit trail should not be a second copy of the PII.
    after: { field },
    request,
  });

  return NextResponse.json({ field, value });
}
