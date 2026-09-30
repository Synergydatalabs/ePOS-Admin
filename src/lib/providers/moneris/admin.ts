// Moneris Go Cloud — admin-side credential validation.
//
// Cred shape matches what tap-app/src/lib/moneris/client.ts reads at
// request time. terminal_id is the DX8000 Device ID from Moneris Go
// Portal; ist_config_code is Moneris-provisioned (rep can confirm; the
// docs require the field even when unused — Moneris returns "Invalid
// Parameter" if omitted, so we keep it optional here and send "" on the
// wire when blank). environment picks between sandbox and production
// base URLs.

import type { ProviderAdmin } from "../registry";

interface CredsMoneris {
  store_id: string;
  api_token: string;
  terminal_id: string;
  ist_config_code?: string;
  environment?: "test" | "prod";
}

export const monerisAdmin: ProviderAdmin = {
  displayName: "Moneris (Moneris Go Cloud)",

  validateCredentials(raw: unknown) {
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: "credentials must be an object" };
    }
    const r = raw as Record<string, unknown>;
    const store_id = String(r.store_id || "").trim();
    const api_token = String(r.api_token || "").trim();
    const terminal_id = String(r.terminal_id || "").trim();
    const ist_config_code = r.ist_config_code
      ? String(r.ist_config_code).trim()
      : undefined;
    const environmentRaw = r.environment
      ? String(r.environment).trim().toLowerCase()
      : "test";
    const environment: "test" | "prod" =
      environmentRaw === "prod" ? "prod" : "test";
    if (!store_id || !api_token || !terminal_id) {
      return {
        ok: false,
        error:
          "Moneris requires credentials.store_id, credentials.api_token, and credentials.terminal_id",
      };
    }
    const creds: CredsMoneris = {
      store_id,
      api_token,
      terminal_id,
      ist_config_code,
      environment,
    };
    return { ok: true, creds };
  },
};
