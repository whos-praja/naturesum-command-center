/**
 * Update the NatureSum Command Center Tracker xlsx to reflect what's
 * actually shipped to production. Reads the original from Downloads,
 * writes a new file in the same folder with " - Updated <date>" suffix.
 *
 * Run: cd ~/naturesum-command-center && node scripts/update-tracker.cjs
 *
 * What it does:
 *   1. Tracking sheet — flips Status / Sprint / Notes for items shipped
 *      in commits 3a06aa9 (Sprint 1) and b71ac8b (Sprint 2)
 *   2. Tracking sheet — flips Status from DECISION-BLOCKED → READY for
 *      items whose blocking decisions are now answered
 *   3. Tracking sheet — appends LIB-001 and DISPLAY-001 cross-cutting
 *      items that emerged during Sprint 2
 *   4. Decisions sheet — fills the Decided column for RUN-001-D1,
 *      AMZ-001-D1, AMZ-001-D2
 *   5. Data Requests sheet — sets Date requested = 30-May-2026 on all
 *      seven rows (none received yet)
 *   6. Dashboard counts — recomputes DONE / READY / DECISION-BLOCKED
 *      totals (only if those cells contain static numbers, not formulas)
 *
 * Preserves formulas and cell styles via { cellFormula: true,
 * cellStyles: true } on read/write.
 */
const XLSX = require("xlsx");
const path = require("path");
const fs = require("fs");

// Source: prefer the freshly-updated tracker if it exists, else fall back
// to the original. This lets the script run idempotently on each sprint.
const SRC_CANDIDATES = [
  "/Users/shivamprajapati/Downloads/NatureSum Command Center Tracker - Updated 2026-05-31.xlsx",
  "/Users/shivamprajapati/Downloads/NatureSum Command Center Tracker - Updated 2026-05-30.xlsx",
  "/Users/shivamprajapati/Downloads/NatureSum Command Center Tracker.xlsx",
];
const SRC = SRC_CANDIDATES.find(p => fs.existsSync(p)) || SRC_CANDIDATES[SRC_CANDIDATES.length - 1];
const OUT = "/Users/shivamprajapati/Downloads/NatureSum Command Center Tracker - Updated 2026-05-31.xlsx";

if (!fs.existsSync(SRC)) {
  console.error("Source file not found:", SRC);
  process.exit(1);
}

const wb = XLSX.readFile(SRC, { cellFormula: true, cellStyles: true });

// ─── helpers ────────────────────────────────────────────────────
const colLetter = (n) => {
  // 0-indexed column number → A, B, ..., Z, AA, ...
  let s = "";
  while (n >= 0) { s = String.fromCharCode((n % 26) + 65) + s; n = Math.floor(n / 26) - 1; }
  return s;
};
const addr = (col, row1Based) => `${colLetter(col)}${row1Based}`;

// Update a single cell. If the existing cell has a formula, we preserve it;
// otherwise overwrite with a plain string/number.
function setCell(sheet, address, value) {
  const existing = sheet[address];
  if (existing && existing.f) {
    // Don't overwrite formula cells silently
    console.warn(`  ⚠ skipping ${address} (formula present: =${existing.f})`);
    return;
  }
  sheet[address] = { t: typeof value === "number" ? "n" : "s", v: value };
}

// Find the row (1-based for xlsx addressing) where column `keyCol` (0-based)
// matches `keyValue`. Returns -1 if not found.
function findRow(sheet, range, keyCol, keyValue) {
  const r = XLSX.utils.decode_range(range);
  for (let row = r.s.r; row <= r.e.r; row++) {
    const cell = sheet[addr(keyCol, row + 1)];
    if (cell && String(cell.v).trim() === String(keyValue).trim()) return row + 1;
  }
  return -1;
}

// Extend the sheet's !ref range to include a new row/column if needed.
function extendRange(sheet, row1, col0) {
  const r = XLSX.utils.decode_range(sheet["!ref"] || "A1");
  let dirty = false;
  if (row1 - 1 > r.e.r) { r.e.r = row1 - 1; dirty = true; }
  if (col0 > r.e.c)     { r.e.c = col0;     dirty = true; }
  if (dirty) sheet["!ref"] = XLSX.utils.encode_range(r);
}

// ─── 1. TRACKING sheet — flip Status / Sprint / Notes ──────────
const tracking = wb.Sheets["Tracking"];
if (!tracking) { console.error("No 'Tracking' sheet found"); process.exit(1); }

// Column indices (0-based) per the header row we read:
//   2 = Item Key, 10 = Status, 11 = Blocker, 15 = Sprint, 16 = Notes
const COL = { key: 2, status: 10, blocker: 11, sprint: 15, notes: 16 };

const SHIPPED_NOTE = "Shipped 30-May-2026 (commit %s)";
const TRACKING_UPDATES = [
  // Sprint 1 (3a06aa9) — all DONE
  { key: "SIM-001", status: "DONE", blocker: "None", sprint: "Done", notes: SHIPPED_NOTE.replace("%s", "3a06aa9") },
  { key: "SIM-002", status: "DONE", blocker: "None", sprint: "Done", notes: SHIPPED_NOTE.replace("%s", "3a06aa9") },
  { key: "SIM-003", status: "DONE", blocker: "None", sprint: "Done", notes: SHIPPED_NOTE.replace("%s", "3a06aa9") },
  { key: "SIM-004", status: "DONE", blocker: "None", sprint: "Done", notes: SHIPPED_NOTE.replace("%s", "3a06aa9") },
  { key: "MAT-001", status: "DONE", blocker: "None", sprint: "Done", notes: SHIPPED_NOTE.replace("%s", "3a06aa9") },
  { key: "MAT-002", status: "DONE", blocker: "None", sprint: "Done", notes: SHIPPED_NOTE.replace("%s", "3a06aa9") },
  // Sprint 2 (b71ac8b)
  { key: "RUN-001", status: "DONE", blocker: "None", sprint: "Done", notes: "Shipped 30-May-2026 (b71ac8b). Parallel cascade via lib/runwayCascade.js." },
  { key: "AMZ-001", status: "DONE", blocker: "None", sprint: "Done", notes: "Shipped 30-May-2026 (b71ac8b). Amazon channel = Amazon + Shopify combined." },
  // Sprint 3 (ea83955) — Simulator overhaul
  { key: "SIM-010", status: "DONE", blocker: "None", sprint: "Done", notes: "Per-marketplace velocity inputs — 31-May-2026 (ea83955)" },
  { key: "SIM-011", status: "DONE", blocker: "None", sprint: "Done", notes: "Nested velocity behaviour — 31-May-2026 (ea83955)" },
  { key: "SIM-012", status: "DONE", blocker: "None", sprint: "Done", notes: "Per-marketplace MoM growth inputs — 31-May-2026 (ea83955)" },
  { key: "SIM-013", status: "DONE", blocker: "None", sprint: "Done", notes: "Per-marketplace WH stock inputs — 31-May-2026 (ea83955)" },
  { key: "SIM-015", status: "DONE", blocker: "None", sprint: "Done", notes: "Per-PKG component inputs — 31-May-2026 (ea83955)" },
  { key: "SIM-017", status: "DONE", blocker: "None", sprint: "Done", notes: "Total runway cascade applied in Simulator — 31-May-2026 (ea83955)" },
  { key: "SIM-018", status: "DONE", blocker: "None", sprint: "Done", notes: "AMZ-001 (Amazon + Shopify) applied in Simulator — 31-May-2026 (ea83955)" },
  // Sprint 3 lead-time data wiring (1a0d379)
  { key: "SIM-014", status: "DONE", blocker: "None", sprint: "Done", notes: "Real lead times wired: Amazon 14d / Flipkart 3d / Blinkit 8d — 31-May-2026 (1a0d379)" },
  { key: "SIM-016", status: "DONE", blocker: "None", sprint: "Done", notes: "Per-component lead times: SB raw 50d / Moringa 25d / SFG 20d / packaging 14d — 31-May-2026 (1a0d379)" },
  // Sprint 4 — Blinkit cascade UI (BLK-001 → BLK-005). Sprint 5 swapped real
  // Blinkit data in — STUB badges dropped, real WH names + per-WH velocity.
  { key: "BLK-001", status: "DONE", blocker: "None", sprint: "Done", notes: "Blinkit cell shows feeder-WH OOS counts — real DATA-001 export wired 01-Jun-2026" },
  { key: "BLK-002", status: "DONE", blocker: "None", sprint: "Done", notes: "a/b split — denominator = lifetime launched WHs (real) — 01-Jun-2026" },
  { key: "BLK-003", status: "DONE", blocker: "None", sprint: "Done", notes: "Same Blinkit treatment applied in Runway tab — 01-Jun-2026" },
  { key: "BLK-004", status: "DONE", blocker: "None", sprint: "Done", notes: "Drill modal — per-feeder-WH stock + real 30-day sales → days-of-cover — 01-Jun-2026" },
  { key: "BLK-005", status: "DONE", blocker: "None", sprint: "Done", notes: "Editable amber threshold (default 25, persisted per-SKU in localStorage) — 01-Jun-2026" },
  // DATA-001 satisfied — Blinkit Seller Panel export landed and wired
  { key: "DATA-001", status: "DONE", blocker: "None", sprint: "Done", notes: "Blinkit feeder-WH 'Stock On Hand' export ingested via scripts/import-marketplace-data.cjs — 01-Jun-2026" },
  // Sprint 6 — Amazon cascade UI (AMZ-003 + AMZ-004) — real FBA per-FC data wired
  { key: "AMZ-003", status: "DONE", blocker: "None", sprint: "Done", notes: "Per-FC OOS counts in Amazon cell + drill modal — per-FC stock, customer shipments, damaged disposition — 01-Jun-2026" },
  { key: "AMZ-004", status: "DONE", blocker: "MCF orders still pending (DATA-002 partial)", sprint: "Done", notes: "Velocity decomposition (amz + d2c) in drill modal. MCF orders share will refine when DATA-002 MCF export arrives — 01-Jun-2026" },
  // DATA-002 unblocked AMZ-003 fully; AMZ-004 partial (MCF orders still pending)
  { key: "DATA-002", status: "READY", blocker: "MCF orders report still pending from Amazon", sprint: "Done", notes: "FBA inventory side: ingested 01-Jun-2026. MCF orders report still pending — partial." },
  // Sprint 7 — Flipkart drill (FK-001 + FK-002 superseded for single-WH case)
  { key: "FK-001", status: "DONE", blocker: "None", sprint: "Done", notes: "Drill modal: 7d/14d/30d/60d/90d avg daily trend, reserved + scheduled, F-Assured badge, real price — 01-Jun-2026" },
  { key: "FK-002", status: "DONE", blocker: "None", sprint: "Done", notes: "Single-WH (Gurgaon Sandila) → OOS-count indicator is degenerate. Replaced with cell-level health pill: live count + days-of-cover + F-Assured chip — 01-Jun-2026" },
  // DATA-003 + DATA-004 (Flipkart side) closed
  { key: "DATA-003", status: "DONE", blocker: "None", sprint: "Done", notes: "Flipkart 'Current Inventory' export with 7D/14D/30D/60D/90D sales + reserved + F-Assured ingested — 01-Jun-2026" },
  { key: "DATA-004", status: "READY", blocker: "Amazon ASP + Blinkit MRP per SKU still pending", sprint: "Done", notes: "Flipkart selling prices wired into drill modal. Amazon ASP + Blinkit MRP per-SKU still pending — partial." },
  // AMZ-004 sits unblocked from decisions but still awaiting drill modal
  { key: "AMZ-004", status: "READY", blocker: "DATA-002 for drill modal numbers", notes: "Decisions AMZ-001-D1/D2 answered. Display pattern shipped in Unified Stock + Runway. Drill modal awaits DATA-002." },
];

const DATA_RECEIVED = [
  { key: "SIM-014-DATA", date: "31-May-2026", status: "yes" },
  { key: "SIM-016-DATA", date: "31-May-2026", status: "yes" },
  // 01-Jun-2026 — real marketplace exports landed
  { key: "DATA-001",     date: "01-Jun-2026", status: "yes" },     // Blinkit feeder-WH xlsx — full
  { key: "DATA-002",     date: "01-Jun-2026", status: "partial" }, // Amazon FBA ledger received; MCF Orders report still pending
  { key: "DATA-003",     date: "01-Jun-2026", status: "yes" },     // Flipkart inventory CSV (single Gurgaon WH)
  { key: "DATA-004",     date: "01-Jun-2026", status: "partial" }, // Flipkart prices received; Amazon ASP + Blinkit MRP still pending
];

console.log("\n── TRACKING sheet ──");
const trackRange = tracking["!ref"];
TRACKING_UPDATES.forEach(u => {
  const row = findRow(tracking, trackRange, COL.key, u.key);
  if (row < 0) { console.warn("  ⚠ key not found:", u.key); return; }
  if (u.status   !== undefined) setCell(tracking, addr(COL.status,  row), u.status);
  if (u.blocker  !== undefined) setCell(tracking, addr(COL.blocker, row), u.blocker);
  if (u.sprint   !== undefined) setCell(tracking, addr(COL.sprint,  row), u.sprint);
  if (u.notes    !== undefined) setCell(tracking, addr(COL.notes,   row), u.notes);
  console.log(`  ✓ ${u.key.padEnd(10)} row ${row} → ${u.status || "(blocker only)"}`);
});

// ─── 2. TRACKING sheet — append new cross-cutting items ────────
console.log("\n── TRACKING sheet — append new rows ──");
const lastRowExisting = XLSX.utils.decode_range(tracking["!ref"]).e.r + 1; // 1-based
const NEW_ITEMS = [
  {
    Bucket: "Cross-cutting", Priority: "—", "Item Key": "LIB-001",
    Title: "Shared cascade library (lib/runwayCascade.js)",
    Description: "Multi-phase parallel-cascade simulator module shared across Runway calculator + Simulator + Materials breakdown. Encapsulates the formula so all consumers stay consistent.",
    "Acceptance Criteria": "Library lives at src/lib/runwayCascade.js. Exports computeCascade() + fmtRunway(). Used by Runway calculator's adjRunway calc.",
    "Inputs Needed": "—", "Decisions Needed": "—", "Data Needed": "—",
    Effort: "S", Status: "DONE", Blocker: "None", Workaround: "—",
    Dependencies: "—", Owner: "Claude", Sprint: "Done",
    Notes: "Shipped 30-May-2026 (b71ac8b) alongside RUN-001.",
  },
  {
    Bucket: "Cross-cutting", Priority: "—", "Item Key": "DISPLAY-001",
    Title: "a+b split display pattern for combined channels",
    Description: "Reusable display pattern (caption beneath stock number, optional split tags) used by Amazon channel cell across Unified Stock + Runway tab. Generalises to any future combined channel.",
    "Acceptance Criteria": "PlatformCell + RunwayChannelCell both accept splitA/splitB/labels props and render the breakdown. No regression on cells without splits.",
    "Inputs Needed": "—", "Decisions Needed": "—", "Data Needed": "—",
    Effort: "XS", Status: "DONE", Blocker: "None", Workaround: "—",
    Dependencies: "AMZ-001", Owner: "Claude", Sprint: "Done",
    Notes: "Shipped 30-May-2026 (b71ac8b) alongside AMZ-001.",
  },
];
const headerOrder = ["Bucket","Priority","Item Key","Title","Description","Acceptance Criteria","Inputs Needed","Decisions Needed","Data Needed","Effort","Status","Blocker","Workaround","Dependencies","Owner","Sprint","Notes"];
let appendCursor = lastRowExisting + 1;  // 1-based row to write next new item
NEW_ITEMS.forEach((item) => {
  // Idempotent: if an item with this Key already exists, skip the append so
  // re-running the script doesn't duplicate cross-cutting rows every time.
  const existingRow = findRow(tracking, tracking["!ref"], COL.key, item["Item Key"]);
  if (existingRow > 0) {
    console.log(`  · ${item["Item Key"]} already at row ${existingRow} — skipping append`);
    return;
  }
  const r = appendCursor++;
  headerOrder.forEach((h, ci) => {
    setCell(tracking, addr(ci, r), item[h] ?? "");
  });
  extendRange(tracking, r, headerOrder.length - 1);
  console.log(`  ✓ added ${item["Item Key"]} at row ${r}`);
});

// ─── 3. DECISIONS sheet — fill Decided column ──────────────────
console.log("\n── DECISIONS sheet ──");
const decisions = wb.Sheets["Decisions"];
if (decisions) {
  const DEC_COL = { key: 0, decided: 5 };
  const decRange = decisions["!ref"];
  const DECISION_UPDATES = [
    { key: "RUN-001-D1", decided: "Parallel" },
    { key: "AMZ-001-D1", decided: "If FBA has stock, both Amazon + Shopify orders ship via FBA. When FBA hits zero, demand falls back to central warehouse." },
    { key: "AMZ-001-D2", decided: "Combined" },
  ];
  DECISION_UPDATES.forEach(u => {
    const row = findRow(decisions, decRange, DEC_COL.key, u.key);
    if (row < 0) { console.warn("  ⚠ key not found:", u.key); return; }
    setCell(decisions, addr(DEC_COL.decided, row), u.decided);
    console.log(`  ✓ ${u.key.padEnd(14)} row ${row} → "${u.decided.slice(0, 40)}${u.decided.length > 40 ? "..." : ""}"`);
  });
} else console.warn("  ⚠ No 'Decisions' sheet found");

// ─── 4. DATA REQUESTS — date requested + received ─────────────
console.log("\n── DATA REQUESTS sheet ──");
const dreq = wb.Sheets["Data Requests"];
if (dreq) {
  // Cols: 0=Data Key, 6=Received, 7=Date requested, 8=Date received
  const D_COL = { key: 0, received: 6, dateReq: 7, dateRecv: 8 };
  const range = XLSX.utils.decode_range(dreq["!ref"]);
  for (let r = range.s.r + 1; r <= range.e.r; r++) {  // skip header
    const keyCell = dreq[addr(D_COL.key, r + 1)];
    if (!keyCell || !String(keyCell.v).trim()) continue;
    const key = String(keyCell.v).trim();
    setCell(dreq, addr(D_COL.dateReq, r + 1), "30-May-2026");
    const received = DATA_RECEIVED.find(d => d.key === key);
    if (received) {
      setCell(dreq, addr(D_COL.received, r + 1), received.status || "yes");
      setCell(dreq, addr(D_COL.dateRecv, r + 1), received.date);
      console.log(`  ✓ ${key.padEnd(14)} row ${r + 1} → ${(received.status || "yes").toUpperCase()} on ${received.date}`);
    } else {
      console.log(`  ✓ ${key.padEnd(14)} row ${r + 1} → date requested set (not yet received)`);
    }
  }
} else console.warn("  ⚠ No 'Data Requests' sheet found");

// ─── 5. DASHBOARD counts (formulas) — extend COUNTIF ranges ────
console.log("\n── DASHBOARD & LEGEND sheet ──");
const dash = wb.Sheets["Dashboard & Legend"];
if (dash) {
  // The dashboard counts are COUNTIF formulas like:
  //   =COUNTIF(Tracking!K2:K40,"DONE")
  // We added LIB-001 + DISPLAY-001 at rows 41-42, so the existing range
  // (K2:K40) misses them. Bump every COUNTIF range to row 50 so future
  // appends up to ~10 more items are picked up automatically.
  const formulaCells = Object.keys(dash).filter(k => dash[k] && dash[k].f);
  let extended = 0;
  formulaCells.forEach(addr => {
    const f = dash[addr].f;
    // Match "Tracking!K2:K40" → "Tracking!K2:K50". Range uses a colon
    // which \w+ won't catch, so spell it out.
    const updated = f.replace(/(Tracking![A-Z]+\d+:[A-Z]+)40/g, "$150");
    if (updated !== f) {
      // IMPORTANT: keep `v` (cached value) — the xlsx writer strips
      // cells that only have `f` with no `v`. Excel + Sheets recompute
      // formulas when the file opens, so the cached value just shows
      // briefly before being replaced.
      dash[addr] = { ...dash[addr], f: updated };
      extended++;
    }
  });
  console.log(`  ✓ extended ${extended} COUNTIF formula ranges → row 50`);
  console.log("  ℹ all summary counts will auto-recompute when the file is opened");
} else console.warn("  ⚠ No 'Dashboard & Legend' sheet found");

// ─── write out ─────────────────────────────────────────────────
XLSX.writeFile(wb, OUT, { cellStyles: true });
console.log("\n✓ Wrote updated tracker to:");
console.log("  " + OUT);
console.log("\nOpen it in Numbers / Excel / Google Sheets to verify, then");
console.log("replace your original or rename as you prefer.");
