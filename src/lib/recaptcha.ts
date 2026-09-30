// reCAPTCHA verification for tapapp-admin.
//
// Ported from tap-app/src/lib/recaptcha.ts on 2026-09-12 to gate the
// admin login endpoint. Same site key + secret as the platform-wide
// reCAPTCHA project — just make sure admin.oreugo.ca (and any other
// admin domains) are listed under "Domains" in the reCAPTCHA console.
//
// HARD-FAIL by design: unlike tap-app's earlier soft-fail, we NEVER
// let a request through on a failed captcha. Admin login is the
// highest-value target on the platform; false positives are annoying
// (staff re-hits login) but false negatives could hand a bot a
// SUPER_ADMIN session.

export interface RecaptchaResult {
  ok: boolean;
  score?: number;
  action?: string;
  errorCodes?: string[];
  reason?: string;
}

interface GoogleVerifyResponse {
  success: boolean;
  challenge_ts?: string;
  hostname?: string;
  score?: number;
  action?: string;
  "error-codes"?: string[];
}

export interface VerifyOptions {
  token: string;
  ip?: string;
  minScore?: number;
  expectedAction?: string;
}

const VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";

export async function verifyRecaptcha(opts: VerifyOptions): Promise<RecaptchaResult> {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) {
    // Dev machine: no secret configured. Rather than fail-open (which
    // is what tap-app used to do and let the burner-account signups
    // through), we log loudly + return FAIL. Set the key in .env — even
    // in dev — before touching admin login.
    console.error(
      "[recaptcha admin] RECAPTCHA_SECRET_KEY not set — rejecting all requests. " +
        "Configure it in .env to unlock admin login."
    );
    return { ok: false, reason: "secret-not-configured" };
  }
  if (!opts.token || opts.token.trim().length === 0) {
    return { ok: false, reason: "empty-token" };
  }

  const form = new URLSearchParams();
  form.set("secret", secret);
  form.set("response", opts.token);
  if (opts.ip) form.set("remoteip", opts.ip);

  let raw: GoogleVerifyResponse;
  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(5000),
    });
    raw = (await res.json()) as GoogleVerifyResponse;
  } catch (err: any) {
    console.error("[recaptcha admin] verify fetch failed:", err?.message || err);
    return { ok: false, reason: "verify-network-error" };
  }

  if (!raw.success) {
    return {
      ok: false,
      errorCodes: raw["error-codes"],
      reason: `verify-failed: ${(raw["error-codes"] || []).join(",") || "no reason"}`,
    };
  }

  // v3 score check
  if (typeof raw.score === "number") {
    const threshold = opts.minScore ?? 0.5;
    if (raw.score < threshold) {
      return {
        ok: false,
        score: raw.score,
        action: raw.action,
        reason: `low-score: ${raw.score.toFixed(2)} < ${threshold}`,
      };
    }
    if (opts.expectedAction && raw.action && raw.action !== opts.expectedAction) {
      return {
        ok: false,
        score: raw.score,
        action: raw.action,
        reason: `action-mismatch: got ${raw.action}, expected ${opts.expectedAction}`,
      };
    }
  }

  return { ok: true, score: raw.score, action: raw.action };
}

export function ipFromRequest(request: Request): string | undefined {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = request.headers.get("x-real-ip");
  return real || undefined;
}
