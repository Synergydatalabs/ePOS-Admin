// GP UCI — device command client (trimmed to pingTerminal only).
// tap-app has the full surface (createBill, chargeOnTerminal, batchClose…).
// The admin app only needs to verify a merchant's terminal is reachable,
// so we ship the smallest possible subset here.

import {
  getUciConfig,
  UCI_ACTIONS,
  getUciGpVersion,
  UCI_TIMEOUTS,
  isUciConfigured,
} from "./constants";
import { getUciAccessToken } from "./token";
import { UciApiError, UciAuthError } from "./types";

interface DeviceCommandResponse {
  id?: string;
  device_reference?: string;
  action_type?: string;
  status?: string;
  action?: {
    id?: string;
    type?: string;
    time_created?: string;
    result_code?: string;
    app_id?: string;
    app_name?: string;
  };
  error_code?: string;
  detailed_error_description?: unknown;
  detailed_error_code?: string;
  error_message?: string;
}

async function postDeviceCommand(
  body: Record<string, unknown>
): Promise<DeviceCommandResponse> {
  const config = getUciConfig();
  const token = await getUciAccessToken();

  const response = await fetch(config.deviceCommandsUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-GP-Version": getUciGpVersion(),
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(UCI_TIMEOUTS.COMMAND),
  });

  const data = (await response
    .json()
    .catch(() => ({}))) as DeviceCommandResponse;

  if (!response.ok) {
    // GP sometimes returns detailed_error_description as an object — stringify
    // so the admin UI shows something readable instead of "[object Object]".
    const stringifyErr = (val: unknown): string => {
      if (val == null) return "";
      if (typeof val === "string") return val;
      try {
        return JSON.stringify(val);
      } catch {
        return String(val);
      }
    };
    const errText =
      stringifyErr(data.detailed_error_description) ||
      stringifyErr(data.error_message) ||
      "Device command failed";
    const verbose = [
      errText,
      data.error_code && `[error_code=${data.error_code}]`,
      data.detailed_error_code && `[detailed=${data.detailed_error_code}]`,
      `[http=${response.status}]`,
    ]
      .filter(Boolean)
      .join(" ");
    throw new UciApiError(
      response.status,
      String(data.error_code || "UNKNOWN"),
      verbose
    );
  }

  return data;
}

// Merges the account context onto every request. Admin pings don't need a
// webhook (we're just probing liveness), so we skip the notifications block.
function withContext(body: Record<string, unknown>): Record<string, unknown> {
  const config = getUciConfig();
  const wrapped: Record<string, unknown> = { ...body };
  if (config.accountName && !wrapped.account_name) {
    wrapped.account_name = config.accountName;
  }
  return wrapped;
}

/**
 * PING the terminal via GP UCI. Returns the raw device-command response so
 * the caller can surface DVC id / status back to the admin UI.
 * Throws UciAuthError if UCI env vars are missing, UciApiError on GP failure.
 */
export async function pingTerminal(lane: string): Promise<DeviceCommandResponse> {
  if (!lane) {
    throw new UciApiError(400, "MISSING_LANE", "lane (device_reference) is required");
  }
  if (!isUciConfigured()) {
    throw new UciAuthError(
      "UCI not configured: set GLOBALPAY_UCI_APP_ID, GLOBALPAY_UCI_APP_KEY, GLOBALPAY_UCI_ACCOUNT_NAME, and (optionally) GLOBALPAY_UCI_BASE_URL / GLOBALPAY_UCI_ENV"
    );
  }
  return postDeviceCommand(
    withContext({
      device_reference: lane,
      action_type: UCI_ACTIONS.PING,
    })
  );
}
