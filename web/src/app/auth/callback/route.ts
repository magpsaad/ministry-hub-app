import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Owner-approved sign-in fix F (security audit 3 Oct 2026): where to go
 * after signing in must be a page of THIS app. `next=//evil.example` or
 * `next=@evil.example` used to send a freshly signed-in person to another
 * site; anything that isn't a plain in-app path now goes home. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
  return raw;
}

/** Exchanges the Google sign-in `code` for a session, then sends the user on. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  return NextResponse.redirect(new URL("/login?error=signin_failed", origin));
}
