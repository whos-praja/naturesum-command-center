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
const NUMERIC_FIELDS = ["units", "grossRev", "netRev", "returnsUnits", "returnsValue", "adSpendDirect"];
function mergeCell(target, incoming) {
  const out = target ? { ...target } : {};
  for (const f of NUMERIC_FIELDS) {
    if (incoming[f] !== undefined) {
      const v = (out[f] || 0) + Number(incoming[f] || 0);
      out[f] = Number.isFinite(v) ? Math.round(v * 100) / 100 : (out[f] || 0);
    }
  }
  return out;
}
const DAILY_FIELDS = ["units", "netRev"];
function mergeDailyCell(target, incoming) {
  const out = target ? { ...target } : {};
  for (const f of DAILY_FIELDS) {
    if (incoming[f] !== undefined) {
      const v = (out[f] || 0) + Number(incoming[f] || 0);
      out[f] = Number.isFinite(v) ? Math.round(v * 100) / 100 : (out[f] || 0);
    }
  }
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

// ─── Merged view (bundled baseline ⊕ uploaded overrides) ─────────────────────
/**
 * mergedFacts() — the read model every consumer (engine, verification, pages)
 * uses. Bundled baseline first; uploaded store overlaid so that for any key+source
 * present in both, the UPLOADED store wins. Returns a fresh { monthly, daily, meta }.
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
  return out;
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
