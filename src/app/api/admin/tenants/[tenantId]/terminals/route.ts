// GET /api/admin/tenants/:id/terminals — all terminals across the tenant's
// locations. Ordered so the default terminal per location floats to the top.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";

interface Params {
  params: Promise<{ tenantId: string }>;
}

const READ_ROLES = new Set(["SUPER_ADMIN", "COMPLIANCE", "SUPPORT"]);

export async function GET(request: NextRequest, { params }: Params) {
  const role = request.headers.get("x-admin-role") || "";
  if (!READ_ROLES.has(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { tenantId } = await params;

  const terminals = await prisma.terminal.findMany({
    where: { location: { tenantId } },
    select: {
      id: true,
      name: true,
      provider: true,
      uciLane: true,
      uciEnvironment: true,
      uciMerchantId: true,
      status: true,
      isDefault: true,
      locationId: true,
      createdAt: true,
      lastPingAt: true,
      location: { select: { id: true, name: true } },
    },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });

  return NextResponse.json({ terminals });
}
