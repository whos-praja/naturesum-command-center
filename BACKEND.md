# Naturesum Command Center — Per-SKU Backend Walkthrough

> **Purpose.** A self-contained tutorial that walks through how every number on the dashboard is computed and fetched — **per SKU**, with real current values. Drop the whole file into Claude and ask things like *"For NSSBJ500, why is the Amazon cell showing 3 units when Manage Orders says we sold 471 units last month?"* or *"What number flows into NSSBDB250's runway?"* — Claude has every formula + every source + every current value to answer.
>
> **Pairs with** `MAPPING.md` (the reference tables) and `CLAUDE_API.md` (AI integration setup). Where the others are dictionaries, this is the **storybook**.
>
> **Last regenerated** 01-Jun-2026 · commit `fc37d8e`. Numbers come from `src/realMarketplaceData.js` + `src/realNitinData.js` snapshots.

---

## Section A — How to read this doc

1. **Section B** explains the universal data flow once. Read this first.
2. **Section C** does a *detailed walkthrough of NSSBJ500* (most complex SKU — 4 PKG components, all 4 channels, real data everywhere). Use this as the worked example.
3. **Section D** does *compact one-pagers for the other 13 SKUs* — same shape as C but trimmed.
4. **Section E** catalogs *known data-flow caveats* — places where the dashboard's number can differ from raw reality.

If you only have 5 minutes, read B + the NSSBJ500 walkthrough in C.

---

## Section B — The universal data flow

Every number on the dashboard travels through these layers, in this order:

### B.1 Sources → bundled JSON → runtime overlay

```
   ┌───────────────────────────────────────────┐
   │   PHYSICAL / EXTERNAL SOURCES             │
   │                                            │
   │   • Amazon Seller Central                  │
   │     → Warehouse Wise Ledger CSV            │
   │     → Manage Orders 30-day TSV             │
   │   • Flipkart Seller Hub                    │
   │     → Current Inventory CSV                │
   │   • Blinkit Seller Panel                   │
   │     → Stock On Hand Excel                  │
   │   • Shopify Admin                          │
   │     → Website Sales CSV                    │
   │   • Nitin's MIS workbook                   │
   │     → Naturesum Live Inventory xlsx        │
   └───────────────────────────────────────────┘
                       │
                       │  scripts/import-marketplace-data.cjs
                       │  scripts/import-nitin-sheet.cjs
                       ▼
   ┌───────────────────────────────────────────┐
   │   BUNDLED JSON (committed to repo)        │
   │                                            │
   │   • src/realMarketplaceData.js  (~1100 LOC)│
   │   • src/realNitinData.js        (~650  LOC)│
   └───────────────────────────────────────────┘
                       │
                       │  imported by src/data.js at module init
                       ▼
   ┌───────────────────────────────────────────┐
   │   STUB FALLBACKS (in src/data.js)         │
   │                                            │
   │   • SKU_OPERATIONS  · fg / vel / leadTime  │
   │   • CHANNEL_MIX     · stub units/30d/ch    │
   │   • MOM_GROWTH      · hardcoded MoM%       │
   │   • SKU_PRICING     · SP + MRP             │
   │   • ITEM_QTY        · component qtys       │
   └───────────────────────────────────────────┘
                       │
                       │  + browser-side localStorage overlay
                       │    (if user uploaded via the Upload modal)
                       ▼
   ┌───────────────────────────────────────────┐
   │   data.js IIFE — computes per-SKU         │
   │   { stock, velocity, growth, runway, … } │
   └───────────────────────────────────────────┘
                       │
                       ▼  consumed by every page component
                  THE DASHBOARD
```

### B.2 Per-channel precedence for each number

For any (SKU × channel × metric), the runtime walks this fallback chain. **First non-null wins.**

#### Stock (units on hand)

| Channel | 1st | 2nd | 3rd (stub) |
|---|---|---|---|
| Central WH | localStorage upload (Nitin) | bundled `NITIN_DATA.warehouseInventory.fg[code]` | `SKU_OPERATIONS[code].fg` |
| Amazon FBA | uploaded amazon-ledger | bundled `REAL_MARKETPLACE_DATA[code].amazon.totalSellable` | `CHANNEL_MIX.amazon / 30 × 7` (7-day cover heuristic) |
| Flipkart | uploaded flipkart inventory | bundled `REAL_MARKETPLACE_DATA[code].flipkart.live` | `CHANNEL_MIX.flipkart / 30 × 7` |
| Blinkit | uploaded blinkit excel | bundled `REAL_MARKETPLACE_DATA[code].blinkit.totalSellable` | `CHANNEL_MIX.blinkit / 30 × 7` |

#### Daily velocity per channel

| Channel | 1st | 2nd | 3rd | 4th (stub) |
|---|---|---|---|---|
| Amazon | Manage Orders 32d: `(fbaUnits+mcfUnits)/days` | Nitin Daily Movement: `dailyMovement.byCode[c].channels.amazon.dailyOut` | FBA ledger 1-day proxy: `totalShippedToday` | `CHANNEL_MIX.amazon / 30` |
| Flipkart | Flipkart CSV: `sales30d / 30` | Nitin Daily Movement: `…flipkart.dailyOut` | — | `CHANNEL_MIX.flipkart / 30` |
| Blinkit | Blinkit Excel: `Σ byWh.sales30d / 30` | Nitin Daily Movement: `…blinkit.dailyOut` | — | `CHANNEL_MIX.blinkit / 30` |
| Shopify | Shopify CSV: `sales30d / 30` | Nitin Daily Movement: `…website.dailyOut` | — | `CHANNEL_MIX.shopify / 30` |
| WH base (offline+marketing) | Nitin Daily Movement: `…offline.dailyOut + …marketing.dailyOut` | — | — | residual = `stubVel × (1 − stubChannelShare)` |

### B.3 The Amazon channel folds in Shopify (AMZ-001 rule)

Per `AMZ-001`, Shopify D2C orders ship from Amazon FBA → they're treated as Amazon channel demand for cascade math. The dashboard's `channelVelocity.amazon` therefore = Amazon orders/day **+** Shopify orders/day.

Important nuance: the **Amazon Manage Orders feed already contains MCF orders** (= Shopify-via-Amazon shipments), so adding the Shopify CSV's `sales30d` on top **may double-count** the Shopify-origin slice. See Section E for the workaround.

### B.4 Total velocity → runway → status

```
sku.velocity      = channelVelocity.amazon + channelVelocity.flipkart
                  + channelVelocity.blinkit + whBaseVelocity      (all rounded to 1dp)

sku.totalStock    = stock.warehouse + stock.amazonFBA + stock.flipkart + stock.blinkit

sku.runway        = round(sku.totalStock / sku.velocity)          (days)

sku.runwayStatus  = vel ≤ 0           → "amber"
                  | runway ≤ leadTime → "red"
                  | runway < 30       → "amber"
                  | else              → "green"

sku.stockValue    = sku.totalStock × SKU_PRICING[code].sp
```

### B.5 Producible FG (the recipe layer)

```
inputCapacity     = floor(ITEM_QTY[recipe.input.refCode] / recipe.input.perPack)
pkgCapacity[k]    = floor(ITEM_QTY[recipe.pkg[k].refCode] / recipe.pkg[k].unitsPerPack)
producibleFG      = min(inputCapacity, min over k of pkgCapacity[k])
bottleneck        = the argmin (display label: SFG / RM / PKG1 / PKG2 / …)

maxFG             = currentFG + producibleFG     (the upper bound today)
```

### B.6 Reorder math (Forecast tab)

```
targetDays = readTargetDays(skuCode)              // localStorage, default 30
forecast   = sku.velocity × forecastDays × trend  // trend = stub seasonal multiplier
required   = sku.velocity × (forecastDays + targetDays) × trend
reorder    = max(0, required − maxFG)
```

### B.7 Cascade runway (Runway calculator tab)

Different from the simple `totalStock / velocity` runway. The cascade model:
1. Each marketplace drains at its own velocity using its own stock.
2. When a marketplace hits zero, its demand falls back to the central WH.
3. Total runway = the day the central WH itself hits zero.

Implemented in `src/lib/runwayCascade.js → computeCascade()`. The cascade total is what shows in the Runway tab's headline number.

### B.8 MoM growth derivation

```
if real Shopify data present:
  cur30  = real.shopify.sales30d
  prev30 = real.shopify.sales60d − cur30
  growth = (cur30 − prev30) / prev30 × 100
  growth = clamp(growth, −100, +200)               // 200% cap when prev was near zero
else:
  growth = MOM_GROWTH[code]                        // hardcoded May/Apr ratio
```

---

## Section C — Worked example: NSSBJ500 (Sea Buckthorn Juice 500ml)

Picked this SKU because it has all 4 channels live, 4 PKG components, real numbers across the board, and an active Shopify-via-Amazon stream. If you understand NSSBJ500, you understand all the others.

### C.1 Identity

| System | Identifier |
|---|---|
| Canonical (our code) | `NSSBJ500` |
| Amazon MSKU | `NSSBJ500ML` |
| Amazon FNSKU | `X002JBTVHJ` |
| Flipkart SKU | `NSSBJ500ML` |
| Shopify SKU | `NS-SBJ-500` |
| Blinkit | *not launched* |
| Nitin MIS | "Pure Sea Buckthorn Berries Juice 500ML" |
| Marketplace names | Amazon "Sea Buckthorn juice 500ml" · Flipkart "Sea Buckthorn juice 500ml" · Shopify "NATURESUM SEA BUCKTHORN JUICE — 500 ml" |

### C.2 BOM (recipe)

```
SKU_RECIPE.NSSBJ500 = {
  kind: "raw",
  input: { refCode: "NSSBJPLP", name: "SB Juice Pulp", unit: "Ltr", perPack: 0.50 },
  pkg: [
    { refCode: "NSPKGJBOT500", name: "Juice Bottle 500 ml",     unit: "Pcs", unitsPerPack: 1 },
    { refCode: "NSPKGJB500",   name: "Large Air Pouch 500 ml",  unit: "Pcs", unitsPerPack: 1 },
    { refCode: "NSPKGJTUB500", name: "Juice Tube 500 ml",       unit: "Pcs", unitsPerPack: 1 },
    { refCode: "NSPKGJLBL500", name: "Juice Label 500 ml",      unit: "Pcs", unitsPerPack: 1 },
  ],
}
```

Component qtys (from `ITEM_QTY` / Nitin's snapshot):

| refCode | Component | On hand | perPack | Capacity (packs) |
|---|---|---|---|---|
| `NSSBJPLP` | SB Juice Pulp | 0 L | 0.50 L | **0** |
| `NSPKGJBOT500` | Juice Bottle 500ml | 0 | 1 | **0** |
| `NSPKGJB500` | Large Air Pouch 500ml | 483 | 1 | 483 |
| `NSPKGJTUB500` | Juice Tube 500ml | 0 | 1 | **0** |
| `NSPKGJLBL500` | Juice Label 500ml | 0 | 1 | **0** |

**producibleFG = min(0, 0, 483, 0, 0) = 0 packs.** Bottleneck = tied between RM / PKG1 / PKG3 / PKG4 (any of the four 0s). The dashboard labels it whichever is smallest by index.

### C.3 Lead time

```
COMPONENT_LEAD_TIMES per component:
  NSSBJPLP     → 50 d   (Sea Buckthorn raw materials bucket)
  NSPKGJBOT500 → 14 d   (packaging)
  NSPKGJB500   → 14 d
  NSPKGJTUB500 → 14 d
  NSPKGJLBL500 → 14 d

sku.leadTime = max(50, 14, 14, 14, 14) = 50 days
```

The slowest component (SB Juice Pulp) gates the whole pack. Reorder PO must go 50 days before stock runs out.

### C.4 Stock right now

| Channel | Units | Source | Snapshot date |
|---|---|---|---|
| Central WH (FG) | **525** | `NITIN_DATA.warehouseInventory.fg.NSSBJ500` | 5-May-2026 |
| Amazon FBA | **3** | `REAL_MARKETPLACE_DATA.NSSBJ500.amazon.totalSellable` (sum across 4 FCs) | 29-May-2026 |
| Flipkart | **132** | `REAL_MARKETPLACE_DATA.NSSBJ500.flipkart.live` | 29-May-2026 |
| Blinkit | **0** | not launched | — |
| **Total** | **660** | sum | |

Per-FC breakdown for Amazon:

| FC | City | Sellable | 1-day shipped |
|---|---|---|---|
| BOM7 | Mumbai | 0 | 0 |
| CCX1 | Mumbai | 1 | 1 |
| DEL4 | Delhi NCR | 1 | 0 |
| MAA4 | Chennai | 1 | 0 |

⚠ Amazon FBA is critically low (3 units across 4 FCs). The dashboard flags this in the per-FC drill modal as 0 critical / 0 amber / 4 healthy — but "healthy" is misleading at this absolute level because all 4 are within 7 units. The threshold is the `≤10 absolute` fallback in `amzFcStats()`.

### C.5 Velocity (daily)

| Channel | Daily | Math | Source · Window |
|---|---|---|---|
| Amazon (FBA orders) | **8.7** | 278 units ÷ 32 days | Amazon Manage Orders TSV · 01-May → 01-Jun |
| Amazon (MCF orders) | **6.0** | 193 units ÷ 32 days | Same orders feed, `fulfillment-channel = Merchant` |
| **Amazon channel total** | **14.7** | FBA + MCF | (per AMZ-001) |
| Flipkart | **1.0** | 30 units ÷ 30 days | Flipkart "Sales 30D" field |
| Blinkit | **0** | — | not launched |
| Shopify | **8.1** | 243 units ÷ 30 days | Shopify CSV `Net items sold` |
| Offline | **0.1** | from Nitin Daily Movement 72d | nitin.dailyMovement |
| Marketing | **0** | from Nitin Daily Movement | nitin.dailyMovement |

**Total velocity computation:**

```
amazonChannelVel = (8.7 + 6.0) + 8.1 = 22.8         // includes Shopify per AMZ-001
flipkartVel       = 1.0
blinkitVel        = 0
whBaseVelocity    = 0.1 + 0 = 0.1                   // offline + marketing only

sku.velocity      = 22.8 + 1.0 + 0 + 0.1 = 23.9 / d
```

⚠ See **Section E.1** on the MCF/Shopify potential double-count.

### C.6 Growth (MoM %)

Derived from Shopify 30d vs prior-30d:

```
cur30  = 243
prev30 = sales60d − sales30d = 251 − 243 = 8
growth = (243 − 8) / 8 × 100 = 2,937.5%
growth = clamp(2937.5, −100, 200) = 200%             // capped
```

This is the +200% you see on the dashboard. The cap kicks in because prev30 was near zero (Shopify push only ramped late in May).

### C.7 Runway

#### Simple runway (Inventory headline)
```
runway = round(660 / 23.9) = 28 days
```
**Status**: leadTime (50) > runway (28) → status = **red**.

#### Cascade runway (Runway calculator headline)
This walks the cascade — see `src/lib/runwayCascade.js`. Each marketplace drains at its own velocity, WH absorbs each as it dies.

Cascade phases for NSSBJ500:
1. **Day 0** — Amazon FBA dies almost instantly (3 / 14.7 ≈ 0.2 days). Amazon demand falls back to WH. WH now drains at `14.7 + (residual) ≈ 14.8 /day`.
2. **Day ~132** — Flipkart dies (132 / 1.0 = 132 days). FK demand falls back to WH. WH drains at `~15.8 /day`.
3. **Total cascade** — when WH itself hits zero, given it was supplying everything from Day 0.

WH = 525, drain ≈ 14.8 → 525/14.8 ≈ 35 days from Day 0. So cascade total ≈ **35 days**.

This is roughly the same as the simple runway (28 days) — close because WH is the dominant pool. For SKUs where marketplaces hold the bulk of stock, the cascade and simple runways diverge more.

### C.8 Reorder quantity

```
targetDays  = 30 (default)                          // user can change in SkuBreakdownModal
forecast    = 23.9 × forecastDays(60) × trend(1.0) = 1,434
required    = 23.9 × (60 + 30) × 1.0 = 2,151
maxFG       = currentFG(525) + producibleFG(0) = 525
reorder     = max(0, 2,151 − 525) = 1,626 units
```

The dashboard says: "Reorder ~1,626 units to maintain 60d forecast + 30d buffer". Action flag = **red** (runway 28d < leadTime 50d).

### C.9 Stock value

```
SP = ₹1,100
stockValue = 660 × 1,100 = ₹7,26,000 (₹7.26 L)
```

### C.10 Where each number appears in the UI

| Tab / cell | What you see | The computed value |
|---|---|---|
| **Inventory → Unified Stock → row "Sea Buckthorn Juice 500ml"** | Total stock 660, runway 28d, vel 23.9/d, growth +200% | Section C.4 sum, C.7 simple, C.5 total, C.6 |
| Unified Stock → Warehouse cell | 525 (with "525 + 0 producible" subtext + 22d runway pill) | C.4 WH row + C.2 producible + WH stock/total vel = 22 |
| Unified Stock → Amazon FBA cell | 3 (0/4 red 4/4 amber) + 14.7/d | C.4 FC breakdown + C.5 amazon channel |
| Unified Stock → Flipkart cell | 132 + health pill (healthy if days-cover > 21) | C.4 + days-cover = 132/1 = 132d |
| Unified Stock → Blinkit cell | "not on Blinkit" | C.4 |
| Click row → SkuBreakdownModal | Full BOM table + per-channel runway/vel + target-cover editor | Sections C.2, C.5, C.7 + skuTargets.js |
| **Materials breakdown** → row NSSBJ500 | Produced FG 525, RM 0, PKG1 0, PKG2 483, PKG3 0, PKG4 0, bottleneck RM (or any PKG with 0), producible 0, max FG 525 | C.2 |
| **Runway calculator** → row NSSBJ500 | Cascade total runway ~35d, lead time 50d, action "Reorder now" | C.3, C.7 cascade |
| **Forecast** → row NSSBJ500 | Forecast 1,434, required 2,151, reorder qty 1,626 | C.8 |
| **Simulator** (when SKU picked) | Each input pre-filled from above; user can tweak vel/stock/lead/growth | All of the above |

---

## Section D — Compact one-pagers for the other 13 SKUs

Same shape as C but trimmed. Numbers per latest snapshot.

### D.1 NSMP100 · Moringa Powder 100g

- **Identity**: Amazon `NSMP100` · Flipkart `NSMP100` · Shopify `NSMP100` · not on Blinkit
- **BOM**: input `NSMLPR` (Moringa Leaves Powder, 0.10 kg/pack, 200 kg on hand → 2,000 packs) + PKG1 `NSPKGMP100` (0 → 0) + PKG2 `NSPKGCB100` (950 → 950) · **producibleFG = 0** (PKG1 bottleneck)
- **Lead time**: max(25 RM, 14 PKG×2) = **25 days**
- **Stock**: WH 201 · Amazon 81 (10 FCs) · Flipkart 100 · Blinkit 0 → **total 382**
- **Velocity**: Amazon orders 32d (16 FBA + 0 MCF + 9 Shopify) → amzCh = 0.5 + 0.3 = 0.8/d · FK 0/d · BLK 0 · Nitin offline 0.1/d → **total ≈ 1.0/d**. Stub `SKU_OPERATIONS.vel = 0` so this is real-derived.
- **Growth**: Shopify cur30=9, prev30=0 → cap → **+200%**
- **Runway**: 382 / ~1.0 ≈ **382d** · status **green**
- **Stock value**: 382 × ₹265 = ₹1,01,230

### D.2 NSMP250 · Moringa Powder 250g

- **Identity**: Amazon `NSMP250` · Flipkart `NSMP250` · Shopify `NSMP250` · not on Blinkit
- **BOM**: input `NSMLPR` (0.25 kg/pack, 200 kg → 800 packs) + PKG1 `NSPKGMP250` (0 → 0) + PKG2 `NSPKGCB250` (1,675 → 1,675) · **producibleFG = 0** (PKG1)
- **Lead time**: max(25, 14, 14) = **25 days**
- **Stock**: WH 169 · Amazon 97 (1 FC: DED4 only) · Flipkart 100 · Blinkit 0 → **total 366**
- **Velocity**: Amazon orders 32d (4 FBA + 0 MCF) → 0.13/d + Shopify 0 → amzCh ≈ 0.13 · Nitin offline 0.1 · others 0 → **total ≈ 0.2/d**
- **Growth**: no Shopify data → MOM_GROWTH stub **0%**
- **Runway**: 366 / 0.2 ≈ **1,830d** · status **green** (overstock)
- **Stock value**: 366 × ₹495 = ₹1,81,170
- ⚠ NSMP250 is only on 1 Amazon FC (DED4). Drill modal will show "1/1 healthy" — single-FC means no geographic redundancy.

### D.3 NSSB100 · Sea Buckthorn Powder 100g

- **Identity**: Amazon `NSSBP100` · Flipkart `NSSBP100` · Shopify `NS-SBP-100` · Blinkit "Daily Nutrition Supplement Powder 100g"
- **BOM**: input `NSSBPR` (0 kg) + PKG1 `NSPKGSBP100` (1,481) · **producibleFG = 0** (RM bottleneck)
- **Lead time**: max(50 RM, 14 PKG) = **50 days**
- **Stock**: WH 140 · Amazon 509 (11 FCs) · Flipkart 111 · Blinkit 471 (12 feeder WHs) → **total 1,231**
- **Velocity**: Amazon 32d (85 FBA + 82 MCF) = 5.2/d + Shopify 60/30 = 2.0/d → amzCh = 7.2 · FK 40/30 = 1.3 · BLK 110/30 = 3.7 · offline 0.1 · marketing 0 → **total ≈ 12.3/d** *(dashboard shows 16.4 due to AMZ-001 fold double-count — see E.1)*
- **Growth**: Shopify cur30=60, prev30=12 → +400% → cap **+200%**
- **Runway**: 1,231 / 16.4 ≈ **75d** · status **green** (well above 50d lead time)
- **Stock value**: 1,231 × ₹450 = ₹5,53,950

### D.4 NSSB250 · Sea Buckthorn Powder 250g

- **Identity**: Amazon `NSSBP250` · Flipkart `NSSBP250` · Shopify `NS-SBP-250` · Blinkit "Sea Buckthorn Berries Powder 250g"
- **BOM**: input `NSSBPR` (0) + PKG1 `NSPKGSBP250` (2,997) · **producibleFG = 0** (RM)
- **Lead time**: **50 days**
- **Stock**: WH 263 · Amazon 859 (9 FCs) · Flipkart 27 · Blinkit 373 (10 WHs) → **total 1,522**
- **Velocity**: Amazon 32d (637 FBA + 31 MCF) = 20.9/d + Shopify 36/30 = 1.2/d → amzCh ≈ 22.1 · FK 66/30 = 2.2 · BLK 42/30 = 1.4 · offline 0.2 → **total ≈ 25.9/d** *(dashboard says 31.3 — same double-count issue)*
- **Growth**: cur30=36, prev30=65 → **−44.6%**
- **Runway**: 1,522 / 31.3 ≈ **49d** · status **red** (just below 50d lead time)
- **Stock value**: 1,522 × ₹750 = ₹11,41,500

### D.5 NSSB500 · Sea Buckthorn Powder 500g

- **Identity**: Amazon `NSSBP500` · Flipkart `NSSBP500` · Shopify `NS-SBP-500` · Blinkit "Daily Nutrition Supplement 500g"
- **BOM**: input `NSSBPR` (0) + PKG1 `NSPKGSBP500` (2,972) · **producibleFG = 0** (RM)
- **Lead time**: **50 days**
- **Stock**: WH 202 · Amazon 545 (10 FCs) · Flipkart 99 · Blinkit 0 (1 WH launched, OOS) → **total 846**
- **Velocity**: Amazon 32d (156 FBA + 18 MCF) = 5.4 + Shopify 48/30 = 1.6 → amzCh ≈ 7.0 · FK 11/30 = 0.4 · BLK 0 · offline 0.4 → **total ≈ 7.8/d** *(dashboard says 8.1)*
- **Growth**: cur30=48, prev30=11 → +336% → cap **+200%**
- **Runway**: 846 / 8.1 ≈ **104d** · status **green**
- **Stock value**: 846 × ₹1,350 = ₹11,42,100

### D.6 NSSBDB100 · Sea Buckthorn Dry Berry 100g

- **Identity**: Amazon `NSSBDB100g` · Flipkart `NSSBDB100g` · Shopify `NS-SBDR-100` · Blinkit "Himalayan Sea Buckthorn Dry Berries 100g"
- **BOM**: input `NSSBDBR` (946.79 kg → 9,467 packs) + PKG1 `NSPKGDBP100` (67) · **producibleFG = 67** (PKG bottleneck)
- **Lead time**: **50 days**
- **Stock**: WH 0 · Amazon 171 (7 FCs) · Flipkart 74 · Blinkit 0 (1 WH launched, OOS) → **total 245**
- **Velocity**: Amazon 32d (685 FBA + 40 MCF) = 22.7 + Shopify 71/30 = 2.4 → amzCh ≈ 25.1 · FK 59/30 = 2.0 · BLK 0 · offline 0.1 → **total ≈ 27.2/d** *(dashboard says 26.3)*
- **Growth**: cur30=71, prev30=99 → **−28.3%**
- **Runway**: 245 / 26.3 ≈ **9d** · status **red** (below leadTime)
- **Reorder**: required = 26.3 × 90 = 2,367; max FG = 0 + 67 = 67; **reorder ≈ 2,300 units**
- **Stock value**: 245 × ₹390 = ₹95,550
- ⚠ Critical SKU — 9-day runway with 50-day lead time. PO must have already been placed.

### D.7 NSSBDB250 · Sea Buckthorn Dry Berry 250g

- **Identity**: Amazon `NSSBDB250g` · Flipkart `NSSBDB250g` · Shopify `NS-SBDR-250` · Blinkit "Sea Buckthorn Dry Berries 250g"
- **BOM**: input `NSSBDBR` (946.79 kg, 0.25/pack → 3,787 packs) + PKG1 `NSPKGDBP250` (916) · **producibleFG = 916** (PKG)
- **Lead time**: **50 days**
- **Stock**: WH 3 · Amazon 7 (4 FCs) · Flipkart 20 · Blinkit 99 (3 WHs) → **total 129**
- **Velocity**: Amazon 32d (604 FBA + 0 MCF) = 18.9 + Shopify 78/30 = 2.6 → amzCh ≈ 21.5 · FK 102/30 = 3.4 · BLK 110/30 = 3.7 · offline 0.1 → **total ≈ 28.7/d** *(dashboard says 25.2)*
- **Growth**: cur30=78, prev30=186 → **−58.1%**
- **Runway**: 129 / 25.2 ≈ **5d** · status **red, critical**
- **Reorder**: required = 25.2 × 90 = 2,268; max FG = 3 + 916 = 919; **reorder ≈ 1,349 units**
- **Stock value**: 129 × ₹690 = ₹89,010

### D.8 NSSBDB500 · Sea Buckthorn Dry Berry 500g

- **Identity**: Amazon `NSSBDB500g` · Flipkart `NSSBDB500g` · Shopify `NS-SBDR-500` · Blinkit "Himalayan Sea Buckthorn Dry Berries 500g"
- **BOM**: input `NSSBDBR` (0.50/pack → 1,893 packs) + PKG1 `NSPKGDBP500` (3,055) · **producibleFG = 1,893** (RM)
- **Lead time**: **50 days**
- **Stock**: WH 0 · Amazon 17 (6 FCs) · Flipkart 0 · Blinkit 114 (4 WHs) → **total 131**
- **Velocity**: Amazon 32d (308 FBA + 0 MCF) = 9.6 + Shopify 80/30 = 2.7 → amzCh ≈ 12.3 · FK 73/30 = 2.4 · BLK 78/30 = 2.6 · offline 0.1 → **total ≈ 17.4/d** *(dashboard says 13.8)*
- **Growth**: cur30=80, prev30=90 → **−11.1%**
- **Runway**: 131 / 13.8 ≈ **9d** · status **red, critical**
- **Stock value**: 131 × ₹1,150 = ₹1,50,650

### D.9 NSSBJ300 · Sea Buckthorn Juice 300ml

- **Identity**: Amazon `NSSBJ300ML` · Flipkart `NSSBJ300ML` · Shopify `NS-SBJ-300` · Blinkit "Berry Juice Concentrate 300ml"
- **BOM**: input `NSSBJPLP` (0 L → 0 packs) + 4 PKGs (juice bottle 0, air pouch 1,025, tube 0, label 0) · **producibleFG = 0** (RM + 3 PKGs all 0)
- **Lead time**: **50 days**
- **Stock**: WH 224 · Amazon 110 (4 FCs) · Flipkart 55 · Blinkit 3 (1 WH) → **total 392**
- **Velocity**: Amazon 32d (289 FBA + 43 MCF) = 10.4 + Shopify 96/30 = 3.2 → amzCh ≈ 13.6 · FK 50/30 = 1.7 · BLK 14/30 = 0.5 · offline 0.2 → **total ≈ 16.0/d** *(dashboard says 13.0)*
- **Growth**: cur30=96, prev30=10 → +860% → cap **+200%**
- **Runway**: 392 / 13.0 ≈ **30d** · status **red** (below 50d lead time)
- **Stock value**: 392 × ₹690 = ₹2,70,480

### D.10 NSSBBO15 · Sea Buckthorn Berry Oil 15ml

- **Identity**: Not listed on any marketplace · only in Nitin's MIS
- **BOM**: input `NSSBOR` (5 L, 0.015 L/pack → 333 packs) + 4 PKGs: `NSPKGBOBT15` (497) + `NSPKGBOB15` (1,014) + `NSPKGBOCAP` (1,050) + `NSPKGBODROP` (1,050) · **producibleFG = 333** (RM bottleneck)
- **Lead time**: **50 days**
- **Stock**: WH 45 · Amazon 0 · Flipkart 0 · Blinkit 0 → **total 45**
- **Velocity**: no marketplace data · Nitin offline 0.1/d → **total ≈ 0/d** (rounds to 0.0)
- **Growth**: no data → **0%** (stub)
- **Runway**: vel ≈ 0 → no pill shown · status **amber** (zero velocity)
- **Stock value**: 45 × ₹1,075 = ₹48,375
- ⚠ This SKU is essentially dormant. WH has 45 units but no detectable demand stream.

### D.11 NSSBBO30 · Sea Buckthorn Berry Oil 30ml

- **Identity**: Shopify `NS-SB-030` only · not on Amazon/Flipkart/Blinkit
- **BOM**: input `NSSBOR` (5 L, 0.030 L/pack → 166 packs) + 4 PKGs: `NSPKGBOBT30` (26) + `NSPKGBOB30` (123) + `NSPKGBOCAP` (1,050) + `NSPKGBODROP` (1,050) · **producibleFG = 26** (PKG1 bottleneck — only 26 bottles)
- **Lead time**: **50 days**
- **Stock**: WH 0 · Amazon 0 · Flipkart 0 · Blinkit 0 → **total 0**
- **Velocity**: Shopify 30d=0 (90d=-2 returns) · Nitin offline 0.2 · others 0 → **total ≈ 0.5/d** *(dashboard shows 0.7; whBaseVelocity dominates)*
- **Growth**: no positive Shopify signal → **0%**
- **Runway**: 0 / 0.5 = 0d · status **red** (out of stock)
- **Stock value**: 0 × ₹1,580 = ₹0

### D.12 NSJO100 · Jatamansi Hair Oil 100ml

- **Identity**: Amazon `NSJ&RHO100ML` (FNSKU `X0025NUJDB_HO`) · Flipkart `NSJ&RHO100ML` · Shopify `NS-HO-JT-100` · not on Blinkit
- **BOM**: **kind: semi** · input `NSJOF100` (Jatamansi Hair Oil Filled Bottle, 1 pc/pack, 0 on hand) + PKG1 `NSPKGJOB100` (533) · **producibleFG = 0** (SFG bottleneck)
- **Lead time**: max(20 SFG, 14 PKG) = **20 days**
- **Stock**: WH 613 · Amazon 231 (4 FCs) · Flipkart 49 · Blinkit 0 → **total 893**
- **Velocity**: Amazon 32d (117 FBA + 0 MCF) = 3.7 + Shopify 10/30 = 0.3 → amzCh ≈ 4.0 · FK 1/30 = 0.03 · BLK 0 · offline 0.3 · marketing 0.4 → **total ≈ 4.8/d** *(dashboard says 5.2)*
- **Growth**: cur30=10, prev30=4 → **+150%** (not capped)
- **Runway**: 893 / 5.2 ≈ **172d** · status **green** (well above 20d lead time)
- **Stock value**: 893 × ₹1,350 = ₹12,05,550

### D.13 NSACDT30 · Acacia Catechu Diabetes Care Tea 30 bags

- **Identity**: Amazon `DI-TE-1-A` · Flipkart `DI-TE-1-A` · Shopify `DI-TE-1-A` · Blinkit "Diabetes Care Tea 30 pcs" (1 WH only)
- **BOM**: **kind: semi** · input `NSACDSF30` (AC Tea Dip Sachets Filled, 30 sachets/pack, 9,073 on hand → 302 packs) + PKG1 `NSPKGACTC30` (Tea Bag Pouch green, 44,350 / 30 per pack = 1,478) + PKG2 `NSPKGACTCBOX` (Outer Box, 2,543) · **producibleFG = 302** (SFG bottleneck)
- **Lead time**: max(20 SFG, 14 PKG×2) = **20 days**
- **Stock**: WH 55 · Amazon 42 (2 FCs: CCX1, MAA4) · Flipkart 27 · Blinkit 0 (1 WH launched, OOS) → **total 124**
- **Velocity**: Amazon 32d (33 FBA + 3 MCF) = 1.1 + Shopify 0/30 = 0 → amzCh ≈ 1.1 · FK 1/30 = 0.03 · BLK 0 · offline 0.2 → **total ≈ 1.4/d** *(dashboard says 2.1 — partly stub fallback)*
- **Growth**: cur30=0, prev30=4 → −100% (negative cap) **−100%**
- **Runway**: 124 / 2.1 ≈ **59d** · status **green** (above 20d lead time but trending down)
- **Stock value**: 124 × ₹975 = ₹1,20,900

---

## Section E — Known data-flow caveats (where the dashboard can be off)

### E.1 Amazon MCF + Shopify potential double-count

The Amazon Manage Orders feed includes `fulfillment-channel = Merchant` rows — these are MCF (Multi-Channel Fulfilment) orders where Amazon ships for off-Amazon stores (mostly Shopify). The dashboard treats these as **Amazon channel velocity** (counts them in `dailyFba + dailyMcf`).

Separately, the Shopify CSV reports **all Shopify orders** (Net items sold) — including those that were fulfilled via Amazon MCF.

Result: the same physical order is potentially counted in both `realAmazonDaily` and `realShopifyDaily`. Then `amazonChannelVel = realAmazonDaily + realShopifyDaily` adds them again per AMZ-001.

**How big is the effect?** For NSSBJ500 the MCF was 193 units / 32d vs Shopify 243 units / 30d — very similar magnitudes. Suggesting the Shopify number is ~all of MCF. So dashboard's 14.7 (FBA+MCF) + 8.1 (Shopify) = 22.8 likely overstates by ~6 units/day. The true Amazon channel is closer to ~17/d.

**To fix**: in `src/data.js` near `amazonChannelVel`, subtract the MCF Shopify-origin (`real.amazon.orders.mcfWebsiteUnits / days`) from the Shopify total before adding. One-line patch; needs a test. Currently unfixed because we wanted to ship the orders integration first.

### E.2 Stub velocity fallback can dominate for low-data SKUs

SKUs without marketplace data (NSSBBO15) or with very thin Shopify-only data (NSSBBO30) end up with `realFooDaily = null` for every channel, so the dashboard falls back to `stubVel * (1 − stubChannelShare)` which becomes `stubVel` itself when `CHANNEL_MIX` is all zeros.

For NSSBBO30 the stub vel is `0.5/d` (from `SKU_OPERATIONS.vel`). That number is hand-keyed and may be stale or fictional. Tagged as `velocitySource: "stub"` in the SKU object — UI doesn't surface this yet (provenance markers are the next improvement).

### E.3 Single-day Amazon FBA ledger

The "Warehouse Wise Ledger" CSV we ingest is **one day's** snapshot (29-May). Per-FC stock numbers are real for that day. `totalShippedToday` is one day's customer shipments — used as a 1-day proxy in the precedence chain only if neither the orders feed nor Nitin's daily movement have data. Multi-day ledger would improve cascade-runway math (FC-level depletion rates).

### E.4 Blinkit "ever launched" = sheet rows

The denominator in the Blinkit a/b stat (`red feeders / total feeders`) is the count of feeder-WH rows for that SKU in the Stock On Hand sheet. If Blinkit drops a feeder from the report (e.g. they delisted us at one WH), the historic "ever launched" denominator shrinks. To keep historic comparisons honest you'd snapshot the feeder list on first sighting — not done today.

### E.5 Producible FG ignores SFG production rate

`producibleFG` answers "how many more packs can I make TODAY given current components". It assumes:
- I can convert RM → SFG instantly (no production time)
- The SFG line in `SKU_RECIPE` is the bottleneck for semi-FG SKUs

For NSACDT30 specifically, the 9,073 sachets / 30 per pack = 302 packs producible — but only if no further SFG production is needed. If we're out of dip sachets, the cascade goes RM → SFG production → packing. The dashboard doesn't model the SFG production step.

### E.6 Shopify trend cap (+200%)

`MOM_GROWTH` is capped at ±200% because some SKUs went from 0 prior-30d to non-zero cur30 → infinite ratio. The cap is a display safety. SKUs at +200% mean "went from ~zero to active" but the actual ratio is unknown. NSMP100, NSSB100, NSSB500, NSSBJ300, NSSBJ500 are all hitting the cap right now.

### E.7 Nitin's warehouse audit is 5-May, marketplace data is 29-May

The central WH stock numbers (`NITIN_DATA.warehouseInventory.fg`) are from 5-May. Marketplace stocks are 29-May. Production / shipping activity over those 24 days isn't reflected in the WH number, so WH stock may be **higher than displayed** for SKUs that produced in May, or **lower** for SKUs that shipped heavily to marketplaces.

This is why central WH numbers can look stale on the dashboard. Solution: re-upload Nitin's sheet via the Upload modal whenever a fresh audit happens — that overrides the bundled 5-May snapshot in localStorage.

---

## Section F — Quick-reference: which number is fed from where

For any "why does the dashboard show X?" question, walk this chain in order:

1. **What metric is it?** (stock / velocity / runway / growth / reorder / value)
2. **What channel?** (central WH / Amazon / Flipkart / Blinkit / Shopify)
3. **Walk the precedence** (Section B.2):
   - Is there a fresh user upload for that file type? → use that
   - Else: is there a bundled real value? → use that
   - Else: fall back to stub
4. **Apply the formula** (Section B.4-B.6)
5. **Cross-check against the per-SKU walkthrough** in Section C / D

If the number is off:
- **Vs reality** → check Section E for known caveats
- **Vs another tab** → some tabs use simple runway, others use cascade — they SHOULD differ for SKUs with imbalanced channel stock
- **Vs intuition** → confirm `velocitySource` (in the SKU object) is `"real"` for the channel that should be driving the number; if it's `"stub"` the dashboard is using hardcoded fallback

---

*End of per-SKU walkthrough. For the reference tables (mapping rules, refCode catalog, file index), see `MAPPING.md`. For AI integration setup, see `CLAUDE_API.md`.*
