# VERIFICATION — Naturesum Inventory Tool (Pass 2026-07)

Lead-auditor independent re-derivation against the raw warehouse workbook
`~/Downloads/Naturesum Live Inventory (6).xlsx` (latest audit **Audit 050626** = 5-Jun;
daily movement → 8-Jun; production → 4-Jun) plus the bundled marketplace/agency artifacts.

Scope of this pass: confirm the FIX-SPEC D1–D8 model is implemented, grade objectives O1–O6
against numbers I re-derived myself, document what was fixed in the just-completed fix phase,
and separate the residual model/conceptual gaps that need a founder decision from the code bugs.

> **Method discipline.** Every number below was re-derived from first principles — by hand
> off the raw sheet or by my own `node` calc — *before* it was compared to the tool. Code
> comments and the tool's own outputs were treated as suspects, not ground truth. Verdicts are
> what I personally reproduced this pass, not what any sub-report asserted.

---

## 1. METHOD

1. **Raw re-derivation.** Read `Audit 050626`, `Production`, and `Daily Movement of FG`
   directly via `xlsx`. Re-derived FG new stock as `auditNew − post-audit-net-movement`
   (production is all dated ≤ 4-Jun, so zero post-audit production; movement after the 5-Jun
   anchor = the 6-Jun + 8-Jun blocks). Re-derived raw/packaging on-hand line by line.
2. **Tool comparison.** Loaded the live `src/data.js` default export
   (`node --input-type=module`), read computed `inventory[]`, `centralWh`, and
   `centralWhComponents`, and compared field-by-field to the hand derivation.
3. **Artifact inspection.** Grepped the bundled artifacts (`bundledAgencyData.js`,
   `realMarketplaceData.js`, `bundledCentralWHData.js`) for the schema fields the model depends
   on (`monthly[]`, `sales14d`, per-SKU presence).
4. **Source inspection.** Read the changed source (`PageInventory.jsx`, `data.js`,
   `uploadParsers.js`, `centralWhEngine.js` + its `build-central-wh.cjs` twin) at the exact line
   ranges the fix phase touched.
5. **Build/runtime gate.** `npm run build` (clean) and a no-throw / no-NaN load of `data.js`.

### Anchors re-confirmed (independent)
| Item | Re-derived | Tool | Verdict |
|---|---|---|---|
| Audit anchor sheet | `Audit 050626` (5-Jun) | `Audit 050626`, anchor 2026-06-05, asOf 2026-06-08 | MATCH |
| Moringa Leaves Powder raw | 100 KG (single line #4) | NSMLPR = 100 | MATCH |
| Dry-berry raw | absent from audit → 0 | NSSBDBR = 0 | MATCH |
| Moringa 100g / 250g pouches | 2935 / 2934 | NSPKGMP100 path / NSPKGMP250 = 2934 | MATCH |
| Total stock value (all locations, SP) | Σ per-SKU = **₹72.62 L** incl **₹14.06 L** old | ₹72.62 L incl ₹14.06 L | MATCH |
| Velocity windows carrying real data | 51 channel-windows, **0** "30d-only" | 0 "30d-only" | MATCH |
| Data-quality flags | negStock 4, bomGaps 5, unmappedComponents 27, unmappedNames 1 | identical | MATCH |

---

## 2. OBJECTIVE CONFORMANCE (O1–O6)

### O1 — Truthful current stock — **MEETS** (one residual RM line)
All 14 FG stock values, anchor/asOf, and marketplace snapshots reproduced exactly off the raw
sheet + roll-forward. NSACDT30 is now present with real agency data. The single remaining
defect is the **SB Oil raw double-count (NSSBOR = 5.6 L; true 2.8 L)** — see I-NF-1; it has no
producible impact today but the displayed RM line is 2× wrong. Stock counts are trustworthy.

### O2 — Accurate runway — **PARTIAL**
The velocity engine is now correct and consistent: MAX(30,14/15) per channel, summed, no
"30d-only" degradation anywhere, and drill-modal velocities (Flipkart, Blinkit per-WH) now use
the same channel rule as the cells (P1-2/P1-3 fixed). RunwayTab "current" mode no longer applies
the growth factor (P1-4 fixed). **What blocks a full MEETS is conceptual, not arithmetic:** the
headline central-WH runway is `WH_FG ÷ Σ all-channel velocity` (M1) and FG cover ignores
producible while reorder urgency is gated on the 50-day raw lead (M2). Under that definition
NSSB100 reads 47d / RED even though it carries producible headroom and each marketplace drains
its own buffer first. The cascade model already computes the truthful network runway (~126d for
an NSSB100-shape input). These need a founder ruling (M1/M2) before runway can be called MEETS.

### O3 — Accurate reorder dates/qty — **PARTIAL** (was the weakest objective; materially improved)
The three P0s that broke reorder are fixed and reproduced:
- **Growth** is now max-trailing-MoM — `bundledAgencyData.js` carries `monthly[]` (41 entries);
  NSSB100 amazon growth flipped **−18.2 → +41.7**. Fast movers no longer get under-ordered.
- **Forecast trend** no longer uses the hardcoded row-index array; `trendForSku(s)` uses the
  SKU's real growth (P0-2).
- **Component reorder** now runs on sales-based consumption, not 2-day warehouse movement.
  Re-verified: NSMLPR cover **41d → 800d**, NSSBPR **34d → 109d** (reorder now false),
  NSPKGSBP500 **4d → 15d** (reorder false), NSPKGMP250 consumption **6.9/d → 0.1/d**. The
  spurious "reorder ~900 kg raw powder" alarm is gone.
- Dashboard reorder count is pinned to the engine component source (P1-1).

Residual PARTIAL: reorder *dates* inherit the M1/M2 runway-definition issue (urgency vs raw-lead
straddling), so dates are directionally right but conceptually unsettled until M1/M2 land.

### O4 — Total value — **MEETS**
₹72.62 L reproduced exactly by independent per-SKU summation; old stock (₹14.06 L) included as a
separate line, no WH↔Flipkart double-count. The +₹0.30 L vs the previous ₹72.32 L is exactly the
now-counted Flipkart multipack stock (NSSBDB100 FK 74 → 150; 76 × ₹390 = ₹29,640) — a
correction, not an inflation. Only labeling nits remain (P3-5/P3-6).

### O5 — Smaller requirements — **PARTIAL**
Velocity-window labels now truthful (max(30,14)/max(30,15)); per-channel growth correct (#12 via
P0-1); modal velocity (#5/#6) fixed. Open: tunable amber/red runway params still hardcoded in the
Sim/RunwayTab guards (P3-3), dead "Place PO" button (P3-4).

### O6 — Durability — **PARTIAL** (improved)
A committed `scripts/build-bundled-agency.cjs` now regenerates the agency bundle deterministically
(was a lost inline command → the original source of drift). `build-central-wh.cjs` resolves the
latest `Naturesum Live Inventory*.xlsx` by mtime and fails loud (P3-7), and the defensive
`Math.max(0, consumption)` clamp is in **both** engine twins. The browser round-trip still matches
the committed bundle. Open durability gaps: silent marketplace parsers on a wrong-schema file
(P3-8), the audit auto-detect gate keyed on the literal word "audit" (P3-9), the AC-tea SFG alias
mismatch (I-NF-2, latent silent-drop), and the engine/parser twin duplication (M9).

---

## 3. ISSUES FOUND & FIXED THIS PASS

All re-verified against the current tree (not taken on faith from the fix report):

| ID | Issue | Re-verified evidence | Files |
|---|---|---|---|
| **P0-1** | Growth was single-MoM (sign-flipped on declining-window SKUs) | `bundledAgencyData.js` now has `monthly`×41, `sales14d`×41, NSACDT30 present; NSSB100 amazon growth +41.7 | `build-bundled-agency.cjs` (new), regenerated `bundledAgencyData.js`, `data.js` |
| **P0-2** | Forecast required/reorder used hardcoded `trendForIdx[idx]` | `trendForSku(s)=1+(centralWhGrowth??growth)/100` at PageInventory.jsx:3681; `trendForIdx` gone | `PageInventory.jsx` |
| **P0-3** | Component consumption/cover/reorder on 2-day movement velocity | sales-based now: NSMLPR 800d, NSSBPR 109d, NSPKGSBP500 15d, all reorder=false; 0 negative-consumption components | `data.js` |
| **P1-1** | Dashboard reorder count from stale legacy breakdown | `materialsToReorder = centralWh.components.filter(reorder && constrains)` = 9; relabeled "cover < lead time" | `PageInventory.jsx` |
| **P1-2** | Flipkart modal velocity/cover 30d-only | hero + days use `sku.channelVelocity.flipkart` (max(30,14)); relabeled | `PageInventory.jsx` |
| **P1-3** | Blinkit modal + per-WH velocity 30d-only | `blkPerWhVelocity` uses max(30,15) via new `perWhSales15d` (data.js:615); relabeled | `data.js`, `PageInventory.jsx` |
| **P1-4** | RunwayTab "current" mode applied growth factor | `growthFactor = mode==="custom" ? 1+g/100 : 1` (PageInventory.jsx:3218) | `PageInventory.jsx` |
| **P1-5** | Shopify (D2C) velocity degraded to 30d-only on every SKU | `realMarketplaceData.js` shopify now has `sales14d`×24; 0 "30d-only" windows tool-wide | `realMarketplaceData.js`, `import-marketplace-data.cjs` |
| **P1-6** | Shopify growth degraded to single-MoM | shopify `monthly[]`×12 now present | `realMarketplaceData.js`, `import-marketplace-data.cjs` |
| **P1-7** | NSACDT30 dropped from agency bundle → velocity fell to 1.0 | NSACDT30 now present, velocity 1.30, agency real; `"acacia catechu"` alias added | `uploadParsers.js`, regenerated bundle |
| **P1-8** | Flipkart `*N` multipack rows dropped (NSSBDB100) | `resolveFkMultipack` folds `*N`; NSSBDB100 FK stock 74 → 150, velocity 10.8 | `uploadParsers.js`, `import-marketplace-data.cjs` |
| **P2-3** | Negative component consumption leaked to UI (NSPKGDBP500 −1.033/d) | now +17.6/d; 0 negative-consumption components; `Math.max(0,…)` in both twins | `data.js`, `centralWhEngine.js`, `build-central-wh.cjs` |
| **P3-7** | `build-central-wh.cjs` defaulted to stale "(2).xlsx" | now resolves latest workbook by mtime, fails loud (`os` required) | `build-central-wh.cjs` |

**Gate:** `npm run build` ✓ clean; `data.js` loads with no NaN/Inf/throw; verified-stock invariants
hold (NSMLPR=100, NSSBDBR=0, NSPKGMP250=2934). Total value ₹72.32 L → ₹72.62 L is the multipack
correction only.

### Deliberately NOT fixed this pass (with reason)
- **Blinkit half of P1-8** — confirmed a no-op: the Blinkit raw feed is a name-matched
  stock-on-hand snapshot with no `*N` combo rows; agency-Blinkit already folds multipacks.
- **P2-4** (cascade Infinity → 0d on zero-demand SKUs in Sim/RunwayTab) — P2, narrow (only
  NSSBBO15/30, only two secondary tabs). Base Unified tab renders `null → "—"` correctly
  (re-verified: NSSBBO15/30 runway=null, status=amber). Cosmetic; left scoped out.

---

## 4. ISSUES FOUND, NOT FIXED — need founder decision

### Conceptual / model (M-series) — the real blockers for O2/O3
- **I-NF-M1 · Central-WH runway double-counts demand vs marketplace buffers.** Headline runway =
  `WH_FG ÷ Σ(amazon+flipkart+blinkit velocity)` (data.js ~1224), i.e. the WH serves 100% of every
  channel from day 0 while each marketplace simultaneously drains its own FBA/FBF/feeder buffer.
  The cascade already models the correct "marketplaces first, WH backstops" behavior and gives
  ~126d for an NSSB100-shape input vs the flat 47d → green stock reads RED. **Recommendation:**
  make the displayed central-WH runway the cascade `totalRunway`; keep `FG ÷ ΣchannelVel` only as
  a labeled "if all marketplaces vanished" worst-case line. *Single biggest driver of false
  reorder flags.*
- **I-NF-M2 · FG runway is FG-only; reorder urgency gated on 50-day raw lead.** `cwhSellable =
  fg + producible` is computed but runway divides `fg / vel`, and status/reorder compare it to the
  max BOM lead (SB raw = 50d). NSSB100 (FG 47d but +producible from on-hand pouches) reads RED, and
  a 4-day FG swing flips NSSB100 vs NSSB250 purely because the 50d raw clock straddles them.
  **Recommendation:** FG cover = `(FG + producible) ÷ vel` against a *packing* horizon; raw-PO
  urgency belongs on the component-reorder tab on its own 50d clock.
- **I-NF-M3 · Producible double-counts shared raw (no allocation).** NSMLPR=100 kg yields NSMP100
  1000 *and* NSMP250 400 simultaneously (1000×0.1 + 400×0.25 = 200 kg > 100 kg). Live for Moringa
  (raw-bound). **Recommendation:** present producible as a constrained allocation, or at minimum
  flag "shared raw — totals not additive."
- **I-NF-M4 · "Old = never sellable" too absolute for dry berries that are demonstrably selling.**
  All 3 dry-berry SKUs are 100% old → sellable 0 → runway 0 → RED, yet post-audit movement ships
  them (the 4 negative_stock flags: NSSBDB500 −9, NSSBDB250 −3, NSSBDB100 −1, NSSBJ500 −1 —
  re-verified in `centralWh.flags.detail`). The model says "0 sellable" while the warehouse sells
  them. **Recommendation:** founder to confirm dry-berry sellability; if moving, it must count
  toward sellable/runway (or be re-tagged) and ship-outs must deplete the old bucket.
- **I-NF-M5 · MAX-window velocity × max-MoM growth compound the same upside.** D5 takes the higher
  of 30/14-day demand, then grows that peak by the single highest MoM (clamp +200; several SKUs pin
  at +200 — e.g. NSSBJ300, NSMP100, re-verified). Potential systematic over-order. **Recommendation:**
  cap combined uplift, or use median-MoM when velocity already uses the max window.
- **I-NF-M6 · `whBaseVelocity` hardcoded 0** makes standalone-WH runway degenerate and the cascade
  base phase empty, despite a real Website/direct-WH movement stream. **Recommendation:** derive it
  from the Website/direct-WH movement lines.
- **I-NF-M7 · One word "runway" names two ~3.7× different numbers** (Unified WH-only 47d vs
  Sim/Runway cascade ~173d). Both internally correct. **Recommendation:** relabel "WH-only runway"
  vs "network runway (cascade)" (resolved alongside M1).
- **I-NF-M8 · Juice SFG + BOM gaps suppress producible on a selling line.** NSSBJ300 (565 FG,
  shipping) shows producible 0 because pulp=0 and tube/label are unmapped BOM gaps (re-verified: 5
  juice bom_gaps in flags.detail). **Recommendation:** confirm juice tube/label/air-pouch naming;
  mark optional BOM lines so a missing label doesn't zero producible.
- **I-NF-M9 · Logic duplicated across twins** (`centralWhEngine.js` + `build-central-wh.cjs`; live
  vs offline parsers). Every data-side fix must land in both or they drift. **Recommendation:**
  de-duplicate to one source; until then enforce the build-script regeneration path.

### Code/data, deferred for founder confirmation
- **I-NF-1 · SB Oil raw double-count (NSSBOR 5.6 → true 2.8 L).** Re-confirmed in the raw sheet:
  "SB Oil 2.8 ltrs" appears in **both** the SEMI-FINISHED section (#7) and the RAW section (#5),
  same physical drum; both alias to NSSBOR and sum. No producible impact today (15ml bound by empty
  box=0; 30ml bound by 30ml bottle=0 — re-verified 15ml uncapped=375, 30ml empty=0). **Recommendation:**
  dedupe identical (ref,qty,unit) lines across SEMI/RAW in both engine twins. Left to founder because
  the correct dedup target (which section owns the drum) is a warehouse-process call. *(spawned task)*
- **I-NF-2 · AC-tea SFG production alias mismatch (latent silent-drop).** `SFG_PRODUCTION_ALIASES`
  key is `"acacia tea pouches (green, filled)"` but the Production sheet says `"AC Tea Pouches(Green,
  Filled)"` ("ac" ≠ "acacia") → unmapped, silently dropped (surfaced as the 1 unmapped_name).
  Zero numeric impact now (the only such rows are 18-Mar/20-Mar, pre-audit, excluded from
  roll-forward), but breaks fail-loud + durability for any future post-audit AC-tea production.
  **Recommendation:** add an `"ac tea pouches (green, filled)"` alias in both engine twins. *(spawned task)*
- **I-NF-3 · Fictional stub data on the founder's dashboard.** `data.js` `alerts`,
  `marketplaceAmazon`, suppliers, influencer and ad cards are hardcoded demo data for a fictional
  whey-protein/collagen brand (re-verified: "Daily Multivitamin (Women)", "Whey Choc 2kg",
  "Collagen Peptides", "Glanbia", "Tanmay Bhat / Whey Choc 1kg", ASINs `NS-WHT-CHO-1K`). Renders on
  Home/Alerts/Marketplace mixed with real inventory — a real honesty/trust gap, though outside the
  strict inventory core. **Recommendation:** derive alerts from real reorder/runway signals
  (`D.inventory` + `D.centralWhComponents`); relabel or remove the other stub cards. *(spawned task)*
- **P2-4 · Cascade Infinity → 0d on zero-demand SKUs (Sim/RunwayTab only).** NSSBBO15/30 (vel 0)
  show "0d" instead of "—/∞" on the two secondary tabs; base tab is correct. Low severity, cosmetic.
- **P3 nits** — P3-3 (Sim/RunwayTab hardcode `runway<30` vs `amberRunwayDays` param), P3-4 (dead
  "Place PO" button), P3-5 (value card "incl old" vs new-only units mismatch), P3-6 (stale Berry-Oil
  pricing comment), P3-8 (silent marketplace parsers on bad schema), P3-9 (audit auto-detect keyed
  on literal "audit"), P3-10 (juice air-pouch aliases) — all cosmetic, durability, or need founder
  confirmation; left for the report.

---

## 5. RESIDUAL RISK

- **Runway/reorder *decisions* remain model-gated.** Arithmetic is now correct and consistent, but
  the *definition* (M1/M2) still mislabels green network-healthy SKUs as RED/reorder. Until the
  founder rules on M1/M2, the headline runway and the per-SKU reorder=true flags
  (NSSB100/250/500/NSSBJ300/NSACDT30 all show RED) should be read as "WH-only worst case," not as
  "order now." This is the largest residual risk.
- **Shared-raw producible (M3)** is live-overstated for Moringa; any producible-based decision on
  raw-bound SKUs is not additive.
- **Dry-berry model tension (M4)** — the tool both excludes dry-berry from sellable *and* flags
  negative stock from real dry-berry sales; one of the two is wrong and only the founder can say which.
- **Twin drift (M9)** — fixes verified in both twins this pass, but there is no automated guard
  preventing future single-twin edits.
- **Marketplace raw exports** were verified via the bundled artifacts; the underlying per-FC Amazon
  / FK-multipack raw files were not re-read line-by-line this pass (the parser logic and folded
  totals were verified instead). NSSBDB100 multipack fold (74 → 150) is verified at the output level.
- **Unverified-by-design:** `whBaseVelocity` (hardcoded 0, M6) and the juice SFG path (M8) depend on
  source-data that isn't cleanly mapped yet.

---

## 6. PER-TAB "NUMBERS VERIFIED" CHECKLIST

### Unified Stock
- [x] All 14 FG stock values = `auditNew − post-audit movement` (re-derived; e.g. NSSB250 670−18=652, NSSBJ300 611−46=565, NSMP100 92−1=91) — MATCH
- [x] Marketplace columns (amazon FBA sum-of-FC, FK live, blinkit sum) — spot-verified (NSSB250 859/27/373; NSSB100 509/111/471)
- [x] Total value ₹72.62 L incl ₹14.06 L old — independently summed
- [x] Zero-demand SKUs render runway `null → "—"`, status amber (NSSBBO15/30) — MATCH
- [x] No "30d-only" velocity window anywhere (51/51 carry real windows) — MATCH
- [ ] SB Oil raw NSSBOR shows 5.6 (should be 2.8) — KNOWN, not fixed (I-NF-1)

### Materials (components)
- [x] Consumption sales-based: NSMLPR 0.125/d, NSSBPR 8.33/d, NSPKGSBP500 7.3/d, NSPKGMP250 0.1/d
- [x] Days-cover follows: NSMLPR 800d, NSSBPR 109d, NSPKGSBP500 15d
- [x] 0 negative-consumption components (was NSPKGDBP500 −1.033 → +17.6)
- [x] Constraining vs non-constraining set correct (cartons/juice-air-pouch non-constraining)
- [x] reorder & constrains count = 9 (dashboard source); all reorder = 13 (Suppliers source)

### Runway
- [x] WH-only runway per SKU reproduced (NSSB100 47, NSSB250 49, NSMP100 91, NSJO100 408)
- [x] "current" mode growthFactor = 1 (P1-4); growth only in custom what-if
- [ ] Network-vs-WH-only runway naming (M7) — open
- [ ] Runway *definition* (M1/M2) — open, founder

### Simulator
- [x] Trend uses real `trendForSku` (P0-2), not row-index array
- [x] Growth factor = `1 + (centralWhGrowth ?? growth)/100`
- [ ] Hardcoded `runway<30` instead of `amberRunwayDays` param (P3-3) — open nit
- [ ] Zero-demand SKUs show 0d instead of "—" (P2-4) — open nit

### Forecast
- [x] `required = fvel × (days+targetDays) × trendForSku` (real growth-driven)
- [x] Growth feeds forward projection (max-MoM source now correct)

### SKU catalog / velocity / growth
- [x] Velocity = MAX(30,14/15) per channel, summed (re-derived NSSB250 13.2, NSJO100 1.4)
- [x] Growth = max-trailing-MoM, clamp [−100,+200] (NSSB100 amazon +41.7; pins at +200 noted M5)
- [x] NSACDT30 present, velocity 1.30, agency real (P1-7)
- [x] NSSBDB100 FK multipack folded (stock 150, velocity 10.8) (P1-8)

### Suppliers / component reorder
- [x] Reorder coverage from engine `reorder=true` (13) incl non-constraining
- [x] Reorder dates = asOf(8-Jun) + (daysCover − leadTime), sales-based
- [x] Quality-flags modal data present (negStock 4, bomGaps 5, unmappedComponents 27, unmappedNames 1)
- [ ] Suppliers list / ad / influencer cards = fictional stub data (I-NF-3) — open, founder

---

**Bottom line.** Stock counts and total value (O1/O4) are trustworthy and independently
reproduced. The fix phase correctly closed all three P0s (growth, forecast trend, component
velocity) and the P1 velocity/modal/parser gaps — verified in the live tree, build clean. The
tool's runway and reorder *arithmetic* is now sound, but O2/O3 stay PARTIAL because the runway
**definition** (M1/M2) still flags network-healthy SKUs as RED. Get a founder ruling on M1/M2/M4
and clear the SB-Oil dedup (I-NF-1), AC-tea alias (I-NF-2), and dashboard stub data (I-NF-3)
before the runway/reorder surfaces are relied on for purchasing.
