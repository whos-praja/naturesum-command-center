// Mock data for Naturesum Command Center
// Real marketplace exports (Amazon FBA ledger, Blinkit feeder-WH stock,
// Flipkart inventory + sales, Shopify website sales) are imported as a
// per-SKU map and used to override stub values where available. See
// scripts/import-marketplace-data.cjs for the regeneration pipeline.
import { REAL_MARKETPLACE_DATA as BUNDLED_MP, REAL_DATA_SNAPSHOT_DATE } from "./realMarketplaceData.js";

// ⚠️ Nitin's live inventory sheet (realNitinData.js) is NO LONGER imported
// (FIX-SPEC V9, GROUND-TRUTH §3.5). Its 72-day log is warehouse MOVEMENT, not
// sales, and was inflating velocity; its warehouse-stock leg conflicted with
// the central-WH engine. The engine is the single warehouse-FG authority and
// velocity is sales-only — so the entire nitin runtime path is severed.

// Founder's Agency Channel-wise Sales Sheet, pre-parsed at build time and
// bundled. Per truth table, this is the source-of-truth for Amazon channel
// velocity + growth (and a fallback for Flipkart/Blinkit when their native
// exports are missing). Live agency uploads (uploadParsers.js daily-log
// shape) override this on a per-SKU/per-channel basis.
import { BUNDLED_AGENCY_DATA } from "./bundledAgencyData.js";
const BUNDLED_AGENCY = BUNDLED_AGENCY_DATA.byCode || {};
// Parallel-cascade runway model (lib/runwayCascade.js). Used to compute the
// HEADLINE central-WH runway (founder M1): marketplaces drain their own buffers
// first, the WH backstops, total runway = day the WH itself hits zero. Replaces
// the old flat "WH FG ÷ Σ all-channel velocity" which double-counted demand and
// flagged network-healthy SKUs RED. The flat number is kept as a labelled
// "WH-only (if all marketplaces vanished)" worst-case line.
import { computeCascade } from "./lib/runwayCascade.js";

// Central warehouse engine output (scripts/build-central-wh.cjs). Source of
// truth for: FG stock, producible cap, binding component, depletion velocity
// (across all 6 movement channels), MoM growth (on net units), runway days,
// SKU lead time (max over BOM), per-component stock + days-of-cover.
// Spec: docs/central-wh-spec.md.
import { CENTRAL_WH_DATA } from "./bundledCentralWHData.js";
// O6 durability: an uploaded Central-WH workbook (7th upload zone 'central-wh',
// parsed in-browser by the ported engine) must auto-override the bundled
// artifact with ZERO code change. We read the live store at module-init time
// and prefer it whenever it parsed cleanly. SAFE FALLBACK: buildCentralWhOverride
// already guards on `parsed.fg`, so a malformed/absent upload → null → bundled.
// __liveStore is initialised a little further down (the loadMultiFile() call);
// to keep this above that line we read the store directly here via loadMultiFile.
const __liveCwh = (typeof window !== "undefined") ? buildCentralWhOverride(loadMultiFile()) : null;
const CWH_SRC = __liveCwh || CENTRAL_WH_DATA;
const CWH_FG   = CWH_SRC?.fg || {};
const CWH_COMP = CWH_SRC?.components || {};
// Warehouse-level (non-SKU) buckets — surfaced at the bottom of the
// Materials breakdown tab per founder. Equipment + furniture (fixed assets)
// and cartons/stickers/tape/etc (consumables & shipping).
const CWH_FIXED_ASSETS = CWH_SRC?.fixedAssets || [];
const CWH_CONSUMABLES  = CWH_SRC?.consumables || [];

// Per-SKU overrides — stored in localStorage per-device under
// `ns.skuOverride.<code>.<field>`. Set via the FormulaIcon (ⓘ) popover
// on any cell that supports override (velocity, growth, leadTime, etc).
// When set, the override wins over derived/uploaded numbers. Applied as
// the LAST step of per-SKU derivation so it beats every real-data leg
// in the precedence chain (agency > Manage Orders > stub).
function _readSkuOverrides() {
  if (typeof window === "undefined") return {};
  const out = {};
  for (const k of Object.keys(window.localStorage)) {
    if (!k.startsWith("ns.skuOverride.")) continue;
    const [, , code, field] = k.split(".");
    if (!code || !field) continue;
    const n = parseFloat(window.localStorage.getItem(k));
    if (!Number.isFinite(n)) continue;
    if (!out[code]) out[code] = {};
    out[code][field] = n;
  }
  return out;
}
const __overrideMap = _readSkuOverrides();

// User-uploaded multi-file payload (Sprint 12 — upload UI). When a SKU
// has uploaded data for a given source, it wins over the bundled file;
// SKUs/channels not present in the upload fall back to the bundled real
// data, which themselves fall back to stub. Reads localStorage at
// init time so refreshes pick up the latest upload without code change.
import { loadMultiFile, buildRealMarketplaceOverride, buildCentralWhOverride } from "./lib/multiFileStore.js";
// readParam → the amber-runway threshold (and other tunables) so the default
// render path honors the ⚙ Settings value instead of a hardcoded 30 (R21).
import { readParam } from "./lib/formulaParams.js";
const __liveStore = (typeof window !== "undefined") ? loadMultiFile() : null;
const __liveMp    = buildRealMarketplaceOverride(__liveStore) || {};
function _mergeBundledAndLive(code) {
  const b = BUNDLED_MP[code] || {};
  const l = __liveMp[code] || {};
  return {
    amazon:   l.amazon   ?? b.amazon   ?? null,
    blinkit:  l.blinkit  ?? b.blinkit  ?? null,
    flipkart: l.flipkart ?? b.flipkart ?? null,
    shopify:  l.shopify  ?? b.shopify  ?? null,
    agency:   l.agency   ?? BUNDLED_AGENCY[code] ?? null,
  };
}
const REAL_MARKETPLACE_DATA = new Proxy({}, {
  get: (_t, code) => _mergeBundledAndLive(code),
  has: (_t, code) => Boolean(BUNDLED_MP[code] || __liveMp[code]),
  ownKeys: () => [...new Set([...Object.keys(BUNDLED_MP), ...Object.keys(__liveMp)])],
  getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
});

// ── Growth cap (founder rule M5, 2026-06) ────────────────────────────────
// Velocity already uses the PEAK of (30d,14d). Multiplying that peak by an
// unbounded max-MoM growth double-counts the same surge → systematic
// over-ordering (many SKUs pinned at the old +200% cap). Founder ruling:
// keep the safety stack but cap the forward growth uplift at +75%, and show a
// note in the UI explaining when/why the cap is applied. Downside floor stays
// -100% (a SKU can't decline more than 100%).
const GROWTH_CAP = 75;          // max +% MoM uplift (was 200; founder M5)
const GROWTH_FLOOR = -100;

// ── MAX-MoM growth (founder rule, 2026-06) ───────────────────────────────
// From a monthly sales array [m0,m1,m2,m3] (MOST-RECENT FIRST), compute the
// consecutive month-over-month growth rate ((m[i]-m[i+1])/m[i+1]*100) for each
// adjacent pair whose PRIOR month (m[i+1]) is > 0, and return the MAX of those
// rates (plan for the highest growth seen → don't under-stock). Clamped to
// [-100, +75] (M5). Returns null when fewer than 2 usable months exist, so
// callers can fall back to the existing single-MoM number.
// SAFE FALLBACK: tolerates null/undefined/non-array/NaN entries → null, never
// throws and never emits NaN/Infinity.
function maxMoMGrowth(monthly) {
  if (!Array.isArray(monthly) || monthly.length < 2) return null;
  const m = monthly.map((x) => (Number.isFinite(x) ? x : null));
  let best = null;
  for (let i = 0; i < m.length - 1; i++) {
    const cur = m[i];
    const prior = m[i + 1];
    if (cur == null || prior == null) continue;
    if (!(prior > 0)) continue; // need a positive base to define a MoM rate
    const rate = ((cur - prior) / prior) * 100;
    if (!Number.isFinite(rate)) continue;
    if (best == null || rate > best) best = rate;
  }
  if (best == null) return null;
  return Math.max(GROWTH_FLOOR, Math.min(GROWTH_CAP, best));
}

const NSData = (function () {
  const fmtINR = (n) => {
    if (n == null || !Number.isFinite(n)) return "—"; // NaN/Infinity → em-dash, never "₹NaN"
    // Bug #9 — put the minus sign BEFORE the rupee glyph so negatives
    // render as "−₹0.2K" instead of the ugly "₹-0.2K". Use the typographic
    // minus (U+2212) to match the Delta component's convention.
    const sign = n < 0 ? "−" : "";
    const a = Math.abs(n);
    if (a >= 10000000) return sign + "₹" + (a/10000000).toFixed(2) + " Cr";
    if (a >= 100000)   return sign + "₹" + (a/100000).toFixed(2) + " L";
    if (a >= 1000)     return sign + "₹" + (a/1000).toFixed(1) + "K";
    return sign + "₹" + a;
  };
  // Format a number for display. Integers render as locale-grouped ("12,345").
  // Floats with a non-trivial fractional part render to 1 decimal place
  // (rounded). This is a defensive guard — most call sites pass pre-rounded
  // integers, but velocity/growth values derived from real exports are floats
  // and we don't want "34.333333..." leaking through to a card.
  const fmtN = (n) => {
    if (n == null || Number.isNaN(n)) return "—";
    const rounded = Math.round(n * 10) / 10;
    if (Math.abs(rounded - Math.round(rounded)) < 0.05) {
      return Math.round(rounded).toLocaleString("en-IN");
    }
    return rounded.toLocaleString("en-IN", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  };
  const pct = (n, d=1) => (n>=0?"+":"") + n.toFixed(d) + "%";

  // ── SKUs ──────────────────────────────────────────────
  const skus = [
    { code: "NSMP100",   name: "Moringa Powder",          variant: "100 g",  active: true,  velocity:  30 },
    { code: "NSMP250",   name: "Moringa Powder",          variant: "250 g",  active: true,  velocity:  25 },
    { code: "NSSB100",   name: "Sea Buckthorn Powder",    variant: "100 g",  active: true,  velocity:  40 },
    { code: "NSSB250",   name: "Sea Buckthorn Powder",    variant: "250 g",  active: true,  velocity:  30 },
    { code: "NSSB500",   name: "Sea Buckthorn Powder",    variant: "500 g",  active: true,  velocity:  20 },
    { code: "NSSBDB100", name: "Sea Buckthorn Dry Berry", variant: "100 g",  active: true,  velocity:  50 },
    { code: "NSSBDB250", name: "Sea Buckthorn Dry Berry", variant: "250 g",  active: true,  velocity:  40 },
    { code: "NSSBDB500", name: "Sea Buckthorn Dry Berry", variant: "500 g",  active: true,  velocity:  30 },
    { code: "NSSBJ300",  name: "Sea Buckthorn Juice",     variant: "300 ml", active: true,  velocity:  10 },
    { code: "NSSBJ500",  name: "Sea Buckthorn Juice",     variant: "500 ml", active: true,  velocity:  25 },
    { code: "NSSBBO15",  name: "Sea Buckthorn Berry Oil", variant: "15 ml",  active: true,  velocity:   3 },
    { code: "NSSBBO30",  name: "Sea Buckthorn Berry Oil", variant: "30 ml",  active: true,  velocity:   2 },
    { code: "NSJO100",   name: "Jatamansi Hair Oil",      variant: "100 ml", active: true,  velocity:  25 },
    { code: "NSACDT30",  name: "Acacia Catechu Tea",      variant: "30 bags",active: true,  velocity:   3 },
  ];

  // ── Channels ──────────────────────────────────────────
  const channels = [
    { id: "amazon",   name: "Amazon",    short: "AMZ",  color: "#E47911", payout: "D+7" },
    { id: "shopify",  name: "Shopify",   short: "SHP",  color: "#5E8E3E", payout: "D+1" },
    { id: "flipkart", name: "Flipkart",  short: "FK",   color: "#2874F0", payout: "D+10" },
    { id: "blinkit",  name: "Blinkit",   short: "BLK",  color: "#F8CB46", payout: "D+15" },
    { id: "instamart",name: "Instamart", short: "INS",  color: "#FC8019", payout: "—" },
  ];

  // revenue today by channel
  const revenueToday = {
    amazon:   485000,
    shopify:  312000,
    flipkart: 168000,
    blinkit:   94000,
    instamart:     0,
  };
  const revenueYesterday = {
    amazon:   442000,
    shopify:  298000,
    flipkart: 182000,
    blinkit:   71000,
    instamart:     0,
  };
  // 7-day rolling average revenue by channel (last 7 days excluding today)
  const revenue7dAvg = {
    amazon:   438000,
    shopify:  286000,
    flipkart: 174000,
    blinkit:   78000,
    instamart:     0,
  };

  // Aggregate cash flow expected
  const cashExpected = {
    inflow7d:  2860000,   // ₹28.6L
    inflow30d: 9500000,   // ₹95L
    outflow7d: 480000,    // ₹4.8L
    outflow30d:3900000,   // ₹39L
  };
  const revenueMTD = 28940000; // 2.89 Cr
  const revenueMTDLast = 24210000;
  const revenueMTDTarget = 35000000;

  // 30-day revenue trend (in lakhs)
  const trend30 = [7.8, 8.2, 7.6, 9.1, 9.4, 8.8, 9.6, 10.1, 9.8, 9.4, 10.2, 11.1, 10.4, 9.9, 11.4, 11.7, 12.0, 11.3, 10.8, 11.6, 12.2, 12.4, 11.8, 12.6, 13.1, 12.7, 13.4, 13.0, 12.9, 13.5];

  // ── Alerts ────────────────────────────────────────────
  const alerts = [
    { id: "a1", sev: "crit", cat: "Inventory",  title: "Stockout imminent — Daily Multivitamin (Women)", detail: "8 days runway on Amazon FBA · lead time 21 days · reorder window passed",  module: "inventory", time: "12 min ago", roles: ["founder","ops","marketplace"] },
    { id: "a2", sev: "crit", cat: "Marketplace", title: "Amazon listing suppressed — Whey Choc 2kg", detail: "ASIN B09… flagged for image policy. Listing inactive since 06:48 IST.", module: "marketplace", time: "1h 12m ago", roles: ["founder","marketplace"] },
    { id: "a3", sev: "crit", cat: "Finance",    title: "Cash projection breaches ₹40L floor on Jun 04", detail: "Supplier payments due ₹18.4L · expected payouts ₹14.2L", module: "finance", time: "3h ago", roles: ["founder","vcfo"] },
    { id: "a4", sev: "warn", cat: "Marketing",  title: "Meta Ads overpacing — 18% above daily budget", detail: "₹62K spent vs ₹52K target · auction CPM up 22% WoW", module: "marketing", time: "2h ago", roles: ["founder","ads"] },
    { id: "a5", sev: "warn", cat: "Marketplace", title: "Rating drop — Collagen Peptides at 3.9★", detail: "4 new 1–2★ reviews in last 48h · last cohort cited 'taste'", module: "marketplace", time: "5h ago", roles: ["founder","marketplace"] },
    { id: "a6", sev: "warn", cat: "Inventory",  title: "Batch B-2412-OMG3 expiring in 47 days", detail: "1,840 units remaining · velocity won't clear · move to flash sale?", module: "inventory", time: "8h ago", roles: ["founder","ops"] },
    { id: "a7", sev: "warn", cat: "Sales",      title: "Returns spike — Plant Protein up 3.2× vs 30-day avg", detail: "12 returns in last 7d · 'lumpy when mixed' cited 8×", module: "sales", time: "yesterday", roles: ["founder","ops","marketplace"] },
    { id: "a8", sev: "info", cat: "Marketing",  title: "ROAS up 45% on Biotin+Hair — consider scaling budget", detail: "Meta creative #BIO-V3 driving CAC ₹312 vs blended ₹486", module: "marketing", time: "yesterday", roles: ["founder","ads"] },
    { id: "a9", sev: "info", cat: "Inventory",  title: "Whey Choc 1kg — 8 days FBA, 45 days central warehouse", detail: "Recommend FBA replenishment shipment of 600 units", module: "inventory", time: "yesterday", roles: ["founder","ops","marketplace"] },
    { id: "a10",sev: "info", cat: "Sales",      title: "Blinkit revenue +60% WoW", detail: "Ashwagandha + Multivitamin driving lift · check ad support", module: "sales", time: "2d ago", roles: ["founder"] },
  ];

  // ── SKU sales table (Sales module) ───────────────────
  const skuSales = skus.filter(s => s.active).map((s, i) => {
    const total = s.velocity * 30 * (380 + (i%4)*55);
    const splits = {
      amazon:   Math.round(total * (0.35 + (i%5)*0.03)),
      shopify:  Math.round(total * (0.28 - (i%4)*0.02)),
      flipkart: Math.round(total * (0.18 + (i%3)*0.01)),
      blinkit:  Math.round(total * (0.12 + (i%6)*0.005)),
    };
    return {
      ...s,
      revenue30: Math.round(Object.values(splits).reduce((a,b)=>a+b,0)),
      units30: s.velocity * 30,
      aov: 380 + (i%4)*55,
      returnRate: 1.4 + (i%5)*0.35,
      growth: ([12.4, -4.1, 18.2, 8.6, 22.4, -2.2, 32.1, -8.4, 14.6, -22.4, 6.8, 19.2, 4.4])[i] || 5,
      splits,
    };
  });

  // ── Inventory ─────────────────────────────────────────
  // REAL-WORLD SNAPSHOT — extracted from the Naturesum Live Inventory sheet
  // (Master tab "Live" column + Daily Movement of FG 30-day average) and the
  // Naturesum Daily Ad Report (May 2026 per-channel unit totals) + the
  // Shopify product-wise monthly export.
  //
  // Data model (per the founder's rule of thumb):
  //   - Each SKU has ONE upstream input — either a Semi-FG (SFG) or a Raw
  //     Material (RM), never both. The other row is rendered as N/A.
  //   - Packaging is a list of components (PKG1, PKG2, …). Juice for example
  //     needs bottle + tube + label + air pouch; AC Tea needs empty pouches
  //     + outer carton.
  //   - Producible FG = min(input capacity, min over pkg capacities).
  //
  // ⚠️ ITEM_QTY (the legacy hardcoded "what's in the warehouse" map) has been
  // REMOVED (FIX-SPEC, 2026-06). It was STALE (Moringa raw 200 vs real 100,
  // Moringa pouch 0 vs real 2935, dry berry 946.79 vs audit) and was the root
  // cause of the wrong Materials-breakdown / producible / bottleneck numbers.
  // The central-WH engine (CWH_COMP / CWH_FG[code].bomDetail) is now the SINGLE
  // source for every component stock. See `compStock()` below.
  //
  // SKU_RECIPE is still the per-SKU BOM *structure* (which item it consumes, how
  // much per pack, display name/unit/label) — but the QUANTITIES come from the
  // engine, never from a hardcoded literal.

  // Component stock lookup — engine-sourced, with a safe fallback chain.
  // 1) CWH_COMP[ref].stock  (component pass: audit baseline − post-audit
  //    production consumption, clamped ≥0).
  // 2) the binding-SKU's bomDetail stock (same number; belt-and-suspenders for
  //    components that only appear inside a SKU's bomDetail).
  // 3) 0 — never undefined/NaN, so capacity arithmetic can never white-screen.
  // SAFE FALLBACK: tolerates a missing/half-baked engine payload.
  const _bomStockIndex = (() => {
    const idx = {};
    for (const code of Object.keys(CWH_FG)) {
      for (const d of (CWH_FG[code]?.bomDetail || [])) {
        if (d && d.ref != null && Number.isFinite(d.stock)) idx[d.ref] = d.stock;
      }
    }
    return idx;
  })();
  function compStock(ref) {
    if (!ref) return 0;
    const c = CWH_COMP[ref];
    if (c && Number.isFinite(c.stock)) return c.stock;
    if (Number.isFinite(_bomStockIndex[ref])) return _bomStockIndex[ref];
    return 0;
  }
  // D1 non-constraining set (outer cartons only — founder pass-4 correction:
  // juice air pouches DO constrain) — read from whichever engine payload won
  // (uploaded workbook over bundled). SAFE FALLBACK to the known set so the
  // flag is correct even if the payload omits `nonConstraining`.
  const NON_CONSTRAINING = new Set(
    (Array.isArray(CWH_SRC?.nonConstraining) && CWH_SRC.nonConstraining.length)
      ? CWH_SRC.nonConstraining
      : ["NSPKGCB100", "NSPKGCB250"]
  );
  // Pass 4 — BOM refs with NO audit line anywhere: stock is UNKNOWN, not zero.
  // Excluded from producible binding + M3 allocation (phantom-zero guard) and
  // labelled "untracked" in the UI. Today: juice glass bottles + labels.
  const UNTRACKED = new Set(
    Array.isArray(CWH_SRC?.untrackedComponents) ? CWH_SRC.untrackedComponents : []
  );

  // Per-SKU recipe — kind (raw/semi), the input item, and packaging components.
  // Display labels in the popover: SFG / RM / PKG1 / PKG2 / …
  // perPack: how many units of the input are needed to make ONE FG pack.
  // unitsPerPack on pkg: how many of that component per FG pack (e.g. 30
  //   empty pouches per AC Tea pack).
  const SKU_RECIPE = {
    NSMP100: {
      kind: "raw",
      input: { refCode: "NSMLPR", name: "Moringa Leaves Powder", unit: "KG", perPack: 0.10 },
      pkg: [
        { refCode: "NSPKGMP100", name: "Moringa Powder Empty Pouch 100g", unit: "Pcs", unitsPerPack: 1 },
        { refCode: "NSPKGCB100", name: "100g Carton Box",                  unit: "Pcs", unitsPerPack: 1 },
      ],
    },
    NSMP250: {
      kind: "raw",
      input: { refCode: "NSMLPR", name: "Moringa Leaves Powder", unit: "KG", perPack: 0.25 },
      pkg: [
        { refCode: "NSPKGMP250", name: "Moringa Powder Empty Pouch 250g", unit: "Pcs", unitsPerPack: 1 },
        { refCode: "NSPKGCB250", name: "250g Carton Box",                  unit: "Pcs", unitsPerPack: 1 },
      ],
    },
    NSSB100: {
      kind: "raw",
      input: { refCode: "NSSBPR", name: "SB Powder (Raw)", unit: "KG", perPack: 0.10 },
      pkg: [{ refCode: "NSPKGSBP100", name: "SB Powder Empty Pouch 100g", unit: "Pcs", unitsPerPack: 1 }],
    },
    NSSB250: {
      kind: "raw",
      input: { refCode: "NSSBPR", name: "SB Powder (Raw)", unit: "KG", perPack: 0.25 },
      pkg: [{ refCode: "NSPKGSBP250", name: "SB Powder Empty Pouch 250g", unit: "Pcs", unitsPerPack: 1 }],
    },
    NSSB500: {
      kind: "raw",
      input: { refCode: "NSSBPR", name: "SB Powder (Raw)", unit: "KG", perPack: 0.50 },
      pkg: [{ refCode: "NSPKGSBP500", name: "SB Powder Empty Pouch 500g", unit: "Pcs", unitsPerPack: 1 }],
    },
    NSSBDB100: {
      kind: "raw",
      input: { refCode: "NSSBDBR", name: "SB Dry Berries (Raw)", unit: "KG", perPack: 0.10 },
      pkg: [{ refCode: "NSPKGDBP100", name: "Dry Berries Empty Pouch 100g", unit: "Pcs", unitsPerPack: 1 }],
    },
    NSSBDB250: {
      kind: "raw",
      input: { refCode: "NSSBDBR", name: "SB Dry Berries (Raw)", unit: "KG", perPack: 0.25 },
      pkg: [{ refCode: "NSPKGDBP250", name: "Dry Berries Empty Pouch 250g", unit: "Pcs", unitsPerPack: 1 }],
    },
    NSSBDB500: {
      kind: "raw",
      input: { refCode: "NSSBDBR", name: "SB Dry Berries (Raw)", unit: "KG", perPack: 0.50 },
      pkg: [{ refCode: "NSPKGDBP500", name: "Dry Berries Empty Pouch 500g", unit: "Pcs", unitsPerPack: 1 }],
    },
    NSSBJ300: {
      kind: "raw",
      input: { refCode: "NSSBJPLP", name: "SB Juice Pulp", unit: "Ltr", perPack: 0.30 },
      pkg: [
        { refCode: "NSPKGJBOT300", name: "Juice Bottle 300 ml",      unit: "Pcs", unitsPerPack: 1 },
        { refCode: "NSPKGJB300",   name: "Small Air Pouch 300 ml",   unit: "Pcs", unitsPerPack: 1 },
        { refCode: "NSPKGJTUB300", name: "Juice Tube 300 ml",        unit: "Pcs", unitsPerPack: 1 },
        { refCode: "NSPKGJLBL300", name: "Juice Label 300 ml",       unit: "Pcs", unitsPerPack: 1 },
      ],
    },
    NSSBJ500: {
      kind: "raw",
      input: { refCode: "NSSBJPLP", name: "SB Juice Pulp", unit: "Ltr", perPack: 0.50 },
      pkg: [
        { refCode: "NSPKGJBOT500", name: "Juice Bottle 500 ml",      unit: "Pcs", unitsPerPack: 1 },
        { refCode: "NSPKGJB500",   name: "Large Air Pouch 500 ml",   unit: "Pcs", unitsPerPack: 1 },
        { refCode: "NSPKGJTUB500", name: "Juice Tube 500 ml",        unit: "Pcs", unitsPerPack: 1 },
        { refCode: "NSPKGJLBL500", name: "Juice Label 500 ml",       unit: "Pcs", unitsPerPack: 1 },
      ],
    },
    NSSBBO15: {
      kind: "raw",
      input: { refCode: "NSSBOR", name: "SB Face Oil (Raw)", unit: "Ltr", perPack: 0.015 },
      pkg: [
        { refCode: "NSPKGBOBT15", name: "SB Oil Bottle 15 ml",       unit: "Pcs", unitsPerPack: 1 },
        { refCode: "NSPKGBOB15",  name: "SB Faceoil Empty Box 15 ml",unit: "Pcs", unitsPerPack: 1 },
        { refCode: "NSPKGBOCAP",  name: "Bottle Cap",                unit: "Pcs", unitsPerPack: 1 },
        { refCode: "NSPKGBODROP", name: "Dropper",                   unit: "Pcs", unitsPerPack: 1 },
      ],
    },
    NSSBBO30: {
      kind: "raw",
      input: { refCode: "NSSBOR", name: "SB Face Oil (Raw)", unit: "Ltr", perPack: 0.030 },
      pkg: [
        { refCode: "NSPKGBOBT30", name: "SB Oil Bottle 30 ml",       unit: "Pcs", unitsPerPack: 1 },
        { refCode: "NSPKGBOB30",  name: "SB Faceoil Empty Box 30 ml",unit: "Pcs", unitsPerPack: 1 },
        { refCode: "NSPKGBOCAP",  name: "Bottle Cap",                unit: "Pcs", unitsPerPack: 1 },
        { refCode: "NSPKGBODROP", name: "Dropper",                   unit: "Pcs", unitsPerPack: 1 },
      ],
    },
    NSJO100: {
      kind: "semi",
      input: { refCode: "NSJOF100", name: "Jatamansi Hair Oil Filled Bottle", unit: "Pcs", perPack: 1 },
      pkg:   [{ refCode: "NSPKGJOB100", name: "Jatamansi Empty Box (with print)", unit: "Pcs", unitsPerPack: 1 }],
    },
    NSACDT30: {
      kind: "semi",
      input: { refCode: "NSACDSF30", name: "AC Tea Dip Sachets (Filled)", unit: "Pcs", perPack: 30 },
      pkg: [
        { refCode: "NSPKGACTC30",  name: "Acacia Tea Bag Empty Pouch (green)", unit: "Pcs", unitsPerPack: 30 },
        { refCode: "NSPKGACTCBOX", name: "Acacia Tea Empty Outer Box",          unit: "Pcs", unitsPerPack: 1 },
      ],
    },
  };

  // Per-component supplier lead time in days (founder-provided 31-May-2026).
  // Buckets per the latest data:
  //   Sea Buckthorn raw materials (juice pulp, powder, oil, dry berries) → 50d
  //   Moringa leaves powder → 25d
  //   Semi-FG (Acacia + Jatamansi filled) → 20d
  //   Packaging (every PKGn component, pouches/bottles/boxes/labels) → 14d
  // SIM-016-DATA satisfied. Used both as the default lead time for any
  // component in the Simulator AND as the source for each SKU's overall
  // supplier lead time (= max of all its component lead times — the
  // slowest input is the binding one).
  const COMPONENT_LEAD_TIMES = {
    // Semi-FG
    NSACDSF30: 20,   // AC Tea Dip Sachets (Filled)
    NSJOF100:  20,   // Jatamansi Hair Oil Filled Bottles
    NSACTPF:   20,   // AC Tea Pouches (Filled) — same family
    // Raw materials
    NSSBPR:    50,   // SB Powder (Raw)
    NSSBJPLP:  50,   // SB Juice Pulp
    NSSBDBR:   50,   // SB Dry Berries (Raw)
    NSSBOR:    50,   // SB Face Oil (Raw)
    NSMLPR:    25,   // Moringa Leaves Powder
    // Packaging — everywhere 14 days
    NSPKGCB100:   14, NSPKGCB250:   14,
    NSPKGMP100:   14, NSPKGMP250:   14,
    NSPKGSBP100:  14, NSPKGSBP250:  14, NSPKGSBP500:  14,
    NSPKGDBP100:  14, NSPKGDBP250:  14, NSPKGDBP500:  14,
    NSPKGJB300:   14, NSPKGJB500:   14,
    NSPKGJBOT300: 14, NSPKGJBOT500: 14,
    NSPKGJTUB300: 14, NSPKGJTUB500: 14,
    NSPKGJLBL300: 14, NSPKGJLBL500: 14,
    NSPKGBOB15:   14, NSPKGBOB30:   14,
    NSPKGBOBT15:  14, NSPKGBOBT30:  14,
    NSPKGBOCAP:   14, NSPKGBODROP:  14,
    NSPKGJOB100:  14,
    NSPKGACTC30:  14, NSPKGACTCBOX: 14,
  };

  // Compute per-SKU lead time = max(component lead times). The slowest
  // component blocks the whole pack. Falls back to a sensible default if
  // recipe is missing.
  function maxLeadTimeForSku(code) {
    const r = SKU_RECIPE[code];
    if (!r) return 21;
    const candidates = [
      COMPONENT_LEAD_TIMES[r.input.refCode],
      ...r.pkg.map(p => COMPONENT_LEAD_TIMES[p.refCode]),
    ].filter(n => Number.isFinite(n));
    return candidates.length ? Math.max(...candidates) : 21;
  }

  // 30-day velocity per SKU. Lead time derived automatically from the
  // slowest component above — overrides the old hardcoded values to
  // keep one source of truth.
  const SKU_OPERATIONS = {
    NSMP100:   { fg: 0,   vel: 0,    leadTime: maxLeadTimeForSku("NSMP100")   },
    NSMP250:   { fg: 0,   vel: 0,    leadTime: maxLeadTimeForSku("NSMP250")   },
    NSSB100:   { fg: 37,  vel: 14.3, leadTime: maxLeadTimeForSku("NSSB100")   },
    NSSB250:   { fg: 185, vel: 17.9, leadTime: maxLeadTimeForSku("NSSB250")   },
    NSSB500:   { fg: 99,  vel: 7.8,  leadTime: maxLeadTimeForSku("NSSB500")   },
    NSSBDB100: { fg: 620, vel: 21.2, leadTime: maxLeadTimeForSku("NSSBDB100") },
    NSSBDB250: { fg: 493, vel: 18.9, leadTime: maxLeadTimeForSku("NSSBDB250") },
    NSSBDB500: { fg: 725, vel: 16.7, leadTime: maxLeadTimeForSku("NSSBDB500") },
    NSSBJ300:  { fg: 0,   vel: 0,    leadTime: maxLeadTimeForSku("NSSBJ300")  },
    NSSBJ500:  { fg: 677, vel: 0,    leadTime: maxLeadTimeForSku("NSSBJ500")  },
    NSSBBO15:  { fg: 0,   vel: 0,    leadTime: maxLeadTimeForSku("NSSBBO15")  },
    NSSBBO30:  { fg: 0,   vel: 0.5,  leadTime: maxLeadTimeForSku("NSSBBO30")  },
    NSJO100:   { fg: 788, vel: 8.3,  leadTime: maxLeadTimeForSku("NSJO100")   },
    NSACDT30:  { fg: 39,  vel: 3.3,  leadTime: maxLeadTimeForSku("NSACDT30")  },
  };

  // May 2026 per-channel unit totals — drives the per-channel velocity split
  // shown in PlatformCell / Runway calculator / popover channel breakdown.
  const CHANNEL_MIX = {
    NSMP100:   { amazon: 0,   shopify: 5,   flipkart: 0,  blinkit: 0   },
    NSMP250:   { amazon: 0,   shopify: 0,   flipkart: 0,  blinkit: 0   },
    NSSB100:   { amazon: 112, shopify: 67,  flipkart: 20, blinkit: 95  },
    NSSB250:   { amazon: 175, shopify: 42,  flipkart: 47, blinkit: 33  },
    NSSB500:   { amazon: 99,  shopify: 50,  flipkart: 4,  blinkit: 0   },
    NSSBDB100: { amazon: 127, shopify: 82,  flipkart: 80, blinkit: 0   },
    NSSBDB250: { amazon: 54,  shopify: 78,  flipkart: 63, blinkit: 101 },
    NSSBDB500: { amazon: 282, shopify: 79,  flipkart: 55, blinkit: 68  },
    NSSBJ300:  { amazon: 92,  shopify: 92,  flipkart: 54, blinkit: 14  },
    NSSBJ500:  { amazon: 240, shopify: 227, flipkart: 12, blinkit: 0   },
    NSSBBO15:  { amazon: 0,   shopify: 0,   flipkart: 0,  blinkit: 0   },
    NSSBBO30:  { amazon: 0,   shopify: 0,   flipkart: 0,  blinkit: 0   },
    NSJO100:   { amazon: 25,  shopify: 11,  flipkart: 1,  blinkit: 0   },
    NSACDT30:  { amazon: 31,  shopify: 0,   flipkart: 1,  blinkit: 0   },
  };

  // MoM revenue growth (Shopify CSV: May 2026 / April 2026). Capped at the
  // founder's +75% growth cap (M5) — some SKUs went from a near-zero base so
  // the raw rate would explode and over-order.
  const cap = (v) => Math.max(GROWTH_FLOOR, Math.min(GROWTH_CAP, v));
  const MOM_GROWTH = {
    NSMP100: 0,            NSMP250: 0,
    NSSB100:   cap(1497.3),  NSSB250: -46.2,  NSSB500: 0,
    NSSBDB100: -37.1,        NSSBDB250: -67.7, NSSBDB500: -4.3,
    NSSBJ300:  cap(739.2),   NSSBJ500: cap(1597.9),
    NSSBBO15: 0,             NSSBBO30: 0,
    NSJO100:   55.4,         NSACDT30: -100,
  };

  // Per-SKU pricing — Selling Price (SP) and MRP, founder-provided 01-Jun-2026
  // (DATA-004). SP = realised selling price across channels (matches blended
  // ASP — used for stock-value math). MRP = list / max retail price.
  // Two SKUs (Berry Oil 15/30) have SP "TBD" — use MRP as a conservative
  // upper-bound stand-in until SP lands.
  const SKU_PRICING = {
    NSMP100:   { sp: 265,  mrp: 315  },
    NSMP250:   { sp: 495,  mrp: 625  },
    NSSB100:   { sp: 450,  mrp: 500  },   // user code: NSSBP100
    NSSB250:   { sp: 750,  mrp: 880  },   // user code: NSSBP250
    NSSB500:   { sp: 1350, mrp: 1550 },   // user code: NSSBP500
    NSSBDB100: { sp: 390,  mrp: 520  },
    NSSBDB250: { sp: 690,  mrp: 920  },
    NSSBDB500: { sp: 1150, mrp: 1550 },
    NSSBJ300:  { sp: 690,  mrp: 920  },
    NSSBJ500:  { sp: 1100, mrp: 1300 },
    NSSBBO15:  { sp: 1075, mrp: 1250 },
    NSSBBO30:  { sp: 1580, mrp: 1920 },
    NSJO100:   { sp: 1350, mrp: 1500 },
    NSACDT30:  { sp: 975,  mrp: 1150 },
  };
  // Back-compat: existing call sites read `SKU_PRICE[code]` as a flat number.
  // Keep that working by exposing the SP (or MRP fallback for TBD SKUs).
  const SKU_PRICE = Object.fromEntries(
    Object.entries(SKU_PRICING).map(([code, p]) => [code, p.sp ?? p.mrp ?? 500])
  );

  // What each SKU is listed as on each marketplace / channel. Pulled from
  // the actual sheet exports (Amazon/FK/Blinkit category reports + the
  // Shopify product-wise CSV). null = not listed on that channel yet.
  const MARKETPLACE_NAMES = {
    NSMP100:   { amazon: null, flipkart: null, blinkit: null, shopify: "Moringa Powder — 100gm" },
    NSMP250:   { amazon: null, flipkart: null, blinkit: null, shopify: "Moringa Powder — 250gm" },
    NSSB100:   { amazon: "Sea Buckthorn powder 100g", flipkart: null, blinkit: null, shopify: "NATURESUM HIMALAYAN SEA BUCKTHORN BERRIES POWDER — 100gm" },
    NSSB250:   { amazon: "Sea Buckthorn powder 250g", flipkart: null, blinkit: null, shopify: "NATURESUM HIMALAYAN SEA BUCKTHORN BERRIES POWDER — 250gm" },
    NSSB500:   { amazon: "Sea Buckthorn powder 500g", flipkart: null, blinkit: null, shopify: "NATURESUM HIMALAYAN SEA BUCKTHORN BERRIES POWDER — 500gm" },
    NSSBDB100: { amazon: "Sea Buckthorn Berries 100g", flipkart: "Sea Buckthorn Berries 100g", blinkit: "Sea Buckthorn Berries 100g", shopify: "PURE SEA BUCKTHORN DRY BERRIES — 100GM" },
    NSSBDB250: { amazon: "Sea Buckthorn Berries 250g", flipkart: "Sea Buckthorn Berries 250g", blinkit: "Sea Buckthorn Berries 250g", shopify: "PURE SEA BUCKTHORN DRY BERRIES — 250GM" },
    NSSBDB500: { amazon: "Sea Buckthorn Berries 500g", flipkart: "Sea Buckthorn Berries 500g", blinkit: "Sea Buckthorn Berries 500g", shopify: "PURE SEA BUCKTHORN DRY BERRIES — 500GM" },
    NSSBJ300:  { amazon: "Sea Buckthorn juice 300ml", flipkart: null, blinkit: "Sea Buckthorn Juice 300ml", shopify: "NATURESUM SEA BUCKTHORN JUICE — 300 ml" },
    NSSBJ500:  { amazon: "Sea Buckthorn juice 500ml", flipkart: null, blinkit: null, shopify: "NATURESUM SEA BUCKTHORN JUICE — 500 ml" },
    NSSBBO15:  { amazon: "Sea Buckthorn Oil 15ML", flipkart: "Sea Buckthorn Oil 15ML", blinkit: "Sea Buckthorn Oil 15ML", shopify: "SEA BUCKTHORN BERRY OIL — 15ML" },
    NSSBBO30:  { amazon: "Sea Buckthorn Oil 30ML", flipkart: null, blinkit: "Sea Buckthorn Oil 30ML", shopify: "SEA BUCKTHORN BERRY OIL — 30ML" },
    NSJO100:   { amazon: "Jatamansi Oil", flipkart: "Jatamansi Oil", blinkit: "Jatamansi Oil", shopify: "ROSEMARY & JATAMANSI HAIR OIL — 100ML" },
    NSACDT30:  { amazon: "Acacia Catechu", flipkart: "Acacia Catechu", blinkit: null, shopify: "DIABETES CARE COLD BREW TEA WITH ACACIA CATECHU — Pack Of 30" },
  };

  // ── Blinkit feeder warehouses ─────────────────────────
  // Real list derived from the Blinkit Seller Panel "Stock On Hand" export
  // (DATA-001, arrived 30-May-2026). The export uses long names like
  // "Noida N1 - Feeder" — we keep those as the canonical `code` so the
  // per-SKU `current[code]` map keys directly match the import.
  //
  // Cities are derived from the WH name prefix (Noida → Delhi NCR,
  // Faridabad → Delhi NCR, Kundli → Delhi NCR — they're all in the same
  // metro). For display, `name` is the short form ("Noida N1") and
  // `city` is the metro grouping.
  const BLINKIT_FEEDER_WH_MAP = {
    "Noida N1 - Feeder":              { name: "Noida N1",      city: "Delhi NCR" },
    "Faridabad - Feeder":             { name: "Faridabad",     city: "Delhi NCR" },
    "Kundli Feeder":                  { name: "Kundli",        city: "Delhi NCR" },
    "Mumbai M10 - Feeder":            { name: "Mumbai M10",    city: "Mumbai"    },
    "Bengaluru B3":                   { name: "Bengaluru B3",  city: "Bangalore" },
    "Bengaluru B5 - Feeder":          { name: "Bengaluru B5",  city: "Bangalore" },
    "Hyderabad H3 - Feeder":          { name: "Hyderabad H3",  city: "Hyderabad" },
    "Kolkata K6 - Feeder Warehouse":  { name: "Kolkata K6",    city: "Kolkata"   },
    "Pune P3 - Feeder Warehouse":     { name: "Pune P3",       city: "Pune"      },
    "Chennai C5 - Feeder":            { name: "Chennai C5",    city: "Chennai"   },
    "Ahmedabad A2 - Feeder":          { name: "Ahmedabad A2",  city: "Ahmedabad" },
    "Jaipur J3 - Feeder":             { name: "Jaipur J3",     city: "Jaipur"    },
    "Lucknow L4":                     { name: "Lucknow L4",    city: "Lucknow"   },
  };
  const BLINKIT_FEEDER_WHS = Object.entries(BLINKIT_FEEDER_WH_MAP).map(
    ([code, meta]) => ({ code, ...meta })
  );

  // Build per-SKU per-WH stock. When the real Blinkit export covers a SKU,
  // use it directly. Otherwise the SKU is treated as "not launched on
  // Blinkit" (empty `ever` list) — none of the SKUs missing from the real
  // file are actually Blinkit-eligible (Moringa, Sea Buckthorn Oil,
  // Jatamansi Hair Oil — Blinkit-side launch pending).
  function buildBlinkitFeeders(skuCode) {
    const real = REAL_MARKETPLACE_DATA[skuCode]?.blinkit;
    if (!real || real.everLaunched.length === 0) {
      return { ever: [], current: {}, isStub: false };
    }
    const current = {};
    for (const wh of real.everLaunched) {
      current[wh] = real.byWh[wh]?.sellable ?? 0;
    }
    return {
      ever: [...real.everLaunched],
      current,
      isStub: false,
      // Real per-WH 30-day sales — used by the UI to compute days-of-cover
      // per WH instead of dividing total Blinkit velocity by WH count.
      perWhSales30d: Object.fromEntries(
        real.everLaunched.map(wh => [wh, real.byWh[wh]?.sales30d ?? 0])
      ),
      // D5: per-WH 15-day sales so the modal can apply the same MAX(30d,15d)
      // velocity rule the channel cell uses (Blinkit's nearest-to-14d window).
      perWhSales15d: Object.fromEntries(
        real.everLaunched.map(wh => [wh, real.byWh[wh]?.sales15d ?? 0])
      ),
    };
  }

  const inv0 = skus.map((s) => {
    const opsRaw = SKU_OPERATIONS[s.code] || { fg: 0, vel: 0, leadTime: 25 };
    // ⚠️ Legacy `nitin` warehouse-FG synth path REMOVED (FIX-SPEC, 2026-06).
    // It was a SECOND, conflicting warehouse source (Nitin's 5-May daily sheet)
    // racing the central-WH engine. The engine (CWH_FG, applied in the overlay
    // below) is now the single warehouse-FG authority; `opsRaw.fg` is only a
    // stub fallback for any SKU the engine doesn't cover.
    const ops = opsRaw;
    const recipe = SKU_RECIPE[s.code];
    const ch = CHANNEL_MIX[s.code] || { amazon: 0, shopify: 0, flipkart: 0, blinkit: 0 };
    const totalChUnits = (ch.amazon + ch.shopify + ch.flipkart + ch.blinkit) || 0;
    // Marketplace stock — use real exports when present, otherwise hold
    // approximately 7 days of cover at each channel's run rate as a stand-in.
    //   - amazonFBA: Amazon FBA ledger ending-balance sum (snapshot date in REAL_DATA_SNAPSHOT_DATE)
    //   - flipkart:  Flipkart inventory live count (single Gurgaon WH)
    //   - blinkit:   Blinkit feeder-WH sellable sum across all feeders
    const dailyByCh = totalChUnits ? totalChUnits / 30 : 0;
    const ESTCOVER = 7;
    const real = REAL_MARKETPLACE_DATA[s.code] || {};
    const stubAmazon   = Math.round(dailyByCh * (ch.amazon   / (totalChUnits || 1)) * ESTCOVER) || 0;
    const stubFlipkart = Math.round(dailyByCh * (ch.flipkart / (totalChUnits || 1)) * ESTCOVER) || 0;
    const stubBlinkit  = Math.round(dailyByCh * (ch.blinkit  / (totalChUnits || 1)) * ESTCOVER) || 0;
    const totalStock = {
      warehouse: ops.fg,
      amazonFBA: real.amazon?.totalSellable   ?? stubAmazon,
      flipkart:  real.flipkart?.live          ?? stubFlipkart,
      blinkit:   real.blinkit?.totalSellable  ?? stubBlinkit,
      transit:   0,
    };
    // Track which channels are sourced from real data — used to drop the
    // STUB badges in the UI and to expose precise numbers in drill modals.
    const stockSource = {
      amazon:   real.amazon   ? "real" : "stub",
      flipkart: real.flipkart ? "real" : "stub",
      blinkit:  real.blinkit  ? "real" : "stub",
    };

    // Build the per-SKU input rows from the recipe + the CENTRAL-WH ENGINE
    // component stock (NOT the killed ITEM_QTY map). Exactly one of `sfg`/`rm`
    // is populated; the other stays null and the UI renders an "N/A" row.
    //
    // D1 — each row carries a `constrains` flag (false for cartons + juice air
    // pouches). `capacity` is the REAL pack-equivalent (for honest display); the
    // UI's bottleneck/producible math filters on `constrains` so a "quickly-
    // arranged" carton/air-pouch can never become the bottleneck — matching the
    // engine's producible, which excludes them.
    const mkLead = (ref) => {
      const fromEngine = CWH_COMP[ref]?.leadDays;
      return Number.isFinite(fromEngine) ? fromEngine : (COMPONENT_LEAD_TIMES[ref] ?? null);
    };
    let sfg = null, rm = null;
    if (recipe) {
      const ref = recipe.input.refCode;
      const inputQty = compStock(ref);                       // engine-sourced
      const constrains = !NON_CONSTRAINING.has(ref);
      // Capacity = how many FG packs this input alone can make. Clamp ≥0
      // (negative engine stock shouldn't contaminate caps). Non-constraining →
      // Infinity so it never becomes the bottleneck (D1).
      const rawCap = recipe.input.perPack > 0 ? Math.max(0, Math.floor(inputQty / recipe.input.perPack)) : 0;
      const inputRow = {
        label:   recipe.kind === "semi" ? "SFG" : "RM",
        refCode: ref,
        name:    recipe.input.name,
        unit:    recipe.input.unit,
        qty:     inputQty,
        stock:   inputQty,
        perPack: recipe.input.perPack,
        capacity: rawCap,                                    // real pack-equivalent
        capacityReal: rawCap,
        constrains,                                          // D1 — UI filters on this
        untracked: UNTRACKED.has(ref),                       // no audit line — stock unknown ≠ 0
        leadTime: mkLead(ref),
      };
      if (recipe.kind === "semi") sfg = inputRow;
      else rm = inputRow;
    }
    const pkgList = (recipe?.pkg || []).map((p, idx) => {
      const qty = compStock(p.refCode);                      // engine-sourced
      const constrains = !NON_CONSTRAINING.has(p.refCode);
      const rawCap = p.unitsPerPack > 0 ? Math.max(0, Math.floor(qty / p.unitsPerPack)) : 0;
      return {
        label:        `PKG${idx + 1}`,
        refCode:      p.refCode,
        name:         p.name,
        unit:         p.unit,
        qty,
        stock:        qty,
        unitsPerPack: p.unitsPerPack,
        capacity:     rawCap,                                // real pack-equivalent
        capacityReal: rawCap,
        constrains,                                          // D1 — UI filters on this
        untracked:    UNTRACKED.has(p.refCode),              // no audit line — stock unknown ≠ 0
        leadTime:     mkLead(p.refCode),
      };
    });

    // Producible FG + binding — sourced from the CENTRAL-WH ENGINE (CWH_FG),
    // which already excludes NON_CONSTRAINING components (cartons/air pouches)
    // from the min and never lets them bind. We DON'T recompute it locally from
    // ITEM_QTY any more (that produced the phantom-pouch 0). SAFE FALLBACK: if
    // the engine has no row for this SKU, fall back to a local min over
    // CONSTRAINING rows only (still excludes cartons), then 0 — never NaN.
    const cwhFgRow = CWH_FG[s.code] || null;
    let producibleFG, bindingComponent;
    if (cwhFgRow && Number.isFinite(cwhFgRow.producible)) {
      producibleFG = Math.max(0, cwhFgRow.producible);
      bindingComponent = cwhFgRow.binding || null;
    } else if (!recipe || (sfg == null && rm == null)) {
      producibleFG = 0;
      bindingComponent = null;
    } else {
      // Untracked rows excluded — unknown stock can't bind (phantom-zero guard).
      const constrainingRows = [sfg, rm, ...pkgList].filter(r => r && r.constrains && !r.untracked);
      const caps = constrainingRows.map(r => r.capacityReal);
      producibleFG = caps.length ? Math.max(0, Math.min(...caps)) : 0;
      if (!isFinite(producibleFG)) producibleFG = 0;
      const bindRow = constrainingRows.find(r => r.capacityReal === producibleFG);
      bindingComponent = bindRow?.refCode || null;
    }

    const warehouseBreakdown = {
      fg:    ops.fg,
      kind:  recipe?.kind || null,
      inputs: {
        sfg,                 // null when SKU uses raw → pack direct
        rm,                  // null when SKU uses semi → pack
        pkg:    pkgList,     // 1..N components
      },
      // Legacy fields kept for backward compatibility with existing
      // Materials breakdown table + forecast / runway code that still
      // reads semiFg / rawMaterial / packaging directly. Eventually those
      // call sites should switch to `inputs.{sfg,rm,pkg}`.
      semiFg:       sfg?.qty ?? 0,
      rawMaterial:  rm?.qty ?? 0,
      // Legacy "packaging" scalar = the tightest CONSTRAINING pkg stock (D1:
      // cartons/air pouches excluded so they don't drag this to 0). Falls back
      // to the first pkg when none constrain.
      packaging:    (() => {
        const con = pkgList.filter(p => p.constrains);
        if (con.length) return Math.min(...con.map(p => p.qty));
        return pkgList.length ? Math.min(...pkgList.map(p => p.qty)) : 0;
      })(),
      perPacketRaw: (rm || sfg)?.perPack || 0.1,
      codes: {
        semiFg:      sfg?.refCode || null,
        rawMaterial: rm?.refCode  || null,
        packaging:   pkgList[0]?.refCode || null,
      },
      producibleFG,
      // D1 — authoritative binding component (engine-sourced; never a carton/air
      // pouch). The overlay re-affirms this from CWH_FG; set here too for SKUs
      // the engine doesn't cover.
      bindingComponent,
    };

    const total = totalStock.warehouse + totalStock.amazonFBA + totalStock.flipkart + totalStock.blinkit;

    // ── Per-channel velocity: real-first, stub fallback ──────────────
    // Where real export data is present we use it directly; otherwise we
    // fall back to the CHANNEL_MIX-derived stub. Sources:
    //   - Flipkart: real `sales30d` ÷ 30 (live 30-day average)
    //   - Blinkit:  real `totalSales30d` ÷ 30 (sum across feeder WHs)
    //   - Shopify:  real `sales30d` ÷ 30 (Shopify website CSV)
    //   - Amazon:   real `totalShippedToday` is one day's FBA customer
    //               shipments — used as a daily proxy. Multi-day ledger
    //               will firm this up.
    // The Amazon channel per AMZ-001 combines Amazon FBA + Shopify D2C,
    // so its velocity = Amazon daily + Shopify daily.
    const stubVel = ops.vel;
    const denomUnits = totalChUnits || 1;
    const stubChannelVelocity = {
      amazon:   stubVel * ((ch.amazon + ch.shopify) / denomUnits),
      flipkart: stubVel * (ch.flipkart / denomUnits),
      blinkit:  stubVel * (ch.blinkit  / denomUnits),
    };
    // ⚠️ Nitin's 72-day daily-movement velocity legs REMOVED (FIX-SPEC V9,
    // GROUND-TRUTH §3.5). That log is WAREHOUSE MOVEMENT (dominated by bulk
    // replenishment shipments to marketplace WHs), not SALES, so it must not
    // feed velocity / runway / growth / reorder. Velocity is now sales-only
    // (agency → native sales → shopify). The central-WH engine still owns the
    // physical FG count + producible + components.

    // Agency Channel-wise Sales Sheet — founder's truth-table source for
    // Amazon velocity + growth. Wins over every other Amazon-velocity
    // source when present. Captured per-channel so other channels can
    // optionally use it too if the native export is missing.
    const agencyCh = real.agency || null;
    const agencyAmazonDaily   = agencyCh?.amazon?.dailyOut;
    const agencyFlipkartDaily = agencyCh?.flipkart?.dailyOut;
    const agencyBlinkitDaily  = agencyCh?.blinkit?.dailyOut;
    const agencyShopifyDaily  = agencyCh?.shopify?.dailyOut;

    // Preference order for Amazon (per founder's truth table):
    //   1. Agency Channel-wise Sales Sheet (TOP) — `amazon` row dailyOut
    //   2. Amazon "Manage Orders" 32-day FBA daily (MCF intentionally excluded —
    //      MCF report is not part of this version's data feed, per founder)
    //   3. 1-day FBA ledger proxy
    //   (Nitin's 72-day movement avg REMOVED — it is warehouse movement, not
    //    sales; GROUND-TRUTH §3.5.)
    const orderDailyAmz = real.amazon?.orders
      ? (real.amazon.orders.dailyFba || 0)
      : null;

    // ── D5 — MAX(30-day rate, 14-day rate) per channel ────────────────
    // Velocity = MAX(sales30d/30, sales14d/14) so we plan for the HIGHER recent
    // demand (conservative — never under-stock). Blinkit uses its 15-day bucket
    // (sales15d/15) since the panel exposes 15d not 14d; the agency sheet is
    // also 15d. Where no short-window bucket is available we fall back to the
    // 30-day rate and FLAG it (velocityWindow.<ch> = "30d-only").
    // SAFE FALLBACK: every helper tolerates null/NaN and never emits NaN/Inf.
    const velFlag = {};   // ch → "max(30,14)" | "max(30,15)" | "30d-only"
    // Compute MAX(rate30, rateShort) given total units in each window.
    // shortDays is 14 or 15. Returns { daily, flag } or null when no 30d signal.
    const maxRate = (units30, unitsShort, shortDays, chKey) => {
      const has30 = Number.isFinite(units30);
      const hasShort = Number.isFinite(unitsShort) && shortDays > 0;
      if (!has30 && !hasShort) return null;
      const rate30 = has30 ? units30 / 30 : null;
      const rateShort = hasShort ? unitsShort / shortDays : null;
      if (rate30 != null && rateShort != null) {
        velFlag[chKey] = `max(30,${shortDays})`;
        return Math.max(rate30, rateShort);
      }
      // Only one window present → use it; flag when the short window is missing.
      if (rate30 != null) { velFlag[chKey] = "30d-only"; return rate30; }
      velFlag[chKey] = `${shortDays}d-only`;
      return rateShort;
    };

    // Amazon ORDERS leg (excludes website D2C — that's the shopify leg).
    // Agency exposes sales30d + sales15d; fall back to the orders-feed/ledger
    // daily proxies (single-window → 30d-only flag handled below).
    let realAmazonDaily;
    if (agencyCh?.amazon && (Number.isFinite(agencyCh.amazon.sales30d) || Number.isFinite(agencyCh.amazon.sales15d))) {
      realAmazonDaily = maxRate(agencyCh.amazon.sales30d, agencyCh.amazon.sales15d, 15, "amazon");
    } else {
      realAmazonDaily = agencyAmazonDaily ?? orderDailyAmz ?? real.amazon?.totalShippedToday ?? null;
      if (realAmazonDaily != null) velFlag.amazon = "30d-only";
    }
    // Shopify / website D2C leg. Native CSV has sales14d (live uploads) — use it
    // for max(30,14); bundled shopify has only 30d → 30d-only fallback.
    let realShopifyDaily;
    if (real.shopify && (Number.isFinite(real.shopify.sales30d) || Number.isFinite(real.shopify.sales14d))) {
      realShopifyDaily = maxRate(real.shopify.sales30d, real.shopify.sales14d, 14, "shopify");
    } else if (agencyCh?.shopify && (Number.isFinite(agencyCh.shopify.sales30d) || Number.isFinite(agencyCh.shopify.sales15d))) {
      realShopifyDaily = maxRate(agencyCh.shopify.sales30d, agencyCh.shopify.sales15d, 15, "shopify");
    } else {
      realShopifyDaily = agencyShopifyDaily ?? null;
      if (realShopifyDaily != null) velFlag.shopify = "30d-only";
    }
    // Flipkart leg. Native FK has sales14d; agency FK has sales15d.
    let realFlipkartDaily;
    if (real.flipkart && (Number.isFinite(real.flipkart.sales30d) || Number.isFinite(real.flipkart.sales14d))) {
      realFlipkartDaily = maxRate(real.flipkart.sales30d, real.flipkart.sales14d, 14, "flipkart");
    } else if (agencyCh?.flipkart && (Number.isFinite(agencyCh.flipkart.sales30d) || Number.isFinite(agencyCh.flipkart.sales15d))) {
      realFlipkartDaily = maxRate(agencyCh.flipkart.sales30d, agencyCh.flipkart.sales15d, 15, "flipkart");
    } else {
      realFlipkartDaily = agencyFlipkartDaily ?? null;
      if (realFlipkartDaily != null) velFlag.flipkart = "30d-only";
    }
    // Blinkit leg. Native panel = per-WH sales15d summed (blinkit total15d) for
    // max(30,15); agency blinkit has sales15d. Fall back to total30d/30.
    const blinkitTotal15d = (() => {
      const b = real.blinkit;
      if (!b) return null;
      if (Number.isFinite(b.totalSales15d)) return b.totalSales15d;
      // Aggregate per-WH sales15d when the total isn't precomputed.
      if (b.byWh && typeof b.byWh === "object") {
        let sum = 0, seen = false;
        for (const wh of Object.keys(b.byWh)) {
          const v = b.byWh[wh]?.sales15d;
          if (Number.isFinite(v)) { sum += v; seen = true; }
        }
        if (seen) return sum;
      }
      return null;
    })();
    let realBlinkitDaily;
    if (real.blinkit && (Number.isFinite(real.blinkit.totalSales30d) || Number.isFinite(blinkitTotal15d))) {
      realBlinkitDaily = maxRate(real.blinkit.totalSales30d, blinkitTotal15d, 15, "blinkit");
    } else if (agencyCh?.blinkit && (Number.isFinite(agencyCh.blinkit.sales30d) || Number.isFinite(agencyCh.blinkit.sales15d))) {
      realBlinkitDaily = maxRate(agencyCh.blinkit.sales30d, agencyCh.blinkit.sales15d, 15, "blinkit");
    } else {
      realBlinkitDaily = agencyBlinkitDaily ?? null;
      if (realBlinkitDaily != null) velFlag.blinkit = "30d-only";
    }
    // ⚠️ Nitin offline+marketing addend REMOVED (FIX-SPEC V9, GROUND-TRUTH
    // §3.5). It was warehouse movement, not sales, and inflated velocity by
    // up to ~36% on some SKUs. The minor direct-WH-sales leg is not isolable
    // from the current sales exports, so it is 0 (a SAFE finite default that
    // keeps the cascade math NaN-free); derive it from a real direct-WH-sales
    // export if one is added later.

    // For Amazon channel: combine real Amazon + real Shopify when either
    // has signal; otherwise fall back to the stub combined value.
    const hasAmazonSignal = realAmazonDaily != null || realShopifyDaily != null;
    const amazonChannelVel = hasAmazonSignal
      ? (realAmazonDaily ?? 0) + (realShopifyDaily ?? 0)
      : stubChannelVelocity.amazon;

    // Round to 1 decimal — velocity is a daily rate, more precision than
    // that is noise (and leaks ugly floats like 34.333333 into cards).
    const r1 = (n) => Math.round((n || 0) * 10) / 10;
    const channelVelocity = {
      amazon:   r1(amazonChannelVel),
      flipkart: r1(realFlipkartDaily ?? stubChannelVelocity.flipkart),
      blinkit:  r1(realBlinkitDaily  ?? stubChannelVelocity.blinkit),
    };
    // Which legs of the velocity come from real exports? UI exposes this.
    const velocitySource = {
      amazon:   real.amazon || real.shopify ? "real" : "stub",
      flipkart: real.flipkart ? "real"  : "stub",
      blinkit:  real.blinkit  ? "real"  : "stub",
    };
    // D5 — which window each channel's velocity used: "max(30,14)" / "max(30,15)"
    // / "30d-only" (short bucket unavailable → fell back to 30d, flagged). The
    // amazon channel is the Amazon-orders + Shopify-D2C fold, so we surface the
    // tighter (more-cautious) of the two legs' flags. SAFE: defaults to null.
    const velocityWindow = {
      amazon:   velFlag.shopify === "30d-only" || velFlag.amazon === "30d-only"
                  ? (velFlag.amazon || velFlag.shopify || null)
                  : (velFlag.amazon || velFlag.shopify || null),
      flipkart: velFlag.flipkart || null,
      blinkit:  velFlag.blinkit  || null,
      shopify:  velFlag.shopify  || null,
    };

    // Total velocity = sum of per-channel SALES velocities (GROUND-TRUTH §3.5).
    // Warehouse own (direct-WH) velocity is the MINOR direct-WH-sales leg only —
    // not isolable from current exports, so 0. It is NOT the stub channel-share
    // residual (that double-counted demand the marketplace legs already carry)
    // and NOT Nitin warehouse movement (removed). Kept as a finite SAFE default
    // so the cascade math is never NaN, and so total velocity == channel sales.
    const whBaseVelocity = 0;
    const channelTotalVel = channelVelocity.amazon + channelVelocity.flipkart + channelVelocity.blinkit;
    // If we have ANY real signal, trust the sum-of-channels. Otherwise keep ops.vel as before.
    const hasRealSignal = velocitySource.amazon === "real" || velocitySource.flipkart === "real" || velocitySource.blinkit === "real";
    const vel = r1(hasRealSignal ? channelTotalVel + whBaseVelocity : stubVel);

    const cascadeChannels = [
      { key: "amazon",   label: "Amazon FBA", stock: totalStock.amazonFBA, velocity: channelVelocity.amazon },
      { key: "flipkart", label: "Flipkart",   stock: totalStock.flipkart,  velocity: channelVelocity.flipkart },
      { key: "blinkit",  label: "Blinkit",    stock: totalStock.blinkit,   velocity: channelVelocity.blinkit  },
    ];

    // Total runway = cascade-aware: each channel drains at its own
    // velocity, central WH absorbs each channel's load as it dies, total
    // runway = day central WH itself hits zero. See lib/runwayCascade.js
    // for the model. We lazy-compute when the inventory is consumed (to
    // avoid pulling that module into data.js's load path), but expose
    // the inputs here.
    const runway = vel > 0 ? Math.round(total / vel) : 0;
    const runwayStatus = vel <= 0 ? "amber" : runway <= ops.leadTime ? "red" : runway < 30 ? "amber" : "green";
    const price = SKU_PRICE[s.code] || 500;

    // ── Splits: amount-of-units-per-channel-per-month ─────────────────
    // Used by the Simulator (per-marketplace inputs) + Action-needed
    // cell math. Express as units/30d so existing call sites that read
    // CHANNEL_MIX-style numbers continue to work. Real numbers replace
    // stub for any channel with real signal; the rest fall back to the
    // hardcoded May-2026 mix.
    // Splits express units/30d. We multiply the per-channel daily rate by 30
    // rather than reading `real.<channel>.<sales-field>` directly — because
    // `realFooDaily` may have come from the agency sheet's daily-out leg even
    // when the corresponding native marketplace export is null. Reading the
    // marketplace field unconditionally would crash for agency-only SKUs.
    const realSplits = {
      amazon:   realAmazonDaily   != null ? Math.round(realAmazonDaily   * 30) : ch.amazon,
      shopify:  realShopifyDaily  != null ? Math.round(realShopifyDaily  * 30) : ch.shopify,
      flipkart: realFlipkartDaily != null ? Math.round(realFlipkartDaily * 30) : ch.flipkart,
      blinkit:  realBlinkitDaily  != null ? Math.round(realBlinkitDaily  * 30) : ch.blinkit,
    };

    // ── Per-channel MoM growth ────────────────────────────────────────
    // Per founder's truth table, each channel reads its OWN 30d / 60d
    // sales from its OWN data source. Single SKU.growth value was wrong
    // — it was leaking the Amazon-agency number into every cell.
    //
    // Sources (matches velocity precedence, but only the sources that
    // actually expose both 30d AND 60d aging buckets are eligible):
    //   Amazon channel  → Agency AMZ tab. Falls back to Shopify-derived
    //                     (since AMZ-001 fold gives us shopify 30d/60d).
    //   Shopify D2C     → Shopify CSV sales30d / sales60d.
    //   Flipkart        → Flipkart Seller Hub sales30d / sales60d
    //                     (or Agency FK tab if Hub missing).
    //   Blinkit         → ONLY Agency Blinkit tab (native Seller Panel
    //                     has no sales60d). Returns null if no agency.
    //   Central WH      → aggregate cumulative: sum all channels'
    //                     sales30d vs sum of all channels' prior30.
    //
    // Returns null when there's no data signal — UI shows "—" instead
    // of a stale stub (per founder: honest > silent fakery).
    const clamp = (v) => Math.max(GROWTH_FLOOR, Math.min(GROWTH_CAP, v));
    const growthFromBuckets = (cur30, prev30) => {
      if (cur30 == null && prev30 == null) return null;
      const c = cur30 || 0, p = prev30 || 0;
      if (c === 0 && p === 0) return null;
      if (p === 0 && c > 0)  return GROWTH_CAP;   // zero-baseline → cap at +75% (M5)
      if (c === 0 && p > 0)  return -100;  // stopped
      if (p > 0)             return clamp(((c - p) / p) * 100);
      return null; // negative prior (heavy returns) — undefined growth
    };

    // Pull 30d/60d per channel with precedence.
    const flipkartCur30 = real.flipkart?.sales30d ?? agencyCh?.flipkart?.sales30d ?? null;
    const flipkartCur60 = real.flipkart?.sales60d ?? agencyCh?.flipkart?.sales60d ?? null;
    const flipkartPrev30 = (flipkartCur60 != null && flipkartCur30 != null) ? (flipkartCur60 - flipkartCur30) : null;

    const shopifyCur30 = real.shopify?.sales30d ?? agencyCh?.shopify?.sales30d ?? null;
    const shopifyCur60 = real.shopify?.sales60d ?? agencyCh?.shopify?.sales60d ?? null;
    const shopifyPrev30 = (shopifyCur60 != null && shopifyCur30 != null) ? (shopifyCur60 - shopifyCur30) : null;

    // Amazon (orders-only, before AMZ-001 fold). Agency is the only source
    // with both 30d + 60d for the Amazon channel orders side.
    const amzOrdersCur30  = agencyCh?.amazon?.sales30d ?? null;
    const amzOrdersCur60  = agencyCh?.amazon?.sales60d ?? null;
    const amzOrdersPrev30 = (amzOrdersCur60 != null && amzOrdersCur30 != null) ? (amzOrdersCur60 - amzOrdersCur30) : null;

    // Blinkit — agency tab only (native lacks sales60d).
    const blkCur30  = agencyCh?.blinkit?.sales30d ?? null;
    const blkCur60  = agencyCh?.blinkit?.sales60d ?? null;
    const blkPrev30 = (blkCur60 != null && blkCur30 != null) ? (blkCur60 - blkCur30) : null;

    // Channel-level growths.
    // Amazon channel = AMZ-001 fold: amz orders + shopify D2C. Combine the
    // 30d / 60d from each side, then derive growth from the combined totals.
    const amzChannelCur30 = (amzOrdersCur30 != null || shopifyCur30 != null)
      ? (amzOrdersCur30 ?? 0) + (shopifyCur30 ?? 0)
      : null;
    const amzChannelPrev30 = (amzOrdersPrev30 != null || shopifyPrev30 != null)
      ? (amzOrdersPrev30 ?? 0) + (shopifyPrev30 ?? 0)
      : null;

    // ── MAX-MoM monthly ladders (founder rule, 2026-06) ───────────────
    // Prefer each channel's own monthly sales array (trailing-30d sums,
    // MOST-RECENT FIRST) emitted by the parsers:
    //   - agency daily-log → real.agency.<channel>.monthly (up to 4 months)
    //   - shopify CSV      → real.shopify.monthly (3 months)
    // maxMoMGrowth() returns the MAX consecutive MoM rate (plan for peak
    // growth → don't under-stock); null when <2 usable months, in which case
    // we fall back to the existing single-MoM (growthFromBuckets) so nothing
    // breaks when monthly data is absent. The Amazon channel folds Shopify
    // D2C (AMZ-001): we sum the two monthly ladders element-wise when present.
    const amzMonthly = (agencyCh?.amazon?.monthly && Array.isArray(agencyCh.amazon.monthly))
      ? agencyCh.amazon.monthly : null;
    const shopifyMonthly = (real.shopify?.monthly && Array.isArray(real.shopify.monthly))
      ? real.shopify.monthly
      : (agencyCh?.shopify?.monthly && Array.isArray(agencyCh.shopify.monthly) ? agencyCh.shopify.monthly : null);
    const flipkartMonthly = (agencyCh?.flipkart?.monthly && Array.isArray(agencyCh.flipkart.monthly))
      ? agencyCh.flipkart.monthly : null;
    const blinkitMonthly = (agencyCh?.blinkit?.monthly && Array.isArray(agencyCh.blinkit.monthly))
      ? agencyCh.blinkit.monthly : null;
    // Element-wise sum of monthly ladders (most-recent-first aligned). Used for
    // the Amazon=amz+shopify fold and the warehouse=Σ-channels aggregate. SAFE
    // FALLBACK: ignores non-arrays; returns null when no usable array given.
    const sumMonthly = (...arrs) => {
      const valid = arrs.filter(a => Array.isArray(a) && a.length);
      if (!valid.length) return null;
      const len = Math.max(...valid.map(a => a.length));
      const out = [];
      for (let i = 0; i < len; i++) {
        let acc = 0, seen = false;
        for (const a of valid) {
          const v = a[i];
          if (Number.isFinite(v)) { acc += v; seen = true; }
        }
        out.push(seen ? acc : null);
      }
      return out;
    };
    const amzChannelMonthly = sumMonthly(amzMonthly, shopifyMonthly);

    const channelGrowth = {
      // Prefer MAX-MoM from the channel's monthly ladder; fall back to the
      // existing single-MoM number when <2 usable months are available.
      amazon:   maxMoMGrowth(amzChannelMonthly) ?? growthFromBuckets(amzChannelCur30,  amzChannelPrev30),
      flipkart: maxMoMGrowth(flipkartMonthly)   ?? growthFromBuckets(flipkartCur30,    flipkartPrev30),
      blinkit:  maxMoMGrowth(blinkitMonthly)    ?? growthFromBuckets(blkCur30,         blkPrev30),
      shopify:  maxMoMGrowth(shopifyMonthly)    ?? growthFromBuckets(shopifyCur30,     shopifyPrev30),
    };

    // Central WH growth = MAX-MoM of the SUMMED monthly demand across channels
    // (per founder). Falls back to the cumulative single-MoM when monthly
    // ladders are absent, then to null when there's no signal at all.
    const whMonthly = sumMonthly(amzMonthly, shopifyMonthly, flipkartMonthly, blinkitMonthly);
    const allCur30 = (amzOrdersCur30 ?? 0) + (shopifyCur30 ?? 0) + (flipkartCur30 ?? 0) + (blkCur30 ?? 0);
    const allPrev30 = (amzOrdersPrev30 ?? 0) + (shopifyPrev30 ?? 0) + (flipkartPrev30 ?? 0) + (blkPrev30 ?? 0);
    const anyData = [amzOrdersCur30, shopifyCur30, flipkartCur30, blkCur30].some(x => x != null);
    channelGrowth.warehouse = maxMoMGrowth(whMonthly)
      ?? (anyData ? growthFromBuckets(allCur30, allPrev30) : null);

    // Round each to 1 decimal for display.
    for (const k of Object.keys(channelGrowth)) {
      if (channelGrowth[k] != null) channelGrowth[k] = r1(channelGrowth[k]);
    }

    // sku.growth (the legacy single value) = central-WH aggregate. This
    // is what Simulator/Forecast/cascade still read. Falls back to the
    // old Shopify-derived → stub chain when no aggregate signal.
    let derivedGrowth = channelGrowth.warehouse ?? channelGrowth.amazon ?? channelGrowth.shopify ?? MOM_GROWTH[s.code] ?? 0;
    derivedGrowth = r1(derivedGrowth);

    return {
      ...s,
      velocity:    vel,
      growth:      derivedGrowth,
      splits:      realSplits,
      // Per-channel velocities and a pre-built cascade input set.
      // channelVelocity.amazon already includes Shopify (folded per AMZ-001).
      channelVelocity,
      // Per-channel MoM growth — derived from each channel's own 30d/60d
      // aging buckets. `.warehouse` is the cumulative aggregate. null
      // means "no data signal" — UI must show "—" not a stale stub.
      channelGrowth,
      // Per-channel "real | stub" marker — set when we substituted real
      // export data into the velocity. UI uses this to show provenance.
      velocitySource,
      // D5 — which window drove each channel's velocity (max(30,14)/max(30,15)/
      // 30d-only). UI can flag SKUs where the short bucket was unavailable.
      velocityWindow,
      cascade: {
        whStock:       ops.fg,
        whBaseVelocity,
        channels:      cascadeChannels,
      },
      marketplaceNames: MARKETPLACE_NAMES[s.code] || { amazon: null, flipkart: null, blinkit: null, shopify: null },
      // Per-SKU Blinkit feeder-warehouse map (real data from DATA-001 export
      // when available; empty `ever` list for SKUs not yet launched on Blinkit).
      blinkitFeeders: buildBlinkitFeeders(s.code),
      // Mirror of the real-export numbers so cell drill modals can show
      // damaged / disposed / per-WH velocity etc. directly.
      realData:    REAL_MARKETPLACE_DATA[s.code] || null,
      stockSource,
      leadTime:    ops.leadTime,
      stock:       totalStock,
      warehouseBreakdown,
      totalStock:  total,
      runway,
      runwayStatus,
      stockValue:  total * price,
      // Founder-provided pricing (DATA-004). pricing.sp is the realised
      // selling price (matches what we book in stockValue); pricing.mrp is
      // the list price. Two SKUs (Berry Oil 15/30) have sp=null because
      // SP is TBD — UI should fall back to MRP for those.
      pricing:     SKU_PRICING[s.code] || { sp: price, mrp: price },
    };
  });

  // ── M3 — CONSTRAINED ALLOCATION of shared inputs across SKUs ───────────────
  // The engine's producible is a per-SKU MAX: each SKU independently claims
  // floor(componentStock / perPack). When SKUs share a physical pool (Moringa
  // raw NSMLPR feeds NSMP100 AND NSMP250; SB powder raw feeds 3 SKUs; juice pulp
  // feeds 2; face-oil raw feeds 2), those claims OVERLAP — the reported
  // producibles aren't simultaneously achievable (NSMP100 1000 + NSMP250 400
  // would need 200 kg from a 100 kg pool). Founder ruling M3: allocate each
  // shared constraining input across its consuming SKUs BY DEMAND SHARE (sales
  // velocity × per-pack draw), then producible = min over the SKU's allocated
  // component caps. Non-shared components are unchanged (single consumer → full
  // pool). Uses the COMPLETE BOM from SKU_RECIPE (incl. juice tube/label), which
  // also closes the engine's juice-BOM gap (M8). Velocity lives at THIS layer
  // (the engine has no sales signal), so the allocation must happen here.
  const allocatedProducible = {};
  {
    const velByCode = Object.fromEntries(inv0.map((s) => [s.code, Math.max(0, s.velocity || 0)]));
    // CONSTRAINING component ref → [{ code, perPack }] consuming it
    const consumers = {};
    for (const s of inv0) {
      const wb = s.warehouseBreakdown || {};
      const rows = [wb.inputs?.sfg, wb.inputs?.rm, ...(wb.inputs?.pkg || [])].filter(Boolean);
      for (const r of rows) {
        if (!r.constrains) continue;                          // outer cartons never bind
        if (r.untracked) continue;                            // unknown stock can't bind (phantom-zero guard)
        const perPack = r.perPack ?? r.unitsPerPack ?? 0;
        if (!(perPack > 0)) continue;
        (consumers[r.refCode] ||= []).push({ code: s.code, perPack });
      }
    }
    // allocated pack-equivalent cap per (code, ref)
    const capByCode = {};
    for (const [ref, list] of Object.entries(consumers)) {
      const stock = Math.max(0, compStock(ref));
      if (list.length === 1) {                                // sole consumer → full pool
        const { code, perPack } = list[0];
        (capByCode[code] ||= {})[ref] = Math.floor(stock / perPack);
        continue;
      }
      // SHARED pool → split by demand weight = velocity × perPack (units of the
      // shared input drawn per day). No demand anywhere → equal split.
      const weights = list.map(({ code, perPack }) => Math.max(0, (velByCode[code] || 0) * perPack));
      const totalW = weights.reduce((a, b) => a + b, 0);
      list.forEach(({ code, perPack }, i) => {
        const share = totalW > 0 ? weights[i] / totalW : 1 / list.length;
        (capByCode[code] ||= {})[ref] = Math.floor((stock * share) / perPack);
      });
    }
    // producible per SKU = min over its constraining allocated caps; annotate
    // the breakdown rows so the Materials tab shows the realistic (allocated)
    // capacity + a "shared" marker instead of an overlapping total.
    for (const s of inv0) {
      const caps = capByCode[s.code] || {};
      const refs = Object.keys(caps);
      let min = Infinity, binding = null;
      for (const ref of refs) { if (caps[ref] < min) { min = caps[ref]; binding = ref; } }
      const producible = Math.max(0, Number.isFinite(min) ? min : 0);
      allocatedProducible[s.code] = { producible, binding, caps };
      const wb = s.warehouseBreakdown;
      if (wb) {
        wb.producibleFG = producible;
        wb.bindingComponent = binding;
        const rows = [wb.inputs?.sfg, wb.inputs?.rm, ...(wb.inputs?.pkg || [])].filter(Boolean);
        for (const r of rows) {
          if (caps[r.refCode] == null) continue;
          const isShared = (consumers[r.refCode] || []).length > 1;
          r.shared = isShared;
          if (isShared) {
            r.sharedWith = (consumers[r.refCode] || []).map((c) => c.code).filter((c) => c !== s.code);
            r.fullCapacity = r.capacityReal;                  // un-allocated, for reference
            r.capacity = caps[r.refCode];                     // realistic allocated cap
            r.capacityReal = caps[r.refCode];
          }
        }
      }
    }
  }

  const inventory = inv0.map((sku) => {
    // ── CENTRAL WH OVERLAY — apply numbers from the build-central-wh
    //    engine (rolls forward from the 5-May audit + Production matrix +
    //    Daily Movement of FG). Per spec docs/central-wh-spec.md, these
    //    are the authoritative numbers for Central WH; marketplace cells
    //    keep their own per-channel sources (Agency / Shopify / FK Hub).
    const cwh = CWH_FG[sku.code];
    if (!cwh) return sku;
    // r1 is local to the previous .map() callback scope — redeclare here.
    // (The crash this caused turned the whole Inventory page white.)
    const r1 = (n) => Math.round((n || 0) * 10) / 10;
    // Total company SALES velocity = sum of per-channel sales velocities
    // (channelVelocity.amazon already folds website D2C per R-FBA). This is
    // what the WH buffer actually drains at — NOT warehouse movement.
    const cv = sku.channelVelocity || {};
    const totalSalesVel = (cv.amazon || 0) + (cv.flipkart || 0) + (cv.blinkit || 0);
    // M3 allocation result for this SKU (constrained, non-overlapping producible).
    // SAFE FALLBACK to the engine's value if the allocation pass somehow missed it.
    const alloc = allocatedProducible[sku.code]
      || { producible: Math.max(0, cwh.producible || 0), binding: cwh.binding || null };

    const next = {
      ...sku,
      // Stock pool: replace warehouse-direct with audited FG; per-WH/per-FC
      // marketplace stocks (amazonFBA, flipkart.live, blinkit feeders) are
      // untouched — they come from their own exports.
      stock: { ...sku.stock, warehouse: cwh.fgStock },
      // Builder block — feeds the Materials breakdown popover. producibleFG /
      // bindingComponent come from the M3 constrained allocation (already
      // written onto sku.warehouseBreakdown), NOT the engine's overlapping
      // per-SKU max — so shared-raw SKUs don't double-claim the same pool.
      warehouseBreakdown: {
        ...sku.warehouseBreakdown,
        fg: cwh.fgStock,
        oldStock: cwh.oldStock || 0,   // shown in modal, excluded from runway
        producibleFG: alloc.producible,
        bindingComponent: alloc.binding,
        bindingMissing: alloc.binding && CWH_COMP[alloc.binding]?.stock === 0,
      },
      // Old (non-fresh) FG — surfaced in the material-breakdown modal.
      centralWhOldStock: cwh.oldStock || 0,
      // Central WH-specific fields the cell + drill modal read directly
      // (kept separate from per-channel velocity/growth so each cell
      // displays its own source).
      //
      // ── CORRECTED METRIC MODEL (founder, 2026-06) ──────────────
      // Consumption = SALES, not warehouse movement. The engine's
      // depletion30 (FG movement out of the WH) is dominated by bulk
      // replenishment shipments to marketplace WHs and MISREPRESENTS
      // consumption — so it is NO LONGER used for velocity / runway /
      // reorder anywhere. The engine roll-forward is kept ONLY for the
      // physical FG count (cwh.fgStock), producible, and components.
      //
      // Central-WH velocity = TOTAL company SALES velocity = the sum of
      // the per-channel sales velocities (channelVelocity is already
      // sales-derived; amazon leg already folds website D2C per R-FBA).
      // The WH ultimately supplies all channels, so its buffer drains at
      // total demand.
      centralWhVelocity: r1(totalSalesVel),
      centralWhSalesVel: r1(totalSalesVel),
      centralWhGrowth:   sku.channelGrowth?.warehouse ?? null,   // sales-based aggregate MoM
      centralWhBinding:  cwh.binding,
      centralWhWorstCover: cwh.worstCoverDays,
      // Lead time from the spec = max component lead in BOM.
      leadTime: cwh.leadDays ?? sku.leadTime,
      // FG-only stock value (WH finished goods × SP). The HEADLINE total
      // value is summed at the UI from each location's units × SP.
      stockValue: cwh.stockValue,
    };
    // Recompute totalStock using the new WH stock.
    next.totalStock = (next.stock.warehouse || 0) + (next.stock.amazonFBA || 0)
                    + (next.stock.flipkart  || 0) + (next.stock.blinkit    || 0);
    // ── M1/M2 — HEADLINE central-WH runway = NETWORK CASCADE ──────────────────
    // Sellable cover = FG + producible (what we can ship OR pack now, M2). The
    // headline runway is the parallel cascade (lib/runwayCascade.js): each
    // marketplace drains its OWN buffer at its sales velocity first; as channels
    // die their demand falls back to the central WH; total runway = the day the
    // WH itself hits zero. This replaces the old flat "FG ÷ Σ all-channel
    // velocity", which assumed the WH served 100% of every channel's demand from
    // day 0 (double-counting the buffers the marketplaces already hold) and so
    // flagged network-healthy SKUs RED. whBaseVelocity stays 0 (the minor
    // direct-WH-sales lane isn't cleanly isolable from the exports without
    // double-counting the website demand already folded into the Amazon channel
    // — see M6 note in docs/CHANGE-LOG; revisit if a clean direct lane lands).
    const freshSellable = (cwh.fgStock || 0) + alloc.producible;
    const oldUnits = next.centralWhOldStock || 0;
    // M4 (founder clarification, 2026-06) — a SKU whose FRESH stock is gone but
    // whose OLD stock is still ACTIVELY SELLING is NOT dead/discontinued: those
    // old batches are the live inventory and the line WILL be restocked (e.g. the
    // dry-berries — selling old stock now, fresh berries on order later). So count
    // the old stock as the available WH cover here, so runway + reorder are REAL
    // and the founder gets a timely reorder alert. (The general "old excluded from
    // runway/producible/value-only" rule still holds for SKUs that have fresh
    // stock, or have old stock but NO demand — genuinely dead stock.)
    const oldStockSelling = freshSellable <= 0 && oldUnits > 0 && totalSalesVel > 0;
    next.oldStockSelling = oldStockSelling;
    const cwhSellable = freshSellable > 0
      ? freshSellable
      : (oldStockSelling ? oldUnits : freshSellable);
    const cascadeHeadline = computeCascade({
      whStock: cwhSellable,
      whBaseVelocity: 0,
      channels: (sku.cascade?.channels || []).map((c) => ({ ...c })),
    });
    // Keep the cascade inputs the RunwayTab / Simulator read consistent with the
    // headline (real WH sellable stock, not the ops.fg stub used before overlay).
    next.cascade = { whStock: cwhSellable, whBaseVelocity: 0, channels: sku.cascade?.channels || [] };
    // M7 — the flat "WH-only" number kept as a labelled worst-case line
    // (what the runway would be if every marketplace vanished and the WH alone
    // served all demand). NOT the headline.
    next.centralWhRunwayWhOnly = totalSalesVel > 0
      ? Math.round(cwhSellable / totalSalesVel)
      : null;
    // Headline: finite cascade → round it; Infinite (no demand) with stock →
    // null ("no sales signal" → amber); no sellable stock → 0 (red).
    next.centralWhRunway = Number.isFinite(cascadeHeadline.totalRunway)
      ? Math.round(cascadeHeadline.totalRunway)
      : (cwhSellable <= 0 ? 0 : null);
    next.runway = next.centralWhRunway;
    // Status — HARD zero-sellable guard first (fixes the green-stockout bug R7),
    // then thresholds against the NETWORK runway, amber from the tunable param.
    const amberDays = readParam("amberRunwayDays") || 30;
    next.runwayStatus =
        cwhSellable <= 0 ? "red"
      : next.centralWhRunway == null ? "amber"          // stock but no sales signal
      : next.centralWhRunway <= next.leadTime ? "red"
      : next.centralWhRunway < amberDays ? "amber"
      : "green";
    // ISSUE 3 (verification) — a SKU that CANNOT be replenished right now
    // (producible 0 — its raw/SFG is exhausted) whose WH-ONLY cover is already
    // below the lead time is genuinely at risk even when the network cascade
    // looks healthy: its marketplace buffers mask a warehouse that can't be
    // refilled. Don't let it read green — escalate to amber (watch) and flag it
    // so the UI can caption "can't replenish · WH cover below lead". The raw/SFG
    // PO itself is surfaced separately on the component-reorder tab. Excludes
    // old-stock-selling SKUs (already red + reorder + their own caption).
    next.thinUnmakeable =
      alloc.producible <= 0
      && next.centralWhRunwayWhOnly != null
      && next.centralWhRunwayWhOnly <= next.leadTime;
    if (next.thinUnmakeable && next.runwayStatus === "green") next.runwayStatus = "amber";
    // Reorder = out of sellable cover OR network runway shorter than the
    // replenishment lead time. Old-stock-selling SKUs reorder normally (founder:
    // they ARE being restocked). Raw-PO timing also lives on the component tab.
    next.reorder =
      cwhSellable <= 0
      || (next.centralWhRunway != null && next.centralWhRunway <= next.leadTime);
    // M5 — flag when the forward growth used for reorder/forecast hit the +75%
    // cap, so the UI can explain why (the peak-window velocity is already
    // aggressive; the growth uplift is capped to avoid double-counting the same
    // surge). growthCap exposed for the note text.
    next.growthCap = GROWTH_CAP;
    next.growthCapped = (() => {
      const g = sku.channelGrowth?.warehouse ?? sku.growth ?? 0;
      return Number.isFinite(g) && g >= GROWTH_CAP;
    })();

    // ── D4 — per-SKU TOTAL stock value (all locations × SP, each unit once) ──
    // stockValue stays FG-only (WH finished goods × SP) per spec; totalValue is
    // the all-locations roll-up the headline card sums: WH new + WH old +
    // Amazon FBA + Flipkart + Blinkit, each counted ONCE (FK is a physically
    // separate pool — no double-count with WH). oldStockValue is the WH old-
    // stock line (counted in totalValue, EXCLUDED from runway). SP basis =
    // pricing.sp, MRP fallback for the two TBD SKUs. SAFE FALLBACK: every term
    // coerces to 0, so a missing field can never NaN the dashboard total.
    const spUnit = sku.pricing?.sp ?? sku.pricing?.mrp ?? 500;
    const whNewUnits = next.stock.warehouse || 0;
    const whOldUnits = next.centralWhOldStock || 0;
    const allLocationUnits = whNewUnits + whOldUnits
                           + (next.stock.amazonFBA || 0)
                           + (next.stock.flipkart  || 0)
                           + (next.stock.blinkit   || 0);
    next.totalValue    = allLocationUnits * spUnit;   // all locations × SP
    next.oldStockValue = whOldUnits * spUnit;          // WH old-stock value line
    next.allLocationUnits = allLocationUnits;          // exposed for UI sums
    return next;
  }).map((sku) => {
    // ── FINAL STEP — apply per-SKU overrides from Formulas tab ──
    // For each override field set in localStorage, replace the derived
    // value. Recompute downstream values (runway, runwayStatus, totalStock,
    // stockValue) so the rest of the dashboard stays consistent.
    const ov = __overrideMap[sku.code];
    if (!ov) return sku;

    const next = { ...sku, stock: { ...sku.stock } };
    if (ov.velocity != null)      next.velocity = ov.velocity;
    if (ov.growth != null)        next.growth   = ov.growth;
    if (ov.leadTime != null)      next.leadTime = ov.leadTime;
    if (ov.whStock != null)       next.stock.warehouse = ov.whStock;
    if (ov.amazonStock != null)   next.stock.amazonFBA = ov.amazonStock;
    if (ov.flipkartStock != null) next.stock.flipkart  = ov.flipkartStock;
    if (ov.blinkitStock != null)  next.stock.blinkit   = ov.blinkitStock;

    // Recompute totals + runway if any stock or velocity was overridden.
    const stockTouched = ["whStock","amazonStock","flipkartStock","blinkitStock"].some(k => ov[k] != null);
    if (stockTouched || ov.velocity != null) {
      next.totalStock = (next.stock.warehouse || 0) + (next.stock.amazonFBA || 0)
                      + (next.stock.flipkart  || 0) + (next.stock.blinkit    || 0);
      next.runway = next.velocity > 0 ? Math.round(next.totalStock / next.velocity) : 0;
      next.runwayStatus = next.velocity <= 0 ? "amber"
        : next.runway <= next.leadTime ? "red"
        : next.runway < 30 ? "amber" : "green";
      // D4 — keep stockValue FG-ONLY (WH finished goods × SP) even after an
      // override (the prior code flipped it to total-basis, double-meaning the
      // field and inflating at-risk value — AUDIT CWH-13). totalValue carries
      // the all-locations roll-up instead.
      const px = sku.pricing?.sp ?? sku.pricing?.mrp ?? 500;
      next.stockValue = (next.stock.warehouse || 0) * px;
      const whOldUnits = next.centralWhOldStock || 0;
      next.allLocationUnits = next.totalStock + whOldUnits;
      next.totalValue = next.allLocationUnits * px;
      next.oldStockValue = whOldUnits * px;
    }
    next.__hasOverrides = Object.keys(ov);
    return next;
  });

  // Reverse-lookup: for any refCode (e.g. "NSPKGCB100"), which SKUs use it?
  // Powers the popover "click PKGn → see other SKUs sharing this component".
  const itemUsedBy = (() => {
    const map = {};
    for (const sku of inventory) {
      const wb = sku.warehouseBreakdown;
      const refs = [wb.inputs.sfg?.refCode, wb.inputs.rm?.refCode, ...wb.inputs.pkg.map(p => p.refCode)]
        .filter(Boolean);
      for (const ref of refs) {
        if (!map[ref]) map[ref] = [];
        if (!map[ref].includes(sku.code)) map[ref].push(sku.code);
      }
    }
    return map;
  })();

  // ── Sales-based component consumption (GROUND-TRUTH §3.5 / D5) ──────────────
  // The central-WH ENGINE computes component consumption from Daily-Movement FG
  // "stock-out" over the tiny post-audit window — that is WAREHOUSE MOVEMENT
  // (bulk replenishment shipments to FBA/FBF/feeders), NOT sales. §3.5 is
  // explicit: consumption = SALES, never warehouse movement. Using the engine's
  // value here produced spurious component reorder alarms (e.g. SB raw 34d <50d
  // lead → "reorder now"; SB-500 pouch 4d <14d) and even NEGATIVE consumption
  // (returns > ship-outs in a 2-day window).
  //
  // Correct model: a component drains at the rate the FG that consume it SELL.
  //   consumption[ref] = Σ over SKUs using ref of (sku.velocity × perUnit)
  // where `sku.velocity` is the sales-based total velocity from data.js and
  // `perUnit` is how many units of `ref` go into ONE FG pack (raw KG/Ltr via
  // input.perPack; packaging via pkg[].unitsPerPack).
  //
  // SAFE FALLBACK: missing recipe / velocity → 0; never NaN. Clamped ≥0 so a
  // returns-heavy net-negative velocity never yields negative consumption.
  const componentSalesConsumption = (() => {
    const cons = {};                       // refCode → units/day consumed by sales
    const velByCode = {};
    for (const s of inventory) {
      velByCode[s.code] = Number.isFinite(s.velocity) ? Math.max(0, s.velocity) : 0;
    }
    for (const [skuCode, recipe] of Object.entries(SKU_RECIPE)) {
      const vel = velByCode[skuCode] || 0;
      if (vel <= 0) continue;
      // Raw / semi-finished input.
      const inp = recipe.input;
      if (inp?.refCode && Number.isFinite(inp.perPack)) {
        cons[inp.refCode] = (cons[inp.refCode] || 0) + vel * inp.perPack;
      }
      // Packaging components.
      for (const p of (recipe.pkg || [])) {
        if (!p?.refCode) continue;
        const per = Number.isFinite(p.unitsPerPack) ? p.unitsPerPack : 1;
        cons[p.refCode] = (cons[p.refCode] || 0) + vel * per;
      }
    }
    return cons;
  })();

  // ── D6 — Per-component reorder coverage (raw materials + primary packaging) ──
  // Exposed on NSData so the UI can render component reorder DATES alongside FG.
  // Each entry mirrors the engine component row + a computed reorder horizon:
  //   reorderByDays = daysCover − leadDays  → days from as-of until the latest
  //   safe order date for that component (NEGATIVE = overdue). When daysCover is
  //   null (no consumption signal) the component isn't draining → no reorder
  //   pressure → reorderByDays = null.
  // Stock is the engine's deplete-only balance (D8). Old component stock is
  // already folded into the engine balance, so it's reflected in `stock`.
  // SAFE FALLBACK: tolerates a missing/partial engine payload → [].
  const centralWhComponents = (() => {
    try {
      const asOf = CWH_SRC?.asOf || CWH_SRC?.anchorDate || null;
      // Sales-based per-SKU velocity, for deriving which SKUs a low component
      // blocks (mirrors the engine `blocks` logic but on the SALES daysCover).
      const velByCode = {};
      for (const s of inventory) velByCode[s.code] = Number.isFinite(s.velocity) ? Math.max(0, s.velocity) : 0;
      return Object.values(CWH_COMP || {})
        .filter(c => c && c.ref)
        .map(c => {
          const stock = Number.isFinite(c.stock) ? c.stock : 0;
          const leadDays = Number.isFinite(c.leadDays) ? c.leadDays : null;
          // §3.5: consumption = SALES-based (Σ sku.velocity × perUnit), NOT the
          // engine's Daily-Movement value. Clamp ≥0 (a net-negative velocity
          // never yields negative consumption — P2-3). 0 consumption → not
          // draining → daysCover null → no reorder pressure.
          const salesCons = componentSalesConsumption[c.ref];
          const consumption = Number.isFinite(salesCons) ? Math.max(0, salesCons) : 0;
          // Pass 4 — untracked (no audit line): stock is UNKNOWN, not zero. No
          // cover / reorder pressure can be derived; surfaced as "untracked" in
          // the UI + DQ flags so the founder adds an audit row.
          const untracked = c.untracked === true || UNTRACKED.has(c.ref);
          const daysCover = !untracked && consumption > 0 ? Math.round(stock / consumption) : null;
          // D6: reorder when sales-based cover < own lead time. Kept for ALL
          // components incl. non-constraining (you still reorder cartons).
          const reorder = daysCover != null && leadDays != null && daysCover < leadDays;
          const reorderByDays = (daysCover != null && leadDays != null)
            ? daysCover - leadDays
            : null;
          // Suggested order quantity — how much to order NOW to hold cover
          // through one replenishment cycle + a 30-day buffer at the current
          // sales-based consumption: ceil(consumption × (lead + 30) − stock),
          // floored at 0. null when not draining / untracked (no basis).
          const suggestedQty = (!untracked && consumption > 0 && leadDays != null)
            ? Math.max(0, Math.ceil(consumption * (leadDays + 30) - stock))
            : null;
          const constrains = c.constrains !== false;   // D1 flag
          // Which SKUs does this CONSTRAINING component block? A SKU where this
          // is the binding component, OR where sales-based cover < that SKU's
          // lead time (recomputed on the sales basis — the engine `blocks` used
          // the movement basis). Non-constraining never blocks (D1).
          let blocks = [];
          if (constrains) {
            for (const skuCode of (itemUsedBy[c.ref] || [])) {
              const inv = inventory.find(x => x.code === skuCode);
              const skuLead = inv && Number.isFinite(inv.leadTime) ? inv.leadTime : null;
              const isBinding = CWH_FG[skuCode]?.binding === c.ref;
              if (isBinding || (daysCover != null && skuLead != null && daysCover < skuLead)) {
                blocks.push(skuCode);
              }
            }
          }
          return {
            ref: c.ref,
            name: c.name ?? c.ref,
            type: c.type ?? null,           // RM | SFG | PKG
            unit: c.unit ?? null,
            stock,
            oldStock: Number.isFinite(c.oldStock) ? c.oldStock : 0,
            consumption: +consumption.toFixed(3),
            daysCover,
            leadDays,
            reorder,
            reorderByDays,
            suggestedQty,                  // order now to cover lead + 30d buffer
            untracked,                     // no audit line — stock unknown ≠ 0
            // Reorder date (ISO, as-of + reorderByDays). null when no signal or
            // as-of is unknown. Negative reorderByDays → a past date (overdue).
            reorderDate: (reorderByDays != null && asOf)
              ? (() => {
                  const d = new Date(asOf + "T00:00:00Z");
                  if (isNaN(d.getTime())) return null;
                  d.setUTCDate(d.getUTCDate() + reorderByDays);
                  return d.toISOString().slice(0, 10);
                })()
              : null,
            constrains,
            blocks,
            usedBy: itemUsedBy[c.ref] || [],
          };
        })
        .sort((a, b) => {
          // Most-urgent first: overdue/low reorderByDays at the top, nulls last.
          const av = a.reorderByDays == null ? Infinity : a.reorderByDays;
          const bv = b.reorderByDays == null ? Infinity : b.reorderByDays;
          return av - bv;
        });
    } catch {
      return [];   // SAFE FALLBACK — never break the page on a bad payload
    }
  })();

  // ── Batches ───────────────────────────────────────────
  const batches = [
    { id: "B-2503-MOR-1", sku: "NSMP250",   mfg: "Mar 2026", exp: "Mar 2028", units: 100,  loc: "Central warehouse", risk: "green" },
    { id: "B-2502-SBP-1", sku: "NSSB250",   mfg: "Feb 2026", exp: "Aug 2027", units: 60,   loc: "Central warehouse", risk: "amber" },
    { id: "B-2412-SBDB",  sku: "NSSBDB500", mfg: "Dec 2025", exp: "Jul 2026", units: 400,  loc: "Central warehouse", risk: "red" },
    { id: "B-2501-JAT",   sku: "NSJO100",   mfg: "Jan 2026", exp: "Jan 2028", units: 500,  loc: "Central warehouse", risk: "green" },
    { id: "B-2410-AC",    sku: "NSACDT30",  mfg: "Oct 2025", exp: "Oct 2027", units: 50,   loc: "Central warehouse", risk: "amber" },
    { id: "B-2504-SBJ",   sku: "NSSBJ500",  mfg: "Apr 2026", exp: "Apr 2027", units: 300,  loc: "Central warehouse", risk: "green" },
    { id: "B-2411-SBO",   sku: "NSSBBO15",  mfg: "Nov 2025", exp: "Nov 2027", units: 40,   loc: "Central warehouse", risk: "green" },
    { id: "B-2502-MP",    sku: "NSMP100",   mfg: "Feb 2026", exp: "Feb 2028", units: 180,  loc: "Central warehouse", risk: "green" },
    { id: "B-2503-SBDB-1",sku: "NSSBDB250", mfg: "Mar 2026", exp: "Sep 2027", units: 800,  loc: "Central warehouse", risk: "green" },
  ];

  // ── Suppliers ─────────────────────────────────────────
  const suppliers = [
    { id: "SUP-001", name: "Glanbia Performance Nutrition", contact: "Rohit Mehra", phone: "+91 98xxx 12340", supplies: "Whey protein concentrate, isolate", moq: "500 kg", lead: 21, payment: "30% advance, 70% on delivery", skus: ["NS-WHT-CHO-1K","NS-WHT-VAN-1K","NS-WHT-CHO-2K"], reliability: 94 },
    { id: "SUP-002", name: "Lonza India",             contact: "Priya Iyer",   phone: "+91 99xxx 88210", supplies: "Vitamins, minerals premix",   moq: "200 kg",  lead: 18, payment: "Net 30",                  skus: ["NS-MUL-MEN-60","NS-MUL-WMN-60","NS-VITD-2K-60"], reliability: 88 },
    { id: "SUP-003", name: "Marpol Pvt Ltd",          contact: "Amit Shah",    phone: "+91 91xxx 44012", supplies: "Fish oil, omega-3 concentrate", moq: "100 kg", lead: 25, payment: "50% advance, balance on dispatch", skus: ["NS-OMG-3-90"], reliability: 91 },
    { id: "SUP-004", name: "DSM Nutritional Products", contact: "Suresh K.",   phone: "+91 98xxx 91020", supplies: "Biotin, B-complex actives",   moq: "50 kg",   lead: 30, payment: "Net 45",                  skus: ["NS-BIO-HAIR-60"], reliability: 76 },
    { id: "SUP-005", name: "Rousselot India",         contact: "Kavya Reddy",  phone: "+91 90xxx 33121", supplies: "Bovine collagen peptides",    moq: "300 kg",  lead: 35, payment: "Net 30",                  skus: ["NS-COL-PEP-250"], reliability: 82 },
    { id: "SUP-006", name: "Arjuna Natural",          contact: "Bijoy Cherian",phone: "+91 94xxx 21034", supplies: "Ashwagandha root extract (KSM-66)", moq: "100 kg", lead: 21, payment: "Net 30", skus: ["NS-ASH-500-60"], reliability: 96 },
    { id: "SUP-007", name: "Ingredia",                contact: "Manish Kumar", phone: "+91 95xxx 60189", supplies: "Plant protein blend",          moq: "500 kg", lead: 28, payment: "30% advance, 70% on delivery", skus: ["NS-PRO-VEG-1K"], reliability: 79 },
    { id: "SUP-008", name: "Packwell Industries",     contact: "Deepak Singh", phone: "+91 99xxx 11023", supplies: "Containers, lids, seals (packaging)", moq: "10K units", lead: 14, payment: "Net 30", skus: ["(all)"], reliability: 93 },
    { id: "SUP-009", name: "Print Origin",            contact: "Rhea Pillai",  phone: "+91 88xxx 22090", supplies: "Labels, cartons (packaging)", moq: "5K units", lead: 10, payment: "Net 15", skus: ["(all)"], reliability: 89 },
  ];

  // ── PO Log ────────────────────────────────────────────
  const poLog = [
    { id: "PO-2026-0118", supplier: "Glanbia Performance Nutrition", date: "May 02, 2026", items: "Whey protein isolate · 1,200 kg", expected: "May 23, 2026", actual: "May 21, 2026", status: "Delivered", deltaDays: -2 },
    { id: "PO-2026-0117", supplier: "Lonza India", date: "May 06, 2026", items: "Multivitamin premix · 400 kg", expected: "May 24, 2026", actual: null, status: "In transit", deltaDays: 0 },
    { id: "PO-2026-0116", supplier: "Marpol Pvt Ltd", date: "Apr 28, 2026", items: "Omega-3 concentrate · 200 kg", expected: "May 23, 2026", actual: "May 26, 2026", status: "Delivered", deltaDays: +3 },
    { id: "PO-2026-0115", supplier: "Arjuna Natural", date: "May 04, 2026", items: "KSM-66 Ashwagandha · 150 kg", expected: "May 25, 2026", actual: null, status: "In transit", deltaDays: 0 },
    { id: "PO-2026-0114", supplier: "DSM Nutritional Products", date: "Apr 14, 2026", items: "Biotin actives · 60 kg", expected: "May 14, 2026", actual: "May 19, 2026", status: "Delivered", deltaDays: +5 },
    { id: "PO-2026-0113", supplier: "Packwell Industries", date: "May 01, 2026", items: "1kg whey tubs · 15K units", expected: "May 15, 2026", actual: "May 15, 2026", status: "Delivered", deltaDays: 0 },
  ];

  // ── Marketing ─────────────────────────────────────────
  const adAccounts = {
    google: { spendMTD: 1840000, revAttrib: 6240000, roas: 3.39, cac: 412, impressions: 4820000, clicks: 64200, conversions: 4480, budget: 2500000 },
    meta:   { spendMTD: 2120000, revAttrib: 7910000, roas: 3.73, cac: 386, impressions: 8210000, clicks: 88400, conversions: 5490, budget: 2400000 },
  };

  const googleCampaigns = [
    { name: "Search · Brand · Naturesum",     spend: 184000, roas: 8.42, cac: 124, conv: 1480, status: "Active" },
    { name: "Search · Whey Protein",          spend: 412000, roas: 4.18, cac: 384, conv: 1072, status: "Active" },
    { name: "Search · Multivitamins",         spend: 318000, roas: 3.62, cac: 412, conv:  772, status: "Active" },
    { name: "PMax · All products",            spend: 540000, roas: 2.94, cac: 482, conv: 1120, status: "Active" },
    { name: "Display · Remarketing",          spend: 184000, roas: 2.18, cac: 612, conv:  300, status: "Active" },
    { name: "YouTube · Hair & Skin",          spend: 202000, roas: 1.61, cac: 894, conv:  226, status: "Paused" },
  ];

  const metaCampaigns = [
    { name: "ABO · Whey Protein · Lookalike 1%",    spend: 412000, roas: 4.92, cac: 312, conv: 1320, status: "Active" },
    { name: "ABO · Multivitamin · Interest stack",  spend: 360000, roas: 3.86, cac: 384, conv:  938, status: "Active" },
    { name: "CBO · Hair & Biotin · UGC creatives",  spend: 290000, roas: 5.21, cac: 268, conv: 1082, status: "Active" },
    { name: "CBO · Ashwagandha · Static",           spend: 184000, roas: 3.14, cac: 412, conv:  447, status: "Active" },
    { name: "Retargeting · ATC 14d",                spend: 218000, roas: 6.04, cac: 184, conv: 1184, status: "Active" },
    { name: "Prospecting · Plant Protein launch",   spend: 240000, roas: 1.86, cac: 712, conv:  337, status: "Active" },
    { name: "Catalog · Collagen Peptides",          spend: 168000, roas: 2.42, cac: 488, conv:  344, status: "Paused" },
  ];

  // ── Influencers ───────────────────────────────────────
  const influencers = [
    { name: "Tanmay Bhat",         handle: "@tanmaybhat",     platform: "Instagram", tier: "Macro",  followers: "4.2M", product: "Whey Choc 1kg",   format: "Reel",  spend: 320000, boost: 80000, views: 1840000, engagement: "4.2%", coupon: "TANMAY10", attribRev: 980000 },
    { name: "Rebecca Pinto",       handle: "@rebecca.pinto",  platform: "Instagram", tier: "Micro",  followers: "186K", product: "Biotin+Hair",     format: "Reel",  spend: 45000,  boost: 12000, views: 412000,  engagement: "6.8%", coupon: "REBECCA15",attribRev: 240000 },
    { name: "Yatinder Singh",      handle: "@yatinder_singh", platform: "Instagram", tier: "Macro",  followers: "1.1M", product: "Whey Van 1kg",    format: "Post",  spend: 80000,  boost: 20000, views: 380000,  engagement: "3.4%", coupon: "YATI10",   attribRev: 320000 },
    { name: "Anushka Hegde",       handle: "@anushkahegde",   platform: "YouTube",   tier: "Micro",  followers: "212K", product: "Multivitamin W",  format: "Video", spend: 60000,  boost: 0,     views: 184000,  engagement: "5.1%", coupon: "ANU20",    attribRev: 410000 },
    { name: "Karan Singh",         handle: "@karansinghxd",   platform: "Instagram", tier: "Nano",   followers: "42K",  product: "Creatine",        format: "Story", spend: 8000,   boost: 0,     views: 28000,   engagement: "8.2%", coupon: null,       attribRev: null },
    { name: "Dr. Ananya Sharma",   handle: "@dr.ananyas",     platform: "Instagram", tier: "Micro",  followers: "320K", product: "Omega-3",         format: "Reel",  spend: 75000,  boost: 25000, views: 540000,  engagement: "5.6%", coupon: "ANANYA15", attribRev: 380000 },
    { name: "FitWithDev",          handle: "@fitwithdev",     platform: "YouTube",   tier: "Micro",  followers: "184K", product: "Whey Choc 2kg",   format: "Video", spend: 90000,  boost: 0,     views: 240000,  engagement: "4.4%", coupon: null,       attribRev: null },
  ];

  // ── Marketplace intel ─────────────────────────────────
  const marketplaceAmazon = [
    { sku: "NS-WHT-CHO-1K", asin: "B09KX2J4Q1", bsr: 142,  bsrPrev: 168,  cat: "Sports Nutrition", buyBox: "Winning", buyBoxRate: 96, listing: "Active",     rating: 4.5, reviews: 4820, ratingTrend: +0.1 },
    { sku: "NS-WHT-VAN-1K", asin: "B09KX2J4Q2", bsr: 184,  bsrPrev: 172,  cat: "Sports Nutrition", buyBox: "Winning", buyBoxRate: 92, listing: "Active",     rating: 4.4, reviews: 2940, ratingTrend: -0.1 },
    { sku: "NS-WHT-CHO-2K", asin: "B09KX2J4Q3", bsr: null, bsrPrev: 312,  cat: "Sports Nutrition", buyBox: "—",       buyBoxRate: 0,  listing: "Suppressed", rating: 4.5, reviews: 1840, ratingTrend: 0.0 },
    { sku: "NS-MUL-MEN-60", asin: "B0B7P92XK4", bsr: 38,   bsrPrev: 41,   cat: "Multivitamins",    buyBox: "Winning", buyBoxRate: 98, listing: "Active",     rating: 4.6, reviews: 8210, ratingTrend: 0.0 },
    { sku: "NS-MUL-WMN-60", asin: "B0B7P92XK5", bsr: 24,   bsrPrev: 28,   cat: "Multivitamins",    buyBox: "Winning", buyBoxRate: 99, listing: "Active",     rating: 4.7, reviews: 9420, ratingTrend: +0.1 },
    { sku: "NS-OMG-3-90",   asin: "B0C1MTH7QQ", bsr: 86,   bsrPrev: 92,   cat: "Supplements",      buyBox: "Winning", buyBoxRate: 94, listing: "Active",     rating: 4.5, reviews: 5180, ratingTrend: 0.0 },
    { sku: "NS-BIO-HAIR-60",asin: "B0C1MTH7QR", bsr: 12,   bsrPrev: 14,   cat: "Hair Care",        buyBox: "Winning", buyBoxRate: 97, listing: "Active",     rating: 4.6, reviews: 12480,ratingTrend: +0.1 },
    { sku: "NS-COL-PEP-250",asin: "B0C1MTH7QS", bsr: 220,  bsrPrev: 184,  cat: "Skin Care",        buyBox: "Losing",  buyBoxRate: 62, listing: "Active",     rating: 3.9, reviews: 2840, ratingTrend: -0.3 },
    { sku: "NS-ASH-500-60", asin: "B0C1MTH7QT", bsr: 54,   bsrPrev: 58,   cat: "Herbal",           buyBox: "Winning", buyBoxRate: 95, listing: "Active",     rating: 4.5, reviews: 3120, ratingTrend: 0.0 },
    { sku: "NS-PRO-VEG-1K", asin: "B0C1MTH7QU", bsr: 380,  bsrPrev: 412,  cat: "Sports Nutrition", buyBox: "Winning", buyBoxRate: 88, listing: "Active",     rating: 3.8, reviews: 612,  ratingTrend: -0.2 },
  ];

  const recentReviews = [
    { sku: "NS-COL-PEP-250", platform: "Amazon",   rating: 1, title: "Tastes chalky",            body: "Couldn't drink more than two days. The taste is really off, doesn't dissolve well either.", time: "4h ago" },
    { sku: "NS-COL-PEP-250", platform: "Amazon",   rating: 2, title: "Doesn't mix properly",     body: "Even in warm water there are clumps. Returning.", time: "11h ago" },
    { sku: "NS-WHT-VAN-1K",  platform: "Flipkart", rating: 5, title: "Best whey under 3K",       body: "Mixes well, tastes good, no bloating. Already on second tub.", time: "yesterday" },
    { sku: "NS-MUL-WMN-60",  platform: "Amazon",   rating: 5, title: "Felt the difference",      body: "Energy is back up. Hair fall reduced after week 3.", time: "yesterday" },
    { sku: "NS-COL-PEP-250", platform: "Amazon",   rating: 1, title: "Smells weird",             body: "Fishy smell, can't get past it. Money wasted.", time: "yesterday" },
    { sku: "NS-PRO-VEG-1K",  platform: "Amazon",   rating: 2, title: "Lumpy when mixed",         body: "Tried with water and milk, both end up lumpy. Disappointing for the price.", time: "2d ago" },
  ];

  // ── Finance ───────────────────────────────────────────
  const costCards = [
    { sku: "NS-WHT-CHO-1K", batch: "B-2503-WHT01", cogs: 480, packaging: 62, freight: 18, landed: 560, mrp: 1899 },
    { sku: "NS-WHT-VAN-1K", batch: "B-2503-WHT02", cogs: 478, packaging: 62, freight: 18, landed: 558, mrp: 1899 },
    { sku: "NS-MUL-WMN-60", batch: "B-2502-MUL-W", cogs: 142, packaging: 28, freight:  6, landed: 176, mrp:  699 },
    { sku: "NS-OMG-3-90",   batch: "B-2412-OMG3",  cogs: 168, packaging: 32, freight:  8, landed: 208, mrp:  799 },
    { sku: "NS-BIO-HAIR-60",batch: "B-2501-BIO",   cogs: 124, packaging: 28, freight:  6, landed: 158, mrp:  649 },
    { sku: "NS-COL-PEP-250",batch: "B-2410-COL",   cogs: 248, packaging: 42, freight: 12, landed: 302, mrp: 1199 },
    { sku: "NS-ASH-500-60", batch: "B-2504-ASH",   cogs:  92, packaging: 28, freight:  4, landed: 124, mrp:  499 },
  ];

  // P&L MTD (₹)
  const pnl = {
    revenue: { amazon: 11240000, shopify: 8420000, flipkart: 4820000, blinkit: 4460000 },
    cogs: -8640000,
    platformFees: { amazon: -1820000, flipkart: -680000, blinkit: -340000 },
    fulfillment: -1240000,
    adSpend: { google: -1840000, meta: -2120000 },
    influencer: -680000,
    overhead: -1640000, // Zoho synced
  };

  // Cash flow next 30 days (selected days)
  const cashflow = [
    { date: "May 21", inflow: 720000,  outflow: -180000, evt: "Shopify payout" },
    { date: "May 24", inflow: 320000,  outflow: -0,      evt: "Shopify payout" },
    { date: "May 25", inflow: 0,       outflow: -480000, evt: "Glanbia 70% balance" },
    { date: "May 27", inflow: 1820000, outflow: 0,       evt: "Amazon payout D+7" },
    { date: "May 30", inflow: 0,       outflow: -240000, evt: "Print Origin invoice" },
    { date: "Jun 02", inflow: 940000,  outflow: -0,      evt: "Flipkart payout" },
    { date: "Jun 04", inflow: 0,       outflow: -1240000, evt: "Lonza Net 30 + DSM" },
    { date: "Jun 07", inflow: 2140000, outflow: 0,       evt: "Amazon payout D+7" },
    { date: "Jun 10", inflow: 0,       outflow: -680000, evt: "Influencer payouts" },
    { date: "Jun 14", inflow: 1280000, outflow: -1080000, evt: "Blinkit · Arjuna PO" },
    { date: "Jun 17", inflow: 2280000, outflow: 0,       evt: "Amazon payout" },
  ];

  // ── Launches ──────────────────────────────────────────
  const launches = [
    {
      id: "L01", name: "Magnesium Glycinate · 60ct", sku: "NS-MAG-GLY-60", phase: "pre", target: "Aug 14, 2026", progress: 62,
      milestones: [
        { name: "Concept & formulation finalized",         owner: "Cristoo",   start: 0,  end: 6,  status: "done"     },
        { name: "Lab testing complete (FSSAI/safety)",     owner: "Kirat",     start: 6,  end: 18, status: "done"     },
        { name: "Packaging design approved",               owner: "Design",    start: 12, end: 24, status: "done"     },
        { name: "Packaging material procured",             owner: "Ops",       start: 22, end: 36, status: "progress" },
        { name: "Raw materials procured",                  owner: "Ops",       start: 24, end: 38, status: "progress" },
        { name: "Production / manufacturing complete",     owner: "Ops",       start: 38, end: 52, status: "notstarted" },
        { name: "Inventory received at central warehouse", owner: "Ops",       start: 52, end: 58, status: "notstarted" },
        { name: "Listing copy written",                    owner: "Marketing", start: 30, end: 44, status: "delayed"  },
        { name: "Listing creatives ready (A+ / EBC)",      owner: "Design",    start: 38, end: 56, status: "notstarted" },
        { name: "Ad creatives ready",                      owner: "Agency",    start: 44, end: 60, status: "notstarted" },
        { name: "Amazon / Flipkart listing live",          owner: "Marketplace", start: 60, end: 64, status: "notstarted" },
        { name: "Shopify product page live",               owner: "Marketing", start: 60, end: 64, status: "notstarted" },
        { name: "Launch date confirmed",                   owner: "Cristoo",   start: 64, end: 68, status: "notstarted" },
        { name: "Blinkit / Instamart onboarding",          owner: "Marketplace", start: 64, end: 78, status: "notstarted" },
      ]
    },
    {
      id: "L02", name: "Zinc + Vitamin C · Effervescent · 20ct", sku: "NS-ZNC-EFF-20", phase: "pre", target: "Sep 10, 2026", progress: 18,
      milestones: [
        { name: "Concept & formulation finalized",         owner: "Cristoo",   start: 0,  end: 14, status: "progress" },
        { name: "Lab testing complete (FSSAI/safety)",     owner: "Kirat",     start: 14, end: 28, status: "notstarted" },
      ]
    },
    {
      id: "L03", name: "Pre-Probiotic Gut Health · 30ct", sku: "NS-PRE-GUT-30", phase: "post", target: "Live · D+34", progress: 100,
      milestones: [],
      live: { d1: 84, d7: 312, d14: 540, d30: 980, d60: null, d90: null, targets: { d1: 60, d7: 400, d14: 800, d30: 1500 } },
    },
  ];

  return {
    fmtINR, fmtN, pct,
    skus, channels, revenueToday, revenueYesterday, revenueMTD, revenueMTDLast, revenueMTDTarget,
    revenue7dAvg, cashExpected,
    trend30, alerts, skuSales, inventory, itemUsedBy, batches, suppliers, poLog,
    blinkitFeederWhs: BLINKIT_FEEDER_WHS,
    realDataSnapshotDate: REAL_DATA_SNAPSHOT_DATE,
    // Central WH engine snapshot + the two non-SKU buckets (fixed assets,
    // consumables/shipping) for the Materials breakdown tab footer.
    centralWh: {
      anchorDate:  CWH_SRC?.anchorDate ?? null,
      anchorSheet: CWH_SRC?.anchorSheet ?? null,
      asOf:        CWH_SRC?.asOf ?? null,
      fixedAssets: CWH_FIXED_ASSETS,
      consumables: CWH_CONSUMABLES,
      // Data-quality flags (unmapped SKUs/components, garbage rows, BOM gaps,
      // negative stock) so the UI can SURFACE them instead of silently dropping
      // (smaller-requirement #13). Comes from whichever source won (uploaded
      // workbook over bundled). SAFE FALLBACK: null when absent.
      flags: CWH_SRC?.flags || null,
      // D6 — per-component reorder coverage (RM + primary packaging) with stock,
      // daysCover, leadDays, reorder flag, reorderByDays + reorderDate. Sorted
      // most-urgent first so the UI can render component reorder dates.
      components: centralWhComponents,
      nonConstraining: [...NON_CONSTRAINING],
    },
    // Also expose at the top level for convenience (same array reference).
    centralWhComponents,
    // ⚠️ nitinSheetSnapshot REMOVED (FIX-SPEC V9) — the nitin runtime path is
    // severed; the central-WH engine owns the warehouse as-of/movement dates.
    adAccounts, googleCampaigns, metaCampaigns, influencers,
    marketplaceAmazon, recentReviews,
    costCards, pnl, cashflow, launches,
  };
})();


if (typeof window !== 'undefined') window.NSData = NSData;
export default NSData;
