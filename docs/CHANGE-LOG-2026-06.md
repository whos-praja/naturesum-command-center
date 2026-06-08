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

## Still open / maintenance
- Engine twins (`centralWhEngine.js` + `build-central-wh.cjs`) are duplicate
  logic — keep in sync.
- Juice air pouch treated as non-constraining (air-wrap) — flag if that's wrong.
- Component inbound/PO sheet not yet modelled (deplete-only) — add when ready.
- Cascade "total runway = Infinity when WH residual velocity = 0 and a channel
  has 0 velocity" — defensible; optional redefinition pending.
