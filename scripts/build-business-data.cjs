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

// ─── V2 channel-grain accumulators (reserved code "__ch__") ──────────────────
const CH_CODE = "__ch__";
function bumpChM(month, ch, fields, tier, src) {
  const key = `${month}|${ch}|${CH_CODE}`;
  const cur = facts.monthly[key] || { units: 0, grossRev: 0, netRev: 0, adSpend: 0, src: "" };
  for (const f of ["units", "grossRev", "netRev", "adSpend"]) if (fields[f] !== undefined) cur[f] = r2((cur[f] || 0) + num(fields[f]));
  cur.tier = tier;
  const s = new Set(String(cur.src || "").split(",").filter(Boolean)); s.add(src); cur.src = [...s].join(",");
  cur.source = src;
  facts.monthly[key] = cur;
}
function bumpChD(date, ch, fields, tier, src) {
  const key = `${date}|${ch}|${CH_CODE}`;
  const cur = facts.daily[key] || { units: 0, grossRev: 0, netRev: 0, adSpend: 0, src: "" };
  for (const f of ["units", "grossRev", "netRev", "adSpend"]) if (fields[f] !== undefined) cur[f] = r2((cur[f] || 0) + num(fields[f]));
  cur.tier = tier;
  const s = new Set(String(cur.src || "").split(",").filter(Boolean)); s.add(src); cur.src = [...s].join(",");
  cur.source = src;
  facts.daily[key] = cur;
}
// ─── V2 Snell Categorywise header → code (mirror of businessParsers) ─────────
function snellCatHeaderToCode(title) {
  const t = String(title || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!t || t === "date" || t === "total") return null;
  const mm = t.match(/\*\s*(\d+)\s*$/); const mult = mm ? parseInt(mm[1], 10) || 1 : 1;
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

// ═══ 9b · Snell FULL DAILY channel-grain history (V2, tier agency) ═══════════
function buildSnellHistory() {
  const p = resolve("SnellSales&AdsSheet", "xlsx"); if (!p) { console.error("MISSING SnellSales&AdsSheet.xlsx"); return; }
  const wb = XLSX.readFile(p);
  const saleName = wb.SheetNames.find((n) => /^sale$/i.test(n.trim())); if (!saleName) { console.error("Snell history: no Sale tab"); return; }
  const g = grid(wb.Sheets[saleName]);
  const b2 = ffRow(g[2] || []), r3 = g[3] || [];
  const C = {
    amzUnits: findSnellCol(b2, r3, /^total$/i, /shipped units/i),
    amzGross: findSnellCol(b2, r3, /total gross value/i, null),
    amzNet: findSnellCol(b2, r3, /final net without review/i, null),
    amzAd: findSnellCol(b2, r3, /actual ams spend/i, null),
    fkUnits: findSnellCol(b2, r3, /^total$/i, /^shipped$/i),
    fkGross: findSnellCol(b2, r3, /sale value gross/i, /fbf \+ nonfbf/i),
    fkNet: findSnellCol(b2, r3, /sale value net/i, /total net value/i),
    fkAd: findSnellCol(b2, r3, /flipkart spend\s*total/i, null),
    bkUnits: findSnellCol(b2, r3, /blinkit/i, /^total$/i),
    bkGross: findSnellCol(b2, r3, /sale value/i, /total gross value/i),
    bkAd: findSnellCol(b2, r3, /blinkit spend\s*total/i, null),
  };
  const get = (r, c) => (c === -1 ? 0 : num(r[c]));
  const span = {}; const mayCheck = { amazonNet: 0, flipkartNet: 0, blinkitGross: 0 };
  let dayRows = 0, chCells = 0;
  for (let i = 5; i < g.length; i++) {
    const r = g[i]; const d = r[0];
    if (typeof d !== "number" || d < 30000 || d > 80000) continue;
    const iso = excelToISODate(d); const m = monthOf(iso); if (!m) continue; dayRows++;
    const rows = [
      // M1 FIX (2026-06-12): "Final Net Without Review" (c22) is ALREADY net-of-GST
      // (Snell's net column), so use it AS-IS — the prior ÷1.05 double-discounted
      // every agency Amazon month ~5% (Nov-25 761266→799329, Mar-26 1215940→1276737).
      { ch: "amazon", units: get(r, C.amzUnits), gross: get(r, C.amzGross), net: get(r, C.amzNet), ad: get(r, C.amzAd) },
      { ch: "flipkart", units: get(r, C.fkUnits), gross: get(r, C.fkGross), net: get(r, C.fkNet), ad: get(r, C.fkAd) },
      { ch: "blinkit", units: get(r, C.bkUnits), gross: get(r, C.bkGross), net: get(r, C.bkGross) / 1.05, ad: get(r, C.bkAd) },
    ];
    for (const x of rows) {
      if (!x.units && !x.gross && !x.net && !x.ad) continue;
      const f = { units: x.units, grossRev: x.gross, netRev: x.net, adSpend: x.ad };
      bumpChD(iso, x.ch, f, "agency", "snell-history");
      bumpChM(m, x.ch, f, "agency", "snell-history"); chCells++;
      if (!span[x.ch]) span[x.ch] = { first: iso, last: iso };
      span[x.ch].last = iso; if (iso < span[x.ch].first) span[x.ch].first = iso;
      if (m === "2026-05") { if (x.ch === "amazon") mayCheck.amazonNet += x.net; if (x.ch === "flipkart") mayCheck.flipkartNet += x.net; if (x.ch === "blinkit") mayCheck.blinkitGross += x.gross; }
    }
  }
  const NATIVE = { amazonNet: 1143449.84, flipkartNet: 272842.99, blinkitGross: 281560 };
  const recon = {};
  for (const k of Object.keys(NATIVE)) { const a = r2(mayCheck[k]); recon[k] = { agency: a, native: NATIVE[k], delta: r2(a - NATIVE[k]), deltaPct: NATIVE[k] ? r2((a - NATIVE[k]) / NATIVE[k] * 100) : null }; }
  facts.meta.bySource["snell-history"] = {
    tier: "agency", source: "snell-history", channelSpan: span,
    netColumnChoice: {
      amazon: "Final Net Without Review (c22) AS-IS — M1 fix 2026-06-12: this column is ALREADY net-of-GST; the prior ÷1.05 double-discounted (~5% low). May agency net 1,213,769 = +6.15% vs native 1,143,450 (return-tail/review timing; native wins per V2.1, agency is shadow-only).",
      flipkart: "Total Net Value (c43) AS-IS — +0.59% vs native BIA",
      blinkit: "Gross (c53) ÷ 1.05 — Snell has no tax-netted net column (native ratio 0.95238 = 1/1.05)",
    },
    mayReconciliation: recon, columns: C,
  };
  report.snellHistory = { dayRows, channelGrainCells: chCells, span, mayReconciliation: recon };
}

// ═══ 9c · Snell Categorywise daily per-SKU UNITS (V2, tier agency) ═══════════
// Agency per-SKU units are revenue-LESS (cross-check/shape only). They are NOT
// written into facts.monthly/daily (the SKU-revenue keyspace the anchors sum) —
// they live in meta.bySource["snell-sku-units"].{monthly,daily} so they can NEVER
// double-count against native per-SKU revenue. Native > agency precedence is
// structural (separate namespace), order-independent.
function buildSnellSkuUnits() {
  const p = resolve("SnellSales&AdsSheet", "xlsx"); if (!p) return;
  const wb = XLSX.readFile(p);
  const tabs = [
    { re: /amz\s*categorywise/i, channel: "amazon" },
    { re: /fk\s*categorywise/i, channel: "flipkart" },
    { re: /blinkit\s*categorywise/i, channel: "blinkit" },
  ];
  const perChannel = {};
  const skuMonthly = {}, skuDaily = {};
  const addU = (map, key, u) => { map[key] = r2((map[key] || 0) + u); };
  for (const td of tabs) {
    const name = wb.SheetNames.find((n) => td.re.test(String(n).trim())); if (!name) continue;
    const g = grid(wb.Sheets[name]); if (g.length < 3) continue;
    const header = g[0] || []; const colMap = {}; let mapped = 0;
    for (let c = 1; c < header.length; c++) { const hit = snellCatHeaderToCode(header[c]); if (hit) { colMap[c] = hit; mapped++; } }
    if (mapped === 0) continue;
    let dayRows = 0, units = 0; const span = { first: null, last: null };
    for (let i = 1; i < g.length; i++) {
      const r = g[i]; const d = r[0];
      if (typeof d !== "number" || d < 30000 || d > 80000) continue;
      const iso = excelToISODate(d); const m = monthOf(iso); if (!m) continue; dayRows++;
      if (!span.first) span.first = iso; span.last = iso;
      for (const c of Object.keys(colMap)) {
        const { code, mult } = colMap[c]; const u = num(r[c]) * mult; if (!u) continue;
        addU(skuDaily, `${iso}|${td.channel}|${code}`, u);
        addU(skuMonthly, `${m}|${td.channel}|${code}`, u); units += u;
      }
    }
    perChannel[td.channel] = { tab: name, mappedCols: mapped, dayRows, units, span };
  }
  facts.meta.bySource["snell-sku-units"] = { tier: "agency", source: "snell-cat", perChannel, monthly: skuMonthly, daily: skuDaily };
  report.snellSkuUnits = perChannel;
}

// ═══ 10b · Monarch FULL DAILY website history (V2, tier monarch) ═════════════
function buildMonarchHistory() {
  const p = resolve("MonarchWebsiteSales&AdsSheet", "xlsx"); if (!p) return;
  const wb = XLSX.readFile(p);
  const masterName = wb.SheetNames.find((n) => /master sheet/i.test(n)); if (!masterName) return;
  const g = grid(wb.Sheets[masterName]);
  const H = (g[1] || []).map((h) => String(h || "").trim());
  const dateCol = H.findIndex((h) => /^date$/i.test(h));
  const salesCol = H.findIndex((h) => /^total sales$/i.test(h));
  const cancelCol = H.findIndex((h) => /total cancel/i.test(h));
  const convCol = H.findIndex((h) => /total conversion value/i.test(h));
  const googleCols = H.map((h, c) => (/google spend/i.test(h) ? c : -1)).filter((c) => c !== -1);
  const metaCols = H.map((h, c) => (/meta spend/i.test(h) ? c : -1)).filter((c) => c !== -1);
  if (dateCol === -1 || googleCols.length === 0 || metaCols.length === 0) { console.error("Monarch history: schema drift"); return; }
  const byMonth = {}; let firstISO = null, lastISO = null, dailyCells = 0;
  for (let i = 2; i < g.length; i++) {
    const r = g[i]; const iso = excelToISODate(r[dateCol]); const ym = monthOf(iso); if (!ym) continue;
    const conv = convCol !== -1 ? num(r[convCol]) : 0;
    const orders = salesCol !== -1 ? num(r[salesCol]) : 0;
    const cancels = cancelCol !== -1 ? num(r[cancelCol]) : 0;
    const google = Math.max(0, ...googleCols.map((c) => num(r[c])));
    const meta = Math.max(0, ...metaCols.map((c) => num(r[c])));
    const ad = google + meta;
    if (!conv && !orders && !cancels && !ad) continue;
    if (!firstISO) firstISO = iso; lastISO = iso;
    bumpChD(iso, "website", { units: orders, grossRev: conv, adSpend: ad }, "monarch", "monarch-history");
    bumpChM(ym, "website", { units: orders, grossRev: conv, adSpend: ad }, "monarch", "monarch-history"); dailyCells++;
    if (!byMonth[ym]) byMonth[ym] = { gConv: 0, orders: 0, cancels: 0, google: 0, meta: 0, days: 0, lastDay: iso };
    const b = byMonth[ym]; b.gConv += conv; b.orders += orders; b.cancels += cancels; b.google += google; b.meta += meta; b.days++; b.lastDay = iso;
  }
  facts.meta.bySource["monarch-history"] = {
    tier: "monarch", source: "monarch-history", span: { first: firstISO, last: lastISO },
    byMonth: Object.fromEntries(Object.keys(byMonth).sort().map((ym) => { const b = byMonth[ym]; return [ym, { grossConvValue: r2(b.gConv), orders: b.orders, cancels: b.cancels, googleSpend: r2(b.google), metaSpend: r2(b.meta), days: b.days, lastDay: b.lastDay }]; })),
  };
  report.monarchHistory = { months: Object.keys(byMonth).length, span: { first: firstISO, last: lastISO }, dailyCells };
}

// ═══ E · Snell cancel-rate per channel per month (V2 upside view E) ═══════════
// Sale tab carries shipped + cancel UNIT columns per channel daily. We roll up to
// month×channel {shipped, cancelled, total, cancelPct}. Amazon Total Shipped c7 /
// Cancel c8; Flipkart Total Shipped c35 / Cancel c36; Blinkit Shipped c50 / Cancel
// c51. Cancel rate = cancelled / (shipped+cancelled). Threshold coloring is a UI
// concern; the data layer only emits honest rates (no fabrication where a channel
// has no coverage that month — months with zero ship+cancel are omitted).
// SHAPE: meta.bySource["snell-cancel"] = {
//   source, byChannel: { amazon|flipkart|blinkit: { "YYYY-MM": { shipped, cancelled,
//   total, cancelPct } } }, latestByChannel: { ch: { month, cancelPct } } }.
function buildSnellCancel() {
  const p = resolve("SnellSales&AdsSheet", "xlsx"); if (!p) { console.error("MISSING SnellSales&AdsSheet.xlsx (cancel)"); return; }
  const wb = XLSX.readFile(p);
  const saleName = wb.SheetNames.find((n) => /^sale$/i.test(n.trim())); if (!saleName) { console.error("Snell cancel: no Sale tab"); return; }
  const g = grid(wb.Sheets[saleName]);
  const b2 = ffRow(g[2] || []), r3 = g[3] || [];
  const C = {
    amzShip: findSnellCol(b2, r3, /^total$/i, /shipped units/i),   // c7
    amzCanc: findSnellCol(b2, r3, /^total$/i, /cancel units/i),    // c8
    fkShip: findSnellCol(b2, r3, /^total$/i, /^shipped$/i),        // c35
    fkCanc: findSnellCol(b2, r3, /^total$/i, /^cancel$/i),         // c36
    bkShip: findSnellCol(b2, r3, /blinkit/i, /^shipped$/i),        // c50
    bkCanc: findSnellCol(b2, r3, /blinkit/i, /^cancel$/i),         // c51
  };
  const chans = [
    { ch: "amazon", ship: C.amzShip, canc: C.amzCanc },
    { ch: "flipkart", ship: C.fkShip, canc: C.fkCanc },
    { ch: "blinkit", ship: C.bkShip, canc: C.bkCanc },
  ];
  const acc = {}; // ch → ym → {shipped, cancelled}
  for (const x of chans) acc[x.ch] = {};
  for (let i = 5; i < g.length; i++) {
    const r = g[i]; const d = r[0]; if (typeof d !== "number" || d < 30000 || d > 80000) continue;
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
  facts.meta.bySource["snell-cancel"] = { source: "snell-cancel", tier: "agency", columns: C, byChannel, latestByChannel };
  report.snellCancel = { latestByChannel, monthsAmazon: Object.keys(byChannel.amazon || {}).length };
}

// ═══ B · Monarch SEO keyword rank-over-time (V2 upside view B) ════════════════
// "SEO - Keywords" tab: col0 = keyword, cols 1..N = rank snapshots with Excel-
// serial DATE headers (lower rank = better; 100 = not-ranked floor). We keep the
// TOP ~30 keywords (best current rank, ties broken by improvement) to stay inside
// the bundle budget, each with: latest rank, rank ~30d ago, earliest rank (the
// longest available baseline ≈ "90d"), best/worst over the window, and the snapshot
// date list. SHAPE: meta.bySource["monarch-seo"] = {
//   source, dates:[iso...] (sorted asc), keywords:[ { kw, latest, latestDate,
//   prev30, prev30Date, earliest, earliestDate, best, worst, movement30 (prev30 -
//   latest; +ve = improved/rank dropped), movementAll } ], totalKeywords }.
function buildMonarchSeo() {
  const p = resolve("MonarchWebsiteSales&AdsSheet", "xlsx"); if (!p) { console.error("MISSING Monarch (SEO)"); return; }
  const wb = XLSX.readFile(p);
  const seoName = wb.SheetNames.find((n) => /seo\s*-\s*keywords/i.test(n)); if (!seoName) { console.error("Monarch: no SEO - Keywords tab"); return; }
  const g = grid(wb.Sheets[seoName]);
  const hdr = g[0] || [];
  // Date columns (col 1+), sorted ascending so "latest" / "prev30" / "earliest" are stable.
  const dateCols = [];
  for (let c = 1; c < hdr.length; c++) { const iso = excelToISODate(hdr[c]); if (iso) dateCols.push({ c, iso }); }
  dateCols.sort((a, b) => (a.iso < b.iso ? -1 : 1));
  if (!dateCols.length) { console.error("Monarch SEO: no date columns"); return; }
  const isoList = dateCols.map((d) => d.iso);
  const latestCol = dateCols[dateCols.length - 1];
  const earliestCol = dateCols[0];
  // ~30d-ago column: the snapshot closest to 30 days before latest (fallback: 2nd-latest).
  const latestMs = Date.parse(latestCol.iso);
  let prev30 = dateCols[dateCols.length - 2] || dateCols[0];
  let bestDiff = Infinity;
  for (const d of dateCols) { if (d.iso >= latestCol.iso) continue; const diff = Math.abs((latestMs - Date.parse(d.iso)) / 86400000 - 30); if (diff < bestDiff) { bestDiff = diff; prev30 = d; } }
  const rows = [];
  for (let i = 1; i < g.length; i++) {
    const kw = String(g[i][0] || "").trim(); if (!kw) continue;
    const rk = (col) => { const v = g[i][col.c]; const n = num(v); return v === "" || v == null || !Number.isFinite(n) || n === 0 ? null : n; };
    const latest = rk(latestCol); if (latest == null) continue; // need a current rank to be useful
    const vals = dateCols.map((d) => rk(d)).filter((v) => v != null);
    const best = vals.length ? Math.min(...vals) : null;
    const worst = vals.length ? Math.max(...vals) : null;
    const prev = rk(prev30); const earliest = rk(earliestCol);
    rows.push({
      kw, latest, latestDate: latestCol.iso,
      prev30: prev, prev30Date: prev30.iso,
      earliest, earliestDate: earliestCol.iso,
      best, worst,
      movement30: prev != null ? r2(prev - latest) : null,   // +ve = rank number dropped = improved
      movementAll: earliest != null ? r2(earliest - latest) : null,
    });
  }
  // Keep TOP-N by best current rank (lower=better); tie-break by larger all-window improvement.
  rows.sort((a, b) => (a.latest - b.latest) || ((b.movementAll || 0) - (a.movementAll || 0)));
  const TOP_N = 30;
  const keywords = rows.slice(0, TOP_N);
  facts.meta.bySource["monarch-seo"] = { source: "monarch-seo", tier: "monarch", dates: isoList, prev30Date: prev30.iso, keywords, totalKeywords: rows.length };
  report.monarchSeo = { dates: isoList, totalKeywords: rows.length, kept: keywords.length, prev30Date: prev30.iso };
}

// ═══ C · Monarch Google-vs-Meta monthly efficiency (V2 upside view C) ═════════
// Master Sheet daily Google/Meta cols → monthly per-platform {spend, convValue,
// sales(orders), roas, cpa}. spend = MAX of the two candidate spend cols per
// platform per day (the live block; mirrors monarch-history's max-spend logic so
// the May totals tie to the website-ad-total anchor 212,958.35). ROAS = convValue
// / spend (same-window, guardable). CPA = spend / sales. SHAPE:
// meta.bySource["monarch-platform"] = { source, byMonth: { "YYYY-MM": {
//   google: {spend, convValue, sales, roas, cpa}, meta: {...} } } }.
function buildMonarchPlatform() {
  const p = resolve("MonarchWebsiteSales&AdsSheet", "xlsx"); if (!p) { console.error("MISSING Monarch (platform)"); return; }
  const wb = XLSX.readFile(p);
  const masterName = wb.SheetNames.find((n) => /master sheet/i.test(n)); if (!masterName) { console.error("Monarch platform: no Master Sheet"); return; }
  const g = grid(wb.Sheets[masterName]);
  const H = (g[1] || []).map((h) => String(h || "").trim());
  const dateCol = H.findIndex((h) => /^date$/i.test(h));
  // Resolve platform columns by band(row0)+leaf(row1) so a layout shift fails loud.
  const band = ffRow(g[0] || []);
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
    gSale: findCol(/google ads/i, /^sale$/i),       // c9
    gConv: findCol(/google ads/i, /^conversion value$/i), // c12
    mSale: findCol(/meta/i, /^sale$/i),             // c25
    mConv: findCol(/meta/i, /^conversion value$/i), // c28
  };
  if (dateCol === -1 || !gSpendCols.length || !mSpendCols.length) { console.error("Monarch platform: schema drift"); return; }
  const byMonth = {};
  for (let i = 2; i < g.length; i++) {
    const r = g[i]; const ym = monthOf(excelToISODate(r[dateCol])); if (!ym) continue;
    if (!byMonth[ym]) byMonth[ym] = { gS: 0, gCV: 0, gSale: 0, mS: 0, mCV: 0, mSale: 0 };
    const b = byMonth[ym];
    b.gS += Math.max(0, ...gSpendCols.map((c) => num(r[c])));
    b.mS += Math.max(0, ...mSpendCols.map((c) => num(r[c])));
    if (cols.gConv !== -1) b.gCV += num(r[cols.gConv]);
    if (cols.gSale !== -1) b.gSale += num(r[cols.gSale]);
    if (cols.mConv !== -1) b.mCV += num(r[cols.mConv]);
    if (cols.mSale !== -1) b.mSale += num(r[cols.mSale]);
  }
  const platMonth = (spend, conv, sales) => ({
    spend: r2(spend), convValue: r2(conv), sales: r2(sales),
    roas: spend > 0 ? r2(conv / spend) : null,
    cpa: sales > 0 ? r2(spend / sales) : null,
  });
  const out = {};
  for (const ym of Object.keys(byMonth).sort()) {
    const b = byMonth[ym];
    out[ym] = { google: platMonth(b.gS, b.gCV, b.gSale), meta: platMonth(b.mS, b.mCV, b.mSale) };
  }
  facts.meta.bySource["monarch-platform"] = { source: "monarch-platform", tier: "monarch", byMonth: out, columns: cols };
  report.monarchPlatform = { months: Object.keys(out).length };
}

// ═══ A · BusinessModel Repeats + Returns (V2 upside view A — HISTORICAL actuals)
// Founder rule 9 normally restricts BusinessModel to the variable cost %s; these
// two tabs are ACTUALS (historical repeat/returns), explicitly allowed for view A
// and SOURCE-LABELLED. We read from the BusinessModel workbook directly.
//   Repeats(Shopify & Amazon): Shopify quarterly repeat % + returning-sales %;
//     Amazon quarterly repeat share + sales-from-repeat share.
//   Returns(Shopify): monthly returns ₹ / gross ₹ / return % (month = Excel serial).
// SHAPE: meta.bySource["bm-repeats"] = { source, sourceLabel, shopify:[{quarter,
//   newCustomers, returningCustomers, totalCustomers, repeatPct, ...salesRow}],
//   amazon:[{quarter, repeatCustomers, repeatShare, salesFromRepeatShare}] }.
//   meta.bySource["bm-returns"] = { source, sourceLabel, monthly:[{month(iso),
//   returnsInr, grossInr, returnPct}] }.
function resolveBusinessModel() {
  // Prefer the " (1)" revised file the spec pins, else the plain name.
  const names = fs.readdirSync(RAW_DIR).filter((n) => /^Naturesum_BusinessModel(?: \(\d+\))?\.xlsx$/i.test(n));
  if (!names.length) return null;
  names.sort((a, b) => (b.length - a.length)); // " (1)" (longer) first
  return path.join(RAW_DIR, names[0]);
}
function buildBmRepeatsReturns() {
  const p = resolveBusinessModel(); if (!p) { console.error("MISSING Naturesum_BusinessModel.xlsx"); return; }
  const wb = XLSX.readFile(p);
  const SRC_LABEL = `Naturesum_BusinessModel.xlsx · ${path.basename(p)} (historical actuals — per founder rule 9, source-labelled)`;
  // ── Repeats ──
  const repName = wb.SheetNames.find((n) => /repeats/i.test(n));
  if (repName) {
    const g = grid(wb.Sheets[repName]);
    // Row1 = customer-count header; rows 2-5 = Shopify quarters (col0-4) + Amazon (col7-9).
    // Row6 = sales header; rows 7-10 = Shopify sales quarters + Amazon sales-from-repeat.
    const shopify = []; const amazon = [];
    const custRows = [2, 3, 4, 5];
    for (const i of custRows) {
      const r = g[i]; if (!r) continue;
      const q = String(r[0] || "").trim(); if (q) shopify.push({ quarter: q, newCustomers: num(r[1]), returningCustomers: num(r[2]), totalCustomers: num(r[3]), repeatPct: r2(num(r[4]) * 100) });
      const aq = String(r[7] || "").trim(); if (aq) amazon.push({ quarter: aq, repeatCustomers: num(r[8]), repeatShare: r2(num(r[9]) * 100) });
    }
    // Sales rows (7-10): merge returning-sales % into shopify by quarter; amazon sales-from-repeat share by quarter.
    const salesRows = [7, 8, 9, 10];
    const shopByQ = Object.fromEntries(shopify.map((s) => [s.quarter, s]));
    const amzByQ = Object.fromEntries(amazon.map((a) => [a.quarter, a]));
    for (const i of salesRows) {
      const r = g[i]; if (!r) continue;
      const q = String(r[0] || "").trim();
      if (q && shopByQ[q]) { shopByQ[q].newCustomerSales = r2(num(r[1])); shopByQ[q].returningCustomerSales = r2(num(r[2])); shopByQ[q].totalSales = r2(num(r[3])); shopByQ[q].returningSalesPct = r2(num(r[4]) * 100); }
      const aq = String(r[7] || "").trim();
      if (aq && amzByQ[aq]) { amzByQ[aq].salesFromRepeatShare = r2(num(r[9]) * 100); }
    }
    facts.meta.bySource["bm-repeats"] = { source: "bm-repeats", tier: "businessmodel", sourceLabel: SRC_LABEL, shopify, amazon };
    report.bmRepeats = { shopifyQuarters: shopify.length, amazonQuarters: amazon.length };
  } else { console.error("BusinessModel: no Repeats tab"); }
  // ── Returns ──
  const retName = wb.SheetNames.find((n) => /returns\(shopify\)/i.test(n) || /^returns/i.test(n.trim()));
  if (retName) {
    const g = grid(wb.Sheets[retName]);
    // Row1 = header (Month | Returns INR | Gross Sales INR | Return %). Data from row2; Month = Excel serial.
    const monthly = [];
    for (let i = 2; i < g.length; i++) {
      const r = g[i]; if (!r) continue; const iso = excelToISODate(r[0]); if (!iso) continue;
      monthly.push({ month: iso, returnsInr: r2(num(r[1])), grossInr: r2(num(r[2])), returnPct: r2(num(r[3]) * 100) });
    }
    monthly.sort((a, b) => (a.month < b.month ? -1 : 1));
    facts.meta.bySource["bm-returns"] = { source: "bm-returns", tier: "businessmodel", sourceLabel: SRC_LABEL, monthly };
    report.bmReturns = { months: monthly.length, span: monthly.length ? { first: monthly[0].month, last: monthly[monthly.length - 1].month } : null };
  } else { console.error("BusinessModel: no Returns tab"); }
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
    if (code === CH_CODE) continue;   // V2: skip channel-grain sentinel (not a SKU)
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

// ─── Daily-history thinning (bundle-budget guard) ────────────────────────────
// Keep the localStorage/bundle budget tight: full DAILY grain is retained for the
// most recent `monthsKept` months; daily cells older than that are DROPPED (the
// monthly rollup of the same data already survives — no information loss at month
// grain, the daily series is a trend signal only). Native May daily + recent
// agency/monarch daily are always preserved. Returns count dropped.
//
// EXCEPTION (V2 fixer): channels in `keepFullSpan` retain their ENTIRE daily
// history regardless of the cutoff. Amazon carries the 0-to-1 growth curve back
// to Aug-2024 (the single biggest "left on the table" item in the founder audit);
// it is channel-grain only (one cell per day), so keeping its full span costs ~9
// extra months × 1 channel ≈ a few hundred cells — a small, justified budget for
// surfacing the whole early-ramp revenue story in the daily chart's "all" range.
function thinDailyHistory(monthsKept = 13, keepFullSpan = ["amazon"]) {
  const keep = new Set(keepFullSpan);
  // Cutoff = first-of-month, (monthsKept-1) months before the latest daily date.
  const dates = Object.keys(facts.daily).map((k) => k.split("|")[0]).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (!dates.length) return 0;
  const latest = dates.sort().slice(-1)[0];
  const [ly, lm] = latest.slice(0, 7).split("-").map(Number);
  const cutoffMonthIdx = ly * 12 + (lm - 1) - (monthsKept - 1);
  const cutoffYm = `${String(Math.floor(cutoffMonthIdx / 12)).padStart(4, "0")}-${String((cutoffMonthIdx % 12) + 1).padStart(2, "0")}`;
  let dropped = 0;
  for (const k of Object.keys(facts.daily)) {
    const [date, ch] = k.split("|");
    if (keep.has(ch)) continue;            // full-span channel — never thinned
    const ym = date.slice(0, 7);
    if (ym < cutoffYm) { delete facts.daily[k]; dropped++; }
  }
  // Also thin the agency per-SKU-units DAILY map (meta namespace, same budget).
  let droppedSku = 0;
  const skuDaily = facts.meta.bySource?.["snell-sku-units"]?.daily;
  if (skuDaily) {
    for (const k of Object.keys(skuDaily)) {
      const ym = k.split("|")[0].slice(0, 7);
      if (ym < cutoffYm) { delete skuDaily[k]; droppedSku++; }
    }
  }
  report.dailyThinning = { monthsKept, keepFullSpan: [...keep], cutoffYm, latestDay: latest, droppedDailyCells: dropped, droppedAgencySkuDailyCells: droppedSku };
  return dropped;
}

// ─── Run all ─────────────────────────────────────────────────────────────────
buildAmazon(); buildFlipkart(); buildBlinkit(); buildShopifyNet(); buildShopifyDaily();
buildAmazonSp(); buildFkPla(); buildGoogle(); buildSnell(); buildMonarch();
buildSnellHistory(); buildSnellSkuUnits(); buildMonarchHistory();  // V2 full history
buildSnellCancel();      // E · cancel-rate per channel per month
buildMonarchSeo();       // B · SEO keyword rank-over-time (top-N)
buildMonarchPlatform();  // C · Google vs Meta monthly ROAS/CPA
buildBmRepeatsReturns(); // A · BusinessModel Repeats + Returns (historical actuals)
// D · per-SKU × channel monthly units mix is already baked in
// meta.bySource["snell-sku-units"].monthly ("YYYY-MM|channel|CODE" → units) — no
// new extraction needed; the channel-split bars view reads that map directly.
buildMcfShare(); // depends on amazon (mcf units) + shopify-net (per-unit price)
thinDailyHistory(13); // V2 bundle-budget guard (older daily dropped; monthly rollup survives)

facts.meta.uploads = [
  "amazon-orders", "fk-sales", "blinkit-sales", "shopify-net", "shopify-daily",
  "ads-amazon-sp", "ads-fk-pla", "ads-google", "snell-agency", "monarch-web",
  "snell-history", "snell-sku-units", "monarch-history",   // V2 full-history sources
  "snell-cancel", "monarch-seo", "monarch-platform", "bm-repeats", "bm-returns", // upside views A/B/C/E
].map((sourceTag) => ({ sourceTag, at: new Date().toISOString(), baked: true }));

// ─── M6 · latest-data-date (replaces the hard-coded "Last sync · 21 May" footer) ─
// The footer must reflect how FRESH THE DATA IS, not a wall-clock sync time. We
// derive the newest day present in the fact store: the max over all daily keys
// (native + agency/monarch channel-grain) plus the Snell/Monarch history span
// last-days (those survive even after daily thinning). The UI footer renders this
// as "Data through <latestDataDate>" (and may add "· app build <buildDate>").
function computeLatestDataDate() {
  let latest = null;
  const consider = (iso) => { if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) && (!latest || iso > latest)) latest = iso; };
  for (const k of Object.keys(facts.daily)) consider(k.split("|")[0]);
  // history spans survive thinning — include their last-days explicitly.
  const snh = facts.meta.bySource?.["snell-history"]?.channelSpan || {};
  for (const ch of Object.keys(snh)) consider(snh[ch]?.last);
  consider(facts.meta.bySource?.["monarch-history"]?.span?.last);
  const mbm = facts.meta.bySource?.["monarch-history"]?.byMonth || {};
  for (const ym of Object.keys(mbm)) consider(mbm[ym]?.lastDay);
  return latest;
}
facts.meta.latestDataDate = computeLatestDataDate();
facts.meta.appBuildDate = new Date().toISOString().slice(0, 10);
report.latestDataDate = facts.meta.latestDataDate;

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
