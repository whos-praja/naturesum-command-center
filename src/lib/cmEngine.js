/**
 * cmEngine.js
 *
 * Pure contribution-margin engine for the Business Performance module
 * (spec §6). NO DOM, NO localStorage writes — given a fact set + a month it
 * computes the CM1→CM4 chain per channel × SKU, the SKU×channel CM3 matrix,
 * SKU and company rollups, and the ad-allocation breakdown.
 *
 * CM CHAIN (per month × channel × SKU), spec §6:
 *   netRev
 *   − COGS × units                              → CM1
 *   − feePct(channel) × netRev                  → CM2   (variable platform %)
 *   − adSpend (direct product-attributed +
 *       channel-unattributed allocated by
 *       netRev share within the channel)        → CM3
 *   − fixedAlloc (editable monthly ₹, allocated
 *       revenue-proportionally across channels
 *       then SKUs within channel)               → CM4
 *
 * AD ALLOCATION (spec §3/§6): each cell's adSpend = its DIRECT product-
 * attributed spend (fact.adSpendDirect) + its share of the channel's
 * UNATTRIBUTED spend. Channel total spend comes from a per-channel override
 * (getAdSpendOverride) or, absent that, equals Σ direct (→ unattributed 0).
 * Unattributed = max(0, channelTotal − Σ direct), split by netRev share
 * within the channel. If a channel has unattributed spend but ZERO net
 * revenue, it cannot be revenue-split → it lands in an `unallocated` bucket
 * (surfaced, never silently dropped).
 *
 * COVERAGE / HONESTY (spec §11): COGS absent for a SKU → cogs is null and CM1
 * is null (not 0); such cells are excluded from CM rollups and flagged in
 * `coverage`. Every emitted number is finite (SAFE fallbacks throughout) —
 * the engine NEVER returns NaN/Infinity.
 *
 * COST INPUTS: read via the injected `costs` param when provided (keeps the
 * engine unit-testable with synthetic cost cards), else via the live
 * costInputs.js module. CHOICE: injection wins so node self-tests need no
 * localStorage; production calls pass nothing and get the real registry.
 *
 * ═══ V2 (coverage-aware, multi-month) ═══════════════════════════════════════
 * The v1 `computeCM` above is the NATIVE per-SKU chain and is UNCHANGED — it is
 * the authoritative path for months that have native per-SKU revenue (currently
 * May-2026). V2 adds a coverage-aware layer ON TOP that never breaks v1:
 *
 *  - `coverageFor(facts)` (from businessStore) classifies every month×channel as
 *    sales: native|agency|none, skuGrain: bool, ads: actual|agency|none.
 *  - `computeMonthChannelCM()` dispatches per month×channel by coverage:
 *      native → full SKU-grain chain (the v1 behaviour, filtered to that channel)
 *      agency → CHANNEL-grain CM: snell net revenue − COGS − fees − snell adSpend.
 *               COGS uses snell per-SKU UNITS × cost where skuGrain present
 *               (meta.snellSkuUnits), else channel-weighted-avg cost (flagged
 *               approx). NO per-SKU CM is emitted for agency months.
 *      none   → no CM at all (returns { coverage:"none" }).
 *  - Every figure carries `adBasis ∈ actual-attributed | allocated-share |
 *    agency-total` (V2.3) and CM coverage carries the source basis (V2 §1).
 *  - RATIO GUARDS (V2.2): `guardRatio()` refuses any ratio whose numerator and
 *    denominator come from different coverage windows; ACOS>500% / ROAS<0.2 on
 *    mixed-tier coverage is suppressed with windowMismatch + explanation.
 *  - `monthsAvailable(facts)` lists months with per-channel coverage badges +
 *    partial (MTD) flags for pickers/charts.
 *
 * WEBSITE NET (agency/monarch): Monarch channel-grain carries grossRev only
 * (netRev:0). For agency website months we derive net = gross ÷ 1.05 (a
 * documented approximation; native website net is AS-IS per spec §1.3 and wins
 * whenever a native Shopify report is uploaded).
 */
import * as defaultCosts from "./costInputs.js";
import { coverageFor, isChannelGrainKey, CH_CODE } from "./businessStore.js";

// Website agency net derivation: Monarch carries gross conv value only; ÷1.05 is
// the documented marketplace net rule (spec §2). Native website net is AS-IS and
// overrides this whenever a Shopify net report exists for the month.
const WEBSITE_AGENCY_NET_DIVISOR = 1.05;

// Per-channel ad-spend total overrides (Snell/Monarch channel totals that the
// fact store can't carry as a per-SKU number). Read from the same override
// namespace the Cost Inputs panel writes. Returns a finite number or null.
function readAdSpendOverride(channel) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("ns.bizCost.adTotal");
    const map = raw ? JSON.parse(raw) : null;
    const n = Number(map?.[channel]);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

// Channel ad TOTALS for a SPECIFIC month (V2: month-scoped — the v1 version
// pulled a single May-only meta figure and applied it to EVERY month, which made
// April's tiny native revenue divide against the full May ad total → a 9947%
// ACOS, the exact V2.2 cross-window bug). The authoritative per-month channel
// total is the channel-grain "__ch__" cell's `adSpend` for THAT month (the data
// layer bakes Snell/Monarch monthly spend there). Only when no "__ch__" cell
// exists for the month (e.g. a pre-history bundle) do we fall back to the legacy
// meta.bySource totals — and ONLY for the anchor month they describe (May).
//
// SAFE: any missing source → channel absent from the map (engine then falls back
// to Σ direct, i.e. zero unattributed). NaN-free.
//
// PRECEDENCE for a channel's total (step 3): explicit adSpendOverride param →
// localStorage manual override → THIS per-month total → Σ direct.
export function deriveChannelAdTotals(facts, month) {
  const out = {};
  const monthly = facts && facts.monthly ? facts.monthly : null;
  const m = month != null ? String(month) : null;

  // PRIMARY (month-scoped, coverage-gated): per-month channel-grain "__ch__"
  // adSpend — but ONLY for channels whose sales coverage is AGENCY, where the ad
  // total and the (channel-grain) revenue share the SAME window. For a NATIVE
  // channel-month the agency ad total must NOT be allocated against the native
  // SKU revenue (and ESPECIALLY not against a stray-date "native" sliver like
  // April amazon, where the real revenue is shadowed) — that is the 9947%-ACOS
  // cross-window bug. Native channels get their ad total from native attribution
  // (Σ direct) + the May anchor meta fallback below.
  if (monthly && m) {
    const cov = coverageFor(facts);
    for (const [key, cell] of Object.entries(monthly)) {
      if (!isChannelGrainKey(key)) continue;
      const [km, kch] = key.split("|");
      if (km !== m) continue;
      const sales = cov[`${m}|${kch}`]?.sales;
      if (sales !== "agency") continue;            // coverage gate (V2.2)
      const spend = Number(cell?.adSpend);
      if (Number.isFinite(spend) && spend > 0) out[kch] = spend;
    }
  }

  // FALLBACK (legacy May-only baseline): meta.bySource totals, for the NATIVE May
  // anchor where SP-attributed + AMS-total is the v1 model. Guarded to the anchor
  // month so it can never leak onto another month; channels already resolved above
  // (agency) are not overwritten.
  const ANCHOR = "2026-05";
  if (m != null && m !== ANCHOR) return out;
  const bySource = facts && facts.meta && facts.meta.bySource ? facts.meta.bySource : null;
  if (!bySource) return out;
  // Snell Sale-tab: per-channel agency spend (amazon AMS, flipkart, blinkit).
  // `out[ch] === undefined` guard: never overwrite a channel already resolved
  // from the (agency-coverage) per-month cells above.
  const snell = bySource["snell-agency"]?.snellChannelSpend;
  if (snell) {
    if (out.amazon === undefined && Number.isFinite(Number(snell.amazon))) out.amazon = Number(snell.amazon);
    if (out.flipkart === undefined && Number.isFinite(Number(snell.flipkart))) out.flipkart = Number(snell.flipkart);
    if (out.blinkit === undefined && Number.isFinite(Number(snell.blinkit))) out.blinkit = Number(snell.blinkit);
  }
  // Monarch: website channel total = Google + Meta (spec §3 website row).
  const mon = bySource["monarch-web"]?.monarchWebSpend;
  if (mon && out.website === undefined) {
    const g = Number(mon.googleTotal), me = Number(mon.metaTotal);
    if (Number.isFinite(g) || Number.isFinite(me)) {
      out.website = (Number.isFinite(g) ? g : 0) + (Number.isFinite(me) ? me : 0);
    }
  }
  return out;
}

const fin0 = (n) => (Number.isFinite(n) ? n : 0);

function pctOf(part, whole) {
  const w = fin0(whole);
  if (w === 0) return 0; // SAFE: 0-revenue cell reports 0% not Infinity
  return fin0(part) / w;
}

/**
 * computeCM({ facts, month, costs?, adSpendOverride? })
 *
 *   facts  — the fact-store payload's `monthly` map (key "YYYY-MM|channel|CODE")
 *            OR a full payload { monthly, daily } (monthly is used).
 *   month  — "YYYY-MM" filter (required).
 *   costs  — optional cost-input module override (defaults to costInputs.js).
 *   adSpendOverride — optional { [channel]: total ₹ } injected for tests.
 *
 * Returns { byChannel, bySku, matrix, company, adAllocation, coverage }.
 */
export function computeCM({ facts, month, costs, adSpendOverride } = {}) {
  const C = costs || defaultCosts;
  const monthly = facts && facts.monthly ? facts.monthly : (facts || {});
  const m = String(month || "");

  // ── 1. Gather this month's facts into [{channel, code, fact}] ──
  const cells = [];
  const channelsSet = new Set();
  const codesSet = new Set();
  for (const key of Object.keys(monthly)) {
    const parts = key.split("|");
    if (parts.length !== 3) continue;        // SAFE: skip malformed keys
    const [fm, channel, code] = parts;
    if (fm !== m) continue;
    if (!channel || !code) continue;
    if (code === "__ch__") continue;         // V2: skip channel-grain sentinel (not a SKU; would double-count)
    cells.push({ channel, code, fact: monthly[key] || {} });
    channelsSet.add(channel);
    codesSet.add(code);
  }

  // ── 2. Per-channel net-revenue totals + direct ad sums (for allocation) ──
  const chNetRev = {};   // channel → Σ netRev
  const chDirectAd = {}; // channel → Σ adSpendDirect
  for (const { channel, fact } of cells) {
    chNetRev[channel] = fin0(chNetRev[channel]) + fin0(Number(fact.netRev));
    chDirectAd[channel] = fin0(chDirectAd[channel]) + fin0(Number(fact.adSpendDirect));
  }

  // ── 3. Per-channel unattributed ad pool (spec §3) ──
  // channelTotal precedence: explicit adSpendOverride param → localStorage
  // manual override → meta-derived Snell/Monarch total → Σ direct.
  // unattributed = max(0, channelTotal − Σ direct). poolBasis = channel netRev.
  const metaTotals = deriveChannelAdTotals(facts, m); // month-scoped (V2); {} when none
  const adAllocation = {};
  for (const channel of channelsSet) {
    const direct = fin0(chDirectAd[channel]);
    const paramOv = adSpendOverride ? Number(adSpendOverride[channel]) : NaN;
    const lsOv = adSpendOverride ? NaN : readAdSpendOverride(channel);
    const metaOv = Number(metaTotals[channel]);
    const override = [paramOv, lsOv, metaOv].find((v) => Number.isFinite(v));
    const total = Number.isFinite(override) ? override : direct;
    const unattributed = Math.max(0, total - direct);
    adAllocation[channel] = {
      direct,
      total,
      unattributed,
      poolBasis: fin0(chNetRev[channel]),
      // unallocated: unattributed that can't be revenue-split (0-revenue channel)
      unallocated: fin0(chNetRev[channel]) === 0 ? unattributed : 0,
    };
  }

  // ── 4. Fixed-cost pool for the month (CM4). null → CM4 hidden downstream. ──
  const fixed = (C.getFixedCost ? C.getFixedCost(m) : null);
  const fixedTotal = fixed && Number.isFinite(Number(fixed.amount)) ? Number(fixed.amount) : null;
  const companyNetRev = Object.values(chNetRev).reduce((a, b) => a + fin0(b), 0);

  // ── 5. Build each cell's CM chain ──
  const byChannel = {};
  const bySku = {};
  const matrix = {};
  const coverageMisses = []; // {channel, code, missing:"cogs"}

  for (const { channel, code, fact } of cells) {
    const units = fin0(Number(fact.units));
    const netRev = fin0(Number(fact.netRev));
    const directAd = fin0(Number(fact.adSpendDirect));

    // COGS — null when no card resolves (honest gap, excluded from rollups).
    const card = C.getCostCard ? C.getCostCard(code) : null;
    const hasCogs = !!(card && Number.isFinite(card.cogs));
    const cogsCost = hasCogs ? card.cogs * units : null;
    if (!hasCogs) coverageMisses.push({ channel, code, missing: "cogs" });

    const cm1 = hasCogs ? netRev - cogsCost : null;

    // Fees — feePct × this channel's net revenue (spec §5). Website channel
    // resolves to the blended rate inside getFeePct.
    const feePct = C.getFeePct ? fin0(Number(C.getFeePct(channel)?.pct)) : 0;
    const fees = feePct * netRev;
    const cm2 = hasCogs ? cm1 - fees : null;

    // Ad — direct + share of channel unattributed by netRev within channel.
    const alloc = adAllocation[channel] || { unattributed: 0, poolBasis: 0 };
    const basis = fin0(alloc.poolBasis);
    const unattrShare = basis > 0 ? (netRev / basis) * fin0(alloc.unattributed) : 0;
    const adSpend = directAd + unattrShare;
    const cm3 = hasCogs ? cm2 - adSpend : null;

    // Fixed alloc — revenue-proportional across the whole company (then this
    // cell's slice). Null when no fixed cost set → CM4 stays null (hidden).
    let fixedAlloc = 0;
    let cm4 = null;
    if (fixedTotal != null && companyNetRev > 0) {
      fixedAlloc = (netRev / companyNetRev) * fixedTotal;
      cm4 = hasCogs ? cm3 - fixedAlloc : null;
    }

    const cell = {
      netRev, units,
      cogs: cogsCost,
      cm1: cm1 == null ? null : fin0(cm1),
      fees: fin0(fees),
      cm2: cm2 == null ? null : fin0(cm2),
      adSpend: fin0(adSpend),
      cm3: cm3 == null ? null : fin0(cm3),
      fixedAlloc: fin0(fixedAlloc),
      cm4: cm4 == null ? null : fin0(cm4),
      pcts: {
        cm1: cm1 == null ? null : pctOf(cm1, netRev),
        cm2: cm2 == null ? null : pctOf(cm2, netRev),
        cm3: cm3 == null ? null : pctOf(cm3, netRev),
        cm4: cm4 == null ? null : pctOf(cm4, netRev),
      },
      coverage: { cogs: hasCogs },
    };

    // accumulate channel + sku + matrix
    accumChannel(byChannel, channel, cell);
    accumSku(bySku, code, channel, cell);
    if (!matrix[code]) matrix[code] = {};
    matrix[code][channel] = {
      netRev: cell.netRev,
      units: cell.units,
      adSpend: cell.adSpend,
      cm3: cell.cm3,
      cm3Pct: cell.cm3 == null ? null : pctOf(cell.cm3, cell.netRev),
    };
  }

  // ── 6. Finalize rollup percentages + company ──
  for (const ch of Object.keys(byChannel)) finalizeRollup(byChannel[ch]);
  for (const code of Object.keys(bySku)) {
    finalizeRollup(bySku[code]);
    for (const ch of Object.keys(bySku[code].byChannel || {})) {
      finalizeRollup(bySku[code].byChannel[ch]);
    }
  }

  const company = blankRollup();
  for (const ch of Object.keys(byChannel)) addRollup(company, byChannel[ch]);
  finalizeRollup(company);
  company.fixedTotal = fixedTotal; // null when unset → UI hides CM4
  company.fixedAsOf = fixed?.asOf || null;

  const coverage = {
    channels: [...channelsSet].sort(),
    skus: [...codesSet].sort(),
    cogsMisses: coverageMisses,
    cogsCovered: coverageMisses.length === 0,
    hasFixedCost: fixedTotal != null,
  };

  return { byChannel, bySku, matrix, company, adAllocation, coverage };
}

// ═══════════════════════════════════════════════════════════════════════════
// V2 — COVERAGE-AWARE, MULTI-MONTH CM
// ═══════════════════════════════════════════════════════════════════════════

// adBasis taxonomy (spec V2.3). Every margin figure renders one of these.
export const AD_BASIS = {
  ACTUAL: "actual-attributed",   // per-SKU SP/PLA attribution (native)
  ALLOC: "allocated-share",      // channel total split across SKUs by net rev
  AGENCY: "agency-total",        // Snell/Monarch channel-grain total (no attribution)
  NONE: "none",                  // no ad spend known for this window
};

// sales basis taxonomy mirrors coverage.sales.
export const SALES_BASIS = { NATIVE: "native", AGENCY: "agency", NONE: "none" };

/**
 * snellSkuUnitsMap(facts) → { "YYYY-MM|channel|CODE": units } | {}.
 * The per-SKU UNITS namespace the data layer parks under
 * meta.bySource["snell-sku-units"].monthly (NOT facts.monthly — revenue-less
 * agency units must never join the SKU-grain revenue map). SAFE: absent → {}.
 */
export function snellSkuUnitsMap(facts) {
  const m = facts?.meta?.bySource?.["snell-sku-units"]?.monthly;
  return m && typeof m === "object" ? m : {};
}

/**
 * channelWeightedAvgCost(code-units map for a channel, costs) → { cost, covered }.
 * Σ(units×cost) / Σ(units over SKUs that HAVE a cost card). `covered` = fraction
 * of units priced (1.0 = every unit has a COGS card). Used as the agency-month
 * channel COGS basis when per-SKU units exist; the weighted avg also prices any
 * residual units the SKU map didn't cover. SAFE: no priced units → cost null.
 */
function channelWeightedAvgCost(skuUnits, C) {
  let costSum = 0, pricedUnits = 0, totalUnits = 0;
  for (const [code, u] of Object.entries(skuUnits)) {
    const units = fin0(Number(u));
    totalUnits += units;
    const card = C.getCostCard ? C.getCostCard(code) : null;
    if (card && Number.isFinite(card.cogs)) {
      costSum += card.cogs * units;
      pricedUnits += units;
    }
  }
  if (pricedUnits <= 0) return { cost: null, covered: 0, costSum: 0, pricedUnits: 0, totalUnits };
  return {
    cost: costSum / pricedUnits,            // ₹/unit weighted avg over priced SKUs
    covered: totalUnits > 0 ? pricedUnits / totalUnits : 0,
    costSum, pricedUnits, totalUnits,
  };
}

// Pull a channel's per-SKU UNITS for a month out of the snell-sku-units namespace.
function channelSkuUnits(snellMap, month, channel) {
  const out = {};
  const prefix = `${month}|${channel}|`;
  for (const [key, u] of Object.entries(snellMap)) {
    if (!key.startsWith(prefix)) continue;
    const code = key.slice(prefix.length);
    if (!code || code === CH_CODE) continue;
    out[code] = fin0(Number(u));
  }
  return out;
}

/**
 * computeMonthChannelCM({ facts, month, channel, costs?, coverage? }) →
 *   {
 *     month, channel, coverage: "native"|"agency"|"none",
 *     skuGrain, adBasis, partial, lastDay,
 *     netRev, units, cogs, cm1, fees, cm2, adSpend, cm3,
 *     pcts: { cm1, cm2, cm3 },
 *     cogsApprox?  (agency months priced via weighted-avg — flagged),
 *     cogsCovered, note?
 *   }
 *
 * Coverage dispatch (spec V2 §1):
 *   native → full SKU-grain chain (v1 computeCM, this channel's slice). The
 *            channel rollup it produces IS the channel-grain CM, so we reuse it.
 *   agency → channel-grain CM directly from the "__ch__" cell:
 *              netRev (website: gross÷1.05) − COGS − feePct×netRev − adSpend.
 *            COGS = Σ(snell SKU units × cost) + (residual units × weighted-avg
 *            cost); flagged cogsApprox unless every unit is priced.
 *   none   → { coverage:"none" } (no CM, no fabricated margin).
 *
 * NaN-free, ratio-free at this layer (ratios are gated in guardRatio()).
 */
export function computeMonthChannelCM({ facts, month, channel, costs, coverage } = {}) {
  const C = costs || defaultCosts;
  const m = String(month || "");
  const ch = String(channel || "");
  const cov = coverage || coverageFor(facts);
  const mc = `${m}|${ch}`;
  const cell = cov[mc] || { sales: "none", skuGrain: false, ads: "none", partial: false, lastDay: null };

  const base = {
    month: m, channel: ch,
    coverage: cell.sales,
    skuGrain: !!cell.skuGrain,
    partial: !!cell.partial,
    lastDay: cell.lastDay || null,
  };

  // ── none ──
  if (cell.sales === "none") {
    return { ...base, adBasis: AD_BASIS.NONE, netRev: 0, units: 0, cogs: null,
      cm1: null, fees: 0, cm2: null, adSpend: 0, cm3: null,
      pcts: { cm1: null, cm2: null, cm3: null }, cogsCovered: false,
      note: "no sales coverage for this month×channel" };
  }

  // ── native ──
  if (cell.sales === "native") {
    // V2.2 RETURNS-TAIL / STRAY-DATE ARTIFACT GUARD. A month×channel is flagged
    // "native" if even a single per-SKU cell carries that month's date — but a
    // handful of stray-date All-Orders rows (e.g. 2 April-dated Amazon cells) or
    // a prior-month return dated into this month (Flipkart April −₹1,435) is NOT
    // genuine native coverage of the month. When the real agency window for the
    // same month (retained in meta.agencyShadow by V2.1 precedence) dwarfs the
    // native sliver (native < 2% of agency net, the V2.2 threshold), we REROUTE
    // to the agency channel-grain CM using the shadow revenue + the suppressed
    // cell's surviving adSpend — so the headline shows the real ~₹9L April amazon
    // month, not a ₹3,690 sliver, and never divides ad spend against the sliver.
    const shadow = facts?.meta?.agencyShadow?.[mc];
    if (shadow) {
      const v1peek = computeCM({ facts, month: m, costs: C });
      const nativeNet = fin0(v1peek.byChannel[ch]?.netRev);
      const shadowNet = fin0(Number(shadow.netRev)) || (fin0(Number(shadow.grossRev)) / WEBSITE_AGENCY_NET_DIVISOR);
      const sliver = shadowNet > 0 && Math.abs(nativeNet) < 0.02 * shadowNet;
      if (sliver) {
        const chCell = (facts.monthly || {})[`${mc}|${CH_CODE}`] || {};
        return agencyChannelCM({
          base: { ...base, coverage: "agency" }, // present as the real agency window
          C, facts, month: m, channel: ch,
          grossRev: fin0(Number(shadow.grossRev)),
          netRev: fin0(Number(shadow.netRev)),
          units: fin0(Number(shadow.units)),
          adSpend: fin0(Number(chCell.adSpend)), // adSpend survives suppression
          artifact: true, nativeSliver: nativeNet,
        });
      }
    }

    // genuine native: reuse the v1 SKU chain, take this channel's rollup.
    const v1 = computeCM({ facts, month: m, costs: C });
    const roll = v1.byChannel[ch];
    if (!roll) {
      return { ...base, adBasis: AD_BASIS.NONE, netRev: 0, units: 0, cogs: null,
        cm1: null, fees: 0, cm2: null, adSpend: 0, cm3: null,
        pcts: { cm1: null, cm2: null, cm3: null }, cogsCovered: false,
        note: "native coverage flag but no per-SKU cells resolved" };
    }
    // ad basis: actual if any direct attribution in this channel, else allocated
    // (channel total split by rev), else agency total only, else none.
    const alloc = v1.adAllocation[ch] || {};
    const adBasis = fin0(alloc.direct) > 0
      ? AD_BASIS.ACTUAL
      : (fin0(roll.adSpend) > 0 ? AD_BASIS.ALLOC : AD_BASIS.NONE);
    return {
      ...base,
      adBasis,
      netRev: fin0(roll.netRev),
      units: fin0(roll.units),
      cogs: fin0(roll.cogs),
      cm1: roll.cm1 == null ? null : fin0(roll.cm1),
      fees: fin0(roll.fees),
      cm2: roll.cm2 == null ? null : fin0(roll.cm2),
      adSpend: fin0(roll.adSpend),
      cm3: roll.cm3 == null ? null : fin0(roll.cm3),
      pcts: {
        cm1: roll.cm1 == null ? null : pctOf(roll.cm1, roll.netRev),
        cm2: roll.cm2 == null ? null : pctOf(roll.cm2, roll.netRev),
        cm3: roll.cm3 == null ? null : pctOf(roll.cm3, roll.netRev),
      },
      cogsCovered: roll.cogsCovered !== false,
    };
  }

  // ── agency: channel-grain CM from the "__ch__" cell ──
  const monthly = facts && facts.monthly ? facts.monthly : (facts || {});
  const chCell = monthly[`${mc}|${CH_CODE}`] || {};
  return agencyChannelCM({
    base, C, facts, month: m, channel: ch,
    grossRev: fin0(Number(chCell.grossRev)),
    netRev: fin0(Number(chCell.netRev)),
    units: fin0(Number(chCell.units)),
    adSpend: fin0(Number(chCell.adSpend)),
  });
}

/**
 * agencyChannelCM(args) — the channel-grain CM body, factored out so the
 * native-artifact reroute (V2.2 returns-tail handling) can feed it SHADOW
 * revenue + the suppressed-cell adSpend instead of the live (zeroed) cell.
 *   netRev (website: gross÷1.05) − COGS − feePct×netRev − adSpend → CM1/2/3.
 *   COGS = Σ(snell SKU units × cost) + residual units × weighted-avg cost.
 * Every emitted number is finite-or-null. `coverage` on the result is whatever
 * `base.coverage` was set to ("agency"), so artifact reroutes label themselves.
 */
function agencyChannelCM({ base, C, facts, month, channel, grossRev, netRev, units, adSpend, artifact, nativeSliver }) {
  let net = fin0(netRev);
  let netDerived = false;
  // Website (Monarch) carries gross only → derive net = gross÷1.05 (documented).
  if (net === 0 && fin0(grossRev) > 0) {
    net = fin0(grossRev) / WEBSITE_AGENCY_NET_DIVISOR;
    netDerived = true;
  }
  const u = fin0(units);
  const ad = fin0(adSpend);

  // COGS: Σ(snell SKU units × cost) for the priced SKUs, then price residual
  // channel units (units − Σ skuUnits) at the channel weighted-avg cost.
  const skuUnits = channelSkuUnits(snellSkuUnitsMap(facts), month, channel);
  const wac = channelWeightedAvgCost(skuUnits, C);
  let cogs = null;
  let cogsApprox = false;
  let cogsCovered = false;
  if (wac.cost != null) {
    const skuUnitTotal = wac.totalUnits;
    const residual = Math.max(0, u - skuUnitTotal);
    cogs = wac.costSum + residual * wac.cost;
    cogsCovered = wac.covered >= 0.999 && residual === 0;
    cogsApprox = !cogsCovered;
  }

  const cm1 = cogs == null ? null : net - cogs;
  const feePct = C.getFeePct ? fin0(Number(C.getFeePct(channel)?.pct)) : 0;
  const fees = feePct * net;
  const cm2 = cm1 == null ? null : cm1 - fees;
  const cm3 = cm2 == null ? null : cm2 - ad;

  return {
    ...base,
    adBasis: ad > 0 ? AD_BASIS.AGENCY : AD_BASIS.NONE,
    netRev: fin0(net),
    units: u,
    cogs: cogs == null ? null : fin0(cogs),
    cm1: cm1 == null ? null : fin0(cm1),
    fees: fin0(fees),
    cm2: cm2 == null ? null : fin0(cm2),
    adSpend: fin0(ad),
    cm3: cm3 == null ? null : fin0(cm3),
    pcts: {
      cm1: cm1 == null ? null : pctOf(cm1, net),
      cm2: cm2 == null ? null : pctOf(cm2, net),
      cm3: cm3 == null ? null : pctOf(cm3, net),
    },
    cogsCovered,
    ...(cogsApprox ? { cogsApprox: true } : {}),
    ...(netDerived ? { netDerived: true } : {}),
    ...(artifact ? { artifactReroute: true, nativeSliver: fin0(nativeSliver) } : {}),
  };
}

/**
 * guardRatio({ numerator, denominator, numWindow, denWindow, kind }) →
 *   { value, suppressed, reason }
 *
 * The single chokepoint for ROAS/ACOS/CM%/MoM (spec V2.2). HARD RULES:
 *  - numerator and denominator MUST share a coverage window; numWindow !==
 *    denWindow → suppressed:"window-mismatch" (the 16276%-ACOS class of bug).
 *  - 0 / near-0 denominator → suppressed:"no-denominator" (never Infinity).
 *  - kind:"acos": value = spend/revenue; if value > 5 (500%) AND windows are
 *    mixed-tier → suppress with "window-mismatch". If same-window, returned.
 *  - kind:"roas": value = revenue/spend; if value < 0.2 AND mixed-tier →
 *    suppress. Same-window returned with evidence.
 * `value` is a finite number or null; never NaN/Infinity.
 */
export function guardRatio({ numerator, denominator, numWindow, denWindow, kind } = {}) {
  const num = Number(numerator), den = Number(denominator);
  // window discipline first — a cross-window ratio is never computed.
  if (numWindow != null && denWindow != null && numWindow !== denWindow) {
    return { value: null, suppressed: true, reason: "window-mismatch" };
  }
  if (!Number.isFinite(num) || !Number.isFinite(den) || Math.abs(den) < 1e-9) {
    return { value: null, suppressed: true, reason: "no-denominator" };
  }
  const value = num / den;
  if (!Number.isFinite(value)) return { value: null, suppressed: true, reason: "no-denominator" };
  const mixedTier = numWindow != null && denWindow != null && /mixed/.test(String(numWindow) + String(denWindow));
  if (kind === "acos" && value > 5 && mixedTier) {
    return { value: null, suppressed: true, reason: "window-mismatch" };
  }
  if (kind === "roas" && value < 0.2 && mixedTier) {
    return { value: null, suppressed: true, reason: "window-mismatch" };
  }
  return { value, suppressed: false, reason: null };
}

/**
 * monthsAvailable(facts) → [{ month, partial, lastDay, channels:
 *   { [channel]: { sales, skuGrain, ads, partial, lastDay } } }]  (ascending).
 *
 * The month picker / chart model. Every month carries per-channel coverage
 * badges; `partial` at the month level = ANY channel still MTD (last data day
 * before month end). Built straight from coverageFor — single source of truth.
 */
export function monthsAvailable(facts) {
  const cov = coverageFor(facts);
  const byMonth = {};
  for (const [mc, c] of Object.entries(cov)) {
    const [month, channel] = mc.split("|");
    if (!month || !channel) continue;
    if (!byMonth[month]) byMonth[month] = { month, partial: false, lastDay: null, channels: {} };
    byMonth[month].channels[channel] = {
      sales: c.sales, skuGrain: c.skuGrain, ads: c.ads, partial: c.partial, lastDay: c.lastDay,
    };
    if (c.partial) byMonth[month].partial = true;
    if (c.lastDay && (!byMonth[month].lastDay || c.lastDay > byMonth[month].lastDay)) {
      byMonth[month].lastDay = c.lastDay;
    }
  }
  return Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * computeCMv2({ facts, month, costs? }) → coverage-aware month rollup.
 *   { month, channels: { [ch]: <computeMonthChannelCM> }, company:
 *     { netRev, cm1, cm2, cm3, units, adSpend, ... }, coverageNote }.
 * The company rollup sums ONLY channels with real sales coverage (native or
 * agency); 'none' channels contribute nothing. CM rollups skip channels whose
 * COGS is uncovered (their netRev still counts; cmX excluded → cogsCovered flag).
 */
export function computeCMv2({ facts, month, costs } = {}) {
  const C = costs || defaultCosts;
  const m = String(month || "");
  const cov = coverageFor(facts);
  const channels = new Set();
  for (const mc of Object.keys(cov)) {
    const [cm, ch] = mc.split("|");
    if (cm === m && ch) channels.add(ch);
  }
  const out = { month: m, channels: {}, company: blankRollup(), coverageNote: null };
  let anyAgency = false, anyNative = false;
  for (const ch of [...channels].sort()) {
    const r = computeMonthChannelCM({ facts, month: m, channel: ch, costs: C, coverage: cov });
    out.channels[ch] = r;
    if (r.coverage === "none") continue;
    if (r.coverage === "agency") anyAgency = true;
    if (r.coverage === "native") anyNative = true;
    // accumulate into company (null cmX contribute 0; cogsCovered flips).
    out.company.netRev += fin0(r.netRev);
    out.company.units += fin0(r.units);
    out.company.cogs += fin0(r.cogs);
    out.company.fees += fin0(r.fees);
    out.company.adSpend += fin0(r.adSpend);
    out.company.cm1 += fin0(r.cm1);
    out.company.cm2 += fin0(r.cm2);
    out.company.cm3 += fin0(r.cm3);
    if (r.cogsCovered === false || r.cogs == null) out.company.cogsCovered = false;
  }
  finalizeRollup(out.company);
  out.company.cm4 = null; // CM4 is the v1 native-month path only (fixed alloc)
  out.coverageNote = anyNative && anyAgency ? "mixed: native + agency channels"
    : anyNative ? "all native" : anyAgency ? "all agency" : "no coverage";
  return out;
}

/**
 * monthlyNetRevByChannel(facts, { lastN }) → { months:[…], channels:[…],
 *   rows: { [channel]: { [month]: { netRev, basis, partial } } }, table }.
 *
 * Headline multi-month report model: net revenue per channel per month, with
 * the active source basis (native|agency) and a partial-MTD flag. `lastN` trims
 * to the most recent N months (default all). NEVER divides across windows.
 */
export function monthlyNetRevByChannel(facts, { lastN } = {}) {
  const months = monthsAvailable(facts);
  const trimmed = Number.isFinite(lastN) && lastN > 0 ? months.slice(-lastN) : months;
  const monthList = trimmed.map((mm) => mm.month);
  const channelSet = new Set();
  const rows = {};
  for (const mm of trimmed) {
    for (const ch of Object.keys(mm.channels)) {
      channelSet.add(ch);
      const r = computeMonthChannelCM({ facts, month: mm.month, channel: ch });
      if (r.coverage === "none") continue;
      rows[ch] = rows[ch] || {};
      rows[ch][mm.month] = {
        netRev: fin0(r.netRev),
        basis: r.coverage,        // native | agency
        partial: !!r.partial,
      };
    }
  }
  const channels = [...channelSet].sort();
  // flat table for rendering: [{ month, [ch]:netRev|null, partial }]
  const table = monthList.map((mo) => {
    const partial = trimmed.find((t) => t.month === mo)?.partial || false;
    const row = { month: mo, partial };
    for (const ch of channels) row[ch] = rows[ch]?.[mo]?.netRev ?? null;
    return row;
  });
  return { months: monthList, channels, rows, table };
}

// ─── Rollup accumulation (sums; null CM contributions excluded) ──
function blankRollup() {
  return {
    netRev: 0, units: 0, cogs: 0, fees: 0, adSpend: 0, fixedAlloc: 0,
    cm1: 0, cm2: 0, cm3: 0, cm4: 0,
    cm4HasData: false,                 // false until any cell contributes a CM4
    cogsCovered: true,                 // flips false if any contributing cell lacks COGS
    pcts: { cm1: 0, cm2: 0, cm3: 0, cm4: 0 },
  };
}
function addRollup(agg, cell) {
  agg.netRev += fin0(cell.netRev);
  agg.units += fin0(cell.units);
  agg.cogs += fin0(cell.cogs);
  agg.fees += fin0(cell.fees);
  agg.adSpend += fin0(cell.adSpend);
  agg.fixedAlloc += fin0(cell.fixedAlloc);
  // CM rollups: a null (no-COGS) cell still contributes its netRev to the
  // denominator but contributes 0 to CMs and marks coverage incomplete.
  if (cell.cogs == null || cell.coverage?.cogs === false) agg.cogsCovered = false;
  agg.cm1 += fin0(cell.cm1);
  agg.cm2 += fin0(cell.cm2);
  agg.cm3 += fin0(cell.cm3);
  if (cell.cm4 != null) { agg.cm4 += fin0(cell.cm4); agg.cm4HasData = true; }
}
function accumChannel(byChannel, channel, cell) {
  if (!byChannel[channel]) byChannel[channel] = blankRollup();
  addRollup(byChannel[channel], cell);
}
function accumSku(bySku, code, channel, cell) {
  if (!bySku[code]) { bySku[code] = blankRollup(); bySku[code].byChannel = {}; }
  addRollup(bySku[code], cell);
  if (!bySku[code].byChannel[channel]) bySku[code].byChannel[channel] = blankRollup();
  addRollup(bySku[code].byChannel[channel], cell);
}
function finalizeRollup(agg) {
  const r = fin0(agg.netRev);
  agg.pcts = {
    cm1: pctOf(agg.cm1, r),
    cm2: pctOf(agg.cm2, r),
    cm3: pctOf(agg.cm3, r),
    cm4: agg.cm4HasData ? pctOf(agg.cm4, r) : null,
  };
  if (!agg.cm4HasData) agg.cm4 = null; // hide CM4 rollup until a fixed cost is set
}

// ───────────────────────────────────────────────────────────────
// NODE SELF-TEST — runs only when executed directly:
//   node src/lib/cmEngine.js
// (guarded by import.meta.url so Vite/browser imports never trigger it.)
// Synthetic, hand-checkable case below; every assert is verifiable by hand.
// ───────────────────────────────────────────────────────────────
// `proc` reads node's process via globalThis so the browser/ESLint env (where
// `process` is undefined) never trips — node populates it, browsers leave it
// undefined and the self-test block below stays dormant.
const proc = typeof globalThis !== "undefined" ? globalThis.process : undefined;
const isMain = (() => {
  try { return !!proc && import.meta.url === `file://${proc.argv[1]}`; }
  catch { return false; }
})();

if (isMain) {
  // Synthetic cost module — no localStorage, deterministic.
  const costs = {
    getCostCard: (code) => ({ NSSB100: { cogs: 100 }, NSMP100: { cogs: 40 } }[code] || null),
    getFeePct: (ch) => ({ pct: { amazon: 0.20, blinkit: 0.25 }[ch] ?? 0 }),
    getFixedCost: () => ({ amount: 1000, asOf: "2026-05" }),
  };
  // Facts: amazon NSSB100 (1000 rev, 5 units, 50 direct ad),
  //        amazon NSMP100 (1000 rev, 10 units, 0 direct ad),
  //        blinkit NSSB100 (500 rev, 3 units, 0 direct ad).
  const facts = {
    monthly: {
      "2026-05|amazon|NSSB100":  { units: 5,  netRev: 1000, adSpendDirect: 50 },
      "2026-05|amazon|NSMP100":  { units: 10, netRev: 1000, adSpendDirect: 0 },
      "2026-05|blinkit|NSSB100": { units: 3,  netRev: 500,  adSpendDirect: 0 },
    },
  };
  // Amazon channel total ad = 250 → unattributed = 250−50 = 200, split by
  // netRev within amazon (NSSB100 1000 / 2000 = 0.5 → +100; NSMP100 +100).
  // Blinkit total = 100 → unattributed 100, only one SKU → +100.
  const adSpendOverride = { amazon: 250, blinkit: 100 };

  const out = computeCM({ facts, month: "2026-05", costs, adSpendOverride });

  const assert = (label, got, want) => {
    const ok = Math.abs(got - want) < 1e-6;
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}: got=${got} want=${want}`);
    if (!ok) proc.exitCode = 1;
  };

  // amazon NSSB100: cogs 100×5=500, cm1 500; fee .20×1000=200, cm2 300;
  // ad 50 direct + 100 unattr = 150, cm3 150; fixed: rev 1000/2500×1000=400, cm4 -250.
  const a1 = out.bySku.NSSB100.byChannel.amazon;
  assert("amz NSSB100 cm1", a1.cm1, 500);
  assert("amz NSSB100 cm2", a1.cm2, 300);
  assert("amz NSSB100 adSpend", a1.adSpend, 150);
  assert("amz NSSB100 cm3", a1.cm3, 150);
  assert("amz NSSB100 fixedAlloc", a1.fixedAlloc, 400);
  assert("amz NSSB100 cm4", a1.cm4, -250);

  // amazon NSMP100: cogs 40×10=400, cm1 600; fee .20×1000=200, cm2 400;
  // ad 0 + 100 unattr = 100, cm3 300; fixed 1000/2500×1000=400, cm4 -100.
  const a2 = out.bySku.NSMP100.byChannel.amazon;
  assert("amz NSMP100 cm3", a2.cm3, 300);
  assert("amz NSMP100 cm4", a2.cm4, -100);

  // blinkit NSSB100: cogs 100×3=300, cm1 200; fee .25×500=125, cm2 75;
  // ad 0 + 100 unattr = 100, cm3 -25; fixed 500/2500×1000=200, cm4 -225.
  const b1 = out.bySku.NSSB100.byChannel.blinkit;
  assert("blk NSSB100 cm3", b1.cm3, -25);
  assert("blk NSSB100 cm4", b1.cm4, -225);

  // company: netRev 2500; cm1 = 500+600+200 = 1300; cm3 = 150+300−25 = 425;
  // fixed total 1000 → cm4 = 425 − 1000 = -575.
  assert("company netRev", out.company.netRev, 2500);
  assert("company cm1", out.company.cm1, 1300);
  assert("company cm3", out.company.cm3, 425);
  assert("company cm4", out.company.cm4, -575);

  // matrix CM3% for amazon NSSB100 = 150/1000 = 0.15
  assert("matrix amz NSSB100 cm3Pct", out.matrix.NSSB100.amazon.cm3Pct, 0.15);

  // adAllocation sanity: amazon unattributed = 200, blinkit = 100.
  assert("adAlloc amazon unattr", out.adAllocation.amazon.unattributed, 200);
  assert("adAlloc blinkit unattr", out.adAllocation.blinkit.unattributed, 100);

  // ═══ V2 self-tests ═══════════════════════════════════════════════════════
  const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); if (!cond) proc.exitCode = 1; };

  // V2 cost module: SB sizes priced, flipkart/blinkit/amazon/website fees.
  const v2costs = {
    getCostCard: (code) => ({
      NSSB100: { cogs: 100 }, NSSB250: { cogs: 300 }, NSSB500: { cogs: 580 },
    }[code] || null),
    getFeePct: (ch) => ({ pct: { amazon: 0.25, flipkart: 0.10, blinkit: 0.25, website: 0.23 }[ch] ?? 0 }),
    getFixedCost: () => null,
  };

  // V2 facts: May amazon NATIVE (1 SKU) + agency __ch__ (rev should be ignored
  // in agency path because May is native). April amazon AGENCY-only with snell
  // SKU units. June blinkit AGENCY partial (MTD). Website May agency (gross only,
  // net derived ÷1.05). A 'none' channel-month (no cells) is implicit.
  const v2facts = {
    monthly: {
      // May amazon native: NSSB100 1000 rev / 5 units / 200 direct ad.
      "2026-05|amazon|NSSB100": { units: 5, netRev: 1000, grossRev: 1050, adSpendDirect: 200 },
      // May amazon agency channel cell (present, but native wins → agency path NOT taken for May).
      "2026-05|amazon|__ch__": { units: 6, grossRev: 1200, netRev: 1100, adSpend: 300, tier: "agency" },
      // April amazon agency-only: 8 units, gross 8000, net 6000, ad 1500.
      "2026-04|amazon|__ch__": { units: 8, grossRev: 8000, netRev: 6000, adSpend: 1500, tier: "agency" },
      // June blinkit agency partial (MTD): 4 units, gross 4000, net 3000, ad 500.
      "2026-06|blinkit|__ch__": { units: 4, grossRev: 4000, netRev: 3000, adSpend: 500, tier: "agency" },
      // May website agency: gross only (net 0 → derive ÷1.05). 10 units, gross 1050, ad 200.
      "2026-05|website|__ch__": { units: 10, grossRev: 1050, netRev: 0, adSpend: 200, tier: "monarch" },
    },
    daily: {
      // June blinkit last day mid-month → partial. May/April have no daily → not partial.
      "2026-06-10|blinkit|__ch__": { units: 4, grossRev: 4000, netRev: 3000, adSpend: 500 },
    },
    meta: { bySource: { "snell-sku-units": { monthly: {
      // April amazon SKU units: 4×NSSB100 + 4×NSSB250 = 8 units (== channel units).
      "2026-04|amazon|NSSB100": 4, "2026-04|amazon|NSSB250": 4,
    } } } },
  };

  // coverage classification
  const v2cov = coverageFor(v2facts);
  ok("V2 May amazon = native", v2cov["2026-05|amazon"].sales === "native");
  ok("V2 April amazon = agency", v2cov["2026-04|amazon"].sales === "agency");
  ok("V2 June blinkit = agency", v2cov["2026-06|blinkit"].sales === "agency");
  ok("V2 June blinkit partial (MTD)", v2cov["2026-06|blinkit"].partial === true);
  ok("V2 May website = agency", v2cov["2026-05|website"].sales === "agency");

  // native month dispatch — reuses v1 chain for the channel slice.
  const mayAmz = computeMonthChannelCM({ facts: v2facts, month: "2026-05", channel: "amazon", costs: v2costs });
  ok("V2 native coverage label", mayAmz.coverage === "native");
  assert("V2 native May amz netRev", mayAmz.netRev, 1000);
  assert("V2 native May amz cm1 (1000-500)", mayAmz.cm1, 500);
  assert("V2 native May amz cm2 (500-250 fee)", mayAmz.cm2, 250);
  // ad: direct 200 only (no channel total override) → cm3 = 250-200 = 50.
  assert("V2 native May amz cm3", mayAmz.cm3, 50);
  ok("V2 native ad basis = actual", mayAmz.adBasis === AD_BASIS.ACTUAL);

  // agency month dispatch — channel-grain CM, COGS via snell SKU units.
  // April amazon: net 6000. COGS = 4×100 + 4×300 = 1600 (all 8 units priced).
  // cm1 = 6000-1600 = 4400; fee .25×6000=1500 → cm2 2900; ad 1500 → cm3 1400.
  const aprAmz = computeMonthChannelCM({ facts: v2facts, month: "2026-04", channel: "amazon", costs: v2costs });
  ok("V2 April coverage = agency", aprAmz.coverage === "agency");
  assert("V2 April amz netRev", aprAmz.netRev, 6000);
  assert("V2 April amz cogs (4×100+4×300)", aprAmz.cogs, 1600);
  assert("V2 April amz cm1", aprAmz.cm1, 4400);
  assert("V2 April amz cm2", aprAmz.cm2, 2900);
  assert("V2 April amz cm3", aprAmz.cm3, 1400);
  ok("V2 April amz cogs fully covered (not approx)", aprAmz.cogsApprox !== true && aprAmz.cogsCovered === true);
  ok("V2 April ad basis = agency", aprAmz.adBasis === AD_BASIS.AGENCY);

  // website agency net derivation: gross 1050 → net 1000 (÷1.05). No SKU units →
  // no COGS card → cm1 null (honest gap, NOT a fabricated margin).
  const mayWeb = computeMonthChannelCM({ facts: v2facts, month: "2026-05", channel: "website", costs: v2costs });
  assert("V2 website net derived (1050/1.05)", mayWeb.netRev, 1000);
  ok("V2 website net flagged derived", mayWeb.netDerived === true);
  ok("V2 website cm1 null (no COGS units)", mayWeb.cm1 === null && mayWeb.cogsCovered === false);

  // 'none' coverage → no CM, no fabricated margin.
  const noneCh = computeMonthChannelCM({ facts: v2facts, month: "2026-05", channel: "flipkart", costs: v2costs });
  ok("V2 none coverage → no CM", noneCh.coverage === "none" && noneCh.cm1 === null && noneCh.cm3 === null);

  // computeCMv2 month rollup: May = amazon native + website agency.
  const v2may = computeCMv2({ facts: v2facts, month: "2026-05", costs: v2costs });
  ok("V2 month rollup coverageNote mixed", v2may.coverageNote === "mixed: native + agency channels");
  assert("V2 month rollup netRev (1000 native + 1000 web)", v2may.company.netRev, 2000);
  ok("V2 month rollup cogsCovered false (website unpriced)", v2may.company.cogsCovered === false);

  // monthsAvailable: 3 months, June flagged partial.
  const ma = monthsAvailable(v2facts);
  ok("V2 monthsAvailable count = 3", ma.length === 3);
  ok("V2 monthsAvailable ascending", ma[0].month === "2026-04" && ma[2].month === "2026-06");
  ok("V2 June month partial", ma.find((x) => x.month === "2026-06").partial === true);

  // monthlyNetRevByChannel headline model.
  const hl = monthlyNetRevByChannel(v2facts, { lastN: 13 });
  ok("V2 headline has amazon+blinkit+website channels",
    hl.channels.includes("amazon") && hl.channels.includes("blinkit") && hl.channels.includes("website"));
  const aprRow = hl.table.find((r) => r.month === "2026-04");
  assert("V2 headline April amazon netRev", aprRow.amazon, 6000);
  ok("V2 headline April amazon basis agency", hl.rows.amazon["2026-04"].basis === "agency");
  ok("V2 headline May amazon basis native", hl.rows.amazon["2026-05"].basis === "native");

  // guardRatio — the 16276%-ACOS killer.
  const sameWin = guardRatio({ numerator: 50, denominator: 1000, numWindow: "2026-05|amazon|agency", denWindow: "2026-05|amazon|agency", kind: "acos" });
  ok("V2 guard same-window ACOS computes", !sameWin.suppressed && Math.abs(sameWin.value - 0.05) < 1e-9);
  const crossWin = guardRatio({ numerator: 50, denominator: 1000, numWindow: "2026-05|amazon|agency", denWindow: "2026-06|amazon|native", kind: "acos" });
  ok("V2 guard cross-window suppressed", crossWin.suppressed && crossWin.reason === "window-mismatch");
  const zeroDen = guardRatio({ numerator: 50, denominator: 0, numWindow: "w", denWindow: "w", kind: "acos" });
  ok("V2 guard zero-denominator suppressed (no Infinity)", zeroDen.suppressed && zeroDen.value === null);
  const absurdAcos = guardRatio({ numerator: 16276, denominator: 100, numWindow: "2026-05|mixed", denWindow: "2026-06|mixed", kind: "acos" });
  ok("V2 guard absurd mixed-tier ACOS suppressed", absurdAcos.suppressed);

  // ARTIFACT REROUTE (V2.2 returns-tail / stray-date): a "native" month×channel
  // whose native revenue is a sliver of the agency shadow reroutes to agency CM.
  const artFacts = {
    monthly: {
      // April amazon: 2 stray native cells (sliver ₹3,690) + suppressed __ch__ (ad survives).
      "2026-04|amazon|NSSBDB500": { units: 3, netRev: 3000, grossRev: 3150 },
      "2026-04|amazon|NSSBDB100": { units: 1, netRev: 690, grossRev: 725 },
      "2026-04|amazon|__ch__": { units: 0, netRev: 0, grossRev: 0, adSpend: 269860, revSuppressed: true, tier: "agency" },
    },
    meta: {
      // V2.1 retained the suppressed agency revenue here.
      agencyShadow: { "2026-04|amazon": { units: 1145, netRev: 909594, grossRev: 1068835, tier: "agency", source: "snell-history" } },
      bySource: { "snell-sku-units": { monthly: { "2026-04|amazon|NSSB100": 200, "2026-04|amazon|NSSB250": 100 } } },
    },
  };
  const art = computeMonthChannelCM({ facts: artFacts, month: "2026-04", channel: "amazon", costs: v2costs });
  ok("V2 artifact reroute → agency coverage", art.coverage === "agency" && art.artifactReroute === true);
  assert("V2 artifact netRev = shadow 909594", art.netRev, 909594);
  assert("V2 artifact nativeSliver recorded", Math.round(art.nativeSliver), 3690);
  ok("V2 artifact ad basis = agency (ad survived suppression)", art.adBasis === AD_BASIS.AGENCY && art.adSpend === 269860);
  ok("V2 artifact CM3% sane (not -9000%)", art.pcts.cm3 > -5 && art.pcts.cm3 < 1);
  // A GENUINE native month (native ≈ full agency) must NOT reroute.
  const genuineFacts = {
    monthly: {
      "2026-05|amazon|NSSB100": { units: 5, netRev: 900000, grossRev: 945000, adSpendDirect: 100 },
      "2026-05|amazon|__ch__": { units: 0, netRev: 0, grossRev: 0, adSpend: 300000, revSuppressed: true },
    },
    meta: { agencyShadow: { "2026-05|amazon": { netRev: 910000, grossRev: 955000, units: 1000 } } },
  };
  const genuine = computeMonthChannelCM({ facts: genuineFacts, month: "2026-05", channel: "amazon", costs: v2costs });
  ok("V2 genuine native NOT rerouted (native≈agency)", genuine.coverage === "native" && !genuine.artifactReroute);

  // FORMATTING / SANITY walk: every emitted number across all computeMonthChannelCM
  // outputs must be finite-or-null, never NaN/Infinity.
  let allFinite = true;
  for (const month of ["2026-04", "2026-05", "2026-06"]) {
    for (const ch of ["amazon", "flipkart", "blinkit", "website"]) {
      const r = computeMonthChannelCM({ facts: v2facts, month, channel: ch, costs: v2costs });
      for (const k of ["netRev", "units", "cogs", "cm1", "fees", "cm2", "adSpend", "cm3"]) {
        const v = r[k];
        if (v !== null && !Number.isFinite(v)) { allFinite = false; console.log(`  non-finite ${month}|${ch}.${k} = ${v}`); }
      }
      for (const k of ["cm1", "cm2", "cm3"]) {
        const v = r.pcts[k];
        if (v !== null && !Number.isFinite(v)) { allFinite = false; console.log(`  non-finite pct ${month}|${ch}.${k} = ${v}`); }
      }
    }
  }
  ok("V2 every emitted number finite-or-null (no NaN/Infinity)", allFinite);

  console.log("cmEngine self-test complete.");
}
