// Tenant detail — the shell is a server component (fetches overview once),
// then a client tab-switcher lazily pulls the other tabs on demand.
import { notFound } from "next/navigation";
import Link from "next/link";
import { Icon } from "@iconify/react";
import prisma from "@/lib/prisma";
import TenantTabs from "./TenantTabs";
import ApprovalPanel from "./ApprovalPanel";

interface Props {
  params: Promise<{ tenantId: string }>;
}

export default async function TenantDetailPage({ params }: Props) {
  const { tenantId } = await params;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      currency: true,
      timezone: true,
      businessType: true,
      createdAt: true,
      // Phase I #4 (2026-09-12): approval panel needs email/phone
      // verification state + the reviewer's decision trail. Null for
      // grandfathered tenants (created before the approval flow).
      verification: {
        select: {
          contactEmail: true,
          contactPhone: true,
          emailVerifiedAt: true,
          phoneVerifiedAt: true,
          adminReviewedAt: true,
          adminReviewerEmail: true,
          adminDecision: true,
          rejectionReason: true,
        },
      },
    },
  });
  if (!tenant) notFound();

  const isPending = tenant.status === "PENDING_APPROVAL";
  const isRejected = tenant.status === "REJECTED";

  return (
    <main className="p-8 max-w-6xl">
      <div className="mb-2 text-sm">
        <Link href="/tenants" className="text-gray-500 hover:text-gray-700">
          ← Tenants
        </Link>
      </div>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{tenant.name}</h1>
          <div className="mt-1 text-sm text-gray-500">
            <span className="font-mono">{tenant.slug}</span>
            <span className="mx-2">·</span>
            <span className="capitalize">{tenant.businessType}</span>
            <span className="mx-2">·</span>
            <span>{tenant.status}</span>
          </div>
        </div>
        <Link
          href={`/audit-log?resourceType=tenant&resourceId=${tenant.id}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-gray-50"
          title="Every admin action taken against this tenant"
        >
          <Icon icon="solar:clipboard-list-linear" className="h-3.5 w-3.5" />
          View audit
        </Link>
      </header>

      {isPending && (
        <ApprovalPanel
          tenantId={tenant.id}
          verification={
            tenant.verification
              ? {
                  contactEmail: tenant.verification.contactEmail,
                  contactPhone: tenant.verification.contactPhone,
                  emailVerifiedAt:
                    tenant.verification.emailVerifiedAt?.toISOString() ?? null,
                  phoneVerifiedAt:
                    tenant.verification.phoneVerifiedAt?.toISOString() ?? null,
                }
              : null
          }
        />
      )}

      {isRejected && tenant.verification?.adminDecision === "REJECTED" && (
        <section className="mb-6 rounded-2xl border border-red-200 bg-red-50/60 p-5">
          <div className="flex items-center gap-2 text-red-900">
            <Icon icon="solar:close-circle-bold" className="h-5 w-5" />
            <h2 className="text-base font-semibold">Rejected</h2>
          </div>
          <p className="mt-1 text-sm text-red-900/80">
            Rejected
            {tenant.verification.adminReviewedAt && (
              <>
                {" on "}
                {new Date(
                  tenant.verification.adminReviewedAt
                ).toLocaleString()}
              </>
            )}
            {tenant.verification.adminReviewerEmail && (
              <>{" by "}{tenant.verification.adminReviewerEmail}</>
            )}
            .
          </p>
          {tenant.verification.rejectionReason && (
            <p className="mt-3 rounded-lg bg-white/70 border border-red-100 p-3 text-sm text-gray-800">
              <span className="text-xs uppercase tracking-wider text-red-900/60 block mb-1">
                Reason
              </span>
              {tenant.verification.rejectionReason}
            </p>
          )}
        </section>
      )}

      <TenantTabs
        tenantId={tenant.id}
        overview={{
          currency: tenant.currency,
          timezone: tenant.timezone,
          businessType: tenant.businessType,
          slug: tenant.slug,
          status: tenant.status,
          createdAt: tenant.createdAt.toISOString(),
        }}
      />
    </main>
  );
}
