// GET  /api/admin/support/threads?status=&merchantTenantId=&supplierTenantId=&entityType=&entityId=&assignedAdminId=&search=&take=&skip=
// POST /api/admin/support/threads
//
// Both gated by requireSupportRole (SUPER_ADMIN + SUPPORT). Creation
// writes an audit row so we can trace which operator opened which
// conversation with which merchant/supplier.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { logAdminAction } from "@/lib/admin-audit";
import { requireSupportRole } from "@/lib/support/rbac";
import {
  createThread,
  listThreads,
  adminDisplayName,
} from "@/lib/support/thread-service";
import {
  SUPPORT_THREAD_STATUSES,
  SUPPORT_ENTITY_TYPES,
  type SupportThreadStatusValue,
  type SupportEntityTypeValue,
} from "@/lib/support/constants";

function parseIntOrDefault(v: string | null, fallback: number, max: number): number {
  if (!v) return fallback;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

export async function GET(request: NextRequest) {
  const gate = requireSupportRole(request);
  if (gate instanceof NextResponse) return gate;

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const status =
    statusParam && (SUPPORT_THREAD_STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as SupportThreadStatusValue)
      : statusParam === "ALL"
        ? "ALL"
        : undefined;

  const entityTypeParam = url.searchParams.get("entityType");
  const entityType =
    entityTypeParam && (SUPPORT_ENTITY_TYPES as readonly string[]).includes(entityTypeParam)
      ? (entityTypeParam as SupportEntityTypeValue)
      : undefined;

  const { threads, total } = await listThreads({
    status,
    entityType,
    entityId: url.searchParams.get("entityId") || undefined,
    merchantTenantId: url.searchParams.get("merchantTenantId") || undefined,
    supplierTenantId: url.searchParams.get("supplierTenantId") || undefined,
    assignedAdminId: url.searchParams.get("assignedAdminId") || undefined,
    search: url.searchParams.get("search")?.trim() || undefined,
    take: parseIntOrDefault(url.searchParams.get("take"), 50, 200),
    skip: parseIntOrDefault(url.searchParams.get("skip"), 0, 100_000),
  });

  // Enrich rows with counterparty tenant names — the DB stores only UUIDs
  // on the thread. One extra query per page is cheap and keeps the UI
  // legible without needing a Prisma relation (we deliberately did not
  // add one to keep schema drift minimal).
  const tenantIds = Array.from(
    new Set(
      threads.flatMap((t) =>
        [t.merchantTenantId, t.supplierTenantId].filter(Boolean) as string[]
      )
    )
  );
  const tenantMap = new Map<string, string>();
  if (tenantIds.length > 0) {
    const tenants = await prisma.tenant.findMany({
      where: { id: { in: tenantIds } },
      select: { id: true, name: true },
    });
    for (const t of tenants) tenantMap.set(t.id, t.name);
  }

  const enriched = threads.map((t) => ({
    ...t,
    merchantTenantName: t.merchantTenantId ? tenantMap.get(t.merchantTenantId) ?? null : null,
    supplierTenantName: t.supplierTenantId ? tenantMap.get(t.supplierTenantId) ?? null : null,
  }));

  return NextResponse.json({ threads: enriched, total });
}

export async function POST(request: NextRequest) {
  const gate = requireSupportRole(request);
  if (gate instanceof NextResponse) return gate;
  const { actorId } = gate;

  let body: {
    subject?: string;
    merchantTenantId?: string | null;
    supplierTenantId?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    firstMessage?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const subject = body.subject?.trim();
  const firstMessage = body.firstMessage?.trim();
  if (!subject) {
    return NextResponse.json({ error: "Subject is required." }, { status: 400 });
  }
  if (subject.length > 255) {
    return NextResponse.json({ error: "Subject must be 255 characters or fewer." }, { status: 400 });
  }
  if (!firstMessage) {
    return NextResponse.json({ error: "First message is required." }, { status: 400 });
  }

  const entityType = body.entityType?.trim() || null;
  if (entityType && !(SUPPORT_ENTITY_TYPES as readonly string[]).includes(entityType)) {
    return NextResponse.json({ error: "Invalid entityType." }, { status: 400 });
  }
  if (entityType && !body.entityId?.trim()) {
    return NextResponse.json(
      { error: "entityId is required when entityType is set." },
      { status: 400 }
    );
  }

  // At least one of merchantTenantId / supplierTenantId should be set —
  // an admin-initiated thread must have a counterparty. Free-form threads
  // targeting nobody would just be admin notes, and we don't want to
  // support that in v1 (avoids becoming Slack-lite).
  const merchantTenantId = body.merchantTenantId?.trim() || null;
  const supplierTenantId = body.supplierTenantId?.trim() || null;
  if (!merchantTenantId && !supplierTenantId) {
    return NextResponse.json(
      { error: "Pick at least one counterparty (merchant or supplier)." },
      { status: 400 }
    );
  }

  const admin = await prisma.adminUser.findUnique({
    where: { id: actorId },
    select: { id: true, email: true, firstName: true, lastName: true },
  });
  if (!admin) return NextResponse.json({ error: "Actor missing" }, { status: 401 });

  const thread = await createThread({
    subject,
    merchantTenantId,
    supplierTenantId,
    entityType: (entityType as SupportEntityTypeValue | null) ?? null,
    entityId: body.entityId?.trim() || null,
    firstMessage,
    createdByType: "ADMIN",
    createdByAdminId: admin.id,
    createdByName: adminDisplayName(admin),
  });

  await logAdminAction({
    adminUserId: actorId,
    action: "support.thread.create",
    resourceType: "SupportThread",
    resourceId: thread.id,
    after: {
      subject: thread.subject,
      merchantTenantId: thread.merchantTenantId,
      supplierTenantId: thread.supplierTenantId,
      entityType: thread.entityType,
      entityId: thread.entityId,
    },
    request,
  });

  return NextResponse.json({ thread }, { status: 201 });
}
