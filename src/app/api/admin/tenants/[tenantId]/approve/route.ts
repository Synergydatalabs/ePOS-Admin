// POST /api/admin/tenants/:tenantId/approve — Phase I #4 (2026-09-12).
// Flips a PENDING_APPROVAL tenant to ACTIVE, records the reviewer, and
// fires a welcome email. Idempotent-ish: refuses if the tenant is not
// in PENDING_APPROVAL so we don't accidentally re-activate a suspended
// or cancelled account through this door.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/admin-auth";
import { logAdminAction } from "@/lib/admin-audit";

const ses = new SESClient({ region: process.env.AWS_REGION || "us-east-1" });
const FROM_EMAIL = process.env.SES_FROM_EMAIL || "noreply@zashx.com";
const TAPAPP_ORIGIN = process.env.TAPAPP_ORIGIN || "https://oreugo.ca";

interface Params {
  params: Promise<{ tenantId: string }>;
}

export async function POST(request: NextRequest, { params }: Params) {
  const { tenantId } = await params;

  // Middleware already validated the cookie, but we need the reviewer's
  // email/id for the audit trail + verification.adminReviewerEmail.
  const session = await getAdminSession(request);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, status: true, verification: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (tenant.status !== "PENDING_APPROVAL") {
    return NextResponse.json(
      { error: `Tenant is ${tenant.status}, not PENDING_APPROVAL` },
      { status: 409 }
    );
  }

  const now = new Date();

  // Write status + verification decision atomically. If verification
  // is missing (grandfathered edge case someone dropped into PENDING
  // by hand), we still flip the status but skip the verification write.
  await prisma.$transaction(async (tx) => {
    await tx.tenant.update({
      where: { id: tenantId },
      data: { status: "ACTIVE" },
    });
    if (tenant.verification) {
      await tx.tenantVerification.update({
        where: { tenantId },
        data: {
          adminReviewedAt: now,
          adminReviewerEmail: session.email,
          adminDecision: "APPROVED",
          rejectionReason: null,
        },
      });
    }
  });

  await logAdminAction({
    adminUserId: session.adminUserId,
    action: "tenant.approve",
    resourceType: "tenant",
    resourceId: tenantId,
    before: { status: "PENDING_APPROVAL" },
    after: { status: "ACTIVE" },
    request,
  });

  // Welcome email — best-effort. Never fails the approval.
  if (tenant.verification?.contactEmail) {
    try {
      await ses.send(
        new SendEmailCommand({
          Source: FROM_EMAIL,
          Destination: { ToAddresses: [tenant.verification.contactEmail] },
          Message: {
            Subject: {
              Data: `${tenant.name} — your account is approved`,
            },
            Body: {
              Html: {
                Data: `
                  <p>Hi,</p>
                  <p>Good news — your <strong>${escapeHtml(tenant.name)}</strong>
                  account on the Oreugo platform has been approved.</p>
                  <p>You can now sign in to the portal:</p>
                  <p><a href="${TAPAPP_ORIGIN}/partner/login">${TAPAPP_ORIGIN}/partner/login</a></p>
                  <p>Welcome aboard,<br/>The Oreugo team</p>
                `,
              },
              Text: {
                Data:
                  `Good news — your ${tenant.name} account on the Oreugo platform has been approved.\n\n` +
                  `Sign in here: ${TAPAPP_ORIGIN}/partner/login\n\nWelcome aboard,\nThe Oreugo team`,
              },
            },
          },
        })
      );
    } catch (err) {
      // Log but don't fail the request — the admin already approved,
      // and the tenant can be nudged manually if the email bounced.
      console.error(
        `[tenant approve] SES send failed for ${tenant.verification.contactEmail}:`,
        err
      );
    }
  }

  return NextResponse.json({ ok: true, status: "ACTIVE" });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
