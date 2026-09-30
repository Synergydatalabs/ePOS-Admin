// GET /api/admin/tenants — filtered list capped at 100 rows.
// Middleware already enforced auth; we just read query params and query.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

// Phase I #4 (2026-09-12): PENDING_APPROVAL + REJECTED added so the
// new signup approval queue is filterable from this list.
const ALLOWED_STATUS = new Set([
  "ACTIVE",
  "SUSPENDED",
  "CANCELLED",
  "PENDING_APPROVAL",
  "REJECTED",
]);

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const search = url.searchParams.get("search")?.trim() || "";
  const businessType = url.searchParams.get("businessType")?.trim() || "";
  const status = url.searchParams.get("status")?.trim() || "";

  const where: Prisma.TenantWhereInput = {};
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { slug: { contains: search, mode: "insensitive" } },
    ];
  }
  if (businessType) where.businessType = businessType;
  if (status && ALLOWED_STATUS.has(status)) {
    where.status = status as Prisma.TenantWhereInput["status"];
  }

  const tenants = await prisma.tenant.findMany({
    where,
    select: {
      id: true,
      name: true,
      slug: true,
      businessType: true,
      status: true,
      createdAt: true,
      // Phase I #4 (2026-09-12): pull verification state so the row
      // can show email ✓ / phone ✓ pills next to PENDING_APPROVAL
      // tenants. Grandfathered ACTIVE tenants have no verification
      // row — the join returns null and the UI falls back gracefully.
      verification: {
        select: {
          emailVerifiedAt: true,
          phoneVerifiedAt: true,
          contactEmail: true,
          contactPhone: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({ tenants });
}
