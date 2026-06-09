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
- **M4 — old dry-berry stays 0 sellable + discontinued.** `oldStockOnly` flag →
  reorder=false, excluded from `skusRunningOut`. Engine twins now deplete the OLD
  bucket for post-audit ship-outs (no phantom negatives) — `negative_stock` 4→1
  (surviving NSSBJ500 −1 is a real over-ship). Old value tracked (₹13.94 L).
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
- **ISSUE 4 (NEEDS FOUNDER SIGN-OFF)** — the 3 discontinued dry-berry SKUs carry
  live cross-marketplace demand (~42 units/day) with thin buffers yet, per M4, are
  silent on reorder. This is M4 as ruled, but the tool is intentionally quiet on
  real ongoing sales — confirm intended.

## Still open / maintenance
- Engine twins (`centralWhEngine.js` + `build-central-wh.cjs`) are duplicate
  logic — keep in sync.
- Juice air pouch treated as non-constraining (air-wrap) — flag if that's wrong.
- Component inbound/PO sheet not yet modelled (deplete-only) — add when ready.
- Cascade "total runway = Infinity when WH residual velocity = 0 and a channel
  has 0 velocity" — defensible; optional redefinition pending (P2-4 — the Sim/
  RunwayTab still coerce that Infinity to 0d for true zero-demand SKUs).
