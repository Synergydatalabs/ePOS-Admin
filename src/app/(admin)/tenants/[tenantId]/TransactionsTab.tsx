// Transactions tab — most recent payments for the tenant with filter chips
// and a slide-over drawer that dumps the raw provider metadata so support can
// eyeball auth codes / decline reasons without opening the DB.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Icon } from "@iconify/react";

interface PaymentRow {
  id: string;
  amount: number;
  currency: string;
  method: string | null;
  provider: string;
  providerRef: string | null;
  providerStatus: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
  failureReason: string | null;
  completedAt: string | null;
  createdAt: string;
  order: {
    id: string;
    orderNumber: string;
    orderType: string;
  };
}

interface Props {
  tenantId: string;
}

const STATUS_FILTERS = ["COMPLETED", "FAILED", "CANCELLED", "REFUNDED"] as const;
const METHOD_FILTERS: { value: string; label: string }[] = [
  { value: "card", label: "Card" },
  { value: "cash", label: "Cash" },
  { value: "gift", label: "Gift" },
  { value: "interac", label: "Interac" },
];

export default function TransactionsTab({ tenantId }: Props) {
  const [rows, setRows] = useState<PaymentRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [method, setMethod] = useState<string>("");
  const [selected, setSelected] = useState<PaymentRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = new URL(
        `/api/admin/tenants/${tenantId}/payments`,
        window.location.origin
      );
      if (status) url.searchParams.set("status", status);
      if (method) url.searchParams.set("method", method);
      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setRows(data.payments || []);
    } catch {
      toast.error("Failed to load transactions");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId, status, method]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <FilterGroup
          label="Status"
          value={status}
          onChange={setStatus}
          options={STATUS_FILTERS.map((s) => ({ value: s, label: s }))}
        />
        <FilterGroup
          label="Method"
          value={method}
          onChange={setMethod}
          options={METHOD_FILTERS}
        />
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Date</th>
              <th className="text-left px-4 py-2 font-medium">Order #</th>
              <th className="text-left px-4 py-2 font-medium">Type</th>
              <th className="text-left px-4 py-2 font-medium">Method</th>
              <th className="text-right px-4 py-2 font-medium">Amount</th>
              <th className="text-left px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr>
                <td colSpan={6} className="text-center text-gray-400 py-8">
                  Loading&hellip;
                </td>
              </tr>
            )}
            {!loading && rows && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-gray-400 py-8">
                  No transactions match this filter.
                </td>
              </tr>
            )}
            {!loading &&
              rows &&
              rows.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => setSelected(p)}
                  className="hover:bg-gray-50 cursor-pointer"
                >
                  <td className="px-4 py-2 tabular-nums text-gray-600">
                    {new Date(p.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-700">
                    {p.order.orderNumber}
                  </td>
                  <td className="px-4 py-2 text-gray-600">
                    {formatOrderType(p.order.orderType)}
                  </td>
                  <td className="px-4 py-2 text-gray-700">
                    {p.method || p.provider || "—"}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-900 font-medium">
                    {formatMoney(p.amount, p.currency)}
                  </td>
                  <td className="px-4 py-2">
                    <StatusChip status={p.status} />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <PaymentDrawer payment={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function FilterGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs uppercase tracking-wider text-gray-500 mr-1">
        {label}
      </span>
      <button
        type="button"
        onClick={() => onChange("")}
        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
          value === ""
            ? "bg-primary text-white"
            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
        }`}
      >
        All
      </button>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            value === o.value
              ? "bg-primary text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    COMPLETED: "bg-emerald-50 text-emerald-700",
    PENDING: "bg-amber-50 text-amber-700",
    PROCESSING: "bg-amber-50 text-amber-700",
    FAILED: "bg-red-50 text-red-700",
    CANCELLED: "bg-gray-100 text-gray-500",
    REFUNDED: "bg-purple-50 text-purple-700",
    PARTIALLY_REFUNDED: "bg-purple-50 text-purple-700",
  };
  const cls = map[status] || "bg-gray-100 text-gray-600";
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {status}
    </span>
  );
}

function PaymentDrawer({
  payment,
  onClose,
}: {
  payment: PaymentRow;
  onClose: () => void;
}) {
  // Pull the well-known metadata fields we care about into a summary — the
  // rest goes into the raw JSON block at the bottom.
  const meta = payment.metadata || {};
  const summary = useMemo(
    () => extractPaymentSummary(payment, meta),
    [payment, meta]
  );

  return (
    <div
      className="fixed inset-0 z-40 bg-black/40 flex justify-end"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg h-full bg-white shadow-lg overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <div className="text-sm font-semibold text-gray-900">
              {payment.order.orderNumber}
            </div>
            <div className="text-xs text-gray-500">
              {formatMoney(payment.amount, payment.currency)} ·{" "}
              {payment.method || payment.provider}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close"
          >
            <Icon icon="solar:close-circle-linear" className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <section className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
            <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">
              Summary
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {summary.map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-xs text-gray-500">{k}</dt>
                  <dd className="text-gray-900 truncate" title={String(v)}>
                    {v || "—"}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {payment.failureReason && (
            <section className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-800">
              <div className="text-xs uppercase tracking-wider text-red-700 mb-1">
                Failure reason
              </div>
              <div className="whitespace-pre-wrap break-words">
                {payment.failureReason}
              </div>
            </section>
          )}

          <section>
            <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">
              Raw metadata
            </div>
            <pre className="rounded-2xl border border-gray-100 bg-gray-900 text-emerald-200 text-xs p-4 overflow-x-auto whitespace-pre-wrap break-all">
{JSON.stringify(payment.metadata ?? {}, null, 2)}
            </pre>
          </section>
        </div>
      </div>
    </div>
  );
}

function extractPaymentSummary(
  payment: PaymentRow,
  meta: Record<string, unknown>
): [string, string][] {
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = meta[k];
      if (v != null && v !== "") return String(v);
    }
    return "";
  };
  return [
    ["Provider", payment.provider || ""],
    ["Provider ref", payment.providerRef || ""],
    ["Provider status", payment.providerStatus || ""],
    ["Auth code", pick("authCode", "auth_code")],
    ["Card brand", pick("cardBrand", "card_brand", "cardType", "card_type")],
    ["Card last 4", pick("cardLast4", "card_last4", "maskedPan", "last4")],
    ["GP txn id", pick("gpTransactionId", "gp_transaction_id", "transactionId")],
    ["DVC id", pick("dvcId", "gpBillId", "gp_bill_id")],
    ["Entry mode", pick("entryMode", "entry_mode")],
    ["Error code", pick("errorCode", "error_code")],
    ["Decline reason", pick("declineReason", "decline_reason")],
    ["Completed at", payment.completedAt ? new Date(payment.completedAt).toLocaleString() : ""],
    ["Created at", new Date(payment.createdAt).toLocaleString()],
  ];
}

function formatMoney(cents: number, currency: string): string {
  const value = (cents || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "CAD",
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function formatOrderType(t: string): string {
  // Human-readable — Prisma enum values are SHOUT_CASE.
  return t
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
