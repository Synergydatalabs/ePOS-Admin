// POST /api/admin/support/threads/[id]/messages
//
// Body: { body: string, internalNote?: boolean }
// Gated by requireSupportRole. postMessage() flips thread status to
// WAITING_MERCHANT (skipped when internalNote=true so a note never
// changes what the counterparty sees).

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { logAdminAction } from "@/lib/admin-audit";
import { requireSupportRole } from "@/lib/support/rbac";
import {
  adminDisplayName,
  postMessage,
  type AttachmentInput,
} from "@/lib/support/thread-service";
import { notifyTenantOfAdminReply } from "@/lib/support/notify";
import {
  SUPPORT_ATTACHMENT_ALLOWED_MIME,
  SUPPORT_ATTACHMENT_MAX_BYTES,
} from "@/lib/support/s3-support";

const MAX_BODY_LEN = 8000;
const MAX_ATTACHMENTS = 5;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = requireSupportRole(request);
  if (gate instanceof NextResponse) return gate;
  const { actorId } = gate;

  const { id } = await params;

  let body: {
    body?: string;
    internalNote?: boolean;
    attachments?: AttachmentInput[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const text = body.body?.trim();
  if (!text) return NextResponse.json({ error: "Message body required" }, { status: 400 });
  if (text.length > MAX_BODY_LEN) {
    return NextResponse.json(
      { error: `Message too long (max ${MAX_BODY_LEN} chars)` },
      { status: 400 }
    );
  }

  // Attachment metadata validation — defense in depth even though the
  // presign endpoint already gate-kept the upload.
  const attachments = body.attachments ?? [];
  if (attachments.length > MAX_ATTACHMENTS) {
    return NextResponse.json(
      { error: `Too many attachments (max ${MAX_ATTACHMENTS})` },
      { status: 400 }
    );
  }
  for (const a of attachments) {
    if (!a.s3Key || !a.fileName || !a.contentType || !Number.isFinite(a.sizeBytes)) {
      return NextResponse.json({ error: "Malformed attachment entry" }, { status: 400 });
    }
    if (a.sizeBytes <= 0 || a.sizeBytes > SUPPORT_ATTACHMENT_MAX_BYTES) {
      return NextResponse.json({ error: "Attachment size out of range" }, { status: 400 });
    }
    if (!SUPPORT_ATTACHMENT_ALLOWED_MIME.has(a.contentType)) {
      return NextResponse.json({ error: "Attachment type not allowed" }, { status: 400 });
    }
    if (!a.s3Key.startsWith(`support/${id}/`)) {
      return NextResponse.json({ error: "Attachment key mismatch" }, { status: 400 });
    }
  }

  const thread = await prisma.supportThread.findUnique({
    where: { id },
    select: {
      id: true,
      subject: true,
      status: true,
      merchantTenantId: true,
      supplierTenantId: true,
    },
  });
  if (!thread) return NextResponse.json({ error: "not found" }, { status: 404 });

  const admin = await prisma.adminUser.findUnique({
    where: { id: actorId },
    select: { id: true, email: true, firstName: true, lastName: true },
  });
  if (!admin) return NextResponse.json({ error: "Actor missing" }, { status: 401 });

  const internal = body.internalNote === true;

  const message = await postMessage({
    threadId: id,
    senderType: "ADMIN",
    senderId: admin.id,
    senderName: adminDisplayName(admin),
    body: text,
    internalNote: internal,
    attachments,
  });

  await logAdminAction({
    adminUserId: actorId,
    action: internal ? "support.message.note" : "support.message.post",
    resourceType: "SupportThread",
    resourceId: id,
    after: {
      messageId: message.id,
      bytes: text.length,
      internal,
      attachments: attachments.length,
    },
    request,
  });

  // Public reply → notify tenant. Internal notes never leave the admin
  // side, so skip the email in that case.
  if (!internal) {
    notifyTenantOfAdminReply({
      threadId: id,
      threadSubject: thread.subject,
      senderName: adminDisplayName(admin),
      bodyPreview: text,
      merchantTenantId: thread.merchantTenantId,
      supplierTenantId: thread.supplierTenantId,
    }).catch((err) => console.error("notifyTenantOfAdminReply failed:", err));
  }

  return NextResponse.json({ message }, { status: 201 });
}
