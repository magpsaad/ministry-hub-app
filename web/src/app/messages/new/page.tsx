import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/get-current-user";
import { getAppSettings } from "@/lib/app-settings";
import { getAccessibleGroups } from "@/lib/groups";
import { getRoleLabels } from "@/lib/role-labels-server";
import { todayInZone } from "@/lib/timezone";
import { MessagesHeader } from "@/components/messages/MessagesHeader";
import { OversightNote } from "@/components/messages/OversightNote";
import { MessageComposer } from "@/components/messages/MessageComposer";
import type { PersonOption } from "@/lib/messages";

/** Messages -> New message (migration 0102): to anyone in the ministry, or
 * a whole class (its Servants); optionally a task with a due date. */
export default async function NewMessagePage({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const sp = await searchParams;

  const supabase = await createClient();
  const [settings, L, groups, { data, error }] = await Promise.all([
    getAppSettings(),
    getRoleLabels(),
    getAccessibleGroups(),
    supabase.rpc("message_people"),
  ]);
  const people = (data ?? []) as PersonOption[];
  const classes = groups.filter((g) => g.kind === "regular").map((g) => ({ id: g.id, name: g.name }));

  return (
    <div className="min-h-full bg-[#f5f5f5]">
      <MessagesHeader logoUrl={settings.logo_url} title={settings.app_title_short} subtitle="New message" />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {error ? (
          <p className="rounded-md bg-[#f8d7da] px-3 py-2 text-sm text-[#721c24]">Couldn&rsquo;t load the people list. Please refresh.</p>
        ) : (
          <MessageComposer
            people={people}
            classes={classes}
            today={todayInZone(settings.timezone)}
            initialTo={sp.to && people.some((p) => p.user_id === sp.to) ? [sp.to] : []}
          />
        )}
        <OversightNote oversight={settings.message_oversight} labels={L} />
      </main>
    </div>
  );
}
