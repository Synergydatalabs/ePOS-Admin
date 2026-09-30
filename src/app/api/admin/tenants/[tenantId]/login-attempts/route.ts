// GET /api/admin/tenants/:id/login-attempts — current auth state per member.
// tap-app has no dedicated login-attempts table today (rate-limit counters
// live on Membership itself); this endpoint surfaces that snapshot so ops
// can see who is locked or accumulating failures. A real time-series log
// requires schema work — flagged in the UI banner.
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

  const memberships = await prisma.membership.findMany({
    where: { tenantId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      status: true,
      loginAttempts: true,
      lockedUntil: true,
      lastPasswordChange: true,
      lastActiveAt: true,
      createdAt: true,
    },
    // Sort: anyone locked OR with >0 failed attempts bubbles up first.
    // Prisma can't do a computed "priority" sort in one query, so we fetch
    // and re-sort in JS — this tenant's membership set is small enough.
    take: 200,
  });

  const now = Date.now();
  const decorated = memberships.map((m) => ({
    ...m,
    isLocked: m.lockedUntil ? m.lockedUntil.getTime() > now : false,
  }));

  decorated.sort((a, b) => {
    const aPriority = (a.isLocked ? 2 : 0) + (a.loginAttempts > 0 ? 1 : 0);
    const bPriority = (b.isLocked ? 2 : 0) + (b.loginAttempts > 0 ? 1 : 0);
    if (aPriority !== bPriority) return bPriority - aPriority;
    // Then most-recently-active first for the "normal" bucket.
    const aLast = a.lastActiveAt?.getTime() ?? 0;
    const bLast = b.lastActiveAt?.getTime() ?? 0;
    return bLast - aLast;
  });

  return NextResponse.json({
    members: decorated.slice(0, 50),
    note: "Current-state snapshot per user. Time-series login-attempt log ships in a follow-up.",
  });
}
