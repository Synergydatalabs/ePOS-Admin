// Admin auth primitives — bcrypt password hashing + jose-signed HS256 JWTs.
// The cookie name is admin_token; sessions last 8h (a work-day) to balance
// staying-logged-in convenience against theft risk on shared operator machines.

import bcrypt from "bcryptjs";
import crypto from "crypto";
import { SignJWT, jwtVerify } from "jose";
import type { NextRequest } from "next/server";

export const ADMIN_COOKIE_NAME = "admin_token";
const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8h

function getSecret(): Uint8Array {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) throw new Error("ADMIN_JWT_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export interface AdminSession {
  adminUserId: string;
  role: string;
  email: string;
}

export async function signAdminToken(session: AdminSession): Promise<string> {
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function verifyAdminToken(token: string): Promise<AdminSession | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (!payload.adminUserId || !payload.role || !payload.email) return null;
    return {
      adminUserId: String(payload.adminUserId),
      role: String(payload.role),
      email: String(payload.email),
    };
  } catch {
    return null;
  }
}

export function getAdminCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

// Reads the admin_token cookie off a NextRequest (middleware or route handler)
// and returns the decoded session, or null when missing / invalid.
export async function getAdminSession(
  request: NextRequest
): Promise<AdminSession | null> {
  const token = request.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyAdminToken(token);
}

// Returns null when the password meets policy, or a human-facing error string.
// Rules: min 12 chars, at least one letter + one digit. Symbol not required
// so the admin can pick something memorable; length carries the entropy.
export function validatePassword(plain: string): string | null {
  if (typeof plain !== "string") return "Password is required.";
  if (plain.length < 12) return "Password must be at least 12 characters.";
  if (!/[A-Za-z]/.test(plain)) return "Password must include a letter.";
  if (!/\d/.test(plain)) return "Password must include a digit.";
  return null;
}

// Cryptographically random 12-char temp password guaranteed to include
// a letter, digit, and symbol. Ambiguous glyphs (0/O, 1/l/I) are excluded
// so the string is safe to read aloud when handing it off out-of-band.
const TEMP_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const TEMP_LOWER = "abcdefghijkmnopqrstuvwxyz";
const TEMP_DIGITS = "23456789";
const TEMP_SYMBOLS = "!@#$%^&*-_+=?";

export function generateTempPassword(): string {
  const pick = (pool: string) => pool[crypto.randomInt(0, pool.length)];
  const chars = [pick(TEMP_UPPER), pick(TEMP_LOWER), pick(TEMP_DIGITS), pick(TEMP_SYMBOLS)];
  const pool = TEMP_UPPER + TEMP_LOWER + TEMP_DIGITS + TEMP_SYMBOLS;
  while (chars.length < 12) chars.push(pick(pool));
  // Fisher-Yates so the required chars aren't always in positions 0-3.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
