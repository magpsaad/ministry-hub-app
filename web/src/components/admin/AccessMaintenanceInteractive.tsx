"use client";

import { useMemo, useState, useTransition } from "react";
import type { AccessProfile, AccessRoleRow } from "@/app/admin/access-maintenance/actions";
import type { GroupSummary } from "@/lib/groups";
import {
  addPersonByEmailAction,
  grantRoleAction,
  revokeRoleAction,
  removeProfileCompletelyAction,
  mergeServantAccountsAction,
  setPersonDeactivatedAction,
} from "@/app/admin/access-maintenance/actions";

const ROLE_LABELS: Record<AccessRoleRow["role"], string> = {
  // "System Admin" (not just "Admin") deliberately -- owner-reported:
  // disambiguates the role from someone doing "an admin function" for the
  // service day-to-day (food, marketing, trips) with no need for cohort
  // data access at all.
  admin: "System Admin",
  general_coordinator: "General Coordinator",
  // Owner-requested: displayed as just "Coordinator" now (was
  // "Sub-Coordinator") -- the internal role/key name is unchanged.
  sub_coordinator: "Coordinator",
  servant: "Servant",
  read_only: "Read-Only (exception access)",
};

const ROLE_DESCRIPTIONS: Record<AccessRoleRow["role"], string> = {
  admin: "Can: everything, everywhere — every group's data, plus every admin-only screen (this one included). Cannot be restricted from anything.",
  general_coordinator: "Can: full read/write on every group's data, and the Coordinator Corner. Cannot open admin-only screens, unless also separately granted System Admin.",
  sub_coordinator: "Can: full read/write, same as General Coordinator, but scoped to just one group. Cannot reassign a servant's group, remove a servant, or see/edit any other group's data.",
  servant: "Can: view/edit their one assigned group's data (or none at all, if Unassigned), and appear in that group's assignment list — the only role that does, even though Coordinators/Read-Only can also access that group's data. Cannot see or edit any other group's data.",
  read_only: "Can: view one group's data — members, attendance, outreach. Cannot make any edit there, and never appears in that group's assignment dropdown. Meant to sit alongside someone's real primary role, not as their only grant.",
};

const ROLES_REQUIRING_GROUP: AccessRoleRow["role"][] = ["sub_coordinator", "read_only"];
const ROLES_ALLOWING_GROUP: AccessRoleRow["role"][] = ["sub_coordinator", "servant", "read_only"];

/** REQUIREMENTS.md §6.14/§4 -- Access Maintenance: grant/revoke role rows
 * over `user_roles`. Only existing profiles (people who've signed in at
 * least once) can be granted a role -- there's no account to attach one to
 * otherwise (matches how the Pending Servants approval flow works). */
export function AccessMaintenanceInteractive({
  profiles: initialProfiles,
  initialRoles,
  groups,
}: {
  profiles: AccessProfile[];
  initialRoles: AccessRoleRow[];
  groups: GroupSummary[];
}) {
  const [profiles, setProfiles] = useState(initialProfiles);
  const [roles, setRoles] = useState(initialRoles);
  const [search, setSearch] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [newRole, setNewRole] = useState<AccessRoleRow["role"]>("servant");
  const [newGroupId, setNewGroupId] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showMerge, setShowMerge] = useState(false);
  const [mergeSearch, setMergeSearch] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addMessage, setAddMessage] = useState<{ ok: boolean; text: string } | null>(null);

  /** MULTI_TENANT_PLAN.md §3.7 -- "Add existing account by email". Someone
   * already listed here is simply selected; otherwise they get a profile in
   * this ministry (no role yet) and are selected so a role can be granted. */
  function handleAddByEmail() {
    const email = addEmail.trim();
    setAddMessage(null);
    if (!email) return;
    const existing = profiles.find((p) => p.email?.toLowerCase() === email.toLowerCase());
    if (existing) {
      setSelectedProfileId(existing.id);
      setAddMessage({ ok: true, text: `${existing.full_name} is already listed — selected.` });
      return;
    }
    startTransition(async () => {
      const res = await addPersonByEmailAction(email);
      if (res.error || !res.profile) {
        setAddMessage({ ok: false, text: res.error ?? "Could not add that person." });
        return;
      }
      const added = res.profile;
      setProfiles((prev) =>
        prev.some((p) => p.id === added.id)
          ? prev
          : [...prev, added].sort((a, b) => a.full_name.localeCompare(b.full_name)),
      );
      setSelectedProfileId(added.id);
      setAddEmail("");
      setAddMessage({ ok: true, text: `Added ${added.full_name}. Grant them a role on the right.` });
    });
  }

  const filteredProfiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Was capped at the first 20 -- silently hid anyone alphabetically past
    // that (owner-reported: only findable by searching). The list below
    // already scrolls in its own fixed-height box, so there's no reason to
    // truncate it.
    if (!q) return profiles;
    return profiles.filter((p) => p.full_name.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q));
  }, [profiles, search]);

  const mergeCandidates = useMemo(() => {
    const q = mergeSearch.trim().toLowerCase();
    const others = profiles.filter((p) => p.id !== selectedProfileId);
    if (!q) return others;
    return others.filter((p) => p.full_name.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q));
  }, [profiles, mergeSearch, selectedProfileId]);

  const selectedProfile = profiles.find((p) => p.id === selectedProfileId) ?? null;
  const selectedRoles = roles.filter((r) => r.user_id === selectedProfileId);

  function handleGrant() {
    if (!selectedProfileId) return;
    setError(null);
    const groupId = ROLES_ALLOWING_GROUP.includes(newRole) && newGroupId ? newGroupId : null;
    if (ROLES_REQUIRING_GROUP.includes(newRole) && !groupId) {
      setError("This role requires a group.");
      return;
    }
    startTransition(async () => {
      const res = await grantRoleAction(selectedProfileId, newRole, groupId);
      if (res.error) {
        setError(res.error);
        return;
      }
      setRoles((prev) => [
        ...prev,
        {
          id: res.id!,
          user_id: selectedProfileId,
          role: newRole,
          group_id: groupId,
          group_name: groups.find((g) => g.id === groupId)?.name ?? null,
        },
      ]);
    });
  }

  function handleRevoke(roleRowId: string) {
    if (!confirm("Revoke this role grant?")) return;
    setError(null);
    startTransition(async () => {
      const res = await revokeRoleAction(roleRowId);
      if (res.error) {
        setError(res.error);
        return;
      }
      setRoles((prev) => prev.filter((r) => r.id !== roleRowId));
    });
  }

  /** Owner-reported: a duplicate/leftover account (all its roles already
   * revoked above) has no way to be removed outright -- it just sits here
   * forever, since this is the only screen listing every profile
   * regardless of role. remove_profile_completely() itself refuses if the
   * person has left behind any real history, so this can't silently
   * destroy genuine activity -- that failure surfaces here as an error. */
  function handleRemoveProfile() {
    if (!selectedProfileId || !selectedProfile) return;
    if (!confirm(`Permanently remove ${selectedProfile.full_name}'s record? This cannot be undone.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await removeProfileCompletelyAction(selectedProfileId);
      if (res.error) {
        setError(res.error);
        return;
      }
      setProfiles((prev) => prev.filter((p) => p.id !== selectedProfileId));
      setRoles((prev) => prev.filter((r) => r.user_id !== selectedProfileId));
      setSelectedProfileId(null);
    });
  }

  /** Owner-requested (3 Oct 2026): someone who no longer serves is
   * Deactivated rather than removed -- history kept, roles removed, and no
   * role can be given until an Admin reactivates them (migration 0077). */
  function handleSetDeactivated(deactivated: boolean) {
    if (!selectedProfileId || !selectedProfile) return;
    const name = selectedProfile.full_name;
    const question = deactivated
      ? `Deactivate ${name}? Their roles here are removed and nobody can give them access again until they're reactivated. Their history (attendance, outreach, assignments) is kept.`
      : `Reactivate ${name}? They get no role back automatically -- grant one below if they should have access.`;
    if (!confirm(question)) return;
    setError(null);
    const personId = selectedProfileId;
    startTransition(async () => {
      const res = await setPersonDeactivatedAction(personId, deactivated);
      if (res.error) {
        setError(res.error);
        return;
      }
      setProfiles((prev) =>
        prev.map((p) =>
          p.id === personId ? { ...p, deactivated_at: deactivated ? (res.deactivatedAt ?? new Date().toISOString()) : null } : p,
        ),
      );
      if (deactivated) setRoles((prev) => prev.filter((r) => r.user_id !== personId));
    });
  }

  /** Owner-requested: for a servant who ended up with two accounts (a
   * different email each time). The currently-selected person is "the one
   * to keep"; this picks the duplicate to merge away. Unlike Remove
   * Person, both accounts may have real history -- migration 0056 folds
   * the duplicate's attendance, outreach, assignments, calendar events,
   * and role grants onto the kept account rather than refusing. A full
   * reload afterward (rather than hand-updating local state) so the roles
   * list reflects the merge's own dedup rules exactly as the server
   * applied them. */
  function handleMerge(removeId: string, removeName: string) {
    if (!selectedProfileId || !selectedProfile) return;
    if (
      !confirm(
        `Merge ${removeName}'s history into ${selectedProfile.full_name}? All of ${removeName}'s attendance, outreach, assignments, calendar events, and role grants will move onto ${selectedProfile.full_name}, and ${removeName}'s record will then be permanently deleted. This cannot be undone.`,
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      const res = await mergeServantAccountsAction(selectedProfileId, removeId);
      if (res.error) {
        setError(res.error);
        return;
      }
      window.location.reload();
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
        <h2 className="text-sm font-bold text-brand mb-2">What each role can and cannot do</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
          {(Object.keys(ROLE_LABELS) as AccessRoleRow["role"][]).map((r) => (
            <div key={r}>
              <dt className="font-semibold text-[#333]">{ROLE_LABELS[r]}</dt>
              <dd className="text-[#666]">{ROLE_DESCRIPTIONS[r]}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
        <h2 className="text-lg font-bold text-brand mb-3">Find a Person</h2>
        <p className="text-xs text-[#666] mb-3">
          Only people who&rsquo;ve signed in at least once appear here -- there&rsquo;s no account yet to grant a
          role to otherwise.
        </p>
        <input
          type="text"
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-md border border-[#ddd] px-3 py-2 text-sm mb-3 focus:border-brand focus:outline-none"
        />
        <div className="mb-3 rounded-md border border-[#eee] bg-[#fafafa] p-3">
          <p className="text-xs text-[#666] mb-2">
            <strong className="text-[#333]">Add existing account by email</strong> &mdash; for someone who already has
            a sign-in but hasn&rsquo;t used this ministry&rsquo;s address yet.
          </p>
          <div className="flex gap-2">
            <input
              type="email"
              placeholder="their@email.com"
              value={addEmail}
              onChange={(e) => setAddEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddByEmail();
              }}
              className="min-w-0 flex-1 rounded-md border border-[#ddd] px-3 py-1.5 text-sm focus:border-brand focus:outline-none"
            />
            <button
              type="button"
              onClick={handleAddByEmail}
              disabled={pending || !addEmail.trim()}
              className="shrink-0 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
            >
              Add
            </button>
          </div>
          {addMessage && (
            <p className={`mt-2 text-xs ${addMessage.ok ? "text-[#155724]" : "text-[#dc3545]"}`}>{addMessage.text}</p>
          )}
        </div>
        <div className="divide-y divide-[#f0f0f0] max-h-96 overflow-y-auto">
          {filteredProfiles.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setSelectedProfileId(p.id);
                setError(null);
                setShowMerge(false);
                setMergeSearch("");
              }}
              className={`w-full text-left py-2 px-2 text-sm rounded-md ${
                selectedProfileId === p.id ? "bg-brand text-white" : "hover:bg-[#f5f5f5] text-[#333]"
              }`}
            >
              <p className={`font-medium ${p.deactivated_at && selectedProfileId !== p.id ? "text-[#999]" : ""}`}>
                {p.full_name}
                {p.deactivated_at && (
                  <span
                    className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      selectedProfileId === p.id ? "bg-white/20 text-white" : "bg-[#eee] text-[#777]"
                    }`}
                  >
                    Deactivated
                  </span>
                )}
              </p>
              <p className={`text-xs ${selectedProfileId === p.id ? "text-white/70" : "text-[#666]"}`}>{p.email}</p>
            </button>
          ))}
          {filteredProfiles.length === 0 && <p className="py-2 text-sm text-[#666]">No matches.</p>}
        </div>
      </div>

      <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
        {!selectedProfile ? (
          <p className="text-sm text-[#666]">Select a person to view/edit their roles.</p>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-lg font-bold text-brand">{selectedProfile.full_name}</h2>
              <div className="flex shrink-0 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowMerge((v) => !v);
                    setMergeSearch("");
                    setError(null);
                  }}
                  disabled={pending}
                  title="Merge a duplicate account's history into this one"
                  className="text-xs font-semibold text-brand hover:underline disabled:opacity-60"
                >
                  Merge Duplicate Into This
                </button>
                {!selectedProfile.deactivated_at && (
                  <button
                    type="button"
                    onClick={() => handleSetDeactivated(true)}
                    disabled={pending}
                    title="No longer serving: remove their access but keep their history"
                    className="text-xs font-semibold text-[#b26a00] hover:underline disabled:opacity-60"
                  >
                    Deactivate
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleRemoveProfile}
                  disabled={pending}
                  title="Permanently delete this person's record"
                  className="text-xs font-semibold text-[#dc3545] hover:underline disabled:opacity-60"
                >
                  Remove Person
                </button>
              </div>
            </div>
            {error && <p className="mb-3 text-sm text-[#dc3545]">{error}</p>}

            {selectedProfile.deactivated_at && (
              <div className="mb-4 rounded-md border border-[#e0e0e0] bg-[#f7f7f7] p-3 text-sm text-[#555]">
                <p>
                  <strong className="text-[#333]">Deactivated</strong> on{" "}
                  {new Date(selectedProfile.deactivated_at).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                  . Their history is kept, but they can&rsquo;t be given a role until they&rsquo;re reactivated.
                </p>
                <button
                  type="button"
                  onClick={() => handleSetDeactivated(false)}
                  disabled={pending}
                  className="mt-2 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
                >
                  Reactivate
                </button>
              </div>
            )}

            {showMerge && (
              <div className="mb-4 rounded-md border border-[#ddd] p-3 bg-[#f9f9f9]">
                <p className="text-xs text-[#666] mb-2">
                  Pick the duplicate account to merge into <strong>{selectedProfile.full_name}</strong>. That
                  account&rsquo;s history moves here, then its record is permanently deleted.
                </p>
                <input
                  type="text"
                  placeholder="Search by name or email..."
                  value={mergeSearch}
                  onChange={(e) => setMergeSearch(e.target.value)}
                  className="w-full rounded-md border border-[#ddd] px-3 py-2 text-sm mb-2 focus:border-brand focus:outline-none"
                />
                <div className="divide-y divide-[#f0f0f0] max-h-48 overflow-y-auto">
                  {mergeCandidates.map((p) => (
                    <div key={p.id} className="py-1.5 flex items-center justify-between gap-2 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium text-[#333] truncate">{p.full_name}</p>
                        <p className="text-xs text-[#666] truncate">{p.email}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleMerge(p.id, p.full_name)}
                        disabled={pending}
                        className="shrink-0 rounded-md bg-brand px-3 py-1 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
                      >
                        Merge
                      </button>
                    </div>
                  ))}
                  {mergeCandidates.length === 0 && <p className="py-2 text-sm text-[#666]">No matches.</p>}
                </div>
              </div>
            )}

            <div className="divide-y divide-[#f0f0f0] mb-4">
              {selectedRoles.map((r) => (
                <div key={r.id} className="py-2 flex items-center justify-between text-sm">
                  <span className="text-[#333]">
                    {ROLE_LABELS[r.role]}
                    {r.group_name && ` — ${r.group_name}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRevoke(r.id)}
                    disabled={pending}
                    className="text-[#dc3545] text-xs font-semibold disabled:opacity-60"
                  >
                    Revoke
                  </button>
                </div>
              ))}
              {selectedRoles.length === 0 && <p className="py-2 text-sm text-[#666]">No roles granted yet.</p>}
            </div>

            {!selectedProfile.deactivated_at && (
            <div className="border-t border-[#f0f0f0] pt-3 space-y-2">
              <h3 className="text-sm font-bold text-brand">Grant a Role</h3>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as AccessRoleRow["role"])}
                className="w-full rounded-md border border-[#ddd] px-3 py-2 text-sm focus:border-brand focus:outline-none"
              >
                {(Object.keys(ROLE_LABELS) as AccessRoleRow["role"][]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
              {ROLES_ALLOWING_GROUP.includes(newRole) && (
                <select
                  value={newGroupId}
                  onChange={(e) => setNewGroupId(e.target.value)}
                  className="w-full rounded-md border border-[#ddd] px-3 py-2 text-sm focus:border-brand focus:outline-none"
                >
                  <option value="">{newRole === "servant" ? "Unassigned" : "Select a group..."}</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={handleGrant}
                disabled={pending}
                className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60 shadow-[0_2px_4px_rgba(0,0,0,0.15)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_8px_rgba(0,0,0,0.2)] active:translate-y-0 active:shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
              >
                Grant
              </button>
            </div>
            )}
          </>
        )}
      </div>
      </div>
    </div>
  );
}
