// Dashboard — 4 read-only stat tiles rendered server-side straight from Prisma.
// Deliberately plain: this is the "does the app boot?" landing page.
import prisma from "@/lib/prisma";
import { Icon } from "@iconify/react";

async function loadStats() {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [total, active, byType, recent] = await Promise.all([
    prisma.tenant.count(),
    prisma.tenant.count({ where: { status: "ACTIVE" } }),
    prisma.tenant.groupBy({
      by: ["businessType"],
      _count: { _all: true },
      orderBy: { _count: { businessType: "desc" } },
    }),
    prisma.tenant.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
  ]);

  return { total, active, byType, recent };
}

interface TileProps {
  label: string;
  value: string | number;
  icon: string;
  hint?: string;
}

function Tile({ label, value, icon, hint }: TileProps) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-gray-500">{label}</div>
          <div className="mt-2 text-3xl font-semibold text-gray-900 tabular-nums">
            {value}
          </div>
          {hint && <div className="mt-1 text-xs text-gray-500">{hint}</div>}
        </div>
        <div className="rounded-xl bg-primary/10 p-2">
          <Icon icon={icon} className="w-6 h-6 text-primary" />
        </div>
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  const stats = await loadStats();

  return (
    <main className="p-8 max-w-6xl">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">
          Snapshot across every tenant on the platform.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Tile
          label="Total tenants"
          value={stats.total}
          icon="solar:buildings-2-linear"
        />
        <Tile
          label="Active"
          value={stats.active}
          icon="solar:check-circle-linear"
          hint={`${stats.total - stats.active} suspended / cancelled`}
        />
        <Tile
          label="New (30d)"
          value={stats.recent}
          icon="solar:add-circle-linear"
        />
        <Tile
          label="Business types"
          value={stats.byType.length}
          icon="solar:layers-linear"
        />
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">By business type</h2>
        <div className="rounded-2xl border border-gray-100 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Type</th>
                <th className="text-right px-4 py-2 font-medium">Tenants</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {stats.byType.length === 0 ? (
                <tr>
                  <td colSpan={2} className="text-center text-gray-400 py-6">
                    No tenants yet.
                  </td>
                </tr>
              ) : (
                stats.byType.map((row) => (
                  <tr key={row.businessType}>
                    <td className="px-4 py-2 capitalize">{row.businessType}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {row._count._all}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
