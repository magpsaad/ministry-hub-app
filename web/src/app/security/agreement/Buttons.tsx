"use client";

import { useFormStatus } from "react-dom";
import { PRIMARY_BUTTON } from "../shared";

export function SignButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
      {pending ? "Signing…" : "Sign"}
    </button>
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
