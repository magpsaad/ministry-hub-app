import Link from "next/link";
import { AppLogo } from "@/components/AppLogo";
import { HeaderWordmark } from "@/components/MinistryHubBrand";
import { MenuButton } from "@/components/MenuButton";
import { BackButton } from "@/components/BackButton";
import { RefreshButton } from "@/components/RefreshButton";

/** The ministry-branded header of the Messages pages (0102). */
export function MessagesHeader({ logoUrl, title, subtitle }: { logoUrl: string | null; title: string; subtitle: string }) {
  return (
    <header className="bg-gradient-to-br from-brand to-brand-light text-white px-5 py-5 text-center shadow-[0_2px_10px_rgba(0,0,0,0.1)] relative sticky top-[var(--qa-banner-h)] z-40">
      <div className="absolute top-2.5 left-4 flex flex-col items-start gap-1">
        <MenuButton />
        <BackButton />
      </div>
      <div className="absolute top-2.5 right-4">
        <RefreshButton />
      </div>
      <Link href="/" className="inline-flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
        <AppLogo logoUrl={logoUrl} title={title} size={32} circular={false} />
        <h1 className="text-2xl font-bold">{title}</h1>
      </Link>
      <p className="mt-1 text-sm opacity-90">{subtitle}</p>
      <HeaderWordmark />
    </header>
  );
}
