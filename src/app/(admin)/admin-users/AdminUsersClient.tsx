// Interactive admin-user list + invite/edit/reset flows. All routes it hits
// are SUPER_ADMIN-gated server-side, so the client can be optimistic — the
// worst case on tampering is a 403 that surfaces as a toast.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Icon } from "@iconify/react";

interface AdminUserRow {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const ROLES = ["SUPER_ADMIN", "COMPLIANCE", "SUPPORT", "SALES", "FINANCE"] as const;

interface Props {
  selfId: string;
}

export default function AdminUsersClient({ selfId }: Props) {
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUserRow | null>(null);
  const [resetting, setResetting] = useState<AdminUserRow | null>(null);
  // Persistent banner surface — either an invite temp-password or a reset temp-password.
  const [banner, setBanner] = useState<{
    kind: "invite" | "reset";
    email: string;
    tempPassword: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/admin-users", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setRows(data.users || []);
    } catch {
      toast.error("Failed to load admin users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="p-8 max-w-6xl">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Admin users</h1>
          <p className="mt-1 text-sm text-gray-500">
            SUPER_ADMIN can invite operators, reset their passwords, or deactivate them.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primaryDark"
        >
          <Icon icon="solar:user-plus-linear" className="h-4 w-4" />
          Invite admin
        </button>
      </header>

      {banner && (
        <TempPasswordBanner
          banner={banner}
          onDismiss={() => setBanner(null)}
        />
      )}

      <div className="rounded-2xl border border-gray-100 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Name</th>
              <th className="text-left px-4 py-2 font-medium">Email</th>
              <th className="text-left px-4 py-2 font-medium">Role</th>
              <th className="text-left px-4 py-2 font-medium">Status</th>
              <th className="text-left px-4 py-2 font-medium">Last login</th>
              <th className="text-left px-4 py-2 font-medium">Created</th>
              <th className="text-right px-4 py-2 font-medium">Actions</th>
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
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-gray-400 py-8">
                  No admin users yet.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((u) => {
                const isSelf = u.id === selfId;
                const displayName =
                  [u.firstName, u.lastName].filter(Boolean).join(" ") || "—";
                return (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-gray-900">
                      {displayName}
                      {isSelf && (
                        <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
                          You
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-700">{u.email}</td>
                    <td className="px-4 py-2">
                      <RoleChip role={u.role} />
                    </td>
                    <td className="px-4 py-2">
                      <StatusChip active={u.isActive} />
                    </td>
                    <td className="px-4 py-2 text-gray-500 tabular-nums">
                      {u.lastLoginAt
                        ? new Date(u.lastLoginAt).toLocaleString()
                        : "—"}
                    </td>
                    <td className="px-4 py-2 text-gray-500 tabular-nums">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/audit-log?adminId=${u.id}`}
                          title="View this admin's action history"
                          aria-label="View audit"
                          className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors"
                        >
                          <Icon icon="solar:clipboard-list-linear" className="h-4 w-4" />
                        </Link>
                        <IconAction
                          icon="solar:pen-linear"
                          label="Edit"
                          disabled={isSelf}
                          disabledLabel="You can't edit yourself here — use Change password."
                          onClick={() => setEditing(u)}
                        />
                        <IconAction
                          icon="solar:key-linear"
                          label="Reset password"
                          disabled={isSelf}
                          disabledLabel="Use Change password to update your own credential."
                          onClick={() => setResetting(u)}
                        />
                        <IconAction
                          icon={
                            u.isActive
                              ? "solar:user-block-linear"
                              : "solar:user-check-linear"
                          }
                          label={u.isActive ? "Deactivate" : "Reactivate"}
                          disabled={isSelf}
                          disabledLabel="You can't deactivate yourself."
                          onClick={async () => {
                            const verb = u.isActive ? "deactivate" : "reactivate";
                            if (!confirm(`Really ${verb} ${u.email}?`)) return;
                            try {
                              const res = await fetch(
                                `/api/admin/admin-users/${u.id}`,
                                {
                                  method: "PATCH",
                                  headers: { "content-type": "application/json" },
                                  body: JSON.stringify({ isActive: !u.isActive }),
                                }
                              );
                              if (!res.ok) {
                                const b = await res.json().catch(() => ({}));
                                throw new Error(b.error || "Failed");
                              }
                              toast.success(
                                u.isActive ? "Deactivated" : "Reactivated"
                              );
                              void load();
                            } catch (e: unknown) {
                              toast.error(
                                (e as Error).message || "Update failed"
                              );
                            }
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {inviteOpen && (
        <InviteModal
          onClose={() => setInviteOpen(false)}
          onSuccess={(result) => {
            setInviteOpen(false);
            setBanner({
              kind: "invite",
              email: result.user.email,
              tempPassword: result.tempPassword,
            });
            void load();
          }}
        />
      )}

      {editing && (
        <EditModal
          user={editing}
          isSelf={editing.id === selfId}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}

      {resetting && (
        <ResetConfirm
          user={resetting}
          onCancel={() => setResetting(null)}
          onDone={(tempPassword) => {
            setBanner({
              kind: "reset",
              email: resetting.email,
              tempPassword,
            });
            setResetting(null);
          }}
        />
      )}
    </main>
  );
}

function RoleChip({ role }: { role: string }) {
  const map: Record<string, string> = {
    SUPER_ADMIN: "bg-indigo-50 text-indigo-700",
    COMPLIANCE: "bg-emerald-50 text-emerald-700",
    SUPPORT: "bg-sky-50 text-sky-700",
    SALES: "bg-amber-50 text-amber-700",
    FINANCE: "bg-purple-50 text-purple-700",
  };
  const cls = map[role] || "bg-gray-100 text-gray-600";
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {role}
    </span>
  );
}

function StatusChip({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
      Active
    </span>
  ) : (
    <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
      Inactive
    </span>
  );
}

function IconAction({
  icon,
  label,
  onClick,
  disabled,
  disabledLabel,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  disabledLabel?: string;
}) {
  return (
    <button
      type="button"
      title={disabled ? disabledLabel || label : label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg p-2 transition-colors ${
        disabled
          ? "text-gray-300 cursor-not-allowed"
          : "text-gray-500 hover:bg-gray-100 hover:text-gray-800"
      }`}
    >
      <Icon icon={icon} className="h-4 w-4" />
    </button>
  );
}

// -------------------------------------------------------------- Invite modal

function InviteModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: (result: { user: AdminUserRow; tempPassword: string }) => void;
}) {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState<string>("SUPPORT");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/admin-users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, firstName, lastName, role }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to invite");
      toast.success("Admin invited");
      onSuccess(body);
    } catch (e: unknown) {
      toast.error((e as Error).message || "Failed to invite");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title="Invite admin" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Email">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name">
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Last name">
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="input"
            />
          </Field>
        </div>
        <Field label="Role">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="input"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        <div className="pt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primaryDark disabled:opacity-50"
          >
            {submitting ? "Inviting…" : "Send invite"}
          </button>
        </div>
      </form>
      <style jsx>{`
        .input {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid #e5e7eb;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
        }
        .input:focus {
          border-color: #4f46e5;
          outline: none;
          box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.2);
        }
      `}</style>
    </ModalShell>
  );
}

// -------------------------------------------------------------- Edit modal

function EditModal({
  user,
  isSelf,
  onClose,
  onSaved,
}: {
  user: AdminUserRow;
  isSelf: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [firstName, setFirstName] = useState(user.firstName || "");
  const [lastName, setLastName] = useState(user.lastName || "");
  const [role, setRole] = useState<string>(user.role);
  const [isActive, setIsActive] = useState<boolean>(user.isActive);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/admin-users/${user.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ firstName, lastName, role, isActive }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to save");
      toast.success("Saved");
      onSaved();
    } catch (e: unknown) {
      toast.error((e as Error).message || "Failed to save");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title={`Edit ${user.email}`} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name">
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Last name">
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="input"
            />
          </Field>
        </div>
        <Field label="Role">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="input"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          {isSelf && role !== "SUPER_ADMIN" && (
            <p className="mt-1 text-xs text-amber-600">
              You can&apos;t demote yourself from SUPER_ADMIN — the server will
              reject this change.
            </p>
          )}
        </Field>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            disabled={isSelf}
          />
          Active
          {isSelf && (
            <span className="text-xs text-gray-400">(can&apos;t deactivate yourself)</span>
          )}
        </label>
        <div className="pt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primaryDark disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
      <style jsx>{`
        .input {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid #e5e7eb;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
        }
        .input:focus {
          border-color: #4f46e5;
          outline: none;
          box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.2);
        }
      `}</style>
    </ModalShell>
  );
}

// -------------------------------------------------------------- Reset confirm

function ResetConfirm({
  user,
  onCancel,
  onDone,
}: {
  user: AdminUserRow;
  onCancel: () => void;
  onDone: (tempPassword: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  async function doReset() {
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/admin/admin-users/${user.id}?action=reset-password`,
        { method: "POST" }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Reset failed");
      onDone(body.tempPassword);
    } catch (e: unknown) {
      toast.error((e as Error).message || "Reset failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title="Reset password" onClose={onCancel}>
      <p className="text-sm text-gray-600">
        This will invalidate the current password for{" "}
        <span className="font-medium text-gray-900">{user.email}</span> and mint
        a new temp password. Hand it off out-of-band.
      </p>
      <div className="pt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={doReset}
          disabled={submitting}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primaryDark disabled:opacity-50"
        >
          {submitting ? "Resetting…" : "Reset password"}
        </button>
      </div>
    </ModalShell>
  );
}

// -------------------------------------------------------------- Banner

function TempPasswordBanner({
  banner,
  onDismiss,
}: {
  banner: { kind: "invite" | "reset"; email: string; tempPassword: string };
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const heading =
    banner.kind === "invite"
      ? "Admin invited — share this temp password"
      : "Password reset — share this temp password";

  async function copy() {
    try {
      await navigator.clipboard.writeText(banner.tempPassword);
      setCopied(true);
      toast.success("Copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copy failed — select and copy manually.");
    }
  }

  return (
    <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <Icon icon="solar:check-circle-linear" className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-emerald-900">
            {heading}
          </div>
          <div className="mt-0.5 text-xs text-emerald-800">
            For {banner.email}. This is the only time it will be shown — copy it
            now and hand it off over Slack or similar.
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="flex-1 min-w-[220px] rounded-lg border border-emerald-200 bg-white px-3 py-2 font-mono text-sm text-gray-900">
              {banner.tempPassword}
            </code>
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
            >
              <Icon
                icon={copied ? "solar:check-linear" : "solar:copy-linear"}
                className="h-4 w-4"
              />
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-lg px-3 py-2 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------- Bits

function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-gray-100 bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div className="text-sm font-semibold text-gray-900">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close"
          >
            <Icon icon="solar:close-circle-linear" className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
