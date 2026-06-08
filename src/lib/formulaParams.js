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
    expression: "runway = round( centralWhFG ÷ totalSalesVelocity )\n  totalSalesVelocity = Σ per-channel MAX(30d, 14d) sales rate\n  sellable(FG + producible) ≤ 0 → 0   ·   sellable > 0 but velocity = 0 → null (no sales signal)",
    plain: "Days the central-WH finished goods last at the company's TOTAL SALES velocity (sum of the per-channel MAX(30d,14d) sales rates), NOT warehouse movement — bulk replenishment shipments out of the WH are not consumption. Numerator is WH finished goods only (old stock is excluded — never sellable). Runway is 0 (and the row is red) when sellable stock (FG + producible) ≤ 0; null when there IS sellable stock but no sales signal at all (shows amber, not a false runway).",
    where: "src/data.js · centralWhRunway / runway",
  },
  {
    id: "runwayStatus",
    name: "Runway status chip",
    expression: "status = sellable(FG+producible) ≤ 0 → red\n       | runway == null (stock, no sales signal) → amber\n       | runway ≤ leadTime → red\n       | runway < amberRunwayDays → amber\n       | else → green",
    plain: "Tri-state color on every row, evaluated in order. Red = stocked out (no sellable FG+producible units) OR will run out before the replenishment lead time. Amber = runway below the comfort buffer (amberRunwayDays, a tunable param) — or there's stock but no sales signal to compute a runway. Green = healthy. The hard sellable≤0 guard is checked FIRST so a dead, stocked-out SKU can never render green.",
    where: "src/data.js · runwayStatus",
  },
  {
    id: "velocity",
    name: "Central-WH velocity (total sales)",
    expression: "centralWhVelocity = salesVel.amazon + salesVel.flipkart + salesVel.blinkit\n  salesVel.ch = MAX( sales30d ÷ 30 , sales14d ÷ 14 )    (Blinkit/agency use 15d → MAX(30,15); 30d-only when no short window)",
    plain: "Sum of the per-channel SALES velocities — the rate the WH buffer actually drains, because it ultimately supplies every channel. Each channel takes the MAX of its 30-day and 14-day average daily sales (the conservative choice — plan for the higher recent demand); Blinkit and agency sheets expose 15-day, so they use MAX(30d, 15d), falling back to 30d-only where no short window exists. Amazon leg folds website D2C (R-FBA). This is SALES, NOT warehouse stock movement — the engine's FG depletion is dominated by bulk replenishment shipments to marketplace WHs and is no longer used for velocity / runway / growth.",
    where: "src/data.js · centralWhVelocity (= totalSalesVel; maxRate per channel)",
  },
  {
    id: "amazonChannelVel",
    name: "Amazon channel velocity (per AMZ-001)",
    expression: "amazonChannelVel = amazonOrdersDaily + shopifyD2CDaily\n  each leg = MAX(30d rate, 14d rate)    (agency 15d → MAX(30,15); 30d-only when no short window)",
    plain: "Amazon FBA serves both Amazon orders AND Shopify D2C (Shopify ships from FBA), so the channel velocity combines both demand streams. Each leg takes the MAX of its 30-day and 14-day average daily SALES (D5 — plan for the higher recent demand), with a 15-day fallback for the agency sheet and a 30d-only fallback where no short window exists.",
    where: "src/data.js · channelVelocity.amazon (maxRate)",
  },
  {
    id: "growth",
    name: "MoM growth (max trailing)",
    expression: "growth = max( monthOverMonth SALES rates )    (up to 3 MoMs from up to 4 months), clamp [−100%, +200%]",
    plain: "Forward growth = the MAX of the trailing month-over-month SALES growth rates (up to 3, computed from up to 4 months of sales) — plan for the highest growth seen so you don't under-stock. Fewer months → fewer MoMs; <2 months → 0. Each channel uses its OWN sales source (not warehouse movement). Clamped to −100%…+200% so a near-zero base can't make the ratio explode. Growth drives the FORWARD reorder projection; displayed runway stays at the current sales pace.",
    where: "src/data.js · channelGrowth / centralWhGrowth",
  },
  {
    id: "producibleFG",
    name: "Producible FG (BOM cap)",
    expression: "producibleFG = min over CONSTRAINING components of floor(component qty / units-per-pack)\n  CONSTRAINING = all BOM components EXCEPT the easily-arranged set (cartons NSPKGCB100/250, juice air pouches NSPKGJB300/500)",
    plain: "The slowest GENUINE constraint (raw/SFG input or a real packaging component) caps how many additional FG packs we could pack today. Each capacity = floor(component qty / units-per-pack). Cartons and juice air-pouches are EXCLUDED (D1) — they're quickly arranged, so they never cap producible or become the bottleneck. Old stock does not count toward producible. Sourced from the central-WH engine, which applies the same exclusion.",
    where: "src/data.js · warehouseBreakdown.producibleFG (NON_CONSTRAINING filter)",
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
    expression: "stockValue = centralWhFG × SP    (per-SKU, FG-only)\nheadline Total = Σ over all locations of units × SP\n  = (WH new FG + WH old + Amazon FBA + Flipkart + Blinkit) × SP",
    plain: "Per-SKU value = central-WH finished goods × selling price (SP, not MRP/cost). The headline Total stock value at the top of Inventory sums units × SP across EVERY location (WH new + WH old + Amazon + Flipkart + Blinkit), each physical unit counted exactly once — no double-count (Flipkart is a physically separate pool), no omission. Old WH stock IS counted in total value but is EXCLUDED from runway (never sellable); it's shown as a separate 'old stock' line.",
    where: "src/data.js · stockValue / totalValue · PageInventory total",
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
    plain: "Units Flipkart shows as available to customers. This stock physically sits at a SEPARATE Flipkart fulfillment centre — a distinct pool from the central WH — so it is counted ONCE on its own (no double-count with the Central column). (Note: the audit's '(Flipkart shipment)' rows are different — those are units staged at central WH pre-dispatch and already fold into WH FG.)",
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
  // ─── Simulator formulas ────────────────────────────────────────
  {
    id: "simReorderBy",
    name: "Reorder by (days)",
    expression: "reorderByDays = totalRunway − supplierLeadTime\nstatus:  reorderByDays < 0  → overdue\n         reorderByDays = 0  → reorder today\n         else               → reorder in N days",
    plain: "How long you have until the latest moment you can place a new order and still have it land before stock runs out. Negative means you're already late.",
    where: "src/pages/PageInventory.jsx · SimulatorTab · reorderByDays",
  },
  {
    id: "simBottleneck",
    name: "Producible FG bottleneck",
    expression: "bottleneck = argmin over CONSTRAINING components of floor(component qty / units-per-pack)\n  CONSTRAINING excludes cartons (NSPKGCB100/250) and juice air pouches (NSPKGJB300/500)",
    plain: "Which GENUINE input or packaging component runs out first when packing more FG. That component caps Producible FG — fix it and you unblock more units. Cartons and juice air-pouches are excluded (D1, easily arranged) so they can never show up as the bottleneck.",
    where: "src/pages/PageInventory.jsx · SimulatorTab · bottleneck",
  },
  {
    id: "simTotalVelocity",
    name: "Simulator total daily velocity",
    expression: "totalVel = projVel.amazon + projVel.flipkart + projVel.blinkit + projVel.wh\n  each projVel.ch = baseVel.ch × (1 + perChannelMoM / 100)",
    plain: "Sum of per-channel projected velocities. In overall mode the input is one number split across channels by current revenue mix. In per-channel mode each channel is set independently.",
    where: "src/pages/PageInventory.jsx · SimulatorTab · projVel",
  },
  {
    id: "simMomGrowth",
    name: "Simulator MoM % growth",
    expression: "projVel.ch = baseVel.ch × (1 + perChannelMoM / 100)",
    plain: "Each channel's velocity is multiplied by (1 + its growth%). Overall mode applies the same growth to every channel; per-channel mode lets you stress-test each independently.",
    where: "src/pages/PageInventory.jsx · SimulatorTab · projVel",
  },
];
