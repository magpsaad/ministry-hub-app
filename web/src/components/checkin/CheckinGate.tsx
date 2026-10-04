"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { loadTurnstile, TURNSTILE_SITE_KEY } from "@/components/turnstile-loader";
import { startCheckinPassAction } from "@/app/checkin/actions";

/** Security audit #2 (owner-approved, 4 Oct 2026): the check-in page's
 * one-time bot check. Shown instead of the check-in form until this browser
 * has a pass for this poster (lib/checkin-session.ts); most people see it
 * only for a second, a few get one "Verify you are human" box. Then the
 * page reloads into the normal check-in. */
export function CheckinGate({ token }: { token: string }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let widgetId: string | null = null;
    let cancelled = false;
    loadTurnstile()
      .then(() => {
        if (cancelled || !window.turnstile) return;
        widgetId = window.turnstile.render(el, {
          sitekey: TURNSTILE_SITE_KEY,
          size: "flexible",
          appearance: "interaction-only",
          callback: async (answer: string) => {
            const res = await startCheckinPassAction(token, answer);
            if (res.ok) {
              router.refresh();
            } else {
              setFailed(true);
              if (widgetId && window.turnstile) window.turnstile.reset(widgetId);
            }
          },
          "error-callback": () => setFailed(true),
        });
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [token, router]);

  return (
    <div className="rounded-xl bg-white p-6 text-center shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
      <p className="text-sm font-semibold text-[#333]">Just a moment&hellip;</p>
      <p className="mt-1 text-xs text-[#666]">Checking you&rsquo;re not a robot before check-in opens.</p>
      <div ref={ref} className="mt-4 flex justify-center" />
      {failed && (
        <p className="mt-3 text-sm text-[#721c24]">
          That didn&rsquo;t work. Please reload the page, or ask a servant for help.
        </p>
      )}
    </div>
  );
}
