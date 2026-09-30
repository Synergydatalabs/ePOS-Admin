// Login access tab — current auth state per membership. tap-app doesn't
// keep a proper time-series login-attempt log yet, so this shows the counter
// and lockout snapshot that IS available. Banner sets expectations.
"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Icon } from "@iconify/react";

interface MemberRow {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  status: string;
  loginAttempts: number;
  lockedUntil: string | null;
  lastPasswordChange: string | null;
  lastActiveAt: string | null;
  isLocked: boolean;
}

interface Props {
  tenantId: string;
}

export default function LoginAccessTab({ tenantId }: Props) {
  const [rows, setRows] = useState<MemberRow[] | null>(null);
  const [note, setNote] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/admin/tenants/${tenantId}/login-attempts`,
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (cancelled) return;
        setRows(data.members || []);
        setNote(data.note || "");
      } catch {
        if (!cancelled) {
          toast.error("Failed to load login access");
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  return (
    <div className="space-y-4">
      {note && (
        <div className="rounded-2xl border border-amber-100 bg-amber-50 p-3 flex gap-2 items-start">
          <Icon
            icon="solar:info-circle-linear"
            className="h-4 w-4 text-amber-700 mt-0.5 shrink-0"
          />
          <div className="text-xs text-amber-900">{note}</div>
        </div>
      )}

      <div className="rounded-2xl border border-gray-100 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Email</th>
              <th className="text-left px-4 py-2 font-medium">Name</th>
              <th className="text-left px-4 py-2 font-medium">Role</th>
              <th className="text-left px-4 py-2 font-medium">Status</th>
              <th className="text-right px-4 py-2 font-medium">Failed attempts</th>
              <th className="text-left px-4 py-2 font-medium">Last active</th>
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
                  No memberships for this tenant.
                </td>
              </tr>
            )}
            {!loading &&
              rows &&
              rows.map((m) => {
                const displayName =
                  [m.firstName, m.lastName].filter(Boolean).join(" ") || "—";
                return (
                  <tr key={m.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-900">{m.email}</td>
                    <td className="px-4 py-2 text-gray-700">{displayName}</td>
                    <td className="px-4 py-2">
                      <RoleChip role={m.role} />
                    </td>
                    <td className="px-4 py-2">
                      <MemberStatusChip
                        isLocked={m.isLocked}
                        lockedUntil={m.lockedUntil}
                        status={m.status}
                      />
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-900">
                      <span
                        className={
                          m.loginAttempts > 0
                            ? "font-semibold text-red-700"
                            : "text-gray-400"
                        }
                      >
                        {m.loginAttempts}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-500 tabular-nums">
                      {m.lastActiveAt
                        ? new Date(m.lastActiveAt).toLocaleString()
                        : "—"}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RoleChip({ role }: { role: string }) {
  return (
    <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700">
      {role}
    </span>
  );
}

function MemberStatusChip({
  isLocked,
  lockedUntil,
  status,
}: {
  isLocked: boolean;
  lockedUntil: string | null;
  status: string;
}) {
  if (isLocked) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700"
        title={
          lockedUntil ? `Locked until ${new Date(lockedUntil).toLocaleString()}` : ""
        }
      >
        <Icon icon="solar:lock-keyhole-linear" className="h-3 w-3" />
        Locked
      </span>
    );
  }
  if (status === "ACTIVE") {
    return (
      <span className="inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
        Active
      </span>
    );
  }
  return (
    <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
      {status}
    </span>
  );
}
