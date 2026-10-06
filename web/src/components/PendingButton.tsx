"use client";

import { useFormStatus } from "react-dom";
import { useLinkStatus } from "next/link";
import { SpinnerIcon } from "@/components/icons";

/** Owner-reported (5 Oct 2026): a new GC's tap seemed to do nothing for a
 * second, so he tapped again -- the second request hit Supabase's "too many
 * codes" limit and threw him off the screen where he'd type his code. On
 * the sign-in, onboarding and check-in screens every button now locks the
 * moment it's pressed and shows a spinner until the next screen is up. */

/** A button's label while it works: a spinner, then the text. */
export function BusyLabel({ busy, busyText, children }: { busy: boolean; busyText?: string; children: React.ReactNode }) {
  if (!busy) return <>{children}</>;
  return (
    <span className="inline-flex items-center justify-center gap-2">
      <SpinnerIcon className="h-4 w-4 shrink-0" />
      {busyText ?? children}
    </span>
  );
}

/** The submit button of a form that runs a server action: disabled, with a
 * spinner, from the moment the form is sent until the next screen appears
 * (the action's redirect included). */
export function SubmitButton({
  children,
  busyText,
  className,
}: {
  children: React.ReactNode;
  busyText?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={`${className ?? ""} disabled:opacity-60`}>
      <BusyLabel busy={pending} busyText={busyText}>
        {children}
      </BusyLabel>
    </button>
  );
}

/** Put inside a <Link>: a spinner while the page it opens is loading. */
export function LinkSpinner() {
  const { pending } = useLinkStatus();
  return pending ? <SpinnerIcon className="ml-2 inline h-4 w-4 align-[-2px]" /> : null;
}
