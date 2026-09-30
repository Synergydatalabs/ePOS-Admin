// POST /api/admin/applications/[id]/forward
//
// Body: { processor: "GP" | "MONERIS", note?: string }
//
// Builds the PDF summary + ZIP of every non-deleted KybDocument, uploads
// the ZIP to S3, sends the processor's onboarding team an email with the
// presigned download link, and transitions the application to FORWARDED.
//
// Role gate: SUPER_ADMIN or COMPLIANCE. Refuses unless the current status
// is SUBMITTED, IN_REVIEW, or INFO_REQUESTED — anything past that has
// already been handed off (FORWARDED) or beyond (PROVIDER_APPROVED / LIVE
// / REJECTED) and shouldn't be re-forwarded from the same admin action.
//
// Every step writes an ApplicationEvent + AdminAuditLog so we can prove
// who did what after the fact.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { logAdminAction } from "@/lib/admin-audit";
import { buildKybSummaryPdf } from "@/lib/kyb-summary-pdf";
import { buildKybForwardBundle } from "@/lib/kyb-bundle";
import { sendForwardEmail } from "@/lib/kyb-forward-email";

const FORWARD_ROLES = new Set(["SUPER_ADMIN", "COMPLIANCE"]);
// Hardcoded array (not Object.values on a Prisma enum) per the Phase 1a
// fix — top-level Object.values(SomeEnum) blows up during Next.js build
// module tracing on some environments.
const ALLOWED_FROM_STATUSES = new Set(["SUBMITTED", "IN_REVIEW", "INFO_REQUESTED"]);
const ALLOWED_PROCESSORS = new Set(["GP", "MONERIS"]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const role = request.headers.get("x-admin-role") || "";
  const adminUserId = request.headers.get("x-admin-user-id") || "";
  if (!FORWARD_ROLES.has(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!adminUserId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body: { processor?: string; note?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const processor = String(body.processor || "").toUpperCase();
  if (!ALLOWED_PROCESSORS.has(processor)) {
    return NextResponse.json(
      { error: "processor must be 'GP' or 'MONERIS'" },
      { status: 400 }
    );
  }

  const app = await prisma.merchantApplication.findUnique({
    where: { id },
    include: {
      tenant: { select: { name: true, slug: true } },
      ubos: true,
      documents: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } },
      events: { orderBy: { at: "desc" }, take: 10 },
    },
  });
  if (!app) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }
  if (!ALLOWED_FROM_STATUSES.has(app.status)) {
    return NextResponse.json(
      {
        error: `Cannot forward from status ${app.status}. Allowed: SUBMITTED, IN_REVIEW, INFO_REQUESTED.`,
      },
      { status: 409 }
    );
  }
  if (app.documents.length === 0) {
    return NextResponse.json(
      { error: "No documents uploaded — refusing to forward an empty packet." },
      { status: 409 }
    );
  }

  const adminEmail = await prisma.adminUser
    .findUnique({ where: { id: adminUserId }, select: { email: true } })
    .then((r) => r?.email ?? null);

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await buildKybSummaryPdf({
      application: app,
      ubos: app.ubos,
      events: app.events,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to build summary PDF: ${(err as Error).message}` },
      { status: 500 }
    );
  }

  let zipBuffer: Buffer;
  let zipFilenames: string[];
  try {
    const bundle = await buildKybForwardBundle({ pdfBuffer, documents: app.documents });
    zipBuffer = bundle.zipBuffer;
    zipFilenames = bundle.filenames;
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to build ZIP bundle: ${(err as Error).message}` },
      { status: 500 }
    );
  }

  let sesResult: Awaited<ReturnType<typeof sendForwardEmail>>;
  try {
    sesResult = await sendForwardEmail({
      toProcessor: processor as "GP" | "MONERIS",
      application: app,
      ubos: app.ubos,
      pdfBuffer,
      zipBuffer,
      ccAdminEmail: adminEmail ?? undefined,
      additionalNote: body.note?.trim() || null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `SES send failed: ${(err as Error).message}` },
      { status: 502 }
    );
  }

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const updated = await tx.merchantApplication.update({
      where: { id },
      data: {
        status: "FORWARDED",
        forwardedAt: now,
        forwardedToEmail: sesResult.toEmail,
        forwardedToProcessor: processor as "GP" | "MONERIS",
        forwardedByAdminId: adminUserId,
        forwardBundleS3Key: sesResult.zipS3Key,
        processorMessageId: sesResult.messageId,
        reviewedByAdminEmail: adminEmail,
        lastAdminActionAt: now,
      },
    });
    await tx.applicationEvent.create({
      data: {
        applicationId: id,
        fromStatus: app.status,
        toStatus: "FORWARDED",
        actorType: "ADMIN",
        actorId: adminUserId,
        note:
          `Forwarded to ${processor} onboarding (${sesResult.toEmail}). ` +
          `Bundle: ${zipFilenames.length} files, ${zipBuffer.length} bytes.` +
          (body.note?.trim() ? `\nNote: ${body.note.trim()}` : ""),
      },
    });
    return updated;
  });

  await logAdminAction({
    adminUserId,
    action: "kyb.forward_to_processor",
    resourceType: "merchant_application",
    resourceId: id,
    before: { status: app.status },
    after: {
      status: updated.status,
      processor,
      toEmail: sesResult.toEmail,
      s3Key: sesResult.zipS3Key,
      messageId: sesResult.messageId,
      fileCount: zipFilenames.length,
      byteSize: zipBuffer.length,
    },
    request,
  });

  return NextResponse.json({
    success: true,
    application: {
      id: updated.id,
      status: updated.status,
      forwardedAt: updated.forwardedAt,
      forwardedToEmail: updated.forwardedToEmail,
      forwardedToProcessor: updated.forwardedToProcessor,
    },
    bundle: {
      s3Key: sesResult.zipS3Key,
      byteSize: zipBuffer.length,
      fileCount: zipFilenames.length,
      messageId: sesResult.messageId,
      expiresAt: sesResult.zipExpiresAt,
    },
  });
}
