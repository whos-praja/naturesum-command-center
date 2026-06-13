/**
 * ScorecardHelpers — the SINGLE source of formatting + tone + channel/basis
 * presentation for all three business pages (Sales, Finance, Marketing).
 *
 * Why this exists (rubric IX/72 — consistency): the three pages had each
 * re-declared their own `inr` / `pctStr` / `pctTone` / `cmColor` / channel-pill
 * helpers, which drifts. This module is imported by every biz component AND by
 * the pages so a red is the same red, a CM colour is the same colour, and a
 * channel pill is the same pill everywhere. Presentation-only, NaN-safe.
 *
 * `D` (NSData) is the currency authority — fmtINR rounds + em-dashes NaN, so
 * EVERY rupee on the business pages goes through inr() → D.fmtINR (HARD
 * INVARIANT: never a raw float).
 */
import NSData from "../../data.js";

export const D = NSData;

// ─── Currency / numbers (HARD INVARIANT: all ₹ via D.fmtINR) ────────────────
export const inr = (n) => (Number.isFinite(Number(n)) ? D.fmtINR(Number(n)) : "—");
export const fmtUnits = (n) => (Number.isFinite(Number(n)) ? Math.round(Number(n)).toLocaleString("en-IN") : "—");
// fraction (0..1) → "12.3%"; % always to 1dp; null/NaN → em-dash.
export const pct1 = (frac) => (Number.isFinite(frac) ? `${(frac * 100).toFixed(1)}%` : "—");
// signed pct for deltas → "+12.3%" / "−4.0%".
export const pctSigned = (frac) => {
  if (!Number.isFinite(frac)) return "—";
  const v = frac * 100;
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
};

// ─── Tone (rubric 70 — colour reads at a glance; red = losing/softening) ────
// Returns a CSS var string for inline style color. Higher = better by default.
export function pctTone(frac, { goodAbove = 0, invert = false } = {}) {
  if (!Number.isFinite(frac)) return "var(--ink-3)";
  const good = invert ? frac < goodAbove : frac > goodAbove;
  const bad = invert ? frac > goodAbove : frac < goodAbove;
  return good ? "var(--success)" : bad ? "var(--critical)" : "var(--ink)";
}
// CM ₹ colour: negative = critical red, positive = ink, zero = muted.
export const cmColor = (v) => (v == null || !Number.isFinite(v) ? "var(--ink-3)" : v < 0 ? "var(--critical)" : "var(--ink)");
// Flag colour for daily-flag / anomaly states (matches dailyFlags.flag).
export const FLAG_COLOR = {
  peak: "var(--success)", strong: "var(--success)", normal: "var(--ink-3)",
  soft: "var(--warning)", "anomaly-low": "var(--critical)", "anomaly-high": "var(--info)",
};
export const flagColor = (flag) => FLAG_COLOR[flag] || "var(--ink-3)";

// ─── Channel presentation (presentation-only; channel set is derived upstream) ─
export const CH_META = {
  amazon: { name: "Amazon", short: "AMZ", color: "#E47911" },
  flipkart: { name: "Flipkart", short: "FK", color: "#2874F0" },
  blinkit: { name: "Blinkit", short: "BLK", color: "#F8CB46" },
  website: { name: "Website", short: "WEB", color: "#5E8E3E" },
};
export const chMeta = (ch) => CH_META[ch] || { name: ch, short: String(ch).slice(0, 3).toUpperCase(), color: "#9CA098" };
const ORDER = ["amazon", "flipkart", "blinkit", "website"];
export const chOrder = (a, b) => {
  const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
};
export const pillStyle = (ch) => {
  const c = chMeta(ch).color;
  return { background: c + "22", color: c, borderColor: c + "55" };
};

// ─── Ad / coverage basis pill (rubric 23/28 — attribution confidence) ───────
const BASIS_LABEL = {
  "actual-attributed": { t: "measured", cls: "cov-native", title: "Per-SKU ad attribution (native) — trustworthy" },
  "allocated-share": { t: "allocated", cls: "cov-mtd", title: "Channel total split by revenue share — partly inferred" },
  "agency-total": { t: "agency", cls: "cov-agency", title: "Snell/Monarch channel total — no per-SKU attribution" },
  none: { t: "no ads", cls: "cov-agency", title: "No ad spend known for this window" },
  native: { t: "native", cls: "cov-native", title: "Per-SKU native export" },
  agency: { t: "agency", cls: "cov-agency", title: "Agency (Snell/Monarch) channel-grain" },
};
export function BasisPill({ basis, partial }) {
  const meta = BASIS_LABEL[basis] || { t: basis || "—", cls: "cov-agency", title: "" };
  return (
    <span className={`cov-badge ${meta.cls} sm`} title={meta.title} style={{ marginLeft: 4 }}>
      {meta.t}{partial ? " · MTD" : ""}
    </span>
  );
}

// Small delta chip: arrow + signed % with tone.
export function DeltaChip({ frac, invert = false }) {
  if (!Number.isFinite(frac)) return <span className="delta flat">—</span>;
  const cls = frac > 0 ? (invert ? "down" : "up") : frac < 0 ? (invert ? "up" : "down") : "flat";
  const arrow = frac > 0 ? "▲" : frac < 0 ? "▼" : "■";
  return <span className={`delta ${cls}`}>{arrow} {pctSigned(frac)}</span>;
}
