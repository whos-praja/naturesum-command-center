# Accuracy Overhaul — Change Log & Conformance (2026-06)

Mission-critical pass to make every number trustworthy. Driven by the founder's
8 decisions (FIX-SPEC-2026-06.md) + an end-to-end supply-chain re-derivation.
Verified against `Naturesum Live Inventory (6).xlsx` (anchor 5-Jun audit, rolls
forward to 8-Jun). Build clean · runtime clean.

## The root cause that's now fixed
`data.js` had a STALE hardcoded `ITEM_QTY` map feeding the Materials breakdown /
producible / bottleneck (Moringa raw 200, dry-berry 946.79, Moringa pouch 0),
while the central-WH engine parsed the audit correctly. **`ITEM_QTY` + the legacy
`liveInventory`/`nitin` synth path are removed.** The central-WH engine
(`centralWhEngine.js` runtime + `build-central-wh.cjs` offline twin) is now the
SINGLE source for warehouse FG + every component.

## Changes by area

**Engine twins (`centralWhEngine.js`, `build-central-wh.cjs`)**
- Robust latest-audit detection (date parsed from sheet name + cross-checked
  against the "As of" cell; tolerant of future naming changes); fail-loud if no
  audit tab.
- Central WH ignores any cutoff: latest audit baseline + daily-movement /
  production strictly AFTER the audit date (deplete-only, no inbound sheet).
- `NON_CONSTRAINING` set — cartons (CB100/250) + juice air pouches (JB300/500):
  excluded from producible/bottleneck; every component carries a `constrains`
  flag. Outer boxes (faceoil/jatamansi/tea) DO constrain (primary packaging).
- Per-component metrics: stock, consumption, days-cover, lead time, reorder flag.
- Offline/marketing spike flag retained.

**`data.js`**
- Single-source: component rows / producible / bottleneck from the engine.
- Velocity = MAX(30-day, 14-day) sales rate per channel; central-WH velocity =
  sum of channel SALES velocities (never warehouse movement).
- Old stock excluded from runway / reorder / bottleneck / producible; included in
  value only.
- Total value helper = Σ all locations × SP (WH new+old + Amazon + Flipkart +
  Blinkit), each once.
- Per-component reorder (raw + primary packaging) exposed.

**Ingestion (`uploadParsers.js`, `multiFileStore.js`, `UploadModal.jsx`)**
- Per-sheet cutoff honored (rows after cutoff dropped); persistence fixed so
  distinct cutoffs survive a hard refresh.
- Central-Warehouse zone has NO cutoff picker (shows an explanatory note).
- 14-day sales bucket added (Shopify + agency) for the velocity rule.

**Frontend (`PageInventory.jsx`, `PageSuppliers.jsx`, `formulaParams.js`)**
- "Total stock value" = all locations × SP, "incl. ₹X old stock" line; the
  misleading "sample data · last MIS sync" label is gone — real data labelled
  truthfully with its as-of date.
- Materials breakdown reads engine components; non-constraining components marked
  and excluded from the bottleneck pill.
- New "Component reorder" tab (Suppliers) — raw + primary packaging reorder dates.
- Formula popovers rewritten to the final sales-based model.

## Conformance — reported bugs (verified on file 6)
| Reported issue | Now |
|---|---|
| Moringa raw shown 200kg | **100kg** ✓ |
| Dry-berry raw shown ~950kg | **0kg** ✓ |
| Moringa 100g pouch "out of stock" | **2935** ✓ (producible bound by raw, not phantom pouch) |
| Cartons in runway/bottleneck | **excluded** (constrains=false); outer boxes still constrain ✓ |
| Old stock in runway/reorder/bottleneck | **excluded**; value-only ✓ |
| "sample data" label on real data | **removed** ✓ |
| Total value scope | **all locations × SP** = ₹72.3L (incl ₹14.06L old) ✓ |
| Cutoff equalizes on refresh / central-WH cutoff | **per-sheet persisted; central-WH has none** ✓ |
| Wrong audit taken | **latest = 5-Jun `Audit 050626`**, rolls to 8-Jun ✓ |

## 6 objectives
O1 truthful stock ✓ · O2 runway (sales-based) ✓ · O3 reorder dates (FG +
components, adjustable leads) ✓ · O4 total value (all locations, no double-count,
old included) ✓ · O5 smaller reqs ✓ · O6 durability (browser ingestion, latest
audit auto-detect, fail-loud) ✓.

## Lead-auditor pass 2 (2026-06, code-level fixes)
Confirmed code-level bugs fixed; model/conceptual concerns (M1–M9) left for the
founder report. Build + load clean; all reported conformance items still hold;
total value moved ₹72.32L → ₹72.62L (the +₹0.30L is the now-counted Flipkart
multi-pack stock — P1-8 — not an inflation).

- **P0-1 growth never max-trailing-MoM** — the bundled agency/shopify artifacts
  lacked `monthly[]` (and `sales14d`/`sales90d`), so `maxMoMGrowth()` got null and
  silently fell to single-MoM. Regenerated both bundles via the parsers' current
  output; added a committed generator `scripts/build-bundled-agency.cjs` (offline
  twin of `processAgencyDailyLogTab`) so the agency bundle can't drift again.
  NSSB100 amazon growth −18.2 (single-MoM) → +13.5 (max-MoM).
- **P0-2 forecast fake trend** (`PageInventory.jsx` ForecastTab) — replaced the
  hardcoded `trendForIdx[idx]` array (keyed by row index) with the SKU's real
  growth factor `1 + (centralWhGrowth ?? growth)/100`.
- **P0-3 component consumption on movement velocity** (`data.js`
  `centralWhComponents`) — recomputed consumption/daysCover/reorder/blocks from
  the SALES-based per-SKU velocity (Σ sku.velocity × perPack) instead of the
  engine's Daily-Movement `sales30`. Kills spurious reorders (NSSBPR 34d→111d,
  NSPKGSBP500 4d→16d, NSMLPR 41d→1053d). Defensive `consumption ≥ 0` clamp added
  to BOTH engine twins (P2-3 — NSPKGDBP500 −1.033 → 0).
- **P1-1 dashboard reorder count** (`PageInventory.jsx`) — `materialsToReorder`
  now derives from `D.centralWh.components.filter(reorder && constrains)` (same
  engine source as the Suppliers tab), not the legacy flat-30d warehouseBreakdown
  path. Resolves the dashboard-vs-Suppliers contradiction (P2-2).
- **P1-2 Flipkart modal velocity / days-of-cover** — use
  `sku.channelVelocity.flipkart` (MAX(30,14)) instead of 30d-only; MoM kept on
  the pure 30d basis; relabeled "max(30,14)".
- **P1-3 Blinkit modal per-WH + avg /d velocity** — `blkPerWhVelocity` and the
  summary "avg /d" now use MAX(30d,15d) (added per-WH `sales15d` in data.js);
  relabeled "max(30,15)".
- **P1-4 RunwayTab current-mode growth** — current mode no longer applies the
  growth factor to displayed runway (§3.5: current = current pace); growth is
  reserved for the custom what-if.
- **P1-5/P1-6 Shopify sales14d + monthly[]** — added to the offline
  `import-marketplace-data.cjs` parseShopify and regenerated
  `realMarketplaceData.js` (stock snapshots byte-identical; only shopify gained
  the fields). shopify velocityWindow now max(30,14) on all SKUs, not 30d-only.
- **P1-7 NSACDT30 in agency bundle** — added the `acacia catechu → NSACDT30`
  alias to the live + offline agency name maps; NSACDT30 now carries real agency
  velocity (1.0 fallback → 1.3/d) + growth.
- **P1-8 Flipkart multi-pack fold (R-MULTIPACK)** — `parseFlipkart` (live +
  offline) strips `*N`, resolves the base SKU, folds N× units/sales into it.
  NSSBDB100 FK live 74 → 150, sales30d 59 → 121. (Blinkit native is name/UoM
  snapshot with no `*N` rows — no change needed there; agency Blinkit already
  folds multipacks.)
- **P3-7 stale rebuild default** — `build-central-wh.cjs` no longer defaults to
  the stale "(2).xlsx"; it resolves the latest "Naturesum Live Inventory*.xlsx"
  by mtime and fails loud if none is found.

## Model-level fixes (M1–M8) — founder rulings, 2026-06

The first-principles verification (`docs/VERIFICATION-2026-07.md`) surfaced 8
MODEL-level concerns (not arithmetic) that needed founder judgement. Rulings +
implementation:

- **M1/M2/M7 — headline runway = NETWORK CASCADE.** `computeCascade` (imported
  into data.js) now drives `centralWhRunway`: marketplaces drain their own buffer
  first, the WH backstops, runway = the day the WH itself hits zero. WH stock fed
  in = sellable = FG + producible (M2). The old flat `FG ÷ Σ all-channel velocity`
  is kept as a labelled `centralWhRunwayWhOnly` "WH-only worst case" line. Fixed
  network-healthy SKUs reading RED (NSSB100 47-flat-red → 173-network-green / 94
  WH-only). Drill modal + the `runway` formula popover relabelled.
- **M3 — producible = CONSTRAINED ALLOCATION of shared inputs by demand share.**
  A shared pool (Moringa raw → NSMP100+NSMP250; SB powder raw → 3 SKUs; juice pulp
  → 2; face-oil raw → 2) is split across consumers by `velocity × perPack`, then
  producible = min over allocated caps. Moringa 100 kg → NSMP100 800 + NSMP250 80
  (= 100 kg) instead of the impossible 1000 + 400. Uses the full SKU_RECIPE BOM
  (incl. juice tube/label → closes the engine BOM gap, M8). Rows carry
  `shared`/`sharedWith`/`fullCapacity`; Materials breakdown shows the allocated
  capacity + "also used by".
- **M4 — old dry-berry = ACTIVE old-stock-selling (NOT discontinued).** Founder
  clarification: the dry-berry lines have no FRESH stock, but the OLD batches are
  the LIVE selling inventory (~42 units/day) and fresh raw WILL be reordered. So
  when a SKU has 0 fresh stock but old stock that's still selling (velocity > 0),
  the old stock is counted as the WH cover: runway = real old-stock cover, reorder
  fires normally, included in `skusRunningOut`. (The general "old excluded from
  runway/producible/value-only" rule still holds for SKUs that have fresh stock,
  or old stock with NO demand — genuinely dead stock.) Flagged `oldStockSelling`
  with a "selling through old stock · reorder fresh raw" caption. Engine twins
  deplete the OLD bucket for post-audit ship-outs (no phantom negatives) —
  `negative_stock` 4→1 (surviving NSSBJ500 −1 is a real over-ship). Result:
  NSSBDB250/500 red + reorder (41/45 d < 50 d lead), NSSBDB100 amber watch
  (53 d, can't replenish). Old value tracked (₹13.94 L).
- **M5 — growth clamp +200% → +75% (`GROWTH_CAP`).** Velocity already uses the
  peak (30,14) window, so the forward uplift is capped to avoid double-counting
  the surge. `growthCapped` flag + a "capped +75%" Forecast chip + popover note.
- **M6 — `whBaseVelocity` kept 0 deliberately.** The minor direct-WH-sales lane
  isn't cleanly isolable from the exports without double-counting the website
  demand already folded into the Amazon channel. Documented; revisit if a clean
  direct lane lands.

Fixed a pre-existing crash in the offline twin (`compRowOccurrences` referenced
but never declared) — completed the duplicate-component-row flag in BOTH twins.

## Adversarial verification of M1–M8 (independent re-derivation)

A 6-agent workflow re-derived every number from the raw workbook (not the tool's
output). **All core PO-driving numbers reproduced to the unit** — FG roll-forward,
cascade runway + WH-only line, demand-share allocation, OLD-bucket depletion,
+75% cap, ₹72.49 L total; 0 invariant violations across 14 SKUs; build/runtime
clean. It found **4 surface/consistency gaps**; 3 fixed, 1 deferred to founder:

- **ISSUE 1 (fixed)** — Unified Stock WH cell showed FG÷vel (15d amber) while the
  row + modal showed the cascade (117d green). The cell now shows the network
  runway + row status (`runwayOverride`/`tierOverride` on PlatformCell).
- **ISSUE 2 (fixed)** — Simulator baseline re-seeded the FULL shared pool → sim
  producible 1000 vs headline 800. Now seeds the allocated share (80 kg → 800).
- **ISSUE 3 (fixed)** — cascade greened a can't-replenish, WH-thin SKU (NSACDT30:
  net 52 green but producible 0 / WH-only 19 / +65% growth). New `thinUnmakeable`
  flag escalates green→amber (producible 0 && WH-only ≤ lead) with a drill caption.
  Catches NSACDT30 + NSSBJ300.
- **ISSUE 4 (RESOLVED by founder)** — the 3 dry-berry SKUs carry live
  cross-marketplace demand (~42 units/day). Founder confirmed they are NOT
  discontinued (fresh raw will be reordered), so the M4 "silent/discontinued"
  behaviour was reversed: old-stock-selling SKUs now count their old stock as
  cover and fire reorder normally (see corrected M4 above).

## Pass 4 (2026-06) — founder spot-checks + first-principles hardening

Full analysis: `docs/FIRST-PRINCIPLES-2026-06.md`. Summary:
- **Juice tubes ≠ bottles**: `"Juice containers (Package)"` audit rows (1826/
  2022) re-aliased to the TUBE refs; glass bottles have no audit line → now
  UNTRACKED, not phantom-zero.
- **Juice air pouches now count**: `"Air pouches (300ML)/(500ML)"` (910/1000)
  aliased + `NSPKGJB300/500` removed from NON_CONSTRAINING (founder: real
  packing components, not air-wrap). Only outer cartons remain non-constraining.
- **UNTRACKED rule (phantom-zero guard, generalised)**: any BOM ref with no
  audit line = stock UNKNOWN ≠ 0 → flagged, labelled "untracked" in UI,
  excluded from producible/bottleneck/worst-cover/M3/Simulator binding.
- **R-FUZZY name robustness**: digit-unit splitting in `norm()` ("100gm" ≡
  "100 g") + conservative fuzzy alias fallback (numeric tokens exact, Dice
  ≥ 0.8, unambiguous) across audit/production/daily-movement (engine twins)
  AND agency column headers (parser twins). Every hit FLAGGED in the DQ panel;
  unknown names still flag unmapped. Synthetic altered-names test passes; real
  workbook byte-identical. Immediately fixed a real miss: Production's
  "AC Tea Pouches(Green, Filled)" now maps → Acacia SFG production counted.
- **Blinkit cell velocity** (founder): Unified Stock Blinkit cell now shows the
  full meta row (days-cover, vel/d max(30,15), MoM) like other channels.
- **Reorder horizons in months/years** (founder): "Sep 14 · in ~3.1 mo" across
  Runway risk cards, materials table, Suppliers component tab.
- **Component suggested order qty** (Suppliers): ceil(consumption × (lead+30d)
  − stock) — e.g. juice pulp → order 1,343 Ltr.
- DQ panel: new "Fuzzy name matches" + "Duplicate component rows" sections;
  BOM gaps relabelled "Untracked components".
- Headline numbers unchanged (expected): ₹72,48,755 · 3r/5a/6g · 3 reorders.

## Still open / maintenance
- Engine twins (`centralWhEngine.js` + `build-central-wh.cjs`) are duplicate
  logic — keep in sync. (Agency parser twins too: `uploadParsers.js` ↔
  `build-bundled-agency.cjs`.)
- Component inbound/PO sheet not yet modelled (deplete-only) — add when ready.
- Cascade "total runway = Infinity when WH residual velocity = 0 and a channel
  has 0 velocity" — defensible; optional redefinition pending (P2-4 — the Sim/
  RunwayTab still coerce that Infinity to 0d for true zero-demand SKUs).

## Business module (pass 5) — Business Performance (2026-06)

New module: genuine business visibility (sales, revenue, growth, ads, margins).
Built against `docs/BUSINESS-MODULE-SPEC.md` (founder-approved 2026-06-11, the 11
binding decisions). Verification record: `docs/VERIFICATION-BUSINESS-2026-06.md`.
Channels (amazon · flipkart · blinkit · website) are a first-class dimension
everywhere — adding one needs only a parser + a fee row, never a consumer edit.

**Fact store + bundled baseline (twin discipline)**
- `src/lib/businessStore.js` — durable AGGREGATED fact store under localStorage
  `ns.businessPerf` (schemaVersion 1): `monthly["YYYY-MM|channel|CODE"]`
  (authoritative units/grossRev/netRev/returns/adSpendDirect) + `daily[...]`
  (shape/trend). `upsertFacts`/`clearSource` (exact inverse via a `meta.contrib`
  snapshot) / `mergedFacts` (bundled baseline ⊕ uploads, uploaded wins per
  key+source). Re-upload REPLACES same-key facts (idempotent — V3-proven).
- `src/bundledBusinessData.js` — May-2026 baseline, baked by the offline twin
  `scripts/build-business-data.cjs` from the raw `~/Downloads` files (same twin
  pattern as centralWhEngine). Bakes Snell/Monarch channel ad totals + the FK
  cashback note + the capped mcfShare into `meta.bySource`.
- `src/lib/businessParsers.js` — fail-loud browser parsers (schema drift → throw,
  never silent 0) reusing `uploadParsers.js` CODE_MAP + the binding ASIN map;
  Blinkit keyed on Item Id with conservative fuzzy title fallback.

**Cost inputs (no-sheet-next-time provision, spec §4/§5/§7)**
- `src/lib/costInputs.js` — baked §4 COGS (14 cards, 2 ₹0-pkg placeholders flagged)
  + §5 variable platform %s (the ONLY BusinessModel numbers used; deductions tab
  used nowhere). `getCostCard`/`getFeePct`/`getMcfShare`/`getFixedCost` + setters
  writing `ns.bizCost.*` localStorage overrides. Every figure carries as-of +
  source. Website fee = blended mcf-web/website-direct via mcfShare; the May
  mcfShare proxy overshoots 1.0 (652 MCF units > 610 net website units) so the
  build caps it to [0,1] (share=1, blended fee 24.8011%, UI "⚠ capped 100%").

**Engine (pure, NaN-free, spec §6)**
- `src/lib/cmEngine.js` — `computeCM({ facts, month, costs?, adSpendOverride? })`
  → `{ byChannel, bySku, matrix, company, adAllocation, coverage }`. CM1→CM4 per
  channel × SKU; SKU×channel CM3 matrix (headline view); ad allocation =
  direct + max(0, channelTotal − Σ direct) split by netRev share (totals from
  param → localStorage → meta-derived Snell/Monarch → Σ direct). Absent COGS →
  null CM (excluded from rollups, flagged in `coverage`), never 0. CM4 null until
  a monthly fixed cost is set. Node self-test 17/17.

**Pages (fabricated stub data DELETED, un-gated from preview/blur)**
- `src/pages/PageFinance.jsx` — CM waterfall (channel + company), SKU×channel CM3
  matrix, SKU economics cards, Cost Inputs panel, Coverage tab
  (`src/components/BizCoveragePanel.jsx`), CM4 view (captioned "reporting view";
  CM3 stays the decision layer), and the Verification panel. PageSales /
  PageMarketing consume the same fact store.

**Verification panel (permanent regression net, spec §10)**
- `src/lib/businessVerification.js` — every §2/§3 May anchor as
  `{ id, label, expected, filter, compute(facts) }`; `runVerification(facts)` →
  MATCH/DRIFT(δ) per anchor against the live store. 15 anchors, all pinned
  (`PENDING_ANCHORS` empty). Node self-test 19/19. Anchors change ONLY when a new
  bundled baseline ships.

**Gate result (2026-06-12):** `runVerification(BUNDLED_BUSINESS)` = 15/15 MATCH,
0 DRIFT; engine 17/17 + verification 19/19 self-tests pass; build twin reproduces
`bundledBusinessData.js` with zero git diff; zero NaN/Infinity across full engine
output; `npm run build` clean. May headline: netRev ₹21,12,823 · CM1 ₹11,63,961
(55.1%) · CM2 ₹6,45,619 (30.6%) · CM3 −₹48,283 (−2.3%) · CM4 hidden (no fixed
cost set). See `docs/VERIFICATION-BUSINESS-2026-06.md` for the anchor table,
hand-recomputed CM chains, durability proofs, and the 5 caveats.

---

## FIXER ROUND 1 (2026-06-12) — founder-analyst audit follow-up

Four findings from the fresh-context founder-analyst review of the running tool, all fixed. All verification anchors stay green (15/15 v1 + 3 history MATCH on the rebuilt bundle); engine 17/17 + verification self-tests pass; `npm run build` clean.

**[MAJOR] Finding 1 — Amazon history truncated at Jun-2025 in the headline Sales views.**
The MoM table, channel-mix area, and AOV trend used `monthlyNetRevByChannel(facts, { lastN: 13 })`, clipping the 22-month monthly history (Amazon back to Aug-2024) to the last 13 months. The daily net-revenue chart's "all" range stopped at Jun-2025 because `thinDailyHistory(13)` dropped all daily cells older than 13 months for the localStorage budget.
- `src/pages/PageSales.jsx` — removed the `lastN: 13` cap on `headline`; MoM / channel-mix / AOV now span the full Aug-2024→ monthly history (zero bundle cost — monthly facts already existed back that far).
- `scripts/build-business-data.cjs` — `thinDailyHistory(monthsKept, keepFullSpan=["amazon"])` now retains Amazon's ENTIRE daily span (the 0-to-1 growth curve) while keeping the 13-month cap for FK/Blinkit/website. Rebuilt: Amazon daily now runs **2024-08-02 → 2026-06-10 (583 days)**; bundle 575 KB → 620 KB (+8%, justified). All anchors re-verified green.

**[MINOR] Finding 4 — header/per-chart copy now matches the real coverage windows.** Updated the "How to read" note + the daily-chart, MoM, and section subtitles to state honestly that monthly views span the full agency history (Amazon Aug-2024, FK/website Jun-2025, Blinkit Dec-2025) and that daily grain follows the same per-channel windows. Added a per-channel "since <first day>" marker to the daily-chart legend so each series' window is explicit.

**[MINOR] Finding 2 — wrong ad-basis label on Flipkart/Website rows (Finance page).** `AdBasisChip` showed "SP actual" (Amazon Sponsored Products terminology) on every ACTUAL-basis row including Flipkart and Website. Made the chip channel-aware (`ACTUAL_LABEL_BY_CHANNEL = { amazon: "SP actual", flipkart: "PLA actual", website: "Google actual" }`), matching the Marketing page vocabulary exactly. Applied `channel={…}` to the per-channel waterfall, the agency-month channel-CM table, and the SKU drill rows. Generic legend chips clarified to "per-product attribution (Amazon SP · Flipkart PLA · website Google)".

**[MINOR] Finding 3 — platform-fee % inputs showed raw 4-decimal floats.** The Cost-inputs `FeeRow` input rendered `(fee.pct*100).toFixed(4)` → "27.5413%", violating the V2.4 "% to 1 decimal" contract. Now displays 1 decimal (27.5% / 24.8% / 10.4% / 23.3% / 25.7%); the precise baked fraction is unchanged in the engine, and the dirty-check compares against the shown 1-dp value so an untouched default never spuriously flags Save or rounds the stored fraction.

---

## FIXER ROUND 2 (2026-06-12) — v2 founder-analyst review: 6 minors closed + 5 "left on the table" views built

The v2 business module passed a fresh founder-analyst review with **zero critical/major**. This round closes the 6 `[MINOR]` findings and builds the 5 upside views the reviewer flagged as data-already-loaded. All anchors stay green (18 v1+history MATCH + 3 INFO on the rebuilt bundle); engine + verification self-tests pass; `npm run build` clean; SSR-render of all three pages = zero render errors, zero raw-float (`\d{4,}\.\d{3,}`) hits.

### The 6 minors

- **[M1] Snell agency Amazon net was double-GST-discounted.** The build divided Snell "Final Net Without Review" (c22) by 1.05 — but that column is ALREADY net-of-GST, so every agency Amazon month ran ~5% low. `scripts/build-business-data.cjs` now uses `C.amzNet` **AS-IS** (no `/1.05`). Agency Amazon net corrected: **Nov-25 761,266 → 799,329 · Mar-26 1,215,940 → 1,276,737**; May agency net 1,213,769 (= **+6.15%** vs native 1,143,450 — return-tail/review timing; native still wins per V2.1, agency is shadow-only). Anchors `snell-amazon-net-may` (1,213,768.71) and `recon-amazon-may-delta` (+6.15%) updated and re-verified MATCH; the build's `netColumnChoice.amazon` note records the methodology. May agency-vs-native recon re-checked sane (+6.15% Amazon / +0.59% FK / 0% Blinkit-gross).
- **[M2] Marketing all-period ad-spend headline (₹51.15L) itemized.** New `PeriodSpendItemization` hover-popover (same style as the AMS card) breaks the total down by channel — naming each channel's ad source incl. the **FK-side Google Spend column** on the Monarch Master Sheet for website — with each channel's spend window (first→last month). MTD June excluded.
- **[M3] Agency-only Blinkit months get the Δ reconciliation chip.** New `BlinkitAgencyReconNote` (Finance waterfall) surfaces, for agency-tier Blinkit months, the proxy net (gross÷1.05, CESS-blind) vs the estimated true tax-netted net and the Δ — the same Δ treatment as the native↔agency note, badged "proxy — upload native to resolve."
- **[M4] Alloc-by-rev rows excluded from the SKU "losing per ad rupee" COUNT.** Marketing's loss count is now `losingAll.filter(r => r.basis !== ALLOC)` (SKU-attributed only); alloc-by-rev loss-rows stay **visible (greyed)** in the table and are reported separately at the channel level ("+N alloc-by-rev channels above breakeven — channel-level, excluded from the count"). Caption + legend updated.
- **[M5] CM-trend early-ramp months annotated, not alarming.** `CMTrendView` marks any month whose company (or channel) net revenue is below the low-base floor as **"low base · ₹X rev"**; the chart caps the plotted CM3% for those months (uncapped value stays in the tooltip + table) so Dec-24 (−268.6% CM3 over a tiny base) no longer crushes the axis or reads as an alarm.
- **[M6] Footer "Last sync · 21 May 10:42 IST" replaced with data freshness.** The sidebar footer (`Nav.jsx`) now reads **"Data through · <latest data date>"** (= `meta.latestDataDate`, baked by the build as the max order/invoice/spend date across all facts = **10 Jun 2026**) plus **"app build · <date>"** as separate context. No more sync-clock that read as staleness.

### The 5 upside views (data already in loaded sources; source-labelled per founder rule 9)

- **[A] Retention + returns trend** (Sales) — `RetentionReturnsPanel` from BusinessModel "Repeats" + "Returns" tabs (HISTORICAL actuals): Shopify repeat % by quarter (**7.9% → 15.1%**), Amazon repeat share, returning-customer sales %, and Shopify returns % by month (14 months).
- **[B] SEO keyword-rank panel** (Marketing) — `SeoKeywordRanks` from Monarch "SEO - Keywords" tab: top keywords with rank-now vs 30/90d-ago and movement arrows (30 kept keywords across 4 snapshots).
- **[C] Google vs Meta efficiency** (Marketing) — `PlatformEfficiency` from Monarch daily Google/Meta ROAS+CPA columns: monthly ROAS + CPA per platform side-by-side (13 months) — the budgeting decision view, with a same-window guard and a one-line steer.
- **[D] Per-SKU × channel monthly units mix** (Sales) — `SkuChannelMix` from Snell Categorywise daily per-SKU units (269 monthly SKU keys): the per-SKU drill gains a channel-split monthly-bars view ("which channel is this SKU winning/losing on").
- **[E] Cancel-rate KPI** (Sales) — `CancelRatePanel` from Snell Sale-tab shipped-vs-cancel unit columns (+ Amazon All-Orders cancelled rows): cancel-rate trend per channel (amazon/flipkart/blinkit) with threshold coloring.

### Gate result (FIXER ROUND 2, 2026-06-12)
`runVerification(BUNDLED_BUSINESS)` = **18 MATCH · 3 INFO · 0 DRIFT/PENDING/NO-DATA**; `runFormattingSanity` walks 124 engine cells with 0 failures. cmEngine self-test 61/61, businessVerification self-test 34/34. `scripts/build-business-data.cjs` reproduces `bundledBusinessData.js` with zero data diff (timestamps only — idempotent). `npm run build` clean. SSR-render (PageSales/PageMarketing/PageFinance + every Finance tab) — **zero render errors, zero raw-float regex hits**; all minor + view markers present against real data. Harnesses: `scripts/ssr-gate.mjs`, `scripts/ssr-spotcheck.mjs`. M1 spot-check: agency Nov-25 amazon net **799,329** (sheet-consistent), Mar-26 **1,276,737**.
