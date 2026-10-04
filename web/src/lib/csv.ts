/** Security audit #7 (owner-approved, 4 Oct 2026): one CSV cell, quoted, and
 * made safe for Excel/Sheets -- a value starting with = + - @ (or a tab or
 * return) is a formula to them, so names typed at a public check-in like
 * `=HYPERLINK(...)` would run when an Admin opens the export. Such a value
 * gets a leading apostrophe, which spreadsheets show as plain text. */
export function csvCell(value: string | null | undefined): string {
  let text = value ?? "";
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
