// Self-service password change. Any authenticated admin can hit this.
// On success we nuke the current cookie so the caller has to log in with
// the new password — a small friction that catches "wait, did that actually
// take?" ambiguity and forces immediate verification of the new credential.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import {
  ADMIN_COOKIE_NAME,
  hashPassword,
  validatePassword,
  verifyPassword,
} from "@/lib/admin-auth";
import { logAdminAction } from "@/lib/admin-audit";

export async function POST(request: NextRequest) {
  const actorId = request.headers.get("x-admin-user-id");
  if (!actorId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  if (!currentPassword || !newPassword) {
    return NextResponse.json(
      { error: "Both current and new passwords are required." },
      { status: 400 }
    );
  }

  const policyErr = validatePassword(newPassword);
  if (policyErr) return NextResponse.json({ error: policyErr }, { status: 400 });

  if (currentPassword === newPassword) {
    return NextResponse.json(
      { error: "New password must differ from current password." },
      { status: 400 }
    );
  }

  const user = await prisma.adminUser.findUnique({
    where: { id: actorId },
    select: { id: true, isActive: true, passwordHash: true },
  });
  if (!user || !user.isActive) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.adminUser.update({ where: { id: user.id }, data: { passwordHash } });

  await logAdminAction({
    adminUserId: user.id,
    action: "admin_user.change_password",
    resourceType: "AdminUser",
    resourceId: user.id,
    request,
  });

  const res = NextResponse.json({ success: true });
  // Clear the cookie so the client is forced to re-authenticate with the
  // new password — proves the change took before we let them keep working.
  res.cookies.set(ADMIN_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}
