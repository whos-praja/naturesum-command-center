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
 */
import * as defaultCosts from "./costInputs.js";

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

// Channel ad TOTALS carried in the fact store's meta (the bundled baseline /
// any upload bakes Snell's per-channel agency spend + Monarch's website
// Google+Meta totals into meta.bySource — see businessStore). These are the
// authoritative channel totals when the user hasn't typed a manual override.
// SAFE: any missing source → that channel simply absent from the map (engine
// then falls back to Σ direct, i.e. zero unattributed). NaN-free.
//
// PRECEDENCE for a channel's total (step 3): explicit adSpendOverride param →
// localStorage manual override → THIS meta-derived total → Σ direct.
export function deriveChannelAdTotals(facts) {
  const out = {};
  const bySource = facts && facts.meta && facts.meta.bySource ? facts.meta.bySource : null;
  if (!bySource) return out;
  // Snell Sale-tab: per-channel agency spend (amazon AMS, flipkart, blinkit).
  const snell = bySource["snell-agency"]?.snellChannelSpend;
  if (snell) {
    if (Number.isFinite(Number(snell.amazon))) out.amazon = Number(snell.amazon);
    if (Number.isFinite(Number(snell.flipkart))) out.flipkart = Number(snell.flipkart);
    if (Number.isFinite(Number(snell.blinkit))) out.blinkit = Number(snell.blinkit);
  }
  // Monarch: website channel total = Google + Meta (spec §3 website row).
  const mon = bySource["monarch-web"]?.monarchWebSpend;
  if (mon) {
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
  const metaTotals = deriveChannelAdTotals(facts); // {} when no meta present
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

  console.log("cmEngine self-test complete.");
}
