"use client";

import { useState, useTransition } from "react";
import type { MinistryListRow } from "@/lib/console";
import {
  updateMinistryAction,
  addMinistryAddressAction,
  removeMinistryAddressAction,
} from "@/app/console/actions";
import { addressUrl } from "@/lib/address-url";

export function EditMinistryInteractive({ ministry }: { ministry: MinistryListRow }) {
  const [name, setName] = useState(ministry.name);
  const [displayOrder, setDisplayOrder] = useState(ministry.display_order);
  const [addresses, setAddresses] = useState(ministry.addresses);
  const [newHost, setNewHost] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await updateMinistryAction(ministry.id, name, displayOrder);
      if (res.error) {
        setError(res.error);
        return;
      }
      setSaved(true);
    });
  }

  function handleAddAddress() {
    setError(null);
    startTransition(async () => {
      const res = await addMinistryAddressAction(ministry.id, newHost);
      if (res.error || !res.host) {
        setError(res.error ?? "Could not add that address.");
        return;
      }
      const host = res.host;
      setAddresses((prev) => [...prev, host].sort());
      setNewHost("");
    });
  }

  function handleRemoveAddress(host: string) {
    if (
      !confirm(
        `Remove ${host}? Anyone using that address will see "This address isn't set up" until it's added back. No data is deleted.`,
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      const res = await removeMinistryAddressAction(ministry.id, host);
      if (res.error) {
        setError(res.error);
        return;
      }
      setAddresses((prev) => prev.filter((h) => h !== host));
    });
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded-md bg-[#f8d7da] px-3 py-2 text-sm text-[#721c24]">{error}</p>}

      <section className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
        <h2 className="text-lg font-bold text-brand mb-3">Ministry</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          <label className="text-xs text-[#666]">
            Code (permanent)
            <input
              value={ministry.id}
              readOnly
              className="mt-1 w-full rounded-md border border-[#eee] bg-[#f5f5f5] px-2 py-1.5 font-mono text-sm font-bold tracking-widest text-[#666]"
            />
          </label>
          <label className="text-xs text-[#666]">
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
            />
          </label>
          <label className="text-xs text-[#666]">
            Order in lists
            <input
              type="number"
              value={displayOrder}
              onChange={(e) => setDisplayOrder(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
            />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={pending}
            className="rounded-md bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
          >
            Save
          </button>
          {saved && <span className="text-xs text-[#155724]">Saved.</span>}
        </div>
      </section>

      <section className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
        <h2 className="text-lg font-bold text-brand mb-1">Addresses</h2>
        <p className="text-sm text-[#666] mb-3">
          The web addresses this ministry is reached at in this environment. A new address also has to be added to
          the Vercel project (Settings &rarr; Domains) and to Supabase&rsquo;s Redirect URLs (Authentication &rarr; URL
          Configuration), each listed exactly, or signing in there fails.
        </p>
        <ul className="divide-y divide-[#f0f0f0] mb-3">
          {addresses.map((h) => (
            <li key={h} className="flex items-center justify-between gap-2 py-2 text-sm">
              <a href={addressUrl(h)} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline truncate">
                {h} &#8599;
              </a>
              <span className="flex shrink-0 items-center gap-3">
                <a
                  href={addressUrl(h, "/admin/actions-needed-config")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold text-brand hover:underline"
                >
                  App Settings &#8599;
                </a>
                <button
                  type="button"
                  onClick={() => handleRemoveAddress(h)}
                  disabled={pending}
                  className="text-xs font-semibold text-[#dc3545] hover:underline disabled:opacity-60"
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
          {addresses.length === 0 && <li className="py-2 text-sm text-[#dc3545]">No addresses yet.</li>}
        </ul>
        <div className="flex gap-2">
          <input
            placeholder="e.g. highschool-ministry.vercel.app"
            value={newHost}
            onChange={(e) => setNewHost(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-[#ddd] px-3 py-1.5 text-sm focus:border-brand focus:outline-none"
          />
          <button
            type="button"
            onClick={handleAddAddress}
            disabled={pending || !newHost.trim()}
            className="shrink-0 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
          >
            Add
          </button>
        </div>
      </section>

      <section className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
        <h2 className="text-lg font-bold text-brand mb-1">Logo, labels, colours and schedule</h2>
        <p className="text-sm text-[#666]">
          These live in the ministry&rsquo;s own App Settings. As Church Admin you&rsquo;re an Admin on every
          ministry&rsquo;s address, so use the <strong>App Settings</strong> link next to an address above (you may need
          to sign in there first).
        </p>
      </section>
    </div>
  );
}
