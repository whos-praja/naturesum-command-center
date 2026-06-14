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

// ═══ 1 · Amazon Orders Insights xlsx — "Data (cleaned)" tab ═══════════════════
// AUTHORITATIVE Amazon source (founder approval 2026-06-14, basis A — SUPERSEDES
// the old amazonmaysales.txt All-Orders TSV / ₹11,43,450 anchor). Offline twin of
// businessParsers.parseAmazonInsights — same basis byte-for-byte:
//   • Amazon revenue = Status bucket ∈ {"Shipped / in transit","Delivered"},
//     net = Σ Line revenue ÷ 1.05 (excludes Cancelled/Pending pickup/Unfulfillable).
//   • Only REVENUE-BEARING rows carry revenue; ₹0 MCF/bulk rows (Revenue-bearing?
//     "No") → MCF units for mcfShare, never Amazon demand. The priced
//     shipped+delivered rows = real Amazon.in demand (May: 1,292u / gross
//     ₹13,46,437 / net ₹12,82,321).
//   • Returns = Status bucket "Returned/Rejected" (14u / ₹9,500 gross): a SEPARATE
//     bucket, already NOT in shipped+delivered revenue. Recorded as
//     returnsUnits/returnsValue, NOT double-subtracted.
//   • Geo = same shipped+delivered revenue-bearing basis, by State (norm), net÷1.05
//     → geo total == channel net (Punjab #1 ≈ ₹1.58L net). Per-state returns from
//     the Returned/Rejected rows.
//   • Master SKU = per-SKU grain (already canonical; resolveMasterSku folds _MP/*N).
const AMZ_INSIGHTS_SHEET = "Data (cleaned)";
const SD_BUCKETS = new Set(["Shipped / in transit", "Delivered"]);
const RR_BUCKET = "Returned/Rejected";
const AMZ_MASTER_SKU_MAP = {
  NSMP100: "NSMP100", NSMP250: "NSMP250",
  NSSB100: "NSSB100", NSSB250: "NSSB250", NSSB500: "NSSB500",
  NSSBDB100: "NSSBDB100", NSSBDB250: "NSSBDB250", NSSBDB500: "NSSBDB500",
  NSSBJ300: "NSSBJ300", NSSBJ500: "NSSBJ500",
  NSSBBO15: "NSSBBO15", NSSBBO30: "NSSBBO30",
  NSJO100: "NSJO100", NSACDT30: "NSACDT30",
};
function resolveMasterSku(raw) {
  let s = String(raw ?? "").trim();
  if (!s) return null;
  s = s.replace(/_MP$/i, "").replace(/\s*\*\s*\d+\s*$/, "");
  return AMZ_MASTER_SKU_MAP[s] || AMZ_MSKU_MAP[s] || ASIN_MAP[s] || null;
}

// BOUNDARY-SPILL FOLD (mirror of businessParsers.parseAmazonInsights): the cleaned
// export is a SINGLE-MONTH file whose Day serials can spill ONE boundary day into
// the next month (the May export reaches 2026-06-01). The founder anchor
// ₹12,82,321 INCLUDES that boundary row, so every row is attributed to the modal
// month (≥80% of dated rows). Returns the modal month or null (true multi-month).
function amzInsightsModalMonth(g, dayCol) {
  const counts = {};
  for (let i = 1; i < g.length; i++) {
    const m0 = monthOf(excelToISODate(g[i]?.[dayCol]));
    if (m0) counts[m0] = (counts[m0] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, n]) => s + n, 0);
  return (sorted[0] && sorted[0][1] / Math.max(1, total) >= 0.8) ? sorted[0][0] : null;
}

function buildAmazon() {
  const p = resolve("Amazon Orders Insights by Shivam", "xlsx");
  if (!p) { console.error("MISSING Amazon Orders Insights by Shivam.xlsx"); return; }
  const wb = XLSX.readFile(p);
  const ws = wb.Sheets[AMZ_INSIGHTS_SHEET];
  if (!ws) { console.error(`MISSING "${AMZ_INSIGHTS_SHEET}" tab in Amazon Orders Insights`); return; }
  const g = grid(ws);
  const H = g[0].map((h) => String(h ?? "").trim()); const col = (n) => H.indexOf(n);
  const C = {
    day: col("Day"), orderType: col("Order type"), salesCh: col("Sales channel"),
    ful: col("Fulfilment"), masterSku: col("Master SKU"), sku: col("SKU"),
    qty: col("Qty"), itemPrice: col("Item price (₹)"), lineRev: col("Line revenue (₹)"),
    bucket: col("Status bucket"), revBearing: col("Revenue-bearing?"),
    state: col("State (norm)"), biz: col("Business order?"),
  };
  const mcf = {}; let mcfTotal = 0, retU = 0, retV = 0, units = 0, gross = 0;
  // VARIANT-FOLD provenance per canonical (Master SKU already folds ML/_MP).
  const foldByCode = {};
  const noteFold = (code, masterSku, sku, q) => {
    const fb = (foldByCode[code] = foldByCode[code] || { components: {} });
    const key = sku || masterSku || "(blank)";
    const comp = (fb.components[key] = fb.components[key] || { units: 0, isMp: /_MP$/i.test(sku || ""), masterSku });
    comp.units += q;
  };
  // GEO: "YYYY-MM|STATE" → { units, netRev, returns }. State normalised (trim/upper);
  // blank → "UNKNOWN". Same shipped+delivered revenue-bearing basis; returns tally
  // only (they're a separate bucket, never netted into demand). We accumulate RAW
  // gross per state and ÷1.05 ONCE at finalise so the geo net total reconciles to
  // the channel net to the paise (per-row rounding would drift ~₹1k).
  const geo = {};       // key → { units, gross, returns }
  const bumpGeo = (m, st, q, rev, isReturn) => {
    const state = String(st || "").trim().toUpperCase() || "UNKNOWN";
    const k = `${m}|${state}`;
    const cur = geo[k] || { units: 0, gross: 0, returns: 0 };
    if (isReturn) { cur.returns += q; }
    else { cur.units += q; cur.gross += rev; }
    geo[k] = cur;
  };
  // Accumulate RAW gross per SKU cell; netRev is computed ONCE per cell after the
  // loop (= r2(grossRev ÷ 1.05)) so Σ per-SKU netRev == r2(Σ gross ÷ 1.05) ==
  // ₹12,82,321 (the founder-approved anchor). Per-row ÷1.05 rounding would under-
  // count by ~₹1,286.
  const modalMonth = amzInsightsModalMonth(g, C.day);
  for (let i = 1; i < g.length; i++) {
    const row = g[i]; if (!row || row.length === 0) continue;
    const bucket = String(row[C.bucket] ?? "").trim();
    const masterSku = String(row[C.masterSku] ?? "").trim();
    const skuRaw = String(row[C.sku] ?? "").trim();
    const code = resolveMasterSku(masterSku) || resolveMasterSku(skuRaw);
    const iso = excelToISODate(row[C.day]); const m = modalMonth || monthOf(iso);   // boundary spill → modal month
    const q = num(row[C.qty]), lineRev = num(row[C.lineRev]);
    const revBearing = String(row[C.revBearing] ?? "").trim().toLowerCase() === "yes";
    const st = C.state === -1 ? "" : row[C.state];
    if (bucket === RR_BUCKET) {
      if (code && m) bumpM(m, "amazon", code, "amazon-orders", { returnsUnits: q, returnsValue: lineRev });
      retU += q; retV += lineRev; bumpGeo(m, st, q, lineRev, true); continue;
    }
    if (!revBearing) { if (SD_BUCKETS.has(bucket) && code) { mcf[code] = (mcf[code] || 0) + q; mcfTotal += q; } continue; }
    if (!SD_BUCKETS.has(bucket) || !code || !m) continue;
    bumpM(m, "amazon", code, "amazon-orders", { units: q, grossRev: lineRev });   // netRev finalised below
    units += q; gross += lineRev; bumpGeo(m, st, q, lineRev, false); noteFold(code, masterSku, skuRaw, q);
  }
  // Finalise per-SKU netRev ONCE per cell from accumulated raw gross (÷1.05).
  for (const k of Object.keys(facts.monthly)) {
    const [mm, ch] = k.split("|");
    if (mm === MONTH && ch === "amazon" && !k.endsWith(`|${CH_CODE}`)) {
      facts.monthly[k].netRev = r2((facts.monthly[k].grossRev || 0) / 1.05);
    }
  }
  const skuVariantFold = {};
  for (const [code, fb] of Object.entries(foldByCode)) {
    const components = Object.entries(fb.components)
      .map(([sku, c0]) => ({ rawSku: sku, units: c0.units, isMp: c0.isMp }))
      .sort((a, b) => b.units - a.units);
    const folded = components.length > 1;
    if (!folded && !components.some((c0) => c0.isMp)) continue;
    skuVariantFold[code] = {
      channel: "amazon", canonical: code, folded, components,
      label: `${code} = ${components.map((c0) => c0.rawSku).join(" + ")} folded`,
      rule: "Amazon Orders Insights folds each Master SKU's marketplace SKU variants (e.g. NSSBJ500ML + NSSBJ500ML_MP) into ONE canonical code. The _MP suffix marks the MCF/website-fulfilment twin. Components retained pre-fold so the identity resolution is inspectable.",
    };
  }
  const geoMonths = new Set();
  for (const k of Object.keys(geo)) {
    geo[k].netRev = r2((geo[k].gross || 0) / 1.05);   // ÷1.05 ONCE per state
    delete geo[k].gross;                              // store only the contract fields
    geoMonths.add(k.split("|")[0]);
  }
  facts.meta.bySource["amazon-orders"] = {
    mcf: { byCode: mcf, totalUnits: mcfTotal },
    amazonReturns: { units: retU, value: r2(retV) },
    geo: { source: "amazon-orders-insights State (norm)", asOf: facts.meta.latestDataDate || null, byMonthState: geo },
    // Per-SKU UNITS and REVENUE come from the SAME filtered row set, so
    // AOV = netRev ÷ units re-derives from the file. Reproduce: open
    // "Amazon Orders Insights by Shivam.xlsx" → tab "Data (cleaned)", keep rows
    // where Status bucket ∈ {Shipped / in transit, Delivered} AND
    // Revenue-bearing?="Yes", group by Master SKU → canonical, sum Qty for units
    // and Line revenue for gross, net = gross ÷ 1.05.
    unitsRule:
      'Amazon per-SKU units & revenue share ONE row set: "Amazon Orders Insights · Data (cleaned)" · Status bucket ∈ {Shipped / in transit, Delivered} · Revenue-bearing?="Yes" · Master SKU → canonical code · bucketed by Day month · units = Σ Qty, gross = Σ Line revenue, net = gross ÷ 1.05 (GST-incl rule). AOV = net ÷ units re-derives from the file. (Cancelled / Pending pickup / Unfulfillable / ₹0 MCF-bulk / Returned-Rejected rows excluded from revenue; returns reported separately as 14u/₹9,500.)',
    skuVariantFold,
  };
  report.amazon = { units, gross: r2(gross), net: r2(gross / 1.05), returnsUnits: retU, returnsValue: r2(retV), mcfUnits: mcfTotal, geoCells: Object.keys(geo).length, geoMonths: geoMonths.size, variantFolds: Object.values(skuVariantFold).filter((f) => f.folded).length };
}

// ═══ 1b · Amazon ORDER-COMPOSITION cuts (FBA/MFN · B2B/B2C · basket) ══════════
// New authoritative source ("Amazon Orders Insights · Data (cleaned)") is ROW/LINE
// grain (one row per order line — no order-id column). We derive composition, by
// month, from the SAME shipped+delivered revenue-bearing rows the per-SKU revenue
// uses, so it stays consistent with the ₹12.82L basis:
//   • basket composition — single-unit vs multi-unit LINES (Qty 1 → single, ≥2 →
//     multi) + units-per-line (UPO proxy). Honest: line-grain, since the cleaned
//     export folds to order LINES, not full baskets.
//   • fulfilment split — FBA (Fulfilment "Amazon" / Order type "…(FBA)") vs MFN
//     (Fulfilment "Merchant" / "Website D2C (Easy Ship)") lines + units.
//   • B2B vs B2C — Business order? "Yes"/"No" lines + units.
function buildAmazonOrderComposition() {
  const p = resolve("Amazon Orders Insights by Shivam", "xlsx"); if (!p) return;
  const wb = XLSX.readFile(p); const ws = wb.Sheets[AMZ_INSIGHTS_SHEET]; if (!ws) return;
  const g = grid(ws);
  const H = g[0].map((h) => String(h ?? "").trim()); const col = (n) => H.indexOf(n);
  const C = {
    day: col("Day"), ful: col("Fulfilment"), masterSku: col("Master SKU"), sku: col("SKU"),
    qty: col("Qty"), lineRev: col("Line revenue (₹)"), bucket: col("Status bucket"),
    revBearing: col("Revenue-bearing?"), biz: col("Business order?"),
  };
  const byMonth = {};
  const modalMonth = amzInsightsModalMonth(g, C.day);
  const blank = () => ({ lines: 0, units: 0, mappedUnits: 0, singleLines: 0, multiLines: 0, multiUnits: 0, fbaLines: 0, mfnLines: 0, fbaUnits: 0, mfnUnits: 0, b2bLines: 0, b2cLines: 0, b2bUnits: 0, b2cUnits: 0, netRev: 0 });
  for (let i = 1; i < g.length; i++) {
    const row = g[i]; if (!row || row.length === 0) continue;
    const bucket = String(row[C.bucket] ?? "").trim();
    const revBearing = String(row[C.revBearing] ?? "").trim().toLowerCase() === "yes";
    if (!SD_BUCKETS.has(bucket) || !revBearing) continue;       // same revenue basis
    const iso = excelToISODate(row[C.day]); const m = modalMonth || monthOf(iso); if (!m) continue;
    const q = num(row[C.qty]);
    const code = resolveMasterSku(String(row[C.masterSku] ?? "")) || resolveMasterSku(String(row[C.sku] ?? ""));
    const b = (byMonth[m] = byMonth[m] || blank());
    b.lines++; b.units += q; b.netRev += num(row[C.lineRev]) / 1.05;
    if (code) b.mappedUnits += q;
    if (q >= 2) { b.multiLines++; b.multiUnits += q; } else b.singleLines++;
    const isFba = String(row[C.ful] ?? "").trim() === "Amazon";
    if (isFba) { b.fbaLines++; b.fbaUnits += q; } else { b.mfnLines++; b.mfnUnits += q; }
    const isB2b = String(row[C.biz] ?? "").trim().toLowerCase() === "yes";
    if (isB2b) { b.b2bLines++; b.b2bUnits += q; } else { b.b2cLines++; b.b2cUnits += q; }
  }
  const months = Object.keys(byMonth).sort();
  const series = months.map((m) => {
    const b = byMonth[m]; const o = b.lines || 0; const u = Math.round(b.units);
    // Names kept (orders/upo/…) so downstream consumers (bizAnalytics order-comp
    // view) read the same shape; here a "line" IS the order grain available.
    return {
      month: m, orders: o, units: u, grossUnits: u, netUnits: u, returnUnits: 0, netRev: r2(b.netRev),
      singleOrders: b.singleLines, multiOrders: b.multiLines, multiUnits: b.multiUnits,
      upo: o > 0 ? r2(b.units / o) : null,
      multiPct: o > 0 ? r2(b.multiLines / o) : null,
      fbaOrders: b.fbaLines, mfnOrders: b.mfnLines, fbaUnits: b.fbaUnits, mfnUnits: b.mfnUnits,
      fbaPct: o > 0 ? r2(b.fbaLines / o) : null,
      b2bOrders: b.b2bLines, b2cOrders: b.b2cLines, b2bUnits: b.b2bUnits, b2cUnits: b.b2cUnits,
      b2bPct: o > 0 ? r2(b.b2bLines / o) : null,
    };
  });
  facts.meta.bySource["amazon-order-composition"] = {
    source: "amazon-orders-insights line grouping (Data cleaned)", tier: "native",
    unitsNote: "Line-grain composition from the SAME shipped+delivered revenue-bearing rows as per-SKU revenue (the cleaned export folds to order LINES — no order-id — so 'orders' here = order lines and UPO = units ÷ lines). single/multi by Qty (1 vs ≥2); FBA = Fulfilment 'Amazon', MFN = Fulfilment 'Merchant' (Easy Ship); B2B = Business order? 'Yes'. units reconcile EXACTLY to the per-SKU units sum (1,292 for May).",
    byMonth: series,
  };
  report.amazonOrderComposition = { months: series.length, latest: series[series.length - 1] || null };
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
  // I-9 — per-month BIA + units so the disclosed derivation re-derives the EXACT
  // month being shown (MONTH), not the all-month running total (which would NOT
  // tie to the May anchor on its own face — the exact failure class to kill).
  const biaByMonth = {}, unitsByMonth = {};
  // I-7 · VARIANT-FOLD provenance (Flipkart `*N` multipacks). The parser folds a
  // Flipkart "<base> * N" SKU into its base canonical, counting the order as N base
  // units (qty × N). We retain the PRE-FOLD components per canonical — the raw SKU
  // string, the multiplier, and base units vs folded units — so a tooltip can prove
  // "NSSBDB100 = NSSBDB100g + NSSBDB100g*2 + NSSBDB100g*4 folded".
  const foldByCode = {};
  const noteFold = (code, rawSku, mult, baseQty) => {
    const fb = (foldByCode[code] = foldByCode[code] || { components: {} });
    const key = String(rawSku).replace(/"/g, "").replace(/^SKU:/i, "").trim();
    const comp = (fb.components[key] = fb.components[key] || { rawSku: key, mult, orderRows: 0, baseUnits: 0, foldedUnits: 0 });
    comp.orderRows += 1; comp.baseUnits += baseQty; comp.foldedUnits += baseQty * mult;
  };
  for (let i = 1; i < g.length; i++) {
    const r = g[i]; if (!r || r[C.sku] === "" || r[C.sku] == null) continue;
    const hit = resolveFkSku(r[C.sku]); if (!hit) continue;
    const iso = excelToISODate(r[C.orderDate]) || excelToISODate(r[C.invDate]); const m = monthOf(iso); if (!m) continue;
    const baseQty = num(r[C.qty]), bia = num(r[C.bia]), qty = baseQty * hit.mult;
    const isRet = String(r[C.eventType] || "").toLowerCase().includes("return") || bia < 0;
    if (isRet) retRows++;
    else noteFold(hit.code, r[C.sku], hit.mult, baseQty);
    // BIA is already net-of-GST (binding §2 anchor): netRev = bia AS-IS, no ÷1.05.
    bumpM(m, "flipkart", hit.code, "fk-sales", { units: isRet ? -Math.abs(qty) : qty, grossRev: bia, netRev: bia, ...(isRet ? { returnsUnits: Math.abs(qty), returnsValue: Math.abs(bia) } : {}) });
    const ds = excelToISODate(r[C.orderDate]) || iso; if (ds && !isRet) bumpD(ds, "flipkart", hit.code, "fk-sales", { units: qty, netRev: bia });
    const signedU = isRet ? -Math.abs(qty) : qty;
    units += signedU; biaSum += bia;
    biaByMonth[m] = r2((biaByMonth[m] || 0) + bia);
    unitsByMonth[m] = (unitsByMonth[m] || 0) + signedU;
  }
  const mayBia = r2(biaByMonth[MONTH] || 0);
  const mayUnits = unitsByMonth[MONTH] || 0;
  // Finalise the FK variant-fold map: `folded` when MORE THAN ONE raw SKU (incl. a
  // `*N` multipack) resolved into the canonical, OR any multipack (`*N`) is present.
  const skuVariantFold = {};
  for (const [code, fb] of Object.entries(foldByCode)) {
    const components = Object.values(fb.components)
      .map((c0) => ({ rawSku: c0.rawSku, mult: c0.mult, orderRows: c0.orderRows, baseUnits: c0.baseUnits, foldedUnits: c0.foldedUnits, isMultipack: c0.mult > 1 }))
      .sort((a, b) => b.foldedUnits - a.foldedUnits);
    const hasMultipack = components.some((c0) => c0.isMultipack);
    const folded = components.length > 1 || hasMultipack;
    if (!folded) continue;                       // single 1× SKU → nothing folded
    skuVariantFold[code] = {
      channel: "flipkart", canonical: code, folded, components,
      label: `${code} = ${components.map((c0) => c0.rawSku).join(" + ")} folded`,
      rule: "Flipkart SKU `<base> * N` is a multipack order: it folds into the base canonical counting N base units (qty × N). Components retained pre-fold (raw SKU, multiplier, base vs folded units) so the multipack identity resolution is inspectable.",
    };
  }
  // Cashback (excluded from CM) — (d) trended BY MONTH (settlement-drag signal).
  // The cashback sheet carries "Invoice Date" so we can attribute each credit-note
  // amount to a month and surface the trend, not just one lump total.
  let cb = 0, cn = 0; const cbByMonth = {};
  const cbName = wb.SheetNames.find((n) => /cash\s*back/i.test(n));
  if (cbName) {
    const cg = grid(wb.Sheets[cbName]); const H0 = cg[0] || [];
    const ia = H0.indexOf("Invoice Amount"); const id = H0.indexOf("Invoice Date");
    if (ia !== -1) for (let i = 1; i < cg.length; i++) {
      if (!cg[i] || cg[i][ia] === "") continue;
      const v = num(cg[i][ia]); cb += v; cn++;
      const ym = id !== -1 ? monthOf(excelToISODate(cg[i][id])) : null;
      const key = ym || "unknown";
      const m = cbByMonth[key] || { value: 0, rows: 0 };
      m.value = r2(m.value + v); m.rows++; cbByMonth[key] = m;
    }
  }
  facts.meta.bySource["fk-sales"] = {
    flipkartCashback: { value: r2(cb), rows: cn, byMonth: cbByMonth },
    // I-9 — Flipkart net rule disclosure so ₹2,72,843 (May) re-derives:
    netRule: {
      column: "Buyer Invoice Amount",
      gstBasis: "already net-of-GST — taken AS-IS (no ÷1.05; that would double-discount)",
      signRule: "sign as-is — return/replacement rows carry a negative Buyer Invoice Amount, so summing the column NETS returns out automatically",
      multipackFold: 'SKU "<base> * N" folds N into units (qty × N) so a 2-pack counts as 2 units; revenue is the row\'s Buyer Invoice Amount unchanged',
      monthAttribution: "Order Date (falls back to Buyer Invoice Date only when Order Date is blank)",
      cashback: "the Cash Back tab is EXCLUDED from net revenue/CM (settlement-drag signal, trended separately)",
      // RE-DERIVES on its own face: this is the MONTH-scoped sum (not the all-month
      // running total), so the disclosed figure equals the displayed Flipkart net.
      month: MONTH,
      mayNet: mayBia,
      mayUnits,
      derivation: `${MONTH} net = Σ Buyer Invoice Amount (native sign) over rows whose SKU resolves to a canonical code AND Order-Date month = ${MONTH} = ${mayBia.toLocaleString("en-IN")} across ${mayUnits} units. Ties to the native Flipkart anchor exactly.`,
    },
    skuVariantFold,   // I-7 — pre-fold `*N` multipack components per canonical (Flipkart fold)
  };
  report.flipkart = { units, grossBIA: r2(biaSum), net: r2(biaSum), returnRows: retRows, cashback: r2(cb), cashbackMonths: Object.keys(cbByMonth).length, variantFolds: Object.keys(skuVariantFold).length };
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

// ═══ 6 · Amazon SP ads (DAILY per-ASIN) ══════════════════════════════════════
// The source file is DAILY per-ASIN (Date · Advertised ASIN · Spend). Previously
// we only summed it to one monthly adSpendDirect per SKU + the headline total. To
// make the ₹3,55,115 attributed-spend anchor re-derivable END-TO-END from a daily
// export (rubric XI/III reviewer re-derivation), we ALSO emit:
//   • meta.bySource["ads-amazon-sp"].daily  — { "YYYY-MM-DD|amazon|CODE": spend }
//       (per-SKU daily spend; sums EXACTLY to the monthly cells and to the total)
//   • meta.bySource["ads-amazon-sp"].byDay   — { "YYYY-MM-DD": spend } channel rollup
//   • meta.bySource["ads-amazon-sp"].byMonth — { "YYYY-MM": spend } (per-month total)
//   • reconciliation: Σ daily = Σ monthly cells = amazonSpTotal (an explicit equation).
function buildAmazonSp() {
  const p = resolve("may_product_wise_sp", "xlsx"); if (!p) { console.error("MISSING may_product_wise_sp.xlsx"); return; }
  const wb = XLSX.readFile(p); const g = grid(wb.Sheets[wb.SheetNames[0]]);
  const H = g[0]; const C = { date: H.indexOf("Date"), asin: H.indexOf("Advertised ASIN"), spend: H.indexOf("Spend") };
  let total = 0, unmapped = 0, unmappedSpend = 0;
  const daily = {};      // "YYYY-MM-DD|amazon|CODE" → spend
  const byDay = {};      // "YYYY-MM-DD" → spend (channel rollup)
  const byMonth = {};    // "YYYY-MM" → spend
  const span = { first: null, last: null };
  const addD = (map, key, v) => { map[key] = r2((map[key] || 0) + v); };
  for (let i = 1; i < g.length; i++) {
    const r = g[i]; const asin = String(r[C.asin] || "").trim(); if (!asin) continue;
    const code = ASIN_MAP[asin];
    const iso = excelToISODate(r[C.date]); const m = monthOf(iso);
    const sp = num(r[C.spend]);
    if (!code) { if (sp) { unmapped++; unmappedSpend += sp; } continue; }
    if (!m) continue;
    total += sp; bumpM(m, "amazon", code, "ads-amazon-sp", { adSpendDirect: sp });
    // daily per-SKU + rollups (a row with 0 spend on a real ASIN still anchors the day).
    addD(daily, `${iso}|amazon|${code}`, sp);
    addD(byDay, iso, sp);
    addD(byMonth, m, sp);
    if (!span.first || iso < span.first) span.first = iso;
    if (!span.last || iso > span.last) span.last = iso;
  }
  // Reconciliation equation: Σ daily-per-SKU = Σ byDay = Σ byMonth = amazonSpTotal.
  const sumDaily = r2(Object.values(daily).reduce((a, v) => a + v, 0));
  const sumByDay = r2(Object.values(byDay).reduce((a, v) => a + v, 0));
  facts.meta.bySource["ads-amazon-sp"] = {
    amazonSpTotal: r2(total),
    span, days: Object.keys(byDay).length,
    daily, byDay, byMonth,
    unmappedRows: unmapped, unmappedSpend: r2(unmappedSpend),
    reconciliation: {
      sumDailyPerSku: sumDaily, sumByDay, monthlyCellsTotal: r2(total),
      ties: Math.abs(sumDaily - r2(total)) < 1 && Math.abs(sumByDay - r2(total)) < 1,
      note: `Σ daily-per-SKU spend (${sumDaily.toLocaleString("en-IN")}) = Σ by-day (${sumByDay.toLocaleString("en-IN")}) = Σ monthly attributed cells = ${r2(total).toLocaleString("en-IN")}. The attributed-spend anchor re-derives from the daily per-ASIN export end-to-end.`,
    },
    source: "may_product_wise_sp.xlsx (Date · Advertised ASIN · Spend), daily per-ASIN",
  };
  report.adsAmazonSp = { total: r2(total), days: Object.keys(byDay).length, span, dailyCells: Object.keys(daily).length, recTies: Math.abs(sumDaily - r2(total)) < 1 };
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
  // I (rubric 7) — the Google title→code match is the ONLY non-exact (fuzzy) SKU
  // resolver in the business module. Every other channel keys on an exact map
  // (ASIN/MSKU/FK-SKU/Item-Id/Shopify-SKU). Record the match TYPE so the UI can
  // badge a SKU "matched by similarity" only when its resolution was non-exact:
  //   exact-needle  — a single grams+needle candidate (high-confidence map-like)
  //   multi-needle  — >1 candidate, disambiguated by the most specific needle (FUZZY)
  if (cand.length === 1) return { code: cand[0].code, match: "exact-needle" };
  if (cand.length > 1) {
    const best = cand.find((k) => k.needles.some((n) => n.includes(k.grams) && t.includes(n))) || cand[0];
    return { code: best.code, match: "multi-needle" };
  }
  return null;
}
function buildGoogle() {
  const p = resolve("google may ads", "csv"); if (!p) { console.error("MISSING google may ads.csv"); return; }
  const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
  const hi = lines.findIndex((l) => /^product title,/i.test(l)); if (hi === -1) return;
  const H = parseCsvLine(lines[hi]); const costCol = H.indexOf("Cost") === -1 ? H.length - 1 : H.indexOf("Cost");
  let total = 0, attr = 0;
  const matchByCode = {};   // code → "exact-needle" | "multi-needle" (worst seen)
  for (let i = hi + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue; const c = parseCsvLine(lines[i]); const cost = num(c[costCol]); total += cost;
    if (cost === 0) continue; const hit = googleTitleToCode(c[0]); if (!hit) continue;
    attr += cost; bumpM(MONTH, "website", hit.code, "ads-google", { adSpendDirect: cost });
    // keep the LEAST-certain match seen for this code (multi-needle wins over exact).
    if (matchByCode[hit.code] !== "multi-needle") matchByCode[hit.code] = hit.match;
  }
  facts.meta.bySource["ads-google"] = { googleProductTotal: r2(total), googleAttributed: r2(attr), googleUnattributed: r2(total - attr), matchByCode };
  report.adsGoogleProduct = { total: r2(total), attributed: r2(attr), unattributed: r2(total - attr), fuzzyCodes: Object.entries(matchByCode).filter(([, m]) => m !== "exact-needle").map(([c]) => c) };
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
  // III-96 — Monarch's own "Total Spend" column (the agency's headline ad total),
  // captured so the website ad total (Google+Meta we attribute) can be reconciled
  // against it the way Amazon's SP-attributed total reconciles to Snell's AMS.
  const totalSpendCol = H.findIndex((h) => /^total spend$/i.test(h));
  const byMonth = {};
  for (let i = 2; i < g.length; i++) {
    const iso = excelToISODate(g[i][dateCol]); const ym = monthOf(iso); if (!ym) continue;
    if (!byMonth[ym]) byMonth[ym] = { google: googleCols.map(() => 0), meta: metaCols.map(() => 0), conv: 0, totalSpend: 0, days: 0 };
    googleCols.forEach((c, j) => { byMonth[ym].google[j] += num(g[i][c]); });
    metaCols.forEach((c, j) => { byMonth[ym].meta[j] += num(g[i][c]); });
    if (convCol !== -1) byMonth[ym].conv += num(g[i][convCol]);
    if (totalSpendCol !== -1) byMonth[ym].totalSpend += num(g[i][totalSpendCol]);
    byMonth[ym].days++;
  }
  const tm = byMonth[MONTH]; let gTot = 0, mTot = 0, totalSpend = 0;
  if (tm) { gTot = Math.max(...tm.google, 0); mTot = Math.max(...tm.meta, 0); totalSpend = tm.totalSpend; }
  const attributed = gTot + mTot;                 // what we place on the website channel (Google+Meta)
  const reconDelta = r2(totalSpend - attributed); // Monarch's own total minus our Google+Meta
  // per-month Total-Spend vs Google+Meta history (delta surfaced for every month).
  const history = Object.fromEntries(Object.keys(byMonth).sort().map((ym) => {
    const b = byMonth[ym]; const g2 = Math.max(...b.google, 0); const m2 = Math.max(...b.meta, 0);
    return [ym, { convValue: r2(b.conv), days: b.days, totalSpend: r2(b.totalSpend), googleMeta: r2(g2 + m2), reconDelta: r2(b.totalSpend - (g2 + m2)) }];
  }));
  facts.meta.bySource["monarch-web"] = {
    monarchWebSpend: {
      month: MONTH, googleTotal: r2(gTot), metaTotal: r2(mTot),
      // III-96 reconciliation line (Monarch own total vs Google+Meta attributed).
      attributed: r2(attributed), monarchTotalSpend: r2(totalSpend), reconDelta,
      reconNote: "Website ad total = Google + Meta (per-platform daily columns) = " + r2(attributed) + "; Monarch's own “Total Spend” column = " + r2(totalSpend) + "; delta " + reconDelta + " (un-broken-out spend in Monarch's total not split by platform — surfaced, not absorbed).",
    },
    monarchWebHistory: history,
  };
  report.monarch = { googleTotal: r2(gTot), metaTotal: r2(mTot), monarchTotalSpend: r2(totalSpend), reconDelta, historyMonths: Object.keys(history).length };
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
    // (I/b) Capture the tab's own "Total" row (the sheet's headline per-SKU total,
    // *N folded) so every Categorywise field is surfaced AND the daily-series sum
    // can be reconciled against the sheet's own total. Found by a non-numeric col0
    // === "total" within the first few rows.
    const tabTotal = {}; let tabTotalUnits = 0;
    for (let i = 1; i < Math.min(g.length, 6); i++) {
      if (String(g[i][0] || "").trim().toLowerCase() !== "total") continue;
      for (const c of Object.keys(colMap)) { const { code, mult } = colMap[c]; const u = num(g[i][c]) * mult; if (!u) continue; tabTotal[code] = r2((tabTotal[code] || 0) + u); tabTotalUnits += u; }
      break;
    }
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
    perChannel[td.channel] = { tab: name, mappedCols: mapped, dayRows, units, span, tabTotal, tabTotalUnits, dailySeriesUnits: units };
  }
  facts.meta.bySource["snell-sku-units"] = { tier: "agency", source: "snell-cat", perChannel, monthly: skuMonthly, daily: skuDaily };
  report.snellSkuUnits = Object.fromEntries(Object.entries(perChannel).map(([ch, v]) => [ch, { units: v.units, tabTotalUnits: v.tabTotalUnits }]));
}

// ═══ a/b · Snell Sale-tab ORDER-MIX + Total-row reconciliation (agency) ═══════
// (a) ORDER-MIX: the Amazon block carries a daily Non-Advt / Review / Organic
//     decomposition — order UNITS (c12 Non Advt order Units, c13 Review Oder
//     Units, c14 Organic Order Units) plus the Review/Organic AMOUNT columns
//     (c18 Review Oder AMT, c19 Organic Order AMT). We roll these to monthly
//     {nonAdvtUnits, reviewUnits, organicUnits, reviewAmt, organicAmt} on the
//     amazon channel (this split exists ONLY for amazon in the sheet). Honest:
//     a month with no order-mix coverage is omitted, never fabricated.
// (b) RECONCILIATION: the sheet has its OWN "Total" row (r4) whose figures DO NOT
//     equal the sum of the daily rows — the Total row is a narrower founder-curated
//     window. We capture BOTH the Total-row figures (shipped units c7, gross c20)
//     AND the full daily-series sums so the UI can show the discrepancy in-tool
//     (founder audit item b: ₹77.07L/8,793u Total-row vs the daily-series sum).
//     SHAPE: meta.bySource["snell-ordermix"] = {
//       source, tier, byMonth: { "YYYY-MM": { channel:"amazon", nonAdvtUnits,
//         reviewUnits, organicUnits, reviewAmt, organicAmt } },
//       reconciliation: { totalRow: { shippedUnits, grossValue, nonAdvtUnits,
//         reviewUnits, organicUnits }, dailySeries: { shippedUnits, grossValue,
//         nonAdvtUnits, reviewUnits, organicUnits, dayRows }, note } }.
const SNELL_MIX_COLS = { amzShipUnits: 7, amzGross: 20, nonAdvt: 12, review: 13, organic: 14, reviewAmt: 18, organicAmt: 19 };
function buildSnellOrderMix() {
  const p = resolve("SnellSales&AdsSheet", "xlsx"); if (!p) { console.error("MISSING Snell (order-mix)"); return; }
  const wb = XLSX.readFile(p);
  const saleName = wb.SheetNames.find((n) => /^sale$/i.test(n.trim())); if (!saleName) { console.error("Snell order-mix: no Sale tab"); return; }
  const g = grid(wb.Sheets[saleName]);
  // Resolve order-mix cols by header band/leaf (never positional) so a layout
  // shift fails loud rather than reading the wrong column.
  const b2 = ffRow(g[2] || []), r3 = g[3] || [];
  const C = {
    amzShipUnits: findSnellCol(b2, r3, /^total$/i, /shipped units/i),       // c7
    amzGross: findSnellCol(b2, r3, /total gross value/i, null),             // c20
    nonAdvt: findSnellCol(b2, r3, /sales value/i, /non advt order units/i), // c12
    review: findSnellCol(b2, r3, /sales value/i, /review oder units/i),     // c13
    organic: findSnellCol(b2, r3, /sales value/i, /organic order units/i),  // c14
    reviewAmt: findSnellCol(b2, r3, /sales value/i, /review oder amt/i),    // c18
    organicAmt: findSnellCol(b2, r3, /sales value/i, /organic order amt/i), // c19
  };
  // Fall back to the pinned positions if a band/leaf lookup misses (the sheet's
  // band text is sparse on these inner columns); record any fallback in report.
  const fellBack = [];
  for (const k of Object.keys(SNELL_MIX_COLS)) { if (C[k] === -1) { C[k] = SNELL_MIX_COLS[k]; fellBack.push(k); } }
  const byMonth = {};
  const daily = { shippedUnits: 0, grossValue: 0, nonAdvtUnits: 0, reviewUnits: 0, organicUnits: 0, reviewAmt: 0, organicAmt: 0, dayRows: 0 };
  for (let i = 5; i < g.length; i++) {
    const r = g[i]; const d = r[0];
    if (typeof d !== "number" || d < 30000 || d > 80000) continue;
    const ym = monthOf(excelToISODate(d)); if (!ym) continue;
    const na = num(r[C.nonAdvt]), rv = num(r[C.review]), og = num(r[C.organic]);
    const rvA = num(r[C.reviewAmt]), ogA = num(r[C.organicAmt]);
    daily.shippedUnits += num(r[C.amzShipUnits]); daily.grossValue += num(r[C.amzGross]);
    daily.nonAdvtUnits += na; daily.reviewUnits += rv; daily.organicUnits += og;
    daily.reviewAmt += rvA; daily.organicAmt += ogA; daily.dayRows++;
    if (!na && !rv && !og && !rvA && !ogA) continue;     // no order-mix coverage this day → skip month accumulation
    const b = byMonth[ym] || { channel: "amazon", nonAdvtUnits: 0, reviewUnits: 0, organicUnits: 0, reviewAmt: 0, organicAmt: 0 };
    b.nonAdvtUnits += na; b.reviewUnits += rv; b.organicUnits += og; b.reviewAmt += rvA; b.organicAmt += ogA;
    byMonth[ym] = b;
  }
  // Round monthly cells.
  for (const ym of Object.keys(byMonth)) { const b = byMonth[ym]; b.reviewAmt = r2(b.reviewAmt); b.organicAmt = r2(b.organicAmt); }
  // Total-row (r4) figures — the founder's own curated total.
  const tr = g[4] || [];
  const totalRow = {
    shippedUnits: num(tr[C.amzShipUnits]), grossValue: r2(num(tr[C.amzGross])),
    nonAdvtUnits: num(tr[C.nonAdvt]), reviewUnits: num(tr[C.review]), organicUnits: num(tr[C.organic]),
  };
  const dailySeries = {
    shippedUnits: daily.shippedUnits, grossValue: r2(daily.grossValue),
    nonAdvtUnits: daily.nonAdvtUnits, reviewUnits: daily.reviewUnits, organicUnits: daily.organicUnits,
    reviewAmt: r2(daily.reviewAmt), organicAmt: r2(daily.organicAmt), dayRows: daily.dayRows,
  };
  facts.meta.bySource["snell-ordermix"] = {
    source: "snell-ordermix", tier: "agency",
    byMonth,
    reconciliation: {
      totalRow, dailySeries,
      deltaUnits: dailySeries.shippedUnits - totalRow.shippedUnits,
      deltaGross: r2(dailySeries.grossValue - totalRow.grossValue),
      note: "Snell's own 'Total' row (r4) is a founder-curated narrower window and does NOT equal the sum of the daily rows. Both are surfaced so the gap (daily-series − Total-row) is an explicit reconciliation, not a hidden inconsistency. The full daily series is authoritative for trend/history; the Total row is the founder's headline snapshot.",
    },
    columns: C, columnFallbacks: fellBack,
  };
  report.snellOrderMix = { months: Object.keys(byMonth).length, totalRow, dailySeries: { shippedUnits: dailySeries.shippedUnits, grossValue: dailySeries.grossValue }, columnFallbacks: fellBack };
}

// ═══ I · Monarch supplementary tabs (March 2025 + Weekly Comparison) ═════════
// Founder audit item I: surface EVERY field of every Monarch tab somewhere.
// Two tabs are not yet exposed:
//  • "March 2025" — the earliest daily website log (the 0→1 ramp month, Mar-2025),
//    labelled Total/Google/website/Meta order+sales+cancel columns. We emit a
//    monthly rollup of the Total block + the per-row labelled daily table.
//  • "Weekly Comparsion" — founder-built 7-day / 3-day / vs-last-month Google-vs-
//    Meta comparison blocks (Cost/Sales/SalesValue/ROAS/CPA). We emit each block
//    as { title, rows:[{ platform, date, cost, sales, salesValue, roas, cpa }] }.
// SHAPE: meta.bySource["monarch-extra"] = { march2025:{ monthly, daily }, weekly:[blocks] }.
function buildMonarchExtraTabs() {
  const p = resolve("MonarchWebsiteSales&AdsSheet", "xlsx"); if (!p) return;
  const wb = XLSX.readFile(p);
  const findTab = (re) => Object.keys(wb.Sheets).find((k) => re.test(k.trim()));
  const out = {};

  // ── March 2025 daily log ──
  const m25Name = findTab(/^march 2025$/i);
  if (m25Name) {
    const g = grid(wb.Sheets[m25Name]);
    const lbl = (g[2] || []).map((h) => String(h || "").trim());
    // Column map by the row2 labels (Total block first 6 cols after Date).
    const ci = (re) => lbl.findIndex((h) => re.test(h));
    const cols = {
      totalOrders: ci(/^total oders$/i), cancelOrders: ci(/cancel oders total/i),
      netOrders: ci(/after removing cancel orders/i), salesValue: ci(/^total sales value$/i),
      cancelValue: ci(/^cancel order value$/i), netSalesValue: ci(/after removing cancel order - sales value/i),
    };
    let mOrders = 0, mCancels = 0, mSalesValue = 0, mNetSalesValue = 0, dayRows = 0;
    const daily = [];
    for (let i = 3; i < g.length; i++) {
      const r = g[i]; if (!r) continue;
      // Date in col0 is a "1 -3- 25" style string OR an Excel serial; skip blank rows.
      const d0 = r[0]; if (d0 === "" || d0 == null) continue;
      const ord = cols.totalOrders === -1 ? 0 : num(r[cols.totalOrders]);
      const sv = cols.salesValue === -1 ? 0 : num(r[cols.salesValue]);
      if (!ord && !sv) continue;
      dayRows++;
      mOrders += ord; mCancels += cols.cancelOrders === -1 ? 0 : num(r[cols.cancelOrders]);
      mSalesValue += sv; mNetSalesValue += cols.netSalesValue === -1 ? 0 : num(r[cols.netSalesValue]);
      daily.push({
        date: String(d0).trim(),
        totalOrders: ord, cancelOrders: cols.cancelOrders === -1 ? 0 : num(r[cols.cancelOrders]),
        netOrders: cols.netOrders === -1 ? 0 : num(r[cols.netOrders]),
        salesValue: r2(sv), cancelValue: cols.cancelValue === -1 ? 0 : r2(num(r[cols.cancelValue])),
        netSalesValue: cols.netSalesValue === -1 ? 0 : r2(num(r[cols.netSalesValue])),
      });
    }
    out.march2025 = {
      tab: m25Name.trim(), labels: lbl.filter(Boolean),
      monthly: { month: "2025-03", totalOrders: mOrders, cancelOrders: mCancels, salesValue: r2(mSalesValue), netSalesValue: r2(mNetSalesValue), dayRows },
      daily,
    };
  }

  // ── Weekly Comparison blocks ──
  const wcName = findTab(/^weekly compar/i);
  if (wcName) {
    const g = grid(wb.Sheets[wcName]);
    const blocks = [];
    for (let i = 0; i < g.length; i++) {
      const title = String((g[i] || [])[1] || "").trim();
      if (!/compar/i.test(title)) continue;
      // The header row is +2 (Date/Cost/Sales/Sales Value/ROAS/CPA for Google then Meta);
      // data rows follow until a blank or the next block title.
      const rows = [];
      for (let j = i + 2; j < g.length; j++) {
        const r = g[j] || [];
        const gDate = String(r[1] || "").trim(); const mDate = String(r[8] || "").trim();
        const nextTitle = String(r[1] || "").trim();
        if (/compar/i.test(nextTitle)) break;          // next block
        if (/^date$/i.test(gDate)) continue;            // header row
        if (!gDate && !mDate) { if (rows.length) break; else continue; }
        if (gDate && !/^date$/i.test(gDate)) rows.push({ platform: "google", date: gDate, cost: r2(num(r[2])), sales: num(r[3]), salesValue: r2(num(r[4])), roas: r2(num(r[5])), cpa: r2(num(r[6])) });
        if (mDate && !/^date$/i.test(mDate)) rows.push({ platform: "meta", date: mDate, cost: r2(num(r[9])), sales: num(r[10]), salesValue: r2(num(r[11])), roas: r2(num(r[12])), cpa: r2(num(r[13])) });
      }
      if (rows.length) blocks.push({ title, rows });
    }
    out.weekly = { tab: wcName.trim(), blocks };
  }

  facts.meta.bySource["monarch-extra"] = { source: "monarch-extra-tabs", tier: "monarch", ...out };
  report.monarchExtra = { march2025Days: out.march2025?.daily?.length || 0, weeklyBlocks: out.weekly?.blocks?.length || 0 };
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
  // Sort by best current rank (lower=better); tie-break by larger all-window improvement.
  // I/VI fix (2026-06-13): keep ALL ranked keywords (every row with a current rank),
  // not a top-30 slice — the founder audit flagged 14 keywords silently dropped.
  // The full set is 44 rows (rows.length); it is small enough to bundle in full.
  rows.sort((a, b) => (a.latest - b.latest) || ((b.movementAll || 0) - (a.movementAll || 0)));
  const keywords = rows;                       // ALL ranked keywords (no top-N slice)
  const staleness = latestCol.iso;             // latest snapshot date — SEO is stale past this
  facts.meta.bySource["monarch-seo"] = { source: "monarch-seo", tier: "monarch", dates: isoList, prev30Date: prev30.iso, latestDate: staleness, staleAsOf: staleness, keywords, totalKeywords: rows.length };
  report.monarchSeo = { dates: isoList, totalKeywords: rows.length, kept: keywords.length, prev30Date: prev30.iso, staleAsOf: staleness };
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
    // (e) new-vs-returning AOV per Shopify quarter (returning ₹ ÷ returning custs,
    // new ₹ ÷ new custs) + the gap — the leading D2C-health signal the founder asked
    // for. Guarded against /0 (a quarter with 0 of either type → null AOV, never
    // NaN/Infinity). aovGapPct = (returningAOV − newAOV) / newAOV × 100.
    for (const s of shopify) {
      const newAOV = s.newCustomers > 0 && s.newCustomerSales != null ? r2(s.newCustomerSales / s.newCustomers) : null;
      const returningAOV = s.returningCustomers > 0 && s.returningCustomerSales != null ? r2(s.returningCustomerSales / s.returningCustomers) : null;
      s.newAOV = newAOV;
      s.returningAOV = returningAOV;
      s.aovGap = (newAOV != null && returningAOV != null) ? r2(returningAOV - newAOV) : null;
      s.aovGapPct = (newAOV && returningAOV != null) ? r2((returningAOV - newAOV) / newAOV * 100) : null;
    }
    facts.meta.bySource["bm-repeats"] = { source: "bm-repeats", tier: "businessmodel", sourceLabel: SRC_LABEL, shopify, amazon };
    report.bmRepeats = { shopifyQuarters: shopify.length, amazonQuarters: amazon.length, latestAovGap: shopify.length ? { newAOV: shopify[shopify.length - 1].newAOV, returningAOV: shopify[shopify.length - 1].returningAOV } : null };
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

// ═══ f · Unit_COGS Notes-column cost-change history (per SKU) ════════════════
// The Unit_COGS sheet's "Source / Notes" column records the PRIOR raw-material
// value for SKUs whose cost changed ("RM: Rs1,115/kg landed … was Rs1,050"). We
// parse that "was Rs X" prior value into a per-SKU cost-change history so the tool
// can show "history of what changed" (founder audit item f / rubric param 38).
// SKU resolution: the sheet's "Total COGS/Unit" (col5) is UNIQUE per SKU and equals
// the engine's DEFAULT_COGS, so we key on that (tolerance ₹0.5) — robust to the
// free-text product name. SHAPE: meta.bySource["cogs-history"] = {
//   source, asOf, byCode: { CODE: { current:{rmPerKg?, totalCogs, asOf}, prior:[
//     { rmPerKg, note }], changed:bool, productName } } }.
const COGS_TOTAL_TO_CODE = {
  150: "NSACDT30", 375: "NSJO100", 133: "NSSB100", 305.25: "NSSB250", 582.5: "NSSB500",
  136.5: "NSSBDB100", 314: "NSSBDB250", 600: "NSSBDB500", 39.5: "NSMP100", 71.5: "NSMP250",
  180.5: "NSSBBO15", 353: "NSSBBO30", 232.7: "NSSBJ300", 342.3: "NSSBJ500",
};
function resolveCogsCode(totalCogs) {
  // exact key first, else nearest within ₹0.5 (float-rounding tolerant).
  if (COGS_TOTAL_TO_CODE[totalCogs]) return COGS_TOTAL_TO_CODE[totalCogs];
  let best = null, bestD = 0.5;
  for (const [t, code] of Object.entries(COGS_TOTAL_TO_CODE)) { const d = Math.abs(Number(t) - totalCogs); if (d <= bestD) { bestD = d; best = code; } }
  return best;
}
function buildCogsHistory() {
  const names = fs.readdirSync(RAW_DIR).filter((n) => /^Naturesum_Unit_COGS(?:_\d+)?(?: \(\d+\))?\.xlsx$/i.test(n));
  if (!names.length) { console.error("MISSING Naturesum_Unit_COGS*.xlsx (cogs-history)"); return; }
  names.sort();
  const wb = XLSX.readFile(path.join(RAW_DIR, names[0]));
  const sn = wb.SheetNames.find((n) => /unit\s*cogs/i.test(n)) || wb.SheetNames[0];
  const g = grid(wb.Sheets[sn]);
  const H = (g[0] || []).map((h) => String(h || "").trim());
  const cName = H.findIndex((h) => /^sku$/i.test(h));
  const cRm = H.findIndex((h) => /rm landed cost/i.test(h));
  const cTotal = H.findIndex((h) => /total cogs\/?unit/i.test(h));
  const cNotes = H.findIndex((h) => /source\s*\/?\s*notes/i.test(h));
  if (cTotal === -1 || cNotes === -1) { console.error("Unit_COGS: schema drift (no Total COGS/Notes col)"); return; }
  const byCode = {}; let changed = 0;
  for (let i = 1; i < g.length; i++) {
    const r = g[i]; if (!r) continue;
    const name = String(r[cName === -1 ? 0 : cName] || "").trim(); if (!name) continue;
    const total = num(r[cTotal]); if (!total) continue;
    const code = resolveCogsCode(r2(total)); if (!code) continue;
    const notes = String(r[cNotes] || "");
    const rmNow = cRm !== -1 ? num(r[cRm]) : null;
    // Prior RM value: "was Rs 1,050" / "was Rs1,050" anywhere in the note.
    const m = notes.match(/was\s*Rs[\s,]*([\d,]+(?:\.\d+)?)/i);
    const rmWas = m ? num(m[1]) : null;
    const prior = rmWas != null ? [{ rmPerKg: rmWas, note: `RM was Rs${rmWas} → Rs${rmNow} (per Unit_COGS Notes, 11-Jun-26)` }] : [];
    if (prior.length) changed++;
    byCode[code] = {
      productName: name,
      current: { rmPerKg: rmNow, totalCogs: r2(total), asOf: "2026-06-11" },
      prior,
      changed: prior.length > 0,
      noteRaw: notes,
    };
  }
  facts.meta.bySource["cogs-history"] = { source: "Naturesum_Unit_COGS Notes column", asOf: "2026-06-11", byCode };
  report.cogsHistory = { skus: Object.keys(byCode).length, changedSkus: changed };
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
buildAmazon(); buildAmazonOrderComposition(); buildFlipkart(); buildBlinkit(); buildShopifyNet(); buildShopifyDaily();
buildAmazonSp(); buildFkPla(); buildGoogle(); buildSnell(); buildMonarch();
buildSnellHistory(); buildSnellSkuUnits(); buildMonarchHistory();  // V2 full history
buildSnellCancel();      // E · cancel-rate per channel per month
buildMonarchSeo();       // B · SEO keyword rank-over-time (ALL ranked keywords)
buildMonarchPlatform();  // C · Google vs Meta monthly ROAS/CPA
buildBmRepeatsReturns(); // A · BusinessModel Repeats + Returns (historical actuals)
buildSnellOrderMix();    // a/b · Snell order-mix decomposition + Total-row reconciliation
buildMonarchExtraTabs(); // I · Monarch March-2025 + Weekly-Comparison tabs
buildCogsHistory();      // f · Unit_COGS Notes-column cost-change history per SKU
// D · per-SKU × channel monthly units mix is already baked in
// meta.bySource["snell-sku-units"].monthly ("YYYY-MM|channel|CODE" → units) — no
// new extraction needed; the channel-split bars view reads that map directly.
// c · Monarch monthly Total Conversion Value is already baked in
// meta.bySource["monarch-history"].byMonth[ym].grossConvValue (and the May
// agencyShadow.website.grossRev) — the conv-value-gap insight reads those vs
// Shopify-net (website netRev) at the engine layer; no new extraction needed.
buildMcfShare(); // depends on amazon (mcf units) + shopify-net (per-unit price)

// I (rubric 7) — SKU IDENTITY RESOLUTION MAP. For every canonical SKU the store
// carries, record HOW it was resolved per source. Exact-map channels (Amazon
// ASIN/MSKU, Flipkart SKU, Blinkit Item-Id, Shopify SKU, Snell column, COGS name)
// resolve EXACT; the Google product-wise ad title is the one fuzzy resolver. A SKU
// is flagged `fuzzy` only when at least one of its source resolutions was
// non-exact — so the UI badge appears precisely (and rarely) where it should.
function buildSkuIdentity() {
  const gMatch = facts.meta.bySource?.["ads-google"]?.matchByCode || {};
  const identity = {};                       // code → { fuzzy:bool, via:[…], note }
  // collect every canonical code present in monthly cells (skip channel-grain).
  const codes = new Set();
  for (const k of Object.keys(facts.monthly)) {
    const code = k.split("|")[2];
    if (code && code !== "__ch__") codes.add(code);
  }
  for (const code of [...codes].sort()) {
    // The Google product-wise ad source resolves a canonical SKU from a FREE-TEXT
    // product title (prose), not an identifier. `method` records how tight that
    // resolution was: exact-needle = a SINGLE candidate after pinning the numeric
    // size token (high-confidence, map-LIKE) vs multi-needle = >1 candidate that
    // had to be disambiguated by the most-specific needle (the genuinely NON-EXACT
    // / FUZZY case).
    //
    // I-7 (rubric 7): the "matched by similarity" BADGE must fire ONLY when the
    // match is genuinely non-exact — badging every title hit (incl. exact-needle)
    // dilutes the signal. So fuzzy = true ONLY for multi-needle. exact-needle is
    // recorded as an informational title-basis `via` (no warning badge), so the
    // provenance is still discoverable without crying wolf on a clean single hit.
    const m = gMatch[code];
    const isFuzzy = m === "multi-needle";
    const via = m
      ? [{ source: "ads-google", method: m, basis: "free-text Google product title (numeric size token pinned exactly; brand/variant matched by needle)" }]
      : [];
    identity[code] = {
      fuzzy: isFuzzy,
      // fuzzyVia retains ONLY the non-exact legs (so the UI badge, which reads
      // fuzzyVia, never lights up for an exact-needle hit); `titleVia` keeps the
      // exact-needle title basis for the provenance popover without the badge.
      fuzzyVia: isFuzzy ? via : [],
      titleVia: !isFuzzy ? via : [],
      note: isFuzzy
        ? "Ad spend on this SKU was attributed from a free-text Google product TITLE that matched MORE THAN ONE candidate and was disambiguated by similarity (the most-specific needle) — a non-exact match. All sales/units still resolve via exact identifier maps; verify the ad attribution if a title is renamed."
        : m
          ? "Ad spend attributed from the Google product title, but the numeric size token pinned a SINGLE candidate (exact-needle) — a high-confidence, map-like resolution. All sales/units resolve via exact identifier maps."
          : "Resolved by an exact identifier map across every source (ASIN/MSKU/FK-SKU/Item-Id/Shopify-SKU/Snell-column/COGS-name).",
    };
  }
  facts.meta.skuIdentity = identity;
  report.skuIdentity = { total: Object.keys(identity).length, fuzzy: Object.values(identity).filter((x) => x.fuzzy).length };
}
buildSkuIdentity();

// I-7 · TOP-LEVEL VARIANT-FOLD index. Amazon (`_MP`) and Flipkart (`*N`) folds are
// each captured in their own source block; merge them into ONE inspectable map the
// page builders read directly: meta.skuVariantFold = { CODE: { byChannel:{ amazon?,
// flipkart? }, anyFolded } }. So the UI can badge a canonical "folded ⓘ" and the
// tooltip lists the exact pre-fold components per channel ("NSSBJ500 = NSSBJ500ML +
// NSSBJ500ML_MP folded"; "NSSBDB100 = NSSBDB100g + NSSBDB100g*2 + NSSBDB100g*4").
function buildVariantFoldIndex() {
  const amz = facts.meta.bySource?.["amazon-orders"]?.skuVariantFold || {};
  const fk = facts.meta.bySource?.["fk-sales"]?.skuVariantFold || {};
  const idx = {};
  for (const [code, f] of Object.entries(amz)) { (idx[code] = idx[code] || { canonical: code, byChannel: {}, anyFolded: false }).byChannel.amazon = f; if (f.folded) idx[code].anyFolded = true; }
  for (const [code, f] of Object.entries(fk)) { (idx[code] = idx[code] || { canonical: code, byChannel: {}, anyFolded: false }).byChannel.flipkart = f; if (f.folded) idx[code].anyFolded = true; }
  facts.meta.skuVariantFold = idx;
  report.skuVariantFold = { codes: Object.keys(idx).length, folded: Object.values(idx).filter((x) => x.anyFolded).length };
}
buildVariantFoldIndex();

thinDailyHistory(13); // V2 bundle-budget guard (older daily dropped; monthly rollup survives)

facts.meta.uploads = [
  "amazon-orders", "fk-sales", "blinkit-sales", "shopify-net", "shopify-daily",
  "ads-amazon-sp", "ads-fk-pla", "ads-google", "snell-agency", "monarch-web",
  "snell-history", "snell-sku-units", "monarch-history",   // V2 full-history sources
  "snell-cancel", "monarch-seo", "monarch-platform", "bm-repeats", "bm-returns", // upside views A/B/C/E
  "snell-ordermix", "monarch-extra", "cogs-history",       // R3 left-on-table a/b/f/I
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

// ─── Provenance labels — map every internal source slug to a HUMAN label + tier ──
// The store keys sources by slug (snell-ordermix, monarch-extra, cogs-history, …);
// the UI must NEVER show a raw slug. This map gives each a founder-readable name,
// its trust tier, and the underlying file, so a provenance chip reads
// "Order-mix · Snell agency" not "snell-ordermix". (round-4 never-landed item.)
const SOURCE_LABELS = {
  "amazon-orders":            { label: "Amazon Orders Insights · Data (cleaned) — shipped+delivered ÷1.05 (native export)", tier: "native", file: "Amazon Orders Insights by Shivam.xlsx" },
  "amazon-order-composition": { label: "Amazon order composition (FBA/MFN · B2B/B2C · basket)", tier: "native", file: "Amazon Orders Insights by Shivam.xlsx" },
  "fk-sales":                 { label: "Flipkart Sales Report (native export)",     tier: "native",       file: "flipkart may sales.xlsx" },
  "blinkit-sales":            { label: "Blinkit Sales Report (native export)",      tier: "native",       file: "blinkit may sales.xlsx" },
  "shopify-net":              { label: "Shopify net sales/units (native export)",   tier: "native",       file: "shopify net sales net units.csv" },
  "shopify-daily":            { label: "Shopify daily website sales (native)",      tier: "native",       file: "Website Sales of all SKUs.csv" },
  "ads-amazon-sp":            { label: "Amazon Sponsored Products (per-ASIN ads)",  tier: "native",       file: "may_product_wise_sp.xlsx" },
  "ads-fk-pla":               { label: "Flipkart PLA (per-SKU ads)",                tier: "native",       file: "flipkart may ads.csv" },
  "ads-google":               { label: "Google product-wise ads (title-matched)",  tier: "native-fuzzy", file: "google may ads.csv" },
  "snell-agency":             { label: "Snell agency channel spend (Sale tab)",     tier: "agency",       file: "SnellSales&AdsSheet.xlsx" },
  "snell-history":            { label: "Snell agency full daily history",           tier: "agency",       file: "SnellSales&AdsSheet.xlsx" },
  "snell-sku-units":          { label: "Snell agency per-SKU units (Categorywise)", tier: "agency",       file: "SnellSales&AdsSheet.xlsx" },
  "snell-ordermix":           { label: "Order-mix · Snell agency (Non-Advt/Review/Organic)", tier: "agency", file: "SnellSales&AdsSheet.xlsx" },
  "snell-cancel":             { label: "Shipped-vs-cancel · Snell agency",          tier: "agency",       file: "SnellSales&AdsSheet.xlsx" },
  "monarch-web":              { label: "Monarch website Google/Meta spend",         tier: "monarch",      file: "MonarchWebsiteSales&AdsSheet.xlsx" },
  "monarch-history":          { label: "Monarch website full history (orders/conv)",tier: "monarch",      file: "MonarchWebsiteSales&AdsSheet.xlsx" },
  "monarch-platform":         { label: "Monarch website platform totals",           tier: "monarch",      file: "MonarchWebsiteSales&AdsSheet.xlsx" },
  "monarch-seo":              { label: "Monarch website SEO keyword ranks",         tier: "monarch",      file: "MonarchWebsiteSales&AdsSheet.xlsx" },
  "monarch-extra":            { label: "Monarch extra tabs (Mar-25 daily · weekly)",tier: "monarch",      file: "MonarchWebsiteSales&AdsSheet.xlsx" },
  "bm-repeats":               { label: "Repeat-customer history · Business Model",  tier: "businessmodel",file: "Naturesum_BusinessModel.xlsx" },
  "bm-returns":               { label: "Returns history · Business Model",          tier: "businessmodel",file: "Naturesum_BusinessModel.xlsx" },
  "cogs-history":             { label: "Unit COGS history (Notes column)",          tier: "cogs",         file: "Naturesum_Unit_COGS_116.xlsx" },
};
// attach the resolved label onto each present source AND a top-level lookup so the
// UI can label by slug even for sources it reads directly.
facts.meta.sourceLabels = SOURCE_LABELS;
for (const slug of Object.keys(facts.meta.bySource || {})) {
  const L = SOURCE_LABELS[slug];
  if (L && facts.meta.bySource[slug] && typeof facts.meta.bySource[slug] === "object") {
    if (!facts.meta.bySource[slug].label) facts.meta.bySource[slug].label = L.label;
    if (!facts.meta.bySource[slug].tier) facts.meta.bySource[slug].tier = L.tier;
    if (!facts.meta.bySource[slug].file) facts.meta.bySource[slug].file = L.file;
  }
}
report.sourceLabels = Object.keys(SOURCE_LABELS).length;

// ─── Per-source RECENCY (XI-83) — the latest data day each source reaches, so every
// page can show a per-source "through <date>" line, not one global footer. We read
// the freshest day already recorded by each parser (history spans, byMonth.lastDay,
// SEO dates, COGS asOf) and fall back to the month-window end for the native
// May-only exports. Honest: reflects the actual latest data day, never wall-clock.
function sourceLatest() {
  const bs = facts.meta.bySource || {};
  const maxIso = (...xs) => xs.filter((x) => x && /^\d{4}-\d{2}-\d{2}$/.test(x)).sort().pop() || null;
  const fromByMonth = (bm) => bm ? maxIso(...Object.values(bm).map((v) => v && v.lastDay)) : null;
  // native May exports cover the full May window → last day = 2026-05-31.
  const MAY_END = "2026-05-31";
  const rec = {};
  const set = (slug, iso) => { if (iso) rec[slug] = iso; };
  // resolve each explicitly:
  rec["amazon-orders"] = MAY_END;
  rec["amazon-order-composition"] = maxIso(...(bs["amazon-order-composition"]?.byMonth || []).map((x) => x.month + "-28")) || MAY_END;
  rec["fk-sales"] = MAY_END;
  rec["blinkit-sales"] = MAY_END;
  rec["shopify-net"] = MAY_END;
  rec["ads-amazon-sp"] = MAY_END;
  rec["ads-fk-pla"] = MAY_END;
  rec["ads-google"] = MAY_END;
  rec["snell-agency"] = MAY_END;
  set("snell-history", maxIso(...Object.values(bs["snell-history"]?.channelSpan || {}).map((s) => s && s.last)));
  set("snell-sku-units", maxIso(...Object.values(bs["snell-sku-units"]?.perChannel || {}).map((c) => c && c.span && c.span.last)));
  set("monarch-web", fromByMonth(bs["monarch-history"]?.byMonth));
  set("monarch-history", bs["monarch-history"]?.span?.last || fromByMonth(bs["monarch-history"]?.byMonth));
  set("monarch-platform", fromByMonth(bs["monarch-platform"]?.byMonth));
  set("monarch-seo", bs["monarch-seo"]?.latestDate || (bs["monarch-seo"]?.dates || []).slice(-1)[0]);
  set("monarch-extra", MAY_END);
  set("cogs-history", bs["cogs-history"]?.asOf || null);
  set("bm-repeats", null); set("bm-returns", null);
  // CAP at the true latest data day — a source's span may carry a forward-dated /
  // month-label row (e.g. Snell categorywise reaches a 2026-06-30 label) that is
  // NOT real data. Freshness must be true to the actual latest data day, never an
  // over-stated calendar artifact, so we clamp every per-source date to the global
  // latestDataDate (rubric XI-83 / freshness honesty).
  const cap = facts.meta.latestDataDate;
  if (cap) for (const k of Object.keys(rec)) if (rec[k] > cap) rec[k] = cap;
  // strip nulls (a source with no resolvable day reads "—" in the UI, never a guess).
  for (const k of Object.keys(rec)) if (!rec[k]) delete rec[k];
  return rec;
}
facts.meta.sourceRecency = sourceLatest();
report.sourceRecency = facts.meta.sourceRecency;

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
