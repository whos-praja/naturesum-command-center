/**
 * businessStore.js — BUILDER B1, DATA LAYER.
 *
 * Durable AGGREGATED fact store for the Business Performance module
 * (docs/BUSINESS-MODULE-SPEC.md §8). NO raw rows are kept — only month×channel×SKU
 * and date×channel×SKU aggregates — to stay inside the localStorage budget.
 *
 * PINNED store shape (BINDING — every builder conforms exactly):
 *   {
 *     schemaVersion: 1,
 *     monthly: { "YYYY-MM|channel|CODE": {
 *        units, grossRev, netRev, returnsUnits, returnsValue, adSpendDirect, src } },
 *     daily:   { "YYYY-MM-DD|channel|CODE": { units, netRev, src } },
 *     meta:    { uploads:[{ sourceTag, at, dq }], ...parser-meta-merged }
 *   }
 *   channel ∈ amazon | flipkart | blinkit | website  (EXTENSIBLE — consumers
 *   must derive the channel set from the keys, never hardcode it).
 *
 * Provenance: every fact carries `src` = the sourceTag that wrote it. Re-upload
 * of overlapping data REPLACES same-key facts FROM THE SAME SOURCE (idempotent:
 * parse-twice == parse-once). Facts from a DIFFERENT source are additive (e.g.
 * sales facts + ad-spend facts on the same key merge field-wise; see upsertFacts).
 *
 * mergedFacts() = bundled baseline (src/bundledBusinessData.js) overlaid with the
 * localStorage store; for any key+source present in both, the uploaded store wins.
 */
import { BUNDLED_BUSINESS } from "../bundledBusinessData.js";

const KEY = "ns.businessPerf";
export const SCHEMA_VERSION = 1;

// ─── V2: channel-grain sentinel ──────────────────────────────────────────────
// Channel-grain facts (Snell/Monarch tiers 2/3) live under keys
// "YYYY-MM|channel|__ch__" (monthly) and "YYYY-MM-DD|channel|__ch__" (daily),
// carrying { units, grossRev, netRev, adSpend, tier, source }. The "__ch__" code
// is RESERVED — every SKU-grain consumer (cmEngine, businessVerification, SKU
// breakdowns) MUST skip it so channel-grain rows never double-count as a fake
// SKU. Use isChannelGrainKey()/skuMonthlyKeys() to filter. SKU-grain facts gain
// an optional `tier` (native | agency | monarch) but their keys are unchanged.
export const CH_CODE = "__ch__";
export const isChannelGrainKey = (key) => String(key).split("|")[2] === CH_CODE;
// SKU-grain monthly keys only (channel-grain sentinel excluded) — the read model
// every per-SKU consumer should iterate.
export function skuMonthlyKeys(facts) {
  return Object.keys((facts && facts.monthly) || {}).filter((k) => !isChannelGrainKey(k));
}

function emptyStore() {
  return { schemaVersion: SCHEMA_VERSION, monthly: {}, daily: {}, meta: { uploads: [] } };
}

// ─── Persistence ─────────────────────────────────────────────────────────────
export function loadBusinessFacts() {
  if (typeof window === "undefined") return emptyStore();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw);
    // SAFE FALLBACK: a corrupt / old-schema blob → fresh empty store (never throw
    // into a consumer). schemaVersion bump would migrate here in future.
    if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION || !parsed.monthly) return emptyStore();
    if (!parsed.daily) parsed.daily = {};
    if (!parsed.meta) parsed.meta = { uploads: [] };
    if (!parsed.meta.uploads) parsed.meta.uploads = [];
    return parsed;
  } catch {
    return emptyStore();
  }
}

function saveBusinessFacts(store) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(KEY, JSON.stringify(store)); }
  catch (e) { /* QuotaExceeded etc — fail soft; the module still runs off bundled. */ void e; }
}

// Field-wise merge of one fact cell. SALES sources write units/grossRev/netRev/
// returns; AD sources write adSpendDirect — they target the SAME key from
// DIFFERENT sources, so a same-source rewrite REPLACES that source's fields while
// other sources' fields survive. We implement this by tracking per-field source
// is overkill for the localStorage budget; instead the contract is: a sourceTag
// owns a disjoint set of fields per key (sales-tag owns revenue fields, ad-tag
// owns adSpendDirect). On re-upload we first clear the source (clearSource),
// then re-apply — so additive merge below is always onto a clean slate for that
// source and can never double-count.
// `adSpend` (channel-grain ad total, V2) added alongside the v1 fields. Carries
// the channel-grain agency/monarch ad spend; per-SKU cells keep adSpendDirect.
const NUMERIC_FIELDS = ["units", "grossRev", "netRev", "returnsUnits", "returnsValue", "adSpendDirect", "adSpend"];
// Non-numeric provenance fields carried through verbatim (last writer wins).
const TAG_FIELDS = ["tier", "source"];
function copyTags(out, incoming) {
  for (const t of TAG_FIELDS) if (incoming[t] !== undefined) out[t] = incoming[t];
}
function mergeCell(target, incoming) {
  const out = target ? { ...target } : {};
  for (const f of NUMERIC_FIELDS) {
    if (incoming[f] !== undefined) {
      const v = (out[f] || 0) + Number(incoming[f] || 0);
      out[f] = Number.isFinite(v) ? Math.round(v * 100) / 100 : (out[f] || 0);
    }
  }
  copyTags(out, incoming);
  return out;
}
// `grossRev` + `adSpend` added for channel-grain daily cells (Snell/Monarch).
const DAILY_FIELDS = ["units", "netRev", "grossRev", "adSpend"];
function mergeDailyCell(target, incoming) {
  const out = target ? { ...target } : {};
  for (const f of DAILY_FIELDS) {
    if (incoming[f] !== undefined) {
      const v = (out[f] || 0) + Number(incoming[f] || 0);
      out[f] = Number.isFinite(v) ? Math.round(v * 100) / 100 : (out[f] || 0);
    }
  }
  copyTags(out, incoming);
  return out;
}

/**
 * upsertFacts(facts, sourceTag) — idempotent merge of a parsed payload.
 *
 * `facts` = { monthly, daily, meta } (the parser output's `.facts`). `sourceTag`
 * identifies the upload (e.g. "amazon-orders:2026-05"). Steps:
 *   1. clearSource(sourceTag) — subtract this source's PRIOR contribution so a
 *      re-upload REPLACES rather than double-counts (parse-twice == parse-once).
 *   2. Snapshot THIS upload's contribution in meta.contrib[sourceTag] so the next
 *      clearSource can subtract exactly what we add now — exact idempotency with
 *      no raw rows retained.
 *   3. Field-wise add each incoming cell onto whatever OTHER sources already wrote
 *      to that key, stamping `src` with this sourceTag.
 *   4. Namespace parser meta under meta.bySource[sourceTag] and record the upload.
 * Returns the new store.
 */
export function upsertFacts(facts, sourceTag, extra = {}) {
  if (!facts) return loadBusinessFacts();
  const store = clearSource(sourceTag);               // step 1 — idempotency

  // step 2 — snapshot exactly what this source contributes (for a future clear).
  store.meta.contrib = store.meta.contrib || {};
  store.meta.contrib[sourceTag] = { monthly: facts.monthly || {}, daily: facts.daily || {} };

  // step 3 — monthly
  for (const [k, cell] of Object.entries(facts.monthly || {})) {
    const merged = mergeCell(store.monthly[k], cell);
    const srcs = new Set(store.monthly[k]?.src ? String(store.monthly[k].src).split(",").filter(Boolean) : []);
    srcs.add(sourceTag);
    merged.src = [...srcs].join(",");
    store.monthly[k] = merged;
  }
  // daily
  for (const [k, cell] of Object.entries(facts.daily || {})) {
    const merged = mergeDailyCell(store.daily[k], cell);
    const srcs = new Set(store.daily[k]?.src ? String(store.daily[k].src).split(",").filter(Boolean) : []);
    srcs.add(sourceTag);
    merged.src = [...srcs].join(",");
    store.daily[k] = merged;
  }
  // step 4 — meta (parser-emitted analytics), namespaced by source.
  if (facts.meta && Object.keys(facts.meta).length) {
    store.meta.bySource = store.meta.bySource || {};
    store.meta.bySource[sourceTag] = facts.meta;
  }
  store.meta.uploads = (store.meta.uploads || []).filter((u) => u.sourceTag !== sourceTag);
  store.meta.uploads.push({ sourceTag, at: new Date().toISOString(), ...extra });

  saveBusinessFacts(store);
  return store;
}

/**
 * clearSource(sourceTag) — remove this source's contribution EXACTLY.
 *
 * Subtracts the contribution snapshot stored at upsert-time (meta.contrib) from
 * every key the source touched, drops the source tag from each cell's `src`, and
 * removes any cell that is now all-zero with no remaining source. This is the
 * inverse of upsertFacts, so upsert→clear is a no-op and parse-twice == parse-once.
 */
export function clearSource(sourceTag) {
  const store = loadBusinessFacts();
  const contrib = store.meta.contrib?.[sourceTag];
  if (contrib) {
    for (const [k, cell] of Object.entries(contrib.monthly || {})) {
      const cur = store.monthly[k];
      if (!cur) continue;
      for (const f of NUMERIC_FIELDS) if (cell[f] !== undefined) cur[f] = Math.round(((cur[f] || 0) - cell[f]) * 100) / 100;
      const srcs = new Set(String(cur.src || "").split(",").filter(Boolean));
      srcs.delete(sourceTag);
      cur.src = [...srcs].join(",");
      if (!cur.src && NUMERIC_FIELDS.every((f) => !cur[f])) delete store.monthly[k];
    }
    for (const [k, cell] of Object.entries(contrib.daily || {})) {
      const cur = store.daily[k];
      if (!cur) continue;
      for (const f of DAILY_FIELDS) if (cell[f] !== undefined) cur[f] = Math.round(((cur[f] || 0) - cell[f]) * 100) / 100;
      const srcs = new Set(String(cur.src || "").split(",").filter(Boolean));
      srcs.delete(sourceTag);
      cur.src = [...srcs].join(",");
      if (!cur.src && DAILY_FIELDS.every((f) => !cur[f])) delete store.daily[k];
    }
    if (store.meta.contrib) delete store.meta.contrib[sourceTag];
  }
  if (store.meta.bySource) delete store.meta.bySource[sourceTag];
  store.meta.uploads = (store.meta.uploads || []).filter((u) => u.sourceTag !== sourceTag);
  saveBusinessFacts(store);
  return store;
}

// ─── V2 coverage model (spec V2.2) ───────────────────────────────────────────
const SALES_NET_FIELDS = ["netRev", "grossRev"];
const cellHasSales = (cell) => SALES_NET_FIELDS.some((f) => Math.abs(Number(cell?.[f]) || 0) > 0) || Math.abs(Number(cell?.units) || 0) > 0;
const monthEnd = (ym) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

/**
 * coverageFor(facts) → { "YYYY-MM|channel": { sales, skuGrain, ads, partial,
 *   lastDay } } — the honesty layer that kills cross-window ratios (spec V2.2).
 *   sales    : "native" | "agency" | "none"
 *              native  = ≥1 per-SKU (non-__ch__) cell with sales coverage
 *              agency  = no native, but channel-grain (__ch__) carries rev/units
 *   skuGrain : bool — any per-SKU cell exists for this month×channel
 *   ads      : "actual" | "agency" | "none"
 *              actual  = per-SKU adSpendDirect present (native attribution)
 *              agency  = channel-grain adSpend present (Snell/Monarch total)
 *   partial  : last data day < month end (MTD month, e.g. June to-date)
 *   lastDay  : latest daily date seen for this month×channel (or null)
 */
export function coverageFor(facts) {
  const monthly = (facts && facts.monthly) || {};
  const daily = (facts && facts.daily) || {};
  const cov = {};
  const ensure = (mc) => (cov[mc] = cov[mc] || { sales: "none", skuGrain: false, ads: "none", partial: false, lastDay: null });
  // Monthly pass — sales + ads coverage.
  for (const [key, cell] of Object.entries(monthly)) {
    const [m, ch, code] = key.split("|");
    if (!m || !ch || !code) continue;
    const mc = `${m}|${ch}`;
    const c = ensure(mc);
    if (code === CH_CODE) {
      if (c.sales === "none" && cellHasSales(cell)) c.sales = "agency";
      if (c.ads === "none" && Math.abs(Number(cell.adSpend) || 0) > 0) c.ads = "agency";
    } else {
      c.skuGrain = true;
      if (cellHasSales(cell)) c.sales = "native";                       // native always wins
      if (Math.abs(Number(cell.adSpendDirect) || 0) > 0) c.ads = "actual"; // actual always wins
    }
  }
  // Daily pass — latest data day per month×channel (for partial detection).
  for (const key of Object.keys(daily)) {
    const [d, ch] = key.split("|");
    if (!d || !ch) continue;
    const m = d.slice(0, 7);
    const mc = `${m}|${ch}`;
    const c = ensure(mc);
    if (!c.lastDay || d > c.lastDay) c.lastDay = d;
  }
  for (const [mc, c] of Object.entries(cov)) {
    const m = mc.split("|")[0];
    c.partial = !!(c.lastDay && c.lastDay < monthEnd(m));
  }
  return cov;
}

// ─── Merged view (bundled baseline ⊕ uploaded overrides) ─────────────────────
/**
 * mergedFacts() — the read model every consumer (engine, verification, pages)
 * uses. Bundled baseline first; uploaded store overlaid so that for any key+source
 * present in both, the UPLOADED store wins. Returns a fresh { monthly, daily, meta }.
 *
 * V2 override precedence (spec V2.1): NATIVE > AGENCY/MONARCH per (month×channel×
 * metric). Where a month×channel has NATIVE per-SKU SALES coverage, the agency
 * channel-grain ("__ch__") REVENUE fields (units/grossRev/netRev) are suppressed
 * from the active cell — native SKU revenue is authoritative — and the suppressed
 * agency revenue is RETAINED under meta.agencyShadow["YYYY-MM|channel"] for the UI
 * reconciliation note. The channel-grain `adSpend` + tier/source ALWAYS survive
 * (the ad pool + provenance + coverage badge still need them). Agency revenue is
 * never double-counted with native, and never silently dropped.
 */
export function mergedFacts() {
  const base = BUNDLED_BUSINESS || emptyStore();
  const store = loadBusinessFacts();
  const out = {
    schemaVersion: SCHEMA_VERSION,
    monthly: { ...(base.monthly || {}) },
    daily: { ...(base.daily || {}) },
    meta: { ...(base.meta || {}) },
  };
  // Overlay: uploaded keys replace bundled keys entirely (uploaded wins).
  for (const [k, v] of Object.entries(store.monthly || {})) out.monthly[k] = v;
  for (const [k, v] of Object.entries(store.daily || {})) out.daily[k] = v;
  // Meta: merge bySource maps (bundled baseline meta is the build-time analytics;
  // uploaded bySource overrides per source).
  out.meta = { ...(base.meta || {}), ...(store.meta || {}) };
  out.meta.bySource = { ...((base.meta || {}).bySource || {}), ...((store.meta || {}).bySource || {}) };

  return applyOverridePrecedence(out);
}

/**
 * applyOverridePrecedence(facts) — V2.1 native > agency/monarch, in place.
 *
 * For every channel-grain ("__ch__") cell whose month×channel has NATIVE per-SKU
 * SALES coverage, the agency REVENUE fields (units/grossRev/netRev) are moved to
 * meta.agencyShadow["YYYY-MM|channel"] (for the UI reconciliation note) and zeroed
 * in the active cell (revSuppressed:true), while adSpend + tier/source SURVIVE
 * (ad pool + provenance + coverage still need them). Pure on `facts`; no window.
 * Returns the same object (mutated) with meta.coverage + meta.agencyShadow set.
 */
export function applyOverridePrecedence(facts) {
  const cov = coverageFor(facts);
  const agencyShadow = {};
  for (const [key, cell] of Object.entries(facts.monthly || {})) {
    if (!isChannelGrainKey(key)) continue;
    const [m, ch] = key.split("|");
    const mc = `${m}|${ch}`;
    if (cov[mc] && cov[mc].sales === "native") {
      const shadow = { units: cell.units || 0, grossRev: cell.grossRev || 0, netRev: cell.netRev || 0, tier: cell.tier, source: cell.source };
      if (cellHasSales(shadow)) agencyShadow[mc] = shadow;
      facts.monthly[key] = { ...cell, units: 0, grossRev: 0, netRev: 0, revSuppressed: true };
    }
  }
  facts.meta = facts.meta || {};
  facts.meta.agencyShadow = agencyShadow;
  facts.meta.coverage = cov;
  return facts;
}

// Convenience: list the channels actually present in a facts object (NEVER
// hardcode the channel list in a consumer — derive it here).
export function channelsIn(facts) {
  const set = new Set();
  for (const k of Object.keys(facts.monthly || {})) { const ch = k.split("|")[1]; if (ch) set.add(ch); }
  return [...set].sort();
}
// Convenience: months present.
export function monthsIn(facts) {
  const set = new Set();
  for (const k of Object.keys(facts.monthly || {})) { const m = k.split("|")[0]; if (m) set.add(m); }
  return [...set].sort();
}

export function clearAllBusinessFacts() {
  if (typeof window !== "undefined") window.localStorage.removeItem(KEY);
}

// ───────────────────────────────────────────────────────────────
// NODE SELF-TEST: node src/lib/businessStore.js  (V2 store logic, no window)
// ───────────────────────────────────────────────────────────────
const _proc = typeof globalThis !== "undefined" ? globalThis.process : undefined;
const _isMain = (() => { try { return !!_proc && import.meta.url === `file://${_proc.argv[1]}`; } catch { return false; } })();
if (_isMain) {
  const check = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); if (!cond) _proc.exitCode = 1; };

  // Facts: May has NATIVE amazon SKU sales + an AGENCY channel-grain amazon cell
  // (revenue should be suppressed, ad kept). April has ONLY agency (kept). June
  // is a partial MTD month (last daily day < month end).
  const facts = {
    monthly: {
      "2026-05|amazon|NSSB100": { netRev: 1000, grossRev: 1050, units: 10 },               // native
      "2026-05|amazon|__ch__": { netRev: 1100, grossRev: 1150, units: 11, adSpend: 300, tier: "agency", source: "snell-history" },
      "2026-04|amazon|__ch__": { netRev: 800, grossRev: 840, units: 8, adSpend: 200, tier: "agency", source: "snell-history" },
      "2026-06|amazon|__ch__": { netRev: 200, grossRev: 210, units: 2, adSpend: 50, tier: "agency", source: "snell-history" },
    },
    daily: { "2026-06-05|amazon|__ch__": { netRev: 200, grossRev: 210, units: 2, adSpend: 50, tier: "agency", source: "snell-history" } },
    meta: {},
  };

  const cov = coverageFor(facts);
  check("May amazon coverage = native", cov["2026-05|amazon"].sales === "native");
  check("April amazon coverage = agency", cov["2026-04|amazon"].sales === "agency");
  check("May amazon ads = agency (channel-grain adSpend)", cov["2026-05|amazon"].ads === "agency");
  check("May skuGrain true (native SKU present)", cov["2026-05|amazon"].skuGrain === true);
  check("June amazon partial (MTD)", cov["2026-06|amazon"].partial === true);
  check("April NOT partial (no daily → no partial)", cov["2026-04|amazon"].partial === false);

  applyOverridePrecedence(facts);
  // May agency revenue suppressed, ad kept, shadow retained.
  check("May agency netRev suppressed → 0", facts.monthly["2026-05|amazon|__ch__"].netRev === 0);
  check("May agency adSpend kept = 300", facts.monthly["2026-05|amazon|__ch__"].adSpend === 300);
  check("May agency revSuppressed flag", facts.monthly["2026-05|amazon|__ch__"].revSuppressed === true);
  check("agencyShadow holds suppressed May rev", facts.meta.agencyShadow["2026-05|amazon"]?.netRev === 1100);
  // April agency revenue UNTOUCHED (no native there).
  check("April agency netRev kept = 800", facts.monthly["2026-04|amazon|__ch__"].netRev === 800);

  // SKU-grain key filter excludes the sentinel.
  const skuKeys = skuMonthlyKeys(facts);
  check("skuMonthlyKeys excludes __ch__", skuKeys.length === 1 && skuKeys[0] === "2026-05|amazon|NSSB100");
  check("isChannelGrainKey identifies sentinel", isChannelGrainKey("2026-05|amazon|__ch__") && !isChannelGrainKey("2026-05|amazon|NSSB100"));

  // channelsIn/monthsIn still derive from positions 0/1 (sentinel-safe).
  check("monthsIn sees 04/05/06", JSON.stringify(monthsIn(facts)) === JSON.stringify(["2026-04", "2026-05", "2026-06"]));
  check("channelsIn = [amazon]", JSON.stringify(channelsIn(facts)) === JSON.stringify(["amazon"]));

  console.log("businessStore V2 self-test complete.");
}
