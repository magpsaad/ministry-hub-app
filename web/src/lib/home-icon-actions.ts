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
