/** Owner-approved sign-in fix F (security audit 3 Oct 2026): the sign-in
 * page only ever shows these fixed messages, chosen by a short code in the
 * address (`/login?error=bad_code`). It used to print whatever text was in
 * the address, so a crafted link could make the real page say anything
 * ("Your account is locked, call ..."). Unknown codes show nothing. */
export const LOGIN_ERRORS = {
  signin_failed: "We couldn't sign you in. Please try again.",
  google_failed: "Google sign-in didn't start. Please try again.",
  send_failed: "We couldn't send the code. Please try again.",
  rate: "Too many codes were requested. Please wait a minute and try again.",
  already_sent:
    "A code was already sent to this address in the last minute. Enter it below, or wait a minute, then tap Send a new code.",
  captcha: "Please complete the security check and try again.",
  bad_code: "That code didn't work or has expired. Check the latest email, or send a new code.",
  invalid_email: "Enter a valid email address.",
  name_required: "Enter your full name.",
  expired: "That sign-in step expired. Please enter your email again.",
} as const;

export const LOGIN_MESSAGES = {
  signed_out_everywhere: "You've been signed out on all your devices.",
} as const;

export type LoginErrorCode = keyof typeof LOGIN_ERRORS;
export type LoginMessageCode = keyof typeof LOGIN_MESSAGES;

export function loginError(code: string | undefined): string | null {
  return code && code in LOGIN_ERRORS ? LOGIN_ERRORS[code as LoginErrorCode] : null;
}

export function loginMessage(code: string | undefined): string | null {
  return code && code in LOGIN_MESSAGES ? LOGIN_MESSAGES[code as LoginMessageCode] : null;
}

/** The email a code was just sent to, kept for the code-entry step in a
 * short-lived cookie only the server can read -- never in the address,
 * where it would end up in browser history and logs. */
export const CODE_EMAIL_COOKIE = "mh_code_email";
export const CODE_EMAIL_SECONDS = 15 * 60;

/** "ma•••@gmail.com" -- which inbox to check, without spelling it out. */
export function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}${"•".repeat(Math.max(3, name.length - 2))}@${domain ?? ""}`;
}
