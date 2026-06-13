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

// ─── Snell "Categorywise" tab header → canonical code (V2) ───────────────────
// The three Categorywise tabs (AMZ/FK/Blinkit) carry one DAILY units column per
// SKU, headered with a free-text product title (verified 2026-06-12). `*N`
// columns are multipack order-counts that FOLD into the base code as units×N.
// CRITICAL distinction the titles encode: "Sea Buckthorn Berries 100g" = DRY
// BERRIES (NSSBDB*), while "Sea Buckthorn powder 100g" = POWDER (NSSB*) — two
// different product lines that must never be conflated.
function snellCatHeaderToCode(title) {
  const t = String(title || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!t || t === "date" || t === "total") return null;
  // multipack multiplier (e.g. "...100g*2", "jatamansi oil*4")
  const mult = (() => { const m = t.match(/\*\s*(\d+)\s*$/); return m ? parseInt(m[1], 10) || 1 : 1; })();
  const base = t.replace(/\*\s*\d+\s*$/, "").trim();
  const grams = (base.match(/(\d+)\s*(?:g|gm|ml)\b/) || [])[1] || null;
  let code = null;
  if (/jatamansi/.test(base)) code = "NSJO100";
  else if (/acacia catechu/.test(base)) code = "NSACDT30";
  else if (/sea buckthorn oil/.test(base)) code = grams === "15" ? "NSSBBO15" : grams === "30" ? "NSSBBO30" : null;
  else if (/sea buckthorn juice/.test(base)) code = grams === "300" ? "NSSBJ300" : grams === "500" ? "NSSBJ500" : null;
  else if (/moringa powder/.test(base)) code = grams === "100" ? "NSMP100" : grams === "250" ? "NSMP250" : null;
  else if (/sea buckthorn berries/.test(base)) code = { "100": "NSSBDB100", "250": "NSSBDB250", "500": "NSSBDB500" }[grams] || null;
  else if (/sea buckthorn powder/.test(base)) code = { "100": "NSSB100", "250": "NSSB250", "500": "NSSB500" }[grams] || null;
  return code ? { code, mult } : null;
}

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

// ─── Channel-grain accumulators (V2) ─────────────────────────────────────────
// Channel-grain facts live under the reserved code sentinel "__ch__" so they
// never collide with per-SKU cells and are skipped by SKU-grain consumers
// (cmEngine, businessVerification — see businessStore.CH_CODE). Each cell carries
// {units, grossRev, netRev, adSpend, tier, source}. Monthly + daily variants.
const CH_CODE = "__ch__";
function bumpChannelMonthly(facts, month, channel, fields, tier, source) {
  const key = `${month}|${channel}|${CH_CODE}`;
  const cur = facts.monthly[key] || { units: 0, grossRev: 0, netRev: 0, adSpend: 0 };
  for (const f of ["units", "grossRev", "netRev", "adSpend"]) if (fields[f] !== undefined) cur[f] = r2((cur[f] || 0) + num(fields[f]));
  cur.tier = tier; cur.source = source;
  facts.monthly[key] = cur;
}
function bumpChannelDaily(facts, date, channel, fields, tier, source) {
  const key = `${date}|${channel}|${CH_CODE}`;
  const cur = facts.daily[key] || { units: 0, grossRev: 0, netRev: 0, adSpend: 0 };
  for (const f of ["units", "grossRev", "netRev", "adSpend"]) if (fields[f] !== undefined) cur[f] = r2((cur[f] || 0) + num(fields[f]));
  cur.tier = tier; cur.source = source;
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
    state: col("ship-state"), postal: col("ship-postal-code"),
  };
  for (const [k, v] of Object.entries(C)) {
    // ship-state/postal are OPTIONAL (geo cut g) — their absence must NOT fail the
    // core parse, only suppress the geo aggregation. Required columns still throw.
    if (v === -1 && k !== "state" && k !== "postal") { dq.push({ level: "error", code: "AMZ_SCHEMA", msg: `Amazon All-Orders missing column for "${k}".` }); throw new Error(`Amazon All-Orders: missing expected column (${k}). Schema drift.`); }
  }
  const facts = emptyFacts();
  const mcf = {};            // code → mcf units (website-fulfilment proxy for mcfShare)
  let mcfTotal = 0, unmapped = 0, returnUnits = 0, returnValue = 0;
  const dates = new Set();
  // (g) GEO: monthly per-state demand/returns concentration. "YYYY-MM|STATE" →
  // { units, netRev, returns }. Mirrors build-business-data.buildAmazon exactly.
  const geo = {};
  const bumpGeo = (m, st, q, rev, isReturn) => {
    const state = String(st || "").trim().toUpperCase() || "UNKNOWN";
    const k = `${m}|${state}`;
    const cur = geo[k] || { units: 0, netRev: 0, returns: 0 };
    if (isReturn) { cur.units -= q; cur.netRev = r2(cur.netRev - rev / 1.05); cur.returns += q; }
    else { cur.units += q; cur.netRev = r2(cur.netRev + rev / 1.05); }
    geo[k] = cur;
  };

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
    const st = C.state === -1 ? "" : cells[C.state];
    if (isReturn) {
      bumpMonthly(facts, month, "amazon", code, {
        units: -q, grossRev: -rev, netRev: -rev / 1.05, returnsUnits: q, returnsValue: rev,
      });
      returnUnits += q; returnValue += rev; bumpGeo(month, st, q, rev, true);
    } else {
      bumpMonthly(facts, month, "amazon", code, { units: q, grossRev: rev, netRev: rev / 1.05 });
      bumpGeo(month, st, q, rev, false);
    }
  }

  for (const k of Object.keys(geo)) geo[k].netRev = r2(geo[k].netRev);
  facts.meta.mcf = { byCode: mcf, totalUnits: mcfTotal };
  facts.meta.amazonReturns = { units: returnUnits, value: r2(returnValue) };
  facts.meta.geo = { source: "amazon-all-orders ship-state", byMonthState: geo };
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
  // (d) Trended BY MONTH from the cashback sheet's "Invoice Date" so it reads as a
  // settlement-drag signal over time, not just one lump.
  const cbSheet = wb.SheetNames.find((n) => /cash\s*back/i.test(n));
  if (cbSheet) {
    const cg = sheetGrid(wb.Sheets[cbSheet]);
    const ch = cg[0] || [];
    const ia = ch.indexOf("Invoice Amount"); const idc = ch.indexOf("Invoice Date");
    let cb = 0, cn = 0; const cbByMonth = {};
    if (ia !== -1) for (let i = 1; i < cg.length; i++) {
      if (!cg[i] || cg[i][ia] === "") continue;
      const v = num(cg[i][ia]); cb += v; cn++;
      const ym = idc !== -1 ? monthOf(excelToISODate(cg[i][idc])) : null;
      const key = ym || "unknown";
      const mm = cbByMonth[key] || { value: 0, rows: 0 };
      mm.value = r2(mm.value + v); mm.rows++; cbByMonth[key] = mm;
    }
    facts.meta.flipkartCashback = { value: r2(cb), rows: cn, byMonth: cbByMonth };
    dq.push({ level: "info", code: "FK_CASHBACK", msg: `Flipkart cashback ₹${r2(cb)} (${cn} notes, ${Object.keys(cbByMonth).length} months) — excluded from CM, reported as net-realization/settlement-drag note.` });
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
// 9b · SNELL "Sale" tab — FULL DAILY CHANNEL-GRAIN HISTORY (V2, tier: agency)
// ═══════════════════════════════════════════════════════════════════════════
// Emits channel-grain DAILY + MONTHLY-rollup facts {units, grossRev, netRev,
// adSpend} for amazon/flipkart/blinkit across the WHOLE Sale-tab history
// (Amazon Aug-2024→, FK Jun-2025→, Blinkit Dec-2025→, incl June-2026 to date).
// Column choices PINNED + reconciled against native May (documented per channel):
//   amazon   gross = c20 (Total Gross Value); net = c22 (Final Net Without
//            Review) AS-IS [M1 fix 2026-06-12]; units = c7 (Total Shipped). c22 is
//            ALREADY net-of-GST (Snell's net column) — the earlier ÷1.05 double-
//            discounted every agency Amazon month ~5%. Native-May reconcile:
//            c22 = 1,213,769 vs native 1,143,450 → +6.15% (return-tail/review
//            timing; native wins per V2.1 so the agency figure is shadow-only).
//            adSpend = c23 (Actual AMS Spend).
//   flipkart gross = c40 (Sale Value Gross FBF+NONFBF); net = c43 (Total Net
//            Value) AS-IS (Snell's net is already net-of-GST realized, like the
//            native BIA — May c43 = 274,451 vs native BIA 271,408 → +1.12%, so
//            NO ÷1.05). units = c35 (Total Shipped). adSpend = c44 (FK Spend Total).
//   blinkit  gross = c53 (Sale Value Total Gross — May = 281,560 = native EXACT);
//            Snell's "net" col equals gross (no tax netting) so net = gross ÷ 1.05
//            (native net/gross = 268,153/281,560 = 0.95238 = 1/1.05). units = c52
//            (Blinkit Total). adSpend = c56 (Blinkit Spend Total).
// A channel-day with ALL of {units, gross, net, adSpend} zero is skipped (no
// coverage) so pre-launch zero rows never create phantom coverage. Returns
// channel-grain facts (monthly + daily) under "__ch__", plus meta.snellHistory
// with the May reconciliation deltas.
const SNELL_NET_DIVISOR_BLINKIT = 1.05; // Snell blinkit "net" == gross; ex-GST = ÷1.05
export async function parseSnellHistory(file, _opts = {}) {
  const dq = [];
  const wb = await fileToWorkbook(file);
  const saleSheet = wb.SheetNames.find((n) => /^sale\s*$/i.test(n) || /^sale$/i.test(n.trim()));
  if (!saleSheet) { dq.push({ level: "error", code: "SNH_NOSALE", msg: `Snell workbook has no 'Sale' tab (sheets: ${wb.SheetNames.join(", ")}).` }); throw new Error("Snell history: no 'Sale' tab."); }
  const grid = sheetGrid(wb.Sheets[saleSheet]);
  if (grid.length < 6) { dq.push({ level: "error", code: "SNH_SHORT", msg: "Snell Sale tab too short." }); throw new Error("Snell history: Sale tab too short."); }
  const b2 = ffRow(grid[2] || []);
  const r3 = grid[3] || [];
  // Resolve the channel-grain columns by header band/leaf (never positional).
  const C = {
    amzUnits: findSnellCol(b2, r3, { band: /^total$/i, leaf: /shipped units/i }),       // c7 Amazon Total Shipped Units
    amzGross: findSnellCol(b2, r3, { band: /total gross value/i, leaf: null }),          // c20
    amzNet: findSnellCol(b2, r3, { band: /final net without review/i, leaf: null }),     // c22
    amzAd: findSnellCol(b2, r3, { band: /actual ams spend/i, leaf: null }),              // c23
    fkUnits: findSnellCol(b2, r3, { band: /^total$/i, leaf: /^shipped$/i }),             // c35 FK Total Shipped
    fkGross: findSnellCol(b2, r3, { band: /sale value gross/i, leaf: /fbf \+ nonfbf/i }),// c40
    fkNet: findSnellCol(b2, r3, { band: /sale value net/i, leaf: /total net value/i }),  // c43
    fkAd: findSnellCol(b2, r3, { band: /flipkart spend\s*total/i, leaf: null }),         // c44
    bkUnits: findSnellCol(b2, r3, { band: /blinkit/i, leaf: /^total$/i }),               // c52 Blinkit Total
    bkGross: findSnellCol(b2, r3, { band: /sale value/i, leaf: /total gross value/i }),  // c53
    bkAd: findSnellCol(b2, r3, { band: /blinkit spend\s*total/i, leaf: null }),          // c56
  };
  for (const [k, v] of Object.entries(C)) {
    if (v === -1) dq.push({ level: "warn", code: "SNH_COL", msg: `Snell history column "${k}" not located — band labels may have changed.` });
  }
  const facts = emptyFacts();
  const get = (r, c) => (c === -1 ? 0 : num(r[c]));
  const span = {};          // channel → {first, last}
  const mayCheck = { amazonNet: 0, flipkartNet: 0, blinkitGross: 0 };
  let dayRows = 0;
  for (let i = 5; i < grid.length; i++) {
    const r = grid[i];
    const d = r[0];
    if (typeof d !== "number" || d < 30000 || d > 80000) continue; // numeric Excel serial only
    const iso = excelToISODate(d);
    const month = monthOf(iso);
    if (!month) continue;
    dayRows++;
    const channels = [
      // M1 FIX (2026-06-12): c22 "Final Net Without Review" is ALREADY net-of-GST →
      // use AS-IS. Prior ÷1.05 double-discounted agency Amazon ~5% every month.
      { ch: "amazon",   units: get(r, C.amzUnits), gross: get(r, C.amzGross), net: get(r, C.amzNet),          ad: get(r, C.amzAd) },
      { ch: "flipkart", units: get(r, C.fkUnits),  gross: get(r, C.fkGross),  net: get(r, C.fkNet),          ad: get(r, C.fkAd) },
      { ch: "blinkit",  units: get(r, C.bkUnits),  gross: get(r, C.bkGross),  net: get(r, C.bkGross) / SNELL_NET_DIVISOR_BLINKIT, ad: get(r, C.bkAd) },
    ];
    for (const x of channels) {
      if (!x.units && !x.gross && !x.net && !x.ad) continue;     // no coverage that channel-day → skip
      const fields = { units: x.units, grossRev: x.gross, netRev: x.net, adSpend: x.ad };
      bumpChannelDaily(facts, iso, x.ch, fields, "agency", "snell-history");
      bumpChannelMonthly(facts, month, x.ch, fields, "agency", "snell-history");
      if (!span[x.ch]) span[x.ch] = { first: iso, last: iso };
      span[x.ch].last = iso; if (iso < span[x.ch].first) span[x.ch].first = iso;
      if (month === "2026-05") {
        if (x.ch === "amazon") mayCheck.amazonNet += x.net;
        if (x.ch === "flipkart") mayCheck.flipkartNet += x.net;
        if (x.ch === "blinkit") mayCheck.blinkitGross += x.gross;
      }
    }
  }
  // May reconciliation deltas (agency vs native anchors) — documented in meta.
  const NATIVE = { amazonNet: 1143449.84, flipkartNet: 272842.99, blinkitGross: 281560 };
  const recon = {};
  for (const k of Object.keys(NATIVE)) {
    const agency = r2(mayCheck[k]);
    const native = NATIVE[k];
    recon[k] = { agency, native, delta: r2(agency - native), deltaPct: native ? r2((agency - native) / native * 100) : null };
  }
  facts.meta.snellHistory = {
    tier: "agency", source: "snell-history",
    channelSpan: span,
    netColumnChoice: {
      amazon: "Final Net Without Review (c22) AS-IS — M1 fix 2026-06-12: ALREADY net-of-GST; prior ÷1.05 double-discounted ~5%. May agency 1,213,769 = +6.15% vs native 1,143,450 (return-tail timing; native wins per V2.1).",
      flipkart: "Total Net Value (c43) AS-IS — Snell net == realized net-of-GST like native BIA; +0.59% vs native May",
      blinkit: "Gross (c53) ÷ 1.05 — Snell has no tax-netted net column; native net/gross ratio = 0.95238 = 1/1.05",
    },
    mayReconciliation: recon,
  };
  dq.push({ level: "info", code: "SNH_OK", msg: `Snell history: ${dayRows} day-rows → ${Object.keys(facts.daily).length} daily + ${Object.keys(facts.monthly).length} monthly channel-grain cells. May recon Δ: amzNet ${recon.amazonNet.deltaPct}% / fkNet ${recon.flipkartNet.deltaPct}% / bkGross ${recon.blinkitGross.deltaPct}%.` });
  return { facts, dq };
}

// ═══════════════════════════════════════════════════════════════════════════
// 9c · SNELL "Categorywise" tabs — DAILY PER-SKU UNITS (V2, tier: agency)
// ═══════════════════════════════════════════════════════════════════════════
// The three Categorywise tabs hold DAILY per-SKU UNITS only (never revenue).
// AMZ tab Aug-2024→, FK tab Jun-2025→, Blinkit tab Dec-2025→. One units column
// per SKU header (snellCatHeaderToCode); `*N` columns fold into the base code as
// units × N. Emits SKU-grain UNITS facts (units only; netRev/grossRev untouched
// so these can NEVER masquerade as revenue) tagged tier "agency". Daily + monthly.
const SNELL_CAT_TABS = [
  { re: /amz\s*categorywise/i, channel: "amazon" },
  { re: /fk\s*categorywise/i, channel: "flipkart" },
  { re: /blinkit\s*categorywise/i, channel: "blinkit" },
];
// Agency per-SKU UNITS are a revenue-LESS series (cross-check / shape only). To
// guarantee they can NEVER double-count against native per-SKU revenue facts,
// they are NOT written into facts.monthly/facts.daily (the SKU-revenue keyspace
// the verification anchors + cmEngine sum). Instead they live in a dedicated,
// clearly-labelled meta structure: meta.snellSkuUnits = { perChannel, monthly:
// {"YYYY-MM|channel|CODE": units}, daily: {"YYYY-MM-DD|channel|CODE": units} }.
// Native > agency precedence is therefore structural (separate namespace) and
// order-independent; the UI reads agency units only where native is absent.
export async function parseSnellSkuUnits(file, _opts = {}) {
  const dq = [];
  const wb = await fileToWorkbook(file);
  const facts = emptyFacts();
  const perChannel = {};
  const skuMonthly = {};   // "YYYY-MM|channel|CODE" → units
  const skuDaily = {};     // "YYYY-MM-DD|channel|CODE" → units
  const addU = (map, key, u) => { map[key] = r2((map[key] || 0) + u); };
  for (const tabDef of SNELL_CAT_TABS) {
    const name = wb.SheetNames.find((n) => tabDef.re.test(String(n).trim()));
    if (!name) { dq.push({ level: "warn", code: "SCU_NOTAB", msg: `Snell Categorywise tab for ${tabDef.channel} not found.` }); continue; }
    const grid = sheetGrid(wb.Sheets[name]);
    if (grid.length < 3) { dq.push({ level: "warn", code: "SCU_SHORT", msg: `Snell Categorywise '${name}' too short.` }); continue; }
    // Map each data column to a base code (+ fold mult) from the header (row 0).
    const header = grid[0] || [];
    const colMap = {};      // colIndex → { code, mult }
    let mapped = 0;
    for (let c = 1; c < header.length; c++) {
      const hit = snellCatHeaderToCode(header[c]);
      if (hit) { colMap[c] = hit; mapped++; }
    }
    if (mapped === 0) { dq.push({ level: "warn", code: "SCU_NOCOLS", msg: `Snell Categorywise '${name}': no SKU columns mapped.` }); continue; }
    let dayRows = 0, units = 0; const span = { first: null, last: null };
    // (I/b) Capture the tab's own "Total" row (sheet headline per-SKU total, *N
    // folded) — surfaces every Categorywise field AND supports daily-vs-total recon.
    const tabTotal = {}; let tabTotalUnits = 0;
    for (let i = 1; i < Math.min(grid.length, 6); i++) {
      if (String(grid[i][0] || "").trim().toLowerCase() !== "total") continue;
      for (const c of Object.keys(colMap)) { const { code, mult } = colMap[c]; const u = num(grid[i][c]) * mult; if (!u) continue; tabTotal[code] = r2((tabTotal[code] || 0) + u); tabTotalUnits += u; }
      break;
    }
    for (let i = 1; i < grid.length; i++) {
      const r = grid[i];
      const d = r[0];
      if (typeof d !== "number" || d < 30000 || d > 80000) continue; // skip "Total"/label rows
      const iso = excelToISODate(d);
      const month = monthOf(iso);
      if (!month) continue;
      dayRows++;
      if (!span.first) span.first = iso; span.last = iso;
      for (const c of Object.keys(colMap)) {
        const { code, mult } = colMap[c];
        const u = num(r[c]) * mult;       // *N folds: 1 N-pack order = N base units
        if (!u) continue;
        addU(skuDaily, `${iso}|${tabDef.channel}|${code}`, u);
        addU(skuMonthly, `${month}|${tabDef.channel}|${code}`, u);
        units += u;
      }
    }
    perChannel[tabDef.channel] = { tab: name, mappedCols: mapped, dayRows, units, span, tabTotal, tabTotalUnits, dailySeriesUnits: units };
  }
  facts.meta.snellSkuUnits = { tier: "agency", source: "snell-cat", perChannel, monthly: skuMonthly, daily: skuDaily };
  const summary = Object.entries(perChannel).map(([ch, v]) => `${ch} ${v.units}u`).join(", ");
  dq.push({ level: "info", code: "SCU_OK", msg: `Snell SKU units: ${summary || "no tabs"}; ${Object.keys(skuMonthly).length} monthly + ${Object.keys(skuDaily).length} daily agency SKU-unit cells (meta, units only).` });
  return { facts, dq };
}

// ═══════════════════════════════════════════════════════════════════════════
// 9d · SNELL "Sale" tab — ORDER-MIX decomposition + Total-row reconciliation
// ═══════════════════════════════════════════════════════════════════════════
// (a) Amazon Non-Advt / Review / Organic ORDER decomposition over time:
//     c12 Non Advt order Units, c13 Review Oder Units, c14 Organic Order Units;
//     c18 Review Oder AMT, c19 Organic Order AMT. Rolled monthly on the amazon
//     channel (this split exists only for amazon). (b) The sheet's own "Total"
//     row (r4) differs from the daily-series sum (it is a narrower founder window);
//     both are captured so the UI can reconcile the gap. Twin of build-business-
//     data.buildSnellOrderMix. SHAPE: meta.snellOrderMix = { byMonth, reconciliation }.
const SNELL_MIX_FALLBACK = { amzShipUnits: 7, amzGross: 20, nonAdvt: 12, review: 13, organic: 14, reviewAmt: 18, organicAmt: 19 };
export async function parseSnellOrderMix(file, _opts = {}) {
  const dq = [];
  const wb = await fileToWorkbook(file);
  const saleSheet = wb.SheetNames.find((n) => /^sale\s*$/i.test(n) || /^sale$/i.test(n.trim()));
  if (!saleSheet) { dq.push({ level: "error", code: "SOM_NOSALE", msg: `Snell workbook has no 'Sale' tab (sheets: ${wb.SheetNames.join(", ")}).` }); throw new Error("Snell order-mix: no 'Sale' tab."); }
  const grid = sheetGrid(wb.Sheets[saleSheet]);
  if (grid.length < 6) { dq.push({ level: "error", code: "SOM_SHORT", msg: "Snell Sale tab too short." }); throw new Error("Snell order-mix: Sale tab too short."); }
  const b2 = ffRow(grid[2] || []); const r3 = grid[3] || [];
  const C = {
    amzShipUnits: findSnellCol(b2, r3, { band: /^total$/i, leaf: /shipped units/i }),
    amzGross: findSnellCol(b2, r3, { band: /total gross value/i, leaf: null }),
    nonAdvt: findSnellCol(b2, r3, { band: /sales value/i, leaf: /non advt order units/i }),
    review: findSnellCol(b2, r3, { band: /sales value/i, leaf: /review oder units/i }),
    organic: findSnellCol(b2, r3, { band: /sales value/i, leaf: /organic order units/i }),
    reviewAmt: findSnellCol(b2, r3, { band: /sales value/i, leaf: /review oder amt/i }),
    organicAmt: findSnellCol(b2, r3, { band: /sales value/i, leaf: /organic order amt/i }),
  };
  const fellBack = [];
  for (const k of Object.keys(SNELL_MIX_FALLBACK)) { if (C[k] === -1) { C[k] = SNELL_MIX_FALLBACK[k]; fellBack.push(k); dq.push({ level: "warn", code: "SOM_COLFALLBACK", msg: `Snell order-mix column "${k}" not located by header — used pinned position ${SNELL_MIX_FALLBACK[k]}.` }); } }
  const byMonth = {};
  const daily = { shippedUnits: 0, grossValue: 0, nonAdvtUnits: 0, reviewUnits: 0, organicUnits: 0, reviewAmt: 0, organicAmt: 0, dayRows: 0 };
  for (let i = 5; i < grid.length; i++) {
    const r = grid[i]; const d = r[0];
    if (typeof d !== "number" || d < 30000 || d > 80000) continue;
    const ym = monthOf(excelToISODate(d)); if (!ym) continue;
    const na = num(r[C.nonAdvt]), rv = num(r[C.review]), og = num(r[C.organic]);
    const rvA = num(r[C.reviewAmt]), ogA = num(r[C.organicAmt]);
    daily.shippedUnits += num(r[C.amzShipUnits]); daily.grossValue += num(r[C.amzGross]);
    daily.nonAdvtUnits += na; daily.reviewUnits += rv; daily.organicUnits += og;
    daily.reviewAmt += rvA; daily.organicAmt += ogA; daily.dayRows++;
    if (!na && !rv && !og && !rvA && !ogA) continue;
    const b = byMonth[ym] || { channel: "amazon", nonAdvtUnits: 0, reviewUnits: 0, organicUnits: 0, reviewAmt: 0, organicAmt: 0 };
    b.nonAdvtUnits += na; b.reviewUnits += rv; b.organicUnits += og; b.reviewAmt += rvA; b.organicAmt += ogA;
    byMonth[ym] = b;
  }
  for (const ym of Object.keys(byMonth)) { const b = byMonth[ym]; b.reviewAmt = r2(b.reviewAmt); b.organicAmt = r2(b.organicAmt); }
  const tr = grid[4] || [];
  const totalRow = {
    shippedUnits: num(tr[C.amzShipUnits]), grossValue: r2(num(tr[C.amzGross])),
    nonAdvtUnits: num(tr[C.nonAdvt]), reviewUnits: num(tr[C.review]), organicUnits: num(tr[C.organic]),
  };
  const dailySeries = {
    shippedUnits: daily.shippedUnits, grossValue: r2(daily.grossValue),
    nonAdvtUnits: daily.nonAdvtUnits, reviewUnits: daily.reviewUnits, organicUnits: daily.organicUnits,
    reviewAmt: r2(daily.reviewAmt), organicAmt: r2(daily.organicAmt), dayRows: daily.dayRows,
  };
  const facts = emptyFacts();
  facts.meta.snellOrderMix = {
    source: "snell-ordermix", tier: "agency", byMonth,
    reconciliation: {
      totalRow, dailySeries,
      deltaUnits: dailySeries.shippedUnits - totalRow.shippedUnits,
      deltaGross: r2(dailySeries.grossValue - totalRow.grossValue),
      note: "Snell's own 'Total' row (r4) is a founder-curated narrower window and does NOT equal the sum of the daily rows. Both surfaced so the gap (daily-series − Total-row) is an explicit reconciliation, never a hidden inconsistency.",
    },
    columns: C, columnFallbacks: fellBack,
  };
  dq.push({ level: "info", code: "SOM_OK", msg: `Snell order-mix: ${Object.keys(byMonth).length} months; Total-row ${totalRow.shippedUnits}u/₹${totalRow.grossValue} vs daily-series ${dailySeries.shippedUnits}u/₹${dailySeries.grossValue}.` });
  return { facts, dq };
}

// ═══════════════════════════════════════════════════════════════════════════
// 10b · MONARCH — FULL DAILY WEBSITE HISTORY (V2, tier: monarch)
// ═══════════════════════════════════════════════════════════════════════════
// Master Sheet = DAILY website log Jun-2025→ (13 mo, incl June-2026 to date).
// Emits website channel-grain DAILY + MONTHLY facts:
//   grossRev = col4 (Total Conversion Value — GST-inclusive gross conversion
//              value; the website TREND series, NOT the authoritative net which
//              is Shopify net per spec §1.3). units = col1 (Total Sales =
//              order count). adSpend = liveGoogle + liveMeta.
//   netSales (col1 Total Sales) is the order-COUNT, mapped to `units`; cancels =
//   col2 (Total Cancel Order). Google/Meta each have a summary col (6/21) and a
//   live col (11/27); from Dec-2025 the summary cols zero out and the live cols
//   carry the value, so we take the MAX of the candidate columns per month/day
//   (robust to which block the founder fills). Emitted as channel-grain adSpend
//   plus a per-month meta.monarchHistory {grossConvValue, orders, cancels,
//   googleSpend, metaSpend, days, partial}.
export async function parseMonarchHistory(file, _opts = {}) {
  const dq = [];
  const wb = await fileToWorkbook(file);
  const masterName = wb.SheetNames.find((n) => /master sheet/i.test(n));
  if (!masterName) { dq.push({ level: "error", code: "MNH_NOMASTER", msg: `Monarch: no 'Master Sheet' (sheets: ${wb.SheetNames.join(", ")}).` }); throw new Error("Monarch history: no Master Sheet."); }
  const grid = sheetGrid(wb.Sheets[masterName]);
  const H = (grid[1] || []).map((h) => String(h || "").trim());
  const dateCol = H.findIndex((h) => /^date$/i.test(h));
  const salesCol = H.findIndex((h) => /^total sales$/i.test(h));
  const cancelCol = H.findIndex((h) => /total cancel/i.test(h));
  const convCol = H.findIndex((h) => /total conversion value/i.test(h));
  const googleCols = H.map((h, c) => (/google spend/i.test(h) ? c : -1)).filter((c) => c !== -1);
  const metaCols = H.map((h, c) => (/meta spend/i.test(h) ? c : -1)).filter((c) => c !== -1);
  if (dateCol === -1 || googleCols.length === 0 || metaCols.length === 0) {
    dq.push({ level: "error", code: "MNH_SCHEMA", msg: "Monarch Master Sheet missing Date / Google Spend / Meta Spend columns." });
    throw new Error("Monarch history: schema drift in Master Sheet.");
  }
  const facts = emptyFacts();
  const byMonth = {};   // ym → { gConv, orders, cancels, gCols:[], mCols:[], days, lastDay }
  let firstISO = null, lastISO = null;
  for (let i = 2; i < grid.length; i++) {
    const r = grid[i];
    const iso = excelToISODate(r[dateCol]);
    const ym = monthOf(iso);
    if (!ym) continue;
    const conv = convCol !== -1 ? num(r[convCol]) : 0;
    const orders = salesCol !== -1 ? num(r[salesCol]) : 0;
    const cancels = cancelCol !== -1 ? num(r[cancelCol]) : 0;
    const google = Math.max(0, ...googleCols.map((c) => num(r[c])));
    const meta = Math.max(0, ...metaCols.map((c) => num(r[c])));
    const ad = google + meta;
    // Skip fully-blank future-dated rows (no conv, no orders, no spend).
    if (!conv && !orders && !cancels && !ad) continue;
    if (!firstISO) firstISO = iso; lastISO = iso;
    // Daily channel-grain website fact: grossRev = gross conv value, units = orders.
    bumpChannelDaily(facts, iso, "website", { units: orders, grossRev: conv, adSpend: ad }, "monarch", "monarch-history");
    bumpChannelMonthly(facts, ym, "website", { units: orders, grossRev: conv, adSpend: ad }, "monarch", "monarch-history");
    if (!byMonth[ym]) byMonth[ym] = { gConv: 0, orders: 0, cancels: 0, google: 0, meta: 0, days: 0, lastDay: iso };
    const b = byMonth[ym];
    b.gConv += conv; b.orders += orders; b.cancels += cancels; b.google += google; b.meta += meta; b.days++; b.lastDay = iso;
  }
  // Per-month history (trend + coverage signal). `partial` flagged later in the
  // store coverage map; here we just record lastDay + days for downstream logic.
  facts.meta.monarchHistory = {
    tier: "monarch", source: "monarch-history",
    span: { first: firstISO, last: lastISO },
    byMonth: Object.fromEntries(Object.keys(byMonth).sort().map((ym) => {
      const b = byMonth[ym];
      return [ym, { grossConvValue: r2(b.gConv), orders: b.orders, cancels: b.cancels, googleSpend: r2(b.google), metaSpend: r2(b.meta), days: b.days, lastDay: b.lastDay }];
    })),
  };
  dq.push({ level: "info", code: "MNH_OK", msg: `Monarch history: ${Object.keys(byMonth).length} months (${firstISO}→${lastISO}); ${Object.keys(facts.daily).length} daily website channel-grain cells.` });
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

// ═══════════════════════════════════════════════════════════════════════════
// E · SNELL "Sale" tab — CANCEL-RATE per channel per month (V2 upside view E)
// ═══════════════════════════════════════════════════════════════════════════
// Shipped + cancel UNIT columns per channel → month×channel {shipped, cancelled,
// total, cancelPct}. Amazon Total Shipped c7 / Cancel c8; FK Total Shipped c35 /
// Cancel c36; Blinkit Shipped c50 / Cancel c51. cancelPct = cancelled/(ship+canc).
// Months with no ship+cancel coverage are omitted (never fabricated). Emits
// meta.snellCancel = { byChannel:{ch:{ym:{shipped,cancelled,total,cancelPct}}},
// latestByChannel:{ch:{month,cancelPct}} }.
export async function parseSnellCancel(file, _opts = {}) {
  const dq = [];
  const wb = await fileToWorkbook(file);
  const saleSheet = wb.SheetNames.find((n) => /^sale\s*$/i.test(n) || /^sale$/i.test(n.trim()));
  if (!saleSheet) { dq.push({ level: "error", code: "SCN_NOSALE", msg: `Snell workbook has no 'Sale' tab (sheets: ${wb.SheetNames.join(", ")}).` }); throw new Error("Snell cancel: no 'Sale' tab."); }
  const grid = sheetGrid(wb.Sheets[saleSheet]);
  if (grid.length < 6) { dq.push({ level: "error", code: "SCN_SHORT", msg: "Snell Sale tab too short." }); throw new Error("Snell cancel: Sale tab too short."); }
  const b2 = ffRow(grid[2] || []); const r3 = grid[3] || [];
  const C = {
    amzShip: findSnellCol(b2, r3, { band: /^total$/i, leaf: /shipped units/i }),  // c7
    amzCanc: findSnellCol(b2, r3, { band: /^total$/i, leaf: /cancel units/i }),    // c8
    fkShip: findSnellCol(b2, r3, { band: /^total$/i, leaf: /^shipped$/i }),        // c35
    fkCanc: findSnellCol(b2, r3, { band: /^total$/i, leaf: /^cancel$/i }),         // c36
    bkShip: findSnellCol(b2, r3, { band: /blinkit/i, leaf: /^shipped$/i }),        // c50
    bkCanc: findSnellCol(b2, r3, { band: /blinkit/i, leaf: /^cancel$/i }),         // c51
  };
  for (const [k, v] of Object.entries(C)) if (v === -1) dq.push({ level: "warn", code: "SCN_COL", msg: `Snell cancel column "${k}" not located.` });
  const chans = [
    { ch: "amazon", ship: C.amzShip, canc: C.amzCanc },
    { ch: "flipkart", ship: C.fkShip, canc: C.fkCanc },
    { ch: "blinkit", ship: C.bkShip, canc: C.bkCanc },
  ];
  const acc = {}; for (const x of chans) acc[x.ch] = {};
  for (let i = 5; i < grid.length; i++) {
    const r = grid[i]; const d = r[0]; if (typeof d !== "number" || d < 30000 || d > 80000) continue;
    const ym = monthOf(excelToISODate(d)); if (!ym) continue;
    for (const x of chans) {
      const s = x.ship === -1 ? 0 : num(r[x.ship]); const c = x.canc === -1 ? 0 : num(r[x.canc]);
      if (!s && !c) continue;
      const cur = acc[x.ch][ym] || { shipped: 0, cancelled: 0 };
      cur.shipped += s; cur.cancelled += c; acc[x.ch][ym] = cur;
    }
  }
  const byChannel = {}; const latestByChannel = {};
  for (const x of chans) {
    const months = Object.keys(acc[x.ch]).sort(); byChannel[x.ch] = {};
    for (const ym of months) {
      const { shipped, cancelled } = acc[x.ch][ym]; const total = shipped + cancelled;
      byChannel[x.ch][ym] = { shipped, cancelled, total, cancelPct: total ? r2(cancelled / total * 100) : 0 };
    }
    if (months.length) { const ym = months[months.length - 1]; latestByChannel[x.ch] = { month: ym, cancelPct: byChannel[x.ch][ym].cancelPct }; }
  }
  const facts = emptyFacts();
  facts.meta.snellCancel = { source: "snell-cancel", tier: "agency", columns: C, byChannel, latestByChannel };
  const summ = chans.map((x) => `${x.ch} ${latestByChannel[x.ch]?.cancelPct ?? "–"}%`).join(", ");
  dq.push({ level: "info", code: "SCN_OK", msg: `Snell cancel rates (latest month): ${summ}.` });
  return { facts, dq };
}

// ═══════════════════════════════════════════════════════════════════════════
// B · MONARCH "SEO - Keywords" — keyword rank-over-time (V2 upside view B)
// ═══════════════════════════════════════════════════════════════════════════
// col0 = keyword, cols1+ = rank snapshots with Excel-serial DATE headers (lower
// rank = better). Keep TOP-30 keywords by best current rank. Emits
// meta.monarchSeo = { dates:[iso...asc], prev30Date, keywords:[{kw, latest,
// latestDate, prev30, prev30Date, earliest, earliestDate, best, worst,
// movement30, movementAll}], totalKeywords, latestDate, staleAsOf }.
// movement = prev − latest (+ve=improved). ALL ranked keywords are kept (no slice).
export async function parseMonarchSeo(file, _opts = {}) {
  const dq = [];
  const wb = await fileToWorkbook(file);
  const seoName = wb.SheetNames.find((n) => /seo\s*-\s*keywords/i.test(n));
  if (!seoName) { dq.push({ level: "error", code: "SEO_NOTAB", msg: `Monarch: no 'SEO - Keywords' tab (sheets: ${wb.SheetNames.join(", ")}).` }); throw new Error("Monarch SEO: no tab."); }
  const grid = sheetGrid(wb.Sheets[seoName]);
  const hdr = grid[0] || [];
  const dateCols = [];
  for (let c = 1; c < hdr.length; c++) { const iso = excelToISODate(hdr[c]); if (iso) dateCols.push({ c, iso }); }
  dateCols.sort((a, b) => (a.iso < b.iso ? -1 : 1));
  if (!dateCols.length) { dq.push({ level: "error", code: "SEO_NODATES", msg: "Monarch SEO: no date columns." }); throw new Error("Monarch SEO: no date columns."); }
  const isoList = dateCols.map((d) => d.iso);
  const latestCol = dateCols[dateCols.length - 1]; const earliestCol = dateCols[0];
  const latestMs = Date.parse(latestCol.iso);
  let prev30 = dateCols[dateCols.length - 2] || dateCols[0]; let bestDiff = Infinity;
  for (const d of dateCols) { if (d.iso >= latestCol.iso) continue; const diff = Math.abs((latestMs - Date.parse(d.iso)) / 86400000 - 30); if (diff < bestDiff) { bestDiff = diff; prev30 = d; } }
  const rows = [];
  for (let i = 1; i < grid.length; i++) {
    const kw = String(grid[i][0] || "").trim(); if (!kw) continue;
    const rk = (col) => { const v = grid[i][col.c]; const n = num(v); return v === "" || v == null || !Number.isFinite(n) || n === 0 ? null : n; };
    const latest = rk(latestCol); if (latest == null) continue;
    const vals = dateCols.map((d) => rk(d)).filter((v) => v != null);
    const best = vals.length ? Math.min(...vals) : null; const worst = vals.length ? Math.max(...vals) : null;
    const prev = rk(prev30); const earliest = rk(earliestCol);
    rows.push({
      kw, latest, latestDate: latestCol.iso, prev30: prev, prev30Date: prev30.iso,
      earliest, earliestDate: earliestCol.iso, best, worst,
      movement30: prev != null ? r2(prev - latest) : null,
      movementAll: earliest != null ? r2(earliest - latest) : null,
    });
  }
  rows.sort((a, b) => (a.latest - b.latest) || ((b.movementAll || 0) - (a.movementAll || 0)));
  // I/VI fix (2026-06-13): keep ALL ranked keywords (every row with a current rank),
  // not a top-30 slice. The full set (44) is small enough to surface in full; the
  // earlier top-30 silently dropped 14 keywords the founder audit flagged.
  const keywords = rows;
  const staleness = latestCol.iso;             // latest snapshot date — SEO stale past this
  const facts = emptyFacts();
  facts.meta.monarchSeo = { source: "monarch-seo", tier: "monarch", dates: isoList, prev30Date: prev30.iso, latestDate: staleness, staleAsOf: staleness, keywords, totalKeywords: rows.length };
  dq.push({ level: "info", code: "SEO_OK", msg: `Monarch SEO: ${rows.length} ranked keywords (ALL kept); latest snapshot ${staleness}; snapshots ${isoList.join(", ")}.` });
  return { facts, dq };
}

// ═══════════════════════════════════════════════════════════════════════════
// C · MONARCH Master Sheet — Google-vs-Meta monthly efficiency (V2 upside view C)
// ═══════════════════════════════════════════════════════════════════════════
// Daily Google/Meta cols → monthly per-platform {spend, convValue, sales, roas,
// cpa}. spend = MAX of the two candidate spend cols per platform per day (mirrors
// parseMonarchHistory's max-spend so May ties to the website-ad-total anchor).
// roas = conv/spend (same-window); cpa = spend/sales. Emits meta.monarchPlatform
// = { byMonth:{ym:{google:{...}, meta:{...}}} }.
export async function parseMonarchPlatform(file, _opts = {}) {
  const dq = [];
  const wb = await fileToWorkbook(file);
  const masterName = wb.SheetNames.find((n) => /master sheet/i.test(n));
  if (!masterName) { dq.push({ level: "error", code: "MPL_NOMASTER", msg: `Monarch: no 'Master Sheet' (sheets: ${wb.SheetNames.join(", ")}).` }); throw new Error("Monarch platform: no Master Sheet."); }
  const grid = sheetGrid(wb.Sheets[masterName]);
  const H = (grid[1] || []).map((h) => String(h || "").trim());
  const band = ffRow(grid[0] || []);
  const dateCol = H.findIndex((h) => /^date$/i.test(h));
  const findCol = (bandRe, leafRe) => {
    for (let c = 0; c < Math.max(band.length, H.length); c++) {
      const B = String(band[c] || "").trim(), L = String(H[c] || "").trim();
      if (bandRe.test(B) && leafRe.test(L)) return c;
    }
    return -1;
  };
  const gSpendCols = H.map((h, c) => (/google spend/i.test(h) ? c : -1)).filter((c) => c !== -1);
  const mSpendCols = H.map((h, c) => (/meta spend/i.test(h) ? c : -1)).filter((c) => c !== -1);
  const cols = {
    gSale: findCol(/google ads/i, /^sale$/i), gConv: findCol(/google ads/i, /^conversion value$/i),
    mSale: findCol(/meta/i, /^sale$/i), mConv: findCol(/meta/i, /^conversion value$/i),
  };
  if (dateCol === -1 || !gSpendCols.length || !mSpendCols.length) { dq.push({ level: "error", code: "MPL_SCHEMA", msg: "Monarch platform: Master Sheet missing Date / Google Spend / Meta Spend." }); throw new Error("Monarch platform: schema drift."); }
  const byMonth = {};
  for (let i = 2; i < grid.length; i++) {
    const r = grid[i]; const ym = monthOf(excelToISODate(r[dateCol])); if (!ym) continue;
    if (!byMonth[ym]) byMonth[ym] = { gS: 0, gCV: 0, gSale: 0, mS: 0, mCV: 0, mSale: 0 };
    const b = byMonth[ym];
    b.gS += Math.max(0, ...gSpendCols.map((c) => num(r[c])));
    b.mS += Math.max(0, ...mSpendCols.map((c) => num(r[c])));
    if (cols.gConv !== -1) b.gCV += num(r[cols.gConv]);
    if (cols.gSale !== -1) b.gSale += num(r[cols.gSale]);
    if (cols.mConv !== -1) b.mCV += num(r[cols.mConv]);
    if (cols.mSale !== -1) b.mSale += num(r[cols.mSale]);
  }
  const platMonth = (spend, conv, sales) => ({ spend: r2(spend), convValue: r2(conv), sales: r2(sales), roas: spend > 0 ? r2(conv / spend) : null, cpa: sales > 0 ? r2(spend / sales) : null });
  const out = {};
  for (const ym of Object.keys(byMonth).sort()) { const b = byMonth[ym]; out[ym] = { google: platMonth(b.gS, b.gCV, b.gSale), meta: platMonth(b.mS, b.mCV, b.mSale) }; }
  const facts = emptyFacts();
  facts.meta.monarchPlatform = { source: "monarch-platform", tier: "monarch", byMonth: out, columns: cols };
  dq.push({ level: "info", code: "MPL_OK", msg: `Monarch platform efficiency: ${Object.keys(out).length} months Google/Meta ROAS+CPA.` });
  return { facts, dq };
}

// ═══════════════════════════════════════════════════════════════════════════
// A · BUSINESSMODEL Repeats + Returns — HISTORICAL actuals (V2 upside view A)
// ═══════════════════════════════════════════════════════════════════════════
// Founder rule 9 restricts BusinessModel to variable-cost %s, EXCEPT these two
// actuals tabs (explicitly allowed for view A, source-labelled). One uploaded
// BusinessModel workbook yields both blocks. Emits meta.bmRepeats {shopify[],
// amazon[], sourceLabel} + meta.bmReturns {monthly[], sourceLabel}.
export async function parseBmRepeatsReturns(file, _opts = {}) {
  const dq = [];
  const wb = await fileToWorkbook(file);
  const SRC_LABEL = "Naturesum_BusinessModel.xlsx (historical actuals — per founder rule 9, source-labelled)";
  const facts = emptyFacts();
  const repName = wb.SheetNames.find((n) => /repeats/i.test(n));
  if (repName) {
    const g = sheetGrid(wb.Sheets[repName]);
    const shopify = []; const amazon = [];
    for (const i of [2, 3, 4, 5]) {
      const r = g[i]; if (!r) continue;
      const q = String(r[0] || "").trim(); if (q) shopify.push({ quarter: q, newCustomers: num(r[1]), returningCustomers: num(r[2]), totalCustomers: num(r[3]), repeatPct: r2(num(r[4]) * 100) });
      const aq = String(r[7] || "").trim(); if (aq) amazon.push({ quarter: aq, repeatCustomers: num(r[8]), repeatShare: r2(num(r[9]) * 100) });
    }
    const shopByQ = Object.fromEntries(shopify.map((s) => [s.quarter, s]));
    const amzByQ = Object.fromEntries(amazon.map((a) => [a.quarter, a]));
    for (const i of [7, 8, 9, 10]) {
      const r = g[i]; if (!r) continue;
      const q = String(r[0] || "").trim();
      if (q && shopByQ[q]) { shopByQ[q].newCustomerSales = r2(num(r[1])); shopByQ[q].returningCustomerSales = r2(num(r[2])); shopByQ[q].totalSales = r2(num(r[3])); shopByQ[q].returningSalesPct = r2(num(r[4]) * 100); }
      const aq = String(r[7] || "").trim();
      if (aq && amzByQ[aq]) { amzByQ[aq].salesFromRepeatShare = r2(num(r[9]) * 100); }
    }
    // (e) new-vs-returning AOV per Shopify quarter + the gap (guarded /0 → null).
    for (const s of shopify) {
      const newAOV = s.newCustomers > 0 && s.newCustomerSales != null ? r2(s.newCustomerSales / s.newCustomers) : null;
      const returningAOV = s.returningCustomers > 0 && s.returningCustomerSales != null ? r2(s.returningCustomerSales / s.returningCustomers) : null;
      s.newAOV = newAOV; s.returningAOV = returningAOV;
      s.aovGap = (newAOV != null && returningAOV != null) ? r2(returningAOV - newAOV) : null;
      s.aovGapPct = (newAOV && returningAOV != null) ? r2((returningAOV - newAOV) / newAOV * 100) : null;
    }
    facts.meta.bmRepeats = { source: "bm-repeats", tier: "businessmodel", sourceLabel: SRC_LABEL, shopify, amazon };
    dq.push({ level: "info", code: "BMR_OK", msg: `BusinessModel Repeats: ${shopify.length} Shopify quarters, ${amazon.length} Amazon quarters.` });
  } else { dq.push({ level: "warn", code: "BMR_NOTAB", msg: "BusinessModel: no Repeats tab." }); }
  const retName = wb.SheetNames.find((n) => /returns\(shopify\)/i.test(n) || /^returns/i.test(n.trim()));
  if (retName) {
    const g = sheetGrid(wb.Sheets[retName]);
    const monthly = [];
    for (let i = 2; i < g.length; i++) { const r = g[i]; if (!r) continue; const iso = excelToISODate(r[0]); if (!iso) continue; monthly.push({ month: iso, returnsInr: r2(num(r[1])), grossInr: r2(num(r[2])), returnPct: r2(num(r[3]) * 100) }); }
    monthly.sort((a, b) => (a.month < b.month ? -1 : 1));
    facts.meta.bmReturns = { source: "bm-returns", tier: "businessmodel", sourceLabel: SRC_LABEL, monthly };
    dq.push({ level: "info", code: "BRT_OK", msg: `BusinessModel Returns: ${monthly.length} months Shopify returns %.` });
  } else { dq.push({ level: "warn", code: "BRT_NOTAB", msg: "BusinessModel: no Returns tab." }); }
  if (!repName && !retName) throw new Error("BusinessModel: neither Repeats nor Returns tab found.");
  return { facts, dq };
}

// ═══════════════════════════════════════════════════════════════════════════
// I · MONARCH supplementary tabs — March-2025 + Weekly-Comparison (monarch)
// ═══════════════════════════════════════════════════════════════════════════
// Surface the two Monarch tabs not otherwise read: "March 2025" (earliest daily
// website log — the 0→1 ramp) and "Weekly Comparsion" (founder 7-/3-day/vs-last-
// month Google-vs-Meta blocks). Twin of build-business-data.buildMonarchExtraTabs.
// SHAPE: meta.monarchExtra = { march2025:{ monthly, daily, labels }, weekly:{ blocks } }.
export async function parseMonarchExtra(file, _opts = {}) {
  const dq = [];
  const wb = await fileToWorkbook(file);
  const findTab = (re) => wb.SheetNames.find((k) => re.test(String(k).trim()));
  const facts = emptyFacts();
  const out = {};
  const m25Name = findTab(/^march 2025$/i);
  if (m25Name) {
    const grid = sheetGrid(wb.Sheets[m25Name]);
    const lbl = (grid[2] || []).map((h) => String(h || "").trim());
    const ci = (re) => lbl.findIndex((h) => re.test(h));
    const cols = {
      totalOrders: ci(/^total oders$/i), cancelOrders: ci(/cancel oders total/i),
      netOrders: ci(/after removing cancel orders/i), salesValue: ci(/^total sales value$/i),
      cancelValue: ci(/^cancel order value$/i), netSalesValue: ci(/after removing cancel order - sales value/i),
    };
    let mOrders = 0, mCancels = 0, mSalesValue = 0, mNetSalesValue = 0, dayRows = 0;
    const daily = [];
    for (let i = 3; i < grid.length; i++) {
      const r = grid[i]; if (!r) continue;
      const d0 = r[0]; if (d0 === "" || d0 == null) continue;
      const ord = cols.totalOrders === -1 ? 0 : num(r[cols.totalOrders]);
      const sv = cols.salesValue === -1 ? 0 : num(r[cols.salesValue]);
      if (!ord && !sv) continue;
      dayRows++;
      mOrders += ord; mCancels += cols.cancelOrders === -1 ? 0 : num(r[cols.cancelOrders]);
      mSalesValue += sv; mNetSalesValue += cols.netSalesValue === -1 ? 0 : num(r[cols.netSalesValue]);
      daily.push({
        date: String(d0).trim(), totalOrders: ord,
        cancelOrders: cols.cancelOrders === -1 ? 0 : num(r[cols.cancelOrders]),
        netOrders: cols.netOrders === -1 ? 0 : num(r[cols.netOrders]),
        salesValue: r2(sv), cancelValue: cols.cancelValue === -1 ? 0 : r2(num(r[cols.cancelValue])),
        netSalesValue: cols.netSalesValue === -1 ? 0 : r2(num(r[cols.netSalesValue])),
      });
    }
    out.march2025 = { tab: m25Name.trim(), labels: lbl.filter(Boolean), monthly: { month: "2025-03", totalOrders: mOrders, cancelOrders: mCancels, salesValue: r2(mSalesValue), netSalesValue: r2(mNetSalesValue), dayRows }, daily };
  } else { dq.push({ level: "warn", code: "MEX_NOM25", msg: "Monarch: no 'March 2025' tab." }); }
  const wcName = findTab(/^weekly compar/i);
  if (wcName) {
    const grid = sheetGrid(wb.Sheets[wcName]);
    const blocks = [];
    for (let i = 0; i < grid.length; i++) {
      const title = String((grid[i] || [])[1] || "").trim();
      if (!/compar/i.test(title)) continue;
      const rows = [];
      for (let j = i + 2; j < grid.length; j++) {
        const r = grid[j] || [];
        const gDate = String(r[1] || "").trim(); const mDate = String(r[8] || "").trim();
        if (/compar/i.test(gDate)) break;
        if (/^date$/i.test(gDate)) continue;
        if (!gDate && !mDate) { if (rows.length) break; else continue; }
        if (gDate && !/^date$/i.test(gDate)) rows.push({ platform: "google", date: gDate, cost: r2(num(r[2])), sales: num(r[3]), salesValue: r2(num(r[4])), roas: r2(num(r[5])), cpa: r2(num(r[6])) });
        if (mDate && !/^date$/i.test(mDate)) rows.push({ platform: "meta", date: mDate, cost: r2(num(r[9])), sales: num(r[10]), salesValue: r2(num(r[11])), roas: r2(num(r[12])), cpa: r2(num(r[13])) });
      }
      if (rows.length) blocks.push({ title, rows });
    }
    out.weekly = { tab: wcName.trim(), blocks };
  } else { dq.push({ level: "warn", code: "MEX_NOWC", msg: "Monarch: no 'Weekly Comparison' tab." }); }
  facts.meta.monarchExtra = { source: "monarch-extra-tabs", tier: "monarch", ...out };
  dq.push({ level: "info", code: "MEX_OK", msg: `Monarch extra: March-2025 ${out.march2025?.daily?.length || 0} days, ${out.weekly?.blocks?.length || 0} weekly blocks.` });
  return { facts, dq };
}

// ═══════════════════════════════════════════════════════════════════════════
// f · UNIT_COGS Notes-column cost-change history per SKU
// ═══════════════════════════════════════════════════════════════════════════
// Parse the "Source / Notes" column's "was Rs X" prior raw-material values into a
// per-SKU cost-change history. SKU resolved by the UNIQUE Total COGS/Unit (col5)
// matching the engine's DEFAULT_COGS. Twin of build-business-data.buildCogsHistory.
// SHAPE: meta.cogsHistory = { source, asOf, byCode: { CODE: { productName, current,
// prior:[{rmPerKg,note}], changed } } }.
const COGS_TOTAL_TO_CODE = {
  150: "NSACDT30", 375: "NSJO100", 133: "NSSB100", 305.25: "NSSB250", 582.5: "NSSB500",
  136.5: "NSSBDB100", 314: "NSSBDB250", 600: "NSSBDB500", 39.5: "NSMP100", 71.5: "NSMP250",
  180.5: "NSSBBO15", 353: "NSSBBO30", 232.7: "NSSBJ300", 342.3: "NSSBJ500",
};
function resolveCogsCode(totalCogs) {
  if (COGS_TOTAL_TO_CODE[totalCogs]) return COGS_TOTAL_TO_CODE[totalCogs];
  let best = null, bestD = 0.5;
  for (const [t, code] of Object.entries(COGS_TOTAL_TO_CODE)) { const d = Math.abs(Number(t) - totalCogs); if (d <= bestD) { bestD = d; best = code; } }
  return best;
}
export async function parseCogsHistory(file, _opts = {}) {
  const dq = [];
  const wb = await fileToWorkbook(file);
  const sn = wb.SheetNames.find((n) => /unit\s*cogs/i.test(n)) || wb.SheetNames[0];
  const grid = sheetGrid(wb.Sheets[sn]);
  const H = (grid[0] || []).map((h) => String(h || "").trim());
  const cName = H.findIndex((h) => /^sku$/i.test(h));
  const cRm = H.findIndex((h) => /rm landed cost/i.test(h));
  const cTotal = H.findIndex((h) => /total cogs\/?unit/i.test(h));
  const cNotes = H.findIndex((h) => /source\s*\/?\s*notes/i.test(h));
  if (cTotal === -1 || cNotes === -1) { dq.push({ level: "error", code: "COG_SCHEMA", msg: "Unit_COGS: missing Total COGS/Notes column." }); throw new Error("Unit_COGS: schema drift."); }
  const byCode = {}; let changed = 0;
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i]; if (!r) continue;
    const name = String(r[cName === -1 ? 0 : cName] || "").trim(); if (!name) continue;
    const total = num(r[cTotal]); if (!total) continue;
    const code = resolveCogsCode(r2(total)); if (!code) continue;
    const notes = String(r[cNotes] || "");
    const rmNow = cRm !== -1 ? num(r[cRm]) : null;
    const m = notes.match(/was\s*Rs[\s,]*([\d,]+(?:\.\d+)?)/i);
    const rmWas = m ? num(m[1]) : null;
    const prior = rmWas != null ? [{ rmPerKg: rmWas, note: `RM was Rs${rmWas} → Rs${rmNow} (per Unit_COGS Notes, 11-Jun-26)` }] : [];
    if (prior.length) changed++;
    byCode[code] = { productName: name, current: { rmPerKg: rmNow, totalCogs: r2(total), asOf: "2026-06-11" }, prior, changed: prior.length > 0, noteRaw: notes };
  }
  const facts = emptyFacts();
  facts.meta.cogsHistory = { source: "Naturesum_Unit_COGS Notes column", asOf: "2026-06-11", byCode };
  dq.push({ level: "info", code: "COG_OK", msg: `COGS history: ${Object.keys(byCode).length} SKUs, ${changed} with a prior-value change.` });
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
  // V2 — full-history channel-grain + per-SKU-units parsers (tier 2/3).
  "snell-history": { label: "Snell Sale tab — full daily channel history (agency)", channel: "*", parse: parseSnellHistory, tier: "agency" },
  "snell-sku-units": { label: "Snell Categorywise — daily per-SKU units (agency)", channel: "*", parse: parseSnellSkuUnits, tier: "agency" },
  "monarch-history": { label: "Monarch Master Sheet — full daily website history (monarch)", channel: "website", parse: parseMonarchHistory, tier: "monarch" },
  // V2 upside views — analytics-only meta (no monthly/daily facts written):
  "snell-cancel": { label: "Snell Sale tab — cancel-rate per channel (agency)", channel: "*", parse: parseSnellCancel, tier: "agency" },
  "monarch-seo": { label: "Monarch SEO - Keywords — rank-over-time (monarch)", channel: "website", parse: parseMonarchSeo, tier: "monarch" },
  "monarch-platform": { label: "Monarch Master Sheet — Google vs Meta efficiency (monarch)", channel: "website", parse: parseMonarchPlatform, tier: "monarch" },
  "bm-repeats": { label: "BusinessModel — Repeats & Returns (historical actuals)", channel: "*", parse: parseBmRepeatsReturns, tier: "businessmodel" },
  // R3 left-on-table — Snell order-mix + reconciliation (a/b), Monarch March-2025 +
  // Weekly-Comparison tabs (I), Unit_COGS Notes cost-change history (f).
  "snell-ordermix": { label: "Snell Sale tab — Amazon order-mix + Total-row reconciliation (agency)", channel: "amazon", parse: parseSnellOrderMix, tier: "agency" },
  "monarch-extra": { label: "Monarch March-2025 + Weekly-Comparison tabs (monarch)", channel: "website", parse: parseMonarchExtra, tier: "monarch" },
  "cogs-history": { label: "Unit_COGS Notes — per-SKU cost-change history", channel: "*", parse: parseCogsHistory, tier: "businessmodel" },
};

export async function parseBusinessFile(type, file, opts = {}) {
  const def = BUSINESS_FILE_TYPES[type];
  if (!def) throw new Error(`Unknown business file type: ${type}`);
  return await def.parse(file, opts);
}

// Exposed for the offline twin + verification re-derivation.
export { ASIN_MAP, AMZ_MSKU_MAP, FK_SKU_MAP, SHP_SKU_MAP, BLINKIT_ITEM_MAP, num, r2, excelToISODate };
// V2 — channel-grain sentinel + Categorywise resolver exposed for the twin/store.
export { CH_CODE, snellCatHeaderToCode };
