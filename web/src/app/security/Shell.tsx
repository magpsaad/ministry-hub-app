import { MinistryHubLogo, MinistryHubName } from "@/components/MinistryHubBrand";

/** The plain frame the Account Security pages share. Deliberately not the
 * ministry's header: these pages also open on the console's address and
 * before the second sign-in step, where nothing of the ministry loads yet. */
export function SecurityShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-full flex items-start justify-center bg-[#f5f5f5] px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-5 flex items-center justify-center gap-2.5">
          <MinistryHubLogo size={40} />
          <MinistryHubName className="h-6" />
        </div>
        <h1 className="mb-4 text-center text-xl font-bold text-brand">{title}</h1>
        {children}
      </div>
    </div>
  );
}
