// Admin-user management shell. Server component so we can 403 non-SUPER_ADMINs
// without shipping the whole client bundle to them. The middleware stamps
// x-admin-role on every authenticated request, and next/headers surfaces it here.

import { headers } from "next/headers";
import Link from "next/link";
import { Icon } from "@iconify/react";
import AdminUsersClient from "./AdminUsersClient";

export default async function AdminUsersPage() {
  const h = await headers();
  const role = h.get("x-admin-role");
  const selfId = h.get("x-admin-user-id");

  if (role !== "SUPER_ADMIN" || !selfId) {
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
            Only SUPER_ADMIN accounts can manage admin users.
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

  return <AdminUsersClient selfId={selfId} />;
}
