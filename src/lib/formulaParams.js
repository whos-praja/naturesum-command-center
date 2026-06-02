/**
 * formulaParams.js
 *
 * Central store for tunable formula parameters + per-SKU calculation
 * overrides. Drives the Inventory → Formulas sub-tab.
 *
 * Storage model (all localStorage, per-device):
 *   ns.formula.<key>          = string number  (global parameter)
 *   ns.skuOverride.<code>.<f> = string number  (per-SKU override)
 *
 * Defaults live here too — when nothing is stored, helpers return the
 * default. Users who don't touch a param see the same behavior as
 * pre-tuning.
 */

// ─── Global tunable parameters ───────────────────────────────
// Each entry is one knob exposed in the Formulas sub-tab. Keep this
// list aligned with the UI's <ParamRow/> components.
export const FORMULA_PARAMS = {
  amberRunwayDays: {
    label: "Runway → amber threshold",
    description: "Days of runway below which a SKU's status flips from green to amber. Red kicks in when runway ≤ supplier lead time.",
    unit: "days",
    default: 30,
    min: 7,
    max: 180,
    affects: ["runwayStatus chip on every Inventory row", "Action-needed flag in Runway tab"],
  },
  blkOosSoonDays: {
    label: "Blinkit OOS-soon window",
    description: "Days within which a feeder WH must be projected to run out at its per-WH velocity to count as amber (the amber/lifetime stat). Doesn't affect the absolute-stock amber threshold (that's per-SKU).",
    unit: "days",
    default: 14,
    min: 3,
    max: 60,
    affects: ["Blinkit cell amber count", "Blinkit drill modal classification"],
  },
  defaultTargetDays: {
    label: "Default desired stock cover",
    description: "Days of cover used in the Forecast tab's reorder-qty formula. Can be overridden per-SKU from the SkuBreakdownModal. This is the global fallback.",
    unit: "days",
    default: 30,
    min: 7,
    max: 180,
    affects: ["Forecast tab reorder qty", "SkuBreakdownModal target cover editor default"],
  },
  velocityFloor: {
    label: "Min velocity to show runway pill",
    description: "Below this velocity, the runway pill is hidden (would otherwise display a huge number from dividing stock by a near-zero value). 0.05 ≈ \"would round to 0.0/d on display\".",
    unit: "units/day",
    default: 0.05,
    min: 0,
    max: 1,
    step: 0.01,
    affects: ["PlatformCell, RunwayChannelCell, SkuBreakdownModal channel rows"],
  },
  reorderForecastDays: {
    label: "Forecast window for reorder calc",
    description: "Number of days the Forecast tab projects demand over (before adding the target buffer). The Forecast tab's day-picker overrides this when the user changes it; this is the initial default.",
    unit: "days",
    default: 60,
    min: 7,
    max: 180,
    affects: ["Forecast tab initial period", "Recommended reorder card"],
  },
};

// ─── Per-SKU override fields ─────────────────────────────────
// Each one is a field a user can force-set for a single SKU. When set,
// the override wins over the derived value. Used by the per-SKU
// override table in the Formulas sub-tab.
export const SKU_OVERRIDE_FIELDS = {
  velocity:        { label: "Daily velocity",      unit: "units/day" },
  growth:          { label: "MoM growth",          unit: "%" },
  leadTime:        { label: "Supplier lead time",  unit: "days" },
  whStock:         { label: "Central WH stock",    unit: "units" },
  amazonStock:     { label: "Amazon FBA stock",    unit: "units" },
  flipkartStock:   { label: "Flipkart stock",      unit: "units" },
  blinkitStock:    { label: "Blinkit stock",       unit: "units" },
  targetDays:      { label: "Desired stock cover", unit: "days"  },
};

// ─── Storage helpers ─────────────────────────────────────────
const PARAM_KEY = (k) => `ns.formula.${k}`;
const OVERRIDE_KEY = (code, field) => `ns.skuOverride.${code}.${field}`;

export function readParam(key) {
  const def = FORMULA_PARAMS[key];
  if (!def) return null;
  if (typeof window === "undefined") return def.default;
  const raw = window.localStorage.getItem(PARAM_KEY(key));
  if (raw == null) return def.default;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : def.default;
}

export function writeParam(key, value) {
  if (typeof window === "undefined") return;
  const def = FORMULA_PARAMS[key];
  if (!def) return;
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return;
  const clamped = Math.max(def.min ?? -Infinity, Math.min(def.max ?? Infinity, n));
  window.localStorage.setItem(PARAM_KEY(key), String(clamped));
}

export function resetParam(key) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(PARAM_KEY(key));
}

export function readOverride(code, field) {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(OVERRIDE_KEY(code, field));
  if (raw == null) return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

export function writeOverride(code, field, value) {
  if (typeof window === "undefined") return;
  if (value === "" || value == null) {
    window.localStorage.removeItem(OVERRIDE_KEY(code, field));
    return;
  }
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return;
  window.localStorage.setItem(OVERRIDE_KEY(code, field), String(n));
}

export function clearOverride(code, field) {
  writeOverride(code, field, "");
}

/** Return all overrides for one SKU as { field: value }. */
export function readAllOverrides(code) {
  const out = {};
  for (const field of Object.keys(SKU_OVERRIDE_FIELDS)) {
    const v = readOverride(code, field);
    if (v != null) out[field] = v;
  }
  return out;
}

/** Bulk reset — wipes every formula param + every SKU override. */
export function resetAllParams() {
  if (typeof window === "undefined") return;
  const keys = Object.keys(window.localStorage);
  for (const k of keys) {
    if (k.startsWith("ns.formula.") || k.startsWith("ns.skuOverride.")) {
      window.localStorage.removeItem(k);
    }
  }
}

/** Lookup helper for the inline ⓘ popover. */
export function getFormula(id) {
  return FORMULA_REFERENCE.find(f => f.id === id) || null;
}

// ─── Reference formulas (display-only, not editable) ────────
// Plain-English + math expression for each derived number. Drives the
// "Read-only formula reference" section of the Formulas sub-tab AND the
// inline ⓘ popovers on individual numbers — look up by `id`.
export const FORMULA_REFERENCE = [
  {
    id: "totalStock",
    name: "Total stock per SKU",
    expression: "totalStock = stock.warehouse + stock.amazonFBA + stock.flipkart + stock.blinkit",
    plain: "Sum of central WH stock and the three marketplace stocks. Used as the numerator of the per-row runway and stock value.",
    where: "src/data.js · per-SKU inventory map",
  },
  {
    id: "runway",
    name: "Per-row runway",
    expression: "runway = round(totalStock / sku.velocity)",
    plain: "How many days the SKU's combined stock would last at its current daily sell-through. Hidden if velocity ≤ velocityFloor.",
    where: "src/data.js · runway field",
  },
  {
    id: "runwayStatus",
    name: "Runway status chip",
    expression: "status = vel ≤ 0 → amber | runway ≤ leadTime → red | runway < amberRunwayDays → amber | else green",
    plain: "Tri-state color on every row. Red = will run out before next supply arrives. Amber = below comfort buffer. Green = healthy.",
    where: "src/data.js · runwayStatus",
  },
  {
    id: "velocity",
    name: "Total velocity",
    expression: "sku.velocity = channelVel.amazon + channelVel.flipkart + channelVel.blinkit + whBaseVel",
    plain: "Sum of per-channel daily sell-through plus offline/marketing leftover. Each channel's velocity walks a real-data precedence chain (see MAPPING.md §5).",
    where: "src/data.js · velocity field",
  },
  {
    id: "amazonChannelVel",
    name: "Amazon channel velocity (per AMZ-001)",
    expression: "amazonChannelVel = amazonOrdersDaily + shopifyOrdersDaily",
    plain: "Amazon FBA serves both Amazon orders AND Shopify D2C (Shopify ships from FBA). So the channel velocity combines both demand streams.",
    where: "src/data.js · channelVelocity.amazon",
  },
  {
    id: "growth",
    name: "MoM growth",
    expression: "growth = clamp((cur30 − prev30) / prev30 × 100, −100, +200)",
    plain: "Shopify's last-30-days sales vs the preceding 30 days. Capped at ±200% because some SKUs went from near-zero base → ratio would explode.",
    where: "src/data.js · derivedGrowth",
  },
  {
    id: "producibleFG",
    name: "Producible FG (BOM cap)",
    expression: "producibleFG = min(inputCapacity, min over k of pkgCapacity[k])",
    plain: "The slowest constraint (input or any packaging component) caps how many additional FG packs we could pack today. Each capacity = floor(component qty / units-per-pack).",
    where: "src/data.js · warehouseBreakdown.producibleFG",
  },
  {
    id: "maxFg",
    name: "Total (WH) finished goods",
    expression: "maxFg = currentFG + producibleFG",
    plain: "Upper bound of finished goods we could have in the central warehouse today. Used in Materials breakdown + Forecast reorder qty.",
    where: "src/data.js · warehouseBreakdown · MaterialsTab",
  },
  {
    id: "leadTime",
    name: "SKU supplier lead time",
    expression: "leadTime = max over components of COMPONENT_LEAD_TIMES[refCode]",
    plain: "The slowest input gates the whole pack. Sea Buckthorn powders take 50 days (raw bottleneck); Acacia tea 20 days (filled-sachet SFG); packaging is universally 14 days.",
    where: "src/data.js · maxLeadTimeForSku()",
  },
  {
    id: "required",
    name: "Required units (Forecast tab)",
    expression: "required = sku.velocity × (forecastDays + targetDays) × trend",
    plain: "Units needed to cover the forecast horizon plus the per-SKU target buffer. targetDays defaults to defaultTargetDays but can be overridden per-SKU.",
    where: "src/pages/PageInventory.jsx · ForecastTab",
  },
  {
    id: "reorder",
    name: "Recommended reorder qty",
    expression: "reorder = max(0, required − maxFg)",
    plain: "How many MORE units we need to order on top of what we already have or could produce. Goes to zero when we're already covered.",
    where: "src/pages/PageInventory.jsx · ForecastTab",
  },
  {
    id: "stockValue",
    name: "Stock value",
    expression: "stockValue = totalStock × SKU_PRICING.sp",
    plain: "Total units × selling price. Used for the headline ₹L total at the top of Inventory.",
    where: "src/data.js · stockValue",
  },
  {
    id: "cascadeRunway",
    name: "Cascade runway (Runway calculator)",
    expression: "Parallel cascade — each channel drains at its own velocity, WH absorbs each channel's demand as it dies, total = day WH itself hits zero.",
    plain: "More realistic than the simple `totalStock / velocity` formula because marketplaces don't drain at the central rate — they drain at their own rate, and only after they empty does WH face the full demand.",
    where: "src/lib/runwayCascade.js · computeCascade()",
  },
  {
    id: "blkClass",
    name: "Blinkit feeder-WH classification",
    expression: "red = stock ≤ 0 | amber = (vel > 0 AND stock/vel ≤ blkOosSoonDays) OR stock ≤ amberThreshold",
    plain: "Per-feeder-WH status. Amber threshold is per-SKU (set from Blinkit drill modal); the OOS-soon window is global (tunable as blkOosSoonDays).",
    where: "src/pages/PageInventory.jsx · blkFeederStats()",
  },
];
