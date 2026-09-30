// POST /api/admin/tenants/:tenantId/reject — Phase I #4 (2026-09-12).
// Flips a PENDING_APPROVAL tenant to REJECTED, stores the reviewer's
// reason (shown to the applicant), and sends a rejection email. Same
// idempotence guard as approve — refuses if the tenant isn't currently
// PENDING_APPROVAL.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/admin-auth";
import { logAdminAction } from "@/lib/admin-audit";

const ses = new SESClient({ region: process.env.AWS_REGION || "us-east-1" });
const FROM_EMAIL = process.env.SES_FROM_EMAIL || "noreply@zashx.com";

interface Params {
  params: Promise<{ tenantId: string }>;
}

export async function POST(request: NextRequest, { params }: Params) {
  const { tenantId } = await params;

  const session = await getAdminSession(request);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const reason = String(body.reason || "").trim();
  if (!reason) {
    return NextResponse.json(
      { error: "Rejection reason is required" },
      { status: 400 }
    );
  }
  if (reason.length > 2000) {
    return NextResponse.json(
      { error: "Rejection reason too long (max 2000 chars)" },
      { status: 400 }
    );
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

  await prisma.$transaction(async (tx) => {
    await tx.tenant.update({
      where: { id: tenantId },
      data: { status: "REJECTED" },
    });
    if (tenant.verification) {
      await tx.tenantVerification.update({
        where: { tenantId },
        data: {
          adminReviewedAt: now,
          adminReviewerEmail: session.email,
          adminDecision: "REJECTED",
          rejectionReason: reason,
        },
      });
    }
  });

  await logAdminAction({
    adminUserId: session.adminUserId,
    action: "tenant.reject",
    resourceType: "tenant",
    resourceId: tenantId,
    before: { status: "PENDING_APPROVAL" },
    after: { status: "REJECTED", reason },
    request,
  });

  if (tenant.verification?.contactEmail) {
    try {
      await ses.send(
        new SendEmailCommand({
          Source: FROM_EMAIL,
          Destination: { ToAddresses: [tenant.verification.contactEmail] },
          Message: {
            Subject: {
              Data: `${tenant.name} — application update`,
            },
            Body: {
              Html: {
                Data: `
                  <p>Hi,</p>
                  <p>Thank you for your interest in joining the Oreugo platform.
                  After review, we&rsquo;re unable to approve your
                  <strong>${escapeHtml(tenant.name)}</strong> application at
                  this time.</p>
                  <p><strong>Reason:</strong><br/>${escapeHtml(reason)}</p>
                  <p>If you believe this decision was made in error, or if you can
                  address the reason above, reply to this email and we&rsquo;ll
                  take another look.</p>
                  <p>Thanks,<br/>The Oreugo team</p>
                `,
              },
              Text: {
                Data:
                  `Thank you for your interest in joining the Oreugo platform.\n\n` +
                  `After review, we're unable to approve your ${tenant.name} application at this time.\n\n` +
                  `Reason:\n${reason}\n\n` +
                  `If you believe this decision was made in error, reply to this email and we'll take another look.\n\n` +
                  `Thanks,\nThe Oreugo team`,
              },
            },
          },
        })
      );
    } catch (err) {
      console.error(
        `[tenant reject] SES send failed for ${tenant.verification.contactEmail}:`,
        err
      );
    }
  }

  return NextResponse.json({ ok: true, status: "REJECTED" });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
