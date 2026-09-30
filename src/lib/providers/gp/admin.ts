// Global Payments (GP) — admin-side credential validation.
// Nothing here knows about routes or transport; just cred shape + normalization.

import type { ProviderAdmin } from "../registry";

interface CredsGp {
  app_id: string;
  app_key: string;
  account_name?: string;
}

export const gpAdmin: ProviderAdmin = {
  displayName: "Global Payments",

  validateCredentials(raw: unknown) {
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: "credentials must be an object" };
    }
    const r = raw as Record<string, unknown>;
    const app_id = String(r.app_id || "").trim();
    const app_key = String(r.app_key || "").trim();
    const account_name = r.account_name ? String(r.account_name).trim() : undefined;
    if (!app_id || !app_key) {
      return { ok: false, error: "GP requires credentials.app_id and credentials.app_key" };
    }
    const creds: CredsGp = { app_id, app_key, account_name };
    return { ok: true, creds };
  },
};
