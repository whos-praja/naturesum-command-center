/**
 * FormulasTab — Inventory sub-tab listing every formula on the dashboard
 * + edit buttons for the tunable parameters and per-SKU overrides.
 *
 * Two sections:
 *   1. Tunable parameters — global knobs (5 today)
 *   2. Read-only reference — every derived number's formula in plain
 *      English + the math expression
 *   3. Per-SKU overrides — table where a user can force-set any SKU's
 *      velocity / growth / lead time / etc. for what-if analysis
 *
 * Edits persist in localStorage (per-device). A "Reload" link prompts
 * the user to refresh — most edits take effect at the next render
 * (because consumers read the param at render time), but a couple
 * require a reload to re-init data.js.
 */
import { useState } from "react";
import NSData from "../../data.js";
import {
  FORMULA_PARAMS,
  SKU_OVERRIDE_FIELDS,
  FORMULA_REFERENCE,
  readParam, writeParam, resetParam,
  readOverride, writeOverride, clearOverride,
  resetAllParams,
} from "../../lib/formulaParams.js";

export default function FormulasTab() {
  const D = NSData;
  const [tick, setTick] = useState(0);
  const bump = () => setTick((n) => n + 1);

  const handleResetAll = () => {
    if (window.confirm("Reset every formula parameter AND every per-SKU override back to defaults? This can't be undone.")) {
      resetAllParams();
      window.location.reload();
    }
  };

  // Per-SKU overrides are read by data.js AT MODULE INIT. Editing one
  // mid-session writes to localStorage but doesn't retroactively rerun
  // data.js. Show a reload nudge whenever the user edits an override.
  const handleOverrideChanged = () => {
    bump();
    // Defer the prompt so the input has time to commit before the modal.
    setTimeout(() => {
      if (window.confirm("Override saved. Reload now so the dashboard picks it up?")) {
        window.location.reload();
      }
    }, 50);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header strip with reset + reload help */}
      <div style={{
        padding: "12px 14px",
        background: "var(--bg-canvas)",
        border: "1px solid var(--border-soft)",
        borderRadius: 8,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
      }}>
        <div style={{ fontSize: 12.5, color: "var(--ink-2)", maxWidth: 720 }}>
          Edit any parameter below to retune the dashboard. Changes persist locally on this device. Most take effect on the next render; a few need a page reload (noted per-row). Use Reset all to wipe every customisation.
        </div>
        <button className="btn ghost sm" onClick={handleResetAll}>Reset all</button>
      </div>

      {/* SECTION 1 — Tunable parameters */}
      <section>
        <div className="card-head" style={{ padding: "0 4px 8px" }}>
          <div>
            <div className="title">Tunable parameters</div>
            <div className="sub">Global constants that drive multiple calculations. Edit any to retune the whole dashboard.</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {Object.entries(FORMULA_PARAMS).map(([key, def]) => (
            <ParamRow key={key} paramKey={key} def={def} onChange={bump}/>
          ))}
        </div>
      </section>

      {/* SECTION 2 — Read-only formula reference */}
      <section>
        <div className="card-head" style={{ padding: "0 4px 8px" }}>
          <div>
            <div className="title">Formula reference</div>
            <div className="sub">Every derived number on the dashboard, in plain English + the math expression. Not editable here — these define the shape of the calculation.</div>
          </div>
        </div>
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table className="table" style={{ tableLayout: "fixed", width: "100%" }}>
            <thead>
              <tr>
                <th style={{ width: "20%" }}>Number</th>
                <th style={{ width: "32%" }}>Expression</th>
                <th style={{ width: "30%" }}>Plain English</th>
                <th style={{ width: "18%" }}>Where</th>
              </tr>
            </thead>
            <tbody>
              {FORMULA_REFERENCE.map((f, i) => (
                <tr key={i}>
                  <td style={{ verticalAlign: "top" }}><strong style={{ fontSize: 12.5 }}>{f.name}</strong></td>
                  <td style={{ verticalAlign: "top" }}>
                    <code style={{
                      fontSize: 11, fontFamily: "var(--mono)", color: "var(--ink-2)",
                      whiteSpace: "pre-wrap", wordBreak: "break-word", display: "block",
                    }}>{f.expression}</code>
                  </td>
                  <td style={{ fontSize: 11.5, color: "var(--ink-3)", verticalAlign: "top" }}>{f.plain}</td>
                  <td style={{ fontSize: 10.5, color: "var(--ink-4)", verticalAlign: "top", wordBreak: "break-all" }}><code>{f.where}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* SECTION 3 — Per-SKU overrides */}
      <section>
        <div className="card-head" style={{ padding: "0 4px 8px" }}>
          <div>
            <div className="title">Per-SKU overrides</div>
            <div className="sub">Force-set any value for a single SKU — bypasses the derived/uploaded number. Useful for what-if scenarios. Click any cell to edit; empty input clears the override.</div>
          </div>
        </div>
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table className="table" style={{ minWidth: 920 }}>
            <thead>
              <tr>
                <th style={{ width: 160, minWidth: 160 }}>SKU</th>
                {Object.entries(SKU_OVERRIDE_FIELDS).map(([field, meta]) => (
                  <th key={field} className="num" style={{ fontSize: 10.5, minWidth: 90 }}>
                    {meta.label}<br/>
                    <span style={{ fontWeight: 400, color: "var(--ink-4)" }}>{meta.unit}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {D.inventory.map((s) => (
                <OverrideRow key={s.code} sku={s} onChange={handleOverrideChanged}/>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ── Single global-parameter row ──────────────────────────────
function ParamRow({ paramKey, def, onChange }) {
  const stored = readParam(paramKey);
  const isDefault = stored === def.default;
  const [draft, setDraft] = useState(String(stored));

  const handleSave = () => {
    writeParam(paramKey, draft);
    onChange();
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
      padding: "12px 14px",
      background: "var(--bg-canvas)",
      border: `1px solid ${isDefault ? "var(--border-soft)" : "rgba(47,94,71,0.32)"}`,
      borderRadius: 8,
      alignItems: "center",
    }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
          {def.label}
          {!isDefault && (
            <span style={{ marginLeft: 8, fontSize: 10, padding: "1px 5px", borderRadius: 3, background: "var(--brand-soft)", color: "var(--brand-deep)", fontWeight: 700, letterSpacing: "0.04em" }}>
              MODIFIED
            </span>
          )}
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
          {def.description}
        </div>
        <div className="muted" style={{ fontSize: 10.5, marginTop: 3 }}>
          Affects: {def.affects.join(" · ")}
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
          style={{ width: 80, fontSize: 12 }}
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

// ── Per-SKU override row ─────────────────────────────────────
function OverrideRow({ sku, onChange }) {
  const [, force] = useState(0);
  const bump = () => { force((n) => n + 1); onChange(); };

  return (
    <tr>
      <td>
        <div style={{ fontSize: 12.5, fontWeight: 500 }}>{sku.name}</div>
        <div className="sku" style={{ fontSize: 10.5 }}>{sku.code} · {sku.variant}</div>
      </td>
      {Object.entries(SKU_OVERRIDE_FIELDS).map(([field, meta]) => (
        <OverrideCell key={field} code={sku.code} field={field} meta={meta} onChange={bump}/>
      ))}
    </tr>
  );
}

function OverrideCell({ code, field, meta, onChange }) {
  const stored = readOverride(code, field);
  const [draft, setDraft] = useState(stored == null ? "" : String(stored));
  const [editing, setEditing] = useState(false);

  const commit = () => {
    if (draft === "") clearOverride(code, field);
    else writeOverride(code, field, draft);
    setEditing(false);
    onChange();
  };
  const cancel = () => {
    setDraft(stored == null ? "" : String(stored));
    setEditing(false);
  };

  return (
    <td className="num" style={{ padding: "6px 10px" }}>
      {editing ? (
        <input
          type="number"
          className="sim-number"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") cancel();
          }}
          style={{ width: 70, fontSize: 11.5, textAlign: "right" }}
          placeholder="—"
        />
      ) : (
        <span
          onClick={() => setEditing(true)}
          style={{
            cursor: "pointer",
            color: stored == null ? "var(--ink-5)" : "var(--brand-deep)",
            fontFamily: "var(--mono)",
            fontWeight: stored == null ? 400 : 600,
            fontSize: 11.5,
            padding: "2px 6px",
            borderRadius: 4,
            background: stored == null ? "transparent" : "var(--brand-soft)",
            display: "inline-block",
            minWidth: 44,
          }}
          title={stored == null ? "Click to set an override" : "Click to edit · clear input to remove"}
        >
          {stored == null ? "—" : stored}
        </span>
      )}
    </td>
  );
}
