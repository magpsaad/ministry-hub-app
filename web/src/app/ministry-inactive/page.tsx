import { redirect } from "next/navigation";
import { getAddressContext } from "@/lib/ministry-context";
import { getCurrentUser } from "@/lib/supabase/get-current-user";
import { SignOutButton } from "@/components/SignOutButton";

/** MULTI_TENANT_PLAN.md §3.2 / §3.8 -- what an inactive ministry's address
 * shows everyone except the Church Admin (the proxy gate rewrites here).
 * The ministry's data is kept; nobody but the Church Admin can sign in or
 * check in until it's turned back on. */
export default async function MinistryInactivePage() {
  const ctx = await getAddressContext();
  if (ctx.kind !== "ministry" || ctx.isActive) redirect("/");

  const user = await getCurrentUser();

  return (
    <div className="min-h-full flex items-center justify-center bg-[#f5f5f5] p-4">
      <div className="max-w-sm w-full text-center bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-6">
        <h1 className="text-lg font-bold text-brand">This ministry isn&rsquo;t active</h1>
        <p className="mt-2 text-sm text-[#666]">
          {ctx.name} isn&rsquo;t using this app right now. If you think this is a mistake, please contact your
          ministry&rsquo;s coordinators.
        </p>
        {user && (
          <div className="mt-4 flex justify-center">
            <SignOutButton className="text-[#666] hover:text-brand transition-colors" />
          </div>
        )}
      </div>
    </div>
  );
}
