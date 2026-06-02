/**
 * FormulaIcon — small ⓘ next to a number on the dashboard. Click opens
 * a popover showing the formula in plain English + the math expression
 * + (optionally) an edit affordance for either a global tunable
 * parameter or a per-SKU override.
 *
 *   <FormulaIcon formulaId="velocity" />
 *   <FormulaIcon formulaId="runway" paramKey="amberRunwayDays" />
 *   <FormulaIcon formulaId="velocity" skuCode="NSSBJ500" skuField="velocity" />
 *
 * Props:
 *   formulaId — id from FORMULA_REFERENCE (look up via getFormula)
 *   paramKey  — optional, makes a global tunable param editable in the popover
 *   skuCode + skuField — optional, makes a per-SKU override editable
 *   currentValue — optional, the actual displayed value (shown in the popover)
 *   valueLabel   — optional, label for the current value (default "Current")
 */
import { useState, useEffect, useRef } from "react";
import {
  getFormula,
  FORMULA_PARAMS,
  SKU_OVERRIDE_FIELDS,
  readParam, writeParam, resetParam,
  readOverride, writeOverride, clearOverride,
} from "../lib/formulaParams.js";

export function FormulaIcon({ formulaId, paramKey, skuCode, skuField, currentValue, valueLabel = "Current" }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const wrapRef = useRef(null);
  const popoverRef = useRef(null);

  // Compute viewport-aware position so the popover never spills off-
  // screen — anchor below the icon, clamp horizontally to a 16px gutter.
  useEffect(() => {
    if (!open || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const popoverW = 360;
    const popoverHEst = 380;                            // rough — refined after first paint
    const gutter = 16;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Default: align popover's left edge with icon's left edge, just below.
    let left = rect.left;
    // If that pushes the right edge off-screen, shift left.
    if (left + popoverW > vw - gutter) left = vw - popoverW - gutter;
    // If still off-screen left, clamp to gutter.
    if (left < gutter) left = gutter;
    // Default: below the icon. If that pushes past viewport bottom, flip above.
    let top = rect.bottom + 6;
    if (top + popoverHEst > vh - gutter) top = Math.max(gutter, rect.top - popoverHEst - 6);
    setPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      if (popoverRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const formula = getFormula(formulaId);
  const paramDef = paramKey ? FORMULA_PARAMS[paramKey] : null;
  const skuFieldDef = skuField ? SKU_OVERRIDE_FIELDS[skuField] : null;

  return (
    <span className="formula-icon-wrap" ref={wrapRef}>
      <button
        type="button"
        className="formula-icon"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        title="See how this number is calculated"
        aria-label="Show formula"
      >
        ⓘ
      </button>
      {open && (
        <div
          ref={popoverRef}
          className="formula-popover"
          style={{ top: pos.top, left: pos.left }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {formula ? (
            <>
              <div className="formula-popover-head">
                <div className="formula-popover-title">{formula.name}</div>
                <button type="button" className="formula-popover-close" onClick={() => setOpen(false)} aria-label="Close">×</button>
              </div>
              <div className="formula-popover-section">
                <div className="formula-popover-label">Formula</div>
                <code className="formula-popover-expr">{formula.expression}</code>
              </div>
              <div className="formula-popover-section">
                <div className="formula-popover-label">In plain English</div>
                <div className="formula-popover-plain">{formula.plain}</div>
              </div>
              {currentValue != null && (
                <div className="formula-popover-section">
                  <div className="formula-popover-label">{valueLabel}</div>
                  <div className="formula-popover-current mono">{String(currentValue)}</div>
                </div>
              )}
              {paramDef && <GlobalParamEditor paramKey={paramKey} def={paramDef}/>}
              {skuFieldDef && skuCode && <SkuOverrideEditor code={skuCode} field={skuField} def={skuFieldDef}/>}
              <div className="formula-popover-where muted">
                Lives in <code>{formula.where}</code>
              </div>
            </>
          ) : (
            <div className="formula-popover-section muted">No formula found for "{formulaId}".</div>
          )}
        </div>
      )}
    </span>
  );
}

function GlobalParamEditor({ paramKey, def }) {
  const stored = readParam(paramKey);
  const [draft, setDraft] = useState(String(stored));
  const [saved, setSaved] = useState(false);
  const isDefault = stored === def.default;

  const handleSave = () => {
    writeParam(paramKey, draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  const handleReset = () => {
    resetParam(paramKey);
    setDraft(String(def.default));
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="formula-popover-section formula-popover-edit">
      <div className="formula-popover-label">
        Edit global parameter
        {!isDefault && <span className="formula-popover-modified">· modified</span>}
      </div>
      <div className="muted" style={{ fontSize: 10.5, marginBottom: 6 }}>
        {def.description}
      </div>
      <div className="formula-popover-edit-row">
        <input
          type="number"
          className="sim-number"
          min={def.min} max={def.max} step={def.step || 1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{ width: 80 }}
        />
        <span className="muted" style={{ fontSize: 10.5 }}>{def.unit}</span>
        <button className="btn primary sm" onClick={handleSave} disabled={parseFloat(draft) === stored}>Save</button>
        {!isDefault && <button className="btn ghost sm" onClick={handleReset}>Reset</button>}
        {saved && <span className="formula-popover-saved">Saved</span>}
      </div>
    </div>
  );
}

function SkuOverrideEditor({ code, field, def }) {
  const stored = readOverride(code, field);
  const [draft, setDraft] = useState(stored == null ? "" : String(stored));
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    if (draft === "") clearOverride(code, field);
    else writeOverride(code, field, draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  const handleClear = () => {
    clearOverride(code, field);
    setDraft("");
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="formula-popover-section formula-popover-edit">
      <div className="formula-popover-label">
        Override for {code}
        {stored != null && <span className="formula-popover-modified">· set</span>}
      </div>
      <div className="muted" style={{ fontSize: 10.5, marginBottom: 6 }}>
        Force-set this SKU's {def.label.toLowerCase()}. Bypasses the derived value. Blank to clear. Reload the page to apply across the dashboard.
      </div>
      <div className="formula-popover-edit-row">
        <input
          type="number"
          className="sim-number"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="(use derived)"
          style={{ width: 90 }}
        />
        <span className="muted" style={{ fontSize: 10.5 }}>{def.unit}</span>
        <button className="btn primary sm" onClick={handleSave}>Save</button>
        {stored != null && <button className="btn ghost sm" onClick={handleClear}>Clear</button>}
        {saved && <span className="formula-popover-saved">Saved · reload to apply</span>}
      </div>
    </div>
  );
}
