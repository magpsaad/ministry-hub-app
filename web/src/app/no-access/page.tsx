import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/get-current-user";
import { getAppSettings } from "@/lib/app-settings";
import { createClient } from "@/lib/supabase/server";
import { AppLogo } from "@/components/AppLogo";
import { SignOutButton } from "@/components/SignOutButton";
import { HeaderWordmark } from "@/components/MinistryHubBrand";
import { JOIN_PARAM, belongsElsewhere, parseAccess } from "@/lib/no-access";

/** Owner-requested (17 Oct 2026, migration 0121) -- where someone lands who
 * serves (or has registered) in another ministry but has nothing on this
 * ministry's address. Names no other ministry; makes no profile here.
 * Joining this ministry anyway is a deliberate second choice. */
export default async function NoAccessPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const [access, settings] = await Promise.all([
    supabase.rpc("my_access_here").then((r) => parseAccess(r.data)),
    getAppSettings(),
  ]);
  if (!belongsElsewhere(access)) redirect("/");

  return (
    <div className="min-h-full flex flex-col bg-[#f5f5f5]">
      <header className="bg-gradient-to-br from-brand to-brand-light text-white px-5 py-6 text-center shadow-[0_2px_10px_rgba(0,0,0,0.1)] relative sticky top-[var(--qa-banner-h)] z-40">
        <div className="flex justify-center">
          <AppLogo logoUrl={settings.logo_url} title={settings.app_title_short} size={60} />
        </div>
        <h1 className="mt-3 text-[22px] font-bold">{settings.app_title_long}</h1>
        <div className="absolute top-2.5 right-4">
          <SignOutButton className="text-white/70 hover:text-white transition-colors" />
        </div>
        <HeaderWordmark corner="bottom" />
      </header>
      <main className="flex-1 max-w-md w-full mx-auto px-4 py-6 space-y-4">
        <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5 text-center space-y-3">
          <h2 className="text-base font-bold text-brand">You don&rsquo;t have access to {settings.app_title_long}</h2>
          <p className="text-sm text-[#666]">
            If you serve in a different ministry, please open the link your ministry gave you.
          </p>
          <div className="pt-2">
            <SignOutButton className="rounded-md bg-brand px-4 py-2 text-white hover:opacity-90" />
          </div>
        </div>
        <p className="text-center text-xs text-[#999]">
          <Link prefetch={false} href={`/register?${JOIN_PARAM}=1`} className="underline">
            I want to join {settings.app_title_long}
          </Link>
        </p>
        <p className="text-center text-xs text-[#999]">Signed in as {user.email}.</p>
      </main>
    </div>
  );
}
