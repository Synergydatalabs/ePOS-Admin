// Server-rendered wrapper for the application detail view. Fetches the
// current admin role from a request header (stamped by middleware) so the
// client component knows whether the Reveal buttons should be enabled at
// all — clicking is still gated server-side, this is only a UX hint.
import { headers } from "next/headers";
import ApplicationDetailClient from "./ApplicationDetailClient";

export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const hdrs = await headers();
  const role = hdrs.get("x-admin-role") || "SUPPORT";
  const canReveal = role === "SUPER_ADMIN" || role === "COMPLIANCE";
  return <ApplicationDetailClient id={id} canReveal={canReveal} role={role} />;
}
