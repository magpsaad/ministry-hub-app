"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { createMinistryAction, type CreateMinistryInput } from "@/app/console/actions";
import { addressUrl } from "@/lib/address-url";

// ISO weekday numbering (Monday=1..Sunday=7), matching app_settings.service_weekday.
const WEEKDAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const inputClass =
  "mt-1 w-full rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none";

/** MULTI_TENANT_PLAN.md §3.8 -- Create ministry. Nothing is pre-filled
 * from any existing ministry's schedule or timezone: those must be chosen
 * for the new ministry (no ministry's values are ever assumed, P8). */
export function CreateMinistryInteractive({
  environment,
  existing,
}: {
  environment: "QA" | "production";
  existing: { id: string; name: string }[];
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [addresses, setAddresses] = useState("");
  const [admin1, setAdmin1] = useState("");
  const [admin2, setAdmin2] = useState("");
  const [preEntryGroupName, setPreEntryGroupName] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [templateEdited, setTemplateEdited] = useState(false);
  const [settings, setSettings] = useState<CreateMinistryInput["settings"]>({
    app_subtitle: "Servant Dashboard",
    logo_url: null,
    group_label: "Group",
    member_label: "Member",
    ladder_position_label: "Level",
    group_name_template: "{cohort_year} - Level {position_label}",
    university_label: "School",
    program_label: "Field of Focus",
    service_weekday: 0,
    same_day_cutoff_time: "",
    timezone: "",
    proximity_enabled: false,
    sub_coordinator_auto_servant: true,
    theme_color: "#1e3a5f",
    theme_color_light: "#2d5a7b",
    theme_color_dark: "#152a45",
  });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ code: string; name: string; hosts: string[] } | null>(null);

  function set<K extends keyof CreateMinistryInput["settings"]>(field: K, value: CreateMinistryInput["settings"][K]) {
    setSettings((prev) => {
      const next = { ...prev, [field]: value };
      // Keep the naming template in step with the position label until the
      // Church Admin edits the template by hand.
      if (field === "ladder_position_label" && !templateEdited) {
        next.group_name_template = `{cohort_year} - ${String(value).trim() || "Level"} {position_label}`;
      }
      return next;
    });
  }

  function handleCreate() {
    setError(null);
    const hosts = addresses
      .split(/[\s,]+/)
      .map((h) => h.trim())
      .filter(Boolean);
    startTransition(async () => {
      const res = await createMinistryAction({
        code,
        name,
        addresses: hosts,
        adminEmails: [admin1, admin2],
        preEntryGroupName,
        copyFrom: copyFrom || null,
        settings,
      });
      if (res.error || !res.code) {
        setError(res.error ?? "Could not create the ministry.");
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      setCreated({
        code: res.code,
        name: name.trim(),
        hosts: hosts.map((h) => h.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")),
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  if (created) {
    return (
      <section className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5 space-y-3">
        <h2 className="text-lg font-bold text-[#155724]">
          {created.name} ({created.code}) was created in {environment}.
        </h2>
        <p className="text-sm text-[#666]">Before anyone can use it, finish these steps (about 10 minutes):</p>
        <ol className="list-decimal pl-5 space-y-2 text-sm text-[#333]">
          <li>
            <strong>Vercel:</strong> in the {environment} project, <em>Settings &rarr; Domains</em>, add{" "}
            {created.hosts.length > 0 ? created.hosts.join(", ") : "its address"}.
          </li>
          <li>
            <strong>Supabase:</strong> in <em>Authentication &rarr; URL Configuration</em>, add each address to the
            Redirect URLs, listed exactly (e.g. <code>{`https://${created.hosts[0] ?? "the-address"}/**`}</code>). Never use a
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
        <div className="flex flex-wrap gap-3 pt-1">
          {created.hosts.map((h) => (
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
          <Link href="/console" className="text-sm font-semibold text-brand hover:underline">
            Back to Ministries
          </Link>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded-md bg-[#f8d7da] px-3 py-2 text-sm text-[#721c24]">{error}</p>}

      <section className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
        <h2 className="text-lg font-bold text-brand mb-3">The ministry</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="text-xs text-[#666]">
            Code (3 letters, permanent)
            <input
              value={code}
              maxLength={3}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
              placeholder="e.g. HSM"
              className={`${inputClass} font-mono font-bold tracking-widest`}
            />
          </label>
          <label className="text-xs text-[#666] sm:col-span-2">
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. High School Ministry"
              className={inputClass}
            />
          </label>
          <label className="text-xs text-[#666] sm:col-span-3">
            {environment} web address(es) &mdash; one per line
            <textarea
              value={addresses}
              onChange={(e) => setAddresses(e.target.value)}
              rows={2}
              placeholder={environment === "QA" ? "e.g. highschool-ministry-qa.vercel.app" : "e.g. highschool-ministry.vercel.app"}
              className={inputClass}
            />
          </label>
          <label className="text-xs text-[#666] sm:col-span-3">
            Subtitle
            <input value={settings.app_subtitle} onChange={(e) => set("app_subtitle", e.target.value)} className={inputClass} />
          </label>
          <label className="text-xs text-[#666] sm:col-span-3">
            Logo URL (optional &mdash; can be added later in App Settings)
            <input
              value={settings.logo_url ?? ""}
              onChange={(e) => set("logo_url", e.target.value || null)}
              className={inputClass}
            />
          </label>
        </div>
      </section>

      <section className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
        <h2 className="text-lg font-bold text-brand mb-1">First Admins (optional)</h2>
        <p className="text-sm text-[#666] mb-3">
          Leave both blank and <strong>you</strong> become the first Admin (you already have full access as Church
          Admin). Add the ministry&rsquo;s own Admins later: once they&rsquo;ve signed in at its address, use its Access
          Maintenance &rarr; &ldquo;Add existing account by email&rdquo;, or approve their registration in Pending
          Servants and grant System Admin. Only enter someone here who has already signed in to the app.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-xs text-[#666]">
            Admin email (optional)
            <input
              type="email"
              value={admin1}
              onChange={(e) => setAdmin1(e.target.value)}
              placeholder="Blank = you"
              className={inputClass}
            />
          </label>
          <label className="text-xs text-[#666]">
            Second Admin email (optional)
            <input type="email" value={admin2} onChange={(e) => setAdmin2(e.target.value)} className={inputClass} />
          </label>
        </div>
      </section>

      <section className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
        <h2 className="text-lg font-bold text-brand mb-3">Vocabulary and groups</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-xs text-[#666]">
            Group label (e.g. &ldquo;Grade&rdquo;, &ldquo;Class&rdquo;)
            <input value={settings.group_label} onChange={(e) => set("group_label", e.target.value)} className={inputClass} />
          </label>
          <label className="text-xs text-[#666]">
            Member label (e.g. &ldquo;Student&rdquo;, &ldquo;Child&rdquo;)
            <input value={settings.member_label} onChange={(e) => set("member_label", e.target.value)} className={inputClass} />
          </label>
          <label className="text-xs text-[#666]">
            Position label (e.g. &ldquo;Grade&rdquo;, &ldquo;Level&rdquo;)
            <input
              value={settings.ladder_position_label}
              onChange={(e) => set("ladder_position_label", e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="text-xs text-[#666]">
            Group name template
            <input
              value={settings.group_name_template}
              onChange={(e) => {
                setTemplateEdited(true);
                set("group_name_template", e.target.value);
              }}
              className={`${inputClass} font-mono`}
            />
            <span className="mt-0.5 block text-[11px] text-[#999]">
              {"{cohort_year}"} and {"{position_label}"} (the position number) are filled in by Group Transition.
            </span>
          </label>
          <label className="text-xs text-[#666]">
            School label
            <input value={settings.university_label} onChange={(e) => set("university_label", e.target.value)} className={inputClass} />
          </label>
          <label className="text-xs text-[#666]">
            Field of focus label
            <input value={settings.program_label} onChange={(e) => set("program_label", e.target.value)} className={inputClass} />
          </label>
          <label className="text-xs text-[#666] sm:col-span-2">
            Name of the first (pre-entry) group
            <input
              value={preEntryGroupName}
              onChange={(e) => setPreEntryGroupName(e.target.value)}
              placeholder="e.g. 2027 Grade 9 (incoming)"
              className={inputClass}
            />
            <span className="mt-0.5 block text-[11px] text-[#999]">
              More groups are added afterwards from the ministry&rsquo;s App Settings.
            </span>
          </label>
        </div>
      </section>

      <section className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
        <h2 className="text-lg font-bold text-brand mb-3">Schedule</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="text-xs text-[#666]">
            Service day
            <select
              value={settings.service_weekday}
              onChange={(e) => set("service_weekday", Number(e.target.value))}
              className={inputClass}
            >
              <option value={0}>Choose...</option>
              {WEEKDAY_LABELS.map((label, i) => (
                <option key={label} value={i + 1}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[#666]">
            Same-day cutoff time
            <input
              type="time"
              value={settings.same_day_cutoff_time}
              onChange={(e) => set("same_day_cutoff_time", e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="text-xs text-[#666]">
            Timezone (IANA name)
            <input
              value={settings.timezone}
              onChange={(e) => set("timezone", e.target.value)}
              placeholder="e.g. America/Toronto"
              className={inputClass}
            />
          </label>
        </div>
      </section>

      <section className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
        <h2 className="text-lg font-bold text-brand mb-3">Options and colours</h2>
        <div className="space-y-2 mb-3">
          <label className="flex items-center gap-2 text-sm text-[#333]">
            <input
              type="checkbox"
              checked={settings.proximity_enabled}
              onChange={(e) => set("proximity_enabled", e.target.checked)}
            />
            Use proximity (Local / Regional / Abroad)
          </label>
          <label className="flex items-center gap-2 text-sm text-[#333]">
            <input
              type="checkbox"
              checked={settings.sub_coordinator_auto_servant}
              onChange={(e) => set("sub_coordinator_auto_servant", e.target.checked)}
            />
            Coordinators automatically become Servants
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {(
            [
              ["theme_color", "Theme colour"],
              ["theme_color_light", "Theme colour, light"],
              ["theme_color_dark", "Theme colour, dark"],
            ] as const
          ).map(([field, label]) => (
            <label key={field} className="text-xs text-[#666]">
              {label}
              <span className="mt-1 flex items-center gap-2">
                <input
                  type="color"
                  value={settings[field]}
                  onChange={(e) => set(field, e.target.value)}
                  className="h-8 w-10 cursor-pointer rounded border border-[#ddd] bg-white p-0.5"
                />
                <input
                  value={settings[field]}
                  onChange={(e) => set(field, e.target.value)}
                  className="w-full rounded-md border border-[#ddd] px-2 py-1.5 text-sm font-mono focus:border-brand focus:outline-none"
                />
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
        <h2 className="text-lg font-bold text-brand mb-1">Starting content (optional)</h2>
        <p className="text-sm text-[#666] mb-3">
          Copy the Bible verses and holiday rules from an existing ministry. They&rsquo;re copies &mdash; editing them
          later never affects the original.
        </p>
        <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} className={inputClass}>
          <option value="">Don&rsquo;t copy anything</option>
          {existing.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.id})
            </option>
          ))}
        </select>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleCreate}
          disabled={pending}
          className="rounded-md bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.15)]"
        >
          {pending ? "Creating..." : "Create ministry"}
        </button>
        <span className="text-xs text-[#666]">The code can&rsquo;t be changed afterwards.</span>
      </div>
    </div>
  );
}
