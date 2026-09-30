// GET /api/admin/tenants/:id — tenant + rollup counts.
// Terminals and orders live on Location, so we count them through the join.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";

interface Params {
  params: Promise<{ tenantId: string }>;
}

export async function GET(_request: NextRequest, { params }: Params) {
  const { tenantId } = await params;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      currency: true,
      timezone: true,
      businessType: true,
      createdAt: true,
    },
  });
  if (!tenant) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [locations, memberships, terminals, ordersLast30Days] = await Promise.all([
    prisma.location.count({ where: { tenantId } }),
    prisma.membership.count({ where: { tenantId } }),
    prisma.terminal.count({ where: { location: { tenantId } } }),
    prisma.order.count({
      where: {
        location: { tenantId },
        createdAt: { gte: thirtyDaysAgo },
      },
    }),
  ]);

  return NextResponse.json({
    tenant,
    counts: { locations, memberships, terminals, ordersLast30Days },
  });
}
