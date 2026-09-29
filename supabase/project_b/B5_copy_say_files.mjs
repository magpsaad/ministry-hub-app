// B5_copy_say_files.mjs -- Project B phase B5 (MULTI_TENANT_PLAN.md §7).
//
// COPIES every SAY photo, calendar attachment and the logo from the old
// flat paths into SAY's own folder in the same bucket:
//   qa-photos/<file>      -> qa-photos/SAY/members/<file>   (youth photos)
//   qa-photos/<file>      -> qa-photos/SAY/profiles/<file>  (servant photos)
//   qa-calendar/<file>    -> qa-calendar/SAY/calendar/<file>
//   qa-branding/<file>    -> qa-branding/SAY/branding/<file> (the logo)
// then checks that every copy is publicly reachable and the same size as
// its original.
//
// It NEVER deletes anything and NEVER changes the database. The stored
// paths are switched over afterwards by a separate SQL step, and the old
// copies are only removed after the owner has checked the photos (gate G4).
// Safe to re-run: a copy that already exists and matches is left alone.
//
// Needs the project's service role key (storage copies bypass the per-user
// storage rules). It is read from web/.env.local as SUPABASE_SERVICE_ROLE_KEY
// and never printed. Run from the repo root:
//     node supabase/project_b/B5_copy_say_files.mjs qa            (dry run)
//     node supabase/project_b/B5_copy_say_files.mjs qa --apply    (copy)

import { readFileSync } from "node:fs";

const env = process.argv[2];
const apply = process.argv.includes("--apply");
if (env !== "qa" && env !== "prod") {
  console.error("Usage: node B5_copy_say_files.mjs <qa|prod> [--apply]");
  process.exit(1);
}
const MINISTRY = "SAY";

function readEnvFile() {
  const out = {};
  for (const line of readFileSync(new URL("../../web/.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
const fileEnv = readEnvFile();
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? fileEnv.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? fileEnv.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (web/.env.local).");
  process.exit(1);
}
// New-style secret keys ("sb_secret_...") go in the apikey header only;
// the older JWT-style service_role key also goes in Authorization.
const auth = KEY.startsWith("sb_") ? { apikey: KEY } : { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function rest(path) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: { ...auth, "Accept-Profile": env } });
  if (!r.ok) throw new Error(`Reading ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

const isExternal = (p) => /^https?:\/\//i.test(p);
const inMinistryFolder = (p) => /^[A-Z]{3}\//.test(p);
const publicUrl = (bucket, name) =>
  `${URL_}/storage/v1/object/public/${bucket}/${name.split("/").map(encodeURIComponent).join("/")}`;

// ---- 1. Build the plan from what the database points at -------------------
const plan = [];
const add = (kind, bucket, from, folder) => {
  if (!from || isExternal(from) || inMinistryFolder(from)) return;
  plan.push({ kind, bucket, from, to: `${MINISTRY}/${folder}/${from}` });
};

for (const r of await rest(`members?select=photo_path&ministry_id=eq.${MINISTRY}&photo_path=not.is.null`)) {
  add("youth photo", `${env}-photos`, r.photo_path, "members");
}
for (const r of await rest(`profiles?select=photo_path&ministry_id=eq.${MINISTRY}&photo_path=not.is.null`)) {
  add("servant photo", `${env}-photos`, r.photo_path, "profiles");
}
for (const r of await rest(`service_calendar_events?select=attachment_url&ministry_id=eq.${MINISTRY}&attachment_url=not.is.null`)) {
  add("calendar attachment", `${env}-calendar`, r.attachment_url, "calendar");
}
const [settings] = await rest(`app_settings?select=logo_url&ministry_id=eq.${MINISTRY}`);
const brandingPrefix = `${URL_}/storage/v1/object/public/${env}-branding/`;
if (settings?.logo_url?.startsWith(brandingPrefix)) {
  add("logo", `${env}-branding`, decodeURIComponent(settings.logo_url.slice(brandingPrefix.length)), "branding");
}

const byKind = plan.reduce((a, p) => ((a[p.kind] = (a[p.kind] ?? 0) + 1), a), {});
console.log(`${env}: ${plan.length} file(s) to copy into ${MINISTRY}/ --`, byKind);
if (!apply) {
  console.log("Dry run only. Nothing was copied. Re-run with --apply to copy.");
  process.exit(0);
}

// ---- 2. Copy, then verify each copy ---------------------------------------
async function size(bucket, name) {
  const r = await fetch(publicUrl(bucket, name), { method: "HEAD", cache: "no-store" });
  return r.ok ? Number(r.headers.get("content-length")) : null;
}

let copied = 0, alreadyThere = 0;
const failures = [];
for (const p of plan) {
  const srcSize = await size(p.bucket, p.from);
  if (srcSize === null) {
    failures.push(`${p.bucket}/${p.from}: original not reachable`);
    continue;
  }
  const existing = await size(p.bucket, p.to);
  if (existing !== null) {
    if (existing === srcSize) alreadyThere++;
    else failures.push(`${p.bucket}/${p.to}: already exists with a different size`);
    continue;
  }
  const r = await fetch(`${URL_}/storage/v1/object/copy`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ bucketId: p.bucket, sourceKey: p.from, destinationKey: p.to }),
  });
  if (!r.ok) {
    failures.push(`${p.bucket}/${p.from}: copy failed (${r.status} ${await r.text()})`);
    continue;
  }
  const newSize = await size(p.bucket, p.to);
  if (newSize !== srcSize) {
    failures.push(`${p.bucket}/${p.to}: copy not reachable or wrong size (${newSize} vs ${srcSize})`);
    continue;
  }
  copied++;
}

console.log(`Copied and verified: ${copied}. Already copied earlier (verified): ${alreadyThere}. Failed: ${failures.length}.`);
for (const f of failures) console.log("  FAILED " + f);
console.log("Nothing was deleted and the database was not changed.");
process.exit(failures.length ? 1 : 0);
