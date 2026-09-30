// Server component wrapper for the Support inbox. The real UI lives in
// SupportClient — this file just renders the title bar so the shell
// paints something before hydration completes.
import SupportClient from "./SupportClient";

export default function SupportPage() {
  return (
    <main className="p-8 max-w-7xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Support</h1>
        <p className="text-sm text-gray-500 mt-1">
          Three-party threads: admin, merchant, supplier. Reply, take internal
          notes, and mark resolved.
        </p>
      </header>
      <SupportClient />
    </main>
  );
}
