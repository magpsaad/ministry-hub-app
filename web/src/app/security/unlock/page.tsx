import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "../shared";
import { UnlockScreen } from "./UnlockScreen";

/** Screen lock (migration 0089): where the front door sends a locked
 * sign-in that opens or reloads a page. Back to that page once unlocked. */
export default async function UnlockPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { next } = await searchParams;
  return <UnlockScreen next={safeNext(next)} />;
}
