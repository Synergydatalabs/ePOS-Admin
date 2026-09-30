// GET /api/admin/applications/[id]
// Full detail view for an admin — returns the plaintext business info,
// LAST-4 previews of sensitive fields, all UBO rows with their id numbers
// masked, all uploaded KYB documents (metadata only — download URLs come
// via a separate signed-url endpoint in Phase 2c), and the timeline of
// application events.
//
// Full decryption (tax id / bank info) is intentionally NOT returned here.
// The reveal endpoint (POST /reveal) unmasks + writes an AdminAuditLog
// row per reveal so we always have a trail of who saw what.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { kybDecrypt, maskTail } from "@/lib/kyb-crypto";

// Resolves an actor's display label per event, given the actorType.
// ADMIN     -> AdminUser.email (via a single batched lookup)
// MERCHANT  -> Membership.user.name/email OR fallback to signerName
// PROCESSOR -> "processor"
// SYSTEM    -> "system"
async function resolveActorLabels(
  events: { actorType: string; actorId: string | null }[],
  fallbackSigner: { name: string | null; email: string | null }
): Promise<Map<string, string>> {
  const key = (t: string, id: string | null) => `${t}:${id ?? ""}`;
  const out = new Map<string, string>();

  const adminIds = new Set<string>();
  const membershipIds = new Set<string>();
  for (const e of events) {
    if (!e.actorId) continue;
    if (e.actorType === "ADMIN") adminIds.add(e.actorId);
    else if (e.actorType === "MERCHANT") membershipIds.add(e.actorId);
  }

  const [admins, memberships] = await Promise.all([
    adminIds.size > 0
      ? prisma.adminUser.findMany({
          where: { id: { in: [...adminIds] } },
          select: { id: true, email: true },
        })
      : Promise.resolve([]),
    membershipIds.size > 0
      ? prisma.membership.findMany({
          where: { id: { in: [...membershipIds] } },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const adminMap = new Map(admins.map((a) => [a.id, a.email] as const));
  const memberMap = new Map(
    memberships.map((m) => {
      const name = [m.firstName, m.lastName].filter(Boolean).join(" ").trim();
      return [m.id, name || m.email || null] as const;
    })
  );

  const merchantFallback =
    fallbackSigner.name || fallbackSigner.email || "merchant";

  for (const e of events) {
    let label: string;
    if (e.actorType === "ADMIN") {
      label = (e.actorId && adminMap.get(e.actorId)) || "admin";
    } else if (e.actorType === "MERCHANT") {
      label = (e.actorId && memberMap.get(e.actorId)) || merchantFallback;
    } else if (e.actorType === "PROCESSOR") {
      label = "processor";
    } else {
      label = "system";
    }
    out.set(key(e.actorType, e.actorId), label);
  }
  return out;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const app = await prisma.merchantApplication.findUnique({
    where: { id },
    include: {
      tenant: {
        select: {
          id: true,
          name: true,
          slug: true,
          businessType: true,
          currency: true,
        },
      },
      resultingProcessor: {
        select: {
          id: true,
          processor: true,
          capability: true,
          externalMid: true,
          status: true,
          activatedAt: true,
        },
      },
      documents: {
        where: { deletedAt: null },
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
      },
      ubos: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          fullName: true,
          dateOfBirth: true,
          nationality: true,
          residentialAddress: true,
          ownershipPct: true,
          isDirector: true,
          isSignatory: true,
          idType: true,
          idNumberEnc: true,
          idExpiry: true,
          idIssuingCountry: true,
          sourceOfFunds: true,
          isPep: true,
        },
      },
      events: {
        orderBy: { at: "desc" },
        take: 200,
        select: {
          id: true,
          fromStatus: true,
          toStatus: true,
          actorType: true,
          actorId: true,
          note: true,
          at: true,
        },
      },
    },
  });

  if (!app) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  // Compute masked previews of the two encrypted top-level fields. Failure
  // here is non-fatal — the reviewer can still see the rest of the record
  // and can retry via the reveal endpoint.
  let taxIdMasked: string | null = null;
  let bankAccountMasked: string | null = null;
  let decryptError: string | null = null;
  try {
    const taxIdPlain = kybDecrypt(app.taxIdEnc);
    if (taxIdPlain) taxIdMasked = maskTail(taxIdPlain, 4);

    const bankPlain = kybDecrypt(app.bankInfoEnc);
    if (bankPlain) {
      try {
        const bank = JSON.parse(bankPlain) as { accountNumber?: string | null };
        if (bank.accountNumber) bankAccountMasked = maskTail(bank.accountNumber, 4);
      } catch {
        // legacy blob shape variation — leave preview null
      }
    }
  } catch (err) {
    decryptError = (err as Error)?.message || "Decrypt failed";
  }

  // UBOs — each row masks its own ID number, decrypted per row.
  const ubos = app.ubos.map((u) => {
    let idNumberMasked: string | null = null;
    try {
      const plain = kybDecrypt(u.idNumberEnc);
      if (plain) idNumberMasked = maskTail(plain, 4);
    } catch {
      // per-row decrypt failure — leave null, row still appears
    }
    return {
      id: u.id,
      fullName: u.fullName,
      dateOfBirth: u.dateOfBirth,
      nationality: u.nationality,
      residentialAddress: u.residentialAddress,
      ownershipPct: Number(u.ownershipPct),
      isDirector: u.isDirector,
      isSignatory: u.isSignatory,
      idType: u.idType,
      idNumberMasked,
      idExpiry: u.idExpiry,
      idIssuingCountry: u.idIssuingCountry,
      sourceOfFunds: u.sourceOfFunds,
      isPep: u.isPep,
    };
  });

  // Enrich each timeline event with a human-readable actor label so the
  // client doesn't have to make N+1 lookups just to render "by <email>".
  const actorLabels = await resolveActorLabels(
    app.events.map((e) => ({ actorType: e.actorType, actorId: e.actorId })),
    { name: app.signerName, email: app.signerEmail }
  );
  const events = app.events.map((e) => ({
    ...e,
    actorLabel:
      actorLabels.get(`${e.actorType}:${e.actorId ?? ""}`) ?? null,
  }));

  return NextResponse.json({
    application: {
      id: app.id,
      tenantRole: app.tenantRole,
      status: app.status,
      targetProcessor: app.targetProcessor,

      tenant: app.tenant,

      legalName: app.legalName,
      dbaName: app.dbaName,
      businessTypeName: app.businessTypeName,
      incorporationDate: app.incorporationDate,
      incorporationRegion: app.incorporationRegion,
      businessAddress: app.businessAddress,
      websiteUrl: app.websiteUrl,
      mccCode: app.mccCode,

      projectedMonthlyVolumeCents: app.projectedMonthlyVolumeCents,
      averageTicketCents: app.averageTicketCents,
      currency: app.currency,

      // Masked-only previews. Full plaintext comes via /reveal.
      taxIdMasked,
      bankAccountMasked,
      decryptError,

      signerName: app.signerName,
      signerTitle: app.signerTitle,
      signerEmail: app.signerEmail,
      signerConsentedAt: app.signerConsentedAt,

      adminNotes: app.adminNotes,
      reviewedByAdminEmail: app.reviewedByAdminEmail,
      forwardedToEmail: app.forwardedToEmail,
      processorReferenceId: app.processorReferenceId,
      rejectionReason: app.rejectionReason,
      infoRequested: app.infoRequested,

      submittedAt: app.submittedAt,
      forwardedAt: app.forwardedAt,
      infoRequestedAt: app.infoRequestedAt,
      approvedAt: app.approvedAt,
      rejectedAt: app.rejectedAt,
      lastAdminActionAt: app.lastAdminActionAt,

      resultingProcessor: app.resultingProcessor,
      documents: app.documents,
      ubos,
      events,
    },
  });
}
