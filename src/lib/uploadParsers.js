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

// ─── 4. Flipkart current inventory (CSV) ────────────────────
export async function parseFlipkart(file, _opts = {}) {
  const txt = await fileToText(file);
  const rows = parseCsv(txt);
  const byCode = {};
  for (const r of rows) {
    const sku = String(r["SKU"] || "").trim();
    const code = byFkSku[sku];
    if (!code) continue;
    byCode[code] = {
      warehouseId: r["Warehouse Id"],
      sellingPrice: num(r["Flipkart Selling Price"]),
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
      isFAssured: String(r["F Assured Badge"] || "").toLowerCase() === "yes",
      fulfilmentType: r["Fulfilment Type"],
    };
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
    if (!byCode[code]) byCode[code] = { sales7d: 0, sales30d: 0, sales60d: 0, sales90d: 0 };
    if (ageDays <= 7)  byCode[code].sales7d  += units;
    if (ageDays <= 30) byCode[code].sales30d += units;
    if (ageDays <= 60) byCode[code].sales60d += units;
    if (ageDays <= 90) byCode[code].sales90d += units;
  }
  return { byCode, dateRange: { first: dates[0], last: lastDate, days: dates.length } };
}

// ─── 6. Nitin's live inventory sheet (xlsx) ─────────────────
// Reuses the parseInventoryFile.js Nitin parser. Wrap it here so the
// dispatcher has a single signature.
export async function parseNitinSheet(file, _opts = {}) {
  const { parseInventoryFile } = await import("./parseInventoryFile.js");
  const result = await parseInventoryFile(file);
  return result; // { fg, semiFg, raw, pkg, velocity, dataAsOf, ... }
}

// ─── Dispatcher ──────────────────────────────────────────────
export const FILE_TYPES = {
  "amazon-ledger":  { label: "Amazon FBA inventory ledger", accept: ".csv,.txt", parse: parseAmazonLedger },
  "amazon-orders":  { label: "Amazon Manage Orders (30-day)", accept: ".txt,.tsv,.csv", parse: parseAmazonOrders },
  "blinkit":        { label: "Blinkit feeder-WH inventory", accept: ".xlsx,.xls", parse: parseBlinkit },
  "flipkart":       { label: "Flipkart current inventory", accept: ".csv", parse: parseFlipkart },
  "shopify":        { label: "Shopify website sales", accept: ".csv", parse: parseShopify },
  "nitin":          { label: "Nitin's live inventory sheet", accept: ".xlsx,.xls", parse: parseNitinSheet },
};

export async function parseByType(type, file, opts = {}) {
  const def = FILE_TYPES[type];
  if (!def) throw new Error(`Unknown file type: ${type}`);
  return await def.parse(file, opts);
}
