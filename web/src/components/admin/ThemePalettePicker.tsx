"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import {
  THEME_COLOR_FIELDS,
  THEME_PALETTES,
  customColorWarnings,
  matchPalette,
  type ThemeColors,
} from "@/lib/theme-palettes";

const CUSTOM = "custom";

type Option = { id: string; name: string; colors: ThemeColors | null };

/** A palette's five colours as one band, with its name on top. `colors`
 * null = the Custom row before any custom colours exist (dashed outline). */
function PaletteBand({ name, colors }: { name: string; colors: ThemeColors | null }) {
  return (
    <span
      className={`relative flex h-9 w-full overflow-hidden rounded-md ${colors ? "" : "border border-dashed border-[#bbb] bg-[#fafafa]"}`}
    >
      {colors &&
        THEME_COLOR_FIELDS.map(({ field }) => (
          <span key={field} className="flex-1" style={{ background: colors[field] }} />
        ))}
      <span className="absolute inset-0 flex items-center justify-center">
        <span
          className={`rounded px-2 py-0.5 text-xs font-semibold ${colors ? "bg-black/40 text-white" : "text-[#666]"}`}
        >
          {name}
        </span>
      </span>
    </span>
  );
}

/** App Settings colour palette. The dropdown shows every palette as a colour
 * band with its name on it; picking one writes its five colours into the form
 * (saved with the rest of App Labels & Branding), and the preview below shows
 * how they look. "Custom" keeps the current colours and shows the five fields
 * to edit, with readability warnings. */
export function ThemePalettePicker({
  colors,
  onChange,
}: {
  colors: ThemeColors;
  onChange: (colors: ThemeColors) => void;
}) {
  const [choice, setChoice] = useState<string>(() => matchPalette(colors)?.id ?? CUSTOM);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const options: Option[] = [
    ...THEME_PALETTES.map((p) => ({ id: p.id, name: p.name, colors: p.colors })),
    // The Custom row shows the ministry's own colours once it has some.
    { id: CUSTOM, name: "Custom", colors: choice === CUSTOM ? colors : null },
  ];
  const selected = options.find((o) => o.id === choice) ?? options[options.length - 1];
  const warnings = choice === CUSTOM ? customColorWarnings(colors) : [];

  // Close when clicking anywhere outside the picker.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // While open, the list has keyboard focus; keep the highlighted row in view.
  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (open) listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function openList() {
    setActive(Math.max(0, options.findIndex((o) => o.id === choice)));
    setOpen(true);
  }

  function pick(id: string) {
    setChoice(id);
    setOpen(false);
    buttonRef.current?.focus();
    const palette = THEME_PALETTES.find((p) => p.id === id);
    if (palette) onChange({ ...palette.colors });
  }

  function onButtonKeyDown(e: KeyboardEvent) {
    if (!open && ["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      openList();
    }
  }

  function onListKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(options[active].id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div className="sm:col-span-2 rounded-md border border-[#eee] p-3 space-y-3">
      <div ref={rootRef} className="relative">
        <p className="text-xs text-[#666]" id={`${listId}-label`}>
          Colour palette
        </p>
        <button
          ref={buttonRef}
          type="button"
          onClick={() => (open ? setOpen(false) : openList())}
          onKeyDown={onButtonKeyDown}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-labelledby={`${listId}-label`}
          className="mt-1 flex w-full items-center gap-2 rounded-md border border-[#ddd] bg-white p-1.5 text-left focus:border-brand focus:outline-none"
        >
          <PaletteBand name={selected.name} colors={selected.colors} />
          <span aria-hidden="true" className="px-1 text-xs text-[#666]">
            {open ? "▲" : "▼"}
          </span>
        </button>
        {open && (
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            onKeyDown={onListKeyDown}
            aria-labelledby={`${listId}-label`}
            aria-activedescendant={`${listId}-${options[active].id}`}
            className="absolute left-0 right-0 z-30 mt-1 max-h-[32rem] focus:outline-none space-y-1 overflow-y-auto rounded-md border border-[#ddd] bg-white p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.15)]"
          >
            {options.map((o, i) => (
              <li
                key={o.id}
                id={`${listId}-${o.id}`}
                role="option"
                aria-selected={o.id === choice}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o.id)}
                className={`cursor-pointer rounded-md p-0.5 ${
                  o.id === choice ? "ring-2 ring-brand" : i === active ? "ring-2 ring-[#bbb]" : ""
                }`}
              >
                <PaletteBand name={o.name} colors={o.colors} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="text-xs text-[#666]">Preview</p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white">
          <span
            className="rounded-md px-3 py-1.5 font-semibold"
            style={{ background: `linear-gradient(135deg, ${colors.theme_color}, ${colors.theme_color_light})` }}
          >
            Header
          </span>
          <span className="rounded-md px-3 py-1.5 font-semibold" style={{ background: colors.theme_color }}>
            Button
          </span>
          <span className="rounded-md px-3 py-1.5 font-semibold" style={{ background: colors.theme_color_dark }}>
            Button (hover)
          </span>
          <span
            className="rounded-md px-3 py-1.5 font-semibold"
            style={{
              background: `linear-gradient(135deg, ${colors.my_assigned_header_color}, ${colors.my_assigned_header_color_light})`,
            }}
          >
            My Assigned List
          </span>
        </div>
        <p className="mt-2 text-[11px] text-[#999]">The colours apply across the app when you save.</p>
      </div>

      {choice === CUSTOM && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {THEME_COLOR_FIELDS.map(({ field, label }) => (
            <label key={field} className="text-xs text-[#666]">
              {label}
              <span className="mt-1 flex items-center gap-2">
                <input
                  type="color"
                  value={/^#[0-9a-f]{6}$/i.test(colors[field]) ? colors[field] : "#000000"}
                  onChange={(e) => onChange({ ...colors, [field]: e.target.value })}
                  className="h-8 w-10 cursor-pointer rounded border border-[#ddd] bg-white p-0.5"
                />
                <input
                  value={colors[field]}
                  onChange={(e) => onChange({ ...colors, [field]: e.target.value })}
                  className="w-full rounded-md border border-[#ddd] px-2 py-1.5 text-sm font-mono focus:border-brand focus:outline-none"
                />
              </span>
            </label>
          ))}
          {warnings.length > 0 && (
            <ul className="sm:col-span-2 list-disc space-y-1 rounded-md bg-[#fff3cd] px-5 py-2 text-xs text-[#856404]">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
