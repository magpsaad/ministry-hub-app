/** Servants' birthdays (migration 0116): day and month only, no year. */

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Days in a month, counting February 29 (no year is kept). */
export function daysInMonth(month: number): number {
  return month === 2 ? 29 : [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Both empty (no birthday), or a real day of a real month. */
export function validBirthday(month: number | null, day: number | null): boolean {
  if (month === null && day === null) return true;
  if (month === null || day === null) return false;
  return Number.isInteger(month) && Number.isInteger(day) && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(month);
}

/** "March 12", or "" when not set. */
export function formatBirthday(month: number | null, day: number | null): string {
  return month && day ? `${MONTH_NAMES[month - 1]} ${day}` : "";
}
