/**
 * LtvCohort — repeat / LTV curve for Shopify + Amazon (rubric VI-46), with the
 * new-vs-returning AOV gap, the returning-revenue share trend, and an EXPLICIT
 * "not derivable from source" deferral for Flipkart + Blinkit (rubric param 89 —
 * a visible deferral, never a silent omission).
 *
 * Takes ltvCohort() output:
 *   { shopify:{ quarters:[…], latest, trendRepeatPct }, amazon:{ quarters:[…], latest },
 *     deferrals:[{ channel, reason }], asOf, sourceLabel }.
 *
 * Presentation-only, NaN-safe; the repeat-rate sparkline scales to width.
 *
 * Props: ltv, D (formatter), title.
 */
import { D as defaultD, inr as defaultInr, pct1, pctSigned } from "./ScorecardHelpers.jsx";

function Spark({ vals, color = "var(--brand)", height = 30 }) {
  const pts = (vals || []).filter((v) => Number.isFinite(v));
  if (pts.length < 2) return null;
  const w = 120, lo = Math.min(...pts), hi = Math.max(...pts), range = hi - lo || 1;
  const xOf = (i) => (i / (pts.length - 1)) * w;
  const yOf = (v) => height - ((v - lo) / range) * (height - 4) - 2;
  const d = pts.map((v, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} style={{ display: "block" }} role="img" aria-label="trend sparkline">
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" />
      <circle cx={xOf(pts.length - 1)} cy={yOf(pts[pts.length - 1])} r="2.4" fill={color} />
    </svg>
  );
}

export function LtvCohort({ ltv, D = defaultD, title = "Retention & LTV" }) {
  const inr = (n) => (D && D.fmtINR ? (Number.isFinite(Number(n)) ? D.fmtINR(Number(n)) : "—") : defaultInr(n));
  if (!ltv) return null;
  const sq = ltv.shopify?.quarters || [];
  const latest = ltv.shopify?.latest || null;
  const aq = ltv.amazon?.quarters || [];

  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div className="muted" style={{ fontSize: 10.5, letterSpacing: 0.4, textTransform: "uppercase" }}>{title}</div>
        {ltv.sourceLabel && <span className="cov-badge cov-agency sm">{ltv.sourceLabel}</span>}
      </div>

      {/* Shopify headline: repeat rate trend + AOV gap. */}
      {latest && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 18, marginTop: 12, alignItems: "center" }}>
          <div>
            <div className="muted" style={{ fontSize: 10 }}>Shopify repeat rate ({latest.quarter})</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 22, fontWeight: 600 }}>{pct1(latest.repeatPct)}</span>
              {Number.isFinite(ltv.shopify.trendRepeatPct) && (
                <span className="delta up" style={{ color: ltv.shopify.trendRepeatPct >= 0 ? "var(--success)" : "var(--critical)" }}>
                  {ltv.shopify.trendRepeatPct >= 0 ? "▲" : "▼"} {pctSigned(ltv.shopify.trendRepeatPct)} pts since {sq[0]?.quarter}
                </span>
              )}
            </div>
            <Spark vals={sq.map((q) => q.repeatPct)} color="var(--success)" />
          </div>
          <div>
            <div className="muted" style={{ fontSize: 10 }}>New vs returning AOV</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span className="mono" style={{ fontSize: 15 }}>{inr(latest.newAOV)}</span>
              <span className="muted" style={{ fontSize: 11 }}>→</span>
              <span className="mono" style={{ fontSize: 15, color: "var(--success)" }}>{inr(latest.returningAOV)}</span>
            </div>
            <div className="muted" style={{ fontSize: 10.5, marginTop: 2 }}>
              returning customers spend {pct1(latest.aovGapPct)} more per order ({inr(latest.aovGap)} premium)
            </div>
          </div>
          {Number.isFinite(latest.ltvIndex) && (
            <div>
              <div className="muted" style={{ fontSize: 10 }}>LTV index</div>
              <span style={{ fontSize: 22, fontWeight: 600 }}>{latest.ltvIndex.toFixed(2)}×</span>
              <div className="muted" style={{ fontSize: 10 }}>returning ₹/order ÷ new ₹/order</div>
            </div>
          )}
        </div>
      )}

      {/* Shopify quarter table. */}
      {sq.length > 0 && (
        <div style={{ width: "100%", overflowX: "auto", marginTop: 12 }}>
          <table className="data-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
            <thead>
              <tr style={{ textAlign: "right", color: "var(--ink-3)", borderBottom: "1px solid var(--border)" }}>
                <th style={{ textAlign: "left", padding: "5px 8px" }}>Quarter (Shopify)</th>
                <th style={{ padding: "5px 8px" }}>New</th>
                <th style={{ padding: "5px 8px" }}>Returning</th>
                <th style={{ padding: "5px 8px" }}>Repeat %</th>
                <th style={{ padding: "5px 8px" }}>Returning rev %</th>
                <th style={{ padding: "5px 8px" }}>New AOV</th>
                <th style={{ padding: "5px 8px" }}>Ret. AOV</th>
              </tr>
            </thead>
            <tbody>
              {sq.map((q) => (
                <tr key={q.quarter} style={{ borderBottom: "1px solid var(--border-soft)" }}>
                  <td style={{ textAlign: "left", padding: "5px 8px" }}>{q.quarter}</td>
                  <td className="mono" style={{ textAlign: "right", padding: "5px 8px" }}>{Number.isFinite(q.newCustomers) ? q.newCustomers.toLocaleString("en-IN") : "—"}</td>
                  <td className="mono" style={{ textAlign: "right", padding: "5px 8px" }}>{Number.isFinite(q.returningCustomers) ? q.returningCustomers.toLocaleString("en-IN") : "—"}</td>
                  <td className="mono" style={{ textAlign: "right", padding: "5px 8px" }}>{pct1(q.repeatPct)}</td>
                  <td className="mono" style={{ textAlign: "right", padding: "5px 8px" }}>{pct1(q.returningSalesPct)}</td>
                  <td className="mono" style={{ textAlign: "right", padding: "5px 8px" }}>{inr(q.newAOV)}</td>
                  <td className="mono" style={{ textAlign: "right", padding: "5px 8px", color: "var(--success)" }}>{inr(q.returningAOV)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Amazon repeat share. */}
      {aq.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="muted" style={{ fontSize: 10.5 }}>Amazon repeat share (from agency Repeats sheet)</div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 4 }}>
            {aq.map((q) => (
              <span key={q.quarter} style={{ fontSize: 11.5 }}>
                <span className="muted">{q.quarter}:</span> <span className="mono">{pct1(q.repeatShare)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Param-89 deferrals — explicit, never a silent omission. */}
      {(ltv.deferrals || []).length > 0 && (
        <div style={{ marginTop: 12, padding: "8px 10px", borderRadius: 8, background: "var(--bg-canvas)", border: "1px dashed var(--border)" }}>
          <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.3 }}>Not derivable from source</div>
          {ltv.deferrals.map((d) => (
            <div key={d.channel} className="muted" style={{ fontSize: 11, lineHeight: 1.45, marginTop: 4 }}>
              <strong style={{ textTransform: "capitalize" }}>{d.channel}:</strong> {d.reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
