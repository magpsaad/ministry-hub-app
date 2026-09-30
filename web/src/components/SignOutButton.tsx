"use client";

import { useTransition } from "react";
import { signOut } from "@/app/login/actions";
import { LogOutIcon } from "@/components/icons";
import { MY_ASSIGNED_STORAGE_KEY } from "@/components/MyAssignedContext";
import { clearMenuData } from "@/components/menuStore";

/** Clears "My Assigned List" before signing out -- sessionStorage otherwise
 * survives a sign-out/sign-in cycle for as long as the browser tab stays
 * open (its lifetime is the tab, not the login session), so the next
 * sign-in was incorrectly inheriting whatever state the previous session
 * left it in instead of defaulting to unchecked. */
export function SignOutButton({ className }: { className?: string }) {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    try {
      sessionStorage.removeItem(MY_ASSIGNED_STORAGE_KEY);
    } catch {
      // sessionStorage unavailable (e.g. private browsing); sign-out still proceeds.
    }
    // The side menu's saved copy is this person's; never show it to the next.
    clearMenuData();
    startTransition(async () => {
      await signOut();
    });
  }

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      title="Exit"
      aria-label="Exit"
      className={`inline-flex items-center gap-1 ${className ?? ""}`}
    >
      <LogOutIcon className="h-4 w-4" />
      <span className="text-xs font-medium">Exit</span>
    </button>
  );
}
