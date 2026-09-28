/**
 * REQUIREMENTS.md §8.1 -- Phase H item 5, "small data visualizations."
 * Replaces the plain Local/Regional/Abroad/Unknown stat-card grid with a
 * donut chart + legend.
 *
 * Color choice is deliberately its OWN palette, not the Proximity badges'
 * light-background/dark-text pairs used elsewhere (Member List, Attendance
 * tab -- §8's Badges spec): those dark text colors (#0c5460 teal, #856404
 * olive, #721c24 maroon, #383d41 charcoal) all read as similar muted dark
 * tones once used as a FILLED donut segment instead of text on a pale
 * background, and owner-reported them as hard to tell apart at a glance.
 * A donut needs bold, saturated, clearly-distinct fills, which is a
 * different constraint than a legible text/background pair -- so this
 * uses simple, high-contrast primary colors instead (owner's exact choice:
 * green/yellow/red for Local/Regional/Abroad, gray for the catch-all
 * "Unknown" bucket, which isn't a real category).
 *
 * Built as a plain stroke-dasharray donut (no charting library, consistent
 * with the app's zero-dependency, hand-drawn-icon approach) -- simpler and
 * less error-prone than constructing arc `<path>`s by hand. Static <title>
 * tooltips and a legend with the actual counts/percentages sit below the
 * ring, so the numbers are readable without hovering -- important since
 * hover doesn't reliably exist on the touch devices this app runs on.
 */

const SEGMENTS = [
  { key: "Local", color: "#2e7d32" }, // green
  { key: "Regional", color: "#fbc02d" }, // yellow
  { key: "Abroad", color: "#d32f2f" }, // red
  { key: "Unknown", color: "#9e9e9e" }, // gray, a couple shades lighter (owner-requested) -- not a real category
] as const;

export function ProximityDonut({
  local,
  regional,
  abroad,
  unknown,
  centerLabel,
}: {
  local: number;
  regional: number;
  abroad: number;
  unknown: number;
  centerLabel: string;
}) {
  const values = { Local: local, Regional: regional, Abroad: abroad, Unknown: unknown };
  const total = local + regional + abroad + unknown;

  const size = 160;
  const center = size / 2;
  const radius = 60;
  const strokeWidth = 24;
  const circumference = 2 * Math.PI * radius;

  let cumulative = 0;
  const arcs = SEGMENTS.filter((s) => values[s.key] > 0).map((s) => {
    const value = values[s.key];
    const fraction = total > 0 ? value / total : 0;
    const dash = fraction * circumference;
    const offset = -cumulative * circumference;
    cumulative += fraction;
    return { ...s, value, dash, offset, percent: total > 0 ? Math.round((value / total) * 100) : 0 };
  });

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        className="shrink-0"
        role="img"
        aria-label={`Proximity breakdown: ${SEGMENTS.map((s) => `${s.key} ${values[s.key]}`).join(", ")}`}
      >
        {/* Rotate only the ring, not the whole SVG, so the labels below stay
            upright -- avoids needing a counter-rotation hack on the text. */}
        <g transform={`rotate(-90 ${center} ${center})`}>
          {total === 0 ? (
            <circle cx={center} cy={center} r={radius} fill="none" stroke="#e2e3e5" strokeWidth={strokeWidth} />
          ) : (
            arcs.map((a) => (
              <circle
                key={a.key}
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                stroke={a.color}
                strokeWidth={strokeWidth}
                strokeDasharray={`${a.dash} ${circumference - a.dash}`}
                strokeDashoffset={a.offset}
              >
                {/* A single template-literal string, not multiple JSX
                    expression children -- an SVG <title> with several
                    {expr} children hydrated with a mismatch in testing. */}
                <title>{`${a.key}: ${a.value} (${a.percent}%)`}</title>
              </circle>
            ))
          )}
        </g>
        <text
          x={center}
          y={center}
          textAnchor="middle"
          dominantBaseline="central"
          style={{ fill: "var(--brand)", fontWeight: 700, fontSize: total > 999 ? 22 : 28 }}
        >
          {total}
        </text>
        <text
          x={center}
          y={center + 20}
          textAnchor="middle"
          dominantBaseline="central"
          style={{ fill: "#666", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em" }}
        >
          {centerLabel}
        </text>
      </svg>

      <ul className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        {SEGMENTS.map((s) => {
          const value = values[s.key];
          const percent = total > 0 ? Math.round((value / total) * 100) : 0;
          return (
            <li key={s.key} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} aria-hidden="true" />
              <span className="text-[#333]">{s.key}</span>
              <span className="text-[#666]">
                {value} ({percent}%)
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
