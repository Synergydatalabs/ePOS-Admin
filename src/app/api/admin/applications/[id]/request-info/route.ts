// POST /api/admin/applications/[id]/request-info
//
// Body: { note: string }  — required (this is the thing the merchant needs
// to provide before we can move forward)
//
// Role gate: SUPPORT and above (i.e. any admin except SALES-only / FINANCE
// which are read/report roles). Refuses unless the status is one of
// SUBMITTED, IN_REVIEW, or FORWARDED — you can bounce back from any active
// state to ask for more info.
//
// Writes ApplicationEvent + AdminAuditLog and stores the note on
// merchant_applications.info_requested so the merchant's next visit shows
// exactly what we're waiting on.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { logAdminAction } from "@/lib/admin-audit";

// Any of these admin roles can request more info.
const REQUEST_INFO_ROLES = new Set(["SUPER_ADMIN", "COMPLIANCE", "SUPPORT"]);
const ALLOWED_FROM_STATUSES = new Set(["SUBMITTED", "IN_REVIEW", "FORWARDED"]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const role = request.headers.get("x-admin-role") || "";
  const adminUserId = request.headers.get("x-admin-user-id") || "";
  if (!REQUEST_INFO_ROLES.has(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!adminUserId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body: { note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const note = String(body.note || "").trim();
  if (!note) {
    return NextResponse.json(
      { error: "note is required — tell the merchant what's needed" },
      { status: 400 }
    );
  }
  if (note.length > 4000) {
    return NextResponse.json(
      { error: "note must be 4000 characters or fewer" },
      { status: 400 }
    );
  }

  const app = await prisma.merchantApplication.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!app) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }
  if (!ALLOWED_FROM_STATUSES.has(app.status)) {
    return NextResponse.json(
      {
        error: `Cannot request info from status ${app.status}. Allowed: SUBMITTED, IN_REVIEW, FORWARDED.`,
      },
      { status: 409 }
    );
  }

  const adminEmail = await prisma.adminUser
    .findUnique({ where: { id: adminUserId }, select: { email: true } })
    .then((r) => r?.email ?? null);

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const updated = await tx.merchantApplication.update({
      where: { id: app.id },
      data: {
        status: "INFO_REQUESTED",
        infoRequested: note,
        infoRequestedAt: now,
        reviewedByAdminEmail: adminEmail,
        lastAdminActionAt: now,
      },
    });
    await tx.applicationEvent.create({
      data: {
        applicationId: id,
        fromStatus: app.status,
        toStatus: "INFO_REQUESTED",
        actorType: "ADMIN",
        actorId: adminUserId,
        note,
      },
    });
    return updated;
  });

  await logAdminAction({
    adminUserId,
    action: "kyb.request_more_info",
    resourceType: "merchant_application",
    resourceId: id,
    before: { status: app.status },
    after: { status: updated.status, note },
    request,
  });

  return NextResponse.json({
    success: true,
    application: {
      id: updated.id,
      status: updated.status,
      infoRequestedAt: updated.infoRequestedAt,
      infoRequested: updated.infoRequested,
    },
  });
}
