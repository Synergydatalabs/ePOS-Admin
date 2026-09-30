// Admin login — split-screen layout. Left panel carries the Oreugo
// brand (this admin is served at admin.oreugo.ca; when we onboard a
// second partner the brand panel can key off the hostname the same
// way partner-billing does). Right panel is a clean form card.
//
// Suspense wraps the form because useSearchParams() forces client
// bailout during static generation — Next 15 requires the boundary.
"use client";

import { Suspense, useState } from "react";
import Image from "next/image";
import { Icon } from "@iconify/react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
// Phase I #4 (2026-09-12): reCAPTCHA v3 on admin login. Loads Google's
// script on mount + generates a fresh token per submit, sent alongside
// email/password. Server hard-fails anything Google doesn't confirm.
import { useRecaptcha } from "@/hooks/useRecaptcha";

// Four abstract icons above the hero word — same shape-language BCB
// uses. Kept generic so they work whether Oreugo positions the
// platform as POS, marketplace, payments, or all three.
const HERO_ICONS = [
  "solar:hexagon-linear",
  "solar:transfer-horizontal-linear",
  "solar:layers-linear",
  "solar:atom-linear",
];

// Oreugo brand tokens (matches tap-app's partner landing palette).
const BRAND = {
  bgDark: "#202F27",
  green: "#195937",
  orange: "#FF914D",
};

export default function LoginPage() {
  return (
    <main className="min-h-screen grid lg:grid-cols-2">
      {/* LEFT — brand panel. Hidden on small screens so mobile gets
          just the form (login isn't a form-factor to sell brand on). */}
      <aside
        className="hidden lg:flex flex-col justify-between p-12 text-white relative overflow-hidden"
        style={{ backgroundColor: BRAND.bgDark }}
      >
        {/* Ambient glow — big soft orange circle top-right and green
            bottom-left. Kept as CSS-only radial gradients so we don't
            ship extra images. */}
        <div
          className="absolute -top-40 -right-40 w-[600px] h-[600px] rounded-full opacity-30 blur-3xl"
          style={{ backgroundColor: BRAND.orange }}
        />
        <div
          className="absolute -bottom-40 -left-40 w-[600px] h-[600px] rounded-full opacity-40 blur-3xl"
          style={{ backgroundColor: BRAND.green }}
        />

        {/* Empty spacer — the hero is centred vertically by the flex
            layout on <aside>. Kept as an empty div so the flex
            "space-between" still pushes the footer to the bottom. */}
        <div className="relative z-10" />

        <div className="relative z-10 space-y-8">
          {/* Symbol row — thin outlined icons, echoes BCB's opener */}
          <div className="flex items-center gap-5 text-white/80">
            {HERO_ICONS.map((name) => (
              <Icon key={name} icon={name} className="w-8 h-8" />
            ))}
          </div>

          {/* Hero word — giant, bold, tight tracking */}
          <h1 className="text-8xl font-bold leading-none tracking-tight">
            Oreugo<span style={{ color: BRAND.orange }}>.</span>
          </h1>

          <p className="text-xl text-white/80 max-w-md leading-relaxed">
            Platform admin. Onboard merchants, review KYB, assign payment
            providers, and support your partners — all in one place.
          </p>

          <div className="flex items-center gap-6 pt-2 text-sm text-white/60">
            <span className="flex items-center gap-2">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: BRAND.orange }}
              />
              Merchants
            </span>
            <span className="flex items-center gap-2">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: BRAND.orange }}
              />
              Suppliers
            </span>
            <span className="flex items-center gap-2">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: BRAND.orange }}
              />
              Payments
            </span>
          </div>
        </div>

        <p className="relative z-10 text-xs text-white/50">
          &copy; {new Date().getFullYear()} Oreugo Technologies. Restricted access — authorized personnel only.
        </p>
      </aside>

      {/* RIGHT — sign-in form */}
      <section className="flex items-center justify-center p-6 bg-gray-50">
        <div className="w-full max-w-sm">
          {/* Small brand mark on mobile only — the left panel is hidden then */}
          <div className="lg:hidden flex justify-center mb-8">
            <Image
              src="/brand/oreugo-wordmark-black.png"
              alt="Oreugo"
              width={120}
              height={32}
              className="h-6 w-auto opacity-80"
            />
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-900">
              Sign in to admin
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Use the credentials your platform administrator gave you.
            </p>
          </div>

          <Suspense fallback={<FormShell disabled />}>
            <LoginForm />
          </Suspense>

          <p className="mt-6 text-center text-xs text-gray-400">
            Forgot your password? Ask a super-admin to reset it from Admin Users.
          </p>
        </div>
      </section>
    </main>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Phase I #4 (2026-09-12): reCAPTCHA v3. Loaded on mount; the actual
  // token is generated per-submit via recaptcha.execute("admin_login").
  const recaptcha = useRecaptcha();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      // Generate fresh token — v3 tokens are single-use + short-lived,
      // so we mint one per click rather than caching.
      const recaptchaToken = await recaptcha.execute("admin_login");
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, recaptchaToken }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || "Invalid email or password");
        return;
      }
      router.push(next);
      router.refresh();
    } catch {
      toast.error("Network error — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm space-y-4"
    >
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
        <input
          type="email"
          required
          autoComplete="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@oreugo.ca"
          className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg py-2.5 text-sm font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          backgroundColor: BRAND.green,
        }}
        onMouseOver={(e) => {
          if (!submitting) e.currentTarget.style.backgroundColor = BRAND.bgDark;
        }}
        onMouseOut={(e) => {
          if (!submitting) e.currentTarget.style.backgroundColor = BRAND.green;
        }}
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

// Kept structurally identical to LoginForm so there's no layout shift
// when Suspense resolves. Same styling minus the interactive polish.
function FormShell({ disabled }: { disabled: boolean }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm space-y-4 opacity-60">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
        <input type="email" disabled={disabled} className="w-full rounded-lg border border-gray-200 px-3 py-2.5" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
        <input type="password" disabled={disabled} className="w-full rounded-lg border border-gray-200 px-3 py-2.5" />
      </div>
      <button
        type="button"
        disabled
        className="w-full rounded-lg py-2.5 text-sm font-semibold text-white opacity-50"
        style={{ backgroundColor: BRAND.green }}
      >
        Loading…
      </button>
    </div>
  );
}
