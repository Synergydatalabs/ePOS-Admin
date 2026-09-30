// POST /api/admin/applications/[id]/reject
//
// Body: { reason: string } — required (recorded on the timeline and stored
// on merchant_applications.rejection_reason so the merchant portal can
// surface it).
//
// Role gate: SUPER_ADMIN or COMPLIANCE. Rejection is a terminal state for
// this application — we allow it from any non-terminal status because
// compliance may need to kill a bad application even after we've forwarded.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { logAdminAction } from "@/lib/admin-audit";

const REJECT_ROLES = new Set(["SUPER_ADMIN", "COMPLIANCE"]);
// LIVE and REJECTED are terminal — we don't let admins re-reject those.
const TERMINAL_STATUSES = new Set(["LIVE", "REJECTED"]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const role = request.headers.get("x-admin-role") || "";
  const adminUserId = request.headers.get("x-admin-user-id") || "";
  if (!REJECT_ROLES.has(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!adminUserId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body: { reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const reason = String(body.reason || "").trim();
  if (!reason) {
    return NextResponse.json(
      { error: "reason is required — tell the merchant why" },
      { status: 400 }
    );
  }
  if (reason.length > 4000) {
    return NextResponse.json(
      { error: "reason must be 4000 characters or fewer" },
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
  if (TERMINAL_STATUSES.has(app.status)) {
    return NextResponse.json(
      { error: `Cannot reject from terminal status ${app.status}.` },
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
        status: "REJECTED",
        rejectionReason: reason,
        rejectedAt: now,
        reviewedByAdminEmail: adminEmail,
        lastAdminActionAt: now,
      },
    });
    await tx.applicationEvent.create({
      data: {
        applicationId: id,
        fromStatus: app.status,
        toStatus: "REJECTED",
        actorType: "ADMIN",
        actorId: adminUserId,
        note: reason,
      },
    });
    return updated;
  });

  await logAdminAction({
    adminUserId,
    action: "kyb.reject_application",
    resourceType: "merchant_application",
    resourceId: id,
    before: { status: app.status },
    after: { status: updated.status, reason },
    request,
  });

  return NextResponse.json({
    success: true,
    application: {
      id: updated.id,
      status: updated.status,
      rejectedAt: updated.rejectedAt,
      rejectionReason: updated.rejectionReason,
    },
  });
}
