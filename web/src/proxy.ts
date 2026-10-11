import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Public files skip it entirely (owner-requested, 11 Oct 2026: each run
    // counts against the free hosting allowance): the service worker, the
    // app manifest, the notification tick and calendar feeds.
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js$|manifest\\.webmanifest$|api/push/tick|api/calendar/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
