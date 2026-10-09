import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/get-current-user";
import { getAppSettings } from "@/lib/app-settings";
import { getRoleLabels } from "@/lib/role-labels-server";
import { todayInZone } from "@/lib/timezone";
import { MessagesHeader } from "@/components/messages/MessagesHeader";
import { OversightNote } from "@/components/messages/OversightNote";
import { ConversationView } from "@/components/messages/ConversationView";
import type { ConversationDetail } from "@/lib/messages";

/** One conversation (migration 0102): the messages, a reply box, and for a
 * task the "Mark as done" panel (recipients) or everyone's status (sender). */
export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;

  const supabase = await createClient();
  const [settings, L, { data, error }] = await Promise.all([
    getAppSettings(),
    getRoleLabels(),
    /^[0-9a-f-]{36}$/i.test(id) ? supabase.rpc("get_conversation", { p_conv: id }) : Promise.resolve({ data: null, error: true }),
  ]);
  const conv = !error && data ? (data as ConversationDetail) : null;

  return (
    <div className="min-h-full bg-[#f5f5f5]">
      <MessagesHeader logoUrl={settings.logo_url} title={settings.app_title_short} subtitle="Messages" />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {conv ? (
          <ConversationView key={conv.id} conv={conv} timeZone={settings.timezone} today={todayInZone(settings.timezone)} />
        ) : (
          <div className="rounded-xl bg-white p-6 text-center text-sm text-[#777] shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
            This conversation isn&rsquo;t available.{" "}
            <Link href="/messages" className="font-semibold text-brand hover:underline">
              Back to Messages
            </Link>
          </div>
        )}
        <OversightNote oversight={settings.message_oversight} labels={L} />
      </main>
    </div>
  );
}
