import { redirect } from "next/navigation";
import { getAddressContext } from "@/lib/ministry-context";

/** MULTI_TENANT_PLAN.md §3.2 -- what an address nobody set up shows (the
 * proxy gate rewrites every request on such an address here). Makes no data
 * call of any kind and names no ministry. */
export default async function AddressNotSetUpPage() {
  const ctx = await getAddressContext();
  if (ctx.kind !== "unknown") redirect("/");

  return (
    <div className="min-h-full flex items-center justify-center bg-[#f5f5f5] p-4">
      <div className="max-w-sm w-full text-center bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-6">
        <h1 className="text-lg font-bold text-brand">This address isn&rsquo;t set up</h1>
        <p className="mt-2 text-sm text-[#666]">
          There&rsquo;s nothing here yet. Check that you&rsquo;re using the address your ministry gave you.
        </p>
      </div>
    </div>
  );
}
