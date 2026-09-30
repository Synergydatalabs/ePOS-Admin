// Protected shell — every authenticated page mounts inside this layout.
// Reads the cookie via the Next headers API so we don't need to pass a NextRequest.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { ADMIN_COOKIE_NAME, verifyAdminToken } from "@/lib/admin-auth";
import AdminSidebar from "@/components/AdminSidebar";

// Force every page under (admin)/* to render at request time.
// Without this, Next tries to prerender any page whose route has no
// dynamic segments (e.g. /dashboard, /tenants, /admin-users) at build
// time — which fires Prisma against Aurora during `next build`. That
// fails when the build machine can't reach the DB, and even when it
// succeeds the tiles end up frozen at build-time counts. Admin data
// must be live.
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE_NAME)?.value;
  const session = token ? await verifyAdminToken(token) : null;
  if (!session) redirect("/login");

  const user = await prisma.adminUser.findUnique({
    where: { id: session.adminUserId },
    // isActive must be in the select — the guard on the next line reads
    // it, and without it Prisma types would let a deactivated admin
    // through (undefined is falsy but not a real check).
    select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) redirect("/login");

  return (
    <div className="min-h-screen flex bg-gray-50">
      <AdminSidebar
        user={{
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        }}
      />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
