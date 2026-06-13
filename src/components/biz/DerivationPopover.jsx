/**
 * DerivationPopover — the inventory FormulaIcon ⓘ craft, generalised for the
 * business pages (rubric 35/36, the named CRAFT FLOOR). A small ⓘ that, on
 * click, reveals: the FORMULA, the ACTUAL inputs that produced THIS value, the
 * SOURCE, and the AS-OF date — depth one click away, surface stays clean.
 *
 * Reuses the existing .formula-icon / .formula-popover CSS (same look as the
 * inventory module) and the same single-open-at-a-time broadcast, so business
 * derivations behave identically to inventory ones (rubric 72, consistency).
 *
 * Props:
 *   title    — popover heading (e.g. "CM3 · Amazon · May")
 *   formula  — the expression string (e.g. "netRev − COGS − fees − ads")
 *   plain    — optional plain-English line
 *   inputs   — [{ label, value }] the ACTUAL numbers that produced this value
 *   value    — optional displayed value (echoed in the popover)
 *   source   — optional source label
 *   asOf     — optional as-of date/label
 *   note     — optional caveat (assumption / approx flag)
 */
import { useState, useEffect, useRef, useId } from "react";

const POPOVER_EVENT = "ns-formula-popover-opened";

export function DerivationPopover({ title, formula, plain, inputs = [], value, source, asOf, note }) {
  const instanceId = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const wrapRef = useRef(null);
  const popoverRef = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (e.detail?.id !== instanceId) setOpen(false); };
    window.addEventListener(POPOVER_EVENT, handler);
    return () => window.removeEventListener(POPOVER_EVENT, handler);
  }, [instanceId]);

  useEffect(() => {
    if (open) window.dispatchEvent(new CustomEvent(POPOVER_EVENT, { detail: { id: instanceId } }));
  }, [open, instanceId]);

  useEffect(() => {
    if (!open || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const popoverW = 360, popoverHEst = 320, gutter = 16;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = rect.left;
    if (left + popoverW > vw - gutter) left = vw - popoverW - gutter;
    if (left < gutter) left = gutter;
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
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <span className="formula-icon-wrap" ref={wrapRef}>
      <button
        type="button"
        className={"formula-icon" + (open ? " is-active" : "")}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        title="See how this number is derived"
        aria-label="Show derivation"
        aria-expanded={open}
      >ⓘ</button>
      {open && (
        <div
          ref={popoverRef}
          className="formula-popover"
          style={{ top: pos.top, left: pos.left }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="formula-popover-head">
            <div className="formula-popover-title">{title}</div>
            <button type="button" className="formula-popover-close" onClick={() => setOpen(false)} aria-label="Close">×</button>
          </div>
          {formula && (
            <div className="formula-popover-section">
              <div className="formula-popover-label">Formula</div>
              <code className="formula-popover-expr">{formula}</code>
            </div>
          )}
          {plain && (
            <div className="formula-popover-section">
              <div className="formula-popover-label">In plain English</div>
              <div className="formula-popover-plain">{plain}</div>
            </div>
          )}
          {inputs.length > 0 && (
            <div className="formula-popover-section">
              <div className="formula-popover-label">Actual inputs</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "3px 12px", fontSize: 11.5 }}>
                {inputs.map((row, i) => (
                  <span key={i} style={{ display: "contents" }}>
                    <span className="muted">{row.label}</span>
                    <span className="mono text-right">{row.value}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {value != null && (
            <div className="formula-popover-section">
              <div className="formula-popover-label">This value</div>
              <div className="formula-popover-current mono">{String(value)}</div>
            </div>
          )}
          {note && (
            <div className="formula-popover-section">
              <div className="formula-popover-plain" style={{ color: "var(--warning)" }}>{note}</div>
            </div>
          )}
          {(source || asOf) && (
            <div className="formula-popover-where muted">
              {source && <>Source: <code>{source}</code></>}{source && asOf ? " · " : ""}{asOf && <>as of {asOf}</>}
            </div>
          )}
        </div>
      )}
    </span>
  );
}
