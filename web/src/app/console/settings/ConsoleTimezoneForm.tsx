"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setConsoleTimezoneAction } from "@/app/console/actions";

export function ConsoleTimezoneForm({ initial }: { initial: string }) {
  const router = useRouter();
  const [timezone, setTimezone] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await setConsoleTimezoneAction(timezone);
      if (res.error) {
        setError(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <section className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
      <h2 className="text-lg font-bold text-brand mb-1">Console Timezone</h2>
      <p className="text-sm text-[#666] mb-3">
        The timezone the console works in &mdash; for example, today&rsquo;s date when you add a release note. Each
        ministry keeps its own timezone in its Ministry Settings; this one is for the console only.
      </p>
      <label className="block text-xs text-[#666]">
        Timezone (IANA name)
        <input
          value={timezone}
          onChange={(e) => {
            setTimezone(e.target.value);
            setSaved(false);
          }}
          placeholder="e.g. America/Toronto"
          className="mt-1 w-full rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
        />
      </label>
      {error && <p className="mt-2 text-sm text-[#dc3545]">{error}</p>}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending || !timezone.trim()}
          className="rounded-md bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-xs text-[#155724]">Saved.</span>}
      </div>
    </section>
  );
}
