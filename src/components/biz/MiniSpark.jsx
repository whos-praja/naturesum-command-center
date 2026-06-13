/**
 * MiniSpark — tiny inline sparkline. Promoted from PageSales (was duplicated)
 * to the shared biz set so all three pages render the same spark.
 * Presentation-only; NaN-safe (filters non-finite, needs ≥2 points).
 */
export function MiniSpark({ data, w = 110, h = 26, color = "var(--brand)" }) {
  const clean = Array.isArray(data) ? data.filter((v) => Number.isFinite(v)) : [];
  if (clean.length < 2) return <span className="muted" style={{ fontSize: 11 }}>—</span>;
  const min = Math.min(...clean), max = Math.max(...clean);
  const r = max - min || 1;
  const step = w / (clean.length - 1);
  const pts = clean.map((v, i) => [i * step, h - 3 - ((v - min) / r) * (h - 6)]);
  const path = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block" }} role="img" aria-label="trend sparkline">
      <path d={path} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2" fill={color} />
    </svg>
  );
}
