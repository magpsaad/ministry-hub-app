"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeAuthenticator } from "./actions";

export function RemoveAuthenticatorButton({ factorId, required }: { factorId: string; required: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    const question = required
      ? "Remove this authenticator? Your role needs one, so you'll be asked to set it up again (for example on a new phone) right away."
      : "Turn off the authenticator step? Signing in will need only your email or Google again.";
    if (!confirm(question)) return;
    setError(null);
    startTransition(async () => {
      const res = await removeAuthenticator(factorId);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="text-xs font-semibold text-[#dc3545] hover:underline disabled:opacity-60"
      >
        {required ? "Replace" : "Turn off"}
      </button>
      {error && <span className="mt-1 text-xs text-[#dc3545]">{error}</span>}
    </span>
  );
}
