#!/usr/bin/env node
/**
 * build-central-wh.cjs — implements docs/central-wh-spec.md exactly.
 *
 * Pipeline:
 *   1. Read Audit 050525 → opening balances (FG + SFG + RM + PKG)
 *   2. Read Production matrix → +FG (and +SFG for Acacia Tea Pouches)
 *      → emit component consumption per BOM
 *   3. Read Daily Movement of FG (73 blocks × 16 rows) → ship_out + return_in
 *   4. Roll forward STRICTLY AFTER anchor date
 *   5. Compute velocity / runway / producible / reorder / value / MoM per spec
 *   6. Emit src/bundledCentralWHData.js + data-quality summary
 *
 * Re-run: `node scripts/build-central-wh.cjs <path-to-xlsx>`
 */
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ─── Config ─────────────────────────────────────────────────────
// ANCHOR_DATE is now AUTO-DETECTED — the latest "Audit DDMMYY" sheet in the
// workbook (parsed from the sheet name; cross-checked against the "As of"
// text). See detectLatestAudit() below. `let` because it's assigned at runtime.
let ANCHOR_DATE = new Date("2026-05-05T00:00:00Z");
let ANCHOR_SHEET = "Audit 050525";
const MERGE_OLD_SB500 = true;
const RANGE_RULE = "first"; // first | sum | min | max
const W30 = 30, W60 = 60;
// Input workbook. P3-7: do NOT silently default to a stale "(2).xlsx" — a no-arg
// rebuild used to regenerate the committed artifact from an old file. Resolve the
// LATEST "Naturesum Live Inventory*.xlsx" in ~/Downloads by mtime; fail-loud
// (R-FAILLOUD) if none is found, so a rebuild can never silently use stale data.
function resolveLatestWorkbook() {
  try {
    const dir = path.join(os.homedir(), "Downloads");
    const cand = fs.readdirSync(dir)
      .filter((n) => /^Naturesum Live Inventory.*\.xlsx$/i.test(n))
      .map((n) => ({ p: path.join(dir, n), m: fs.statSync(path.join(dir, n)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    return cand[0]?.p || null;
  } catch { return null; }
}
const INPUT = process.argv[2] || resolveLatestWorkbook();
if (!INPUT || !fs.existsSync(INPUT)) {
  console.error("build-central-wh: no input workbook. Pass an explicit path:\n  node scripts/build-central-wh.cjs \"<path-to-Naturesum Live Inventory (N).xlsx>\"");
  process.exit(1);
}
const OUT_JS = path.join(__dirname, "..", "src", "bundledCentralWHData.js");

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
].map(s => norm(s))); // normalized through norm() so its rules (digit-unit split etc.) can never desync

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

// ─── D1 — NON-CONSTRAINING components ────────────────────────────
// Founder decision (FIX-SPEC D1): these BOM components are quickly/easily
// arranged (outer shipping cartons) and must NEVER be the producible
// bottleneck. They are still LISTED per-SKU for display (with a
// constrains:false flag) but are excluded from the producible min + binding.
//   NSPKGCB100 / NSPKGCB250 — Moringa shipping carton boxes.
// FOUNDER CORRECTION (2026-06 pass 4): juice AIR POUCHES (NSPKGJB300/JB500)
// DO constrain — real packing components with tracked audit stock ("Air
// pouches (300ML)"/"(500ML)"), not generic air-wrap. Removed from this set.
// Everything else in a BOM (raw materials, primary pouches, bottles, SFG,
// droppers/caps, outer product boxes, juice tube/label/air pouch) STAYS
// constraining.
const NON_CONSTRAINING = new Set([
  "NSPKGCB100", "NSPKGCB250",
]);

// ─── §2d — Normaliser + alias maps ──────────────────────────────
function norm(s) {
  if (s == null) return "";
  let x = String(s).toLowerCase();
  // remove . ( ) and the listed words
  x = x.replace(/[.()]/g, " ");
  // Pass 4 (R-FUZZY): split glued digit-unit tokens so "100gm" == "100 gm" ==
  // "100g" and "300ML" == "300 ml" — unit-suffix spelling must never decide a
  // match. (g/gm/gram/grams collapse to nothing below; ml/ltr stay.)
  x = x.replace(/(\d)([a-z])/g, "$1 $2");
  x = x.replace(/\b(pure|packed|g|gm|gram|grams)\b/g, " ");
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
  // FOUNDER CORRECTION (pass 4): "Juice containers (Package)" rows are the
  // juice TUBES (outer cylindrical container the bottle ships in), NOT the
  // glass bottles — they were misread as bottles. The glass bottles have no
  // packaging audit line (they appear filled under SEMI-FINISHED) → JBOT
  // refs are UNTRACKED, never phantom-zero-bound.
  "juice containers (package) 300ml":           "NSPKGJTUB300",
  "juice containers (package) 500ml":           "NSPKGJTUB500",
  // Juice AIR POUCHES — real packing components with tracked stock
  // ("Air pouches (300ML)" 910 / "(500ML)" 1000). The 0-stock "Large Air
  // pouch for juice(500 ml)" row maps to the same ref (duplicate flag fires).
  "air pouches (300ml)":                        "NSPKGJB300",
  "air pouches (500ml)":                        "NSPKGJB500",
  "large air pouch for juice (500 ml)":         "NSPKGJB500",
};
const COMPONENT_ALIASES = Object.fromEntries(Object.entries(COMPONENT_ALIASES_RAW).map(([k, v]) => [norm(k), v]));

// ─── R-FUZZY — tolerant alias resolution (pass 4; mirror of centralWhEngine) ──
// Slightly-altered item names ("Pouches"→"Pouch", "SB"→"Sea Buckthorn", word
// reorder) no longer silently drop rows. Exact-normalized match first; then a
// conservative fuzzy match on stemmed word tokens: NUMERIC tokens must match
// EXACTLY (300 never matches 500), Dice ≥ 0.8, unambiguous (margin ≥ 0.08).
// Every fuzzy hit is FLAGGED (flags.fuzzy_matched) — tolerant, never silent.
function stemTok(t) {
  if (/\d/.test(t)) return t;
  if (t.length > 3 && t.endsWith("es")) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}
function tokSet(s) { return new Set(norm(s).split(" ").filter(Boolean).map(stemTok)); }
function numSig(s) { return (String(s).match(/\d+/g) || []).sort().join(","); }
function fuzzyResolve(nm, table) {
  const A = tokSet(nm), an = numSig(nm);
  let bestKey = null, best = 0, second = 0;
  for (const k of Object.keys(table)) {
    if (numSig(k) !== an) continue;
    const B = tokSet(k);
    let inter = 0;
    for (const t of A) if (B.has(t)) inter++;
    const score = (2 * inter) / (A.size + B.size);
    if (score > best) { second = best; best = score; bestKey = k; }
    else if (score > second) second = score;
  }
  if (bestKey && best >= 0.8 && best - second >= 0.08) {
    return { key: bestKey, ref: table[bestKey], score: Math.round(best * 100) / 100 };
  }
  return null;
}
function resolveAlias(nm, table, source, rawName) {
  const exact = table[nm];
  if (exact) return exact;
  const fz = fuzzyResolve(nm, table);
  if (fz) {
    flags.fuzzy_matched.push({ source, name: String(rawName ?? nm), matchedKey: fz.key, ref: fz.ref, score: fz.score });
    return fz.ref;
  }
  return undefined;
}

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

// ─── Parse helpers ──────────────────────────────────────────────
const wb = XLSX.readFile(INPUT);
const flags = {
  unmapped_names: [],
  unmapped_components: [],
  manual_review: [],
  unparsed_quantities: [],
  negative_stock: [],
  bom_gaps: [],
  // Same component ref appearing on >1 audit row (often the same physical
  // material listed under two sections, e.g. "SB Oil" under both RAW MATERIALS
  // and SEMI-FINISHED GOODS → summed to 5.6L when it is one 2.8L drum). We sum
  // by default but FLAG it so the founder can confirm rather than silently
  // double-count. R-FAILLOUD / fail-loud mandate.
  duplicate_component_rows: [],
  fuzzy_matched: [],              // R-FUZZY: tolerant alias hits (audited, never silent)
  offline_marketing_spike: [],   // founder: flag unusual offline/marketing outflow
  notes: [],
};
const ledger = [];
// FG: separate new (sellable) vs old (excluded from runway per founder).
const newFG = {};    // code → qty (fresh, sellable)
const oldFG = {};     // code → qty ('(old)' stock — shown, NOT counted in runway)
// Components: new + old both usable for producing → summed for stock,
// but old tracked separately for the modal.
const newComp = {};  // ref → qty
const oldComp = {};   // ref → qty
// Track every audit row that maps to a component ref → FLAG duplicate lines
// (same material under two sections) instead of silently summing them.
const compRowOccurrences = {};   // ref → [{ section, name, qty }]
// Non-BOM audit lines, split into the two display buckets.
const fixedAssets   = [];  // { name, qty, unit }
const consumables   = [];  // { name, qty, unit } — cartons, stickers, tape...
// Back-compat aliases the rest of the script reads from.
const openingFG = newFG;
const openingComp = newComp;

// ─── D7 — Robust latest-audit detection ─────────────────────────
// Pick the SINGLE latest-dated audit sheet, robust to the naming convention
// shifting on a future upload. For every sheet whose NAME contains "audit"
// (in any case) we try to parse a date from the name in several formats
// (DDMMYY run-together, DD-MM-YY, DD/MM/YYYY, or "5th June 2026" words) and
// ALSO read the "As of <date>" cell (row ~2, col A). We pick the larger of the
// two dates as the sheet's effective date, then choose the sheet with the max
// effective date across all candidates.
//
// Tie / quality handling:
//   - Detailed "V-2"/"V2"/"V-<n>" variants and the partial leading-space
//     " warehouse inventory" sheet are DOWN-RANKED: on an equal effective date
//     they lose to a clean primary audit, and they are only ever chosen when
//     STRICTLY newer than every clean candidate.
// R-FAILLOUD (FIX-SPEC D7): return null when NO audit sheet is detectable so
// the caller can throw — never silently fall back to a stale anchor.
const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
function monthIndex(word) {
  if (!word) return -1;
  return MONTHS.findIndex(x => word.toLowerCase().startsWith(x));
}
function mkUTC(yy, mm, dd) {
  if (!(mm >= 1 && mm <= 12) || !(dd >= 1 && dd <= 31)) return null;
  if (yy < 100) yy += 2000;
  const d = new Date(Date.UTC(yy, mm - 1, dd));
  return isNaN(d.getTime()) ? null : d;
}
// Parse a date out of free text (sheet name or "As of" cell). Tries, in order:
//   words ("5th June 2026"), DD-MM-YY[YY] / DD/MM/YY[YY] / DD.MM.YY[YY],
//   then a run-together DDMMYY (6 digits) or DDMMYYYY (8 digits).
function parseFlexibleDate(text) {
  if (!text) return null;
  const s = String(text).trim();
  // 1) "5th June, 2026" / "5 jun 2026" (day month year, words)
  let m = s.match(/(\d{1,2})(?:st|nd|rd|th)?[\s,]+([a-z]{3,})[\s,]+(\d{2,4})/i);
  if (m) { const mi = monthIndex(m[2]); if (mi >= 0) { const d = mkUTC(+m[3], mi + 1, +m[1]); if (d) return d; } }
  // 1b) "June 5, 2026" (month day year, words)
  m = s.match(/([a-z]{3,})[\s,]+(\d{1,2})(?:st|nd|rd|th)?[\s,]+(\d{2,4})/i);
  if (m) { const mi = monthIndex(m[1]); if (mi >= 0) { const d = mkUTC(+m[3], mi + 1, +m[2]); if (d) return d; } }
  // 2) DD-MM-YY[YY] / DD/MM/YY[YY] / DD.MM.YY[YY] (founder always DD-MM)
  m = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) { const d = mkUTC(+m[3], +m[2], +m[1]); if (d) return d; }
  // 3) run-together DDMMYY (6 digits) or DDMMYYYY (8 digits)
  m = s.match(/(?<!\d)(\d{2})(\d{2})(\d{2})(?!\d)/);
  if (m) { const d = mkUTC(+m[3], +m[2], +m[1]); if (d) return d; }
  m = s.match(/(?<!\d)(\d{2})(\d{2})(\d{4})(?!\d)/);
  if (m) { const d = mkUTC(+m[3], +m[2], +m[1]); if (d) return d; }
  return null;
}
function detectLatestAudit() {
  const candidates = [];
  for (const name of wb.SheetNames) {
    if (!/audit/i.test(name)) continue;                       // name must say "audit"
    const nameDate = parseFlexibleDate(name);
    // Cross-check the "As of <date>" cell (scan the first few rows of col A).
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", raw: true });
    let cellDate = null;
    for (let r = 0; r < 4 && !cellDate; r++) {
      const txt = String(grid[r]?.[0] || "");
      if (/as of/i.test(txt) || /\d/.test(txt)) cellDate = parseFlexibleDate(txt) || cellDate;
    }
    // Effective date = the MAX of name-date and cell-date (D7: cross-check,
    // choose max). At least one must parse for the sheet to be a candidate.
    const date = (nameDate && cellDate)
      ? (nameDate.getTime() >= cellDate.getTime() ? nameDate : cellDate)
      : (nameDate || cellDate);
    if (!date) continue;                                       // un-dateable → skip
    // Down-rank detailed variants ("V-2"/"V2") and the partial " warehouse
    // inventory" recount so a clean primary audit wins on an equal date.
    const isVariant = /v-?\d/i.test(name) || /warehouse\s+inventory/i.test(name);
    candidates.push({ name, date, isVariant });
  }
  if (!candidates.length) return null;                         // R-FAILLOUD signal
  candidates.sort((a, b) => {
    if (b.date.getTime() !== a.date.getTime()) return b.date.getTime() - a.date.getTime();
    return (a.isVariant ? 1 : 0) - (b.isVariant ? 1 : 0);     // clean before variant on tie
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
function parseAudit() {
  const detected = detectLatestAudit();
  // R-FAILLOUD (FIX-SPEC D7): no detectable audit sheet → throw, never fall
  // back to a stale hardcoded anchor (which would emit silently-wrong stock).
  if (!detected) {
    throw new Error(
      'Central Warehouse Workbook: no Audit sheet detectable — expected a sheet whose name contains "audit" with a parseable date ' +
      '(e.g. "Audit 050626", "Audit 05-06-26", or an "As of <date>" cell). ' +
      `Sheets present: ${wb.SheetNames.join(", ") || "(none)"}.`
    );
  }
  ANCHOR_SHEET = detected.name;
  ANCHOR_DATE  = detected.date;
  const grid = XLSX.utils.sheet_to_json(wb.Sheets[ANCHOR_SHEET], { header: 1, defval: "", raw: true });
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
      const code = resolveAlias(nm, FG_ALIASES, "audit-FG", bRaw);
      if (!code) { flags.unmapped_names.push({ source: "audit-FG", name: bRaw }); continue; }
      // FK-shipment FG → counts as fresh central-WH FG (founder: team will
      // move it into FG; Daily Movement deducts it when it actually ships).
      if (isOld && !isFkShipment) oldFG[code] = (oldFG[code] || 0) + cq.qty;
      else                        newFG[code] = (newFG[code] || 0) + cq.qty;
      continue;
    }

    // SFG / RM / PKG — classify into BOM component | fixed asset | consumable.
    // R-FUZZY: exact alias first, conservative fuzzy fallback (flagged).
    const ref = resolveAlias(nm, COMPONENT_ALIASES, `audit-${section}`, bRaw);
    if (ref) {
      // Track every audit row that maps to this ref so we can FLAG duplicate
      // lines (same material under two sections) instead of silently summing.
      const occ = (compRowOccurrences[ref] || (compRowOccurrences[ref] = []));
      occ.push({ section, name: bRaw, qty: cq.qty });
      if (occ.length === 2) flags.duplicate_component_rows.push({ ref, rows: occ.slice() });
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
}

// ─── §3c — Parse Production ─────────────────────────────────────
function parseProduction() {
  const grid = XLSX.utils.sheet_to_json(wb.Sheets["Production"], { header: 1, defval: "", raw: true });
  const header = grid[0];
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
    // R-FUZZY: exact alias first, conservative fuzzy fallback (flagged).
    let code = resolveAlias(nm, FG_ALIASES, "production", itemRaw);
    let isSfg = false;
    if (!code) {
      code = resolveAlias(nm, SFG_PRODUCTION_ALIASES, "production-sfg", itemRaw);
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
function parseDailyMovement() {
  const grid = XLSX.utils.sheet_to_json(wb.Sheets["Daily Movement of FG"], { header: 1, defval: "", raw: true });
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
      // R-FUZZY: exact alias first, conservative fuzzy fallback (flagged).
      const code = resolveAlias(nm, FG_ALIASES, "daily-mvmt", row[0]);
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
function computeBalances() {
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
  // M4 — absorb FG ship-out overshoot into the OLD bucket, THEN flag negatives.
  // When a finished-good's NEW/sellable balance rolls below 0 after the audit, it
  // means OLD stock was physically shipped (per founder: the dry-berry lines were
  // a compromise sale of old stock and are now discontinued). Deplete oldFG by
  // the shortfall so (a) the displayed old-stock + value reflect reality and
  // (b) we don't raise a phantom negative-stock flag. Only flag a genuine
  // negative when BOTH new and old are exhausted (a true over-ship).
  for (const [code, q] of Object.entries(balance)) {
    if (q >= 0) continue;
    const isFG = SKU_CODES.has(code);
    const oldAvail = isFG ? Math.max(0, oldFG[code] || 0) : 0;
    if (isFG && oldAvail > 0) {
      const shortfall = -q;
      const fromOld = Math.min(shortfall, oldAvail);
      oldFG[code] = oldAvail - fromOld;           // old stock was sold → deplete it
      balance[code] = q + fromOld;                // move toward 0 (clamped ≥0 at display)
      if (balance[code] < -1e-9) {
        flags.negative_stock.push({ code, qty: balance[code], note: "new+old exhausted" });
      }
    } else {
      flags.negative_stock.push({ code, qty: q });
    }
  }
  return balance;
}

// ─── §6 — Metrics per SKU ───────────────────────────────────────
function computeMetrics(balance, asOf) {
  const window30Start = new Date(asOf); window30Start.setUTCDate(window30Start.getUTCDate() - W30 + 1);
  const window60Start = new Date(asOf); window60Start.setUTCDate(window60Start.getUTCDate() - W60 + 1);
  const priorStart    = new Date(asOf); priorStart.setUTCDate(priorStart.getUTCDate() - W60 + 1);
  const priorEnd      = new Date(asOf); priorEnd.setUTCDate(priorEnd.getUTCDate() - W30);

  const fgRows = [];
  for (const sku of SKUS) {
    const code = sku.code;
    const fgStock = Math.max(0, balance[code] || 0);
    // ─── D1 — Producible over CONSTRAINING BOM components only ──────
    // producible = min over BOM components NOT in NON_CONSTRAINING of
    // floor(stock / perPack). Non-constraining components (cartons + juice air
    // pouches) are still LISTED in bomDetail with constrains:false but can
    // never cap producible nor become the binding component.
    let producible = Infinity, binding = null, bindingMissing = false;
    const bomDetail = [];
    for (const [ref, perPack] of (BOM[code] || [])) {
      const cs = Math.max(0, balance[ref] || 0);                 // D3: old already folded into balance via audit_open; clamp ≥0
      const cap = perPack > 0 ? Math.floor(cs / perPack) : Infinity;
      const constrains = !NON_CONSTRAINING.has(ref);
      const untracked = untrackedComponents.has(ref);            // no audit line — stock UNKNOWN, not zero
      bomDetail.push({ ref, perPack, stock: cs, cap: Number.isFinite(cap) ? cap : null, constrains, untracked });
      if (!constrains) continue;                                 // never the bottleneck
      if (untracked) continue;                                   // phantom-zero guard: unknown can't bind
      if (cap < producible) { producible = cap; binding = ref; bindingMissing = cs === 0 && !(ref in openingComp); }
    }
    if (producible === Infinity) producible = 0;                 // SAFE: no constraining component → 0
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

    // ─── Monthly sales buckets (ADDITIVE — raw data only) ───────────
    // Up to 4 trailing 30-day windows back from asOf. Per window, SALES =
    // ship_out total − return_in total − marketing ship_out (central-WH
    // movement). NOTE: founder says this central-WH movement is NOT a good
    // consumption signal, so NOTHING here feeds velocity/runway/growth —
    // it is emitted purely as `monthly` for downstream inspection. Channel
    // max-MoM is computed elsewhere (data.js) from real sales sources.
    // Most-recent first; only windows with movement data are included.
    let monthly = [];
    try {
      const buckets = [0, 0, 0, 0];           // m0..m3 net sales units
      const hasData = [false, false, false, false];
      const asOfT = asOf.getTime();
      const DAY = 86400000;
      for (const e of ledger) {
        if (e.code !== code) continue;
        if (e.txn !== "ship_out" && e.txn !== "return_in") continue;
        // Days back from asOf: 0 == asOf itself. Bucket b covers
        // [asOf-(30b+29) .. asOf-30b] → b = floor(daysBack / 30).
        const daysBack = Math.round((asOfT - e.date.getTime()) / DAY);
        if (daysBack < 0) continue;            // future-dated guard
        const b = Math.floor(daysBack / W30);
        if (b < 0 || b > 3) continue;          // only the 4 trailing months
        hasData[b] = true;
        if (e.txn === "ship_out") {
          buckets[b] += (e.qty - (e.by?.marketing || 0));
        } else {
          buckets[b] -= e.qty;
        }
      }
      // Most-recent first; include only windows that actually had movement.
      monthly = buckets
        .map((v, b) => ({ v, b }))
        .filter(x => hasData[x.b])
        .map(x => {
          const n = Math.round(x.v);
          return Number.isFinite(n) ? n : 0;
        });
    } catch (_e) {
      monthly = [];                            // SAFE FALLBACK — never throw
    }

    // Worst component cover (across CONSTRAINING BOM components only — D1).
    // Non-constraining components (cartons/air pouches) are quickly arranged so
    // they must not drive the SKU's worst-cover bottleneck either.
    let worstComp = null, worstCover = Infinity;
    for (const [ref, perPack] of (BOM[code] || [])) {
      if (NON_CONSTRAINING.has(ref)) continue;
      if (untrackedComponents.has(ref)) continue;   // unknown stock can't drive worst-cover
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
      // D1: per-component BOM detail with constrains flag (cartons + juice air
      // pouches are constrains:false — listed for display, never bottleneck).
      bomDetail: Array.isArray(bomDetail) ? bomDetail : [],
      sales30: +sales30.toFixed(3), depletion30: +depletion30.toFixed(3),
      runwayDays, momGrowth: mom, stockValue,
      // ADDITIVE raw data: up to 4 trailing 30-day central-WH sales buckets,
      // most-recent first. Not consumed by velocity/runway/growth (see above).
      monthly: Array.isArray(monthly) ? monthly : [],
      worstComp, worstCoverDays, reorder,
    });
  }

  // Component metrics — consumption velocity = Σ over SKUs (sku sales30 × perPack)
  // NOTE: this is the engine's MOVEMENT-based estimate. data.js OVERRIDES it with
  // the SALES-based consumption (§3.5) for the UI; this value is kept only for
  // the engine's standalone snapshot. Clamp ≥0 so a net-negative movement window
  // (returns > ship-outs) never leaks a negative consumption / NaN cover.
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
    consumption = Math.max(0, consumption);
    // D8: deplete-only stock — balance[ref] is the audit baseline minus
    // post-audit production consumption (no inbound/PO sheet), clamped ≥0.
    const stock = Math.max(0, balance[c.ref] || 0);
    const daysCover = consumption > 0 ? Math.round(stock / consumption) : null;
    // D6: reorder flag = daysCover < leadDays (own lead time). Kept for ALL
    // components incl. non-constraining (you still reorder cartons) — but a
    // non-constraining component can NEVER block production (D1), so it is
    // excluded from `blocks`.
    const untracked = untrackedComponents.has(c.ref);
    // Untracked (no audit line) → stock is UNKNOWN, not zero: no cover, no
    // reorder pressure, no blocking — flagged for the founder to add a row.
    const reorder = !untracked && daysCover != null && daysCover < c.leadDays;
    const constrains = !NON_CONSTRAINING.has(c.ref);            // D1 flag
    // Which SKUs does this block? Only CONSTRAINING components block: a SKU
    // where this is the binding component OR cover < sku.leadDays.
    if (constrains && !untracked) {
      for (const fg of fgRows) {
        const recipe = BOM[fg.code] || [];
        const usesIt = recipe.some(([r]) => r === c.ref);
        if (!usesIt) continue;
        if (fg.binding === c.ref || (daysCover != null && daysCover < fg.leadDays)) {
          blocks.push(fg.code);
        }
      }
    }
    compRows.push({
      ref: c.ref, name: c.name, type: c.type, unit: c.unit, leadDays: c.leadDays,
      stock, oldStock: Math.max(0, oldComp[c.ref] || 0),
      consumption: +consumption.toFixed(3),
      daysCover: untracked ? null : daysCover,
      reorder, constrains, untracked, blocks,
    });
  }

  return { fgRows, compRows };
}

// ─── Main ───────────────────────────────────────────────────────
console.log("Reading:", INPUT);
parseAudit();
parseProduction();
parseDailyMovement();

// AS_OF = max date across Production + Daily Movement
let asOf = ANCHOR_DATE;
for (const e of ledger) {
  if (e.txn === "audit_open") continue;
  if (e.date.getTime() > asOf.getTime()) asOf = e.date;
}
console.log("ANCHOR_DATE:", dateKey(ANCHOR_DATE), "  AS_OF:", dateKey(asOf));

// UNTRACKED BOM components (pass 4 — generalises the old hardcoded knownGaps
// list): any BOM ref with NO audit line at all (neither new nor old). Per the
// phantom-zero rule, "no data" != "zero": untracked components are flagged +
// EXCLUDED from producible binding rather than binding everything to 0.
// MUST run BEFORE computeMetrics (the binding exclusion reads this set).
const untrackedComponents = new Set();
{
  const seen = new Set();
  for (const code of Object.keys(BOM)) {
    for (const [ref] of BOM[code]) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      if (!(ref in openingComp) && !(ref in oldComp)) {
        untrackedComponents.add(ref);
        flags.bom_gaps.push({ ref, note: "no audit line — stock UNKNOWN (not zero); excluded from producible binding, founder to add an audit row" });
      }
    }
  }
}

const balance = computeBalances();
const { fgRows, compRows } = computeMetrics(balance, asOf);

// Offline/Marketing spike flag — see centralWhEngine.js for rationale. Offline+
// marketing outflow is excluded from runway velocity but still depletes WH FG;
// flag a SKU whose last-30d offline+marketing is ≥ FLOOR and > RATIO× prior 30d.
const OFFMKT_SPIKE_FLOOR = 20, OFFMKT_SPIKE_RATIO = 2;
{
  const cur0 = asOf.getTime() - 29 * 86400000, curEnd = asOf.getTime();
  const pri0 = asOf.getTime() - 59 * 86400000, priEnd = asOf.getTime() - 30 * 86400000;
  const acc = {};
  for (const e of ledger) {
    if (e.txn !== "ship_out" || !e.by) continue;
    const om = (e.by.offline || 0) + (e.by.marketing || 0);
    if (om <= 0) continue;
    const t = e.date.getTime();
    if (!acc[e.code]) acc[e.code] = { recent: 0, prior: 0 };
    if (t >= cur0 && t <= curEnd) acc[e.code].recent += om;
    else if (t >= pri0 && t <= priEnd) acc[e.code].prior += om;
  }
  for (const [code, { recent, prior }] of Object.entries(acc)) {
    if (recent >= OFFMKT_SPIKE_FLOOR && recent > OFFMKT_SPIKE_RATIO * Math.max(prior, 1)) {
      flags.offline_marketing_spike.push({ code, recent, prior,
        note: `offline+marketing outflow ${recent}u last 30d vs ${prior}u prior 30d — excluded from runway velocity; verify it isn't masking real demand` });
    }
  }
}

// Emit bundled JS file
const out = `/**
 * bundledCentralWHData.js — auto-generated by scripts/build-central-wh.cjs
 * Source: Naturesum_Live_Inventory workbook.
 * Spec: docs/central-wh-spec.md.
 *
 * DO NOT hand-edit. Regenerate via:
 *   node scripts/build-central-wh.cjs <path-to-xlsx>
 *
 * Anchor: ${dateKey(ANCHOR_DATE)} (audit sheet "${ANCHOR_SHEET}"). As-of: ${dateKey(asOf)}.
 */
export const CENTRAL_WH_DATA = ${JSON.stringify({
  anchorDate: dateKey(ANCHOR_DATE),
  anchorSheet: ANCHOR_SHEET,
  asOf: dateKey(asOf),
  config: { MERGE_OLD_SB500, RANGE_RULE, W30, W60 },
  // D1: components that can never be the producible bottleneck (cartons + juice
  // air pouches). Mirrors the NON_CONSTRAINING set in the engine; emitted so
  // data.js / the UI can label them consistently.
  nonConstraining: [...NON_CONSTRAINING],
  // Pass 4 — BOM refs with NO audit line anywhere (stock UNKNOWN, not zero).
  untrackedComponents: [...untrackedComponents],
  fg: Object.fromEntries(fgRows.map(r => [r.code, r])),
  components: Object.fromEntries(compRows.map(r => [r.ref, r])),
  // Non-BOM audit lines, split per founder's request:
  //   fixedAssets = equipment + furniture (own section below materials)
  //   consumables = cartons, stickers, tape, rolls, caps (shown separately)
  fixedAssets,
  consumables,
  flags: {
    unmappedNames: flags.unmapped_names.length,
    unmappedComponents: flags.unmapped_components.length,
    unparsedQuantities: flags.unparsed_quantities.length,
    manualReview: flags.manual_review.length,
    negativeStock: flags.negative_stock.length,
    bomGaps: flags.bom_gaps.length,
    duplicateComponentRows: flags.duplicate_component_rows.length,
    fuzzyMatched: flags.fuzzy_matched.length,
    offlineMarketingSpike: flags.offline_marketing_spike.length,
    detail: flags,
  },
}, null, 2)};
`;
fs.writeFileSync(OUT_JS, out);
console.log("Wrote:", OUT_JS);

// ─── Summary printout ───────────────────────────────────────────
console.log();
console.log("=== FG dashboard (per spec §6) ===");
console.log("code      | fg+prod = total | binding       | dep/d  | run d | MoM%   | val (₹)");
for (const r of fgRows) {
  console.log(
    r.code.padEnd(10) + "| " +
    String(r.fgStock).padStart(4) + " + " + String(r.producible).padStart(5) + " = " + String(r.totalAvail).padStart(5) + " | " +
    (r.binding || "—").padEnd(13) + " | " +
    String(r.depletion30.toFixed(2)).padStart(5) + " | " +
    (r.runwayDays == null ? "  ∞ " : String(r.runwayDays).padStart(4)) + " | " +
    (r.momGrowth == null ? "  — " : (r.momGrowth > 0 ? "+" : "") + r.momGrowth.toFixed(1) + "%").padStart(6) + " | " +
    r.stockValue.toLocaleString("en-IN")
  );
}
console.log();
console.log("=== Data-quality flags ===");
console.log("  unmapped_names:", flags.unmapped_names.length);
console.log("  unmapped_components:", flags.unmapped_components.length);
console.log("  unparsed_quantities:", flags.unparsed_quantities.length);
console.log("  manual_review:", flags.manual_review.length, flags.manual_review.length ? "(" + flags.manual_review.map(m => `${m.name}=${m.raw}→${m.picked}`).join("; ") + ")" : "");
console.log("  negative_stock:", flags.negative_stock.length, flags.negative_stock.length ? JSON.stringify(flags.negative_stock) : "");
console.log("  bom_gaps:", flags.bom_gaps.length);
if (flags.unmapped_names.length) {
  const unique = [...new Set(flags.unmapped_names.map(u => u.name))];
  console.log("  unique unmapped names (first 10):", unique.slice(0, 10));
}
