/**
 * import-nitin-sheet.cjs
 *
 * Reads Nitin's live inventory xlsx (founder's daily ops sheet, the format
 * referenced by DATA-005) and emits src/realNitinData.js. Currently parses:
 *
 *   - "warehouse inventory" sheet → central warehouse stock for every FG /
 *     SFG / RM / PKG item (as of 5-May-2026).
 *
 *   - "Daily Movement of FG" sheet → 72 days of per-channel stock-out
 *     (Amazon / Flipkart / Blinkit / Website / Offline / Marketing) per
 *     SKU. Lets us compute REAL multi-day velocities instead of a 1-day
 *     Amazon proxy.
 *
 *   - "Master" sheet → 7-March stock snapshot (older — kept for diffing).
 *
 *   - "Audit 050525" → physical-count audit on 5-May; preserved for QA.
 *
 * Sheet names in this file aren't fixed; the script matches by substring
 * (case-insensitive) so re-runs survive minor renames.
 *
 * Run:  node scripts/import-nitin-sheet.cjs
 * Out:  src/realNitinData.js
 */
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const SRC = path.join(process.env.HOME, "Downloads/Naturesum Live Inventory (1).xlsx");
const OUT = path.join(__dirname, "..", "src", "realNitinData.js");

if (!fs.existsSync(SRC)) {
  console.error("Source file not found:", SRC);
  process.exit(1);
}
const wb = XLSX.readFile(SRC);

// ─── Item-name → SKU code mapping ────────────────────────────
// Nitin's sheet uses long product names that vary slightly across sheets
// (e.g. "SB Berries 250 gm Packed" vs "Pure Sea Buckthorn Dry Berries 250 GM").
// We match by checking multiple substrings against each name.
const SKU_MATCHERS = [
  { code: "NSMP100",   match: (n) => /moringa/i.test(n) && /100/.test(n) },
  { code: "NSMP250",   match: (n) => /moringa/i.test(n) && /250/.test(n) },
  { code: "NSSB100",   match: (n) => /(sb powder|berries powder|sea buckthorn berries pow)/i.test(n) && /100/.test(n) && !/old/i.test(n) },
  { code: "NSSB250",   match: (n) => /(sb powder|berries powder|sea buckthorn berries pow)/i.test(n) && /250/.test(n) },
  { code: "NSSB500",   match: (n) => /(sb powder|berries powder|sea buckthorn berries pow)/i.test(n) && /500/.test(n) && !/old/i.test(n) },
  { code: "NSSBDB100", match: (n) => /(sb berries|dry berries)/i.test(n) && /100/.test(n) && !/juice|powder/i.test(n) },
  { code: "NSSBDB250", match: (n) => /(sb berries|dry berries)/i.test(n) && /250/.test(n) && !/juice|powder/i.test(n) },
  { code: "NSSBDB500", match: (n) => /(sb berries|dry berries)/i.test(n) && /500/.test(n) && !/juice|powder/i.test(n) },
  { code: "NSSBJ300",  match: (n) => /juice/i.test(n) && /300/.test(n) },
  { code: "NSSBJ500",  match: (n) => /juice/i.test(n) && /500/.test(n) },
  { code: "NSSBBO15",  match: (n) => /(face oil|berry oil)/i.test(n) && /15/.test(n) },
  { code: "NSSBBO30",  match: (n) => /(face oil|berry oil)/i.test(n) && /30/.test(n) && !/tea bag/i.test(n) },
  { code: "NSJO100",   match: (n) => /jatamansi/i.test(n) },
  { code: "NSACDT30",  match: (n) => /(ac tea|acacia)/i.test(n) },
];
function nameToCode(itemName) {
  const n = String(itemName || "").trim();
  if (!n) return null;
  const hit = SKU_MATCHERS.find(m => m.match(n));
  return hit ? hit.code : null;
}

// ─── Item-name → component refCode (for SFG/RM/PKG) ──────────
// These map Nitin's PKG/RM/SFG line items to the refCodes the dashboard
// already uses inside SKU_RECIPE / ITEM_QTY. Anything that doesn't map
// is preserved as `unmapped` in the output for visibility.
const COMPONENT_MATCHERS = [
  // Raw materials
  { ref: "NSSBPR",   match: (n) => /sb powder \(raw\)|sea buckthorn powder \(raw\)/i.test(n) },
  { ref: "NSSBJPLP", match: (n) => /juice pulp|sb juice pulp/i.test(n) },
  { ref: "NSSBDBR",  match: (n) => /sb dry berries.*raw|sea buckthorn dry berries.*raw/i.test(n) },
  { ref: "NSMLPR",   match: (n) => /moringa leaves powder/i.test(n) },
  // Semi-FG (filled)
  { ref: "NSACDTSFG",  match: (n) => /ac tea pouches.*filled/i.test(n) },
  { ref: "NSJOSFG",    match: (n) => /jatamansi.*filled bott/i.test(n) },
  { ref: "NSACDTSFG2", match: (n) => /ac tea dip sachets.*filled/i.test(n) },
  // Packaging — sea buckthorn dry-berry pouches
  { ref: "NSPKGDBP100", match: (n) => /dry berries empty pouches.*100/i.test(n) },
  { ref: "NSPKGDBP250", match: (n) => /dry berries empty pouches.*250/i.test(n) },
  { ref: "NSPKGDBP500", match: (n) => /dry berries empty pouches.*500/i.test(n) },
  // SB Powder pouches
  { ref: "NSPKGSBP100", match: (n) => /sb powder empty pouches.*100/i.test(n) },
  { ref: "NSPKGSBP250", match: (n) => /sb powder empty pouches.*250/i.test(n) },
  { ref: "NSPKGSBP500", match: (n) => /sb powder empty pouches.*500/i.test(n) },
  // Moringa pouches — derive from carton box quantities when no dedicated pouch row
  { ref: "NSPKGMP100", match: (n) => /100 gram packaging carton/i.test(n) },
  { ref: "NSPKGMP250", match: (n) => /250 gm packaging carton/i.test(n) },
  // Carton boxes (shared)
  { ref: "NSPKGCB100", match: (n) => /100 gram packaging carton/i.test(n) },
  { ref: "NSPKGCB250", match: (n) => /250 gm packaging carton/i.test(n) },
  // Juice bottles + pouches
  { ref: "NSPKGJB300",   match: (n) => /small air pouch.*juice.*300/i.test(n) },
  { ref: "NSPKGJB500",   match: (n) => /large air pouch.*juice.*500/i.test(n) },
];

// ─── Helpers ─────────────────────────────────────────────────
const num = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  // Handle "36-50" style entries: take the lower bound.
  const s = String(v || "").trim();
  if (!s || /^na$/i.test(s)) return 0;
  if (s.includes("-")) {
    const [a] = s.split("-");
    const n = Number(a);
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(s.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
function findSheet(substr) {
  const name = wb.SheetNames.find(n => n.toLowerCase().includes(substr.toLowerCase()));
  return name ? wb.Sheets[name] : null;
}

// ─── 1. Central warehouse stock (from "warehouse inventory") ─
function parseWarehouseInventory() {
  console.log("\n── WAREHOUSE INVENTORY ──");
  const ws = findSheet("warehouse inventory");
  if (!ws) return { fg: {}, components: {}, asOf: null, unmapped: [] };
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  const asOf = String(rows[1]?.[0] || "").replace(/^as of\s*/i, "").trim() || null;
  const fg = {};
  const components = {};
  const unmapped = [];
  // Scan all rows: each line item has name at col 1, qty at col 2
  for (const r of rows) {
    const name = String(r[1] || "").trim();
    const qty  = num(r[2]);
    if (!name || /master|as of|s\.no|finished goods|semi|raw materials|packaging/i.test(name) && qty === 0) continue;
    if (!name) continue;
    const code = nameToCode(name);
    if (code) {
      // FG line — accumulate (some SKUs have "Old" duplicate rows)
      fg[code] = (fg[code] || 0) + qty;
      continue;
    }
    // Try component matching
    const comp = COMPONENT_MATCHERS.find(c => c.match(name));
    if (comp) {
      components[comp.ref] = (components[comp.ref] || 0) + qty;
      continue;
    }
    // Skip metadata / asset rows (laptop, ac unit, etc.)
    if (qty > 0 && !/sealing|heat gun|tape|drum|ac unit|laptop|printer|scanner|table|bench|chair|equipment|machine/i.test(name)) {
      unmapped.push({ name, qty });
    }
  }
  console.log(`  as-of: ${asOf}`);
  console.log(`  FG mapped: ${Object.keys(fg).length}`);
  for (const [k, v] of Object.entries(fg)) console.log(`    ${k.padEnd(10)} ${v}`);
  console.log(`  components mapped: ${Object.keys(components).length}`);
  if (unmapped.length) console.log(`  unmapped (won't override): ${unmapped.map(u => u.name).join(" | ")}`);
  return { fg, components, asOf, unmapped };
}

// ─── 2. Daily Movement of FG → multi-day per-channel sales ──
// The sheet is organised as repeating 16-row blocks per day:
//   Row 0:    "On D-M-Y" | "Stock Out" | … | "Stock In" | …
//   Row 1:    Item Name | Amazon | Flipkart | Blinkit | Website | Offline | Marketing | (Stock In: same 6)
//   Rows 2-15: 14 SKUs in fixed order, one per row, with channel volumes
//   Row 16:   blank or next date marker
//
// Net sales per channel per day = StockOut - StockIn (returns/restock).
function parseDailyMovement() {
  console.log("\n── DAILY MOVEMENT OF FG ──");
  const ws = findSheet("daily movement");
  if (!ws) return { byCode: {}, days: 0 };
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  // Channel columns: cols 1-6 = stock OUT (amz/fk/blk/web/off/mkt), cols 7-12 = stock IN
  const OUT = { amazon: 1, flipkart: 2, blinkit: 3, website: 4, offline: 5, marketing: 6 };
  const IN  = { amazon: 7, flipkart: 8, blinkit: 9, website: 10, offline: 11, marketing: 12 };
  // Walk row-by-row, finding "On D-M-Y" markers
  const byCode = {};
  let curDate = null;
  let dayCount = 0;
  for (let i = 0; i < rows.length; i++) {
    const first = String(rows[i][0] || "");
    if (/^on \d/i.test(first)) {
      // Date header — capture for tagging the following rows
      curDate = first.replace(/^on\s*/i, "").trim();
      dayCount++;
      continue;
    }
    // Item rows: skip header rows that say "Item Name"
    if (/^item name/i.test(first)) continue;
    const code = nameToCode(first);
    if (!code || !curDate) continue;
    if (!byCode[code]) byCode[code] = { byChannel: {}, days: new Set() };
    for (const ch of Object.keys(OUT)) {
      const out = num(rows[i][OUT[ch]]);
      const inn = num(rows[i][IN[ch]]);
      const net = out - inn; // net out-of-stock (sales minus returns)
      if (!byCode[code].byChannel[ch]) byCode[code].byChannel[ch] = { totalOut: 0, totalIn: 0, totalNet: 0 };
      byCode[code].byChannel[ch].totalOut += out;
      byCode[code].byChannel[ch].totalIn  += inn;
      byCode[code].byChannel[ch].totalNet += net;
    }
    byCode[code].days.add(curDate);
  }
  // Convert sets to counts + compute daily averages
  const out = {};
  for (const [code, d] of Object.entries(byCode)) {
    const days = d.days.size;
    const channels = {};
    for (const [ch, v] of Object.entries(d.byChannel)) {
      channels[ch] = {
        totalOut: v.totalOut,
        totalNet: v.totalNet,
        dailyOut: days > 0 ? v.totalOut / days : 0,
        dailyNet: days > 0 ? v.totalNet / days : 0,
      };
    }
    out[code] = { days, channels };
  }
  console.log(`  ${dayCount} date sections found, ${Object.keys(out).length} SKUs mapped.`);
  for (const [code, d] of Object.entries(out)) {
    const amz = (d.channels.amazon?.dailyOut || 0).toFixed(1);
    const fk  = (d.channels.flipkart?.dailyOut || 0).toFixed(1);
    const blk = (d.channels.blinkit?.dailyOut || 0).toFixed(1);
    const web = (d.channels.website?.dailyOut || 0).toFixed(1);
    const off = (d.channels.offline?.dailyOut || 0).toFixed(1);
    const mkt = (d.channels.marketing?.dailyOut || 0).toFixed(1);
    console.log(`    ${code.padEnd(10)} (${d.days}d) → amz=${amz} fk=${fk} blk=${blk} web=${web} off=${off} mkt=${mkt}`);
  }
  return { byCode: out, days: dayCount };
}

// ─── 3. Master + Audit (older snapshots — preserved) ─────────
function parseSnapshot(sheetSubstr) {
  const ws = findSheet(sheetSubstr);
  if (!ws) return null;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  const asOf = String(rows[1]?.[0] || "").replace(/^as of\s*/i, "").trim() || null;
  const fg = {};
  for (const r of rows) {
    const name = String(r[1] || "").trim();
    const qty  = num(r[2]);
    if (!name) continue;
    const code = nameToCode(name);
    if (code) fg[code] = (fg[code] || 0) + qty;
  }
  return { asOf, fg };
}

// ─── Emit ────────────────────────────────────────────────────
const inventoryNow = parseWarehouseInventory();
const movement     = parseDailyMovement();
const masterMar7   = parseSnapshot("master");
const auditMay5    = parseSnapshot("audit");

const body = `// AUTO-GENERATED from scripts/import-nitin-sheet.cjs
// Source: ~/Downloads/Naturesum Live Inventory (1).xlsx — DATA-005 sample.
// Re-run \`node scripts/import-nitin-sheet.cjs\` after dropping a fresh sheet.

export const NITIN_DATA = {
  warehouseInventory: ${JSON.stringify(inventoryNow, null, 2)},
  dailyMovement:      ${JSON.stringify(movement, null, 2)},
  masterMar7:         ${JSON.stringify(masterMar7, null, 2)},
  auditMay5:          ${JSON.stringify(auditMay5, null, 2)},
};
`;
fs.writeFileSync(OUT, body, "utf8");
console.log(`\n✓ wrote ${OUT}`);
