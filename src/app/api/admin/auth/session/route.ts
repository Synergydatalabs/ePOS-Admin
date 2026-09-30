// GET /api/admin/auth/session — who am I? Used by client components that need
// the current admin's identity without a server-component round-trip.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/admin-auth";

export async function GET(request: NextRequest) {
  const session = await getAdminSession(request);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const user = await prisma.adminUser.findUnique({
    where: { id: session.adminUserId },
    select: { id: true, email: true, firstName: true, lastName: true, role: true },
  });

  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ user });
}
