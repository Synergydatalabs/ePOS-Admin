// GET /api/admin/applications
// Lists MerchantApplication rows across every tenant (both MERCHANT and
// SUPPLIER roles). Auth is enforced by middleware — anyone with a valid
// admin session can view; write actions live behind role gates in the
// per-application routes.
//
// Query params:
//   ?status=SUBMITTED    — filter by status (single value)
//   ?processor=GP        — filter by targetProcessor
//   ?tenantRole=MERCHANT — filter by tenant role (MERCHANT | SUPPLIER)
//   ?search=xyz          — matches legalName / dbaName / tenant name
//
// Never returns decrypted PII on the list endpoint — that's the detail
// endpoint's job. Kept lightweight so the queue view stays snappy.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

const ALLOWED_STATUS = new Set([
  "DRAFT",
  "SUBMITTED",
  "IN_REVIEW",
  "FORWARDED",
  "INFO_REQUESTED",
  "PROVIDER_APPROVED",
  "APPROVED",
  "REJECTED",
  "LIVE",
]);
const ALLOWED_PROCESSOR = new Set(["GP", "MONERIS", "STRIPE"]);
const ALLOWED_TENANT_ROLE = new Set(["MERCHANT", "SUPPLIER"]);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status")?.trim() || "";
  const processor = searchParams.get("processor")?.trim() || "";
  const tenantRole = searchParams.get("tenantRole")?.trim() || "";
  const search = searchParams.get("search")?.trim() || "";

  const where: Prisma.MerchantApplicationWhereInput = {};

  if (status && ALLOWED_STATUS.has(status)) {
    where.status = status as Prisma.MerchantApplicationWhereInput["status"];
  }
  if (processor && ALLOWED_PROCESSOR.has(processor)) {
    where.targetProcessor =
      processor as Prisma.MerchantApplicationWhereInput["targetProcessor"];
  }
  if (tenantRole && ALLOWED_TENANT_ROLE.has(tenantRole)) {
    where.tenantRole =
      tenantRole as Prisma.MerchantApplicationWhereInput["tenantRole"];
  }
  if (search) {
    where.OR = [
      { legalName: { contains: search, mode: "insensitive" } },
      { dbaName: { contains: search, mode: "insensitive" } },
      { tenant: { name: { contains: search, mode: "insensitive" } } },
    ];
  }

  const [applications, rawCounts] = await Promise.all([
    prisma.merchantApplication.findMany({
      where,
      orderBy: { submittedAt: "desc" },
      take: 200,
      select: {
        id: true,
        tenantRole: true,
        status: true,
        targetProcessor: true,
        legalName: true,
        dbaName: true,
        businessTypeName: true,
        incorporationRegion: true,
        projectedMonthlyVolumeCents: true,
        currency: true,
        submittedAt: true,
        forwardedAt: true,
        approvedAt: true,
        rejectedAt: true,
        infoRequestedAt: true,
        lastAdminActionAt: true,
        reviewedByAdminEmail: true,
        forwardedToEmail: true,
        signerEmail: true,
        tenant: {
          select: {
            id: true,
            name: true,
            businessType: true,
          },
        },
      },
    }),
    // Status counts for the queue tabs. Always FULL total across the
    // currently-selected tenantRole filter (so the badges reflect the
    // list scope), never limited by search.
    prisma.merchantApplication.groupBy({
      by: ["status"],
      where: where.tenantRole ? { tenantRole: where.tenantRole } : undefined,
      _count: true,
    }),
  ]);

  const counts = Object.fromEntries(rawCounts.map((c) => [c.status, c._count]));

  return NextResponse.json({
    applications: applications.map((a) => ({
      ...a,
      tenantName: a.tenant.name,
      tenantBusinessType: a.tenant.businessType,
    })),
    counts,
  });
}
