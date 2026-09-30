// POST /api/admin/support/threads/[id]/attachments/presign — admin-side
// counterpart. Same shape as tap-app's version. Gated by requireSupportRole.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { requireSupportRole } from "@/lib/support/rbac";
import {
  SUPPORT_ATTACHMENT_ALLOWED_MIME,
  SUPPORT_ATTACHMENT_MAX_BYTES,
  buildSupportAttachmentKey,
  presignSupportUpload,
} from "@/lib/support/s3-support";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = requireSupportRole(request);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;

  let body: { fileName?: string; contentType?: string; sizeBytes?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const fileName = body.fileName?.trim();
  const contentType = body.contentType?.trim();
  const sizeBytes = Number(body.sizeBytes);

  if (!fileName) return NextResponse.json({ error: "fileName required" }, { status: 400 });
  if (!contentType) return NextResponse.json({ error: "contentType required" }, { status: 400 });
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return NextResponse.json({ error: "sizeBytes required" }, { status: 400 });
  }
  if (sizeBytes > SUPPORT_ATTACHMENT_MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (max ${SUPPORT_ATTACHMENT_MAX_BYTES / (1024 * 1024)} MB)` },
      { status: 400 }
    );
  }
  if (!SUPPORT_ATTACHMENT_ALLOWED_MIME.has(contentType)) {
    return NextResponse.json({ error: "File type not allowed" }, { status: 400 });
  }

  const thread = await prisma.supportThread.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!thread) return NextResponse.json({ error: "not found" }, { status: 404 });

  const key = buildSupportAttachmentKey({ threadId: id, fileName });
  const { url, expiresAt } = await presignSupportUpload({ key, contentType });
  return NextResponse.json({ uploadUrl: url, s3Key: key, expiresAt });
}
