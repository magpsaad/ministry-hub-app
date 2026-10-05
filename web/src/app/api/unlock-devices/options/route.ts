import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { createClient } from "@/lib/supabase/server";
import { relyingParty, saveChallenge } from "@/lib/screen-lock-server";

/** Turning Face ID unlock on for this device, step 1. Only from an unlocked
 * sign-in (the front door refuses this address while locked). Asks for the
 * device's own built-in check (Face ID, fingerprint, Windows Hello or the
 * device PIN), not a separate security key or another phone. */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  const { rpID } = await relyingParty();
  const [{ data: devices }, { data: profile }] = await Promise.all([
    supabase.from("unlock_devices").select("credential_id, transports").eq("rp_id", rpID),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);
  const options = await generateRegistrationOptions({
    rpName: "Ministry Hub",
    rpID,
    userName: user.email,
    userDisplayName: (profile?.full_name as string | undefined) ?? user.email,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    excludeCredentials: (devices ?? []).map((d) => ({
      id: d.credential_id as string,
      transports: (d.transports as string[] | null) ?? undefined,
    })),
    authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "preferred", userVerification: "required" },
  });
  await saveChallenge("register", user.id, options.challenge);
  return NextResponse.json(options, { headers: { "Cache-Control": "no-store" } });
}
