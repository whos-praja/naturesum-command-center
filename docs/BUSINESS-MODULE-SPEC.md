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
2. **Amazon sales** = All-Orders rows with `sales-channel == "Amazon.in"` ONLY.
   Non-Amazon rows (MCF) are NOT Amazon sales (website fulfilment).
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
11. **Amazon returns: NET OUT** of Amazon revenue/units (refund/return rows in
    All-Orders). **CM4: show it**, with an in-tool editable "fixed costs for
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
| amazon | All-Orders TSV | Σ item-price over `sales-channel=Amazon.in`, item-status shipped/shippable, MINUS return/refund rows; net = gross ÷ 1.05 | gross ≈ ₹12,38,808 · units ≈ 1,430 (pre-return-netting; pin post-netting numbers) |
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
