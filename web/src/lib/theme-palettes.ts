/** Ready-made colour palettes for App Settings: each sets the five theme
 * colours together (main, header-gradient light, button-hover dark, and the
 * contrasting "My Assigned List" pair), so a ministry picks one set that is
 * known to work instead of five separate colours. The Servants QR colour is
 * not part of a palette. Every main/dark/assigned colour passes 4.5:1 with
 * white text; the two "light" shades only end a large bold header's
 * gradient (3:1 is enough there). Navy and Forest are SAY's and TST's
 * colours as they were before palettes existed. */

export type ThemeColors = {
  theme_color: string;
  theme_color_light: string;
  theme_color_dark: string;
  my_assigned_header_color: string;
  my_assigned_header_color_light: string;
};

export type ThemePalette = { id: string; name: string; colors: ThemeColors };

function palette(id: string, name: string, c: [string, string, string, string, string]): ThemePalette {
  return {
    id,
    name,
    colors: {
      theme_color: c[0],
      theme_color_light: c[1],
      theme_color_dark: c[2],
      my_assigned_header_color: c[3],
      my_assigned_header_color_light: c[4],
    },
  };
}

export const THEME_PALETTES: ThemePalette[] = [
  palette("navy", "Navy", ["#1e3a5f", "#2d5a7b", "#152a45", "#c2185b", "#d81b60"]),
  palette("forest", "Forest", ["#2e7d32", "#43a047", "#1b5e20", "#c2185b", "#d81b60"]),
  palette("burgundy", "Burgundy", ["#7b1f3a", "#9c2f4f", "#5a1429", "#00796b", "#00897b"]),
  palette("royal-purple", "Royal purple", ["#4a2c7a", "#6a4396", "#331d57", "#bf360c", "#d84315"]),
  palette("slate", "Slate", ["#37474f", "#546e7a", "#263238", "#bf360c", "#e64a19"]),
  palette("rust", "Rust", ["#a0401a", "#c1572b", "#7a2e10", "#1565c0", "#1e88e5"]),
  palette("olive", "Olive", ["#556b2f", "#6b8e23", "#3e4f22", "#6a1b9a", "#8e24aa"]),
  palette("indigo", "Indigo", ["#283593", "#3949ab", "#1a237e", "#c62828", "#e53935"]),
  palette("plum", "Plum", ["#880e4f", "#ad1457", "#5c0a35", "#2e7d32", "#388e3c"]),
  palette("coffee", "Coffee", ["#5d4037", "#795548", "#3e2723", "#1565c0", "#1e88e5"]),
];

export const THEME_COLOR_FIELDS: { field: keyof ThemeColors; label: string }[] = [
  { field: "theme_color", label: "Main (headers, buttons, headings)" },
  { field: "theme_color_light", label: "Light (header gradient end)" },
  { field: "theme_color_dark", label: "Dark (button hover)" },
  { field: "my_assigned_header_color", label: "“My Assigned List” header" },
  { field: "my_assigned_header_color_light", label: "“My Assigned List”, light (gradient end)" },
];

/** The palette whose five colours all match, or null (= custom colours). */
export function matchPalette(colors: ThemeColors): ThemePalette | null {
  return (
    THEME_PALETTES.find((p) =>
      THEME_COLOR_FIELDS.every(({ field }) => p.colors[field].toLowerCase() === (colors[field] ?? "").toLowerCase()),
    ) ?? null
  );
}

function channels(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** WCAG contrast ratio of white text on this colour, or null if not a #rrggbb colour. */
export function whiteTextContrast(hex: string): number | null {
  const c = channels(hex);
  if (!c) return null;
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
}

function hue(hex: string): number | null {
  const c = channels(hex);
  if (!c) return null;
  const [r, g, b] = c;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return null;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** Plain-language problems with a custom set of colours (empty = fine). */
export function customColorWarnings(colors: ThemeColors): string[] {
  const warnings: string[] = [];
  for (const { field, label } of THEME_COLOR_FIELDS) {
    const ratio = whiteTextContrast(colors[field]);
    if (ratio === null) {
      warnings.push(`${label}: enter a colour like #1e3a5f.`);
      continue;
    }
    const min = field.endsWith("_light") ? 3 : 4.5;
    if (ratio < min) warnings.push(`${label}: white text will be hard to read on this colour.`);
  }
  const main = hue(colors.theme_color);
  const assigned = hue(colors.my_assigned_header_color);
  if (main !== null && assigned !== null) {
    const gap = Math.min(Math.abs(main - assigned), 360 - Math.abs(main - assigned));
    if (gap < 90) warnings.push("The “My Assigned List” colour is close to the main colour; pick one that stands out.");
  }
  return warnings;
}
