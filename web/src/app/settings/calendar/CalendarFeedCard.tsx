"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CARD, PRIMARY_BUTTON } from "@/app/security/shared";
import { BusyLabel } from "@/components/PendingButton";
import { deleteCalendarFeedAction, newCalendarFeedAction } from "./actions";

const SECONDARY =
  "w-full rounded-md border border-[#ddd] bg-white py-2.5 text-sm font-semibold text-[#333] hover:bg-[#f5f5f5] disabled:opacity-60";
const LINK_BUTTON =
  "block w-full rounded-md border border-brand/40 bg-white py-2.5 text-center text-sm font-semibold text-brand hover:bg-brand/5";

/** My Settings -> Calendar Sync (migration 0107): make my private link, add
 * it to Google / Apple / Outlook Calendar, copy it, replace it, or turn it
 * off. */
export function CalendarFeedCard({ feedUrl, calendarName }: { feedUrl: string | null; calendarName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"make" | "new" | "off" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const working = useRef(false);

  async function run(kind: "make" | "new" | "off", task: () => Promise<{ error: string | null }>) {
    if (working.current) return;
    working.current = true;
    setBusy(kind);
    setError(null);
    setCopied(false);
    try {
      const res = await task();
      if (res.error) setError(res.error);
      else router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      working.current = false;
      setBusy(null);
    }
  }

  async function copy() {
    if (!feedUrl) return;
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(true);
    } catch {
      setError("Couldn't copy. Press and hold the link to copy it.");
    }
  }

  const webcal = feedUrl?.replace(/^https?:/, "webcal:") ?? "";
  const google = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`;
  const outlook = `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(feedUrl ?? "")}&name=${encodeURIComponent(calendarName)}`;

  return (
    <>
      <div className={CARD}>
        <h2 className="text-base font-bold text-[#333]">Service Calendar in your own calendar</h2>
        <p className="mt-1 text-sm text-[#555]">
          See the Service Calendar in your phone&rsquo;s or computer&rsquo;s calendar (Google, Apple or Outlook). New
          and changed events show up there by themselves. It only goes one way: nothing from your calendar comes back
          here.
        </p>

        {!feedUrl ? (
          <button type="button" className={`${PRIMARY_BUTTON} mt-4`} disabled={!!busy} onClick={() => run("make", newCalendarFeedAction)}>
            <BusyLabel busy={busy === "make"} busyText="Making your link…">
              Make my calendar link
            </BusyLabel>
          </button>
        ) : (
          <div className="mt-4 space-y-2">
            <a href={webcal} className={LINK_BUTTON}>
              Add to iPhone / Mac Calendar
            </a>
            <a href={google} target="_blank" rel="noopener noreferrer" className={LINK_BUTTON}>
              Add to Google Calendar
            </a>
            <a href={outlook} target="_blank" rel="noopener noreferrer" className={LINK_BUTTON}>
              Add to Outlook
            </a>
            <div className="pt-2">
              <span className="block text-xs font-semibold text-[#666] mb-1">Or copy your link into any calendar app</span>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={feedUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-md border border-[#ddd] bg-[#fafafa] px-2 py-2 text-xs text-[#555]"
                  aria-label="Your calendar link"
                />
                <button type="button" onClick={copy} className="shrink-0 rounded-md border border-[#ddd] bg-white px-3 text-sm font-semibold text-[#333] hover:bg-[#f5f5f5]">
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          </div>
        )}
        {error && <p className="mt-3 rounded-md bg-[#f8d7da] px-3 py-2 text-sm text-[#721c24]">{error}</p>}
      </div>

      {feedUrl && (
        <div className={CARD}>
          <h2 className="text-base font-bold text-[#333]">Good to know</h2>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-[#555]">
            <li>
              Your calendar app decides how often it checks for changes: Apple and Outlook about every hour, Google
              sometimes only once or twice a day.
            </li>
            {/* Owner-requested (9 Oct 2026): Google adds a new calendar unticked. */}
            <li>
              Google Calendar: after adding it, look under &ldquo;Other calendars&rdquo; on the left and make sure the
              calendar is ticked, or its events won&rsquo;t show.
            </li>
            <li>It shows each event&rsquo;s name, date, time and place. Descriptions and attachments stay in the app.</li>
            <li>
              This link is yours: please don&rsquo;t share it. If you think someone else has it, make a new one (the old
              one stops working at once, so add the new one to your calendar again).
            </li>
          </ul>
          <div className="mt-4 space-y-2">
            <button
              type="button"
              className={SECONDARY}
              disabled={!!busy}
              onClick={() => {
                if (confirm("Make a new link? The old one stops working, so you'll need to add the new one to your calendar again.")) {
                  void run("new", newCalendarFeedAction);
                }
              }}
            >
              <BusyLabel busy={busy === "new"} busyText="Making a new link…">
                Make a new link
              </BusyLabel>
            </button>
            <button
              type="button"
              className={SECONDARY}
              disabled={!!busy}
              onClick={() => {
                if (confirm("Turn off your calendar link? The Service Calendar stops updating in your calendar.")) {
                  void run("off", deleteCalendarFeedAction);
                }
              }}
            >
              <BusyLabel busy={busy === "off"} busyText="Turning off…">
                Turn off
              </BusyLabel>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
