/**
 * centralWhEngine.js — BROWSER TWIN of scripts/build-central-wh.cjs.
 *
 * This module is the in-browser, async port of the Node build script. It reads
 * an uploaded Central Warehouse workbook (xlsx) and returns the SAME object
 * shape as CENTRAL_WH_DATA in src/bundledCentralWHData.js:
 *   { anchorDate, anchorSheet, asOf, config, fg:{}, components:{},
 *     fixedAssets:[], consumables:[], flags:{} }
 *
 * ⚠️  KEEP IN SYNC with scripts/build-central-wh.cjs. The two implementations
 *     MUST stay identical in their parsing/metric logic. The reference tables
 *     (SKUS / COMPONENTS / BOM / aliases / FIXED_ASSET_NAMES) below are copied
 *     VERBATIM from build-central-wh.cjs — when you change one, change both.
 *
 * Differences from the Node twin (intentional, behaviour-preserving):
 *   - Input is an uploaded `File` read via XLSX.read(await file.arrayBuffer()),
 *     not a path read via XLSX.readFile().
 *   - Module-level mutable state in the CJS script (ledger, newFG, flags, …) is
 *     made FUNCTION-LOCAL here so the engine is safe to call repeatedly.
 *   - No filesystem write / console summary. The data object is RETURNED.
 *   - R-FAILLOUD: this throws a clear Error when the workbook is structurally
 *     wrong (no Audit tab, audit tab missing FINISHED/SEMI/RAW/PACKAG sections,
 *     or zero FG rows parse) instead of silently returning all-zero data.
 *
 * Lead times match Pass-1: Moringa (NSMP100/NSMP250) = 25, NSMLPR = 25.
 */
import * as XLSX from "xlsx";

// ─── Config ─────────────────────────────────────────────────────
// ANCHOR_DATE / ANCHOR_SHEET are AUTO-DETECTED per-call (latest "Audit DDMMYY"
// sheet). The constants here are only fallback seeds (mirrors the CJS twin).
const ANCHOR_DATE_DEFAULT = new Date("2026-05-05T00:00:00Z");
const ANCHOR_SHEET_DEFAULT = "Audit 050525";
const MERGE_OLD_SB500 = true;
const RANGE_RULE = "first"; // first | sum | min | max
const W30 = 30, W60 = 60;

// ─── Fixed-asset + consumable classification ────────────────────
// Per founder: equipment + furniture = FIXED ASSETS (own section below the
// material breakdown). Everything in the audit's PACKAGING section that is
// NOT a BOM component and NOT a fixed asset falls into CONSUMABLES & SHIPPING
// (cartons, stickers, tape, rolls, caps, carpets, foam) — shown separately.
// Matching is on the normalised name (norm()).
const FIXED_ASSET_NAMES = new Set([
  "sealing machine", "heat gun machine", "tape machine", "tape bundle",
  "picking equipment", "empty drums", "ac unit", "laptop",
  "tsc label printer", "2d wireless barcode scanner", "tables", "benches",
  "office chairs", "thermal inkjet printer", "steel racks",
].map(s => s)); // already lowercase / no punctuation → norm() lands here

// ─── §2a — Finished-good SKUs ───────────────────────────────────
const SKUS = [
  { code: "NSMP100",  name: "Moringa Powder",                       variant: "100 g",     price: 265,  leadDays: 25 },
  { code: "NSMP250",  name: "Moringa Powder",                       variant: "250 g",     price: 495,  leadDays: 25 },
  { code: "NSSB100",  name: "Sea Buckthorn Powder",                 variant: "100 g",     price: 450,  leadDays: 50 },
  { code: "NSSB250",  name: "Sea Buckthorn Powder",                 variant: "250 g",     price: 750,  leadDays: 50 },
  { code: "NSSB500",  name: "Sea Buckthorn Powder",                 variant: "500 g",     price: 1350, leadDays: 50 },
  { code: "NSSBDB100",name: "Sea Buckthorn Dry Berry",              variant: "100 g",     price: 390,  leadDays: 50 },
  { code: "NSSBDB250",name: "Sea Buckthorn Dry Berry",              variant: "250 g",     price: 690,  leadDays: 50 },
  { code: "NSSBDB500",name: "Sea Buckthorn Dry Berry",              variant: "500 g",     price: 1150, leadDays: 50 },
  { code: "NSSBJ300", name: "Sea Buckthorn Juice",                  variant: "300 ml",    price: 690,  leadDays: 50 },
  { code: "NSSBJ500", name: "Sea Buckthorn Juice",                  variant: "500 ml",    price: 1100, leadDays: 50 },
  { code: "NSSBBO15", name: "Sea Buckthorn Face Oil",               variant: "15 ml",     price: 1075, leadDays: 50 },
  { code: "NSSBBO30", name: "Sea Buckthorn Face Oil",               variant: "30 ml",     price: 1580, leadDays: 50 },
  { code: "NSJO100",  name: "Rosemary & Jatamansi Hair Oil",        variant: "100 ml",    price: 1350, leadDays: 20 },
  { code: "NSACDT30", name: "Acacia Catechu Diabetes Care Tea",     variant: "30 sachets",price: 975,  leadDays: 20 },
];
const SKU_CODES = new Set(SKUS.map(s => s.code));
const SKU_BY_CODE = Object.fromEntries(SKUS.map(s => [s.code, s]));

// ─── §2b — Components ───────────────────────────────────────────
const COMPONENTS = [
  { ref: "NSMLPR",        name: "Moringa Leaves Powder",             type: "RM",  leadDays: 25, unit: "KG"  },
  { ref: "NSSBPR",        name: "SB Powder (Raw)",                   type: "RM",  leadDays: 50, unit: "KG"  },
  { ref: "NSSBDBR",       name: "SB Dry Berries (Raw)",              type: "RM",  leadDays: 50, unit: "KG"  },
  { ref: "NSSBJPLP",      name: "SB Juice Pulp",                     type: "RM",  leadDays: 50, unit: "Ltr" },
  { ref: "NSSBOR",        name: "SB Face Oil (Raw)",                 type: "RM",  leadDays: 50, unit: "Ltr" },
  { ref: "NSJOF100",      name: "Jatamansi Hair Oil Filled Bottle",  type: "SFG", leadDays: 20, unit: "Pcs" },
  { ref: "NSACDSF30",     name: "AC Tea Dip Sachets (Filled)",       type: "SFG", leadDays: 20, unit: "Pcs" },
  { ref: "NSPKGMP100",    name: "Moringa Powder Empty Pouch 100g",   type: "PKG", leadDays: 14, unit: "Pcs" },
  { ref: "NSPKGMP250",    name: "Moringa Powder Empty Pouch 250g",   type: "PKG", leadDays: 14, unit: "Pcs" },
  { ref: "NSPKGCB100",    name: "100g Carton Box",                   type: "PKG", leadDays: 14, unit: "Pcs" },
  { ref: "NSPKGCB250",    name: "250g Carton Box",                   type: "PKG", leadDays: 14, unit: "Pcs" },
  { ref: "NSPKGSBP100",   name: "SB Powder Empty Pouch 100g",        type: "PKG", leadDays: 14, unit: "Pcs" },
  { ref: "NSPKGSBP250",   name: "SB Powder Empty Pouch 250g",        type: "PKG", leadDays: 14, unit: "Pcs" },
  { ref: "NSPKGSBP500",   name: "SB Powder Empty Pouch 500g",        type: "PKG", leadDays: 14, unit: "Pcs" },
  { ref: "NSPKGDBP100",   name: "Dry Berries Empty Pouch 100g",      type: "PKG", leadDays: 14, unit: "Pcs" },
  { ref: "NSPKGDBP250",   name: "Dry Berries Empty Pouch 250g",      type: "PKG", leadDays: 14, unit: "Pcs" },
  { ref: "NSPKGDBP500",   name: "Dry Berries Empty Pouch 500g",      type: "PKG", leadDays: 14, unit: "Pcs" },
  { ref: "NSPKGJBOT300",  name: "Juice Bottle 300 ml",               type: "PKG", leadDays: 14, unit: "Pcs" },
  { ref: "NSPKGJB300",    name: "Small Air Pouch 300 ml",            type: "PKG", leadDays: 14, unit: "Pcs" },
  { ref: "NSPKGJTUB300",  name: "Juice Tube 300 ml",                 type: "PKG", leadDays: 14, unit: "Pcs" },
  { ref: "NSPKGJLBL300",  name: "Juice Label 300 ml",                type: "PKG", leadDays: 14, unit: "Pcs" },
  { ref: "NSPKGJBOT500",  name: "Juice Bottle 500 ml",               type: "PKG", leadDays: 14, unit: "Pcs" },
  { ref: "NSPKGJB500",    name: "Large Air Pouch 500 ml",            type: "PKG", leadDays: 14, unit: "Pcs" },
  { ref: "NSPKGJTUB500",  name: "Juice Tube 500 ml",                 type: "PKG", leadDays: 14, unit: "Pcs" },
  { ref: "NSPKGJLBL500",  name: "Juice Label 500 ml",                type: "PKG", leadDays: 14, unit: "Pcs" },
  { ref: "NSPKGBOBT15",   name: "SB Oil Bottle 15 ml",               type: "PKG", leadDays: 14, unit: "Pcs" },
  { ref: "NSPKGBOB15",    name: "SB Faceoil Empty Box 15 ml",        type: "PKG", leadDays: 14, unit: "Pcs" },
  { ref: "NSPKGBOBT30",   name: "SB Oil Bottle 30 ml",               type: "PKG", leadDays: 14, unit: "Pcs" },
  { ref: "NSPKGBOB30",    name: "SB Faceoil Empty Box 30 ml",        type: "PKG", leadDays: 14, unit: "Pcs" },
  { ref: "NSPKGBOCAP",    name: "Bottle Cap",                        type: "PKG", leadDays: 14, unit: "Pcs" },
  { ref: "NSPKGBODROP",   name: "Dropper",                           type: "PKG", leadDays: 14, unit: "Pcs" },
  { ref: "NSPKGJOB100",   name: "Jatamansi Empty Box (with print)",  type: "PKG", leadDays: 14, unit: "Pcs" },
  { ref: "NSPKGACTC30",   name: "Acacia Tea Bag Empty Pouch (green)",type: "PKG", leadDays: 14, unit: "Pcs" },
  { ref: "NSPKGACTCBOX",  name: "Acacia Tea Empty Outer Box",        type: "PKG", leadDays: 14, unit: "Pcs" },
];
const COMP_BY_REF = Object.fromEntries(COMPONENTS.map(c => [c.ref, c]));

// ─── §2c — BOM ──────────────────────────────────────────────────
const BOM = {
  NSMP100:   [["NSMLPR", 0.10],   ["NSPKGMP100", 1], ["NSPKGCB100", 1]],
  NSMP250:   [["NSMLPR", 0.25],   ["NSPKGMP250", 1], ["NSPKGCB250", 1]],
  NSSB100:   [["NSSBPR", 0.10],   ["NSPKGSBP100", 1]],
  NSSB250:   [["NSSBPR", 0.25],   ["NSPKGSBP250", 1]],
  NSSB500:   [["NSSBPR", 0.50],   ["NSPKGSBP500", 1]],
  NSSBDB100: [["NSSBDBR", 0.10],  ["NSPKGDBP100", 1]],
  NSSBDB250: [["NSSBDBR", 0.25],  ["NSPKGDBP250", 1]],
  NSSBDB500: [["NSSBDBR", 0.50],  ["NSPKGDBP500", 1]],
  NSSBJ300:  [["NSSBJPLP", 0.30], ["NSPKGJBOT300", 1], ["NSPKGJB300", 1], ["NSPKGJTUB300", 1], ["NSPKGJLBL300", 1]],
  NSSBJ500:  [["NSSBJPLP", 0.50], ["NSPKGJBOT500", 1], ["NSPKGJB500", 1], ["NSPKGJTUB500", 1], ["NSPKGJLBL500", 1]],
  NSSBBO15:  [["NSSBOR", 0.015],  ["NSPKGBOBT15", 1], ["NSPKGBOB15", 1], ["NSPKGBOCAP", 1], ["NSPKGBODROP", 1]],
  NSSBBO30:  [["NSSBOR", 0.030],  ["NSPKGBOBT30", 1], ["NSPKGBOB30", 1], ["NSPKGBOCAP", 1], ["NSPKGBODROP", 1]],
  NSJO100:   [["NSJOF100", 1],    ["NSPKGJOB100", 1]],
  NSACDT30:  [["NSACDSF30", 30],  ["NSPKGACTC30", 30], ["NSPKGACTCBOX", 1]],
};

// ─── §2d — Normaliser + alias maps ──────────────────────────────
function norm(s) {
  if (s == null) return "";
  let x = String(s).toLowerCase();
  // remove . ( ) and the listed words
  x = x.replace(/[.()]/g, " ");
  x = x.replace(/\b(pure|packed|gm|gram|grams)\b/g, " ");
  x = x.replace(/\s+/g, " ").trim();
  return x;
}

// FG aliases (Daily Movement + Production names) → SKU code
const FG_ALIASES_RAW = {
  "jatamansi & rosemary hair oil - 100 ml":         "NSJO100",
  "jatamansi hair oil 100 ml":                       "NSJO100",
  "sea buckthorn berry oil 15 ml":                   "NSSBBO15",
  "sb face oil 15 ml":                               "NSSBBO15",
  "sea buckthorn berry oil 30 ml":                   "NSSBBO30",
  "sb face oil 30 ml":                               "NSSBBO30",
  "pure sea buckthorn dry berries 500 gm":           "NSSBDB500",
  "sb berries 500 gm":                               "NSSBDB500",
  "pure sea buckthorn dry berries 250 gm":           "NSSBDB250",
  "sb berries 250 gm":                               "NSSBDB250",
  "pure sea buckthorn dry berries 100 gm":           "NSSBDB100",
  "sb berries 100 gm":                               "NSSBDB100",
  "pure sea buckthorn berries powder 500 gm":        "NSSB500",
  "sb powder 500 gm":                                "NSSB500",
  "sb powder 500 gm (old)":                          "NSSB500",
  "pure sea buckthorn berries powder 250 gm":        "NSSB250",
  "sb powder 250 gm":                                "NSSB250",
  "pure sea buckthorn berries powder 100 gm":        "NSSB100",
  "pure sea buckthorn berries powder100 gm":         "NSSB100",
  "sb powder 100 gm":                                "NSSB100",
  "acacia catechu - 30 tea bags":                    "NSACDT30",
  "ac tea (30 tea bags)":                            "NSACDT30",
  "ac tea(30 tea bags)":                             "NSACDT30",
  "pure sea buckthorn berries juice 300ml":          "NSSBJ300",
  "pure sea buckthorn berries juice 500ml":          "NSSBJ500",
  "moringa powder 250g":                             "NSMP250",
  "moringa powder 100g":                             "NSMP100",
  "moringa powder 250 gm":                           "NSMP250",
  "moringa powder 100 gm":                           "NSMP100",
};
const FG_ALIASES = Object.fromEntries(Object.entries(FG_ALIASES_RAW).map(([k, v]) => [norm(k), v]));
// SFG production rows that appear in the Production matrix
const SFG_PRODUCTION_ALIASES = Object.fromEntries(Object.entries({
  "acacia tea pouches (green, filled)":              "NSACDSF30",
  "jatamansi hair oil filled bottles (bo)":          "NSJOF100",
}).map(([k, v]) => [norm(k), v]));

// Component aliases (audit) → refcode
const COMPONENT_ALIASES_RAW = {
  "sb powder (raw)":                            "NSSBPR",
  "sb juice pulp":                              "NSSBJPLP",
  "sb dry berries (raw)":                       "NSSBDBR",
  "moringa leaves powder":                      "NSMLPR",
  "sb oil":                                     "NSSBOR",
  "jatamansi hair oil filled bottles (bo)":     "NSJOF100",
  "ac tea dip sachets (filled)":                "NSACDSF30",
  "100 gm packaging carton box (empty) - powder": "NSPKGCB100",
  "250 gm packaging carton box (empty) - powder": "NSPKGCB250",
  "100 gram pouch - berry":                     "NSPKGDBP100",
  "250 gram pouch - berry":                     "NSPKGDBP250",
  "500 gram pouch - berry":                     "NSPKGDBP500",
  "sb faceoil empty box 15ml (box)":            "NSPKGBOB15",
  "sb faceoil empty box 30ml (box)":            "NSPKGBOB30",
  "acacia catechu tea box (30 packs)":          "NSPKGACTCBOX",
  "acacia catechu tea bag pouch":               "NSPKGACTC30",
  "sb face oil bottle caps":                    "NSPKGBOCAP",
  "sb faceoil droppers":                        "NSPKGBODROP",
  "moringa powder pouches 100gm":               "NSPKGMP100",
  "moringa powder pouches 250gm":               "NSPKGMP250",
  "sb oil empty bottles uncapped with logo (15 ml)": "NSPKGBOBT15",
  "sb face oil empty bottle (30 ml)":           "NSPKGBOBT30",
  "jatamasi empty box with print":              "NSPKGJOB100",
  "sb powder empty pouches (500 gram)":         "NSPKGSBP500",
  "sb powder empty pouches (250 gram)":         "NSPKGSBP250",
  "sb powder empty pouches (100 gram)":         "NSPKGSBP100",
  "juice containers (package) 300ml":           "NSPKGJBOT300",
  "juice containers (package) 500ml":           "NSPKGJBOT500",
  "large air pouch for juice (500 ml)":         "NSPKGJB500",
};
const COMPONENT_ALIASES = Object.fromEntries(Object.entries(COMPONENT_ALIASES_RAW).map(([k, v]) => [norm(k), v]));

// ─── §4 — Quantity cleaner ──────────────────────────────────────
function cleanQty(raw) {
  const note = { qty: 0, raw: raw == null ? "" : String(raw), notCounted: false, wasCompound: false, manualReview: false, unparsed: false };
  if (raw === null || raw === undefined || raw === "") return { ...note, notCounted: true };
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) { note.unparsed = true; return note; }
    note.qty = raw;
    return note;
  }
  let s = String(raw).trim();
  if (!s || /^na$/i.test(s)) return { ...note, notCounted: true };
  s = s.replace(/\b(pcs|pc|kg|ltr|roll|sheet|packs)\b/gi, "").trim();

  // "A + B"
  if (/\+/.test(s)) {
    const parts = s.split("+").map(p => parseFloat(p.trim())).filter(n => Number.isFinite(n));
    if (parts.length >= 2) {
      note.qty = parts.reduce((a, b) => a + b, 0);
      note.wasCompound = true;
      return note;
    }
  }
  // "A-B" range
  const m = s.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
  if (m) {
    const a = parseFloat(m[1]), b = parseFloat(m[2]);
    const pick = RANGE_RULE === "first" ? a : RANGE_RULE === "sum" ? a + b : RANGE_RULE === "min" ? Math.min(a,b) : Math.max(a,b);
    note.qty = pick;
    note.manualReview = true;
    return note;
  }
  const n = parseFloat(s.replace(/[^0-9.\-]/g, ""));
  if (Number.isFinite(n)) { note.qty = n; return note; }
  note.unparsed = true;
  return note;
}

// Excel serial date → JS Date
function xlDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date((v - 25569) * 86400 * 1000);
  if (typeof v === "string") {
    // "9-3-26" / "30-05-26" / "01-06-26" → DD-M(M)-YY
    const m = v.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
    if (m) {
      const dd = parseInt(m[1], 10);
      const mm = parseInt(m[2], 10);
      const yyRaw = m[3];
      const yy = yyRaw.length === 2 ? 2000 + parseInt(yyRaw, 10) : parseInt(yyRaw, 10);
      return new Date(Date.UTC(yy, mm - 1, dd));
    }
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}
function dateKey(d) { return d.toISOString().slice(0, 10); }
function daysBetween(a, b) { return Math.round((b.getTime() - a.getTime()) / 86400000); }

// ─── Detect the latest audit sheet ──────────────────────────────
// Sheet names look like "Audit DDMMYY" (e.g. Audit 050626 = 5 Jun 2026).
// Parse the name; cross-check with the "As of <date>" text in row 1; pick
// the sheet with the max date. Falls back to name-date when text is unclear.
function detectLatestAudit(wb) {
  const candidates = [];
  for (const name of wb.SheetNames) {
    const m = name.match(/audit\s+(\d{2})(\d{2})(\d{2})/i);
    if (!m) continue;
    const dd = +m[1], mm = +m[2], yy = 2000 + +m[3];
    // Name year can be a typo (050525 meant 2026) — prefer the "As of" text.
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", raw: true });
    const asOfText = String(grid[1]?.[0] || "");
    const tm = asOfText.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+),?\s*(\d{4})/i);
    let date = new Date(Date.UTC(yy, mm - 1, dd));
    if (tm) {
      const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
      const mi = months.findIndex(x => tm[2].toLowerCase().startsWith(x));
      if (mi >= 0) date = new Date(Date.UTC(+tm[3], mi, +tm[1]));
    }
    // V-2 / detailed variants share a date with the base — prefer the one
    // WITHOUT a "V-" suffix unless it's strictly newer (handled by sort).
    candidates.push({ name, date, isVariant: /v-?\d/i.test(name) });
  }
  // R-FAILLOUD: no audit tab at all → throw (handled by caller too, but keep
  // a null return as the structural signal so detectLatestAudit stays pure).
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    if (b.date.getTime() !== a.date.getTime()) return b.date.getTime() - a.date.getTime();
    return (a.isVariant ? 1 : 0) - (b.isVariant ? 1 : 0); // non-variant first on tie
  });
  return candidates[0];
}

// Strip "(old)" and "(Flipkart shipment)" tags off an audit item name and
// return { base, isOld, isFkShipment }. Both tags are case-insensitive.
function splitAuditTags(name) {
  let s = String(name || "");
  const isOld = /\(\s*old\s*\)/i.test(s);
  const isFkShipment = /flipkart\s*shipment/i.test(s);
  s = s.replace(/\(\s*old\s*\)/ig, " ")
       .replace(/\([^)]*flipkart\s*shipment[^)]*\)/ig, " ")
       .replace(/\s+/g, " ").trim();
  return { base: s, isOld, isFkShipment };
}

// ─── §3b — Parse Audit (latest sheet, old/new + 3-bucket) ───────
// Mutates the passed-in `state`. Returns the detected audit descriptor and
// throws (R-FAILLOUD) when the audit tab is structurally invalid.
function parseAudit(wb, state) {
  const detected = detectLatestAudit(wb);
  // R-FAILLOUD: no sheet matching /audit \d{6}/.
  if (!detected) {
    throw new Error(
      'Central Warehouse Workbook: no Audit tab found — expected a sheet named like "Audit 050626" (Audit DDMMYY). ' +
      `Sheets present: ${wb.SheetNames.join(", ") || "(none)"}.`
    );
  }
  state.anchorSheet = detected.name;
  state.anchorDate  = detected.date;
  const ANCHOR_DATE = detected.date;
  const { flags, ledger, newFG, oldFG, newComp, oldComp, fixedAssets, consumables } = state;

  const grid = XLSX.utils.sheet_to_json(wb.Sheets[detected.name], { header: 1, defval: "", raw: true });

  // R-FAILLOUD: the chosen audit tab must contain the section headers. We scan
  // first and bail loudly if none of FINISHED/SEMI/RAW/PACKAG are present.
  let sawFinished = false, sawSemi = false, sawRaw = false, sawPackag = false;
  for (const r of grid) {
    const a = String(r[0] || "");
    if (/SEMI/i.test(a))   sawSemi = true;
    if (/FINISH/i.test(a)) sawFinished = true;
    if (/RAW/i.test(a))    sawRaw = true;
    if (/PACKAG/i.test(a)) sawPackag = true;
  }
  if (!sawFinished || !sawSemi || !sawRaw || !sawPackag) {
    const missing = [
      !sawFinished && "FINISHED", !sawSemi && "SEMI",
      !sawRaw && "RAW", !sawPackag && "PACKAGING",
    ].filter(Boolean);
    throw new Error(
      `Central Warehouse Workbook: audit tab "${detected.name}" is missing required section(s): ${missing.join(", ")}. ` +
      'Expected FINISHED / SEMI / RAW / PACKAGING section headers in column A.'
    );
  }

  let section = null;
  for (const r of grid) {
    const a = String(r[0] || "");
    const bRaw = String(r[1] || "");
    if (/SEMI/i.test(a))   { section = "SFG"; continue; }
    if (/FINISH/i.test(a)) { section = "FG"; continue; }
    if (/RAW/i.test(a))    { section = "RM"; continue; }
    if (/PACKAG/i.test(a)) { section = "PKG"; continue; }
    if (!section) continue;
    if (!bRaw || bRaw === "·") continue;
    if (!a.startsWith("#")) continue;

    const cq = cleanQty(r[2]);
    const unit = String(r[3] || "").trim();
    if (cq.unparsed)     flags.unparsed_quantities.push({ section, name: bRaw, raw: cq.raw });
    if (cq.manualReview) flags.manual_review.push({ section, name: bRaw, raw: cq.raw, picked: cq.qty });

    const { base, isOld, isFkShipment } = splitAuditTags(bRaw);
    const nm = norm(base);

    if (section === "FG") {
      const code = FG_ALIASES[nm];
      if (!code) { flags.unmapped_names.push({ source: "audit-FG", name: bRaw }); continue; }
      // FK-shipment FG → counts as fresh central-WH FG (founder: team will
      // move it into FG; Daily Movement deducts it when it actually ships).
      if (isOld && !isFkShipment) oldFG[code] = (oldFG[code] || 0) + cq.qty;
      else                        newFG[code] = (newFG[code] || 0) + cq.qty;
      continue;
    }

    // SFG / RM / PKG — classify into BOM component | fixed asset | consumable.
    const ref = COMPONENT_ALIASES[nm];
    if (ref) {
      if (isOld) oldComp[ref] = (oldComp[ref] || 0) + cq.qty;
      else       newComp[ref] = (newComp[ref] || 0) + cq.qty;
      continue;
    }
    // Not a BOM component → fixed asset or consumable/shipping.
    if (FIXED_ASSET_NAMES.has(nm)) {
      fixedAssets.push({ name: base, qty: cq.qty, unit });
    } else {
      consumables.push({ name: base, qty: cq.qty, unit, section });
      // still log as unmapped-component so the data-quality tab sees it
      flags.unmapped_components.push({ section, name: bRaw, raw: cq.raw, bucket: "consumable" });
    }
  }

  // R-FAILLOUD: zero FG rows parsed → the workbook is unusable for the
  // dashboard. Never proceed to emit all-zero FG silently.
  if (Object.keys(newFG).length === 0 && Object.keys(oldFG).length === 0) {
    throw new Error(
      `Central Warehouse Workbook: audit tab "${detected.name}" produced ZERO finished-good rows. ` +
      'Check that the FINISHED section has "#"-prefixed item rows with names matching the SKU alias table.'
    );
  }

  // Opening-balance ledger entries.
  // FG audit_open = NEW only (sellable). Old stock is a static side field —
  // it does not roll forward and is excluded from sellable/runway.
  for (const [code, qty] of Object.entries(newFG)) {
    ledger.push({ date: ANCHOR_DATE, code, type: "FG", txn: "audit_open", qty });
  }
  // Components: new + old both usable for producing → sum into the balance.
  const allComp = new Set([...Object.keys(newComp), ...Object.keys(oldComp)]);
  for (const ref of allComp) {
    const meta = COMP_BY_REF[ref];
    const qty = (newComp[ref] || 0) + (oldComp[ref] || 0);
    ledger.push({ date: ANCHOR_DATE, code: ref, type: meta?.type || "PKG", txn: "audit_open", qty });
  }

  return detected;
}

// ─── §3c — Parse Production ─────────────────────────────────────
// Production is OPTIONAL — a Central WH workbook may legitimately ship with
// only an audit tab. Missing/empty → no-op (the audit opening balances stand).
function parseProduction(wb, state) {
  const sheet = wb.Sheets["Production"];
  if (!sheet) { state.flags.notes.push({ source: "production", note: "no Production sheet — skipped" }); return; }
  const { flags, ledger } = state;
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
  const header = grid[0];
  if (!header) return;
  const dateCols = [];
  for (let c = 1; c < header.length; c++) {
    const d = xlDate(header[c]);
    if (d) dateCols.push({ col: c, date: d });
  }
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    const itemRaw = row[0];
    if (!itemRaw || itemRaw === "·") continue;
    const nm = norm(itemRaw);
    let code = FG_ALIASES[nm];
    let isSfg = false;
    if (!code) {
      code = SFG_PRODUCTION_ALIASES[nm];
      isSfg = !!code;
    }
    if (!code) { flags.unmapped_names.push({ source: "production", name: String(itemRaw) }); continue; }

    for (const { col, date } of dateCols) {
      const v = row[col];
      const q = typeof v === "number" ? v : parseFloat(v);
      if (!Number.isFinite(q) || q <= 0) continue;
      if (isSfg) {
        ledger.push({ date, code, type: "SFG", txn: "produce_sfg", qty: q });
      } else {
        ledger.push({ date, code, type: "FG", txn: "produce", qty: q });
        // BOM-driven consumption
        const recipe = BOM[code];
        if (!recipe) continue;
        for (const [ref, perPack] of recipe) {
          const meta = COMP_BY_REF[ref];
          ledger.push({ date, code: ref, type: meta?.type || "PKG", txn: "consume", qty: q * perPack });
        }
      }
    }
  }
}

// ─── §3d — Parse Daily Movement ─────────────────────────────────
// Daily Movement is OPTIONAL (same rationale as Production). Missing → no-op.
function parseDailyMovement(wb, state) {
  const sheet = wb.Sheets["Daily Movement of FG"];
  if (!sheet) { state.flags.notes.push({ source: "daily-mvmt", note: "no Daily Movement of FG sheet — skipped" }); return; }
  const { flags, ledger } = state;
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
  for (let i = 0; i < grid.length; i++) {
    const a = grid[i][0];
    if (typeof a !== "string" || !/^on /i.test(a)) continue;
    const dateText = a.replace(/^on\s+/i, "").trim();
    const date = xlDate(dateText);
    if (!date) { flags.notes.push({ source: "daily-mvmt", note: `unparseable date: ${a}` }); continue; }
    // Item rows: 14 rows starting at i+2 (i+1 is the channel column-header row)
    for (let j = 2; j <= 15; j++) {
      const row = grid[i + j];
      if (!row || !row[0]) continue;
      const nm = norm(row[0]);
      const code = FG_ALIASES[nm];
      if (!code) { flags.unmapped_names.push({ source: "daily-mvmt", name: String(row[0]) }); continue; }
      // Stock-Out: B..G = cols 1..6  | Stock-In: H..M = cols 7..12
      // Channels order: Amazon, Flipkart, Blinkit, Website, Offline, Marketing
      const channels = ["amazon","flipkart","blinkit","website","offline","marketing"];
      let outTotal = 0, inTotal = 0;
      const outBy = {}, inBy = {};
      for (let k = 0; k < 6; k++) {
        const out = +row[1 + k] || 0;
        const ret = +row[7 + k] || 0;
        outBy[channels[k]] = out; inBy[channels[k]] = ret;
        outTotal += out; inTotal += ret;
      }
      if (outTotal > 0) ledger.push({ date, code, type: "FG", txn: "ship_out", qty: outTotal, by: outBy });
      if (inTotal  > 0) ledger.push({ date, code, type: "FG", txn: "return_in", qty: inTotal, by: inBy });
    }
  }
}

// ─── §5 — Compute balances (roll forward strictly after anchor) ─
function computeBalances(state) {
  const { ledger, flags } = state;
  const ANCHOR_DATE = state.anchorDate;
  const balance = {};
  // Seed with audit_open at anchor (these are dated == ANCHOR_DATE)
  for (const e of ledger) {
    if (e.txn === "audit_open") balance[e.code] = (balance[e.code] || 0) + e.qty;
  }
  for (const e of ledger) {
    if (e.txn === "audit_open") continue;
    if (e.date.getTime() <= ANCHOR_DATE.getTime()) continue; // STRICTLY after
    const sign = (e.txn === "produce" || e.txn === "produce_sfg" || e.txn === "return_in") ? +1 : -1;
    balance[e.code] = (balance[e.code] || 0) + sign * e.qty;
  }
  // Flag negatives
  for (const [code, q] of Object.entries(balance)) {
    if (q < 0) flags.negative_stock.push({ code, qty: q });
  }
  return balance;
}

// ─── §6 — Metrics per SKU ───────────────────────────────────────
function computeMetrics(state, balance, asOf) {
  const { ledger, oldFG, oldComp, openingComp } = state;
  const window30Start = new Date(asOf); window30Start.setUTCDate(window30Start.getUTCDate() - W30 + 1);
  const window60Start = new Date(asOf); window60Start.setUTCDate(window60Start.getUTCDate() - W60 + 1);
  const priorStart    = new Date(asOf); priorStart.setUTCDate(priorStart.getUTCDate() - W60 + 1);
  const priorEnd      = new Date(asOf); priorEnd.setUTCDate(priorEnd.getUTCDate() - W30);

  const fgRows = [];
  for (const sku of SKUS) {
    const code = sku.code;
    const fgStock = Math.max(0, balance[code] || 0);
    // Producible
    let producible = Infinity, binding = null, bindingMissing = false;
    for (const [ref, perPack] of (BOM[code] || [])) {
      const cs = Math.max(0, balance[ref] || 0);
      const cap = Math.floor(cs / perPack);
      if (cap < producible) { producible = cap; binding = ref; bindingMissing = cs === 0 && !(ref in openingComp); }
    }
    if (producible === Infinity) producible = 0;
    const totalAvail = fgStock + producible;

    // Velocity (depletion = gross_out - returns; sales = depletion - marketing_out)
    let gross30 = 0, gross60 = 0, gross_prior30 = 0;
    let ret30 = 0, ret60 = 0, ret_prior30 = 0;
    let mkt30 = 0;
    for (const e of ledger) {
      if (e.code !== code) continue;
      if (e.txn !== "ship_out" && e.txn !== "return_in") continue;
      const t = e.date.getTime();
      const w30 = t >= window30Start.getTime() && t <= asOf.getTime();
      const w60 = t >= window60Start.getTime() && t <= asOf.getTime();
      const wp  = t >= priorStart.getTime() && t <= priorEnd.getTime();
      if (e.txn === "ship_out") {
        if (w30) gross30 += e.qty;
        if (w60) gross60 += e.qty;
        if (wp)  gross_prior30 += e.qty;
        if (w30) mkt30 += (e.by?.marketing || 0);
      } else {
        if (w30) ret30 += e.qty;
        if (w60) ret60 += e.qty;
        if (wp)  ret_prior30 += e.qty;
      }
    }
    const depletion30 = (gross30 - ret30) / W30;
    const sales30     = (gross30 - ret30 - mkt30) / W30;
    const runwayDays  = depletion30 > 0 ? Math.round(fgStock / depletion30) : null;

    // MoM growth: cur30 net units vs prior30 net units
    const cur30Net = gross30 - ret30;
    const prior30Net = gross_prior30 - ret_prior30;
    let mom = null;
    if (prior30Net > 0) mom = +((((cur30Net - prior30Net) / prior30Net) * 100).toFixed(1));
    else if (cur30Net > 0) mom = 200;
    // clamp ±200
    if (mom != null) mom = Math.max(-100, Math.min(200, mom));

    // Worst component cover (across BOM) — uses consumption velocity per component
    let worstComp = null, worstCover = Infinity;
    for (const [ref, perPack] of (BOM[code] || [])) {
      const cs = Math.max(0, balance[ref] || 0);
      // Rough consumption velocity: this SKU's sales velocity × perPack (other SKUs not yet folded — done in component pass)
      const vel = sales30 > 0 ? sales30 * perPack : 0;
      const cover = vel > 0 ? cs / vel : Infinity;
      if (cover < worstCover) { worstCover = cover; worstComp = ref; }
    }
    const worstCoverDays = Number.isFinite(worstCover) ? Math.round(worstCover) : null;

    // Reorder when out of sellable cover OR runway shorter than lead time.
    // (Was false when runwayDays===null, hiding stocked-out SKUs — R12.)
    const reorder = totalAvail <= 0 || (runwayDays != null && runwayDays < sku.leadDays);
    const stockValue = fgStock * sku.price;

    // Old stock — static side field (NOT in fgStock/sellable/runway). Per
    // founder: shown in the material-breakdown modal, excluded from runway.
    const oldStock = Math.max(0, oldFG[code] || 0);

    fgRows.push({
      code, name: sku.name, variant: sku.variant, price: sku.price, leadDays: sku.leadDays,
      fgStock, oldStock, producible, totalAvail, binding,
      sales30: +sales30.toFixed(3), depletion30: +depletion30.toFixed(3),
      runwayDays, momGrowth: mom, stockValue,
      worstComp, worstCoverDays, reorder,
    });
  }

  // Component metrics — consumption velocity = Σ over SKUs (sku sales30 × perPack)
  const compRows = [];
  for (const c of COMPONENTS) {
    let consumption = 0;
    const blocks = [];
    for (const sku of SKUS) {
      const recipe = BOM[sku.code];
      if (!recipe) continue;
      for (const [ref, perPack] of recipe) {
        if (ref !== c.ref) continue;
        const sv = fgRows.find(f => f.code === sku.code)?.sales30 || 0;
        consumption += sv * perPack;
      }
    }
    const stock = Math.max(0, balance[c.ref] || 0);
    const daysCover = consumption > 0 ? Math.round(stock / consumption) : null;
    const reorder = daysCover != null && daysCover < c.leadDays;
    // Which SKUs does this block? Any SKU where this is the binding component OR cover < sku.leadDays.
    for (const fg of fgRows) {
      const recipe = BOM[fg.code] || [];
      const usesIt = recipe.some(([r]) => r === c.ref);
      if (!usesIt) continue;
      if (fg.binding === c.ref || (daysCover != null && daysCover < fg.leadDays)) {
        blocks.push(fg.code);
      }
    }
    compRows.push({
      ref: c.ref, name: c.name, type: c.type, unit: c.unit, leadDays: c.leadDays,
      stock, oldStock: Math.max(0, oldComp[c.ref] || 0),
      consumption: +consumption.toFixed(3), daysCover, reorder, blocks,
    });
  }

  return { fgRows, compRows };
}

/**
 * parseCentralWhWorkbook — read an uploaded Central Warehouse xlsx File and
 * return the CENTRAL_WH_DATA shape.
 *
 * @param {File|Blob} file  uploaded workbook (browser File/Blob with arrayBuffer())
 * @param {object} [opts]   reserved for future options (currently unused)
 * @returns {Promise<object>} { anchorDate, anchorSheet, asOf, config, fg,
 *                              components, fixedAssets, consumables, flags }
 * @throws {Error} R-FAILLOUD: no Audit tab / missing sections / zero FG rows.
 */
export async function parseCentralWhWorkbook(file, opts = {}) {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new Error("Central Warehouse Workbook: no file provided (expected an uploaded .xlsx File).");
  }

  // Read the workbook from the uploaded bytes (browser path).
  let wb;
  try {
    const buf = await file.arrayBuffer();
    wb = XLSX.read(buf, { type: "array" });
  } catch (err) {
    throw new Error(`Central Warehouse Workbook: failed to read the xlsx file — ${err?.message || err}`);
  }
  if (!wb || !Array.isArray(wb.SheetNames) || wb.SheetNames.length === 0) {
    throw new Error("Central Warehouse Workbook: the file has no sheets — is it a valid .xlsx?");
  }

  // Per-call state (function-local — safe to call repeatedly).
  const newFG = {};    // code → qty (fresh, sellable)
  const oldFG = {};     // code → qty ('(old)' stock — shown, NOT counted in runway)
  const newComp = {};  // ref → qty
  const oldComp = {};   // ref → qty
  const state = {
    anchorDate: ANCHOR_DATE_DEFAULT,
    anchorSheet: ANCHOR_SHEET_DEFAULT,
    flags: {
      unmapped_names: [],
      unmapped_components: [],
      manual_review: [],
      unparsed_quantities: [],
      negative_stock: [],
      bom_gaps: [],
      notes: [],
    },
    ledger: [],
    newFG, oldFG, newComp, oldComp,
    fixedAssets: [],
    consumables: [],
    // Back-compat aliases the metric code reads from (mirror the CJS twin).
    openingFG: newFG,
    openingComp: newComp,
  };

  // ── Pipeline (mirrors build-central-wh.cjs main) ──
  parseAudit(wb, state);          // throws on structural failure (R-FAILLOUD)
  parseProduction(wb, state);     // optional
  parseDailyMovement(wb, state);  // optional

  // AS_OF = max date across Production + Daily Movement (≥ anchor).
  let asOf = state.anchorDate;
  for (const e of state.ledger) {
    if (e.txn === "audit_open") continue;
    if (e.date.getTime() > asOf.getTime()) asOf = e.date;
  }

  const balance = computeBalances(state);
  const { fgRows, compRows } = computeMetrics(state, balance, asOf);

  // Known BOM gaps per spec.
  const knownGaps = ["NSPKGJB300","NSPKGJTUB300","NSPKGJLBL300","NSPKGJTUB500","NSPKGJLBL500"];
  for (const ref of knownGaps) {
    if (!(ref in state.openingComp)) state.flags.bom_gaps.push({ ref, note: "no clean audit line — set to 0, founder must confirm juice packaging map" });
  }

  // SAFE FALLBACK: even though parseAudit guarantees ≥1 FG row, double-guard
  // the emitted FG map so the consumer never gets an empty object silently.
  const fgOut = Object.fromEntries((fgRows || []).map(r => [r.code, r]));
  const compOut = Object.fromEntries((compRows || []).map(r => [r.ref, r]));

  return {
    anchorDate: dateKey(state.anchorDate),
    anchorSheet: state.anchorSheet,
    asOf: dateKey(asOf),
    config: { MERGE_OLD_SB500, RANGE_RULE, W30, W60 },
    fg: fgOut,
    components: compOut,
    // Non-BOM audit lines, split per founder's request:
    //   fixedAssets = equipment + furniture (own section below materials)
    //   consumables = cartons, stickers, tape, rolls, caps (shown separately)
    fixedAssets: state.fixedAssets,
    consumables: state.consumables,
    flags: {
      unmappedNames: state.flags.unmapped_names.length,
      unmappedComponents: state.flags.unmapped_components.length,
      unparsedQuantities: state.flags.unparsed_quantities.length,
      manualReview: state.flags.manual_review.length,
      negativeStock: state.flags.negative_stock.length,
      bomGaps: state.flags.bom_gaps.length,
      detail: state.flags,
    },
  };
}

export default parseCentralWhWorkbook;
