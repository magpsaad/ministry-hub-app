import { NextResponse, type NextRequest } from "next/server";
import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { createClient } from "@/lib/supabase/server";
import { createServerKeyClient, fromBase64Url, relyingParty, takeChallenge } from "@/lib/screen-lock-server";

const FAILED = "That didn't work. Try again, or use another way below.";

/** Face ID unlock, step 2: checks the device's answer here, on this server,
 * then unlocks this sign-in. Requires the phone's own check of the person
 * (Face ID, fingerprint or the device PIN), not just the device. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { response?: AuthenticationResponseJSON } | null;
  const response = body?.response;
  const challenge = await takeChallenge("unlock", user.id);
  if (!response?.id || !challenge) return NextResponse.json({ error: FAILED }, { status: 400 });

  const { rpID, origin } = await relyingParty();
  const { data: device } = await supabase
    .from("unlock_devices")
    .select("credential_id, public_key, sign_count, transports")
    .eq("credential_id", response.id)
    .eq("rp_id", rpID)
    .maybeSingle();
  if (!device) return NextResponse.json({ error: FAILED }, { status: 400 });

  let newCounter = 0;
  try {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: device.credential_id as string,
        publicKey: fromBase64Url(device.public_key as string),
        counter: Number(device.sign_count ?? 0),
        transports: (device.transports as string[] | null) ?? undefined,
      },
      requireUserVerification: true,
    });
    if (!result.verified) return NextResponse.json({ error: FAILED }, { status: 400 });
    newCounter = result.authenticationInfo.newCounter;
  } catch {
    return NextResponse.json({ error: FAILED }, { status: 400 });
  }

  const server = await createServerKeyClient();
  const used = await server.rpc("use_unlock_device", { p_credential_id: device.credential_id, p_sign_count: newCounter });
  const unlocked = await server.rpc("unlock_session");
  if (used.error || unlocked.error) return NextResponse.json({ error: FAILED }, { status: 500 });
  return NextResponse.json({ ok: true });
}
