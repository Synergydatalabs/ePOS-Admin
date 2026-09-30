// ============================================================================
// Provider registry (admin side).
//
// The single map that lists every payment processor tapapp-admin knows how
// to configure. Adding a new provider means:
//   1. Create src/lib/providers/<name>/admin.ts that exports a ProviderAdmin
//   2. Import it here and add to PROVIDER_REGISTRY
//   3. Optionally expose an input component in PaymentProvidersTab
//
// No other file in this app should switch on the processor code — reach
// through the registry so a new provider stays additive.
// ============================================================================

import { gpAdmin } from "./gp/admin";
import { monerisAdmin } from "./moneris/admin";

export type ProviderCode = "GP" | "MONERIS";

export interface ProviderAdmin {
  /** Human-readable display name (used in dropdowns, audit log). */
  displayName: string;
  /**
   * Validate the raw credentials the admin submitted from the modal.
   * Returns the normalized credential bag ready to encrypt + store, or a
   * user-facing error string when the input is malformed.
   */
  validateCredentials(
    raw: unknown
  ): { ok: true; creds: unknown } | { ok: false; error: string };
}

export const PROVIDER_REGISTRY: Record<ProviderCode, ProviderAdmin> = {
  GP: gpAdmin,
  MONERIS: monerisAdmin,
};

/** Runtime allow-list of processor codes — used by request validation. */
export const ALLOWED_PROCESSORS = new Set<string>(Object.keys(PROVIDER_REGISTRY));
