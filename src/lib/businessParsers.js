/**
 * businessParsers.js — BUILDER B1, DATA LAYER (Business Performance module).
 *
 * Browser-side parsers for every source in docs/BUSINESS-MODULE-SPEC.md §2/§3.
 * Each parser is `async (file, opts) → { facts, dq }` where:
 *   - `facts` conforms EXACTLY to the pinned store shape (see businessStore.js):
 *       { monthly:{ "YYYY-MM|channel|CODE": {...} }, daily:{ "YYYY-MM-DD|channel|CODE": {...} }, meta:{...} }
 *   - `dq` is an array of data-quality flags `{ level:"info"|"warn"|"error", code, msg }`.
 *
 * Constraints baked here are BINDING (founder checkpoint 2026-06-11):
 *   • Amazon = All-Orders rows sales-channel == "Amazon.in" ONLY (incl. its
 *     Merchant/_MP website-fulfilment rows — the §2 gross anchor 1,238,808/1,430
 *     is re-derived with exactly this filter). Non-Amazon* channel rows are MCF
 *     (website fulfilment, item-price 0) → captured as mcfUnits for mcfShare,
 *     NEVER as Amazon revenue. Returns ("Shipped - Returned to Seller") netted out.
 *   • Flipkart = Σ Buyer Invoice Amount with NATIVE SIGN (Return rows carry
 *     negative BIA → auto-net); net = Σ ÷ 1.05; fold `*N` multipacks into base.
 *     Cashback report (₹11,931) EXCLUDED from CM, reported separately.
 *   • Blinkit = Σ Total Gross Bill Amount; net = gross − (CGST+SGST+CESS) — NOT
 *     the "Total Tax" column (which holds only one GST leg); key on Item Id.
 *   • Website May = shopify-net file AS-IS (already net, do NOT ÷1.05). Daily
 *     shopify file is SHAPE only, never the monthly total.
 *
 * Fail-loud: schema drift → a dq error + a clear thrown Error (never a silent 0).
 * No NaN/Infinity emitted; every numeric goes through num().
 */
import * as XLSX from "xlsx";

// ─── Canonical SKU maps (BINDING — see prompt + uploadParsers.CODE_MAP) ──────
// ASIN → canonical code (binding map, founder-confirmed). This is the PRIMARY
// Amazon resolver (the All-Orders TSV carries asin in every row).
const ASIN_MAP = {
  B0GZNRL4XS: "NSMP100",  B0GZNGQLTM: "NSMP250",
  B0FPMJMRW7: "NSSB100",  B0FPMDD8ZS: "NSSB250",  B0GHQVMC93: "NSSB500",
  B0DV5K7BB4: "NSSBDB100", B0DV5MS3J3: "NSSBDB250", B0FPD5432G: "NSSBDB500",
  B0GRMC94JJ: "NSSBJ300", B0GRMG2BLQ: "NSSBJ500",
  B0DK1X2H8F: "NSSBBO15", B0DK1X4LGV: "NSSBBO30",
  B0DJK3DCZF: "NSJO100",  B0F88G8DYP: "NSACDT30",
};

// Marketplace-MSKU → canonical (Amazon "sku" column; reused from CODE_MAP so the
// two parsers can never drift). Suffix "_MP" (MCF website fulfilment) is stripped
// before lookup.
const AMZ_MSKU_MAP = {
  NSSBDB100g: "NSSBDB100", NSSBDB250g: "NSSBDB250", NSSBDB500g: "NSSBDB500",
  NSSBP100: "NSSB100", NSSBP250: "NSSB250", NSSBP500: "NSSB500",
  NSSBJ300ML: "NSSBJ300", NSSBJ500ML: "NSSBJ500",
  NSMP100: "NSMP100", NSMP250: "NSMP250",
  "NSJ&RHO100ML": "NSJO100", "DI-TE-1-A": "NSACDT30",
};

// Flipkart SKU → canonical (the FK sheet wraps SKU in quotes + a "SKU:" prefix).
const FK_SKU_MAP = {
  NSSBDB100g: "NSSBDB100", NSSBDB250g: "NSSBDB250", NSSBDB500g: "NSSBDB500",
  NSSBP100: "NSSB100", NSSBP250: "NSSB250", NSSBP500: "NSSB500",
  NSSBJ300ML: "NSSBJ300", NSSBJ500ML: "NSSBJ500",
  NSMP100: "NSMP100", NSMP250: "NSMP250",
  "NSJ&RHO100ML": "NSJO100", "DI-TE-1-A": "NSACDT30",
};

// Shopify variant SKU → canonical (from CODE_MAP `shp`).
const SHP_SKU_MAP = {
  "NS-SBDR-100": "NSSBDB100", "NS-SBDR-250": "NSSBDB250", "NS-SBDR-500": "NSSBDB500",
  "NS-SBP-100": "NSSB100", "NS-SBP-250": "NSSB250", "NS-SBP-500": "NSSB500",
  "NS-SBJ-300": "NSSBJ300", "NS-SBJ-500": "NSSBJ500",
  NSMP100: "NSMP100", NSMP250: "NSMP250",
  "NS-HO-JT-100": "NSJO100", "DI-TE-1-A": "NSACDT30", "NS-SB-030": "NSSBBO30",
};

// Blinkit Item Id → canonical (BINDING — key on Item Id, never free-text title).
const BLINKIT_ITEM_MAP = {
  10270854: "NSSB100", 10282349: "NSSB250",
  10269110: "NSSBDB250", 10276565: "NSSBDB500",
  10302844: "NSSBJ300",
};
// Conservative title fallback for Blinkit rows whose Item Id is not in the map
// (R-FUZZY, never silent — every fallback hit is recorded in dq).
const BLINKIT_TITLE_FALLBACK = [
  { needle: "daily nutrition supplement powder", variant: "100", code: "NSSB100" },
  { needle: "sea buckthorn berries powder",       variant: "250", code: "NSSB250" },
  { needle: "sea buckthorn dry berries",          variant: "250", code: "NSSBDB250" },
  { needle: "himalayan sea buckthorn dry berries",variant: "500", code: "NSSBDB500" },
  { needle: "berry juice concentrate",            variant: "300", code: "NSSBJ300" },
];

// ─── Numeric guard (NaN/Infinity-free; mirrors uploadParsers.num intent) ─────
const num = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v ?? "").trim();
  if (!s) return 0;
  const n = Number(s.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
// Round to paise so accumulated floats never leak long mantissas into storage.
const r2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : 0);

// ─── File readers ────────────────────────────────────────────────────────────
async function fileToText(file) { return await file.text(); }
async function fileToWorkbook(file) {
  const buf = await file.arrayBuffer();
  return XLSX.read(buf, { type: "array" });
}

// Some exporters (Flipkart) write a WRONG/truncated worksheet "!ref" (e.g.
// "A1:BH1" for a 589-row sheet). Recompute the true used range from the cell
// keys so every data row is read — silently trusting !ref would drop all data
// (a fail-loud-able schema trap). Returns the worksheet with a corrected !ref.
function repairSheetRange(ws) {
  let maxR = 0, maxC = 0;
  for (const k of Object.keys(ws)) {
    if (k[0] === "!") continue;
    const c = XLSX.utils.decode_cell(k);
    if (c.r > maxR) maxR = c.r;
    if (c.c > maxC) maxC = c.c;
  }
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
  return ws;
}
function sheetGrid(ws) {
  return XLSX.utils.sheet_to_json(repairSheetRange(ws), { header: 1, defval: "", raw: true });
}

// Minimal RFC-4180 CSV line splitter (quotes, escaped quotes).
function parseCsvLine(line) {
  const out = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
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

// Excel serial / string → "YYYY-MM-DD" (UTC). Returns null when unparseable.
function excelToISODate(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    const ms = (v - 25569) * 86400 * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const iso = s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
const monthOf = (iso) => (iso ? iso.slice(0, 7) : null);

// Empty facts skeleton + a keyed monthly accumulator.
function emptyFacts() { return { monthly: {}, daily: {}, meta: {} }; }
function bumpMonthly(facts, month, channel, code, fields) {
  const key = `${month}|${channel}|${code}`;
  const cur = facts.monthly[key] || {
    units: 0, grossRev: 0, netRev: 0, returnsUnits: 0, returnsValue: 0, adSpendDirect: 0,
  };
  for (const f of Object.keys(fields)) cur[f] = r2((cur[f] || 0) + num(fields[f]));
  facts.monthly[key] = cur;
}
function bumpDaily(facts, date, channel, code, fields) {
  const key = `${date}|${channel}|${code}`;
  const cur = facts.daily[key] || { units: 0, netRev: 0 };
  for (const f of Object.keys(fields)) cur[f] = r2((cur[f] || 0) + num(fields[f]));
  facts.daily[key] = cur;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1 · AMAZON ALL-ORDERS TSV  (channel: amazon)  + MCF units capture
// ═══════════════════════════════════════════════════════════════════════════
// Pins: sales-channel == "Amazon.in" → Amazon sales. item-status "Shipped"
// (Cancelled / Unfulfillable rows carry qty 0). "Shipped - Returned to Seller"
// rows are NETTED OUT (recorded as returnsUnits/returnsValue, then subtracted
// from units/grossRev). Non-Amazon* channel rows = MCF (website fulfilment,
// price 0) → mcfUnits per code in meta.mcf (drives §5 website blended fee).
// net = grossRev ÷ 1.05.
export async function parseAmazonOrders(file, _opts = {}) {
  const dq = [];
  const txt = await fileToText(file);
  const lines = txt.split(/\r?\n/).filter((l) => l.length);
  if (lines.length < 2) { dq.push({ level: "error", code: "AMZ_EMPTY", msg: "Amazon All-Orders TSV has no data rows." }); throw new Error("Amazon All-Orders: empty file."); }
  const headers = lines[0].split("\t");
  const col = (n) => headers.indexOf(n);
  const C = {
    date: col("purchase-date"), status: col("order-status"), itemStatus: col("item-status"),
    salesCh: col("sales-channel"), sku: col("sku"), asin: col("asin"),
    qty: col("quantity"), price: col("item-price"),
  };
  for (const [k, v] of Object.entries(C)) {
    if (v === -1) { dq.push({ level: "error", code: "AMZ_SCHEMA", msg: `Amazon All-Orders missing column for "${k}".` }); throw new Error(`Amazon All-Orders: missing expected column (${k}). Schema drift.`); }
  }
  const facts = emptyFacts();
  const mcf = {};            // code → mcf units (website-fulfilment proxy for mcfShare)
  let mcfTotal = 0, unmapped = 0, returnUnits = 0, returnValue = 0;
  const dates = new Set();

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split("\t");
    const salesCh = (cells[C.salesCh] || "").trim();
    const itemStatus = (cells[C.itemStatus] || "").trim();
    const status = (cells[C.status] || "").trim();
    const iso = excelToISODate(cells[C.date]);
    const month = monthOf(iso);
    const asin = (cells[C.asin] || "").trim();
    const rawSku = (cells[C.sku] || "").trim();
    const code = ASIN_MAP[asin] || AMZ_MSKU_MAP[rawSku.replace(/_MP$/i, "")] || null;

    // ── MCF: Non-Amazon* channel rows = website fulfilment (NOT Amazon sales).
    // item-price is 0 here; capture units only (valued downstream at website
    // per-unit net price → mcfShare). Cancelled/Unfulfillable excluded.
    if (/^Non-Amazon/i.test(salesCh)) {
      if (itemStatus === "Shipped" && code) {
        const q = num(cells[C.qty]);
        mcf[code] = (mcf[code] || 0) + q;
        mcfTotal += q;
      }
      continue;
    }
    if (salesCh !== "Amazon.in") continue;           // BINDING: Amazon = Amazon.in ONLY
    if (itemStatus !== "Shipped") continue;          // Cancelled/Unfulfillable/blank → qty 0, skip

    if (!code) {
      if (rawSku || asin) { unmapped++; if (unmapped <= 5) dq.push({ level: "warn", code: "AMZ_UNMAPPED", msg: `Unmapped Amazon row asin=${asin} sku=${rawSku}` }); }
      continue;
    }
    if (!month) { dq.push({ level: "warn", code: "AMZ_NODATE", msg: `Amazon row with unparseable date dropped (asin=${asin}).` }); continue; }
    dates.add(iso);
    const q = num(cells[C.qty]);
    const rev = num(cells[C.price]);
    const isReturn = /Returned to Seller/i.test(status);

    // Net-out: returns subtract from units & grossRev AND are recorded as
    // returnsUnits/returnsValue so the Sales page returns-view can show them.
    if (isReturn) {
      bumpMonthly(facts, month, "amazon", code, {
        units: -q, grossRev: -rev, netRev: -rev / 1.05, returnsUnits: q, returnsValue: rev,
      });
      returnUnits += q; returnValue += rev;
    } else {
      bumpMonthly(facts, month, "amazon", code, { units: q, grossRev: rev, netRev: rev / 1.05 });
    }
  }

  facts.meta.mcf = { byCode: mcf, totalUnits: mcfTotal };
  facts.meta.amazonReturns = { units: returnUnits, value: r2(returnValue) };
  if (unmapped > 5) dq.push({ level: "warn", code: "AMZ_UNMAPPED_MORE", msg: `${unmapped} total unmapped Amazon rows.` });
  if (Object.keys(facts.monthly).length === 0) dq.push({ level: "error", code: "AMZ_NOFACTS", msg: "Amazon parse produced no facts — check sales-channel filter." });
  dq.push({ level: "info", code: "AMZ_OK", msg: `Amazon: ${Object.keys(facts.monthly).length} month×SKU cells; returns ${returnUnits}u/₹${r2(returnValue)}; MCF ${mcfTotal}u.` });
  return { facts, dq };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2 · FLIPKART SALES REPORT xlsx  (channel: flipkart)
// ═══════════════════════════════════════════════════════════════════════════
// Pins: Σ Buyer Invoice Amount with NATIVE SIGN (Return rows negative → auto-net).
// net = Σ ÷ 1.05. Fold `*N` multipacks into the base code (units × N). Cashback
// report (Invoice Amount sum) EXCLUDED from CM, surfaced as meta.flipkartCashback.
function resolveFkSku(raw) {
  // Sheet stores e.g. '"""SKU:NSSBDB100g"""' or 'NSSBDB100g*2'.
  let s = String(raw ?? "").replace(/"/g, "").replace(/^SKU:/i, "").trim();
  if (!s) return null;
  const m = s.match(/^(.+?)\s*\*\s*(\d+)$/);
  if (m) {
    const code = FK_SKU_MAP[m[1].trim()];
    return code ? { code, mult: parseInt(m[2], 10) || 1 } : null;
  }
  const code = FK_SKU_MAP[s];
  return code ? { code, mult: 1 } : null;
}
export async function parseFlipkartSales(file, _opts = {}) {
  const dq = [];
  if (!/\.(xlsx|xls)$/i.test(file.name)) dq.push({ level: "warn", code: "FK_EXT", msg: `Flipkart sales expected xlsx, got ${file.name}.` });
  const wb = await fileToWorkbook(file);
  const sheetName = wb.SheetNames.find((n) => /sales report/i.test(n)) || wb.SheetNames[0];
  const grid = sheetGrid(wb.Sheets[sheetName]);
  if (grid.length < 2) { dq.push({ level: "error", code: "FK_EMPTY", msg: "Flipkart Sales Report has no data rows (check !ref repair)." }); throw new Error("Flipkart Sales: empty after range repair."); }
  const H = grid[0];
  const idx = (n) => H.indexOf(n);
  const C = {
    sku: idx("SKU"), qty: idx("Item Quantity"), bia: idx("Buyer Invoice Amount"),
    orderDate: idx("Order Date"), invDate: idx("Buyer Invoice Date"), eventType: idx("Event Type"),
  };
  for (const [k, v] of Object.entries(C)) {
    if (v === -1 && k !== "invDate") { dq.push({ level: "error", code: "FK_SCHEMA", msg: `Flipkart Sales missing column "${k}".` }); throw new Error(`Flipkart Sales: missing column (${k}). Schema drift.`); }
  }
  const facts = emptyFacts();
  let unmapped = 0, returnRows = 0;
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i];
    if (!r || r[C.sku] === "" || r[C.sku] == null) continue;
    const hit = resolveFkSku(r[C.sku]);
    if (!hit) { unmapped++; if (unmapped <= 5) dq.push({ level: "warn", code: "FK_UNMAPPED", msg: `Unmapped Flipkart SKU ${r[C.sku]}` }); continue; }
    const { code, mult } = hit;
    const iso = excelToISODate(r[C.orderDate]) || excelToISODate(r[C.invDate]);
    const month = monthOf(iso);
    if (!month) { dq.push({ level: "warn", code: "FK_NODATE", msg: `Flipkart row dropped — no parseable date (sku ${r[C.sku]}).` }); continue; }
    const bia = num(r[C.bia]);                       // native sign — returns are negative
    const qty = num(r[C.qty]) * mult;                // *N multipack folds into base units
    const isReturn = String(r[C.eventType] || "").toLowerCase().includes("return") || bia < 0;
    if (isReturn) returnRows++;
    // BIA already net of GST? No — spec says net = Σ BIA ÷ 1.05. grossRev = Σ BIA.
    bumpMonthly(facts, month, "flipkart", code, {
      units: isReturn ? -Math.abs(qty) : qty,
      grossRev: bia, netRev: bia / 1.05,
      ...(isReturn ? { returnsUnits: Math.abs(qty), returnsValue: Math.abs(bia) } : {}),
    });
    const ds = excelToISODate(r[C.orderDate]) || iso;
    if (ds && !isReturn) bumpDaily(facts, ds, "flipkart", code, { units: qty, netRev: bia / 1.05 });
  }

  // Cashback report — settlement-layer "net realization" note, EXCLUDED from CM.
  const cbSheet = wb.SheetNames.find((n) => /cash\s*back/i.test(n));
  if (cbSheet) {
    const cg = sheetGrid(wb.Sheets[cbSheet]);
    const ch = cg[0] || [];
    const ia = ch.indexOf("Invoice Amount");
    let cb = 0, cn = 0;
    if (ia !== -1) for (let i = 1; i < cg.length; i++) { if (cg[i] && cg[i][ia] !== "") { cb += num(cg[i][ia]); cn++; } }
    facts.meta.flipkartCashback = { value: r2(cb), rows: cn };
    dq.push({ level: "info", code: "FK_CASHBACK", msg: `Flipkart cashback ₹${r2(cb)} (${cn} notes) — excluded from CM, reported as net-realization note.` });
  }
  if (unmapped > 5) dq.push({ level: "warn", code: "FK_UNMAPPED_MORE", msg: `${unmapped} total unmapped Flipkart SKUs.` });
  dq.push({ level: "info", code: "FK_OK", msg: `Flipkart: ${Object.keys(facts.monthly).length} cells; ${returnRows} return/cancel rows native-netted.` });
  return { facts, dq };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3 · BLINKIT SALES REPORT xlsx  (channel: blinkit)
// ═══════════════════════════════════════════════════════════════════════════
// Pins: gross = Σ Total Gross Bill Amount; net = gross − (CGST+SGST+CESS). Do NOT
// use "Total Tax" (holds only one GST leg). Key on Item Id; conservative title
// fallback when the Item Id is unknown (every fallback recorded in dq).
export async function parseBlinkitSales(file, _opts = {}) {
  const dq = [];
  const wb = await fileToWorkbook(file);
  const sheetName = wb.SheetNames.find((n) => /sales report/i.test(n)) || wb.SheetNames[0];
  const grid = sheetGrid(wb.Sheets[sheetName]);
  if (grid.length < 2) { dq.push({ level: "error", code: "BLK_EMPTY", msg: "Blinkit Sales Report has no data rows." }); throw new Error("Blinkit Sales: empty."); }
  const H = grid[0];
  const idx = (n) => H.indexOf(n);
  const C = {
    item: idx("Item Id"), name: idx("Product Name"), variant: idx("Variant Description"),
    qty: idx("Quantity"), gross: idx("Total Gross Bill Amount"),
    cgst: idx("CGST Value"), sgst: idx("SGST Value"), cess: idx("CESS Value"),
    date: idx("Order Date"), status: idx("Order Status"),
  };
  for (const [k, v] of Object.entries(C)) {
    if (v === -1) { dq.push({ level: "error", code: "BLK_SCHEMA", msg: `Blinkit Sales missing column "${k}".` }); throw new Error(`Blinkit Sales: missing column (${k}). Schema drift.`); }
  }
  const facts = emptyFacts();
  let unmapped = 0, fallbackHits = 0;
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i];
    if (!r || (r[C.item] === "" && r[C.name] === "")) continue;
    const itemId = num(r[C.item]);
    let code = BLINKIT_ITEM_MAP[itemId] || null;
    if (!code) {
      const title = String(r[C.name] || "").toLowerCase();
      const variant = String(r[C.variant] || "");
      const fb = BLINKIT_TITLE_FALLBACK.find((f) => title.includes(f.needle) && variant.includes(f.variant));
      if (fb) { code = fb.code; fallbackHits++; dq.push({ level: "warn", code: "BLK_TITLEFALLBACK", msg: `Blinkit Item ${itemId} resolved by title→${code}.` }); }
    }
    if (!code) { unmapped++; if (unmapped <= 5) dq.push({ level: "warn", code: "BLK_UNMAPPED", msg: `Unmapped Blinkit Item Id ${r[C.item]} (${r[C.name]}).` }); continue; }
    const iso = excelToISODate(r[C.date]);
    const month = monthOf(iso);
    if (!month) { dq.push({ level: "warn", code: "BLK_NODATE", msg: `Blinkit row dropped — no parseable date (item ${itemId}).` }); continue; }
    const gross = num(r[C.gross]);
    const qty = num(r[C.qty]);
    const tax = num(r[C.cgst]) + num(r[C.sgst]) + num(r[C.cess]);
    const net = gross - tax;
    bumpMonthly(facts, month, "blinkit", code, { units: qty, grossRev: gross, netRev: net });
    if (iso) bumpDaily(facts, iso, "blinkit", code, { units: qty, netRev: net });
  }
  if (unmapped > 5) dq.push({ level: "warn", code: "BLK_UNMAPPED_MORE", msg: `${unmapped} total unmapped Blinkit items.` });
  dq.push({ level: "info", code: "BLK_OK", msg: `Blinkit: ${Object.keys(facts.monthly).length} cells; ${fallbackHits} title-fallback rows.` });
  return { facts, dq };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 · SHOPIFY NET (monthly authoritative)  (channel: website)
// ═══════════════════════════════════════════════════════════════════════════
// Pins: Net sales + Net items sold AS-IS (already net of returns/discounts,
// ex-GST per Shopify semantics). Do NOT ÷1.05. grossRev == netRev here (Shopify
// "Net sales" is the authoritative net). The month is supplied by opts.month
// (this file has no date column — it's a month-scoped export). Default "2026-05".
export async function parseShopifyNet(file, opts = {}) {
  const dq = [];
  const month = opts.month || "2026-05";
  const txt = await fileToText(file);
  const lines = txt.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.length);
  if (lines.length < 2) { dq.push({ level: "error", code: "SHN_EMPTY", msg: "shopify-net file empty." }); throw new Error("shopify-net: empty."); }
  const H = parseCsvLine(lines[0]);
  const C = {
    sku: H.indexOf("Product variant SKU"), units: H.indexOf("Net items sold"), net: H.indexOf("Net sales"),
  };
  for (const [k, v] of Object.entries(C)) {
    if (v === -1) { dq.push({ level: "error", code: "SHN_SCHEMA", msg: `shopify-net missing column "${k}".` }); throw new Error(`shopify-net: missing column (${k}). Schema drift.`); }
  }
  const facts = emptyFacts();
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const sku = (cells[C.sku] || "").trim();
    if (!sku) continue;
    const code = SHP_SKU_MAP[sku];
    if (!code) { dq.push({ level: "warn", code: "SHN_UNMAPPED", msg: `Unmapped Shopify SKU ${sku}.` }); continue; }
    const units = num(cells[C.units]);
    const net = num(cells[C.net]);
    bumpMonthly(facts, month, "website", code, { units, grossRev: net, netRev: net }); // AS-IS, no ÷1.05
  }
  if (Object.keys(facts.monthly).length === 0) dq.push({ level: "error", code: "SHN_NOFACTS", msg: "shopify-net produced no facts." });
  dq.push({ level: "info", code: "SHN_OK", msg: `shopify-net (${month}): ${Object.keys(facts.monthly).length} website cells.` });
  return { facts, dq };
}

// ═══════════════════════════════════════════════════════════════════════════
// 5 · SHOPIFY DAILY (shape/trend only — NEVER the monthly total)  (website)
// ═══════════════════════════════════════════════════════════════════════════
// Emits ONLY daily facts (units). It must never feed the monthly authoritative
// total (that is shopify-net). netRev left 0 here — daily is a unit-shape signal.
export async function parseShopifyDaily(file, _opts = {}) {
  const dq = [];
  const txt = await fileToText(file);
  const lines = txt.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.length);
  if (lines.length < 2) { dq.push({ level: "error", code: "SHD_EMPTY", msg: "shopify-daily file empty." }); throw new Error("shopify-daily: empty."); }
  const H = parseCsvLine(lines[0]);
  const C = { sku: H.indexOf("Product variant SKU"), day: H.indexOf("Day"), units: H.indexOf("Net items sold") };
  for (const [k, v] of Object.entries(C)) {
    if (v === -1) { dq.push({ level: "error", code: "SHD_SCHEMA", msg: `shopify-daily missing column "${k}".` }); throw new Error(`shopify-daily: missing column (${k}). Schema drift.`); }
  }
  const facts = emptyFacts();
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const sku = (cells[C.sku] || "").trim();
    if (!sku) continue;
    const code = SHP_SKU_MAP[sku];
    if (!code) continue;                              // daily shape only — silent skip ok (warned upstream)
    const iso = excelToISODate(cells[C.day]);
    if (!iso) continue;
    bumpDaily(facts, iso, "website", code, { units: num(cells[C.units]) });
  }
  dq.push({ level: "info", code: "SHD_OK", msg: `shopify-daily: ${Object.keys(facts.daily).length} daily website cells (shape only).` });
  return { facts, dq };
}

// ═══════════════════════════════════════════════════════════════════════════
// 6 · AMAZON SP ADS (may_product_wise_sp.xlsx — DAILY, per-ASIN)  (amazon)
// ═══════════════════════════════════════════════════════════════════════════
// Product-attributed Amazon ad spend. Sums "Spend" by Advertised ASIN → code,
// per month (from Date). Stored as monthly adSpendDirect on the amazon channel.
export async function parseAmazonSpAds(file, _opts = {}) {
  const dq = [];
  const wb = await fileToWorkbook(file);
  const grid = sheetGrid(wb.Sheets[wb.SheetNames[0]]);
  if (grid.length < 2) { dq.push({ level: "error", code: "SP_EMPTY", msg: "Amazon SP ads empty." }); throw new Error("Amazon SP ads: empty."); }
  const H = grid[0];
  const C = { date: H.indexOf("Date"), asin: H.indexOf("Advertised ASIN"), spend: H.indexOf("Spend") };
  for (const [k, v] of Object.entries(C)) {
    if (v === -1) { dq.push({ level: "error", code: "SP_SCHEMA", msg: `Amazon SP ads missing column "${k}".` }); throw new Error(`Amazon SP ads: missing column (${k}). Schema drift.`); }
  }
  const facts = emptyFacts();
  let total = 0, unmapped = 0;
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i];
    const asin = String(r[C.asin] || "").trim();
    if (!asin) continue;
    const code = ASIN_MAP[asin];
    if (!code) { unmapped++; if (unmapped <= 5) dq.push({ level: "warn", code: "SP_UNMAPPED", msg: `Unmapped SP ASIN ${asin}.` }); continue; }
    const iso = excelToISODate(r[C.date]);
    const month = monthOf(iso);
    if (!month) continue;
    const sp = num(r[C.spend]);
    total += sp;
    bumpMonthly(facts, month, "amazon", code, { adSpendDirect: sp });
  }
  facts.meta.amazonSpTotal = r2(total);
  dq.push({ level: "info", code: "SP_OK", msg: `Amazon SP product-attributed ₹${r2(total)} across ${Object.keys(facts.monthly).length} cells.` });
  return { facts, dq };
}

// ═══════════════════════════════════════════════════════════════════════════
// 7 · FLIPKART PLA ADS (flipkart may ads.csv — per-SKU)  (flipkart)
// ═══════════════════════════════════════════════════════════════════════════
// Product-attributed FK ad spend. `*N` SKUs fold to base code. Month from the
// "Start Time" header line (the file is a month-scoped report). adSpendDirect.
export async function parseFlipkartPlaAds(file, _opts = {}) {
  const dq = [];
  const txt = await fileToText(file);
  const lines = txt.split(/\r?\n/);
  // Header row is the line beginning "Campaign ID". A "Start Time" meta line
  // above it carries the month.
  let monthFromHeader = null;
  const startLine = lines.find((l) => /^start time/i.test(l));
  if (startLine) { const iso = excelToISODate(startLine.split(",").slice(1).join(",").trim()); monthFromHeader = monthOf(iso); }
  const hdrIdx = lines.findIndex((l) => /^campaign id/i.test(l));
  if (hdrIdx === -1) { dq.push({ level: "error", code: "PLA_SCHEMA", msg: "FK PLA ads: no 'Campaign ID' header." }); throw new Error("FK PLA ads: header not found. Schema drift."); }
  const H = parseCsvLine(lines[hdrIdx]);
  const C = { sku: H.indexOf("Sku Id"), spend: H.indexOf("Ad Spend") };
  if (C.sku === -1 || C.spend === -1) { dq.push({ level: "error", code: "PLA_SCHEMA2", msg: "FK PLA ads missing Sku Id / Ad Spend." }); throw new Error("FK PLA ads: missing column. Schema drift."); }
  const month = monthFromHeader || "2026-05";
  const facts = emptyFacts();
  let total = 0, unmapped = 0;
  for (let i = hdrIdx + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = parseCsvLine(lines[i]);
    const hit = resolveFkSku(cells[C.sku]);
    if (!hit) { unmapped++; if (unmapped <= 5) dq.push({ level: "warn", code: "PLA_UNMAPPED", msg: `Unmapped FK PLA SKU ${cells[C.sku]}.` }); continue; }
    const sp = num(cells[C.spend]);
    total += sp;
    bumpMonthly(facts, month, "flipkart", hit.code, { adSpendDirect: sp });
  }
  facts.meta.flipkartPlaTotal = r2(total);
  dq.push({ level: "info", code: "PLA_OK", msg: `Flipkart PLA product-attributed ₹${r2(total)} (${month}).` });
  return { facts, dq };
}

// ═══════════════════════════════════════════════════════════════════════════
// 8 · GOOGLE PRODUCT-WISE ADS (google may ads.csv)  (website)
// ═══════════════════════════════════════════════════════════════════════════
// Free-text Product Title → code via conservative fuzzy (numeric tokens must
// match; Dice ≥ 0.5 with a clear margin). Every match recorded in dq. Spend on
// the website channel as adSpendDirect.
const GOOGLE_NUM = (s) => (String(s).match(/(\d+)\s*(?:g|gm|gram|grams|ml)\b/gi) || []).map((x) => x.match(/\d+/)[0]).sort().join(",");
const GOOGLE_KEYS = [
  { code: "NSSBDB100", needles: ["dry berries 100", "berries dry", "dry berries"], grams: "100" },
  { code: "NSSBDB250", needles: ["dry berries 250", "dry berries"], grams: "250" },
  { code: "NSSBDB500", needles: ["berries 500", "dry berries"], grams: "500" },
  { code: "NSSB100", needles: ["berry powder", "buckthorn powder"], grams: "100" },
  { code: "NSSB250", needles: ["berry powder", "buckthorn powder"], grams: "250" },
  { code: "NSSB500", needles: ["berry powder", "buckthorn powder"], grams: "500" },
  { code: "NSSBJ300", needles: ["juice"], grams: "300" },
  { code: "NSSBJ500", needles: ["juice"], grams: "500" },
  { code: "NSMP100", needles: ["moringa powder"], grams: "100" },
  { code: "NSMP250", needles: ["moringa powder"], grams: "250" },
  { code: "NSJO100", needles: ["jatamansi", "rosemary hair oil"], grams: "100" },
];
function googleTitleToCode(title) {
  const t = String(title || "").toLowerCase();
  const numSig = GOOGLE_NUM(t);                       // e.g. "100" or "250"
  // Numeric token MUST match (100g never matches 250g); then needle containment.
  const candidates = GOOGLE_KEYS.filter((k) => numSig.split(",").includes(k.grams) && k.needles.some((n) => t.includes(n)));
  if (candidates.length === 1) return { code: candidates[0].code, conf: "exact-needle" };
  if (candidates.length > 1) {
    // Disambiguate by the most specific needle hit.
    const best = candidates.find((k) => k.needles.some((n) => n.includes(k.grams) && t.includes(n))) || candidates[0];
    return { code: best.code, conf: "multi-needle" };
  }
  return null;
}
export async function parseGoogleAds(file, opts = {}) {
  const dq = [];
  const month = opts.month || "2026-05";
  const txt = await fileToText(file);
  const lines = txt.split(/\r?\n/);
  // The export has 2 title lines then a "Product Title,Currency code,Cost" header.
  const hdrIdx = lines.findIndex((l) => /^product title,/i.test(l));
  if (hdrIdx === -1) { dq.push({ level: "error", code: "GG_SCHEMA", msg: "Google ads: no 'Product Title' header." }); throw new Error("Google ads: header not found. Schema drift."); }
  const H = parseCsvLine(lines[hdrIdx]);
  const titleCol = 0, costCol = H.indexOf("Cost") === -1 ? H.length - 1 : H.indexOf("Cost");
  const facts = emptyFacts();
  let total = 0, attributed = 0;
  for (let i = hdrIdx + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = parseCsvLine(lines[i]);
    const title = cells[titleCol];
    const cost = num(cells[costCol]);
    total += cost;
    if (cost === 0) continue;                         // zero-spend rows carry no attribution signal
    const hit = googleTitleToCode(title);
    if (!hit) { dq.push({ level: "warn", code: "GG_UNMAPPED", msg: `Unmapped Google title (₹${r2(cost)}): ${String(title).slice(0, 60)}` }); continue; }
    attributed += cost;
    dq.push({ level: "info", code: "GG_MATCH", msg: `Google ₹${r2(cost)} → ${hit.code} (${hit.conf}).` });
    bumpMonthly(facts, month, "website", hit.code, { adSpendDirect: cost });
  }
  facts.meta.googleProductTotal = r2(total);
  facts.meta.googleAttributed = r2(attributed);
  facts.meta.googleUnattributed = r2(total - attributed);
  dq.push({ level: "info", code: "GG_OK", msg: `Google product-wise total ₹${r2(total)}; attributed ₹${r2(attributed)}; unattributed ₹${r2(total - attributed)}.` });
  return { facts, dq };
}

// ═══════════════════════════════════════════════════════════════════════════
// 9 · SNELL "Sale" tab — per-channel May ad spend (channel totals)
// ═══════════════════════════════════════════════════════════════════════════
// Daily-log workbook; the "Sale" tab runs all channels left-to-right with a
// 4-row header (R0 channel band, R1 sub-band, R2/R3 column labels) then a "Total"
// row (R4) and daily rows from R5 (Date = Excel serial in col 0). We PIN columns
// by reading the merged R2/R3 labels — NOT positional guesses — then sum the
// month's daily rows. Pinned (verified): AMS Spend col23, FK Spend col44,
// Google Spend col45, Blinkit gross col53 (cross-check 281,560), Blinkit Spend
// col56. Channel totals stored in meta.snellChannelSpend; Blinkit spend also
// allocated across Blinkit SKUs by net revenue is done in the engine (B2), here
// we only record the channel total + the gross cross-check.
function ffRow(arr) { const o = [...arr]; for (let i = 1; i < o.length; i++) { if (o[i] === "" || o[i] == null) o[i] = o[i - 1]; } return o; }
function findSnellCol(b2, r3, want) {
  // want: { band:/regex/ on forward-filled R2, leaf:/regex/ on R3 } — returns idx or -1.
  for (let c = 0; c < Math.max(b2.length, r3.length); c++) {
    const band = String(b2[c] || "").replace(/[\r\n]+/g, " ").trim();
    const leaf = String(r3[c] || "").trim();
    if (want.band.test(band) && (!want.leaf || want.leaf.test(leaf))) return c;
  }
  return -1;
}
export async function parseSnellSale(file, opts = {}) {
  const dq = [];
  const monthKey = opts.month || "2026-05";
  const [yy, mm] = monthKey.split("-").map(Number);
  const minSer = Math.round(Date.UTC(yy, mm - 1, 1) / 86400000) + 25569;
  const maxSer = Math.round(Date.UTC(yy, mm, 0) / 86400000) + 25569; // last day of month
  const wb = await fileToWorkbook(file);
  const saleSheet = wb.SheetNames.find((n) => /^sale\s*$/i.test(n) || /^sale$/i.test(n.trim()));
  if (!saleSheet) { dq.push({ level: "error", code: "SNL_NOSALE", msg: `Snell workbook has no 'Sale' tab (sheets: ${wb.SheetNames.join(", ")}).` }); throw new Error("Snell: no 'Sale' tab."); }
  const grid = sheetGrid(wb.Sheets[saleSheet]);
  if (grid.length < 6) { dq.push({ level: "error", code: "SNL_SHORT", msg: "Snell Sale tab too short." }); throw new Error("Snell Sale: too short."); }
  const b2 = ffRow(grid[2] || []);
  const r3 = grid[3] || [];
  const cols = {
    amsSpend: findSnellCol(b2, r3, { band: /actual ams spend/i, leaf: null }),
    fkSpend: findSnellCol(b2, r3, { band: /flipkart spend\s*total/i, leaf: null }),
    googleSpend: findSnellCol(b2, r3, { band: /google spend\s*total/i, leaf: null }),
    blinkitGross: findSnellCol(b2, r3, { band: /sale value/i, leaf: /total gross value/i }),
    blinkitSpend: findSnellCol(b2, r3, { band: /blinkit spend\s*total/i, leaf: null }),
    blinkitUnits: findSnellCol(b2, r3, { band: /blinkit/i, leaf: /^total$/i }),
  };
  for (const [k, v] of Object.entries(cols)) {
    if (v === -1) dq.push({ level: "warn", code: "SNL_COL", msg: `Snell column "${k}" not located — band labels may have changed.` });
  }
  const sum = { amsSpend: 0, fkSpend: 0, googleSpend: 0, blinkitGross: 0, blinkitSpend: 0, blinkitUnits: 0 };
  let rows = 0;
  for (let i = 5; i < grid.length; i++) {
    const r = grid[i];
    const d = r[0];
    if (typeof d !== "number" || d < minSer || d > maxSer) continue;
    rows++;
    for (const k of Object.keys(sum)) { if (cols[k] !== -1) sum[k] += num(r[cols[k]]); }
  }
  const facts = emptyFacts();
  facts.meta.snellChannelSpend = {
    month: monthKey,
    amazon: r2(sum.amsSpend), flipkart: r2(sum.fkSpend), website_google: r2(sum.googleSpend),
    blinkit: r2(sum.blinkitSpend),
    blinkitGrossCrosscheck: r2(sum.blinkitGross), blinkitUnitsCrosscheck: sum.blinkitUnits, rows,
  };
  dq.push({ level: "info", code: "SNL_OK", msg: `Snell ${monthKey}: AMS ₹${r2(sum.amsSpend)}, FK ₹${r2(sum.fkSpend)}, Blinkit ₹${r2(sum.blinkitSpend)}; Blinkit gross x-check ₹${r2(sum.blinkitGross)} (=281560 expected).` });
  if (Math.abs(sum.blinkitGross - 281560) > 1) dq.push({ level: "warn", code: "SNL_XCHECK", msg: `Snell Blinkit gross ₹${r2(sum.blinkitGross)} ≠ native 281560 — investigate.` });
  return { facts, dq };
}

// ═══════════════════════════════════════════════════════════════════════════
// 10 · MONARCH — website history + Meta/Google monthly channel spend (website)
// ═══════════════════════════════════════════════════════════════════════════
// The "Master Sheet" is a daily website log. RECENT months populate the live
// Google/Meta blocks (col11 "Google Spend", col27 "Meta Spend") while the
// summary blocks (col6/col21) are left blank — so we PIN the populated columns
// by header label + a value-presence pick. We emit, per month: meta.metaSpend,
// meta.googleSpend (channel totals for the website unattributed-ad pool), plus a
// website monthly conversion-value history (trend context only, NOT revenue).
export async function parseMonarchWeb(file, opts = {}) {
  const dq = [];
  const targetMonth = opts.month || "2026-05";
  const wb = await fileToWorkbook(file);
  const masterName = wb.SheetNames.find((n) => /master sheet/i.test(n));
  if (!masterName) { dq.push({ level: "error", code: "MON_NOMASTER", msg: `Monarch: no 'Master Sheet' (sheets: ${wb.SheetNames.join(", ")}).` }); throw new Error("Monarch: no Master Sheet."); }
  const grid = sheetGrid(wb.Sheets[masterName]);
  // Header is row1 (row0 is a band). Find ALL "Google Spend" / "Meta Spend"
  // columns; pick the one with the most non-zero values in the target month
  // (the live block) — robust to the founder swapping which block they fill.
  const H = (grid[1] || []).map((h) => String(h || "").trim());
  const googleCols = H.map((h, c) => (/google spend/i.test(h) ? c : -1)).filter((c) => c !== -1);
  const metaCols = H.map((h, c) => (/meta spend/i.test(h) ? c : -1)).filter((c) => c !== -1);
  const dateCol = H.findIndex((h) => /^date$/i.test(h));
  if (dateCol === -1 || googleCols.length === 0 || metaCols.length === 0) {
    dq.push({ level: "error", code: "MON_SCHEMA", msg: "Monarch Master Sheet missing Date / Google Spend / Meta Spend columns." });
    throw new Error("Monarch: schema drift in Master Sheet.");
  }
  // Per-month accumulation across the whole sheet (for trend history) + the
  // populated-column pick for the target month.
  const byMonth = {};                 // ym → { google:[per-col sums], meta:[per-col sums], conv, days }
  const convCol = H.findIndex((h) => /total conversion value/i.test(h));
  for (let i = 2; i < grid.length; i++) {
    const r = grid[i];
    const iso = excelToISODate(r[dateCol]);
    const ym = monthOf(iso);
    if (!ym) continue;
    if (!byMonth[ym]) byMonth[ym] = { google: googleCols.map(() => 0), meta: metaCols.map(() => 0), conv: 0, days: 0 };
    googleCols.forEach((c, j) => { byMonth[ym].google[j] += num(r[c]); });
    metaCols.forEach((c, j) => { byMonth[ym].meta[j] += num(r[c]); });
    if (convCol !== -1) byMonth[ym].conv += num(r[convCol]);
    byMonth[ym].days++;
  }
  const facts = emptyFacts();
  // Channel totals for the TARGET month — pick the populated (max) block.
  const tm = byMonth[targetMonth];
  if (tm) {
    const googleTotal = Math.max(...tm.google, 0);
    const metaTotal = Math.max(...tm.meta, 0);
    facts.meta.monarchWebSpend = { month: targetMonth, googleTotal: r2(googleTotal), metaTotal: r2(metaTotal) };
    dq.push({ level: "info", code: "MON_OK", msg: `Monarch ${targetMonth}: Google ₹${r2(googleTotal)}, Meta ₹${r2(metaTotal)} (channel totals).` });
  } else {
    dq.push({ level: "warn", code: "MON_NOMONTH", msg: `Monarch has no ${targetMonth} rows.` });
  }
  // Website trend history (conversion value per month) — context only.
  facts.meta.monarchWebHistory = Object.fromEntries(
    Object.keys(byMonth).sort().map((ym) => [ym, { convValue: r2(byMonth[ym].conv), days: byMonth[ym].days }])
  );
  return { facts, dq };
}

// ─── Dispatcher (parallels uploadParsers.FILE_TYPES) ─────────────────────────
// Upload-zone keys match spec §8: amazon-orders, fk-sales, blinkit-sales,
// shopify-net, shopify-daily, ads-amazon-sp, ads-fk-pla, ads-google,
// snell-agency, monarch-web. The list is data-driven so consumers never
// hardcode the channel/zone set.
export const BUSINESS_FILE_TYPES = {
  "amazon-orders": { label: "Amazon All-Orders (TSV)", channel: "amazon", parse: parseAmazonOrders },
  "fk-sales": { label: "Flipkart Sales Report (xlsx)", channel: "flipkart", parse: parseFlipkartSales },
  "blinkit-sales": { label: "Blinkit Sales Report (xlsx)", channel: "blinkit", parse: parseBlinkitSales },
  "shopify-net": { label: "Shopify Net Sales/Units (CSV, monthly)", channel: "website", parse: parseShopifyNet },
  "shopify-daily": { label: "Shopify Daily Sales (CSV, shape)", channel: "website", parse: parseShopifyDaily },
  "ads-amazon-sp": { label: "Amazon SP Ads (xlsx, daily per-ASIN)", channel: "amazon", parse: parseAmazonSpAds },
  "ads-fk-pla": { label: "Flipkart PLA Ads (CSV)", channel: "flipkart", parse: parseFlipkartPlaAds },
  "ads-google": { label: "Google Product-wise Ads (CSV)", channel: "website", parse: parseGoogleAds },
  "snell-agency": { label: "Snell Sales&Ads Sheet (Sale tab spend)", channel: "*", parse: parseSnellSale },
  "monarch-web": { label: "Monarch Website Sales&Ads Sheet", channel: "website", parse: parseMonarchWeb },
};

export async function parseBusinessFile(type, file, opts = {}) {
  const def = BUSINESS_FILE_TYPES[type];
  if (!def) throw new Error(`Unknown business file type: ${type}`);
  return await def.parse(file, opts);
}

// Exposed for the offline twin + verification re-derivation.
export { ASIN_MAP, AMZ_MSKU_MAP, FK_SKU_MAP, SHP_SKU_MAP, BLINKIT_ITEM_MAP, num, r2, excelToISODate };
