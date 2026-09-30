// Edge middleware — protects every route except the login page + auth endpoints.
// Stamps x-admin-user-id onto the request so API routes can trust the caller
// without re-verifying the cookie (middleware already did it).

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_COOKIE_NAME, verifyAdminToken } from "@/lib/admin-auth";

const PUBLIC_PATHS = new Set<string>([
  "/login",
  "/api/admin/auth/login",
  // ALB health-check target. Must be reachable without a cookie so
  // AWS's health prober can hit it every N seconds and mark the target
  // healthy. Endpoint itself is intentionally cheap — see /api/health.
  "/api/health",
]);

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith("/_next")) return true;
  if (pathname === "/favicon.ico") return true;
  // static assets sitting in /public
  if (pathname.includes(".")) return true;
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const token = request.cookies.get(ADMIN_COOKIE_NAME)?.value;
  const session = token ? await verifyAdminToken(token) : null;

  if (!session) {
    // API callers get a 401 (no interactive redirect), everyone else lands on /login.
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Forward the resolved admin id to downstream handlers so they don't re-verify.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-admin-user-id", session.adminUserId);
  requestHeaders.set("x-admin-role", session.role);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

// Force the Node.js runtime instead of the default Edge Runtime.
// admin-auth.ts imports bcryptjs + node:crypto — neither works on
// Edge. We run on a single PM2 instance on EC2 anyway, so there's no
// benefit to keeping middleware on the edge.
export const runtime = "nodejs";
