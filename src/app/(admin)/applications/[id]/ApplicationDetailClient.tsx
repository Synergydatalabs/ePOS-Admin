// Application detail — four tabs (Business / UBOs / Documents / Timeline).
// Phase 2d adds the top-right Actions bar: Request more info, Forward to
// processor, Mark provider-approved, Reject. Each modal posts to its
// dedicated /api/admin/applications/[id]/<action> endpoint; every action
// writes an ApplicationEvent so the Timeline tab picks up the change on
// the reload that follows.
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

type Status =
  | "DRAFT"
  | "SUBMITTED"
  | "IN_REVIEW"
  | "FORWARDED"
  | "INFO_REQUESTED"
  | "PROVIDER_APPROVED"
  | "APPROVED"
  | "REJECTED"
  | "LIVE";

interface Ubo {
  id: string;
  fullName: string;
  dateOfBirth: string | null;
  nationality: string;
  residentialAddress: unknown;
  ownershipPct: number;
  isDirector: boolean;
  isSignatory: boolean;
  idType: string;
  idNumberMasked: string | null;
  idExpiry: string | null;
  idIssuingCountry: string | null;
  sourceOfFunds: string | null;
  isPep: boolean;
}

interface DocRow {
  id: string;
  docType: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  scanStatus: string;
  createdAt: string;
}

interface EventRow {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  actorType: string;
  actorId: string | null;
  actorLabel: string | null;
  note: string | null;
  at: string;
}

interface AppDetail {
  id: string;
  tenantRole: "MERCHANT" | "SUPPLIER";
  status: Status;
  targetProcessor: "GP" | "MONERIS" | "STRIPE" | null;
  tenant: {
    id: string;
    name: string;
    slug: string;
    businessType: string;
    currency: string;
  };
  legalName: string;
  dbaName: string | null;
  businessTypeName: string | null;
  incorporationDate: string | null;
  incorporationRegion: string | null;
  businessAddress: Record<string, string> | null;
  websiteUrl: string | null;
  mccCode: string | null;
  projectedMonthlyVolumeCents: number | null;
  averageTicketCents: number | null;
  currency: string;
  taxIdMasked: string | null;
  bankAccountMasked: string | null;
  decryptError: string | null;
  signerName: string | null;
  signerTitle: string | null;
  signerEmail: string | null;
  signerConsentedAt: string | null;
  reviewedByAdminEmail: string | null;
  forwardedToEmail: string | null;
  processorReferenceId: string | null;
  rejectionReason: string | null;
  infoRequested: string | null;
  submittedAt: string;
  forwardedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  resultingProcessor: {
    id: string;
    processor: string;
    capability: string;
    externalMid: string;
    status: string;
    activatedAt: string | null;
  } | null;
  documents: DocRow[];
  ubos: Ubo[];
  events: EventRow[];
}

const STATUS_STYLES: Record<Status, { bg: string; text: string; label: string }> = {
  DRAFT:             { bg: "bg-gray-100",    text: "text-gray-700",    label: "Draft" },
  SUBMITTED:         { bg: "bg-blue-100",    text: "text-blue-800",    label: "New" },
  IN_REVIEW:         { bg: "bg-indigo-100",  text: "text-indigo-800",  label: "In review" },
  FORWARDED:         { bg: "bg-purple-100",  text: "text-purple-800",  label: "With processor" },
  INFO_REQUESTED:    { bg: "bg-amber-100",   text: "text-amber-900",   label: "Info requested" },
  PROVIDER_APPROVED: { bg: "bg-teal-100",    text: "text-teal-800",    label: "Provider approved" },
  APPROVED:          { bg: "bg-emerald-100", text: "text-emerald-800", label: "Approved" },
  LIVE:              { bg: "bg-emerald-500/20", text: "text-emerald-900", label: "Live" },
  REJECTED:          { bg: "bg-red-100",     text: "text-red-800",     label: "Rejected" },
};

type Tab = "business" | "ubos" | "documents" | "timeline";

// Roles allowed to run the Phase 2d write actions. Server enforces the same
// gates; these keep the buttons out of the UI for read-only roles so nothing
// looks clickable when the underlying API will reject it.
const FORWARD_APPROVE_REJECT_ROLES = new Set(["SUPER_ADMIN", "COMPLIANCE"]);
const REQUEST_INFO_ROLES = new Set(["SUPER_ADMIN", "COMPLIANCE", "SUPPORT"]);

type ActionKind = "request-info" | "forward" | "mark-provider-approved" | "reject" | null;

export default function ApplicationDetailClient({
  id,
  canReveal,
  role,
}: {
  id: string;
  canReveal: boolean;
  role: string;
}) {
  const [app, setApp] = useState<AppDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("business");
  const [action, setAction] = useState<ActionKind>(null);

  // Revealed plaintext lives only in memory; a fresh mount re-masks.
  const [revealedTaxId, setRevealedTaxId] = useState<string | null>(null);
  const [revealedBank, setRevealedBank] = useState<Record<string, string> | string | null>(null);
  const [revealing, setRevealing] = useState<null | "taxId" | "bankInfo">(null);

  const canForwardApproveReject = FORWARD_APPROVE_REJECT_ROLES.has(role);
  const canRequestInfo = REQUEST_INFO_ROLES.has(role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/applications/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || String(res.status));
      setApp(data.application);
    } catch (e) {
      toast.error((e as Error).message || "Failed to load application");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const reveal = async (field: "taxId" | "bankInfo") => {
    if (!canReveal) {
      toast.error("Only SUPER_ADMIN and COMPLIANCE can reveal PII.");
      return;
    }
    setRevealing(field);
    try {
      const res = await fetch(`/api/admin/applications/${id}/reveal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || String(res.status));
      if (field === "taxId") setRevealedTaxId(String(data.value ?? ""));
      else setRevealedBank(data.value ?? null);
    } catch (e) {
      toast.error((e as Error).message || "Reveal failed");
    } finally {
      setRevealing(null);
    }
  };

  if (loading) {
    return (
      <main className="p-8 max-w-5xl">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-100 rounded w-1/3" />
          <div className="h-64 bg-gray-100 rounded-2xl" />
        </div>
      </main>
    );
  }
  if (!app) {
    return (
      <main className="p-8 max-w-5xl">
        <p className="text-sm text-gray-500">Application not found.</p>
      </main>
    );
  }

  const s = STATUS_STYLES[app.status];
  const money = (cents: number | null) =>
    cents == null
      ? "—"
      : `${app.currency} ${(cents / 100).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;
  const addr = app.businessAddress || {};
  const addrLines = [
    addr.line1,
    addr.line2,
    [addr.city, addr.region, addr.postalCode].filter(Boolean).join(", "),
    addr.country,
  ].filter(Boolean);

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "business", label: "Business" },
    { key: "ubos", label: "UBOs", count: app.ubos.length },
    { key: "documents", label: "Documents", count: app.documents.length },
    { key: "timeline", label: "Timeline", count: app.events.length },
  ];

  return (
    <main className="p-8 max-w-5xl">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
          <Link href="/applications" className="text-slate-700 hover:underline">
            Applications
          </Link>
          <span>›</span>
          <span>Detail</span>
        </div>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-semibold text-gray-900">{app.legalName}</h1>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
                  app.tenantRole === "MERCHANT"
                    ? "bg-sky-100 text-sky-800"
                    : "bg-amber-100 text-amber-900"
                }`}
              >
                {app.tenantRole}
              </span>
              <span
                className={`text-xs px-2.5 py-1 rounded-full font-semibold ${s.bg} ${s.text}`}
              >
                {s.label}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Tenant: <strong className="text-gray-700">{app.tenant.name}</strong>{" "}
              ({app.tenant.slug}) · Submitted{" "}
              {new Date(app.submittedAt).toLocaleString()}
            </p>
            <div className="mt-2">
              <Link
                href={`/audit-log?resourceType=merchant_application&resourceId=${app.id}`}
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-900 hover:underline"
                title="Every admin action on this application"
              >
                <Icon icon="solar:clipboard-list-linear" className="h-3.5 w-3.5" />
                View audit
              </Link>
            </div>
          </div>
          <ActionButtons
            status={app.status}
            docCount={app.documents.length}
            canRequestInfo={canRequestInfo}
            canForwardApproveReject={canForwardApproveReject}
            onSelect={setAction}
          />
        </div>
      </div>

      {app.decryptError && (
        <div className="mb-4 p-3 rounded-xl border border-red-200 bg-red-50 text-sm text-red-900">
          Decrypt error on top-level fields: {app.decryptError}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-200 mb-6 overflow-x-auto">
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5 ${
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              {t.label}
              {t.count != null && (
                <span className="text-[11px] px-1.5 rounded-full bg-gray-100 text-gray-500">
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tab === "business" && (
        <div className="space-y-4">
          <Section title="Business information">
            <Row label="Legal name" value={app.legalName} />
            {app.dbaName && <Row label="DBA" value={app.dbaName} />}
            {app.businessTypeName && <Row label="Business type" value={app.businessTypeName} />}
            {app.incorporationDate && (
              <Row
                label="Incorporation date"
                value={new Date(app.incorporationDate).toLocaleDateString()}
              />
            )}
            {app.incorporationRegion && <Row label="Region" value={app.incorporationRegion} />}
            {app.mccCode && <Row label="MCC" value={app.mccCode} mono />}
            {app.websiteUrl && <Row label="Website" value={app.websiteUrl} />}
            {addrLines.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">
                  Address
                </p>
                {addrLines.map((line, i) => (
                  <p key={i} className="text-sm text-gray-800">
                    {line}
                  </p>
                ))}
              </div>
            )}
          </Section>

          <Section title="Volume + processor preference">
            <Row label="Preferred processor" value={app.targetProcessor || "None specified"} />
            <Row label="Projected monthly volume" value={money(app.projectedMonthlyVolumeCents)} />
            <Row label="Average ticket" value={money(app.averageTicketCents)} />
          </Section>

          <Section title="Signer">
            {app.signerName && <Row label="Name" value={app.signerName} />}
            {app.signerTitle && <Row label="Title" value={app.signerTitle} />}
            {app.signerEmail && <Row label="Email" value={app.signerEmail} />}
            {app.signerConsentedAt && (
              <Row
                label="Consented"
                value={new Date(app.signerConsentedAt).toLocaleString()}
              />
            )}
          </Section>

          <Section
            title="Tax ID"
            rightSlot={
              revealedTaxId == null ? (
                <RevealButton
                  disabled={!canReveal}
                  running={revealing === "taxId"}
                  onClick={() => reveal("taxId")}
                />
              ) : (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-800 font-semibold">
                  REVEALED
                </span>
              )
            }
          >
            {revealedTaxId != null ? (
              <Row label="Tax ID" value={revealedTaxId || "—"} mono />
            ) : (
              <Row
                label="Tax ID"
                value={app.taxIdMasked || (canReveal ? "Hidden — click Reveal" : "•••• (last-4 only for this role)")}
                mono
              />
            )}
          </Section>

          <Section
            title="Bank info"
            rightSlot={
              revealedBank == null ? (
                <RevealButton
                  disabled={!canReveal}
                  running={revealing === "bankInfo"}
                  onClick={() => reveal("bankInfo")}
                />
              ) : (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-800 font-semibold">
                  REVEALED
                </span>
              )
            }
          >
            {revealedBank != null && typeof revealedBank === "object" ? (
              <>
                {(revealedBank as Record<string, string>).accountHolderName && (
                  <Row label="Holder" value={(revealedBank as Record<string, string>).accountHolderName} />
                )}
                {(revealedBank as Record<string, string>).bankName && (
                  <Row label="Bank" value={(revealedBank as Record<string, string>).bankName} />
                )}
                {(revealedBank as Record<string, string>).routingNumber && (
                  <Row label="Routing" value={(revealedBank as Record<string, string>).routingNumber} mono />
                )}
                {(revealedBank as Record<string, string>).accountNumber && (
                  <Row label="Account" value={(revealedBank as Record<string, string>).accountNumber} mono />
                )}
              </>
            ) : revealedBank != null ? (
              <Row label="Bank info" value={String(revealedBank)} mono />
            ) : (
              <Row
                label="Account"
                value={
                  app.bankAccountMasked
                    ? app.bankAccountMasked
                    : canReveal
                    ? "Hidden — click Reveal"
                    : "•••• (last-4 only for this role)"
                }
                mono
              />
            )}
          </Section>

          {app.resultingProcessor && (
            <Section title="Active processor">
              <Row label="Processor" value={app.resultingProcessor.processor} />
              <Row label="Capability" value={app.resultingProcessor.capability} />
              <Row label="MID" value={app.resultingProcessor.externalMid} mono />
              <Row label="Status" value={app.resultingProcessor.status} />
              {app.resultingProcessor.activatedAt && (
                <Row
                  label="Activated"
                  value={new Date(app.resultingProcessor.activatedAt).toLocaleString()}
                />
              )}
            </Section>
          )}
        </div>
      )}

      {tab === "ubos" && (
        <div>
          {app.ubos.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-200 p-10 text-center text-sm text-gray-500">
              No UBOs recorded.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {app.ubos.map((u) => (
                <div
                  key={u.id}
                  className="rounded-2xl border border-gray-200 bg-white p-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-gray-900">{u.fullName}</h3>
                    <span className="text-xs text-gray-500">
                      {Number(u.ownershipPct).toFixed(2)}%
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                    <Field label="DOB" value={u.dateOfBirth ? new Date(u.dateOfBirth).toLocaleDateString() : "—"} />
                    <Field label="Nationality" value={u.nationality || "—"} />
                    <Field label="ID Type" value={u.idType} />
                    <Field label="ID #" value={u.idNumberMasked || "••••"} mono />
                    {u.idExpiry && (
                      <Field label="ID expiry" value={new Date(u.idExpiry).toLocaleDateString()} />
                    )}
                    {u.idIssuingCountry && (
                      <Field label="Issuing country" value={u.idIssuingCountry} />
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {u.isDirector && <Chip>Director</Chip>}
                    {u.isSignatory && <Chip>Signatory</Chip>}
                    {u.isPep && <Chip tone="red">PEP</Chip>}
                  </div>
                  {u.sourceOfFunds && (
                    <p className="mt-3 text-xs text-gray-500 whitespace-pre-wrap">
                      <strong className="text-gray-700">Funds: </strong>
                      {u.sourceOfFunds}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "documents" && (
        <DocumentsTab appId={app.id} documents={app.documents} />
      )}

      {tab === "timeline" && <TimelineTab events={app.events} />}

      {action === "request-info" && (
        <RequestInfoModal
          appId={app.id}
          onClose={() => setAction(null)}
          onDone={async () => {
            setAction(null);
            await load();
          }}
        />
      )}
      {action === "forward" && (
        <ForwardModal
          appId={app.id}
          docCount={app.documents.length}
          onClose={() => setAction(null)}
          onDone={async () => {
            setAction(null);
            await load();
          }}
        />
      )}
      {action === "mark-provider-approved" && (
        <MarkProviderApprovedModal
          appId={app.id}
          onClose={() => setAction(null)}
          onDone={async () => {
            setAction(null);
            await load();
          }}
        />
      )}
      {action === "reject" && (
        <RejectModal
          appId={app.id}
          onClose={() => setAction(null)}
          onDone={async () => {
            setAction(null);
            await load();
          }}
        />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Phase 2e — vertical timeline. Colored dot + icon per transition, actor
// resolved server-side (see /api/admin/applications/[id]), relative time
// with a hover tooltip carrying the absolute timestamp.
// ---------------------------------------------------------------------------

type StatusTone = "green" | "amber" | "red" | "indigo" | "gray";

const TIMELINE_TONE: Record<string, StatusTone> = {
  LIVE: "green",
  APPROVED: "green",
  PROVIDER_APPROVED: "green",
  INFO_REQUESTED: "amber",
  FORWARDED: "amber",
  REJECTED: "red",
  CANCELLED: "red",
  SUBMITTED: "indigo",
  IN_REVIEW: "indigo",
  DRAFT: "gray",
};

const TIMELINE_ICON: Record<string, string> = {
  LIVE: "solar:check-circle-bold",
  APPROVED: "solar:check-circle-bold",
  PROVIDER_APPROVED: "solar:shield-check-linear",
  INFO_REQUESTED: "solar:info-circle-linear",
  FORWARDED: "solar:paper-plane-linear",
  REJECTED: "solar:close-circle-bold",
  CANCELLED: "solar:close-circle-linear",
  SUBMITTED: "solar:document-add-linear",
  IN_REVIEW: "solar:eye-linear",
  DRAFT: "solar:pen-2-linear",
};

const TONE_CLASSES: Record<StatusTone, { dot: string; ring: string; text: string }> = {
  green: { dot: "bg-emerald-500", ring: "ring-emerald-100", text: "text-emerald-700" },
  amber: { dot: "bg-amber-500", ring: "ring-amber-100", text: "text-amber-700" },
  red: { dot: "bg-red-500", ring: "ring-red-100", text: "text-red-700" },
  indigo: { dot: "bg-indigo-500", ring: "ring-indigo-100", text: "text-indigo-700" },
  gray: { dot: "bg-gray-400", ring: "ring-gray-100", text: "text-gray-600" },
};

const ACTOR_TYPE_LABEL: Record<string, string> = {
  ADMIN: "by",
  MERCHANT: "by",
  PROCESSOR: "by",
  SYSTEM: "",
};

const RTF = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
function relativeTime(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 1000 * 60 * 60 * 24 * 365],
    ["month", 1000 * 60 * 60 * 24 * 30],
    ["day", 1000 * 60 * 60 * 24],
    ["hour", 1000 * 60 * 60],
    ["minute", 1000 * 60],
    ["second", 1000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms || unit === "second") {
      return RTF.format(Math.round(diffMs / ms), unit);
    }
  }
  return "just now";
}

function TimelineTab({ events }: { events: EventRow[] }) {
  if (events.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-200 p-10 text-center text-sm text-gray-500">
        No lifecycle events recorded yet.
      </div>
    );
  }
  return (
    <ol className="relative pl-8">
      {/* Vertical spine — sits behind every dot at x=12 */}
      <div
        className="absolute left-3 top-2 bottom-2 w-px bg-gray-200"
        aria-hidden
      />
      {events.map((ev) => {
        const tone = TIMELINE_TONE[ev.toStatus] || "gray";
        const iconName = TIMELINE_ICON[ev.toStatus] || "solar:round-arrow-right-linear";
        const t = TONE_CLASSES[tone];
        const actorPrefix = ACTOR_TYPE_LABEL[ev.actorType] ?? "";
        const actorText =
          ev.actorType === "SYSTEM"
            ? "system"
            : ev.actorLabel ||
              (ev.actorType === "PROCESSOR" ? "processor" : ev.actorType.toLowerCase());
        return (
          <li key={ev.id} className="relative mb-5 last:mb-0">
            {/* Dot on the spine — absolute so the card content flows freely */}
            <span
              className={`absolute -left-8 top-1.5 flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-white ${t.dot}`}
              aria-hidden
            >
              <Icon icon={iconName} className="h-3.5 w-3.5 text-white" />
            </span>
            <div className={`rounded-2xl border border-gray-100 bg-white p-3 ring-1 ${t.ring}`}>
              <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-xs text-gray-500">
                <span
                  title={new Date(ev.at).toLocaleString()}
                  className="text-gray-700"
                >
                  {relativeTime(ev.at)}
                </span>
                <span aria-hidden>·</span>
                <span>
                  {actorPrefix ? `${actorPrefix} ` : ""}
                  <strong className="text-gray-800">{actorText}</strong>
                </span>
                {ev.actorType !== "SYSTEM" && (
                  <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                    {ev.actorType}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-gray-900">
                {ev.fromStatus ? (
                  <>
                    <span className="text-gray-400">{ev.fromStatus}</span>{" "}
                    <span className="text-gray-400">→</span>{" "}
                  </>
                ) : null}
                <strong className={t.text}>{ev.toStatus}</strong>
              </p>
              {ev.note && (
                <p className="mt-2 ml-0 text-sm text-gray-600 whitespace-pre-wrap border-l-2 border-gray-100 pl-3">
                  {ev.note}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Phase 2d — action bar + modals. Kept in-file so the whole detail view is
// a single self-contained client component. Server-side role checks are
// authoritative — buttons are hidden only as a UX hint.
// ---------------------------------------------------------------------------

function ActionButtons({
  status,
  docCount,
  canRequestInfo,
  canForwardApproveReject,
  onSelect,
}: {
  status: Status;
  docCount: number;
  canRequestInfo: boolean;
  canForwardApproveReject: boolean;
  onSelect: (a: ActionKind) => void;
}) {
  const canForwardFromStatus =
    status === "SUBMITTED" || status === "IN_REVIEW" || status === "INFO_REQUESTED";
  const canRequestInfoFromStatus =
    status === "SUBMITTED" || status === "IN_REVIEW" || status === "FORWARDED";
  const canMarkApprovedFromStatus = status === "FORWARDED";
  const canRejectFromStatus = status !== "LIVE" && status !== "REJECTED";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canRequestInfo && (
        <button
          type="button"
          disabled={!canRequestInfoFromStatus}
          onClick={() => onSelect("request-info")}
          title={
            canRequestInfoFromStatus
              ? "Send the merchant a message asking for more info"
              : `Not available from ${status}`
          }
          className={`text-xs font-semibold px-3 py-1.5 rounded-full ${
            canRequestInfoFromStatus
              ? "bg-amber-100 text-amber-900 hover:bg-amber-200"
              : "bg-gray-100 text-gray-400 cursor-not-allowed"
          }`}
        >
          Request more info
        </button>
      )}
      {canForwardApproveReject && (
        <>
          <button
            type="button"
            disabled={!canForwardFromStatus}
            onClick={() => onSelect("forward")}
            title={
              !canForwardFromStatus
                ? `Not available from ${status}`
                : `Forward the KYB packet (${docCount} document${docCount !== 1 ? "s" : ""}) to a processor`
            }
            className={`text-xs font-semibold px-3 py-1.5 rounded-full ${
              canForwardFromStatus
                ? "bg-slate-900 text-white hover:opacity-90"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
            }`}
          >
            Forward to processor
          </button>
          <button
            type="button"
            disabled={!canMarkApprovedFromStatus}
            onClick={() => onSelect("mark-provider-approved")}
            title={
              canMarkApprovedFromStatus
                ? "Record a processor's approval + credentials → goes LIVE"
                : `Only available from FORWARDED (currently ${status})`
            }
            className={`text-xs font-semibold px-3 py-1.5 rounded-full ${
              canMarkApprovedFromStatus
                ? "bg-emerald-600 text-white hover:opacity-90"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
            }`}
          >
            Mark provider-approved
          </button>
          <button
            type="button"
            disabled={!canRejectFromStatus}
            onClick={() => onSelect("reject")}
            title={canRejectFromStatus ? "Reject with a reason" : `Not available from ${status}`}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full ${
              canRejectFromStatus
                ? "bg-red-600 text-white hover:opacity-90"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
            }`}
          >
            Reject
          </button>
        </>
      )}
    </div>
  );
}

function RequestInfoModal({
  appId,
  onClose,
  onDone,
}: {
  appId: string;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/applications/${appId}/request-info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || String(res.status));
      toast.success("Info request sent");
      await onDone();
    } catch (e) {
      toast.error((e as Error).message || "Save failed");
      setSubmitting(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl">
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">Request more info</h3>
          <p className="text-xs text-gray-600 mt-1">
            The merchant sees this note on their portal + gets an email nudge.
            App status flips to INFO_REQUESTED.
          </p>
        </div>
        <div className="p-5 space-y-2">
          <label className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
            What do you need?
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={6}
            placeholder="e.g. Please upload a clearer scan of the void cheque — the account number isn't legible."
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-sm font-medium text-gray-600 hover:text-gray-800 px-3 py-1.5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !note.trim()}
            className="text-sm font-semibold px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Sending…" : "Send request"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ForwardModal({
  appId,
  docCount,
  onClose,
  onDone,
}: {
  appId: string;
  docCount: number;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [processor, setProcessor] = useState<"GP" | "MONERIS">("GP");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!window.confirm(
      `Send the KYB packet (${docCount} document${docCount !== 1 ? "s" : ""} + summary PDF) to ${processor === "GP" ? "Global Payments" : "Moneris"}?`
    )) {
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/applications/${appId}/forward`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ processor, note: note.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || String(res.status));
      toast.success(`Forwarded to ${data.application?.forwardedToEmail || processor}`);
      await onDone();
    } catch (e) {
      toast.error((e as Error).message || "Forward failed");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl">
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">Forward to processor</h3>
          <p className="text-xs text-gray-600 mt-1">
            Builds a summary PDF + ZIP of {docCount} document{docCount !== 1 ? "s" : ""}
            {" "}and emails the processor's onboarding team with a 7-day download link.
            App status flips to FORWARDED.
          </p>
        </div>
        <div className="p-5 space-y-3">
          <label className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
            Processor
          </label>
          <div className="flex gap-2">
            {(["GP", "MONERIS"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setProcessor(p)}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold border ${
                  processor === p
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                {p === "GP" ? "Global Payments" : "Moneris"}
              </button>
            ))}
          </div>
          <label className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold pt-2 block">
            Reviewer note (optional — inlined in the email)
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            placeholder="e.g. Approved KYB, projected volume matches supplied bank statements. Please prioritise."
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-sm font-medium text-gray-600 hover:text-gray-800 px-3 py-1.5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || docCount === 0}
            className="text-sm font-semibold px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Sending…" : `Forward to ${processor === "GP" ? "GP" : "Moneris"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function MarkProviderApprovedModal({
  appId,
  onClose,
  onDone,
}: {
  appId: string;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [processor, setProcessor] = useState<"GP" | "MONERIS">("GP");
  const [capability, setCapability] = useState<"CARD" | "INTERAC" | "GIFT_CARD" | "ACH">("CARD");
  const [providerReferenceId, setProviderReferenceId] = useState("");
  const [appIdVal, setAppIdVal] = useState("");
  const [appKey, setAppKey] = useState("");
  const [accountName, setAccountName] = useState("");
  const [storeId, setStoreId] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      const credentials =
        processor === "GP"
          ? { app_id: appIdVal, app_key: appKey, account_name: accountName || undefined }
          : { store_id: storeId, api_token: apiToken };
      const res = await fetch(`/api/admin/applications/${appId}/mark-provider-approved`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ processor, capability, providerReferenceId, credentials }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || String(res.status));
      toast.success("Provider approved — tenant is LIVE");
      await onDone();
    } catch (e) {
      toast.error((e as Error).message || "Save failed");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl">
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">Mark provider-approved</h3>
          <p className="text-xs text-gray-600 mt-1">
            Records the processor's approval + credentials. Credentials are AES-GCM
            encrypted at rest. App status flips to LIVE and the tenant's
            (capability, processor) slot is activated.
          </p>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-1">Processor</p>
              <select
                value={processor}
                onChange={(e) => setProcessor(e.target.value as "GP" | "MONERIS")}
                className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
              >
                <option value="GP">Global Payments</option>
                <option value="MONERIS">Moneris</option>
              </select>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-1">Capability</p>
              <select
                value={capability}
                onChange={(e) =>
                  setCapability(e.target.value as "CARD" | "INTERAC" | "GIFT_CARD" | "ACH")
                }
                className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
              >
                <option value="CARD">CARD</option>
                <option value="INTERAC">INTERAC</option>
                <option value="GIFT_CARD">GIFT_CARD</option>
                <option value="ACH">ACH</option>
              </select>
            </div>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-1">
              Provider reference (MID / store_id)
            </p>
            <input
              type="text"
              value={providerReferenceId}
              onChange={(e) => setProviderReferenceId(e.target.value)}
              placeholder="e.g. 12345678"
              className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm font-mono"
            />
          </div>
          {processor === "GP" ? (
            <>
              <FormField label="app_id" value={appIdVal} onChange={setAppIdVal} mono />
              <FormField label="app_key" value={appKey} onChange={setAppKey} mono secret />
              <FormField label="account_name (optional)" value={accountName} onChange={setAccountName} mono />
            </>
          ) : (
            <>
              <FormField label="store_id" value={storeId} onChange={setStoreId} mono />
              <FormField label="api_token" value={apiToken} onChange={setApiToken} mono secret />
            </>
          )}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-sm font-medium text-gray-600 hover:text-gray-800 px-3 py-1.5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !providerReferenceId}
            className="text-sm font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Approve + go LIVE"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RejectModal({
  appId,
  onClose,
  onDone,
}: {
  appId: string;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    if (!window.confirm("Reject this application? This is terminal and cannot be undone.")) {
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/applications/${appId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || String(res.status));
      toast.success("Application rejected");
      await onDone();
    } catch (e) {
      toast.error((e as Error).message || "Reject failed");
      setSubmitting(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border-2 border-red-200">
        <div className="px-5 py-4 border-b border-red-200 bg-red-50/40">
          <h3 className="font-semibold text-red-900">Reject application</h3>
          <p className="text-xs text-red-800 mt-1">
            Terminal action — status flips to REJECTED and the merchant is notified.
            You cannot un-reject from the UI.
          </p>
        </div>
        <div className="p-5 space-y-2">
          <label className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
            Reason (shown to merchant + timeline)
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={6}
            placeholder="e.g. Bank statements do not match declared account. Please re-submit with corrected KYB."
            className="w-full rounded-lg border border-red-200 px-3 py-2 text-sm"
          />
        </div>
        <div className="px-5 py-3 border-t border-red-100 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-sm font-medium text-gray-600 hover:text-gray-800 px-3 py-1.5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !reason.trim()}
            className="text-sm font-semibold px-3 py-1.5 rounded-lg bg-red-600 text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Rejecting…" : "Reject"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FormField({
  label,
  value,
  onChange,
  mono,
  secret,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  secret?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-1">
        {label}
      </p>
      <input
        type={secret ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm ${mono ? "font-mono" : ""}`}
      />
    </div>
  );
}

function Section({
  title,
  rightSlot,
  children,
}: {
  title: string;
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900">{title}</h2>
        {rightSlot}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={`text-gray-900 text-right ${mono ? "font-mono" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-gray-400">{label}</p>
      <p className={`text-gray-800 ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function Chip({
  children,
  tone = "gray",
}: {
  children: React.ReactNode;
  tone?: "gray" | "red";
}) {
  const cls =
    tone === "red"
      ? "bg-red-100 text-red-800"
      : "bg-gray-100 text-gray-700";
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${cls}`}>
      {children}
    </span>
  );
}

function RevealButton({
  disabled,
  running,
  onClick,
}: {
  disabled: boolean;
  running: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || running}
      title={disabled ? "SUPER_ADMIN or COMPLIANCE only" : "Reveal — audited"}
      className={`text-xs px-2.5 py-1 rounded-full font-semibold inline-flex items-center gap-1 ${
        disabled
          ? "bg-gray-100 text-gray-400 cursor-not-allowed"
          : "bg-amber-100 text-amber-900 hover:bg-amber-200"
      }`}
    >
      {running ? "Revealing…" : "Reveal"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Documents tab (Phase 2c) — real download/preview via presigned GETs.
// The preview modal renders PDFs in an <iframe> and images inline;
// everything else falls through to a plain "download" link. Every
// URL request is audited server-side.
// ---------------------------------------------------------------------------

function DocumentsTab({
  appId,
  documents,
}: {
  appId: string;
  documents: DocRow[];
}) {
  const [previewing, setPreviewing] = useState<{
    doc: DocRow;
    url: string;
  } | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  // The list on the page came from the initial page load; when a new
  // Phase 2c upload arrives we hit our own admin endpoint for a fresh
  // list so the admin doesn't have to reload the page manually.
  const [rows, setRows] = useState<DocRow[]>(documents);
  const [reloading, setReloading] = useState(false);

  const reload = useCallback(async () => {
    setReloading(true);
    try {
      const res = await fetch(`/api/admin/applications/${appId}/documents`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.documents)) {
        setRows(data.documents);
      }
    } finally {
      setReloading(false);
    }
  }, [appId]);

  const fetchUrl = async (
    doc: DocRow,
    disposition: "inline" | "attachment"
  ): Promise<string | null> => {
    try {
      const res = await fetch(
        `/api/admin/applications/${appId}/documents/${doc.id}/download?disposition=${disposition}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || String(res.status));
      return data.url as string;
    } catch (e) {
      toast.error((e as Error).message || "Failed to sign download URL");
      return null;
    }
  };

  const handlePreview = async (doc: DocRow) => {
    setPreviewingId(doc.id);
    const url = await fetchUrl(doc, "inline");
    setPreviewingId(null);
    if (url) setPreviewing({ doc, url });
  };

  const handleDownload = async (doc: DocRow) => {
    setDownloading(doc.id);
    const url = await fetchUrl(doc, "attachment");
    setDownloading(null);
    if (!url) return;
    // Programmatic click on a hidden anchor so the browser respects the
    // Content-Disposition on the presigned URL and drops the file to Downloads.
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener noreferrer";
    a.click();
  };

  const previewable = (mime: string) =>
    mime === "application/pdf" ||
    mime.startsWith("image/");

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-gray-500">
          Downloads are audited (<code>kyb.download_document</code>). Presigned URLs expire after 5 minutes.
        </p>
        <button
          type="button"
          onClick={reload}
          disabled={reloading}
          className="text-xs font-medium text-slate-700 hover:underline disabled:opacity-50"
        >
          {reloading ? "Refreshing…" : "Refresh list"}
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 p-10 text-center text-sm text-gray-500">
          No documents uploaded yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map((d) => {
            const canPreview = previewable(d.mimeType);
            return (
              <div
                key={d.id}
                className="rounded-2xl border border-gray-200 bg-white p-4 flex flex-col"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 font-semibold uppercase">
                    {d.docType.replaceAll("_", " ")}
                  </span>
                  <span className="text-[10px] text-gray-400 uppercase">
                    {d.scanStatus}
                  </span>
                </div>
                <div className="h-24 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center mb-3">
                  {d.mimeType.startsWith("image/") ? (
                    <span className="text-[10px] text-gray-400 uppercase tracking-wider">
                      Image thumb on preview
                    </span>
                  ) : d.mimeType === "application/pdf" ? (
                    <span className="text-2xl">📄</span>
                  ) : (
                    <span className="text-2xl">📎</span>
                  )}
                </div>
                <p
                  className="text-sm font-medium text-gray-900 truncate"
                  title={d.originalFilename}
                >
                  {d.originalFilename}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {d.mimeType} · {(d.sizeBytes / 1024).toFixed(1)} KB
                </p>
                {d.sha256 && (
                  <p
                    className="text-[10px] text-gray-400 mt-1 font-mono truncate"
                    title={d.sha256}
                  >
                    {d.sha256.slice(0, 16)}…
                  </p>
                )}
                <p className="text-xs text-gray-400 mt-1">
                  Uploaded {new Date(d.createdAt).toLocaleString()}
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!canPreview || previewingId === d.id}
                    onClick={() => handlePreview(d)}
                    className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-800 hover:bg-slate-200 disabled:opacity-50"
                    title={canPreview ? "Preview inline" : "No inline preview for this file type"}
                  >
                    {previewingId === d.id ? "Loading…" : "Preview"}
                  </button>
                  <button
                    type="button"
                    disabled={downloading === d.id}
                    onClick={() => handleDownload(d)}
                    className="text-xs font-semibold px-2.5 py-1 rounded-full bg-primary text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {downloading === d.id ? "Signing…" : "Download"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {previewing && (
        <PreviewModal
          filename={previewing.doc.originalFilename}
          mimeType={previewing.doc.mimeType}
          url={previewing.url}
          onClose={() => setPreviewing(null)}
        />
      )}
    </div>
  );
}

function PreviewModal({
  filename,
  mimeType,
  url,
  onClose,
}: {
  filename: string;
  mimeType: string;
  url: string;
  onClose: () => void;
}) {
  // ESC closes — matches every other overlay in this admin.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="relative w-full max-w-5xl h-[85vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate" title={filename}>
              {filename}
            </p>
            <p className="text-xs text-gray-500">{mimeType}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-medium text-slate-700 hover:underline"
          >
            Close (Esc)
          </button>
        </div>
        <div className="flex-1 bg-gray-50">
          {mimeType === "application/pdf" ? (
            <iframe title={filename} src={url} className="w-full h-full border-0" />
          ) : mimeType.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={filename}
              className="max-w-full max-h-full mx-auto object-contain"
            />
          ) : (
            <div className="p-6 text-sm text-gray-600">
              This file type can't be previewed inline. Use the Download button on the card
              behind this modal.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
