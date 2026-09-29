// B5_delete_old_say_files.mjs -- Project B phase B5, step 3 (MULTI_TENANT_PLAN.md §7).
// ONLY after the owner has checked the photos (gate G4).
//
// Deletes an old flat-path file only when ALL of these hold:
//   * its copy exists in the SAY/ folder of the same bucket, same size;
//   * nothing in the database points at the old path any more
//     (members, profiles, calendar events, the logo);
//   * it is a flat path (never touches anything inside a ministry folder).
// Anything that doesn't pass is listed and left alone.
//
// Reads SUPABASE_SERVICE_ROLE_KEY from web/.env.local (never printed).
//     node supabase/project_b/B5_delete_old_say_files.mjs qa            (dry run)
//     node supabase/project_b/B5_delete_old_say_files.mjs qa --apply    (delete)

import { readFileSync } from "node:fs";

const env = process.argv[2];
const apply = process.argv.includes("--apply");
if (env !== "qa" && env !== "prod") {
  console.error("Usage: node B5_delete_old_say_files.mjs <qa|prod> [--apply]");
  process.exit(1);
}

const fileEnv = {};
for (const line of readFileSync(new URL("../../web/.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) fileEnv[m[1]] = m[2].trim();
}
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? fileEnv.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? fileEnv.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (web/.env.local).");
  process.exit(1);
}
const auth = KEY.startsWith("sb_") ? { apikey: KEY } : { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function rest(path) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: { ...auth, "Accept-Profile": env } });
  if (!r.ok) throw new Error(`Reading ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function listFlat(bucket) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(`${URL_}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: "", limit: 1000, offset, sortBy: { column: "name", order: "asc" } }),
    });
    if (!r.ok) throw new Error(`Listing ${bucket}: ${r.status} ${await r.text()}`);
    const page = await r.json();
    // Folders come back with id = null; only real files at the top level.
    for (const o of page) if (o.id) out.push({ name: o.name, size: o.metadata?.size ?? null });
    if (page.length < 1000) return out;
  }
}

async function size(bucket, name) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch(`${URL_}/storage/v1/object/public/${bucket}/${name.split("/").map(encodeURIComponent).join("/")}`, {
      method: "HEAD",
      cache: "no-store",
    });
    if (r.status === 429) {
      await new Promise((s) => setTimeout(s, 1500 * (attempt + 1)));
      continue;
    }
    return r.ok ? Number(r.headers.get("content-length")) : null;
  }
  return null;
}

// Every path the database still points at, in any ministry.
const referenced = new Set();
for (const r of await rest("members?select=photo_path&photo_path=not.is.null")) referenced.add(r.photo_path);
for (const r of await rest("profiles?select=photo_path&photo_path=not.is.null")) referenced.add(r.photo_path);
for (const r of await rest("service_calendar_events?select=attachment_url&attachment_url=not.is.null")) referenced.add(r.attachment_url);
const logos = (await rest("app_settings?select=logo_url")).map((r) => r.logo_url ?? "");

const buckets = [
  { bucket: `${env}-photos`, folders: ["SAY/members/", "SAY/profiles/"] },
  { bucket: `${env}-calendar`, folders: ["SAY/calendar/"] },
  { bucket: `${env}-branding`, folders: ["SAY/branding/"] },
];

const toDelete = [];
const kept = [];
for (const { bucket, folders } of buckets) {
  for (const f of await listFlat(bucket)) {
    const stillUsed = referenced.has(f.name) || logos.some((l) => l.endsWith(`/${bucket}/${f.name}`));
    if (stillUsed) {
      kept.push(`${bucket}/${f.name}: still used by the database`);
      continue;
    }
    let copyOk = false;
    for (const folder of folders) {
      const s = await size(bucket, folder + f.name);
      if (s !== null && s === (f.size ?? (await size(bucket, f.name)))) copyOk = true;
    }
    if (!copyOk) {
      kept.push(`${bucket}/${f.name}: no matching copy in SAY/`);
      continue;
    }
    toDelete.push({ bucket, name: f.name });
  }
}

console.log(`${env}: ${toDelete.length} old file(s) safe to delete; ${kept.length} kept.`);
for (const k of kept) console.log("  KEPT " + k);
if (!apply) {
  console.log("Dry run only. Nothing was deleted. Re-run with --apply to delete.");
  process.exit(0);
}

let deleted = 0;
const failures = [];
for (const b of [...new Set(toDelete.map((d) => d.bucket))]) {
  const names = toDelete.filter((d) => d.bucket === b).map((d) => d.name);
  for (let i = 0; i < names.length; i += 100) {
    const chunk = names.slice(i, i + 100);
    const r = await fetch(`${URL_}/storage/v1/object/${b}`, {
      method: "DELETE",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: chunk }),
    });
    if (!r.ok) failures.push(`${b}: ${r.status} ${await r.text()}`);
    else deleted += (await r.json()).length;
  }
}
console.log(`Deleted: ${deleted}. Failed batches: ${failures.length}.`);
for (const f of failures) console.log("  FAILED " + f);
process.exit(failures.length ? 1 : 0);
