// Terminals tab — list + per-row Ping button (SUPER_ADMIN / COMPLIANCE only).
// The role check happens both on the server (route.ts) and here in the UI so
// the button is disabled for SUPPORT rather than clickable-then-403.
"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Icon } from "@iconify/react";

interface TerminalRow {
  id: string;
  name: string;
  provider: string;
  uciLane: string | null;
  uciEnvironment: string | null;
  uciMerchantId: string | null;
  status: string;
  isDefault: boolean;
  locationId: string;
  createdAt: string;
  lastPingAt: string | null;
  location: { id: string; name: string } | null;
}

interface Props {
  tenantId: string;
}

interface PingState {
  status: "idle" | "pinging" | "ok" | "err";
  latencyMs?: number;
  error?: string;
}

const PING_ROLES = new Set(["SUPER_ADMIN", "COMPLIANCE"]);

export default function TerminalsTab({ tenantId }: Props) {
  const [rows, setRows] = useState<TerminalRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string>("");
  const [pingState, setPingState] = useState<Record<string, PingState>>({});

  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      setLoading(true);
      try {
        const [tRes, sRes] = await Promise.all([
          fetch(`/api/admin/tenants/${tenantId}/terminals`, { cache: "no-store" }),
          fetch(`/api/admin/auth/session`, { cache: "no-store" }),
        ]);
        if (!tRes.ok) throw new Error(String(tRes.status));
        const tData = await tRes.json();
        const sData = sRes.ok ? await sRes.json() : { user: { role: "" } };
        if (cancelled) return;
        setRows(tData.terminals || []);
        setRole(sData.user?.role || "");
      } catch {
        if (!cancelled) {
          toast.error("Failed to load terminals");
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadAll();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const canPing = PING_ROLES.has(role);

  const doPing = useCallback(
    async (terminal: TerminalRow) => {
      setPingState((s) => ({ ...s, [terminal.id]: { status: "pinging" } }));
      try {
        const res = await fetch(
          `/api/admin/tenants/${tenantId}/terminals/${terminal.id}/ping`,
          { method: "POST" }
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.success === false) {
          const msg = body.error || `Ping failed (${res.status})`;
          setPingState((s) => ({
            ...s,
            [terminal.id]: { status: "err", error: msg, latencyMs: body.latencyMs },
          }));
          toast.error(`${terminal.name}: ${msg}`);
          return;
        }
        setPingState((s) => ({
          ...s,
          [terminal.id]: { status: "ok", latencyMs: body.latencyMs },
        }));
        toast.success(`${terminal.name}: ${body.latencyMs}ms`);
      } catch (e: unknown) {
        const msg = (e as Error).message || "Network error";
        setPingState((s) => ({
          ...s,
          [terminal.id]: { status: "err", error: msg },
        }));
        toast.error(`${terminal.name}: ${msg}`);
      }
    },
    [tenantId]
  );

  return (
    <div className="rounded-2xl border border-gray-100 bg-white overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
          <tr>
            <th className="text-left px-4 py-2 font-medium">Name</th>
            <th className="text-left px-4 py-2 font-medium">Provider</th>
            <th className="text-left px-4 py-2 font-medium">Lane</th>
            <th className="text-left px-4 py-2 font-medium">Env</th>
            <th className="text-left px-4 py-2 font-medium">Status</th>
            <th className="text-left px-4 py-2 font-medium">Location</th>
            <th className="text-right px-4 py-2 font-medium">Ping</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {loading && (
            <tr>
              <td colSpan={7} className="text-center text-gray-400 py-8">
                Loading&hellip;
              </td>
            </tr>
          )}
          {!loading && rows && rows.length === 0 && (
            <tr>
              <td colSpan={7} className="text-center text-gray-400 py-8">
                No terminals configured for this tenant.
              </td>
            </tr>
          )}
          {!loading &&
            rows &&
            rows.map((t) => {
              const st = pingState[t.id] || { status: "idle" as const };
              const canPingRow = canPing && t.provider === "UCI" && !!t.uciLane;
              return (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-900">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{t.name}</span>
                      {t.isDefault && (
                        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
                          Default
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-gray-600">{t.provider}</td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-700">
                    {t.uciLane || "—"}
                  </td>
                  <td className="px-4 py-2 text-gray-600">
                    {t.uciEnvironment || "—"}
                  </td>
                  <td className="px-4 py-2">
                    <TerminalStatusChip status={t.status} />
                  </td>
                  <td className="px-4 py-2 text-gray-600">
                    {t.location?.name || "—"}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-2">
                      <PingResult state={st} />
                      <button
                        type="button"
                        disabled={!canPingRow || st.status === "pinging"}
                        onClick={() => doPing(t)}
                        title={
                          !canPing
                            ? "Restricted to super-admin / compliance"
                            : t.provider !== "UCI"
                            ? "Ping is only supported for UCI terminals"
                            : !t.uciLane
                            ? "Terminal has no UCI lane configured"
                            : "Ping terminal"
                        }
                        aria-label="Ping terminal"
                        className={`rounded-lg p-2 transition-colors ${
                          !canPingRow
                            ? "text-gray-300 cursor-not-allowed"
                            : "text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                        }`}
                      >
                        <Icon
                          icon={
                            st.status === "pinging"
                              ? "solar:refresh-linear"
                              : "solar:wi-fi-router-linear"
                          }
                          className={`h-4 w-4 ${
                            st.status === "pinging" ? "animate-spin" : ""
                          }`}
                        />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}

function PingResult({ state }: { state: PingState }) {
  if (state.status === "ok") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700"
        title="Reachable"
      >
        <Icon icon="solar:check-circle-linear" className="h-4 w-4" />
        {state.latencyMs != null ? `${state.latencyMs}ms` : "OK"}
      </span>
    );
  }
  if (state.status === "err") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] font-medium text-red-700 max-w-[160px] truncate"
        title={state.error || "Failed"}
      >
        <Icon icon="solar:close-circle-linear" className="h-4 w-4" />
        Failed
      </span>
    );
  }
  return null;
}

function TerminalStatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    ONLINE: "bg-emerald-50 text-emerald-700",
    OFFLINE: "bg-gray-100 text-gray-500",
    BUSY: "bg-amber-50 text-amber-700",
    ERROR: "bg-red-50 text-red-700",
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
