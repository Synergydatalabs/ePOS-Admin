// Tenants list — client-side filters over the /api/admin/tenants endpoint.
// Server-side pagination lives on the endpoint (100-row cap) so we don't
// pull the whole tenants table into the browser on the first render.
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  businessType: string;
  status: string;
  createdAt: string;
  // Phase I #4 (2026-09-12): from api/admin/tenants join to
  // tenant_verifications. Null for grandfathered/ACTIVE tenants that
  // predate the approval flow.
  verification?: {
    emailVerifiedAt: string | null;
    phoneVerifiedAt: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
  } | null;
}

const BUSINESS_TYPES = ["", "restaurant", "salon", "retail", "supplier", "cab"];
// Phase I #4 (2026-09-12): PENDING_APPROVAL surfaces first so the
// approval queue is one click away from the list.
const STATUSES = ["", "PENDING_APPROVAL", "ACTIVE", "SUSPENDED", "CANCELLED", "REJECTED"];

export default function TenantsPage() {
  const [search, setSearch] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      const qs = new URLSearchParams();
      if (search) qs.set("search", search);
      if (businessType) qs.set("businessType", businessType);
      if (status) qs.set("status", status);
      try {
        const res = await fetch(`/api/admin/tenants?${qs}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        setRows(data.tenants || []);
      } catch (e: unknown) {
        if ((e as { name?: string }).name !== "AbortError") {
          toast.error("Failed to load tenants");
        }
      } finally {
        setLoading(false);
      }
    }, 200); // debounce keystrokes

    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [search, businessType, status]);

  const empty = useMemo(() => !loading && rows.length === 0, [loading, rows.length]);

  return (
    <main className="p-8 max-w-6xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Tenants</h1>
        <p className="text-sm text-gray-500 mt-1">
          Every tenant across every partner deployment.
        </p>
      </header>

      <div className="rounded-2xl border border-gray-100 bg-white overflow-hidden">
        <div className="flex flex-wrap gap-3 border-b border-gray-100 p-4">
          <input
            type="text"
            placeholder="Search name or slug…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <select
            value={businessType}
            onChange={(e) => setBusinessType(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            {BUSINESS_TYPES.map((t) => (
              <option key={t} value={t}>
                {t ? t.charAt(0).toUpperCase() + t.slice(1) : "All types"}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s || "All statuses"}
              </option>
            ))}
          </select>
        </div>

        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Name</th>
              <th className="text-left px-4 py-2 font-medium">Slug</th>
              <th className="text-left px-4 py-2 font-medium">Type</th>
              <th className="text-left px-4 py-2 font-medium">Status</th>
              <th className="text-left px-4 py-2 font-medium">Verification</th>
              <th className="text-left px-4 py-2 font-medium">Created</th>
              <th className="text-right px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr>
                <td colSpan={7} className="text-center text-gray-400 py-8">
                  Loading…
                </td>
              </tr>
            )}
            {empty && (
              <tr>
                <td colSpan={7} className="text-center text-gray-400 py-8">
                  No tenants match those filters.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium text-gray-900">{t.name}</td>
                  <td className="px-4 py-2 text-gray-500">{t.slug}</td>
                  <td className="px-4 py-2 capitalize">{t.businessType}</td>
                  <td className="px-4 py-2">
                    <StatusPill status={t.status} />
                  </td>
                  <td className="px-4 py-2">
                    <VerificationCell verification={t.verification} />
                  </td>
                  <td className="px-4 py-2 text-gray-500 tabular-nums">
                    {new Date(t.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/tenants/${t.id}`}
                      className="text-primary hover:underline text-sm"
                    >
                      {t.status === "PENDING_APPROVAL" ? "Review" : "View"}
                    </Link>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function StatusPill({ status }: { status: string }) {
  // Phase I #4 (2026-09-12): PENDING_APPROVAL uses blue (waiting on us);
  // REJECTED uses red (decisive) so it stands out from CANCELLED grey.
  const map: Record<string, string> = {
    ACTIVE: "bg-emerald-50 text-emerald-700",
    PENDING_APPROVAL: "bg-blue-50 text-blue-700",
    SUSPENDED: "bg-amber-50 text-amber-700",
    REJECTED: "bg-red-50 text-red-700",
    CANCELLED: "bg-gray-100 text-gray-500",
  };
  const cls = map[status] || "bg-gray-100 text-gray-500";
  const label = status === "PENDING_APPROVAL" ? "PENDING" : status;
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {label}
    </span>
  );
}

// Two compact chips per row: email + phone verification. A grey dot
// means "not verified yet", a green check means "verified". Absent
// row (grandfathered tenant) renders a dash.
function VerificationCell({
  verification,
}: {
  verification: TenantRow["verification"];
}) {
  if (!verification) {
    return <span className="text-gray-300 text-xs">—</span>;
  }
  const emailOk = !!verification.emailVerifiedAt;
  const phoneOk = !!verification.phoneVerifiedAt;
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <VerifyChip label="email" ok={emailOk} />
      <VerifyChip label="phone" ok={phoneOk} muted={!verification.contactPhone} />
    </div>
  );
}

function VerifyChip({
  label,
  ok,
  muted,
}: {
  label: string;
  ok: boolean;
  muted?: boolean;
}) {
  if (muted) {
    return (
      <span className="inline-flex items-center gap-1 text-gray-300">
        <span>–</span>
        {label}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 ${
        ok ? "text-emerald-600" : "text-gray-400"
      }`}
    >
      <span>{ok ? "✓" : "○"}</span>
      {label}
    </span>
  );
}
