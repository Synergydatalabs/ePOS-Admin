// GET /api/health/deep
//
// Full health probe — pings Aurora via a trivial SELECT 1. Slower + can
// return 503, so DO NOT wire this to the ALB target (a DB blip would
// pull the box out of rotation). This is for on-call diagnosis and for
// external uptime monitors that page a human on failure.
//
// Requires auth (unlike /api/health) so a script kiddie can't use it
// to fingerprint DB latency from the internet.

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const started = Date.now();
  try {
    // Trivial query — proves the pool has a live connection.
    await prisma.$queryRawUnsafe("SELECT 1 AS ok");
    return NextResponse.json(
      {
        ok: true,
        service: "tapapp-admin",
        db: "reachable",
        dbLatencyMs: Date.now() - started,
        timestamp: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        service: "tapapp-admin",
        db: "unreachable",
        error: err?.message || "unknown",
        dbLatencyMs: Date.now() - started,
        timestamp: new Date().toISOString(),
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
