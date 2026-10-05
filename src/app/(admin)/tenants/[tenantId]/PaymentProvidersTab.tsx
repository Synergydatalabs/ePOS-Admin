// Payment providers tab — per-tenant view of every TenantPaymentProvider
// row grouped by capability (CARD / INTERAC / GIFT_CARD / ACH). ACTIVE at
// the top, INACTIVE / SUSPENDED below. Read is open to anyone with admin
// access; the Switch/Deactivate/Reveal actions are gated to
// SUPER_ADMIN + COMPLIANCE (server enforces; the UI hides / disables).
//
// A "Switch provider" button per capability opens a modal identical to
// the one on the application detail page — the operator pastes MID +
// credentials for the new processor and the server flips the previous
// active row to SUSPENDED as a side-effect (partial unique index).
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const CAPABILITIES = ["CARD", "INTERAC", "GIFT_CARD", "ACH", "ECOMMERCE"] as const;
type Capability = (typeof CAPABILITIES)[number];
type Processor = "GP" | "MONERIS" | "STRIPE";
type Status = "ACTIVE" | "PENDING" | "SUSPENDED";

interface ProviderRow {
  id: string;
  processor: Processor;
  capability: Capability;
  status: Status;
  externalMidMasked: string;
  applicationId: string | null;
  applicationLegalName: string | null;
  assignedByAdminEmail: string | null;
  assignedAt: string | null;
  activatedAt: string | null;
  suspendedAt: string | null;
  updatedAt: string;
  hasFeeSchedule: boolean;
}

interface Session {
  user?: { role?: string; email?: string };
}

const WRITE_ROLES = new Set(["SUPER_ADMIN", "COMPLIANCE"]);

export default function PaymentProvidersTab({ tenantId }: { tenantId: string }) {
  const [rows, setRows] = useState<ProviderRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string>("");
  const [modal, setModal] = useState<
    | { kind: "switch"; capability: Capability }
    | { kind: "reveal"; providerId: string }
    | null
  >(null);
  const [revealed, setRevealed] = useState<Record<string, RevealedProvider>>({});
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, sRes] = await Promise.all([
        fetch(`/api/admin/tenants/${tenantId}/payment-providers`, { cache: "no-store" }),
        fetch(`/api/admin/auth/session`, { cache: "no-store" }),
      ]);
      if (!pRes.ok) throw new Error(String(pRes.status));
      const pData = await pRes.json();
      const sData: Session = sRes.ok ? await sRes.json() : { user: { role: "" } };
      setRows(pData.providers || []);
      setRole(sData.user?.role || "");
    } catch {
      toast.error("Failed to load payment providers");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const canWrite = WRITE_ROLES.has(role);

  const grouped = useMemo(() => {
    // Seed one bucket per declared capability so grouped[cap] is never
    // undefined. Keeping this derived from CAPABILITIES means adding a
    // new capability later only needs the one-line addition at the top.
    const out = CAPABILITIES.reduce((acc, cap) => {
      acc[cap] = [];
      return acc;
    }, {} as Record<Capability, ProviderRow[]>);
    (rows || []).forEach((r) => {
      // Prisma-generated capability may include future values (schema-level
      // enum). Guard against unknown values so the UI doesn't crash.
      if ((CAPABILITIES as readonly string[]).includes(r.capability)) {
        out[r.capability].push(r);
      }
    });
    // Within each group, ACTIVE first, then most recently updated.
    (Object.keys(out) as Capability[]).forEach((k) => {
      out[k].sort((a, b) => {
        if (a.status === "ACTIVE" && b.status !== "ACTIVE") return -1;
        if (a.status !== "ACTIVE" && b.status === "ACTIVE") return 1;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
    });
    return out;
  }, [rows]);

  const doDeactivate = useCallback(
    async (row: ProviderRow) => {
      if (!canWrite) return;
      const reason = window.prompt(
        `Suspend ${row.processor} for ${row.capability}? Reason (shown in audit trail):`,
        "Deactivated by admin"
      );
      if (reason === null) return;
      setPendingAction(row.id);
      try {
        const res = await fetch(
          `/api/admin/tenants/${tenantId}/payment-providers/${row.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "SUSPENDED", suspensionReason: reason }),
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || String(res.status));
        toast.success(`${row.processor} suspended`);
        await load();
      } catch (e) {
        toast.error((e as Error).message || "Failed to suspend provider");
      } finally {
        setPendingAction(null);
      }
    },
    [canWrite, load, tenantId]
  );

  const doReactivate = useCallback(
    async (row: ProviderRow) => {
      if (!canWrite) return;
      setPendingAction(row.id);
      try {
        const res = await fetch(
          `/api/admin/tenants/${tenantId}/payment-providers/${row.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "ACTIVE" }),
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || String(res.status));
        toast.success(`${row.processor} reactivated`);
        await load();
      } catch (e) {
        toast.error((e as Error).message || "Failed to reactivate");
      } finally {
        setPendingAction(null);
      }
    },
    [canWrite, load, tenantId]
  );

  const doReveal = useCallback(
    async (row: ProviderRow) => {
      if (!canWrite) {
        toast.error("SUPER_ADMIN or COMPLIANCE only");
        return;
      }
      setPendingAction(row.id);
      try {
        const res = await fetch(
          `/api/admin/tenants/${tenantId}/payment-providers/${row.id}/reveal`,
          { method: "POST" }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || String(res.status));
        setRevealed((prev) => ({
          ...prev,
          [row.id]: {
            externalMid: data.externalMid,
            credentials: data.credentials,
          },
        }));
      } catch (e) {
        toast.error((e as Error).message || "Reveal failed");
      } finally {
        setPendingAction(null);
      }
    },
    [canWrite, tenantId]
  );

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-24 bg-gray-100 rounded-2xl" />
        <div className="h-24 bg-gray-100 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {CAPABILITIES.map((cap) => {
        const list = grouped[cap];
        const active = list.find((r) => r.status === "ACTIVE") || null;
        return (
          <div key={cap} className="rounded-2xl border border-gray-100 bg-white">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <div>
                <p className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
                  Capability
                </p>
                <h3 className="text-base font-semibold text-gray-900">
                  {cap.replace("_", " ")}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {active
                    ? `Active: ${active.processor} · MID ${active.externalMidMasked}`
                    : "No active provider"}
                </p>
              </div>
              <button
                type="button"
                disabled={!canWrite}
                onClick={() => setModal({ kind: "switch", capability: cap })}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full ${
                  canWrite
                    ? "bg-slate-900 text-white hover:opacity-90"
                    : "bg-gray-100 text-gray-400 cursor-not-allowed"
                }`}
                title={canWrite ? "Assign a new provider (suspends the previous active row)" : "SUPER_ADMIN / COMPLIANCE only"}
              >
                {active ? "Switch provider" : "Assign provider"}
              </button>
            </div>
            <div className="p-4">
              {list.length === 0 ? (
                <p className="text-sm text-gray-500 py-4 px-2">
                  No provider has ever been assigned for {cap.replace("_", " ")}.
                </p>
              ) : (
                <ul className="space-y-2">
                  {list.map((row) => {
                    const isRevealed = revealed[row.id];
                    return (
                      <li
                        key={row.id}
                        className={`rounded-xl border p-3 ${
                          row.status === "ACTIVE"
                            ? "border-emerald-200 bg-emerald-50/40"
                            : "border-gray-200 bg-white"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-gray-900">
                                {row.processor}
                              </span>
                              <StatusChip status={row.status} />
                              {row.hasFeeSchedule && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800 font-semibold uppercase tracking-wider">
                                  Fee schedule
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-600 mt-1">
                              MID:{" "}
                              <span className="font-mono">
                                {isRevealed ? isRevealed.externalMid : row.externalMidMasked}
                              </span>
                              {isRevealed && (
                                <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-800 font-semibold">
                                  REVEALED
                                </span>
                              )}
                            </p>
                            <p className="text-[11px] text-gray-500 mt-0.5">
                              Assigned{" "}
                              {row.assignedAt
                                ? new Date(row.assignedAt).toLocaleString()
                                : "—"}
                              {row.assignedByAdminEmail && ` · ${row.assignedByAdminEmail}`}
                              {row.applicationLegalName &&
                                ` · from application "${row.applicationLegalName}"`}
                            </p>
                            {isRevealed?.credentials != null ? (
                              <pre className="mt-2 rounded-lg bg-gray-900 text-emerald-100 text-[11px] font-mono p-3 overflow-x-auto">
                                {JSON.stringify(isRevealed.credentials, null, 2)}
                              </pre>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              disabled={pendingAction === row.id}
                              onClick={() => doReveal(row)}
                              title="Reveal — audited"
                              className={`text-[11px] font-semibold px-2 py-1 rounded-full ${
                                canWrite
                                  ? "bg-amber-100 text-amber-900 hover:bg-amber-200"
                                  : "bg-gray-100 text-gray-400 cursor-not-allowed"
                              }`}
                            >
                              {pendingAction === row.id ? "…" : "Reveal"}
                            </button>
                            {row.status === "ACTIVE" ? (
                              <button
                                type="button"
                                disabled={!canWrite || pendingAction === row.id}
                                onClick={() => doDeactivate(row)}
                                className={`text-[11px] font-semibold px-2 py-1 rounded-full ${
                                  canWrite
                                    ? "bg-red-100 text-red-800 hover:bg-red-200"
                                    : "bg-gray-100 text-gray-400 cursor-not-allowed"
                                }`}
                              >
                                Deactivate
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={!canWrite || pendingAction === row.id}
                                onClick={() => doReactivate(row)}
                                className={`text-[11px] font-semibold px-2 py-1 rounded-full ${
                                  canWrite
                                    ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                                    : "bg-gray-100 text-gray-400 cursor-not-allowed"
                                }`}
                              >
                                Reactivate
                              </button>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        );
      })}

      {modal?.kind === "switch" && (
        <AssignProviderModal
          tenantId={tenantId}
          capability={modal.capability}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

interface RevealedProvider {
  externalMid: string;
  credentials: unknown;
}

function StatusChip({ status }: { status: Status }) {
  const map: Record<Status, string> = {
    ACTIVE: "bg-emerald-100 text-emerald-800",
    PENDING: "bg-amber-100 text-amber-900",
    SUSPENDED: "bg-gray-200 text-gray-700",
  };
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${map[status]}`}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Assign / switch provider modal — same shape as mark-provider-approved on
// the application detail page. Kept local to this file so the tab is
// entirely self-contained; if we later share this modal across
// application detail + tenant tab, hoist it into a common component.
// ---------------------------------------------------------------------------
function AssignProviderModal({
  tenantId,
  capability,
  onClose,
  onSaved,
}: {
  tenantId: string;
  capability: Capability;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [processor, setProcessor] = useState<Processor>("GP");
  const [providerReferenceId, setProviderReferenceId] = useState("");
  const [appId, setAppId] = useState("");
  const [appKey, setAppKey] = useState("");
  const [accountName, setAccountName] = useState("");
  const [storeId, setStoreId] = useState("");
  const [apiToken, setApiToken] = useState("");
  // Moneris Go Cloud extras — terminal_id (Device ID from Moneris Go
  // portal), ist_config_code (some Moneris accounts require this, ask
  // rep if in doubt — safe empty for now), environment picks sandbox vs
  // prod base URL at request time.
  const [terminalId, setTerminalId] = useState("");
  const [istConfigCode, setIstConfigCode] = useState("");
  const [environment, setEnvironment] = useState<"test" | "prod">("test");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      const credentials =
        processor === "GP"
          ? { app_id: appId, app_key: appKey, account_name: accountName || undefined }
          : {
              store_id: storeId,
              api_token: apiToken,
              terminal_id: terminalId,
              ist_config_code: istConfigCode || undefined,
              environment,
            };
      const res = await fetch(`/api/admin/tenants/${tenantId}/payment-providers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          processor,
          capability,
          providerReferenceId,
          credentials,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || String(res.status));
      toast.success(`${processor} activated for ${capability}`);
      await onSaved();
    } catch (e) {
      toast.error((e as Error).message || "Save failed");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl">
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">
            Assign provider — {capability.replace("_", " ")}
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            Any currently-active row for this capability will be moved to SUSPENDED.
          </p>
        </div>
        <div className="p-5 space-y-3">
          <FormRow label="Processor">
            <select
              value={processor}
              onChange={(e) => setProcessor(e.target.value as Processor)}
              className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
            >
              <option value="GP">Global Payments</option>
              <option value="MONERIS">Moneris</option>
            </select>
          </FormRow>
          <FormRow label="Provider reference (MID / store id)">
            <input
              type="text"
              value={providerReferenceId}
              onChange={(e) => setProviderReferenceId(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm font-mono"
              placeholder="e.g. 12345678"
            />
          </FormRow>
          {processor === "GP" ? (
            <>
              <FormRow label="app_id">
                <input
                  type="text"
                  value={appId}
                  onChange={(e) => setAppId(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm font-mono"
                />
              </FormRow>
              <FormRow label="app_key">
                <input
                  type="password"
                  value={appKey}
                  onChange={(e) => setAppKey(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm font-mono"
                />
              </FormRow>
              <FormRow label="account_name (optional)">
                <input
                  type="text"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm font-mono"
                />
              </FormRow>
            </>
          ) : (
            <>
              <FormRow label="store_id">
                <input
                  type="text"
                  value={storeId}
                  onChange={(e) => setStoreId(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm font-mono"
                  placeholder="e.g. mogo006531"
                />
              </FormRow>
              <FormRow label="api_token">
                <input
                  type="password"
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm font-mono"
                />
              </FormRow>
              <FormRow label="terminal_id (Device ID)">
                <input
                  type="text"
                  value={terminalId}
                  onChange={(e) => setTerminalId(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm font-mono"
                  placeholder="e.g. A7005622"
                />
              </FormRow>
              <FormRow label="ist_config_code (optional — leave blank if unknown)">
                <input
                  type="text"
                  value={istConfigCode}
                  onChange={(e) => setIstConfigCode(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm font-mono"
                  placeholder="Ask Moneris rep if required"
                />
              </FormRow>
              <FormRow label="environment">
                <select
                  value={environment}
                  onChange={(e) => setEnvironment(e.target.value as "test" | "prod")}
                  className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
                >
                  <option value="test">Sandbox (ippostest.moneris.com)</option>
                  <option value="prod">Production (ippos.moneris.com)</option>
                </select>
              </FormRow>
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
            disabled={
              submitting ||
              !providerReferenceId ||
              (processor === "MONERIS" && (!storeId || !apiToken || !terminalId))
            }
            className="text-sm font-semibold px-3 py-1.5 rounded-lg bg-primary text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Activate"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-1">
        {label}
      </p>
      {children}
    </div>
  );
}
