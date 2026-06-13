/**
 * ActionQueue — the ONE "what to do Monday" list, spanning ALL levers
 * (reorder / delist / reprice / ad-cut / reallocate / de-risk), each ranked by
 * ₹ impact (rubric VIII). Replaces the ad-budget-only prescription list: the
 * founder works this top-down, every row ending in a decision with a number.
 *
 * Takes actionQueue() output:
 *   [{ rank, lever, severity, action, rationale, impactPerMonth, impactKind,
 *      channel?, sku?, basis }].
 *
 * Presentation-only, NaN-safe. Lever pills are colour-coded; severity drives the
 * left rail; impact is right-aligned monospace ₹. No horizontal overflow at 390px
 * (the row is a flex column on narrow widths via wrap).
 *
 * Props: queue, D (formatter), title, max (default 12), onPick(row)?.
 */
import { D as defaultD, inr as defaultInr } from "./ScorecardHelpers.jsx";

const LEVER = {
  "ad-cut": { label: "Ad cut", color: "#E47911" },
  delist: { label: "Delist", color: "var(--critical)" },
  reprice: { label: "Reprice", color: "#2874F0" },
  reallocate: { label: "Reallocate", color: "#7C5CFC" },
  reorder: { label: "Reorder", color: "var(--success)" },
  "de-risk": { label: "De-risk", color: "var(--warning)" },
};
const SEV_RAIL = { critical: "var(--critical)", warn: "var(--warning)", opportunity: "var(--success)" };

export function ActionQueue({ queue, D = defaultD, title = "What to do Monday", max = 12, onPick, period }) {
  const inr = (n) => (D && D.fmtINR ? (Number.isFinite(Number(n)) ? D.fmtINR(Number(n)) : "—") : defaultInr(n));
  if (!Array.isArray(queue) || queue.length === 0) {
    return (
      <div className="card" style={{ padding: "14px 16px" }}>
        <div className="muted" style={{ fontSize: 10.5, letterSpacing: 0.4, textTransform: "uppercase" }}>{title}</div>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>No actions surfaced — the levers are quiet this month. Hold course.</div>
      </div>
    );
  }
  const rows = queue.slice(0, max);
  // lever spread summary (so the founder sees the queue isn't ad-budget-only).
  const counts = queue.reduce((a, r) => ((a[r.lever] = (a[r.lever] || 0) + 1), a), {});

  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 10.5, letterSpacing: 0.4, textTransform: "uppercase" }}>{title}</span>
          {/* VIII-95 — the queue's impacts are computed off the latest COMPLETE month,
              which differs from the page's June-MTD headline. Label the period right
              on the queue header so the founder never holds two periods at once. */}
          {period && (
            <span className="cov-badge cov-agency sm" title="Impacts are computed off the latest COMPLETE month (a partial MTD month would understate monthly ₹). This differs from the page's live-month headline.">
              impacts · {period}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {Object.entries(counts).map(([lev, c]) => (
            <span key={lev} className="cov-badge sm" title={`${c} ${LEVER[lev]?.label || lev} action(s)`}
              style={{ background: (LEVER[lev]?.color || "var(--ink-3)") + "1c", color: LEVER[lev]?.color || "var(--ink-3)", borderColor: (LEVER[lev]?.color || "var(--ink-3)") + "44" }}>
              {LEVER[lev]?.label || lev} {c}
            </span>
          ))}
        </div>
      </div>
      <ol style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "grid", gap: 7 }}>
        {rows.map((r) => {
          const lev = LEVER[r.lever] || { label: r.lever, color: "var(--ink-3)" };
          const clickable = typeof onPick === "function";
          return (
            <li key={r.id || `${r.rank}-${r.action}`}
              onClick={clickable ? () => onPick(r) : undefined}
              style={{
                display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, alignItems: "start",
                padding: "8px 10px", borderRadius: 8, background: "var(--bg-elev, var(--bg-canvas))",
                borderLeft: `3px solid ${SEV_RAIL[r.severity] || "var(--border)"}`,
                cursor: clickable ? "pointer" : "default",
              }}>
              <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)", minWidth: 16, textAlign: "right" }}>{r.rank}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span className="cov-badge sm" style={{ background: lev.color + "1c", color: lev.color, borderColor: lev.color + "44" }}>{lev.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{r.action}</span>
                </div>
                <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.45, marginTop: 2 }}>{r.rationale}</div>
                {/* VII — demand-elasticity caveat on the recoverable-₹ levers
                    (ad-cut / reprice) whose figure assumes demand is held. */}
                {(r.lever === "ad-cut" || r.lever === "reprice") && (
                  <div style={{ fontSize: 10, lineHeight: 1.4, marginTop: 2, color: "#7a6312" }}
                    title="The recoverable ₹ holds volume constant. Cutting ads or raising price usually loses some demand, so the realised gain is lower (and could reverse) if sales fall.">
                    ⚠ assumes no demand loss — true gain lower if sales fall
                  </div>
                )}
              </div>
              <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <div className="mono" style={{ fontSize: 13, fontWeight: 600, color: r.severity === "critical" ? "var(--critical)" : "var(--ink)" }}>{inr(Math.abs(r.impactPerMonth))}</div>
                <div className="muted" style={{ fontSize: 9.5 }}>{r.impactKind || "₹/mo"}</div>
                {/* VIII — when one ad-cut decision carries two framings (full spend
                    recoverable vs loss-to-breakeven), show the breakeven figure as a
                    sub-line so the single row carries both numbers. */}
                {Number.isFinite(Number(r.impactToBreakeven)) && (
                  <div className="muted" style={{ fontSize: 9.5, marginTop: 1 }} title="Two framings of ONE ad-cut decision: full ad spend recoverable (above) vs the loss-to-breakeven portion (here).">
                    {inr(Math.abs(r.impactToBreakeven))} to b/e
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {queue.length > max && <div className="muted" style={{ fontSize: 10.5, marginTop: 8 }}>+{queue.length - max} more lower-impact actions</div>}
    </div>
  );
}
