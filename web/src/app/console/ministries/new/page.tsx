import { getConsoleAccess, listMinistries } from "@/lib/console";
import { ConsoleShell, NotAuthorized } from "@/components/console/ConsoleShell";
import { CreateMinistryInteractive } from "@/components/console/CreateMinistryInteractive";

/** MULTI_TENANT_PLAN.md §3.8 -- Create ministry: everything is created in
 * one step by create_ministry() (settings row, audit switches, Actions
 * Needed thresholds, the pre-entry group and its intake-only QR code, the
 * Servants QR code, the address records, and the first Admins' profiles
 * and roles), then the manual checklist is shown. */
export default async function ConsoleCreateMinistryPage() {
  const access = await getConsoleAccess();
  if (!access.isChurchAdmin) return <NotAuthorized email={access.email} />;

  const ministries = await listMinistries();
  const env = process.env.NEXT_PUBLIC_APP_ENV === "prod" ? "production" : "QA";

  return (
    <ConsoleShell title="Create Ministry" email={access.email}>
      <CreateMinistryInteractive
        environment={env}
        existing={ministries.map((m) => ({ id: m.id, name: m.name }))}
      />
    </ConsoleShell>
  );
}
