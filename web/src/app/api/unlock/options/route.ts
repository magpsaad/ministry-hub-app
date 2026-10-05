import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { createClient } from "@/lib/supabase/server";
import { relyingParty, saveChallenge } from "@/lib/screen-lock-server";

/** Face ID unlock, step 1: a one-time challenge for this person's devices on
 * this address. */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  const { rpID } = await relyingParty();
  const { data: devices } = await supabase.from("unlock_devices").select("credential_id, transports").eq("rp_id", rpID);
  if (!devices?.length) {
    return NextResponse.json({ error: "Face ID isn't set up on this device yet." }, { status: 400 });
  }
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: devices.map((d) => ({
      id: d.credential_id as string,
      transports: (d.transports as string[] | null) ?? undefined,
    })),
    userVerification: "required",
  });
  await saveChallenge("unlock", user.id, options.challenge);
  return NextResponse.json(options, { headers: { "Cache-Control": "no-store" } });
}
