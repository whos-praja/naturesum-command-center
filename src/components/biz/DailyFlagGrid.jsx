/**
 * DailyFlagGrid — THE daily founder-sheet table, surpassed (rubric 40 + 16).
 * Date rows × channel columns × Total + a running cumulative + a day-over-day
 * growth column + the day FLAG (Max-7 "beat peak" vs weekday-matched
 * "softening", seasonality-honest). Replaces the founder's manual tracking
 * sheet (rubric 64).
 *
 * Takes dailyFactTable() output { channels, metric, rows, totals, grandTotal }
 * and the dailyFlags() rows keyed by iso (so a colour answers a stated
 * question). Presentation-only, NaN-safe; horizontal scroll never overflows the
 * page (overflowX:auto). Newest-first by default so today is at the top.
 *
 * Props: table, flagsByIso, D (formatter), channels meta via chMeta, metric,
 *   newestFirst (default true), maxRows.
 */
import { D as defaultD, chMeta, pillStyle, flagColor, DeltaChip } from "./ScorecardHelpers.jsx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDay = (iso) => {
  const [, m, d] = String(iso || "").split("-");
  const mi = parseInt(m, 10) - 1;
  return mi >= 0 && mi < 12 && d ? `${parseInt(d, 10)} ${MONTHS[mi]}` : (iso || "—");
};

const FLAG_LEGEND = [
  { flag: "peak", label: "Beat 7-day peak" },
  { flag: "strong", label: "Above weekday avg" },
  { flag: "soft", label: "Softening vs weekday" },
  { flag: "anomaly-low", label: "Broke pattern (2σ↓)" },
  { flag: "anomaly-high", label: "Unusual high (2σ↑)" },
];

export function DailyFlagGrid({ table, flagsByIso = {}, D = defaultD, newestFirst = true, maxRows = 95 }) {
  if (!table || !Array.isArray(table.rows) || table.rows.length === 0) {
    return <div className="muted" style={{ fontSize: 12.5, padding: "16px 4px" }}>No daily data in range.</div>;
  }
  const isUnits = table.metric === "units";
  const fmt = (n) => (!Number.isFinite(Number(n)) ? "—" : isUnits ? Math.round(Number(n)).toLocaleString("en-IN") : (D && D.fmtINR ? D.fmtINR(Number(n)) : Number(n)));
  const chans = table.channels;
  let rows = table.rows.slice(-maxRows);
  if (newestFirst) rows = rows.slice().reverse();

  return (
    <div>
      {/* flag legend (land-cold; rubric 68/80 — not colour-only, labelled) */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 8, fontSize: 10.5 }}>
        {FLAG_LEGEND.map((l) => (
          <span key={l.flag} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: flagColor(l.flag), display: "inline-block" }} />
            <span className="muted">{l.label}</span>
          </span>
        ))}
      </div>
      <div style={{ width: "100%", overflowX: "auto" }}>
        <table className="data-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
          <thead>
            <tr style={{ textAlign: "right", color: "var(--ink-3)", borderBottom: "1px solid var(--border)" }}>
              <th style={{ textAlign: "left", padding: "6px 8px", position: "sticky", left: 0, background: "var(--bg-canvas)" }}>Date</th>
              <th style={{ textAlign: "center", padding: "6px 4px" }}>Day</th>
              {chans.map((ch) => (
                <th key={ch} style={{ padding: "6px 8px" }}>
                  <span className="badge sm" style={{ ...pillStyle(ch), fontSize: 9 }}>{chMeta(ch).short}</span>
                </th>
              ))}
              <th style={{ padding: "6px 8px", fontWeight: 600 }}>Total</th>
              <th style={{ padding: "6px 8px" }}>Δ d/d</th>
              <th style={{ padding: "6px 8px" }}>Cumulative</th>
              <th style={{ textAlign: "center", padding: "6px 6px" }}>Flag</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.iso} style={{ borderBottom: "1px solid var(--border-soft)" }}>
                <td style={{ textAlign: "left", padding: "5px 8px", position: "sticky", left: 0, background: "var(--bg-canvas)", whiteSpace: "nowrap" }}>{fmtDay(r.iso)}</td>
                <td style={{ textAlign: "center", padding: "5px 4px", color: "var(--ink-3)" }}>{r.dowName}</td>
                {chans.map((ch) => (
                  <td key={ch} className="mono" style={{ textAlign: "right", padding: "5px 8px" }}>{r.cells[ch] ? fmt(r.cells[ch]) : <span className="muted">—</span>}</td>
                ))}
                <td className="mono" style={{ textAlign: "right", padding: "5px 8px", fontWeight: 600 }}>{fmt(r.total)}</td>
                <td style={{ textAlign: "right", padding: "5px 8px" }}><DeltaChip frac={r.mom} /></td>
                <td className="mono" style={{ textAlign: "right", padding: "5px 8px", color: "var(--ink-3)" }}>{fmt(r.cumulative)}</td>
                <td style={{ textAlign: "center", padding: "5px 6px" }}>
                  {r.flag && r.flag !== "normal"
                    ? <span title={flagsByIso[r.iso]?.label || r.flag} style={{ width: 10, height: 10, borderRadius: 2, background: flagColor(r.flag), display: "inline-block" }} />
                    : <span className="muted" style={{ fontSize: 10 }}>·</span>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "2px solid var(--border)", fontWeight: 600 }}>
              <td style={{ textAlign: "left", padding: "6px 8px", position: "sticky", left: 0, background: "var(--bg-canvas)" }}>Total</td>
              <td />
              {chans.map((ch) => (
                <td key={ch} className="mono" style={{ textAlign: "right", padding: "6px 8px" }}>{fmt(table.totals[ch])}</td>
              ))}
              <td className="mono" style={{ textAlign: "right", padding: "6px 8px" }}>{fmt(table.grandTotal)}</td>
              <td /><td /><td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
