// GP UCI (Unified Cloud Integration) — env config + PING action constant.
// Trimmed for tapapp-admin: only pingTerminal is exposed, so we only keep
// the config resolver + PING + timeouts. Env-var names match tap-app so the
// same values plug into either app.

export const UCI_CONFIG = {
  CERT: {
    BASE_URL: "https://apis.sandbox.globalpay.com",
    TOKEN_URL: "https://apis.sandbox.globalpay.com/ucp/accesstoken",
  },
  PROD: {
    BASE_URL: "https://apis.globalpay.com",
    TOKEN_URL: "https://apis.globalpay.com/ucp/accesstoken",
  },
} as const;

export const UCI_ENDPOINT = "/ucp/device_commands";

// GP-API rejects the doc-listed "03-02-2021" format. ISO YYYY-MM-DD is what
// actually validates. Env override for future GP version bumps.
export const UCI_GP_VERSION_DEFAULT = "2021-03-02";
export function getUciGpVersion(): string {
  return process.env.GLOBALPAY_UCI_GP_VERSION || UCI_GP_VERSION_DEFAULT;
}

// Only PING is needed here — full action enum lives in tap-app.
export const UCI_ACTIONS = {
  PING: "PING",
} as const;

export const UCI_TIMEOUTS = {
  AUTH: 10_000,
  COMMAND: 30_000,
  WEBHOOK: 5_000,
} as const;

// Aggressive trim: PM2 ecosystem configs sometimes carry hidden CR/LF/BOM
// that break SHA-512 hashing → "App credentials not recognized" from GP.
function clean(value: string | undefined): string {
  if (!value) return "";
  return String(value)
    .replace(/^﻿/, "")
    .replace(/[\r\n\t]/g, "")
    .trim();
}

export function getUciConfig() {
  const env =
    clean(process.env.GLOBALPAY_UCI_ENV || "CERT").toUpperCase() === "PROD"
      ? "PROD"
      : "CERT";
  const cfg = UCI_CONFIG[env];

  const baseUrl = clean(process.env.GLOBALPAY_UCI_BASE_URL) || cfg.BASE_URL;
  const tokenUrl = clean(process.env.GLOBALPAY_UCI_TOKEN_URL) || cfg.TOKEN_URL;

  return {
    env,
    baseUrl,
    tokenUrl,
    deviceCommandsUrl: `${baseUrl}${UCI_ENDPOINT}`,
    appId:
      clean(process.env.GLOBALPAY_UCI_APP_ID) ||
      clean(process.env.GP_DROPIN_APP_ID) ||
      clean(process.env.GP_CLOUD_APP_ID) ||
      "",
    appKey:
      clean(process.env.GLOBALPAY_UCI_APP_KEY) ||
      clean(process.env.GP_DROPIN_APP_KEY) ||
      clean(process.env.GP_CLOUD_APP_KEY) ||
      "",
    accountName:
      clean(process.env.GLOBALPAY_UCI_ACCOUNT_NAME) ||
      clean(process.env.GP_DROPIN_ACCOUNT_NAME) ||
      "",
    isProduction: env === "PROD",
  };
}

// Ping doesn't need a webhook, but withContext still checks for one — this
// helper lets the ping route surface a clear "UCI not configured" error
// instead of GP returning an opaque 401 later.
export function isUciConfigured(): boolean {
  const c = getUciConfig();
  return Boolean(c.appId && c.appKey && c.baseUrl);
}
