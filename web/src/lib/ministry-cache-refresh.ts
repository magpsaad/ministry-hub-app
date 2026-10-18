import { updateTag } from "next/cache";
import { getActiveMinistry } from "@/lib/ministry-context";
import { RELEASE_TAG, ministrySettingsTag } from "@/lib/ministry-cache";

/** Owner-approved (17 Oct 2026) -- the "push" for the shared settings copy
 * (lib/ministry-cache.ts). Called from the Server Actions that save
 * settings, after the save succeeded: everyone's next page open reads the
 * new values, and the person who saved sees them straight away. */

/** This address's ministry saved one of its settings. */
export async function ministrySettingsChanged(): Promise<void> {
  updateTag(ministrySettingsTag(await getActiveMinistry()));
}

/** A release was added or edited (church-wide). */
export function releasesChanged(): void {
  updateTag(RELEASE_TAG);
}

/** The console: these ministries' settings (and the release number) may
 * have changed outside the app -- read them all afresh. */
export function refreshMinistries(ministryIds: string[]): void {
  for (const id of ministryIds) updateTag(ministrySettingsTag(id));
  updateTag(RELEASE_TAG);
}
