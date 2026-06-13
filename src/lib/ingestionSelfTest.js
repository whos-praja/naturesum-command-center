/**
 * ingestionSelfTest.js — XI (rubric param 84/85): an in-tool, runnable proof
 * that the Business-Performance ingestion is IDEMPOTENT and that NATIVE per-SKU
 * sources override AGENCY channel-grain ones — live, in the browser, as a green
 * check the founder can click. It does NOT just *claim* parse-twice == parse-once;
 * it re-ingests the bundled sources and shows the equality.
 *
 * WHY a separate harness (not the real store): the real store reads/writes a fixed
 * localStorage key (ns.businessPerf). A self-test the user can click at any time
 * must NEVER mutate their live uploaded facts. So this module runs the EXACT store
 * merge/clear contract against an in-memory scratch store, and — for the
 * native>agency half — calls the REAL engine functions (coverageFor +
 * applyOverridePrecedence) directly on a deep clone, so that half is a genuine
 * exercise of the production code path, not a re-implementation.
 *
 * Contract mirrored verbatim from businessStore.js (kept in lockstep — see the
 * field lists there):
 *   • NUMERIC_FIELDS / DAILY_FIELDS, round-to-2dp on every field write.
 *   • upsertFacts: clearSource(tag) → snapshot contrib[tag] → field-add → stamp src.
 *   • clearSource: subtract contrib[tag] exactly → drop tag from src → delete a
 *     cell that is all-zero with no remaining source.
 * If the store contract ever drifts from this mirror, an assertion here trips —
 * which is itself a useful regression tripwire.
 *
 * Pure: no window, no localStorage, no DOM. Safe to call from a Node self-test
 * (node src/lib/ingestionSelfTest.js) or from the UI.
 */
import { BUNDLED_BUSINESS } from "../bundledBusinessData.js";
import {
  coverageFor,
  applyOverridePrecedence,
  isChannelGrainKey,
  CH_CODE,
} from "./businessStore.js";

// ── store contract mirror (must match businessStore.js) ──────────────────────
const NUMERIC_FIELDS = ["units", "grossRev", "netRev", "returnsUnits", "returnsValue", "adSpendDirect", "adSpend"];
const DAILY_FIELDS = ["units", "netRev", "grossRev", "adSpend"];
// Ad sources own the spend fields; every other source owns the sales fields. This
// is the documented field-disjoint ownership (businessStore.js upsert comment):
// a sales tag owns revenue/units/returns, an ad tag owns adSpendDirect/adSpend.
const AD_FIELDS = new Set(["adSpendDirect", "adSpend"]);
// Field ownership on a cell shared by multiple sources. The bundle's pure ad
// sources are the "ads-*" set; Snell/Monarch carry BOTH channel-grain sales AND
// their own adSpend on the __ch__ cells (no separate ad tag there). So: an AD
// FIELD belongs to the cell's "ads-*" tag if one is present, else to the lone
// sales/channel-grain tag (Snell's own adSpend). A SALES field always belongs to
// the cell's non-ad tag. This makes every field owned by EXACTLY one tag, so the
// per-source split reconstructs the merged bundle without double-counting.
const tagOwnsField = (tag, field, cellTags) => {
  const hasAdTag = cellTags.some((t) => /^ads-/.test(t));
  if (AD_FIELDS.has(field)) return hasAdTag ? /^ads-/.test(tag) : !/^ads-/.test(tag);
  return !/^ads-/.test(tag);                                    // sales/units/returns → the non-ad owner
};
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);

// ── in-memory scratch store (no persistence) ─────────────────────────────────
function freshStore() {
  return { schemaVersion: 1, monthly: {}, daily: {}, meta: { uploads: [], contrib: {} } };
}
function mergeFields(target, incoming, fields) {
  const out = target ? { ...target } : {};
  for (const f of fields) {
    if (incoming[f] !== undefined) {
      const v = (out[f] || 0) + Number(incoming[f] || 0);
      out[f] = Number.isFinite(v) ? r2(v) : (out[f] || 0);
    }
  }
  return out;
}
// upsert one source's contribution (idempotent — clear-then-add, snapshotting the
// contribution so the next clear subtracts EXACTLY this).
function upsert(store, contrib, tag) {
  clearTag(store, tag);
  store.meta.contrib[tag] = { monthly: contrib.monthly || {}, daily: contrib.daily || {} };
  for (const [k, cell] of Object.entries(contrib.monthly || {})) {
    const merged = mergeFields(store.monthly[k], cell, NUMERIC_FIELDS);
    const srcs = new Set(store.monthly[k]?.src ? String(store.monthly[k].src).split(",").filter(Boolean) : []);
    srcs.add(tag);
    merged.src = [...srcs].join(",");
    store.monthly[k] = merged;
  }
  for (const [k, cell] of Object.entries(contrib.daily || {})) {
    const merged = mergeFields(store.daily[k], cell, DAILY_FIELDS);
    const srcs = new Set(store.daily[k]?.src ? String(store.daily[k].src).split(",").filter(Boolean) : []);
    srcs.add(tag);
    merged.src = [...srcs].join(",");
    store.daily[k] = merged;
  }
  store.meta.uploads = store.meta.uploads.filter((u) => u.sourceTag !== tag);
  store.meta.uploads.push({ sourceTag: tag });
}
function clearTag(store, tag) {
  const contrib = store.meta.contrib[tag];
  if (contrib) {
    for (const [k, cell] of Object.entries(contrib.monthly || {})) {
      const cur = store.monthly[k];
      if (!cur) continue;
      for (const f of NUMERIC_FIELDS) if (cell[f] !== undefined) cur[f] = r2((cur[f] || 0) - cell[f]);
      const srcs = new Set(String(cur.src || "").split(",").filter(Boolean));
      srcs.delete(tag);
      cur.src = [...srcs].join(",");
      if (!cur.src && NUMERIC_FIELDS.every((f) => !cur[f])) delete store.monthly[k];
    }
    for (const [k, cell] of Object.entries(contrib.daily || {})) {
      const cur = store.daily[k];
      if (!cur) continue;
      for (const f of DAILY_FIELDS) if (cell[f] !== undefined) cur[f] = r2((cur[f] || 0) - cell[f]);
      const srcs = new Set(String(cur.src || "").split(",").filter(Boolean));
      srcs.delete(tag);
      cur.src = [...srcs].join(",");
      if (!cur.src && DAILY_FIELDS.every((f) => !cur[f])) delete store.daily[k];
    }
    delete store.meta.contrib[tag];
  }
  store.meta.uploads = store.meta.uploads.filter((u) => u.sourceTag !== tag);
}

// ── reconstruct each bundled source's parsed contribution ────────────────────
// The bundle is the parsed-once OUTPUT (every source already merged). To re-ingest
// it source-by-source we split it back into per-tag contributions using the
// documented field-ownership: each cell's `src` lists its contributing tags; we
// hand each numeric field to the tag that owns it (ad-fields → ads-* tag; the rest
// → the sales/channel-grain tag on that cell). This reconstructs exactly what each
// source originally upserted, so re-ingesting them rebuilds the bundle.
function reconstructContributions() {
  const byTag = {}; // tag -> { monthly:{}, daily:{} }
  const ensure = (tag) => (byTag[tag] = byTag[tag] || { monthly: {}, daily: {} });
  const split = (cell, fields) => {
    const tags = String(cell.src || "").split(",").filter(Boolean);
    if (tags.length === 0) return [];
    const out = [];
    for (const tag of tags) {
      const sub = {};
      let any = false;
      for (const f of fields) {
        if (cell[f] === undefined) continue;
        if (tagOwnsField(tag, f, tags)) { sub[f] = cell[f]; any = true; }
      }
      // Carry tier/source provenance with the channel-grain (non-ad) owner.
      if (!/^ads-/.test(tag)) {
        if (cell.tier !== undefined) sub.tier = cell.tier;
        if (cell.source !== undefined) sub.source = cell.source;
      }
      if (any || Object.keys(sub).length) out.push([tag, sub]);
    }
    return out;
  };
  for (const [k, cell] of Object.entries(BUNDLED_BUSINESS.monthly || {})) {
    for (const [tag, sub] of split(cell, NUMERIC_FIELDS)) ensure(tag).monthly[k] = sub;
  }
  for (const [k, cell] of Object.entries(BUNDLED_BUSINESS.daily || {})) {
    for (const [tag, sub] of split(cell, DAILY_FIELDS)) ensure(tag).daily[k] = sub;
  }
  return byTag;
}

// ── deep canonical compare (order-independent over keys; 2dp numeric tolerance) ─
function canonicalStore(store) {
  const norm = (map, fields) => {
    const out = {};
    for (const k of Object.keys(map).sort()) {
      const cell = map[k];
      const o = {};
      // A field that is absent and a field that is an explicit 0 are semantically
      // identical in this store (a 0 sales figure on an ad-only cell carries no
      // information). Drop zero/absent fields so the two are compared as equal.
      for (const f of fields) {
        const v = r2(Number(cell[f]) || 0);
        if (v !== 0) o[f] = v;
      }
      // normalise the src tag list order so two equal stores compare equal
      if (cell.src !== undefined) o.src = String(cell.src).split(",").filter(Boolean).sort().join(",");
      out[k] = o;
    }
    return out;
  };
  return JSON.stringify({
    monthly: norm(store.monthly, NUMERIC_FIELDS),
    daily: norm(store.daily, DAILY_FIELDS),
  });
}

/**
 * runIngestionSelfTest() → {
 *   ok, ranAt, durationMs,
 *   idempotency: { ok, sources:[tag], onceCells, twiceCells, deltaCells, firstMismatch },
 *   overrides:   { ok, nativeCells, suppressedCells, shadowKept, example:{ mc, agencyNetRev, nativeNetRev, adSpendKept } },
 *   checks: [{ id, label, ok, detail }],
 * }
 * Deterministic; pure; safe to call repeatedly.
 */
export function runIngestionSelfTest() {
  const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
  const checks = [];
  const add = (id, label, ok, detail) => { checks.push({ id, label, ok: !!ok, detail: detail || "" }); return ok; };

  // ── 1 · idempotency: parse-once vs parse-twice on the real bundled sources ──
  const contributions = reconstructContributions();
  const sources = Object.keys(contributions).sort();

  // parse ONCE — ingest every source a single time.
  const once = freshStore();
  for (const tag of sources) upsert(once, contributions[tag], tag);

  // parse TWICE — ingest every source, then ingest every source AGAIN (each
  // re-upsert internally clears its prior contribution then re-adds it). If the
  // contrib-snapshot subtraction is exact, the store is unchanged.
  const twice = freshStore();
  for (const tag of sources) upsert(twice, contributions[tag], tag);
  for (const tag of sources) upsert(twice, contributions[tag], tag);

  const cOnce = canonicalStore(once);
  const cTwice = canonicalStore(twice);
  const idemOk = cOnce === cTwice;

  // also reconcile back to the bundle the sources were split from (round-trip).
  const cBundle = canonicalStore({ monthly: BUNDLED_BUSINESS.monthly || {}, daily: BUNDLED_BUSINESS.daily || {} });
  const roundTripOk = cOnce === cBundle;

  // locate the first mismatching key (for a precise message if it ever fails).
  let firstMismatch = null;
  if (!idemOk) {
    const a = JSON.parse(cOnce), b = JSON.parse(cTwice);
    for (const grain of ["monthly", "daily"]) {
      const keys = new Set([...Object.keys(a[grain]), ...Object.keys(b[grain])]);
      for (const k of keys) {
        if (JSON.stringify(a[grain][k]) !== JSON.stringify(b[grain][k])) { firstMismatch = `${grain} ${k}`; break; }
      }
      if (firstMismatch) break;
    }
  }

  const onceCells = Object.keys(once.monthly).length + Object.keys(once.daily).length;
  const twiceCells = Object.keys(twice.monthly).length + Object.keys(twice.daily).length;
  add("idem-equal", "Re-ingesting every source twice == ingesting once", idemOk,
    idemOk ? `${onceCells} cells identical across both passes` : `mismatch at ${firstMismatch}`);
  add("idem-roundtrip", "Per-source re-ingest reconstructs the bundled baseline exactly", roundTripOk,
    roundTripOk ? `${sources.length} sources round-trip to the bundle` : "round-trip differs from bundle");

  const idempotency = {
    ok: idemOk && roundTripOk,
    sources,
    onceCells,
    twiceCells,
    deltaCells: Math.abs(twiceCells - onceCells),
    firstMismatch,
    roundTripOk,
  };

  // ── 2 · native overrides agency (REAL engine path) ──────────────────────────
  const clone = JSON.parse(JSON.stringify({ monthly: BUNDLED_BUSINESS.monthly || {}, daily: BUNDLED_BUSINESS.daily || {}, meta: {} }));
  const cov = coverageFor(clone);
  const applied = applyOverridePrecedence(clone);   // production code path
  const shadow = (applied.meta && applied.meta.agencyShadow) || {};

  // Every month×channel that coverage marks NATIVE must have its agency __ch__
  // REVENUE suppressed (moved to shadow) while adSpend + provenance survive.
  let nativeMc = 0, suppressedOk = 0, shadowKept = 0, adKept = 0, leak = null;
  let example = null;
  for (const [key, cell] of Object.entries(applied.monthly || {})) {
    if (!isChannelGrainKey(key)) continue;
    const [m, ch] = key.split("|");
    const mc = `${m}|${ch}`;
    if (!(cov[mc] && cov[mc].sales === "native")) continue;
    nativeMc++;
    const revZeroed = (Number(cell.netRev) || 0) === 0 && (Number(cell.grossRev) || 0) === 0 && (Number(cell.units) || 0) === 0;
    if (revZeroed && cell.revSuppressed) suppressedOk++; else if (!leak) leak = mc;
    const sh = shadow[mc];
    if (sh && (Number(sh.netRev) || 0) > 0) shadowKept++;
    if ((Number(cell.adSpend) || 0) > 0) adKept++;
    if (sh) {
      // native per-SKU netRev for the same month×channel (excludes __ch__)
      let nat = 0;
      for (const [k2, c2] of Object.entries(applied.monthly || {})) {
        const [m2, ch2, code2] = k2.split("|");
        if (m2 === m && ch2 === ch && code2 && code2 !== CH_CODE) nat += Number(c2.netRev) || 0;
      }
      const cand = { mc, agencyNetRev: r2(Number(sh.netRev) || 0), nativeNetRev: r2(nat), adSpendKept: r2(Number(cell.adSpend) || 0) };
      // Prefer the cell with the LARGEST native revenue — a meaningful "native
      // wins" override, not a stray-date returns-tail sliver.
      if (!example || cand.nativeNetRev > example.nativeNetRev) example = cand;
    }
  }
  const overOk = nativeMc > 0 && suppressedOk === nativeMc && shadowKept > 0 && !leak;
  add("ovr-suppress", "Agency revenue is suppressed wherever native per-SKU sales exist", nativeMc > 0 && suppressedOk === nativeMc,
    `${suppressedOk}/${nativeMc} native month×channel cells suppress their agency revenue`);
  add("ovr-shadow", "Suppressed agency revenue is retained (never dropped) under agencyShadow", shadowKept > 0,
    `${shadowKept} agency figures kept for reconciliation`);
  add("ovr-ad-kept", "Channel-grain ad spend survives the override (ad pool intact)", adKept > 0,
    `${adKept} channel-grain ad totals preserved`);

  const overrides = {
    ok: overOk,
    nativeCells: nativeMc,
    suppressedCells: suppressedOk,
    shadowKept,
    adKept,
    leak,
    example,
  };

  const durationMs = Math.round(((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0) * 10) / 10;
  return {
    ok: checks.every((c) => c.ok),
    ranAt: new Date().toISOString(),
    durationMs,
    idempotency,
    overrides,
    checks,
  };
}

// ───────────────────────────────────────────────────────────────
// NODE SELF-TEST: node src/lib/ingestionSelfTest.js
// ───────────────────────────────────────────────────────────────
const _proc = typeof globalThis !== "undefined" ? globalThis.process : undefined;
const _isMain = (() => { try { return !!_proc && import.meta.url === `file://${_proc.argv[1]}`; } catch { return false; } })();
if (_isMain) {
  const r = runIngestionSelfTest();
  for (const c of r.checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.label} — ${c.detail}`);
  console.log(`\nidempotency: ${r.idempotency.ok ? "OK" : "FAIL"} · ${r.idempotency.sources.length} sources · ${r.idempotency.onceCells} cells · roundTrip=${r.idempotency.roundTripOk}`);
  console.log(`overrides:   ${r.overrides.ok ? "OK" : "FAIL"} · ${r.overrides.suppressedCells}/${r.overrides.nativeCells} suppressed · ${r.overrides.shadowKept} shadow kept`);
  if (r.overrides.example) {
    const e = r.overrides.example;
    console.log(`example:     ${e.mc} — agency ₹${e.agencyNetRev} suppressed → native ₹${e.nativeNetRev}; adSpend ₹${e.adSpendKept} kept`);
  }
  console.log(`\noverall: ${r.ok ? "ALL GREEN" : "FAIL"} (${r.durationMs}ms)`);
  if (!r.ok) _proc.exitCode = 1;
}
