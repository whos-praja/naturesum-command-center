/**
 * DatePicker — compact branded date picker.
 *
 * Replaces <input type="date"> in the upload modal so the cutoff field
 * uses the same DM Sans / cream-and-green palette as the rest of the
 * dashboard instead of the OS's stock blue-square calendar.
 *
 *   <DatePicker value={iso}        // "yyyy-mm-dd"
 *               onChange={fn}       // (iso) => void
 *               minDate={iso?}
 *               maxDate={iso?}
 *               placeholder={str?}
 *               width={number?} />
 */
import { useState, useEffect, useRef } from "react";
import { Icon } from "./Shared.jsx";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DOW = ["S","M","T","W","T","F","S"];

const pad2 = (n) => String(n).padStart(2, "0");
const toISO = (d) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
const fromISO = (s) => {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
};
const fmtDisplay = (s) => {
  const d = fromISO(s);
  if (!d) return "";
  return `${pad2(d.getDate())} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
};
const isSameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function DatePicker({ value, onChange, minDate, maxDate, placeholder = "Pick a date", width = 160 }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => fromISO(value) || new Date());
  const rootRef = useRef(null);

  // Keep the visible month in sync when the parent updates `value`
  useEffect(() => {
    const d = fromISO(value);
    if (d) setView(new Date(d.getFullYear(), d.getMonth(), 1));
  }, [value]);

  // Click-outside + Esc close
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = fromISO(value);
  const today = new Date();
  const min = fromISO(minDate);
  const max = fromISO(maxDate);

  const moveMonth = (delta) => {
    const v = new Date(view);
    v.setMonth(v.getMonth() + delta);
    setView(v);
  };
  const pick = (d) => {
    if (min && d < min) return;
    if (max && d > max) return;
    onChange(toISO(d));
    setOpen(false);
  };
  const pickToday = () => pick(new Date());
  const clear = () => {
    onChange("");
    setOpen(false);
  };

  // Build the 6-row grid for `view`. Always 42 cells so the popover
  // doesn't jump in height between months.
  const grid = (() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const startDow = first.getDay(); // 0 = Sun
    const start = new Date(first);
    start.setDate(start.getDate() - startDow);
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      cells.push(d);
    }
    return cells;
  })();

  return (
    <div className="dp-root" ref={rootRef} style={{ width, position: "relative" }}>
      <button
        type="button"
        className="dp-trigger"
        onClick={() => setOpen((o) => !o)}
        title="Pick a date"
      >
        <Icon name="up" size={11}/>
        <span className={value ? "dp-trigger-val" : "dp-trigger-placeholder"}>
          {value ? fmtDisplay(value) : placeholder}
        </span>
        <span className="dp-trigger-caret"></span>
      </button>

      {open && (
        <div className="dp-popover">
          <div className="dp-head">
            <button type="button" className="dp-nav" onClick={() => moveMonth(-1)} title="Previous month">‹</button>
            <div className="dp-title">
              {MONTHS[view.getMonth()]} {view.getFullYear()}
            </div>
            <button type="button" className="dp-nav" onClick={() => moveMonth(1)} title="Next month">›</button>
          </div>

          <div className="dp-dow">
            {DOW.map((d, i) => <span key={i}>{d}</span>)}
          </div>

          <div className="dp-grid">
            {grid.map((d, i) => {
              const inMonth = d.getMonth() === view.getMonth();
              const isToday = isSameDay(d, today);
              const isSel   = isSameDay(d, selected);
              const isDisabled = (min && d < min) || (max && d > max);
              return (
                <button
                  key={i}
                  type="button"
                  className={
                    "dp-day"
                    + (inMonth     ? "" : " is-out")
                    + (isToday     ? " is-today" : "")
                    + (isSel       ? " is-selected" : "")
                    + (isDisabled  ? " is-disabled" : "")
                  }
                  disabled={isDisabled}
                  onClick={() => pick(d)}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>

          <div className="dp-foot">
            <button type="button" className="dp-foot-action dp-foot-clear" onClick={clear}>Clear</button>
            <button type="button" className="dp-foot-action dp-foot-today" onClick={pickToday}>Today</button>
          </div>
        </div>
      )}
    </div>
  );
}
