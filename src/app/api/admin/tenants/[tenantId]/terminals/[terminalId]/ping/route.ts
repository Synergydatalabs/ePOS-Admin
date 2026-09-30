// POST /api/admin/tenants/:id/terminals/:terminalId/ping — poke a merchant's
// terminal to verify it's reachable. Side-effects the merchant's hardware, so
// gated to SUPER_ADMIN + COMPLIANCE only. Every call is audit-logged.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { logAdminAction } from "@/lib/admin-audit";
import { pingTerminal } from "@/lib/gp-uci/bill-client";
import { UciAuthError, UciApiError } from "@/lib/gp-uci/types";

interface Params {
  params: Promise<{ tenantId: string; terminalId: string }>;
}

const PING_ROLES = new Set(["SUPER_ADMIN", "COMPLIANCE"]);

export async function POST(request: NextRequest, { params }: Params) {
  const role = request.headers.get("x-admin-role") || "";
  const adminUserId = request.headers.get("x-admin-user-id") || "";
  if (!PING_ROLES.has(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!adminUserId) {
    // Middleware should have set this; defence-in-depth.
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { tenantId, terminalId } = await params;

  const terminal = await prisma.terminal.findUnique({
    where: { id: terminalId },
    select: {
      id: true,
      name: true,
      provider: true,
      uciLane: true,
      uciEnvironment: true,
      location: { select: { id: true, tenantId: true } },
    },
  });

  if (!terminal || terminal.location.tenantId !== tenantId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (terminal.provider !== "UCI" || !terminal.uciLane) {
    return NextResponse.json(
      { error: "not_uci_terminal", message: "Ping is only supported for UCI terminals with a uci_lane." },
      { status: 400 }
    );
  }

  const startedAt = Date.now();
  try {
    const gpResponse = await pingTerminal(terminal.uciLane);
    const latencyMs = Date.now() - startedAt;

    await logAdminAction({
      adminUserId,
      action: "terminal.ping",
      resourceType: "terminal",
      resourceId: terminal.id,
      after: {
        latencyMs,
        gpStatus: gpResponse.status,
        gpId: gpResponse.id,
        lane: terminal.uciLane,
      },
      request,
    });

    return NextResponse.json({
      success: true,
      latencyMs,
      gpResponse,
    });
  } catch (err: unknown) {
    const latencyMs = Date.now() - startedAt;
    const message =
      err instanceof UciAuthError || err instanceof UciApiError
        ? err.message
        : (err as Error)?.message || "Ping failed";

    await logAdminAction({
      adminUserId,
      action: "terminal.ping",
      resourceType: "terminal",
      resourceId: terminal.id,
      after: {
        latencyMs,
        success: false,
        error: message,
        lane: terminal.uciLane,
      },
      request,
    });

    return NextResponse.json(
      { success: false, error: message, latencyMs },
      { status: 502 }
    );
  }
}
