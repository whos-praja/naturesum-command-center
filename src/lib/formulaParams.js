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
  // ─── Marketplace drill-modal formulas ──────────────────────────
  {
    id: "amzStockLeft",
    name: "Amazon FBA stock left",
    expression: "stockLeft = Σ byFc.sellable    (across all Amazon FCs)",
    plain: "Total sellable units sitting in Amazon FBA fulfillment centers right now. Damaged / inbound / reserved buckets are NOT included.",
    where: "src/realMarketplaceData.js · amazon.totalSellable",
  },
  {
    id: "amzCombinedRunway",
    name: "Amazon combined runway",
    expression: "runway = totalFbaStock ÷ (amzOrdersDaily + shopifyD2CDaily)",
    plain: "Days until FBA stock pool runs out, given both Amazon orders AND Shopify D2C depleting it (per AMZ-001 fold).",
    where: "src/pages/PageInventory.jsx · AmazonFcModal · combinedRunway",
  },
  {
    id: "amzChannelSplit",
    name: "Channel split — Amazon orders + Shopify D2C",
    expression: "amzChannel = amzOrdersDaily + shopifyD2CDaily\namzOrders = Agency Sheet AMZ tab · sum(SKU col last 30d) ÷ 30\nshopifyD2C = Shopify CSV · filter SKU · sum(Net items sold) last 30d ÷ 30",
    plain: "Per AMZ-001 the Amazon FBA stock pool serves both Amazon-direct orders AND Shopify D2C orders (Shopify ships from FBA). So the channel velocity adds both streams. Each leg reads its own 30d window from its own sheet.",
    where: "src/pages/PageInventory.jsx · AmazonFcModal channel split table",
  },
  {
    id: "channelMomGrowth",
    name: "Per-channel MoM growth",
    expression: "growth = clamp((sales30d − prior30) / prior30 × 100, −100, +200)\n  where prior30 = sales60d − sales30d",
    plain: "Each cell shows ITS OWN channel's MoM. Sources: Amazon → Agency AMZ tab. Shopify → Shopify CSV. Flipkart → FK Seller Hub. Blinkit → Agency Blinkit tab (native lacks 60d). Central WH = aggregate across all channels.",
    where: "src/data.js · channelGrowth",
  },
  {
    id: "fkStockLeft",
    name: "Flipkart listed quantity",
    expression: "stockLeft = real.flipkart.live    (from FK Seller Hub \"Live on Website\")",
    plain: "Units Flipkart shows as available to customers. Physically sits at central WH (gur_san_wh_nl_01nl IS the central WH) — so it's already part of the Central column total, NOT a separate pool.",
    where: "src/realMarketplaceData.js · flipkart.live",
  },
  {
    id: "fkVelocity",
    name: "Flipkart 30d velocity",
    expression: "velocity = real.flipkart.sales30d ÷ 30",
    plain: "Average daily units sold on Flipkart over the last 30 days, from the FK Seller Hub Current Inventory export.",
    where: "src/data.js · channelVelocity.flipkart",
  },
  {
    id: "fkDaysOfCover",
    name: "Flipkart days of cover",
    expression: "days = floor(stockLeft ÷ velocity)",
    plain: "How many days the FK-listed stock would last at current sell-through. Mirrors the runway pill pattern.",
    where: "src/pages/PageInventory.jsx · FlipkartDrillModal · days",
  },
  {
    id: "blkStockLeft",
    name: "Blinkit total feeder-WH stock",
    expression: "stockLeft = Σ byWh.sellable    (across all Blinkit feeder warehouses)",
    plain: "Total sellable units across every Blinkit feeder warehouse this SKU is launched on. Per-WH detail in the drill modal.",
    where: "src/realMarketplaceData.js · blinkit.totalSellable",
  },
  {
    id: "blkPerWhVelocity",
    name: "Blinkit per-WH velocity",
    expression: "perWhVel = byWh.sales30d ÷ 30    (per feeder warehouse)",
    plain: "Each Blinkit feeder WH's own 30-day sell-through, from the Blinkit Seller Panel \"Stock On Hand\" export. Used to flag amber WHs (running out in ≤14d at their own rate).",
    where: "src/pages/PageInventory.jsx · blkPerWhVelocity()",
  },
  {
    id: "blkBiweeklyDelta",
    name: "Blinkit per-WH biweekly Δ",
    expression: "Δ = clamp((sales15d − prior15) / prior15 × 100, −100, +200)\n  where prior15 = sales30d − sales15d",
    plain: "Per-WH momentum signal: did the WH sell more in the last 15 days than the 15 before that? Same cap rules as MoM — +200% on zero baseline, −100% on stopped.",
    where: "src/pages/PageInventory.jsx · BlinkitFeederModal · computeBiweeklyDelta()",
  },
];
