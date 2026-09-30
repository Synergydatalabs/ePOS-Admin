// Self-service password change. The server route clears the session cookie
// on success, so we hard-navigate to /login right after — any subsequent
// authenticated request would 401 anyway.
"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Icon } from "@iconify/react";

interface Rule {
  label: string;
  ok: boolean;
}

function evalRules(pw: string): Rule[] {
  return [
    { label: "At least 12 characters", ok: pw.length >= 12 },
    { label: "Includes a letter", ok: /[A-Za-z]/.test(pw) },
    { label: "Includes a digit", ok: /\d/.test(pw) },
  ];
}

export default function ChangePasswordPage() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const rules = useMemo(() => evalRules(next), [next]);
  const allPass = rules.every((r) => r.ok);
  const confirmOk = confirm.length > 0 && confirm === next;
  const canSubmit =
    current.length > 0 && allPass && confirmOk && current !== next && !submitting;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/admin-users/me/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to change password");
      toast.success("Password updated — sign in with your new password.");
      // Server already cleared the cookie; hard-navigate so middleware picks it up.
      window.location.href = "/login";
    } catch (e: unknown) {
      toast.error((e as Error).message || "Failed to change password");
      setSubmitting(false);
    }
  }

  return (
    <main className="p-8 max-w-xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Change password</h1>
        <p className="mt-1 text-sm text-gray-500">
          After saving, you&apos;ll be signed out and asked to log in again with
          your new password.
        </p>
      </header>

      <form
        onSubmit={onSubmit}
        className="rounded-2xl border border-gray-100 bg-white p-6 space-y-5"
      >
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Current password
          </label>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            New password
          </label>
          <input
            type="password"
            autoComplete="new-password"
            required
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <ul className="mt-2 space-y-1">
            {rules.map((r) => (
              <li
                key={r.label}
                className={`flex items-center gap-2 text-xs ${
                  r.ok ? "text-emerald-700" : "text-gray-500"
                }`}
              >
                <Icon
                  icon={
                    r.ok
                      ? "solar:check-circle-linear"
                      : "solar:minus-circle-linear"
                  }
                  className="h-3.5 w-3.5"
                />
                {r.label}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Confirm new password
          </label>
          <input
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          {confirm.length > 0 && !confirmOk && (
            <p className="mt-1 text-xs text-rose-600">
              Confirmation doesn&apos;t match the new password.
            </p>
          )}
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primaryDark disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Change password"}
          </button>
        </div>
      </form>
    </main>
  );
}
