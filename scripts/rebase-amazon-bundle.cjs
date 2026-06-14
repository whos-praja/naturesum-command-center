#!/usr/bin/env node
/**
 * rebase-amazon-bundle.cjs — surgical Amazon re-base of src/bundledBusinessData.js.
 *
 * The full offline twin (build-business-data.cjs) needs ALL May raw files in
 * ~/Downloads. When only the NEW authoritative Amazon source is present (founder
 * approval 2026-06-14, basis A), running the full build would zero every other
 * channel. This script instead recomputes ONLY the Amazon facts/meta from
 *   "Amazon Orders Insights by Shivam.xlsx" → tab "Data (cleaned)"
 * on the founder-approved shipped+delivered ÷1.05 basis, and MERGES them into the
 * existing bundle, leaving every non-Amazon fact (Flipkart/Blinkit/Website/ads/
 * Snell/Monarch/…) byte-for-byte untouched.
 *
 * Amazon basis (BINDING — FBA-ONLY, founder 2026-06-14; SUPERSEDES the erroneous
 * FBA+EasyShip ₹12.82L re-base, which DOUBLE-COUNTED website Easy Ship orders):
 *   • Amazon channel = ONLY Order type "Amazon.in marketplace (FBA)" rows that are
 *     Revenue-bearing? "Y…" (priced & not cancelled). net = Σ Line revenue ÷ 1.05
 *     (per cell once). May: 995u / gross ₹10,85,267 / net ₹10,33,588. This
 *     reproduces the founder's Executive Summary FBA line EXACTLY.
 *   • Website D2C (Easy Ship) is EXCLUDED — it is website D2C demand already in the
 *     Shopify-net website figure (₹4,28,378); folding it into Amazon double-counts.
 *   • returns = FBA rows in the "Returned/Rejected" bucket = 0 (the 14u/₹9,500
 *     returns are Easy Ship/website, NOT Amazon).
 *   • geo = same FBA revenue-bearing basis by State (norm) → reconciles to channel
 *     net (Punjab #1 ≈ ₹1,30,471).
 *   • MCF (non-Amazon channels) rows (Revenue-bearing "No", ₹0) → MCF units for
 *     mcfShare (website fulfilment), never Amazon demand.
 *
 * This mirrors build-business-data.buildAmazon / buildAmazonOrderComposition /
 * buildMcfShare EXACTLY (same per-cell-once rounding, boundary-spill fold). When
 * all raw files are restored to ~/Downloads, the full twin produces an identical
 * Amazon block — this is a faithful subset, not a divergent path.
 *
 * Run:  node scripts/rebase-amazon-bundle.cjs            (uses ~/Downloads)
 *       node scripts/rebase-amazon-bundle.cjs <dir>
 */
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");
const os = require("os");

const RAW_DIR = process.argv[2] || path.join(os.homedir(), "Downloads");
const OUT_JS = path.join(__dirname, "..", "src", "bundledBusinessData.js");
const MONTH = "2026-05";
const AMZ_INSIGHTS_SHEET = "Data (cleaned)";
// CHANNEL MEMBERSHIP (founder 2026-06-14, FBA-only re-base — SUPERSEDES the
// erroneous FBA+EasyShip ₹12.82L basis): the Amazon channel = ONLY rows whose
// Order type is "Amazon.in marketplace (FBA)". Website D2C (Easy Ship) is website
// D2C demand already counted in the Shopify-net website figure (₹4,28,378) — folding
// it into Amazon DOUBLE-COUNTS website, so it is excluded here. MCF (non-Amazon
// channels) rows are website-fulfilment-through-Amazon → mcfShare proxy, never
// Amazon demand. (Per spec §2: Amazon = Amazon.in marketplace (FBA) only.)
const AMZ_FBA_ORDER_TYPE = "Amazon.in marketplace (FBA)";
const MCF_ORDER_TYPE = "MCF (non-Amazon channels)";
const RR_BUCKET = "Returned/Rejected";

// ── resolver + helpers (identical to build-business-data.cjs) ────────────────
function resolve(base, ext) {
  const names = fs.readdirSync(RAW_DIR);
  const re = new RegExp("^" + base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?: \\(\\d+\\))?\\." + ext + "$", "i");
  const hit = names.filter((n) => re.test(n)).sort();
  return hit.length ? path.join(RAW_DIR, hit[0]) : null;
}
const ASIN_MAP = {
  B0GZNRL4XS: "NSMP100", B0GZNGQLTM: "NSMP250", B0FPMJMRW7: "NSSB100", B0FPMDD8ZS: "NSSB250", B0GHQVMC93: "NSSB500",
  B0DV5K7BB4: "NSSBDB100", B0DV5MS3J3: "NSSBDB250", B0FPD5432G: "NSSBDB500", B0GRMC94JJ: "NSSBJ300", B0GRMG2BLQ: "NSSBJ500",
  B0DK1X2H8F: "NSSBBO15", B0DK1X4LGV: "NSSBBO30", B0DJK3DCZF: "NSJO100", B0F88G8DYP: "NSACDT30",
};
const AMZ_MSKU_MAP = {
  NSSBDB100g: "NSSBDB100", NSSBDB250g: "NSSBDB250", NSSBDB500g: "NSSBDB500",
  NSSBP100: "NSSB100", NSSBP250: "NSSB250", NSSBP500: "NSSB500",
  NSSBJ300ML: "NSSBJ300", NSSBJ500ML: "NSSBJ500", NSMP100: "NSMP100", NSMP250: "NSMP250",
  "NSJ&RHO100ML": "NSJO100", "DI-TE-1-A": "NSACDT30",
};
const AMZ_MASTER_SKU_MAP = {
  NSMP100: "NSMP100", NSMP250: "NSMP250", NSSB100: "NSSB100", NSSB250: "NSSB250", NSSB500: "NSSB500",
  NSSBDB100: "NSSBDB100", NSSBDB250: "NSSBDB250", NSSBDB500: "NSSBDB500", NSSBJ300: "NSSBJ300", NSSBJ500: "NSSBJ500",
  NSSBBO15: "NSSBBO15", NSSBBO30: "NSSBBO30", NSJO100: "NSJO100", NSACDT30: "NSACDT30",
};
function resolveMasterSku(raw) {
  let s = String(raw ?? "").trim();
  if (!s) return null;
  s = s.replace(/_MP$/i, "").replace(/\s*\*\s*\d+\s*$/, "");
  return AMZ_MASTER_SKU_MAP[s] || AMZ_MSKU_MAP[s] || ASIN_MAP[s] || null;
}
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
function excelToISODate(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") { const d = new Date((v - 25569) * 86400 * 1000); return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); }
  const s = String(v).trim(); const iso = s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(s); return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
const monthOf = (iso) => (iso ? iso.slice(0, 7) : null);
function amzInsightsModalMonth(g, dayCol) {
  const counts = {};
  for (let i = 1; i < g.length; i++) { const m0 = monthOf(excelToISODate(g[i]?.[dayCol])); if (m0) counts[m0] = (counts[m0] || 0) + 1; }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, n]) => s + n, 0);
  return (sorted[0] && sorted[0][1] / Math.max(1, total) >= 0.8) ? sorted[0][0] : null;
}

// ── compute fresh Amazon facts/meta from the new xlsx ────────────────────────
function computeAmazon() {
  const p = resolve("Amazon Orders Insights by Shivam", "xlsx");
  if (!p) throw new Error("MISSING Amazon Orders Insights by Shivam.xlsx in " + RAW_DIR);
  const wb = XLSX.readFile(p);
  const ws = wb.Sheets[AMZ_INSIGHTS_SHEET];
  if (!ws) throw new Error(`MISSING "${AMZ_INSIGHTS_SHEET}" tab`);
  const g = grid(ws);
  const H = g[0].map((h) => String(h ?? "").trim()); const col = (n) => H.indexOf(n);
  const C = {
    day: col("Day"), orderType: col("Order type"), ful: col("Fulfilment"),
    masterSku: col("Master SKU"), sku: col("SKU"),
    qty: col("Qty"), lineRev: col("Line revenue (₹)"), bucket: col("Status bucket"),
    revBearing: col("Revenue-bearing?"), state: col("State (norm)"), biz: col("Business order?"),
  };
  if (C.orderType === -1) throw new Error('MISSING "Order type" column — cannot apply FBA-only filter.');
  const modalMonth = amzInsightsModalMonth(g, C.day);

  const cells = {};   // code → { units, grossRev, returnsUnits, returnsValue }
  const mcf = {}; let mcfTotal = 0, retU = 0, retV = 0, units = 0, gross = 0;
  const geo = {};     // STATE → { units, gross, returns }
  const foldByCode = {};
  const noteFold = (code, masterSku, sku, q) => {
    const fb = (foldByCode[code] = foldByCode[code] || { components: {} });
    const key = sku || masterSku || "(blank)";
    const comp = (fb.components[key] = fb.components[key] || { units: 0, isMp: /_MP$/i.test(sku || ""), masterSku });
    comp.units += q;
  };
  // composition (line grain)
  const comp = { lines: 0, units: 0, mappedUnits: 0, singleLines: 0, multiLines: 0, multiUnits: 0, fbaLines: 0, mfnLines: 0, fbaUnits: 0, mfnUnits: 0, b2bLines: 0, b2cLines: 0, b2bUnits: 0, b2cUnits: 0, netRev: 0 };

  for (let i = 1; i < g.length; i++) {
    const row = g[i]; if (!row || row.length === 0) continue;
    const orderType = String(row[C.orderType] ?? "").trim();
    const bucket = String(row[C.bucket] ?? "").trim();
    const masterSku = String(row[C.masterSku] ?? "").trim();
    const skuRaw = String(row[C.sku] ?? "").trim();
    const code = resolveMasterSku(masterSku) || resolveMasterSku(skuRaw);
    const m = modalMonth || monthOf(excelToISODate(row[C.day]));
    const q = num(row[C.qty]), lineRev = num(row[C.lineRev]);
    const revBearing = /^y/i.test(String(row[C.revBearing] ?? "").trim());
    const st = C.state === -1 ? "" : row[C.state];
    const state = String(st || "").trim().toUpperCase() || "UNKNOWN";

    // ── MCF (non-Amazon channels): website-fulfilment-through-Amazon units →
    // mcfShare proxy, NEVER Amazon demand. Scoped to its own Order type so the
    // FBA-only Amazon channel stays clean. (Revenue-bearing? "No", ₹0.)
    if (orderType === MCF_ORDER_TYPE) {
      if (!revBearing && code) { mcf[code] = (mcf[code] || 0) + q; mcfTotal += q; }
      continue;
    }

    // ── FBA-ONLY channel membership. Everything that is NOT Amazon.in marketplace
    // (FBA) — i.e. Website D2C (Easy Ship) — is excluded from Amazon entirely (it
    // is website D2C, already in the Shopify-net website figure). This is the
    // double-counting fix (founder 2026-06-14).
    if (orderType !== AMZ_FBA_ORDER_TYPE) continue;

    // Returns within FBA (Returned/Rejected bucket). On the FBA-only basis this is
    // EMPTY — the 14u/₹9,500 returns are all Easy Ship/website — so Amazon returns
    // = 0. Kept defensively so any future FBA return surfaces correctly.
    if (bucket === RR_BUCKET) {
      if (code && m) { const c = (cells[code] = cells[code] || { units: 0, grossRev: 0, returnsUnits: 0, returnsValue: 0 }); c.returnsUnits += q; c.returnsValue += lineRev; }
      retU += q; retV += lineRev;
      const gg = (geo[state] = geo[state] || { units: 0, gross: 0, returns: 0 }); gg.returns += q;
      continue;
    }
    // Non-revenue-bearing FBA rows (Cancelled / Pending pickup / Unfulfillable / ₹0):
    // excluded from revenue & demand (they are not priced customer demand).
    if (!revBearing || !code || m !== MONTH) continue;
    const c = (cells[code] = cells[code] || { units: 0, grossRev: 0, returnsUnits: 0, returnsValue: 0 });
    c.units += q; c.grossRev += lineRev;
    units += q; gross += lineRev;
    const gg = (geo[state] = geo[state] || { units: 0, gross: 0, returns: 0 }); gg.units += q; gg.gross += lineRev;
    noteFold(code, masterSku, skuRaw, q);
    // composition
    comp.lines++; comp.units += q; comp.netRev += lineRev / 1.05; comp.mappedUnits += q;
    if (q >= 2) { comp.multiLines++; comp.multiUnits += q; } else comp.singleLines++;
    const isFba = String(row[C.ful] ?? "").trim() === "Amazon";
    if (isFba) { comp.fbaLines++; comp.fbaUnits += q; } else { comp.mfnLines++; comp.mfnUnits += q; }
    const isB2b = String(row[C.biz] ?? "").trim().toLowerCase() === "yes";
    if (isB2b) { comp.b2bLines++; comp.b2bUnits += q; } else { comp.b2cLines++; comp.b2cUnits += q; }
  }

  // finalise per-cell netRev once (÷1.05) and round grossRev/returnsValue.
  const finalCells = {};
  for (const [code, c] of Object.entries(cells)) {
    finalCells[code] = {
      units: c.units, grossRev: r2(c.grossRev), netRev: r2(c.grossRev / 1.05),
      returnsUnits: c.returnsUnits, returnsValue: r2(c.returnsValue),
    };
  }
  // geo finalise (÷1.05 once per state).
  const geoOut = {};
  for (const [state, v] of Object.entries(geo)) {
    geoOut[`${MONTH}|${state}`] = { units: v.units, netRev: r2((v.gross || 0) / 1.05), returns: v.returns };
  }
  // variant-fold map
  const skuVariantFold = {};
  for (const [code, fb] of Object.entries(foldByCode)) {
    const components = Object.entries(fb.components).map(([sku, c0]) => ({ rawSku: sku, units: c0.units, isMp: c0.isMp })).sort((a, b) => b.units - a.units);
    const folded = components.length > 1;
    if (!folded && !components.some((c0) => c0.isMp)) continue;
    skuVariantFold[code] = {
      channel: "amazon", canonical: code, folded, components,
      label: `${code} = ${components.map((c0) => c0.rawSku).join(" + ")} folded`,
      rule: "Amazon Orders Insights folds each Master SKU's marketplace SKU variants (e.g. NSSBJ500ML + NSSBJ500ML_MP) into ONE canonical code. The _MP suffix marks the MCF/website-fulfilment twin. Components retained pre-fold so the identity resolution is inspectable.",
    };
  }
  const o = comp.lines || 0; const u = Math.round(comp.units);
  const compositionMonth = {
    month: MONTH, orders: o, units: u, grossUnits: u, netUnits: u, returnUnits: 0, netRev: r2(comp.netRev),
    singleOrders: comp.singleLines, multiOrders: comp.multiLines, multiUnits: comp.multiUnits,
    upo: o > 0 ? r2(comp.units / o) : null, multiPct: o > 0 ? r2(comp.multiLines / o) : null,
    fbaOrders: comp.fbaLines, mfnOrders: comp.mfnLines, fbaUnits: comp.fbaUnits, mfnUnits: comp.mfnUnits,
    fbaPct: o > 0 ? r2(comp.fbaLines / o) : null,
    b2bOrders: comp.b2bLines, b2cOrders: comp.b2cLines, b2bUnits: comp.b2bUnits, b2cUnits: comp.b2cUnits,
    b2bPct: o > 0 ? r2(comp.b2bLines / o) : null,
  };
  return {
    finalCells, geoOut, skuVariantFold, compositionMonth,
    mcf: { byCode: mcf, totalUnits: mcfTotal },
    amazonReturns: { units: retU, value: r2(retV) },
    totals: { units, gross: r2(gross), net: r2(gross / 1.05), returnsUnits: retU, returnsValue: r2(retV), mcfUnits: mcfTotal, geoCells: Object.keys(geoOut).length, cells: Object.keys(finalCells).length },
  };
}

// ── load the existing bundle (parse the exported object) ─────────────────────
function loadBundle() {
  const txt = fs.readFileSync(OUT_JS, "utf8");
  const start = txt.indexOf("{", txt.indexOf("BUNDLED_BUSINESS"));
  const end = txt.lastIndexOf("};");
  const json = txt.slice(start, end + 1);
  return JSON.parse(json);
}

// ── MERGE ─────────────────────────────────────────────────────────────────────
const A = computeAmazon();
const B = loadBundle();

// 1. per-SKU Amazon cells for MONTH: overwrite demand fields, PRESERVE adSpendDirect/src.
const existingAmzKeys = Object.keys(B.monthly).filter((k) => { const [m, ch, code] = k.split("|"); return m === MONTH && ch === "amazon" && code !== "__ch__"; });
const newCodes = new Set(Object.keys(A.finalCells));
for (const code of newCodes) {
  const key = `${MONTH}|amazon|${code}`;
  const prev = B.monthly[key] || {};
  const nc = A.finalCells[code];
  const srcSet = new Set(String(prev.src || "").split(",").filter(Boolean)); srcSet.add("amazon-orders");
  B.monthly[key] = {
    units: nc.units, grossRev: nc.grossRev, netRev: nc.netRev,
    returnsUnits: nc.returnsUnits, returnsValue: nc.returnsValue,
    adSpendDirect: r2(num(prev.adSpendDirect)),       // preserved (SP ads unchanged)
    src: [...srcSet].join(","),
  };
}
// codes present before but NOT in new demand (e.g. ad-only NSSBBO15/30): zero the
// demand fields but KEEP adSpendDirect so the SP-attributed anchor is unchanged.
for (const key of existingAmzKeys) {
  const code = key.split("|")[2];
  if (newCodes.has(code)) continue;
  const prev = B.monthly[key];
  B.monthly[key] = { units: 0, grossRev: 0, netRev: 0, returnsUnits: 0, returnsValue: 0, adSpendDirect: r2(num(prev.adSpendDirect)), src: prev.src || "ads-amazon-sp" };
}

// 2. amazon-orders meta: rebuild geo/mcf/returns/skuVariantFold + provenance, keep
//    the downstream-added keys (mcfShare recomputed below, label/tier/file reset).
const prevAO = B.meta.bySource["amazon-orders"] || {};
B.meta.bySource["amazon-orders"] = {
  mcf: A.mcf,
  amazonReturns: A.amazonReturns,
  geo: { source: "amazon-orders-insights State (norm)", asOf: B.meta.latestDataDate || null, byMonthState: A.geoOut },
  unitsRule:
    'Amazon per-SKU units & revenue share ONE row set: "Amazon Orders Insights · Data (cleaned)" · Order type = "Amazon.in marketplace (FBA)" (FBA-ONLY per Executive Summary) · Revenue-bearing?="Y…" · Master SKU → canonical code · bucketed by Day month (boundary-day spill folds into the modal month) · units = Σ Qty, gross = Σ Line revenue, net = gross ÷ 1.05 (GST-incl rule). AOV = net ÷ units re-derives from the file. (Website D2C Easy Ship EXCLUDED — it is website D2C already in Shopify-net website; MCF-bulk / Cancelled / Pending pickup / Unfulfillable / Returned-Rejected rows excluded from revenue. May FBA: 995u / gross ₹10,85,267 / net ₹10,33,588; Amazon returns = 0.)',
  skuVariantFold: A.skuVariantFold,
  label: "Amazon Orders Insights · Data (cleaned) — Amazon.in marketplace (FBA) ONLY ÷1.05 (native export)",
  tier: "native",
  file: "Amazon Orders Insights by Shivam.xlsx",
};

// 3. amazon-order-composition meta.
B.meta.bySource["amazon-order-composition"] = {
  source: "amazon-orders-insights line grouping (Data cleaned)", tier: "native",
  unitsNote: "Line-grain composition from the SAME FBA-only revenue-bearing rows as per-SKU revenue (Order type 'Amazon.in marketplace (FBA)'; the cleaned export folds to order LINES — no order-id — so 'orders' here = order lines and UPO = units ÷ lines). single/multi by Qty (1 vs ≥2); FBA = Fulfilment 'Amazon' (all rows are FBA now; MFN/Easy Ship excluded from the Amazon channel); B2B = Business order? 'Yes'. units reconcile EXACTLY to the per-SKU units sum (995 for May).",
  byMonth: [A.compositionMonth],
  label: "Amazon order composition (FBA-only · B2B/B2C · basket)",
  file: "Amazon Orders Insights by Shivam.xlsx",
};

// 4. recompute mcfShare from new MCF units × existing website per-unit net price.
(function recomputeMcfShare() {
  const mcfByCode = A.mcf.byCode || {};
  const perUnit = {}; let webNet = 0;
  for (const [k, cell] of Object.entries(B.monthly)) {
    const [m, ch, code] = k.split("|");
    if (m !== MONTH || ch !== "website" || code === "__ch__") continue;
    const u = num(cell.units), n = num(cell.netRev);
    webNet += n;
    if (u > 0) perUnit[code] = n / u;
  }
  let mcfRev = 0;
  for (const [code, u] of Object.entries(mcfByCode)) if (perUnit[code] != null) mcfRev += u * perUnit[code];
  const raw = webNet > 0 ? mcfRev / webNet : 0;
  const share = Math.max(0, Math.min(1, raw));
  B.meta.bySource["amazon-orders"].mcfShare = {
    share: r2(share), rawProxy: r2(raw), mcfRev: r2(mcfRev), websiteNet: r2(webNet),
    capped: raw > 1 || raw < 0, asOf: "2026-06-14",
    source: "Amazon Orders Insights MCF (non-Amazon channels) units (Revenue-bearing No) × website per-unit net price (capped [0,1])",
  };
})();

// 5. refresh sourceLabels + sourceRecency for the two Amazon slugs (keep the rest).
if (B.meta.sourceLabels) {
  B.meta.sourceLabels["amazon-orders"] = { label: "Amazon Orders Insights · Data (cleaned) — Amazon.in marketplace (FBA) ONLY ÷1.05 (native export)", tier: "native", file: "Amazon Orders Insights by Shivam.xlsx" };
  B.meta.sourceLabels["amazon-order-composition"] = { label: "Amazon order composition (FBA-only · B2B/B2C · basket)", tier: "native", file: "Amazon Orders Insights by Shivam.xlsx" };
}

// 6. refresh the top-level skuVariantFold index for amazon entries (others kept).
if (B.meta.skuVariantFold) {
  for (const [code, vf] of Object.entries(A.skuVariantFold)) {
    const cur = B.meta.skuVariantFold[code] || { byChannel: {}, anyFolded: false };
    cur.byChannel = cur.byChannel || {};
    cur.byChannel.amazon = vf;
    cur.anyFolded = Object.values(cur.byChannel).some((x) => x.folded);
    B.meta.skuVariantFold[code] = cur;
  }
  // drop amazon fold for codes no longer folded (none expected) — leave as-is otherwise.
}

// ── write back ───────────────────────────────────────────────────────────────
const payload = { schemaVersion: B.schemaVersion || 1, monthly: B.monthly, daily: B.daily, meta: B.meta };
const out = `/**
 * bundledBusinessData.js — GENERATED by scripts/build-business-data.cjs.
 * Amazon block RE-BASED 2026-06-14 by scripts/rebase-amazon-bundle.cjs to the
 * authoritative "Amazon Orders Insights · Data (cleaned)" source on the FBA-ONLY
 * basis: Order type = "Amazon.in marketplace (FBA)" · Revenue-bearing? "Y…" · ÷1.05
 * (Amazon net ₹10,33,588 / 995u / gross ₹10,85,267). This SUPERSEDES the erroneous
 * FBA+EasyShip ₹12.82L re-base, which DOUBLE-COUNTED website Easy Ship orders
 * (already in the Shopify-net website figure). DO NOT hand-edit — regenerate via
 * the build script (full) or the rebase script (Amazon-only).
 *
 * May-2026 Business Performance baseline in the pinned store shape (businessStore.js).
 */
export const BUNDLED_BUSINESS = ${JSON.stringify(payload, null, 2)};
`;
fs.writeFileSync(OUT_JS, out);

console.log("=== rebase-amazon-bundle: Amazon May 2026 (Amazon.in marketplace FBA ONLY · ÷1.05) ===");
console.log(JSON.stringify(A.totals, null, 2));
const geoArr = Object.entries(A.geoOut).map(([k, v]) => [k.split("|")[1], v.netRev, v.units, v.returns]).sort((a, b) => b[1] - a[1]);
console.log("geo top 5:", JSON.stringify(geoArr.slice(0, 5)));
console.log("composition:", JSON.stringify(A.compositionMonth));
console.log("mcfShare:", JSON.stringify(B.meta.bySource["amazon-orders"].mcfShare));
console.log(`written → ${OUT_JS}`);
