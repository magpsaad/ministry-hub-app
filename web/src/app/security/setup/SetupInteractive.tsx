"use client";

import { useEffect, useState, useTransition } from "react";
import { startAuthenticatorSetup, finishAuthenticatorSetup } from "../actions";
import { CARD, PRIMARY_BUTTON, CODE_INPUT } from "../shared";

type Setup = { factorId: string; qr: string; secret: string; uri: string };

/** Setting up the authenticator app: scan the QR code (or, on the same
 * phone, open/enter the key), then type the first code it shows. */
export function SetupInteractive({ required, next }: { required: boolean; next: string }) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    startAuthenticatorSetup().then((res) => {
      if (cancelled) return;
      if ("error" in res) setError(res.error);
      else setSetup(res);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function finish(e: React.FormEvent) {
    e.preventDefault();
    if (!setup) return;
    setError(null);
    startTransition(async () => {
      const res = await finishAuthenticatorSetup(setup.factorId, code);
      if (res.error) {
        setError(res.error);
        return;
      }
      // A full load, so every page picks up the completed second step.
      window.location.assign(next);
    });
  }

  return (
    <div className={CARD}>
      <p className="mb-4 text-sm text-[#555]">
        {required
          ? "Your role in Ministry Hub needs a second sign-in step. It takes about two minutes, once."
          : "Adds a second step when you sign in on a new device, so nobody can get in with your email alone."}{" "}
        You&apos;ll be asked for a code only when you sign in fresh &mdash; not every time you open the app.
      </p>

      <ol className="mb-4 list-decimal space-y-2 pl-5 text-sm text-[#333]">
        <li>
          Install <strong>Google Authenticator</strong> or <strong>Microsoft Authenticator</strong> on your phone
          (free, from the App Store or Google Play).
        </li>
        <li>
          In the app, tap <strong>+</strong> and <strong>scan this QR code</strong>.
        </li>
        <li>Type the 6-digit code it shows for Ministry Hub below.</li>
      </ol>

      {!setup && !error && <p className="py-8 text-center text-sm text-[#888]">Preparing your code&hellip;</p>}

      {setup && (
        <>
          <div className="mb-3 flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- Supabase returns an SVG data address */}
            <img src={setup.qr} alt="QR code to add Ministry Hub to your authenticator app" width={180} height={180} />
          </div>
          <details className="mb-4 rounded-md border border-[#eee] bg-[#fafafa] p-3 text-sm">
            <summary className="cursor-pointer font-semibold text-brand">Setting up on this same phone?</summary>
            <p className="mt-2 text-[#555]">
              <a href={setup.uri} className="font-semibold text-brand underline">
                Open in my authenticator app
              </a>
              , or in the app choose &ldquo;Enter a setup key&rdquo; and type this key:
            </p>
            <p className="mt-2 break-all rounded bg-white px-2 py-1.5 font-mono text-xs tracking-wider text-[#333] select-all">
              {setup.secret.replace(/(.{4})/g, "$1 ").trim()}
            </p>
          </details>
          <form onSubmit={finish} className="space-y-3">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              required
              aria-label="6-digit code from the app"
              className={CODE_INPUT}
            />
            <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
              {pending ? "Checking…" : "Turn on"}
            </button>
          </form>
        </>
      )}

      {error && <p className="mt-3 rounded-md bg-[#f8d7da] px-3 py-2 text-sm text-[#721c24]">{error}</p>}
    </div>
  );
}
