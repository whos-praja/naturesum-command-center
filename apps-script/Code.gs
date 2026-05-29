/**
 * Naturesum Command Center — Apps Script Web App
 * Reads the existing "Naturesum Live Inventory" sheet (Master, Daily
 * Movement of FG, Production, warehouse inventory tabs) and returns
 * a normalised JSON payload the React tool consumes.
 *
 * Deploy: Extensions → Apps Script → paste this code → Deploy → Web App
 *   Execute as: Me  |  Access: Anyone (or "Anyone with Google account")
 * Copy the /exec URL and set as VITE_SHEET_URL in the tool.
 */

// ─── SKU mapping: sheet item name → canonical Naturesum code ────────
// The sheet uses descriptive names; the tool uses stable codes.
// Add new aliases as needed. Matching is case-insensitive and ignores
// extra whitespace. Partial-match supported via the `aliases` array.
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

  // Packaging — match by product family + size
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

// Equipment / non-inventory items in Master sheet to ignore
const SKIP_KEYWORDS = [
  "sealing machine", "heat gun", "tape", "picking equipment",
  "empty drums", "ac unit", "laptop", "tsc label", "barcode scanner",
  "tables", "benches", "office chair", "disposable packaging caps",
  "mrp stickers", "sb faceoil droppers", "sb faceoil carpets",
  "sb face oil bottle caps", "blank(no print) hair oil box",
  "jatamansi hair oil foam",
];

/**
 * Map a raw item description from the sheet to a canonical code.
 * Returns null if no match (item is then skipped).
 */
function mapItem(name) {
  if (!name) return null;
  const n = String(name).toLowerCase().trim();
  if (SKIP_KEYWORDS.some(kw => n.indexOf(kw) !== -1)) return null;
  for (const entry of ITEM_MAP) {
    if (entry.aliases.some(a => n.indexOf(a) !== -1)) return entry;
  }
  return null;
}

/** Parse free-text quantity strings: "20 + 2000" → 2020, "36-50" → 36,
 *  "NA"/empty → 0. Otherwise plain number. */
function parseQty(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (!s || /^na$/i.test(s)) return 0;
  // "20 + 2000" — sum the additions
  if (s.indexOf("+") !== -1) {
    return s.split("+").reduce((sum, p) => sum + (parseFloat(p) || 0), 0);
  }
  // "36-50" — take the lower bound
  if (s.indexOf("-") > 0) {
    return parseFloat(s.split("-")[0]) || 0;
  }
  return parseFloat(s) || 0;
}

/** Read the latest warehouse inventory snapshot (FG only). Falls back
 *  to Master if the warehouse-inventory tab is empty. */
function readInventoryFG(ss) {
  let sheet = ss.getSheetByName(" warehouse inventory") || ss.getSheetByName("warehouse inventory");
  if (!sheet) sheet = ss.getSheetByName("Master");
  const rows = sheet.getDataRange().getValues();
  const out = {};
  for (const row of rows) {
    const [_sno, name, qty] = row;
    const m = mapItem(name);
    if (!m || m.category !== "FG") continue;
    out[m.code] = (out[m.code] || 0) + parseQty(qty);
  }
  return out;
}

/** Read Semi-FG, Raw, Packaging quantities from Master. */
function readInventoryAll(ss) {
  const sheet = ss.getSheetByName("Master");
  if (!sheet) return { semiFg: {}, raw: {}, pkg: {} };
  const rows = sheet.getDataRange().getValues();
  const out = { semiFg: {}, raw: {}, pkg: {} };
  for (const row of rows) {
    const [_sno, name, qty] = row;
    const m = mapItem(name);
    if (!m) continue;
    const v = parseQty(qty);
    if (m.category === "SEMI") out.semiFg[m.code] = (out.semiFg[m.code] || 0) + v;
    else if (m.category === "RAW") out.raw[m.code] = (out.raw[m.code] || 0) + v;
    else if (m.category === "PKG") out.pkg[m.code] = (out.pkg[m.code] || 0) + v;
  }
  return out;
}

/** Sum daily stock-OUT per item over the last N days from "Daily Movement of FG".
 *  The sheet uses repeating wide blocks per day. We walk top-to-bottom,
 *  find each "Item Name" header, then sum the channel cols.
 *  Returns { [code]: avgDailyVelocity (rounded) } */
function readVelocity(ss, days) {
  days = days || 30;
  const sheet = ss.getSheetByName("Daily Movement of FG");
  if (!sheet) return {};
  const rows = sheet.getDataRange().getValues();
  // OUT columns are B..G (indices 1-6) per the sheet's structure
  const outCols = [1, 2, 3, 4, 5, 6];
  const sums = {}; const dayCount = {};
  let inItemRows = false;
  let blocksSeen = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const first = String(r[0] || "").trim().toLowerCase();
    if (first.indexOf("item name") === 0) { inItemRows = true; blocksSeen++; continue; }
    if (first.indexOf("on ") === 0) { inItemRows = false; continue; }
    if (!inItemRows) continue;
    if (blocksSeen > days) break; // limit to recent N days
    const m = mapItem(r[0]);
    if (!m || m.category !== "FG") continue;
    let outQty = 0;
    for (const c of outCols) outQty += (parseFloat(r[c]) || 0);
    sums[m.code] = (sums[m.code] || 0) + outQty;
    dayCount[m.code] = (dayCount[m.code] || 0) + 1;
  }
  // average per day; round to nearest integer for cleaner display
  const out = {};
  Object.keys(sums).forEach(k => {
    const d = Math.max(1, dayCount[k]);
    out[k] = Math.round(sums[k] / d * 10) / 10;
  });
  return out;
}

/** Main entry — returns the full JSON payload. */
function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const fg = readInventoryFG(ss);
  const all = readInventoryAll(ss);
  const velocity = readVelocity(ss, 30);

  const payload = {
    lastUpdated: new Date().toISOString(),
    sheetName: ss.getName(),
    fg, semiFg: all.semiFg, raw: all.raw, pkg: all.pkg,
    velocity,
  };

  return ContentService
    .createTextOutput(JSON.stringify(payload, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Optional: open the URL via doGet in a browser. To test inside the
 *  script editor, run `testFetch()` and check the logs. */
function testFetch() {
  const out = doGet({});
  Logger.log(out.getContent());
}
