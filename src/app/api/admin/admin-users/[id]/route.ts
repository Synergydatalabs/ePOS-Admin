// PATCH — edit an admin user (role, isActive, name).
// POST ?action=reset-password — mint a new temp password and return it once.
// Both SUPER_ADMIN-only. Two self-safety rails: you can't deactivate yourself
// and you can't demote yourself from SUPER_ADMIN — otherwise you could lock
// the platform out entirely with a single click.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { AdminRole, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { generateTempPassword, hashPassword } from "@/lib/admin-auth";
import { logAdminAction } from "@/lib/admin-audit";

// Hardcoded rather than `Object.values(AdminRole)` — that expression
// runs at module load and blows up Next's build-time page-data
// collector when Prisma's runtime enum export resolves undefined
// (intermittent Prisma 5.x + Next 15 interop). Enum stays typed via
// the `import type` above; if we add a new role, add it here too.
const VALID_ROLES = new Set<string>([
  "SUPER_ADMIN",
  "COMPLIANCE",
  "SUPPORT",
  "SALES",
  "FINANCE",
]);

interface Ctx {
  params: Promise<{ id: string }>;
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

function requireSuperAdmin(request: NextRequest): { actorId: string } | NextResponse {
  const role = request.headers.get("x-admin-role");
  const actorId = request.headers.get("x-admin-user-id");
  if (role !== "SUPER_ADMIN" || !actorId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return { actorId };
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const gate = requireSuperAdmin(request);
  if (gate instanceof NextResponse) return gate;
  const { actorId } = gate;

  const { id } = await ctx.params;

  let body: {
    role?: string;
    isActive?: boolean;
    firstName?: string | null;
    lastName?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const target = await prisma.adminUser.findUnique({
    where: { id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: true,
      isActive: true,
    },
  });
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: Prisma.AdminUserUpdateInput = {};

  if (body.role !== undefined) {
    if (typeof body.role !== "string" || !VALID_ROLES.has(body.role)) {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }
    if (target.id === actorId && body.role !== "SUPER_ADMIN") {
      return NextResponse.json(
        { error: "You cannot demote yourself from SUPER_ADMIN." },
        { status: 400 }
      );
    }
    data.role = body.role as AdminRole;
  }

  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") {
      return NextResponse.json({ error: "isActive must be boolean." }, { status: 400 });
    }
    if (target.id === actorId && body.isActive === false) {
      return NextResponse.json(
        { error: "You cannot deactivate yourself." },
        { status: 400 }
      );
    }
    data.isActive = body.isActive;
  }

  if (body.firstName !== undefined) {
    const v = typeof body.firstName === "string" ? body.firstName.trim() : "";
    data.firstName = v || null;
  }
  if (body.lastName !== undefined) {
    const v = typeof body.lastName === "string" ? body.lastName.trim() : "";
    data.lastName = v || null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const updated = await prisma.adminUser.update({
    where: { id },
    data,
    select: USER_SELECT,
  });

  await logAdminAction({
    adminUserId: actorId,
    action: "admin_user.update",
    resourceType: "AdminUser",
    resourceId: id,
    before: {
      firstName: target.firstName,
      lastName: target.lastName,
      role: target.role,
      isActive: target.isActive,
    },
    after: {
      firstName: updated.firstName,
      lastName: updated.lastName,
      role: updated.role,
      isActive: updated.isActive,
    },
    request,
  });

  return NextResponse.json({ user: updated });
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const gate = requireSuperAdmin(request);
  if (gate instanceof NextResponse) return gate;
  const { actorId } = gate;

  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  if (action !== "reset-password") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const { id } = await ctx.params;
  const target = await prisma.adminUser.findUnique({
    where: { id },
    select: { id: true, email: true },
  });
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  await prisma.adminUser.update({ where: { id }, data: { passwordHash } });

  await logAdminAction({
    adminUserId: actorId,
    action: "admin_user.reset_password",
    resourceType: "AdminUser",
    resourceId: id,
    request,
  });

  return NextResponse.json({ tempPassword });
}
