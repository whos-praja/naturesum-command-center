/**
 * multiFileStore.js
 *
 * Persists the multi-file upload payload to localStorage so it survives
 * page reloads. data.js reads from here at module-init time and merges
 * uploaded payloads on top of the bundled real-data files.
 *
 * Storage shape:
 *   {
 *     uploadedAt: ISO,
 *     files: {
 *       "amazon-ledger": { dataAsOf, fileName, parsed },
 *       "amazon-orders": { dataAsOf, fileName, parsed },
 *       "blinkit":       { dataAsOf, fileName, parsed },
 *       "flipkart":      { dataAsOf, fileName, parsed },
 *       "shopify":       { dataAsOf, fileName, parsed },
 *       "nitin":         { dataAsOf, fileName, parsed },
 *     }
 *   }
 *
 * Each entry is independent — you can upload one file at a time and
 * later overlay another without resetting the rest.
 */

const KEY = "ns.multiFileUpload";

export function loadMultiFile() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveMultiFile(payload) {
  if (typeof window === "undefined") return;
  if (payload) {
    window.localStorage.setItem(KEY, JSON.stringify(payload));
  } else {
    window.localStorage.removeItem(KEY);
  }
}

/** Merge a single file's parsed payload into the current store. Other
 *  file slots stay as-is. Returns the new combined payload. */
export function upsertFile(type, entry) {
  const cur = loadMultiFile() || { uploadedAt: null, files: {} };
  const next = {
    uploadedAt: new Date().toISOString(),
    files: { ...cur.files, [type]: { ...entry, uploadedAt: new Date().toISOString() } },
  };
  saveMultiFile(next);
  return next;
}

export function removeFile(type) {
  const cur = loadMultiFile();
  if (!cur) return null;
  const { [type]: _removed, ...rest } = cur.files;
  const next = { uploadedAt: new Date().toISOString(), files: rest };
  saveMultiFile(next);
  return next;
}

export function clearAll() {
  saveMultiFile(null);
}

/** Build a REAL_MARKETPLACE_DATA-shaped object from uploaded files.
 *  Returns null when nothing usable has been uploaded.
 *  Per the founder's truth table, the Agency Channel-wise Sales Sheet is
 *  the source of truth for Amazon velocity + growth. It rides in the
 *  per-SKU `agency` field so data.js can prefer it over every other
 *  Amazon-velocity source. */
export function buildRealMarketplaceOverride(store) {
  if (!store?.files) return null;
  const { files } = store;
  const amazonLedger = files["amazon-ledger"]?.parsed || {};
  const amazonOrders = files["amazon-orders"]?.parsed || {};        // legacy zone (retired from UI)
  const agency       = files["agency"]?.parsed?.byCode || {};       // NEW — agency channel split
  const blinkit      = files["blinkit"]?.parsed || {};
  const flipkart     = files["flipkart"]?.parsed || {};
  const shopify      = files["shopify"]?.parsed?.byCode || {};
  const codes = new Set([
    ...Object.keys(amazonLedger),
    ...Object.keys(amazonOrders),
    ...Object.keys(agency),
    ...Object.keys(blinkit),
    ...Object.keys(flipkart),
    ...Object.keys(shopify),
  ]);
  if (codes.size === 0) return null;
  const out = {};
  for (const code of codes) {
    out[code] = {
      amazon: amazonLedger[code] ? {
        ...amazonLedger[code],
        ...(amazonOrders[code] ? { orders: amazonOrders[code] } : {}),
      } : (amazonOrders[code] ? { orders: amazonOrders[code] } : null),
      blinkit:  blinkit[code]  || null,
      flipkart: flipkart[code] || null,
      shopify:  shopify[code]  || null,
      agency:   agency[code]   || null,
    };
  }
  return out;
}

/** Build a NITIN_DATA-shaped object from the Nitin upload. */
export function buildNitinOverride(store) {
  const parsed = store?.files?.["nitin"]?.parsed;
  if (!parsed) return null;
  // parseInventoryFile output → match NITIN_DATA shape used by data.js.
  return {
    warehouseInventory: { fg: parsed.fg || {}, asOf: parsed.dataAsOf || null },
    dailyMovement:      parsed.dailyMovement || { byCode: {}, days: 0 },
  };
}

/** A compact summary of what's uploaded — used in the UI status pill. */
export function summariseStore(store) {
  if (!store?.files) return { count: 0, dates: {} };
  const files = store.files;
  return {
    count: Object.keys(files).length,
    dates: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.dataAsOf || null])),
    uploadedAt: store.uploadedAt,
  };
}
