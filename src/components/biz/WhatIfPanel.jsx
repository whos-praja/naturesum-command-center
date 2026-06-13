/**
 * WhatIfPanel — the economics simulator (rubric 54). Four levers (price, COGS,
 * fees, ad spend) drive a live re-run of computeWhatIf(); the panel shows the
 * base→scenario CM1/2/3 and the per-channel CM3 delta. The Simulator pattern,
 * for unit economics.
 *
 * Stays presentational by taking the COMPUTE FUNCTION as a prop (`compute`) —
 * the page passes a closure bound to its facts/month/costs, so this component
 * has no engine import and is trivially testable. NaN-safe display.
 *
 * Props:
 *   compute(levers) → computeWhatIf() result   (required)
 *   channelLabel(ch) → display name            (optional; defaults to ch)
 *   D — formatter (defaults NSData)
 *   month — label for the header
 */
import { useState, useMemo } from "react";
import { D as defaultD } from "./ScorecardHelpers.jsx";

const LEVERS = [
  { key: "pricePct", label: "Price", min: -30, max: 30, step: 1, unit: "%", scale: 0.01 },
  { key: "cogsPct", label: "COGS", min: -30, max: 30, step: 1, unit: "%", scale: 0.01 },
  { key: "feePctAbs", label: "Platform fee", min: -10, max: 10, step: 0.5, unit: "pts", scale: 0.01 },
  { key: "adPct", label: "Ad spend", min: -50, max: 50, step: 5, unit: "%", scale: 0.01 },
];

export function WhatIfPanel({ compute, channelLabel = (c) => c, D = defaultD, month }) {
  const [raw, setRaw] = useState({ pricePct: 0, cogsPct: 0, feePctAbs: 0, adPct: 0 });
  const inr = (n) => (D && D.fmtINR ? (Number.isFinite(Number(n)) ? D.fmtINR(Number(n)) : "—") : String(n));

  const levers = useMemo(() => {
    const out = {};
    for (const L of LEVERS) out[L.key] = (Number(raw[L.key]) || 0) * L.scale;
    return out;
  }, [raw]);

  const result = useMemo(() => {
    try { return compute(levers); } catch { return null; }
  }, [compute, levers]);

  const dirty = LEVERS.some((L) => Number(raw[L.key]) !== 0);
  const reset = () => setRaw({ pricePct: 0, cogsPct: 0, feePctAbs: 0, adPct: 0 });

  if (!result) return <div className="muted" style={{ fontSize: 12.5, padding: 12 }}>No data to simulate for this month.</div>;
  const { base, scenario, delta, byChannel = [] } = result;
  const cmRow = (label, b, s, d) => (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: "4px 14px", alignItems: "baseline", fontSize: 12.5, padding: "3px 0" }}>
      <span className="muted">{label}</span>
      <span className="mono text-right">{inr(b)}</span>
      <span className="mono text-right" style={{ fontWeight: 600 }}>{inr(s)}</span>
      <span className="mono text-right" style={{ color: d > 0 ? "var(--success)" : d < 0 ? "var(--critical)" : "var(--ink-3)" }}>
        {d > 0 ? "+" : ""}{inr(d)}
      </span>
    </div>
  );

  return (
    <div>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>
        Drag a lever to see the contribution-margin impact across {month}. Pure margin mechanics — demand elasticity is not modelled.
      </div>
      {/* VII — demand-elasticity caveat, sharpened when a demand-loss-prone lever
          (price up, or ad cut) is active so a positive Δ isn't read as riskless. */}
      {(Number(raw.pricePct) > 0 || Number(raw.adPct) < 0) && (
        <div role="note" style={{ fontSize: 10.5, lineHeight: 1.45, marginBottom: 10, padding: "6px 9px", borderRadius: 6, background: "rgba(201,162,39,0.08)", border: "1px solid rgba(201,162,39,0.3)", color: "#7a6312" }}>
          ⚠ Volume held constant. {Number(raw.pricePct) > 0 ? "A price rise " : "An ad cut "}
          typically loses some demand — the true CM3 gain is <strong>lower</strong> than shown if units fall, and could turn negative if the drop is large. Treat the Δ as an upper bound.
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 14 }}>
        {LEVERS.map((L) => (
          <div key={L.key}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
              <span>{L.label}</span>
              <span className="mono" style={{ color: Number(raw[L.key]) !== 0 ? "var(--brand)" : "var(--ink-3)" }}>
                {Number(raw[L.key]) > 0 ? "+" : ""}{raw[L.key]}{L.unit}
              </span>
            </div>
            <input
              type="range" min={L.min} max={L.max} step={L.step} value={raw[L.key]}
              onChange={(e) => setRaw((s) => ({ ...s, [L.key]: Number(e.target.value) }))}
              style={{ width: "100%" }}
              aria-label={`${L.label} lever`}
            />
          </div>
        ))}
      </div>

      <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: "4px 14px", fontSize: 10.5, color: "var(--ink-3)", paddingBottom: 4, borderBottom: "1px solid var(--border-soft)" }}>
          <span>Company</span><span className="text-right">Base</span><span className="text-right">Scenario</span><span className="text-right">Δ</span>
        </div>
        {cmRow("Net revenue", base.netRev, scenario.netRev, delta.netRev)}
        {cmRow("CM1", base.cm1, scenario.cm1, delta.cm1)}
        {cmRow("CM2", base.cm2, scenario.cm2, delta.cm2)}
        {cmRow("CM3", base.cm3, scenario.cm3, delta.cm3)}
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", fontSize: 11.5, paddingTop: 4 }}>
          <span className="muted">CM3 margin</span>
          <span className="mono text-right">{Number.isFinite(scenario.cm3Pct) ? (scenario.cm3Pct * 100).toFixed(1) + "%" : "—"}</span>
        </div>
      </div>

      {byChannel.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="muted" style={{ fontSize: 10.5, marginBottom: 4 }}>CM3 impact by channel</div>
          <div style={{ display: "grid", gap: 4 }}>
            {byChannel.map((c) => (
              <div key={c.ch} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 12, fontSize: 11.5, alignItems: "baseline" }}>
                <span>{channelLabel(c.ch)}</span>
                <span className="mono text-right muted">{inr(c.baseCm3)} → {inr(c.scenCm3)}</span>
                <span className="mono text-right" style={{ color: c.delta > 0 ? "var(--success)" : c.delta < 0 ? "var(--critical)" : "var(--ink-3)" }}>
                  {c.delta > 0 ? "+" : ""}{inr(c.delta)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {dirty && <button className="btn ghost sm" style={{ marginTop: 12 }} onClick={reset}>Reset levers</button>}
    </div>
  );
}
