"use client";

import { useRef, useState, useTransition } from "react";
import type { AdminGroupRow, AddGroupInput } from "@/app/admin/actions-needed-config/actions";
import {
  renameGroupAction,
  addGroupAction,
  deleteGroupTierAction,
  updateGroupQrColorAction,
  updateServantsQrColorAction,
  moveGroupAction,
  setGroupLevelAction,
  setGroupNamePatternAction,
  setGroupQrActiveAction,
  setGroupCheckInCodeAction,
  updateNamePatternsAction,
} from "@/app/admin/actions-needed-config/actions";
import { levelText, renderGroupName, PATTERN_PLACEHOLDER } from "@/lib/group-names";

const SERVANTS = "servants";

const inputClass =
  "rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none";
const greyButton =
  "rounded-md bg-[#f0f0f0] px-3 py-1.5 text-xs font-semibold text-[#333] hover:bg-[#e0e0e0] disabled:opacity-60";
const brandButton =
  "rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-60";

/** GROUP_LADDER_PLAN.md §4.5 -- the App Settings "Group Names & QR Code
 * Colors" panel. One list in display order: the hidden pre-entry group
 * first, the regular groups (▲/▼ to reorder, each at a level; several may
 * share one), the hidden hand-over group last, then the Servants code.
 * Each row has its QR colour dot (or, when it shares another group's code,
 * which one), and the hidden groups have a "QR code active" switch (D5).
 * "More" opens a row's level, yearly name pattern and check-in code. The
 * default name pattern sits at the top (Q3) and every new group starts from
 * it; the hand-over pattern sits below the list. Every change goes through
 * a migration-0069 function that refuses anything unsafe. */
export function GroupNamesInteractive({
  initial,
  positionLabel,
  levelOffset,
  groupLabel,
  initialServantsQrColor,
  initialDefaultPattern,
  initialTerminalPattern,
}: {
  initial: AdminGroupRow[];
  positionLabel: string;
  levelOffset: number;
  groupLabel: string;
  /** The Servants QR colour -- also what a group with no colour of its own
   * prints in (lib/qrcodes.ts). */
  initialServantsQrColor: string;
  initialDefaultPattern: string | null;
  initialTerminalPattern: string;
}) {
  const [groups, setGroups] = useState(initial);
  const [servantsQrColor, setServantsQrColor] = useState(initialServantsQrColor);
  const [colorStatus, setColorStatus] = useState<Record<string, "saving" | "saved">>({});
  const colorTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [patternDrafts, setPatternDrafts] = useState<Record<string, string>>({});
  const [defaultPattern, setDefaultPattern] = useState(initialDefaultPattern ?? "");
  const [terminalPattern, setTerminalPattern] = useState(initialTerminalPattern);
  const [patternsSaved, setPatternsSaved] = useState(false);

  const regular = groups.filter((g) => g.kind === "regular");
  const topLevel = regular.length > 0 ? Math.max(...regular.map((g) => g.ladder_position)) : 0;
  const preEntryYear = groups.find((g) => g.kind === "pre_entry")?.cohort_year ?? null;
  const exampleYear = preEntryYear ?? new Date().getFullYear();
  const graduatingYear = regular.find((g) => g.ladder_position === topLevel && g.cohort_year !== null)?.cohort_year ?? null;
  const nameOf = (id: string | null) => groups.find((g) => g.id === id)?.name ?? "another group";

  // Runs a server action; on success reloads (one change can renumber,
  // reorder or rename several rows, so the page re-reads them all).
  function run(action: () => Promise<{ error: string | null }>, reload = true) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.error) {
        setError(res.error);
        return;
      }
      if (reload) window.location.reload();
    });
  }

  // The colour picker reports every step while dragging, so save once the
  // colour has stopped changing for a moment. `key` is a group id, or
  // SERVANTS for the Servants QR.
  function handleQrColor(key: string, color: string) {
    setError(null);
    if (key === SERVANTS) setServantsQrColor(color);
    else setGroups((prev) => prev.map((g) => (g.id === key ? { ...g, qr_color: color } : g)));
    setColorStatus((prev) => ({ ...prev, [key]: "saving" }));
    clearTimeout(colorTimers.current[key]);
    colorTimers.current[key] = setTimeout(async () => {
      const res = key === SERVANTS ? await updateServantsQrColorAction(color) : await updateGroupQrColorAction(key, color);
      if (res.error) {
        setError(res.error);
        setColorStatus((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        return;
      }
      setColorStatus((prev) => ({ ...prev, [key]: "saved" }));
    }, 600);
  }

  // One row's colour dot (and its "Saving…"/"Saved" note). Group rows and
  // the Servants row use the same markup so every dot lines up.
  function colorDot(key: string, color: string, label: string) {
    return (
      <>
        {colorStatus[key] && (
          <span className="text-[11px] text-[#999]">{colorStatus[key] === "saving" ? "Saving…" : "Saved"}</span>
        )}
        <input
          type="color"
          value={color}
          onChange={(e) => handleQrColor(key, e.target.value)}
          title={`QR code colour for ${label}`}
          aria-label={`QR code colour for ${label}`}
          className="h-7 w-7 shrink-0 cursor-pointer appearance-none rounded-full border border-[#ddd] bg-transparent p-0 [&::-moz-color-swatch]:rounded-full [&::-moz-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch-wrapper]:p-0"
        />
      </>
    );
  }

  function handleSaveRename(groupId: string) {
    setError(null);
    startTransition(async () => {
      const res = await renameGroupAction(groupId, editingName);
      if (res.error) {
        setError(res.error);
        return;
      }
      setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, name: editingName.trim() } : g)));
      setEditingId(null);
    });
  }

  function handleQrActive(g: AdminGroupRow, active: boolean) {
    setGroups((prev) => prev.map((x) => (x.id === g.id ? { ...x, qr_active: active } : x)));
    run(() => setGroupQrActiveAction(g.id, active), false);
  }

  function handleCheckInCode(g: AdminGroupRow, codeGroupId: string) {
    const target = codeGroupId || null;
    if (target && !confirm(`"${g.name}" will use ${nameOf(target)}'s QR code, and its own code stops working. Continue?`)) return;
    run(() => setGroupCheckInCodeAction(g.id, target));
  }

  function handleDelete(g: AdminGroupRow) {
    if (!confirm(`Remove "${g.name}"? This only works if it has no active members or role grants left.`)) return;
    run(() => deleteGroupTierAction(g.id));
  }

  // Add Group --------------------------------------------------------------
  const blankAdd = (): AddGroupInput => ({ name: "", level: null, cohortYear: null, qrColor: null, namePattern: defaultPattern });
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<AddGroupInput>(blankAdd);
  const [nameTyped, setNameTyped] = useState(false);
  const addLevel = addForm.level ?? topLevel + 1;
  const suggestedName =
    addForm.namePattern && PATTERN_PLACEHOLDER.test(addForm.namePattern)
      ? renderGroupName(addForm.namePattern, addForm.cohortYear, addLevel, levelOffset, positionLabel)
      : "";
  const addName = nameTyped ? addForm.name : suggestedName;

  function handleAdd() {
    if (!addName.trim()) {
      setError("Name is required.");
      return;
    }
    run(() => addGroupAction({ ...addForm, name: addName }));
  }

  function rowLabel(g: AdminGroupRow) {
    if (g.kind === "pre_entry") return "Pre-entry";
    if (g.kind === "terminal") return "Hand-over";
    return levelText(g.ladder_position, positionLabel, levelOffset);
  }

  return (
    <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] p-5">
      <h2 className="text-lg font-bold text-brand mb-1">Group Names &amp; QR Code Colors</h2>
      <p className="text-sm text-[#666] mb-4">
        Every active group, in the order the side menu lists them. The pre-entry group (first) and the hand-over
        group (last) are hidden from everyone except Admins. Use ▲/▼ to change the order, and <em>More</em> for a
        group&rsquo;s level, yearly name pattern and check-in code. Click a colour dot to change that QR code&rsquo;s
        colour; it saves straight away.
      </p>
      {error && <p className="mb-3 text-sm text-[#dc3545]">{error}</p>}

      {/* Q3 -- the default yearly name pattern, at the top. */}
      <div className="mb-4 rounded-md border border-[#eee] bg-[#fafafa] p-3">
        <label className="block text-xs font-semibold text-[#555]">
          Default name pattern
          <input
            value={defaultPattern}
            onChange={(e) => {
              setDefaultPattern(e.target.value);
              setPatternsSaved(false);
            }}
            placeholder="{cohort_year} - Yr {level}"
            className={`mt-1 w-full ${inputClass}`}
          />
        </label>
        <p className="mt-1 text-xs text-[#888]">
          New {groupLabel.toLowerCase()}s start from this. {"{cohort_year}"} = the year, {"{level}"} = the level number,{" "}
          {"{label}"} = &ldquo;{positionLabel}&rdquo;.
          {PATTERN_PLACEHOLDER.test(defaultPattern) && (
            <>
              {" "}
              Example: <strong>{renderGroupName(defaultPattern, exampleYear, 1, levelOffset, positionLabel)}</strong>
            </>
          )}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const res = await updateNamePatternsAction(defaultPattern, terminalPattern);
                if (!res.error) setPatternsSaved(true);
                return res;
              }, false)
            }
            className={brandButton}
          >
            Save pattern
          </button>
          {patternsSaved && <span className="text-xs text-[#28a745]">Saved</span>}
        </div>
      </div>

      <div className="divide-y divide-[#f0f0f0] mb-4">
        {groups.map((g) => {
          const isRegular = g.kind === "regular";
          const regularIndex = regular.findIndex((r) => r.id === g.id);
          const sharesCode = g.check_in_code_group_id !== null;
          const expanded = expandedId === g.id;
          const draft = patternDrafts[g.id] ?? g.name_pattern ?? "";
          const codeOwners = groups.filter(
            (o) => o.id !== g.id && o.kind !== "pre_entry" && o.check_in_code_group_id === null,
          );
          return (
            <div key={g.id} className="py-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="w-20 shrink-0 text-xs font-semibold text-[#666]">{rowLabel(g)}</span>
                <span className="flex w-12 shrink-0 gap-1">
                  {isRegular && (
                    <>
                      <button
                        type="button"
                        aria-label={`Move ${g.name} up`}
                        disabled={pending || regularIndex === 0}
                        onClick={() => run(() => moveGroupAction(g.id, "up"))}
                        className="rounded px-1.5 text-xs text-[#555] hover:bg-[#eee] disabled:opacity-30"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${g.name} down`}
                        disabled={pending || regularIndex === regular.length - 1}
                        onClick={() => run(() => moveGroupAction(g.id, "down"))}
                        className="rounded px-1.5 text-xs text-[#555] hover:bg-[#eee] disabled:opacity-30"
                      >
                        ▼
                      </button>
                    </>
                  )}
                </span>
                {editingId === g.id ? (
                  <>
                    <input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className={`flex-1 min-w-[8rem] ${inputClass}`}
                    />
                    <button type="button" onClick={() => handleSaveRename(g.id)} disabled={pending} className={brandButton}>
                      Save
                    </button>
                    <button type="button" onClick={() => setEditingId(null)} className={greyButton}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 min-w-[8rem]">
                      <span className="block truncate text-sm text-[#333]">{g.name}</span>
                      <span className="block text-[11px] text-[#999]">
                        {g.active_count} active
                        {!isRegular && " · hidden from servants"}
                        {sharesCode && ` · uses ${nameOf(g.check_in_code_group_id)}'s QR code`}
                      </span>
                    </span>
                    {!isRegular && (
                      <label className="flex items-center gap-1 text-[11px] text-[#555]" title="QR code active (D5)">
                        <input
                          type="checkbox"
                          checked={g.qr_active}
                          disabled={pending}
                          onChange={(e) => handleQrActive(g, e.target.checked)}
                        />
                        QR active
                      </label>
                    )}
                    {sharesCode ? (
                      <span aria-hidden="true" className="h-7 w-7 shrink-0" />
                    ) : (
                      colorDot(g.id, g.qr_color ?? servantsQrColor, g.name)
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setEditingId(g.id);
                        setEditingName(g.name);
                      }}
                      className={greyButton}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : g.id)}
                      className={greyButton}
                      aria-expanded={expanded}
                    >
                      {expanded ? "Less" : "More"}
                    </button>
                    {isRegular ? (
                      <button
                        type="button"
                        onClick={() => handleDelete(g)}
                        disabled={pending}
                        className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-[#dc3545] border border-[#dc3545] hover:bg-[#f8d7da] disabled:opacity-60"
                      >
                        Delete
                      </button>
                    ) : (
                      <span aria-hidden="true" className="invisible rounded-md border px-3 py-1.5 text-xs font-semibold">
                        Delete
                      </span>
                    )}
                  </>
                )}
              </div>

              {expanded && (
                <div className="mt-2 ml-0 sm:ml-[8.75rem] space-y-3 rounded-md border border-[#eee] bg-[#fafafa] p-3 text-xs text-[#555]">
                  {isRegular && (
                    <label className="block">
                      Level
                      <select
                        value={g.ladder_position}
                        disabled={pending}
                        onChange={(e) => run(() => setGroupLevelAction(g.id, Number(e.target.value)))}
                        className={`mt-1 block ${inputClass}`}
                      >
                        {Array.from({ length: topLevel }, (_, i) => i + 1).map((l) => (
                          <option key={l} value={l}>
                            {levelText(l, positionLabel, levelOffset)}
                          </option>
                        ))}
                        <option value={topLevel + 1}>
                          New top level: {levelText(topLevel + 1, positionLabel, levelOffset)}
                        </option>
                      </select>
                    </label>
                  )}
                  {g.kind !== "terminal" && (
                    <div>
                      <label className="block">
                        Yearly name pattern (empty = the name never changes)
                        <input
                          value={draft}
                          onChange={(e) => setPatternDrafts((prev) => ({ ...prev, [g.id]: e.target.value }))}
                          placeholder={defaultPattern || "{cohort_year} - Yr {level}"}
                          className={`mt-1 w-full ${inputClass}`}
                        />
                      </label>
                      {PATTERN_PLACEHOLDER.test(draft) && (
                        <p className="mt-1 text-[#888]">
                          After the next Group Transition:{" "}
                          <strong>
                            {renderGroupName(draft, g.cohort_year, isRegular ? g.ladder_position + 1 : 1, levelOffset, positionLabel)}
                          </strong>
                        </p>
                      )}
                      <button
                        type="button"
                        disabled={pending || draft === (g.name_pattern ?? "")}
                        onClick={() => run(() => setGroupNamePatternAction(g.id, draft))}
                        className={`mt-2 ${brandButton}`}
                      >
                        Save pattern
                      </button>
                    </div>
                  )}
                  {g.kind !== "pre_entry" && (
                    <label className="block">
                      Check-in QR code
                      <select
                        value={g.check_in_code_group_id ?? ""}
                        disabled={pending || groups.some((o) => o.check_in_code_group_id === g.id)}
                        onChange={(e) => handleCheckInCode(g, e.target.value)}
                        className={`mt-1 block ${inputClass}`}
                      >
                        <option value="">Its own code</option>
                        {codeOwners.map((o) => (
                          <option key={o.id} value={o.id}>
                            Use {o.name}&rsquo;s code
                          </option>
                        ))}
                      </select>
                      {groups.some((o) => o.check_in_code_group_id === g.id) && (
                        <span className="mt-1 block text-[#888]">
                          Also used by {groups.filter((o) => o.check_in_code_group_id === g.id).map((o) => o.name).join(", ")}.
                        </span>
                      )}
                    </label>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showAddForm ? (
        <div className="rounded-md border border-[#ddd] p-3 space-y-2">
          <p className="text-xs text-[#666]">
            The new {groupLabel.toLowerCase()} is listed last, just before the hand-over group. Choose a new top level,
            or an existing level for a second class in the same grade.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="text-xs text-[#666]">
              Level
              <select
                value={addForm.level ?? ""}
                onChange={(e) => setAddForm((prev) => ({ ...prev, level: e.target.value === "" ? null : Number(e.target.value) }))}
                className={`mt-1 w-full ${inputClass}`}
              >
                <option value="">New top level: {levelText(topLevel + 1, positionLabel, levelOffset)}</option>
                {Array.from({ length: topLevel }, (_, i) => i + 1).map((l) => (
                  <option key={l} value={l}>
                    {levelText(l, positionLabel, levelOffset)} (another class)
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-[#666]">
              {groupLabel} year (optional)
              <input
                type="number"
                value={addForm.cohortYear ?? ""}
                onChange={(e) => setAddForm((prev) => ({ ...prev, cohortYear: e.target.value === "" ? null : Number(e.target.value) }))}
                className={`mt-1 w-full ${inputClass}`}
              />
            </label>
            <label className="text-xs text-[#666]">
              Yearly name pattern
              <input
                value={addForm.namePattern}
                onChange={(e) => setAddForm((prev) => ({ ...prev, namePattern: e.target.value }))}
                className={`mt-1 w-full ${inputClass}`}
              />
            </label>
            <label className="text-xs text-[#666]">
              Name (required)
              <input
                value={addName}
                onChange={(e) => {
                  setNameTyped(true);
                  setAddForm((prev) => ({ ...prev, name: e.target.value }));
                }}
                className={`mt-1 w-full ${inputClass}`}
              />
            </label>
            <div className="text-xs text-[#666] sm:col-span-2">
              QR colour
              <div className="mt-1 flex items-center gap-3">
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    checked={addForm.qrColor === null}
                    onChange={() => setAddForm((prev) => ({ ...prev, qrColor: null }))}
                  />
                  Pick one automatically (different from the others)
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    checked={addForm.qrColor !== null}
                    onChange={() => setAddForm((prev) => ({ ...prev, qrColor: "#999999" }))}
                  />
                  Choose
                </label>
                {addForm.qrColor !== null && (
                  <input
                    type="color"
                    value={addForm.qrColor}
                    onChange={(e) => setAddForm((prev) => ({ ...prev, qrColor: e.target.value }))}
                    className="h-7 w-10 rounded border border-[#ddd]"
                  />
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleAdd} disabled={pending} className={`px-4 ${brandButton}`}>
              {pending ? "Adding…" : "Add Group"}
            </button>
            <button type="button" onClick={() => setShowAddForm(false)} className={`px-4 ${greyButton}`}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setAddForm(blankAdd());
            setNameTyped(false);
            setShowAddForm(true);
          }}
          className={`px-4 ${brandButton}`}
        >
          + Add Group
        </button>
      )}

      <div className="mt-4 border-t border-[#f0f0f0] py-2 flex items-center gap-3">
        <span className="w-20 shrink-0" />
        <span className="w-12 shrink-0" />
        <span className="flex-1 min-w-0 truncate text-sm text-[#333]">Servants</span>
        {colorDot(SERVANTS, servantsQrColor, "the Servants QR")}
        <span aria-hidden="true" className="invisible rounded-md px-3 py-1.5 text-xs font-semibold">
          Rename
        </span>
        <span aria-hidden="true" className="invisible rounded-md px-3 py-1.5 text-xs font-semibold">
          More
        </span>
        <span aria-hidden="true" className="invisible rounded-md border px-3 py-1.5 text-xs font-semibold">
          Delete
        </span>
      </div>

      {/* D9 -- the hand-over group's yearly name. */}
      <div className="mt-4 rounded-md border border-[#eee] bg-[#fafafa] p-3">
        <label className="block text-xs font-semibold text-[#555]">
          Hand-over group name pattern
          <input
            value={terminalPattern}
            onChange={(e) => {
              setTerminalPattern(e.target.value);
              setPatternsSaved(false);
            }}
            className={`mt-1 w-full ${inputClass}`}
          />
        </label>
        <p className="mt-1 text-xs text-[#888]">
          Used at each Group Transition, with the year of the {groupLabel.toLowerCase()} that graduates. Next one:{" "}
          <strong>{renderGroupName(terminalPattern, graduatingYear, 0, 0, positionLabel)}</strong>
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const res = await updateNamePatternsAction(defaultPattern, terminalPattern);
              if (!res.error) setPatternsSaved(true);
              return res;
            }, false)
          }
          className={`mt-2 ${brandButton}`}
        >
          Save pattern
        </button>
      </div>
    </div>
  );
}
