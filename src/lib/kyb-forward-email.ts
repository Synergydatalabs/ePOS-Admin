// ============================================================================
// Send the KYB forward email to a processor's onboarding team.
//
// Same SES sender init as tap-app (`SESClient` from `@aws-sdk/client-ses`).
// We do NOT attach the ZIP inline — even a modest KYB bundle can push past
// SES's 40MB message size and email clients start rejecting/quarantining
// anything over 10MB anyway. Instead we upload the ZIP to S3 first, sign a
// 7-day GET URL, and inline that URL in the email body.
//
// The email intentionally contains no PII — the summary + KYB documents are
// behind the presigned URL. The recipient can forward the email without
// leaking anything sensitive (until they click the link).
//
// Returns the SES MessageId so the caller can persist it for audit; a
// missing MessageId is treated as a soft failure (email sent but SES didn't
// echo an id) rather than a hard error.
// ============================================================================

import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import type { MerchantApplication, UboRecord } from "@prisma/client";
import { uploadKybForwardBundle } from "@/lib/s3-kyb";

let cachedClient: SESClient | null = null;
function getSes(): SESClient {
  if (cachedClient) return cachedClient;
  const region = process.env.AWS_REGION || process.env.AWS_S3_REGION || "us-east-1";
  cachedClient = new SESClient({ region });
  return cachedClient;
}

function getFromAddress(): string {
  return (
    process.env.SES_FROM_ADDRESS ||
    process.env.SES_FROM_EMAIL ||
    "noreply@zashx.com"
  );
}

export function getProcessorOnboardingEmail(
  toProcessor: "GP" | "MONERIS"
): string {
  if (toProcessor === "GP") {
    return process.env.GP_ONBOARDING_EMAIL || "partneronboarding@globalpayments.com";
  }
  return process.env.MONERIS_ONBOARDING_EMAIL || "newpartner@moneris.com";
}

export interface SendForwardEmailInput {
  toProcessor: "GP" | "MONERIS";
  application: MerchantApplication & { tenant?: { name: string; slug: string } | null };
  ubos: UboRecord[];
  pdfBuffer: Buffer;
  zipBuffer: Buffer;
  // Suffix used for the S3 object key. Defaults to Date.now() but the
  // caller can pass an explicit token for idempotent uploads (rerun after
  // an SES throttle without stacking objects in S3).
  bundleToken?: string;
  ccAdminEmail?: string;
  additionalNote?: string | null;
}

export interface SendForwardEmailResult {
  messageId: string | null;
  toEmail: string;
  zipS3Key: string;
  zipDownloadUrl: string;
  zipExpiresAt: string;
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendForwardEmail(
  input: SendForwardEmailInput
): Promise<SendForwardEmailResult> {
  const { toProcessor, application, ubos, zipBuffer, additionalNote } = input;
  const token = input.bundleToken || String(Date.now());
  const key = `kyb-forwards/${application.id}/${token}.zip`;

  const { s3Key, downloadUrl, expiresAt } = await uploadKybForwardBundle({
    key,
    body: zipBuffer,
    contentType: "application/zip",
  });

  const toEmail = getProcessorOnboardingEmail(toProcessor);
  const processorLabel = toProcessor === "GP" ? "Global Payments" : "Moneris";
  const businessName = application.legalName;
  const subject =
    toProcessor === "GP"
      ? `KYB packet — ${businessName} (Oreugo merchant referral)`
      : `Moneris merchant referral — ${businessName} (Oreugo)`;

  const uboCount = ubos.length;
  const regionLine = application.incorporationRegion || "N/A";
  const volumeLine =
    application.projectedMonthlyVolumeCents != null
      ? `${application.currency} ${(application.projectedMonthlyVolumeCents / 100).toLocaleString("en-US", {
          maximumFractionDigits: 0,
        })}/mo (projected)`
      : "N/A";

  const noteBlockHtml = additionalNote
    ? `<p style="color:#4b5563;line-height:1.6;background:#f3f4f6;border-radius:8px;padding:12px 14px;">
         <strong>From reviewer:</strong> ${escapeHtml(additionalNote)}
       </p>`
    : "";
  const noteBlockText = additionalNote ? `\nFrom reviewer:\n${additionalNote}\n` : "";

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto;padding:20px;background:#f9fafb;">
  <div style="background:#fff;border-radius:12px;padding:28px;">
    <h2 style="color:#111827;margin:0 0 12px 0;">Merchant referral — ${escapeHtml(businessName)}</h2>
    <p style="color:#4b5563;line-height:1.6;">
      Hi ${escapeHtml(processorLabel)} team,
    </p>
    <p style="color:#4b5563;line-height:1.6;">
      We'd like to refer the merchant below for a merchant account.
      Full KYB packet (business summary PDF + supporting documents) is
      attached as a secure download link — it expires in 7 days.
    </p>
    ${noteBlockHtml}
    <table style="width:100%;border-collapse:collapse;margin:12px 0;">
      <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;width:40%;">Legal name</td><td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;">${escapeHtml(businessName)}</td></tr>
      ${application.dbaName ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">DBA</td><td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;">${escapeHtml(application.dbaName)}</td></tr>` : ""}
      <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Region</td><td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;">${escapeHtml(regionLine)}</td></tr>
      ${application.mccCode ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">MCC</td><td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;">${escapeHtml(application.mccCode)}</td></tr>` : ""}
      <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Volume</td><td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;">${escapeHtml(volumeLine)}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">UBOs on file</td><td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;">${uboCount}</td></tr>
      ${application.signerName ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Signer</td><td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;">${escapeHtml(application.signerName)}${application.signerEmail ? ` — ${escapeHtml(application.signerEmail)}` : ""}</td></tr>` : ""}
    </table>
    <div style="text-align:center;margin:24px 0;">
      <a href="${downloadUrl}" style="display:inline-block;background:#4F46E5;color:white;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;">
        Download KYB Packet (ZIP)
      </a>
    </div>
    <p style="color:#9ca3af;font-size:12px;line-height:1.5;margin:20px 0 0 0;">
      Link expires ${escapeHtml(new Date(expiresAt).toUTCString())}. Please reply
      once you've received the packet so we can confirm delivery. Merchant ID
      (once assigned) can be sent back to compliance@oreugo.com or logged in
      the Oreugo admin portal.
    </p>
  </div>
  <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:16px;">
    Oreugo Merchant Onboarding — automated referral
  </p>
</body>
</html>`;

  const text =
    `Merchant referral — ${businessName}\n\n` +
    `Hi ${processorLabel} team,\n\n` +
    `We'd like to refer the merchant below for a merchant account. Full KYB packet (business summary PDF + supporting documents) is available at the secure link below — expires in 7 days.\n` +
    noteBlockText +
    `\nLegal name: ${businessName}\n` +
    (application.dbaName ? `DBA: ${application.dbaName}\n` : "") +
    `Region: ${regionLine}\n` +
    (application.mccCode ? `MCC: ${application.mccCode}\n` : "") +
    `Volume: ${volumeLine}\n` +
    `UBOs on file: ${uboCount}\n` +
    (application.signerName
      ? `Signer: ${application.signerName}${application.signerEmail ? ` — ${application.signerEmail}` : ""}\n`
      : "") +
    `\nDownload KYB packet:\n${downloadUrl}\n\n` +
    `Link expires ${new Date(expiresAt).toUTCString()}.\n` +
    `Please reply once received. MID can be sent back to compliance@oreugo.com or logged in the Oreugo admin portal.\n`;

  const to = [toEmail];
  const cc = input.ccAdminEmail ? [input.ccAdminEmail] : undefined;

  const command = new SendEmailCommand({
    Source: `Oreugo Merchant Onboarding <${getFromAddress()}>`,
    Destination: { ToAddresses: to, CcAddresses: cc },
    Message: {
      Subject: { Data: subject },
      Body: {
        Html: { Data: html },
        Text: { Data: text },
      },
    },
  });

  const res = await getSes().send(command);
  return {
    messageId: res.MessageId || null,
    toEmail,
    zipS3Key: s3Key,
    zipDownloadUrl: downloadUrl,
    zipExpiresAt: expiresAt,
  };
}
