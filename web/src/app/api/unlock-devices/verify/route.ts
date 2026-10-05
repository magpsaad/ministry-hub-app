import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { createClient } from "@/lib/supabase/server";
import { cleanLabel, createServerKeyClient, relyingParty, takeChallenge, toBase64Url } from "@/lib/screen-lock-server";

const FAILED = "Couldn't turn it on. Please try again.";

/** Turning Face ID unlock on for this device, step 2: checks the device's
 * answer here and keeps its PUBLIC key (nothing biometric is ever sent). */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { response?: RegistrationResponseJSON; label?: string } | null;
  const challenge = await takeChallenge("register", user.id);
  if (!body?.response || !challenge) return NextResponse.json({ error: FAILED }, { status: 400 });

  const { rpID, origin } = await relyingParty();
  let credential;
  try {
    const result = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
    if (!result.verified) return NextResponse.json({ error: FAILED }, { status: 400 });
    credential = result.registrationInfo.credential;
  } catch {
    return NextResponse.json({ error: FAILED }, { status: 400 });
  }

  const server = await createServerKeyClient();
  const { error } = await server.rpc("add_unlock_device", {
    p_credential_id: credential.id,
    p_public_key: toBase64Url(credential.publicKey),
    p_sign_count: credential.counter,
    p_transports: credential.transports ?? body.response.response.transports ?? null,
    p_rp_id: rpID,
    p_label: cleanLabel(body.label) || null,
  });
  if (error) {
    return NextResponse.json({ error: error.message.includes("10 devices") ? error.message : FAILED }, { status: 400 });
  }
  revalidatePath("/security");
  return NextResponse.json({ ok: true });
}
