// Applications inbox — client component. Owns the filter state, debounces
// the search box, and re-fetches whenever a filter changes. Read-only: no
// action buttons in Phase 2b. Row click routes to the detail view.
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

// Phase 2e — FORWARDED applications older than this get an amber "Overdue"
// chip so the queue view surfaces processor stalls. Tune here.
const FORWARDED_OVERDUE_DAYS = 14;

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

type TenantRoleFilter = "" | "MERCHANT" | "SUPPLIER";

interface AppRow {
  id: string;
  tenantRole: "MERCHANT" | "SUPPLIER";
  status: Status;
  targetProcessor: "GP" | "MONERIS" | "STRIPE" | null;
  legalName: string;
  dbaName: string | null;
  incorporationRegion: string | null;
  projectedMonthlyVolumeCents: number | null;
  currency: string;
  submittedAt: string;
  forwardedAt: string | null;
  tenantName: string;
  tenantBusinessType: string;
}

function overdueDays(row: AppRow): number | null {
  if (row.status !== "FORWARDED" || !row.forwardedAt) return null;
  const days = Math.floor(
    (Date.now() - new Date(row.forwardedAt).getTime()) / (1000 * 60 * 60 * 24)
  );
  return days > FORWARDED_OVERDUE_DAYS ? days : null;
}

type Counts = Partial<Record<Status, number>>;

const STATUS_TABS: { key: "" | Status; label: string; countKey?: Status }[] = [
  { key: "", label: "All" },
  { key: "SUBMITTED", label: "New", countKey: "SUBMITTED" },
  { key: "IN_REVIEW", label: "In review", countKey: "IN_REVIEW" },
  { key: "INFO_REQUESTED", label: "Info requested", countKey: "INFO_REQUESTED" },
  { key: "FORWARDED", label: "With processor", countKey: "FORWARDED" },
  { key: "PROVIDER_APPROVED", label: "Provider approved", countKey: "PROVIDER_APPROVED" },
  { key: "APPROVED", label: "Approved", countKey: "APPROVED" },
  { key: "LIVE", label: "Live", countKey: "LIVE" },
  { key: "REJECTED", label: "Rejected", countKey: "REJECTED" },
];

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

export default function ApplicationsClient() {
  const [tenantRole, setTenantRole] = useState<TenantRoleFilter>("");
  const [activeStatus, setActiveStatus] = useState<"" | Status>("");
  const [processor, setProcessor] = useState<"" | "GP" | "MONERIS" | "STRIPE">("");
  const [search, setSearch] = useState("");

  const [apps, setApps] = useState<AppRow[]>([]);
  const [counts, setCounts] = useState<Counts>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      const qs = new URLSearchParams();
      if (activeStatus) qs.set("status", activeStatus);
      if (tenantRole) qs.set("tenantRole", tenantRole);
      if (processor) qs.set("processor", processor);
      if (search.trim()) qs.set("search", search.trim());
      try {
        const res = await fetch(`/api/admin/applications?${qs.toString()}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        setApps(data.applications || []);
        setCounts(data.counts || {});
      } catch (e: unknown) {
        if ((e as { name?: string }).name !== "AbortError") {
          toast.error("Failed to load applications");
        }
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [activeStatus, tenantRole, processor, search]);

  const money = (cents: number | null, currency: string) =>
    cents == null
      ? "—"
      : `${currency} ${(cents / 100).toLocaleString(undefined, {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        })}`;

  const empty = useMemo(() => !loading && apps.length === 0, [loading, apps.length]);

  return (
    <div>
      {/* Role + processor filter row */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="inline-flex rounded-full border border-gray-200 bg-white p-1 text-sm">
          {(["", "MERCHANT", "SUPPLIER"] as TenantRoleFilter[]).map((r) => (
            <button
              key={r || "all"}
              type="button"
              onClick={() => setTenantRole(r)}
              className={`px-3 py-1 rounded-full transition-colors ${
                tenantRole === r
                  ? "bg-gray-900 text-white"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              {r ? r.charAt(0) + r.slice(1).toLowerCase() : "All"}
            </button>
          ))}
        </div>

        <select
          value={processor}
          onChange={(e) =>
            setProcessor(e.target.value as "" | "GP" | "MONERIS" | "STRIPE")
          }
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="">All processors</option>
          <option value="GP">Global Payments</option>
          <option value="MONERIS">Moneris</option>
          <option value="STRIPE">Stripe</option>
        </select>

        <input
          type="text"
          placeholder="Search tenant name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>

      {/* Status tabs — badges reflect counts within the current tenantRole filter */}
      <div className="flex items-center gap-2 mb-5 overflow-x-auto pb-1">
        {STATUS_TABS.map((tab) => {
          const count = tab.countKey ? counts[tab.countKey] || 0 : undefined;
          const active = activeStatus === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveStatus(tab.key)}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors flex-shrink-0 ${
                active
                  ? "bg-slate-900 text-white"
                  : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
              }`}
            >
              {tab.label}
              {count != null && (
                <span
                  className={`text-xs px-1.5 py-0 rounded-full ${
                    active ? "bg-white/20" : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : empty ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">
            {activeStatus || search || tenantRole || processor
              ? "No applications match"
              : "No applications yet"}
          </h2>
          <p className="text-sm text-gray-500">
            {activeStatus || search || tenantRole || processor
              ? "Try clearing a filter."
              : "Merchants + suppliers who apply will appear here."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {apps.map((a) => {
            const style = STATUS_STYLES[a.status];
            return (
              <Link
                key={a.id}
                href={`/applications/${a.id}`}
                className="block bg-white rounded-2xl border border-gray-200 p-5 hover:border-slate-300 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="font-semibold text-gray-900 truncate">
                        {a.legalName}
                      </h3>
                      {a.dbaName && (
                        <span className="text-sm text-gray-500 truncate">
                          ({a.dbaName})
                        </span>
                      )}
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
                          a.tenantRole === "MERCHANT"
                            ? "bg-sky-100 text-sky-800"
                            : "bg-amber-100 text-amber-900"
                        }`}
                      >
                        {a.tenantRole}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${style.bg} ${style.text}`}
                      >
                        {style.label}
                      </span>
                      {(() => {
                        const days = overdueDays(a);
                        return days == null ? null : (
                          <span
                            className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-900"
                            title={`Forwarded ${new Date(
                              a.forwardedAt!
                            ).toLocaleDateString()} — no processor decision in ${days} days`}
                          >
                            Overdue {days} days
                          </span>
                        );
                      })()}
                    </div>
                    <p className="text-sm text-gray-600 truncate">
                      Tenant: {a.tenantName} · {a.tenantBusinessType}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                      <span>
                        Submitted {new Date(a.submittedAt).toLocaleDateString()}
                      </span>
                      {a.targetProcessor && (
                        <span>
                          <strong className="text-gray-700">→</strong>{" "}
                          {a.targetProcessor}
                        </span>
                      )}
                      {a.incorporationRegion && (
                        <span>{a.incorporationRegion}</span>
                      )}
                      {a.projectedMonthlyVolumeCents != null && (
                        <span>
                          ~{money(a.projectedMonthlyVolumeCents, a.currency)}/mo
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-gray-400 text-xl leading-none">›</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
