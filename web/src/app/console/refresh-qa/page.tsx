import { getConsoleAccess } from "@/lib/console";
import { createClient } from "@/lib/supabase/server";
import { ConsoleShell, NotAuthorized } from "@/components/console/ConsoleShell";
import { RefreshQaInteractive } from "@/components/console/RefreshQaInteractive";

/** Refresh QA from production (owner-requested; migration 0068). QA console
 * only: replaces QA's copy of the chosen production ministries with
 * production's current data, keeping any QA-only access the Church Admin
 * ticks. The production console never shows this page. */
export default async function RefreshQaPage() {
  const access = await getConsoleAccess();
  if (!access.isChurchAdmin) return <NotAuthorized email={access.email} />;

  if (process.env.NEXT_PUBLIC_APP_ENV !== "qa") {
    return (
      <ConsoleShell title="Refresh QA" email={access.email}>
        <p className="text-sm text-[#666]">This is only available in the QA console.</p>
      </ConsoleShell>
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("refresh_prod_ministries");
  const ministries = (data ?? []) as { id: string; name: string; in_qa: boolean }[];

  return (
    <ConsoleShell title="Refresh QA from Production" email={access.email}>
      {error ? (
        <p className="rounded-md bg-[#f8d7da] px-3 py-2 text-sm text-[#721c24]">
          Couldn&rsquo;t load the production ministries: {error.message}
        </p>
      ) : (
        <RefreshQaInteractive ministries={ministries} />
      )}
    </ConsoleShell>
  );
}
