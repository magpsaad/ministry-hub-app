import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/get-current-user";
import { getAccessSummary } from "@/lib/roles";
import { getAppSettings } from "@/lib/app-settings";
import { getAccessibleGroups } from "@/lib/groups";
import { AppLogo } from "@/components/AppLogo";
import { MenuButton } from "@/components/MenuButton";
import { BackButton } from "@/components/BackButton";
import { RefreshButton } from "@/components/RefreshButton";
import { ExportListsInteractive } from "@/components/ExportListsInteractive";
import { HeaderWordmark } from "@/components/MinistryHubBrand";

/** Owner-requested: Coordinator Corner, General/Sub-Coordinators and Admins
 * -- export or print a names-only list, either one cohort's roster (never
 * the hidden Yr0 pre-entry group) or the overall Servants list. Every real
 * cohort is offered to any Coordinator here, not just the ones they're
 * personally assigned to -- "no risk of data leaking since it's just a
 * list of names" (owner's explicit call, unlike every other screen's real
 * per-cohort data access). export_group_member_names() (migration 0052)
 * is what actually grants the broader read; the page-level gate above
 * still keeps this to Coordinators/Admins only. */
export default async function ExportListsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const access = await getAccessSummary(user.id);
  if (!access.isCoordinator && !access.isAdmin) {
    return (
      <div className="min-h-full flex items-center justify-center bg-[#f5f5f5] p-4">
        <p className="text-sm text-[#666]">You don&rsquo;t have access to this page.</p>
      </div>
    );
  }

  // Every regular group for any Coordinator (above); Admins also get the
  // hidden hand-over group(s), to hand the list to the next ministry
  // (GROUP_LADDER_PLAN.md §4.5). The database only returns hidden groups to
  // Admins anyway.
  const [settings, groups] = await Promise.all([getAppSettings(), getAccessibleGroups()]);
  const selectableGroups = groups.filter((g) => g.kind === "regular" || (access.isAdmin && g.kind === "terminal"));

  return (
    <div className="min-h-full bg-[#f5f5f5]">
      <header className="print:hidden bg-gradient-to-br from-brand to-brand-light text-white px-5 py-5 text-center shadow-[0_2px_10px_rgba(0,0,0,0.1)] relative sticky top-[var(--qa-banner-h)] z-40">
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
        <p className="mt-1 text-sm opacity-90">Print/Export Lists</p>
        <HeaderWordmark />
      </header>
      <main className="max-w-2xl mx-auto px-4 py-6">
        <ExportListsInteractive groups={selectableGroups} memberLabel={settings.member_label} appTitle={settings.app_title_short} />
      </main>
    </div>
  );
}
