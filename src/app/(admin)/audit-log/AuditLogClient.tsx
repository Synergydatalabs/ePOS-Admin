// Interactive audit-log table. Reads the query string once for deep-link
// support, then owns local filter state and re-queries /api/admin/audit-log
// whenever a filter changes. Pagination is server-side (50 per page).
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

interface AdminRef {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role?: string;
}

interface AuditRow {
  id: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  before: unknown;
  after: unknown;
  ipAddress: string | null;
  createdAt: string;
  admin: AdminRef | null;
}

// Human-readable labels for the actions we already emit. Any action not
// in the map falls back to the raw slug so the log never hides an event.
const ACTION_LABELS: Record<string, string> = {
  "admin_user.create": "Created admin user",
  "admin_user.update": "Updated admin user",
  "admin_user.reset_password": "Reset password",
  "admin_user.deactivate": "Deactivated admin user",
  "admin_user.reactivate": "Reactivated admin user",
  "kyb.reveal_field": "Revealed KYB field",
  "kyb.download_document": "Downloaded KYB document",
  "kyb.forward_to_processor": "Forwarded to processor",
  "kyb.request_info": "Requested more info",
  "kyb.mark_provider_approved": "Marked provider-approved",
  "kyb.reject": "Rejected application",
  "tenant.update": "Updated tenant",
};

function humanAction(slug: string): string {
  return ACTION_LABELS[slug] || slug;
}

// Same relative-time behavior date-fns gives, but built on Intl so we
// don't ship a whole date lib for this one call site.
const RTF = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
function relative(iso: string): string {
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

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: "bg-indigo-50 text-indigo-700",
  COMPLIANCE: "bg-emerald-50 text-emerald-700",
  SUPPORT: "bg-sky-50 text-sky-700",
  SALES: "bg-amber-50 text-amber-700",
  FINANCE: "bg-purple-50 text-purple-700",
};

function todayIso(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
function daysAgoIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export default function AuditLogClient() {
  const router = useRouter();
  const sp = useSearchParams();

  // Deep-link seed values — read once, then local state owns them.
  const [adminId, setAdminId] = useState(sp.get("adminId") || "");
  const [action, setAction] = useState(sp.get("action") || "");
  const [resourceType, setResourceType] = useState(sp.get("resourceType") || "");
  const [resourceId, setResourceId] = useState(sp.get("resourceId") || "");
  const [search, setSearch] = useState(sp.get("search") || "");
  const [from, setFrom] = useState(sp.get("from") || daysAgoIso(7));
  const [to, setTo] = useState(sp.get("to") || todayIso());
  const [page, setPage] = useState(Number(sp.get("page") || "1") || 1);

  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(true);

  // Dropdown data — cached across page changes; only page 1 refreshes them.
  const [actionOptions, setActionOptions] = useState<string[]>([]);
  const [typeOptions, setTypeOptions] = useState<string[]>([]);
  const [adminOptions, setAdminOptions] = useState<AdminRef[]>([]);

  // Sync the URL so links are shareable + reload-safe. Never introduce a
  // new history entry for a filter tweak — we replace.
  const syncUrl = useCallback(
    (
      overrides: Partial<{
        adminId: string;
        action: string;
        resourceType: string;
        resourceId: string;
        search: string;
        from: string;
        to: string;
        page: number;
      }> = {}
    ) => {
      const params = new URLSearchParams();
      const eff = {
        adminId,
        action,
        resourceType,
        resourceId,
        search,
        from,
        to,
        page,
        ...overrides,
      };
      if (eff.adminId) params.set("adminId", eff.adminId);
      if (eff.action) params.set("action", eff.action);
      if (eff.resourceType) params.set("resourceType", eff.resourceType);
      if (eff.resourceId) params.set("resourceId", eff.resourceId);
      if (eff.search) params.set("search", eff.search);
      if (eff.from) params.set("from", eff.from);
      if (eff.to) params.set("to", eff.to);
      if (eff.page && eff.page !== 1) params.set("page", String(eff.page));
      router.replace(`/audit-log?${params.toString()}`, { scroll: false });
    },
    [adminId, action, resourceType, resourceId, search, from, to, page, router]
  );

  // Reset to page 1 whenever a filter (not the page number itself) changes,
  // so switching filter never leaves the user on an empty page N.
  const resetPageOnFilterChange = useRef<boolean>(false);
  useEffect(() => {
    if (resetPageOnFilterChange.current) {
      setPage(1);
    } else {
      resetPageOnFilterChange.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminId, action, resourceType, resourceId, search, from, to]);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      const qs = new URLSearchParams();
      if (adminId) qs.set("adminId", adminId);
      if (action) qs.set("action", action);
      if (resourceType) qs.set("resourceType", resourceType);
      if (resourceId) qs.set("resourceId", resourceId);
      if (search) qs.set("search", search);
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      qs.set("page", String(page));
      try {
        const res = await fetch(`/api/admin/audit-log?${qs.toString()}`, {
          signal: ctrl.signal,
          cache: "no-store",
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        setRows(data.events || []);
        setTotal(data.total || 0);
        setPageSize(data.pageSize || 50);
        if (Array.isArray(data.distinctActions)) setActionOptions(data.distinctActions);
        if (Array.isArray(data.distinctResourceTypes))
          setTypeOptions(data.distinctResourceTypes);
        if (Array.isArray(data.admins)) setAdminOptions(data.admins);
        syncUrl();
      } catch (e: unknown) {
        if ((e as { name?: string }).name !== "AbortError") {
          toast.error("Failed to load audit log");
        }
      } finally {
        setLoading(false);
      }
    }, 150);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
    // syncUrl intentionally excluded — it depends on the same values,
    // which would recurse. All filter state is already in this array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminId, action, resourceType, resourceId, search, from, to, page]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const activeFilterCount = useMemo(
    () =>
      [adminId, action, resourceType, resourceId, search].filter(Boolean).length +
      (from ? 1 : 0) +
      (to ? 1 : 0),
    [adminId, action, resourceType, resourceId, search, from, to]
  );

  const clearFilters = () => {
    setAdminId("");
    setAction("");
    setResourceType("");
    setResourceId("");
    setSearch("");
    setFrom(daysAgoIso(7));
    setTo(todayIso());
    setPage(1);
  };

  return (
    <div>
      {/* Filter panel — indigo highlight on any active filter to make it
          obvious the view isn't showing everything. */}
      <div className="rounded-2xl border border-gray-100 bg-white p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <FilterField label="Admin">
            <select
              value={adminId}
              onChange={(e) => setAdminId(e.target.value)}
              className="input"
            >
              <option value="">All admins</option>
              {adminOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.email}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Action">
            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="input"
            >
              <option value="">All actions</option>
              {actionOptions.map((a) => (
                <option key={a} value={a}>
                  {humanAction(a)}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Resource type">
            <select
              value={resourceType}
              onChange={(e) => setResourceType(e.target.value)}
              className="input"
            >
              <option value="">All resources</option>
              {typeOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Resource id (search)">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="uuid or partial…"
              className="input"
            />
          </FilterField>
          <FilterField label="From">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="input"
            />
          </FilterField>
          <FilterField label="To">
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="input"
            />
          </FilterField>
          <div className="flex items-end gap-2 md:col-span-2 lg:col-span-2 justify-end">
            {resourceId && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-indigo-50 text-indigo-700 rounded-full px-2 py-1">
                Pinned resource: {resourceId.slice(0, 8)}…
                <button
                  type="button"
                  onClick={() => setResourceId("")}
                  className="hover:text-indigo-900"
                  aria-label="Clear pinned resource"
                >
                  <Icon icon="solar:close-circle-linear" className="h-3.5 w-3.5" />
                </button>
              </span>
            )}
            <button
              type="button"
              onClick={clearFilters}
              disabled={activeFilterCount === 0}
              className="text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-40 disabled:hover:text-gray-600"
            >
              Reset filters
            </button>
          </div>
        </div>
      </div>

      {/* Result count + pagination */}
      <div className="flex items-center justify-between mb-3 text-xs text-gray-500">
        <span>
          {loading
            ? "Loading…"
            : `${total.toLocaleString()} event${total === 1 ? "" : "s"}`}
        </span>
        <Pager
          page={page}
          totalPages={totalPages}
          disabled={loading || totalPages <= 1}
          onChange={setPage}
        />
      </div>

      {/* Table — desktop-first, single scroll container for narrow viewports. */}
      <div className="rounded-2xl border border-gray-100 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2 font-medium">When</th>
                <th className="text-left px-4 py-2 font-medium">Admin</th>
                <th className="text-left px-4 py-2 font-medium">Action</th>
                <th className="text-left px-4 py-2 font-medium">Resource</th>
                <th className="text-left px-4 py-2 font-medium">Change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-gray-400 py-8">
                    Loading&hellip;
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-gray-400 py-8">
                    No audit events match the current filters.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50 align-top">
                  <td
                    className="px-4 py-2 whitespace-nowrap text-gray-700"
                    title={new Date(r.createdAt).toLocaleString()}
                  >
                    {relative(r.createdAt)}
                  </td>
                  <td className="px-4 py-2">
                    {r.admin ? (
                      <div className="flex flex-col">
                        <span className="text-gray-900">{r.admin.email}</span>
                        {r.admin.role && (
                          <span
                            className={`mt-0.5 self-start rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                              ROLE_COLORS[r.admin.role] || "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {r.admin.role}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <div className="text-gray-900">{humanAction(r.action)}</div>
                    <code className="text-[10px] text-gray-400 font-mono">
                      {r.action}
                    </code>
                  </td>
                  <td className="px-4 py-2">
                    {r.resourceType ? (
                      <div className="flex flex-col">
                        <span className="text-gray-700 text-xs">{r.resourceType}</span>
                        {r.resourceId && (
                          <code
                            className="text-[11px] text-gray-500 font-mono"
                            title={r.resourceId}
                          >
                            {r.resourceId.slice(0, 12)}
                            {r.resourceId.length > 12 ? "…" : ""}
                          </code>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 max-w-md">
                    <DiffCell before={r.before} after={r.after} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between mt-3 text-xs text-gray-500">
        <span>
          Page {page} of {totalPages}
        </span>
        <Pager
          page={page}
          totalPages={totalPages}
          disabled={loading || totalPages <= 1}
          onChange={setPage}
        />
      </div>
    </div>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-1">
        {label}
      </span>
      {children}
      <style jsx>{`
        label :global(.input) {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid #e5e7eb;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          background: white;
        }
        label :global(.input:focus) {
          border-color: #4f46e5;
          outline: none;
          box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.2);
        }
      `}</style>
    </label>
  );
}

function Pager({
  page,
  totalPages,
  disabled,
  onChange,
}: {
  page: number;
  totalPages: number;
  disabled: boolean;
  onChange: (n: number) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        disabled={disabled || page <= 1}
        onClick={() => onChange(page - 1)}
        className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-transparent"
      >
        Prev
      </button>
      <button
        type="button"
        disabled={disabled || page >= totalPages}
        onClick={() => onChange(page + 1)}
        className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-transparent"
      >
        Next
      </button>
    </div>
  );
}

function DiffCell({ before, after }: { before: unknown; after: unknown }) {
  const hasBefore = before !== null && before !== undefined;
  const hasAfter = after !== null && after !== undefined;
  if (!hasBefore && !hasAfter) {
    return <span className="text-gray-400 text-xs">—</span>;
  }
  return (
    <details className="group">
      <summary className="cursor-pointer text-xs text-indigo-700 hover:text-indigo-900 select-none">
        {hasBefore && hasAfter ? "before → after" : hasAfter ? "after" : "before"}
        <span className="ml-1 text-gray-400 group-open:hidden">▸</span>
        <span className="ml-1 text-gray-400 hidden group-open:inline">▾</span>
      </summary>
      <div className="mt-2 space-y-2">
        {hasBefore && (
          <JsonBlock label="before" tone="red" value={before} />
        )}
        {hasAfter && (
          <JsonBlock label="after" tone="emerald" value={after} />
        )}
      </div>
    </details>
  );
}

function JsonBlock({
  label,
  tone,
  value,
}: {
  label: string;
  tone: "red" | "emerald";
  value: unknown;
}) {
  const cls =
    tone === "red"
      ? "border-red-100 bg-red-50/50 text-red-900"
      : "border-emerald-100 bg-emerald-50/50 text-emerald-900";
  let pretty = "";
  try {
    pretty = JSON.stringify(value, null, 2);
  } catch {
    pretty = String(value);
  }
  return (
    <div className={`rounded-lg border ${cls} p-2`}>
      <div className="text-[10px] uppercase tracking-wider opacity-70 mb-1">
        {label}
      </div>
      <pre className="text-[11px] font-mono whitespace-pre-wrap break-all leading-tight">
        {pretty}
      </pre>
    </div>
  );
}
