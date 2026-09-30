// GET /api/health
//
// ALB / uptime-monitor target. Intentionally CHEAP — no auth, no DB
// hit. Just proves the Node process is up and Next.js is serving
// requests. Returns 200 in single-digit milliseconds so the ALB
// health-probe timeout is a non-issue.
//
// Deliberately NOT hitting Aurora here: an Aurora blip (failover,
// slow query, connection-pool saturation) would flip the target to
// unhealthy and pull it out of rotation even though the app itself is
// fine. Use /api/health/deep for a DB-inclusive probe when needed.
//
// Middleware whitelists this path — see src/middleware.ts.

import { NextResponse } from "next/server";

// Always-fresh so ALB never gets a cached 200 while the process is
// actually wedged.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      service: "tapapp-admin",
      timestamp: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}
