"use client";

import { useEffect, useRef } from "react";

type Turnstile = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptLoading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptLoading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptLoading = null;
      reject(new Error("Turnstile failed to load"));
    };
    document.head.appendChild(s);
  });
  return scriptLoading;
}

/** Owner-approved sign-in change C (3 Oct 2026): Cloudflare Turnstile, the
 * "invisible bot check". Placed inside a form, it quietly checks the
 * visitor is a real person in a real browser and adds its answer to the
 * form as `cf-turnstile-response`; the server action passes that to
 * Supabase, which verifies it once CAPTCHA protection is switched on in its
 * Auth settings. Real people almost never see anything. Rendered by hand
 * (not Cloudflare's scan-on-load) so it also appears after moving between
 * sign-in steps without a page reload. Renders nothing until
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY is set, so forms keep working before the
 * Cloudflare side is set up. */
export function TurnstileWidget() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!siteKey || !ref.current) return;
    const el = ref.current;
    let widgetId: string | null = null;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !window.turnstile) return;
        widgetId = window.turnstile.render(el, {
          sitekey: siteKey,
          size: "flexible",
          appearance: "interaction-only",
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey]);

  if (!siteKey) return null;
  return <div ref={ref} className="flex justify-center" />;
}
