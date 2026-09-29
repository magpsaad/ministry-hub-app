import Link from "next/link";
import { getConsoleAccess, listMinistries } from "@/lib/console";
import { addressUrl } from "@/lib/address-url";
import { ConsoleShell, NotAuthorized } from "@/components/console/ConsoleShell";
import { MinistryActiveToggle } from "@/components/console/MinistryActiveToggle";

/** MULTI_TENANT_PLAN.md §3.8 -- Ministries: every ministry in this
 * environment, with its addresses, Admin count and on/off switch. There is
 * deliberately no delete. */
export default async function ConsoleMinistriesPage() {
  const access = await getConsoleAccess();
  if (!access.isChurchAdmin) return <NotAuthorized email={access.email} />;

  const ministries = await listMinistries();
  const env = process.env.NEXT_PUBLIC_APP_ENV === "prod" ? "production" : "QA";

  return (
    <ConsoleShell title="Ministries" email={access.email}>
      <p className="text-sm text-[#666]">
        Every ministry in <strong>{env}</strong>. The addresses listed are this environment&rsquo;s only &mdash; each
        ministry&rsquo;s {env === "QA" ? "production" : "QA"} addresses are managed in the{" "}
        {env === "QA" ? "production" : "QA"} console.
      </p>

      {ministries.map((m) => (
        <section key={m.id} className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-[#f0f4f8] px-2 py-0.5 font-mono text-sm font-bold tracking-widest text-brand">
                  {m.id}
                </span>
                <h2 className="text-lg font-bold text-[#333] truncate">{m.name}</h2>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    m.is_active ? "bg-[#d4edda] text-[#155724]" : "bg-[#eee] text-[#666]"
                  }`}
                >
                  {m.is_active ? "Active" : "Inactive"}
                </span>
              </div>
              <p className="mt-1 text-xs text-[#666]">
                {m.admin_count} Admin{m.admin_count === 1 ? "" : "s"} &middot; created{" "}
                {new Date(m.created_at).toLocaleDateString("en-CA", { timeZone: "UTC" })}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <MinistryActiveToggle code={m.id} name={m.name} isActive={m.is_active} />
              <Link href={`/console/ministries/${m.id}`} className="text-xs font-semibold text-brand hover:underline">
                Edit
              </Link>
            </div>
          </div>

          <div className="mt-3">
            <p className="text-xs font-semibold text-[#333] mb-1">Addresses</p>
            {m.addresses.length === 0 ? (
              <p className="text-xs text-[#dc3545]">None yet &mdash; nobody can reach this ministry.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {m.addresses.map((h) => (
                  <li key={h}>
                    <a
                      href={addressUrl(h)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md border border-[#ddd] px-2 py-1 text-xs text-brand hover:bg-[#f0f4f8]"
                    >
                      {h} &#8599;
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ))}

      {ministries.length === 0 && <p className="text-sm text-[#666]">No ministries yet.</p>}

      <p className="text-xs text-[#999]">
        Church Admins are managed directly in the database for now (you are the only one).
      </p>
    </ConsoleShell>
  );
}
