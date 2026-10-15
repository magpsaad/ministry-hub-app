import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppLogo } from "@/components/AppLogo";
import { HeaderWordmark } from "@/components/MinistryHubBrand";
import { MenuButton } from "@/components/MenuButton";
import { BackButton } from "@/components/BackButton";
import { RefreshButton } from "@/components/RefreshButton";
import { HomeLink } from "@/components/HomeLink";
import { getAppSettings } from "@/lib/app-settings";
import { getAddressContext } from "@/lib/ministry-context";
import { MyBirthdayCard } from "./MyBirthdayCard";

/** My Settings -> My Birthday (owner-approved 15 Oct 2026, migration 0116):
 * this person's own birthday, day and month only. Their Coordinators and
 * General Coordinators see it on the Dashboard's My Servants Team. */
export default async function MyBirthdayPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const address = await getAddressContext();
  if (address.kind !== "ministry") redirect("/security");

  const [settings, { data: profile }] = await Promise.all([
    getAppSettings(),
    supabase.from("profiles").select("birthday_month, birthday_day").eq("id", user.id).maybeSingle(),
  ]);

  return (
    <div className="min-h-full bg-[#f5f5f5]">
      <header className="bg-gradient-to-br from-brand to-brand-light text-white px-5 py-5 text-center shadow-[0_2px_10px_rgba(0,0,0,0.1)] relative sticky top-[var(--qa-banner-h)] z-40">
        <div className="absolute top-2.5 left-4 flex flex-col items-start gap-1">
          <MenuButton />
          <BackButton />
        </div>
        <div className="absolute top-2.5 right-4">
          <RefreshButton />
        </div>
        <HomeLink className="inline-flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
          <AppLogo logoUrl={settings.logo_url} title={settings.app_title_short} size={32} circular={false} />
          <h1 className="text-2xl font-bold">{settings.app_title_short}</h1>
        </HomeLink>
        <p className="mt-1 text-sm opacity-90">My Birthday</p>
        <HeaderWordmark />
      </header>
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <MyBirthdayCard initialMonth={profile?.birthday_month ?? null} initialDay={profile?.birthday_day ?? null} />
      </main>
    </div>
  );
}
