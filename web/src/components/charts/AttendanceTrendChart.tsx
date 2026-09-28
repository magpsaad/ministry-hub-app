/**
 * REQUIREMENTS.md §8.1 -- Phase H item 5, "small data visualizations."
 * Replaces the Analytics tab's Average Attendance by Month horizontal-bar
 * list with an actual trend line -- the bar list is fine for comparing one
 * month to another, but a line is what actually reads as "trending up/down
 * over time," which is what this section is for.
 *
 * `data` must be in chronological order (oldest first, left to right) --
 * the opposite of the bar list it replaces, which is sorted newest-first.
 * Hand-drawn SVG (no charting library), and every value is a static label
 * on the chart itself rather than something you have to hover to see --
 * consistent with the rest of the app's zero-dependency approach, and
 * deliberately not hover-dependent since hover doesn't reliably exist on
 * the touch devices this app runs on. Wrapped in a horizontally-scrolling
 * container by the caller for groups with a long attendance history.
 */
export function AttendanceTrendChart({
  data,
}: {
  data: { month: string; label: string; avgPercent: number }[];
}) {
  if (data.length === 0) return null;

  const pointSpacing = 56;
  const leftPad = 34;
  const rightPad = 20;
  const topPad = 26;
  const bottomPad = 34;
  const plotHeight = 140;
  const width = leftPad + rightPad + Math.max(1, data.length - 1) * pointSpacing + (data.length === 1 ? pointSpacing : 0);
  const height = topPad + plotHeight + bottomPad;

  const x = (i: number) => leftPad + i * pointSpacing;
  const y = (pct: number) => topPad + plotHeight - (Math.min(100, Math.max(0, pct)) / 100) * plotHeight;

  const linePath = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(d.avgPercent)}`).join(" ");
  const areaPath = `${linePath} L${x(data.length - 1)},${topPad + plotHeight} L${x(0)},${topPad + plotHeight} Z`;

  // Thin out month labels once there are more than 12 -- always keep the
  // first and last so the visible range is unambiguous.
  const labelEvery = data.length > 12 ? Math.ceil(data.length / 12) : 1;
  const showValueLabels = data.length <= 12;

  // Abbreviated month label, e.g. "Jan '25" -- distinguishes years without
  // needing the full "January 2025" the bar-list version uses (there's no
  // room for that here). Hand-formatted rather than toLocaleDateString(),
  // whose *unspecified*-locale form resolves against the runtime's default
  // locale -- that can differ between Node (SSR) and the browser (hydration),
  // which caused a real hydration mismatch when this was tried with Intl.
  const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const shortLabel = (month: string) => {
    const [year, m] = month.split("-").map(Number);
    return `${MONTH_ABBR[m - 1]} '${String(year).slice(2)}`;
  };

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label="Average attendance by month, trend line">
      {[0, 50, 100].map((pct) => (
        <g key={pct}>
          <line x1={leftPad} y1={y(pct)} x2={width - rightPad} y2={y(pct)} stroke="#eee" strokeWidth={1} />
          <text x={leftPad - 8} y={y(pct)} textAnchor="end" dominantBaseline="central" style={{ fill: "#999", fontSize: 9 }}>
            {pct}%
          </text>
        </g>
      ))}

      <path d={areaPath} style={{ fill: "var(--brand)" }} fillOpacity={0.08} stroke="none" />
      <path d={linePath} fill="none" style={{ stroke: "var(--brand)" }} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

      {data.map((d, i) => (
        <g key={d.month}>
          <circle cx={x(i)} cy={y(d.avgPercent)} r={3.5} style={{ fill: "var(--brand)" }}>
            {/* A single template-literal string, not multiple JSX expression
                children -- an SVG <title> with several {expr} children
                hydrated with a mismatch in testing (React/Next.js seems to
                normalize the text-node split differently server vs client
                for this element specifically); one string child sidesteps it. */}
            <title>{`${d.label}: ${d.avgPercent}%`}</title>
          </circle>
          {showValueLabels && (
            <text x={x(i)} y={y(d.avgPercent) - 10} textAnchor="middle" style={{ fill: "var(--brand)", fontSize: 10, fontWeight: 700 }}>
              {d.avgPercent}%
            </text>
          )}
          {i % labelEvery === 0 || i === data.length - 1 ? (
            <text x={x(i)} y={topPad + plotHeight + 18} textAnchor="middle" style={{ fill: "#666", fontSize: 9 }}>
              {shortLabel(d.month)}
            </text>
          ) : null}
        </g>
      ))}
    </svg>
  );
}
