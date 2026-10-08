import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/get-current-user";
import { getAccessSummary } from "@/lib/roles";
import { getAppSettings } from "@/lib/app-settings";
import { getAccessibleGroups } from "@/lib/groups";
import { todayInZone, shiftDateKey } from "@/lib/timezone";
import { AppLogo } from "@/components/AppLogo";
import { HeaderWordmark } from "@/components/MinistryHubBrand";
import { MenuButton } from "@/components/MenuButton";
import { BackButton } from "@/components/BackButton";
import { RefreshButton } from "@/components/RefreshButton";
import { AnnouncementsInteractive } from "@/components/announcements/AnnouncementsInteractive";
import type { AnnouncementRow } from "@/lib/announcements";

/** Servant Corner -> Announcements (owner-approved design 8 Oct 2026,
 * migration 0099): everyone reads here; Coordinators, General Coordinators
 * and System Admins also post (Coordinators only to their classes'
 * Servants or to fellow Coordinators). */
export default async function AnnouncementsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const [access, settings, groups, { data }] = await Promise.all([
    getAccessSummary(user.id),
    getAppSettings(),
    getAccessibleGroups(),
    supabase.rpc("my_announcements"),
  ]);
  const full = access.isAdmin || access.isGeneralCoordinator;
  const myClassIds = access.roles.filter((r) => r.role === "sub_coordinator" && r.group_id).map((r) => r.group_id!);
  const canPost = full || myClassIds.length > 0;
  const classes = groups.filter((g) => g.kind === "regular").map((g) => ({ id: g.id, name: g.name }));
  const today = todayInZone(settings.timezone);

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
        <Link href="/" className="inline-flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
          <AppLogo logoUrl={settings.logo_url} title={settings.app_title_short} size={32} circular={false} />
          <h1 className="text-2xl font-bold">{settings.app_title_short}</h1>
        </Link>
        <p className="mt-1 text-sm opacity-90">Announcements</p>
        <HeaderWordmark />
      </header>
      <main className="max-w-2xl mx-auto px-4 py-6">
        <AnnouncementsInteractive
          rows={(data ?? []) as AnnouncementRow[]}
          canPost={canPost}
          full={full}
          classes={full ? classes : classes.filter((c) => myClassIds.includes(c.id))}
          allClasses={classes}
          today={today}
          defaultEnd={shiftDateKey(today, { days: 7 })}
        />
      </main>
    </div>
  );
}
