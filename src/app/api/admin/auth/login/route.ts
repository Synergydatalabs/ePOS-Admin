// POST /api/admin/auth/login — bcrypt-verify + issue admin_token cookie.
// Every attempt (win or lose) writes an AdminLoginAttempt row for forensics.
// The rate-limit is a naïve in-memory Map — good enough for a single-instance
// admin app; swap for Redis if we ever run behind more than one node.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import {
  ADMIN_COOKIE_NAME,
  getAdminCookieOptions,
  signAdminToken,
  verifyPassword,
} from "@/lib/admin-auth";
// Phase I #4 (2026-09-12): HARD-FAIL reCAPTCHA on admin login. Admin
// accounts are the highest-value target on the platform — a bot that
// brute-forces a SUPER_ADMIN session bypasses every downstream guard.
// The login form now sends a token and we reject anything Google
// doesn't confirm. Register admin.oreugo.ca (and any other admin
// domains) in the reCAPTCHA console before deploying this.
import { verifyRecaptcha, ipFromRequest } from "@/lib/recaptcha";

type Bucket = { count: number; resetAt: number };
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 10;
const buckets = new Map<string, Bucket>();

function rateLimit(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || b.resetAt < now) {
    buckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  b.count += 1;
  return b.count <= RATE_MAX;
}

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  const ua = request.headers.get("user-agent") || null;

  if (!rateLimit(ip)) {
    return NextResponse.json({ error: "Too many attempts. Wait a minute." }, { status: 429 });
  }

  let body: { email?: string; password?: string; recaptchaToken?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Phase I #4 (2026-09-12): HARD-FAIL reCAPTCHA. Runs BEFORE the DB
  // lookup so a bot with no token can't even probe whether an admin
  // email exists.
  const rc = await verifyRecaptcha({
    token: String(body.recaptchaToken || ""),
    ip: ipFromRequest(request),
    expectedAction: "admin_login",
  });
  if (!rc.ok) {
    console.warn(`[admin login] reCAPTCHA rejected (${rc.reason}) ip=${ip}`);
    return NextResponse.json(
      { error: "Verification failed. Please refresh the page and try again." },
      { status: 403 }
    );
  }

  // Narrow to concrete strings before the closures below use them —
  // TS's flow-narrowing doesn't reach through the nested logAttempt().
  const emailRaw = body.email?.trim().toLowerCase();
  const password = body.password;
  if (!emailRaw || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }
  const email: string = emailRaw;

  const user = await prisma.adminUser.findUnique({ where: { email } });

  async function logAttempt(succeeded: boolean, failureReason?: string) {
    try {
      await prisma.adminLoginAttempt.create({
        data: {
          email,
          succeeded,
          failureReason: failureReason ?? null,
          ipAddress: ip,
          userAgent: ua,
        },
      });
    } catch (err) {
      // Never let audit-log failure block auth.
      console.error("Failed to write AdminLoginAttempt:", err);
    }
  }

  if (!user || !user.isActive) {
    await logAttempt(false, user ? "inactive" : "unknown_email");
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    await logAttempt(false, "bad_password");
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  await logAttempt(true);
  await prisma.adminUser.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const token = await signAdminToken({
    adminUserId: user.id,
    role: user.role,
    email: user.email,
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE_NAME, token, getAdminCookieOptions());
  return res;
}
