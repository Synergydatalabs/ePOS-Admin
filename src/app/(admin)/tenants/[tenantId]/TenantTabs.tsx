// Client-side tab switcher for the tenant detail page.
// Overview is pre-populated by the server component. Transactions, Login access
// and Terminals are real data views lazy-loaded on click (each tab component
// fetches its own data, cached in local state so re-selecting a tab is instant).
// Locations / Users / Subscription are still Phase-2 tiles.
"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import TransactionsTab from "./TransactionsTab";
import LoginAccessTab from "./LoginAccessTab";
import TerminalsTab from "./TerminalsTab";
import PaymentProvidersTab from "./PaymentProvidersTab";

type TabId =
  | "overview"
  | "transactions"
  | "login"
  | "terminals"
  | "payment-providers"
  | "locations"
  | "users"
  | "subscription";

interface OverviewData {
  slug: string;
  status: string;
  currency: string;
  timezone: string;
  businessType: string;
  createdAt: string;
}

interface Counts {
  locations: number;
  memberships: number;
  terminals: number;
  ordersLast30Days: number;
}

interface Props {
  tenantId: string;
  overview: OverviewData;
}

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "transactions", label: "Transactions" },
  { id: "login", label: "Login access" },
  { id: "terminals", label: "Terminals" },
  // Phase 2d — sits between Terminals and Locations per the phase spec.
  { id: "payment-providers", label: "Payment providers" },
  { id: "locations", label: "Locations" },
  { id: "users", label: "Users" },
  { id: "subscription", label: "Subscription" },
];

// Which tabs still show the old count-tile placeholder (Phase 2).
const COUNT_TABS = new Set<TabId>(["locations", "users", "subscription"]);

export default function TenantTabs({ tenantId, overview }: Props) {
  const [active, setActive] = useState<TabId>("overview");
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loadingCounts, setLoadingCounts] = useState(false);
  // Track which real-data tabs have ever been opened so we can mount them
  // once and cache their state — swapping back to a tab must not re-fetch.
  const [visited, setVisited] = useState<Set<TabId>>(new Set(["overview"]));

  useEffect(() => {
    setVisited((prev) => {
      if (prev.has(active)) return prev;
      const next = new Set(prev);
      next.add(active);
      return next;
    });
  }, [active]);

  useEffect(() => {
    if (!COUNT_TABS.has(active) || counts) return;
    setLoadingCounts(true);
    fetch(`/api/admin/tenants/${tenantId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => setCounts(d.counts))
      .catch(() => toast.error("Failed to load tenant details"))
      .finally(() => setLoadingCounts(false));
  }, [active, tenantId, counts]);

  return (
    <div>
      <nav className="flex flex-wrap gap-1 border-b border-gray-200 mb-6">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              active === t.id
                ? "border-primary text-primary"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {active === "overview" && <OverviewPanel data={overview} />}

      {/* Real-data tabs are mounted the first time they're opened and stay
          mounted so their in-component state (filters, drawer) survives tab
          switches without re-fetching. */}
      {visited.has("transactions") && (
        <div className={active === "transactions" ? "" : "hidden"}>
          <TransactionsTab tenantId={tenantId} />
        </div>
      )}
      {visited.has("login") && (
        <div className={active === "login" ? "" : "hidden"}>
          <LoginAccessTab tenantId={tenantId} />
        </div>
      )}
      {visited.has("terminals") && (
        <div className={active === "terminals" ? "" : "hidden"}>
          <TerminalsTab tenantId={tenantId} />
        </div>
      )}
      {visited.has("payment-providers") && (
        <div className={active === "payment-providers" ? "" : "hidden"}>
          <PaymentProvidersTab tenantId={tenantId} />
        </div>
      )}

      {COUNT_TABS.has(active) && (
        <CountsPanel tab={active} counts={counts} loading={loadingCounts} />
      )}
    </div>
  );
}

function OverviewPanel({ data }: { data: OverviewData }) {
  const rows: [string, string][] = [
    ["Slug", data.slug],
    ["Status", data.status],
    ["Business type", data.businessType],
    ["Currency", data.currency],
    ["Timezone", data.timezone],
    ["Created", new Date(data.createdAt).toLocaleString()],
  ];
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5">
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs uppercase tracking-wider text-gray-500">{k}</dt>
            <dd className="mt-0.5 text-gray-900">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function CountsPanel({
  tab,
  counts,
  loading,
}: {
  tab: TabId;
  counts: Counts | null;
  loading: boolean;
}) {
  if (loading || !counts) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center text-sm text-gray-400">
        Loading&hellip;
      </div>
    );
  }
  const num =
    tab === "locations"
      ? counts.locations
      : tab === "users"
      ? counts.memberships
      : counts.ordersLast30Days;
  const label =
    tab === "locations"
      ? "locations"
      : tab === "users"
      ? "team members"
      : "orders in the last 30 days";
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6">
      <div className="text-4xl font-semibold text-gray-900 tabular-nums">{num}</div>
      <div className="mt-1 text-sm text-gray-500">{label}</div>
      <p className="mt-4 text-xs text-gray-400">
        Full listing UI ships in Phase 2. For now this tile confirms the tenant
        has data attached.
      </p>
    </div>
  );
}
