I have everything I need. All verification complete against the live tree. I made no edits (the tree already conforms; Pass-1 and the review work landed correctly). Here is the final conformance report.

---

# Naturesum Inventory Tool — Final 6-Objective Conformance Report

**Basis:** live working tree at `/Users/shivamprajapati/naturesum-command-center`, all numbers re-verified with `node` against `src/data.js` / `src/lib/runwayCascade.js` on today's bundled data (14 SKUs). Build gate `npm run build` exits 0 (113 modules); runtime gate prints `SKUs 14` / `NSSBDB500 status red reorder true`. No edits were made this pass — the tree already satisfies every objective; this report documents the verified state and what remains for the founder.

---

## O1 — Truthful current stock (every stock type, every location) — **MEETS**

**Was broken:** A stocked-out SKU (NSSBDB500: 0 FG, 0 producible) rendered **GREEN** and vanished from every alert, because `runwayStatus` only entered red/amber when `centralWhRunway != null`, and the engine emitted `null` for zero/negative depletion (the overloaded-null bug, Theme B).

**What changed (landed):** `src/data.js:1094-1108` now computes `cwhSellable = fgStock + producible` and applies a **hard zero-sellable guard first** → `cwhSellable <= 0 → "red"`, before any threshold test. WH FG comes from the engine roll-forward (`cwh.fgStock`, new-stock only), marketplace stocks stay on their own snapshot exports (`stock.amazonFBA`, `flipkart.live`, blinkit feeders) — untouched by the overlay (`data.js:1049`).

**Verified now:** NSSBDB500 → `fg=0, producible=0, status="red", reorder=true`; it is included in `skusRunningOut` (5 red SKUs total). Null/NaN sweep across all 14 SKUs on `runway / centralWhVelocity / velocity / centralWhRunway / growth / leadTime / status` → **NONE bad**. Every status ∈ {red, amber, green}.

**Founder input still needed:** none for FG. (Marketplace stock is a latest-snapshot; WH stock is an audit + roll-forward — the two location types are intentionally computed differently per spec §3, which is correct, not a bug.)

---

## O2 — Accurate runway per stock type, per location — **MEETS**

**Was broken:** (a) `computeCascade` destructured `whVelocity` while all call sites passed `whBaseVelocity` → the WH lane silently defaulted to 0, inflating runway on ~86% of SKUs and producing `Infinity` on zero-channel-stock SKUs. (b) Central-WH runway used engine `depletion30` (bulk-shipment movement), misrepresenting consumption.

**What changed (landed):** 
- `runwayCascade.js:49` destructures `whBaseVelocity` and reads it at lines 71/103/107/120 — the WH lane is **live**. Old-key `whVelocity` is now silently ignored (proven below).
- `data.js:1092-1097`: central-WH runway = `round(WH FG ÷ totalSalesVel)`, where `totalSalesVel = channelVelocity.amazon + .flipkart + .blinkit` (sales-based, §3.5). Marketplace runway stays per-channel snapshot ÷ that channel's sales velocity.

**Verified now (live `computeCascade`):**
- WH lane alive: same SKU, `whBaseVelocity=0 → 82.0d` vs `0.8 → 75.9d` (differ).
- Old-key ignored: passing `whVelocity:0.8` → 82.0d (≠ 75.9d) — the fix is in force.
- NSJO100 RunwayTab path end-to-end → `adjRunway = 691d` (finite, no NaN/Inf leak).

**Founder input still needed:** none. (See Simulator + Known-limitations for the WH-lane=0 crater nuance.)

---

## O3 — Reorder dates from adjustable lead times — **MEETS**

**Was broken:** engine `reorder` was `false` whenever runway was null (so stocked-out SKUs never flagged reorder); reorder math read an untrusted ±200-clamped `sku.growth`.

**What changed (landed):** `data.js:1109-1112` — `reorder = cwhSellable <= 0 || (centralWhRunway != null && centralWhRunway <= leadTime)`. Lead time is `cwh.leadDays ?? sku.leadTime` (`data.js:1084`), per-SKU adjustable via the ⓘ override map (`data.js:1119-1125`), and the Simulator exposes `supplierLead` + per-component lead levers (`PageInventory.jsx:2299-2314`). Reorder-by date = `runway − leadTime` (negative ⇒ overdue), confirmed to move 1-for-1 with the lead lever.

**Verified now:** NSSBDB500 `reorder=true`. Lead-lever check: runway 75.9 → reorder-by 54.9d at lead 21, 30.9d at lead 45 (moves exactly with lead). Moringa lead = 25 confirmed landed in Pass-1.

**Founder input still needed:** lead times are seeded from BOM max-component-lead defaults; founder should confirm/tune per-SKU values via the ⓘ popovers when real supplier lead times are known.

---

## O4 — Accurate total value, no double-count / no omission — **PARTIAL**

**Was broken (now fixed):** `unitCost = stockValue / totalStock` collapsed the per-unit price to ≪ SP and to **₹0** for FG-empty SKUs, understating the headline ~44%.

**What changed (landed):** `PageInventory.jsx:1038` — `unitCost = pricing.sp ?? pricing.mrp ?? 0` (selling price directly, §8.3). Headline `warehouseStockValue = Σ stock.warehouse × SP`. Each location counted once (WH FG + Amazon + Flipkart + Blinkit), Flipkart physically separate per §8.2 → no double-count.

**Verified now:** `warehouseStockValue = ₹23,54,980 (23.55L)` — in the expected ₹23–24L band, no longer collapsing.

**Why PARTIAL — still needs founder confirmation:** Spec **§8.4 says old stock must be INCLUDED in total value** (excluded only from runway). The headline currently counts **new FG only**. Old stock is correctly shown separately in the modal (`centralWhOldStock`) and correctly excluded from runway, but its value is **omitted from the headline**: 6 SKUs hold old stock worth **₹14.06L** (e.g. NSSBDB500 664 units × ₹1150 = ₹7.64L) that is not in the ₹23.55L figure. This is a deliberate-looking omission against §8.4, not a math bug. **Founder decision:** confirm whether the headline "Total stock value" should read WH-new-FG-only (current) or WH-new + WH-old + marketplaces (§8.4 literal). If §8.4, add `Σ oldStock × SP` (and ideally surface it as a separate "old stock value" line so it never contaminates runway).

---

## O5 — All smaller requirements — **MEETS** (one item is the O4 founder decision)

Verified present/correct in the tree:
- **Sales-based formula popovers** (`formulaParams.js`): `runway = round(centralWhFG ÷ totalSalesVelocity)` with explicit "NOT warehouse movement" copy; `centralWhVelocity = sum of per-channel SALES velocities"; `runwayStatus` shows the `sellable ≤ 0 → red` guard; growth = "MAX of trailing MoM rates, clamp ±200". The trust feature now matches the computed numbers.
- **Per-channel growth** (`data.js:956-963`): each channel uses its own monthly ladder via `maxMoMGrowth`; null where <2 months exist (not faked).
- **Negative velocity / null guards:** Delta + PlatformCell + SkuBreakdownModal all guard null/non-finite (no "NaN%"/"Infinity"/"nulld" leaks) — confirmed by null sweep.
- **Per-SKU overrides** via ⓘ; **DQ flags wired** (`PageSuppliers.jsx:101` opens QualityFlagsModal reading `D.centralWh.flags`).
- **Upload zones:** 6 real zones with "Central Warehouse Workbook" present, legacy `nitin` retired from the UI, count copy reads "X of 6 sources".

**Founder input still needed:** only the O4 old-stock-value decision above.

---

## O6 — Durability / drop-in (zero code changes per update) — **MEETS**

**Was broken:** WH data was baked offline (`build-central-wh.cjs` → committed `bundledCentralWHData.js`) → updating the warehouse required a code/build/redeploy step.

**What changed / verified:** `centralWhEngine.js` ports the full audit + production + daily-movement roll-forward **in-browser**; `parseCentralWhWorkbook` auto-detects the latest audit by date (`Audit 050626`), rolls forward 1 day to `asOf`, and `buildCentralWhOverride` (`multiFileStore.js:120-123`) makes an uploaded workbook **win over** the bundled artifact (`data.js:35-36`). All 6 marketplace zones already parse-in-browser + persist to localStorage.

**Fail-loud (R-FAILLOUD) verified:** malformed workbooks **throw clear errors** (no Audit tab; missing FINISHED/SEMI/RAW/PACKAGING sections; zero FG rows; null file; corrupt bytes) — never a silent all-zero. Uploaded-over-bundled preference verified for null/empty/malformed → falls back to bundled; valid `.fg` → uses upload.

**Founder input still needed:** none functionally. (Maintenance caveat in Known-limitations: the offline `.cjs` and the browser engine are two copies of the same logic and must be kept in sync.)

---

## Simulator

**Confirmed: the Simulator reuses the base cascade.** `SimulatorTab` calls the **same** `computeCascade` from `src/lib/runwayCascade.js` (`PageInventory.jsx:2386-2394`), identical to the RunwayTab call (`:3005-3013`) and the data.js overlay path. There is no divergent copy.

**Confirmed: sales velocities + live WH lane.** Simulator `baselineState` (`PageInventory.jsx:2245-2263`) seeds from `s.channelVelocity.{amazon,flipkart,blinkit}` (sales-based), decomposes the Shopify D2C leg so `amazonOnly + shopifyOnly == channelVelocity.amazon` exactly (honoring AMZ-001), and derives `whVel = max(0, centralWhVelocity − channelSalesVel)` — the WH lane is seeded from the sales-based number and passed as `whBaseVelocity: projVel.wh` (`:2388`), so the WH lane is **live** (not the old dropped key).

**Perturbation checks (run against `computeCascade`):**
1. **Lead-time lever moves the reorder date** — runway 75.9d: reorder-by = 54.9d at lead 21, 30.9d at lead 45. Moves 1-for-1 with the lead lever. ✅
2. **FBA velocity doubling halves Amazon runway, honoring R-FBA** — Amazon channel buffer: vel 6 → 20.0d, vel 12 → 10.0d (exactly halved). The Amazon lane velocity folds website D2C upstream (`channelVelocity.amazon`), so doubling FBA demand correctly halves Amazon cover while the Shopify leg remains decomposed for display. ✅
3. **Warehouse stock → 0 craters runway** — with a live WH lane (`whBaseVelocity > 0`), base 105.9d → **0.00d** when WH FG = 0 (WH exhausts instantly, can no longer back-stop channels). ✅ (See limitation below for the WH-lane = 0 sub-case.)

---

## Known limitations / still-open

1. **WH-crater is Infinity when `whBaseVelocity == 0`.** Total runway is defined as "the day the central WH hits zero." When a SKU's WH lane residual is 0 (which is the common case, since §3.5 makes `centralWhVelocity == sum(channels)` → residual ≈ 0), setting WH FG → 0 yields `totalRunway = Infinity`, **not** the channel-buffer floor — because the WH only starts draining after the last channel dies (by which point `whRemaining` is already 0, and the final-phase block requires `whRemaining > 0`). If any channel has zero velocity (e.g. NSJO100: flipkart=blinkit=0), that channel never exhausts, the WH is never called, and runway is Infinity regardless. **Effect:** the "warehouse → 0 craters runway" perturbation is only visibly dramatic when there is a live direct-WH lane OR all channels have positive velocity *and* you measure the channel-buffer survival rather than the WH-zero day. This is an honest consequence of the cascade definition, not a crash — every value stays finite-or-Infinity-guarded (`Number.isFinite(totalRunway) ? round : 0`), so the UI shows a safe number. **Open question for founder:** should "total runway" instead be defined as "day the last fulfillable lane dies" so a zeroed WH with live channels shows the channel-buffer floor rather than Infinity? Current behavior is defensible (WH is the ultimate backstop) but counterintuitive when channels have their own buffers.

2. **Max-MoM data depth.** Growth uses up to 4 monthly buckets → up to 3 MoMs → MAX. Today only **39/56** channel-growth values are non-null (the rest have <2 usable months → null, correctly). Several SKUs show the **+200% clamp** (NSMP100/250 amazon & warehouse) where the prior month is near-zero or data is thin — that is the clamp working as designed, but it means forward reorder qty for those SKUs assumes the max sane growth. As Shopify (2 MoMs) and the agency daily-log (more MoMs) accumulate history, these resolve to real rates. No action needed; flagged so the founder knows clamped-200% SKUs are data-thin, not literally +200%.

3. **Browser engine vs offline `.cjs` duplication.** `src/lib/centralWhEngine.js` (runtime) and `scripts/build-central-wh.cjs` (offline) implement the same roll-forward. O6 is satisfied via the browser path, but the two must be kept in sync — a fix to one should be mirrored. Recommend eventually retiring the `.cjs` or generating both from one shared module.

4. **`nitin` legacy remnants.** `FILE_TYPES["nitin"]` and `buildNitinOverride` still exist (marked LEGACY) for backward compat with old localStorage entries, though the zone is removed from the UI. Harmless; can be deleted once no stale uploads remain.

5. **Open founder decision (O4):** old-stock value inclusion in the headline (§8.4) — quantified at **₹14.06L** across 6 SKUs, currently omitted. This is the one substantive PARTIAL.

**Files of record:** `src/data.js:1033-1146` (CWH overlay: stock, sales-velocity, runway, status, reorder, override), `src/data.js:100-122 / 956-984` (max-MoM growth), `src/lib/runwayCascade.js:49-126` (cascade + `whBaseVelocity`), `src/pages/PageInventory.jsx:1038-1039` (unitCost/headline value), `:2240-2394` (Simulator), `:2960-3029` (RunwayTab), `src/lib/formulaParams.js:165-207` (sales-based popovers), `src/lib/centralWhEngine.js` (in-browser engine + fail-loud), `src/lib/multiFileStore.js:120-123` (uploaded-over-bundled).

**Risk:** none introduced this pass (no edits). All computed fields finite/defined; build + runtime gates green.