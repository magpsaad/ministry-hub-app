/** A ministry address as a clickable link: plain http for a local
 * development address, https for everything else. Safe to use from both
 * server and client code. */
export function addressUrl(host: string, path = "/"): string {
  const local = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  return `${local ? "http" : "https"}://${host}${path}`;
}
