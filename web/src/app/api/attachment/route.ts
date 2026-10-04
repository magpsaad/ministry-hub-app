import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { calendarBucket } from "@/lib/storage";

/** Security audit #6 (owner-approved, 4 Oct 2026; migration 0085): calendar
 * attachments are private, like photos (see api/photo/route.ts). The app
 * links to this address; it asks storage, as the signed-in person, for a
 * link to the file that stops working after an hour, and sends the browser
 * there. Only people signed in to that ministry get one (signed out: the
 * proxy sends them to sign-in; anyone else: 404). */
const ATTACHMENT_PATH = /^[A-Z]{3}\/calendar\/[0-9a-fA-F-]{36}-[0-9]+\.[A-Za-z0-9]{1,10}$/;
const LINK_SECONDS = 60 * 60;

export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get("p") ?? "";
  if (!ATTACHMENT_PATH.test(path)) return notFound();

  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(calendarBucket()).createSignedUrl(path, LINK_SECONDS);
  if (error || !data?.signedUrl) return notFound();

  const response = NextResponse.redirect(data.signedUrl, 302);
  response.headers.set("Cache-Control", `private, max-age=${LINK_SECONDS - 600}`);
  return response;
}

function notFound() {
  return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}
