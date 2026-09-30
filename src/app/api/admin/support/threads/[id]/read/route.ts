// POST /api/admin/support/threads/[id]/read — mark thread read for
// the current admin (per-admin unread counts).
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSupportRole } from "@/lib/support/rbac";
import { markThreadReadByAdmin } from "@/lib/support/thread-service";
import prisma from "@/lib/prisma";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = requireSupportRole(request);
  if (gate instanceof NextResponse) return gate;
  const { actorId } = gate;

  const { id } = await params;
  const thread = await prisma.supportThread.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!thread) return NextResponse.json({ error: "not found" }, { status: 404 });

  await markThreadReadByAdmin({ threadId: id, adminUserId: actorId });
  return NextResponse.json({ ok: true });
}
