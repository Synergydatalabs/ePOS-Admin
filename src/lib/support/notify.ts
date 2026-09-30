// SES notifications for admin-side support activity — fires when an
// admin operator replies on a thread so the merchant or supplier gets
// an email even if they aren't watching their portal. Fire-and-forget.
//
// Recipient lookup:
//   • Merchant thread → first active TENANT_OWNER member of the tenant.
//     If none, fall back to any active member's email.
//   • Supplier thread → SupplierProfile.contactEmail if set, otherwise
//     same TENANT_OWNER fallback.

import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import prisma from "@/lib/prisma";

const ses = new SESClient({ region: process.env.AWS_REGION || "us-east-1" });
const FROM_EMAIL = process.env.SES_FROM_EMAIL || "noreply@zashx.com";

// Where clicking "View thread" takes the tenant. tap-app is served from
// the platform's canonical origin, defaulting to what production uses.
const TAPAPP_ORIGIN = process.env.TAPAPP_ORIGIN || "https://oreugo.ca";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(s: string, n = 240): string {
  return s.length <= n ? s : s.slice(0, n).trimEnd() + "…";
}

async function resolveTenantContactEmail(args: {
  tenantId: string;
  tenantRole: "MERCHANT" | "SUPPLIER";
}): Promise<string | null> {
  if (args.tenantRole === "SUPPLIER") {
    const profile = await prisma.supplierProfile.findUnique({
      where: { tenantId: args.tenantId },
      select: { contactEmail: true },
    });
    if (profile?.contactEmail) return profile.contactEmail;
  }
  // Any-role fallback (also the merchant primary path): pick the owner
  // first, then any active member. TENANT_OWNER emails are usually the
  // primary billing / account contact.
  const owner = await prisma.membership.findFirst({
    where: { tenantId: args.tenantId, status: "ACTIVE", role: "TENANT_OWNER" },
    select: { email: true },
  });
  if (owner?.email) return owner.email;
  const anyMember = await prisma.membership.findFirst({
    where: { tenantId: args.tenantId, status: "ACTIVE" },
    select: { email: true },
    orderBy: { createdAt: "asc" },
  });
  return anyMember?.email ?? null;
}

// Which portal the tenant goes to. Merchants land at /dashboard/support,
// suppliers at /supplier/support. Both live on the same host.
function portalUrlFor(tenantRole: "MERCHANT" | "SUPPLIER"): string {
  return tenantRole === "SUPPLIER"
    ? `${TAPAPP_ORIGIN}/supplier/support`
    : `${TAPAPP_ORIGIN}/dashboard/support`;
}

export async function notifyTenantOfAdminReply(args: {
  threadId: string;
  threadSubject: string;
  senderName: string;
  bodyPreview: string;
  merchantTenantId: string | null;
  supplierTenantId: string | null;
}): Promise<void> {
  // Resolve which tenant column is set and look up their contact email.
  const tenantId = args.merchantTenantId || args.supplierTenantId;
  if (!tenantId) return; // free-form thread with no counterparty
  const tenantRole: "MERCHANT" | "SUPPLIER" = args.supplierTenantId
    ? "SUPPLIER"
    : "MERCHANT";

  const to = await resolveTenantContactEmail({ tenantId, tenantRole });
  if (!to) {
    // No email on file for this tenant — silently skip. Ops can see the
    // reply in the admin UI, and the tenant will see it when they open
    // the widget.
    console.warn(
      `[support/notify] no contact email for tenant ${tenantId} (${tenantRole})`
    );
    return;
  }

  const preview = truncate(args.bodyPreview);
  const url = portalUrlFor(tenantRole);
  const subject = `Support reply: ${args.threadSubject}`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f9fafb;">
  <div style="background:white;border-radius:12px;padding:28px;">
    <h2 style="color:#111827;margin:0 0 8px 0;font-size:18px;">${escapeHtml(args.senderName)} replied to your support thread</h2>
    <p style="color:#6b7280;margin:0 0 16px 0;font-size:13px;">
      Subject: <strong>${escapeHtml(args.threadSubject)}</strong>
    </p>
    <div style="background:#f3f4f6;border-left:4px solid #4F46E5;padding:12px 16px;border-radius:6px;color:#111827;white-space:pre-wrap;font-size:14px;">
      ${escapeHtml(preview)}
    </div>
    <div style="margin:24px 0;text-align:center;">
      <a href="${url}" style="display:inline-block;background:#4F46E5;color:white;text-decoration:none;padding:10px 22px;border-radius:8px;font-weight:600;font-size:14px;">Open Support</a>
    </div>
    <p style="color:#9ca3af;font-size:11px;margin:0;">
      Reply directly in your portal so the whole conversation stays in one place.
    </p>
  </div>
</body>
</html>`;

  const text =
    `${args.senderName} replied to your support thread\n\n` +
    `Subject: ${args.threadSubject}\n\n` +
    `${preview}\n\n` +
    `Open the support portal: ${url}\n`;

  const command = new SendEmailCommand({
    Source: `Platform Support <${FROM_EMAIL}>`,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: subject },
      Body: { Html: { Data: html }, Text: { Data: text } },
    },
  });
  await ses.send(command);
}
