"use client";

import { useMemo, useState } from "react";
import type { ServantTeamRow } from "@/lib/servant-team";
import { servantPhotoUrl } from "@/lib/storage";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { PhoneLink } from "@/components/PhoneLink";
import { COORDINATOR_CHIP } from "@/components/ServantTotals";
import { useRoleLabels } from "@/components/RoleLabelsProvider";
import { useTimezone } from "@/components/TimezoneProvider";
import { formatDateTimeInZone } from "@/lib/timezone";
import { ChevronDownIcon, UserCheckIcon } from "@/components/icons";

/** Owner-requested (15 Oct 2026, migration 0116) -- "My Servants Team", at
 * the top of the Dashboard for Coordinators and General Coordinators. One
 * summary line (always shown, even collapsed); opened, the same kind of
 * cards as the youth panels: yellow for someone absent a while, grey for
 * someone who's gone quiet in the app, green for a birthday. A General
 * Coordinator or System Admin (or a Coordinator of several groups) first
 * sees one line per group and taps a group to see its cards. */

type Team = { key: string; name: string; rows: ServantTeamRow[] };

type Counts = { present: number; counted: number; absent: number; quiet: number; birthdays: number; lastService: string | null };

/** Each person once, even when they serve in two groups. */
function countPeople(rows: ServantTeamRow[], absenceWeeks: number): Counts {
  const seen = new Map<string, ServantTeamRow>();
  for (const r of rows) if (!seen.has(r.person_id)) seen.set(r.person_id, r);
  const people = Array.from(seen.values());
  return {
    present: people.filter((p) => p.present_last).length,
    counted: people.filter((p) => p.counted_last).length,
    absent: people.filter((p) => p.absent_weeks >= absenceWeeks).length,
    quiet: people.filter((p) => p.quiet).length,
    birthdays: people.filter((p) => p.birthday_offset !== null).length,
    lastService: rows.find((r) => r.last_service)?.last_service ?? null,
  };
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function birthdayLabel(month: number, day: number) {
  return new Date(2000, month - 1, day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("");
}

function Avatar({ row }: { row: ServantTeamRow }) {
  const url = servantPhotoUrl(row.photo_path);
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img loading="lazy" src={url} alt={row.full_name} className="h-10 w-10 rounded-full object-cover shrink-0" />
  ) : (
    <div className="h-10 w-10 shrink-0 rounded-full bg-brand text-white text-xs font-bold flex items-center justify-center">
      {initials(row.full_name)}
    </div>
  );
}

export function MyServantsTeam({
  rows,
  isGeneralCoordinator,
  absenceWeeks,
  quietDays,
  defaultOpen,
}: {
  rows: ServantTeamRow[];
  isGeneralCoordinator: boolean;
  absenceWeeks: number;
  quietDays: number;
  defaultOpen: boolean;
}) {
  const L = useRoleLabels();
  const timeZone = useTimezone();
  const [openTeams, setOpenTeams] = useState<Set<string>>(new Set());

  const teams = useMemo(() => {
    const byKey = new Map<string, Team>();
    for (const r of rows) {
      const key = r.group_id ?? "unassigned";
      if (!byKey.has(key)) byKey.set(key, { key, name: r.group_name ?? "Unassigned", rows: [] });
      byKey.get(key)!.rows.push(r);
    }
    return Array.from(byKey.values());
  }, [rows]);

  if (rows.length === 0) return null;

  const total = countPeople(rows, absenceWeeks);
  const parts: string[] = [];
  if (total.lastService && total.counted > 0) parts.push(`${total.present} of ${total.counted} attended last week`);
  if (total.absent > 0) parts.push(`${total.absent} absent ${absenceWeeks}+ weeks`);
  if (total.quiet > 0) parts.push(`${total.quiet} quiet`);
  if (total.birthdays > 0) parts.push(plural(total.birthdays, "birthday"));
  const summary = `${L.servants}: ${parts.length > 0 ? parts.join(", ") : "nothing needs attention"}`;

  const byTeam = isGeneralCoordinator || teams.length > 1;

  function toggleTeam(key: string) {
    setOpenTeams((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Owner-approved (15 Oct 2026): gentle wording -- care, not monitoring.
  function seenLine(r: ServantTeamRow) {
    return r.last_seen_at
      ? `Haven't seen them in the app since ${formatDateTimeInZone(r.last_seen_at, timeZone, { month: "short", day: "numeric" })}`
      : "Haven't seen them in the app yet";
  }

  function nameLine(r: ServantTeamRow) {
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <p className="min-w-0 overflow-hidden whitespace-nowrap font-semibold text-[#333]">{r.full_name}</p>
        {r.is_coordinator && <span className={COORDINATOR_CHIP}>{L.coordinator}</span>}
      </div>
    );
  }

  function cards(teamRows: ServantTeamRow[]) {
    const absent = teamRows.filter((r) => r.absent_weeks >= absenceWeeks);
    // Owner-requested (15 Oct 2026): someone both absent and quiet gets both cards.
    const quietOnly = teamRows.filter((r) => r.quiet);
    const birthdays = teamRows
      .filter((r) => r.birthday_offset !== null)
      .sort((a, b) => (a.birthday_offset ?? 0) - (b.birthday_offset ?? 0));
    if (absent.length + quietOnly.length + birthdays.length === 0) {
      return <p className="text-sm text-[#666]">Nothing needs your attention here right now.</p>;
    }
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {absent.map((r) => (
          <div key={`a-${r.person_id}`} className="rounded-lg bg-[#fff3cd] border-l-4 border-[#dc3545] p-3 flex items-center gap-3">
            <Avatar row={r} />
            <div className="min-w-0 flex-1">
              {nameLine(r)}
              <p className="text-xs text-[#721c24]">Absent for {plural(r.absent_weeks, "week")}</p>
              <PhoneLink phone={r.phone} className="text-xs" />
            </div>
          </div>
        ))}
        {quietOnly.map((r) => (
          <div key={`q-${r.person_id}`} className="rounded-lg bg-[#eceff1] border-l-4 border-[#78909c] p-3 flex items-center gap-3">
            <Avatar row={r} />
            <div className="min-w-0 flex-1">
              {nameLine(r)}
              <p className="text-xs text-[#455a64]">{seenLine(r)}</p>
              <PhoneLink phone={r.phone} className="text-xs" />
            </div>
          </div>
        ))}
        {birthdays.map((r) => (
          <div key={`b-${r.person_id}`} className="rounded-lg bg-[#e2f0d9] border-l-4 border-[#28a745] p-3 flex items-center gap-3">
            <Avatar row={r} />
            <div className="min-w-0 flex-1">
              {nameLine(r)}
              <p className="text-xs font-medium text-[#28a745]">
                {r.birthday_offset === 0 ? "Birthday today 🎂" : `Birthday ${birthdayLabel(r.birthday_month!, r.birthday_day!)}`}
              </p>
              <PhoneLink phone={r.phone} className="text-xs" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <CollapsibleSection
      id="servant-team"
      defaultOpen={defaultOpen}
      title={
        <span className="flex items-center gap-2">
          <UserCheckIcon className="h-5 w-5" /> My {L.servants} Team
        </span>
      }
      summary={summary}
    >
      <p className="mb-3 text-[11px] text-[#888]">
        Yellow: absent {absenceWeeks}+ weeks in a row. Grey: hasn&rsquo;t opened the app in {quietDays}+ days. Green: birthday.
      </p>
      {!byTeam ? (
        cards(teams[0].rows)
      ) : (
        <div className="divide-y divide-[#f0f0f0]">
          {teams.map((team) => {
            const c = countPeople(team.rows, absenceWeeks);
            const coordinators = Array.from(new Set(team.rows.filter((r) => r.is_coordinator).map((r) => r.full_name.split(" ")[0])));
            const stats: string[] = [];
            // Owner-requested (15 Oct 2026): spelled out, as in the summary line.
            if (c.lastService && c.counted > 0) stats.push(`${c.present} of ${c.counted} present last week`);
            if (c.absent > 0) stats.push(`${c.absent} absent ${absenceWeeks}+ weeks`);
            if (c.quiet > 0) stats.push(`${c.quiet} quiet`);
            if (c.birthdays > 0) stats.push(plural(c.birthdays, "birthday"));
            const open = openTeams.has(team.key);
            return (
              <div key={team.key} className="py-2">
                <button
                  type="button"
                  onClick={() => toggleTeam(team.key)}
                  aria-expanded={open}
                  className="w-full flex items-center gap-2 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <p className="overflow-hidden whitespace-nowrap text-sm font-bold text-brand">
                      {team.name}
                      {coordinators.length > 0 && <span className="font-normal text-[#666]"> ({coordinators.join(", ")})</span>}
                    </p>
                    <p className="overflow-hidden whitespace-nowrap text-xs text-[#666]">{stats.join(", ") || "No attendance yet"}</p>
                  </div>
                  <ChevronDownIcon className={`h-4 w-4 shrink-0 text-[#999] transition-transform ${open ? "rotate-180" : ""}`} />
                </button>
                {open && <div className="mt-2">{cards(team.rows)}</div>}
              </div>
            );
          })}
        </div>
      )}
    </CollapsibleSection>
  );
}
