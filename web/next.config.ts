import type { NextConfig } from "next";

/** Security audit #9 (owner-approved, 4 Oct 2026): browser protections on
 * every page. HTTPS-only (HSTS) is already added by Vercel.
 * - No page can be shown inside another site's frame (clickjacking).
 * - Browsers must not guess a file's type from its content.
 * - Links to other sites don't carry our page addresses (check-in poster
 *   codes included) -- only the site name.
 * - No microphone/location/payment access; the camera only for our own
 *   pages (photo taking uses the phone's camera through the file picker). */
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Default 1MB is well under a typical phone camera photo (often
      // 3-12MB); uploadMemberPhotoAction/removeMemberPhotoAction send the
      // raw file as multipart form data straight to this Server Action.
      bodySizeLimit: "10mb",
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
