"use client";

import { useState, useTransition } from "react";
import type { CalendarEvent, CalendarEventType, EventAttendanceOptions, EventAudience } from "@/lib/calendar-types";
import { ATTENDANCE_EVENT_TYPES, EVENT_TYPES } from "@/lib/calendar-types";
import { calendarAttachmentUrl } from "@/lib/storage";
import {
  createEventAction,
  updateEventAction,
  deleteEventAction,
  uploadEventAttachmentAction,
  removeEventAttachmentAction,
  type EventInput,
} from "@/app/calendar/actions";
import { todayInZone } from "@/lib/timezone";
import { useTimezone } from "@/components/TimezoneProvider";
import { useRoleLabels } from "@/components/RoleLabelsProvider";

const inputClass =
  "w-full rounded-md border border-[#ddd] px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10";
// Owner-reported (10 Oct 2026): on phones the start/end date and time boxes
// overlapped and the end one ran off the screen -- the phone's date/time
// boxes have a built-in minimum width wider than half the form. Letting
// them shrink (and the grid columns too) keeps each in its half.
const dateTimeClass = `${inputClass} block min-w-0 appearance-none bg-white`;

const chipClass = (on: boolean) =>
  `rounded-full border px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-60 ${
    on ? "border-brand bg-brand text-white" : "border-[#ddd] bg-white text-[#555] hover:bg-[#f5f5f5]"
  }`;

const AUDIENCES: { value: EventAudience; label: string }[] = [
  { value: "all", label: "Whole ministry" },
  { value: "grade", label: "Grade" },
  { value: "class", label: "Class" },
];

/** REQUIREMENTS.md §6.8 -- auto-template suggestions for Speaker Session /
 * Group Discussion, only applied when the description is still empty (a
 * suggestion, not an overwrite). */
const DESCRIPTION_TEMPLATES: Partial<Record<CalendarEventType, string>> = {
  "Speaker Session": "Speaker: \nTopic: \n",
  "Group Discussion": "Discussion Topic: \nLeader: \n",
};

/** Create/edit modal for a Service Calendar event (§6.8) -- open to all
 * Servants (RLS enforces this regardless of the UI). The attachment field
 * is available even while creating a brand-new event -- the file is held
 * in state and uploaded right after the event itself is created, since the
 * storage path needs a real event id first. */
export function EventForm({
  event,
  defaultDate,
  attendance,
  onClose,
  onSaved,
}: {
  event: CalendarEvent | null;
  defaultDate?: string;
  attendance: EventAttendanceOptions;
  onClose: () => void;
  onSaved: () => void;
}) {
  const timeZone = useTimezone();
  const L = useRoleLabels();
  const [form, setForm] = useState<EventInput>({
    title: event?.title ?? "",
    description: event?.description ?? "",
    event_type: event?.event_type ?? "Event",
    start_date: event?.start_date ?? defaultDate ?? todayInZone(timeZone),
    end_date: event?.end_date ?? defaultDate ?? todayInZone(timeZone),
    all_day: event?.all_day ?? true,
    start_time: event?.start_time ?? null,
    end_time: event?.end_time ?? null,
    location: event?.location ?? null,
    take_attendance: event?.take_attendance ?? false,
    audience: event?.audience ?? "all",
    audience_levels: event?.audience_levels ?? [],
    audience_group_ids: event?.audience_group_ids ?? [],
  });
  const canTakeAttendance = ATTENDANCE_EVENT_TYPES.includes(form.event_type);
  const [attachmentPath, setAttachmentPath] = useState(event?.attachment_url ?? null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Owner-reported: picking Group Discussion filled in its template, but
  // then switching to Speaker Session (or anything else) left that
  // template's text stuck in the box instead of swapping to the new type's
  // template (or clearing). Tracks the exact string we last auto-filled so
  // a later type change can tell "still exactly what we suggested, safe to
  // replace" apart from "the user actually typed/edited this, leave it
  // alone" -- null whenever the description isn't (or is no longer) our
  // own suggestion, including for an existing event's real saved
  // description, which was never auto-filled by this session.
  const [autoDescription, setAutoDescription] = useState<string | null>(null);

  function field<K extends keyof EventInput>(key: K, value: EventInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleDescriptionChange(value: string) {
    field("description", value);
    if (value !== autoDescription) setAutoDescription(null);
  }

  function handleTypeChange(type: CalendarEventType) {
    setForm((f) => {
      const template = DESCRIPTION_TEMPLATES[type];
      const currentIsEmpty = !f.description?.trim();
      const currentIsAutoFilled = autoDescription !== null && f.description === autoDescription;
      if (currentIsEmpty || currentIsAutoFilled) {
        setAutoDescription(template ?? null);
        return { ...f, event_type: type, description: template ?? "" };
      }
      return { ...f, event_type: type };
    });
  }

  function toggleIn<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
  }

  function handleSave() {
    if (!form.title.trim()) {
      setError("Please enter a title.");
      return;
    }
    if (form.end_date < form.start_date) {
      setError("End date can't be before the start date.");
      return;
    }
    const takes = !!form.take_attendance && canTakeAttendance;
    if (attendance.canSet && takes && form.audience === "grade" && (form.audience_levels ?? []).length === 0) {
      setError("Choose at least one grade.");
      return;
    }
    if (attendance.canSet && takes && form.audience === "class" && (form.audience_group_ids ?? []).length === 0) {
      setError("Choose at least one class.");
      return;
    }
    // Only people who may set attendance send it (the event otherwise keeps
    // what it has); off for types that can't take it.
    const input: EventInput = attendance.canSet
      ? { ...form, take_attendance: takes }
      : { ...form, take_attendance: undefined, audience: undefined, audience_levels: undefined, audience_group_ids: undefined };
    setError(null);
    startTransition(async () => {
      let eventId: string | null;
      if (event) {
        const result = await updateEventAction(event.id, input);
        if (result.error) {
          setError(result.error);
          return;
        }
        eventId = event.id;
      } else {
        const result = await createEventAction(input);
        if (result.error) {
          setError(result.error);
          return;
        }
        eventId = result.id;
      }

      if (pendingFile && eventId) {
        const formData = new FormData();
        formData.set("attachment", pendingFile);
        const uploadResult = await uploadEventAttachmentAction(eventId, formData);
        if (uploadResult.error) {
          setError(uploadResult.error);
          return;
        }
      }

      onSaved();
      onClose();
    });
  }

  function handleDelete() {
    if (!event) return;
    const message = event.take_attendance
      ? `Delete "${event.title}"? Its attendance will be deleted too. This cannot be undone.`
      : `Delete "${event.title}"? This cannot be undone.`;
    if (!confirm(message)) return;
    startTransition(async () => {
      const result = await deleteEventAction(event.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      onSaved();
      onClose();
    });
  }

  function handleRemoveAttachment() {
    if (!event || !attachmentPath) return;
    startTransition(async () => {
      const result = await removeEventAttachmentAction(event.id, attachmentPath);
      if (result.error) {
        setError(result.error);
        return;
      }
      setAttachmentPath(null);
      onSaved();
    });
  }

  const attachmentUrl = calendarAttachmentUrl(attachmentPath);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-[0_10px_40px_rgba(0,0,0,0.2)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b-2 border-[#f0f0f0] pb-3 mb-4">
          <h2 className="text-lg font-bold text-brand">{event ? "Edit Event" : "New Event"}</h2>
          <button onClick={onClose} className="text-[#999] hover:text-[#333] text-xl leading-none">
            ×
          </button>
        </div>

        {error && <div className="mb-3 rounded-md bg-[#f8d7da] text-[#721c24] text-sm px-3 py-2">{error}</div>}

        <div className="space-y-3 text-sm">
          <div>
            <label className="block font-semibold mb-1">Type *</label>
            <select value={form.event_type} onChange={(e) => handleTypeChange(e.target.value as CalendarEventType)} className={inputClass}>
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-semibold mb-1">Title *</label>
            <input required value={form.title} onChange={(e) => field("title", e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="block font-semibold mb-1">Description</label>
            <textarea
              value={form.description ?? ""}
              onChange={(e) => handleDescriptionChange(e.target.value)}
              rows={3}
              className={inputClass}
            />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
            <div className="min-w-0">
              <label className="block font-semibold mb-1">Start Date *</label>
              <input
                type="date"
                required
                value={form.start_date}
                onChange={(e) => field("start_date", e.target.value)}
                className={dateTimeClass}
              />
            </div>
            <div className="min-w-0">
              <label className="block font-semibold mb-1">End Date *</label>
              <input
                type="date"
                required
                value={form.end_date}
                onChange={(e) => field("end_date", e.target.value)}
                className={dateTimeClass}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 font-semibold">
            <input
              type="checkbox"
              checked={form.all_day}
              onChange={(e) => field("all_day", e.target.checked)}
              className="accent-brand"
            />
            All Day
          </label>
          {!form.all_day && (
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
              <div className="min-w-0">
                <label className="block font-semibold mb-1">Start Time</label>
                <input
                  type="time"
                  value={form.start_time ?? ""}
                  onChange={(e) => field("start_time", e.target.value || null)}
                  className={dateTimeClass}
                />
              </div>
              <div className="min-w-0">
                <label className="block font-semibold mb-1">End Time</label>
                <input
                  type="time"
                  value={form.end_time ?? ""}
                  onChange={(e) => field("end_time", e.target.value || null)}
                  className={dateTimeClass}
                />
              </div>
            </div>
          )}
          {/* Owner-approved (10 Oct 2026, migration 0111): attendance at
              Events, Trips and Outings, set by Coordinators. */}
          {canTakeAttendance && (attendance.canSet || form.take_attendance) && (
            <div className="border-t border-[#f0f0f0] pt-3">
              <label className="flex items-center gap-2 font-semibold">
                <input
                  type="checkbox"
                  checked={!!form.take_attendance}
                  disabled={!attendance.canSet}
                  onChange={(e) => field("take_attendance", e.target.checked)}
                  className="accent-brand"
                />
                Take attendance
              </label>
              <p className="ml-6 text-xs text-[#888]">
                {L.coordinators} only. QR check-in opens during the event&rsquo;s hours.
              </p>
              {form.take_attendance && (
                <div className="mt-2">
                  <span className="block font-semibold mb-1">Who it&rsquo;s for</span>
                  <div className="flex flex-wrap gap-1.5">
                    {AUDIENCES.map((a) => (
                      <button
                        key={a.value}
                        type="button"
                        disabled={!attendance.canSet}
                        aria-pressed={form.audience === a.value}
                        onClick={() => field("audience", a.value)}
                        className={chipClass(form.audience === a.value)}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                  {form.audience === "grade" && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {attendance.grades.map((g) => {
                        const on = (form.audience_levels ?? []).includes(g.level);
                        return (
                          <button
                            key={g.level}
                            type="button"
                            disabled={!attendance.canSet}
                            aria-pressed={on}
                            onClick={() => field("audience_levels", toggleIn(form.audience_levels ?? [], g.level))}
                            className={chipClass(on)}
                          >
                            {g.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {form.audience === "class" && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {attendance.classes.map((c) => {
                        const on = (form.audience_group_ids ?? []).includes(c.id);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            disabled={!attendance.canSet}
                            aria-pressed={on}
                            onClick={() => field("audience_group_ids", toggleIn(form.audience_group_ids ?? [], c.id))}
                            className={chipClass(on)}
                          >
                            {c.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <p className="mt-1.5 text-xs text-[#888]">
                    {form.audience === "all"
                      ? "Counts toward everyone's Events %."
                      : form.audience === "grade"
                        ? "Counts toward the Events % of every class in the chosen grades only."
                        : "Counts toward the Events % of the chosen classes only."}
                  </p>
                </div>
              )}
            </div>
          )}
          <div>
            <label className="block font-semibold mb-1">Location</label>
            <input
              value={form.location ?? ""}
              onChange={(e) => field("location", e.target.value || null)}
              className={inputClass}
            />
          </div>

          <div>
            <label className="block font-semibold mb-1">Attachment</label>
            {attachmentUrl && !pendingFile ? (
              <div className="flex items-center gap-2">
                <a href={attachmentUrl} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline truncate">
                  View attachment
                </a>
                <button type="button" onClick={handleRemoveAttachment} disabled={pending} className="text-xs font-semibold text-[#dc3545] hover:underline">
                  Remove
                </button>
              </div>
            ) : (
              <input
                type="file"
                onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-[#333] file:mr-3 file:rounded-md file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-brand-dark"
              />
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2 justify-between items-center border-t border-[#f0f0f0] pt-4">
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={pending}
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
            >
              {pending ? "Saving…" : "Save"}
            </button>
            <button onClick={onClose} className="rounded-md bg-[#f0f0f0] px-4 py-2 text-sm font-semibold text-[#333] hover:bg-[#e0e0e0] shadow-[0_2px_4px_rgba(0,0,0,0.1)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.15)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.1)]">
              Cancel
            </button>
          </div>
          {event && (
            <button
              onClick={handleDelete}
              disabled={pending}
              className="rounded-md bg-[#dc3545] px-4 py-2 text-sm font-semibold text-white hover:bg-[#c82333] disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
            >
              Delete Event
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
