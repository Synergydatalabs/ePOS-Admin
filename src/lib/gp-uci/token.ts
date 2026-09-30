// UCI access token — POST /ucp/accesstoken with sha512(nonce + app_key).
// Token lives ~30 min; cached with a 30s safety buffer.

import crypto from "crypto";
import { getUciConfig } from "./constants";
import { UciAuthError, type UciAccessToken } from "./types";

let cached: UciAccessToken | null = null;

function generateNonce(): string {
  return crypto.randomBytes(8).toString("hex");
}

// GP-API spec: secret = sha512(nonce + app_key), lowercase hex.
function computeSecret(nonce: string, appKey: string): string {
  return crypto.createHash("sha512").update(nonce + appKey, "utf8").digest("hex");
}

export function clearUciTokenCache() {
  cached = null;
}

export async function getUciAccessToken(): Promise<string> {
  const config = getUciConfig();

  if (!config.appId || !config.appKey) {
    throw new UciAuthError(
      "UCI not configured: GLOBALPAY_UCI_APP_ID and GLOBALPAY_UCI_APP_KEY must be set"
    );
  }

  if (cached && cached.expiresAt > new Date(Date.now() + 30_000)) {
    return cached.token;
  }

  const nonce = generateNonce();
  const secret = computeSecret(nonce, config.appKey);

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GP-Version": "2021-03-22",
      Accept: "application/json",
    },
    body: JSON.stringify({
      app_id: config.appId,
      nonce,
      secret,
      grant_type: "client_credentials",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new UciAuthError(`Token request failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  if (!data.token) {
    throw new UciAuthError(`Token response missing 'token' field: ${JSON.stringify(data)}`);
  }

  cached = {
    token: data.token,
    type: data.type || "Bearer",
    expiresAt: new Date(Date.now() + (data.seconds_to_expire || 1800) * 1000),
    scope: data.scope || "TRN",
  };

  return cached.token;
}
