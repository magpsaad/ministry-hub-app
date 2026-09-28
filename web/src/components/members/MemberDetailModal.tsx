"use client";

import { useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import type { MemberDetail } from "@/lib/members";
import type { University } from "@/lib/universities";
import type { ServantOption } from "@/lib/servants";
import type { GroupSummary } from "@/lib/groups";
import { memberPhotoUrl } from "@/lib/storage";
import {
  updateMemberAction,
  deleteMemberAction,
  assignServantAction,
  moveMemberGroupAction,
  uploadMemberPhotoAction,
  removeMemberPhotoAction,
  type UpdateMemberInput,
} from "@/app/g/[groupId]/members/actions";
import { CameraIcon, TrashIcon } from "@/components/icons";
import { AddOutreachModal } from "@/components/outreach/AddOutreachModal";
import { PrevOutreachModal } from "@/components/outreach/PrevOutreachModal";
import { PhotoCropperModal } from "@/components/PhotoCropperModal";
import { ErrorModal } from "@/components/ErrorModal";
import { ALL_COHORTS_GROUP_ID } from "@/lib/allCohorts";

const inputClass = (editing: boolean) =>
  `w-full rounded-md border px-3 py-2 text-sm focus:outline-none ${
    editing
      ? "border-[#ffc107] bg-[#fffacd] focus:ring-2 focus:ring-[#ffc107]/40"
      : "border-[#ddd] bg-[#f5f5f5] text-[#333] cursor-not-allowed"
  }`;

export function MemberDetailModal({
  member,
  groupId,
  groups,
  groupLabel,
  universities,
  universityLabel,
  programLabel,
  servants,
  memberLabel,
  canDelete,
  canEdit,
  currentUserName,
  onClose,
  onSaved,
}: {
  member: MemberDetail;
  groupId: string;
  groups: GroupSummary[];
  groupLabel: string;
  universities: University[];
  universityLabel: string;
  programLabel: string;
  servants: ServantOption[];
  memberLabel: string;
  canDelete: boolean;
  /** Owner-reported: a Read-Only servant could open Edit and every photo
   * control here even though Save/upload were always going to be rejected
   * server-side (migration 0057 + the row-count checks in actions.ts) --
   * confusing dead end. Hides Edit and both photo buttons outright instead
   * of just letting them fail. */
  canEdit: boolean;
  currentUserName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState(member.photo_path);
  const [pendingPhotoFile, setPendingPhotoFile] = useState<File | null>(null);
  const [showAddOutreach, setShowAddOutreach] = useState(false);
  const [showPrevOutreach, setShowPrevOutreach] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<UpdateMemberInput>({
    phone: member.phone,
    email: member.email,
    university_id: member.university_id,
    program_of_study: member.program_of_study,
    date_of_birth: member.date_of_birth,
    father_of_confession: member.father_of_confession,
    home_address: member.home_address,
    gender: member.gender,
    servant_comments: member.servant_comments,
    is_visitor: member.is_visitor,
  });
  const [assignedServantId, setAssignedServantId] = useState(member.assigned_servant_id);
  const [memberGroupId, setMemberGroupId] = useState(member.group_id);
  // "Load Youth Data for all cohorts" combined view (REQUIREMENTS.md §6.1
  // addendum) -- owner-reported: reassigning from here isn't safe, since
  // the servant list shown across a combined member set spans the whole
  // ministry rather than being scoped to this one member's actual cohort.
  // Reassignment stays a single-cohort-screen action; this just shows who
  // it currently is.
  const isCombined = groupId === ALL_COHORTS_GROUP_ID;

  // Owner-reported: hard-filter to matching-gender servants, same rule
  // AssignServantSelect (the New Registrations quick-assign dropdown)
  // already enforces -- this used to only soft-sort by gender instead.
  // Always keeps the member's CURRENT servant in the list even if their
  // gender doesn't match (a pre-existing exception shouldn't silently
  // vanish from its own dropdown, which would either blank the selection
  // or make it look unassigned). A servant with no gender on file still
  // shows up for everyone, same as AssignServantSelect.
  const sortedServants = servants
    .filter((s) => !member.gender || !s.gender || s.gender === member.gender || s.id === member.assigned_servant_id)
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  function field<K extends keyof UpdateMemberInput>(key: K, value: UpdateMemberInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function resetForm() {
    setForm({
      phone: member.phone,
      email: member.email,
      university_id: member.university_id,
      program_of_study: member.program_of_study,
      date_of_birth: member.date_of_birth,
      father_of_confession: member.father_of_confession,
      home_address: member.home_address,
      gender: member.gender,
      servant_comments: member.servant_comments,
      is_visitor: member.is_visitor,
    });
    setAssignedServantId(member.assigned_servant_id);
    setMemberGroupId(member.group_id);
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await updateMemberAction(member.id, groupId, form);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (memberGroupId !== member.group_id) {
        const moveResult = await moveMemberGroupAction(member.id, member.group_id, memberGroupId);
        if (moveResult.error) {
          setError(moveResult.error);
          return;
        }
      } else if (assignedServantId !== member.assigned_servant_id) {
        await assignServantAction(member.id, groupId, assignedServantId);
      }
      setEditing(false);
      onSaved();
    });
  }

  function handleDelete() {
    if (!confirm(`Permanently delete ${member.full_name}'s record? This cannot be undone.`)) return;
    startTransition(async () => {
      const result = await deleteMemberAction(member.id, groupId);
      if (result.error) {
        setError(result.error);
        return;
      }
      onSaved();
      onClose();
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
      const result = await uploadMemberPhotoAction(member.id, groupId, formData);
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
      const result = await removeMemberPhotoAction(member.id, groupId, photoPath);
      if (result.error) {
        setError(result.error);
        return;
      }
      setPhotoPath(null);
      onSaved();
    });
  }

  const photoUrl = memberPhotoUrl(photoPath);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-[0_10px_40px_rgba(0,0,0,0.2)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b-2 border-[#f0f0f0] pb-3 mb-4">
          <h2 className="text-lg font-bold text-brand">{member.full_name}</h2>
          <button onClick={onClose} className="text-[#999] hover:text-[#333] text-xl leading-none">
            ×
          </button>
        </div>

        <label className="flex items-center gap-2 text-sm font-semibold text-[#333] mb-4">
          <input
            type="checkbox"
            checked={form.is_visitor}
            onChange={(e) => field("is_visitor", e.target.checked)}
            disabled={!editing}
            className="accent-brand"
          />
          Visitor
        </label>

        <div className="flex flex-col items-center mb-2">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt={member.full_name} className="h-[100px] w-[100px] rounded-full object-cover" />
          ) : (
            <div className="h-[100px] w-[100px] rounded-full bg-gradient-to-br from-brand to-brand-light flex items-center justify-center text-white text-2xl font-bold">
              {member.full_name
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
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handlePhotoSelected}
              className="hidden"
            />
            {/* Owner-reported (follow-up, then revised, then clarified
                again): Add Photo (no photo yet) stays available to EVERYONE
                who can view this record, Read-Only included -- explicitly
                the one exception to the Edit lockout ("they CAN add
                photos"). Only Replace and Delete, which act on an existing
                photo, require canEdit. Since `editing` can never become
                true without canEdit (the Edit button itself is hidden
                otherwise), `canEdit && editing` here already collapses to
                "always false" for a Read-Only viewer, leaving just
                `!photoUrl` -- no separate flag needed. */}
            {(!photoUrl || (canEdit && editing)) && (
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
            {canEdit && photoUrl && editing && (
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
          <FieldRow label="Phone">
            <input
              value={form.phone ?? ""}
              onChange={(e) => field("phone", e.target.value)}
              readOnly={!editing}
              className={inputClass(editing)}
            />
          </FieldRow>
          <FieldRow label="Email">
            <input
              value={form.email ?? ""}
              onChange={(e) => field("email", e.target.value)}
              readOnly={!editing}
              className={inputClass(editing)}
            />
          </FieldRow>
          <FieldRow label={universityLabel}>
            <select
              value={form.university_id ?? ""}
              onChange={(e) => field("university_id", e.target.value || null)}
              disabled={!editing}
              className={inputClass(editing)}
            >
              <option value="">—</option>
              {universities.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </FieldRow>
          <FieldRow label={programLabel}>
            <input
              value={form.program_of_study ?? ""}
              onChange={(e) => field("program_of_study", e.target.value)}
              readOnly={!editing}
              className={inputClass(editing)}
            />
          </FieldRow>
          <FieldRow label="Date of Birth">
            <input
              type="date"
              value={form.date_of_birth ?? ""}
              onChange={(e) => field("date_of_birth", e.target.value)}
              readOnly={!editing}
              disabled={!editing}
              className={inputClass(editing)}
            />
          </FieldRow>
          <FieldRow label="Gender">
            <select
              value={form.gender ?? ""}
              onChange={(e) => field("gender", e.target.value || null)}
              disabled={!editing}
              className={inputClass(editing)}
            >
              <option value="">—</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          </FieldRow>
          <FieldRow label="Father of Confession">
            <input
              value={form.father_of_confession ?? ""}
              onChange={(e) => field("father_of_confession", e.target.value)}
              readOnly={!editing}
              className={inputClass(editing)}
            />
          </FieldRow>
          <FieldRow label="Home Address">
            <input
              value={form.home_address ?? ""}
              onChange={(e) => field("home_address", e.target.value)}
              readOnly={!editing}
              className={inputClass(editing)}
            />
          </FieldRow>
          <FieldRow label="Registration Comments">
            <textarea value={member.registration_comments ?? ""} readOnly className={inputClass(false)} rows={2} />
          </FieldRow>
          <FieldRow label="Join Date">
            <input value={member.join_date ?? "Not yet attended"} readOnly className={inputClass(false)} />
          </FieldRow>
          {isCombined && (
            <FieldRow label={groupLabel}>
              <select
                value={memberGroupId}
                onChange={(e) => setMemberGroupId(e.target.value)}
                disabled={!editing || !canDelete}
                className={inputClass(editing && canDelete)}
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              {editing && canDelete && memberGroupId !== member.group_id && (
                <p className="mt-1 text-xs text-[#b35900]">
                  Moving cohorts will unassign their current servant.
                </p>
              )}
            </FieldRow>
          )}
          <FieldRow label="Assigned Servant">
            <select
              value={assignedServantId ?? ""}
              onChange={(e) => setAssignedServantId(e.target.value || null)}
              disabled={!editing || isCombined}
              className={inputClass(editing && !isCombined)}
            >
              <option value="">Unassigned</option>
              {sortedServants.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name} (has {s.caseload})
                </option>
              ))}
            </select>
          </FieldRow>
          <FieldRow label="Servant Comments">
            <textarea
              value={form.servant_comments ?? ""}
              onChange={(e) => field("servant_comments", e.target.value)}
              readOnly={!editing}
              className={inputClass(editing)}
              rows={2}
            />
          </FieldRow>
        </div>

        <div className="mt-5 flex flex-wrap gap-2 justify-between items-center border-t border-[#f0f0f0] pt-4">
          <div className="flex flex-wrap gap-2">
            {!editing ? (
              canEdit && (
                <button
                  onClick={() => setEditing(true)}
                  className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
                >
                  Edit
                </button>
              )
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
                    resetForm();
                  }}
                  className="rounded-md bg-[#f0f0f0] px-4 py-2 text-sm font-semibold text-[#333] hover:bg-[#e0e0e0] shadow-[0_2px_4px_rgba(0,0,0,0.1)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.15)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
                >
                  Cancel
                </button>
              </>
            )}
            <button
              onClick={() => setShowPrevOutreach(true)}
              className="rounded-md bg-[#f0f0f0] px-4 py-2 text-sm font-semibold text-[#333] hover:bg-[#e0e0e0] shadow-[0_2px_4px_rgba(0,0,0,0.1)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.15)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
            >
              Prev. Outreach
            </button>
            <button
              onClick={() => setShowAddOutreach(true)}
              className="rounded-md bg-[#f0f0f0] px-4 py-2 text-sm font-semibold text-[#333] hover:bg-[#e0e0e0] shadow-[0_2px_4px_rgba(0,0,0,0.1)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.15)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
            >
              New Outreach
            </button>
            <button onClick={onClose} className="rounded-md bg-[#f0f0f0] px-4 py-2 text-sm font-semibold text-[#333] hover:bg-[#e0e0e0] shadow-[0_2px_4px_rgba(0,0,0,0.1)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.15)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.1)]">
              Close
            </button>
          </div>
          {canDelete && (
            <button
              onClick={handleDelete}
              disabled={pending}
              className="rounded-md bg-[#dc3545] px-4 py-2 text-sm font-semibold text-white hover:bg-[#c82333] disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
            >
              Delete {memberLabel}
            </button>
          )}
        </div>
      </div>

      {showAddOutreach && (
        <AddOutreachModal
          memberId={member.id}
          memberName={member.full_name}
          memberPhone={member.phone}
          memberLabel={memberLabel}
          groupId={groupId}
          currentUserName={currentUserName}
          onClose={() => setShowAddOutreach(false)}
          onSaved={onSaved}
        />
      )}
      {showPrevOutreach && (
        <PrevOutreachModal memberId={member.id} memberName={member.full_name} onClose={() => setShowPrevOutreach(false)} />
      )}
      {pendingPhotoFile && (
        <PhotoCropperModal
          file={pendingPhotoFile}
          onCancel={() => setPendingPhotoFile(null)}
          onCropped={handlePhotoCropped}
        />
      )}
      {/* Owner-reported (Delete Youth's blocked-by-FK error specifically,
          but this covers every error path here -- Save, photo upload/
          delete, Delete -- since they all had the same problem): an inline
          banner near the top of this modal was easy to miss if the user
          was scrolled down near whatever they'd just clicked (e.g. Delete
          at the very bottom) -- it looked like nothing had happened unless
          they knew to scroll back up. */}
      {error && <ErrorModal message={error} onDismiss={() => setError(null)} />}
    </div>,
    document.body,
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
