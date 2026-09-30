// Left nav for the admin shell. Phase-2/3 entries render but are click-disabled
// so the org can see the roadmap without the risk of clicking dead links.
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

interface Props {
  user: {
    email: string;
    firstName: string | null;
    lastName: string | null;
    role: string;
  };
}

type NavItem = {
  label: string;
  href: string;
  icon: string;
  disabled?: boolean;
  chip?: string;
  superAdminOnly?: boolean;
  // Any-of role gate — the item is visible only if the current admin's
  // role is in this set. superAdminOnly is kept as a shorthand for the
  // common case; use this when SUPER_ADMIN alone isn't enough.
  roles?: string[];
};

const NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: "solar:home-2-linear" },
  { label: "Tenants", href: "/tenants", icon: "solar:buildings-2-linear" },
  {
    label: "Applications",
    href: "/applications",
    icon: "solar:document-add-linear",
  },
  {
    label: "Support",
    href: "/support",
    icon: "solar:chat-round-line-linear",
    roles: ["SUPER_ADMIN", "SUPPORT"],
  },
  {
    label: "Admin Users",
    href: "/admin-users",
    icon: "solar:users-group-two-rounded-linear",
    superAdminOnly: true,
  },
  {
    label: "Audit Log",
    href: "/audit-log",
    icon: "solar:clipboard-list-linear",
    roles: ["SUPER_ADMIN", "COMPLIANCE"],
  },
];

export default function AdminSidebar({ user }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [supportUnread, setSupportUnread] = useState(0);

  // Support-unread poll — only runs for roles that can see the support
  // link. Skip for others so we don't send pointless requests every 30s.
  const canSeeSupport =
    user.role === "SUPER_ADMIN" || user.role === "SUPPORT";
  useEffect(() => {
    if (!canSeeSupport) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/admin/support/unread", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { count: number };
        if (alive) setSupportUnread(data.count);
      } catch {
        // silent — badge just won't update
      }
    };
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [canSeeSupport]);

  async function onLogout() {
    await fetch("/api/admin/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const visible = NAV.filter((n) => {
    if (n.superAdminOnly && user.role !== "SUPER_ADMIN") return false;
    if (n.roles && !n.roles.includes(user.role)) return false;
    return true;
  });
  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;

  return (
    <aside className="w-60 shrink-0 border-r border-gray-100 bg-white flex flex-col">
      <div className="px-5 py-5 border-b border-gray-100">
        <div className="text-sm font-semibold text-gray-900">tapapp-admin</div>
        <div className="text-xs text-gray-500 mt-0.5">Platform ops</div>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {visible.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const base =
            "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors";
          if (item.disabled) {
            return (
              <button
                key={item.href}
                type="button"
                onClick={() => toast(`${item.label} — coming soon`)}
                className={`${base} w-full text-left text-gray-400 cursor-not-allowed`}
              >
                <Icon icon={item.icon} className="w-5 h-5" />
                <span className="flex-1">{item.label}</span>
                {item.chip && (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                    {item.chip}
                  </span>
                )}
              </button>
            );
          }
          const showBadge = item.href === "/support" && supportUnread > 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${base} ${
                active
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-gray-700 hover:bg-gray-50"
              }`}
            >
              <Icon icon={item.icon} className="w-5 h-5" />
              <span className="flex-1">{item.label}</span>
              {showBadge && (
                <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center">
                  {supportUnread > 9 ? "9+" : supportUnread}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-gray-100 p-3">
        <div className="px-2 py-2">
          <div className="text-sm text-gray-900 truncate" title={displayName}>
            {displayName}
          </div>
          <div className="text-xs text-gray-500 truncate">{user.email}</div>
          <div className="text-[10px] uppercase tracking-wider text-gray-400 mt-1">
            {user.role}
          </div>
        </div>
        <Link
          href="/admin-users/me"
          className={`mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors ${
            pathname === "/admin-users/me"
              ? "bg-primary/10 text-primary font-medium"
              : "text-gray-600 hover:bg-gray-50"
          }`}
        >
          <Icon icon="solar:key-linear" className="w-5 h-5" />
          Change password
        </Link>
        <button
          type="button"
          onClick={onLogout}
          className="mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
        >
          <Icon icon="solar:logout-2-linear" className="w-5 h-5" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
