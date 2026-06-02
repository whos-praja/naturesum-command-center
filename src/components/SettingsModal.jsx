/**
 * SettingsModal — replaces the old Formulas sub-tab.
 *
 * Opened from the ⚙ gear icon in the Inventory page header. Three
 * sections:
 *   1. Tunable parameters — 5 global knobs (amber threshold, OOS-soon
 *      window, default target days, velocity floor, forecast horizon).
 *      Edits write to localStorage and prompt for a reload.
 *   2. Reset all — wipes every formula param + per-SKU override.
 *   3. Formula reference — collapsible, shows every derived number's
 *      formula in plain English. Mostly redundant given the inline ⓘ
 *      icons, but useful as a flat reference for new teammates.
 *
 * Per-SKU overrides UI was removed: the Simulator tab is the better
 * what-if tool, and the per-icon ⓘ popovers still let you override one
 * field at a time from the actual cell.
 */
import { useEffect, useState } from "react";
import {
  FORMULA_PARAMS,
  FORMULA_REFERENCE,
  readParam, writeParam, resetParam,
  resetAllParams,
} from "../lib/formulaParams.js";

export default function SettingsModal({ onClose }) {
  const [tick, setTick] = useState(0);
  const [refOpen, setRefOpen] = useState(false);
  const bump = () => setTick((n) => n + 1);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleResetAll = () => {
    if (window.confirm("Reset every formula parameter AND every per-SKU override back to defaults? This can't be undone.")) {
      resetAllParams();
      window.location.reload();
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal-card" onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(620px, 92vw)" }}>
        <div className="modal-head">
          <div>
            <div className="modal-title">Inventory settings</div>
            <div className="modal-sub muted">Global knobs that retune every formula on the dashboard.</div>
          </div>
          <button className="btn ghost icon" onClick={onClose} title="Close (Esc)">✕</button>
        </div>

        <div className="modal-body">
          {/* Tunable parameters */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {Object.entries(FORMULA_PARAMS).map(([key, def]) => (
              <ParamRow key={`${key}-${tick}`} paramKey={key} def={def} onChange={bump}/>
            ))}
          </div>

          {/* Formula reference — collapsed by default */}
          <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 14 }}>
            <button
              className="btn ghost sm"
              onClick={() => setRefOpen(o => !o)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px" }}
            >
              <span style={{ fontSize: 11 }}>{refOpen ? "▾" : "▸"}</span>
              <span>Formula reference{refOpen ? "" : ` (${FORMULA_REFERENCE.length} formulas)`}</span>
            </button>
            {refOpen && (
              <div style={{ marginTop: 10, border: "1px solid var(--border-soft)", borderRadius: 8, overflow: "hidden" }}>
                <table className="table" style={{ tableLayout: "fixed", width: "100%", margin: 0 }}>
                  <thead>
                    <tr>
                      <th style={{ width: "26%", fontSize: 10.5 }}>Number</th>
                      <th style={{ width: "44%", fontSize: 10.5 }}>Expression</th>
                      <th style={{ width: "30%", fontSize: 10.5 }}>Plain English</th>
                    </tr>
                  </thead>
                  <tbody>
                    {FORMULA_REFERENCE.map((f, i) => (
                      <tr key={i}>
                        <td style={{ verticalAlign: "top", fontSize: 11.5 }}><strong>{f.name}</strong></td>
                        <td style={{ verticalAlign: "top" }}>
                          <code style={{ fontSize: 10.5, fontFamily: "var(--mono)", color: "var(--ink-2)", whiteSpace: "pre-wrap", wordBreak: "break-word", display: "block" }}>{f.expression}</code>
                        </td>
                        <td style={{ fontSize: 10.5, color: "var(--ink-3)", verticalAlign: "top" }}>{f.plain}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn ghost sm" onClick={handleResetAll}>Reset all to defaults</button>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function ParamRow({ paramKey, def, onChange }) {
  const stored = readParam(paramKey);
  const isDefault = stored === def.default;
  const [draft, setDraft] = useState(String(stored));

  const handleSave = () => {
    writeParam(paramKey, draft);
    onChange();
    // Param changes take effect at next render (consumers read at render-time),
    // so no reload prompt needed for these — unlike per-SKU overrides which
    // are read at module init.
  };
  const handleReset = () => {
    resetParam(paramKey);
    setDraft(String(def.default));
    onChange();
  };

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr auto",
      gap: 16,
      padding: "10px 12px",
      background: "var(--bg-canvas)",
      border: `1px solid ${isDefault ? "var(--border-soft)" : "rgba(47,94,71,0.32)"}`,
      borderRadius: 8,
      alignItems: "center",
    }}>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>
          {def.label}
          {!isDefault && (
            <span style={{ marginLeft: 8, fontSize: 9.5, padding: "1px 5px", borderRadius: 3, background: "var(--brand-soft)", color: "var(--brand-deep)", fontWeight: 700, letterSpacing: "0.04em" }}>
              MODIFIED
            </span>
          )}
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 2, lineHeight: 1.4 }}>
          {def.description}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <input
          type="number"
          className="sim-number"
          min={def.min}
          max={def.max}
          step={def.step || 1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{ width: 72, fontSize: 12 }}
        />
        <span className="muted" style={{ fontSize: 10.5 }}>{def.unit}</span>
        <button
          className="btn primary sm"
          onClick={handleSave}
          disabled={parseFloat(draft) === stored}
        >
          Save
        </button>
        {!isDefault && (
          <button className="btn ghost sm" onClick={handleReset} title={`Reset to default ${def.default}`}>Reset</button>
        )}
      </div>
    </div>
  );
}
