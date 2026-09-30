"use client";

import { useEffect } from "react";
import { clearMenuData } from "@/components/menuStore";

/** Rendered on the sign-in page: whoever signs in next must never see the
 * previous person's saved side menu (menuStore), even if they never
 * pressed Exit (e.g. their session simply expired). */
export function ClearMenuCache() {
  useEffect(() => {
    clearMenuData();
  }, []);
  return null;
}
