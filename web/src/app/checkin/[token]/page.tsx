import { cookies } from "next/headers";
import { getCheckInFlow, listCheckInMembers, listCheckInServants } from "@/lib/checkin";
import { getUniversities } from "@/lib/universities";
import { getAppSettings } from "@/lib/app-settings";
import { getActiveMinistry } from "@/lib/ministry-context";
import { getCurrentUser } from "@/lib/supabase/get-current-user";
import { weekdayName } from "@/lib/attendance-window";
import { SERVANT_CHECKIN_COOKIE, MEMBER_CHECKIN_COOKIE, parseRememberedCheckinPerson } from "@/lib/checkin-remember-cookie";
import { AppLogo } from "@/components/AppLogo";
import { BackButton } from "@/components/BackButton";
import { MenuButton } from "@/components/MenuButton";
import { RefreshButton } from "@/components/RefreshButton";
import { CheckInFlow } from "@/components/checkin/CheckInFlow";

/** REQUIREMENTS.md §6.11/§6.12 -- public, no-login check-in/intake page.
 * One route serves every group's QR code and the "Servants" QR alike; the
 * token alone (via checkin_get_flow) decides which flow to render. */
export default async function CheckInPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // The school list is fetched up front with the flow lookup (it used to
  // wait for it -- an extra round trip on every QR scan). It's small and
  // readable without signing in; the servants' flow simply doesn't use it.
  const [flow, settings, allUniversities, ministryId, user] = await Promise.all([
    getCheckInFlow(token),
    getAppSettings(),
    getUniversities(),
    getActiveMinistry(),
    getCurrentUser(),
  ]);

  // A QR code only works on its own ministry's address (it's printed with
  // that address). Opened on another ministry's address, it's treated as
  // unrecognized -- this page must never show one ministry's code under
  // another ministry's name, logo or school list (MULTI_TENANT_PLAN.md
  // §3.2, V8).
  if (flow === "switched_off") {
    return (
      <div className="min-h-full flex items-center justify-center bg-[#f5f5f5] p-4">
        <div className="max-w-sm w-full text-center bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-6">
          <h1 className="text-lg font-bold text-[#dc3545]">Check-In Code Not Active</h1>
          <p className="mt-2 text-sm text-[#666]">This QR code isn&rsquo;t in use right now. Please ask a servant for help.</p>
        </div>
      </div>
    );
  }
  if (!flow || flow.ministryId !== ministryId) {
    return (
      <div className="min-h-full flex items-center justify-center bg-[#f5f5f5] p-4">
        <div className="max-w-sm w-full text-center bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-6">
          <h1 className="text-lg font-bold text-[#dc3545]">Invalid Check-In Code</h1>
          <p className="mt-2 text-sm text-[#666]">This QR code isn&rsquo;t recognized. Please ask a servant for help.</p>
        </div>
      </div>
    );
  }

  const people = await (flow.isServant
    ? listCheckInServants(token)
    : flow.flowType === "check_in_and_intake"
      ? listCheckInMembers(token)
      : Promise.resolve([]));
  const universities = flow.isServant ? [] : allUniversities;

  const rememberCookieName = flow.isServant ? SERVANT_CHECKIN_COOKIE : MEMBER_CHECKIN_COOKIE;
  const rememberedPersonId =
    flow.flowType === "check_in_and_intake"
      ? (parseRememberedCheckinPerson((await cookies()).get(rememberCookieName)?.value)?.id ?? null)
      : null;

  return (
    <div className="min-h-full bg-[#f5f5f5]">
      <header className="bg-gradient-to-br from-brand to-brand-light text-white px-5 py-6 text-center shadow-[0_2px_10px_rgba(0,0,0,0.1)] relative sticky top-[var(--qa-banner-h)] z-40">
        {/* Owner-requested: Menu, Back and Refresh on every check-in page
            (member, intake-only and servant alike), matching every other
            page in the app -- except that a signed-out youth on a member
            QR gets neither Menu nor Back (owner-reported: they led to
            sign-in, and a youth signing in there lands in Pending Servants
            as noise). The Servants QR keeps them, since servants do sign
            in. Exit lives in the side menu. */}
        <div className="absolute top-2.5 left-4 flex flex-col items-start gap-1">
          {(flow.isServant || user) && (
            <>
              <MenuButton />
              <BackButton />
            </>
          )}
        </div>
        <div className="absolute top-2.5 right-4">
          <RefreshButton />
        </div>
        <div className="flex justify-center">
          <AppLogo logoUrl={settings.logo_url} title={settings.app_title_short} size={56} />
        </div>
        <h1 className="mt-3 text-xl font-bold">{settings.app_title_short}</h1>
        <p className="mt-1 text-sm opacity-90">{flow.label}</p>
      </header>
      <main className="max-w-md mx-auto px-4 py-6">
        <CheckInFlow
          token={token}
          isServant={flow.isServant}
          flowType={flow.flowType}
          initialPeople={people}
          universities={universities}
          universityLabel={settings.university_label}
          programLabel={settings.program_label}
          groupLabel={settings.group_label}
          memberLabel={settings.member_label}
          groupName={flow.label}
          serviceDayName={weekdayName(settings.service_weekday)}
          rememberedPersonId={rememberedPersonId}
        />
      </main>
    </div>
  );
}
