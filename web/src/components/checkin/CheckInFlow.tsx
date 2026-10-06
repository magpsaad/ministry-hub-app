"use client";

import { useRef, useEffect, useState } from "react";
import type { CheckInPerson } from "@/lib/checkin";
import type { University } from "@/lib/universities";
import {
  searchCheckInPeopleAction,
  markMemberAttendanceAction,
  markServantAttendanceAction,
  undoMemberAttendanceAction,
  undoServantAttendanceAction,
  type MissingMemberFields,
} from "@/app/checkin/actions";
import { MemberIntakeForm } from "./MemberIntakeForm";
import { ServantIntakeForm } from "./ServantIntakeForm";
import { MissingFieldsForm } from "./MissingFieldsForm";
import { BusyLabel } from "@/components/PendingButton";

const NO_MISSING_FIELDS: MissingMemberFields = {
  phone: false,
  email: false,
  university: false,
  program: false,
  dob: false,
  fatherOfConfession: false,
  parents: {
    parent1_name: false,
    parent1_phone: false,
    parent1_email: false,
    parent2_name: false,
    parent2_phone: false,
    parent2_email: false,
  },
};

type View = "list" | "member-intake" | "servant-intake" | "success";

/** REQUIREMENTS.md §6.11/§6.12 -- the public no-login check-in page. One
 * component drives both flows (member group QR, and the "Servants" QR
 * added in Phase C) since they're structurally identical: search, tap your
 * name, done -- or "don't see your name?" into an intake form.
 *
 * Migration 0074 (owner-requested, after a congregation member's complaint):
 * the page no longer receives a list of names. Typing 3+ letters searches
 * the database, which returns at most 10 short names ("Mina H."); and it
 * only does so during check-in hours (the service day, between the
 * ministry's check-in times) -- outside them the page says when it opens,
 * and registering is still possible. */
export function CheckInFlow({
  token,
  isServant,
  flowType,
  isOpen,
  openingText,
  universities,
  universityLabel,
  programLabel,
  groupLabel,
  memberLabel,
  groupName,
  serviceDayName,
  rememberedPerson,
  showParents,
}: {
  token: string;
  isServant: boolean;
  flowType: "check_in_and_intake" | "intake_only";
  /** Migration 0074 -- whether names can be searched and attendance taken now. */
  isOpen: boolean;
  /** e.g. "Check-in opens on Fridays from 7:00 PM to 11:00 PM." */
  openingText: string;
  universities: University[];
  universityLabel: string;
  programLabel: string;
  groupLabel: string;
  memberLabel: string;
  /** The scanned QR's own group name -- "Servants" for the servant flow,
   * meaningless there since the duplicate-detection feature is member-
   * flow only. Used for the "Move my record to <groupName>" option. */
  groupName: string;
  /** Owner-reported: the "check back this Friday" message was hardcoded to
   * "Friday" regardless of the actually-configured service day. */
  serviceDayName: string;
  /** Owner-requested: whoever this device last checked in (as a servant or
   * a member/youth) with "Remember me" checked (see
   * checkin-remember-cookie.ts), as a short name, read server-side -- shown
   * as a one-tap "Check in as ..." button. Null when closed, for an
   * intake-only flow, or when this device remembers nobody here. */
  rememberedPerson: CheckInPerson | null;
  /** Migration 0087 -- this ministry keeps parents' contact details. */
  showParents: boolean;
}) {
  const [view, setView] = useState<View>(
    flowType === "intake_only" ? (isServant ? "servant-intake" : "member-intake") : "list",
  );
  const [q, setQ] = useState("");
  const [pending, setPending] = useState(false);
  const selecting = useRef(false);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const undoBusy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [successName, setSuccessName] = useState<string | null>(null);
  const [attendanceRecorded, setAttendanceRecorded] = useState(true);
  const [wasNewRegistration, setWasNewRegistration] = useState(false);
  // Owner-requested: distinguishes "brand new registration" from "matched
  // an existing record and updated it" -- both go through the same intake
  // form/success screen, but the not-tracked-today message shouldn't call
  // an existing, just-updated record a "registration."
  const [wasResolvedDuplicate, setWasResolvedDuplicate] = useState(false);
  // Owner-reported: a self-check-in mis-tap (wrong name, right next to the
  // intended one) had no way to be undone. The success screen already
  // shows the checked-in name -- a mis-tap is immediately visible there --
  // so rather than a confirm-before-every-tap dialog (friction on every
  // single check-in to guard a rare mistake), this adds a "Not you? Undo"
  // action on that screen instead. checkedInPerson carries what's needed
  // to call the matching undo action; canUndo is only true when this tap
  // actually created today's record (never when it already existed --
  // e.g. someone else already checked this person in), so undo can never
  // remove a record this tap didn't create. Only wired up for the tap-a-
  // name list, not the "don't see your name?" registration flow, which is
  // out of scope here.
  const [checkedInPerson, setCheckedInPerson] = useState<CheckInPerson | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [undoing, setUndoing] = useState(false);
  // Owner-requested: right after "Not you? Undo", offer to fill in whichever
  // of this member's own fields are currently blank. Member/youth flow only
  // -- never shown for servants, and never after a fresh registration (the
  // intake form just collected everything already).
  const [missingFields, setMissingFields] = useState<MissingMemberFields>(NO_MISSING_FIELDS);
  const [showMissingFields, setShowMissingFields] = useState(false);
  // Owner-requested: "Remember me on this device" -- checked by default, so
  // tapping your own (already pre-highlighted) name needs no extra step;
  // someone checking in a DIFFERENT person unchecks it first so that tap
  // doesn't overwrite whoever this device already remembers. Stays
  // unchecked across multiple taps in the same visit once someone
  // deliberately unchecks it (no silent revert to checked mid-session).
  const [remember, setRemember] = useState(true);
  // Lets "Not you? Undo" restore exactly what this device remembered
  // before a mis-tap changed it (see markServantAttendanceAction).
  const [rememberRestore, setRememberRestore] = useState<{ rememberedCookieWritten: boolean; previousRemembered: string | null } | null>(
    null,
  );

  // Migration 0074: the database is searched as she types (3+ letters,
  // short names, at most 10) -- the page never holds the whole list.
  const [results, setResults] = useState<CheckInPerson[]>([]);
  const [searching, setSearching] = useState(false);
  const [closed, setClosed] = useState(!isOpen);
  const letters = q.replace(/[^\p{L}]/gu, "").length;
  useEffect(() => {
    if (closed || letters < 3) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      const res = await searchCheckInPeopleAction(token, q, isServant);
      if (cancelled) return;
      setSearching(false);
      setResults(res.people);
      if (res.closed) setClosed(true);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, letters, closed, token, isServant]);
  const shown = letters >= 3 ? results : [];

  async function handleSelect(person: CheckInPerson) {
    // Owner-reported (5 Oct 2026): one check-in at a time.
    if (selecting.current) return;
    selecting.current = true;
    setSelectingId(person.id);
    try {
      await selectOnce(person);
    } finally {
      selecting.current = false;
      setSelectingId(null);
    }
  }

  async function selectOnce(person: CheckInPerson) {
    setPending(true);
    setError(null);
    const result = isServant
      ? await markServantAttendanceAction(token, person.id, person.kind === "pending" ? "pending" : "servant", remember)
      : await markMemberAttendanceAction(token, person.id, remember);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setSuccessName(person.full_name);
    setAttendanceRecorded(result.attendanceRecorded);
    setWasNewRegistration(false);
    setWasResolvedDuplicate(false);
    setCheckedInPerson(person);
    setCanUndo(result.attendanceRecorded && result.newlyCreated);
    setRememberRestore({ rememberedCookieWritten: result.rememberedCookieWritten, previousRemembered: result.previousRemembered });
    if (!isServant) {
      const memberResult = result as Awaited<ReturnType<typeof markMemberAttendanceAction>>;
      setMissingFields(memberResult.missingFields);
      setShowMissingFields(true);
    } else {
      setMissingFields(NO_MISSING_FIELDS);
      setShowMissingFields(false);
    }
    setView("success");
  }

  function handleIntakeSubmitted(name: string, recorded: boolean, resolvedDuplicate = false) {
    setSuccessName(name);
    setAttendanceRecorded(recorded);
    setWasNewRegistration(!resolvedDuplicate);
    setWasResolvedDuplicate(resolvedDuplicate);
    setCheckedInPerson(null);
    setCanUndo(false);
    setMissingFields(NO_MISSING_FIELDS);
    setShowMissingFields(false);
    setRememberRestore(null);
    setView("success");
  }

  async function handleUndo() {
    if (undoBusy.current) return;
    undoBusy.current = true;
    try {
      await undoOnce();
    } finally {
      undoBusy.current = false;
    }
  }

  async function undoOnce() {
    if (!checkedInPerson) return;
    setUndoing(true);
    setError(null);
    const result = isServant
      ? await undoServantAttendanceAction(
          token,
          checkedInPerson.id,
          checkedInPerson.kind === "pending" ? "pending" : "servant",
          rememberRestore ?? undefined,
        )
      : await undoMemberAttendanceAction(token, checkedInPerson.id, rememberRestore ?? undefined);
    setUndoing(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setCheckedInPerson(null);
    setCanUndo(false);
    setMissingFields(NO_MISSING_FIELDS);
    setShowMissingFields(false);
    setRememberRestore(null);
    setView("list");
  }

  if (view === "success") {
    return (
      <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-6 text-center">
        <p className="text-3xl">{attendanceRecorded ? "✅" : "👋"}</p>
        <h2 className="mt-2 text-lg font-bold text-brand">
          {attendanceRecorded ? `You’re checked in, ${successName}!` : `Thanks, ${successName}!`}
        </h2>
        <p className="mt-1 text-sm text-[#666]">
          {attendanceRecorded
            ? "See you inside."
            : wasResolvedDuplicate
              ? "Attendance isn’t tracked today, but your record has been updated."
              : wasNewRegistration
                ? "Attendance isn’t tracked today, but your registration is saved."
                : `Attendance isn’t tracked today — please check back this ${serviceDayName}.`}
        </p>
        {canUndo && (
          <>
            {error && <p className="mt-3 text-sm text-[#dc3545]">{error}</p>}
            <button
              type="button"
              onClick={handleUndo}
              disabled={undoing}
              className="mt-4 text-base font-bold text-[#dc3545] underline hover:text-[#c82333] disabled:opacity-50"
            >
              <BusyLabel busy={undoing} busyText="Removing…">
            Not you? Undo
          </BusyLabel>
            </button>
          </>
        )}
        {!isServant && showMissingFields && checkedInPerson && (
          <MissingFieldsForm
            token={token}
            memberId={checkedInPerson.id}
            missing={missingFields}
            universities={universities}
            universityLabel={universityLabel}
            programLabel={programLabel}
            onDone={() => setShowMissingFields(false)}
          />
        )}
      </div>
    );
  }

  if (view === "member-intake") {
    return (
      <MemberIntakeForm
        token={token}
        universities={universities}
        universityLabel={universityLabel}
        programLabel={programLabel}
        groupLabel={groupLabel}
        memberLabel={memberLabel}
        currentGroupName={groupName}
        showParents={showParents}
        onBack={flowType === "check_in_and_intake" ? () => setView("list") : undefined}
        onSubmitted={handleIntakeSubmitted}
      />
    );
  }

  if (view === "servant-intake") {
    return (
      <ServantIntakeForm
        token={token}
        onBack={flowType === "check_in_and_intake" ? () => setView("list") : undefined}
        onSubmitted={handleIntakeSubmitted}
      />
    );
  }

  const registerButton = (
    <button
      type="button"
      onClick={() => setView(isServant ? "servant-intake" : "member-intake")}
      className="mt-3 w-full rounded-md bg-[#f0f0f0] px-4 py-3 text-sm font-semibold text-[#333] hover:bg-[#e0e0e0] shadow-[0_2px_4px_rgba(0,0,0,0.1)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.15)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
    >
      {closed ? "New here? Register here" : "Don’t see your name? Register here"}
    </button>
  );

  if (closed) {
    return (
      <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5 text-center">
        <p className="text-3xl">🕑</p>
        <h2 className="mt-2 text-lg font-bold text-brand">Check-in is closed right now</h2>
        <p className="mt-1 text-sm text-[#666]">{openingText}</p>
        {registerButton}
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-4">
      {rememberedPerson && (
        <button
          type="button"
          disabled={pending}
          onClick={() => handleSelect(rememberedPerson)}
          className="mb-3 w-full rounded-md border-l-4 border-brand bg-[#eef4fa] px-3 py-3 text-left font-semibold text-brand disabled:opacity-50"
        >
          <BusyLabel busy={selectingId === rememberedPerson.id} busyText="Checking you in…">
            Check in as {rememberedPerson.full_name}
          </BusyLabel>
        </button>
      )}
      <label className="flex items-center gap-2 text-xs text-[#666]">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-[#ccc] accent-brand"
        />
        Remember me on this device
      </label>
      <input
        autoFocus={!rememberedPerson}
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={rememberedPerson ? "Not you? Type your name…" : "Type your first or last name…"}
        className="mt-2 w-full rounded-md border border-[#ddd] px-3 py-3 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10"
      />
      {error && <p className="mt-2 text-sm text-[#dc3545]">{error}</p>}
      <div className="mt-3 max-h-[50vh] overflow-y-auto divide-y divide-[#f0f0f0]">
        {shown.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={pending}
            onClick={() => handleSelect(p)}
            className="w-full text-left px-2 py-3 text-[#333] hover:bg-[#f5f5f5] disabled:opacity-50"
          >
            <BusyLabel busy={selectingId === p.id} busyText={`${p.full_name} — checking you in…`}>
              {p.full_name}
            </BusyLabel>
          </button>
        ))}
        {letters < 3 && <p className="px-2 py-3 text-sm text-[#666]">Type at least 3 letters of your name.</p>}
        {letters >= 3 && !searching && shown.length === 0 && (
          <p className="px-2 py-3 text-sm text-[#666]">No match. Check the spelling, or register below.</p>
        )}
      </div>
      {registerButton}
    </div>
  );
}
