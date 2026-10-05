"use client";

import { useState, useTransition } from "react";
import type { ActionsNeededConfigRow, AppSettingsFormInput, AdminGroupRow } from "@/app/admin/actions-needed-config/actions";
import {
  updateActionsNeededConfigAction,
  updateActionsNeededLookbackAction,
  updateAttendanceWindowSettingsAction,
  updateAppSettingsAction,
} from "@/app/admin/actions-needed-config/actions";
import { UploadLogoModal } from "@/components/admin/UploadLogoModal";
import { ThemePalettePicker } from "@/components/admin/ThemePalettePicker";
import type { AttendanceWindowSettings } from "@/lib/app-settings";
import { GroupNamesInteractive } from "@/components/admin/GroupNamesInteractive";
import { levelText } from "@/lib/group-names";
import { LOCK_MINUTE_CHOICES } from "@/lib/screen-lock";

// ISO weekday numbering (Monday=1..Sunday=7), matching app_settings.service_weekday.
const WEEKDAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function ActionsNeededConfigInteractive({
  ministryCode,
  initial,
  initialWindowSettings,
  initialAppSettings,
  initialGroups,
  initialLookbackMonths,
  initialServantsQrColor,
  initialDefaultPattern,
  initialTerminalPattern,
}: {
  ministryCode: string;
  initial: ActionsNeededConfigRow[];
  initialWindowSettings: AttendanceWindowSettings;
  initialAppSettings: AppSettingsFormInput;
  initialGroups: AdminGroupRow[];
  initialLookbackMonths: number;
  initialServantsQrColor: string;
  initialDefaultPattern: string | null;
  initialTerminalPattern: string;
}) {
  const [rows, setRows] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [savedProximity, setSavedProximity] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [windowSettings, setWindowSettings] = useState(initialWindowSettings);
  const [windowSaved, setWindowSaved] = useState(false);
  const [windowError, setWindowError] = useState<string | null>(null);

  const [appSettings, setAppSettings] = useState<AppSettingsFormInput>(initialAppSettings);
  const [appSettingsSaved, setAppSettingsSaved] = useState(false);
  const [appSettingsError, setAppSettingsError] = useState<string | null>(null);

  const [showLogoUpload, setShowLogoUpload] = useState(false);
  const [logoMessage, setLogoMessage] = useState<string | null>(null);

  function handleLogoUploaded(logoUrl: string) {
    // Keep the form in step, so a later Save on this card keeps the new logo.
    updateAppField("logo_url", logoUrl);
    setShowLogoUpload(false);
    setLogoMessage("Uploaded. The new logo now shows across the app.");
  }

  const [lookbackMonths, setLookbackMonths] = useState(initialLookbackMonths);
  const [lookbackSaved, setLookbackSaved] = useState(false);
  const [lookbackError, setLookbackError] = useState<string | null>(null);

  function handleSaveLookback() {
    setLookbackError(null);
    setLookbackSaved(false);
    startTransition(async () => {
      const res = await updateActionsNeededLookbackAction(lookbackMonths);
      if (res.error) {
        setLookbackError(res.error);
        return;
      }
      setLookbackSaved(true);
    });
  }

  function updateAppField<K extends keyof AppSettingsFormInput>(field: K, value: AppSettingsFormInput[K]) {
    setAppSettings((prev) => ({ ...prev, [field]: value }));
  }

  // Proximity off: everyone is Local, so the Local row is the only set of
  // thresholds that can ever apply.
  const visibleRows = appSettings.proximity_enabled ? rows : rows.filter((r) => r.proximity === "Local");

  function handleSaveAppSettings() {
    setAppSettingsError(null);
    setAppSettingsSaved(false);
    const universityLabel = appSettings.university_label.trim();
    const programLabel = appSettings.program_label.trim();
    const positionLabel = appSettings.ladder_position_label.trim();
    if (!universityLabel || !programLabel || !positionLabel) {
      setAppSettingsError("The position, school and field-of-focus labels can't be blank.");
      return;
    }
    startTransition(async () => {
      const res = await updateAppSettingsAction({
        ...appSettings,
        university_label: universityLabel,
        program_label: programLabel,
        ladder_position_label: positionLabel,
      });
      if (res.error) {
        setAppSettingsError(res.error);
        return;
      }
      setAppSettingsSaved(true);
    });
  }

  function handleSaveWindows() {
    setWindowError(null);
    setWindowSaved(false);
    startTransition(async () => {
      const res = await updateAttendanceWindowSettingsAction(windowSettings);
      if (res.error) {
        setWindowError(res.error);
        return;
      }
      setWindowSaved(true);
    });
  }

  function updateField(proximity: string, field: keyof ActionsNeededConfigRow, value: number) {
    setRows((prev) => prev.map((r) => (r.proximity === proximity ? { ...r, [field]: value } : r)));
  }

  function handleSave(row: ActionsNeededConfigRow) {
    setError(null);
    setSavedProximity(null);
    startTransition(async () => {
      const res = await updateActionsNeededConfigAction(row);
      if (res.error) {
        setError(res.error);
        return;
      }
      setSavedProximity(row.proximity);
    });
  }

  return (
    <div className="space-y-4">
    {/* MULTI_TENANT_PLAN.md D0 -- the ministry's permanent 3-letter code,
        shown read-only; it's chosen once, when the ministry is created. */}
    <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] px-5 py-4 flex items-center justify-between gap-3">
      <div>
        <h2 className="text-sm font-bold text-brand">Ministry Code</h2>
        <p className="text-xs text-[#666]">Permanent &mdash; it can&rsquo;t be changed.</p>
      </div>
      <span className="rounded-md bg-[#f0f4f8] px-3 py-1.5 font-mono text-base font-bold tracking-widest text-brand">
        {ministryCode}
      </span>
    </div>

    <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
      <h2 className="text-lg font-bold text-brand mb-1">App Labels</h2>
      <p className="text-sm text-[#666] mb-4">
        The app&rsquo;s names and vocabulary, used everywhere they&rsquo;re displayed &mdash; e.g. Ministry Label
        &ldquo;High School Ministry&rdquo;, Group Label &ldquo;Grade&rdquo;, Member Label &ldquo;Student&rdquo;
        &mdash; plus the service day and time settings.
      </p>
      {appSettingsError && <p className="mb-3 text-sm text-[#dc3545]">{appSettingsError}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <label className="text-xs text-[#666]">
          Ministry Label (long title)
          <input
            value={appSettings.app_title_long}
            onChange={(e) => updateAppField("app_title_long", e.target.value)}
            className="mt-1 w-full rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
          />
        </label>
        <label className="text-xs text-[#666]">
          Ministry Label (short title)
          <input
            value={appSettings.app_title_short}
            onChange={(e) => updateAppField("app_title_short", e.target.value)}
            className="mt-1 w-full rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
          />
        </label>
        <label className="text-xs text-[#666]">
          Dashboard Subtitle
          <input
            value={appSettings.app_subtitle}
            onChange={(e) => updateAppField("app_subtitle", e.target.value)}
            className="mt-1 w-full rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
          />
        </label>
        <label className="text-xs text-[#666]">
          Group Label (e.g. &ldquo;Cohort&rdquo;, &ldquo;Grade&rdquo;, &ldquo;Class&rdquo;)
          <input
            value={appSettings.group_label}
            onChange={(e) => updateAppField("group_label", e.target.value)}
            className="mt-1 w-full rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
          />
        </label>
        <label className="text-xs text-[#666]">
          Member Label (e.g. &ldquo;Youth&rdquo;, &ldquo;Student&rdquo;, &ldquo;Child&rdquo;)
          <input
            value={appSettings.member_label}
            onChange={(e) => updateAppField("member_label", e.target.value)}
            className="mt-1 w-full rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
          />
        </label>
        <label className="text-xs text-[#666]">
          Position Label (e.g. &ldquo;Yr&rdquo;, &ldquo;Grade&rdquo;, &ldquo;Level&rdquo;)
          <input
            value={appSettings.ladder_position_label}
            onChange={(e) => updateAppField("ladder_position_label", e.target.value)}
            className="mt-1 w-full rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
          />
        </label>
        <label className="text-xs text-[#666]">
          Number of the first level (e.g. 1, or 9 for Grade 9)
          <input
            type="number"
            min={1}
            max={51}
            value={appSettings.level_number_offset + 1}
            onChange={(e) => updateAppField("level_number_offset", Math.max(0, Number(e.target.value) - 1))}
            className="mt-1 w-full rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
          />
          <span className="mt-1 block text-[11px] text-[#999]">
            Levels display as {levelText(1, appSettings.ladder_position_label, appSettings.level_number_offset)},{" "}
            {levelText(2, appSettings.ladder_position_label, appSettings.level_number_offset)}…
          </span>
        </label>
        <label className="text-xs text-[#666]">
          School Label (e.g. &ldquo;University/College&rdquo;, &ldquo;School&rdquo;)
          <input
            value={appSettings.university_label}
            onChange={(e) => updateAppField("university_label", e.target.value)}
            className="mt-1 w-full rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
          />
        </label>
        <label className="text-xs text-[#666]">
          Field of Focus Label (e.g. &ldquo;Program of Study&rdquo;)
          <input
            value={appSettings.program_label}
            onChange={(e) => updateAppField("program_label", e.target.value)}
            className="mt-1 w-full rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
          />
        </label>
        <label className="text-xs text-[#666]">
          Service Day
          <select
            value={appSettings.service_weekday}
            onChange={(e) => updateAppField("service_weekday", Number(e.target.value))}
            className="mt-1 w-full rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
          >
            {WEEKDAY_LABELS.map((label, i) => (
              <option key={label} value={i + 1}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[#666]">
          Same-Day Cutoff Time
          <input
            type="time"
            value={appSettings.same_day_cutoff_time.slice(0, 5)}
            onChange={(e) => updateAppField("same_day_cutoff_time", e.target.value)}
            className="mt-1 w-full rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
          />
        </label>
        <label className="text-xs text-[#666]">
          Timezone (IANA name)
          <input
            value={appSettings.timezone}
            onChange={(e) => updateAppField("timezone", e.target.value)}
            placeholder="e.g. America/Toronto"
            className="mt-1 w-full rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
          />
        </label>
        <label className="text-xs text-[#666]">
          Check-in opens
          <input
            type="time"
            value={appSettings.checkin_opens_at.slice(0, 5)}
            onChange={(e) => updateAppField("checkin_opens_at", e.target.value)}
            className="mt-1 w-full rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
          />
        </label>
        <label className="text-xs text-[#666]">
          Check-in closes
          <input
            type="time"
            value={appSettings.checkin_closes_at.slice(0, 5)}
            onChange={(e) => updateAppField("checkin_closes_at", e.target.value)}
            className="mt-1 w-full rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
          />
        </label>
      </div>
      <p className="text-xs text-[#666] mb-3">
        Service Day drives self-check-in gating and which dates count toward average attendance %. The Cutoff Time
        and Timezone together control when &ldquo;Today&rdquo; becomes available in the Attendance tab — it opens as
        soon as either someone has checked in, or the cutoff time passes, whichever comes first. The QR check-in
        page only lets people find their name and check in on the Service Day, between Check-in opens and Check-in
        closes (00:00 to 23:59 = the whole day). All of these take effect immediately, everywhere.
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSaveAppSettings}
          disabled={pending}
          className="rounded-md bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          Save
        </button>
        {appSettingsSaved && <span className="text-xs text-[#155724]">Saved.</span>}
      </div>
    </div>

    <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
      <h2 className="text-lg font-bold text-brand mb-1">App Branding</h2>
      <p className="text-sm text-[#666] mb-4">
        The app&rsquo;s colours and logo, used on every page. Pick a palette and preview it, then Save.
      </p>
      {appSettingsError && <p className="mb-3 text-sm text-[#dc3545]">{appSettingsError}</p>}
      <div className="space-y-3 mb-3">
        <ThemePalettePicker
          colors={{
            theme_color: appSettings.theme_color,
            theme_color_light: appSettings.theme_color_light,
            theme_color_dark: appSettings.theme_color_dark,
            my_assigned_header_color: appSettings.my_assigned_header_color,
            my_assigned_header_color_light: appSettings.my_assigned_header_color_light,
          }}
          onChange={(colors) => setAppSettings((prev) => ({ ...prev, ...colors }))}
        />
        <div className="rounded-md border border-[#eee] p-3 space-y-2">
          <p className="text-xs font-semibold text-[#333]">Logo</p>
          <div className="flex flex-wrap items-center gap-3">
            {appSettings.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- small preview of a remote branding image
              <img
                src={appSettings.logo_url}
                alt="Current logo"
                className="h-14 w-14 rounded-full bg-white object-contain p-1 shadow-[0_2px_6px_rgba(0,0,0,0.15)]"
              />
            ) : (
              <span className="text-xs text-[#999]">No logo yet</span>
            )}
            <button
              type="button"
              onClick={() => {
                setLogoMessage(null);
                setShowLogoUpload(true);
              }}
              className="rounded-md bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark"
            >
              {appSettings.logo_url ? "Upload new logo" : "Upload logo"}
            </button>
          </div>
          {logoMessage && <p className="text-xs text-[#155724]">{logoMessage}</p>}
          {showLogoUpload && (
            <UploadLogoModal onClose={() => setShowLogoUpload(false)} onUploaded={handleLogoUploaded} />
          )}
          <label className="block text-xs text-[#666]">
            Or paste an image address (blank = no logo, then Save)
            <input
              value={appSettings.logo_url ?? ""}
              onChange={(e) => updateAppField("logo_url", e.target.value === "" ? null : e.target.value)}
              className="mt-1 w-full rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
            />
          </label>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSaveAppSettings}
          disabled={pending}
          className="rounded-md bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          Save
        </button>
        {appSettingsSaved && <span className="text-xs text-[#155724]">Saved.</span>}
      </div>
    </div>

    <GroupNamesInteractive
      key={JSON.stringify([initialGroups, initialServantsQrColor, initialDefaultPattern, initialTerminalPattern])}
      initial={initialGroups}
      positionLabel={appSettings.ladder_position_label}
      levelOffset={appSettings.level_number_offset}
      groupLabel={appSettings.group_label}
      initialServantsQrColor={initialServantsQrColor}
      initialDefaultPattern={initialDefaultPattern}
      initialTerminalPattern={initialTerminalPattern}
    />

    <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
      <h2 className="text-lg font-bold text-brand mb-1">Coordinators</h2>
      <p className="text-sm text-[#666] mb-3">
        When on, making someone Coordinator of a {appSettings.group_label.toLowerCase()} also makes them a Servant
        of that {appSettings.group_label.toLowerCase()} automatically. Changing this only affects grants made from now
        on; existing roles are left as they are.
      </p>
      <label className="flex items-center gap-2 text-sm text-[#333] mb-3">
        <input
          type="checkbox"
          checked={appSettings.sub_coordinator_auto_servant}
          onChange={(e) => updateAppField("sub_coordinator_auto_servant", e.target.checked)}
        />
        Coordinators automatically become Servants
      </label>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSaveAppSettings}
          disabled={pending}
          className="rounded-md bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          Save
        </button>
        {appSettingsSaved && <span className="text-xs text-[#155724]">Saved.</span>}
      </div>
    </div>

    {/* Owner-approved (5 Oct 2026, migration 0089): the screen lock. */}
    <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
      <h2 className="text-lg font-bold text-brand mb-1">Screen Lock</h2>
      <p className="text-sm text-[#666] mb-3">
        Locks the app on a servant&rsquo;s phone or computer after a few minutes without use, so nobody who picks it up can
        see {appSettings.member_label.toLowerCase()} details. It also hides the app while it&rsquo;s in the background.
        Servants unlock it with Face ID, a fingerprint or their device&rsquo;s PIN (once they turn that on in Account
        Security), their authenticator code, or by signing in again. Applies to everyone, Admins and GCs included.
      </p>
      <label className="flex items-center gap-2 text-sm text-[#333] mb-3">
        Lock after
        <select
          value={appSettings.idle_lock_minutes ?? ""}
          onChange={(e) => updateAppField("idle_lock_minutes", e.target.value === "" ? null : Number(e.target.value))}
          className="rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
        >
          <option value="">Off</option>
          {LOCK_MINUTE_CHOICES.map((m) => (
            <option key={m} value={m}>
              {m} minutes
            </option>
          ))}
        </select>
        without use
      </label>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSaveAppSettings}
          disabled={pending}
          className="rounded-md bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          Save
        </button>
        {appSettingsSaved && <span className="text-xs text-[#155724]">Saved.</span>}
      </div>
    </div>

    {/* Owner-requested (4 Oct 2026, migration 0087): for ministries that
        keep parents' details, e.g. High School and Sunday School. */}
    <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
      <h2 className="text-lg font-bold text-brand mb-1">Parents&rsquo; Contact Details</h2>
      <p className="text-sm text-[#666] mb-3">
        When on, each {appSettings.member_label.toLowerCase()}&rsquo;s details include Parent 1 and Parent 2 (name,
        phone and email), all optional. Servants see and edit them like the other details, the check-in
        page&rsquo;s registration form asks for them, and after checking in a {appSettings.member_label.toLowerCase()}{" "}
        is offered to fill in any that are blank. Turning it off hides them everywhere; anything already entered is
        kept.
      </p>
      <label className="flex items-center gap-2 text-sm text-[#333] mb-3">
        <input
          type="checkbox"
          checked={appSettings.show_parent_contacts}
          onChange={(e) => updateAppField("show_parent_contacts", e.target.checked)}
        />
        Keep parents&rsquo; contact details
      </label>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSaveAppSettings}
          disabled={pending}
          className="rounded-md bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          Save
        </button>
        {appSettingsSaved && <span className="text-xs text-[#155724]">Saved.</span>}
      </div>
    </div>

    <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
      <h2 className="text-lg font-bold text-brand mb-1">Current Birthdays Window</h2>
      <p className="text-sm text-[#666] mb-4">
        How many days before and after today a birthday counts as &ldquo;upcoming&rdquo; on the Dashboard.
      </p>
      {appSettingsError && <p className="mb-3 text-sm text-[#dc3545]">{appSettingsError}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <label className="text-xs text-[#666]">
          Days before today
          <input
            type="number"
            min={0}
            value={appSettings.birthday_window_days_before}
            onChange={(e) => updateAppField("birthday_window_days_before", Number(e.target.value))}
            className="mt-1 w-full rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
          />
        </label>
        <label className="text-xs text-[#666]">
          Days after today
          <input
            type="number"
            min={0}
            value={appSettings.birthday_window_days_after}
            onChange={(e) => updateAppField("birthday_window_days_after", Number(e.target.value))}
            className="mt-1 w-full rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
          />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSaveAppSettings}
          disabled={pending}
          className="rounded-md bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          Save
        </button>
        {appSettingsSaved && <span className="text-xs text-[#155724]">Saved.</span>}
      </div>
    </div>

    <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
      <h2 className="text-lg font-bold text-brand mb-1">Attendance Window Settings</h2>
      <p className="text-sm text-[#666] mb-1">How far back average-attendance % looks, as a rolling number of weeks.</p>
      <ul className="text-sm text-[#666] mb-4 list-disc pl-5 space-y-0.5">
        <li>
          The app calculates it based on the <strong>later</strong> of (today &minus; the rolling window) and each
          person&rsquo;s Join Date (their earliest attendance record) &mdash; so the window never reaches before they
          joined.
        </li>
        <li>Leave a field blank to calculate over that group&rsquo;s entire attendance history instead, with no rolling cap.</li>
        <li>{appSettings.member_label}s and servants are configured independently.</li>
      </ul>
      {windowError && <p className="mb-3 text-sm text-[#dc3545]">{windowError}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <label className="text-xs text-[#666]">
          {appSettings.member_label} attendance window (weeks, blank = no cap)
          <input
            type="number"
            min={1}
            value={windowSettings.youth_attendance_window_weeks ?? ""}
            onChange={(e) =>
              setWindowSettings((prev) => ({
                ...prev,
                youth_attendance_window_weeks: e.target.value === "" ? null : Number(e.target.value),
              }))
            }
            className="mt-1 w-full rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
          />
        </label>
        <label className="text-xs text-[#666]">
          Servant attendance window (weeks, blank = no cap)
          <input
            type="number"
            min={1}
            value={windowSettings.servant_attendance_window_weeks ?? ""}
            onChange={(e) =>
              setWindowSettings((prev) => ({
                ...prev,
                servant_attendance_window_weeks: e.target.value === "" ? null : Number(e.target.value),
              }))
            }
            className="mt-1 w-full rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
          />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSaveWindows}
          disabled={pending}
          className="rounded-md bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          Save
        </button>
        {windowSaved && <span className="text-xs text-[#155724]">Saved.</span>}
      </div>
    </div>

    <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
      <h2 className="text-lg font-bold text-brand mb-1">Proximity</h2>
      <p className="text-sm text-[#666] mb-3">
        Tags each {appSettings.university_label.toLowerCase()} as Local, Regional or Abroad, so people can be shown,
        filtered and judged by different Actions Needed thresholds. Turn it off for a group where everyone is local:
        every {appSettings.member_label.toLowerCase()} is then treated as Local, only one set of thresholds applies, and
        all proximity badges, filters, columns and charts are hidden.
      </p>
      <div className="space-y-2 mb-3">
        <label className="flex items-center gap-2 text-sm text-[#333]">
          <input
            type="checkbox"
            checked={appSettings.proximity_enabled}
            onChange={(e) => updateAppField("proximity_enabled", e.target.checked)}
          />
          Use proximity (Local / Regional / Abroad)
        </label>
        <label
          className={`flex items-center gap-2 text-sm ${appSettings.proximity_enabled ? "text-[#333]" : "text-[#999]"}`}
        >
          <input
            type="checkbox"
            checked={appSettings.proximity_enabled && appSettings.show_proximity_on_attendance}
            disabled={!appSettings.proximity_enabled}
            onChange={(e) => updateAppField("show_proximity_on_attendance", e.target.checked)}
          />
          Show the Proximity column on the Attendance tab
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSaveAppSettings}
          disabled={pending}
          className="rounded-md bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          Save
        </button>
        {appSettingsSaved && <span className="text-xs text-[#155724]">Saved.</span>}
      </div>
    </div>

    <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
      <h2 className="text-lg font-bold text-brand mb-1">Actions Needed Thresholds</h2>
      <p className="text-sm text-[#666] mb-2">
        {appSettings.proximity_enabled ? "Per-proximity thresholds" : "Thresholds"} for the Dashboard&rsquo;s &ldquo;Outreach Needed&rdquo; cards. A member is flagged
        once, as of today, their current run of consecutive absences has reached the minimum below, and their most
        recent outreach (or lack of any) is older than the outreach-staleness window.
      </p>
      <p className="text-sm text-[#666] mb-4">
        These cards clear themselves automatically &mdash; no one needs to dismiss them by hand. A card disappears
        the moment the member shows up again, or as soon as any servant logs a new outreach entry for them.
      </p>
      <div className="border border-[#f0f0f0] rounded-lg p-4 mb-4">
        <h3 className="text-sm font-bold text-brand mb-1">Look-back period</h3>
        <p className="text-xs text-[#666] mb-3">
          &ldquo;Min. presence count&rdquo; below counts visits over this many most recent months. Someone who
          hasn&rsquo;t attended at least that many times in this period isn&rsquo;t flagged.
        </p>
        {lookbackError && <p className="mb-2 text-sm text-[#dc3545]">{lookbackError}</p>}
        <div className="flex items-end gap-3">
          <label className="text-xs text-[#666]">
            Months
            <input
              type="number"
              min={1}
              max={120}
              value={lookbackMonths}
              onChange={(e) => setLookbackMonths(Number(e.target.value))}
              className="mt-1 block w-24 rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={handleSaveLookback}
            disabled={pending}
            className="rounded-md bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
          >
            Save
          </button>
          {lookbackSaved && <span className="text-xs text-[#155724]">Saved.</span>}
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-[#dc3545]">{error}</p>}

      <div className="space-y-4">
        {visibleRows.map((row) => (
          <div key={row.proximity} className="border border-[#f0f0f0] rounded-lg p-4">
            <h3 className="text-sm font-bold text-brand mb-3">
              {appSettings.proximity_enabled ? row.proximity : `All ${appSettings.member_label.toLowerCase()}s`}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              <label className="text-xs text-[#666]">
                Min. presence count
                <input
                  type="number"
                  min={0}
                  value={row.min_presence_count}
                  onChange={(e) => updateField(row.proximity, "min_presence_count", Number(e.target.value))}
                  className="mt-1 w-full rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
                />
              </label>
              <label className="text-xs text-[#666]">
                Min. consecutive absences (weeks)
                <input
                  type="number"
                  min={0}
                  value={row.min_absence_weeks}
                  onChange={(e) => updateField(row.proximity, "min_absence_weeks", Number(e.target.value))}
                  className="mt-1 w-full rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
                />
              </label>
              <label className="text-xs text-[#666]">
                Outreach staleness (weeks)
                <input
                  type="number"
                  min={0}
                  value={row.min_outreach_weeks}
                  onChange={(e) => updateField(row.proximity, "min_outreach_weeks", Number(e.target.value))}
                  className="mt-1 w-full rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
                />
              </label>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => handleSave(row)}
                disabled={pending}
                className="rounded-md bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
              >
                Save
              </button>
              {savedProximity === row.proximity && <span className="text-xs text-[#155724]">Saved.</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
    </div>
  );
}
