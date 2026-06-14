# BUSINESS PERFORMANCE MODULE — BINDING SPEC (2026-06)

Founder-approved at the single checkpoint (2026-06-11). Every rule here is
BINDING. Builders implement exactly this; verifiers verify against exactly
this. Where this spec pins a number, the number was extracted from the
founder's files — never estimated.

## 0 · Mission
Extend the tool with genuine business visibility: sales, revenue, growth, ad
performance, and margins — CM1 (after COGS), CM2 (after variable platform/
fulfilment), CM3 (after ads), CM4 (after fixed-cost allocation, provisioned) —
channel-wise, SKU-wise, and as a SKU × channel CM3 matrix. Channels: amazon,
flipkart, blinkit, website (Instamart later — channel is a first-class
dimension everywhere; adding a channel must require only a parser + a fee row).

## 1 · Founder decisions (the 11 answers, binding)
1. **COGS set** = `Naturesum_Unit_COGS_116 (1).xlsx` (revised 11-Jun). Numbers in §4.
2. **Amazon sales = `Amazon Orders Insights by Shivam.xlsx` · tab "Data (cleaned)" · Order type "Amazon.in marketplace (FBA)" ONLY** (founder approval 2026-06-14 — Amazon = Amazon.in marketplace (FBA) only per the Executive Summary; SUPERSEDES the erroneous FBA+EasyShip ₹12.82L re-base AND the older `amazonmaysales.txt` All-Orders TSV / ₹11,43,450). Revenue = FBA rows with **Revenue-bearing? starts with "Y"** (priced & not cancelled); net = Σ Line revenue ÷ 1.05 (per cell once) = **₹10,33,588 / 995u / gross ₹10,85,267**. **Website D2C (Easy Ship) (₹3,81,730) is EXCLUDED from Amazon** — it is website D2C demand already counted in the Shopify-net website figure (₹4,28,378); folding it into Amazon would DOUBLE-COUNT website. The ₹0 MCF (non-Amazon channels) rows (Revenue-bearing="No") are NOT Amazon sales — captured as MCF units for mcfShare (website fulfilment). Amazon returns = **0** (the 14u/₹9,500 Returned/Rejected rows are Easy Ship/website, not Amazon).
3. **Website revenue + units (May)** = the founder's `shopify net sales net
   units.csv` (per-SKU Net sales + Net items sold; net of returns/discounts,
   ex-GST per Shopify "Net sales" semantics — use AS-IS, do NOT ÷1.05).
   The daily `shopify may sales.csv` provides the DAILY SHAPE only (trend),
   never the monthly total.
4. **Amazon May ads** = `may_product_wise_sp.xlsx` (DAILY, per-ASIN, May-only;
   product-attributed SP ≈ ₹3,55,115). Channel total = Snell `Sale` tab
   "Actual AMS Spend" for May (~₹3.67L — builder pins exact). Remainder
   (total − SP-attributed) is unattributed → allocated per §6.
5. **Blinkit May ad spend** = Snell `Sale` tab Blinkit spend column (~₹66.4k —
   builder pins exact; the sheet's Blinkit gross 281,560 cross-checks the
   native report exactly). Allocated across Blinkit SKUs by revenue.
6. **Blinkit fees** = commission + storage only; NO missing fulfilment line.
7. (folded into 3.)
8. **SKU mappings confirmed**: Blinkit Item 10276565 = NSSBDB500 (key Blinkit
   parsing on Item Id, never free-text title). Face oil ASINs:
   **B0DK1X4LGV = NSSBBO30 (30 ml)**, B0DK1X2H8F = NSSBBO15. DI-TE-1-A =
   NSACDT30. "Rosemary & Jatamansi Hair Oil"/NSJ&RHO100ML = NSJO100.
9. **From `Naturesum_BusinessModel (1).xlsx` use ONLY the variable platform
   cost percentages** (§5). NOTHING else — no COGS, no per-SKU Amazon
   deductions (founder: deductions < total Amazon variable platform cost —
   using them would OVERSTATE CM2), no marketing numbers, no fixed costs,
   unless extremely essential and explicitly justified in a code comment.
10. **Flipkart cashback** (+₹11,931): settlement-layer line, NOT revenue,
    excluded from CM. Shown as a separate "net realization" note.
11. **Amazon returns: NET OUT** of Amazon revenue/units. Under basis A the
    "Returned/Rejected" rows are a SEPARATE Status bucket already EXCLUDED from
    the shipped+delivered revenue (14 units / ₹9,500 gross for May) — so they are
    reported as the returns figure, NOT double-subtracted. **CM4: show it**, with an in-tool editable "fixed costs for
    the month" input; allocation = proportional to net revenue across
    channels (and across SKUs within channels). Judgment (founder asked):
    revenue-proportional allocation is the right pragmatic default for a
    dashboard CM4 — but it taxes high-revenue cells regardless of actual
    fixed-resource use, so the UI must caption CM4 as a reporting view;
    CM3 stays the decision layer (delist/ads decisions). Implemented as such.

**Standing defaults (approved):** revenue basis net-of-GST everywhere
(marketplaces ÷1.05 or explicit tax columns; website per §1.3); date
attribution = channel-native order/invoice date; negative CM cells shown,
never floored; all fabricated stub data in Finance/Sales/Marketing pages
REPLACED with real derived data.

## 2 · Channel revenue definitions (May 2026 anchors → verifier panel)
| Channel | Source of truth | Net-revenue rule | May anchors (builder/verifier re-derive exactly) |
|---|---|---|---|
| amazon | **Amazon Orders Insights · Data (cleaned)** (xlsx), **Order type "Amazon.in marketplace (FBA)" ONLY** | Σ Line revenue over **FBA** rows that are **Revenue-bearing? "Y…"** (priced & not cancelled); net = Σ ÷ 1.05 (per cell once); group per-SKU by **Master SKU → canonical** (Website D2C Easy Ship EXCLUDED — website D2C; ₹0 MCF excluded → mcfShare; Cancelled/Pending pickup/Unfulfillable excluded) | **net ₹10,33,588 · gross ₹10,85,267 · 995 units** · returns **0** (the 14u/₹9,500 "Returned/Rejected" rows are Easy Ship/website, not Amazon) · geo #1 Punjab ₹1,30,471 net (Maharashtra #2, UP #3, Gujarat #4, Haryana #5).<br>_Amazon = Amazon.in marketplace (FBA) ONLY per Order type (Executive Summary), revenue-bearing priced-&-not-cancelled, net÷1.05 = ₹10,33,588 / 995u; Website Easy Ship (₹3,81,730) is website D2C — EXCLUDED from Amazon to avoid double-counting Shopify-net website; supersedes the erroneous FBA+EasyShip ₹12.82L re-base, founder 2026-06-14._ |
| flipkart | FK Sales Report xlsx | Σ Buyer Invoice Amount with NATIVE SIGN (negatives auto-net); net = Σ ÷ 1.05; fold `*N` multipacks | net-BIA ≈ ₹2,71,408 · 588 rows |
| blinkit | Blinkit Sales Report | Σ gross bill; net = gross − (CGST+SGST+cess); key on Item Id | gross ₹2,81,560 · net ≈ ₹2,68,153 · 386 units |
| website | shopify net csv (monthly) | Net sales AS-IS (already net) | ₹4,28,378 · 610 units |

Snell Categorywise tabs = independent units cross-check only (never revenue).
Monarch = website trend history + Meta/Google channel spend only.

## 3 · Ad spend model (May)
| Channel | Product-attributed | Channel total | Unattributed remainder |
|---|---|---|---|
| amazon | SP per-ASIN daily (may_product_wise_sp: ₹3,55,115) | Snell AMS May (builder pins, ~₹3.67L) | total − SP |
| flipkart | PLA per-SKU (₹47,406) | Snell FK spend (~₹47.3k; if ≈PLA, total=PLA) | ~0 |
| blinkit | none | Snell Blinkit May (~₹66.4k) | all of it |
| website | Google product-wise CSV (~₹1.17L) | Monarch May: Google + Meta totals | Meta + (Google total − product-wise) |

## 4 · COGS (₹/unit, incl packaging — 11-Jun file, as-of tracked)
NSACDT30 150 (pkg 0 placeholder) · NSJO100 375 (pkg 0 placeholder) ·
NSSB100 133 · NSSB250 305.25 · NSSB500 582.5 · NSSBDB100 136.5 ·
NSSBDB250 314 · NSSBDB500 600 · NSMP100 39.5 · NSMP250 71.5 ·
NSSBBO15 180.5 · NSSBBO30 353 · NSSBJ300 232.7 · NSSBJ500 342.3.
All editable in-tool (§7); the two ₹0 packaging placeholders flagged in UI.

## 5 · Variable platform cost % (of channel's own net revenue) — the ONLY
BusinessModel numbers used. As-of April 2026; editable in-tool (§7).
amazon 27.5413% · mcf-web 24.8011% · flipkart 10.3647% ·
website-direct 23.2627% · blinkit 25.6940%.
**Website blended rate** = mcfShare × 24.8011% + (1−mcfShare) × 23.2627%,
where mcfShare = MCF revenue share of website (derived from All-Orders
Non-Amazon units × website per-unit net price; May default computed at build,
editable). All three inputs visible + editable.

## 6 · CM chain (per month × channel × SKU)
netRev → −COGS×units → **CM1** → −feePct×netRev → **CM2** → −adSpend
(product-attributed direct; ALL unattributed spend allocated proportionally
to netRev within its channel) → **CM3** → −fixedAlloc (editable monthly ₹,
revenue-proportional) → **CM4**.
SKU×channel CM3 matrix = the headline view; negative cells highlighted.

## 7 · Editable cost inputs (no-sheet-next-time provision)
A "Cost Inputs" panel: per-SKU COGS (+as-of), per-channel fee % (+as-of),
website mcfShare, monthly fixed costs, Blinkit/unattributed ad overrides.
Stored in localStorage overrides over baked defaults; every figure displays
its as-of date + source ("11-Jun COGS file" / "BusinessModel Apr-26" /
"user-edited <date>"); export/import as JSON.

## 8 · Durable fact store (no double-count)
`ns.businessPerf` — AGGREGATED facts only (no raw rows; localStorage budget).
Monthly facts `month|channel|code` (authoritative: revenue, units, adSpend,
returns) + daily facts `date|channel|code` (shape/trends where daily exists).
Each upload parses → upserts by key+source; re-upload of overlapping data
REPLACES same-key facts (idempotent — verifier must prove parse-twice ==
parse-once). Provenance per fact. New upload zones in the existing modal:
amazon-orders, fk-sales, blinkit-sales, shopify-net, shopify-daily,
ads-amazon-sp, ads-fk-pla, ads-google, snell-agency (spend), monarch-web.
Browser parsers + offline `scripts/build-business-data.cjs` twin that bakes
May 2026 into `src/bundledBusinessData.js` (same twin discipline as
centralWhEngine).

## 9 · UI scope
- **PageFinance**: CM waterfall (channel + company), SKU×channel CM3 matrix,
  SKU economics cards, CM trend, Cost Inputs panel, CM4 view (captioned),
  Verification panel (§10).
- **PageSales**: channel revenue/units + growth (MoM when ≥2 months; Monarch
  13-mo website history + Snell history as trend context), SKU breakdown,
  returns view (Shopify 18.7% blended trend, Amazon returns), channel mix.
- **PageMarketing**: spend by channel/SKU, ROAS/ACOS per SKU, breakeven-ACOS
  (= CM2%) flags, zero-sale spend list, CM3-after-ads bridge.
- **Data-coverage panel**: month × channel × source completeness; SKU-gap
  matrix (e.g. Blinkit sells only 5 SKUs); ad-coverage caveats.
- Fabricated placeholder data in these pages is DELETED, not coexisting.
- Un-gate these pages from preview/blur mode.

## 10 · Permanent in-tool verification
`src/lib/businessVerification.js`: every anchor in §2/§3 stored as
{label, expected, filterDescription, computeFromFacts()} — a Verification
panel recomputes from the live fact store and shows MATCH / DRIFT(δ) per
anchor. Anchors update only via a new bundled baseline. This panel is the
permanent regression net the founder asked for.

## 11 · Quality bars
- Fail-loud parsers (schema drift → clear error + DQ flag, never silent 0).
- R-FUZZY name tolerance where free-text names occur (Google titles, Blinkit
  titles as fallback to Item Id), same conservative algorithm as inventory.
- No NaN/Infinity rendered anywhere; SAFE fallbacks on every derived field.
- Engine logic in lib/ pure functions (unit-testable via node), UI thin.
- docs/CHANGE-LOG-2026-06.md updated; verification results recorded in
  docs/VERIFICATION-BUSINESS-2026-06.md.

# ═══ V2 ADDENDUM (2026-06-12) — multi-month history, coverage honesty, daily grain ═══
Founder verdict on v1: "not good — rich data, little used." V2 is BINDING and
supersedes v1 where they conflict.

## V2.1 Source tiers + override semantics
- **Tier-1 NATIVE** (per-SKU revenue grain): Amazon All-Orders, FK Sales xlsx,
  Blinkit report, Shopify net csv. Currently May-2026 only.
- **Tier-2 AGENCY (Snell)**: Sale tab = DAILY channel-grain units + gross/net
  revenue + ad spend — Amazon Aug-2024→, FK Jun-2025→, Blinkit Dec-2025→
  (incl June 2026 to date). Categorywise tabs = DAILY per-SKU UNITS (same
  ranges). Units only at SKU grain — never fabricate SKU revenue from them.
- **Tier-3 MONARCH**: Master Sheet = DAILY website revenue + cancels + Google/
  Meta spend, Jun-2025→ (12 mo).
- **Override rule**: for the same (month × channel × metric), NATIVE wins over
  AGENCY/MONARCH. Both retained; UI shows the active source per figure and the
  agency-vs-native delta as a reconciliation note, never silently.
- Every fact carries `tier` + `source`. The long-term view BUILDS from tiers
  2/3 and upgrades automatically when native reports are uploaded.

## V2.2 Coverage model (kills the 16276%-ACOS class of bug)
Per (month × channel): `{sales: native|agency|none, skuGrain: bool,
ads: actual|agency|none}`. HARD RULES:
- A ratio (ROAS/ACOS/CM%/MoM) may ONLY divide quantities from the SAME
  coverage window. No cross-window ratios, ever.
- A month×channel missing sales coverage shows "no sales data" — NEVER a
  computed margin against near-zero revenue.
- Months in pickers/charts carry coverage badges; partial months (e.g. June
  to-date) are labeled "MTD through <date>" and excluded from MoM unless
  compared like-for-like (same day-of-month window).
- ACOS/ROAS display: if ACOS > 500% or ROAS < 0.2 AND coverage is mixed-tier,
  suppress the number and show "window mismatch" with the explanation. If
  genuinely same-window, show it with the evidence inline.
- Flipkart Apr-type artifacts (returns dated into a prior month creating
  negative revenue): months where |netRev| is < 2% of the channel's typical
  month AND negative → label "returns tail, no sales coverage" — not a CM row.

## V2.3 Ad-spend provenance (visible on every margin figure)
`adBasis ∈ actual-attributed | allocated-share | agency-total`. Every CM3/ROAS
figure renders a small basis chip (e.g. "SP actual" / "alloc by rev" /
"agency"). The SKU×channel matrix legend explains the three bases. No margin
number without its basis.

## V2.4 Formatting (zero tolerance)
ALL currency through D.fmtINR (rounded; never raw floats), all % to 1 decimal,
all units integers. A global guard: any cell that would render >6 significant
raw digits is a bug. Verifier greps the rendered DOM for `\d{4,}\.\d{3,}`.

## V2.5 Daily grain UI (minimum bar)
- Sales: daily net-revenue chart per channel (stack/line toggle, 7d MA,
  range presets 30d/90d/12m/all), built from tier-2/3 history + native where
  present; per-SKU daily units drill (Categorywise); weekday pattern panel;
  channel mix over months (stacked area); MoM table per channel with
  like-for-like partial-month handling; AOV trend.
- Marketing: monthly spend vs revenue per channel across ALL history (Snell
  TCOS trend vs the sheet's own TCOS columns as cross-check), May per-SKU
  deep-dive clearly badged by basis, breakeven-ACOS only where same-window.
- Finance: unchanged model, plus provenance chips, coverage-aware month list,
  agency-tier months show channel-level CM (SKU matrix only for native months,
  with an explicit "needs native reports" note elsewhere).
- In-tool upload: a visible "Upload reports" button on Finance/Sales/Marketing
  opening the business upload zones (same modal); per-zone last-upload + tier
  shown; uploads upsert + override per V2.1.

## V2.6 Acceptance
A fresh-context founder-analyst reviewer audits the RUNNING tool with real
data and must find zero critical/major issues across: daily-grain visibility,
full Snell/Monarch exploitation, working dedup/override upload, margin-basis
traceability, formatting/sanity, instant-comprehension UX, and depth
exceeding the inventory module — plus a "nothing left on the table" judgment.
