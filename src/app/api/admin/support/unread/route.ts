// GET /api/admin/support/unread — unread threads for the current admin.
// Silent 200 with count:0 if the caller isn't in a support role — the
// widget just won't render a badge instead of showing an error.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SUPPORT_ROLES } from "@/lib/support/constants";
import { getUnreadForAdmin } from "@/lib/support/thread-service";

export async function GET(request: NextRequest) {
  const role = request.headers.get("x-admin-role");
  const actorId = request.headers.get("x-admin-user-id");
  if (!role || !actorId || !SUPPORT_ROLES.has(role)) {
    return NextResponse.json({ count: 0, threadIds: [] });
  }
  const result = await getUnreadForAdmin(actorId);
  return NextResponse.json(result);
}
