// Server component wrapper for the Applications inbox.
// The actual UI lives in ApplicationsClient — this file just renders the
// title bar so the shell layout can render without a client-only hydration
// wait, and the client component takes over for the filterable list.
import ApplicationsClient from "./ApplicationsClient";

export default function ApplicationsPage() {
  return (
    <main className="p-8 max-w-6xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Applications</h1>
        <p className="text-sm text-gray-500 mt-1">
          Merchant + supplier onboarding inbox. Filter by role, status, or
          processor.
        </p>
      </header>
      <ApplicationsClient />
    </main>
  );
}
