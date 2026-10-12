"use server";

import { createClient } from "@/lib/supabase/server";

/** Migration 0110: this person opened the app from its home screen icon on
 * this ministry's address (Audit Logs -> Device setup). A no-op when not
 * signed in. Never throws. */
export async function noteHomeIconAction(): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.rpc("note_home_icon");
  } catch {
    // Best effort -- it's only a check mark.
  }
}

/** Migration 0114: this person opened the app in the browser (from a link),
 * not from its home screen icon. True once recorded; false when not signed
 * in, so the app tries again after sign-in. Never throws. */
export async function noteLinkOpenAction(): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.rpc("note_link_open");
    return data === true;
  } catch {
    return false;
  }
}
