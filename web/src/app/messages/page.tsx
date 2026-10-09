import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/get-current-user";
import { getAccessSummary } from "@/lib/roles";
import { getAppSettings } from "@/lib/app-settings";
import { getRoleLabels, roleWords } from "@/lib/role-labels-server";
import { todayInZone } from "@/lib/timezone";
import { LinkSpinner } from "@/components/PendingButton";
import { MessagesHeader } from "@/components/messages/MessagesHeader";
import { OversightNote } from "@/components/messages/OversightNote";
import { dueLabel, toInbox, whenLabel, type ConversationRow, type InboxItem } from "@/lib/messages";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "for-me", label: "Tasks for me" },
  { key: "sent", label: "Tasks I sent" },
  { key: "done", label: "Done" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

function keep(item: InboxItem, f: FilterKey): boolean {
  if (f === "for-me") return item.is_task && !item.i_sent && !item.my_done;
  if (f === "sent") return item.is_task && item.i_sent;
  if (f === "done")
    return item.is_task && (item.i_sent ? item.recipient_count > 0 && item.done_count === item.recipient_count : item.my_done);
  return true;
}

/** Servant Corner -> Messages (owner-approved design 8 Oct 2026, migration
 * 0102): my conversations and tasks, newest first, with filters. Those the
 * ministry lets read every conversation (Ministry Settings; no one by
 * default, 0103) also get a "Whole ministry" view. */
export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ f?: string; view?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const sp = await searchParams;
  const filter: FilterKey = FILTERS.some((x) => x.key === sp.f) ? (sp.f as FilterKey) : "all";

  const [access, settings, L] = await Promise.all([getAccessSummary(user.id), getAppSettings(), getRoleLabels()]);
  const hasRole = (r: string) => access.roles.some((x) => x.role === r);
  const oversees =
    (settings.message_oversight === "gc" && hasRole("general_coordinator")) ||
    (settings.message_oversight === "gc_admin" && (hasRole("general_coordinator") || hasRole("admin")));
  const ministryView = oversees && sp.view === "ministry";

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_conversations", { p_scope: ministryView ? "all" : "mine" });
  const items = toInbox((data ?? []) as ConversationRow[]).filter((i) => keep(i, filter));
  const today = todayInZone(settings.timezone);
  const qs = (f: FilterKey, view: boolean) => {
    const p = new URLSearchParams();
    if (f !== "all") p.set("f", f);
    if (view) p.set("view", "ministry");
    const s = p.toString();
    return s ? `/messages?${s}` : "/messages";
  };

  return (
    <div className="min-h-full bg-[#f5f5f5]">
      <MessagesHeader logoUrl={settings.logo_url} title={settings.app_title_short} subtitle="Messages" />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          {oversees ? (
            <div className="inline-flex rounded-full border border-[#ddd] bg-white p-0.5 text-xs font-semibold">
              <Link
                href={qs(filter, false)}
                className={`rounded-full px-3 py-1 ${!ministryView ? "bg-brand text-white" : "text-[#555]"}`}
              >
                Mine
              </Link>
              <Link
                href={qs(filter, true)}
                className={`rounded-full px-3 py-1 ${ministryView ? "bg-brand text-white" : "text-[#555]"}`}
              >
                Whole ministry
              </Link>
            </div>
          ) : (
            <span />
          )}
          <Link
            href="/messages/new"
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark shadow-[0_2px_4px_rgba(0,0,0,0.15)]"
          >
            + New message
            <LinkSpinner />
          </Link>
        </div>

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((x) => (
            <Link
              key={x.key}
              href={qs(x.key, ministryView)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                filter === x.key ? "border-brand bg-brand/10 text-brand" : "border-[#ddd] bg-white text-[#555] hover:bg-[#f5f5f5]"
              }`}
            >
              {x.label}
            </Link>
          ))}
        </div>

        {error ? (
          <p className="rounded-md bg-[#f8d7da] px-3 py-2 text-sm text-[#721c24]">{await roleWords(error.message)}</p>
        ) : items.length === 0 ? (
          <div className="rounded-xl bg-white p-6 text-center text-sm text-[#777] shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
            {filter === "all"
              ? ministryView
                ? "No conversations in this ministry yet."
                : "No messages yet. Tap “+ New message” to write to someone, or give a task."
              : "Nothing here."}
          </div>
        ) : (
          <ul className="overflow-hidden rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] divide-y divide-[#eee]">
            {items.map((i) => (
              <li key={i.key}>
                <Link href={i.href} className="block px-4 py-3 hover:bg-[#fafafa]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className={`truncate text-sm ${i.unread ? "font-bold text-[#222]" : "font-semibold text-[#333]"}`}>
                        {i.unread && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-brand align-middle" />}
                        {i.subject}
                        <LinkSpinner />
                      </p>
                      <p className="truncate text-xs text-[#666]">
                        {i.i_sent ? "To " : ministryView && !i.member ? "" : i.mode === "group" ? "With " : "From "}
                        {i.people || "—"}
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] text-[#888]">{whenLabel(i.last_message_at, settings.timezone, today)}</span>
                  </div>
                  {i.last_body && (
                    <p className="mt-1 line-clamp-2 text-xs text-[#555]">
                      <span className="font-semibold">{i.last_author}:</span> {i.last_body}
                    </p>
                  )}
                  {i.is_task && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
                      <span className="rounded bg-[#e8f0fe] px-1.5 py-0.5 text-[#1a56db]">Task</span>
                      {i.due_on && (
                        <span
                          className={`rounded px-1.5 py-0.5 ${
                            i.due_on < today && !(i.i_sent ? i.done_count === i.recipient_count : i.my_done)
                              ? "bg-[#f8d7da] text-[#721c24]"
                              : "bg-[#f0f0f0] text-[#555]"
                          }`}
                        >
                          Due {dueLabel(i.due_on)}
                        </span>
                      )}
                      {i.i_sent || (ministryView && !i.member) ? (
                        <span
                          className={`rounded px-1.5 py-0.5 ${
                            i.recipient_count > 0 && i.done_count === i.recipient_count
                              ? "bg-[#d4edda] text-[#155724]"
                              : "bg-[#fff8e1] text-[#5c4400]"
                          }`}
                        >
                          {i.done_count} of {i.recipient_count} done
                        </span>
                      ) : (
                        <span className={`rounded px-1.5 py-0.5 ${i.my_done ? "bg-[#d4edda] text-[#155724]" : "bg-[#fff8e1] text-[#5c4400]"}`}>
                          {i.my_done ? "Done" : "To do"}
                        </span>
                      )}
                    </div>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}

        <OversightNote oversight={settings.message_oversight} labels={L} />
      </main>
    </div>
  );
}
