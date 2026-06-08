# FIX SPEC — mission-critical accuracy overhaul (2026-06, founder-approved)

This supersedes conflicting older notes. The workflow MUST implement all of it,
audit every displayed number end-to-end as a supply-chain expert, fix anything
else found, keep a change log, and leave the tree building + verified. Reference
warehouse workbook: `Naturesum Live Inventory (6).xlsx` (latest audit = 5 Jun
2026 `Audit 050626`; daily movement to 8 Jun; production to 4 Jun).

## The disease (root cause of the wrong numbers)
`data.js` has a STALE hardcoded `ITEM_QTY` map (NSMLPR:200, NSSBDBR:946.79,
NSPKGMP100:0 …) feeding the Materials breakdown / producible / bottleneck, while
the central-WH engine parses the audit correctly (100 / 0 / 2935). KILL
`ITEM_QTY` + the legacy `liveInventory`/`nitin` synth path. The central-WH engine
(`centralWhEngine.js` runtime + `build-central-wh.cjs` offline twin) is the
SINGLE source for warehouse FG + every component.

## Decisions (binding)

**D1 — Non-constraining components.** EXCLUDE from producible/bottleneck/runway
(easily/quickly arranged): cartons `NSPKGCB100`,`NSPKGCB250`; juice air pouches
`NSPKGJB300`,`NSPKGJB500` (air-wrap/protective — FLAG for confirm); plus any
non-BOM consumable (shipping cartons, golden/MRP stickers, tape, plastic seal,
foam, juice air-wrap). CONSTRAIN (genuine): all raw materials; primary pouches
(`NSPKGMP*`,`NSPKGSBP*`,`NSPKGDBP*`, tea-bag pouch `NSPKGACTC30`); bottles
(`NSPKGBOBT15/30`,`NSPKGJBOT300/500`); SFG (`NSJOF100`,`NSACDSF30`);
droppers/caps (`NSPKGBODROP`,`NSPKGBOCAP`); **outer boxes**
(`NSPKGBOB15/30` faceoil, `NSPKGJOB100` jatamansi, `NSPKGACTCBOX` tea) — these ARE
primary packaging for those products; juice tube/label (`NSPKGJTUB*`,`NSPKGJLBL*`
— keep constraining, already flagged BOM gaps). Define one exported
`NON_CONSTRAINING` set; producible = min over CONSTRAINING BOM components only.

**D2 — Cutoff dates.** Per-sheet for marketplace/sales sheets: ignore any row
dated AFTER that sheet's cutoff. **Central-warehouse workbook has NO cutoff** —
remove the cutoff picker for that zone; it ALWAYS uses the latest audit as
baseline + daily-movement/production rows dated strictly AFTER the audit date
(exclude on/before audit, no upper bound). Fix the persistence bug so each
sheet's cutoff survives a hard refresh (today they equalize).

**D3 — Old stock.** Exclude from ALL ops: runway, reorder, bottleneck, and it
does NOT count toward producible (no old raw expected, but if present, excluded).
Included in total VALUE only; shown as a separate line.

**D4 — Total stock value.** Σ over ALL locations of units × selling price, each
unit counted once: WH FG (new + old) + Amazon FBA + Flipkart + Blinkit. FK is a
physically separate pool (no double-count). Relabel the card; remove the
"sample data · last MIS sync" text — bundled/live data is REAL, never call it
sample.

**D5 — Velocity window.** Per channel, velocity = **MAX(30-day avg, 14-day avg)**
(conservative — plan for the higher recent demand). Need a 14-day sales bucket;
where exact 14d isn't available use the nearest (Blinkit 15d) else fall back to
30d, and flag. Growth stays max-trailing-MoM.

**D6 — Reorder coverage.** Reorder dates for FG **and** components (raw materials
+ primary packaging), each with its own lead time. Reorder date = as-of +
(runway − leadTime); negative = overdue.

**D7 — Audit selection.** Always the SINGLE latest-dated audit. Detect the date
robustly from the sheet name even if the naming convention shifts on a future
upload (parse any `audit … <date-ish>` pattern; cross-check the "As of <date>"
cell; pick max date; ignore detailed "V-2" variants and the partial
" warehouse inventory" sheet unless one is strictly newer). FAIL-LOUD if no audit
sheet is detectable.

**D8 — Component replenishment.** Deplete-only from the audit baseline via
post-audit production consumption (no inbound/PO sheet yet). Component runway
therefore only decreases until a newer audit is uploaded.

## Structural + frontend
- Kill `ITEM_QTY` + legacy `liveInventory`/`nitin` synth path; engine = single
  warehouse source. Marketplace stock = latest snapshot per export.
- Frontend honesty sweep: no "sample data" for real data; every card states its
  true source + as-of date; cards that misstate scope/source fixed.
- Fail-loud everywhere: any unmapped audit/sheet row → visible Data-Quality flag,
  never a silent wrong/zero number.

## Mandate
Audit EVERY number end-to-end as a supply-chain expert (stock, runway, velocity,
growth, reorder, value, producible, bottleneck, per-location, simulator,
forecast). Find inaccuracies beyond this list, fix with best judgement, keep a
change log (`docs/CHANGE-LOG-2026-06.md`), and only stop when the tool's numbers
can be trusted for real business decisions. Build must pass; runtime must be
white-screen-free; the reported bugs (Moringa raw 100 not 200; dry berry 0 not
950; Moringa 100g pouch 2935 not OOS; cartons not in bottleneck; old excluded;
value all-locations; no "sample data" label; per-sheet cutoff + none for
central-WH) must all verify against file (6).
