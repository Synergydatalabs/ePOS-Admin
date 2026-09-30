// GET /api/admin/applications/[id]/documents/[docId]/download
//
// Returns { url } — a fresh presigned S3 GET URL (5 min TTL). Also writes
// an AdminAuditLog row (`kyb.download_document`) so every download can
// be traced back to an admin, and takes a `disposition` query param
// (`inline` for the preview modal, `attachment` for the download button).
//
// Route trusts middleware to have already gated on auth; we still fetch
// the admin id/email from the request headers stamped there.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { getKybDownloadUrl } from "@/lib/s3-kyb";
import { logAdminAction } from "@/lib/admin-audit";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  const { id, docId } = await params;
  const adminUserId = request.headers.get("x-admin-user-id");
  if (!adminUserId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const disposition =
    request.nextUrl.searchParams.get("disposition") === "inline"
      ? "inline"
      : "attachment";

  const doc = await prisma.kybDocument.findUnique({
    where: { id: docId },
    select: {
      id: true,
      applicationId: true,
      s3Key: true,
      originalFilename: true,
      mimeType: true,
      sizeBytes: true,
      deletedAt: true,
      application: { select: { id: true, tenantId: true } },
    },
  });
  if (!doc || doc.applicationId !== id) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  if (doc.deletedAt) {
    return NextResponse.json({ error: "Document was deleted" }, { status: 410 });
  }

  let signed: { url: string; expiresAt: string };
  try {
    signed = await getKybDownloadUrl({
      s3Key: doc.s3Key,
      filename: doc.originalFilename,
      disposition,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Failed to sign URL" },
      { status: 500 }
    );
  }

  // Audit — record which doc was accessed but NEVER the URL itself.
  // A URL in an audit log is effectively still-live credentials for
  // 5 minutes, which we don't want in Postgres.
  await logAdminAction({
    adminUserId,
    action: "kyb.download_document",
    resourceType: "KybDocument",
    resourceId: doc.id,
    after: {
      applicationId: doc.applicationId,
      tenantId: doc.application.tenantId,
      filename: doc.originalFilename,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      disposition,
    },
    request,
  });

  return NextResponse.json({
    url: signed.url,
    expiresAt: signed.expiresAt,
    mimeType: doc.mimeType,
    filename: doc.originalFilename,
  });
}
