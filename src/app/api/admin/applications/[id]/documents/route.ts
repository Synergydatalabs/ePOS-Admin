// GET /api/admin/applications/[id]/documents
// Returns every non-deleted KybDocument for an application. Admin-only
// (middleware already blocks unauthenticated callers). No presigned URL
// is generated here — the client asks for one per doc via the /download
// endpoint so we can attach an AdminAuditLog row per unmask.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Verify the parent application exists — no doc listing for phantom
  // ids. Cheap select-only lookup.
  const app = await prisma.merchantApplication.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!app) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  const documents = await prisma.kybDocument.findMany({
    where: { applicationId: id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      docType: true,
      originalFilename: true,
      mimeType: true,
      sizeBytes: true,
      sha256: true,
      scanStatus: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ documents });
}
