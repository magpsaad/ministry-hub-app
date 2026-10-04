/** Where to go after the authenticator step: a page of THIS app only (same
 * rule as the sign-in callback), never another site. */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
  if (raw.startsWith("/security/")) return "/";
  return raw;
}

export const CARD = "rounded-xl bg-white p-5 shadow-[0_4px_20px_rgba(0,0,0,0.06)]";
export const PRIMARY_BUTTON =
  "w-full rounded-md bg-brand py-3 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.15)]";
export const CODE_INPUT =
  "w-full rounded-md border border-[#ddd] px-3 py-2.5 text-center text-lg tracking-[0.4em] focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/10";
