#!/usr/bin/env node
/**
 * build-business-data.cjs — OFFLINE TWIN of src/lib/businessParsers.js.
 *
 * Parses ALL the May-2026 raw files and bakes src/bundledBusinessData.js
 * (BUNDLED_BUSINESS) in the pinned store shape, mirroring the browser parsers
 * byte-for-byte on the rules that matter. Same twin discipline as
 * build-central-wh.cjs.
 *
 * Run:  node scripts/build-business-data.cjs            (uses ~/Downloads)
 *       node scripts/build-business-data.cjs <dir>      (custom raw-file dir)
 *
 * Pins (BINDING — docs/BUSINESS-MODULE-SPEC.md, founder checkpoint 2026-06-11):
 *  - Amazon = sales-channel "Amazon.in" ONLY, item-status Shipped, returns
 *    ("Shipped - Returned to Seller") NETTED OUT; net = gross ÷ 1.05. Non-Amazon*
 *    rows = MCF units (website fulfilment) → meta.mcf for mcfShare.
 *  - Flipkart = Σ Buyer Invoice Amount NATIVE SIGN (negatives auto-net); the
 *    BIA is ALREADY the realized net-of-GST invoice amount, so netRev = Σ BIA
 *    AS-IS — NOT ÷1.05 (Σ BIA native = 271,408 = the binding §2 anchor; ÷1.05
 *    would understate to 258,484, a DRIFT). *N multipacks fold; cashback
 *    (₹11,931) EXCLUDED, reported separately.
 *  - Blinkit = Σ gross; net = gross − (CGST+SGST+CESS); key on Item Id.
 *  - Website May = shopify-net AS-IS (no ÷1.05).
 *  - Ad spend: Amazon SP (per-ASIN), FK PLA (per-SKU), Google (fuzzy title),
 *    Snell Sale tab channel totals, Monarch Meta/Google totals.
 *
 * DO NOT hand-edit src/bundledBusinessData.js — regenerate via this script.
 */
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");
const os = require("os");

const RAW_DIR = process.argv[2] || path.join(os.homedir(), "Downloads");
const OUT_JS = path.join(__dirname, "..", "src", "bundledBusinessData.js");
const MONTH = "2026-05";

// File resolver — accepts the exact name OR a " (N)" variant (Downloads dups).
function resolve(base, ext) {
  const names = fs.readdirSync(RAW_DIR);
  const re = new RegExp("^" + base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?: \\(\\d+\\))?\\." + ext + "$", "i");
  const hit = names.filter((n) => re.test(n)).sort();      // prefer the plain name (sorts first)
  return hit.length ? path.join(RAW_DIR, hit[0]) : null;
}

// ─── Canonical maps (BINDING — identical to businessParsers.js) ──────────────
const ASIN_MAP = {
  B0GZNRL4XS: "NSMP100", B0GZNGQLTM: "NSMP250",
  B0FPMJMRW7: "NSSB100", B0FPMDD8ZS: "NSSB250", B0GHQVMC93: "NSSB500",
  B0DV5K7BB4: "NSSBDB100", B0DV5MS3J3: "NSSBDB250", B0FPD5432G: "NSSBDB500",
  B0GRMC94JJ: "NSSBJ300", B0GRMG2BLQ: "NSSBJ500",
  B0DK1X2H8F: "NSSBBO15", B0DK1X4LGV: "NSSBBO30",
  B0DJK3DCZF: "NSJO100", B0F88G8DYP: "NSACDT30",
};
const AMZ_MSKU_MAP = {
  NSSBDB100g: "NSSBDB100", NSSBDB250g: "NSSBDB250", NSSBDB500g: "NSSBDB500",
  NSSBP100: "NSSB100", NSSBP250: "NSSB250", NSSBP500: "NSSB500",
  NSSBJ300ML: "NSSBJ300", NSSBJ500ML: "NSSBJ500",
  NSMP100: "NSMP100", NSMP250: "NSMP250", "NSJ&RHO100ML": "NSJO100", "DI-TE-1-A": "NSACDT30",
};
const FK_SKU_MAP = { ...AMZ_MSKU_MAP };
const SHP_SKU_MAP = {
  "NS-SBDR-100": "NSSBDB100", "NS-SBDR-250": "NSSBDB250", "NS-SBDR-500": "NSSBDB500",
  "NS-SBP-100": "NSSB100", "NS-SBP-250": "NSSB250", "NS-SBP-500": "NSSB500",
  "NS-SBJ-300": "NSSBJ300", "NS-SBJ-500": "NSSBJ500",
  NSMP100: "NSMP100", NSMP250: "NSMP250",
  "NS-HO-JT-100": "NSJO100", "DI-TE-1-A": "NSACDT30", "NS-SB-030": "NSSBBO30",
};
const BLINKIT_ITEM_MAP = {
  10270854: "NSSB100", 10282349: "NSSB250", 10269110: "NSSBDB250",
  10276565: "NSSBDB500", 10302844: "NSSBJ300",
};

// ─── Helpers (mirror businessParsers) ────────────────────────────────────────
const num = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v ?? "").trim();
  if (!s) return 0;
  const n = Number(s.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : 0);

function repairRange(ws) {
  let maxR = 0, maxC = 0;
  for (const k of Object.keys(ws)) { if (k[0] === "!") continue; const c = XLSX.utils.decode_cell(k); if (c.r > maxR) maxR = c.r; if (c.c > maxC) maxC = c.c; }
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
  return ws;
}
const grid = (ws) => XLSX.utils.sheet_to_json(repairRange(ws), { header: 1, defval: "", raw: true });
function parseCsvLine(line) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) { const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else { if (c === ",") { out.push(cur); cur = ""; } else if (c === '"') q = true; else cur += c; } }
  out.push(cur); return out;
}
function excelToISODate(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") { const d = new Date((v - 25569) * 86400 * 1000); return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); }
  const s = String(v).trim(); const iso = s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(s); return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
const monthOf = (iso) => (iso ? iso.slice(0, 7) : null);

const facts = { monthly: {}, daily: {}, meta: { uploads: [], bySource: {} } };
function bumpM(month, ch, code, src, f) {
  const key = `${month}|${ch}|${code}`;
  const cur = facts.monthly[key] || { units: 0, grossRev: 0, netRev: 0, returnsUnits: 0, returnsValue: 0, adSpendDirect: 0, src: "" };
  for (const k of Object.keys(f)) cur[k] = r2((cur[k] || 0) + num(f[k]));
  const s = new Set(String(cur.src || "").split(",").filter(Boolean)); s.add(src); cur.src = [...s].join(",");
  facts.monthly[key] = cur;
}
function bumpD(date, ch, code, src, f) {
  const key = `${date}|${ch}|${code}`;
  const cur = facts.daily[key] || { units: 0, netRev: 0, src: "" };
  for (const k of Object.keys(f)) cur[k] = r2((cur[k] || 0) + num(f[k]));
  const s = new Set(String(cur.src || "").split(",").filter(Boolean)); s.add(src); cur.src = [...s].join(",");
  facts.daily[key] = cur;
}

const report = {};   // human-readable channel rollup for the run summary

// ═══ 1 · Amazon All-Orders TSV ═══════════════════════════════════════════════
function buildAmazon() {
  const p = resolve("amazonmaysales", "txt");
  if (!p) { console.error("MISSING amazonmaysales.txt"); return; }
  const lines = fs.readFileSync(p, "utf8").split(/\r?\n/).filter((l) => l.length);
  const H = lines[0].split("\t"); const col = (n) => H.indexOf(n);
  const C = { date: col("purchase-date"), status: col("order-status"), itemStatus: col("item-status"), salesCh: col("sales-channel"), sku: col("sku"), asin: col("asin"), qty: col("quantity"), price: col("item-price") };
  const mcf = {}; let mcfTotal = 0, retU = 0, retV = 0, units = 0, gross = 0;
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split("\t");
    const salesCh = (c[C.salesCh] || "").trim(), itemStatus = (c[C.itemStatus] || "").trim(), status = (c[C.status] || "").trim();
    const code = ASIN_MAP[(c[C.asin] || "").trim()] || AMZ_MSKU_MAP[(c[C.sku] || "").trim().replace(/_MP$/i, "")] || null;
    if (/^Non-Amazon/i.test(salesCh)) { if (itemStatus === "Shipped" && code) { const q = num(c[C.qty]); mcf[code] = (mcf[code] || 0) + q; mcfTotal += q; } continue; }
    if (salesCh !== "Amazon.in" || itemStatus !== "Shipped" || !code) continue;
    const iso = excelToISODate(c[C.date]); const m = monthOf(iso); if (!m) continue;
    const q = num(c[C.qty]), rev = num(c[C.price]);
    if (/Returned to Seller/i.test(status)) { bumpM(m, "amazon", code, "amazon-orders", { units: -q, grossRev: -rev, netRev: -rev / 1.05, returnsUnits: q, returnsValue: rev }); retU += q; retV += rev; units -= q; gross -= rev; }
    else { bumpM(m, "amazon", code, "amazon-orders", { units: q, grossRev: rev, netRev: rev / 1.05 }); units += q; gross += rev; }
  }
  facts.meta.bySource["amazon-orders"] = { mcf: { byCode: mcf, totalUnits: mcfTotal }, amazonReturns: { units: retU, value: r2(retV) } };
  report.amazon = { units, gross: r2(gross), net: r2(gross / 1.05), returnsUnits: retU, returnsValue: r2(retV), mcfUnits: mcfTotal };
}

// ═══ 2 · Flipkart Sales Report ═══════════════════════════════════════════════
function resolveFkSku(raw) {
  let s = String(raw ?? "").replace(/"/g, "").replace(/^SKU:/i, "").trim(); if (!s) return null;
  const m = s.match(/^(.+?)\s*\*\s*(\d+)$/);
  if (m) { const code = FK_SKU_MAP[m[1].trim()]; return code ? { code, mult: parseInt(m[2], 10) || 1 } : null; }
  const code = FK_SKU_MAP[s]; return code ? { code, mult: 1 } : null;
}
function buildFlipkart() {
  const p = resolve("flipkart may sales", "xlsx"); if (!p) { console.error("MISSING flipkart may sales.xlsx"); return; }
  const wb = XLSX.readFile(p);
  const g = grid(wb.Sheets[wb.SheetNames.find((n) => /sales report/i.test(n)) || wb.SheetNames[0]]);
  const H = g[0]; const idx = (n) => H.indexOf(n);
  const C = { sku: idx("SKU"), qty: idx("Item Quantity"), bia: idx("Buyer Invoice Amount"), orderDate: idx("Order Date"), invDate: idx("Buyer Invoice Date"), eventType: idx("Event Type") };
  let units = 0, biaSum = 0, retRows = 0;
  for (let i = 1; i < g.length; i++) {
    const r = g[i]; if (!r || r[C.sku] === "" || r[C.sku] == null) continue;
    const hit = resolveFkSku(r[C.sku]); if (!hit) continue;
    const iso = excelToISODate(r[C.orderDate]) || excelToISODate(r[C.invDate]); const m = monthOf(iso); if (!m) continue;
    const bia = num(r[C.bia]), qty = num(r[C.qty]) * hit.mult;
    const isRet = String(r[C.eventType] || "").toLowerCase().includes("return") || bia < 0;
    if (isRet) retRows++;
    // BIA is already net-of-GST (binding §2 anchor): netRev = bia AS-IS, no ÷1.05.
    bumpM(m, "flipkart", hit.code, "fk-sales", { units: isRet ? -Math.abs(qty) : qty, grossRev: bia, netRev: bia, ...(isRet ? { returnsUnits: Math.abs(qty), returnsValue: Math.abs(bia) } : {}) });
    const ds = excelToISODate(r[C.orderDate]) || iso; if (ds && !isRet) bumpD(ds, "flipkart", hit.code, "fk-sales", { units: qty, netRev: bia });
    units += isRet ? -Math.abs(qty) : qty; biaSum += bia;
  }
  // Cashback (excluded from CM)
  let cb = 0, cn = 0;
  const cbName = wb.SheetNames.find((n) => /cash\s*back/i.test(n));
  if (cbName) { const cg = grid(wb.Sheets[cbName]); const ia = (cg[0] || []).indexOf("Invoice Amount"); if (ia !== -1) for (let i = 1; i < cg.length; i++) if (cg[i] && cg[i][ia] !== "") { cb += num(cg[i][ia]); cn++; } }
  facts.meta.bySource["fk-sales"] = { flipkartCashback: { value: r2(cb), rows: cn } };
  report.flipkart = { units, grossBIA: r2(biaSum), net: r2(biaSum), returnRows: retRows, cashback: r2(cb) };
}

// ═══ 3 · Blinkit Sales Report ════════════════════════════════════════════════
function buildBlinkit() {
  const p = resolve("blinkit may sales", "xlsx"); if (!p) { console.error("MISSING blinkit may sales.xlsx"); return; }
  const wb = XLSX.readFile(p);
  const g = grid(wb.Sheets[wb.SheetNames.find((n) => /sales report/i.test(n)) || wb.SheetNames[0]]);
  const H = g[0]; const idx = (n) => H.indexOf(n);
  const C = { item: idx("Item Id"), qty: idx("Quantity"), gross: idx("Total Gross Bill Amount"), cgst: idx("CGST Value"), sgst: idx("SGST Value"), cess: idx("CESS Value"), date: idx("Order Date") };
  let units = 0, gross = 0, net = 0, unmapped = 0;
  for (let i = 1; i < g.length; i++) {
    const r = g[i]; if (!r || r[C.item] === "") continue;
    const code = BLINKIT_ITEM_MAP[num(r[C.item])]; if (!code) { unmapped++; continue; }
    const iso = excelToISODate(r[C.date]); const m = monthOf(iso); if (!m) continue;
    const gr = num(r[C.gross]), q = num(r[C.qty]), nt = gr - (num(r[C.cgst]) + num(r[C.sgst]) + num(r[C.cess]));
    bumpM(m, "blinkit", code, "blinkit-sales", { units: q, grossRev: gr, netRev: nt });
    if (iso) bumpD(iso, "blinkit", code, "blinkit-sales", { units: q, netRev: nt });
    units += q; gross += gr; net += nt;
  }
  report.blinkit = { units, gross: r2(gross), net: r2(net), unmappedRows: unmapped };
}

// ═══ 4 · Shopify net (monthly, AS-IS) ════════════════════════════════════════
function buildShopifyNet() {
  const p = resolve("shopify net sales net units", "csv"); if (!p) { console.error("MISSING shopify net sales net units.csv"); return; }
  const lines = fs.readFileSync(p, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.length);
  const H = parseCsvLine(lines[0]); const C = { sku: H.indexOf("Product variant SKU"), units: H.indexOf("Net items sold"), net: H.indexOf("Net sales") };
  let units = 0, net = 0;
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]); const sku = (c[C.sku] || "").trim(); if (!sku) continue;
    const code = SHP_SKU_MAP[sku]; if (!code) continue;
    const u = num(c[C.units]), n = num(c[C.net]);
    bumpM(MONTH, "website", code, "shopify-net", { units: u, grossRev: n, netRev: n }); units += u; net += n;
  }
  report.website = { units, net: r2(net) };
}

// ═══ 5 · Shopify daily (shape only) ══════════════════════════════════════════
function buildShopifyDaily() {
  const p = resolve("shopify may sales", "csv"); if (!p) return;
  const lines = fs.readFileSync(p, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.length);
  const H = parseCsvLine(lines[0]); const C = { sku: H.indexOf("Product variant SKU"), day: H.indexOf("Day"), units: H.indexOf("Net items sold") };
  if (C.day === -1) return;
  let cells = 0;
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]); const code = SHP_SKU_MAP[(c[C.sku] || "").trim()]; if (!code) continue;
    const iso = excelToISODate(c[C.day]); if (!iso) continue;
    bumpD(iso, "website", code, "shopify-daily", { units: num(c[C.units]) }); cells++;
  }
  report.websiteDailyCells = cells;
}

// ═══ 6 · Amazon SP ads ═══════════════════════════════════════════════════════
function buildAmazonSp() {
  const p = resolve("may_product_wise_sp", "xlsx"); if (!p) { console.error("MISSING may_product_wise_sp.xlsx"); return; }
  const wb = XLSX.readFile(p); const g = grid(wb.Sheets[wb.SheetNames[0]]);
  const H = g[0]; const C = { date: H.indexOf("Date"), asin: H.indexOf("Advertised ASIN"), spend: H.indexOf("Spend") };
  let total = 0;
  for (let i = 1; i < g.length; i++) {
    const r = g[i]; const code = ASIN_MAP[String(r[C.asin] || "").trim()]; if (!code) continue;
    const m = monthOf(excelToISODate(r[C.date])); if (!m) continue;
    const sp = num(r[C.spend]); total += sp; bumpM(m, "amazon", code, "ads-amazon-sp", { adSpendDirect: sp });
  }
  facts.meta.bySource["ads-amazon-sp"] = { amazonSpTotal: r2(total) };
  report.adsAmazonSp = r2(total);
}

// ═══ 7 · Flipkart PLA ads ════════════════════════════════════════════════════
function buildFkPla() {
  const p = resolve("flipkart may ads", "csv"); if (!p) { console.error("MISSING flipkart may ads.csv"); return; }
  const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
  const startLine = lines.find((l) => /^start time/i.test(l));
  const monthFromHeader = startLine ? monthOf(excelToISODate(startLine.split(",").slice(1).join(",").trim())) : null;
  const hi = lines.findIndex((l) => /^campaign id/i.test(l)); if (hi === -1) return;
  const H = parseCsvLine(lines[hi]); const C = { sku: H.indexOf("Sku Id"), spend: H.indexOf("Ad Spend") };
  const m = monthFromHeader || MONTH; let total = 0;
  for (let i = hi + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue; const c = parseCsvLine(lines[i]); const hit = resolveFkSku(c[C.sku]); if (!hit) continue;
    const sp = num(c[C.spend]); total += sp; bumpM(m, "flipkart", hit.code, "ads-fk-pla", { adSpendDirect: sp });
  }
  facts.meta.bySource["ads-fk-pla"] = { flipkartPlaTotal: r2(total) };
  report.adsFkPla = r2(total);
}

// ═══ 8 · Google product-wise ads (fuzzy title → code) ════════════════════════
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
  const t = String(title || "").toLowerCase(); const ns = GOOGLE_NUM(t).split(",");
  const cand = GOOGLE_KEYS.filter((k) => ns.includes(k.grams) && k.needles.some((n) => t.includes(n)));
  if (cand.length >= 1) return cand[0].code;
  return null;
}
function buildGoogle() {
  const p = resolve("google may ads", "csv"); if (!p) { console.error("MISSING google may ads.csv"); return; }
  const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
  const hi = lines.findIndex((l) => /^product title,/i.test(l)); if (hi === -1) return;
  const H = parseCsvLine(lines[hi]); const costCol = H.indexOf("Cost") === -1 ? H.length - 1 : H.indexOf("Cost");
  let total = 0, attr = 0;
  for (let i = hi + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue; const c = parseCsvLine(lines[i]); const cost = num(c[costCol]); total += cost;
    if (cost === 0) continue; const code = googleTitleToCode(c[0]); if (!code) continue;
    attr += cost; bumpM(MONTH, "website", code, "ads-google", { adSpendDirect: cost });
  }
  facts.meta.bySource["ads-google"] = { googleProductTotal: r2(total), googleAttributed: r2(attr), googleUnattributed: r2(total - attr) };
  report.adsGoogleProduct = { total: r2(total), attributed: r2(attr), unattributed: r2(total - attr) };
}

// ═══ 9 · Snell "Sale" tab — channel spend totals ═════════════════════════════
function ffRow(arr) { const o = [...arr]; for (let i = 1; i < o.length; i++) if (o[i] === "" || o[i] == null) o[i] = o[i - 1]; return o; }
function findSnellCol(b2, r3, band, leaf) {
  for (let c = 0; c < Math.max(b2.length, r3.length); c++) {
    const B = String(b2[c] || "").replace(/[\r\n]+/g, " ").trim(), L = String(r3[c] || "").trim();
    if (band.test(B) && (!leaf || leaf.test(L))) return c;
  }
  return -1;
}
function buildSnell() {
  const p = resolve("SnellSales&AdsSheet", "xlsx"); if (!p) { console.error("MISSING SnellSales&AdsSheet.xlsx"); return; }
  const wb = XLSX.readFile(p);
  const saleName = wb.SheetNames.find((n) => /^sale$/i.test(n.trim())); if (!saleName) { console.error("Snell: no Sale tab"); return; }
  const g = grid(wb.Sheets[saleName]);
  const b2 = ffRow(g[2] || []), r3 = g[3] || [];
  const cols = {
    amsSpend: findSnellCol(b2, r3, /actual ams spend/i, null),
    fkSpend: findSnellCol(b2, r3, /flipkart spend\s*total/i, null),
    googleSpend: findSnellCol(b2, r3, /google spend\s*total/i, null),
    blinkitGross: findSnellCol(b2, r3, /sale value/i, /total gross value/i),
    blinkitSpend: findSnellCol(b2, r3, /blinkit spend\s*total/i, null),
    blinkitUnits: findSnellCol(b2, r3, /blinkit/i, /^total$/i),
  };
  const [yy, mm] = MONTH.split("-").map(Number);
  const minSer = Math.round(Date.UTC(yy, mm - 1, 1) / 86400000) + 25569;
  const maxSer = Math.round(Date.UTC(yy, mm, 0) / 86400000) + 25569;
  const sum = { amsSpend: 0, fkSpend: 0, googleSpend: 0, blinkitGross: 0, blinkitSpend: 0, blinkitUnits: 0 };
  let rows = 0;
  for (let i = 5; i < g.length; i++) { const d = g[i][0]; if (typeof d !== "number" || d < minSer || d > maxSer) continue; rows++; for (const k of Object.keys(sum)) if (cols[k] !== -1) sum[k] += num(g[i][cols[k]]); }
  facts.meta.bySource["snell-agency"] = { snellChannelSpend: { month: MONTH, amazon: r2(sum.amsSpend), flipkart: r2(sum.fkSpend), website_google: r2(sum.googleSpend), blinkit: r2(sum.blinkitSpend), blinkitGrossCrosscheck: r2(sum.blinkitGross), blinkitUnitsCrosscheck: sum.blinkitUnits, rows } };
  report.snell = { amazonAMS: r2(sum.amsSpend), flipkart: r2(sum.fkSpend), blinkit: r2(sum.blinkitSpend), blinkitGrossXcheck: r2(sum.blinkitGross), blinkitUnitsXcheck: sum.blinkitUnits, cols };
}

// ═══ 10 · Monarch — website Meta/Google totals + history ═════════════════════
function buildMonarch() {
  const p = resolve("MonarchWebsiteSales&AdsSheet", "xlsx"); if (!p) { console.error("MISSING MonarchWebsiteSales&AdsSheet.xlsx"); return; }
  const wb = XLSX.readFile(p);
  const masterName = wb.SheetNames.find((n) => /master sheet/i.test(n)); if (!masterName) { console.error("Monarch: no Master Sheet"); return; }
  const g = grid(wb.Sheets[masterName]);
  const H = (g[1] || []).map((h) => String(h || "").trim());
  const googleCols = H.map((h, c) => (/google spend/i.test(h) ? c : -1)).filter((c) => c !== -1);
  const metaCols = H.map((h, c) => (/meta spend/i.test(h) ? c : -1)).filter((c) => c !== -1);
  const dateCol = H.findIndex((h) => /^date$/i.test(h));
  const convCol = H.findIndex((h) => /total conversion value/i.test(h));
  const byMonth = {};
  for (let i = 2; i < g.length; i++) {
    const iso = excelToISODate(g[i][dateCol]); const ym = monthOf(iso); if (!ym) continue;
    if (!byMonth[ym]) byMonth[ym] = { google: googleCols.map(() => 0), meta: metaCols.map(() => 0), conv: 0, days: 0 };
    googleCols.forEach((c, j) => { byMonth[ym].google[j] += num(g[i][c]); });
    metaCols.forEach((c, j) => { byMonth[ym].meta[j] += num(g[i][c]); });
    if (convCol !== -1) byMonth[ym].conv += num(g[i][convCol]);
    byMonth[ym].days++;
  }
  const tm = byMonth[MONTH]; let gTot = 0, mTot = 0;
  if (tm) { gTot = Math.max(...tm.google, 0); mTot = Math.max(...tm.meta, 0); }
  const history = Object.fromEntries(Object.keys(byMonth).sort().map((ym) => [ym, { convValue: r2(byMonth[ym].conv), days: byMonth[ym].days }]));
  facts.meta.bySource["monarch-web"] = { monarchWebSpend: { month: MONTH, googleTotal: r2(gTot), metaTotal: r2(mTot) }, monarchWebHistory: history };
  report.monarch = { googleTotal: r2(gTot), metaTotal: r2(mTot), historyMonths: Object.keys(history).length };
}

// ═══ 11 · Website mcfShare (blended-fee input, spec §5) ══════════════════════
// mcfShare = MCF revenue share of website. The spec proxy is:
//   MCF revenue = Σ (All-Orders Non-Amazon units per code × website per-unit net
//                    price for that code)         [meta.bySource.amazon-orders.mcf]
//   mcfShare    = MCF revenue / website net revenue
// CONSTRAINT (May 2026): the proxy is structurally fragile — MCF units (652,
// gross shipped from All-Orders) EXCEED website net units (610, net of Shopify
// returns/cancellations), so the raw ratio overshoots 1.0 (≈1.0242). A share
// >1 is non-physical for a blend weight, so we CAP to [0,1]. The cap is the
// fee-conservative (higher-fee) bound and keeps the blend math finite; the value
// is editable in-tool (§7) if the founder has a truer split. Codes with no
// website per-unit price contribute 0 MCF revenue (honest, never fabricated).
function buildMcfShare() {
  const mcf = facts.meta.bySource["amazon-orders"]?.mcf?.byCode || {};
  // website per-unit net price per code, from the shopify-net facts just baked.
  const perUnit = {};
  let webNet = 0;
  for (const [k, cell] of Object.entries(facts.monthly)) {
    const [m, ch, code] = k.split("|");
    if (m !== MONTH || ch !== "website") continue;
    const u = num(cell.units), n = num(cell.netRev);
    webNet += n;
    if (u > 0) perUnit[code] = n / u;
  }
  let mcfRev = 0;
  for (const [code, units] of Object.entries(mcf)) {
    if (perUnit[code] != null) mcfRev += units * perUnit[code];
  }
  const raw = webNet > 0 ? mcfRev / webNet : 0;
  const share = Math.max(0, Math.min(1, raw)); // CAP — a blend weight is in [0,1]
  facts.meta.bySource["amazon-orders"].mcfShare = {
    share: r2(share),
    rawProxy: r2(raw),         // un-capped ratio, kept for transparency
    mcfRev: r2(mcfRev),
    websiteNet: r2(webNet),
    capped: raw > 1 || raw < 0,
    asOf: "2026-06-12",
    source: "All-Orders Non-Amazon units × website per-unit net price (May build, capped [0,1])",
  };
  report.mcfShare = { share: r2(share), rawProxy: r2(raw), mcfRev: r2(mcfRev), websiteNet: r2(webNet), capped: raw > 1 || raw < 0 };
}

// ─── Run all ─────────────────────────────────────────────────────────────────
buildAmazon(); buildFlipkart(); buildBlinkit(); buildShopifyNet(); buildShopifyDaily();
buildAmazonSp(); buildFkPla(); buildGoogle(); buildSnell(); buildMonarch();
buildMcfShare(); // depends on amazon (mcf units) + shopify-net (per-unit price)

facts.meta.uploads = [
  "amazon-orders", "fk-sales", "blinkit-sales", "shopify-net", "shopify-daily",
  "ads-amazon-sp", "ads-fk-pla", "ads-google", "snell-agency", "monarch-web",
].map((sourceTag) => ({ sourceTag, at: new Date().toISOString(), baked: true }));

// ─── Emit bundled file ───────────────────────────────────────────────────────
const payload = { schemaVersion: 1, monthly: facts.monthly, daily: facts.daily, meta: facts.meta };
const out = `/**
 * bundledBusinessData.js — GENERATED by scripts/build-business-data.cjs.
 *
 * May-2026 Business Performance baseline in the pinned store shape
 * (businessStore.js). DO NOT hand-edit — regenerate via:
 *   node scripts/build-business-data.cjs
 *
 * Source files (May 2026): Amazon All-Orders TSV, Flipkart Sales Report,
 * Blinkit Sales Report, Shopify net-sales CSV, Shopify daily CSV, Amazon SP ads,
 * Flipkart PLA ads, Google product-wise ads, Snell Sale-tab spend, Monarch web.
 */
export const BUNDLED_BUSINESS = ${JSON.stringify(payload, null, 2)};
`;
fs.writeFileSync(OUT_JS, out);

// ─── Run summary (printed for the build log) ─────────────────────────────────
console.log("\n=== build-business-data: May 2026 ===");
console.log(JSON.stringify(report, null, 2));
console.log(`\nmonthly cells: ${Object.keys(facts.monthly).length} · daily cells: ${Object.keys(facts.daily).length}`);
console.log(`written → ${OUT_JS}`);
