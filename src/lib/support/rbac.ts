// Route-level RBAC gate for the support surface. Middleware already
// stamped x-admin-role and x-admin-user-id after verifying the cookie,
// so this helper just checks the header against SUPPORT_ROLES.
//
// Returns { actorId, role } on success or a 403 NextResponse on
// failure — callers use the `instanceof NextResponse` pattern to
// early-return, matching requireSuperAdmin in admin-users/route.ts.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SUPPORT_ROLES } from "./constants";

export interface SupportActor {
  actorId: string;
  role: string;
}

export function requireSupportRole(
  request: NextRequest
): SupportActor | NextResponse {
  const role = request.headers.get("x-admin-role");
  const actorId = request.headers.get("x-admin-user-id");
  if (!role || !actorId || !SUPPORT_ROLES.has(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return { actorId, role };
}
