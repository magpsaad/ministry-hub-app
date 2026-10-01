import Link from "next/link";
import { getConsoleAccess, listMinistries } from "@/lib/console";
import { ConsoleShell, NotAuthorized } from "@/components/console/ConsoleShell";
import { EditMinistryInteractive } from "@/components/console/EditMinistryInteractive";
import { SetupChecklist } from "@/components/console/SetupChecklist";

/** MULTI_TENANT_PLAN.md §3.8 -- Edit ministry: name, order and addresses.
 * The code is shown but can never change. Everything in the ministry's own
 * App Settings (logo, labels, colours, schedule, timezone...) is edited on
 * that ministry's App Settings screen, which the Church Admin can open on
 * any ministry's address (links below). */
export default async function ConsoleEditMinistryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const access = await getConsoleAccess();
  if (!access.isChurchAdmin) return <NotAuthorized email={access.email} />;

  const { id } = await params;
  const { created } = await searchParams;
  const ministry = (await listMinistries()).find((m) => m.id === id.toUpperCase());

  if (!ministry) {
    return (
      <ConsoleShell title="Ministry not found" email={access.email}>
        <p className="text-sm text-[#666]">
          There&rsquo;s no ministry with the code {id}.{" "}
          <Link href="/console" className="font-semibold text-brand">
            Back to Ministries
          </Link>
        </p>
      </ConsoleShell>
    );
  }

  return (
    <ConsoleShell title={`Edit ${ministry.name}`} email={access.email}>
      {/* Owner-requested: after Create Ministry (?created=1) the setup steps
          stay until dismissed; any time later, "Show setup steps". */}
      <SetupChecklist
        key={created ?? ""}
        code={ministry.id}
        name={ministry.name}
        environment={process.env.NEXT_PUBLIC_APP_ENV === "prod" ? "production" : "QA"}
        hosts={ministry.addresses}
        justCreated={created === "1"}
      />
      <EditMinistryInteractive ministry={ministry} />
    </ConsoleShell>
  );
}
