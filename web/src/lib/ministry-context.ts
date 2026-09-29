import { cache } from "react";
import { headers } from "next/headers";
import { createClient as createPlainClient } from "@supabase/supabase-js";

/**
 * MULTI_TENANT_PLAN.md §3.2 -- THE one place the ministry is decided: the
 * web address the request came in on. Every Supabase client attaches the
 * resulting code as the `x-ministry-id` request header, which the database
 * reads with current_ministry_id(). The header only ever narrows what a
 * request can see -- every security rule still requires a real role in that
 * ministry -- so it is never a way in, only a way to pick which ministry.
 *
 * - kind "ministry": a ministry's own address (inactive ones included; the
 *   proxy gate decides what an inactive ministry still allows).
 * - kind "console":  the Church Admin console's address (§3.8), which
 *   belongs to no ministry.
 * - kind "unknown":  an address nobody set up -- fails closed: the proxy
 *   shows "This address isn't set up" and no data call is ever made.
 */
export type AddressContext =
  | { kind: "ministry"; ministryId: string; name: string; isActive: boolean }
  | { kind: "console" }
  | { kind: "unknown" };

type Row = { ministry_id: string | null; name: string | null; is_active: boolean; kind: "ministry" | "console" };

// Addresses change only when the Church Admin adds/removes one or turns a
// ministry on/off, so a short per-server-instance cache saves the lookup on
// almost every request. Only successful lookups are cached.
const CACHE_MS = 60_000;
const addressCache = new Map<string, { at: number; ctx: AddressContext }>();

export function normalizeHost(host: string | null | undefined): string {
  return (host ?? "").trim().toLowerCase();
}

/** Looks an address up in this environment's ministry_addresses (via the
 * narrow resolve_ministry_by_address() function, callable without signing
 * in -- the login page needs it). Uses a plain session-less client: which
 * ministry an address belongs to never depends on who's asking. */
export async function resolveAddress(host: string): Promise<AddressContext> {
  const key = normalizeHost(host);
  if (!key) return { kind: "unknown" };

  const hit = addressCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.ctx;

  const supabase = createPlainClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      db: { schema: process.env.NEXT_PUBLIC_APP_ENV as "qa" | "prod" },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    },
  );
  const { data, error } = await supabase.rpc("resolve_ministry_by_address", { p_host: key });
  if (error) {
    throw new Error(`Could not look up this address: ${error.message}`);
  }

  const row = ((data ?? []) as Row[])[0];
  const ctx: AddressContext = !row
    ? { kind: "unknown" }
    : row.kind === "console"
      ? { kind: "console" }
      : { kind: "ministry", ministryId: row.ministry_id!, name: row.name ?? row.ministry_id!, isActive: row.is_active };

  addressCache.set(key, { at: Date.now(), ctx });
  return ctx;
}

/** This request's address context. React.cache()-memoized per request. */
export const getAddressContext = cache(async (): Promise<AddressContext> => {
  const h = await headers();
  return resolveAddress(h.get("host") ?? "");
});

/** The 3-letter code of the ministry this request is working in. Throws on
 * the console or an unknown address -- a ministry screen must never run
 * there (the proxy gate already keeps them apart; this is the backstop). */
export const getActiveMinistry = cache(async (): Promise<string> => {
  const ctx = await getAddressContext();
  if (ctx.kind !== "ministry") {
    throw new Error("This page belongs to a ministry, but this address isn't a ministry's address.");
  }
  return ctx.ministryId;
});

/** Request headers every Supabase client sends for this address: the
 * ministry code on a ministry's address, nothing on the console's. */
export function ministryHeaders(ctx: AddressContext): Record<string, string> {
  return ctx.kind === "ministry" ? { "x-ministry-id": ctx.ministryId } : {};
}
