/** One suggestion at a time: the notifications prompt and the Face ID
 * suggestion both sit at the bottom of the screen, so whichever claims this
 * first keeps it for this visit (until the app is reloaded). Lives in the
 * browser only. */

let holder: string | null = null;

export function claimPromptSlot(name: string): boolean {
  if (holder && holder !== name) return false;
  holder = name;
  return true;
}

/** Give it back -- only when the suggestion decided not to show at all. */
export function releasePromptSlot(name: string) {
  if (holder === name) holder = null;
}
