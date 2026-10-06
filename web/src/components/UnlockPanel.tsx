"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { startAuthentication } from "@simplewebauthn/browser";
import { MinistryHubLogo } from "@/components/MinistryHubBrand";
import type { UnlockMethods } from "@/lib/screen-lock";

const PRIMARY =
  "w-full rounded-md bg-brand py-3 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.15)]";
const SECONDARY =
  "w-full rounded-md border border-[#ddd] bg-white py-2.5 text-sm font-semibold text-[#333] hover:bg-[#f5f5f5] disabled:opacity-60";

/** Screen lock (migration 0089): the ways back in -- Face ID / fingerprint /
 * the device PIN on a device set up for it, the authenticator app's code,
 * or signing in again with an email code. Shown over the page (so a
 * half-typed form is kept) and on /security/unlock. */
export function UnlockPanel({ onUnlocked }: { onUnlocked: () => void }) {
  const router = useRouter();
  const [methods, setMethods] = useState<UnlockMethods | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [code, setCode] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/unlock/methods", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<UnlockMethods>) : null))
      .then((m) => {
        if (!cancelled) setMethods(m ?? { faceId: false, authenticator: false, name: null });
      })
      .catch(() => {
        if (!cancelled) setMethods({ faceId: false, authenticator: false, name: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function unlockWithFaceId() {
    setBusy(true);
    setError(null);
    try {
      const start = await fetch("/api/unlock/options", { method: "POST" });
      if (!start.ok) throw new Error(((await start.json().catch(() => null)) as { error?: string } | null)?.error);
      const response = await startAuthentication({ optionsJSON: await start.json() });
      const check = await fetch("/api/unlock/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ response }),
      });
      if (!check.ok) throw new Error(((await check.json().catch(() => null)) as { error?: string } | null)?.error);
      onUnlocked();
    } catch (e) {
      const name = (e as { name?: string })?.name;
      setError(
        name === "NotAllowedError" || name === "AbortError"
          ? "Face ID was cancelled or didn't match. Try again, or use another way below."
          : (e as Error)?.message || "That didn't work. Try again, or use another way below.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function unlockWithCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/unlock/totp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error);
      setCode("");
      onUnlocked();
    } catch (err) {
      setError((err as Error)?.message || "That code didn't work.");
    } finally {
      setBusy(false);
    }
  }

  async function signInAgain() {
    setBusy(true);
    await fetch("/api/unlock/signout", { method: "POST" }).catch(() => null);
    router.replace("/login");
    router.refresh();
  }

  const first = methods?.name?.trim().split(/\s+/)[0];

  return (
    <div className="w-full max-w-sm rounded-xl bg-white p-6 text-center shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
      <div className="flex justify-center">
        <MinistryHubLogo size={48} />
      </div>
      <h1 className="mt-3 text-lg font-bold text-brand">Locked</h1>
      <p className="mt-1 text-sm text-[#555]">
        {first ? `Hi ${first}. ` : ""}For privacy, the app locked after a few minutes without use.
      </p>

      {error && <p className="mt-3 rounded-md bg-[#f8d7da] px-3 py-2 text-sm text-[#721c24]">{error}</p>}

      <div className="mt-4 space-y-2">
        {!methods ? (
          <p className="text-sm text-[#888]">One moment&hellip;</p>
        ) : (
          <>
            {methods.faceId && (
              <button type="button" onClick={unlockWithFaceId} disabled={busy} className={PRIMARY}>
                {busy && !showCode ? "Checking…" : "Unlock with Face ID / fingerprint"}
              </button>
            )}
            {methods.authenticator &&
              (showCode ? (
                <form onSubmit={unlockWithCode} className="space-y-2">
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    placeholder="6-digit code"
                    autoFocus
                    className="w-full rounded-md border border-[#ddd] px-3 py-2.5 text-center text-lg tracking-[0.4em] focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10"
                  />
                  <button type="submit" disabled={busy || code.length !== 6} className={methods.faceId ? SECONDARY : PRIMARY}>
                    {busy ? "Checking…" : "Unlock with the code"}
                  </button>
                </form>
              ) : (
                <button type="button" onClick={() => setShowCode(true)} disabled={busy} className={methods.faceId ? SECONDARY : PRIMARY}>
                  Use my authenticator app code
                </button>
              ))}
            <button type="button" onClick={signInAgain} disabled={busy} className={SECONDARY}>
              Sign in again with an email code
            </button>
          </>
        )}
      </div>
      {methods && !methods.faceId && (
        <p className="mt-4 text-xs text-[#777]">
          Tip: turn on Face ID / fingerprint unlock for this device in My Settings &rarr; Screen Lock &amp; Face ID.
        </p>
      )}
    </div>
  );
}
