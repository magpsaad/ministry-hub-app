"use client";

import { useMemo, useRef, useState } from "react";
import type { ServantDirectoryEntry } from "@/lib/servant-directory";
import { PhoneLink } from "@/components/PhoneLink";
import { servantPhotoUrl } from "@/lib/storage";
import { uploadServantPhotoAction } from "@/app/servant-profiles/actions";
import { PhotoCropperModal } from "@/components/PhotoCropperModal";

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("");
}

type Bucket = { label: string; entries: ServantDirectoryEntry[] };

/** REQUIREMENTS.md §6.13 -- read-only, searchable. Categorical (grouped by
 * serving group, then General Coordinators, then Unassigned) and
 * Alphabetical view modes, consistent with Servant Profiles & Assignments.
 *
 * Owner-requested: a photo can still be ADDED from here when one is
 * missing (no replace/delete -- that stays on Servant Profiles). Local
 * state mirrors the initial server data so a successful upload shows up
 * immediately without a full page reload. */
export function ServantsDirectoryInteractive({
  servants: initialServants,
  windowWeeks,
  dayName,
}: {
  servants: ServantDirectoryEntry[];
  windowWeeks: number | null;
  dayName: string;
}) {
  const [servants, setServants] = useState(initialServants);
  const [viewMode, setViewMode] = useState<"categorical" | "alphabetical">("categorical");
  const [search, setSearch] = useState("");

  function handlePhotoUploaded(servantId: string, photoPath: string) {
    setServants((prev) => prev.map((s) => (s.id === servantId ? { ...s, photo_path: photoPath } : s)));
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return servants;
    return servants.filter((s) => s.full_name.toLowerCase().includes(q));
  }, [servants, search]);

  const buckets = useMemo(() => {
    const byLabel = new Map<string, ServantDirectoryEntry[]>();
    const positionByLabel = new Map<string, number>();
    const order: string[] = [];

    function add(label: string, entry: ServantDirectoryEntry, ladderPosition?: number) {
      if (!byLabel.has(label)) {
        byLabel.set(label, []);
        order.push(label);
        if (ladderPosition !== undefined) positionByLabel.set(label, ladderPosition);
      }
      byLabel.get(label)!.push(entry);
    }

    for (const s of filtered) {
      for (const g of s.servantGroups) add(g.name, s, g.display_order);
      if (s.isUnassignedServant) add("Unassigned", s);
      if (s.isGeneralCoordinator) add("General Coordinators", s);
    }

    // The groups' list order (display_order, GROUP_LADDER_PLAN D4), not
    // alphabetical by name -- same fix as Servant Profiles/Assignments
    // (owner-reported), now consistent across all three screens.
    const groupLabels = order
      .filter((l) => l !== "General Coordinators" && l !== "Unassigned")
      .sort((a, b) => (positionByLabel.get(a) ?? 0) - (positionByLabel.get(b) ?? 0));
    const tail = order.filter((l) => l === "General Coordinators" || l === "Unassigned").sort().reverse();

    const result: Bucket[] = [];
    for (const label of [...groupLabels, ...tail]) {
      result.push({ label, entries: byLabel.get(label)!.sort((a, b) => a.full_name.localeCompare(b.full_name)) });
    }
    return result;
  }, [filtered]);

  const alphabetical = useMemo(() => [...filtered].sort((a, b) => a.full_name.localeCompare(b.full_name)), [filtered]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-[#666]">
        {windowWeeks === null
          ? `Attendance % is calculated over each servant's entire history since their Join Date, counting only ${dayName}s.`
          : `Attendance % is a rolling trailing ${windowWeeks} week${windowWeeks === 1 ? "" : "s"}, counting only ${dayName}s, never counting weeks before someone joined.`}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search servants..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[180px] rounded-md border border-[#ddd] px-3 py-2 text-sm focus:border-brand focus:outline-none"
        />
        <div className="flex rounded-md border border-[#ddd] overflow-hidden text-sm">
          <button
            type="button"
            onClick={() => setViewMode("categorical")}
            className={`px-3 py-2 font-semibold ${viewMode === "categorical" ? "bg-brand text-white" : "bg-white text-[#333]"}`}
          >
            Categorical
          </button>
          <button
            type="button"
            onClick={() => setViewMode("alphabetical")}
            className={`px-3 py-2 font-semibold ${viewMode === "alphabetical" ? "bg-brand text-white" : "bg-white text-[#333]"}`}
          >
            Alphabetical
          </button>
        </div>
      </div>

      {filtered.length === 0 && <p className="text-sm text-[#666] text-center py-8">No servants match.</p>}

      {viewMode === "categorical"
        ? buckets.map((bucket) => (
            <div key={bucket.label} className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-4">
              <h3 className="text-sm font-bold text-brand mb-3">{bucket.label}</h3>
              <ServantCards entries={bucket.entries} onPhotoUploaded={handlePhotoUploaded} />
            </div>
          ))
        : filtered.length > 0 && (
            <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-4">
              <ServantCards entries={alphabetical} onPhotoUploaded={handlePhotoUploaded} />
            </div>
          )}
    </div>
  );
}

function ServantCards({
  entries,
  onPhotoUploaded,
}: {
  entries: ServantDirectoryEntry[];
  onPhotoUploaded: (servantId: string, photoPath: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {entries.map((s) => (
        <div key={s.id} className="flex items-center gap-3 border border-[#f0f0f0] rounded-lg p-3">
          <ServantAvatar servant={s} onPhotoUploaded={onPhotoUploaded} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-[#333] truncate">{s.full_name}</p>
            <PhoneLink phone={s.phone} className="text-xs" />
            <p className="text-[11px] text-[#666]">
              Attendance: {s.averageAttendance === null ? "N/A" : `${s.averageAttendance}%`}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Owner-requested: when a servant has no photo yet, a small "+" badge under
 * the avatar lets anyone with directory access add one right here -- no
 * replace/delete, that stays on Servant Profiles. The upload itself still
 * goes through uploadServantPhotoAction, so it's still subject to the same
 * RLS rule as everywhere else in the app (self, or a coordinator). */
function ServantAvatar({
  servant,
  onPhotoUploaded,
}: {
  servant: ServantDirectoryEntry;
  onPhotoUploaded: (servantId: string, photoPath: string) => void;
}) {
  const photoUrl = servantPhotoUrl(servant.photo_path);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setPendingFile(file);
    e.target.value = "";
  }

  function handleCropped(blob: Blob) {
    setPendingFile(null);
    setUploading(true);
    const formData = new FormData();
    formData.set("photo", new File([blob], "photo.jpg", { type: "image/jpeg" }));
    uploadServantPhotoAction(servant.id, formData).then((result) => {
      setUploading(false);
      if (result.error) {
        alert(result.error);
        return;
      }
      if (result.photoPath) onPhotoUploaded(servant.id, result.photoPath);
    });
  }

  const avatar = (
    <div className="h-10 w-10 shrink-0 rounded-full bg-brand text-white text-sm font-bold flex items-center justify-center overflow-hidden">
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img loading="lazy" src={photoUrl} alt={servant.full_name} className="h-full w-full object-cover" />
      ) : (
        initials(servant.full_name)
      )}
    </div>
  );

  if (photoUrl) return avatar;

  return (
    <div className="flex flex-col items-center gap-0.5 shrink-0">
      {avatar}
      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelected} className="hidden" />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        title="Add photo"
        aria-label="Add photo"
        className="flex h-4 w-4 items-center justify-center rounded-full bg-brand text-white text-[11px] font-bold leading-none hover:bg-brand-dark disabled:opacity-60"
      >
        +
      </button>
      {pendingFile && <PhotoCropperModal file={pendingFile} onCancel={() => setPendingFile(null)} onCropped={handleCropped} />}
    </div>
  );
}
