"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addressUrl } from "@/lib/address-url";

/**
 * The steps that finish a new ministry's setup outside the app (Vercel
 * domain, Supabase redirect URL, first sign-in). Owner-reported (1 Oct
 * 2026): it used to show only in the Create Ministry form's own state and
 * vanished almost at once. Now Create Ministry opens the ministry's page
 * with `?created=1`, which shows these steps until Dismiss is clicked (a
 * refresh keeps them), and every ministry's page can show them again with
 * "Show setup steps".
 */
export function SetupChecklist({
  code,
  name,
  environment,
  hosts,
  justCreated,
}: {
  code: string;
  name: string;
  environment: "QA" | "production";
  hosts: string[];
  justCreated: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(justCreated);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm font-semibold text-brand hover:underline">
        Show setup steps
      </button>
    );
  }

  function dismiss() {
    setOpen(false);
    if (justCreated) router.replace(`/console/ministries/${code}`);
  }

  return (
    <section className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] border-l-4 border-[#28a745] p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-bold text-[#155724]">
          {justCreated ? `${name} (${code}) was created in ${environment}.` : `Setting up ${name} (${code})`}
        </h2>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 rounded-md border border-[#ddd] px-3 py-1 text-xs font-semibold text-[#333] hover:bg-[#f5f5f5]"
        >
          Dismiss
        </button>
      </div>
      <p className="text-sm text-[#666]">Before anyone can use it, finish these steps (about 10 minutes):</p>
      <ol className="list-decimal pl-5 space-y-2 text-sm text-[#333]">
        <li>
          <strong>Vercel:</strong> in the {environment} project, <em>Settings &rarr; Domains</em>, add{" "}
          {hosts.length > 0 ? hosts.join(", ") : "its address"}.
        </li>
        <li>
          <strong>Supabase:</strong> in <em>Authentication &rarr; URL Configuration</em>, add each address to the
          Redirect URLs, listed exactly (e.g. <code>{`https://${hosts[0] ?? "the-address"}/**`}</code>). Never use a
          broad pattern like <code>*.vercel.app</code>.
        </li>
        <li>
          Open the address, sign in, and check the ministry&rsquo;s App Settings (logo, labels, colours). The first
          Admin(s) will be asked for their phone and gender the first time they sign in there.
        </li>
        {environment === "QA" && (
          <li>Once it&rsquo;s tested in QA, create it again in the production console with its production address.</li>
        )}
      </ol>
      {hosts.length > 0 && (
        <div className="flex flex-wrap gap-3 pt-1">
          {hosts.map((h) => (
            <a
              key={h}
              href={addressUrl(h)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold text-brand hover:underline"
            >
              Open {h} &#8599;
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
