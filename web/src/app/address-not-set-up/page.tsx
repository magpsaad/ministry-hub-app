import { redirect } from "next/navigation";
import { getAddressContext } from "@/lib/ministry-context";
import { MinistryHubLogo, MinistryHubName } from "@/components/MinistryHubBrand";

/** MULTI_TENANT_PLAN.md §3.2 -- what an address nobody set up shows (the
 * proxy gate rewrites every request on such an address here). Makes no data
 * call of any kind and names no ministry.
 *
 * Owner-requested (17 Oct 2026): also the sign-in service's default
 * address (Supabase "Site URL"), where it sends anyone whose sign-in it
 * can't send back to their own ministry -- before, that was one ministry's
 * address, and an HSY servant ended up on SAY's sign-in page. Branded with
 * the app's own emblem and name (owner-requested), never a ministry's. */
export default async function AddressNotSetUpPage() {
  const ctx = await getAddressContext();
  if (ctx.kind !== "unknown") redirect("/");

  return (
    <div className="min-h-full flex flex-col items-center justify-center bg-[#f5f5f5] p-4">
      <div className="mb-6 flex items-center justify-center gap-2.5">
        <MinistryHubLogo size={44} />
        <MinistryHubName className="h-6" />
      </div>
      <div className="max-w-sm w-full text-center bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-6">
        <h1 className="text-lg font-bold text-brand">Please use your ministry&rsquo;s link</h1>
        <p className="mt-2 text-sm text-[#666]">
          This page doesn&rsquo;t belong to any ministry. If you were signing in, it didn&rsquo;t finish: open the link your
          ministry gave you and sign in again.
        </p>
        <p className="mt-3 text-sm text-[#666]">
          If you need help, check with the System Admin of your ministry, or contact the Church Admin, Maged Saad.
        </p>
      </div>
    </div>
  );
}
