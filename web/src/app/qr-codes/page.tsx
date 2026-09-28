import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/get-current-user";
import { getQrCodesForPrinting } from "@/lib/qrcodes";
import { getAppSettings } from "@/lib/app-settings";
import { AppLogo } from "@/components/AppLogo";
import { HomeLink } from "@/components/HomeLink";
import { RefreshButton } from "@/components/RefreshButton";
import { SignOutButton } from "@/components/SignOutButton";
import { QrCodesInteractive } from "@/components/qrcodes/QrCodesInteractive";

/** REQUIREMENTS.md §6.15/§6.1 -- "QR Codes" is Servant Corner, visible to
 * everyone with app access, not admin-restricted. */
export default async function QrCodesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [qrCodes, settings] = await Promise.all([getQrCodesForPrinting(), getAppSettings()]);

  return (
    <div className="min-h-full bg-[#f5f5f5]">
      <header className="print:hidden bg-gradient-to-br from-brand to-brand-light text-white px-5 py-5 text-center shadow-[0_2px_10px_rgba(0,0,0,0.1)] relative sticky top-[var(--qa-banner-h)] z-40">
        <div className="absolute top-2.5 left-4 flex flex-col items-start gap-1">
          <HomeLink />
          <RefreshButton />
        </div>
        <div className="absolute top-2.5 right-4 flex flex-col items-end gap-1">
          <SignOutButton className="text-white/70 hover:text-white transition-colors" />
          <span className="text-[10px] text-white/60">Version {settings.app_version}</span>
        </div>
        <Link href="/" className="inline-flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
          <AppLogo logoUrl={settings.logo_url} title={settings.app_title_short} size={32} circular={false} />
          <h1 className="text-2xl font-bold">{settings.app_title_short}</h1>
        </Link>
        <p className="mt-1 text-sm opacity-90">QR Codes</p>
      </header>
      <main className="max-w-4xl mx-auto px-4 py-6">
        <QrCodesInteractive qrCodes={qrCodes} />
      </main>
    </div>
  );
}
