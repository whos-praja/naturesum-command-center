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
export function applyLiveData(synthInventory, live) {
  if (!live) return synthInventory;

  return synthInventory.map(s => {
    const liveFg     = live.fg?.[s.code];
    const liveSemi   = live.semiFg?.[s.code];
    const liveRaw    = live.raw?.[s.code];
    const livePkg    = live.pkg?.[s.code];
    const liveVel    = live.velocity?.[s.code];

    // Nothing live for this SKU → leave untouched
    if (liveFg == null && liveSemi == null && liveRaw == null && livePkg == null && liveVel == null) {
      return s;
    }

    const wb = { ...s.warehouseBreakdown };
    if (liveFg   != null) wb.fg          = liveFg;
    if (liveSemi != null) wb.semiFg      = liveSemi;
    if (liveRaw  != null) wb.rawMaterial = liveRaw;
    if (livePkg  != null) wb.packaging   = livePkg;
    // Producible FG always = min(semiFg, packaging). Recompute when either input
    // moved, since the cached value would now be stale.
    wb.producibleFG = Math.min(wb.semiFg ?? 0, wb.packaging ?? 0);

    const newWarehouseFg = liveFg != null ? liveFg : s.stock.warehouse;
    const stock = { ...s.stock, warehouse: newWarehouseFg };
    const velocity = liveVel != null ? liveVel : s.velocity;
    const totalStock = stock.warehouse + stock.amazonFBA + stock.flipkart + stock.blinkit;
    const runway = velocity > 0 ? Math.round(totalStock / velocity) : 0;
    const runwayStatus = runway <= s.leadTime ? "red" : runway < 30 ? "amber" : "green";

    return {
      ...s,
      stock,
      warehouseBreakdown: wb,
      velocity,
      totalStock,
      runway,
      runwayStatus,
      // Mark this row as live-sourced so the UI can show a small badge.
      _live: true,
    };
  });
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
