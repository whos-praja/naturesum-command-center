/**
 * ForecastChart — forward revenue/units/CONTRIBUTION at channel/SKU/company grain
 * with the STATED method and an uncertainty BAND (rubric VII-52). Renders the
 * trailing history as a solid line and the forecast points as a dashed line with
 * a shaded ±band ribbon, honest zero-baseline axis. The method + confidence ride
 * under the chart so a forecast is never a black-box number.
 *
 * Takes forecast() output:
 *   { grain, channel, sku, method, asOfMonth, confidence, note, cm3MarginPct,
 *     trailing:{…}, history:[{ month, netRev, units, cm3 }],
 *     forecast:[{ month, netRev, netRevLow, netRevHigh, units, cm3, partial }] }.
 *
 * `metric` ∈ "netRev" | "cm3" | "units" selects the series drawn. Presentation-
 * only, NaN-safe (non-finite points skipped); SVG scales to container width.
 *
 * Props: fc, D (formatter), metric (default "netRev"), title, height.
 */
import { D as defaultD, inr as defaultInr, pct1 } from "./ScorecardHelpers.jsx";

const CONF_COLOR = { medium: "var(--success)", low: "var(--warning)", "very-low": "var(--critical)", none: "var(--ink-3)" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtMonth = (ym) => { const [y, m] = String(ym || "").split("-"); const mi = parseInt(m, 10) - 1; return mi >= 0 && mi < 12 ? `${MONTHS[mi]} ’${String(y).slice(2)}` : (ym || "—"); };

export function ForecastChart({ fc, D = defaultD, metric = "netRev", title, height = 240 }) {
  if (!fc || !Array.isArray(fc.forecast) || (!fc.history?.length && !fc.forecast.length)) {
    return <div className="muted" style={{ fontSize: 12.5, padding: "16px 4px" }}>No forecast data.</div>;
  }
  const isUnits = metric === "units";
  const inr = (n) => (D && D.fmtINR ? (Number.isFinite(Number(n)) ? D.fmtINR(Number(n)) : "—") : defaultInr(n));
  const fmt = (n) => (!Number.isFinite(Number(n)) ? "—" : isUnits ? Math.round(Number(n)).toLocaleString("en-IN") : inr(n));
  const lowK = metric === "cm3" ? "cm3Low" : "netRevLow";
  const highK = metric === "cm3" ? "cm3High" : "netRevHigh";

  // Build the joined series: history points then forecast points.
  const hist = (fc.history || []).map((h) => ({ month: h.month, v: Number(h[metric]), kind: "hist" }))
    .filter((p) => Number.isFinite(p.v));
  const fut = (fc.forecast || []).map((p) => ({
    month: p.month, v: Number(p[metric]),
    lo: Number.isFinite(Number(p[lowK])) ? Number(p[lowK]) : Number(p[metric]),
    hi: Number.isFinite(Number(p[highK])) ? Number(p[highK]) : Number(p[metric]),
    partial: p.partial, kind: "fc",
  })).filter((p) => Number.isFinite(p.v));
  const all = [...hist, ...fut];
  if (!all.length) return <div className="muted" style={{ fontSize: 12.5, padding: 12 }}>No finite points to plot.</div>;

  const w = 720, padL = 8, padR = 8, padT = 14, padB = 38;
  const innerW = w - padL - padR, innerH = height - padT - padB;
  const vals = all.flatMap((p) => [p.v, p.lo, p.hi].filter(Number.isFinite));
  const lo = Math.min(0, ...vals), hi = Math.max(...vals, 1);
  const range = hi - lo || 1;
  const n = all.length;
  const xOf = (i) => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yOf = (v) => padT + innerH - ((v - lo) / range) * innerH;
  const zeroY = yOf(0);

  const histPath = hist.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(p.v).toFixed(1)}`).join(" ");
  const joinIdx = hist.length - 1;
  const fcPath = fut.map((p, j) => `${j === 0 ? "M" : "L"}${xOf(joinIdx + 1 + j).toFixed(1)},${yOf(p.v).toFixed(1)}`).join(" ");
  // connector from last hist to first forecast.
  const connector = hist.length && fut.length ? `M${xOf(joinIdx)},${yOf(hist[hist.length - 1].v)} L${xOf(joinIdx + 1)},${yOf(fut[0].v)}` : "";
  // band ribbon over forecast points.
  const bandPts = fut.map((p, j) => ({ x: xOf(joinIdx + 1 + j), lo: yOf(p.lo), hi: yOf(p.hi) }));
  const bandPath = bandPts.length
    ? `M${bandPts.map((b) => `${b.x.toFixed(1)},${b.hi.toFixed(1)}`).join(" L")} L${bandPts.slice().reverse().map((b) => `${b.x.toFixed(1)},${b.lo.toFixed(1)}`).join(" L")} Z`
    : "";
  const confColor = CONF_COLOR[fc.confidence] || "var(--ink-3)";

  return (
    <div>
      {title && <div className="muted" style={{ fontSize: 11.5, marginBottom: 4 }}>{title}</div>}
      <div style={{ width: "100%", overflowX: "auto" }}>
        <svg width="100%" viewBox={`0 0 ${w} ${height}`} style={{ display: "block", minWidth: 360 }} role="img" aria-label="forecast chart with uncertainty band">
          <line x1={padL} y1={zeroY} x2={w - padR} y2={zeroY} stroke="var(--border)" strokeWidth="1" />
          {bandPath && <path d={bandPath} fill={confColor} opacity="0.13" />}
          {connector && <path d={connector} fill="none" stroke={confColor} strokeWidth="1.5" strokeDasharray="4 3" opacity="0.7" />}
          {histPath && <path d={histPath} fill="none" stroke="var(--brand)" strokeWidth="2" />}
          {fcPath && <path d={fcPath} fill="none" stroke={confColor} strokeWidth="2" strokeDasharray="4 3" />}
          {/* points */}
          {hist.map((p, i) => <circle key={`h${i}`} cx={xOf(i)} cy={yOf(p.v)} r="2.6" fill="var(--brand)" />)}
          {fut.map((p, j) => <circle key={`f${j}`} cx={xOf(joinIdx + 1 + j)} cy={yOf(p.v)} r="3" fill={confColor} stroke="var(--bg-canvas)" strokeWidth="1" />)}
          {/* x labels (sparse) */}
          {all.map((p, i) => (i === 0 || i === n - 1 || i === joinIdx || i === joinIdx + 1)
            ? <text key={`x${i}`} x={xOf(i)} y={height - 22} fontSize="9" textAnchor="middle" fill="var(--ink-3)">{fmtMonth(p.month)}</text>
            : null)}
          {/* forecast value labels */}
          {fut.map((p, j) => <text key={`l${j}`} x={xOf(joinIdx + 1 + j)} y={yOf(p.v) - 7} fontSize="9" textAnchor="middle" fill={confColor} fontFamily="var(--mono)">{fmt(p.v)}{p.partial ? "*" : ""}</text>)}
        </svg>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 4 }}>
        <span className="cov-badge sm" style={{ background: confColor + "22", color: confColor, borderColor: confColor + "55" }}>
          {fc.confidence} confidence
        </span>
        {fut[0]?.partial && <span className="muted" style={{ fontSize: 10 }}>* current month completed via month-end pace</span>}
        {Number.isFinite(fc.cm3MarginPct) && metric !== "cm3" && <span className="muted" style={{ fontSize: 10 }}>held CM3 margin {pct1(fc.cm3MarginPct)}</span>}
      </div>
      <div className="muted" style={{ fontSize: 10.5, marginTop: 4, lineHeight: 1.45 }}>
        Method: {fc.method}
      </div>
      {fc.note && <div style={{ fontSize: 10.5, marginTop: 3, color: "var(--warning)", lineHeight: 1.4 }}>⚠ {fc.note}</div>}
    </div>
  );
}
