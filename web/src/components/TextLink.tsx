"use client";

import { MessageIcon } from "@/components/icons";

/** Clickable sms: link -- the Outreach tab's "Quick Text" action (REQUIREMENTS.md §6.6). */
export function TextLink({ phone, className }: { phone: string | null; className?: string }) {
  if (!phone) return null;
  return (
    <a
      href={`sms:${phone.replace(/[^\d+]/g, "")}`}
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex items-center gap-1 text-brand hover:underline ${className ?? ""}`}
    >
      <MessageIcon className="h-3 w-3" />
      Text
    </a>
  );
}
