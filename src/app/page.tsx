// Root route — send everyone straight to the dashboard.
// Middleware bounces unauthenticated visitors to /login before this ever runs.
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/dashboard");
}
