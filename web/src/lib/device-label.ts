/** A short, plain name for the device the browser is on ("iPhone",
 * "Android phone", ...), shown next to the devices a person set up for
 * Face ID unlock or notifications. Browser-only. */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  if (/Windows/.test(ua)) return "Windows computer";
  if (/Macintosh/.test(ua)) return "Mac";
  return "This device";
}

/** An iPhone or iPad (where notifications need the app on the Home Screen). */
export function isAppleMobile(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Opened from the Home Screen icon (not inside a browser tab). */
export function isInstalledApp(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
