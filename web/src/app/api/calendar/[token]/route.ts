import { NextResponse } from "next/server";
import { createCheckinClient } from "@/lib/supabase/checkin-client";
import { buildIcs, type Feed } from "@/lib/ics";

export const dynamic = "force-dynamic";

/** A person's private Service Calendar link (migration 0107), read by
 * Google / Apple / Outlook Calendar -- no sign-in, the long random code in
 * the address is the key. Only this server can read the feed from the
 * database (the check-in server key). One way: nothing is ever written
 * back except "last used". */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const code = token.replace(/\.ics$/i, "").toLowerCase();
  const notActive = () =>
    new NextResponse("This calendar link isn't active any more.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  if (!/^[0-9a-f]{64}$/.test(code)) return notActive();

  let feed: Feed | null = null;
  try {
    const supabase = await createCheckinClient();
    const { data, error } = await supabase.rpc("calendar_feed", { p_token: code });
    if (error) return new NextResponse("Please try again later.", { status: 503, headers: { "Cache-Control": "no-store" } });
    feed = (data as Feed | null) ?? null;
  } catch {
    return notActive();
  }
  if (!feed) return notActive();

  const host = new URL(request.url).host;
  return new NextResponse(buildIcs(feed, host), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="service-calendar.ics"',
      // Per person and always current: never kept by a shared cache.
      "Cache-Control": "private, no-store",
    },
  });
}
