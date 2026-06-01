/**
 * import-marketplace-data.cjs
 *
 * Reads the four real marketplace data exports and emits one consolidated
 * JS module at src/realMarketplaceData.js. The dashboard consumes it to
 * replace stub numbers with real ones — wherever a SKU is missing from the
 * import, the stub fallback in data.js stays in place.
 *
 * Inputs (all expected in ~/Downloads):
 *   1. NS - inventory - AmazonWarehouseWiseLedger.csv         (FBA per-FC daily ledger)
 *   2. NS - inventory - BlinkitInventoryDataFeederWarehouseWise.xlsx
 *   3. NS - inventory - FlipkartCurrentInventory.csv
 *   4. NS - inventory - Website Sales of all SKUs.csv         (Shopify daily sales)
 *
 * Run:   node scripts/import-marketplace-data.cjs
 * Out:   src/realMarketplaceData.js
 *
 * SKU mapping — our canonical code ↔ Amazon MSKU / Flipkart SKU / Shopify SKU / Blinkit title
 * lives in CODE_MAP below. Edit when a new SKU launches anywhere.
 */
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const HOME = process.env.HOME;
const SRC = {
  amazon:  path.join(HOME, "Downloads/NS - inventory - AmazonWarehouseWiseLedger.csv"),
  blinkit: path.join(HOME, "Downloads/NS - inventory - BlinkitInventoryDataFeederWarehouseWise.xlsx"),
  flipkart:path.join(HOME, "Downloads/NS - inventory - FlipkartCurrentInventory.csv"),
  shopify: path.join(HOME, "Downloads/NS - inventory - Website Sales of all SKUs.csv"),
};
const OUT  = path.join(__dirname, "..", "src", "realMarketplaceData.js");

// ─── Canonical SKU map ────────────────────────────────────────
// our code (data.js) → { name, variant, amzMsku, fkSku, shpSku, blkTitleKey }
// blkTitleKey is a substring used to match the long Blinkit product titles
// (Blinkit titles vary: "Naturesum Sea Buckthorn Daily Nutrition Supplement
// Powder" maps to our Sea Buckthorn POWDER 100g).
const CODE_MAP = {
  NSSBDB100: { amz: "X0029J4T23", amzMsku: "NSSBDB100g", fk: "NSSBDB100g",  shp: "NS-SBDR-100", blkTitleKey: "Himalayan Sea Buckthorn Dry Berries", blkVariant: "100 g" },
  NSSBDB250: { amz: "X0025NUJDB", amzMsku: "NSSBDB250g", fk: "NSSBDB250g",  shp: "NS-SBDR-250", blkTitleKey: "Sea Buckthorn Dry Berries",           blkVariant: "250 g" },
  NSSBDB500: { amz: "X002E5YNFP", amzMsku: "NSSBDB500g", fk: "NSSBDB500g",  shp: "NS-SBDR-500", blkTitleKey: "Himalayan Sea Buckthorn Dry Berries", blkVariant: "500 g" },
  NSSB100:   { amz: "X002EFS34H", amzMsku: "NSSBP100",   fk: "NSSBP100",    shp: "NS-SBP-100",  blkTitleKey: "Daily Nutrition Supplement Powder",   blkVariant: "100 g" },
  NSSB250:   { amz: "X002EFS2ZR", amzMsku: "NSSBP250",   fk: "NSSBP250",    shp: "NS-SBP-250",  blkTitleKey: "Sea Buckthorn Berries Powder",        blkVariant: "250 g" },
  NSSB500:   { amz: "X002HTJ1X7", amzMsku: "NSSBP500",   fk: "NSSBP500",    shp: "NS-SBP-500",  blkTitleKey: "Daily Nutrition Supplement",          blkVariant: "500 g" },
  NSSBJ300:  { amz: "X002JC4PQ5", amzMsku: "NSSBJ300ML", fk: "NSSBJ300ML",  shp: "NS-SBJ-300",  blkTitleKey: "Berry Juice Concentrate",             blkVariant: "300 ml" },
  NSSBJ500:  { amz: "X002JBTVHJ", amzMsku: "NSSBJ500ML", fk: "NSSBJ500ML",  shp: "NS-SBJ-500",  blkTitleKey: null }, // not on Blinkit yet
  NSMP100:   { amz: "X002L3VQ41", amzMsku: "NSMP100",    fk: "NSMP100",     shp: "NSMP100",     blkTitleKey: null },
  NSMP250:   { amz: "X002L3WEBP", amzMsku: "NSMP250",    fk: "NSMP250",     shp: "NSMP250",     blkTitleKey: null },
  NSJO100:   { amz: "X0025NUJDB_HO", amzMsku: "NSJ&RHO100ML", fk: "NSJ&RHO100ML", shp: "NS-HO-JT-100", blkTitleKey: null },
  NSACDT30:  { amz: null,        amzMsku: "DI-TE-1-A",   fk: "DI-TE-1-A",   shp: "DI-TE-1-A",   blkTitleKey: "Diabetes Care Tea",                   blkVariant: "30 pcs" },
  NSSBBO15:  { amz: null, amzMsku: null,            fk: null,        shp: null,          blkTitleKey: null }, // not live on any marketplace
  NSSBBO30:  { amz: null, amzMsku: null,            fk: null,        shp: "NS-SB-030",   blkTitleKey: null },
};

// Reverse lookup tables
function buildLookups() {
  const byAmzMsku  = {};
  const byFkSku    = {};
  const byShpSku   = {};
  const blkMatches = []; // [{ titleKey, variant, code }]
  for (const [code, m] of Object.entries(CODE_MAP)) {
    if (m.amzMsku) byAmzMsku[m.amzMsku] = code;
    if (m.fk)      byFkSku[m.fk.trim()] = code;
    if (m.shp)     byShpSku[m.shp]      = code;
    if (m.blkTitleKey) blkMatches.push({ titleKey: m.blkTitleKey, variant: m.blkVariant, code });
  }
  return { byAmzMsku, byFkSku, byShpSku, blkMatches };
}

// ─── Helpers ──────────────────────────────────────────────────
function parseCsv(filepath) {
  const txt = fs.readFileSync(filepath, "utf8").replace(/^﻿/, "");
  const lines = txt.split(/\r?\n/).filter(l => l.length);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const cells = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ""; });
    return row;
  });
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
const num = (v) => {
  const n = Number(String(v || "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// ─── 1. Amazon FBA ledger ─────────────────────────────────────
function parseAmazon(lookups) {
  console.log("\n── AMAZON ──");
  const rows = parseCsv(SRC.amazon);
  console.log(`  rows: ${rows.length}`);
  const byCode = {};
  let unmapped = new Set();
  for (const r of rows) {
    const msku = r["MSKU"];
    const code = lookups.byAmzMsku[msku];
    if (!code) { if (msku) unmapped.add(msku); continue; }
    const disp = r["Disposition"];
    const loc  = r["Location"];
    const endBal = num(r["Ending Warehouse Balance"]);
    const shipped = -num(r["Customer Shipments"]); // outbound shipments are negative
    const damaged = -num(r["Damaged"]);            // disposition = WAREHOUSE_DAMAGED etc.
    if (!byCode[code]) byCode[code] = { byFc: {}, totalSellable: 0, totalDamaged: 0, totalShippedToday: 0 };
    const fc = byCode[code].byFc[loc] || { sellable: 0, damaged: 0, shipped: 0 };
    if (disp === "SELLABLE") fc.sellable += endBal;
    else fc.damaged += endBal;
    fc.shipped += shipped;
    byCode[code].byFc[loc] = fc;
    if (disp === "SELLABLE") byCode[code].totalSellable += endBal;
    else byCode[code].totalDamaged += endBal;
    // NB: Amazon ledger we ingest is a SINGLE day's data, so `shipped` is
    // one day's customer shipments. That's also the daily-velocity proxy.
    byCode[code].totalShippedToday += shipped;
  }
  console.log(`  mapped SKUs: ${Object.keys(byCode).length}`);
  if (unmapped.size) console.log(`  unmapped MSKUs (won't appear): ${[...unmapped].join(", ")}`);
  for (const [code, d] of Object.entries(byCode)) {
    console.log(`    ${code.padEnd(10)} → ${Object.keys(d.byFc).length.toString().padStart(2)} FCs, sellable=${d.totalSellable.toString().padStart(4)}, damaged=${d.totalDamaged.toString().padStart(3)}`);
  }
  return byCode;
}

// ─── 2. Blinkit feeder-WH ─────────────────────────────────────
function parseBlinkit(lookups) {
  console.log("\n── BLINKIT ──");
  const wb = XLSX.readFile(SRC.blinkit);
  const ws = wb.Sheets["Stock On Hand"];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  // Header at row 2 (0-indexed)
  const dataRows = rows.slice(3);
  console.log(`  rows: ${dataRows.length}`);
  const byCode = {};
  const unmapped = new Set();
  for (const r of dataRows) {
    const itemName = String(r[1] || "");
    const uom      = String(r[4] || "");
    if (!itemName) continue;
    // Match by titleKey substring + matching variant
    const match = lookups.blkMatches.find(m =>
      itemName.toLowerCase().includes(m.titleKey.toLowerCase()) &&
      uom === m.variant
    );
    if (!match) { unmapped.add(`${itemName} (${uom})`); continue; }
    const code = match.code;
    const whName  = String(r[6] || "");
    const sellable = num(r[10]);
    const damaged  = num(r[15]);
    const lost     = num(r[16]);
    const sales7d  = num(r[19]);
    const sales15d = num(r[20]);
    const sales30d = num(r[21]);
    if (!byCode[code]) byCode[code] = { byWh: {}, totalSellable: 0, totalDamaged: 0, totalSales30d: 0, everLaunched: [] };
    byCode[code].byWh[whName] = { sellable, damaged, lost, sales7d, sales15d, sales30d };
    byCode[code].everLaunched.push(whName);
    byCode[code].totalSellable += sellable;
    byCode[code].totalDamaged  += damaged + lost;
    byCode[code].totalSales30d += sales30d;
  }
  console.log(`  mapped SKUs: ${Object.keys(byCode).length}`);
  if (unmapped.size) console.log(`  unmapped Blinkit titles: ${[...unmapped].join("; ")}`);
  for (const [code, d] of Object.entries(byCode)) {
    console.log(`    ${code.padEnd(10)} → ${d.everLaunched.length.toString().padStart(2)} WHs, sellable=${d.totalSellable.toString().padStart(4)}, 30d sales=${d.totalSales30d.toString().padStart(4)}`);
  }
  return byCode;
}

// ─── 3. Flipkart ──────────────────────────────────────────────
function parseFlipkart(lookups) {
  console.log("\n── FLIPKART ──");
  const rows = parseCsv(SRC.flipkart);
  console.log(`  rows: ${rows.length}`);
  const byCode = {};
  const unmapped = new Set();
  for (const r of rows) {
    const sku = String(r["SKU"] || "").trim();
    const code = lookups.byFkSku[sku];
    if (!code) { if (sku) unmapped.add(sku); continue; }
    byCode[code] = {
      warehouseId:    r["Warehouse Id"],
      sellingPrice:   num(r["Flipkart Selling Price"]),
      live:           num(r["Live on Website"]),
      sales7d:        num(r["Sales 7D"]),
      sales14d:       num(r["Sales 14D"]),
      sales30d:       num(r["Sales 30D"]),
      sales60d:       num(r["Sales 60D"]),
      sales90d:       num(r["Sales 90D"]),
      reservedOrders: num(r["Reserved for Orders and Recalls"]),
      reservedInt:    num(r["Reserved for Internal Processing"]),
      damaged:        num(r["Damaged"]),
      transferIncoming: num(r["B2B Receiving"]) + num(r["Transfers Receiving"]),
      isFAssured:     String(r["F Assured Badge"] || "").toLowerCase() === "yes",
      fulfilmentType: r["Fulfilment Type"],
    };
  }
  console.log(`  mapped SKUs: ${Object.keys(byCode).length}`);
  if (unmapped.size) console.log(`  unmapped Flipkart SKUs: ${[...unmapped].join(", ")}`);
  for (const [code, d] of Object.entries(byCode)) {
    console.log(`    ${code.padEnd(10)} → live=${d.live.toString().padStart(4)}, 30d=${d.sales30d.toString().padStart(4)}, price=₹${d.sellingPrice}, F-Assured=${d.isFAssured}`);
  }
  return byCode;
}

// ─── 4. Shopify website sales ─────────────────────────────────
function parseShopify(lookups) {
  console.log("\n── SHOPIFY ──");
  const rows = parseCsv(SRC.shopify);
  console.log(`  rows: ${rows.length}`);
  const byCode = {};
  const unmapped = new Set();
  // Sum per-SKU sales by 30d / 60d / 90d windows from last available date
  const dates = [...new Set(rows.map(r => r["Day"]).filter(Boolean))].sort();
  const lastDate = dates[dates.length - 1];
  const lastTs = new Date(lastDate).getTime();
  for (const r of rows) {
    const sku = r["Product variant SKU"];
    if (!sku) continue;
    const code = lookups.byShpSku[sku];
    if (!code) { unmapped.add(sku); continue; }
    const day = new Date(r["Day"]).getTime();
    const ageDays = (lastTs - day) / (1000 * 60 * 60 * 24);
    const units = num(r["Net items sold"]);
    if (!byCode[code]) byCode[code] = { sales7d: 0, sales30d: 0, sales60d: 0, sales90d: 0 };
    if (ageDays <= 7)  byCode[code].sales7d  += units;
    if (ageDays <= 30) byCode[code].sales30d += units;
    if (ageDays <= 60) byCode[code].sales60d += units;
    if (ageDays <= 90) byCode[code].sales90d += units;
  }
  console.log(`  date range: ${dates[0]} → ${lastDate} (${dates.length} days)`);
  console.log(`  mapped SKUs: ${Object.keys(byCode).length}`);
  if (unmapped.size) console.log(`  unmapped Shopify SKUs: ${[...unmapped].join(", ")}`);
  for (const [code, d] of Object.entries(byCode)) {
    console.log(`    ${code.padEnd(10)} → 7d=${d.sales7d.toString().padStart(3)}, 30d=${d.sales30d.toString().padStart(4)}, 90d=${d.sales90d.toString().padStart(4)}`);
  }
  return { byCode, dateRange: { first: dates[0], last: lastDate, days: dates.length } };
}

// ─── Emit ─────────────────────────────────────────────────────
function emit({ amazon, blinkit, flipkart, shopify }) {
  const stamp = "2026-05-30"; // file generation date — what the data represents
  const codes = new Set([...Object.keys(amazon), ...Object.keys(blinkit), ...Object.keys(flipkart), ...Object.keys(shopify.byCode)]);
  const out = {};
  for (const code of codes) {
    out[code] = {
      amazon:  amazon[code]  || null,
      blinkit: blinkit[code] || null,
      flipkart:flipkart[code]|| null,
      shopify: shopify.byCode[code] || null,
    };
  }
  const body = `// AUTO-GENERATED from scripts/import-marketplace-data.cjs
// Source files: Amazon ledger, Blinkit feeder-WH xlsx, Flipkart inventory, Shopify website sales
// Snapshot date: ${stamp}
// Re-run \`node scripts/import-marketplace-data.cjs\` after dropping fresh exports into ~/Downloads.

export const REAL_DATA_SNAPSHOT_DATE = "${stamp}";
export const SHOPIFY_DATE_RANGE = ${JSON.stringify(shopify.dateRange)};

export const REAL_MARKETPLACE_DATA = ${JSON.stringify(out, null, 2)};
`;
  fs.writeFileSync(OUT, body, "utf8");
  console.log(`\n✓ wrote ${OUT}`);
  console.log(`  ${Object.keys(out).length} SKUs covered`);
}

// ─── Main ─────────────────────────────────────────────────────
const lookups = buildLookups();
const amazon  = parseAmazon(lookups);
const blinkit = parseBlinkit(lookups);
const flipkart= parseFlipkart(lookups);
const shopify = parseShopify(lookups);
emit({ amazon, blinkit, flipkart, shopify });
