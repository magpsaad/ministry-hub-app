"use client";

import { PRIMARY_BUTTON } from "../shared";
import { SubmitButton } from "@/components/PendingButton";

export function SignButton() {
  return (
    <SubmitButton className={PRIMARY_BUTTON} busyText="Signing…">
      Sign
    </SubmitButton>
  );
}

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark print:hidden"
    >
      Print or save as PDF
    </button>
  );
}
