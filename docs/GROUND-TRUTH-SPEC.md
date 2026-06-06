# Naturesum Inventory Tool — Ground-Truth Spec (Phase 0)

> Reconstructed from: the existing tool code, the prior audit (`docs/AUDIT-2026-06.md`),
> the central-warehouse workbook `Naturesum Live Inventory (3).xlsx`, and the full
> project conversation. This file is the SOURCE OF TRUTH for the audit-and-fix
> workflow. Subagents have NO session context — everything they need is here.

---

## 0. What this tool is for (the founder's real need)

A single dashboard that gives the founder a **truthful, current, self-updating**
picture of inventory across the central warehouse + 4 marketplaces, with runway,
reorder timing, and total value — so they never run out unexpectedly, never
over-order, and never have to re-code the tool when fresh exports arrive.

---

## 1. End objectives (the bar every fix is measured against)

- **O1 — Truthful current stock**, every stock type, every marketplace AND the
  central warehouse.
- **O2 — Accurate runway** (days of cover) per stock type, per location.
- **O3 — Reorder dates** for everything, driven by per-item lead times the
  founder can adjust.
- **O4 — Accurate total stock value** (warehouse + every marketplace), with **no
  double-counting and no omissions**.
- **O5 — All smaller requirements** raised across the project (see §6).
- **O6 — Durability / self-sufficiency**: drop in new CSV/Excel exports (or a
  newer warehouse audit) → the tool ingests, integrates, and reflects the latest
  numbers with **zero code changes per update**.

---

## 2. Architecture as-built (so subagents know the data flow)

```
RAW EXPORTS                    INGESTION                      DERIVATION            UI
─────────────────────────────────────────────────────────────────────────────────────
Central-WH workbook  ──(offline)──►  scripts/build-central-wh.cjs ──► src/bundledCentralWHData.js ─┐
 (Audit + Production +              (Node, run by hand,                (committed artifact)          │
  Daily Movement tabs)              bakes data at build time)                                       │
                                                                                                    ├─► src/data.js
Marketplace exports  ──(runtime)──► UploadModal → uploadParsers → localStorage(ns.multiFileUpload)─┘   (overlay chain)
 (Amazon ledger, Agency,            6 zones; parsed in-browser                                          │
  Blinkit, Flipkart,                on upload                                                           ▼
  Shopify, "Nitin" WH)                                                                          PageInventory.jsx
                                                                                                (cells / modals / tabs)
```

**data.js overlay/precedence order** (3 chained `.map()`s over the SKU list):
1. Base derive — stub `CHANNEL_MIX` defaults.
2. `_mergeBundledAndLive` Proxy — bundled `REAL_MARKETPLACE_DATA` ⊕ live uploads ⊕ bundled agency.
3. **Central-WH overlay** — `CWH_FG` from `bundledCentralWHData.js` sets warehouse FG, producible, velocity, growth, runway, leadTime, stockValue.
4. **Per-SKU override** — localStorage `ns.skuOverride.*` (set via ⓘ popovers).

**Per-channel velocity precedence** (top wins):
`agency sheet → native marketplace export → Nitin 72-day log → stub`.

### ⚠️ The durability asymmetry (key finding)
- **Marketplace data IS durable** — 6 runtime upload zones (Amazon ledger,
  Agency, Blinkit, Flipkart, Shopify, "Nitin" warehouse-daily). Drop a file in,
  it parses in-browser, persists to localStorage, reflects immediately. ✅ O6.
- **Central-WH data is NOT durable** — the audit+production+movement workbook is
  processed only by the offline Node script (`build-central-wh.cjs`, default
  input hardcoded to a Downloads path) and **baked into a committed file**.
  Updating warehouse numbers today requires: run the script + rebuild + redeploy.
  That is a code/build step per update → **violates O6 for the warehouse half.**
- There are effectively **two warehouse paths** that can conflict: the runtime
  "Warehouse Daily Inventory Sheet" (`nitin` zone → `parseNitinSheet`) and the
  offline central-WH engine. They both claim to set warehouse stock.

---

## 3. Central-warehouse computation model (from the attached workbook)

Workbook tabs (`Naturesum Live Inventory (3).xlsx`):
| Tab | Role |
|---|---|
| `Master` | OLD snapshot (7 Mar). **Ignore** — superseded. |
| `Audit 050525` | Physical audit, 5 May 2026 (9 FG rows). |
| `Audit 050525 V-2` | Same 5 May date, granular (28 FG rows, full old/new split). |
| `Audit 050626` | Physical audit, **5 June 2026 — current ground-truth baseline (latest by date)**. |
| ` warehouse inventory` | Partial recount, ~9 May (leading space in name). Secondary. |
| `Production` | Wide matrix: FG packed per date; consumes components via fixed BOM. |
| `Daily Movement of FG` | Stacked 16-row daily blocks; per-channel Stock-Out + Stock-In (returns). Now extends to **6 Jun 2026**. |

**Current warehouse stock formula (asymmetric vs marketplaces):**
```
warehouse_stock(item) = latest_audit_baseline(item)
                      + Σ production added   (dated STRICTLY AFTER audit date)
                      − Σ component consumed (production × BOM, after audit)
                      − Σ ship_out           (Daily Movement, after audit)
                      + Σ return_in          (Daily Movement, after audit)
```
- Anchor = **latest audit by date** (auto-detected: `Audit 050626`, 5 Jun).
- With file (3), Daily Movement reaches **6 Jun** → exactly **1 day of
  post-audit roll-forward** (a live durability test).
- Marketplace stock is the OPPOSITE: it is the **latest snapshot export**, not a
  computed roll-forward. *Current-stock logic differs by location — must be
  verified per path.*

**Old vs new stock** (founder rule, established this session):
- Audit rows tagged `(old)` → tracked separately, **EXCLUDED from sellable /
  runway**. New stock only is sellable.
- Consequence in current data: all 3 Sea Buckthorn Berry SKUs are 100% old →
  0 sellable runway; powders show new + old split.

**FK-shipment rows** (`(Flipkart shipment)` in audit) → folded into central-WH
**new/sellable FG** (founder: team stages them in WH; Daily Movement deducts on
actual dispatch).

**Three-bucket classification** of non-FG audit lines:
- BOM component → material breakdown.
- Equipment + furniture → **Fixed assets** section (below materials).
- Cartons/stickers/tape/rolls/caps/etc → **Consumables & shipping** section.

---

## 3.5 CORRECTED METRIC MODEL (founder correction, 2026-06 — supersedes prior velocity logic)

**Consumption = SALES, never warehouse movement.** Warehouse FG "stock-out"
movement is dominated by bulk replenishment shipments to marketplace WHs
(Amazon FBA / Flipkart FBF / Blinkit feeders) — a 3-month FBA shipment shows as
one huge spike then months of nothing. Averaging it misrepresents consumption.
**`centralWhVelocity` (engine depletion30) must NOT be used for velocity, runway,
growth, or reorder anywhere.** The engine roll-forward is still correct for the
warehouse FG *physical count* (units that shipped really did leave) — keep it for
STOCK + producible + components only; drop its velocity/runway/growth outputs.

How depletion actually works (founder):
- Production in WH consumes RM/packaging → makes FG.
- FG leaves WH two ways: (1) MAIN — bulk shipments to Amazon FBA / Flipkart FBF /
  Blinkit feeders; real consumption happens when SALES occur on
  amazon/flipkart/blinkit/website (website delivered via Amazon MCF from FBA).
  (2) MINOR — direct WH sales when a marketplace is out of stock (the daily 1–2
  pieces in Daily Movement; the large movements there are shipments, not sales).

**Velocity (sales-based, 30-day):**
- `salesVel[channel] = channel_sales_last_30d / 30` from sales exports
  (agency → native sales → shopify). Amazon channel = Amazon sales + website D2C
  (R-FBA). `totalSalesVel = salesVel.amazon + salesVel.flipkart + salesVel.blinkit`
  (website inside amazon — not double-counted).

**Runway:**
- Marketplace runway = marketplace snapshot stock ÷ `salesVel[that channel]`.
- Central WH runway = central-WH FG ÷ `totalSalesVel`.
- Runway-calculator cascade uses per-channel SALES velocities (marketplaces drain
  their buffers first, then fall back to WH); `whBaseVelocity` = minor direct-WH
  sales (≈ small; 0 if not isolable).

**Growth (max trailing MoM):**
- From up to 4 months of sales per channel, compute up to 3 month-over-month
  growth rates; **forward growth = MAX of them** (plan for the highest growth
  seen → don't under-stock). Fewer months → fewer MoMs → max of what exists;
  <2 months → 0. Clamp to a sane band (≤ +200%). Requires parsers to emit
  monthly sales buckets (Shopify has 30/60/90 = 2 MoMs; agency daily-log has more).
- Growth feeds the FORWARD projection (reorder qty / reorder date assume demand
  grows at max-MoM). Displayed runway stays at current 30-day pace (truthful).

**Window choice:** 30-day average is the base (stable for reorder decisions);
7/14-day too noisy. Configurable later.

## 4. High-risk domain rules (must each be its own test)

- **R-FBA (AMZ-001 combined demand):** Amazon FBA stock is consumed by BOTH
  Amazon orders AND website (Shopify) orders. FBA runway/reorder MUST use
  `amazon_velocity + shopify_d2c_velocity`. Ignoring website demand = wrong.
- **R-AGENCY:** Amazon channel velocity + growth source-of-truth = the Agency
  "Channel-wise Sales Sheet" → `AMZ Categorywise` tab (sum SKU column last
  30d ÷ 30), beating the Manage-Orders feed. MCF report is NOT used this version.
- **R-VELOCITY-REAL:** Runway velocity must be DERIVED from real order/movement
  exports, never a hardcoded guess. Central-WH velocity = Daily Movement
  depletion `(gross_out − returns)/window`.
- **R-FAILLOUD:** A file that doesn't match expected shape must surface a clear,
  visible error. NEVER silently emit a wrong stock/runway/value number.
- **R-DURABLE:** Dropping in a newer dated export OR a newer warehouse audit must
  recompute current numbers with zero code edits.
- **R-NODOUBLE:** Total value = each physical unit counted exactly once across
  WH + marketplaces × its price. No double-count, no omission.
- **R-NEGATIVES:** Shopify "Net items sold" negatives (returns) are kept, not
  clamped — they legitimately reduce velocity.
- **R-MULTIPACK:** Agency combo columns (`...*N`) contribute N base-SKU units.
- **R-SIM:** The simulator must perturb stock qty / lead time / velocity /
  supplier-landed-cost and recompute runway, reorder dates, bottlenecks using
  the SAME formulas as the base tool (no divergent copy).

---

## 5. Source-of-truth per number (condensed; full map in docs/AUDIT-2026-06.md §1)

| Number | Source |
|---|---|
| WH FG stock | central-WH engine (audit baseline + post-audit roll-forward), new only |
| WH producible | min over BOM of floor(component_stock / perPack) |
| WH velocity | Daily Movement depletion (gross_out − returns)/30 |
| WH runway | WH FG ÷ WH depletion velocity |
| Amazon stock | Amazon ledger snapshot (per-FC sellable) |
| Amazon velocity | Agency AMZ tab (R-AGENCY) → orders feed → … ; folds Shopify D2C (R-FBA) |
| Flipkart stock | FK "Live on Website" snapshot |
| Flipkart velocity | FK sales30d/30 (or agency FK tab) |
| Blinkit stock | Blinkit per-feeder-WH snapshot |
| Blinkit velocity | Blinkit per-WH sales30d/30 (or agency Blinkit tab) |
| MoM growth | per-channel: cur30 vs prior30 from each channel's own source, clamp ±200 |
| Lead time | max component lead in BOM (per-item, adjustable) |
| Reorder date | today + (runway − lead time) — latest safe order date |
| Total value | Σ over locations of units × price (no double-count) |

---

## 6. Smaller requirements mined from the project (drop none)

1. Inline ⓘ formula popovers on every number (must show the ACTUAL computed
   value + correct formula + source).
2. Per-SKU editable overrides (velocity, growth, lead time, stock) via ⓘ.
3. Tunable global params via ⚙ Settings (amber threshold, OOS-soon window,
   default target days, velocity floor, forecast window).
4. Amazon drill modal: hero metrics + channel split (Amazon orders ⊕ Shopify
   D2C) + per-FC warehouse breakdown.
5. Flipkart drill modal: velocity/MoM/days-of-cover hero + sales trend +
   listed-qty caveat (physically at central WH).
6. Blinkit drill modal: per-WH stock + per-WH velocity (/d) + biweekly Δ + all
   feeder WHs visible.
7. "Stock left" hero card on Amazon + Flipkart modals.
8. Old-stock shown in the material breakdown (excluded from runway).
9. Fixed assets + Consumables sections below the material breakdown.
10. Top mover, Total stock value, Stock alerts dashboard cards.
11. Modals must scroll; negative growth/velocity must render sanely (chips, not
    "NaN%"/"Infinity days"/"net returns" hidden).
12. Per-channel growth (each cell its own channel's MoM, not a shared number).
13. Data-quality flags (unmapped SKUs, garbage rows, BOM gaps) must be VISIBLE,
    not silently dropped — currently computed but never surfaced.
14. Agency multi-tab daily-log auto-detect; latest-audit auto-detect.

---

## 7. Known bugs going in (from docs/AUDIT-2026-06.md — 82 confirmed)

Top P0s the fix phase must clear:
- Stocked-out SKU renders GREEN, hidden from reorder alerts (`runwayStatus`
  null-fall-through). [O1/O2/O3]
- Cascade runway drops warehouse velocity (`whVelocity` vs `whBaseVelocity` key
  mismatch) → runway/reorder inflated on 86% of SKUs. [O2/O3]
- Total stock value understated ~44% (`stockValue` FG-only ÷ total units). [O4]
- Runway tab velocity ≠ the modal it opens (4 divergent velocity models). [O2]
Full ranked list (4 P0 / 9 P1 / 14 P2 / 7 P3) + the calculation reference in
`docs/AUDIT-2026-06.md`.

---

## 8. Founder decisions (resolved 2026-06 — binding for the workflow)

1. **WH durability → PORT ENGINE TO BROWSER.** Add a 7th upload zone
   "Central Warehouse Workbook". The audit + production + daily-movement
   roll-forward must run **in-browser on upload** (port `build-central-wh.cjs`
   logic to a browser parser), persist like the other 6 files, and reflect the
   latest numbers with zero code/redeploy. This fully satisfies O6.
2. **Flipkart stock is PHYSICALLY SEPARATE** (at a Flipkart FC), distinct from
   central WH. Total value = WH FG + Amazon + Flipkart + Blinkit, each counted
   once — no double-count between FK and WH. (Note: the audit's
   `(Flipkart shipment)` rows are units STAGED at central WH pre-dispatch and
   already fold into WH FG; they are NOT the same as FK "Live on Website".)
3. **Total value basis = SELLING PRICE** (units × SP = revenue potential).
4. **Old stock: INCLUDE in total value, EXCLUDE from runway.** Show old as a
   separate line; it contributes to value but never to sellable runway.

### Stated assumptions I'm proceeding with (correct me if wrong)
- **Reorder date** = today + (runway − lead_time) = the latest safe order date
  before stockout. Negative ⇒ "overdue".
- **Reorder scope** = FG SKUs **and** components (raw/SFG/packaging), each with
  its own lead time + days-of-cover.
- **The duplicate runtime "Warehouse Daily Inventory Sheet" (`nitin`) zone** is
  superseded by the new browser central-WH engine and should be retired/merged
  to avoid two conflicting warehouse paths.
- **Marketplace runway** = marketplace on-hand snapshot ÷ that channel's velocity
  (Amazon uses combined Amazon+Shopify demand per R-FBA).
