/**
 * Live inventory store + merger.
 *
 * - LocalStorage key: ns.liveInventory
 *   Holds the most recently uploaded payload from parseInventoryFile().
 *   Survives reloads so the dashboard always shows the last-known state
 *   (per user spec: "data till the data should be seen").
 *
 * - applyLiveData(synthInventory, live) returns an enriched inventory list
 *   where each SKU's warehouseBreakdown / stock.warehouse / velocity get
 *   overridden by the live numbers when a matching code exists. Everything
 *   else (name, code, variant, leadTime, growth, splits, marketplace
 *   stock, supplier, cost basis) stays from data.js — the live sheet
 *   doesn't carry that information today.
 */

const STORAGE_KEY = "ns.liveInventory";

export function loadLiveInventory() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveLiveInventory(payload) {
  if (typeof window === "undefined") return;
  if (payload) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } else {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

export function clearLiveInventory() {
  saveLiveInventory(null);
}

/**
 * Overlay live numbers onto the synth inventory.
 * Returns a new inventory array; the input is not mutated.
 */
export function applyLiveData(synthInventory) {
  // ⚠️ RETIRED (FIX-SPEC, 2026-06). This legacy "live inventory" synth path used
  // to override warehouseBreakdown / stock.warehouse / velocity / producible /
  // runway from a stale `ns.liveInventory` localStorage payload — a SECOND
  // warehouse source that conflicted with (and clobbered) the central-WH engine,
  // reintroducing the old producible=min(semiFg,packaging) bug (ignores D1) and
  // the green-stockout runway bug. The central-WH engine (data.js overlay) is
  // now the SINGLE warehouse authority and the durable upload path is the 7th
  // 'central-wh' zone (multiFileStore → centralWhEngine), so this synth is a
  // no-op pass-through. Signature kept so existing call sites don't break.
  return synthInventory;
}

/**
 * Human-readable summary of a live payload — useful for the upload
 * confirmation preview and the "Data as of" badge.
 */
export function summariseLive(live) {
  if (!live) return null;
  const count = (obj) => obj ? Object.keys(obj).length : 0;
  return {
    fileName: live.fileName,
    uploadedAt: live.uploadedAt,
    dataAsOf: live.dataAsOf,
    sheetNames: live.sheetNames || [],
    fgCount: count(live.fg),
    semiFgCount: count(live.semiFg),
    rawCount: count(live.raw),
    pkgCount: count(live.pkg),
    velocityCount: count(live.velocity),
    unmappedCount: (live.unmapped || []).length,
  };
}
