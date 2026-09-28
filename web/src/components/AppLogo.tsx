function initials(title: string) {
  return title
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("");
}

/**
 * Renders the deployment's logo (app_settings.logo_url) if one has been
 * uploaded, otherwise falls back to an initials avatar -- so branding
 * degrades gracefully before a real logo image exists.
 */
export function AppLogo({
  logoUrl,
  title,
  size,
  circular = true,
}: {
  logoUrl: string | null;
  title: string;
  size: number;
  circular?: boolean;
}) {
  const style = { width: size, height: size };

  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- small remote
      // branding image on a dynamic Supabase Storage host; not worth the
      // next/image remotePatterns config for a header logo.
      <img
        src={logoUrl}
        alt={title}
        style={style}
        className={`object-contain shrink-0 ${circular ? "rounded-full bg-white shadow-[0_2px_10px_rgba(0,0,0,0.2)] p-1" : ""}`}
      />
    );
  }

  return (
    <div
      style={style}
      className="shrink-0 rounded-full bg-white shadow-[0_2px_10px_rgba(0,0,0,0.2)] flex items-center justify-center"
    >
      <span className="text-brand font-bold" style={{ fontSize: size * 0.32 }}>
        {initials(title)}
      </span>
    </div>
  );
}
