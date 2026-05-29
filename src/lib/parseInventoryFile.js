/**
 * Naturesum MIS sheet parser — client-side port of apps-script/Code.gs.
 *
 * Takes an uploaded Excel/CSV File and returns a normalised JSON payload:
 *   {
 *     uploadedAt: ISO string,
 *     dataAsOf:   string | null,    // most recent "On <date>" header in Daily Movement
 *     fileName:   string,
 *     sheetNames: string[],
 *     fg, semiFg, raw, pkg, velocity,   // each = { [SKU code]: number }
 *     unmapped: string[],            // names from the sheet that couldn't be matched
 *   }
 *
 * Same SKU mapping + parse rules as the Apps Script so the two stay in sync.
 */
import * as XLSX from "xlsx";

// ─── SKU mapping: sheet item name → canonical Naturesum code ──────────
// Add new aliases as needed. Matching is case-insensitive, substring.
const ITEM_MAP = [
  // Finished Goods (FG)
  { code: "NSMP100",   category: "FG",   aliases: ["moringa powder 100", "moringa 100"] },
  { code: "NSMP250",   category: "FG",   aliases: ["moringa powder 250", "moringa 250"] },
  { code: "NSSB100",   category: "FG",   aliases: ["sb powder 100", "sea buckthorn berries powder 100", "sb berries powder 100"] },
  { code: "NSSB250",   category: "FG",   aliases: ["sb powder 250", "sea buckthorn berries powder 250", "sb berries powder 250"] },
  { code: "NSSB500",   category: "FG",   aliases: ["sb powder 500", "sea buckthorn berries powder 500", "sb berries powder 500"] },
  { code: "NSSBDB100", category: "FG",   aliases: ["sb berries 100", "sea buckthorn dry berries 100", "sb dry berries 100"] },
  { code: "NSSBDB250", category: "FG",   aliases: ["sb berries 250", "sea buckthorn dry berries 250", "sb dry berries 250"] },
  { code: "NSSBDB500", category: "FG",   aliases: ["sb berries 500", "sea buckthorn dry berries 500", "sb dry berries 500"] },
  { code: "NSSBJ300",  category: "FG",   aliases: ["sea buckthorn berries juice 300", "sb juice 300"] },
  { code: "NSSBJ500",  category: "FG",   aliases: ["sea buckthorn berries juice 500", "sb juice 500"] },
  { code: "NSSBBO15",  category: "FG",   aliases: ["sb face oil 15", "sea buckthorn berry oil 15", "sb berry oil 15"] },
  { code: "NSSBBO30",  category: "FG",   aliases: ["sb face oil 30", "sea buckthorn berry oil 30", "sb berry oil 30"] },
  { code: "NSJO100",   category: "FG",   aliases: ["jatamansi hair oil 100", "jatamansi & rosemary hair oil"] },
  { code: "NSACDT30",  category: "FG",   aliases: ["ac tea", "acacia catechu", "acacia catechu - 30 tea bags"] },

  // Semi-Finished
  { code: "NSACTPF",   category: "SEMI", aliases: ["ac tea pouches", "acacia tea pouches"] },
  { code: "NSJOF100",  category: "SEMI", aliases: ["jatamansi hair oil filled", "jatamansi filled bottles"] },
  { code: "NSACDSF30", category: "SEMI", aliases: ["ac tea dip sachets", "acacia tea dip sachets filled"] },

  // Raw
  { code: "NSSBPR",   category: "RAW",  aliases: ["sb powder (raw)", "sb powder raw"] },
  { code: "NSSBJPLP", category: "RAW",  aliases: ["sb juice pulp"] },
  { code: "NSSBDBR",  category: "RAW",  aliases: ["sb dry berries (raw)", "sb dry berries raw"] },
  { code: "NSMLPR",   category: "RAW",  aliases: ["moringa leaves powder"] },
  { code: "NSSBOR",   category: "RAW",  aliases: ["sb oil"] },
  { code: "NSJOR",    category: "RAW",  aliases: ["jatamansi oil"] },

  // Packaging
  { code: "NSPKGCB250",   category: "PKG", aliases: ["250 gm packaging carton box"] },
  { code: "NSPKGCB100",   category: "PKG", aliases: ["100 gram packaging carton box"] },
  { code: "NSPKGBOB15",   category: "PKG", aliases: ["sb faceoil empty box 15"] },
  { code: "NSPKGBOB30",   category: "PKG", aliases: ["sb faceoil empty box 30"] },
  { code: "NSPKGJOB100",  category: "PKG", aliases: ["hair oil bottles empty", "jatamasi empty box"] },
  { code: "NSPKGACTC30",  category: "PKG", aliases: ["acacia catechu tea bag empty outer", "acacia catechu tea bag empty pouch"] },
  { code: "NSPKGJB300",   category: "PKG", aliases: ["small air pouch", "air pouch for juice(300"] },
  { code: "NSPKGJB500",   category: "PKG", aliases: ["large air pouch", "air pouch for juice(500"] },
  { code: "NSPKGDBP500",  category: "PKG", aliases: ["dry berries empty pouches (500"] },
  { code: "NSPKGDBP250",  category: "PKG", aliases: ["dry berries empty pouches (250"] },
  { code: "NSPKGDBP100",  category: "PKG", aliases: ["dry berries empty pouches(100"] },
  { code: "NSPKGSBP500",  category: "PKG", aliases: ["sb powder empty pouches(500"] },
  { code: "NSPKGSBP250",  category: "PKG", aliases: ["sb powder empty pouches(250"] },
  { code: "NSPKGSBP100",  category: "PKG", aliases: ["sb powder empty pouches(100"] },
];

const SKIP_KEYWORDS = [
  "sealing machine", "heat gun", "tape", "picking equipment",
  "empty drums", "ac unit", "laptop", "tsc label", "barcode scanner",
  "tables", "benches", "office chair", "disposable packaging caps",
  "mrp stickers", "sb faceoil droppers", "sb faceoil carpets",
  "sb face oil bottle caps", "blank(no print) hair oil box",
  "jatamansi hair oil foam",
];

/** Map a raw item description from the sheet to a canonical SKU entry.
 *  Returns null if the name should be skipped or no match found. */
function mapItem(name) {
  if (!name) return null;
  const n = String(name).toLowerCase().trim();
  if (!n) return null;
  if (SKIP_KEYWORDS.some(kw => n.includes(kw))) return null;
  for (const entry of ITEM_MAP) {
    if (entry.aliases.some(a => n.includes(a))) return entry;
  }
  return null;
}

/** Parse quirky quantity strings:
 *    "20 + 2000" → 2020      (sums additions)
 *    "36-50"     → 36        (lower bound of range)
 *    "NA" / ""   → 0
 *    number      → itself
 *  Sheets are filled by humans so the values are messy. */
function parseQty(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (!s || /^na$/i.test(s)) return 0;
  if (s.includes("+")) {
    return s.split("+").reduce((sum, p) => sum + (parseFloat(p) || 0), 0);
  }
  if (s.indexOf("-") > 0) {
    return parseFloat(s.split("-")[0]) || 0;
  }
  return parseFloat(s) || 0;
}

/** Look up a sheet by name, tolerating leading/trailing whitespace and
 *  case differences. Returns the row-array (header:1 format) or null. */
function getSheetRows(workbook, name) {
  const target = name.trim().toLowerCase();
  const match = workbook.SheetNames.find(n => n.trim().toLowerCase() === target);
  if (!match) return null;
  const sheet = workbook.Sheets[match];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
}

/** Row schema for the Master tab is
 *    [S.No., Item Description, Quantity (base), Unit, Live, Notes]
 *  We want the "Live" column (index 4) — that's the current balance after
 *  Daily Movement has been applied. "Quantity" (index 2) is the as-of-7-Mar
 *  base value and would silently feed stale numbers into the dashboard.
 *  Falls back to Quantity when Live is blank/null. Negatives clamped to 0
 *  (negative = oversold; physical stock can't go below zero). */
function liveQty(row) {
  const live = row[4];
  const base = row[2];
  const v = (live != null && live !== "") ? parseQty(live) : parseQty(base);
  return Math.max(0, v);
}

/** Read FG quantities from Master's Live column. */
function readInventoryFG(workbook, unmapped) {
  const rows = getSheetRows(workbook, "Master") || getSheetRows(workbook, "warehouse inventory");
  if (!rows) return {};
  const out = {};
  for (const row of rows) {
    if (!row) continue;
    const name = row[1];
    if (!name) continue;
    const m = mapItem(name);
    if (!m) { if (unmapped) unmapped.add(String(name).trim()); continue; }
    if (m.category !== "FG") continue;
    out[m.code] = (out[m.code] || 0) + liveQty(row);
  }
  return out;
}

/** Read Semi-FG, Raw, Packaging quantities from the Master Live column. */
function readInventoryAll(workbook, unmapped) {
  const rows = getSheetRows(workbook, "Master");
  if (!rows) return { semiFg: {}, raw: {}, pkg: {} };
  const out = { semiFg: {}, raw: {}, pkg: {} };
  for (const row of rows) {
    if (!row) continue;
    const name = row[1];
    if (!name) continue;
    const m = mapItem(name);
    if (!m) { if (unmapped) unmapped.add(String(name).trim()); continue; }
    const v = liveQty(row);
    if (m.category === "SEMI") out.semiFg[m.code] = (out.semiFg[m.code] || 0) + v;
    else if (m.category === "RAW") out.raw[m.code] = (out.raw[m.code] || 0) + v;
    else if (m.category === "PKG") out.pkg[m.code] = (out.pkg[m.code] || 0) + v;
  }
  return out;
}

/** Average daily stock-OUT per FG SKU over the most recent N days from
 *  the "Daily Movement of FG" tab. The tab is structured as repeating
 *  blocks per day, each with an "Item Name" header row followed by rows
 *  per SKU, terminated by an "On <date>" header.
 *  Returns { [code]: avgUnitsPerDay (1-decimal precision) }. */
function readVelocity(workbook, days = 30) {
  const rows = getSheetRows(workbook, "Daily Movement of FG");
  if (!rows) return {};
  // OUT columns are B..G in the source sheet → indices 1..6
  const outCols = [1, 2, 3, 4, 5, 6];
  const sums = {};
  const dayCount = {};
  let inItemRows = false;
  let blocksSeen = 0;
  for (const r of rows) {
    if (!r) continue;
    const first = String(r[0] || "").trim().toLowerCase();
    if (first.startsWith("item name")) { inItemRows = true; blocksSeen++; continue; }
    if (first.startsWith("on ")) { inItemRows = false; continue; }
    if (!inItemRows) continue;
    if (blocksSeen > days) break;
    const m = mapItem(r[0]);
    if (!m || m.category !== "FG") continue;
    let outQty = 0;
    for (const c of outCols) outQty += parseFloat(r[c]) || 0;
    sums[m.code] = (sums[m.code] || 0) + outQty;
    dayCount[m.code] = (dayCount[m.code] || 0) + 1;
  }
  const out = {};
  for (const k of Object.keys(sums)) {
    const d = Math.max(1, dayCount[k]);
    out[k] = Math.round((sums[k] / d) * 10) / 10;
  }
  return out;
}

/** Find the most recent "On <date>" header in the Daily Movement tab.
 *  This is the "data as of" date — critical UX so users know whether the
 *  dashboard reflects fresh numbers or stale ones. */
function readDataAsOf(workbook) {
  const rows = getSheetRows(workbook, "Daily Movement of FG");
  if (!rows) return null;
  for (const r of rows) {
    if (!r) continue;
    const first = String(r[0] || "").trim();
    const m = first.match(/^On\s+(.+)/i);
    if (m) return m[1].trim();
  }
  return null;
}

/**
 * Main entry — pass in a browser File object, get back a parsed payload.
 */
export async function parseInventoryFile(file) {
  if (!file) throw new Error("No file provided");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false });

  const unmapped = new Set();
  const fg = readInventoryFG(workbook, unmapped);
  const all = readInventoryAll(workbook, unmapped);
  const velocity = readVelocity(workbook, 30);
  const dataAsOf = readDataAsOf(workbook);

  return {
    uploadedAt: new Date().toISOString(),
    dataAsOf,
    fileName: file.name,
    sheetNames: workbook.SheetNames,
    fg,
    semiFg: all.semiFg,
    raw: all.raw,
    pkg: all.pkg,
    velocity,
    // Cap unmapped list — useful for showing the user "what didn't match" but
    // don't dump 100s of rows.
    unmapped: Array.from(unmapped).slice(0, 50),
  };
}
