// Thin wrapper over AdminAuditLog.create — writes never throw, since a
// failed audit shouldn't block the underlying admin operation. The caller
// passes the NextRequest so we can pull IP + UA without every route
// re-implementing the same header shuffling.

import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import type { NextRequest } from "next/server";

interface LogArgs {
  adminUserId: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  before?: unknown;
  after?: unknown;
  request?: NextRequest | Request | null;
}

function clientIp(req?: NextRequest | Request | null): string | null {
  if (!req) return null;
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim() || null;
  return req.headers.get("x-real-ip");
}

// Prisma's optional Json fields want DbNull for "clear" and InputJsonValue
// for "set". Passing plain null triggers a runtime error, hence this shim.
function toJson(v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (v === undefined || v === null) return Prisma.DbNull;
  return v as Prisma.InputJsonValue;
}

export async function logAdminAction(args: LogArgs): Promise<void> {
  try {
    await prisma.adminAuditLog.create({
      data: {
        adminUserId: args.adminUserId,
        action: args.action,
        resourceType: args.resourceType ?? null,
        resourceId: args.resourceId ?? null,
        before: toJson(args.before),
        after: toJson(args.after),
        ipAddress: clientIp(args.request),
        userAgent: args.request?.headers.get("user-agent") ?? null,
      },
    });
  } catch (err) {
    console.error("logAdminAction failed:", err);
  }
}
