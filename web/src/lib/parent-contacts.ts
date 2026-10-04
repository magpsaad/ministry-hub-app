/** Owner-requested (4 Oct 2026, migration 0087): parents' contact details on
 * a youth's record, for the ministries that switch them on in Ministry
 * Settings (app_settings.show_parent_contacts) -- High School and Sunday
 * School. Every field is optional. While the switch is off the app neither
 * shows nor sends them. */
export type ParentContacts = {
  parent1_name: string | null;
  parent1_phone: string | null;
  parent1_email: string | null;
  parent2_name: string | null;
  parent2_phone: string | null;
  parent2_email: string | null;
};

export type ParentField = keyof ParentContacts;

export const PARENT_FIELDS: { key: ParentField; label: string; kind: "name" | "phone" | "email"; maxLength: number }[] = [
  { key: "parent1_name", label: "Parent 1 Name", kind: "name", maxLength: 80 },
  { key: "parent1_phone", label: "Parent 1 Phone", kind: "phone", maxLength: 30 },
  { key: "parent1_email", label: "Parent 1 Email", kind: "email", maxLength: 254 },
  { key: "parent2_name", label: "Parent 2 Name", kind: "name", maxLength: 80 },
  { key: "parent2_phone", label: "Parent 2 Phone", kind: "phone", maxLength: 30 },
  { key: "parent2_email", label: "Parent 2 Email", kind: "email", maxLength: 254 },
];

export const PARENT_COLUMNS = PARENT_FIELDS.map((f) => f.key).join(", ");

export const EMPTY_PARENTS: ParentContacts = {
  parent1_name: null,
  parent1_phone: null,
  parent1_email: null,
  parent2_name: null,
  parent2_phone: null,
  parent2_email: null,
};

/** Just the six parents' fields, trimmed, blanks as null -- whatever else
 * `input` holds never rides along. */
export function pickParents(input: Partial<ParentContacts> | null | undefined): ParentContacts {
  const out = { ...EMPTY_PARENTS };
  for (const { key } of PARENT_FIELDS) out[key] = input?.[key]?.trim() || null;
  return out;
}
