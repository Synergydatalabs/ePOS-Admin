// Global audit-log shell. RBAC-gates the page server-side (SUPER_ADMIN +
// COMPLIANCE), then delegates every fetch to the client component so the
// filters can debounce + rerun without a full page reload.
//
// The client uses useSearchParams for deep-link support, so it lives inside
// a Suspense boundary (Next 15 bails out of static generation otherwise).

import { Suspense } from "react";
import { headers } from "next/headers";
import Link from "next/link";
import { Icon } from "@iconify/react";
import AuditLogClient from "./AuditLogClient";

const AUDIT_ROLES = new Set(["SUPER_ADMIN", "COMPLIANCE"]);

export default async function AuditLogPage() {
  const h = await headers();
  const role = h.get("x-admin-role") || "";
  if (!AUDIT_ROLES.has(role)) {
    return (
      <main className="p-8 max-w-3xl">
        <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            <Icon icon="solar:shield-warning-linear" className="h-6 w-6" />
          </div>
          <h1 className="text-lg font-semibold text-gray-900">
            403 &mdash; Not allowed
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Only SUPER_ADMIN and COMPLIANCE can view the platform audit log.
          </p>
          <Link
            href="/dashboard"
            className="mt-6 inline-block text-sm text-primary hover:underline"
          >
            &larr; Back to dashboard
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="p-8 max-w-7xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Audit log</h1>
        <p className="mt-1 text-sm text-gray-500">
          Every write action performed by an admin user. Newest first.
        </p>
      </header>
      <Suspense fallback={<Skeleton />}>
        <AuditLogClient />
      </Suspense>
    </main>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3">
      <div className="h-12 bg-gray-100 rounded-xl animate-pulse" />
      <div className="h-64 bg-gray-100 rounded-2xl animate-pulse" />
    </div>
  );
}
