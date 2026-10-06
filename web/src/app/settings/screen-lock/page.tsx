import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppLogo } from "@/components/AppLogo";
import { HeaderWordmark } from "@/components/MinistryHubBrand";
import { MenuButton } from "@/components/MenuButton";
import { BackButton } from "@/components/BackButton";
import { RefreshButton } from "@/components/RefreshButton";
import { CARD } from "@/app/security/shared";
import { getAppSettings } from "@/lib/app-settings";
import { getAddressContext } from "@/lib/ministry-context";
import { relyingParty } from "@/lib/screen-lock-server";
import { FaceIdCard, type UnlockDeviceRow } from "./FaceIdCard";

/** My Settings -> Screen Lock & Face ID (owner-requested 6 Oct 2026):
 * this ministry's screen lock (set by its Admins in Ministry Settings) and
 * my Face ID / fingerprint unlock for this ministry's address -- moved
 * here from Account Security and branded as the ministry, since both
 * belong to this address only. */
export default async function ScreenLockSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const address = await getAddressContext();
  if (address.kind !== "ministry") redirect("/security");

  const { rpID } = await relyingParty();
  const [settings, { data: unlockDevices }, { data: lockState }] = await Promise.all([
    getAppSettings(),
    supabase
      .from("unlock_devices")
      .select("id, label, created_at, last_used_at")
      .eq("rp_id", rpID)
      .order("created_at"),
    supabase.rpc("screen_lock_state", { p_touch: false }),
  ]);
  const lockMinutes = (lockState as { lock_minutes: number | null }[] | null)?.[0]?.lock_minutes ?? null;

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
        <p className="mt-1 text-sm opacity-90">Screen Lock &amp; Face ID</p>
        <HeaderWordmark />
      </header>
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className={CARD}>
          <h2 className="text-base font-bold text-[#333]">Screen lock</h2>
          {lockMinutes ? (
            <p className="mt-1 text-sm text-[#333]">
              <span className="mr-2 rounded bg-[#d4edda] px-1.5 py-0.5 text-[11px] font-semibold uppercase text-[#155724]">
                On
              </span>
              {settings.app_title_short} locks the app after {lockMinutes} minutes without use, and hides it while it&rsquo;s in
              the background.
            </p>
          ) : (
            <p className="mt-1 text-sm text-[#555]">
              <span className="mr-2 rounded bg-[#eee] px-1.5 py-0.5 text-[11px] font-semibold uppercase text-[#666]">Off</span>
              {settings.app_title_short} doesn&rsquo;t lock the app when it&rsquo;s left unused.
            </p>
          )}
          <p className="mt-2 text-xs text-[#777]">Set for everyone by the ministry&rsquo;s Admins in Ministry Settings.</p>
        </div>

        <FaceIdCard devices={(unlockDevices ?? []) as UnlockDeviceRow[]} lockMinutes={lockMinutes} />
      </main>
    </div>
  );
}
