"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { startAuthenticatorSetup, finishAuthenticatorSetup } from "../actions";
import { CARD, PRIMARY_BUTTON, CODE_INPUT } from "../shared";
import { BusyLabel } from "@/components/PendingButton";

type Setup = { factorId: string; qr: string; secret: string; uri: string };

/** Setting up the authenticator app: scan the QR code (or, on the same
 * phone, open/enter the key), then type the first code it shows. */
export function SetupInteractive({ required, next }: { required: boolean; next: string }) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [restarting, setRestarting] = useState(false);
  // Owner-reported (5 Oct 2026): every start makes a new QR code and
  // cancels the previous one, and a quick second tap made two. One start
  // at a time, and one "Turn on" at a time.
  const starting = useRef(false);
  const finishing = useRef(false);

  const begin = useCallback(async () => {
    if (starting.current) return;
    starting.current = true;
    setError(null);
    setCode("");
    const res = await startAuthenticatorSetup();
    starting.current = false;
    setRestarting(false);
    if ("error" in res) setError(res.error);
    else setSetup(res);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void begin(), 0);
    return () => window.clearTimeout(t);
  }, [begin]);

  function restart() {
    setRestarting(true);
    setSetup(null);
    void begin();
  }

  async function finish(e: React.FormEvent) {
    e.preventDefault();
    if (!setup || finishing.current) return;
    finishing.current = true;
    setBusy(true);
    setError(null);
    const res = await finishAuthenticatorSetup(setup.factorId, code);
    if (res.error) {
      finishing.current = false;
      setBusy(false);
      setError(res.error);
      return;
    }
    // A full load, so every page picks up the completed second step. The
    // button stays locked until that page is up.
    window.location.assign(next);
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

      {!setup && !error && (
        <p className="py-8 text-center text-sm text-[#888]">
          <BusyLabel busy busyText="Preparing your code…">
            Preparing your code&hellip;
          </BusyLabel>
        </p>
      )}

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
            <button type="submit" disabled={busy} aria-busy={busy} className={PRIMARY_BUTTON}>
              <BusyLabel busy={busy} busyText="Checking…">
                Turn on
              </BusyLabel>
            </button>
          </form>
        </>
      )}

      {error && <p className="mt-3 rounded-md bg-[#f8d7da] px-3 py-2 text-sm text-[#721c24]">{error}</p>}
      {error && !busy && (
        <button
          type="button"
          onClick={restart}
          disabled={restarting}
          className="mt-3 w-full rounded-md border border-[#ddd] bg-white py-2.5 text-sm font-semibold text-[#333] hover:bg-[#f5f5f5] disabled:opacity-60"
        >
          <BusyLabel busy={restarting} busyText="Making a new code…">
            Get a new QR code and start again
          </BusyLabel>
        </button>
      )}
    </div>
  );
}
