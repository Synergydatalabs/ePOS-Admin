"use client";

// Client-side reCAPTCHA v3 helper for tapapp-admin.
//
// Ported from tap-app/src/hooks/useRecaptcha.ts on 2026-09-12.
// Loads Google's reCAPTCHA script on mount and exposes an execute()
// function that returns a token to submit with the login form.
//
// NEXT_PUBLIC_RECAPTCHA_SITE_KEY must be set in tapapp-admin's env
// (same key used by tap-app — the site key is public, safe to share
// across surfaces as long as each domain is registered in the
// reCAPTCHA console).

import { useEffect, useRef, useState, useCallback } from "react";

interface WindowWithGrecaptcha extends Window {
  grecaptcha?: {
    ready: (cb: () => void) => void;
    execute: (siteKey: string, opts: { action: string }) => Promise<string>;
  };
}

const SCRIPT_ID = "google-recaptcha-v3";

function loadScript(siteKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return resolve();
    if (document.getElementById(SCRIPT_ID)) return resolve();
    const s = document.createElement("script");
    s.id = SCRIPT_ID;
    s.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load reCAPTCHA script"));
    document.head.appendChild(s);
  });
}

/**
 * Loads the reCAPTCHA v3 script + returns an execute() fn.
 * `execute(action)` returns a token string.
 *
 * If NEXT_PUBLIC_RECAPTCHA_SITE_KEY isn't set at build time (dev
 * without config), execute() returns "" and the server helper will
 * reject the request. Configure the key in .env before touching this.
 */
export function useRecaptcha() {
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (!siteKey) {
      // No key configured — set ready:true so the button isn't stuck
      // in a "loading" state forever. The server will reject the empty
      // token and the user sees an error toast.
      setReady(true);
      return () => {
        mountedRef.current = false;
      };
    }
    loadScript(siteKey)
      .then(() => {
        if (!mountedRef.current) return;
        setReady(true);
      })
      .catch((err) => {
        if (!mountedRef.current) return;
        setError(err?.message || "Failed to load reCAPTCHA");
        setReady(true);
      });
    return () => {
      mountedRef.current = false;
    };
  }, [siteKey]);

  const execute = useCallback(
    async (action: string): Promise<string> => {
      if (!siteKey) return "";
      const w = window as WindowWithGrecaptcha;
      if (!w.grecaptcha) return "";
      return new Promise<string>((resolve) => {
        w.grecaptcha!.ready(async () => {
          try {
            const token = await w.grecaptcha!.execute(siteKey, { action });
            resolve(token);
          } catch (err) {
            console.warn("[useRecaptcha admin] execute failed:", err);
            resolve("");
          }
        });
      });
    },
    [siteKey]
  );

  return { ready, error, execute };
}
