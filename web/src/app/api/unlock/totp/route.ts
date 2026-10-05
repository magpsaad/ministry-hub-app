import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServerKeyClient } from "@/lib/screen-lock-server";

/** Unlock with the authenticator app's code (Admins and GCs have one; so does
 * anyone else who turned it on). */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { code?: string } | null;
  const code = String(body?.code ?? "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(code)) return NextResponse.json({ error: "Enter the 6-digit code from the app." }, { status: 400 });

  const supabase = await createClient();
  const { data: list } = await supabase.auth.mfa.listFactors();
  const factor = list?.totp?.find((f) => f.status === "verified");
  if (!factor) return NextResponse.json({ error: "You don't have an authenticator app set up." }, { status: 400 });

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) {
    return NextResponse.json(
      { error: "That code didn't work. Codes change every 30 seconds -- try the current one." },
      { status: 400 },
    );
  }
  const server = await createServerKeyClient();
  const { error: unlockError } = await server.rpc("unlock_session");
  if (unlockError) return NextResponse.json({ error: "Couldn't unlock. Please try again." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
