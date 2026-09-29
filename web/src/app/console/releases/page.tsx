import { getConsoleAccess } from "@/lib/console";
import { getReleases } from "@/lib/releases";
import { ConsoleShell, NotAuthorized } from "@/components/console/ConsoleShell";
import { VersionControlInteractive } from "@/components/VersionControlInteractive";

/** MULTI_TENANT_PLAN.md P9 -- Version Control, now a Church Admin function:
 * release notes added and edited here are shown (read-only) in every
 * ministry's Release History. */
export default async function ConsoleReleasesPage() {
  const access = await getConsoleAccess();
  if (!access.isChurchAdmin) return <NotAuthorized email={access.email} />;

  const releases = await getReleases();

  return (
    <ConsoleShell title="Release Notes" email={access.email}>
      <p className="text-sm text-[#666]">Shown to everyone, in every ministry, as the app&rsquo;s Release History.</p>
      <VersionControlInteractive initial={releases} canManage />
    </ConsoleShell>
  );
}
