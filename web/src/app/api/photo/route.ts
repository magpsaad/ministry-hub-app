import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { photosBucket } from "@/lib/storage";

/** Owner-requested (3 Oct 2026): every photo of a person -- youths and
 * servants alike -- is private. The photos bucket is private (migration
 * 0075) and its read rule lets a signed-in person see only the photos they
 * could see in the app (a youth's photo: someone with access to that youth's
 * class; a servant's photo: anyone signed in to that ministry). The app shows
 * photos through this address (memberPhotoUrl/servantPhotoUrl): it asks
 * storage, as the signed-in person, for a link to the photo that stops
 * working after an hour, and sends the browser there. Anyone else gets
 * nothing (signed out: the proxy sends them to sign-in; no access: 404). */
const PHOTO_PATH = /^[A-Z]{3}\/(members|profiles)\/[A-Za-z0-9._-]+$/;
const LINK_SECONDS = 60 * 60;

export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get("p") ?? "";
  if (!PHOTO_PATH.test(path)) return notFound();

  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(photosBucket()).createSignedUrl(path, LINK_SECONDS);
  if (error || !data?.signedUrl) return notFound();

  const response = NextResponse.redirect(data.signedUrl, 302);
  // Kept by this browser only, and a little shorter than the link itself.
  response.headers.set("Cache-Control", `private, max-age=${LINK_SECONDS - 600}`);
  return response;
}

function notFound() {
  return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}
