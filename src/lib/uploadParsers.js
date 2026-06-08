/**
 * uploadParsers.js
 *
 * Client-side parsers for the six daily upload file types. Mirror of
 * scripts/import-marketplace-data.cjs and scripts/import-nitin-sheet.cjs
 * but reads from a browser File rather than fs.
 *
 * Each parser is `async (file, opts) → parsedPayload`. opts.dateCutoff
 * (Date | null) filters rows with a date column; snapshot files keep
 * the snapshot but tag its source date.
 *
 * Output schemas match the bundled real-data files so data.js can
 * overlay an uploaded payload directly.
 */
import * as XLSX from "xlsx";
import { parseCentralWhWorkbook } from "./centralWhEngine.js";

// ─── Canonical SKU map (same as scripts/) ────────────────────
const CODE_MAP = {
  NSSBDB100: { amzMsku: "NSSBDB100g", fk: "NSSBDB100g",  shp: "NS-SBDR-100", blkTitleKey: "Himalayan Sea Buckthorn Dry Berries", blkVariant: "100 g" },
  NSSBDB250: { amzMsku: "NSSBDB250g", fk: "NSSBDB250g",  shp: "NS-SBDR-250", blkTitleKey: "Sea Buckthorn Dry Berries",           blkVariant: "250 g" },
  NSSBDB500: { amzMsku: "NSSBDB500g", fk: "NSSBDB500g",  shp: "NS-SBDR-500", blkTitleKey: "Himalayan Sea Buckthorn Dry Berries", blkVariant: "500 g" },
  NSSB100:   { amzMsku: "NSSBP100",   fk: "NSSBP100",    shp: "NS-SBP-100",  blkTitleKey: "Daily Nutrition Supplement Powder",   blkVariant: "100 g" },
  NSSB250:   { amzMsku: "NSSBP250",   fk: "NSSBP250",    shp: "NS-SBP-250",  blkTitleKey: "Sea Buckthorn Berries Powder",        blkVariant: "250 g" },
  NSSB500:   { amzMsku: "NSSBP500",   fk: "NSSBP500",    shp: "NS-SBP-500",  blkTitleKey: "Daily Nutrition Supplement",          blkVariant: "500 g" },
  NSSBJ300:  { amzMsku: "NSSBJ300ML", fk: "NSSBJ300ML",  shp: "NS-SBJ-300",  blkTitleKey: "Berry Juice Concentrate",             blkVariant: "300 ml" },
  NSSBJ500:  { amzMsku: "NSSBJ500ML", fk: "NSSBJ500ML",  shp: "NS-SBJ-500",  blkTitleKey: null },
  NSMP100:   { amzMsku: "NSMP100",    fk: "NSMP100",     shp: "NSMP100",     blkTitleKey: null },
  NSMP250:   { amzMsku: "NSMP250",    fk: "NSMP250",     shp: "NSMP250",     blkTitleKey: null },
  NSJO100:   { amzMsku: "NSJ&RHO100ML", fk: "NSJ&RHO100ML", shp: "NS-HO-JT-100", blkTitleKey: null },
  NSACDT30:  { amzMsku: "DI-TE-1-A",   fk: "DI-TE-1-A",   shp: "DI-TE-1-A",   blkTitleKey: "Diabetes Care Tea",                  blkVariant: "30 pcs" },
  NSSBBO15:  { amzMsku: null,         fk: null,          shp: null,          blkTitleKey: null },
  NSSBBO30:  { amzMsku: null,         fk: null,          shp: "NS-SB-030",   blkTitleKey: null },
};
const byAmzMsku  = Object.fromEntries(Object.entries(CODE_MAP).filter(([, m]) => m.amzMsku).map(([c, m]) => [m.amzMsku, c]));
const byFkSku    = Object.fromEntries(Object.entries(CODE_MAP).filter(([, m]) => m.fk).map(([c, m]) => [m.fk.trim(), c]));
const byShpSku   = Object.fromEntries(Object.entries(CODE_MAP).filter(([, m]) => m.shp).map(([c, m]) => [m.shp, c]));
const blkMatches = Object.entries(CODE_MAP)
  .filter(([, m]) => m.blkTitleKey)
  .map(([code, m]) => ({ titleKey: m.blkTitleKey, variant: m.blkVariant, code }));

// ─── Helpers ─────────────────────────────────────────────────
const num = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v || "").trim();
  if (!s || /^na$/i.test(s)) return 0;
  if (s.includes("-") && !/^-?\d+(\.\d+)?$/.test(s)) {
    const [a] = s.split("-");
    const n = Number(a);
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(s.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

async function fileToText(file) {
  return await file.text();
}
async function fileToWorkbook(file) {
  const buf = await file.arrayBuffer();
  return XLSX.read(buf, { type: "array" });
}

function parseCsvLine(line) {
  const out = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else {
      if (c === ",") { out.push(cur); cur = ""; }
      else if (c === '"') q = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}
function parseCsv(txt) {
  txt = txt.replace(/^﻿/, "");
  const lines = txt.split(/\r?\n/).filter(l => l.length);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const cells = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ""; });
    return row;
  });
}

// ─── 1. Amazon FBA warehouse-wise ledger (CSV) ──────────────
export async function parseAmazonLedger(file, _opts = {}) {
  const txt = await fileToText(file);
  const rows = parseCsv(txt);
  const byCode = {};
  for (const r of rows) {
    const code = byAmzMsku[r["MSKU"]];
    if (!code) continue;
    const disp = r["Disposition"];
    const loc  = r["Location"];
    const endBal = num(r["Ending Warehouse Balance"]);
    const shipped = -num(r["Customer Shipments"]);
    if (!byCode[code]) byCode[code] = { byFc: {}, totalSellable: 0, totalDamaged: 0, totalShippedToday: 0 };
    const fc = byCode[code].byFc[loc] || { sellable: 0, damaged: 0, shipped: 0 };
    if (disp === "SELLABLE") fc.sellable += endBal;
    else fc.damaged += endBal;
    fc.shipped += shipped;
    byCode[code].byFc[loc] = fc;
    if (disp === "SELLABLE") byCode[code].totalSellable += endBal;
    else byCode[code].totalDamaged += endBal;
    byCode[code].totalShippedToday += shipped;
  }
  return byCode;
}

// ─── 2. Amazon "Manage Orders" 30-day TSV ───────────────────
export async function parseAmazonOrders(file, opts = {}) {
  const txt = await fileToText(file);
  const lines = txt.split(/\r?\n/).filter(l => l.length);
  const headers = lines[0].split("\t");
  const col = (n) => headers.indexOf(n);
  const FUL = col("fulfillment-channel"), SKU = col("sku"), QTY = col("quantity");
  const PRC = col("item-price"), STA = col("order-status"), DTE = col("purchase-date");
  const SCH = col("order-channel");
  const cutoff = opts.dateCutoff ? new Date(opts.dateCutoff) : null;
  const byCode = {};
  const dates = new Set();
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split("\t");
    if (/cancel/i.test(cells[STA] || "")) continue;
    const dateStr = (cells[DTE] || "").slice(0, 10);
    if (cutoff && dateStr && new Date(dateStr) > cutoff) continue;
    const rawSku = (cells[SKU] || "").trim();
    if (!rawSku) continue;
    const code = byAmzMsku[rawSku.replace(/_MP$/i, "")];
    if (!code) continue;
    const isMcf = /_MP$/i.test(rawSku) || /merchant/i.test(cells[FUL] || "");
    const isWebsite = /websiteorderchannel/i.test(cells[SCH] || "");
    const qty = num(cells[QTY]), rev = num(cells[PRC]);
    if (!byCode[code]) byCode[code] = { fbaOrders:0, fbaUnits:0, fbaRevenue:0, mcfOrders:0, mcfUnits:0, mcfRevenue:0, mcfWebsiteUnits:0 };
    if (isMcf) {
      byCode[code].mcfOrders++; byCode[code].mcfUnits += qty; byCode[code].mcfRevenue += rev;
      if (isWebsite) byCode[code].mcfWebsiteUnits += qty;
    } else {
      byCode[code].fbaOrders++; byCode[code].fbaUnits += qty; byCode[code].fbaRevenue += rev;
    }
    if (dateStr) dates.add(dateStr);
  }
  const days = Math.max(1, dates.size);
  for (const code of Object.keys(byCode)) {
    byCode[code].dailyFba = byCode[code].fbaUnits / days;
    byCode[code].dailyMcf = byCode[code].mcfUnits / days;
    byCode[code].days = days;
  }
  return byCode;
}

// ─── 3. Blinkit feeder-WH (xlsx) ────────────────────────────
export async function parseBlinkit(file, _opts = {}) {
  const wb = await fileToWorkbook(file);
  const sheetName = wb.SheetNames.find(n => /stock on hand/i.test(n)) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  const dataRows = rows.slice(3);
  const byCode = {};
  for (const r of dataRows) {
    const itemName = String(r[1] || "");
    const uom      = String(r[4] || "");
    if (!itemName) continue;
    const match = blkMatches.find(m =>
      itemName.toLowerCase().includes(m.titleKey.toLowerCase()) && uom === m.variant);
    if (!match) continue;
    const code = match.code;
    const whName = String(r[6] || "");
    const sellable = num(r[10]);
    const damaged = num(r[15]);
    const lost = num(r[16]);
    const sales7d = num(r[19]), sales15d = num(r[20]), sales30d = num(r[21]);
    if (!byCode[code]) byCode[code] = { byWh: {}, totalSellable: 0, totalDamaged: 0, totalSales30d: 0, everLaunched: [] };
    byCode[code].byWh[whName] = { sellable, damaged, lost, sales7d, sales15d, sales30d };
    byCode[code].everLaunched.push(whName);
    byCode[code].totalSellable += sellable;
    byCode[code].totalDamaged  += damaged + lost;
    byCode[code].totalSales30d += sales30d;
  }
  return byCode;
}

// Resolve a marketplace SKU that may carry a multi-pack suffix ("NSSBDB100g*2")
// to its base canonical code + the pack multiplier (R-MULTIPACK). Each multi-pack
// unit ships N base-SKU units, so its stock/sales fold into the base × N. Returns
// { code, multiplier } or null when neither the suffixed nor the base resolves.
function resolveFkMultipack(rawSku) {
  const sku = String(rawSku || "").trim();
  if (!sku) return null;
  if (byFkSku[sku]) return { code: byFkSku[sku], multiplier: 1 }; // exact match first
  const m = sku.match(/^(.+?)\s*\*\s*(\d+)$/);
  if (m) {
    const base = m[1].trim();
    const code = byFkSku[base];
    if (code) return { code, multiplier: parseInt(m[2], 10) || 1 };
  }
  return null;
}

// ─── 4. Flipkart current inventory (CSV) ────────────────────
export async function parseFlipkart(file, _opts = {}) {
  const txt = await fileToText(file);
  const rows = parseCsv(txt);
  const byCode = {};
  // Additive quantity fields fold N× from a multi-pack row into the base SKU.
  const QTY_FIELDS = ["live", "sales7d", "sales14d", "sales30d", "sales60d", "sales90d",
    "reservedOrders", "reservedInt", "damaged", "transferIncoming"];
  for (const r of rows) {
    const hit = resolveFkMultipack(r["SKU"]);
    if (!hit) continue;
    const { code, multiplier } = hit;
    const qty = {
      live: num(r["Live on Website"]),
      sales7d: num(r["Sales 7D"]),
      sales14d: num(r["Sales 14D"]),
      sales30d: num(r["Sales 30D"]),
      sales60d: num(r["Sales 60D"]),
      sales90d: num(r["Sales 90D"]),
      reservedOrders: num(r["Reserved for Orders and Recalls"]),
      reservedInt: num(r["Reserved for Internal Processing"]),
      damaged: num(r["Damaged"]),
      transferIncoming: num(r["B2B Receiving"]) + num(r["Transfers Receiving"]),
    };
    if (!byCode[code]) {
      byCode[code] = { warehouseId: r["Warehouse Id"], sellingPrice: num(r["Flipkart Selling Price"]),
        live: 0, sales7d: 0, sales14d: 0, sales30d: 0, sales60d: 0, sales90d: 0,
        reservedOrders: 0, reservedInt: 0, damaged: 0, transferIncoming: 0,
        isFAssured: String(r["F Assured Badge"] || "").toLowerCase() === "yes",
        fulfilmentType: r["Fulfilment Type"] };
    } else if (multiplier === 1) {
      // A later exact-match (base) row carries the canonical metadata.
      byCode[code].warehouseId = r["Warehouse Id"] || byCode[code].warehouseId;
      if (num(r["Flipkart Selling Price"])) byCode[code].sellingPrice = num(r["Flipkart Selling Price"]);
      if (String(r["F Assured Badge"] || "").toLowerCase() === "yes") byCode[code].isFAssured = true;
      byCode[code].fulfilmentType = byCode[code].fulfilmentType || r["Fulfilment Type"];
    }
    for (const f of QTY_FIELDS) byCode[code][f] += qty[f] * multiplier;
  }
  return byCode;
}

// ─── 5. Shopify website sales (CSV) ─────────────────────────
export async function parseShopify(file, opts = {}) {
  const txt = await fileToText(file);
  const rows = parseCsv(txt);
  const cutoff = opts.dateCutoff ? new Date(opts.dateCutoff) : null;
  const dates = [...new Set(rows.map(r => r["Day"]).filter(Boolean))]
    .filter(d => !cutoff || new Date(d) <= cutoff)
    .sort();
  const lastDate = dates[dates.length - 1];
  const lastTs = lastDate ? new Date(lastDate).getTime() : Date.now();
  const byCode = {};
  for (const r of rows) {
    const sku = r["Product variant SKU"];
    if (!sku) continue;
    const code = byShpSku[sku];
    if (!code) continue;
    const dayStr = r["Day"];
    if (!dayStr) continue;
    const day = new Date(dayStr).getTime();
    if (cutoff && day > cutoff.getTime()) continue;
    const ageDays = (lastTs - day) / 86400000;
    const units = num(r["Net items sold"]);
    // D5: sales14d (0-14d) added alongside the existing buckets so data.js can
    // compute a 14-day velocity for the MAX(30d,14d) window.
    if (!byCode[code]) byCode[code] = { sales7d: 0, sales14d: 0, sales30d: 0, sales60d: 0, sales90d: 0 };
    if (ageDays <= 7)  byCode[code].sales7d  += units;
    if (ageDays <= 14) byCode[code].sales14d += units;
    if (ageDays <= 30) byCode[code].sales30d += units;
    if (ageDays <= 60) byCode[code].sales60d += units;
    if (ageDays <= 90) byCode[code].sales90d += units;
  }
  // Derive a `monthly` ladder (trailing 30-day sums, MOST-RECENT FIRST) from the
  // existing 30/60/90 aging so data.js can compute MAX-MoM growth. Shopify gives
  // us 3 months → 2 usable MoMs. R-NEGATIVES: month diffs are NOT clamped (net
  // returns reduce a month's total). SAFE FALLBACK: missing buckets → 0.
  for (const code of Object.keys(byCode)) {
    const c = byCode[code];
    const s30 = Number.isFinite(c.sales30d) ? c.sales30d : 0;
    const s60 = Number.isFinite(c.sales60d) ? c.sales60d : 0;
    const s90 = Number.isFinite(c.sales90d) ? c.sales90d : 0;
    c.monthly = [s30, s60 - s30, s90 - s60];
  }
  return { byCode, dateRange: { first: dates[0], last: lastDate, days: dates.length } };
}

// ─── 6. Agency channel-wise sales sheet ─────────────────────
// Source-of-truth for Amazon / Blinkit / Flipkart velocity + growth per
// founder's truth table. Three shapes are auto-detected (top wins):
//
//   DAILY-LOG (the actual founder workbook): multi-tab xlsx with one
//     channel-named tab each ("AMZ Categorywise", "Blinkit Categorywise",
//     "FK Categorywise"). Each tab is a daily-log — Column A = Date,
//     columns B..N = product category display names with daily sales
//     ints. SKU resolution via NAME_MAP (display-name → canonical).
//     Sum last 30 rows for sales30d, last 60 for sales60d → growth from
//     (cur30 vs prior30 = sales60d − sales30d).
//
//   WIDE: single sheet, one row per SKU, per-channel columns ("Amazon",
//         "Flipkart", "Blinkit", "Shopify") + optional growth columns.
//
//   LONG: single sheet, one row per (SKU × channel), columns: SKU ·
//         Channel · Sales 30d · Growth.
//
// Full spec: docs/data-extraction-spec.md
//
// Agency-sheet category display name → canonical SKU code. Matching is
// case-insensitive and whitespace/punctuation-tolerant (see normalize()).
const AGENCY_NAME_MAP = {
  "jatamansi oil":                "NSJO100",
  "sea buckthorn berries 100g":   "NSSBDB100",
  "sea buckthorn berries 250g":   "NSSBDB250",
  "sea buckthorn berries 500g":   "NSSBDB500",
  "sea buckthorn powder 100g":    "NSSB100",
  "sea buckthorn powder 250g":    "NSSB250",
  "sea buckthorn powder 500g":    "NSSB500",
  "sea buckthorn oil 15ml":       "NSSBBO15",
  "sea buckthorn oil 30ml":       "NSSBBO30",
  "sea buckthorn juice 300ml":    "NSSBJ300",
  "sea buckthorn juice 500ml":    "NSSBJ500",
  "moringa powder 100g":          "NSMP100",
  "moringa powder 250g":          "NSMP250",
  // Acacia Catechu = the Diabetes Care Tea (NSACDT30, marketplace MSKU
  // DI-TE-1-A). Mapped so the agency Amazon/FK/Blinkit velocity + growth carry
  // it; previously unmapped → NSACDT30 fell back to the 1.0/d orders proxy
  // flagged "30d-only" and its growth degraded (P1-7).
  "acacia catechu":               "NSACDT30",
};

function normalizeAgencyName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[()]/g, " ")    // tolerate "Moringa Powder (100g)" vs "Moringa Powder 100g"
    .replace(/\s+/g, " ")
    .trim();
}

// Multi-pack columns: "Jatamansi Oil*4" → { code: NSJO100, multiplier: 4 }.
// Singles: "Jatamansi Oil" → { code: NSJO100, multiplier: 1 }.
// Unmapped or "total" → null.
function mapAgencyColumnToCode(header) {
  const norm = normalizeAgencyName(header);
  if (!norm || norm === "total") return null;
  const m = norm.match(/^(.+?)\s*\*\s*(\d+)$/);
  if (m) {
    const code = AGENCY_NAME_MAP[m[1].trim()];
    return code ? { code, multiplier: parseInt(m[2], 10) || 1 } : null;
  }
  const code = AGENCY_NAME_MAP[norm];
  return code ? { code, multiplier: 1 } : null;
}

function detectAgencyChannel(tabName) {
  const lc = String(tabName || "").toLowerCase();
  if (/amz|amazon|fba/.test(lc))    return "amazon";
  if (/blink|blnkit|quick/.test(lc)) return "blinkit";
  if (/flip|^fk|flipkart/.test(lc)) return "flipkart";
  return null; // "Sale" and others ignored
}

// Parse Excel/Sheets date cell to JS Date. Accepts:
//   • Date object  → return as-is
//   • number       → Excel serial (days since 1899-12-30)
//   • DD/M/YYYY    → Indian format
//   • ISO string   → native Date parse
function parseSheetDate(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date((v - 25569) * 86400 * 1000);
  const s = String(v).trim();
  if (!s || /^total/i.test(s)) return null;
  // DD/M/YYYY or D/M/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(`${m[3]}-${String(m[2]).padStart(2,"0")}-${String(m[1]).padStart(2,"0")}`);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// Process a single daily-log channel tab → aggregate sales into byCode[channel].
// `cutoff` (Date | null) — D2 per-sheet cutoff: any daily-log row dated STRICTLY
// AFTER the cutoff is dropped, and the trailing-window reference date is clamped
// to the cutoff so the 7/14/30/60-day buckets age back from the cutoff, not from
// a future row the founder asked to ignore. Null → no cutoff (use sheet's own
// latest date, original behaviour).
function processAgencyDailyLogTab(ws, channel, byCode, cutoff = null) {
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true });
  if (!grid.length) return false;

  // Find header row — first row where column A is "date" (case-insensitive).
  let headerIdx = -1;
  for (let i = 0; i < Math.min(grid.length, 10); i++) {
    const a = normalizeAgencyName(grid[i][0]);
    if (a === "date") { headerIdx = i; break; }
  }
  if (headerIdx === -1) return false;
  const headers = grid[headerIdx];

  // Map each column → { code, multiplier }. Multi-packs ("Jatamansi Oil*4")
  // get multiplier=4 so the unit count = raw value × 4 (one combo sold =
  // 4 actual units of stock depleted).
  const colMap = {};
  for (let c = 1; c < headers.length; c++) {
    const m = mapAgencyColumnToCode(headers[c]);
    if (m) colMap[c] = m;
  }
  if (Object.keys(colMap).length === 0) return false;

  // Determine the trailing-window reference = latest row date ON OR BEFORE the
  // D2 cutoff (snapshot semantics — not literal "today"). Rows dated strictly
  // after the cutoff are ignored entirely, so they neither move the reference
  // forward nor contribute to any bucket.
  const cutoffTs = cutoff instanceof Date && !isNaN(cutoff.getTime()) ? cutoff.getTime() : null;
  const dataRows = grid.slice(headerIdx + 1);
  let latestTs = -Infinity;
  for (const r of dataRows) {
    const d = parseSheetDate(r[0]);
    if (!d) continue;
    const t = d.getTime();
    if (cutoffTs != null && t > cutoffTs) continue; // D2: drop post-cutoff rows
    latestTs = Math.max(latestTs, t);
  }
  if (!Number.isFinite(latestTs)) return false;

  // Aggregate per-SKU aging buckets. Multi-pack columns contribute
  // (raw value × multiplier) units to the base SKU's aging buckets.
  for (const r of dataRows) {
    const d = parseSheetDate(r[0]);
    if (!d) continue;
    if (cutoffTs != null && d.getTime() > cutoffTs) continue; // D2: drop post-cutoff rows
    const ageDays = (latestTs - d.getTime()) / 86400000;
    // Extended to 120d so we can build a 4-month MoM ladder (monthly[]) for
    // data.js's MAX-MoM growth model. sales7/15/30/60 stay byte-identical.
    if (ageDays < 0 || ageDays > 120) continue;
    for (const col of Object.keys(colMap)) {
      const { code, multiplier } = colMap[col];
      const val = num(r[col]) * multiplier;
      if (!byCode[code])             byCode[code] = {};
      // D5: sales14d added (trailing 14d) alongside the existing buckets so
      // data.js can compute a 14-day velocity for MAX(30d,14d).
      if (!byCode[code][channel])    byCode[code][channel] = { sales7d: 0, sales14d: 0, sales15d: 0, sales30d: 0, sales60d: 0, sales90d: 0, sales120d: 0 };
      const tgt = byCode[code][channel];
      if (ageDays <=  7) tgt.sales7d  += val;
      if (ageDays <= 14) tgt.sales14d += val;
      if (ageDays <= 15) tgt.sales15d += val;
      if (ageDays <= 30) tgt.sales30d += val;
      if (ageDays <= 60) tgt.sales60d += val;
      if (ageDays <= 90)  tgt.sales90d  += val;
      if (ageDays <= 120) tgt.sales120d += val;
    }
  }

  // Finalize each SKU for this channel: dailyOut, growth (MoM cur30 vs prior30),
  // and a `monthly` ladder for the MAX-MoM growth model in data.js.
  for (const code of Object.keys(byCode)) {
    const t = byCode[code][channel];
    if (!t) continue;
    t.dailyOut = t.sales30d / 30;
    const prior30 = Math.max(0, t.sales60d - t.sales30d);
    if (prior30 > 0)             t.growth = Math.max(-100, Math.min(200, ((t.sales30d - prior30) / prior30) * 100));
    else if (t.sales30d > 0)     t.growth = 200;
    else if (prior30 === 0 && t.sales30d === 0) t.growth = null;
    else                         t.growth = -100;
    // monthly = trailing 30-day sales sums, MOST-RECENT FIRST (m0..m3), derived
    // from the cumulative aging buckets. R-NEGATIVES: differences are NOT
    // clamped — net returns legitimately reduce a month's total. SAFE FALLBACK:
    // any missing bucket falls back to 0 so this can never throw / emit NaN.
    const s30  = Number.isFinite(t.sales30d)  ? t.sales30d  : 0;
    const s60  = Number.isFinite(t.sales60d)  ? t.sales60d  : 0;
    const s90  = Number.isFinite(t.sales90d)  ? t.sales90d  : 0;
    const s120 = Number.isFinite(t.sales120d) ? t.sales120d : 0;
    t.monthly = [s30, s60 - s30, s90 - s60, s120 - s90];
    // Scratch accumulators for the >60d buckets — keep the emitted shape lean
    // and identical to before aside from the new `monthly` field.
    delete t.sales90d;
    delete t.sales120d;
  }
  return true;
}

export async function parseAgencyChannelSales(file, opts = {}) {
  const isExcel = /\.(xlsx|xls)$/i.test(file.name);
  // D2 per-sheet cutoff — applied to the daily-log path (the only agency shape
  // with dated rows). WIDE/LONG shapes carry pre-aggregated 30d/60d totals with
  // no row dates, so a cutoff is not applicable there.
  const cutoff = opts.dateCutoff ? new Date(opts.dateCutoff) : null;

  // ── Try DAILY-LOG (founder's actual format) first when it's an xlsx
  //    workbook with channel-named tabs. Each tab is processed
  //    independently — Amazon from AMZ Categorywise, Blinkit from
  //    Blinkit Categorywise, Flipkart from FK Categorywise.
  if (isExcel) {
    const wb = await fileToWorkbook(file);
    const channelTabs = wb.SheetNames
      .map(name => ({ name, channel: detectAgencyChannel(name) }))
      .filter(x => x.channel);
    if (channelTabs.length > 0) {
      const byCode = {};
      const processedTabs = [];
      for (const { name, channel } of channelTabs) {
        const ok = processAgencyDailyLogTab(wb.Sheets[name], channel, byCode, cutoff);
        if (ok) processedTabs.push({ name, channel });
      }
      if (processedTabs.length > 0) {
        return { byCode, shape: "daily-log", processedTabs };
      }
      // Fall through to WIDE/LONG on first sheet if no daily-log tabs matched
    }
  }

  let rows;
  if (isExcel) {
    const wb = await fileToWorkbook(file);
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
  } else {
    const txt = await fileToText(file);
    // Auto-detect TSV vs CSV
    const sep = txt.split("\n", 1)[0].includes("\t") ? "\t" : ",";
    if (sep === "\t") {
      const lines = txt.split(/\r?\n/).filter(l => l.length);
      const headers = lines[0].split("\t");
      rows = lines.slice(1).map(line => {
        const cells = line.split("\t");
        const o = {}; headers.forEach((h, i) => { o[h] = cells[i] ?? ""; });
        return o;
      });
    } else {
      rows = parseCsv(txt);
    }
  }
  if (!rows.length) return { byCode: {}, shape: "empty" };

  // Detect shape — long format has a "Channel" column; wide has per-channel headers.
  const headers = Object.keys(rows[0]);
  const lc = (s) => String(s || "").toLowerCase();
  const findCol = (matcher) => headers.find(h => matcher(lc(h)));

  // Tolerant SKU column finder — try every plausible name + Amazon MSKU.
  const skuCol = findCol(h => /^sku$|sku.*code|merchant.*sku|msku|item.*code|product.*sku|^code$/.test(h));
  if (!skuCol) {
    throw new Error(`Could not find a SKU column. Expected one of: SKU, MSKU, Item Code, Product SKU. Headers seen: ${headers.join(", ")}`);
  }

  // Tolerant SKU→canonical mapper — try every cross-reference at once
  const toCanonical = (raw) => {
    const s = String(raw || "").trim();
    return byAmzMsku[s.replace(/_MP$/i, "")]
        || byFkSku[s]
        || byShpSku[s]
        || (CODE_MAP[s] ? s : null);                  // already canonical?
  };

  const channelCol = findCol(h => /^channel$|marketplace|platform/.test(h));
  const isLong = !!channelCol;
  const byCode = {};

  if (isLong) {
    const salesCol  = findCol(h => /sales.*30|30.*sales|units.*30|qty.*30|net.*items|sales$/.test(h));
    const growthCol = findCol(h => /growth|mom|m-o-m/.test(h));
    for (const r of rows) {
      const code = toCanonical(r[skuCol]); if (!code) continue;
      const ch   = lc(r[channelCol]);
      const key  = /amaz|amz|fba/.test(ch)        ? "amazon"
                 : /flip|fk/.test(ch)             ? "flipkart"
                 : /blink|quick/.test(ch)         ? "blinkit"
                 : /shop|website|d2c/.test(ch)    ? "shopify"
                 : null;
      if (!key) continue;
      const sales = num(r[salesCol]);
      const growth = growthCol != null ? num(r[growthCol]) : null;
      if (!byCode[code]) byCode[code] = {};
      byCode[code][key] = {
        sales30d: sales,
        dailyOut: sales / 30,
        growth,
      };
    }
    return { byCode, shape: "long" };
  }

  // WIDE shape — one row per SKU, channel columns inline
  const chCols = {
    amazon:   findCol(h => /^amazon$|^amz$|fba$/.test(h)),
    flipkart: findCol(h => /^flip|^fk$|flipkart/.test(h)),
    blinkit:  findCol(h => /^blink|blinkit|quick.*com/.test(h)),
    shopify:  findCol(h => /^shopify|^d2c$|website/.test(h)),
  };
  const growthCols = {
    amazon:   findCol(h => /amazon.*growth|amz.*growth|growth.*amazon/.test(h)),
    flipkart: findCol(h => /flip.*growth|fk.*growth|growth.*flip/.test(h)),
    blinkit:  findCol(h => /blink.*growth|growth.*blink/.test(h)),
    shopify:  findCol(h => /shopify.*growth|d2c.*growth|growth.*shop/.test(h)),
  };
  for (const r of rows) {
    const code = toCanonical(r[skuCol]); if (!code) continue;
    if (!byCode[code]) byCode[code] = {};
    for (const ch of ["amazon", "flipkart", "blinkit", "shopify"]) {
      if (!chCols[ch]) continue;
      const sales = num(r[chCols[ch]]);
      const growth = growthCols[ch] ? num(r[growthCols[ch]]) : null;
      byCode[code][ch] = { sales30d: sales, dailyOut: sales / 30, growth };
    }
  }
  return { byCode, shape: "wide" };
}

// ─── 7. (retired) Nitin's live inventory sheet ──────────────
// The parseNitinSheet wrapper + the 'nitin' upload zone were REMOVED
// (FIX-SPEC V9). The central-warehouse engine (parseCentralWhWorkbook) is the
// single warehouse source; its 72-day movement log must never feed velocity
// (GROUND-TRUTH §3.5 — consumption = SALES, not warehouse movement).

// ─── Dispatcher ──────────────────────────────────────────────
// Every zone accepts every common spreadsheet/text format. The parser
// for the chosen zone still expects its native shape — if a user drops
// the wrong file in a zone, the parser surfaces an error (and Claude's
// format-guard, when wired, suggests the right zone).
//
// amazon-orders was retired from the UI per founder request — bundled
// data still ships the FBA + MCF split, but ongoing uploads come from
// the Warehouse Wise Ledger alone.
const ALL_FORMATS = ".csv,.txt,.tsv,.xlsx,.xls";
export const FILE_TYPES = {
  "amazon-ledger": { label: "Amazon Warehouse Wise Ledger Sheet", accept: ALL_FORMATS, parse: parseAmazonLedger },
  "agency":        { label: "Agency Channel-wise Sales Sheet",    accept: ALL_FORMATS, parse: parseAgencyChannelSales },
  "blinkit":       { label: "Blinkit Feeder-WH Inventory Sheet",  accept: ALL_FORMATS, parse: parseBlinkit },
  "flipkart":      { label: "Flipkart Current Inventory Sheet",   accept: ALL_FORMATS, parse: parseFlipkart },
  "shopify":       { label: "Shopify Website Sales Sheet",        accept: ALL_FORMATS, parse: parseShopify },
  // ⚠️ The legacy 'nitin' (Warehouse Daily Inventory Sheet) zone is RETIRED
  // (FIX-SPEC V9). It was a second, conflicting warehouse source whose 72-day
  // log fed velocity as if it were sales (GROUND-TRUTH §3.5 violation). The
  // central-warehouse engine below is the single warehouse authority.
  // Central Warehouse Workbook zone — ports the offline build-central-wh.cjs
  // engine into the browser (audit baseline + post-audit production/movement
  // roll-forward) so WH numbers are durable per founder decision §8.1.
  "central-wh":    { label: "Central Warehouse Workbook (Audit + Production + Daily Movement)", accept: ALL_FORMATS, parse: (file, opts) => parseCentralWhWorkbook(file, opts) },
};

export async function parseByType(type, file, opts = {}) {
  const def = FILE_TYPES[type];
  if (!def) throw new Error(`Unknown file type: ${type}`);
  return await def.parse(file, opts);
}
