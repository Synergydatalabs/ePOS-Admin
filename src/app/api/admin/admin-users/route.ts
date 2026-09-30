// Admin-user directory + invite. SUPER_ADMIN gated at the route level
// (middleware already stamped x-admin-role). The invite endpoint returns
// the temp password ONCE in the response body — the inviter is expected to
// hand it off out-of-band. It never lives at rest anywhere but as a bcrypt hash.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { AdminRole, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  generateTempPassword,
  hashPassword,
} from "@/lib/admin-auth";
import { logAdminAction } from "@/lib/admin-audit";

// Hardcoded rather than `Object.values(AdminRole)` — module-scope
// enum spreads break Next 15's build-time page-data collector when
// the Prisma runtime enum resolves undefined. Keep this list in
// sync with the AdminRole enum in schema.prisma.
const VALID_ROLES = new Set<string>([
  "SUPER_ADMIN",
  "COMPLIANCE",
  "SUPPORT",
  "SALES",
  "FINANCE",
]);

function requireSuperAdmin(request: NextRequest): { actorId: string } | NextResponse {
  const role = request.headers.get("x-admin-role");
  const actorId = request.headers.get("x-admin-user-id");
  if (role !== "SUPER_ADMIN" || !actorId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return { actorId };
}

const USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AdminUserSelect;

export async function GET(request: NextRequest) {
  const gate = requireSuperAdmin(request);
  if (gate instanceof NextResponse) return gate;

  const users = await prisma.adminUser.findMany({
    select: USER_SELECT,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ users });
}

export async function POST(request: NextRequest) {
  const gate = requireSuperAdmin(request);
  if (gate instanceof NextResponse) return gate;
  const { actorId } = gate;

  let body: {
    email?: string;
    firstName?: string;
    lastName?: string;
    role?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const firstName = body.firstName?.trim() || null;
  const lastName = body.lastName?.trim() || null;
  const role = body.role?.trim();

  if (!email) return NextResponse.json({ error: "Email is required." }, { status: 400 });
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: "Email looks invalid." }, { status: 400 });
  }
  if (!role || !VALID_ROLES.has(role)) {
    return NextResponse.json({ error: "Invalid role." }, { status: 400 });
  }

  const existing = await prisma.adminUser.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: "An admin with that email already exists." },
      { status: 409 }
    );
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  const user = await prisma.adminUser.create({
    data: {
      email,
      firstName,
      lastName,
      role: role as AdminRole,
      passwordHash,
    },
    select: USER_SELECT,
  });

  await logAdminAction({
    adminUserId: actorId,
    action: "admin_user.create",
    resourceType: "AdminUser",
    resourceId: user.id,
    after: {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      isActive: user.isActive,
    },
    request,
  });

  return NextResponse.json({ user, tempPassword }, { status: 201 });
}
