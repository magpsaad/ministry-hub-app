"use client";

import { useEffect, useRef, useState } from "react";
import { loadTurnstile, TURNSTILE_SITE_KEY } from "./turnstile-loader";

/** Owner-approved sign-in change C (3 Oct 2026): Cloudflare Turnstile, the
 * "invisible bot check". Placed inside a form, it quietly checks the
 * visitor is a real person in a real browser and adds its answer to the
 * form as `cf-turnstile-response`; the server action passes that to
 * Supabase, which checks it (CAPTCHA protection in Supabase's Auth
 * settings). Real people almost never see anything.
 *
 * Each answer works once. So the form is held until there is a fresh
 * answer (a quick click, or a second try after an error, used to send an
 * empty or used one -- React clears the form after each submit while this
 * widget stays on the page), and a new answer is fetched straight after
 * every submit. Rendered by hand (not Cloudflare's scan-on-load) so it
 * also appears after moving between sign-in steps without a page reload. */
export function TurnstileWidget() {
  const siteKey = TURNSTILE_SITE_KEY;
  const ref = useRef<HTMLDivElement>(null);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    const el = ref.current;
    const form = el?.closest("form");
    if (!el || !form) return;

    let widgetId: string | null = null;
    let cancelled = false;
    let submitWhenReady = false;
    const token = () => (widgetId && window.turnstile?.getResponse(widgetId)) || "";

    const onSubmit = (e: SubmitEvent) => {
      if (!token()) {
        // No answer yet: hold this submit (before React sees it) and send
        // the form as soon as one arrives.
        e.preventDefault();
        e.stopPropagation();
        submitWhenReady = true;
        setWaiting(true);
        return;
      }
      // React has already read the form for this submit; get a fresh
      // answer for the next one.
      setTimeout(() => {
        if (widgetId && window.turnstile) window.turnstile.reset(widgetId);
      }, 0);
    };
    form.addEventListener("submit", onSubmit);

    loadTurnstile()
      .then(() => {
        if (cancelled || !window.turnstile) return;
        widgetId = window.turnstile.render(el, {
          sitekey: siteKey,
          size: "flexible",
          appearance: "interaction-only",
          "refresh-expired": "auto",
          callback: () => {
            if (submitWhenReady) {
              submitWhenReady = false;
              setWaiting(false);
              form.requestSubmit();
            }
          },
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      form.removeEventListener("submit", onSubmit);
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey]);

  return (
    <>
      <div ref={ref} className="flex justify-center" />
      {waiting && <p className="text-center text-xs text-[#666]">Checking you&rsquo;re not a robot&hellip;</p>}
    </>
  );
}
