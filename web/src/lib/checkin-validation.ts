/** The check-in forms' rules, shared by the forms (instant feedback, before
 * anything is sent -- owner-reported 4 Oct 2026: a bad name used to be
 * caught only at the "Is this you?" confirm step, after the form was gone)
 * and the server actions. Same rules and wording as the database's
 * checkin_check_person (migration 0080), which stays the real backstop. */
export const NAME_PROBLEM = "Please enter your name using letters only (2 to 80 characters).";

const NAME_RE = /^\p{L}[\p{L} .,()'’-]*$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type CheckinPersonFields = {
  full_name: string;
  phone: string | null;
  email: string | null;
  gender: string | null;
  home_address?: string | null;
  program_of_study?: string | null;
  father_of_confession?: string | null;
  comments?: string | null;
  date_of_birth?: string | null;
};

export function checkinPersonProblem(f: CheckinPersonFields): string | null {
  const name = f.full_name.trim().replace(/\s+/g, " ");
  if (!name || name.split(" ").length < 2) return "Please enter your first and last name.";
  if (name.length > 80 || !NAME_RE.test(name)) return NAME_PROBLEM;

  const digits = (f.phone ?? "").replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 11) return "Please enter a valid phone number.";
  const email = (f.email ?? "").trim();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return "Please enter a valid email address.";
  if (!f.gender) return "Please select a gender.";

  if ((f.home_address ?? "").length > 200) return "Please keep the address under 200 characters.";
  if ((f.program_of_study ?? "").length > 100) return "Please keep that answer under 100 characters.";
  if ((f.father_of_confession ?? "").length > 80) return "Please keep the Father of Confession under 80 characters.";
  if ((f.comments ?? "").length > 500) return "Please keep comments under 500 characters.";
  if (f.date_of_birth) {
    const today = new Date().toISOString().slice(0, 10);
    if (f.date_of_birth < "1940-01-01" || f.date_of_birth > today) return "Please enter a valid date of birth.";
  }
  return null;
}
