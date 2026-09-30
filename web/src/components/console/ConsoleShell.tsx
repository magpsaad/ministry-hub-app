import Link from "next/link";
import { SignOutButton } from "@/components/SignOutButton";

const NAV = [
  { href: "/console", label: "Ministries" },
  { href: "/console/ministries/new", label: "Create Ministry" },
  { href: "/console/releases", label: "Release Notes" },
  // QA console only (migration 0068): never offered in production.
  ...(process.env.NEXT_PUBLIC_APP_ENV === "qa" ? [{ href: "/console/refresh-qa", label: "Refresh QA" }] : []),
];

/** Page frame for the Church Admin console (MULTI_TENANT_PLAN.md §3.8):
 * neutral chrome -- the console belongs to no ministry, so it never shows a
 * ministry's name, logo or colours in its own header. */
export function ConsoleShell({
  title,
  email,
  children,
}: {
  title: string;
  email: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-full flex flex-col bg-[#f5f5f5]">
      <header className="bg-gradient-to-br from-brand to-brand-light text-white px-5 pt-5 pb-3 shadow-[0_2px_10px_rgba(0,0,0,0.1)] relative sticky top-[var(--qa-banner-h)] z-40">
        <div className="absolute top-2.5 right-4 flex flex-col items-end gap-1">
          <SignOutButton className="text-white/70 hover:text-white transition-colors" />
          {email && <span className="text-[10px] text-white/60">{email}</span>}
        </div>
        <p className="text-center text-xs uppercase tracking-widest opacity-80">Church Admin Console</p>
        <h1 className="mt-1 text-center text-2xl font-bold">{title}</h1>
        <nav className="mt-3 flex flex-wrap justify-center gap-1">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="rounded-md px-3 py-1 text-xs font-semibold text-white/90 hover:bg-white/15 transition-colors"
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 py-6 space-y-4">{children}</main>
    </div>
  );
}

export function NotAuthorized({ email }: { email: string | null }) {
  return (
    <div className="min-h-full flex items-center justify-center bg-[#f5f5f5] p-4">
      <div className="max-w-sm w-full text-center bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-6">
        <h1 className="text-lg font-bold text-brand">Not authorized</h1>
        <p className="mt-2 text-sm text-[#666]">
          This console is for the Church Admin only{email ? ` (you're signed in as ${email})` : ""}.
        </p>
        <div className="mt-4 flex justify-center">
          <SignOutButton className="text-[#666] hover:text-brand transition-colors" />
        </div>
      </div>
    </div>
  );
}
