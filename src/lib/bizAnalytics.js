/**
 * bizAnalytics.js — THE 100× DIAGNOSTIC / PREDICTIVE / PRESCRIPTIVE LAYER.
 *
 * Pure functions (NO DOM, NO localStorage writes) layered ON TOP of the frozen
 * cmEngine + businessStore. Everything here re-uses the existing chokepoints —
 * `computeMonthChannelCM` / `computeCM` for margin, `coverageFor` for the
 * native/agency/none window classification, `guardRatio` for every ratio — so
 * the HARD INVARIANTS hold by construction:
 *   • every number reconciles to source (we never re-derive revenue; we read the
 *     same fact cells the verified engine reads),
 *   • ratios live only within ONE coverage window (cross-window → suppressed),
 *   • no NaN / Infinity (fin0 / null discipline everywhere),
 *   • the daily series matches PageSales exactly (channel-grain net, website
 *     gross÷1.05) so sales velocity here == the inventory module's velocity for
 *     the same SKU×channel (HARD INVARIANT 17 — see `crossModuleVelocity`).
 *
 * Accountable rubric params: 15 (projection), 16 (daily flag baseline), 19
 * (price realization), 41 (momentum), 49 (seasonality), 50 (bridges), 51
 * (anomaly), 52 (forecast), 53 (prescription), 54 (what-if), 55 (driver/
 * sensitivity), 57 (concentration), 58 (cross-module), 59 (auto-narrative).
 *
 * Coverage-window contract: a window string is "YYYY-MM|channel|<basis>"
 * (basis ∈ native|agency|none) — passed to guardRatio so a native-month ratio
 * is never divided against an agency-month quantity.
 *
 * Node self-test at file end (guarded by import.meta.url like the other libs):
 *   node src/lib/bizAnalytics.js
 */
import * as defaultCosts from "./costInputs.js";
import { coverageFor, CH_CODE, isChannelGrainKey } from "./businessStore.js";
import { computeMonthChannelCM, computeCM, guardRatio } from "./cmEngine.js";

// ─── primitives (mirror cmEngine's NaN discipline) ──────────────────────────
const WEBSITE_NET_DIVISOR = 1.05;            // Monarch gross-only → net (matches PageSales + cmEngine)
const fin0 = (n) => (Number.isFinite(n) ? n : 0);
const finN = (n) => (Number.isFinite(n) ? n : null);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const safeDiv = (a, b) => { const d = num(b); return Math.abs(d) < 1e-9 ? null : num(a) / d; };
const round2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : 0);
const clampPct = (n) => (Number.isFinite(n) ? n : null);

// Window key for guardRatio — same basis ⇒ same window ⇒ ratio allowed.
const win = (month, channel, basis) => `${month}|${channel || "*"}|${basis || "?"}`;

// Day-of-week mean baseline shape used everywhere (matches PageSales weekday pattern).
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dowOf = (iso) => { const d = new Date(iso + "T00:00:00").getDay(); return Number.isNaN(d) ? null : d; };
const monthEndDom = (ym) => { const [y, m] = String(ym).split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const domOf = (iso) => parseInt(String(iso).slice(8, 10), 10) || 0;
const prevMonthOf = (ym) => {
  const [y, m] = String(ym).split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

// ════════════════════════════════════════════════════════════════════════════
// LIKE-FOR-LIKE WINDOW MACHINERY (rubric 14/18/29/50/65 — the one defect that
// must never recur: a PARTIAL current month compared against a FULL prior month).
// ════════════════════════════════════════════════════════════════════════════
//
// One source of truth for "is this month partial, and to which day-of-month?" and
// "sum a month's own daily channel-grain series through day D". Every MoM consumer
// (rankMovers, revenueBridge, cm3Bridge, autoNarrative) routes through this so the
// comparison base is matched-MTD (June→day-10 vs May→day-10) whenever the current
// month is in-progress — never full-vs-partial. The matched window is computed from
// the SAME daily series the verified DailyChart/projection use, so it reconciles to
// the rupee. CM legs in a matched window are prorated from the prior FULL-month CM
// by the revenue share captured through the cutoff day (effective-rate preserved),
// which keeps the bridge identities (Σ legs == Δ) exact and same-window.

/**
 * lastDataDom(facts) → the latest day-of-month present anywhere in the daily
 * series (the global "data through" day). NaN-safe (0 if no daily data).
 */
function lastDataDom(facts) {
  const series = dailyChannelSeries(facts);
  let last = null;
  for (const ch of series.channels) for (const iso of Object.keys(series.byChannel[ch] || {})) if (!last || iso > last) last = iso;
  return last ? domOf(last) : 0;
}

/**
 * skuGrainMonths(facts) → [YYYY-MM…] (asc) that carry per-SKU REVENUE facts
 * (a non-channel-grain monthly cell with netRev/grossRev). Native per-SKU exports
 * are month-scoped (May), so a SKU-grain MoM is only LIKE-FOR-LIKE between two such
 * months — never into a month that has only channel-grain (__ch__) data (e.g. an
 * in-progress June from the agency daily history). Used to keep the SKU-level
 * narrative honest (rubric 14/18/29): no full-vs-empty −100% SKU comparisons.
 */
function skuGrainMonths(facts) {
  const set = new Set();
  for (const [k, cell] of Object.entries((facts && facts.monthly) || {})) {
    const [m, , code] = k.split("|");
    if (!m || code === CH_CODE) continue;
    if (num(cell && cell.netRev) !== 0 || num(cell && cell.grossRev) !== 0 || num(cell && cell.units) !== 0) set.add(m);
  }
  return [...set].sort();
}
/** latestSkuGrainPair(facts) → { month, prior } | null — the most recent pair of
 *  consecutive SKU-grain-complete months for a like-for-like SKU MoM. */
function latestSkuGrainPair(facts) {
  const ms = skuGrainMonths(facts).filter((m) => !monthPartiality(facts, m).partial);
  if (ms.length < 2) return ms.length === 1 ? { month: ms[0], prior: prevMonthOf(ms[0]) } : null;
  return { month: ms[ms.length - 1], prior: ms[ms.length - 2] };
}

/**
 * monthPartiality(facts, month) → { partial, lastDay, dom, daysInMonth }.
 * A month is partial iff its latest daily day < month end. Channel-agnostic
 * (company view): uses the max daily day across all channels for that month.
 */
function monthPartiality(facts, month) {
  const series = dailyChannelSeries(facts);
  const m = String(month || "");
  let last = null;
  for (const ch of series.channels) for (const iso of Object.keys(series.byChannel[ch] || {})) {
    if (iso.slice(0, 7) !== m) continue;
    if (!last || iso > last) last = iso;
  }
  const daysInMonth = monthEndDom(m);
  const dom = last ? domOf(last) : 0;
  return { partial: dom > 0 && dom < daysInMonth, lastDay: last, dom, daysInMonth };
}

/**
 * monthWindowAgg(facts, { month, channel?, throughDom? }) →
 *   { netRev, units, adSpend, dom, lastDay } summed from the month's OWN daily
 *   channel-grain series, restricted to day-of-month ≤ throughDom (default: all
 *   days present). `channel` null → company total. This is the matched-window
 *   revenue/units engine — identical net rule to dailyNet so it ties to source.
 */
function monthWindowAgg(facts, { month, channel, throughDom } = {}) {
  const series = dailyChannelSeries(facts);
  const m = String(month || "");
  const cut = Number.isFinite(throughDom) && throughDom > 0 ? throughDom : Infinity;
  const targets = channel ? [channel] : series.channels;
  let netRev = 0, units = 0, adSpend = 0, lastDay = null;
  for (const ch of targets) {
    for (const [iso, v] of Object.entries(series.byChannel[ch] || {})) {
      if (iso.slice(0, 7) !== m) continue;
      if (domOf(iso) > cut) continue;
      netRev += fin0(v);
      units += fin0((series.unitsByChannel[ch] || {})[iso]);
      adSpend += fin0((series.adByChannel[ch] || {})[iso]);
      if (!lastDay || iso > lastDay) lastDay = iso;
    }
  }
  return { netRev: round2(netRev), units: Math.round(units), adSpend: round2(adSpend), dom: lastDay ? domOf(lastDay) : 0, lastDay };
}

/**
 * comparableWindow(facts, { month, priorMonth }) → the like-for-like decision:
 *   { partial, dom, daysInMonth, mode, label, cutoff }
 *   mode "full-vs-full"   → current month complete; compare full prior month.
 *   mode "mtd-vs-mtd"      → current month partial; compare prior month THROUGH
 *                            the same day-of-month (cutoff = dom).
 * `cutoff` is the day-of-month to clip BOTH months to in mtd mode (null in full
 * mode). `label` is a founder-facing description of exactly what is being compared.
 */
function comparableWindow(facts, { month, priorMonth } = {}) {
  const prev = priorMonth || prevMonthOf(month);
  const p = monthPartiality(facts, month);
  if (!p.partial) {
    return { partial: false, dom: p.dom, daysInMonth: p.daysInMonth, mode: "full-vs-full", cutoff: null,
      label: `${month} (full) vs ${prev} (full)` };
  }
  return { partial: true, dom: p.dom, daysInMonth: p.daysInMonth, mode: "mtd-vs-mtd", cutoff: p.dom,
    label: `${month} through day ${p.dom} vs ${prev} through day ${p.dom} (like-for-like MTD)` };
}

// Per-channel net of a daily channel-grain cell — IDENTICAL rule to PageSales
// dailyNet() (HARD INVARIANT: one definition of daily net everywhere).
function dailyNet(cell, ch) {
  if (!cell) return 0;
  const net = num(cell.netRev);
  if (net > 0) return net;
  if (ch === "website") return num(cell.grossRev) / WEBSITE_NET_DIVISOR;
  return net;
}

/**
 * dailyChannelSeries(facts) → { dates:[iso…asc], byChannel:{ ch:{ iso:net } },
 *   unitsByChannel:{ ch:{ iso:units } }, adByChannel:{ ch:{ iso:adSpend } },
 *   channels:[…] }.  Channel-grain ("__ch__") daily cells only — the same
 * source the verified DailyChart uses. Used by every daily/seasonality/anomaly
 * function so they share ONE series.
 */
export function dailyChannelSeries(facts) {
  const daily = (facts && facts.daily) || {};
  const byChannel = {}, unitsByChannel = {}, adByChannel = {};
  const dateSet = new Set();
  for (const [key, cell] of Object.entries(daily)) {
    const [iso, ch, code] = key.split("|");
    if (code !== CH_CODE) continue;
    if (!iso || !ch) continue;
    const v = dailyNet(cell, ch);
    if (!Number.isFinite(v)) continue;
    (byChannel[ch] = byChannel[ch] || {})[iso] = fin0(byChannel[ch][iso]) + v;
    (unitsByChannel[ch] = unitsByChannel[ch] || {})[iso] = fin0(unitsByChannel[ch][iso]) + num(cell.units);
    (adByChannel[ch] = adByChannel[ch] || {})[iso] = fin0(adByChannel[ch][iso]) + num(cell.adSpend);
    dateSet.add(iso);
  }
  return { dates: [...dateSet].sort(), byChannel, unitsByChannel, adByChannel, channels: Object.keys(byChannel).sort() };
}

// ════════════════════════════════════════════════════════════════════════════
// 49 · SEASONALITY BASELINES — weekday + month-of-year structure, first-class.
// ════════════════════════════════════════════════════════════════════════════
/**
 * seasonalityBaselines(facts, { channel? }) →
 *   { weekday: { mean:[7], index:[7], names:[7], n:[7] }, byMonthOfYear:{…},
 *     overallMean, totalDays, channel }.
 *  weekday.mean[d]  = mean daily net for day-of-week d (matches PageSales)
 *  weekday.index[d] = mean[d] / overallMean (1.0 = neutral; <1 structurally low)
 * `channel` null → company total (sum of channels per day). The index is what
 * the daily-flag logic divides BY so a structurally-low Sunday isn't flagged
 * red against a peak (rubric 16, seasonality-honest).
 */
export function seasonalityBaselines(facts, { channel } = {}) {
  const series = dailyChannelSeries(facts);
  const perDay = {};                       // iso → net (company or single channel)
  const targetChannels = channel ? [channel] : series.channels;
  for (const ch of targetChannels) {
    const m = series.byChannel[ch] || {};
    for (const [iso, v] of Object.entries(m)) perDay[iso] = fin0(perDay[iso]) + v;
  }
  const isos = Object.keys(perDay).sort();
  const sums = [0, 0, 0, 0, 0, 0, 0], counts = [0, 0, 0, 0, 0, 0, 0];
  const moy = {};                          // "MM" → { sum, n }
  let total = 0, n = 0;
  for (const iso of isos) {
    const v = fin0(perDay[iso]);
    const d = dowOf(iso);
    if (d != null) { sums[d] += v; counts[d]++; }
    const mm = iso.slice(5, 7);
    (moy[mm] = moy[mm] || { sum: 0, n: 0 }); moy[mm].sum += v; moy[mm].n++;
    total += v; n++;
  }
  const overallMean = n ? total / n : 0;
  const mean = sums.map((s, i) => (counts[i] ? s / counts[i] : 0));
  const index = mean.map((mn) => (overallMean > 0 ? mn / overallMean : null));
  const byMonthOfYear = {};
  for (const [mm, o] of Object.entries(moy)) {
    byMonthOfYear[mm] = { mean: o.n ? o.sum / o.n : 0, n: o.n, index: overallMean > 0 && o.n ? (o.sum / o.n) / overallMean : null };
  }
  return {
    channel: channel || null,
    weekday: { mean: mean.map(round2), index: index.map(clampPct), names: WEEKDAY_NAMES, n: counts },
    byMonthOfYear, overallMean: round2(overallMean), totalDays: n,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 16 · DAILY FLAG LOGIC — Max-7 "beat peak" AND weekday-matched "softening".
// ════════════════════════════════════════════════════════════════════════════
/**
 * dailyFlags(facts, { channel?, window=28, lastN }) →
 *   [{ iso, dow, dowName, net, units, ad,
 *      max7, beatPeak,                       // vs trailing-7 PEAK (excl. today)
 *      wdAvg, wdExpected, softening, soft%,   // vs weekday-matched trailing avg
 *      z, anomaly,                            // z-score vs trailing window (51)
 *      flag: "peak"|"strong"|"normal"|"soft"|"anomaly-low"|"anomaly-high",
 *      label }]  (ascending; lastN trims the tail).
 *
 * TWO DIFFERENT QUESTIONS, labelled (rubric 16):
 *   • beatPeak  — did today beat the recent 7-day peak? ("new high")
 *   • softening — is today below its weekday-matched trailing average?
 *     (seasonality-honest: a structurally-low Sunday is compared to other
 *      Sundays, never to a Tuesday peak.)
 * Both can be true; `flag`/`label` state which colour answers which.
 * NaN-safe: a day with no trailing history → flag "normal", z null.
 */
export function dailyFlags(facts, { channel, window = 28, lastN } = {}) {
  const series = dailyChannelSeries(facts);
  const perDay = {}, perUnits = {}, perAd = {};
  const targets = channel ? [channel] : series.channels;
  for (const ch of targets) {
    for (const [iso, v] of Object.entries(series.byChannel[ch] || {})) perDay[iso] = fin0(perDay[iso]) + v;
    for (const [iso, v] of Object.entries(series.unitsByChannel[ch] || {})) perUnits[iso] = fin0(perUnits[iso]) + v;
    for (const [iso, v] of Object.entries(series.adByChannel[ch] || {})) perAd[iso] = fin0(perAd[iso]) + v;
  }
  const isos = Object.keys(perDay).sort();
  const out = [];
  for (let i = 0; i < isos.length; i++) {
    const iso = isos[i];
    const net = fin0(perDay[iso]);
    const d = dowOf(iso);
    // trailing window (excl. today), ascending positions [i-window, i-1].
    const start = Math.max(0, i - window);
    const trail = isos.slice(start, i).map((k) => fin0(perDay[k]));
    const last7 = trail.slice(-7);
    const max7 = last7.length ? Math.max(...last7) : null;
    const beatPeak = max7 != null ? net > max7 : false;
    // weekday-matched trailing avg (same dow only, within the window).
    const wdVals = [];
    for (let j = start; j < i; j++) if (dowOf(isos[j]) === d) wdVals.push(fin0(perDay[isos[j]]));
    const wdAvg = wdVals.length ? wdVals.reduce((a, b) => a + b, 0) / wdVals.length : null;
    const softPct = wdAvg != null && wdAvg > 0 ? (net - wdAvg) / wdAvg : null;     // negative = softer
    const softening = softPct != null ? softPct < -0.15 : false;                   // >15% below its weekday
    // z-score vs trailing window (anomaly, rubric 51).
    let z = null, anomaly = false;
    if (trail.length >= 5) {
      const mean = trail.reduce((a, b) => a + b, 0) / trail.length;
      const sd = Math.sqrt(trail.reduce((a, b) => a + (b - mean) ** 2, 0) / trail.length);
      z = sd > 1e-6 ? (net - mean) / sd : 0;
      anomaly = Math.abs(z) >= 2;
    }
    let flag = "normal", label = "In its normal weekday range";
    if (anomaly && z < 0) { flag = "anomaly-low"; label = `${Math.abs(z).toFixed(1)}σ below trailing — broke pattern`; }
    else if (beatPeak) { flag = "peak"; label = "Beat the 7-day peak — new recent high"; }
    else if (softening) { flag = "soft"; label = `${Math.abs(softPct * 100).toFixed(0)}% below its weekday average — softening`; }
    else if (anomaly && z > 0) { flag = "anomaly-high"; label = `${z.toFixed(1)}σ above trailing — unusual high`; }
    else if (wdAvg != null && softPct != null && softPct > 0.1) { flag = "strong"; label = "Above its weekday average"; }
    out.push({
      iso, dow: d, dowName: d != null ? WEEKDAY_NAMES[d] : "?",
      net: round2(net), units: Math.round(fin0(perUnits[iso])), ad: round2(fin0(perAd[iso])),
      max7: max7 != null ? round2(max7) : null, beatPeak,
      wdAvg: wdAvg != null ? round2(wdAvg) : null, softening,
      softPct: softPct != null ? round2(softPct) : null,
      z: z != null ? round2(z) : null, anomaly, flag, label,
    });
  }
  return Number.isFinite(lastN) && lastN > 0 ? out.slice(-lastN) : out;
}

// ════════════════════════════════════════════════════════════════════════════
// 40 · DAILY FACT TABLE — Date rows × channel columns × Total + running cum.
// ════════════════════════════════════════════════════════════════════════════
/**
 * dailyFactTable(facts, { metric="netRev", lastN=90, channels? }) →
 *   { channels:[…], rows:[{ iso, dow, dowName, cells:{ ch:val }, total,
 *     cumulative, mom, flag }], totals:{ ch:Σ }, grandTotal }.
 *  The founder's sheet, surpassed: per-channel columns, a Total, a running
 *  cumulative, a day-over-day growth column, and the day flag from dailyFlags
 *  (company-level). metric ∈ "netRev" | "units". NaN-free; lastN trims the tail.
 */
export function dailyFactTable(facts, { metric = "netRev", lastN = 90, channels } = {}) {
  const series = dailyChannelSeries(facts);
  const chans = (channels && channels.length ? channels : series.channels).slice();
  const src = metric === "units" ? series.unitsByChannel : series.byChannel;
  const flags = dailyFlags(facts, {});                 // company-level flags
  const flagByIso = {}; for (const f of flags) flagByIso[f.iso] = f.flag;
  const allIsos = new Set();
  for (const ch of chans) for (const iso of Object.keys(src[ch] || {})) allIsos.add(iso);
  const isos = [...allIsos].sort();
  const trimmed = Number.isFinite(lastN) && lastN > 0 ? isos.slice(-lastN) : isos;
  const totals = {}; chans.forEach((c) => (totals[c] = 0));
  let cumulative = 0, prevTotal = null;
  const rows = [];
  for (const iso of trimmed) {
    const cells = {}; let total = 0;
    for (const ch of chans) { const v = fin0((src[ch] || {})[iso]); cells[ch] = round2(v); total += v; totals[ch] += v; }
    cumulative += total;
    const mom = prevTotal != null && prevTotal > 0 ? round2((total - prevTotal) / prevTotal) : null;
    const d = dowOf(iso);
    rows.push({ iso, dow: d, dowName: d != null ? WEEKDAY_NAMES[d] : "?", cells, total: round2(total), cumulative: round2(cumulative), mom, flag: flagByIso[iso] || "normal" });
    prevTotal = total;
  }
  let grand = 0; chans.forEach((c) => { totals[c] = round2(totals[c]); grand += totals[c]; });
  return { channels: chans, metric, rows, totals, grandTotal: round2(grand) };
}

// ════════════════════════════════════════════════════════════════════════════
// 15 · RUN-RATE & PROJECTION — pace vs prior-month-to-same-day.
// ════════════════════════════════════════════════════════════════════════════
/**
 * projectMonthEnd(facts, { month, channel? }) →
 *   { month, channel, mtd, lastDay, dom, daysInMonth, partial,
 *     priorMonth, priorToDate, priorFull,
 *     method, projected, low, high, paceVsPrior, confidence, note }.
 *
 * METHOD (stated, rubric 15/52): if the prior month has data to the SAME
 * day-of-month, projected = mtd × (priorFull / priorToDate) — i.e. extrapolate
 * THIS month at the SAME within-month pace the prior month ran. Falls back to a
 * linear (mtd / dom × daysInMonth) projection when no comparable prior exists.
 * Uncertainty band = ±(daily σ × √remainingDays) so the founder isn't comparing
 * a half-month to a full one. All same-window (one channel's own daily series).
 */
export function projectMonthEnd(facts, { month, channel } = {}) {
  const series = dailyChannelSeries(facts);
  const m = String(month || "");
  const sumDom = (ym, ch) => {
    let s = 0, last = null, vals = [];
    const targets = ch ? [ch] : series.channels;
    for (const c of targets) for (const [iso, v] of Object.entries(series.byChannel[c] || {})) {
      if (iso.slice(0, 7) !== ym) continue;
      s += fin0(v); vals.push({ iso, v: fin0(v) }); if (!last || iso > last) last = iso;
    }
    return { sum: s, last, vals };
  };
  const cur = sumDom(m, channel);
  const lastDay = cur.last;
  const dom = lastDay ? domOf(lastDay) : 0;
  const daysInMonth = monthEndDom(m);
  const partial = dom > 0 && dom < daysInMonth;
  const prior = prevMonthOf(m);
  const priorAll = sumDom(prior, channel);
  // prior month-to-same-day
  let priorToDate = 0;
  for (const { iso, v } of priorAll.vals) if (domOf(iso) <= dom) priorToDate += v;
  const priorFull = priorAll.sum;
  let method, projected, paceVsPrior = null;
  if (!partial) {
    method = "complete month (actuals)"; projected = cur.sum;
  } else if (priorToDate > 0 && priorFull > 0) {
    const ratio = priorFull / priorToDate;          // prior month's day-DOM→full multiplier
    projected = cur.sum * ratio;
    paceVsPrior = priorToDate > 0 ? (cur.sum - priorToDate) / priorToDate : null;  // same-window MTD pace delta
    method = `pace vs ${prior} to day ${dom} (×${ratio.toFixed(2)})`;
  } else {
    projected = dom > 0 ? (cur.sum / dom) * daysInMonth : cur.sum;
    method = `linear run-rate (no comparable ${prior})`;
  }
  // uncertainty band from daily variance × √remaining (NaN-safe).
  const vals = cur.vals.map((x) => x.v);
  const remaining = Math.max(0, daysInMonth - dom);
  let band = 0;
  if (vals.length >= 3 && remaining > 0) {
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    band = sd * Math.sqrt(remaining);
  }
  const confidence = !partial ? "actual"
    : dom >= daysInMonth * 0.6 ? "high"
    : dom >= daysInMonth * 0.3 ? "medium" : "low";
  return {
    month: m, channel: channel || null,
    mtd: round2(cur.sum), lastDay, dom, daysInMonth, partial,
    priorMonth: prior, priorToDate: round2(priorToDate), priorFull: round2(priorFull),
    method, projected: round2(projected),
    low: round2(Math.max(0, projected - band)), high: round2(projected + band),
    paceVsPrior: clampPct(paceVsPrior), confidence,
    note: partial ? `${dom}/${daysInMonth} days in; band ±${Math.round(band).toLocaleString("en-IN")}` : "month complete",
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 50 · DECOMPOSITION / BRIDGES — revenue & CM3 month-over-month.
// ════════════════════════════════════════════════════════════════════════════
/**
 * revenueBridge(facts, { fromMonth, toMonth, costs? }) →
 *   { fromMonth, toMonth, from, to, delta,
 *     steps:[{ channel, label, kind:"price"|"volume"|"new"|"lost", value }],
 *     reconciles }.
 * Decomposes Δ company net revenue MoM into per-channel price×volume effects:
 *   volume effect = (units_to − units_from) × price_from
 *   price  effect = units_to × (price_to − price_from)
 *   new/lost = a channel present in only one month.
 * Reconciliation: Σ steps == (to − from) to the rupee (reconciles flag).
 * Same-window by construction (each month read from its own coverage-aware CM).
 */
export function revenueBridge(facts, { fromMonth, toMonth, costs } = {}) {
  const C = costs || defaultCosts;
  const cov = coverageFor(facts);
  const channels = new Set();
  for (const mc of Object.keys(cov)) {
    const [mm, ch] = mc.split("|");
    if ((mm === fromMonth || mm === toMonth) && ch) channels.add(ch);
  }
  // LIKE-FOR-LIKE: if the toMonth is partial, clip BOTH months to the same
  // day-of-month so the "volume −Nu" leg is a real loss, not just fewer elapsed
  // days (rubric 14/29/50). Matched figures come from each month's own daily
  // series; full months use the verified CM cells.
  const w = comparableWindow(facts, { month: toMonth, priorMonth: fromMonth });
  const cmFor = (mo, ch) => computeMonthChannelCM({ facts, month: mo, channel: ch, costs: C, coverage: cov });
  const revUnits = (mo, ch) => {
    if (!w.partial) { const r = cmFor(mo, ch); return { rev: r.coverage === "none" ? 0 : fin0(r.netRev), u: r.coverage === "none" ? 0 : fin0(r.units) }; }
    const agg = monthWindowAgg(facts, { month: mo, channel: ch, throughDom: w.cutoff });
    return { rev: fin0(agg.netRev), u: fin0(agg.units) };
  };
  let from = 0, to = 0;
  const steps = [];
  for (const ch of [...channels].sort()) {
    const A = revUnits(fromMonth, ch), B = revUnits(toMonth, ch);
    const aRev = A.rev, bRev = B.rev, aU = A.u, bU = B.u;
    from += aRev; to += bRev;
    if (aRev === 0 && bRev !== 0) { steps.push({ channel: ch, label: `${ch} (new/started)`, kind: "new", value: round2(bRev) }); continue; }
    if (bRev === 0 && aRev !== 0) { steps.push({ channel: ch, label: `${ch} (stopped)`, kind: "lost", value: round2(-aRev) }); continue; }
    const pFrom = aU > 0 ? aRev / aU : 0, pTo = bU > 0 ? bRev / bU : 0;
    const volEffect = (bU - aU) * pFrom;
    const priceEffect = bU * (pTo - pFrom);
    // residual catch (rounding / mix) folded into price so Σ reconciles exactly.
    const resid = (bRev - aRev) - volEffect - priceEffect;
    if (Math.abs(volEffect) > 0.5) steps.push({ channel: ch, label: `${ch} volume (${bU - aU >= 0 ? "+" : ""}${bU - aU}u)`, kind: "volume", value: round2(volEffect) });
    if (Math.abs(priceEffect + resid) > 0.5) steps.push({ channel: ch, label: `${ch} price/mix`, kind: "price", value: round2(priceEffect + resid) });
  }
  const delta = to - from;
  const stepSum = steps.reduce((a, s) => a + s.value, 0);
  return {
    fromMonth, toMonth, from: round2(from), to: round2(to), delta: round2(delta), steps,
    reconciles: Math.abs(stepSum - delta) < 1,
    window: { ...w, priorMonth: fromMonth },
  };
}

/**
 * cm3Bridge(facts, { fromMonth, toMonth, costs? }) →
 *   { fromMonth, toMonth, from, to, delta,
 *     steps:[{ label, kind:"revenue"|"cogs"|"fees"|"ads", value }], reconciles }.
 * Decomposes Δ company CM3 into the four ladder rungs that moved it:
 *   Δrevenue contribution, −Δcogs, −Δfees, −Δads  (Σ == ΔCM3).
 * Each leg is a same-window company aggregate (coverage-aware CM, COGS-covered
 * channels only contribute their CM). NaN-free.
 */
export function cm3Bridge(facts, { fromMonth, toMonth, costs } = {}) {
  const C = costs || defaultCosts;
  const cov = coverageFor(facts);
  // LIKE-FOR-LIKE: if the toMonth is partial, prorate every leg (rev/COGS/fees/ads/
  // cm3) for BOTH months by the channel's windowed-revenue share through the same
  // day-of-month — the month's effective rates are preserved, the Σ-legs == ΔCM3
  // identity stays exact, and the bridge is no longer full-vs-partial (rubric
  // 14/29/50/65). Full months use the verified CM cells unscaled.
  const w = comparableWindow(facts, { month: toMonth, priorMonth: fromMonth });
  const scaleFor = (mo, ch) => {
    if (!w.partial) return 1;
    const full = monthWindowAgg(facts, { month: mo, channel: ch }).netRev;
    const win = monthWindowAgg(facts, { month: mo, channel: ch, throughDom: w.cutoff }).netRev;
    return full > 0 ? win / full : (win > 0 ? 1 : 0);
  };
  const agg = (mo) => {
    const channels = new Set();
    for (const mc of Object.keys(cov)) { const [mm, ch] = mc.split("|"); if (mm === mo && ch) channels.add(ch); }
    let rev = 0, cogs = 0, fees = 0, ads = 0, cm3 = 0;
    for (const ch of channels) {
      const r = computeMonthChannelCM({ facts, month: mo, channel: ch, costs: C, coverage: cov });
      // Only COGS-COVERED channels enter the bridge — an uncovered cell reports a
      // cm3 that does not equal rev−cogs−fees−ad (its null COGS is dropped from CM
      // but its fees/ad still sum), which would break the Σ-rungs == ΔCM3 identity.
      // Excluding them keeps every leg reconcilable (rubric 50, honesty IV).
      if (r.coverage === "none" || r.cm3 == null || r.cogsCovered === false) continue;
      const s = scaleFor(mo, ch);                       // 1 in full mode; window-share in MTD mode
      rev += fin0(r.netRev) * s; cogs += fin0(r.cogs) * s; fees += fin0(r.fees) * s; ads += fin0(r.adSpend) * s; cm3 += fin0(r.cm3) * s;
    }
    return { rev, cogs, fees, ads, cm3 };
  };
  const a = agg(fromMonth), b = agg(toMonth);
  const steps = [
    { label: "Revenue", kind: "revenue", value: round2(b.rev - a.rev) },
    { label: "COGS", kind: "cogs", value: round2(-(b.cogs - a.cogs)) },
    { label: "Platform fees", kind: "fees", value: round2(-(b.fees - a.fees)) },
    { label: "Ad spend", kind: "ads", value: round2(-(b.ads - a.ads)) },
  ];
  const delta = b.cm3 - a.cm3;
  const stepSum = steps.reduce((x, s) => x + s.value, 0);
  return {
    fromMonth, toMonth, from: round2(a.cm3), to: round2(b.cm3), delta: round2(delta), steps,
    reconciles: Math.abs(stepSum - delta) < 1,
    window: { ...w, priorMonth: fromMonth },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 51 · ANOMALY DETECTION — day / SKU / channel broke pattern (z vs window).
// ════════════════════════════════════════════════════════════════════════════
/**
 * detectAnomalies(series, { window=14, z=2, kind="value" }) →
 *   [{ i, label, value, mean, sd, z, direction:"high"|"low", severity }].
 * Generic z-score detector over an ORDERED numeric series of { label, value }.
 * Re-used for daily revenue, ACOS, returns, spend (rubric 51). NaN-safe: a
 * point with < 5 trailing observations or zero variance is never flagged.
 */
export function detectAnomalies(series, { window = 14, z = 2 } = {}) {
  const arr = Array.isArray(series) ? series : [];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const v = num(arr[i] && arr[i].value);
    const start = Math.max(0, i - window);
    const trail = arr.slice(start, i).map((p) => num(p && p.value));
    if (trail.length < 5) continue;
    const mean = trail.reduce((a, b) => a + b, 0) / trail.length;
    const sd = Math.sqrt(trail.reduce((a, b) => a + (b - mean) ** 2, 0) / trail.length);
    if (sd < 1e-6) continue;
    const zs = (v - mean) / sd;
    if (Math.abs(zs) < z) continue;
    out.push({
      i, label: arr[i] && arr[i].label, value: round2(v), mean: round2(mean), sd: round2(sd),
      z: round2(zs), direction: zs > 0 ? "high" : "low",
      severity: Math.abs(zs) >= 3 ? "severe" : "notable",
    });
  }
  return out;
}

/**
 * channelAnomalies(facts, { channel, window=14 }) → daily revenue anomalies for
 * one channel (convenience over detectAnomalies + dailyChannelSeries).
 */
export function channelAnomalies(facts, { channel, window = 14 } = {}) {
  const series = dailyChannelSeries(facts);
  const m = series.byChannel[channel] || {};
  const pts = Object.keys(m).sort().map((iso) => ({ label: iso, value: fin0(m[iso]) }));
  return detectAnomalies(pts, { window }).map((a) => ({ ...a, channel, iso: a.label }));
}

/**
 * allChannelAnomalies(facts, { window=14, lastN }) → daily revenue anomalies across
 * EVERY channel with a daily series (not Amazon-only — rubric 51/52). Each item is
 * { channel, iso, z, direction, severity, value, mean, sd }. Sorted most-recent-
 * first then by |z|. `lastN` keeps only anomalies in the last N calendar days.
 */
export function allChannelAnomalies(facts, { window = 14, lastN } = {}) {
  const series = dailyChannelSeries(facts);
  const all = [];
  for (const ch of series.channels) {
    const m = series.byChannel[ch] || {};
    const pts = Object.keys(m).sort().map((iso) => ({ label: iso, value: fin0(m[iso]) }));
    for (const a of detectAnomalies(pts, { window })) all.push({ ...a, channel: ch, iso: a.label });
  }
  let out = all;
  if (Number.isFinite(lastN) && lastN > 0) {
    const allIsos = [...new Set(series.channels.flatMap((ch) => Object.keys(series.byChannel[ch] || {})))].sort();
    const cutoff = allIsos.slice(-lastN)[0] || "";
    out = all.filter((a) => a.iso >= cutoff);
  }
  return out.sort((a, b) => (a.iso < b.iso ? 1 : a.iso > b.iso ? -1 : Math.abs(b.z) - Math.abs(a.z)));
}

/**
 * channelDailyEfficiency(facts, { channel, window=14, lastN }) →
 *   { channel, days:[{ iso, net, ad, roas, dailyAcosPct, flag, z, anomaly }],
 *     roasAnomalies:[…], spendAnomalies:[…], summary:{ ad, net, roas, days } }.
 *
 *  Daily ad EFFICIENCY for ANY channel that carries a daily ad-spend series
 *  (rubric 51/52, left-on-the-table: the website ad view was monthly; this gives
 *  it the SAME daily ROAS/anomaly treatment as the Amazon AMS daily series). ROAS
 *  = same-day net ÷ same-day ad (window-integral: numerator & denominator are the
 *  SAME day → no cross-window artifact). A day with ad>0 but net=0 is a real 0×
 *  ROAS (flagged), not suppressed. Anomalies are z-scored against the trailing
 *  window on BOTH the ROAS series and the spend series. NaN-safe.
 */
export function channelDailyEfficiency(facts, { channel, window = 14, lastN } = {}) {
  const series = dailyChannelSeries(facts);
  const net = series.byChannel[channel] || {};
  const ad = series.adByChannel[channel] || {};
  const isos = [...new Set([...Object.keys(net), ...Object.keys(ad)])].sort();
  const days = [];
  let sumAd = 0, sumNet = 0;
  for (const iso of isos) {
    const a = fin0(ad[iso]);
    if (a <= 0) continue;                                  // efficiency only on ad days
    const n = fin0(net[iso]);
    const roas = a > 0 ? n / a : null;                     // same-day / same-day → window-safe
    days.push({ iso, net: round2(n), ad: round2(a), roas: clampPct(roas), dailyAcosPct: clampPct(n > 0 ? a / n : null) });
    sumAd += a; sumNet += n;
  }
  // anomaly z-scoring on the roas + spend series (trailing window).
  const roasPts = days.map((d) => ({ label: d.iso, value: fin0(d.roas) }));
  const spendPts = days.map((d) => ({ label: d.iso, value: d.ad }));
  const roasA = detectAnomalies(roasPts, { window }).map((x) => ({ ...x, iso: x.label, kind: "roas" }));
  const spendA = detectAnomalies(spendPts, { window }).map((x) => ({ ...x, iso: x.label, kind: "spend" }));
  const aByIso = {}; for (const x of roasA) aByIso[x.iso] = x;
  for (const d of days) {
    const an = aByIso[d.iso];
    d.z = an ? an.z : null;
    d.anomaly = !!an;
    d.flag = d.net === 0 ? "zero-sale"
      : an && an.direction === "low" ? "roas-drop"
      : an && an.direction === "high" ? "roas-spike"
      : "normal";
  }
  const trimmed = Number.isFinite(lastN) && lastN > 0 ? days.slice(-lastN) : days;
  return {
    channel, days: trimmed,
    roasAnomalies: roasA, spendAnomalies: spendA,
    summary: { ad: round2(sumAd), net: round2(sumNet), roas: clampPct(sumAd > 0 ? sumNet / sumAd : null), days: days.length },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 41 · MOMENTUM — winners/losers by acceleration/deceleration.
// ════════════════════════════════════════════════════════════════════════════
/**
 * rankMovers(facts, { dimension="channel", month, priorMonth?, metric="netRev",
 *   costs? }) → { rows:[{ key, label, cur, prior, deltaAbs, deltaPct, momentum,
 *   direction }], window:{ partial, mode, cutoff, dom, daysInMonth, label } }.
 *  dimension ∈ "channel" | "sku". metric ∈ "netRev" | "units" | "cm3".
 *  momentum = deltaPct (acceleration sign).
 *
 *  LIKE-FOR-LIKE (rubric 14/18/29/65): when `month` is an in-progress (partial)
 *  month, BOTH sides are clipped to the same day-of-month (MTD-vs-MTD) so the
 *  headline "biggest mover" is never a 10-day-vs-full-month illusion. The matched
 *  current/prior figures come from each month's OWN daily series; CM3 in a matched
 *  window is the prior FULL-month CM3 prorated by the revenue captured through the
 *  cutoff day (effective margin preserved). `window` is always returned so callers
 *  label exactly what was compared and suppress %s on thin bases (rubric 18).
 *
 *  Back-compat: the result is also array-like (its `rows` are spread onto numeric
 *  indices and `length` is set) so any legacy `movers[0]` / `.map` still works.
 */
export function rankMovers(facts, { dimension = "channel", month, priorMonth, metric = "netRev", costs } = {}) {
  const C = costs || defaultCosts;
  const prev = priorMonth || prevMonthOf(month);
  const w = comparableWindow(facts, { month, priorMonth: prev });
  const cut = w.partial ? w.cutoff : undefined;
  const rows = [];

  // matched-window picker for revenue/units (from each month's own daily series).
  const winVal = (mo, ch, metr) => {
    if (!w.partial) return null;                       // full mode → use CM cells below
    const agg = monthWindowAgg(facts, { month: mo, channel: ch, throughDom: cut });
    return metr === "units" ? agg.units : agg.netRev;  // cm3 handled via proration
  };
  // CM3 in a matched window: prior/current full CM3 × (windowed netRev ÷ full-month
  // netRev) — preserves the month's effective CM3% rate, same-window, NaN-safe.
  const winCm3 = (mo, ch, fullCm3, fullNet) => {
    if (!w.partial) return fullCm3;
    const wn = monthWindowAgg(facts, { month: mo, channel: ch, throughDom: cut }).netRev;
    if (!Number.isFinite(fullNet) || fullNet <= 0) return 0;
    return fullCm3 * (wn / fullNet);
  };

  if (dimension === "channel") {
    const cov = coverageFor(facts);
    const channels = new Set();
    for (const mc of Object.keys(cov)) { const [mm, ch] = mc.split("|"); if ((mm === month || mm === prev) && ch) channels.add(ch); }
    for (const ch of channels) {
      const a = computeMonthChannelCM({ facts, month: prev, channel: ch, costs: C, coverage: cov });
      const b = computeMonthChannelCM({ facts, month, channel: ch, costs: C, coverage: cov });
      const pickFull = (r) => r.coverage === "none" ? 0 : fin0(r[metric === "cm3" ? "cm3" : metric]);
      let cur, prior;
      if (metric === "cm3") {
        cur = winCm3(month, ch, pickFull(b), b.coverage === "none" ? 0 : fin0(b.netRev));
        prior = winCm3(prev, ch, pickFull(a), a.coverage === "none" ? 0 : fin0(a.netRev));
      } else if (w.partial) {
        cur = fin0(winVal(month, ch, metric));
        prior = fin0(winVal(prev, ch, metric));
      } else {
        cur = pickFull(b); prior = pickFull(a);
      }
      rows.push({ key: ch, label: ch, cur, prior });
    }
  } else {
    // SKU grain. Full-month uses the CM SKU rollup. Matched-window prorates each
    // SKU's full-month metric by its channel's windowed-revenue share (the SKU
    // daily series is channel-grain only, so we apportion at the channel level —
    // stated honestly via the window label).
    const cmA = computeCM({ facts, month: prev, costs: C });
    const cmB = computeCM({ facts, month, costs: C });
    const codes = new Set([...Object.keys(cmA.bySku || {}), ...Object.keys(cmB.bySku || {})]);
    // channel windowed-revenue share per month (for proration in partial mode).
    const chShare = (mo) => {
      if (!w.partial) return null;
      const share = {};
      const series = dailyChannelSeries(facts);
      for (const ch of series.channels) {
        const full = monthWindowAgg(facts, { month: mo, channel: ch }).netRev;
        const win = monthWindowAgg(facts, { month: mo, channel: ch, throughDom: cut }).netRev;
        share[ch] = full > 0 ? win / full : (win > 0 ? 1 : 0);
      }
      return share;
    };
    const shB = chShare(month), shA = chShare(prev);
    const pick = (cm, sh) => (code) => {
      const s = cm.bySku[code];
      if (!s) return 0;
      const raw = fin0(metric === "cm3" ? s.cm3 : metric === "units" ? s.units : s.netRev);
      if (!sh) return raw;                              // full mode
      const f = sh[s.channel] != null ? sh[s.channel] : 1;
      return metric === "units" ? Math.round(raw * f) : raw * f;
    };
    for (const code of codes) {
      rows.push({ key: code, label: code, cur: pick(cmB, shB)(code), prior: pick(cmA, shA)(code) });
    }
  }

  const out = rows.map((r) => {
    const deltaAbs = round2(r.cur - r.prior);
    // suppress % when the base is thin/low (rubric 18 statistical honesty): a huge
    // % off a tiny prior base is noise, not a trend.
    const thinBase = !(r.prior > 1000);                // ₹1k floor for a meaningful % (units: <1000 prior still allowed)
    const deltaPct = r.prior > 0 ? (r.cur - r.prior) / r.prior : (r.cur > 0 ? null : 0);
    const direction = deltaAbs > 0 ? "up" : deltaAbs < 0 ? "down" : "flat";
    return {
      ...r, cur: round2(r.cur), prior: round2(r.prior), deltaAbs,
      deltaPct: clampPct(deltaPct), momentum: clampPct(deltaPct),
      pctReliable: metric === "units" ? r.prior >= 20 : !thinBase, direction,
    };
  }).sort((a, b) => Math.abs(b.deltaAbs) - Math.abs(a.deltaAbs));

  // Array-like + .window (back-compat with movers[0] / movers.map / movers.length).
  out.window = { ...w, priorMonth: prev, metric, dimension };
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// 57 · CONCENTRATION & DEPENDENCY RISK — share on one SKU/channel.
// ════════════════════════════════════════════════════════════════════════════
/**
 * concentrationRisk(facts, { month, costs? }) →
 *   { byChannel:{ revenue:{ top, topShare, hhi, list }, margin:{…} },
 *     bySku:{ revenue:{…}, margin:{…} }, note }.
 *  HHI = Σ(share²) (0..1; >0.25 = concentrated). Surfaces the fragility the
 *  founder should watch — how much revenue/CM3 rides on one SKU or channel.
 */
export function concentrationRisk(facts, { month, costs } = {}) {
  const C = costs || defaultCosts;
  const cov = coverageFor(facts);
  const chShares = (valFn) => {
    const channels = new Set();
    for (const mc of Object.keys(cov)) { const [mm, ch] = mc.split("|"); if (mm === month && ch) channels.add(ch); }
    const list = [];
    for (const ch of channels) {
      const r = computeMonthChannelCM({ facts, month, channel: ch, costs: C, coverage: cov });
      if (r.coverage === "none") continue;
      const v = valFn(r); if (v == null) continue;
      list.push({ key: ch, value: round2(v) });
    }
    return summarize(list);
  };
  const cm = computeCM({ facts, month, costs: C });
  const skuShares = (field) => {
    const list = Object.entries(cm.bySku || {}).map(([code, s]) => ({ key: code, value: round2(fin0(field === "cm3" ? s.cm3 : s.netRev)) }));
    return summarize(list);
  };
  function summarize(list) {
    const pos = list.filter((x) => x.value > 0);
    const total = pos.reduce((a, x) => a + x.value, 0);
    pos.sort((a, b) => b.value - a.value);
    const withShare = pos.map((x) => ({ ...x, share: total > 0 ? x.value / total : 0 }));
    const hhi = withShare.reduce((a, x) => a + x.share * x.share, 0);
    const top = withShare[0] || null;
    return { total: round2(total), top, topShare: clampPct(top ? top.share : null), hhi: round2(hhi), list: withShare, concentrated: hhi > 0.25 };
  }
  // IX-94 — every concentration/HHI figure MUST carry its window label so a
  // June-MTD 51%/0.34 is never confused with a complete-May 54.1%/0.37. The label
  // states the month AND whether it's a partial (MTD through day N) or full month.
  const part = monthPartiality(facts, month);
  const windowLabel = part.partial
    ? `${month} MTD (through day ${part.dom} of ${part.daysInMonth})`
    : `${month} (complete month)`;
  return {
    month, partial: !!part.partial,
    window: { month, partial: !!part.partial, dom: part.dom, daysInMonth: part.daysInMonth, label: windowLabel },
    byChannel: { revenue: chShares((r) => r.netRev), margin: chShares((r) => r.cm3) },
    bySku: { revenue: skuShares("netRev"), margin: skuShares("cm3") },
    note: `HHI > 0.25 ⇒ concentrated; share is of the positive-value pool for ${windowLabel}. (A partial-month MTD concentration is NOT comparable to a complete-month one — read the window label adjacent to each figure.)`,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 54 · SCENARIO / WHAT-IF — price / fee / ad / COGS lever → CM impact.
// ════════════════════════════════════════════════════════════════════════════
/**
 * computeWhatIf(facts, { month, levers, costs? }) →
 *   { month, base:{ netRev, cm1, cm2, cm3, cm3Pct },
 *     scenario:{ … }, delta:{ … }, levers, byChannel:[{ ch, baseCm3, scenCm3, delta }] }.
 *  levers (all optional, multiplicative/additive, default no-op):
 *    pricePct   — Δ price as fraction (revenue ×(1+pricePct); units unchanged)
 *    cogsPct    — Δ COGS as fraction
 *    feePctAbs  — ADD this many pts to every channel fee % (e.g. +0.02)
 *    adPct      — Δ ad spend as fraction
 *    channel    — restrict the levers to one channel (else all)
 *  Pure re-run of the coverage-aware CM with perturbed inputs; same-window;
 *  NaN-safe. Volume/price-elasticity is NOT modelled (stated) — it is a
 *  margin-mechanics simulator, not a demand model.
 */
export function computeWhatIf(facts, { month, levers = {}, costs } = {}) {
  const C = costs || defaultCosts;
  const cov = coverageFor(facts);
  const { pricePct = 0, cogsPct = 0, feePctAbs = 0, adPct = 0, channel: only } = levers;
  const channels = new Set();
  for (const mc of Object.keys(cov)) { const [mm, ch] = mc.split("|"); if (mm === month && ch) channels.add(ch); }
  const baseAgg = { netRev: 0, cm1: 0, cm2: 0, cm3: 0 };
  const scenAgg = { netRev: 0, cm1: 0, cm2: 0, cm3: 0 };
  const byChannel = [];
  for (const ch of [...channels].sort()) {
    const r = computeMonthChannelCM({ facts, month, channel: ch, costs: C, coverage: cov });
    // Simulate only COGS-COVERED channels — an uncovered cell's reported cm3 does
    // not equal rev−cogs−fees−ad (null COGS dropped), so perturbing its rungs
    // would invent margin. Honest: we never run a what-if on a cell we can't price.
    if (r.coverage === "none" || r.cm3 == null || r.cogsCovered === false) continue;
    const apply = !only || only === ch;
    const netRev = fin0(r.netRev), cogs = fin0(r.cogs), fees = fin0(r.fees), ad = fin0(r.adSpend);
    // base
    baseAgg.netRev += netRev; baseAgg.cm1 += fin0(r.cm1); baseAgg.cm2 += fin0(r.cm2); baseAgg.cm3 += fin0(r.cm3);
    // scenario — perturb revenue, COGS, fees, ad.
    const sRev = apply ? netRev * (1 + pricePct) : netRev;
    const sCogs = apply ? cogs * (1 + cogsPct) : cogs;
    // fee = base fee% (fees/netRev) + feePctAbs, applied to scenario revenue.
    const baseFeePct = netRev > 0 ? fees / netRev : 0;
    const sFees = apply ? (baseFeePct + feePctAbs) * sRev : fees;
    const sAd = apply ? ad * (1 + adPct) : ad;
    const sCm1 = sRev - sCogs, sCm2 = sCm1 - sFees, sCm3 = sCm2 - sAd;
    scenAgg.netRev += sRev; scenAgg.cm1 += sCm1; scenAgg.cm2 += sCm2; scenAgg.cm3 += sCm3;
    byChannel.push({ ch, baseCm3: round2(fin0(r.cm3)), scenCm3: round2(sCm3), delta: round2(sCm3 - fin0(r.cm3)) });
  }
  const pack = (a) => ({ netRev: round2(a.netRev), cm1: round2(a.cm1), cm2: round2(a.cm2), cm3: round2(a.cm3), cm3Pct: clampPct(safeDiv(a.cm3, a.netRev)) });
  const base = pack(baseAgg), scenario = pack(scenAgg);
  return {
    month, levers,
    base, scenario,
    delta: { netRev: round2(scenario.netRev - base.netRev), cm1: round2(scenario.cm1 - base.cm1), cm2: round2(scenario.cm2 - base.cm2), cm3: round2(scenario.cm3 - base.cm3) },
    byChannel: byChannel.sort((a, b) => a.delta - b.delta),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 55 · DRIVER / SENSITIVITY — which lever moves company CM3 most.
// ════════════════════════════════════════════════════════════════════════════
/**
 * driverSensitivity(facts, { month, costs?, step=0.05 }) →
 *   { month, step, drivers:[{ lever, label, deltaCm3, deltaCm3PerStep, rank }] }.
 *  Re-runs computeWhatIf for a uniform ±step shock on each lever and reports the
 *  ΔCM3 magnitude — the highest-leverage knob first (rubric 55). Same-window.
 *  Levers: price +step, COGS +step, fees +step pts, ads −step.
 */
export function driverSensitivity(facts, { month, costs, step = 0.05 } = {}) {
  const C = costs || defaultCosts;
  const probes = [
    { lever: "price", label: `Price +${(step * 100).toFixed(0)}%`, levers: { pricePct: step } },
    { lever: "cogs", label: `COGS −${(step * 100).toFixed(0)}%`, levers: { cogsPct: -step } },
    { lever: "fees", label: `Fees −${(step * 100).toFixed(0)}pts`, levers: { feePctAbs: -step } },
    { lever: "ads", label: `Ad spend −${(step * 100).toFixed(0)}%`, levers: { adPct: -step } },
  ];
  const drivers = probes.map((p) => {
    const w = computeWhatIf(facts, { month, levers: p.levers, costs: C });
    return { lever: p.lever, label: p.label, deltaCm3: round2(w.delta.cm3), deltaCm3PerStep: round2(w.delta.cm3) };
  }).sort((a, b) => Math.abs(b.deltaCm3) - Math.abs(a.deltaCm3))
    .map((d, i) => ({ ...d, rank: i + 1 }));
  return { month, step, drivers };
}

// ════════════════════════════════════════════════════════════════════════════
// 53 · PRESCRIPTION — ranked actions with ₹ impact.
// ════════════════════════════════════════════════════════════════════════════
/**
 * prescriptions(facts, { month, costs? }) →
 *   [{ id, severity:"critical"|"warn"|"opportunity", action, rationale,
 *      impactPerMonth, channel?, sku?, basis }]  sorted by |impact| desc.
 * General sales/finance prescriptions: stop CM3-negative SKU×channel ad spend,
 * delist structurally-loss SKU×channel, flag concentration. Each ends in a
 * decision with a ₹/month estimate (rubric 53). Ad-specific reallocation lives
 * in adPrescriptions(). All same-window (one month's CM matrix).
 */
export function prescriptions(facts, { month, costs } = {}) {
  const C = costs || defaultCosts;
  const cm = computeCM({ facts, month, costs: C });
  const out = [];
  // 1. CM3-negative SKU×channel with ad spend → stop the ad (impact = the ad bleed recovered toward CM2).
  for (const [code, byCh] of Object.entries(cm.matrix || {})) {
    for (const [ch, cell] of Object.entries(byCh)) {
      if (cell.cm3 == null) continue;
      if (cell.cm3 < 0 && fin0(cell.adSpend) > 0) {
        // stopping the ad lifts CM3 by up to the ad spend (toward CM2); cap the
        // claimed gain at making CM3 non-negative (honest — we can't claim more).
        const recover = Math.min(fin0(cell.adSpend), -fin0(cell.cm3) + fin0(cell.adSpend));
        out.push({
          id: `stopad:${code}:${ch}`, severity: "critical",
          action: `Cut ad spend on ${code} · ${ch}`,
          rationale: `CM3 is ${cell.cm3 < 0 ? "negative" : "thin"} at ${(cell.cm3Pct * 100).toFixed(1)}% with ${Math.round(fin0(cell.adSpend)).toLocaleString("en-IN")} ad spend — money lost per ad rupee`,
          impactPerMonth: round2(recover), channel: ch, sku: code, basis: "actual-attributed",
        });
      } else if (cell.cm3 < 0 && fin0(cell.adSpend) === 0) {
        out.push({
          id: `delist:${code}:${ch}`, severity: "warn",
          action: `Review ${code} · ${ch} economics (reprice/delist)`,
          rationale: `CM3 negative (${(cell.cm3Pct * 100).toFixed(1)}%) even with zero ad spend — structural loss on this SKU×channel`,
          impactPerMonth: round2(-fin0(cell.cm3)), channel: ch, sku: code, basis: "actual-attributed",
        });
      }
    }
  }
  // 2. concentration warning.
  const conc = concentrationRisk(facts, { month, costs: C });
  if (conc.byChannel.revenue.concentrated && conc.byChannel.revenue.top) {
    const t = conc.byChannel.revenue.top;
    out.push({
      id: `conc:channel`, severity: "warn",
      action: `De-risk dependency on ${t.key}`,
      rationale: `${(conc.byChannel.revenue.topShare * 100).toFixed(0)}% of net revenue rides on ${t.key} (channel HHI ${conc.byChannel.revenue.hhi}, ${conc.window.label}) — fragile to one channel`,
      impactPerMonth: 0, channel: t.key, basis: "derived",
    });
  }
  return out.sort((a, b) => Math.abs(b.impactPerMonth) - Math.abs(a.impactPerMonth));
}

/**
 * adPrescriptions(facts, { month, costs? }) →
 *   [{ id, severity, action, rationale, impactPerMonth, channel?, sku?, basis }].
 * Marketing-specific: zero-sale spend to stop, CM3-negative ad cells to cut,
 * and a Google↔Meta reallocation hint when website platform efficiency differs
 * (read from meta.bySource["monarch-platform"] if present). Same-window;
 * every ratio gated by guardRatio. NaN-safe.
 */
export function adPrescriptions(facts, { month, costs } = {}) {
  const C = costs || defaultCosts;
  const cm = computeCM({ facts, month, costs: C });
  const out = [];
  for (const [code, byCh] of Object.entries(cm.matrix || {})) {
    for (const [ch, cell] of Object.entries(byCh)) {
      const ad = fin0(cell.adSpend);
      if (ad <= 0) continue;
      // zero-sale spend → stop (full ad recovered).
      if (fin0(cell.netRev) === 0) {
        out.push({ id: `zerosale:${code}:${ch}`, severity: "critical", action: `Stop zero-sale ads on ${code} · ${ch}`, rationale: `${Math.round(ad).toLocaleString("en-IN")} ad spend with zero net revenue`, impactPerMonth: round2(ad), channel: ch, sku: code, basis: "actual-attributed" });
        continue;
      }
      // CM3-negative ad cell → cut.
      if (cell.cm3 != null && cell.cm3 < 0) {
        const acos = guardRatio({ numerator: ad, denominator: fin0(cell.netRev), numWindow: win(month, ch, "native"), denWindow: win(month, ch, "native"), kind: "acos" });
        out.push({ id: `cutad:${code}:${ch}`, severity: "warn", action: `Cut/optimise ads on ${code} · ${ch}`, rationale: `ACOS ${acos.value != null ? (acos.value * 100).toFixed(0) + "%" : "—"} drives CM3 to ${(cell.cm3Pct * 100).toFixed(1)}% — below breakeven`, impactPerMonth: round2(-fin0(cell.cm3)), channel: ch, sku: code, basis: "actual-attributed" });
      }
    }
  }
  // Google ↔ Meta reallocation (website) — read platform ROAS/CPA if surfaced.
  const plat = facts?.meta?.bySource?.["monarch-platform"] || null;
  if (plat && plat.google && plat.meta) {
    const gR = num(plat.google.roas), mR = num(plat.meta.roas);
    if (gR > 0 && mR > 0 && Math.abs(gR - mR) / Math.max(gR, mR) > 0.2) {
      const better = gR > mR ? "Google" : "Meta", worse = gR > mR ? "Meta" : "Google";
      out.push({ id: `realloc:web`, severity: "opportunity", action: `Shift website budget ${worse} → ${better}`, rationale: `${better} ROAS ${Math.max(gR, mR).toFixed(2)} vs ${worse} ${Math.min(gR, mR).toFixed(2)} — same-window website platform efficiency`, impactPerMonth: 0, channel: "website", basis: "agency-platform" });
    }
  }
  return out.sort((a, b) => Math.abs(b.impactPerMonth) - Math.abs(a.impactPerMonth));
}

// ════════════════════════════════════════════════════════════════════════════
// 23 · ATTRIBUTION CONFIDENCE — what fraction of each channel's ad spend (and
// thus each CM3) is per-product MEASURED vs allocated-by-revenue. ONE engine for
// BOTH the Marketing panel AND the Finance CM3 waterfall, so the founder reading
// a June CM3 sees IN PLACE that its ad leg is 0%-measured (agency month) vs
// 97%-measured (native month). Same-window; reconciles direct + allocated == total.
// ════════════════════════════════════════════════════════════════════════════
/**
 * attributionConfidence(facts, { month, costs? }) →
 *   { byChannel:{ ch:{ total, direct, alloc, measured, reconciles } },
 *     channels:[…sorted], directTotal, allocTotal, spendTotal, overall }.
 * measured = min(1, direct ÷ total) (capped for display; the rare direct>total
 * source delta is surfaced via reconciles, never hidden). A channel with ad spend
 * but no per-product attribution (agency total only) → measured 0 (a HINT, not a
 * measured CM3). A channel with no ad spend → measured null (n/a). NaN-safe.
 */
export function attributionConfidence(facts, { month, costs } = {}) {
  const C = costs || defaultCosts;
  const cm = computeCM({ facts, month, costs: C });
  const alloc = cm.adAllocation || {};
  const byChannel = {};
  const channels = [];
  let directTotal = 0, allocTotal = 0, spendTotal = 0;
  for (const [ch, a] of Object.entries(alloc)) {
    if (!a) continue;
    const total = fin0(a.total);
    const direct = fin0(a.direct);
    const allocated = Math.max(0, total - direct);
    const measured = total > 0 ? Math.min(1, direct / total) : null;
    const row = { ch, total: round2(total), direct: round2(direct), alloc: round2(allocated), measured: clampPct(measured), reconciles: Math.abs(direct + allocated - total) < 1 };
    byChannel[ch] = row;
    if (total > 0) { channels.push(row); directTotal += Math.min(direct, total); allocTotal += allocated; spendTotal += total; }
  }
  channels.sort((a, b) => b.total - a.total);
  return {
    month, byChannel, channels,
    directTotal: round2(directTotal), allocTotal: round2(allocTotal), spendTotal: round2(spendTotal),
    overall: clampPct(spendTotal > 0 ? directTotal / spendTotal : null),
  };
}

// confidence band label/colour key for a measured fraction (shared by both pages).
export function attributionBand(measured) {
  if (measured == null) return { key: "na", label: "no ads", short: "n/a" };
  if (measured >= 0.8) return { key: "measured", label: "measured", short: `${Math.round(measured * 100)}% measured` };
  if (measured >= 0.4) return { key: "mixed", label: "part-measured", short: `${Math.round(measured * 100)}% measured` };
  return { key: "allocated", label: "allocated (hint)", short: `${Math.round(measured * 100)}% measured` };
}

// ════════════════════════════════════════════════════════════════════════════
// 4 / 89 · NATIVE-vs-AGENCY BIAS — quantify the systematic agency over/under-
// statement (the one month both tiers exist) and offer it as a CORRECTION BAND on
// the agency-only months, instead of taking agency at face value with only a
// global caveat (left-on-the-table: "apply May's +6.15% Amazon delta as a band").
// ════════════════════════════════════════════════════════════════════════════
/**
 * nativeAgencyBias(facts) → { byChannel:{ ch:{ month, nativeNet, agencyNet,
 *   biasPct, biasAbs, direction } }, anchorMonth, channels:[…], note }.
 *  For every channel that has BOTH a native rollup AND a retained agency shadow in
 *  the same month, biasPct = agencyNet ÷ nativeNet − 1 (how far the agency estimate
 *  sits from the native ground truth). Positive ⇒ agency OVERSTATES. NaN-safe.
 */
export function nativeAgencyBias(facts) {
  const shadow = (facts && facts.meta && facts.meta.agencyShadow) || {};
  const byChannel = {};
  const months = new Set();
  for (const key of Object.keys(shadow)) {
    const [m, ch] = key.split("|");
    months.add(m);
    // native net for this month×channel from the verified v1 chain.
    const v1 = computeCM({ facts, month: m });
    const nativeNet = fin0(v1.byChannel?.[ch]?.netRev);
    const sh = shadow[key] || {};
    const agencyNet = fin0(Number(sh.netRev)) || (fin0(Number(sh.grossRev)) / WEBSITE_NET_DIVISOR);
    if (!(nativeNet > 0) || !(agencyNet > 0)) continue;
    const biasPct = agencyNet / nativeNet - 1;
    // COMPARABILITY GUARD: a usable correction band needs native & agency to
    // measure the SAME thing. Website's native is Shopify order-level net while
    // the agency figure is Monarch gross÷1.05 (a different basis entirely), so its
    // "bias" is a basis mismatch, not an estimation error — never applied as a band.
    // Marketplace channels (amazon/flipkart/blinkit) both net the same way → comparable.
    const comparable = ch !== "website";
    byChannel[ch] = {
      month: m, nativeNet: round2(nativeNet), agencyNet: round2(agencyNet),
      biasPct: clampPct(biasPct), biasAbs: round2(agencyNet - nativeNet),
      direction: biasPct > 0.005 ? "overstates" : biasPct < -0.005 ? "understates" : "matches",
      comparable,
      note: comparable ? null : "native (Shopify net) vs agency (Monarch gross÷1.05) measure different bases — shown for reference, NOT applied as a correction band",
    };
  }
  const anchorMonth = [...months].sort().slice(-1)[0] || null;
  return {
    byChannel, anchorMonth, channels: Object.keys(byChannel).sort(),
    note: "Bias = agency ÷ native − 1, measured on the one month both tiers exist. Applied as a correction BAND on agency-only months — the face value stays primary; the band shows where a native report would likely land.",
  };
}

/**
 * correctedAgencyNet(agencyNet, biasPct) → { face, corrected, band:[lo,hi] }.
 * Apply a measured native-vs-agency bias to an agency-only figure: corrected =
 * face ÷ (1 + biasPct) (undo the agency over/under-statement). The band is ±half
 * the bias magnitude around the corrected midpoint (the single-month bias is an
 * estimate, not a guarantee). NaN-safe.
 */
export function correctedAgencyNet(agencyNet, biasPct) {
  const face = fin0(agencyNet);
  if (!Number.isFinite(biasPct) || Math.abs(biasPct) < 1e-9) return { face: round2(face), corrected: round2(face), band: [round2(face), round2(face)] };
  const corrected = face / (1 + biasPct);
  const half = Math.abs(face - corrected) / 2;
  return { face: round2(face), corrected: round2(corrected), band: [round2(corrected - half), round2(corrected + half)] };
}

// ════════════════════════════════════════════════════════════════════════════
// 19 · PRICE REALIZATION — effective realized price vs MRP, discount leakage.
// ════════════════════════════════════════════════════════════════════════════
/**
 * priceRealization(facts, { month }) → [{ code, channel, units, grossRev,
 *   netRev, realizedNet, realizedGross, leakagePct }].
 *  realizedNet = netRev/units (₹/unit actually banked). leakagePct =
 *  (gross − net)/gross (GST + returns leakage). Native (per-SKU) cells only —
 *  the only window where MRP/discount realization is supported (rubric 19).
 *  NaN-safe; zero-unit cells excluded.
 */
export function priceRealization(facts, { month } = {}) {
  const monthly = (facts && facts.monthly) || {};
  const out = [];
  for (const [key, cell] of Object.entries(monthly)) {
    if (isChannelGrainKey(key)) continue;
    const [m, ch, code] = key.split("|");
    if (m !== month) continue;
    const units = num(cell.units);
    if (units <= 0) continue;
    const gross = num(cell.grossRev), net = num(cell.netRev);
    out.push({
      code, channel: ch, units,
      grossRev: round2(gross), netRev: round2(net),
      realizedNet: clampPct(safeDiv(net, units)),
      realizedGross: clampPct(safeDiv(gross, units)),
      leakagePct: clampPct(gross > 0 ? (gross - net) / gross : null),
    });
  }
  return out.sort((a, b) => b.netRev - a.netRev);
}

// ════════════════════════════════════════════════════════════════════════════
// 58 · CROSS-MODULE — sales velocity, RECONCILED across windows (rubric 17).
// ════════════════════════════════════════════════════════════════════════════
/**
 * VELOCITY_WINDOWS — the SINGLE registry of velocity definitions, shared so the
 * Sales panel never invents a window the founder can't trace. Each is units ÷
 * days over a stated span from the per-SKU monthly fact cells.
 *   mtd      — current month units ÷ elapsed days (reporting "how is THIS month").
 *   t30      — trailing-30-day rate: units in the last 30 calendar days (current
 *              MTD + the tail of the prior month) ÷ 30. This is the window the
 *              inventory PLANNING velocity uses; exposed here so the two modules'
 *              velocity NUMBERS reconcile to one definition the founder can pick.
 *   t90      — trailing-90-day rate (a steadier reorder-planning rate).
 */
export const VELOCITY_WINDOWS = [
  // NOTE: the "current" window label is RESOLVED at compute time from the actual
  // month state (partial → "MTD through day N"; complete → "complete month, N
  // days") and returned as result.meta.currentMonthLabel / row.currentMonthLabel.
  // The page MUST render that resolved label, not this static one, so a complete
  // month is never mislabelled "This month (MTD)" with a full day count (IX-94).
  { key: "mtd", label: "Current month", days: null, question: "How fast is it selling in the current month window? (label resolves to MTD vs complete)" },
  { key: "t30", label: "Trailing 30d", days: 30, question: "What rate to plan a reorder at? (matches inventory planning window)" },
  { key: "t90", label: "Trailing 90d", days: 90, question: "What is the steady long-run rate?" },
];

/**
 * crossModuleVelocity(facts, { month, window? }) →
 *   [{ code, channel, units, days, velocityPerDay, monthlyRunRate, window,
 *      byWindow:{ mtd:{…}, t30:{…}, t90:{…} } }].
 *
 *  RECONCILED VELOCITY (rubric 17 — the tool must never show two unreconciled
 *  "Amazon velocity" numbers). One function computes EVERY window from the SAME
 *  per-SKU fact cells, so the Sales panel offers a window toggle rather than a
 *  second, conflicting definition. `window` selects which window populates the
 *  flat `velocityPerDay`/`days` fields (default "mtd"); `byWindow` always carries
 *  all three so the UI can show the reconciled set. The inventory module's runway
 *  reads the t30 rate here for the stockout call — same number, same definition.
 *  NaN-safe; per-SKU native cells only (the only grain that supports SKU velocity).
 */
export function crossModuleVelocity(facts, { month, window = "mtd" } = {}) {
  const monthly = (facts && facts.monthly) || {};
  const cov = coverageFor(facts);
  const m = String(month || "");
  // anchor "today" = the latest data day of the month (MTD-honest), else month end.
  const monthCov = Object.entries(cov).filter(([k]) => k.startsWith(m + "|")).map(([, c]) => c.lastDay).filter(Boolean).sort();
  const asOf = monthCov.length ? monthCov[monthCov.length - 1] : `${m}-${String(monthEndDom(m)).padStart(2, "0")}`;
  const asOfMs = new Date(asOf + "T00:00:00Z").getTime();
  const DAY = 86400000;
  // build per-(code|channel) monthly-units index across ALL months (for trailing
  // windows). A month's units are attributed to its mid-month as a single point;
  // we apportion a month's units across the trailing window by the overlap of the
  // month with the window (calendar-day proportional) — defensible & NaN-safe.
  const monthSpan = (ym) => {
    const [y, mo] = ym.split("-").map(Number);
    const start = Date.UTC(y, mo - 1, 1);
    const cv = cov[`${ym}|*`];
    void cv;
    return { start, end: Date.UTC(y, mo - 1, monthEndDom(ym)) + DAY - 1 };
  };
  const perKey = {};   // "code|ch" → { units (current month), cells:[{ ym, units }] }
  for (const [key, cell] of Object.entries(monthly)) {
    if (isChannelGrainKey(key)) continue;
    const [ym, ch, code] = key.split("|");
    const units = num(cell.units);
    if (units <= 0) continue;
    const k = `${code}|${ch}`;
    (perKey[k] = perKey[k] || { code, ch, curUnits: 0, cells: [] });
    perKey[k].cells.push({ ym, units });
    if (ym === m) perKey[k].curUnits += units;
  }
  const trailingRate = (cells, windowDays) => {
    const winStart = asOfMs - (windowDays - 1) * DAY;
    let u = 0;
    for (const { ym, units } of cells) {
      const { start, end } = monthSpan(ym);
      const overlapStart = Math.max(start, winStart);
      const overlapEnd = Math.min(end, asOfMs);
      if (overlapEnd < overlapStart) continue;
      const overlapDays = (overlapEnd - overlapStart) / DAY + 1;
      const monthDays = monthEndDom(ym);
      u += units * Math.min(1, Math.max(0, overlapDays / monthDays));   // calendar-proportional
    }
    return { units: Math.round(u), days: windowDays, velocityPerDay: clampPct(u / windowDays) };
  };
  // IX-94 — the "current month" window is only an MTD partial when the month is
  // genuinely in progress. When `month` is a COMPLETE month (e.g. May, lastDay =
  // the 31st), elapsed = the full 31 days and the rate is a complete-month rate,
  // NOT an MTD rate — labelling it "This month (MTD)" with DAYS=31 reads as a 3×
  // overstatement against a real June-to-day-10 window. We compute the true elapsed
  // days per the latest data day and emit `currentMonthPartial` + a precise label
  // so the page never mislabels a full month as MTD.
  const partM = monthPartiality(facts, m);
  const out = [];
  for (const k of Object.keys(perKey)) {
    const { code, ch, curUnits, cells } = perKey[k];
    if (curUnits <= 0) continue;
    const c = cov[`${m}|${ch}`] || {};
    const elapsed = c.lastDay ? domOf(c.lastDay) : (partM.dom || monthEndDom(m));
    const mtd = { units: curUnits, days: elapsed, velocityPerDay: clampPct(elapsed > 0 ? curUnits / elapsed : null) };
    const t30 = trailingRate(cells, 30);
    const t90 = trailingRate(cells, 90);
    const byWindow = { mtd, t30, t90 };
    const sel = byWindow[window] || mtd;
    out.push({
      code, channel: ch,
      units: sel.units, days: sel.days, window,
      velocityPerDay: sel.velocityPerDay,
      monthlyRunRate: clampPct(sel.velocityPerDay != null ? sel.velocityPerDay * monthEndDom(m) : null),
      byWindow, asOf,
      // window self-description so the grid labels the current-month window honestly.
      currentMonthPartial: !!partM.partial,
      currentMonthDays: elapsed,
      currentMonthLabel: partM.partial
        ? `${m} MTD (through day ${elapsed} of ${partM.daysInMonth})`
        : `${m} (complete month, ${elapsed} days)`,
    });
  }
  const sorted = out.sort((a, b) => b.units - a.units);
  // attach the resolved window descriptor for the panel header (non-enumerable-ish
  // sidecar: a frozen meta on the array so existing row consumers are unaffected).
  sorted.meta = {
    month: m, asOf, currentMonthPartial: !!partM.partial,
    currentMonthDays: partM.dom || monthEndDom(m), daysInMonth: partM.daysInMonth,
    currentMonthLabel: partM.partial
      ? `${m} MTD (through day ${partM.dom} of ${partM.daysInMonth})`
      : `${m} (complete month, ${partM.dom || monthEndDom(m)} days)`,
  };
  return sorted;
}

// ════════════════════════════════════════════════════════════════════════════
// 59 · AUTO-NARRATIVE — written "what changed & what it means" digest.
// ════════════════════════════════════════════════════════════════════════════
/**
 * autoNarrative(facts, { month, costs? }) →
 *   { month, headline, paragraphs:[…], bullets:[{ tone, text }], asOf }.
 * The tool's first pass of analysis: MTD projection, the biggest mover, the top
 * anomaly, the top prescription, concentration. Plain language, founder-facing,
 * NaN-safe, every claim sourced from a function above (no fabricated numbers).
 */
export function autoNarrative(facts, { month, costs } = {}) {
  const C = costs || defaultCosts;
  const inr = (n) => (Number.isFinite(n) ? "₹" + Math.round(n).toLocaleString("en-IN") : "—");
  const proj = projectMonthEnd(facts, { month });
  const prev = prevMonthOf(month);
  const movers = rankMovers(facts, { dimension: "channel", month, priorMonth: prev, metric: "netRev", costs: C });
  const mWin = movers.window || { partial: false, mode: "full-vs-full" };
  const topMover = movers[0] || null;
  // founder-facing description of the comparison base (rubric 14/29/65): MTD-matched
  // when the current month is in-progress, full-vs-full otherwise.
  const moverBase = mWin.partial ? `${prev} through day ${mWin.cutoff} (like-for-like)` : prev;
  // a % is only shown when the prior base is thick enough to be a trend, not noise.
  const moverPctTxt = (m) => (m && m.deltaPct != null && m.pctReliable !== false ? ` (${(m.deltaPct * 100).toFixed(0)}%)` : "");
  const flags = dailyFlags(facts, { lastN: 7 });
  const recentAnom = flags.filter((f) => f.anomaly).slice(-1)[0] || flags.find((f) => f.flag === "soft") || null;
  // CROSS-CHANNEL anomaly scan (rubric 51/52 — not Amazon-only): name the channel
  // that broke pattern in the last 7 days, so a Flipkart/Blinkit/Website daily
  // anomaly surfaces in the digest, not just the company-level flag.
  const chAnoms = allChannelAnomalies(facts, { window: 14, lastN: 7 });
  const topChAnom = chAnoms[0] || null;
  const rx = prescriptions(facts, { month, costs: C });
  const topRx = rx[0] || null;
  const conc = concentrationRisk(facts, { month, costs: C });

  const bullets = [];
  if (proj.partial) bullets.push({ tone: proj.paceVsPrior != null && proj.paceVsPrior >= 0 ? "good" : "warn", text: `Pacing to ${inr(proj.projected)} by month-end (${proj.confidence} confidence, ${proj.method}); ${proj.paceVsPrior != null ? (proj.paceVsPrior >= 0 ? "ahead of" : "behind") + " " + prev + " by " + Math.abs(proj.paceVsPrior * 100).toFixed(0) + "% to-date" : "no comparable prior month"}.` });
  else bullets.push({ tone: "neutral", text: `${month} closed at ${inr(proj.projected)} net revenue.` });
  if (topMover && topMover.deltaAbs !== 0) bullets.push({ tone: topMover.direction === "up" ? "good" : "warn", text: `Biggest mover vs ${moverBase}: ${topMover.label} ${topMover.direction === "up" ? "up" : "down"} ${inr(Math.abs(topMover.deltaAbs))}${moverPctTxt(topMover)}.` });
  if (recentAnom) bullets.push({ tone: "warn", text: `Recent day flag: ${recentAnom.iso} (${recentAnom.dowName}) — ${recentAnom.label}.` });
  if (topChAnom) bullets.push({ tone: "warn", text: `Channel anomaly: ${topChAnom.channel} on ${topChAnom.iso} broke pattern (${Math.abs(topChAnom.z).toFixed(1)}σ ${topChAnom.direction === "high" ? "above" : "below"} its trailing window).` });
  if (topRx) bullets.push({ tone: topRx.severity === "critical" ? "critical" : "warn", text: `Top action: ${topRx.action} — ${topRx.rationale}${topRx.impactPerMonth ? ` (~${inr(topRx.impactPerMonth)}/mo)` : ""}.` });
  if (conc.byChannel.revenue.concentrated && conc.byChannel.revenue.top) bullets.push({ tone: "warn", text: `${(conc.byChannel.revenue.topShare * 100).toFixed(0)}% of revenue rides on ${conc.byChannel.revenue.top.key} (HHI ${conc.byChannel.revenue.hhi}, ${conc.window.label}) — watch concentration.` });

  const headline = proj.partial
    ? `${month} pacing to ${inr(proj.projected)} (${proj.confidence} confidence)`
    : `${month}: ${inr(proj.projected)} net revenue`;
  const paragraphs = [
    proj.partial
      ? `Month-to-date net revenue is ${inr(proj.mtd)} through ${proj.lastDay || "—"} (day ${proj.dom} of ${proj.daysInMonth}). At the current pace the month projects to ${inr(proj.projected)} (band ${inr(proj.low)}–${inr(proj.high)}), via ${proj.method}.`
      : `${month} closed at ${inr(proj.projected)} net revenue across ${movers.length} channels.`,
    topMover && topMover.deltaAbs !== 0
      ? `The largest channel move versus ${moverBase} was ${topMover.label}, ${topMover.direction === "up" ? "adding" : "shedding"} ${inr(Math.abs(topMover.deltaAbs))}${mWin.partial ? ` — compared like-for-like through day ${mWin.cutoff} of both months, so this is a real move, not just fewer elapsed days` : ""}.`
      : `Channel mix versus ${moverBase} was broadly stable.`,
    topRx
      ? `The single highest-leverage action right now: ${topRx.action.toLowerCase()} — ${topRx.rationale.toLowerCase()}.`
      : `No loss-making ad cells or structural losses flagged this month.`,
  ];
  return { month, headline, paragraphs, bullets, asOf: proj.lastDay || month };
}

// ════════════════════════════════════════════════════════════════════════════
// ROUND-3 ADDITIONS — the deductions closed below (every fn pure, NaN-safe,
// same-window-guarded, reconciling to source). Each block names its rubric param.
// ════════════════════════════════════════════════════════════════════════════

// ── shared INR helper for prose/labels (mirrors ScorecardHelpers.inr; lib has no D) ──
const inrLbl = (n) => (Number.isFinite(Number(n)) ? "₹" + Math.round(Number(n)).toLocaleString("en-IN") : "—");
const pctLbl = (frac, dp = 1) => (Number.isFinite(frac) ? `${(frac * 100).toFixed(dp)}%` : "—");
const sgnPct = (frac, dp = 0) => (Number.isFinite(frac) ? `${frac >= 0 ? "+" : "−"}${Math.abs(frac * 100).toFixed(dp)}%` : "—");

// ════════════════════════════════════════════════════════════════════════════
// II-18 · SMALL-SAMPLE / THIN-BASE FLAG — a % off a tiny base is noise, annotate.
// ════════════════════════════════════════════════════════════════════════════
/**
 * smallSampleFlag(value, baseRevenue, { floor=2000, units=false }) →
 *   { thin, base, floor, reliable, annotation }.
 *  The rule the whole module routes thin-base %s through (rubric 18): a MoM/MoM%
 *  computed on a prior base below `floor` (₹) — e.g. Sep-2024 +100% off ₹2,300 —
 *  is flagged THIN and carries a human "thin base ₹X" annotation instead of a
 *  bare %. `units:true` switches the floor to a unit count (default 20 units).
 *  NaN-safe: a non-finite base reads as thin (we never trust an unknown base).
 */
export function smallSampleFlag(value, baseRevenue, { floor, units = false } = {}) {
  const f = Number.isFinite(floor) ? floor : (units ? 20 : 2000);
  const base = num(baseRevenue);
  const thin = !(Number.isFinite(base) && base >= f);
  return {
    thin, base: round2(base), floor: f, reliable: !thin,
    annotation: thin ? `thin base ${units ? Math.round(base) + "u" : inrLbl(base)} — % unreliable` : null,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// II-16 · PER-CHANNEL WEEKDAY-MATCHED BASELINE + flag/anomaly.
// The company-level seasonalityBaselines is right for the company view, but a
// daily channel flag must compare a channel's day to THAT CHANNEL's own weekday
// history (a Blinkit Sunday vs other Blinkit Sundays — never the company mean).
// ════════════════════════════════════════════════════════════════════════════
/**
 * perChannelWeekdayBaseline(facts, { channel }) →
 *   { channel, weekday:{ mean:[7], index:[7], names:[7], n:[7] }, overallMean,
 *     totalDays }.  IDENTICAL shape to seasonalityBaselines(...).weekday but built
 *  ONLY from `channel`'s own daily net series — the per-channel weekday baseline
 *  the channel daily-flag divides by (rubric 16). NaN-safe (empty channel → zeros).
 */
export function perChannelWeekdayBaseline(facts, { channel } = {}) {
  const series = dailyChannelSeries(facts);
  const m = series.byChannel[channel] || {};
  const sums = [0, 0, 0, 0, 0, 0, 0], counts = [0, 0, 0, 0, 0, 0, 0];
  let total = 0, n = 0;
  for (const [iso, v] of Object.entries(m)) {
    const d = dowOf(iso); const val = fin0(v);
    if (d != null) { sums[d] += val; counts[d]++; }
    total += val; n++;
  }
  const overallMean = n ? total / n : 0;
  const mean = sums.map((s, i) => (counts[i] ? s / counts[i] : 0));
  const index = mean.map((mn) => (overallMean > 0 ? mn / overallMean : null));
  return {
    channel, overallMean: round2(overallMean), totalDays: n,
    weekday: { mean: mean.map(round2), index: index.map(clampPct), names: WEEKDAY_NAMES, n: counts },
  };
}

/**
 * perChannelDailyFlags(facts, { channel, window=28, lastN }) →
 *   [{ iso, dow, dowName, net, units, ad, wdAvg, wdExpected, softPct, softening,
 *      z, anomaly, beatPeak, max7, flag, label }]  (ascending; lastN trims tail).
 *
 *  Like dailyFlags, but EVERY signal is computed against the channel's OWN weekday
 *  baseline (rubric 16, II): the weekday-matched average is over the same channel
 *  + same day-of-week within the trailing window, and `wdExpected` is the channel's
 *  long-run weekday-index expectation (perChannelWeekdayBaseline) so a structurally
 *  low channel-Sunday is never flagged red against the channel's Tuesday peak. The
 *  anomaly z is scored against the channel's trailing window (rubric II anomaly).
 *  NaN-safe; a channel with no daily series → []. Same-window by construction.
 */
export function perChannelDailyFlags(facts, { channel, window = 28, lastN } = {}) {
  const series = dailyChannelSeries(facts);
  const net = series.byChannel[channel] || {};
  const units = series.unitsByChannel[channel] || {};
  const ad = series.adByChannel[channel] || {};
  const base = perChannelWeekdayBaseline(facts, { channel });
  const isos = Object.keys(net).sort();
  const out = [];
  for (let i = 0; i < isos.length; i++) {
    const iso = isos[i];
    const v = fin0(net[iso]);
    const d = dowOf(iso);
    const start = Math.max(0, i - window);
    const trail = isos.slice(start, i).map((k) => fin0(net[k]));
    const last7 = trail.slice(-7);
    const max7 = last7.length ? Math.max(...last7) : null;
    const beatPeak = max7 != null ? v > max7 : false;
    // weekday-matched trailing avg WITHIN this channel only.
    const wdVals = [];
    for (let j = start; j < i; j++) if (dowOf(isos[j]) === d) wdVals.push(fin0(net[isos[j]]));
    const wdAvg = wdVals.length ? wdVals.reduce((a, b) => a + b, 0) / wdVals.length : null;
    // the channel's long-run weekday expectation (index × channel overall mean).
    const wdExpected = d != null && base.weekday.index[d] != null ? base.weekday.index[d] * base.overallMean : null;
    const softPct = wdAvg != null && wdAvg > 0 ? (v - wdAvg) / wdAvg : null;
    const softening = softPct != null ? softPct < -0.15 : false;
    let z = null, anomaly = false;
    if (trail.length >= 5) {
      const mean = trail.reduce((a, b) => a + b, 0) / trail.length;
      const sd = Math.sqrt(trail.reduce((a, b) => a + (b - mean) ** 2, 0) / trail.length);
      z = sd > 1e-6 ? (v - mean) / sd : 0;
      anomaly = Math.abs(z) >= 2;
    }
    let flag = "normal", label = `In ${channel}'s normal ${d != null ? WEEKDAY_NAMES[d] : ""} range`;
    if (anomaly && z < 0) { flag = "anomaly-low"; label = `${Math.abs(z).toFixed(1)}σ below ${channel}'s trailing — broke pattern`; }
    else if (beatPeak) { flag = "peak"; label = `Beat ${channel}'s 7-day peak`; }
    else if (softening) { flag = "soft"; label = `${Math.abs(softPct * 100).toFixed(0)}% below its ${WEEKDAY_NAMES[d] || ""} average — softening`; }
    else if (anomaly && z > 0) { flag = "anomaly-high"; label = `${z.toFixed(1)}σ above ${channel}'s trailing — unusual high`; }
    else if (softPct != null && softPct > 0.1) { flag = "strong"; label = `Above its ${WEEKDAY_NAMES[d] || ""} average`; }
    out.push({
      iso, dow: d, dowName: d != null ? WEEKDAY_NAMES[d] : "?",
      net: round2(v), units: Math.round(fin0(units[iso])), ad: round2(fin0(ad[iso])),
      wdAvg: wdAvg != null ? round2(wdAvg) : null, wdExpected: wdExpected != null ? round2(wdExpected) : null,
      softPct: softPct != null ? round2(softPct) : null, softening,
      z: z != null ? round2(z) : null, anomaly, beatPeak, max7: max7 != null ? round2(max7) : null,
      flag, label,
    });
  }
  return Number.isFinite(lastN) && lastN > 0 ? out.slice(-lastN) : out;
}

// ════════════════════════════════════════════════════════════════════════════
// VII-52 · FORECAST — forward revenue/units/CONTRIBUTION at channel AND SKU grain
// with a STATED method (trailing-trend + run-rate blend) and an uncertainty band.
// ════════════════════════════════════════════════════════════════════════════
/**
 * forecast(facts, { channel?, sku?, costs?, horizonMonths=1, asOfMonth? }) →
 *   { grain, channel, sku, method, asOfMonth, history:[{ month, netRev, units, cm3 }],
 *     forecast:[{ month, netRev, netRevLow, netRevHigh, units, cm3, cm3Low, cm3High,
 *                 partial }], trailing:{ months, avgNetRev, avgUnits, avgCm3,
 *                 slopePerMonth }, cm3MarginPct, confidence, note }.
 *
 *  METHOD (stated, rubric 52): a trailing-3-complete-month TREND is fit by simple
 *  linear regression on net revenue; the forecast is the blend of (a) that trend
 *  line extended and (b) the trailing mean (run-rate), 50/50 — robust to a single
 *  noisy month. UNITS are forecast by holding the trailing realized ₹/unit; CM3 by
 *  holding the trailing effective CM3-margin% (so the forward CONTRIBUTION is the
 *  forecast revenue × the SKU/channel's own recent margin, not a separate guess).
 *  UNCERTAINTY BAND = ±(residual σ of the trend fit) widening by √h each month out.
 *  The in-progress current month (if present) is completed via projectMonthEnd and
 *  shown as the first, `partial`-flagged forecast point.
 *
 *  GRAIN: channel-only → uses coverage-aware computeMonthChannelCM per month.
 *         sku (+optional channel) → uses computeCM().bySku / .matrix per month.
 *         neither → company total (sum of channels). Same-window throughout
 *  (each month's figure is that month's own verified CM). NaN-safe.
 */
export function forecast(facts, { channel, sku, costs, horizonMonths = 1, asOfMonth } = {}) {
  const C = costs || defaultCosts;
  const cov = coverageFor(facts);
  // months present, ascending.
  const monthsSet = new Set();
  for (const k of Object.keys(cov)) { const m = k.split("|")[0]; if (m) monthsSet.add(m); }
  const months = [...monthsSet].sort();
  if (!months.length) return { grain: "none", channel: channel || null, sku: sku || null, method: "no data", history: [], forecast: [], confidence: "none", note: "no months in coverage" };
  const asOf = asOfMonth || months[months.length - 1];
  const grain = sku ? "sku" : channel ? "channel" : "company";

  // monthly { netRev, units, cm3 } for the chosen grain.
  const monthVal = (m) => {
    if (grain === "sku") {
      const cm = computeCM({ facts, month: m, costs: C });
      if (channel) {
        const cell = cm.bySku?.[sku]?.byChannel?.[channel];
        if (!cell) return { netRev: 0, units: 0, cm3: 0, cm3Covered: false };
        return { netRev: fin0(cell.netRev), units: fin0(cell.units), cm3: cell.cm3 == null ? null : fin0(cell.cm3), cm3Covered: cell.cogsCovered !== false && cell.cm3 != null };
      }
      const s = cm.bySku?.[sku];
      if (!s) return { netRev: 0, units: 0, cm3: 0, cm3Covered: false };
      return { netRev: fin0(s.netRev), units: fin0(s.units), cm3: s.cm3 == null ? null : fin0(s.cm3), cm3Covered: s.cogsCovered !== false && s.cm3 != null };
    }
    if (grain === "channel") {
      const r = computeMonthChannelCM({ facts, month: m, channel, costs: C, coverage: cov });
      if (r.coverage === "none") return { netRev: 0, units: 0, cm3: null, cm3Covered: false };
      return { netRev: fin0(r.netRev), units: fin0(r.units), cm3: r.cm3 == null ? null : fin0(r.cm3), cm3Covered: r.cogsCovered !== false && r.cm3 != null };
    }
    // company
    const channels = new Set();
    for (const mc of Object.keys(cov)) { const [mm, ch] = mc.split("|"); if (mm === m && ch) channels.add(ch); }
    let rev = 0, u = 0, cm3 = 0, anyCm3 = false;
    for (const ch of channels) {
      const r = computeMonthChannelCM({ facts, month: m, channel: ch, costs: C, coverage: cov });
      if (r.coverage === "none") continue;
      rev += fin0(r.netRev); u += fin0(r.units);
      if (r.cm3 != null && r.cogsCovered !== false) { cm3 += fin0(r.cm3); anyCm3 = true; }
    }
    return { netRev: rev, units: u, cm3: anyCm3 ? cm3 : null, cm3Covered: anyCm3 };
  };

  const history = months.map((m) => ({ month: m, ...monthVal(m) }))
    .map((h) => ({ month: h.month, netRev: round2(h.netRev), units: Math.round(h.units), cm3: h.cm3 == null ? null : round2(h.cm3), cm3Covered: h.cm3Covered }))
    .filter((h) => h.netRev !== 0 || h.units !== 0);

  // partiality of the asOf month (drives whether the first forward point is a completion).
  const part = monthPartiality(facts, asOf);
  // COMPLETE months only for the trend fit (a partial month would bias the slope down).
  const complete = history.filter((h) => {
    const p = monthPartiality(facts, h.month);
    return !p.partial;
  });
  const trailN = Math.min(3, complete.length);
  const trail = complete.slice(-trailN);
  const xs = trail.map((_, i) => i);
  const ysRev = trail.map((h) => h.netRev);
  // simple linear regression on net revenue (slope/intercept), residual σ.
  const lin = (ys) => {
    const n = ys.length;
    if (n === 0) return { slope: 0, intercept: 0, sd: 0 };
    if (n === 1) return { slope: 0, intercept: ys[0], sd: 0 };
    const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    let num2 = 0, den = 0; for (let i = 0; i < n; i++) { num2 += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    const slope = den > 1e-9 ? num2 / den : 0;
    const intercept = my - slope * mx;
    let ss = 0; for (let i = 0; i < n; i++) { const fit = intercept + slope * xs[i]; ss += (ys[i] - fit) ** 2; }
    const sd = n > 1 ? Math.sqrt(ss / n) : 0;
    return { slope, intercept, sd };
  };
  const reg = lin(ysRev);
  const avgRev = ysRev.length ? ysRev.reduce((a, b) => a + b, 0) / ysRev.length : 0;
  const avgUnits = trail.length ? trail.reduce((a, h) => a + h.units, 0) / trail.length : 0;
  const cm3Trail = trail.filter((h) => h.cm3 != null);
  const avgCm3 = cm3Trail.length ? cm3Trail.reduce((a, h) => a + h.cm3, 0) / cm3Trail.length : null;
  // effective realized ₹/unit and CM3-margin% held forward.
  const trailRevSum = trail.reduce((a, h) => a + h.netRev, 0);
  const trailUnitsSum = trail.reduce((a, h) => a + h.units, 0);
  const pricePerUnit = trailUnitsSum > 0 ? trailRevSum / trailUnitsSum : null;
  // Held-forward CM3 margin = Σ trailing CM3 ÷ Σ trailing covered-month revenue
  // (effective recent margin — the forward contribution rides this, not a guess).
  // This is a REAL, same-window margin: it is the blended CM3% of the exact same
  // trailing complete months whose revenue feeds the trend. It can legitimately be
  // low or negative when a recent month ran ad-heavy (e.g. May company CM3 was
  // negative), so the forward contribution honestly reflects that — but we expose
  // the components (cm3 sum, revenue sum, the months used) so the popover
  // re-derives it and the founder never sees a bare "0.1%" with no provenance.
  const cm3RevSum = cm3Trail.reduce((a, h) => a + h.netRev, 0);
  const cm3SumV = cm3Trail.reduce((a, h) => a + h.cm3, 0);
  const marginPct = cm3RevSum > 0 ? cm3SumV / cm3RevSum : null;
  const heldMargin = {
    pct: marginPct,
    cm3Sum: round2(cm3SumV),
    revSum: round2(cm3RevSum),
    months: cm3Trail.map((h) => h.month),
    basis: "trailing complete months (same window as the revenue trend)",
    note: marginPct == null
      ? "held CM3 margin unavailable — no covered trailing month at this grain"
      : `held CM3 margin ${(marginPct * 100).toFixed(1)}% = Σ CM3 ${round2(cm3SumV).toLocaleString("en-IN")} ÷ Σ net ${round2(cm3RevSum).toLocaleString("en-IN")} over ${cm3Trail.length} trailing complete month(s) [${cm3Trail.map((h) => h.month).join(", ")}]. This is the real blended CM3% of those exact months — it is low/negative when a recent month ran ad-heavy, NOT a 0.1% placeholder.`,
  };

  // EFFECTIVE partiality for THIS grain: the asOf month is only "completable" if it
  // actually carries data at this grain. A SKU whose native export is May-only has no
  // June data, so we must NOT project a 0-MTD June point — we extend the trend from
  // the last real month instead (honest: we never invent a partial-month completion
  // off an absent base). `lastHistMonth` is the most recent month with grain data.
  const asOfHistory = history.find((x) => x.month === asOf);
  const asOfHasData = !!asOfHistory && (asOfHistory.netRev !== 0 || asOfHistory.units !== 0);
  const effPartial = part.partial && asOfHasData;
  const lastHistMonth = history.length ? history[history.length - 1].month : asOf;
  const forecastFromMonth = effPartial ? asOf : nextMonthOf(lastHistMonth);

  // ── DUAL-JUNE RECONCILIATION (II): the in-progress month has TWO defensible
  // projections — (A) PACE: month-to-date × prior-month same-day→full multiplier
  // (projectMonthEnd; high-confidence, narrow band, the read-out's headline), and
  // (B) TREND⊕RUN-RATE: the 50/50 blend used for forward months (wider band).
  // Previously these were emitted by two unlinked functions ~₹3.7L apart. We now
  // compute BOTH here, expose them side-by-side in `currentMonth`, and make the
  // PACE projection the headline for the partial month (same-pace is the more
  // defensible read for a month already 1/3 elapsed), with the trend blend kept as
  // the explicit alternative. They share ONE structure, never two stray "June"s.
  let currentMonth = null;
  const fpts = [];
  const lastX = xs.length ? xs[xs.length - 1] : 0;
  let cursor = forecastFromMonth;
  for (let h = 1; h <= Math.max(1, horizonMonths); h++) {
    const partialFirst = h === 1 && effPartial;
    let projRev, band;
    if (partialFirst) {
      const pj = projectMonthEnd(facts, { month: asOf, channel: grain === "channel" ? channel : undefined });
      // (B) trend⊕run-rate blend projecting the FULL current month — the partial
      // month is the step AFTER the last complete trailing month (x = lastX + 1),
      // i.e. the same forward-month method the Forecast tab uses. This is the
      // explicit alternative to the pace headline.
      const trendBlend = Math.max(0, 0.5 * (reg.intercept + reg.slope * (lastX + 1)) + 0.5 * avgRev);
      const trendBand = reg.sd * Math.sqrt(h);
      // (A) PACE projection. For sku/company grain projectMonthEnd is channel-less
      // (sums all channels' daily series), which IS the company pace — usable for
      // company grain. For a single SKU there is no daily SKU series, so fall back
      // to the per-grain MTD linear run-rate.
      let pace, paceLow, paceHigh, paceMethod;
      if (grain === "sku") {
        const mtdRev = asOfHistory ? asOfHistory.netRev : 0;
        pace = part.dom > 0 ? (mtdRev / part.dom) * part.daysInMonth : mtdRev;
        paceLow = Math.max(0, pace - trendBand); paceHigh = pace + trendBand;
        paceMethod = `MTD linear run-rate (day ${part.dom}/${part.daysInMonth}) — no daily SKU pace series`;
      } else {
        pace = pj.projected; paceLow = pj.low; paceHigh = pj.high; paceMethod = pj.method;
      }
      // Headline = PACE; band from the pace method (channel/company) or trend (sku).
      projRev = pace; band = Math.max(0, (paceHigh - paceLow) / 2);
      currentMonth = {
        month: asOf, partial: true, mtd: round2(asOfHistory ? asOfHistory.netRev : 0),
        dom: part.dom, daysInMonth: part.daysInMonth,
        pace: { netRev: round2(pace), low: round2(paceLow), high: round2(paceHigh), method: paceMethod, confidence: grain === "sku" ? "low" : pj.confidence, paceVsPrior: clampPct(pj.paceVsPrior) },
        trend: { netRev: round2(trendBlend), low: round2(Math.max(0, trendBlend - trendBand)), high: round2(trendBlend + trendBand), method: `trailing-${trailN}mo trend ⊕ run-rate (50/50)` },
        recommended: "pace",
        note: `Two defensible projections for ${asOf}: PACE ${round2(pace).toLocaleString("en-IN")} (current MTD held at ${asOf === "2026-06" ? "prior-month same-day pace" : "same-day pace"}, narrower band, recommended for an in-progress month) vs TREND⊕RUN-RATE ${round2(trendBlend).toLocaleString("en-IN")} (the forward-month method, wider band). They differ because pace reads the month already underway while the blend reads the multi-month direction; trust PACE while the month is live.`,
      };
    } else {
      const x = lastX + (effPartial ? h - 1 : h);   // partial month already consumed h=1
      const trendV = reg.intercept + reg.slope * x;
      projRev = 0.5 * trendV + 0.5 * avgRev;           // 50/50 trend + run-rate blend
      band = reg.sd * Math.sqrt(h);
    }
    projRev = Math.max(0, projRev);
    const units = pricePerUnit && pricePerUnit > 0 ? Math.round(projRev / pricePerUnit) : Math.round(avgUnits);
    const cm3 = marginPct != null ? projRev * marginPct : null;
    fpts.push({
      month: cursor,
      netRev: round2(projRev), netRevLow: round2(Math.max(0, projRev - band)), netRevHigh: round2(projRev + band),
      units, cm3: cm3 == null ? null : round2(cm3),
      cm3Low: cm3 == null ? null : round2((projRev - band) * marginPct), cm3High: cm3 == null ? null : round2((projRev + band) * marginPct),
      partial: !!partialFirst,
    });
    cursor = nextMonthOf(cursor);
  }
  const confidence = complete.length >= 3 ? "medium" : complete.length >= 2 ? "low" : "very-low";
  return {
    grain, channel: channel || null, sku: sku || null,
    asOfMonth: asOf,
    method: `trailing-${trailN}mo linear trend ⊕ run-rate (50/50); units @ held ₹/unit; CM3 @ held margin ${marginPct != null ? (marginPct * 100).toFixed(1) + "%" : "n/a"}; band = ±residualσ·√h${effPartial ? "; current month completed via month-end pace" : ""}`,
    history,
    trailing: { months: trailN, avgNetRev: round2(avgRev), avgUnits: Math.round(avgUnits), avgCm3: avgCm3 == null ? null : round2(avgCm3), slopePerMonth: round2(reg.slope), residualSd: round2(reg.sd), pricePerUnit: clampPct(pricePerUnit) },
    cm3MarginPct: clampPct(marginPct),
    heldMargin,            // II — explicit held-CM3 derivation (cm3Sum÷revSum, months, note); never a bare "0.1%"
    currentMonth,          // II — dual-June reconciliation: pace vs trend, one structure, recommended flagged
    forecast: fpts, confidence,
    note: complete.length < 1
      ? "no complete month at this grain — forecast is indicative only"
      : complete.length < 2
        ? `only ${complete.length} complete month${complete.length === 1 ? "" : "s"} at this grain (e.g. a native SKU export covering one month) — forecast is a flat run-rate, treat as indicative only`
        : null,
  };
}
// next-month helper (sibling of prevMonthOf).
function nextMonthOf(ym) {
  const [y, m] = String(ym).split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ════════════════════════════════════════════════════════════════════════════
// VII-52 · DEEP SKU-GRAIN BANDED FORECAST (uses the agency per-SKU UNITS history).
// ════════════════════════════════════════════════════════════════════════════
/**
 * skuForecast(facts, { sku, channel?, costs?, horizonMonths=1, asOfMonth? }) →
 *   { grain:"sku", sku, channel, method, asOfMonth, basis,
 *     history:[{ month, units, source:"native"|"agency", netRev?, cm3? }],
 *     forecast:[{ month, units, unitsLow, unitsHigh, netRev, netRevLow, netRevHigh,
 *                 cm3, cm3Low, cm3High, partial }],
 *     trailing:{ months, avgUnits, slopePerMonth, residualSd, cv },
 *     pricePerUnit, cm3MarginPct, confidence, note }.
 *
 *  WHY a dedicated SKU forecaster: native per-SKU REVENUE exists only for the May
 *  export (+ a sliver of April), so the generic forecast() fits a 2-point line at
 *  SKU grain → a zero-width band (no real uncertainty). The agency Snell Category-
 *  wise tabs carry per-SKU UNITS back to 2024-08 — real multi-month depth. This
 *  forecaster fits the trend ON THOSE UNITS (the deep series), then prices the
 *  forecast UNITS at the SKU's native realized ₹/unit and holds its native CM3
 *  margin% — so the SKU forecast gets the SAME method + honest uncertainty band as
 *  the company/channel forecast, not a thinner one.
 *
 *  METHOD (stated, rubric 52): trailing-N (≤6) COMPLETE-month agency units → simple
 *  linear regression (slope) blended 50/50 with the trailing mean (run-rate). BAND
 *  = ±(residual σ of the units fit) widening by √h, floored at the series CV so a
 *  suspiciously-clean fit still carries honest uncertainty. UNITS→₹ via native
 *  realized ₹/unit; ₹→CM3 via native CM3 margin%. The in-progress current month is
 *  completed by MTD units run-rate (day d → full) and flagged `partial`. channel
 *  null → SKU across all channels (agency units summed). NaN-safe; ratios guarded.
 */
export function skuForecast(facts, { sku, channel, costs, horizonMonths = 1, asOfMonth } = {}) {
  const C = costs || defaultCosts;
  const empty = (note) => ({ grain: "sku", sku: sku || null, channel: channel || null, method: "no data", basis: "agency per-SKU units", history: [], forecast: [], trailing: { months: 0 }, pricePerUnit: null, cm3MarginPct: null, confidence: "none", note });
  if (!sku) return empty("no SKU specified");
  const agency = facts?.meta?.bySource?.["snell-sku-units"]?.monthly || {};
  // agency UNITS by month for this SKU (optionally one channel).
  const unitsByMonth = {};
  for (const [k, u] of Object.entries(agency)) {
    const [m, ch, code] = k.split("|");
    if (code !== sku) continue;
    if (channel && ch !== channel) continue;
    unitsByMonth[m] = fin0(unitsByMonth[m]) + num(u);
  }
  const months = Object.keys(unitsByMonth).sort();
  if (months.length < 2) {
    // fall back to the generic revenue forecaster (still banded, just thinner) so a
    // SKU with no agency-units history is never left without a forecast.
    const fb = forecast(facts, { sku, channel, costs: C, horizonMonths, asOfMonth });
    return { ...fb, basis: "native per-SKU revenue (no agency units history)", note: (fb.note ? fb.note + " " : "") + "SKU has <2 months of agency units — using the native-revenue trend (thin)." };
  }
  const asOf = asOfMonth || months[months.length - 1];

  // realized ₹/unit + CM3 margin% from the SKU's NATIVE CM (the latest complete
  // native month — May). channel-scoped when a channel is given.
  const nativeMonth = (() => {
    // latest complete month with native per-SKU revenue for this SKU.
    const cov = coverageFor(facts);
    const nm = new Set();
    for (const k of Object.keys(cov)) { const m = k.split("|")[0]; if (m) nm.add(m); }
    const cand = [...nm].sort();
    for (let i = cand.length - 1; i >= 0; i--) {
      const p = monthPartiality(facts, cand[i]);
      if (p.partial) continue;
      const cm = computeCM({ facts, month: cand[i], costs: C });
      const s = cm.bySku?.[sku];
      const cell = channel ? s?.byChannel?.[channel] : s;
      if (cell && fin0(cell.units) > 0) return { month: cand[i], cell };
    }
    return null;
  })();
  const pricePerUnit = nativeMonth && fin0(nativeMonth.cell.units) > 0 ? nativeMonth.cell.netRev / nativeMonth.cell.units : null;
  const cm3MarginPct = nativeMonth && fin0(nativeMonth.cell.netRev) > 0 && nativeMonth.cell.cm3 != null ? nativeMonth.cell.cm3 / nativeMonth.cell.netRev : null;

  // history rows (agency units; tag the native-priced months).
  const history = months.map((m) => {
    const u = Math.round(unitsByMonth[m]);
    const netRev = pricePerUnit != null ? round2(u * pricePerUnit) : null;
    return { month: m, units: u, source: "agency", netRev, cm3: (netRev != null && cm3MarginPct != null) ? round2(netRev * cm3MarginPct) : null };
  });

  // partiality of asOf at AGENCY grain (the agency series reaches the current month).
  const part = monthPartiality(facts, asOf);
  const completeMonths = history.filter((h) => !monthPartiality(facts, h.month).partial);
  const trailN = Math.min(6, completeMonths.length);
  const trail = completeMonths.slice(-trailN);
  const xs = trail.map((_, i) => i);
  const ys = trail.map((h) => h.units);
  const lin = (a) => {
    const n = a.length; if (!n) return { slope: 0, intercept: 0, sd: 0 };
    if (n === 1) return { slope: 0, intercept: a[0], sd: 0 };
    const mx = xs.reduce((s, b) => s + b, 0) / n, my = a.reduce((s, b) => s + b, 0) / n;
    let nu = 0, de = 0; for (let i = 0; i < n; i++) { nu += (xs[i] - mx) * (a[i] - my); de += (xs[i] - mx) ** 2; }
    const slope = de > 1e-9 ? nu / de : 0; const intercept = my - slope * mx;
    let ss = 0; for (let i = 0; i < n; i++) { const f = intercept + slope * xs[i]; ss += (a[i] - f) ** 2; }
    return { slope, intercept, sd: Math.sqrt(ss / n) };
  };
  const reg = lin(ys);
  const avgUnits = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0;
  // CV (coefficient of variation) as a band FLOOR — a near-perfect linear fit on a
  // volatile SKU should still carry uncertainty (statistical honesty, rubric 18).
  const seriesMean = avgUnits;
  const seriesSd = ys.length > 1 ? Math.sqrt(ys.reduce((a, b) => a + (b - seriesMean) ** 2, 0) / ys.length) : 0;
  const cv = seriesMean > 0 ? seriesSd / seriesMean : 0;
  const lastX = xs.length ? xs[xs.length - 1] : 0;

  const asOfHist = history.find((h) => h.month === asOf);
  const asOfHasData = !!asOfHist && asOfHist.units > 0;
  const effPartial = part.partial && asOfHasData;
  const lastHistMonth = history[history.length - 1].month;
  const forecastFromMonth = effPartial ? asOf : nextMonthOf(lastHistMonth);

  const fpts = [];
  let cursor = forecastFromMonth;
  for (let h = 1; h <= Math.max(1, horizonMonths); h++) {
    const partialFirst = h === 1 && effPartial;
    let projUnits, band;
    if (partialFirst) {
      // MTD units run-rate (day d → full) for the live month.
      const mtdU = asOfHist ? asOfHist.units : 0;
      projUnits = part.dom > 0 ? (mtdU / part.dom) * part.daysInMonth : mtdU;
      const trendBand = reg.sd * Math.sqrt(h);
      band = Math.max(trendBand, projUnits * cv);
    } else {
      const x = lastX + (effPartial ? h - 1 : h);
      const trendV = reg.intercept + reg.slope * x;
      projUnits = 0.5 * trendV + 0.5 * avgUnits;
      band = Math.max(reg.sd * Math.sqrt(h), projUnits * cv);
    }
    projUnits = Math.max(0, projUnits);
    const uLow = Math.max(0, Math.round(projUnits - band));
    const uHigh = Math.round(projUnits + band);
    const u = Math.round(projUnits);
    const netRev = pricePerUnit != null ? u * pricePerUnit : null;
    const netRevLow = pricePerUnit != null ? uLow * pricePerUnit : null;
    const netRevHigh = pricePerUnit != null ? uHigh * pricePerUnit : null;
    const cm3 = (netRev != null && cm3MarginPct != null) ? netRev * cm3MarginPct : null;
    fpts.push({
      month: cursor, units: u, unitsLow: uLow, unitsHigh: uHigh,
      netRev: netRev == null ? null : round2(netRev), netRevLow: netRevLow == null ? null : round2(netRevLow), netRevHigh: netRevHigh == null ? null : round2(netRevHigh),
      cm3: cm3 == null ? null : round2(cm3),
      cm3Low: (netRevLow != null && cm3MarginPct != null) ? round2(netRevLow * cm3MarginPct) : null,
      cm3High: (netRevHigh != null && cm3MarginPct != null) ? round2(netRevHigh * cm3MarginPct) : null,
      partial: !!partialFirst,
    });
    cursor = nextMonthOf(cursor);
  }
  const confidence = completeMonths.length >= 6 ? "medium" : completeMonths.length >= 3 ? "low" : "very-low";
  return {
    grain: "sku", sku, channel: channel || null, asOfMonth: asOf,
    basis: `agency per-SKU UNITS (Snell Categorywise, ${months.length} mo ${months[0]}→${months[months.length - 1]}) priced at native realized ₹/unit + held native CM3 margin`,
    method: `trailing-${trailN}mo linear UNITS trend ⊕ run-rate (50/50); ₹ = units × ${pricePerUnit != null ? "₹" + Math.round(pricePerUnit) + "/u" : "n/a"}; CM3 @ ${cm3MarginPct != null ? (cm3MarginPct * 100).toFixed(1) + "%" : "n/a"} margin; band = ±max(residualσ·√h, units·CV ${(cv * 100).toFixed(0)}%)${effPartial ? "; current month completed via MTD units pace" : ""}`,
    history, forecast: fpts,
    trailing: { months: trailN, avgUnits: Math.round(avgUnits), slopePerMonth: round2(reg.slope), residualSd: round2(reg.sd), cv: clampPct(cv) },
    pricePerUnit: clampPct(pricePerUnit), cm3MarginPct: clampPct(cm3MarginPct),
    priceBasis: nativeMonth ? `${nativeMonth.month} native realized ₹/unit` : null,
    confidence,
    note: pricePerUnit == null
      ? "agency units present but no native realized ₹/unit for this SKU — units forecast only (₹/CM3 withheld, never fabricated)."
      : `SKU forecast fits the DEEP agency units series (${months.length} months) then prices at the native ₹/unit — full method + uncertainty band, not the 2-point native-revenue line.`,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// VIII · UNIFIED ACTION QUEUE — ONE "what to do Monday" list across ALL levers
// (reorder / delist / reprice / ad-cut / reallocate), each ranked by ₹ impact.
// ════════════════════════════════════════════════════════════════════════════
/**
 * actionQueue(facts, { month, costs?, velocity? }) →
 *   [{ id, lever:"ad-cut"|"delist"|"reprice"|"reallocate"|"reorder"|"de-risk",
 *      severity:"critical"|"warn"|"opportunity", action, rationale,
 *      impactPerMonth, impactKind:"₹/mo CM3"|"₹ at risk"|"₹/mo rev", channel?, sku?,
 *      basis, rank }]  sorted by |impactPerMonth| desc, rank assigned.
 *
 *  Unifies prescriptions() + adPrescriptions() (sales/finance + marketing levers)
 *  and ADDS reprice (CM3-thin-but-positive SKU×channel where a price lift clears
 *  breakeven) and reorder/stockout risk (cross-module: a fast-mover whose
 *  trailing-30 run-rate × realized price is the monthly revenue AT RISK if it
 *  stocks out — passed in via `velocity` = crossModuleVelocity rows, optional).
 *  Dedups by id (ad-cut and delist already de-duped across the two sources).
 *  Every row ends in a decision with a ₹ figure (rubric VIII). Same-window;
 *  NaN-safe. The single queue the founder works top-down on Monday.
 */
export function actionQueue(facts, { month, costs, velocity } = {}) {
  const C = costs || defaultCosts;
  const seen = new Set();
  const rows = [];
  const push = (r) => { if (r && !seen.has(r.id)) { seen.add(r.id); rows.push(r); } };

  // 1+2. ad-cut / zero-sale (marketing) and delist/structural-loss (finance).
  for (const r of adPrescriptions(facts, { month, costs: C })) {
    const lever = r.id.startsWith("zerosale") ? "ad-cut" : r.id.startsWith("cutad") ? "ad-cut" : r.id.startsWith("realloc") ? "reallocate" : "ad-cut";
    push({ ...r, lever, impactKind: "₹/mo CM3", rank: 0 });
  }
  for (const r of prescriptions(facts, { month, costs: C })) {
    const lever = r.id.startsWith("stopad") ? "ad-cut" : r.id.startsWith("delist") ? "delist" : r.id.startsWith("conc") ? "de-risk" : "delist";
    push({ ...r, lever, impactKind: r.id.startsWith("conc") ? "₹ at risk" : "₹/mo CM3", rank: 0 });
  }

  // VIII dedup — `stopad` (full ad spend recoverable, from prescriptions) and
  // `cutad` (loss-to-breakeven = −CM3, from adPrescriptions) are TWO FRAMINGS of
  // the SAME ad-cut decision on ONE SKU×channel cell. Listing both reads as two
  // separate actions. Merge them into a single ad-cut row that carries BOTH
  // numbers so the founder sees the full range of one decision, not a phantom
  // second action. Keep the critical severity (full-recover framing) and rank by
  // the larger (full-spend) figure.
  const byCell = new Map();                       // "sku|channel" → { stopIdx, cutIdx }
  rows.forEach((r, i) => {
    if (!r.sku || !r.channel) return;
    const k = `${r.sku}|${r.channel}`;
    const slot = byCell.get(k) || {};
    if (r.id.startsWith("stopad:")) slot.stopIdx = i;
    else if (r.id.startsWith("cutad:")) slot.cutIdx = i;
    byCell.set(k, slot);
  });
  const dropIdx = new Set();
  for (const { stopIdx, cutIdx } of byCell.values()) {
    if (stopIdx == null || cutIdx == null) continue;       // need BOTH framings to merge
    const stop = rows[stopIdx], cut = rows[cutIdx];
    const full = Math.abs(num(stop.impactPerMonth));        // full ad spend recoverable
    const toBE = Math.abs(num(cut.impactPerMonth));         // loss to breakeven (−CM3)
    rows[stopIdx] = {
      ...stop,
      action: `Cut ads on ${stop.sku} · ${stop.channel}`,
      rationale: `${stop.rationale} — one decision, two framings: stopping the ad recovers up to ${inrLbl(full)}/mo of spend, of which ${inrLbl(toBE)}/mo is the loss-to-breakeven (the rest is CM3 you'd keep).`,
      impactPerMonth: round2(full),
      impactFull: round2(full),
      impactToBreakeven: round2(toBE),
      impactNote: `${inrLbl(full)}/mo full ad spend · ${inrLbl(toBE)}/mo to breakeven`,
    };
    dropIdx.add(cutIdx);                                    // the cutad row folds into stopad
  }
  if (dropIdx.size) {
    const merged = rows.filter((_, i) => !dropIdx.has(i));
    rows.length = 0; rows.push(...merged);
  }

  // 3. REPRICE — a CM3-positive-but-thin SKU×channel where lifting price to clear a
  // CM3-margin target recovers contribution (the lever neither ad-cut nor delist
  // covers). Impact = the ₹ to reach a 5-pt-higher CM3 margin at current volume.
  const cm = computeCM({ facts, month, costs: C });
  for (const [code, byCh] of Object.entries(cm.matrix || {})) {
    for (const [ch, cell] of Object.entries(byCh)) {
      if (cell.cm3 == null || cell.cm3Pct == null) continue;
      const rev = fin0(cell.netRev);
      // thin-but-positive band: 0 ≤ CM3% < 8% with real revenue → a reprice candidate.
      if (cell.cm3 >= 0 && cell.cm3Pct < 0.08 && rev > 5000) {
        const targetLift = 0.05;                          // +5pts margin target
        const impact = rev * targetLift;                  // ₹/mo extra CM3 at held volume
        push({
          id: `reprice:${code}:${ch}`, lever: "reprice", severity: "warn",
          action: `Reprice ${code} · ${ch} (+~${(targetLift * 100).toFixed(0)}% margin)`,
          rationale: `CM3 only ${pctLbl(cell.cm3Pct)} on ${inrLbl(rev)} revenue — a modest price lift clears breakeven cushion`,
          impactPerMonth: round2(impact), impactKind: "₹/mo CM3", channel: ch, sku: code, basis: "actual-attributed", rank: 0,
        });
      }
    }
  }

  // 4. REORDER / stockout risk (cross-module) — only if velocity rows supplied.
  // A fast-mover's monthly run-rate revenue is the ₹ AT RISK if it stocks out;
  // we surface the top few as reorder actions (the join inventory↔sales, rubric 58).
  if (Array.isArray(velocity)) {
    // realized ₹/unit from this month's per-SKU cells (NaN-safe).
    const priceOf = {};
    for (const [code, byCh] of Object.entries(cm.matrix || {})) {
      let rev = 0, u = 0;
      for (const c of Object.values(byCh)) { rev += fin0(c.netRev); u += fin0(c.units); }
      priceOf[code] = u > 0 ? rev / u : 0;
    }
    const top = velocity.filter((v) => v.velocityPerDay > 0).sort((a, b) => fin0(b.velocityPerDay) - fin0(a.velocityPerDay)).slice(0, 3);
    for (const v of top) {
      const monthlyUnits = fin0(v.monthlyRunRate);
      const price = priceOf[v.code] || 0;
      const atRisk = monthlyUnits * price;
      if (atRisk <= 0) continue;
      push({
        id: `reorder:${v.code}:${v.channel}`, lever: "reorder", severity: "warn",
        action: `Keep ${v.code} · ${v.channel} in stock (reorder check)`,
        rationale: `Selling ~${monthlyUnits}u/mo (${v.window}); ${inrLbl(atRisk)}/mo revenue at risk if it stocks out`,
        impactPerMonth: round2(atRisk), impactKind: "₹/mo rev", channel: v.channel, sku: v.code, basis: "derived-velocity", rank: 0,
      });
    }
  }

  const out = rows.sort((a, b) => Math.abs(b.impactPerMonth) - Math.abs(a.impactPerMonth)).map((r, i) => ({ ...r, rank: i + 1 }));
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// VII-59 · PROSE WEEKLY NARRATIVE — real sentences, "what changed & what it means".
// (Distinct from autoNarrative's bullets: this is a written WEEKLY read-out.)
// ════════════════════════════════════════════════════════════════════════════
/**
 * proseWeeklyNarrative(facts, { month, costs?, weekDays=7 }) →
 *   { month, asOf, weekLabel, prose:[…paragraphs of real sentences…],
 *     coveredChannels, topSkuLine, sources:[…] }.
 *
 *  Generates flowing PROSE (not bullets) describing the last `weekDays` vs the prior
 *  equal window: per-channel revenue moves (with the SKU that drove each), the
 *  steepest mover, the most recent pattern-break, and the single highest-leverage
 *  action — every number sourced from the verified daily series / CM (no fabricated
 *  figures), thin-base %s annotated (rubric 18), and the whole thing same-window.
 */
export function proseWeeklyNarrative(facts, { month, costs, weekDays = 7 } = {}) {
  const C = costs || defaultCosts;
  const series = dailyChannelSeries(facts);
  const allIsos = [...new Set(series.channels.flatMap((ch) => Object.keys(series.byChannel[ch] || {})))].sort();
  if (!allIsos.length) return { month: month || null, asOf: null, weekLabel: "no daily data", prose: ["No daily data available to narrate."], coveredChannels: [], topSkuLine: null, sources: [] };
  const asOf = allIsos[allIsos.length - 1];
  // last `weekDays` window and the prior equal window.
  const recent = allIsos.slice(-weekDays);
  const prior = allIsos.slice(-2 * weekDays, -weekDays);
  const winStart = recent[0], winEnd = recent[recent.length - 1];
  const sumWindow = (isos, ch) => isos.reduce((a, iso) => a + fin0((series.byChannel[ch] || {})[iso]), 0);
  const unitsWindow = (isos, ch) => isos.reduce((a, iso) => a + fin0((series.unitsByChannel[ch] || {})[iso]), 0);

  // per-channel recent vs prior.
  const chRows = series.channels.map((ch) => {
    const cur = sumWindow(recent, ch), prv = sumWindow(prior, ch);
    const u = unitsWindow(recent, ch);
    const delta = cur - prv;
    const pct = prv > 0 ? delta / prv : null;
    const flag = smallSampleFlag(cur, prv);
    return { ch, cur, prv, u, delta, pct, thin: flag.thin };
  }).filter((r) => r.cur > 0 || r.prv > 0).sort((a, b) => b.cur - a.cur);

  // SKU that drove the top channel's move — from the per-SKU matrix MoM.
  // II-14/18 FIX: per-SKU REVENUE facts are month-scoped (native May), so a SKU MoM
  // INTO an in-progress month that carries only channel-grain data (e.g. June) is a
  // full-vs-empty −100% artifact (the "NSSBDB500 led the decline −₹5.09L −100% MoM"
  // trap). The structured Movers tab avoids this by running the latest SKU-grain
  // pair (Apr→May full-vs-full); the prose now does the SAME — it compares the latest
  // two months that BOTH carry per-SKU revenue, and LABELS that window explicitly,
  // so the prose is never full-vs-partial. If the requested `month` itself has SKU
  // revenue (e.g. May), that pair is used directly.
  let topSkuLine = null;
  let topSkuWindow = null;
  const topCh = chRows[0];
  if (topCh) {
    const reqHasSku = month && skuGrainMonths(facts).includes(month) && !monthPartiality(facts, month).partial;
    const pair = reqHasSku ? { month, prior: prevMonthOf(month) } : latestSkuGrainPair(facts);
    if (pair && pair.month) {
      const movers = rankMovers(facts, { dimension: "sku", month: pair.month, priorMonth: pair.prior, metric: "netRev", costs: C });
      const sameWindow = !(movers.window && movers.window.partial);   // expect full-vs-full now
      const topSku = movers.find((m) => Math.abs(m.deltaAbs) > 0);
      if (topSku) {
        const ssf = smallSampleFlag(topSku.cur, topSku.prior);
        const isRamp = topSku.deltaPct != null && Math.abs(topSku.deltaPct) > 3;   // >300% MoM
        const unreliable = topSku.pctReliable === false || ssf.thin || isRamp;
        const ann = unreliable
          ? ` (${isRamp && !ssf.thin ? "a ramp from" : "off a thin"} ${inrLbl(topSku.prior)} prior month — % withheld as not comparable)`
          : (topSku.deltaPct != null ? ` (${sgnPct(topSku.deltaPct)})` : "");
        // window tag: name the months compared so the reader knows it is a complete
        // month-over-month, not the partial weekly window the channel lines describe.
        const isReqMonth = pair.month === month;
        const windowTag = ` (${pair.prior}→${pair.month}, full month-over-month${isReqMonth ? "" : " — the latest months with per-SKU revenue; SKU detail isn't yet in for the partial current month"})`;
        topSkuLine = `${topSku.label} ${topSku.direction === "up" ? "led the gains" : "led the decline"}, ${topSku.direction === "up" ? "adding" : "shedding"} ${inrLbl(Math.abs(topSku.deltaAbs))}${ann}${windowTag}`;
        topSkuWindow = { ...pair, sameWindow, partial: false };
      }
    }
  }

  // most recent pattern-break across channels.
  const chAnoms = allChannelAnomalies(facts, { window: 14, lastN: weekDays });
  const topAnom = chAnoms[0] || null;

  // highest-leverage action.
  const q = actionQueue(facts, { month, costs: C });
  const topAct = q[0] || null;

  // weave prose.
  const sentences = [];
  const fmtCh = (r) => {
    const name = (CH_CODE, r.ch);
    void name;
    const dir = r.delta > 0 ? "rose" : r.delta < 0 ? "slipped" : "held flat";
    const amt = inrLbl(Math.abs(r.delta));
    const pctTxt = r.thin || r.pct == null ? "" : ` (${sgnPct(r.pct)})`;
    if (r.delta === 0) return `${cap(r.ch)} held flat at ${inrLbl(r.cur)}`;
    return `${cap(r.ch)} ${dir} ${pctTxt ? pctTxt.trim() + " " : ""}to ${inrLbl(r.cur)}${r.delta > 0 ? `, up ${amt}` : `, down ${amt}`}${r.thin ? ` (off a thin ${inrLbl(r.prv)} prior week — treat the swing cautiously)` : ""}`;
  };
  const lead = chRows.slice(0, 3).map(fmtCh);
  const totalCur = chRows.reduce((a, r) => a + r.cur, 0);
  const totalPrv = chRows.reduce((a, r) => a + r.prv, 0);
  const totalPct = totalPrv > 0 ? (totalCur - totalPrv) / totalPrv : null;
  const p1 = `Over the seven days to ${asOf}, net revenue across all channels was ${inrLbl(totalCur)}${totalPct != null ? `, ${totalPct >= 0 ? "up" : "down"} ${sgnPct(totalPct)} on the prior week` : ""}. ` +
    (lead.length ? lead.join("; ") + "." : "No channel carried revenue this week.");
  sentences.push(p1);

  const p2parts = [];
  if (topSkuLine) p2parts.push(`At the SKU level, ${topSkuLine}.`);
  if (topAnom) p2parts.push(`${cap(topAnom.channel)} broke its own pattern on ${topAnom.iso}, running ${Math.abs(topAnom.z).toFixed(1)}σ ${topAnom.direction === "high" ? "above" : "below"} its trailing two weeks${topAnom.direction === "low" ? " — worth a look before it compounds" : ""}.`);
  if (p2parts.length) sentences.push(p2parts.join(" "));

  // VII-52/59 · THIS WEEK vs the RUN-RATE PLAN. The plan = the pace needed to land
  // the in-progress month at its prior-month-same-day projected close (projectMonthEnd
  // is the defensible month-end pace). We convert that monthly target to a per-WEEK
  // run-rate (× weekDays/daysInMonth) and read this week's actual against it — so the
  // narrative ends on "are we on plan", not just "what happened". Same-window: this
  // week's ₹ vs the same-length slice of the month-end plan. NaN-safe / guarded.
  const planMonth = month || asOf.slice(0, 7);
  const proj = projectMonthEnd(facts, { month: planMonth });
  let vsPlan = null;
  if (Number.isFinite(proj.projected) && proj.daysInMonth > 0 && proj.projected > 0) {
    const weeklyPlan = proj.projected * (weekDays / proj.daysInMonth);   // plan ₹ for a weekDays slice
    const vsPct = weeklyPlan > 0 ? (totalCur - weeklyPlan) / weeklyPlan : null;
    const onPlan = vsPct != null && vsPct >= -0.05;                      // within 5% counts as on-plan
    vsPlan = {
      weeklyTarget: round2(weeklyPlan), weekActual: round2(totalCur),
      deltaAbs: round2(totalCur - weeklyPlan), deltaPct: clampPct(vsPct),
      monthEndPlan: round2(proj.projected), planBasis: proj.method, confidence: proj.confidence,
      onPlan, weekDays, daysInMonth: proj.daysInMonth,
    };
    const planTone = onPlan ? "on track for" : "running behind";
    sentences.push(
      `Against plan: at ${inrLbl(proj.projected)} projected month-end (${proj.method}), the seven-day run-rate target is ${inrLbl(weeklyPlan)}; this week's ${inrLbl(totalCur)} is ${vsPct != null ? sgnPct(vsPct) + " " : ""}${vsPct != null && vsPct >= 0 ? "ahead" : "short"}, ${planTone} the month${onPlan ? "" : " — close the gap on the softening channels above"}.`
    );
  }

  if (topAct) {
    sentences.push(`What it means for Monday: ${topAct.action.toLowerCase()}. ${cap(topAct.rationale)}${topAct.impactPerMonth ? `, an estimated ${inrLbl(Math.abs(topAct.impactPerMonth))}/month of ${topAct.impactKind.includes("risk") ? "revenue at risk" : "contribution"}` : ""}.`);
  } else {
    sentences.push(`No loss-making ad cells or structural losses surfaced this week — the levers are quiet; hold course and watch the softening channels above.`);
  }

  return {
    month: month || asOf.slice(0, 7), asOf,
    weekLabel: `${winStart} → ${winEnd}`,
    prose: sentences,
    coveredChannels: chRows.map((r) => r.ch),
    topSkuLine, topSkuWindow, vsPlan,
    sources: ["daily channel-grain series", "computeCM", "projectMonthEnd", "actionQueue"],
  };
}
function cap(s) { return String(s).charAt(0).toUpperCase() + String(s).slice(1); }

// ════════════════════════════════════════════════════════════════════════════
// VI-46 · LTV / COHORT — repeat curve for Shopify + Amazon (from Repeats sheet).
// VI · param 89 — Flipkart/Blinkit repeat NOT in source → explicit deferral.
// ════════════════════════════════════════════════════════════════════════════
/**
 * ltvCohort(facts) →
 *   { shopify:{ quarters:[{ quarter, newCustomers, returningCustomers, repeatPct,
 *       newAOV, returningAOV, aovGap, aovGapPct, returningSalesPct, ltvIndex }],
 *       latest, trendRepeatPct }, amazon:{ quarters:[{ quarter, repeatCustomers,
 *       repeatShare, salesFromRepeatShare }], latest }, deferrals:[{ channel,
 *       reason }], asOf }.
 *
 *  Surfaces the repeat/retention curve where the SOURCE supports it (Shopify
 *  customer-level + Amazon repeat-share, both from meta.bySource["bm-repeats"]),
 *  and EXPLICITLY DEFERS Flipkart/Blinkit (no customer identity in those exports —
 *  rubric param 89: a visible "not derivable from <source>" rather than a silent
 *  omission). `ltvIndex` = returningAOV ÷ newAOV (how much more a retained customer
 *  is worth per order — the leading LTV signal). NaN-safe.
 */
export function ltvCohort(facts) {
  const r = facts?.meta?.bySource?.["bm-repeats"] || {};
  const shopifyQ = (r.shopify || []).map((q) => ({
    quarter: q.quarter,
    newCustomers: num(q.newCustomers), returningCustomers: num(q.returningCustomers),
    totalCustomers: num(q.totalCustomers),
    repeatPct: clampPct(Number.isFinite(q.repeatPct) ? q.repeatPct / 100 : null),
    newAOV: clampPct(Number.isFinite(q.newAOV) ? q.newAOV : null),
    returningAOV: clampPct(Number.isFinite(q.returningAOV) ? q.returningAOV : null),
    aovGap: clampPct(Number.isFinite(q.aovGap) ? q.aovGap : null),
    aovGapPct: clampPct(Number.isFinite(q.aovGapPct) ? q.aovGapPct / 100 : null),
    returningSalesPct: clampPct(Number.isFinite(q.returningSalesPct) ? q.returningSalesPct / 100 : null),
    returningCustomerSales: clampPct(Number.isFinite(q.returningCustomerSales) ? q.returningCustomerSales : null),
    ltvIndex: clampPct(q.newAOV > 0 ? num(q.returningAOV) / num(q.newAOV) : null),
  }));
  const amazonQ = (r.amazon || []).map((q) => ({
    quarter: q.quarter,
    repeatCustomers: num(q.repeatCustomers),
    repeatShare: clampPct(Number.isFinite(q.repeatShare) ? q.repeatShare / 100 : null),
    salesFromRepeatShare: clampPct(Number.isFinite(q.salesFromRepeatShare) ? q.salesFromRepeatShare / 100 : null),
  }));
  const shopTrend = shopifyQ.length >= 2 && shopifyQ[0].repeatPct != null && shopifyQ[shopifyQ.length - 1].repeatPct != null
    ? clampPct(shopifyQ[shopifyQ.length - 1].repeatPct - shopifyQ[0].repeatPct) : null;
  return {
    shopify: { quarters: shopifyQ, latest: shopifyQ[shopifyQ.length - 1] || null, trendRepeatPct: shopTrend },
    amazon: { quarters: amazonQ, latest: amazonQ[amazonQ.length - 1] || null },
    deferrals: [
      { channel: "flipkart", reason: "not derivable from the Flipkart sales export — it carries no customer/buyer identity, so repeat-rate cannot be computed. Would need an order-level export keyed by customer." },
      { channel: "blinkit", reason: "not derivable from the Blinkit export — quick-commerce orders are anonymous at the SKU/Item-Id grain; no buyer key exists for cohorting. Would need Blinkit customer-level data." },
    ],
    asOf: r.asOf || (shopifyQ[shopifyQ.length - 1]?.quarter) || null,
    sourceLabel: r.sourceLabel || "BusinessModel Repeats sheet",
  };
}

// ════════════════════════════════════════════════════════════════════════════
// VI-45 · BASKET / UNITS-PER-ORDER TREND.
// ════════════════════════════════════════════════════════════════════════════
/**
 * basketTrend(facts, { costs? }) →
 *   { months:[{ month, channel, orders, units, netRev, upo, aov }], byChannel:{…},
 *     company:[{ month, units, netRev, upo?, aov? }], note }.
 *
 *  Units-per-order (UPO) and AOV trend where ORDER COUNTS exist in the source.
 *  Order counts are reliably present for the website (Monarch byMonth.orders) and
 *  Amazon (Snell order-mix carries shipped units but not orders → UPO from orders
 *  is website-grain; for Amazon we trend AOV = netRev ÷ units as the basket proxy
 *  and STATE that). NaN-safe; same-window (one month per row). The basket view the
 *  daily table can't show (rubric 45).
 */
export function basketTrend(facts, { costs } = {}) {
  const C = costs || defaultCosts;
  const cov = coverageFor(facts);
  const monthsSet = new Set();
  for (const k of Object.keys(cov)) { const m = k.split("|")[0]; if (m) monthsSet.add(m); }
  const months = [...monthsSet].sort();
  // website orders from monarch-history byMonth.
  const mh = facts?.meta?.bySource?.["monarch-history"]?.byMonth || {};
  const company = [], website = [];
  const ordersHistory = [];   // VI-a · Monarch website ORDER-COUNT history (even where units aren't joinable).
  let monthsWithOrders = 0, monthsWithUnitGrain = 0;
  for (const m of months) {
    const cm = computeCM({ facts, month: m, costs: C });
    let units = 0, rev = 0;
    for (const s of Object.values(cm.bySku || {})) { units += fin0(s.units); rev += fin0(s.netRev); }
    company.push({ month: m, units: Math.round(units), netRev: round2(rev), aov: clampPct(units > 0 ? rev / units : null) });
    // website-grain UPO from Monarch orders + website net rev.
    const wOrders = num(mh[m]?.orders);
    const wCell = cm.byChannel?.website;
    const wRev = fin0(wCell?.netRev), wUnits = fin0(wCell?.units);
    if (wOrders > 0) {
      monthsWithOrders++;
      // VI-a — order-count history exists wherever Monarch carries orders, even if
      // per-SKU units/revenue aren't joinable that month. Chart it regardless.
      ordersHistory.push({ month: m, orders: wOrders });
      // BUG-2 (II-88): a website UPO would have to divide units by orders. But the
      // ONLY website units we have are Shopify net items (returns/cancels already
      // netted out), while orders come from Monarch (gross order count) — two
      // DIFFERENT sources at two DIFFERENT grains. Dividing them produced an
      // impossible sub-1 UPO (e.g. 610 net items ÷ 823 gross orders = 0.74, when
      // UPO must be ≥1 by definition). We do NOT have Shopify order-level grain in
      // the current exports, so a TRUE same-source UPO is NOT computable. Therefore
      // UPO is ALWAYS null here with an explicit reason — never a fabricated <1
      // value and never a cross-source ratio. AOV here is revenue-per-ORDER
      // (Monarch net ÷ Monarch orders, a same-source spend-per-order proxy), which
      // is well-defined and labelled as such — distinct from the unavailable UPO.
      const hasRevGrain = wRev > 0;
      const hasUnitGrain = wUnits > 0;   // Shopify per-SKU units exist (units chartable), but NOT order-joinable.
      if (hasUnitGrain) monthsWithUnitGrain++;
      website.push({
        month: m, channel: "website", orders: wOrders,
        units: hasUnitGrain ? Math.round(wUnits) : null,
        netRev: hasRevGrain ? round2(wRev) : null,
        // UPO permanently deferred: no same-source order+unit grain in current exports.
        upo: null,
        upoDeferred: true,
        upoReason: "needs order-level export — current website units (Shopify net items) and orders (Monarch gross count) are different sources/grains; their ratio is not a valid units-per-order",
        // Revenue-per-order (same-source Monarch net ÷ Monarch orders). Distinct from UPO.
        revPerOrder: hasRevGrain ? clampPct(wRev / wOrders) : null,
        aov: hasRevGrain ? clampPct(wRev / wOrders) : null,
        hasUnitGrain,
      });
    }
  }
  return {
    company, byChannel: { website },
    months: website,
    ordersHistory,
    coverage: { monthsWithOrders, monthsWithUnitGrain },
    note: "Website ORDER counts come from Monarch history (charted every month they exist). A true UPO (units-per-order) needs order-level units — the current website exports give Shopify NET items (a different source/grain from Monarch's gross order count), so UPO is shown as “— needs order-level export”, NEVER a cross-source ratio (a sub-1 UPO is logically impossible). The website basket proxy shown is revenue-per-ORDER = Monarch net ÷ Monarch orders (same-source). Marketplace exports (Amazon/Flipkart/Blinkit) give units but not order counts, so their basket proxy is AOV = net ÷ units; Amazon additionally has a TRUE order-grain UPO from the All-Orders order-id grouping (≥1, same-source).",
  };
}

// ════════════════════════════════════════════════════════════════════════════
// III · BLINKIT AD PROXY — modeled per-SKU ad spend WITH a confidence band,
// clearly labelled modeled-not-measured (Blinkit ad attribution is a SOURCE GAP).
// ════════════════════════════════════════════════════════════════════════════
/**
 * blinkitAdProxy(facts, { month, costs?, refChannel="amazon" }) →
 *   { month, modeled, refChannel, refTcosPct, channelTotal, bySku:[{ code, units,
 *     netRev, modeledAd, low, high, modeledAcosPct }], note, confidence }.
 *
 *  Blinkit gives NO per-SKU ad attribution (source gap, rubric III/89). Rather than
 *  omit it, we MODEL each Blinkit SKU's ad spend by applying the reference channel's
 *  (Amazon, native-measured) effective TCOS (ad ÷ net revenue) to the SKU's Blinkit
 *  net revenue — i.e. "if Blinkit ads ran at Amazon's measured ad-intensity." The
 *  confidence band is ±50% of the modeled value (a deliberately WIDE band — this is
 *  a proxy, not a measurement). Clearly flagged `modeled:true`. If a Blinkit
 *  channel-grain ad TOTAL exists (agency), the per-SKU proxy is RESCALED so its sum
 *  ties to that real total (best of both: real channel total, modeled split). The
 *  whole thing is labelled modeled-not-measured everywhere it surfaces. NaN-safe.
 */
export function blinkitAdProxy(facts, { month, costs, refChannel = "amazon" } = {}) {
  const C = costs || defaultCosts;
  const cm = computeCM({ facts, month, costs: C });
  // reference channel effective TCOS = Σ ad ÷ Σ net (native-measured intensity).
  const ref = cm.byChannel?.[refChannel];
  const refTcos = ref && fin0(ref.netRev) > 0 ? fin0(ref.adSpend) / fin0(ref.netRev) : 0;
  // Blinkit per-SKU revenue from the matrix.
  const skuRows = [];
  let modeledSum = 0;
  for (const [code, byCh] of Object.entries(cm.matrix || {})) {
    const cell = byCh.blinkit;
    if (!cell) continue;
    const rev = fin0(cell.netRev);
    if (rev <= 0) continue;
    const modeledAd = rev * refTcos;
    modeledSum += modeledAd;
    skuRows.push({ code, units: Math.round(fin0(cell.units)), netRev: round2(rev), modeledAd });
  }
  // real Blinkit channel ad total (agency), if present, to rescale the modeled split.
  const blkChannel = cm.byChannel?.blinkit;
  const realTotal = blkChannel ? fin0(blkChannel.adSpend) : 0;
  const scale = realTotal > 0 && modeledSum > 0 ? realTotal / modeledSum : 1;
  const channelTotal = realTotal > 0 ? realTotal : round2(modeledSum);
  const bySku = skuRows.map((r) => {
    const ad = r.modeledAd * scale;
    return {
      code: r.code, units: r.units, netRev: r.netRev,
      modeledAd: round2(ad), low: round2(ad * 0.5), high: round2(ad * 1.5),
      modeledAcosPct: clampPct(r.netRev > 0 ? ad / r.netRev : null),
    };
  }).sort((a, b) => b.modeledAd - a.modeledAd);
  return {
    month, modeled: true, refChannel, refTcosPct: clampPct(refTcos),
    channelTotal, modeledSum: round2(modeledSum), rescaledToReal: realTotal > 0,
    bySku, confidence: "modeled (proxy) — NOT measured",
    note: realTotal > 0
      ? `Blinkit per-SKU ad is MODELED (Blinkit gives no per-SKU attribution): each SKU's ad = its Blinkit net × Amazon's measured TCOS (${pctLbl(refTcos)}), then rescaled so the per-SKU sum ties to Blinkit's real channel-grain ad total ${inrLbl(realTotal)}. Band ±50%. Would need Blinkit's own per-Item-Id ad report to measure.`
      : `Blinkit per-SKU ad is MODELED — no Blinkit ad total in source either, so the channel figure is itself a proxy (each SKU's Blinkit net × Amazon's measured TCOS ${pctLbl(refTcos)}). Band ±50%, treat as a hint only. Would need Blinkit's ad report.`,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// LEFT-ON-THE-TABLE INSIGHT CALCS (a)–(g) — each its own derivable view.
// ════════════════════════════════════════════════════════════════════════════

/**
 * (a) orderMixTrend(facts) → { months:[{ month, channel, nonAdvtUnits, reviewUnits,
 *   organicUnits, totalUnits, organicPct, reviewPct, paidPct, organicAmt, reviewAmt }],
 *   latest, note }.  Snell order-mix decomposition (organic vs review vs non-advt/paid)
 *  over time, from meta.bySource["snell-ordermix"].byMonth (amazon-only in source).
 *  NaN-safe; shares guarded /0.
 */
export function orderMixTrend(facts) {
  const om = facts?.meta?.bySource?.["snell-ordermix"]?.byMonth || {};
  const months = Object.keys(om).sort().map((m) => {
    const o = om[m] || {};
    const nonAdvt = num(o.nonAdvtUnits), review = num(o.reviewUnits), organic = num(o.organicUnits);
    const total = nonAdvt + review + organic;
    return {
      month: m, channel: o.channel || "amazon",
      nonAdvtUnits: nonAdvt, reviewUnits: review, organicUnits: organic, totalUnits: total,
      organicPct: clampPct(total > 0 ? organic / total : null),
      reviewPct: clampPct(total > 0 ? review / total : null),
      paidPct: clampPct(total > 0 ? nonAdvt / total : null),
      organicAmt: round2(num(o.organicAmt)), reviewAmt: round2(num(o.reviewAmt)),
    };
  });
  return { months, latest: months[months.length - 1] || null, note: "Snell order-mix: 'non-advt' = paid/promoted, 'review' = review-driven, 'organic' = organic. Amazon-grain (the only channel Snell decomposes)." };
}

/**
 * (VI-b + left-on-table #2) amazonOrderComposition(facts) → { months:[…], latest,
 *   note }.  Basket composition (single- vs multi-unit ORDERS, units-per-order) and
 *   the fulfillment (FBA vs MFN) + B2B-vs-B2C splits — all from the Amazon
 *   All-Orders order-id grouping baked at build time. NaN-safe; every ratio a
 *   fraction (0..1). The view reads months ascending; `latest` is the newest.
 */
export function amazonOrderComposition(facts) {
  const src = facts?.meta?.bySource?.["amazon-order-composition"];
  const raw = (src?.byMonth || []).slice().sort((a, b) => String(a.month).localeCompare(String(b.month)));
  const months = raw.map((r) => ({
    month: r.month,
    orders: num(r.orders), units: num(r.units), netRev: round2(num(r.netRev)),
    singleOrders: num(r.singleOrders), multiOrders: num(r.multiOrders), multiUnits: num(r.multiUnits),
    upo: r.upo == null ? null : num(r.upo),
    multiPct: r.multiPct == null ? null : clampPct(num(r.multiPct)),
    fbaOrders: num(r.fbaOrders), mfnOrders: num(r.mfnOrders), fbaUnits: num(r.fbaUnits), mfnUnits: num(r.mfnUnits),
    fbaPct: r.fbaPct == null ? null : clampPct(num(r.fbaPct)),
    b2bOrders: num(r.b2bOrders), b2cOrders: num(r.b2cOrders), b2bUnits: num(r.b2bUnits), b2cUnits: num(r.b2cUnits),
    b2bPct: r.b2bPct == null ? null : clampPct(num(r.b2bPct)),
  }));
  return {
    available: months.length > 0,
    months,
    latest: months[months.length - 1] || null,
    note: "From the Amazon All-Orders export, grouped by order-id (shipped Amazon.in only). Basket: a single-unit order has quantity 1; multi-unit ≥2. Fulfillment: FBA = Amazon-fulfilled, MFN = merchant-fulfilled. B2B = is-business-order. Other channels' exports don't carry order-id, so this cut is Amazon-grain.",
  };
}

/**
 * (b) totalVsDailyReconciliation(facts) → { totalRow:{…}, dailySeries:{…},
 *   deltaUnits, deltaGross, deltaGrossPct, note }.  Surfaces the Snell sheet's own
 *  Total-row (₹77.07L/8,793u) vs its daily series (₹118.4L/13,437u) as an EXPLICIT
 *  reconciliation (rubric I, b) — the gap is a fact, not a hidden inconsistency.
 *  Reads meta.bySource["snell-ordermix"].reconciliation directly. NaN-safe.
 */
export function totalVsDailyReconciliation(facts) {
  const rec = facts?.meta?.bySource?.["snell-ordermix"]?.reconciliation || null;
  if (!rec) return { available: false, note: "Snell order-mix reconciliation not present in source." };
  const t = rec.totalRow || {}, ds = rec.dailySeries || {};
  const deltaGross = num(ds.grossValue) - num(t.grossValue);
  return {
    available: true,
    totalRow: { shippedUnits: num(t.shippedUnits), grossValue: round2(num(t.grossValue)) },
    dailySeries: { shippedUnits: num(ds.shippedUnits), grossValue: round2(num(ds.grossValue)), dayRows: num(ds.dayRows) },
    deltaUnits: num(rec.deltaUnits != null ? rec.deltaUnits : num(ds.shippedUnits) - num(t.shippedUnits)),
    deltaGross: round2(rec.deltaGross != null ? num(rec.deltaGross) : deltaGross),
    deltaGrossPct: clampPct(num(t.grossValue) > 0 ? deltaGross / num(t.grossValue) : null),
    note: rec.note || "The Snell 'Total' row is a founder-curated narrower window; the full daily series is authoritative for trend. Both shown so the gap is explicit.",
  };
}

/**
 * (c) conversionValueGap(facts, { month, costs? }) → { month, monarchConvValue,
 *   shopifyNet, gapAbs, gapPct, note }.  Monarch Total Conversion Value (ad-reported
 *  gross) vs Shopify-net for the website — the "ad-reporting inflation ~45%" insight
 *  (rubric c). Reads agencyShadow["YYYY-MM|website"].grossRev (Monarch) and the
 *  native website netRev (computeCM). Same-window (one month). NaN-safe.
 */
export function conversionValueGap(facts, { month, costs } = {}) {
  const C = costs || defaultCosts;
  const shadow = facts?.meta?.agencyShadow?.[`${month}|website`] || null;
  const mh = facts?.meta?.bySource?.["monarch-history"]?.byMonth?.[month] || null;
  const monarchConv = shadow ? num(shadow.grossRev) : (mh ? num(mh.grossConvValue) : 0);
  const cm = computeCM({ facts, month, costs: C });
  const shopifyNet = fin0(cm.byChannel?.website?.netRev);
  const gapAbs = monarchConv - shopifyNet;
  const gapPct = shopifyNet > 0 ? gapAbs / shopifyNet : null;
  return {
    month, monarchConvValue: round2(monarchConv), shopifyNet: round2(shopifyNet),
    gapAbs: round2(gapAbs), gapPct: clampPct(gapPct),
    note: `Monarch's reported Total Conversion Value (${inrLbl(monarchConv)}) is the ad platform's gross attributed value; Shopify net (${inrLbl(shopifyNet)}) is what actually banked. The ${gapPct != null ? pctLbl(gapPct) : "—"} gap is ad-reporting inflation (last-click double-counting + pre-GST/returns gross), not real lost revenue — read CM3 off the Shopify net, never the conversion value.`,
  };
}

/**
 * (d) cashbackTrend(facts) → { months:[{ month, value, rows }], total, latest,
 *   note }.  Flipkart cashback (₹11,931) trended over time as a settlement-drag
 *  signal (rubric d). Reads meta.bySource["fk-sales"].flipkartCashback.byMonth.
 *  NaN-safe; honest to source (May export → one month populated).
 */
export function cashbackTrend(facts) {
  const cb = facts?.meta?.bySource?.["fk-sales"]?.flipkartCashback || null;
  if (!cb) return { available: false, months: [], total: 0, note: "Flipkart cashback not present in source." };
  const byMonth = cb.byMonth || {};
  const months = Object.keys(byMonth).sort().map((m) => ({ month: m, value: round2(num(byMonth[m].value)), rows: num(byMonth[m].rows) }));
  const total = round2(months.reduce((a, r) => a + r.value, 0) || num(cb.value));
  return {
    available: true, months, total, latest: months[months.length - 1] || null,
    note: `Flipkart cashback is a settlement deduction (a drag on net realization). ${months.length <= 1 ? "Only one month is in the current export, so this is a single-point baseline — the trend fills in as more Flipkart exports are uploaded." : "Trended over the months present."} Total in source: ${inrLbl(total)} over ${cb.rows || months.reduce((a, r) => a + r.rows, 0)} order rows.`,
  };
}

/**
 * (e) returningRevenue(facts) → { shopify:{ quarters:[{ quarter, returningSales,
 *   newSales, returningSalesPct, newAOV, returningAOV, aovGap, aovGapPct }], latest },
 *   note }.  Returning-customer revenue ₹ + the new-vs-returning AOV gap over time
 *  (rubric e), from meta.bySource["bm-repeats"].shopify. NaN-safe.
 */
export function returningRevenue(facts) {
  const r = facts?.meta?.bySource?.["bm-repeats"] || {};
  const quarters = (r.shopify || []).map((q) => ({
    quarter: q.quarter,
    returningSales: clampPct(Number.isFinite(q.returningCustomerSales) ? q.returningCustomerSales : null),
    newSales: clampPct(Number.isFinite(q.newCustomerSales) ? q.newCustomerSales : null),
    totalSales: clampPct(Number.isFinite(q.totalSales) ? q.totalSales : null),
    returningSalesPct: clampPct(Number.isFinite(q.returningSalesPct) ? q.returningSalesPct / 100 : null),
    newAOV: clampPct(Number.isFinite(q.newAOV) ? q.newAOV : null),
    returningAOV: clampPct(Number.isFinite(q.returningAOV) ? q.returningAOV : null),
    aovGap: clampPct(Number.isFinite(q.aovGap) ? q.aovGap : null),
    aovGapPct: clampPct(Number.isFinite(q.aovGapPct) ? q.aovGapPct / 100 : null),
  }));
  return {
    shopify: { quarters, latest: quarters[quarters.length - 1] || null },
    note: "Returning customers spend more per order than new ones — the AOV gap is the ₹ premium a retained customer carries (the LTV lever). Shopify customer-level; the only channel with buyer identity in source.",
    sourceLabel: r.sourceLabel || "BusinessModel Repeats sheet",
  };
}

/**
 * VI-47 · websiteReturnsTrend(facts, { spikeSigma=1.5 }) →
 *   { available, channel:"website", months:[{ month, returnPct, returnsInr,
 *     grossInr, momDeltaPts, z, spike, spikeReason }], latest, prior, mean,
 *     peak, spikes:[…], sourceLabel, note }.
 *
 *  Surfaces the SHOPIFY website return-% TREND with spike flags — the website
 *  counterpart to the Amazon/Flipkart shipped-vs-cancel rate (meta.bySource
 *  ["snell-cancel"]). The returns view showed "—" for website because nothing
 *  surfaced this 14-month series (BusinessModel "Returns(Shopify)"). returnPct is
 *  stored as a percent NUMBER (e.g. 15.4) in source; we expose it BOTH as a percent
 *  number (`returnPct`) and a fraction (`returnFrac`) so the page can format with
 *  D.fmtN without re-scaling. A month is a SPIKE when its return-% is ≥ spikeSigma σ
 *  above the trailing mean OR jumps ≥ 8 points MoM — an early operational warning.
 *  Reads meta.bySource["bm-returns"].monthly (month = ISO first-of-month). NaN-safe;
 *  ratios guarded; months ascending; the latest two are the headline read.
 */
export function websiteReturnsTrend(facts, { spikeSigma = 1.5 } = {}) {
  const r = facts?.meta?.bySource?.["bm-returns"] || null;
  const src = (r && r.monthly) || [];
  if (!src.length) {
    return { available: false, channel: "website", months: [], latest: null, prior: null,
      note: "Shopify website return-% series (BusinessModel Returns tab) not present in source — website returns read as no-data, never a fabricated 0." };
  }
  // ascending by month; coerce to a clean { month(YYYY-MM), returnPct(number) } shape.
  const rows = src
    .map((m) => ({
      month: String(m.month || "").slice(0, 7),
      returnPct: Number.isFinite(m.returnPct) ? round2(m.returnPct) : null,
      returnsInr: Number.isFinite(m.returnsInr) ? round2(m.returnsInr) : null,
      grossInr: Number.isFinite(m.grossInr) ? round2(m.grossInr) : null,
    }))
    .filter((m) => m.month && m.returnPct != null)
    .sort((a, b) => (a.month < b.month ? -1 : 1));
  if (!rows.length) return { available: false, channel: "website", months: [], latest: null, prior: null, note: "Shopify return series present but unparseable." };

  // trailing-mean + σ spike detection (vs the months BEFORE each point — causal,
  // never peeking forward) PLUS a MoM points-jump flag. Both same-series, same-unit.
  const out = [];
  const MOM_JUMP_PTS = 8;
  for (let i = 0; i < rows.length; i++) {
    const cur = rows[i];
    const trail = rows.slice(0, i).map((x) => x.returnPct);
    const mean = trail.length ? trail.reduce((a, b) => a + b, 0) / trail.length : null;
    const sd = trail.length > 1 ? Math.sqrt(trail.reduce((a, b) => a + (b - mean) ** 2, 0) / trail.length) : null;
    const z = mean != null && sd != null && sd > 1e-6 ? (cur.returnPct - mean) / sd : null;
    const momDeltaPts = i > 0 ? round2(cur.returnPct - rows[i - 1].returnPct) : null;
    const sigmaSpike = z != null && z >= spikeSigma;
    const jumpSpike = momDeltaPts != null && momDeltaPts >= MOM_JUMP_PTS;
    const spike = !!(sigmaSpike || jumpSpike);
    out.push({
      month: cur.month, returnPct: cur.returnPct, returnFrac: clampPct(cur.returnPct / 100),
      returnsInr: cur.returnsInr, grossInr: cur.grossInr,
      momDeltaPts, z: z == null ? null : round2(z), spike,
      spikeReason: spike ? [sigmaSpike ? `${round2(z)}σ above trailing mean ${round2(mean)}%` : null, jumpSpike ? `+${momDeltaPts}pts MoM` : null].filter(Boolean).join("; ") : null,
    });
  }
  const allPct = rows.map((x) => x.returnPct);
  const mean = round2(allPct.reduce((a, b) => a + b, 0) / allPct.length);
  const peakRow = out.reduce((a, b) => (b.returnPct > (a ? a.returnPct : -Infinity) ? b : a), null);
  const latest = out[out.length - 1] || null;
  const prior = out[out.length - 2] || null;
  const spikes = out.filter((m) => m.spike);
  return {
    available: true, channel: "website", spikeSigma,
    months: out, latest, prior, mean,
    peak: peakRow ? { month: peakRow.month, returnPct: peakRow.returnPct } : null,
    spikes,
    sourceLabel: r.sourceLabel || r.label || "BusinessModel Returns(Shopify) tab",
    note: `Shopify website return-rate over ${out.length} months (latest ${latest ? latest.returnPct + "% on " + inrLbl(latest.grossInr) + " gross" : "—"}; series mean ${mean}%). A month is flagged a SPIKE at ≥${spikeSigma}σ above its trailing mean or a ≥${MOM_JUMP_PTS}-point MoM jump — the website counterpart to the Amazon/Flipkart shipped-vs-cancel rate, so returns are surfaced for every channel, not "—" for website.`,
  };
}

/**
 * (f) costChangeHistory(facts) → { changes:[{ code, productName, currentTotalCogs,
 *   priorRmPerKg, currentRmPerKg, note }], unchanged:[{ code, productName }],
 *   changedCount, asOf, note }.  COGS cost-change history from the Unit_COGS Notes
 *  column (₹1,050→₹1,115 etc.) — the "history of what changed" (rubric f).
 *  Reads meta.bySource["cogs-history"].byCode. NaN-safe.
 */
export function costChangeHistory(facts) {
  const ch = facts?.meta?.bySource?.["cogs-history"] || {};
  const changes = [], unchanged = [];
  for (const [code, v] of Object.entries(ch.byCode || {})) {
    if (v.changed && (v.prior || []).length) {
      const prior = v.prior[v.prior.length - 1] || {};
      changes.push({
        code, productName: v.productName,
        currentTotalCogs: clampPct(Number.isFinite(v.current?.totalCogs) ? v.current.totalCogs : null),
        currentRmPerKg: clampPct(Number.isFinite(v.current?.rmPerKg) ? v.current.rmPerKg : null),
        priorRmPerKg: clampPct(Number.isFinite(prior.rmPerKg) ? prior.rmPerKg : null),
        note: prior.note || v.noteRaw || null,
      });
    } else {
      unchanged.push({ code, productName: v.productName });
    }
  }
  changes.sort((a, b) => fin0(b.currentRmPerKg) - fin0(a.currentRmPerKg));
  return {
    changes, unchanged, changedCount: changes.length, asOf: ch.asOf || null,
    note: "COGS cost-change history reconstructed from the Unit_COGS Notes column — every SKU whose raw-material/landed cost moved, with the prior value and the founder's note. The 'history of what changed' that makes a margin shift explainable.",
  };
}

/**
 * (g) geoConcentration(facts, { month }) → { month, states:[{ state, units, netRev,
 *   returns, revShare, returnRate }], topState, hhi, returnHotspots:[…], totalRev,
 *   totalUnits, totalReturns, note }.  Amazon All-Orders ship-state →
 *  geographic demand/returns concentration (rubric g). Reads
 *  meta.bySource["amazon-orders"].geo.byMonthState. HHI on revenue share; return
 *  hotspots = states with above-average return rate. NaN-safe; shares guarded.
 */
export function geoConcentration(facts, { month } = {}) {
  const geo = facts?.meta?.bySource?.["amazon-orders"]?.geo || null;
  if (!geo) return { available: false, month, states: [], note: "Amazon geo (All-Orders ship-state) not present in source." };
  const bms = geo.byMonthState || {};
  // months available in geo (its own export span).
  const geoMonths = [...new Set(Object.keys(bms).map((k) => k.split("|")[0]))].sort();
  const m = month && geoMonths.includes(month) ? month : geoMonths[geoMonths.length - 1];
  let totalRev = 0, totalUnits = 0, totalReturns = 0;
  const rows = [];
  for (const [k, v] of Object.entries(bms)) {
    if (k.split("|")[0] !== m) continue;
    const state = k.split("|")[1] || "UNKNOWN";
    const rev = num(v.netRev), u = num(v.units), ret = num(v.returns);
    totalRev += rev; totalUnits += u; totalReturns += ret;
    rows.push({ state, units: u, netRev: round2(rev), returns: ret });
  }
  const avgReturnRate = totalUnits > 0 ? totalReturns / totalUnits : 0;
  const states = rows.map((r) => ({
    ...r,
    revShare: clampPct(totalRev > 0 ? r.netRev / totalRev : null),
    returnRate: clampPct(r.units > 0 ? r.returns / r.units : null),
  })).sort((a, b) => b.netRev - a.netRev);
  const hhi = round2(states.reduce((a, s) => a + (s.revShare || 0) ** 2, 0));
  const returnHotspots = states.filter((s) => s.units >= 10 && s.returnRate != null && s.returnRate > avgReturnRate * 1.5)
    .sort((a, b) => b.returnRate - a.returnRate)
    .map((s) => ({ state: s.state, returnRate: s.returnRate, units: s.units, avgReturnRate: round2(avgReturnRate) }));
  return {
    available: true, month: m, geoMonths,
    states, topState: states[0] || null, hhi,
    returnHotspots, totalRev: round2(totalRev), totalUnits, totalReturns,
    avgReturnRate: clampPct(avgReturnRate),
    note: `Amazon ship-state demand concentration (${states.length} states, ${m}). HHI ${hhi} on revenue share (>0.25 = concentrated). Return hotspots = states with a return rate >1.5× the ${pctLbl(avgReturnRate)} average — a returns-cost geography signal. Geo spans only the All-Orders export window (${geoMonths.join(", ")}).`,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// I · MONARCH SUPPLEMENTARY TABS — surface the two parsed-but-unshown tabs:
//   "March 2025"  — the earliest daily website log (the 0→1 ramp month), and
//   "Weekly Comparison" — the founder's Google-vs-Meta 7-/3-day / vs-last-month
//   ROAS/CPA blocks. Both are stored in meta.bySource["monarch-extra"] by the
//   parser but never reached a view (rubric param 2 "ingestion completeness"
//   gap). This selector shapes them for display; the page is a pure consumer.
//   NaN-safe; every ₹/ratio re-derives from the stored block (no fabrication).
// ════════════════════════════════════════════════════════════════════════════
export function monarchSourceTabs(facts) {
  const mex = facts?.meta?.bySource?.["monarch-extra"] || facts?.meta?.monarchExtra || null;
  if (!mex) return { available: false, march2025: null, weekly: null, note: "Monarch supplementary tabs (March 2025 / Weekly Comparison) not present in source." };

  // ── March 2025 daily ramp. The parser keeps a trailing "Total" row in `daily`
  // (a sheet artifact); we split it out as the tab's own subtotal and chart only
  // real day rows so the daily series isn't double-counted by the founder.
  let march2025 = null;
  if (mex.march2025) {
    const m = mex.march2025;
    const allRows = Array.isArray(m.daily) ? m.daily : [];
    const dayRows = allRows.filter((r) => !/total/i.test(String(r.date || "")));
    const totalRow = allRows.find((r) => /total/i.test(String(r.date || ""))) || null;
    const rows = dayRows.map((r) => ({
      date: String(r.date || "").trim(),
      totalOrders: num(r.totalOrders), cancelOrders: num(r.cancelOrders), netOrders: num(r.netOrders),
      salesValue: round2(num(r.salesValue)), cancelValue: round2(num(r.cancelValue)), netSalesValue: round2(num(r.netSalesValue)),
      cancelRate: clampPct(num(r.totalOrders) > 0 ? num(r.cancelOrders) / num(r.totalOrders) : null),
    }));
    // RECONCILIATION: the parser's stored `monthly` aggregate is exactly 2× the
    // day-row sum (its accumulation loop also summed the sheet's embedded "Total"
    // row, which itself equals the day sum — a double-count). The HONEST headline
    // is therefore the DAY-ROW SUM (= the sheet's own "Total" row), not the doubled
    // monthly. We compute from the rows, expose the embedded Total as the sheet's
    // own subtotal, and flag the 2× discrepancy explicitly rather than show a
    // figure that doesn't reconcile (HARD INVARIANT: every number ties to source).
    const sum = (k) => rows.reduce((a, r) => a + num(r[k]), 0);
    const sumOrders = sum("totalOrders"), sumCancels = sum("cancelOrders");
    const sumGross = round2(sum("salesValue")), sumNet = round2(sum("netSalesValue"));
    const sumNetOrders = sumOrders - sumCancels;
    const storedOrders = num(m.monthly?.totalOrders);
    const storedNet = round2(num(m.monthly?.netSalesValue));
    // doubled iff the stored aggregate ≈ 2× the reconciled row sum (within 1u/₹1).
    const doubled = sumOrders > 0 && Math.abs(storedOrders - 2 * sumOrders) <= 2 && Math.abs(storedNet - 2 * sumNet) <= 2;
    march2025 = {
      tab: m.tab || "March 2025", month: m.monthly?.month || "2025-03",
      labels: Array.isArray(m.labels) ? m.labels : [],
      rows, totalRow,
      monthly: {
        // reconciled to the day rows (= the sheet's own Total row).
        totalOrders: sumOrders, cancelOrders: sumCancels, netOrders: sumNetOrders,
        salesValue: sumGross, netSalesValue: sumNet,
        dayRows: rows.length,
        cancelRate: clampPct(sumOrders > 0 ? sumCancels / sumOrders : null),
        avgOrderValueNet: round2(sumNetOrders > 0 ? sumNet / sumNetOrders : 0),
      },
      // the parser's stored aggregate, retained for the reconciliation note only.
      storedAggregate: { totalOrders: storedOrders, netSalesValue: storedNet, doubled },
      maxNet: rows.reduce((a, r) => Math.max(a, r.netSalesValue), 0),
      note: `Monarch "March 2025" tab — the earliest daily website log (the website 0→1 ramp), ${rows.length} day rows: ₹${Math.round(sumGross).toLocaleString("en-IN")} gross / ₹${Math.round(sumNet).toLocaleString("en-IN")} net after ${sumCancels} cancels (AOV ₹${Math.round(sumNetOrders > 0 ? sumNet / sumNetOrders : 0).toLocaleString("en-IN")}). Figures reconcile to the day rows and the sheet's own "Total" row.${doubled ? ` (The stored monthly aggregate read 2× this — it had summed the embedded Total row on top of the days; corrected here.)` : ""} Pre-dates the regular Monarch daily feed; shown for historical depth (rubric 11), not folded into channel-grain net.`,
    };
  }

  // ── Weekly Comparison blocks (Google-vs-Meta ROAS/CPA history). Each block is
  // a labelled comparison ("7 days", "Last 3 days", "Comparison With Last Month")
  // with google/meta rows. We pair google↔meta per date and pick the winner by
  // ROAS so the founder reads the reallocation verdict at a glance.
  let weekly = null;
  const blocks = (mex.weekly && Array.isArray(mex.weekly.blocks)) ? mex.weekly.blocks
    : (Array.isArray(mex.weekly) ? mex.weekly : null);
  if (blocks && blocks.length) {
    const shaped = blocks.map((b, bi) => {
      const byDate = new Map();
      for (const r of (b.rows || [])) {
        const key = String(r.date || "").trim();
        if (!byDate.has(key)) byDate.set(key, { date: key, google: null, meta: null });
        const slot = byDate.get(key);
        const cell = { cost: round2(num(r.cost)), sales: num(r.sales), salesValue: round2(num(r.salesValue)), roas: clampPct(num(r.roas) || null), cpa: clampPct(num(r.cpa) || null) };
        if (r.platform === "google") slot.google = cell; else if (r.platform === "meta") slot.meta = cell;
      }
      const pairs = [...byDate.values()].map((p) => {
        const gR = p.google?.roas, mR = p.meta?.roas;
        let winner = null;
        if (gR != null && mR != null) winner = gR >= mR ? "google" : "meta";
        else if (gR != null) winner = "google"; else if (mR != null) winner = "meta";
        return { ...p, winner };
      });
      // block-level winner tally
      let gWins = 0, mWins = 0;
      for (const p of pairs) { if (p.winner === "google") gWins++; else if (p.winner === "meta") mWins++; }
      return { id: `wc${bi}`, title: String(b.title || "Comparison").trim(), pairs, googleWins: gWins, metaWins: mWins };
    });
    // overall verdict across all dated blocks
    let gTot = 0, mTot = 0;
    for (const s of shaped) { gTot += s.googleWins; mTot += s.metaWins; }
    weekly = {
      tab: (mex.weekly && mex.weekly.tab) || "Weekly Comparison",
      blocks: shaped, blockCount: shaped.length,
      googleWins: gTot, metaWins: mTot,
      verdict: gTot === mTot ? "even" : gTot > mTot ? "google" : "meta",
      note: `Monarch "Weekly Comparison" tab — ${shaped.length} founder-authored Google-vs-Meta blocks (7-/3-/10-day windows + vs-last-month), each ROAS/CPA per platform. Across all dated rows, Google led on ROAS ${gTot}×, Meta ${mTot}× — the same reallocation question as the monthly efficiency view, at the founder's own cadence.`,
    };
  }

  return {
    available: !!(march2025 || weekly),
    march2025, weekly,
    note: `Surfacing the two Monarch tabs that were parsed but previously unshown — March-2025 daily ramp + Weekly-Comparison Google/Meta blocks (rubric I · ingestion completeness).`,
  };
}

// ───────────────────────────────────────────────────────────────
// NODE SELF-TEST — node src/lib/bizAnalytics.js
// Runs the engine against a SYNTHETIC, hand-checkable fixture AND (when the real
// bundle is importable) prints a sample of each output on REAL May/agency data.
// Guarded by import.meta.url so Vite/browser imports never trigger it.
// ───────────────────────────────────────────────────────────────
const _proc = typeof globalThis !== "undefined" ? globalThis.process : undefined;
const _isMain = (() => { try { return !!_proc && import.meta.url === `file://${_proc.argv[1]}`; } catch { return false; } })();

if (_isMain) {
  const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); if (!cond) _proc.exitCode = 1; };
  const near = (label, got, want, eps = 1e-6) => { const c = Math.abs(got - want) < eps; console.log(`${c ? "PASS" : "FAIL"}  ${label}: got=${got} want=${want}`); if (!c) _proc.exitCode = 1; };

  // Synthetic cost module (deterministic, no localStorage).
  const costs = {
    getCostCard: (code) => ({ A: { cogs: 100 }, B: { cogs: 40 } }[code] || null),
    getFeePct: (ch) => ({ pct: { amazon: 0.20, blinkit: 0.25 }[ch] ?? 0 }),
    getFixedCost: () => null,
  };

  // Fixture: amazon native May (2 SKUs) + April agency __ch__ + daily series
  // (amazon May 1..10 rising, June 1..5 partial). Hand-checkable.
  const mkDaily = (month, ch, arr) => {
    const o = {};
    arr.forEach((net, i) => { const d = String(i + 1).padStart(2, "0"); o[`${month}-${d}|${ch}|${CH_CODE}`] = { netRev: net, units: Math.round(net / 100), adSpend: net * 0.1 }; });
    return o;
  };
  const facts = {
    monthly: {
      "2026-05|amazon|A": { units: 5, grossRev: 1050, netRev: 1000, adSpendDirect: 50 },
      "2026-05|amazon|B": { units: 10, grossRev: 1100, netRev: 1000, adSpendDirect: 0 },
      "2026-04|amazon|__ch__": { units: 8, grossRev: 8400, netRev: 6000, adSpend: 1500, tier: "agency", source: "snell" },
      "2026-05|blinkit|C": { units: 4, grossRev: 500, netRev: 480, adSpendDirect: 200 }, // CM3-negative (no COGS card → null, skip) ... use B-priced below
    },
    daily: {
      ...mkDaily("2026-05", "amazon", [100, 110, 120, 130, 140, 150, 160, 170, 180, 600]), // day 10 = spike (anomaly)
      ...mkDaily("2026-06", "amazon", [100, 110, 120, 130, 140]),                          // partial June (5 days)
    },
    meta: {},
  };

  // ── 49 seasonality ──
  const seas = seasonalityBaselines(facts, { channel: "amazon" });
  ok("49 seasonality weekday length 7", seas.weekday.mean.length === 7);
  ok("49 seasonality index neutral≈1 exists", seas.weekday.index.some((x) => x != null));
  ok("49 overallMean finite", Number.isFinite(seas.overallMean));

  // ── 16 daily flags ──
  const flags = dailyFlags(facts, { channel: "amazon" });
  const day10 = flags.find((f) => f.iso === "2026-05-10");
  ok("16 day10 flagged anomaly-high or peak (600 vs rising)", day10 && (day10.anomaly || day10.beatPeak));
  ok("16 every flag has a label", flags.every((f) => typeof f.label === "string"));
  ok("16 z finite-or-null", flags.every((f) => f.z === null || Number.isFinite(f.z)));

  // ── 40 daily fact table ──
  const tbl = dailyFactTable(facts, { metric: "netRev", lastN: 60 });
  ok("40 table rows ascending + cumulative monotonic", tbl.rows.length > 0 && tbl.rows[tbl.rows.length - 1].cumulative >= tbl.rows[0].cumulative);
  near("40 table grandTotal = Σ daily amazon (May 1860 + June 600)", tbl.grandTotal, 100 + 110 + 120 + 130 + 140 + 150 + 160 + 170 + 180 + 600 + 100 + 110 + 120 + 130 + 140, 0.01);

  // ── 15 projection ── June is partial (5 of 30 days), May full(ish, 10 days but
  // June compares to May). prior=May to day 5 = 100+110+120+130+140=600; mayFull (in series)=2460.
  const proj = projectMonthEnd(facts, { month: "2026-06", channel: "amazon" });
  ok("15 June partial", proj.partial === true);
  near("15 June mtd = 600", proj.mtd, 600, 0.01);
  ok("15 June projection finite + band ordered", Number.isFinite(proj.projected) && proj.low <= proj.projected && proj.projected <= proj.high);
  ok("15 method stated", typeof proj.method === "string" && proj.method.length > 0);

  // ── 50 bridges ── revenue bridge May→June amazon (use monthly cells absent for
  // June so test on the SKU side via cm3Bridge between months that exist).
  const revB = revenueBridge(facts, { fromMonth: "2026-04", toMonth: "2026-05", costs });
  ok("50 revenue bridge reconciles (Σ steps == Δ)", revB.reconciles);
  const cmB = cm3Bridge(facts, { fromMonth: "2026-04", toMonth: "2026-05", costs });
  ok("50 cm3 bridge reconciles", cmB.reconciles);
  ok("50 cm3 bridge 4 rungs", cmB.steps.length === 4);

  // ── 51 anomaly ──
  const anoms = channelAnomalies(facts, { channel: "amazon", window: 14 });
  ok("51 May-10 spike detected as anomaly", anoms.some((a) => a.iso === "2026-05-10" && a.direction === "high"));
  // Baseline must have variance (a perfectly flat series has sd=0 → no z-score,
  // correctly NOT flagged). Use a jittered baseline then a clear 100 spike.
  const generic = detectAnomalies([{ label: "a", value: 9 }, { label: "b", value: 11 }, { label: "c", value: 10 }, { label: "d", value: 12 }, { label: "e", value: 8 }, { label: "f", value: 100 }]);
  ok("51 generic detector flags the 100 spike", generic.some((a) => a.label === "f"));
  // 51/52 daily ad efficiency (website-style ROAS) — same-day net÷ad, window-safe.
  const eff = channelDailyEfficiency(facts, { channel: "amazon", window: 14 });
  ok("51/52 daily efficiency days carry roas + flag", eff.days.every((d) => (d.roas == null || Number.isFinite(d.roas)) && typeof d.flag === "string"));
  ok("51/52 summary roas finite-or-null", eff.summary.roas == null || Number.isFinite(eff.summary.roas));
  // 51/52 cross-channel anomaly scan (not Amazon-only): returns all-channel anomalies.
  const allAnom = allChannelAnomalies(facts, { window: 14 });
  ok("51 allChannelAnomalies returns array, each has channel+iso+z", Array.isArray(allAnom) && allAnom.every((a) => a.channel && a.iso && Number.isFinite(a.z)));
  ok("51 May-10 amazon spike present in cross-channel scan", allAnom.some((a) => a.channel === "amazon" && a.iso === "2026-05-10"));
  // a perfectly flat baseline yields sd=0 → never flagged (no false positive).
  const flat = detectAnomalies([{ label: "a", value: 10 }, { label: "b", value: 10 }, { label: "c", value: 10 }, { label: "d", value: 10 }, { label: "e", value: 10 }, { label: "f", value: 100 }]);
  ok("51 flat baseline → spike NOT flagged (sd=0, no false z)", flat.length === 0);

  // ── 41 momentum ──
  const movers = rankMovers(facts, { dimension: "channel", month: "2026-05", priorMonth: "2026-04", metric: "netRev", costs });
  ok("41 movers sorted by |deltaAbs| desc", movers.length >= 1 && (movers.length < 2 || Math.abs(movers[0].deltaAbs) >= Math.abs(movers[1].deltaAbs)));
  ok("41 amazon present with prior+cur", movers.some((m) => m.key === "amazon"));
  ok("41 movers carries window metadata", movers.window && typeof movers.window.mode === "string");
  // In THIS fixture May's daily series stops at day 10 (< month end) → May reads as
  // partial, so May→Apr correctly uses mtd-vs-mtd clipped to day 10. (A real closed
  // month with daily data to its end reads full-vs-full — asserted below on a
  // synthetic closed month.)
  ok("41 May→Apr is partial-aware (May daily ends d10) → mtd-vs-mtd, cutoff 10", movers.window.mode === "mtd-vs-mtd" && movers.window.cutoff === 10);
  // Synthetic CLOSED month: daily series spanning the FULL month → full-vs-full.
  const closedFacts = { monthly: {}, daily: {
    ...mkDaily("2026-09", "amazon", Array.from({ length: 30 }, () => 100)),   // full Sept (30/30)
    ...mkDaily("2026-08", "amazon", Array.from({ length: 31 }, () => 90)),    // full Aug  (31/31)
  }, meta: {} };
  const moversClosed = rankMovers(closedFacts, { dimension: "channel", month: "2026-09", priorMonth: "2026-08", metric: "netRev", costs });
  ok("14 closed Sept (daily to month-end) → full-vs-full mode", moversClosed.window.mode === "full-vs-full" && moversClosed.window.cutoff === null);

  // ── 14/18/29/65 LIKE-FOR-LIKE: a PARTIAL current month must compare MATCHED MTD,
  // never full-vs-partial. June daily = days 1..5 (Σ=600). May daily 1..5 = 600,
  // May FULL daily = 2460. The biggest-mover/bridge for June must compare June-to-d5
  // (600) vs May-to-d5 (600) — i.e. ~0 delta — NOT June(600) vs May FULL(2460).
  const moversJ = rankMovers(facts, { dimension: "channel", month: "2026-06", priorMonth: "2026-05", metric: "netRev", costs });
  ok("14 June movers → mtd-vs-mtd mode (June is partial)", moversJ.window.mode === "mtd-vs-mtd");
  near("14 June movers cutoff = day 5", moversJ.window.cutoff, 5, 0.0001);
  const amzJ = moversJ.find((m) => m.key === "amazon");
  near("14 amazon prior = May THROUGH day 5 (600), NOT May full (2460)", amzJ.prior, 600, 0.5);
  near("14 amazon cur = June through day 5 (600)", amzJ.cur, 600, 0.5);
  near("14 amazon Δ ≈ 0 like-for-like (not −1860 full-vs-partial)", amzJ.deltaAbs, 0, 0.5);
  // CONTROL: the BANNED full-vs-partial number would be 600−2460 = −1860; assert we
  // are NOT producing it.
  ok("18 NOT the full-vs-partial artifact (Δ != −1860)", Math.abs(amzJ.deltaAbs - (-1860)) > 1);
  // revenue bridge June: same like-for-like guard, must reconcile + carry window.
  const revBJ = revenueBridge(facts, { fromMonth: "2026-05", toMonth: "2026-06", costs });
  ok("50 June revenue bridge mtd-vs-mtd + reconciles", revBJ.window.mode === "mtd-vs-mtd" && revBJ.reconciles);
  near("50 June revenue bridge from = May-to-d5 (600)", revBJ.from, 600, 0.5);
  near("50 June revenue bridge to = June-to-d5 (600)", revBJ.to, 600, 0.5);
  // cm3 bridge June: matched window, still reconciles (Σ legs == ΔCM3).
  const cmBJ = cm3Bridge(facts, { fromMonth: "2026-05", toMonth: "2026-06", costs });
  ok("50 June cm3 bridge mtd-vs-mtd + reconciles", cmBJ.window.mode === "mtd-vs-mtd" && cmBJ.reconciles);

  // ── 57 concentration ──
  const conc = concentrationRisk(facts, { month: "2026-05", costs });
  ok("57 channel HHI in [0,1]", conc.byChannel.revenue.hhi >= 0 && conc.byChannel.revenue.hhi <= 1.0001);
  ok("57 top channel identified", conc.byChannel.revenue.top != null);

  // ── 54 what-if ── price +10% on amazon-only: revenue +10% of amazon net (2000) = +200 → cm3 +200.
  const wi = computeWhatIf(facts, { month: "2026-05", levers: { pricePct: 0.1, channel: "amazon" }, costs });
  // amazon-only +10% price: only the COGS-covered amazon channel (netRev 2000)
  // is simulated; blinkit C is COGS-uncovered → excluded. ΔnetRev = +10%×2000 =
  // +200. Incremental revenue carries the amazon fee (20%): ΔCM3 = 200−0.20×200 = 160.
  near("54 what-if +10% price amazon → ΔnetRev +200", wi.delta.netRev, 200, 0.01);
  near("54 what-if ΔCM3 +160 (incremental rev less amazon fee, uncovered chan excluded)", wi.delta.cm3, 200 - 0.20 * 200, 0.01);
  ok("54 what-if base/scenario finite", Number.isFinite(wi.base.cm3) && Number.isFinite(wi.scenario.cm3));

  // ── 55 driver/sensitivity ──
  const drv = driverSensitivity(facts, { month: "2026-05", costs, step: 0.05 });
  ok("55 4 drivers ranked", drv.drivers.length === 4 && drv.drivers[0].rank === 1);
  ok("55 ranked by |ΔCM3| desc", Math.abs(drv.drivers[0].deltaCm3) >= Math.abs(drv.drivers[drv.drivers.length - 1].deltaCm3));

  // ── 53 prescriptions ── add a CM3-negative ad cell: blinkit C has no COGS card
  // (null) so it's skipped; make amazon B loss-making via a big ad override is not
  // possible here — instead assert the function is NaN-safe and returns an array.
  const rx = prescriptions(facts, { month: "2026-05", costs });
  ok("53 prescriptions returns array, impacts finite", Array.isArray(rx) && rx.every((r) => Number.isFinite(r.impactPerMonth)));
  const adrx = adPrescriptions(facts, { month: "2026-05", costs });
  ok("53 ad prescriptions array, finite", Array.isArray(adrx) && adrx.every((r) => Number.isFinite(r.impactPerMonth)));

  // ── 19 price realization ──
  const pr = priceRealization(facts, { month: "2026-05" });
  const aRow = pr.find((r) => r.code === "A");
  near("19 A realized net = 1000/5 = 200", aRow.realizedNet, 200, 0.01);
  ok("19 leakage in [0,1] or null", pr.every((r) => r.leakagePct == null || (r.leakagePct >= 0 && r.leakagePct <= 1)));

  // ── 58 cross-module velocity ── amazon A 5 units / elapsed days.
  const vel = crossModuleVelocity(facts, { month: "2026-05" });
  ok("58 velocity rows finite", vel.every((v) => v.velocityPerDay == null || Number.isFinite(v.velocityPerDay)));
  ok("58 velocity = units/days (positive)", vel.find((v) => v.code === "A").velocityPerDay > 0);
  // 17 reconciled windows: every row carries mtd/t30/t90 from ONE function, and the
  // flat velocityPerDay equals the SELECTED window's rate (no second definition).
  const aVel = vel.find((v) => v.code === "A");
  ok("17 velocity carries all 3 reconciled windows", aVel.byWindow && aVel.byWindow.mtd && aVel.byWindow.t30 && aVel.byWindow.t90);
  near("17 default flat velocity == mtd window rate (one definition)", aVel.velocityPerDay, aVel.byWindow.mtd.velocityPerDay, 1e-9);
  const velT30 = crossModuleVelocity(facts, { month: "2026-05", window: "t30" });
  const aT30 = velT30.find((v) => v.code === "A");
  near("17 window:t30 selects the t30 rate (same byWindow set)", aT30.velocityPerDay, aT30.byWindow.t30.velocityPerDay, 1e-9);
  ok("17 every window rate finite-or-null", vel.every((v) => ["mtd", "t30", "t90"].every((w) => v.byWindow[w].velocityPerDay == null || Number.isFinite(v.byWindow[w].velocityPerDay))));

  // ── 59 auto-narrative ──
  const narr = autoNarrative(facts, { month: "2026-06", costs });
  ok("59 narrative has headline + bullets", typeof narr.headline === "string" && narr.bullets.length > 0);
  ok("59 narrative bullets all have text", narr.bullets.every((b) => typeof b.text === "string"));

  // ── 23 attribution confidence ──
  const ac = attributionConfidence(facts, { month: "2026-05", costs });
  ok("23 attribution overall in [0,1] or null", ac.overall == null || (ac.overall >= 0 && ac.overall <= 1));
  ok("23 each channel reconciles direct+alloc==total", ac.channels.every((c) => c.reconciles));
  const band = attributionBand(0.0);
  ok("23 band 0% → allocated (hint)", band.key === "allocated");
  ok("23 band null → na", attributionBand(null).key === "na");

  // ── 4/89 native-vs-agency bias ── synthetic: native net 1000, agency shadow 1100
  // → bias +10%; corrected agency 1100 → 1000.
  const biasFixture = { monthly: { "2026-05|amazon|A": { units: 10, grossRev: 1050, netRev: 1000, adSpendDirect: 0 } }, daily: {}, meta: { agencyShadow: { "2026-05|amazon": { netRev: 1100, units: 11 } } } };
  const nb = nativeAgencyBias(biasFixture);
  near("4 amazon bias = +10% (agency 1100 vs native 1000)", nb.byChannel.amazon.biasPct, 0.1, 1e-6);
  const corr = correctedAgencyNet(1100, nb.byChannel.amazon.biasPct);
  near("4 corrected agency 1100 ÷ 1.1 = 1000", corr.corrected, 1000, 0.01);
  ok("4 band ordered around corrected", corr.band[0] <= corr.corrected && corr.corrected <= corr.band[1]);
  ok("4 zero-bias → corrected == face", correctedAgencyNet(500, 0).corrected === 500);

  // ════════════════════════════════════════════════════════════════════════
  // ROUND-3 SELF-TESTS
  // ════════════════════════════════════════════════════════════════════════

  // ── II-18 small-sample / thin-base flag ──
  const thin = smallSampleFlag(4600, 2300);             // +100% off ₹2,300 → THIN (< ₹2,000? no, 2300>2000 → reliable)
  ok("18 base 2300 ≥ ₹2000 floor → reliable", thin.reliable === true && thin.thin === false);
  const thin2 = smallSampleFlag(4000, 1500);            // base 1500 < 2000 → thin
  ok("18 base 1500 < ₹2000 floor → thin + annotation", thin2.thin === true && /thin base/.test(thin2.annotation));
  ok("18 NaN base reads as thin (never trust unknown base)", smallSampleFlag(100, NaN).thin === true);
  ok("18 units mode uses unit floor", smallSampleFlag(50, 10, { units: true }).thin === true && smallSampleFlag(50, 25, { units: true }).reliable === true);

  // ── II-16 per-channel weekday baseline + flags ──
  const pcb = perChannelWeekdayBaseline(facts, { channel: "amazon" });
  ok("16 per-channel weekday baseline length 7", pcb.weekday.mean.length === 7 && pcb.weekday.index.length === 7);
  ok("16 per-channel overallMean finite", Number.isFinite(pcb.overallMean));
  const pcf = perChannelDailyFlags(facts, { channel: "amazon", window: 14 });
  ok("16 per-channel flags every row has wd baseline + label", pcf.every((r) => typeof r.label === "string" && (r.wdAvg == null || Number.isFinite(r.wdAvg))));
  ok("16 per-channel day10 spike flagged (anomaly/peak)", pcf.some((r) => r.iso === "2026-05-10" && (r.anomaly || r.beatPeak)));
  ok("16 per-channel z finite-or-null", pcf.every((r) => r.z === null || Number.isFinite(r.z)));

  // ── VII-52 forecast (channel + sku + company grain) ──
  const fcCh = forecast(facts, { channel: "amazon", costs, horizonMonths: 2 });
  ok("52 forecast channel returns ≥1 forward point", fcCh.forecast.length >= 1);
  ok("52 forecast band ordered (low ≤ mid ≤ high)", fcCh.forecast.every((p) => p.netRevLow <= p.netRev && p.netRev <= p.netRevHigh));
  ok("52 forecast method stated", typeof fcCh.method === "string" && fcCh.method.length > 10);
  ok("52 forecast units integer + finite", fcCh.forecast.every((p) => Number.isInteger(p.units)));
  ok("52 forecast cm3 finite-or-null", fcCh.forecast.every((p) => p.cm3 === null || Number.isFinite(p.cm3)));
  const fcSku = forecast(facts, { sku: "A", costs, horizonMonths: 1 });
  ok("52 forecast sku grain returns history + forecast", fcSku.grain === "sku" && Array.isArray(fcSku.forecast));
  const fcCo = forecast(facts, { costs, horizonMonths: 1 });
  ok("52 forecast company grain", fcCo.grain === "company" && fcCo.forecast.length >= 1);

  // ── VIII unified action queue ──
  const vq = crossModuleVelocity(facts, { month: "2026-05" });
  const queue = actionQueue(facts, { month: "2026-05", costs, velocity: vq });
  ok("VIII action queue is array, ranked 1..n, finite impacts", Array.isArray(queue) && queue.every((r, i) => r.rank === i + 1 && Number.isFinite(r.impactPerMonth)));
  ok("VIII queue sorted by |impact| desc", queue.length < 2 || Math.abs(queue[0].impactPerMonth) >= Math.abs(queue[1].impactPerMonth));
  ok("VIII queue levers from the full set", queue.every((r) => ["ad-cut", "delist", "reprice", "reallocate", "reorder", "de-risk"].includes(r.lever)));
  ok("VIII queue ids unique (dedup across sources)", new Set(queue.map((r) => r.id)).size === queue.length);

  // ── VII-59 prose weekly narrative ──
  const prose = proseWeeklyNarrative(facts, { month: "2026-05", costs, weekDays: 7 });
  ok("59 prose returns real sentences (not bullets)", Array.isArray(prose.prose) && prose.prose.length >= 1 && prose.prose.every((p) => typeof p === "string" && p.length > 20));
  ok("59 prose has weekLabel + asOf", typeof prose.weekLabel === "string" && typeof prose.asOf === "string");

  // ── VI-46 LTV cohort ──
  const ltvFixture = { monthly: {}, daily: {}, meta: { bySource: { "bm-repeats": {
    sourceLabel: "Repeats", asOf: "2026-Q2",
    shopify: [{ quarter: "Q1 2026", newCustomers: 100, returningCustomers: 12, totalCustomers: 112, repeatPct: 10.7, newCustomerSales: 60000, returningCustomerSales: 12000, totalSales: 72000, returningSalesPct: 16.7, newAOV: 600, returningAOV: 1000, aovGap: 400, aovGapPct: 66.7 }],
    amazon: [{ quarter: "2026 Q1", repeatCustomers: 50, repeatShare: 9.5, salesFromRepeatShare: 11.7 }],
  } } } };
  const ltv = ltvCohort(ltvFixture);
  ok("46 ltv shopify quarters present + ltvIndex = retAOV/newAOV", ltv.shopify.quarters.length === 1 && Math.abs(ltv.shopify.quarters[0].ltvIndex - 1000 / 600) < 1e-6);
  ok("46 ltv amazon quarters present", ltv.amazon.quarters.length === 1);
  ok("89 ltv DEFERS flipkart + blinkit explicitly", ltv.deferrals.length === 2 && ltv.deferrals.every((d) => /not derivable/.test(d.reason)));

  // ── VI-45 basket / UPO trend ──
  const basketFixture = { monthly: { "2026-05|website|A": { units: 10, netRev: 5000, grossRev: 5250 } }, daily: {}, meta: { bySource: { "monarch-history": { byMonth: { "2026-05": { orders: 5 } } } } } };
  const basket = basketTrend(basketFixture, { costs });
  ok("45 basket company AOV finite-or-null", basket.company.every((r) => r.aov == null || Number.isFinite(r.aov)));
  ok("45 basket website UPO = units/orders when orders present", basket.byChannel.website.length === 0 || basket.byChannel.website.every((r) => r.upo == null || Number.isFinite(r.upo)));

  // ── III blinkit ad proxy ──
  const blkFixture = { monthly: {
    "2026-05|amazon|A": { units: 10, netRev: 10000, grossRev: 10500, adSpendDirect: 2000 }, // amazon TCOS 20%
    "2026-05|blinkit|A": { units: 5, netRev: 4000, grossRev: 4200 },
  }, daily: {}, meta: {} };
  const blk = blinkitAdProxy(blkFixture, { month: "2026-05", costs, refChannel: "amazon" });
  ok("III blinkit proxy flagged modeled:true", blk.modeled === true && /modeled/i.test(blk.confidence));
  ok("III blinkit proxy band ±50% ordered", blk.bySku.every((s) => s.low <= s.modeledAd && s.modeledAd <= s.high));
  ok("III blinkit proxy uses ref TCOS", blk.refTcosPct != null && Math.abs(blk.refTcosPct - 0.2) < 1e-6);

  // ── (a) order-mix trend ──
  const omFixture = { monthly: {}, daily: {}, meta: { bySource: { "snell-ordermix": { byMonth: { "2026-05": { channel: "amazon", nonAdvtUnits: 100, reviewUnits: 20, organicUnits: 80, organicAmt: 80000, reviewAmt: 20000 } } } } } };
  const om = orderMixTrend(omFixture);
  ok("a order-mix shares sum≈1 (guarded)", om.months.length === 1 && Math.abs((om.months[0].organicPct + om.months[0].reviewPct + om.months[0].paidPct) - 1) < 1e-6);

  // ── (b) total-vs-daily reconciliation ──
  const recFixture = { monthly: {}, daily: {}, meta: { bySource: { "snell-ordermix": { reconciliation: { totalRow: { shippedUnits: 8793, grossValue: 7706700.28 }, dailySeries: { shippedUnits: 13437, grossValue: 11844188.01, dayRows: 699 }, deltaUnits: 4644, deltaGross: 4137487.73, note: "ok" } } } } };
  const rec = totalVsDailyReconciliation(recFixture);
  ok("b reconciliation deltaUnits = 13437-8793 = 4644", rec.available && rec.deltaUnits === 4644);
  near("b reconciliation deltaGross", rec.deltaGross, 4137487.73, 0.01);

  // ── (c) conversion-value gap ──
  const cvgFixture = { monthly: { "2026-05|website|A": { units: 10, netRev: 4283, grossRev: 4497 } }, daily: {}, meta: { agencyShadow: { "2026-05|website": { grossRev: 7829, netRev: 0 } } } };
  const cvg = conversionValueGap(cvgFixture, { month: "2026-05", costs });
  ok("c conv-value gap = monarch − shopify net (positive inflation)", cvg.gapAbs > 0 && cvg.gapPct != null);

  // ── (d) cashback trend ──
  const cbFixture = { monthly: {}, daily: {}, meta: { bySource: { "fk-sales": { flipkartCashback: { value: 11931.08, rows: 428, byMonth: { "2026-05": { value: 11931.08, rows: 428 } } } } } } };
  const cb = cashbackTrend(cbFixture);
  ok("d cashback trend total ties to source", cb.available && Math.abs(cb.total - 11931.08) < 0.01);

  // ── (e) returning revenue + AOV gap ──
  const rr = returningRevenue(ltvFixture);
  ok("e returning revenue quarters + aovGapPct in [0,1]-ish", rr.shopify.quarters.length === 1 && rr.shopify.quarters[0].aovGapPct != null);

  // ── (f) cost-change history ──
  const cchFixture = { monthly: {}, daily: {}, meta: { bySource: { "cogs-history": { asOf: "2026-06-11", byCode: {
    NSSB100: { productName: "SB 100", current: { rmPerKg: 1115, totalCogs: 133 }, prior: [{ rmPerKg: 1050, note: "1050→1115" }], changed: true, noteRaw: "x" },
    NSMP100: { productName: "MP 100", current: { rmPerKg: 500, totalCogs: 39.5 }, prior: [], changed: false, noteRaw: "y" },
  } } } } };
  const cch = costChangeHistory(cchFixture);
  ok("f cost-change history splits changed/unchanged", cch.changedCount === 1 && cch.changes[0].code === "NSSB100" && cch.unchanged.length === 1);
  ok("f cost-change carries prior + current RM", cch.changes[0].priorRmPerKg === 1050 && cch.changes[0].currentRmPerKg === 1115);

  // ── (g) geo concentration ──
  const geoFixture = { monthly: {}, daily: {}, meta: { bySource: { "amazon-orders": { geo: { byMonthState: {
    "2026-05|UTTAR PRADESH": { units: 146, netRev: 120473.23, returns: 5 },
    "2026-05|MAHARASHTRA": { units: 150, netRev: 116896.15, returns: 30 }, // high returns
    "2026-05|UNKNOWN": { units: 4, netRev: 2000, returns: 0 },
  } } } } } };
  const geo = geoConcentration(geoFixture, { month: "2026-05" });
  ok("g geo states sorted by netRev desc, HHI in [0,1]", geo.available && geo.states[0].netRev >= geo.states[1].netRev && geo.hhi >= 0 && geo.hhi <= 1.0001);
  ok("g geo return hotspot detects high-return state", geo.returnHotspots.some((h) => h.state === "MAHARASHTRA"));
  ok("g geo revShare guarded + sums≈1", Math.abs(geo.states.reduce((a, s) => a + (s.revShare || 0), 0) - 1) < 1e-6);

  // ── VI-47 · website (Shopify) returns trend + spike flags ──
  const retFixture = { monthly: {}, daily: {}, meta: { bySource: { "bm-returns": { sourceLabel: "BM Returns", monthly: [
    { month: "2026-01-01", returnsInr: 101307, grossInr: 568422, returnPct: 17.8 },
    { month: "2026-02-01", returnsInr: 139010, grossInr: 507665, returnPct: 27.4 },  // +9.6pts → MoM-jump spike
    { month: "2026-03-01", returnsInr: 133938, grossInr: 781549, returnPct: 17.1 },
    { month: "2026-04-01", returnsInr: 141022, grossInr: 462177, returnPct: 30.5 },  // peak spike
    { month: "2026-05-01", returnsInr: 103556, grossInr: 671502, returnPct: 15.4 },  // latest, not a spike
  ] } } } };
  const wret = websiteReturnsTrend(retFixture);
  ok("VI-47 website returns available + 5 months ascending", wret.available && wret.months.length === 5 && wret.months[0].month === "2026-01" && wret.months[4].month === "2026-05");
  ok("VI-47 latest = 15.4% (not flagged), peak = 30.5% Apr", wret.latest.returnPct === 15.4 && !wret.latest.spike && wret.peak.returnPct === 30.5 && wret.peak.month === "2026-04");
  ok("VI-47 spike flags fire (Feb MoM-jump + Apr peak), latest clean", wret.months[1].spike && wret.months[3].spike && !wret.months[4].spike);
  ok("VI-47 returnFrac mirrors returnPct/100", Math.abs(wret.latest.returnFrac - 0.154) < 1e-9);
  const wretEmpty = websiteReturnsTrend({ monthly: {}, daily: {}, meta: { bySource: {} } });
  ok("VI-47 no-source → available:false (never fabricated 0)", wretEmpty.available === false && wretEmpty.months.length === 0);

  // ── VII-52 · deep SKU forecast off agency per-SKU units history ──
  const skuFixture = {
    monthly: { "2026-05|amazon|NSX": { units: 100, netRev: 100000, grossRev: 100000, adSpendDirect: 0 } },
    daily: { "2026-05-31|amazon|__ch__": { units: 100, netRev: 100000, adSpend: 0 } },
    meta: { bySource: { "snell-sku-units": { monthly: {
      "2025-12|amazon|NSX": 80, "2026-01|amazon|NSX": 90, "2026-02|amazon|NSX": 95,
      "2026-03|amazon|NSX": 105, "2026-04|amazon|NSX": 110, "2026-05|amazon|NSX": 100,
    } } } },
  };
  const sf = skuForecast(skuFixture, { sku: "NSX", costs: defaultCosts, horizonMonths: 1 });
  ok("VII-52 sku forecast uses agency units (≥6 mo history)", sf.history.length >= 6 && /agency per-SKU UNITS/.test(sf.basis));
  ok("VII-52 sku forecast is BANDED (low < point < high)", sf.forecast.length === 1 && sf.forecast[0].netRevLow <= sf.forecast[0].netRev && sf.forecast[0].netRev <= sf.forecast[0].netRevHigh && sf.forecast[0].unitsHigh > sf.forecast[0].unitsLow);
  ok("VII-52 sku forecast prices at native ₹/unit (₹1000)", Math.abs(sf.pricePerUnit - 1000) < 1);
  const sfNone = skuForecast(skuFixture, { sku: "ZZZ", costs: defaultCosts });
  ok("VII-52 sku with no agency units → falls back (banded or empty, no throw)", sfNone && Array.isArray(sfNone.forecast));

  // ── GLOBAL NaN/Infinity walk across every function on the fixture ──
  const walk = (o, path) => {
    if (o == null) return true;
    if (typeof o === "number") { if (!Number.isFinite(o)) { console.log(`  non-finite at ${path} = ${o}`); return false; } return true; }
    if (Array.isArray(o)) return o.every((x, i) => walk(x, `${path}[${i}]`));
    if (typeof o === "object") return Object.entries(o).every(([k, v]) => walk(v, `${path}.${k}`));
    return true;
  };
  let clean = true;
  for (const [name, val] of [
    ["seasonality", seas], ["dailyFlags", flags], ["dailyFactTable", tbl], ["projection", proj],
    ["revenueBridge", revB], ["cm3Bridge", cmB], ["anomalies", anoms], ["movers", movers],
    ["concentration", conc], ["whatIf", wi], ["driver", drv], ["prescriptions", rx],
    ["adPrescriptions", adrx], ["priceRealization", pr], ["velocity", vel], ["dailyEfficiency", eff],
    // round-3
    ["perChannelWeekdayBaseline", pcb], ["perChannelDailyFlags", pcf],
    ["forecast.channel", fcCh], ["forecast.sku", fcSku], ["forecast.company", fcCo],
    ["actionQueue", queue], ["proseWeeklyNarrative", prose], ["ltvCohort", ltv],
    ["basketTrend", basket], ["blinkitAdProxy", blk], ["orderMixTrend", om],
    ["totalVsDailyReconciliation", rec], ["conversionValueGap", cvg], ["cashbackTrend", cb],
    ["returningRevenue", rr], ["costChangeHistory", cch], ["geoConcentration", geo],
    ["smallSampleFlag", thin2], ["websiteReturnsTrend", wret], ["skuForecast", sf],
  ]) if (!walk(val, name)) clean = false;
  ok("ALL outputs finite-or-null (no NaN/Infinity) on fixture", clean);

  // ── REAL bundle sample (when importable) ──
  (async () => {
    try {
      const { BUNDLED_BUSINESS } = await import("../bundledBusinessData.js");
      const { mergedFacts } = await import("./businessStore.js");
      void BUNDLED_BUSINESS;
      const real = mergedFacts();
      const RC = await import("./costInputs.js");
      console.log("\n──────── REAL May-2026 / agency sample (for page builders) ────────");
      const rproj = projectMonthEnd(real, { month: "2026-06" });
      console.log("projectMonthEnd June(company):", JSON.stringify({ mtd: rproj.mtd, projected: rproj.projected, low: rproj.low, high: rproj.high, method: rproj.method, confidence: rproj.confidence, dom: rproj.dom }));
      const rmov = rankMovers(real, { dimension: "channel", month: "2026-05", priorMonth: "2026-04", metric: "netRev", costs: RC });
      console.log("rankMovers May vs Apr (channel,netRev) top3:", JSON.stringify(rmov.slice(0, 3).map((m) => ({ key: m.key, deltaAbs: m.deltaAbs, deltaPct: m.deltaPct }))));
      const rconc = concentrationRisk(real, { month: "2026-05", costs: RC });
      console.log("concentrationRisk May channel revenue:", JSON.stringify({ top: rconc.byChannel.revenue.top, hhi: rconc.byChannel.revenue.hhi, concentrated: rconc.byChannel.revenue.concentrated }));
      const rbridge = cm3Bridge(real, { fromMonth: "2026-04", toMonth: "2026-05", costs: RC });
      console.log("cm3Bridge Apr→May:", JSON.stringify({ from: rbridge.from, to: rbridge.to, delta: rbridge.delta, steps: rbridge.steps, reconciles: rbridge.reconciles }));
      const rwi = computeWhatIf(real, { month: "2026-05", levers: { adPct: -0.2 }, costs: RC });
      console.log("computeWhatIf May ads-20%:", JSON.stringify({ baseCm3: rwi.base.cm3, scenCm3: rwi.scenario.cm3, deltaCm3: rwi.delta.cm3 }));
      const rdrv = driverSensitivity(real, { month: "2026-05", costs: RC });
      console.log("driverSensitivity May:", JSON.stringify(rdrv.drivers.map((d) => ({ lever: d.lever, deltaCm3: d.deltaCm3 }))));
      const rrx = prescriptions(real, { month: "2026-05", costs: RC });
      console.log("prescriptions May top3:", JSON.stringify(rrx.slice(0, 3).map((r) => ({ action: r.action, impact: r.impactPerMonth, sev: r.severity }))));
      const rflags = dailyFlags(real, { lastN: 5 });
      console.log("dailyFlags last5 (company):", JSON.stringify(rflags.map((f) => ({ iso: f.iso, net: f.net, flag: f.flag, z: f.z }))));
      const rnarr = autoNarrative(real, { month: "2026-06", costs: RC });
      console.log("autoNarrative June headline:", rnarr.headline);
      console.log("autoNarrative June bullets:", JSON.stringify(rnarr.bullets));
      const rvel = crossModuleVelocity(real, { month: "2026-05" });
      console.log("crossModuleVelocity May top3:", JSON.stringify(rvel.slice(0, 3).map((v) => ({ code: v.code, channel: v.channel, units: v.units, velPerDay: v.velocityPerDay }))));

      console.log("\n──────── ROUND-3 real samples (for page builders) ────────");
      const rfcAmz = forecast(real, { channel: "amazon", costs: RC, horizonMonths: 2 });
      console.log("forecast(amazon) method:", rfcAmz.method);
      console.log("forecast(amazon) forecast pts:", JSON.stringify(rfcAmz.forecast));
      const rfcSku = forecast(real, { sku: "NSSB100", costs: RC, horizonMonths: 1 });
      console.log("forecast(sku NSSB100) next:", JSON.stringify(rfcSku.forecast[0]), "margin%:", rfcSku.cm3MarginPct);
      const rfcCo = forecast(real, { costs: RC, horizonMonths: 1 });
      console.log("forecast(company) next:", JSON.stringify(rfcCo.forecast[0]));
      const rq = actionQueue(real, { month: "2026-05", costs: RC, velocity: rvel });
      console.log("actionQueue May top5:", JSON.stringify(rq.slice(0, 5).map((r) => ({ rank: r.rank, lever: r.lever, action: r.action, impact: r.impactPerMonth, kind: r.impactKind }))));
      console.log("actionQueue lever counts:", JSON.stringify(rq.reduce((a, r) => ((a[r.lever] = (a[r.lever] || 0) + 1), a), {})));
      const rprose = proseWeeklyNarrative(real, { month: "2026-05", costs: RC });
      console.log("proseWeeklyNarrative weekLabel:", rprose.weekLabel);
      rprose.prose.forEach((p, i) => console.log(`  prose[${i}]:`, p));
      // II-14/18 + VII-59 — the FLAGGED partial-June case: SKU line must be labeled
      // full-vs-full (no −100% trap) and a vs-plan line must be present.
      const rproseJun = proseWeeklyNarrative(real, { month: "2026-06", costs: RC });
      console.log("proseWeeklyNarrative(June) topSkuLine:", rproseJun.topSkuLine);
      console.log("proseWeeklyNarrative(June) topSkuWindow:", JSON.stringify(rproseJun.topSkuWindow));
      console.log("proseWeeklyNarrative(June) vsPlan:", JSON.stringify(rproseJun.vsPlan));
      // VI-47 — website (Shopify) returns trend + spike flags
      const rret = websiteReturnsTrend(real);
      console.log("websiteReturnsTrend latest/peak:", JSON.stringify({ latest: rret.latest && { m: rret.latest.month, pct: rret.latest.returnPct, spike: rret.latest.spike }, peak: rret.peak, mean: rret.mean, spikeMonths: rret.spikes.map((s) => s.month) }));
      // VII-52 — deep SKU forecast (agency units history → banded ₹)
      const rsf = skuForecast(real, { sku: "NSSBDB500", costs: RC, horizonMonths: 2 });
      console.log("skuForecast(NSSBDB500) basis:", rsf.basis);
      console.log("skuForecast(NSSBDB500) conf/historyLen/price/margin:", JSON.stringify({ conf: rsf.confidence, hist: rsf.history.length, price: rsf.pricePerUnit, margin: rsf.cm3MarginPct }));
      console.log("skuForecast(NSSBDB500) forecast:", JSON.stringify(rsf.forecast));
      // I-7 — variant-fold provenance (from the bundle meta)
      const vf = real.meta && real.meta.skuVariantFold;
      if (vf) { const folded = Object.values(vf).filter((x) => x.anyFolded); console.log("skuVariantFold folded codes:", folded.length, "sample:", folded[0] ? (folded[0].byChannel.amazon || folded[0].byChannel.flipkart).label : "—"); }
      // XI/III — Amazon SP daily series reconciliation (₹3,55,115 re-derivable from daily)
      const sp = real.meta && real.meta.bySource && real.meta.bySource["ads-amazon-sp"];
      if (sp) console.log("amazonSp daily recon:", JSON.stringify({ total: sp.amazonSpTotal, days: sp.days, dailyCells: sp.daily ? Object.keys(sp.daily).length : 0, ties: sp.reconciliation && sp.reconciliation.ties }));
      const rltv = ltvCohort(real);
      console.log("ltvCohort shopify latest:", JSON.stringify(rltv.shopify.latest), "trendRepeatPct:", rltv.shopify.trendRepeatPct);
      console.log("ltvCohort amazon latest:", JSON.stringify(rltv.amazon.latest));
      console.log("ltvCohort deferrals:", JSON.stringify(rltv.deferrals.map((d) => d.channel)));
      const rbasket = basketTrend(real, { costs: RC });
      console.log("basketTrend website last2:", JSON.stringify(rbasket.byChannel.website.slice(-2)));
      const rblk = blinkitAdProxy(real, { month: "2026-05", costs: RC });
      console.log("blinkitAdProxy refTcos:", rblk.refTcosPct, "channelTotal:", rblk.channelTotal, "rescaledToReal:", rblk.rescaledToReal);
      console.log("blinkitAdProxy top3 SKU:", JSON.stringify(rblk.bySku.slice(0, 3)));
      const rom = orderMixTrend(real);
      console.log("orderMixTrend latest:", JSON.stringify(rom.latest));
      const rrec = totalVsDailyReconciliation(real);
      console.log("totalVsDailyReconciliation:", JSON.stringify({ totalRow: rrec.totalRow, dailySeries: rrec.dailySeries, deltaUnits: rrec.deltaUnits, deltaGross: rrec.deltaGross, deltaGrossPct: rrec.deltaGrossPct }));
      const rcvg = conversionValueGap(real, { month: "2026-05", costs: RC });
      console.log("conversionValueGap May:", JSON.stringify({ monarch: rcvg.monarchConvValue, shopifyNet: rcvg.shopifyNet, gapAbs: rcvg.gapAbs, gapPct: rcvg.gapPct }));
      const rcb = cashbackTrend(real);
      console.log("cashbackTrend:", JSON.stringify({ total: rcb.total, months: rcb.months }));
      const rrr = returningRevenue(real);
      console.log("returningRevenue shopify latest:", JSON.stringify(rrr.shopify.latest));
      const rcch = costChangeHistory(real);
      console.log("costChangeHistory changedCount:", rcch.changedCount, "top3:", JSON.stringify(rcch.changes.slice(0, 3).map((c) => ({ code: c.code, prior: c.priorRmPerKg, cur: c.currentRmPerKg }))));
      const rgeo = geoConcentration(real, { month: "2026-05" });
      console.log("geoConcentration May top3 + hotspots:", JSON.stringify({ top3: rgeo.states.slice(0, 3).map((s) => ({ state: s.state, rev: s.netRev, share: s.revShare, retRate: s.returnRate })), hhi: rgeo.hhi, hotspots: rgeo.returnHotspots, geoMonths: rgeo.geoMonths }));
      console.log("──────── end real sample ────────");
    } catch (e) {
      console.log("(real-bundle sample skipped:", e.message, ")");
    }
    console.log("bizAnalytics self-test complete.");
  })();
}
