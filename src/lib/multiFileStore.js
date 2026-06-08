/**
 * multiFileStore.js
 *
 * Persists the multi-file upload payload to localStorage so it survives
 * page reloads. data.js reads from here at module-init time and merges
 * uploaded payloads on top of the bundled real-data files.
 *
 * Storage shape:
 *   {
 *     uploadedAt: ISO,            // last time ANY file slot changed
 *     files: {
 *       "central-wh":    { dataAsOf, fileName, parsed },  // audit "as-of" date; NO cutoff (D2)
 *       "amazon-ledger": { dataAsOf, fileName, parsed },  // snapshot — dataAsOf is the picker cutoff
 *       "agency":        { dataAsOf, fileName, parsed },
 *       "blinkit":       { dataAsOf, fileName, parsed },
 *       "flipkart":      { dataAsOf, fileName, parsed },
 *       "shopify":       { dataAsOf, fileName, parsed },
 *       // legacy slots that may linger from older uploads: "amazon-orders", "nitin"
 *     }
 *   }
 *
 * Each entry is independent — you can upload one file at a time and
 * later overlay another without resetting the rest. CRUCIALLY, each entry's
 * `dataAsOf` (the per-sheet cutoff for sales/marketplace files, or the audit
 * date for central-wh) is stored and read back PER FILE, so different sheets
 * keep DIFFERENT cutoffs across a hard refresh — they never equalize (D2).
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

/** Build a central-WH override from the 7th upload zone ('central-wh').
 *  Returns the full parsed engine payload ({ fg, components, fixedAssets,
 *  consumables, anchorDate, asOf, flags, ... }) so data.js can overlay WH FG +
 *  producible + components, or null when nothing usable is uploaded.
 *  NOTE: this is the SINGLE warehouse source. The legacy 'nitin' Warehouse
 *  Daily Inventory path (buildNitinOverride) was REMOVED (FIX-SPEC V9): it
 *  conflicted with this engine and fed velocity from warehouse movement
 *  (GROUND-TRUTH §3.5 violation). SAFE FALLBACK: guard on `p.fg` so a malformed
 *  parse → null, never a half-baked override. */
export function buildCentralWhOverride(store) {
  const p = store?.files?.["central-wh"]?.parsed;
  return (p && p.fg) ? p : null;
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
