// Phase I #4 (2026-09-12): approval panel shown on the tenant detail
// page when a tenant sits in PENDING_APPROVAL. Renders the verification
// state (email/phone check pills, contact fields) and the two decisive
// actions — Approve flips the tenant to ACTIVE, Reject opens a reason
// modal and flips it to REJECTED. Both post to /api/admin/tenants/[id]/
// (approve|reject) and reload the page so every other tab reflects the
// new status.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Icon } from "@iconify/react";

interface Props {
  tenantId: string;
  verification: {
    contactEmail: string | null;
    contactPhone: string | null;
    emailVerifiedAt: string | null;
    phoneVerifiedAt: string | null;
  } | null;
}

export default function ApprovalPanel({ tenantId, verification }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");

  const emailOk = !!verification?.emailVerifiedAt;
  const phoneOk = !!verification?.phoneVerifiedAt;
  const hasPhone = !!verification?.contactPhone;
  // A tenant may be approved without phone verification if they never
  // supplied a phone (some signup flows don't collect one). We only
  // require whatever was actually captured.
  const readyToApprove = emailOk && (!hasPhone || phoneOk);

  async function onApprove() {
    if (busy) return;
    if (!readyToApprove) {
      const missing = [];
      if (!emailOk) missing.push("email");
      if (hasPhone && !phoneOk) missing.push("phone");
      if (
        !confirm(
          `${missing.join(" + ")} verification not complete. Approve anyway?`
        )
      ) {
        return;
      }
    }
    setBusy("approve");
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}/approve`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error || "Approval failed");
        return;
      }
      toast.success("Tenant approved — welcome email sent");
      router.refresh();
    } catch {
      toast.error("Network error — try again");
    } finally {
      setBusy(null);
    }
  }

  async function onReject() {
    if (busy) return;
    if (!reason.trim()) {
      toast.error("Reason is required for rejection");
      return;
    }
    setBusy("reject");
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error || "Rejection failed");
        return;
      }
      toast.success("Tenant rejected — email sent");
      setShowReject(false);
      router.refresh();
    } catch {
      toast.error("Network error — try again");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mb-6 rounded-2xl border border-blue-200 bg-blue-50/60 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 text-blue-900">
            <Icon icon="solar:shield-check-linear" className="h-5 w-5" />
            <h2 className="text-base font-semibold">Awaiting approval</h2>
          </div>
          <p className="mt-1 text-sm text-blue-900/80">
            This tenant signed up and is blocked from the portal until you
            approve. Review the verification below, then approve or reject.
          </p>

          <dl className="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wider text-blue-900/60">
                Contact email
              </dt>
              <dd className="mt-0.5 flex items-center gap-2 text-gray-900">
                <span className="font-medium break-all">
                  {verification?.contactEmail || "—"}
                </span>
                <VerifyPill ok={emailOk} />
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-blue-900/60">
                Contact phone
              </dt>
              <dd className="mt-0.5 flex items-center gap-2 text-gray-900">
                <span className="font-medium">
                  {verification?.contactPhone || (
                    <span className="italic text-gray-400">
                      not provided
                    </span>
                  )}
                </span>
                {hasPhone && <VerifyPill ok={phoneOk} />}
              </dd>
            </div>
          </dl>
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={onApprove}
            disabled={!!busy}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <Icon icon="solar:check-circle-bold" className="h-4 w-4" />
            {busy === "approve" ? "Approving…" : "Approve tenant"}
          </button>
          <button
            onClick={() => setShowReject(true)}
            disabled={!!busy}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            <Icon icon="solar:close-circle-linear" className="h-4 w-4" />
            Reject
          </button>
        </div>
      </div>

      {showReject && (
        <div className="mt-5 rounded-lg border border-red-200 bg-white p-4">
          <label className="block text-sm font-medium text-gray-900">
            Rejection reason
          </label>
          <p className="mt-1 text-xs text-gray-500">
            The tenant sees this in the rejection email. Keep it factual and
            actionable (e.g. &quot;business address does not match domain
            registration&quot;).
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-500/20"
            placeholder="Reason shared with the applicant…"
          />
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => {
                setShowReject(false);
                setReason("");
              }}
              disabled={!!busy}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={onReject}
              disabled={!!busy}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {busy === "reject" ? "Rejecting…" : "Confirm reject"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function VerifyPill({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
        ok
          ? "bg-emerald-50 text-emerald-700"
          : "bg-amber-50 text-amber-700"
      }`}
    >
      <Icon
        icon={ok ? "solar:check-circle-bold" : "solar:clock-circle-linear"}
        className="h-3 w-3"
      />
      {ok ? "verified" : "pending"}
    </span>
  );
}
