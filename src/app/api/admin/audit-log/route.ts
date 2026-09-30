// GET /api/admin/audit-log
//
// Global audit-log query used by the /audit-log page. SUPER_ADMIN and
// COMPLIANCE only — every other role gets a 403 (the sidebar hides the
// nav item, but that's a UX hint; this route is the authoritative gate).
//
// Query params (all optional):
//   adminId       — filter to one admin actor
//   action        — filter to one action slug (e.g. "admin_user.create")
//   resourceType  — filter to one resourceType
//   resourceId    — free-text contains match on the resourceId column
//   search        — alias for resourceId (used by the search input)
//   from, to      — ISO date bounds on createdAt
//   page          — 1-based page number; pageSize is fixed at 50
//
// Returns { events, total, page, pageSize } — plus, on page 1 only,
// distinctActions / distinctResourceTypes / admins so the client can
// populate the filter dropdowns without a second round-trip.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

const AUDIT_ROLES = new Set(["SUPER_ADMIN", "COMPLIANCE"]);
const PAGE_SIZE = 50;

export async function GET(request: NextRequest) {
  const role = request.headers.get("x-admin-role") || "";
  if (!AUDIT_ROLES.has(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const adminId = searchParams.get("adminId")?.trim() || "";
  const action = searchParams.get("action")?.trim() || "";
  const resourceType = searchParams.get("resourceType")?.trim() || "";
  const resourceId = searchParams.get("resourceId")?.trim() || "";
  const search = searchParams.get("search")?.trim() || "";
  const fromRaw = searchParams.get("from")?.trim() || "";
  const toRaw = searchParams.get("to")?.trim() || "";
  const pageRaw = Number(searchParams.get("page") || "1");
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;

  const where: Prisma.AdminAuditLogWhereInput = {};
  if (adminId) where.adminUserId = adminId;
  if (action) where.action = action;
  if (resourceType) where.resourceType = resourceType;
  // resourceId is an exact match when the caller passes it explicitly
  // (deep links), but a "contains" when it comes in via free-text search.
  if (resourceId) where.resourceId = resourceId;
  if (search) where.resourceId = { contains: search, mode: "insensitive" };

  const createdAt: Prisma.DateTimeFilter = {};
  const fromDate = fromRaw ? new Date(fromRaw) : null;
  const toDate = toRaw ? new Date(toRaw) : null;
  if (fromDate && !isNaN(fromDate.getTime())) createdAt.gte = fromDate;
  if (toDate && !isNaN(toDate.getTime())) {
    // Inclusive end-of-day when the caller passed a bare YYYY-MM-DD.
    if (/^\d{4}-\d{2}-\d{2}$/.test(toRaw)) {
      toDate.setUTCHours(23, 59, 59, 999);
    }
    createdAt.lte = toDate;
  }
  if (createdAt.gte || createdAt.lte) where.createdAt = createdAt;

  const [rows, total] = await Promise.all([
    prisma.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        action: true,
        resourceType: true,
        resourceId: true,
        before: true,
        after: true,
        ipAddress: true,
        createdAt: true,
        adminUser: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
    }),
    prisma.adminAuditLog.count({ where }),
  ]);

  const events = rows.map((r) => ({
    id: r.id,
    action: r.action,
    resourceType: r.resourceType,
    resourceId: r.resourceId,
    before: r.before,
    after: r.after,
    ipAddress: r.ipAddress,
    createdAt: r.createdAt,
    admin: r.adminUser
      ? {
          id: r.adminUser.id,
          email: r.adminUser.email,
          firstName: r.adminUser.firstName,
          lastName: r.adminUser.lastName,
          role: r.adminUser.role,
        }
      : null,
  }));

  // Filter dropdown data — only shipped on page 1 so pagination stays
  // cheap. The client caches these across page changes.
  let distinctActions: string[] | undefined;
  let distinctResourceTypes: string[] | undefined;
  let admins:
    | { id: string; email: string; firstName: string | null; lastName: string | null }[]
    | undefined;

  if (page === 1) {
    const [actionsAgg, typesAgg, adminRows] = await Promise.all([
      prisma.adminAuditLog.groupBy({ by: ["action"], _count: true }),
      prisma.adminAuditLog.groupBy({
        by: ["resourceType"],
        _count: true,
        where: { resourceType: { not: null } },
      }),
      prisma.adminUser.findMany({
        orderBy: { email: "asc" },
        select: { id: true, email: true, firstName: true, lastName: true },
      }),
    ]);
    distinctActions = actionsAgg
      .map((a) => a.action)
      .filter((v): v is string => !!v)
      .sort();
    distinctResourceTypes = typesAgg
      .map((t) => t.resourceType)
      .filter((v): v is string => !!v)
      .sort();
    admins = adminRows;
  }

  return NextResponse.json({
    events,
    total,
    page,
    pageSize: PAGE_SIZE,
    distinctActions,
    distinctResourceTypes,
    admins,
  });
}
