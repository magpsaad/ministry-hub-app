"use client";

/** Shared by the bot-check components (TurnstileWidget for forms,
 * TurnstileChallenge for the check-in page's one-time check). */
export type Turnstile = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (id: string) => void;
  reset: (id: string) => void;
  getResponse: (id: string) => string | undefined;
};

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** The "Ministry Hub" Turnstile widget's site key (Cloudflare, owner's
 * account, 4 Oct 2026). Public by design -- it's in every visitor's page;
 * the matching SECRET key lives only in Supabase's CAPTCHA settings and in
 * Vercel (TURNSTILE_SECRET_KEY, for the check-in page).
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY in Vercel overrides it. */
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "0x4AAAAAAFNOeAHZpTettkme";

let scriptLoading: Promise<void> | null = null;

export function loadTurnstile(): Promise<void> {
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
