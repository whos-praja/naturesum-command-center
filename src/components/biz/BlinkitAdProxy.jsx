/**
 * BlinkitAdProxy — the MODELED Blinkit per-SKU ad attribution with a visible
 * confidence band, clearly labelled MODELED-NOT-MEASURED (rubric III). Blinkit
 * gives no per-SKU ad data (a source gap); rather than omit, we model each SKU's
 * ad as its Blinkit net × the reference channel's measured TCOS, banded ±50%, and
 * (where a real Blinkit channel total exists) rescaled so the split ties to it.
 *
 * Takes blinkitAdProxy() output:
 *   { month, modeled, refChannel, refTcosPct, channelTotal, rescaledToReal,
 *     bySku:[{ code, units, netRev, modeledAd, low, high, modeledAcosPct }],
 *     confidence, note }.
 *
 * The "modeled" status is impossible to miss: a striped banner header, a dashed
 * border, and a per-row ± band. Presentation-only, NaN-safe.
 *
 * Props: proxy, D (formatter), title, max (default 8).
 */
import { D as defaultD, inr as defaultInr, pct1 } from "./ScorecardHelpers.jsx";

export function BlinkitAdProxy({ proxy, D = defaultD, title = "Blinkit ad attribution", max = 8 }) {
  const inr = (n) => (D && D.fmtINR ? (Number.isFinite(Number(n)) ? D.fmtINR(Number(n)) : "—") : defaultInr(n));
  if (!proxy || !Array.isArray(proxy.bySku)) {
    return <div className="muted" style={{ fontSize: 12.5, padding: "16px 4px" }}>No Blinkit data.</div>;
  }
  const rows = proxy.bySku.slice(0, max);

  return (
    <div className="card" style={{ padding: 0, border: "1px dashed var(--warning)", overflow: "hidden" }}>
      {/* MODELED banner — unmissable (rubric III/IV honesty). */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6,
        padding: "8px 14px", background: "repeating-linear-gradient(45deg, var(--warning-bg, rgba(220,160,40,0.10)), var(--warning-bg, rgba(220,160,40,0.10)) 8px, transparent 8px, transparent 16px)",
        borderBottom: "1px dashed var(--warning)",
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
          <div className="muted" style={{ fontSize: 10.5 }}>{proxy.month} · {proxy.bySku.length} SKUs</div>
        </div>
        <span className="cov-badge sm" style={{ background: "var(--warning)", color: "#1a1206", borderColor: "var(--warning)", fontWeight: 600 }}>
          MODELED — NOT MEASURED
        </span>
      </div>

      <div style={{ padding: "10px 14px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 8 }}>
          <div><span className="muted" style={{ fontSize: 10 }}>Reference TCOS ({proxy.refChannel}, measured)</span><div className="mono" style={{ fontSize: 14 }}>{pct1(proxy.refTcosPct)}</div></div>
          <div><span className="muted" style={{ fontSize: 10 }}>Channel ad {proxy.rescaledToReal ? "(real total)" : "(modeled total)"}</span><div className="mono" style={{ fontSize: 14 }}>{inr(proxy.channelTotal)}</div></div>
        </div>

        <div style={{ width: "100%", overflowX: "auto" }}>
          <table className="data-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
            <thead>
              <tr style={{ textAlign: "right", color: "var(--ink-3)", borderBottom: "1px solid var(--border)" }}>
                <th style={{ textAlign: "left", padding: "5px 8px" }}>SKU</th>
                <th style={{ padding: "5px 8px" }}>Blinkit net</th>
                <th style={{ padding: "5px 8px" }}>Modeled ad</th>
                <th style={{ padding: "5px 8px" }}>Band (±50%)</th>
                <th style={{ padding: "5px 8px" }}>Modeled ACOS</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code} style={{ borderBottom: "1px solid var(--border-soft)" }}>
                  <td style={{ textAlign: "left", padding: "5px 8px" }}>{r.code}</td>
                  <td className="mono" style={{ textAlign: "right", padding: "5px 8px" }}>{inr(r.netRev)}</td>
                  <td className="mono" style={{ textAlign: "right", padding: "5px 8px", fontStyle: "italic" }}>~{inr(r.modeledAd)}</td>
                  <td className="mono" style={{ textAlign: "right", padding: "5px 8px", color: "var(--ink-3)", fontSize: 10.5 }}>{inr(r.low)}–{inr(r.high)}</td>
                  <td className="mono" style={{ textAlign: "right", padding: "5px 8px" }}>{pct1(r.modeledAcosPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="muted" style={{ fontSize: 10.5, marginTop: 8, lineHeight: 1.45 }}>{proxy.note}</div>
      </div>
    </div>
  );
}
