// GET   /api/admin/support/threads/[id]      — thread + messages
// PATCH /api/admin/support/threads/[id]      — { status?, assignedAdminId? }
//
// Both gated by requireSupportRole. PATCH accepts partial updates:
// - status: any valid SupportThreadStatus (CLOSED sets closedAt)
// - assignedAdminId: string UUID or null to unassign

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { logAdminAction } from "@/lib/admin-audit";
import { requireSupportRole } from "@/lib/support/rbac";
import {
  assignThread,
  getThreadForAdmin,
  getThreadForAdminWithAttachments,
  updateThreadStatus,
} from "@/lib/support/thread-service";
import { presignSupportDownload } from "@/lib/support/s3-support";
import {
  SUPPORT_THREAD_STATUSES,
  type SupportThreadStatusValue,
} from "@/lib/support/constants";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = requireSupportRole(request);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const thread = await getThreadForAdminWithAttachments(id);
  if (!thread) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Same tenant-name enrichment as the list endpoint.
  const tenantIds = [thread.merchantTenantId, thread.supplierTenantId].filter(
    Boolean
  ) as string[];
  const tenantMap = new Map<string, string>();
  if (tenantIds.length > 0) {
    const tenants = await prisma.tenant.findMany({
      where: { id: { in: tenantIds } },
      select: { id: true, name: true },
    });
    for (const t of tenants) tenantMap.set(t.id, t.name);
  }

  // Attach fresh presigned download URLs. Minted on every fetch (5-min
  // TTL) so a stale browser tab won't retain a valid link.
  const messages = await Promise.all(
    thread.messages.map(async (m) => {
      const attachments = await Promise.all(
        m.attachments.map(async (a) => ({
          id: a.id,
          fileName: a.fileName,
          contentType: a.contentType,
          sizeBytes: Number(a.sizeBytes),
          downloadUrl: await presignSupportDownload({
            s3Key: a.s3Key,
            fileName: a.fileName,
          }),
        }))
      );
      return { ...m, attachments };
    })
  );

  return NextResponse.json({
    thread: {
      ...thread,
      messages,
      merchantTenantName: thread.merchantTenantId
        ? tenantMap.get(thread.merchantTenantId) ?? null
        : null,
      supplierTenantName: thread.supplierTenantId
        ? tenantMap.get(thread.supplierTenantId) ?? null
        : null,
    },
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = requireSupportRole(request);
  if (gate instanceof NextResponse) return gate;
  const { actorId } = gate;

  const { id } = await params;

  let body: { status?: string; assignedAdminId?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const existing = await prisma.supportThread.findUnique({
    where: { id },
    select: { id: true, status: true, assignedAdminId: true },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const changes: { status?: string; assignedAdminId?: string | null } = {};

  if (body.status !== undefined) {
    if (!(SUPPORT_THREAD_STATUSES as readonly string[]).includes(body.status)) {
      return NextResponse.json({ error: "Invalid status." }, { status: 400 });
    }
    if (body.status !== existing.status) {
      await updateThreadStatus(id, body.status as SupportThreadStatusValue);
      changes.status = body.status;
    }
  }

  if (body.assignedAdminId !== undefined) {
    // Empty string / null → unassign. The literal string "self" is a
    // client-side sentinel: the Claim button doesn't know its own admin
    // UUID, so it POSTs "self" and we resolve it to actorId here. UUID
    // otherwise means assign-to-that-admin.
    let target: string | null;
    if (body.assignedAdminId === "self") {
      target = actorId;
    } else {
      target = body.assignedAdminId?.trim() || null;
    }
    if (target) {
      const admin = await prisma.adminUser.findUnique({
        where: { id: target },
        select: { id: true, isActive: true },
      });
      if (!admin || !admin.isActive) {
        return NextResponse.json(
          { error: "Assignee is not an active admin." },
          { status: 400 }
        );
      }
    }
    if (target !== existing.assignedAdminId) {
      await assignThread(id, target);
      changes.assignedAdminId = target;
    }
  }

  if (Object.keys(changes).length > 0) {
    await logAdminAction({
      adminUserId: actorId,
      action: "support.thread.update",
      resourceType: "SupportThread",
      resourceId: id,
      before: {
        status: existing.status,
        assignedAdminId: existing.assignedAdminId,
      },
      after: changes,
      request,
    });
  }

  const updated = await getThreadForAdmin(id);
  return NextResponse.json({ thread: updated });
}
