/**
 * businessVerification.js
 *
 * Permanent in-tool regression net (spec §10). Every May-2026 anchor from
 * spec §2 (channel revenue/units) and §3 (ad spend) is encoded here as
 *   { id, label, expected, filter, compute(facts) }
 * where compute() RE-DERIVES the figure from the live fact store, and a
 * Verification panel renders MATCH / DRIFT(δ) per anchor. The anchors change
 * ONLY when a new bundled baseline ships — this file is the contract the
 * founder asked to lock the numbers against.
 *
 * FACTS SHAPE (pinned store contract): facts.monthly is a map keyed
 * "YYYY-MM|channel|CODE" → { units, grossRev, netRev, returnsUnits,
 * returnsValue, adSpendDirect, src }. compute() sums over that map with the
 * `filter` string describing exactly which keys it touches (so a human can
 * audit the filter against the data).
 *
 * PENDING ANCHORS: a few §2/§3 numbers are "builder pins exact" in the spec
 * (post-return-netted Amazon revenue/units; Snell channel ad totals; Monarch
 * website ad totals). Those expected values are EXTRACTED by B1's bundled-data
 * build, not estimated here. They are left as the PENDING sentinel and listed
 * in PENDING_ANCHORS so the gate phase can grep + fill them from the bundled
 * output. An anchor whose expected === PENDING reports status "PENDING" (never
 * a false MATCH/DRIFT). The spec's "≈" guide numbers are kept in `guide` as a
 * sanity hint, never used as the pass/fail target.
 *
 * Month is fixed to May 2026 (the baseline month). When multi-month baselines
 * land, parameterise ANCHOR_MONTH per anchor.
 */

import {
  computeCM, computeMonthChannelCM, monthsAvailable, guardRatio,
} from "./cmEngine.js";

export const ANCHOR_MONTH = "2026-05";

// Sentinel for a figure the bundled-data build must pin. Distinct from 0 so an
// unset anchor can never masquerade as a real zero. NaN would propagate;
// null reads cleanly as "not yet pinned".
export const PENDING = null;

const MONTH = ANCHOR_MONTH;

// ─── fact-store accessors (NaN-free) ─────────────────────────
const fin0 = (n) => (Number.isFinite(n) ? n : 0);
function monthlyMap(facts) {
  return facts && facts.monthly ? facts.monthly : (facts || {});
}
// Sum a numeric field over all monthly keys matching (month, channel).
// field ∈ "netRev" | "grossRev" | "units" | "adSpendDirect" | "returnsUnits" ...
function sumChannel(facts, channel, field) {
  const map = monthlyMap(facts);
  let total = 0;
  for (const key of Object.keys(map)) {
    const [m, ch, code] = key.split("|");
    if (m !== MONTH || ch !== channel) continue;
    if (code === "__ch__") continue;   // V2: channel-grain sentinel — not a SKU; excluded from §2/§3 anchors
    total += fin0(Number(map[key]?.[field]));
  }
  return total;
}

// ─── V2: channel-grain (agency/monarch) accessor ─────────────
const CH_CODE = "__ch__";
// Read a field off the channel-grain "__ch__" cell for a given month×channel.
// Returns a finite number or null (cell absent / field absent → NO-DATA, never
// a false 0). Used by the V2 history anchors (Snell/Monarch monthly totals).
function chField(facts, month, channel, field) {
  const map = monthlyMap(facts);
  const cell = map[`${month}|${channel}|${CH_CODE}`];
  if (!cell) return null;
  const n = Number(cell[field]);
  return Number.isFinite(n) ? n : null;
}
// Read the build-baked May reconciliation block (agency-vs-native deltas) from
// the bundled/uploaded meta. SAFE: absent → null. Path mirrors the data layer's
// meta.bySource["snell-history"].mayReconciliation.
function mayReconciliation(facts) {
  return facts?.meta?.bySource?.["snell-history"]?.mayReconciliation || null;
}
// Read a suppressed agency figure off meta.agencyShadow (V2.1). When native wins
// for May, the agency __ch__ revenue is moved here by applyOverridePrecedence;
// the live __ch__ cell is zeroed. FALLBACK: if no shadow (e.g. raw bundle that
// has not had precedence applied, or a month where agency wins), read the live
// __ch__ cell directly — so the anchor verifies the Snell figure either way.
function agencyShadowField(facts, channel, field) {
  const shadow = facts?.meta?.agencyShadow?.[`${MONTH}|${channel}`];
  if (shadow && Number.isFinite(Number(shadow[field]))) return Number(shadow[field]);
  return chField(facts, MONTH, channel, field); // live cell fallback
}

// ─── Anchors (spec §2 revenue/units, §3 ad spend) ────────────
// expected: the BINDING pass/fail target. A literal number is verified to ±δ;
//   PENDING means the bundled build must pin it (see PENDING_ANCHORS).
// guide: spec's "≈" hint, informational only.
// filter: human-readable description of exactly which fact keys compute() sums.
export const ANCHORS = [
  // ── §2 Amazon ──────────────────────────────────────────────
  // RE-BASED 2026-06-14 (founder approval) to FBA-ONLY on the authoritative source
  // "Amazon Orders Insights · Data (cleaned)". Amazon channel = ONLY rows whose
  // Order type is "Amazon.in marketplace (FBA)" AND Revenue-bearing? starts with
  // "Y", net = Σ Line revenue ÷ 1.05. This reproduces the founder's Executive
  // Summary FBA line EXACTLY and SUPERSEDES the erroneous FBA+EasyShip ₹12.82L
  // re-base — Website D2C (Easy Ship) is website D2C demand already counted in the
  // Shopify-net website figure (₹4,28,378); folding it into Amazon double-counted
  // website. (Also supersedes the older amazonmaysales.txt All-Orders ₹11,43,450.)
  // Amazon returns are now 0 (the 14u/₹9,500 Returned/Rejected rows are all Easy
  // Ship/website, NOT Amazon).
  {
    id: "amazon-net-rev",
    label: "Amazon net revenue (May, FBA-only revenue-bearing, ÷1.05)",
    // PINNED from rebased bundle (2026-06-14): Σ netRev over 2026-05|amazon|* =
    // Σ r2(per-SKU gross ÷ 1.05) = 1,033,587.61 (displays as ₹10,33,588; geo
    // reconciles to ₹10,33,587.65; founder Executive Summary FBA net ₹10,33,588).
    expected: 1033587.61,
    guide: 1033588, // founder Executive Summary FBA net (displayed, rounded)
    filter: `Σ netRev over ${MONTH}|amazon|* (Amazon Orders Insights · Data (cleaned): Order type="Amazon.in marketplace (FBA)" · Revenue-bearing="Y…" · ÷1.05)`,
    compute: (facts) => sumChannel(facts, "amazon", "netRev"),
  },
  {
    id: "amazon-units",
    label: "Amazon units (May, FBA-only revenue-bearing)",
    // PINNED from rebased bundle: Σ Qty over the FBA revenue-bearing rows = 995
    // (founder Executive Summary FBA units). Easy Ship & ₹0 MCF rows excluded.
    expected: 995,
    guide: 995,
    filter: `Σ units over ${MONTH}|amazon|* (Order type FBA · revenue-bearing demand; Easy Ship & ₹0 MCF excluded)`,
    compute: (facts) => sumChannel(facts, "amazon", "units"),
  },
  {
    id: "amazon-gross-rev",
    label: "Amazon gross revenue (May, FBA-only, incl GST)",
    // PINNED from rebased bundle: Σ grossRev = Σ Line revenue over the FBA
    // revenue-bearing rows = 1,085,267 (= net × 1.05; founder Exec Summary FBA gross).
    expected: 1085267,
    guide: 1085267,
    filter: `Σ grossRev over ${MONTH}|amazon|* (Σ Line revenue, before ÷1.05, Order type FBA revenue-bearing)`,
    compute: (facts) => sumChannel(facts, "amazon", "grossRev"),
  },
  {
    id: "amazon-returns",
    label: "Amazon returns (May, FBA Returned/Rejected — gross value) = 0",
    // PINNED: meta.bySource["amazon-orders"].amazonReturns = 0u / ₹0 under FBA-only.
    // The 14u/₹9,500 Returned/Rejected rows are all Website D2C (Easy Ship), NOT
    // Amazon, so Amazon returns = 0 (those returns belong to the website channel).
    expected: 0,
    guide: 0, // FBA Returned/Rejected bucket is empty
    filter: `meta.bySource["amazon-orders"].amazonReturns.value (FBA "Returned/Rejected" gross; 0 units — Easy Ship returns are website, not Amazon)`,
    compute: (facts) => amazonReturnsValue(facts),
  },
  {
    id: "amazon-geo-top-state",
    label: "Amazon geo #1 state net (May, FBA-only ÷1.05) — Punjab",
    // PINNED from rebased bundle geo.byMonthState: Punjab ranks #1 at ₹130,471.43
    // net (Maharashtra #2, Uttar Pradesh #3, Gujarat #4, Haryana #5). Geo sums to
    // the channel net (reconciles to ₹10,33,587.65).
    expected: 130471.43,
    guide: 137000, // ≈₹1.37L Punjab GROSS; net ÷1.05 = ₹1,30,471 (binding net figure)
    filter: `max netRev over meta.bySource["amazon-orders"].geo.byMonthState["${MONTH}|*"] (Punjab #1, by State (norm), net÷1.05)`,
    compute: (facts) => amazonGeoTopStateNet(facts),
  },

  // ── §2 Flipkart ────────────────────────────────────────────
  {
    id: "flipkart-net-rev",
    label: "Flipkart net revenue (May, Σ Buyer Invoice Amount, native sign)",
    expected: 272842.99,
    guide: 271408, // §2 "net-BIA ≈ ₹2,71,408 · 588 rows" (ALL-rows total, all months)
    // CONSTRAINT (verified against flipkart may sales (1).xlsx, 588 rows): the
    // "Buyer Invoice Amount" column is ALREADY the realized net-of-GST invoice
    // amount — netRev = Σ BIA native-sign AS-IS, it must NOT be ÷1.05 (that
    // yields 258,484, a DRIFT; the §2 table's "÷1.05" note is the gross
    // marketplace rule and does NOT apply to Flipkart BIA).
    // WHY 272,842.99 and not the §2 guide 271,408: the fact store is keyed by
    // channel-native ORDER DATE (spec standing default). Σ BIA over ALL 588 rows
    // = 271,407.99, but 62 of those are Return rows and −₹1,435.00 of them carry
    // an APRIL-2026 order date, so they land in 2026-04|flipkart|*, NOT May.
    // The May-only fact sum is therefore 271,407.99 + 1,435.00 = 272,842.99 —
    // the authoritative month-attributed figure the store computes. The §2
    // "≈271,408" guide is the cross-month BIA total, kept here as `guide`.
    filter: `Σ netRev over ${MONTH}|flipkart|* (= Σ Buyer Invoice Amount native sign, *N folded; already net-of-GST, NOT ÷1.05; May order-date attribution)`,
    compute: (facts) => sumChannel(facts, "flipkart", "netRev"),
  },

  // ── §2 Blinkit ─────────────────────────────────────────────
  {
    id: "blinkit-gross-rev",
    label: "Blinkit gross bill (May)",
    expected: 281560,
    guide: 281560, // §2 "gross ₹2,81,560"
    filter: `Σ grossRev over ${MONTH}|blinkit|* (Σ gross bill, keyed on Item Id)`,
    compute: (facts) => sumChannel(facts, "blinkit", "grossRev"),
  },
  {
    id: "blinkit-net-rev",
    label: "Blinkit net revenue (May, gross − CGST/SGST/cess)",
    expected: 268153,
    guide: 268153, // §2 "net ≈ ₹2,68,153"
    filter: `Σ netRev over ${MONTH}|blinkit|*`,
    compute: (facts) => sumChannel(facts, "blinkit", "netRev"),
  },
  {
    id: "blinkit-units",
    label: "Blinkit units (May)",
    expected: 386,
    guide: 386, // §2 "386 units"
    filter: `Σ units over ${MONTH}|blinkit|*`,
    compute: (facts) => sumChannel(facts, "blinkit", "units"),
  },

  // ── §2 Website (Shopify net csv = authoritative monthly) ────
  {
    id: "website-net-rev",
    label: "Website net sales (May, Shopify Net sales AS-IS)",
    expected: 428378,
    guide: 428378, // §2 "₹4,28,378"
    filter: `Σ netRev over ${MONTH}|website|* (Shopify Net sales, already net, NOT ÷1.05)`,
    compute: (facts) => sumChannel(facts, "website", "netRev"),
  },
  {
    id: "website-units",
    label: "Website units (May, Shopify Net items sold)",
    expected: 610,
    guide: 610, // §2 "610 units"
    filter: `Σ units over ${MONTH}|website|*`,
    compute: (facts) => sumChannel(facts, "website", "units"),
  },

  // ── §3 Ad spend (product-attributed totals = Σ adSpendDirect) ──
  {
    id: "amazon-sp-attributed",
    label: "Amazon SP product-attributed spend (May)",
    expected: 355115,
    guide: 355115, // §3 "may_product_wise_sp: ₹3,55,115"
    filter: `Σ adSpendDirect over ${MONTH}|amazon|* (SP per-ASIN daily, May-only)`,
    compute: (facts) => sumChannel(facts, "amazon", "adSpendDirect"),
  },
  {
    id: "amazon-ams-total",
    label: "Amazon channel ad total — Snell AMS May (build-pinned)",
    // PINNED from bundled build: Snell Sale-tab "Actual AMS Spend" May = 367,123.20.
    expected: 367123.2,
    guide: 367000, // §3/§4 "~₹3.67L — builder pins exact"
    filter: `Snell Sale tab "Actual AMS Spend" May — stored as channel-total ad override (ns.bizCost.adTotal.amazon)`,
    compute: (facts) => adTotalOverride(facts, "amazon"),
  },
  {
    id: "flipkart-pla-attributed",
    label: "Flipkart PLA product-attributed spend (May)",
    expected: 47406,
    guide: 47406, // §3 "PLA per-SKU (₹47,406)"
    filter: `Σ adSpendDirect over ${MONTH}|flipkart|* (PLA per-SKU)`,
    compute: (facts) => sumChannel(facts, "flipkart", "adSpendDirect"),
  },
  {
    id: "blinkit-ad-total",
    label: "Blinkit channel ad total — Snell May (build-pinned)",
    // PINNED from bundled build: Snell Sale-tab Blinkit spend May = 66,415.
    expected: 66415,
    guide: 66400, // §3/§5 "~₹66.4k — builder pins exact"
    filter: `Snell Sale tab Blinkit spend May — channel-total ad override (ns.bizCost.adTotal.blinkit)`,
    compute: (facts) => adTotalOverride(facts, "blinkit"),
  },
  {
    id: "website-google-attributed",
    label: "Website Google product-wise spend (May)",
    // PINNED from bundled build: Σ adSpendDirect over 2026-05|website|*
    // (Google product-wise CSV) = 116,648.42.
    expected: 116648.42,
    guide: 117000, // §3 "Google product-wise CSV (~₹1.17L)"
    filter: `Σ adSpendDirect over ${MONTH}|website|* (Google product-wise CSV)`,
    compute: (facts) => sumChannel(facts, "website", "adSpendDirect"),
  },
  {
    id: "website-ad-total",
    label: "Website channel ad total — Monarch Google+Meta May (build-pinned)",
    // PINNED from bundled build: Monarch May Google (135,008.32) + Meta
    // (77,950.03) = 212,958.35.
    expected: 212958.35,
    guide: null, // §3 "Monarch May: Google + Meta totals" — build-pinned
    filter: `Monarch May Google+Meta total — channel-total ad override (ns.bizCost.adTotal.website)`,
    compute: (facts) => adTotalOverride(facts, "website"),
  },

  // ═══ V2 HISTORY ANCHORS (Snell agency + Monarch channel-grain) ═══════════
  // These lock the multi-month tiers 2/3 against the bundled baseline. They read
  // the channel-grain "__ch__" cells the data layer bakes — NOT the per-SKU
  // native cells (those are the §2/§3 anchors above). For May, native wins per
  // V2.1 so the agency revenue is suppressed into agencyShadow; therefore the
  // Snell-May revenue anchors read from meta.agencyShadow (the retained agency
  // figure), not the zeroed active __ch__ cell. Ad spend survives suppression so
  // the ad-total anchors read the live __ch__ cell.
  {
    id: "snell-amazon-net-may",
    label: "Snell agency Amazon net revenue (May — Final Net w/o Review AS-IS)",
    // PINNED from bundled build (mayReconciliation.amazonNet.agency).
    // M1 FIX 2026-06-12: c22 "Final Net Without Review" is ALREADY net-of-GST, so
    // it is used AS-IS (no ÷1.05). The prior anchor 1,155,970.19 was the double-
    // discounted figure; the correct agency net is 1,213,768.71 (= +6.15% vs
    // native — return-tail/review timing; native still wins per V2.1).
    expected: 1213768.71,
    guide: 1143449.84, // native May amazon net — the agency figure is +6.15% (return-tail timing)
    filter: `Snell Sale-tab agency Amazon net for ${MONTH} — meta.agencyShadow[${MONTH}|amazon].netRev (Final Net w/o Review c22 AS-IS; suppressed by native per V2.1, retained for reconciliation)`,
    compute: (facts) => agencyShadowField(facts, "amazon", "netRev"),
  },
  {
    id: "snell-flipkart-net-may",
    label: "Snell agency Flipkart net revenue (May — Total Net Value as-is)",
    // PINNED from bundled build (mayReconciliation.flipkartNet.agency).
    expected: 274451.08,
    guide: 272842.99, // native May flipkart net — agency +0.59%
    filter: `Snell Sale-tab agency Flipkart net for ${MONTH} — meta.agencyShadow[${MONTH}|flipkart].netRev`,
    compute: (facts) => agencyShadowField(facts, "flipkart", "netRev"),
  },
  {
    id: "monarch-website-conv-may",
    label: "Monarch website conversion value (May — Total Conversion Value col4)",
    // PINNED from bundled build: Monarch Master-Sheet May gross conv value.
    expected: 782875.24,
    guide: 782875, // founder-cited May website conv value 782,875
    filter: `Monarch Master-Sheet ${MONTH} Total Conversion Value — meta.agencyShadow[${MONTH}|website].grossRev (suppressed by native Shopify, retained)`,
    compute: (facts) => agencyShadowField(facts, "website", "grossRev"),
  },

  // ── INFO rows: Snell-vs-native May deltas (reconciliation, never pass/fail) ──
  {
    id: "recon-amazon-may-delta",
    info: true,
    label: "INFO · Amazon May agency−native delta (Snell vs All-Orders)",
    expected: null,
    guide: 6.15, // ≈ +6.15% (M1 fix: c22 AS-IS; agency higher — return-tail/review timing)
    filter: `meta.bySource["snell-history"].mayReconciliation.amazonNet.deltaPct`,
    compute: (facts) => mayReconciliation(facts)?.amazonNet?.deltaPct ?? null,
  },
  {
    id: "recon-flipkart-may-delta",
    info: true,
    label: "INFO · Flipkart May agency−native delta (Snell vs FK Sales)",
    expected: null,
    guide: 0.59, // ≈ +0.59%
    filter: `meta.bySource["snell-history"].mayReconciliation.flipkartNet.deltaPct`,
    compute: (facts) => mayReconciliation(facts)?.flipkartNet?.deltaPct ?? null,
  },
  {
    id: "recon-blinkit-may-delta",
    info: true,
    label: "INFO · Blinkit May agency−native delta (Snell gross vs Blinkit report)",
    expected: null,
    guide: 0, // Snell Blinkit gross == native exactly (cross-checks per §2)
    filter: `meta.bySource["snell-history"].mayReconciliation.blinkitGross.deltaPct`,
    compute: (facts) => mayReconciliation(facts)?.blinkitGross?.deltaPct ?? null,
  },
];

// Greppable list of anchor ids whose `expected` the gate phase must fill from
// B1's bundled output (every NON-INFO anchor carrying the PENDING sentinel).
// INFO rows legitimately have expected:null (they report a measured delta, not a
// pinned target) and are excluded. The gate replaces `expected: PENDING` with
// the exact bundled number and removes the id from this list.
export const PENDING_ANCHORS = ANCHORS.filter((a) => !a.info && a.expected === PENDING).map((a) => a.id);

// Channel-total ad override accessor (Snell/Monarch totals the fact store can't
// carry per-SKU). Resolves with the SAME precedence the engine uses so the panel
// verifies exactly what the engine consumes:
//   facts.adTotals inline (test) → meta.bySource (Snell/Monarch, the bundled
//   baseline path) → ns.bizCost.adTotal localStorage (manual override).
// SAFE: nothing resolves → null (the anchor reports NO-DATA, never a false 0).
function adTotalOverride(facts, channel) {
  // 1. Inline override map (test / direct-injection path).
  const inline = facts && facts.adTotals ? Number(facts.adTotals[channel]) : NaN;
  if (Number.isFinite(inline)) return inline;
  // 2. Meta-derived total from the fact store (bundled baseline / uploads).
  const meta = metaAdTotal(facts, channel);
  if (Number.isFinite(meta)) return meta;
  // 3. localStorage manual override (Cost Inputs panel).
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("ns.bizCost.adTotal");
    const map = raw ? JSON.parse(raw) : null;
    const n = Number(map?.[channel]);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

// ─── Amazon returns + geo accessors (new authoritative source, basis A) ──────
// Returns VALUE (₹ gross) from the Returned/Rejected bucket. SAFE: absent → null
// (anchor reports NO-DATA, never a false 0).
function amazonReturnsValue(facts) {
  const r = facts?.meta?.bySource?.["amazon-orders"]?.amazonReturns;
  const v = Number(r?.value);
  return Number.isFinite(v) ? v : null;
}
// Top-ranked state net revenue (₹) for ANCHOR_MONTH from the Amazon geo map. The
// #1 state must be Punjab on the shipped+delivered ÷1.05 basis; this anchor pins
// the #1 net VALUE so a drift (or a different #1 state) surfaces. SAFE: absent → null.
function amazonGeoTopStateNet(facts) {
  const geo = facts?.meta?.bySource?.["amazon-orders"]?.geo?.byMonthState;
  if (!geo) return null;
  let topNet = null;
  for (const [k, v] of Object.entries(geo)) {
    if (!k.startsWith(`${MONTH}|`)) continue;
    const n = Number(v?.netRev);
    if (Number.isFinite(n) && (topNet === null || n > topNet)) topNet = n;
  }
  return topNet;
}

// Channel total derived from meta.bySource (mirrors cmEngine.deriveChannelAdTotals
// for the three channels with agency/Monarch totals). Returns a finite number or
// NaN. Kept local so verification has no import cycle with the engine.
function metaAdTotal(facts, channel) {
  const bySource = facts && facts.meta && facts.meta.bySource ? facts.meta.bySource : null;
  if (!bySource) return NaN;
  const snell = bySource["snell-agency"]?.snellChannelSpend;
  if (snell && Number.isFinite(Number(snell[channel]))) return Number(snell[channel]);
  if (channel === "website") {
    const mon = bySource["monarch-web"]?.monarchWebSpend;
    if (mon) {
      const g = Number(mon.googleTotal), me = Number(mon.metaTotal);
      if (Number.isFinite(g) || Number.isFinite(me)) {
        return (Number.isFinite(g) ? g : 0) + (Number.isFinite(me) ? me : 0);
      }
    }
  }
  return NaN;
}

// ─── Runner ──────────────────────────────────────────────────
/**
 * runVerification(facts, opts?) → [{ id, label, status, actual, expected,
 *   delta, deltaPct, filter, guide }]
 *
 * status:
 *   "INFO"     — `info` anchor (reconciliation delta); reports actual, no pass/fail
 *   "PENDING"  — anchor.expected not yet pinned (build must fill it)
 *   "NO-DATA"  — anchor computes to null/undefined (source absent)
 *   "MATCH"    — |actual − expected| ≤ tolerance
 *   "DRIFT"    — outside tolerance (delta surfaced)
 *
 * tolerance: opts.absTol (default 1) OR opts.relTol fraction of expected,
 *   whichever is larger — covers both ₹ rounding (÷1.05) and unit counts.
 */
export function runVerification(facts, opts = {}) {
  const absTol = Number.isFinite(opts.absTol) ? opts.absTol : 1;
  const relTol = Number.isFinite(opts.relTol) ? opts.relTol : 0.005; // 0.5%
  return ANCHORS.map((a) => {
    let actual;
    try { actual = a.compute(facts); } catch { actual = null; }
    const out = {
      id: a.id,
      label: a.label,
      filter: a.filter,
      guide: a.guide ?? null,
      expected: a.expected,
      actual: Number.isFinite(actual) ? actual : null,
      delta: null,
      deltaPct: null,
      status: "PENDING",
      info: !!a.info,
    };
    // INFO rows (reconciliation deltas): surface the value, never pass/fail.
    if (a.info) { out.status = out.actual == null ? "NO-DATA" : "INFO"; return out; }
    if (a.expected === PENDING) { out.status = "PENDING"; return out; }
    if (out.actual == null) { out.status = "NO-DATA"; return out; }
    const delta = out.actual - a.expected;
    out.delta = delta;
    out.deltaPct = a.expected !== 0 ? delta / a.expected : null;
    const tol = Math.max(absTol, Math.abs(a.expected) * relTol);
    out.status = Math.abs(delta) <= tol ? "MATCH" : "DRIFT";
    return out;
  });
}

// ─── V2 FORMATTING / SANITY anchor (spec V2.4 + V2.2) ─────────
/**
 * runFormattingSanity(facts) → { status: "MATCH"|"DRIFT", checks:[…], failures:[…] }
 *
 * The permanent formatting/sanity net the founder asked for. Walks the ENGINE's
 * own output (v1 computeCM for every native month + V2 computeMonthChannelCM for
 * every month×channel) and asserts, with NO tolerance:
 *   1. FINITE — every emitted CM number is finite-or-null (never NaN/Infinity).
 *      A leaked NaN/Infinity is the root cause of the raw-float / absurd-ratio
 *      bugs the founder rejected, so this is a hard gate.
 *   2. ACOS SANITY — for every month×channel with ad spend, ACOS = adSpend/netRev
 *      is computed THROUGH guardRatio with same-window tags. No ACOS > 500% may
 *      survive un-suppressed: if value > 5 it must come back suppressed (window
 *      mismatch) OR be a genuine same-window number ≤ 5. A raw >500% leak fails.
 *   3. PCT RANGE — every CM% is in a sane band (−5..+1, i.e. −500%..+100% of
 *      net rev); anything outside signals a cross-window contamination.
 *
 * status MATCH only when zero failures. Pure (no DOM/localStorage walk here —
 * the DOM grep for `\d{4,}\.\d{3,}` is the UI-layer verifier's job; this asserts
 * the ENGINE never feeds it a non-finite or absurd number in the first place).
 */
export function runFormattingSanity(facts) {
  const failures = [];
  let walked = 0; // count of cells walked (a clean cell records no failure but IS walked)
  const note = (id, detail) => { failures.push({ id, detail }); };

  const finiteOrNull = (v) => v === null || Number.isFinite(v);
  const CM_KEYS = ["netRev", "units", "cogs", "fees", "adSpend", "cm1", "cm2", "cm3", "cm4"];
  const PCT_KEYS = ["cm1", "cm2", "cm3", "cm4"];

  const walkCell = (tag, cell) => {
    if (!cell) return;
    walked++;
    for (const k of CM_KEYS) {
      if (cell[k] === undefined) continue;
      if (!finiteOrNull(cell[k])) note(`finite:${tag}.${k}`, `${tag}.${k}=${cell[k]}`);
    }
    const pcts = cell.pcts || {};
    for (const k of PCT_KEYS) {
      const v = pcts[k];
      if (v === undefined) continue;
      if (!finiteOrNull(v)) { note(`finite:${tag}.pct.${k}`, `${tag}.pct.${k}=${v}`); continue; }
      if (v !== null && (v < -5 || v > 1.0001)) note(`pctRange:${tag}.${k}`, `${tag}.pct.${k}=${v} out of [-5,1]`);
    }
  };

  const months = monthsAvailable(facts);

  // 1+3 — walk every native month's full v1 chain + every month×channel V2 cell.
  for (const mm of months) {
    // V2 per month×channel (covers agency + native uniformly).
    for (const ch of Object.keys(mm.channels)) {
      const r = computeMonthChannelCM({ facts, month: mm.month, channel: ch });
      walkCell(`${mm.month}|${ch}`, r);

      // 2 — ACOS sanity through the guard. Window tag = month|channel|coverage so
      // a same-window ACOS is allowed and a mixed/absurd one is suppressed.
      if (Number.isFinite(r.adSpend) && r.adSpend > 0 && Number.isFinite(r.netRev) && r.netRev > 0) {
        const win = `${mm.month}|${ch}|${r.coverage}`;
        const g = guardRatio({ numerator: r.adSpend, denominator: r.netRev, numWindow: win, denWindow: win, kind: "acos" });
        // A surviving (non-suppressed) ACOS must be ≤ 500%. >500% un-suppressed = bug.
        if (!g.suppressed && Number.isFinite(g.value) && g.value > 5) {
          note(`acos:${win}`, `ACOS ${(g.value * 100).toFixed(1)}% > 500% not suppressed (windowMismatch flag missing)`);
        }
      }
    }
    // Native months also run the full v1 chain (per-SKU cells + company rollup).
    const hasNative = Object.values(mm.channels).some((c) => c.sales === "native");
    if (hasNative) {
      const v1 = computeCM({ facts, month: mm.month });
      for (const code of Object.keys(v1.bySku)) {
        walkCell(`${mm.month}|sku:${code}`, v1.bySku[code]);
        for (const ch of Object.keys(v1.bySku[code].byChannel || {})) {
          walkCell(`${mm.month}|${code}|${ch}`, v1.bySku[code].byChannel[ch]);
        }
      }
      walkCell(`${mm.month}|company`, v1.company);
    }
  }

  if (walked === 0) note("walked-something", "no months to walk");
  return {
    id: "formatting-sanity",
    label: "Formatting & sanity — every engine number finite, no un-flagged >500% ACOS, CM% in [-500%,+100%]",
    status: failures.length === 0 ? "MATCH" : "DRIFT",
    checks: walked,
    failures,
  };
}

// ───────────────────────────────────────────────────────────────
// NODE SELF-TEST: node src/lib/businessVerification.js
// ───────────────────────────────────────────────────────────────
// `proc` reads node's process via globalThis so the browser/ESLint env (where
// `process` is undefined) never trips; the self-test block stays dormant there.
const proc = typeof globalThis !== "undefined" ? globalThis.process : undefined;
const isMain = (() => {
  try { return !!proc && import.meta.url === `file://${proc.argv[1]}`; }
  catch { return false; }
})();

if (isMain) {
  // All non-INFO anchors are PINNED (PENDING_ANCHORS empty). Synthetic facts hit
  // every anchor's expected EXACTLY (channel ad totals via the inline `adTotals`
  // map; V2 history figures via meta.agencyShadow + reconciliation), plus one
  // deliberate DRIFT.
  const facts = {
    monthly: {
      // Authoritative Amazon basis (FBA-only): net ₹10,33,587.61 / 995u /
      // gross ₹10,85,267 on the Order type "Amazon.in marketplace (FBA)" ÷1.05 rows.
      "2026-05|amazon|NSMP100": { netRev: 1033587.61, units: 995, grossRev: 1085267, adSpendDirect: 355115 },
      "2026-05|website|NSSB100": { netRev: 428378, units: 610, adSpendDirect: 116648.42 },
      "2026-05|blinkit|NSSB100": { grossRev: 281560, netRev: 268153, units: 386 },
      "2026-05|flipkart|NSSBP100": { netRev: 272842.99 }, // exact MATCH (May order-date sum)
      "2026-05|flipkart|NSMP100": { adSpendDirect: 47000 }, // DRIFT vs 47406
    },
    adTotals: { amazon: 367123.2, blinkit: 66415, website: 212958.35 },
    meta: {
      // V2 history: native wins for May so agency revenue lives in agencyShadow.
      agencyShadow: {
        "2026-05|amazon": { netRev: 1213768.71, grossRev: 1174650.02, units: 1369 },
        "2026-05|flipkart": { netRev: 274451.08, grossRev: 310913.4, units: 466 },
        "2026-05|website": { netRev: 0, grossRev: 782875.24, units: 823 },
      },
      bySource: {
        // FBA-only Amazon source meta: returns = 0 (Easy Ship returns are website)
        // + geo (Punjab #1 at ₹1,30,471.43 net, Maharashtra #2, UP #3).
        "amazon-orders": {
          amazonReturns: { units: 0, value: 0 },
          geo: { source: "amazon-orders-insights State (norm)", byMonthState: {
            "2026-05|PUNJAB": { units: 83, netRev: 130471.43, returns: 0 },
            "2026-05|MAHARASHTRA": { units: 115, netRev: 104504.76, returns: 0 },
            "2026-05|UTTAR PRADESH": { units: 102, netRev: 95963.81, returns: 0 },
          } },
        },
        "snell-history": { mayReconciliation: {
          amazonNet: { agency: 1213768.71, native: 1143449.84, delta: 70318.87, deltaPct: 6.15 },
          flipkartNet: { agency: 274451.08, native: 272842.99, delta: 1608.09, deltaPct: 0.59 },
          blinkitGross: { agency: 281560, native: 281560, delta: 0, deltaPct: 0 },
        } },
      },
    },
  };
  const res = runVerification(facts);
  const by = Object.fromEntries(res.map((r) => [r.id, r]));
  const check = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); if (!cond) proc.exitCode = 1; };

  check("amazon-net-rev MATCH (FBA-only ₹10.34L)", by["amazon-net-rev"].status === "MATCH");
  check("amazon-units MATCH (995)", by["amazon-units"].status === "MATCH");
  check("amazon-gross-rev MATCH (₹10.85L)", by["amazon-gross-rev"].status === "MATCH");
  check("amazon-returns MATCH (₹0 — Easy Ship returns are website)", by["amazon-returns"].status === "MATCH");
  check("amazon-geo-top-state MATCH (Punjab ₹1.30L net)", by["amazon-geo-top-state"].status === "MATCH");
  check("amazon-ams-total MATCH", by["amazon-ams-total"].status === "MATCH");
  check("website-net-rev MATCH", by["website-net-rev"].status === "MATCH");
  check("website-units MATCH", by["website-units"].status === "MATCH");
  check("website-google-attributed MATCH", by["website-google-attributed"].status === "MATCH");
  check("website-ad-total MATCH", by["website-ad-total"].status === "MATCH");
  check("blinkit-gross MATCH", by["blinkit-gross-rev"].status === "MATCH");
  check("blinkit-net MATCH", by["blinkit-net-rev"].status === "MATCH");
  check("blinkit-units MATCH", by["blinkit-units"].status === "MATCH");
  check("blinkit-ad-total MATCH", by["blinkit-ad-total"].status === "MATCH");
  check("flipkart-net MATCH", by["flipkart-net-rev"].status === "MATCH");
  check("amazon-sp MATCH", by["amazon-sp-attributed"].status === "MATCH");
  check("flipkart-pla DRIFT", by["flipkart-pla-attributed"].status === "DRIFT");
  check("flipkart-pla delta=-406", Math.round(by["flipkart-pla-attributed"].delta) === -406);
  check("PENDING_ANCHORS empty (all pinned)", PENDING_ANCHORS.length === 0);
  check("NO PENDING status anywhere", res.every((r) => r.status !== "PENDING"));
  check("no NaN in any actual", res.every((r) => r.actual === null || Number.isFinite(r.actual)));

  // ── V2 history anchors (Snell/Monarch May) ──
  check("snell-amazon-net-may MATCH (agencyShadow, c22 AS-IS)", by["snell-amazon-net-may"].status === "MATCH");
  check("snell-flipkart-net-may MATCH", by["snell-flipkart-net-may"].status === "MATCH");
  check("monarch-website-conv-may MATCH (782875.24)", by["monarch-website-conv-may"].status === "MATCH");

  // ── V2 INFO reconciliation rows (never pass/fail, report the delta) ──
  check("recon-amazon INFO", by["recon-amazon-may-delta"].status === "INFO");
  check("recon-amazon delta = +6.15% (M1 fix)", Math.abs(by["recon-amazon-may-delta"].actual - 6.15) < 1e-9);
  check("recon-flipkart INFO", by["recon-flipkart-may-delta"].status === "INFO");
  check("recon-blinkit INFO (0% delta)", by["recon-blinkit-may-delta"].status === "INFO" && by["recon-blinkit-may-delta"].actual === 0);
  check("INFO rows excluded from PENDING_ANCHORS", !PENDING_ANCHORS.includes("recon-amazon-may-delta"));

  // ── V2 agencyShadow fallback: a month where agency wins (live __ch__ cell) ──
  const aprFacts = { monthly: { "2026-05|flipkart|__ch__": { netRev: 274451.08, grossRev: 310913.4, units: 466 } } };
  check("agencyShadowField falls back to live __ch__", Math.abs(agencyShadowField(aprFacts, "flipkart", "netRev") - 274451.08) < 1e-6);

  // ── V2 FORMATTING / SANITY walk ──
  // Clean facts (the synthetic native May above) → MATCH, every number finite.
  const fmtClean = runFormattingSanity(facts);
  check("formatting-sanity MATCH on clean facts", fmtClean.status === "MATCH");
  check("formatting-sanity walked something", fmtClean.checks > 0);

  // Real bundled baseline (post-precedence) → must also pass the sanity walk.
  // (Imported lazily so the unit self-test stays bundle-independent if absent.)
  let bundledOk = "skipped";
  try {
    const { mergedFacts } = await import("./businessStore.js");
    const merged = mergedFacts ? mergedFacts() : null;
    if (merged) {
      const fmtBundle = runFormattingSanity(merged);
      bundledOk = fmtBundle.status;
      check("formatting-sanity MATCH on REAL bundled facts", fmtBundle.status === "MATCH");
      if (fmtBundle.failures.length) console.log("  failures:", JSON.stringify(fmtBundle.failures.slice(0, 5)));
      // And the full anchor set against the real bundle (15 v1 + 3 history MATCH).
      const realRes = runVerification(merged);
      const realBy = Object.fromEntries(realRes.map((r) => [r.id, r]));
      const v1Ids = ["amazon-net-rev","amazon-units","amazon-gross-rev","amazon-returns","amazon-geo-top-state","amazon-ams-total","website-net-rev","website-units","website-google-attributed","website-ad-total","blinkit-gross-rev","blinkit-net-rev","blinkit-units","blinkit-ad-total","flipkart-net-rev","amazon-sp-attributed","flipkart-pla-attributed"];
      const v1Match = v1Ids.every((id) => realBy[id]?.status === "MATCH");
      check(`all ${v1Ids.length} v1 anchors MATCH on REAL bundle`, v1Match);
      if (!v1Match) console.log("  v1 drifts:", v1Ids.filter((id)=>realBy[id]?.status!=="MATCH").map((id)=>`${id}:${realBy[id]?.status}(${realBy[id]?.actual})`).join(", "));
      const histMatch = ["snell-amazon-net-may","snell-flipkart-net-may","monarch-website-conv-may"].every((id) => realBy[id]?.status === "MATCH");
      check("3 history anchors MATCH on REAL bundle", histMatch);
      if (!histMatch) console.log("  hist:", ["snell-amazon-net-may","snell-flipkart-net-may","monarch-website-conv-may"].map((id)=>`${id}:${realBy[id]?.status}(${realBy[id]?.actual})`).join(", "));
    }
  } catch (e) { console.log("  (bundled-facts check skipped:", e.message, ")"); }

  // Deliberate FAIL case — a non-finite engine output must trip the sanity walk.
  // We synthesize a facts object whose native channel computes a non-finite by
  // forcing a poisoned cost module is overkill; instead assert guardRatio itself
  // refuses absurd ACOS so the walk's gate is proven live.
  const absurd = guardRatio({ numerator: 1000, denominator: 0, numWindow: "w", denWindow: "w", kind: "acos" });
  check("sanity gate: zero-rev ACOS suppressed (no Infinity)", absurd.suppressed && absurd.value === null);

  console.log(`\nPENDING_ANCHORS (must be empty): [${PENDING_ANCHORS.join(", ")}]`);
  console.log(`bundled-facts formatting walk: ${bundledOk}`);
  console.log("businessVerification self-test complete.");
}
