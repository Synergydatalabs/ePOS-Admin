// Symmetric encryption for KYB / banking fields on payment-gateway
// applications and supplier processor credentials.
//
// AES-256-GCM — authenticated encryption. Encrypted blob layout:
//   [12-byte IV][16-byte auth tag][ciphertext]
// All concatenated and stored as base64.
//
// Key comes from KYB_ENCRYPTION_KEY env var (base64, 32 bytes). If the
// env var is missing OR malformed we throw at first use — this data is
// sensitive enough that a silent fallback to plaintext would be worse
// than an obvious failure.
//
// Generate a key locally with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.KYB_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "KYB_ENCRYPTION_KEY environment variable is not set. Generate one with `node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"` and add it to your environment before submitting KYB data."
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `KYB_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}). Regenerate with the command in the helper docstring.`
    );
  }
  cachedKey = key;
  return key;
}

/**
 * Encrypt a plain string. Returns a base64 blob suitable for storing in a
 * VARCHAR/TEXT column. Empty / nullish input passes through as null so
 * "not provided" doesn't waste storage or complicate decrypt.
 */
export function kybEncrypt(plaintext: string | null | undefined): string | null {
  if (plaintext == null || plaintext === "") return null;
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/**
 * Decrypt a value produced by kybEncrypt. Returns null on null/empty input;
 * throws on tamper / bad key / bad payload so callers don't accidentally
 * proceed on corrupted data.
 */
export function kybDecrypt(ciphertext: string | null | undefined): string | null {
  if (ciphertext == null || ciphertext === "") return null;
  const key = getKey();
  const blob = Buffer.from(String(ciphertext), "base64");
  if (blob.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("kybDecrypt: ciphertext too short");
  }
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = blob.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}

/**
 * Helper for encrypting structured data (JSON). Uses kybEncrypt under the
 * hood so the storage format is identical.
 */
export function kybEncryptJson(value: unknown): string | null {
  if (value == null) return null;
  return kybEncrypt(JSON.stringify(value));
}

/**
 * Inverse of kybEncryptJson. Returns null when the input is null/empty.
 */
export function kybDecryptJson<T = unknown>(ciphertext: string | null | undefined): T | null {
  const plain = kybDecrypt(ciphertext);
  if (plain == null) return null;
  try {
    return JSON.parse(plain) as T;
  } catch {
    throw new Error("kybDecryptJson: decrypted payload is not valid JSON");
  }
}

/**
 * Safe preview for admin UI — shows the last N chars only. Handy for bank
 * account numbers displayed in a review page so a reviewer can visually
 * confirm without exposing the whole number in a log/screenshot.
 */
export function maskTail(value: string | null | undefined, keep = 4): string {
  if (!value) return "";
  const s = String(value);
  if (s.length <= keep) return "•".repeat(s.length);
  return "•".repeat(s.length - keep) + s.slice(-keep);
}
