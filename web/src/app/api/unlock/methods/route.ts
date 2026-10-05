import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { relyingParty } from "@/lib/screen-lock-server";
import type { UnlockMethods } from "@/lib/screen-lock";

/** Which ways this person can unlock on this address: Face ID (a device set
 * up for this address) and/or their authenticator app. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  const { rpID } = await relyingParty();
  const [{ count }, { data: factors }, { data: profile }] = await Promise.all([
    supabase.from("unlock_devices").select("id", { count: "exact", head: true }).eq("rp_id", rpID),
    supabase.auth.mfa.listFactors(),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);
  const methods: UnlockMethods = {
    faceId: (count ?? 0) > 0,
    authenticator: (factors?.totp ?? []).some((f) => f.status === "verified"),
    name: (profile?.full_name as string | undefined) ?? null,
  };
  return NextResponse.json(methods, { headers: { "Cache-Control": "no-store" } });
}
