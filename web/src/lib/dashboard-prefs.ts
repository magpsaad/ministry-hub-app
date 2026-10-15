/** Owner-requested (15 Oct 2026, migration 0116): the Dashboard panels each
 * person can choose to start open or collapsed (My Settings -> Dashboard).
 * The Overview always stays open. */
export const DASHBOARD_PANELS = ["servant_team", "birthdays", "registrations", "actions_needed"] as const;
export type DashboardPanel = (typeof DASHBOARD_PANELS)[number];
export type DashboardStartOpen = Record<DashboardPanel, boolean>;

/** Everything starts collapsed unless the person chose otherwise. */
export const DEFAULT_START_OPEN: DashboardStartOpen = {
  servant_team: false,
  birthdays: false,
  registrations: false,
  actions_needed: false,
};

/** "Youth" stays "Youth"; any other word gets an "s" ("Students"). */
export function memberPlural(memberLabel: string): string {
  return /youth$/i.test(memberLabel) ? memberLabel : `${memberLabel}s`;
}

/** The panels' names, in this ministry's words. */
export function dashboardPanelNames(memberLabel: string, servantsLabel: string): Record<DashboardPanel, string> {
  return {
    servant_team: `My ${servantsLabel} Team`,
    birthdays: `${memberLabel} Birthdays`,
    registrations: `New ${memberLabel} Registrations`,
    actions_needed: `Actions Needed for the ${memberPlural(memberLabel)}`,
  };
}
