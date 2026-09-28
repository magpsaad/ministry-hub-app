import { config } from "./config.js";
import { loadGroupsByLadderPosition } from "./lookups.js";
import { clearContentTables, clearPhotosBucket } from "./clear.js";
import { migrateUniversities } from "./steps/universities.js";
import { migrateVerses } from "./steps/verses.js";
import { migrateServants } from "./steps/servants.js";
import { migrateMembers } from "./steps/members.js";
import { migratePhotos } from "./steps/photos.js";
import { migrateOutreach } from "./steps/outreach.js";
import { migrateAttendance } from "./steps/attendance.js";
import { migrateCalendar } from "./steps/calendar.js";
import { migrateAuditLog } from "./steps/auditLog.js";
import { printReport, hasUnmatched } from "./report.js";

// Order matters: groups/universities/servants must exist (or have their
// dry-run placeholder ids) before anything that references them by lookup.
async function main() {
  // RETIRED -- hard stop (MULTI_TENANT_PLAN.md P1 / D6). This one-time Sheets
  // import wipes whole tables and the entire photo bucket with no filter; SAY
  // has been live since the 11 Sep 2026 cutover, so running it again would
  // erase real data. Kept only as reference for future per-ministry import
  // tools, which must follow MULTI_TENANT_PLAN.md §15 (insert-only, one
  // ministry, QA first). Do not remove this guard.
  console.error("This migration tool is retired and must not be run. See MULTI_TENANT_PLAN.md P1 / §15.");
  process.exit(1);

  const groupsByPosition = await loadGroupsByLadderPosition();

  if (!config.dryRun) {
    console.log("Clearing content tables (dependency order: attendance/outreach -> members -> universities, plus verses/calendar/audit_log)...");
    await clearContentTables();
    console.log("Clearing photos bucket before reload (see clear.ts's comment for why)...");
    await clearPhotosBucket();
  }

  const universitiesByName = await migrateUniversities();
  await migrateVerses();

  const servants = await migrateServants(groupsByPosition);
  const memberIdsByFile = await migrateMembers(groupsByPosition, universitiesByName, servants);
  await migratePhotos(memberIdsByFile, servants);
  await migrateOutreach(memberIdsByFile, servants);
  await migrateAttendance(memberIdsByFile, servants);
  await migrateCalendar(servants);
  await migrateAuditLog(groupsByPosition, servants);

  printReport();

  if (config.dryRun) {
    console.log("\nThis was a DRY RUN -- nothing was written. Re-run with --run to actually migrate.");
  } else if (hasUnmatched()) {
    console.log("\nRun complete, but see the unmatched rows above -- nothing was guessed for those.");
  } else {
    console.log("\nRun complete.");
  }
}

main().catch((err) => {
  console.error("\nMigration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
