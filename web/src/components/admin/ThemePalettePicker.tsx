"use client";

import { useState } from "react";
import {
  THEME_COLOR_FIELDS,
  THEME_PALETTES,
  customColorWarnings,
  matchPalette,
  type ThemeColors,
} from "@/lib/theme-palettes";

const CUSTOM = "custom";

/** App Settings colour palette: one dropdown instead of five colour fields.
 * Picking a palette writes its five colours into the form (saved with the
 * rest of App Labels & Branding); "Custom" keeps the current colours and
 * shows the five fields to edit, with readability warnings. */
export function ThemePalettePicker({
  colors,
  onChange,
}: {
  colors: ThemeColors;
  onChange: (colors: ThemeColors) => void;
}) {
  const [choice, setChoice] = useState<string>(() => matchPalette(colors)?.id ?? CUSTOM);
  const warnings = choice === CUSTOM ? customColorWarnings(colors) : [];

  function handleSelect(id: string) {
    setChoice(id);
    const palette = THEME_PALETTES.find((p) => p.id === id);
    if (palette) onChange({ ...palette.colors });
  }

  const band = THEME_COLOR_FIELDS.map(({ field }) => colors[field]);

  return (
    <div className="sm:col-span-2 rounded-md border border-[#eee] p-3 space-y-3">
      <label className="block text-xs text-[#666]">
        Colour palette
        <select
          value={choice}
          onChange={(e) => handleSelect(e.target.value)}
          className="mt-1 w-full rounded-md border border-[#ddd] px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
        >
          {THEME_PALETTES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value={CUSTOM}>Custom</option>
        </select>
      </label>

      <div>
        <div className="flex h-7 overflow-hidden rounded-md" aria-hidden="true">
          {band.map((c, i) => (
            <div key={i} className="flex-1" style={{ background: c }} />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-white">
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
        <p className="mt-2 text-[11px] text-[#999]">Preview. The colours apply across the app when you save.</p>
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
