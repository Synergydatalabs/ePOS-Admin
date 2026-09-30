// GET /api/admin/tenants/:id/payments — support view of a tenant's payments.
// SUPPORT+ roles. Newest first, capped at 200. Filter by status / method /
// limit. Includes parsed metadata so ops can eyeball auth codes + declines
// without opening the DB.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Prisma, PaymentRecordStatus } from "@prisma/client";
import prisma from "@/lib/prisma";

interface Params {
  params: Promise<{ tenantId: string }>;
}

const READ_ROLES = new Set(["SUPER_ADMIN", "COMPLIANCE", "SUPPORT"]);
const ALLOWED_STATUS = new Set([
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
]);

export async function GET(request: NextRequest, { params }: Params) {
  const role = request.headers.get("x-admin-role") || "";
  if (!READ_ROLES.has(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { tenantId } = await params;
  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status")?.trim() || "";
  const method = url.searchParams.get("method")?.trim() || "";
  const limitRaw = Number(url.searchParams.get("limit") || 100);
  // Cap defensively — a curious client can't force us to page-scan.
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 100, 1), 200);

  const where: Prisma.PaymentWhereInput = {
    order: { location: { tenantId } },
  };
  if (statusParam && ALLOWED_STATUS.has(statusParam)) {
    where.status = statusParam as PaymentRecordStatus;
  }
  if (method) {
    where.method = method;
  }

  const payments = await prisma.payment.findMany({
    where,
    select: {
      id: true,
      amount: true,
      currency: true,
      method: true,
      provider: true,
      providerRef: true,
      providerStatus: true,
      status: true,
      metadata: true,
      failureReason: true,
      completedAt: true,
      createdAt: true,
      order: {
        select: {
          id: true,
          orderNumber: true,
          orderType: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({ payments });
}
