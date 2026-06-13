/**
 * BridgeChart — a waterfall/bridge chart for decomposition (rubric 50). Renders
 * a starting total, a sequence of signed steps (each floating from the running
 * balance), and an ending total. Honest axes (zero baseline shown), red for
 * negative steps, green for positive, neutral for the end caps.
 *
 * Takes the output of revenueBridge() / cm3Bridge():
 *   { from, to, delta, steps:[{ label, value, kind }], reconciles }
 * Presentation-only; NaN-safe (non-finite steps skipped).
 *
 * Props: bridge, D (currency formatter, defaults NSData), title, height.
 */
import { D as defaultD, inr as defaultInr } from "./ScorecardHelpers.jsx";

export function BridgeChart({ bridge, D = defaultD, title, height = 240 }) {
  if (!bridge || !Array.isArray(bridge.steps)) {
    return <div className="muted" style={{ fontSize: 12.5, padding: "16px 4px" }}>No bridge data.</div>;
  }
  const inr = (n) => (D && D.fmtINR ? (Number.isFinite(Number(n)) ? D.fmtINR(Number(n)) : "—") : defaultInr(n));
  const from = Number(bridge.from) || 0;
  const steps = bridge.steps.filter((s) => Number.isFinite(Number(s.value)));
  const to = Number(bridge.to) || 0;

  // Build the bar set: start cap, each step (floating), end cap.
  const bars = [];
  let running = from;
  bars.push({ label: "Start", base: 0, top: from, value: from, kind: "cap" });
  for (const s of steps) {
    const v = Number(s.value);
    const base = v >= 0 ? running : running + v;
    const top = v >= 0 ? running + v : running;
    bars.push({ label: s.label, base, top, value: v, kind: s.kind, sign: v >= 0 ? "pos" : "neg" });
    running += v;
  }
  bars.push({ label: "End", base: 0, top: to, value: to, kind: "cap" });

  // Scale: min/max across all bar extents (include 0 baseline).
  const allVals = bars.flatMap((b) => [b.base, b.top]).concat([0]);
  const lo = Math.min(...allVals), hi = Math.max(...allVals);
  const range = hi - lo || 1;
  const w = 720, padL = 8, padR = 8, padT = 14, padB = 46;
  const innerW = w - padL - padR, innerH = height - padT - padB;
  const n = bars.length;
  const slot = innerW / n;
  const bw = slot * 0.62;
  const yOf = (v) => padT + innerH - ((v - lo) / range) * innerH;
  const zeroY = yOf(0);

  const color = (b) => b.kind === "cap" ? "var(--brand)" : b.sign === "pos" ? "var(--success)" : "var(--critical)";

  return (
    <div>
      {title && <div className="muted" style={{ fontSize: 11.5, marginBottom: 4 }}>{title}</div>}
      <div style={{ width: "100%", overflowX: "auto" }}>
        <svg width="100%" viewBox={`0 0 ${w} ${height}`} style={{ display: "block", minWidth: 480 }} role="img" aria-label="bridge chart">
          {/* zero baseline */}
          <line x1={padL} y1={zeroY} x2={w - padR} y2={zeroY} stroke="var(--border)" strokeWidth="1" />
          {bars.map((b, i) => {
            const x = padL + i * slot + (slot - bw) / 2;
            const y = Math.min(yOf(b.base), yOf(b.top));
            const h = Math.max(2, Math.abs(yOf(b.top) - yOf(b.base)));
            const labelAbove = (b.value >= 0);
            return (
              <g key={i}>
                {/* connector to previous running balance (steps only) */}
                {i > 0 && i < n && b.kind !== "cap" && (
                  <line x1={padL + (i - 1) * slot + slot / 2 + bw / 2} y1={yOf(b.kind === "cap" ? b.top : (b.value >= 0 ? b.base : b.top))}
                        x2={x} y2={yOf(b.value >= 0 ? b.base : b.top)} stroke="var(--border-soft)" strokeWidth="1" strokeDasharray="2 2" />
                )}
                <rect x={x} y={y} width={bw} height={h} fill={color(b)} opacity={b.kind === "cap" ? 0.9 : 0.8} rx="2" />
                <text x={x + bw / 2} y={labelAbove ? y - 4 : y + h + 11} fontSize="9.5" textAnchor="middle"
                      fill="var(--ink-2)" fontFamily="var(--mono)">{inr(b.value)}</text>
                <text x={x + bw / 2} y={height - 28} fontSize="9" textAnchor="middle" fill="var(--ink-3)">
                  {String(b.label).length > 16 ? String(b.label).slice(0, 15) + "…" : b.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="muted" style={{ fontSize: 10.5, marginTop: 2 }}>
        {bridge.fromMonth} → {bridge.toMonth} · Δ {inr(bridge.delta)}
        {bridge.reconciles ? " · steps reconcile to Δ ✓" : " · ⚠ steps do not fully reconcile"}
      </div>
    </div>
  );
}
