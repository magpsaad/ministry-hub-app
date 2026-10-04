"use client";

import { useEffect, useState } from "react";
import { getOutreachContactAction } from "@/app/g/[groupId]/outreach/actions";
import { PhoneIcon, MessageIcon, WhatsAppIcon, MapPinIcon } from "@/components/icons";

export type QuickActionKind = "Call" | "Text" | "WhatsApp" | "Visit";

const BUTTON =
  "flex items-center justify-center gap-1.5 rounded-md bg-[#f0f0f0] px-3 py-2 text-sm font-semibold text-[#333] hover:bg-[#e0e0e0] shadow-[0_2px_4px_rgba(0,0,0,0.1)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.15)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.1)]";

function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

/** A number WhatsApp can open: country code + number, digits only. North
 * American 10-digit numbers get the missing leading 1. */
function whatsAppNumber(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `1${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

/** Owner-requested (4 Oct 2026): the outreach form's quick actions --
 * Call, Text and WhatsApp open the phone's own app (Text and WhatsApp with
 * a greeting already typed, e.g. "Hi Mina, it's Maged from SAY Ministry 🙂",
 * which the servant can edit before sending); Visit shows the youth's
 * address right under the buttons, with Maps / Google Maps links. Each one
 * also fills in the entry's Type. */
export function OutreachQuickActions({
  memberId,
  memberName,
  memberPhone,
  memberLabel,
  servantName,
  onType,
  onError,
}: {
  memberId: string | null;
  memberName: string | null;
  memberPhone: string | null | undefined;
  memberLabel: string;
  servantName: string;
  onType: (kind: QuickActionKind) => void;
  onError: (message: string | null) => void;
}) {
  const [info, setInfo] = useState<{ memberId: string; address: string | null; ministryName: string | null } | null>(null);
  // The youth whose address is showing (it hides when another is chosen).
  const [addressFor, setAddressFor] = useState<string | null>(null);

  // Loaded as soon as a youth is chosen, so the buttons can open the phone's
  // apps straight away (phones block an app opening after a wait).
  useEffect(() => {
    if (!memberId) return;
    let cancelled = false;
    getOutreachContactAction(memberId).then((res) => {
      if (!cancelled) setInfo({ memberId, ...res });
    });
    return () => {
      cancelled = true;
    };
  }, [memberId]);

  const current = info && info.memberId === memberId ? info : null;
  const greeting = `Hi ${firstName(memberName)}, it's ${firstName(servantName)}${
    current?.ministryName ? ` from ${current.ministryName}` : ""
  } 🙂`;

  function act(kind: QuickActionKind) {
    if (!memberId) {
      onError(`Please select a ${memberLabel.toLowerCase()} first.`);
      return;
    }
    onType(kind);
    onError(null);

    if (kind === "Visit") {
      setAddressFor(memberId);
      return;
    }
    setAddressFor(null);
    if (!memberPhone) {
      onError(`No phone number on file for ${memberName ?? "this " + memberLabel.toLowerCase()}.`);
      return;
    }
    const digits = memberPhone.replace(/[^\d+]/g, "");
    if (kind === "Call") {
      window.location.href = `tel:${digits}`;
    } else if (kind === "Text") {
      // "?&body=" works on both iPhone and Android.
      window.location.href = `sms:${digits}?&body=${encodeURIComponent(greeting)}`;
    } else {
      const wa = whatsAppNumber(memberPhone);
      if (!wa) {
        onError("This phone number isn't in a format WhatsApp can use. Please check it on the youth's record.");
        return;
      }
      window.open(`https://wa.me/${wa}?text=${encodeURIComponent(greeting)}`, "_blank", "noopener");
    }
  }

  const address = current?.address ?? null;
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <button type="button" onClick={() => act("Call")} className={BUTTON}>
          <PhoneIcon className="h-3.5 w-3.5" />
          Call
        </button>
        <button type="button" onClick={() => act("Text")} className={BUTTON}>
          <MessageIcon className="h-3.5 w-3.5" />
          Text
        </button>
        <button type="button" onClick={() => act("WhatsApp")} className={BUTTON}>
          <WhatsAppIcon className="h-3.5 w-3.5" />
          WhatsApp
        </button>
        <button type="button" onClick={() => act("Visit")} className={BUTTON}>
          <MapPinIcon className="h-3.5 w-3.5" />
          Visit
        </button>
      </div>
      {memberId && addressFor === memberId && (
        <div className="mt-2 rounded-md border border-[#e0e0e0] bg-[#fafafa] p-3">
          {!current ? (
            <p className="text-sm text-[#888]">Loading the address&hellip;</p>
          ) : address ? (
            <>
              <p className="text-sm text-[#333]">
                <MapPinIcon className="mr-1 inline h-3.5 w-3.5 text-brand" />
                {address}
              </p>
              <div className="mt-2 flex gap-2">
                <a
                  href={`https://maps.apple.com/?q=${encodeURIComponent(address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 rounded-md bg-brand px-3 py-1.5 text-center text-xs font-semibold text-white hover:bg-brand-dark"
                >
                  Maps
                </a>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 rounded-md bg-brand px-3 py-1.5 text-center text-xs font-semibold text-white hover:bg-brand-dark"
                >
                  Google Maps
                </a>
              </div>
            </>
          ) : (
            <p className="text-sm text-[#666]">No address on file for {memberName ?? `this ${memberLabel.toLowerCase()}`}.</p>
          )}
        </div>
      )}
    </div>
  );
}
