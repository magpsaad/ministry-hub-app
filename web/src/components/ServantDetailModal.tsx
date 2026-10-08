"use client";

import { useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import type { ServantDirectoryEntry } from "@/lib/servant-directory";
import { servantPhotoUrl } from "@/lib/storage";
import {
  updateServantProfileAction,
  uploadServantPhotoAction,
  removeServantPhotoAction,
  removeServantAction,
} from "@/app/servant-profiles/actions";
import { CameraIcon, TrashIcon } from "@/components/icons";
import { PhotoCropperModal } from "@/components/PhotoCropperModal";
import { ErrorModal } from "@/components/ErrorModal";
import { useTimezone } from "@/components/TimezoneProvider";
import { useRoleLabels } from "@/components/RoleLabelsProvider";
import { formatDateTimeInZone } from "@/lib/timezone";
import type { AgreementStatus } from "@/lib/agreement";

const inputClass = (editing: boolean) =>
  `w-full rounded-md border px-3 py-2 text-sm focus:outline-none ${
    editing
      ? "border-[#ffc107] bg-[#fffacd] focus:ring-2 focus:ring-[#ffc107]/40"
      : "border-[#ddd] bg-[#f5f5f5] text-[#333] cursor-not-allowed"
  }`;

/** REQUIREMENTS.md §6.13 -- Full Name and Email are always read-only. Group
 * assignment lives on the separate Servant Assignments screen, not here.
 * `onSaved` (photo upload, field save) and `onClose` (X/Close button) are
 * kept deliberately separate -- a photo upload must NOT close the modal,
 * matching Member Detail's exact behavior (MemberDetailLink.tsx). */
export function ServantDetailModal({
  servant,
  canManageServants,
  agreement,
  onClose,
  onSaved,
}: {
  servant: ServantDirectoryEntry;
  canManageServants: boolean;
  /** Migration 0086: undefined = not shown (only Admins and General
   * Coordinators see it); null = nothing signed. */
  agreement?: AgreementStatus | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const L = useRoleLabels();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState(servant.photo_path);
  const [pendingPhotoFile, setPendingPhotoFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [phone, setPhone] = useState(servant.phone ?? "");
  const [fatherOfConfession, setFatherOfConfession] = useState(servant.father_of_confession ?? "");
  const [gender, setGender] = useState(servant.gender ?? "");

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await updateServantProfileAction(servant.id, {
        phone: phone || null,
        father_of_confession: fatherOfConfession || null,
        gender: gender || null,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setEditing(false);
      onSaved();
    });
  }

  function handlePhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setPendingPhotoFile(file);
    e.target.value = ""; // allow re-selecting the same file
  }

  // Owner-reported: Replace had no warning, unlike Delete -- confirms
  // before opening the file picker whenever there's an existing photo to
  // lose (Add, with no current photo, needs no such warning).
  function handleAddOrReplaceClick() {
    if (photoUrl && !confirm("Replace this photo? This cannot be undone.")) return;
    fileInputRef.current?.click();
  }

  function handlePhotoCropped(blob: Blob) {
    setPendingPhotoFile(null);
    const formData = new FormData();
    formData.set("photo", new File([blob], "photo.jpg", { type: "image/jpeg" }));
    startTransition(async () => {
      const result = await uploadServantPhotoAction(servant.id, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.photoPath) setPhotoPath(result.photoPath);
      onSaved();
    });
  }

  function handleRemovePhoto() {
    if (!photoPath) return;
    // Owner-reported: this was one click away with no confirmation, easy to
    // hit by mistake.
    if (!confirm("Delete this photo? This cannot be undone.")) return;
    startTransition(async () => {
      const result = await removeServantPhotoAction(servant.id, photoPath);
      if (result.error) {
        setError(result.error);
        return;
      }
      setPhotoPath(null);
      onSaved();
    });
  }

  function handleRemove() {
    if (!confirm(`Remove ${servant.full_name} as a ${L.servantLower}? This cannot be undone.`)) return;
    startTransition(async () => {
      const result = await removeServantAction(servant.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      onSaved();
      onClose();
    });
  }

  const photoUrl = servantPhotoUrl(photoPath);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-[0_10px_40px_rgba(0,0,0,0.2)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b-2 border-[#f0f0f0] pb-3 mb-4">
          <h2 className="text-lg font-bold text-brand">{servant.full_name}</h2>
          <button onClick={onClose} className="text-[#999] hover:text-[#333] text-xl leading-none">
            ×
          </button>
        </div>

        <div className="flex flex-col items-center mb-4">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img loading="lazy" src={photoUrl} alt={servant.full_name} className="h-[100px] w-[100px] rounded-full object-cover" />
          ) : (
            <div className="h-[100px] w-[100px] rounded-full bg-gradient-to-br from-brand to-brand-light flex items-center justify-center text-white text-2xl font-bold">
              {servant.full_name
                .split(" ")
                .map((w) => w[0])
                .slice(0, 2)
                .join("")}
            </div>
          )}
          <div className="flex gap-3 mt-2">
            {/* Owner-reported: no `capture` attribute -- forcing "environment"
                made mobile browsers open the camera directly, with no way
                to pick an existing photo from the library instead. Leaving
                it unset lets the native picker offer both. */}
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePhotoSelected} className="hidden" />
            {/* Owner-reported (follow-up, then revised): Add Photo (no
                photo yet) stays available any time -- only Replace and
                Delete, which act on an existing photo, are gated behind
                Edit. */}
            {(!photoUrl || editing) && (
              <button
                type="button"
                onClick={handleAddOrReplaceClick}
                disabled={pending}
                title={photoUrl ? "Replace photo" : "Add photo"}
                className="flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
              >
                <CameraIcon className="h-3.5 w-3.5" />
                {photoUrl ? "Replace" : "Add"} Photo
              </button>
            )}
            {/* Owner-reported: this was reachable with one click, no
                confirmation, at any time -- now only shown while editing
                (matching every other destructive/data-changing control on
                this modal), and handleRemovePhoto itself now confirms. */}
            {photoUrl && editing && (
              <button
                type="button"
                onClick={handleRemovePhoto}
                disabled={pending}
                title="Delete photo"
                className="flex items-center gap-1 text-xs font-semibold text-[#dc3545] hover:underline"
              >
                <TrashIcon className="h-3.5 w-3.5" />
                Delete Photo
              </button>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <FieldRow label="Full Name">
            <input value={servant.full_name} readOnly className={inputClass(false)} />
          </FieldRow>
          <FieldRow label="Email">
            <input value={servant.email ?? ""} readOnly className={inputClass(false)} />
          </FieldRow>
          <FieldRow label="Phone">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} readOnly={!editing} className={inputClass(editing)} />
          </FieldRow>
          <FieldRow label="Father of Confession">
            <input
              value={fatherOfConfession}
              onChange={(e) => setFatherOfConfession(e.target.value)}
              readOnly={!editing}
              className={inputClass(editing)}
            />
          </FieldRow>
          <FieldRow label="Gender">
            <select value={gender} onChange={(e) => setGender(e.target.value)} disabled={!editing} className={inputClass(editing)}>
              <option value="">—</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          </FieldRow>
          <FieldRow label="Join Date">
            <input value={servant.join_date ?? "Not yet attended"} readOnly className={inputClass(false)} />
          </FieldRow>
          {agreement !== undefined && <AgreementRow agreement={agreement} />}
        </div>

        <div className="mt-5 flex flex-wrap gap-2 justify-between items-center border-t border-[#f0f0f0] pt-4">
          <div className="flex flex-wrap gap-2">
            {!editing ? (
              <button
                onClick={() => setEditing(true)}
                className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
              >
                Edit
              </button>
            ) : (
              <>
                <button
                  onClick={handleSave}
                  disabled={pending}
                  className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
                >
                  {pending ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={() => {
                    setEditing(false);
                    setPhone(servant.phone ?? "");
                    setFatherOfConfession(servant.father_of_confession ?? "");
                    setGender(servant.gender ?? "");
                  }}
                  className="rounded-md bg-[#f0f0f0] px-4 py-2 text-sm font-semibold text-[#333] hover:bg-[#e0e0e0] shadow-[0_2px_4px_rgba(0,0,0,0.1)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.15)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
                >
                  Cancel
                </button>
              </>
            )}
            <button onClick={onClose} className="rounded-md bg-[#f0f0f0] px-4 py-2 text-sm font-semibold text-[#333] hover:bg-[#e0e0e0] shadow-[0_2px_4px_rgba(0,0,0,0.1)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.15)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.1)]">
              Close
            </button>
          </div>
          {canManageServants && (
            <button
              onClick={handleRemove}
              disabled={pending}
              className="rounded-md bg-[#dc3545] px-4 py-2 text-sm font-semibold text-white hover:bg-[#c82333] disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
            >
              Remove {L.servant}
            </button>
          )}
        </div>
      </div>
      {pendingPhotoFile && (
        <PhotoCropperModal
          file={pendingPhotoFile}
          onCancel={() => setPendingPhotoFile(null)}
          onCropped={handlePhotoCropped}
        />
      )}
      {/* Same fix as Member Detail's ErrorModal -- an inline banner near
          the top of this scrollable modal was easy to miss while scrolled
          down near Remove Servant at the very bottom. */}
      {error && <ErrorModal message={error} onDismiss={() => setError(null)} />}
    </div>,
    document.body,
  );
}

/** Migration 0086: the confidentiality agreement -- signed (with a link to
 * the signed copy), or not yet, and by when during the grace period. */
function AgreementRow({ agreement }: { agreement: AgreementStatus | null }) {
  const timeZone = useTimezone();
  const day = (iso: string) => formatDateTimeInZone(iso, timeZone, { year: "numeric", month: "short", day: "numeric" });
  const graceOpen = agreement?.grace_until && new Date(agreement.grace_until) > new Date();
  let text: string;
  if (agreement?.is_current && agreement.signed_at) {
    text = `Signed ${day(agreement.signed_at)} (version ${agreement.version})`;
  } else if (agreement?.signed_at) {
    text = `Needs to sign again (last signed ${day(agreement.signed_at)}, version ${agreement.version})`;
  } else {
    text = "Not signed yet";
  }
  if (!agreement?.is_current && graceOpen) text += ` — due by ${day(agreement!.grace_until!)}`;

  return (
    <FieldRow label="Confidentiality Agreement">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#ddd] bg-[#f5f5f5] px-3 py-2 text-sm">
        <span className={agreement?.is_current ? "text-[#155724]" : "font-semibold text-[#b45309]"}>{text}</span>
        {agreement?.signature_id && (
          <a
            href={`/security/agreement/${agreement.signature_id}`}
            target="_blank"
            rel="noopener"
            className="text-xs font-semibold text-brand hover:underline"
          >
            View signed copy
          </a>
        )}
      </div>
    </FieldRow>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-[#333] mb-1">{label}</label>
      {children}
    </div>
  );
}
