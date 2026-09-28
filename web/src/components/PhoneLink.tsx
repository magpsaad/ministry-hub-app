"use client";

import { PhoneIcon } from "@/components/icons";

/** Clickable tel: link, used wherever a phone number is shown (member cards,
 * detail modal, birthdays, unassigned list). */
export function PhoneLink({ phone, className }: { phone: string | null; className?: string }) {
  if (!phone) return null;
  return (
    <a
      href={`tel:${phone.replace(/[^\d+]/g, "")}`}
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex items-center gap-1 text-brand hover:underline ${className ?? ""}`}
    >
      <PhoneIcon className="h-3 w-3" />
      {phone}
    </a>
  );
}
