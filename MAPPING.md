# Naturesum Command Center — Backend Mapping Reference

> **What this is.** A single self-contained reference for every "X maps to Y" relationship in the dashboard's backend. SKU codes across marketplaces, BOM recipes, supplier lead times, pricing, data-source precedence, and the formulas that derive velocity / runway / reorder qty.
>
> **How to use it.** Drop the whole file into a Claude conversation and ask things like *"Why is NSSBJ500's stock value showing X?"* or *"Which mapping is wrong if the Flipkart cell for NSSBDB100 says zero?"* or *"What's the chain that flows real Amazon data into the dashboard?"* — Claude can answer using the tables below without touching the codebase.
>
> **Last regenerated:** 01-Jun-2026 · synced to commit `fc37d8e`.

---

## 0. Glossary

| Term | Meaning |
|---|---|
| **Canonical SKU code** | The dashboard's internal identifier for a finished good. 14 in total: `NSMP100`, `NSMP250`, `NSSB100`, `NSSB250`, `NSSB500`, `NSSBDB100`, `NSSBDB250`, `NSSBDB500`, `NSSBJ300`, `NSSBJ500`, `NSSBBO15`, `NSSBBO30`, `NSJO100`, `NSACDT30`. Every other system's identifier maps back to one of these. |
| **refCode** | Internal identifier for a component — raw material, semi-FG, or packaging. e.g. `NSSBPR` = SB Powder Raw, `NSPKGCB250` = 250g Carton Box. |
| **FG / SFG / RM / PKG** | Finished Good / Semi-Finished Good / Raw Material / Packaging. Each canonical SKU is one FG with a recipe that pulls from one SFG-or-RM + ≥1 PKG. |
| **Channel** | One of: `amazon`, `flipkart`, `blinkit`, `shopify`. By AMZ-001 convention, Shopify orders ship through Amazon FBA and are folded into the Amazon channel for velocity math. |
| **MSKU / FNSKU / ASIN** | Amazon's three identifiers. We key off MSKU (merchant SKU) — that's what shows in inventory ledgers and order reports. |
| **FC** | Fulfillment Center — Amazon's warehouse code (BOM7, DEL4, etc.). |
| **Feeder WH** | Blinkit's regional dark-store-replenishment warehouse (Noida N1, Faridabad, etc.). |
| **Cascade runway** | The day the central warehouse hits zero, given marketplaces drain first and the WH absorbs each channel's demand as it dies. Modeled in `src/lib/runwayCascade.js`. |

---

## 1. SKU Identity Across Systems

The master cross-reference. Every row is one canonical SKU and how every other system labels it.

| Canonical | Name | Variant | Amazon MSKU | Amazon ASIN/FNSKU | Flipkart SKU | Shopify SKU | Blinkit (title pattern) | Nitin's MIS sheet aliases |
|---|---|---|---|---|---|---|---|---|
| `NSMP100` | Moringa Powder | 100 g | `NSMP100` | `X002L3VQ41` | `NSMP100` | `NSMP100` | — (not on Blinkit) | "Moringa Powder 100 gm Packed", "moringa 100" |
| `NSMP250` | Moringa Powder | 250 g | `NSMP250` | `X002L3WEBP` | `NSMP250` | `NSMP250` | — | "Moringa Powder 250 gm Packed", "moringa 250" |
| `NSSB100` | Sea Buckthorn Powder | 100 g | `NSSBP100` | `X002EFS34H` | `NSSBP100` | `NS-SBP-100` | "Daily Nutrition Supplement Powder" + variant `100 g` | "SB Powder 100 gm Packed", "Sea Buckthorn Berries Powder 100" |
| `NSSB250` | Sea Buckthorn Powder | 250 g | `NSSBP250` | `X002EFS2ZR` | `NSSBP250` | `NS-SBP-250` | "Sea Buckthorn Berries Powder" + `250 g` | "SB Powder 250 GM Packed" |
| `NSSB500` | Sea Buckthorn Powder | 500 g | `NSSBP500` | `X002HTJ1X7` | `NSSBP500` | `NS-SBP-500` | "Daily Nutrition Supplement" + `500 g` | "SB Powder 500 gm Packed" (NOT "Packed (Old)" — that's filtered out) |
| `NSSBDB100` | Sea Buckthorn Dry Berry | 100 g | `NSSBDB100g` | `X0029J4T23` | `NSSBDB100g` | `NS-SBDR-100` | "Himalayan Sea Buckthorn Dry Berries" + `100 g` | "SB Berries 100 gm Packed", "Sea Buckthorn Dry Berries 100 GM" |
| `NSSBDB250` | Sea Buckthorn Dry Berry | 250 g | `NSSBDB250g` | `X0025NUJDB` | `NSSBDB250g` | `NS-SBDR-250` | "Sea Buckthorn Dry Berries" + `250 g` | "SB Berries 250 gm Packed" |
| `NSSBDB500` | Sea Buckthorn Dry Berry | 500 g | `NSSBDB500g` | `X002E5YNFP` | `NSSBDB500g` | `NS-SBDR-500` ⚠ matches same title as NSSBDB100 — disambiguated by variant `500 g` | "SB Berries 500 gm Packed" |
| `NSSBJ300` | Sea Buckthorn Juice | 300 ml | `NSSBJ300ML` | `X002JC4PQ5` | `NSSBJ300ML` | `NS-SBJ-300` | "Berry Juice Concentrate" + `300 ml` | "Pure Sea Buckthorn Berries Juice 300ML" |
| `NSSBJ500` | Sea Buckthorn Juice | 500 ml | `NSSBJ500ML` | `X002JBTVHJ` | `NSSBJ500ML` | `NS-SBJ-500` | — (not on Blinkit yet) | "Pure Sea Buckthorn Berries Juice 500ML" |
| `NSSBBO15` | Sea Buckthorn Berry Oil | 15 ml | — *(not listed)* | — | — | — | — | "SB Face Oil 15 ml Packed" |
| `NSSBBO30` | Sea Buckthorn Berry Oil | 30 ml | — *(not on Amazon)* | — | — | `NS-SB-030` | — | "SB Face Oil 30 ml Packed" |
| `NSJO100` | Jatamansi Hair Oil | 100 ml | `NSJ&RHO100ML` | `X0025NUJDB_HO` | `NSJ&RHO100ML` | `NS-HO-JT-100` | — *(not on Blinkit)* | "Jatamansi Hair Oil 100 ml Pack", "Jatamansi & Rosemary Hair Oil 100 ML" |
| `NSACDT30` | Acacia Catechu Tea | 30 bags | `DI-TE-1-A` | (Amazon listing dropped — see note) | `DI-TE-1-A` | `DI-TE-1-A` | "Diabetes Care Tea" + `30 pcs` | "AC Tea(30 tea bags) Packed", "Acacia Catechu - 30 Tea Bags" |

### 1.1 Known unmapped / quirky cases

| Item | Where it appears | Why it's unmapped | Impact |
|---|---|---|---|
| `NSSBDB100g*2` | Flipkart inventory CSV | Flipkart 2-pack bundle of NSSBDB100. No canonical equivalent in our 14-SKU master. | Silently ignored by the Flipkart parser. Flipkart cell undercounts 2-pack sales. |
| `NSSBP500` (with `Old` suffix) | Nitin's warehouse-inventory sheet has "SB Powder 500 gm Packed (Old)" as a separate line | `SKU_MATCHERS` for NSSB500 has `!/old/i.test(n)` to **exclude** the Old variant | Old stock excluded from canonical NSSB500 count. If you want it included, remove the `!/old/i` clause. |
| `NSACDT30` Amazon ASIN | Listing was removed at some point | `CODE_MAP.amz = null` for this SKU | Amazon ledger doesn't surface NSACDT30 rows — that's correct given the listing is gone. |
| Blinkit titles with `Daily Nutrition Supplement` for both 100g and 500g | Same prefix used by Blinkit for NSSB100 and NSSB500 | Disambiguated by `blkVariant` (`100 g` vs `500 g`) | OK as long as Blinkit keeps the variant field accurate. If they re-tag both as the same string, the parser will mis-attribute. |

### 1.2 Where the mapping data lives in code

| Mapping | File | Lookup direction |
|---|---|---|
| Canonical → Amazon MSKU / Flipkart / Shopify / Blinkit | `scripts/import-marketplace-data.cjs` → `CODE_MAP` | Top-down (this file is the source of truth for marketplace IDs) |
| Same mapping client-side (used by Upload modal parsers) | `src/lib/uploadParsers.js` → `CODE_MAP` | Must stay in sync with the script-side `CODE_MAP` — duplicate by design (server-side for scripts, client-side for browser upload). |
| Amazon MSKU → canonical | `scripts/import-marketplace-data.cjs` → `byAmzMsku` (derived from `CODE_MAP`) | Reverse lookup |
| Flipkart SKU → canonical | `byFkSku` | Reverse |
| Shopify SKU → canonical | `byShpSku` | Reverse |
| Blinkit title → canonical | `blkMatches` (substring + variant match) | Fuzzy reverse |
| Nitin's MIS line names → canonical | `scripts/import-nitin-sheet.cjs` → `SKU_MATCHERS` (regex tests) | Fuzzy reverse |
| Nitin's MIS line names → component refCode | `scripts/import-nitin-sheet.cjs` → `COMPONENT_MATCHERS` | Fuzzy reverse, only for SFG/RM/PKG rows |
| Canonical → display name on each channel | `src/data.js` → `MARKETPLACE_NAMES` | Display-only |
| Upload-modal alias matcher (in-browser) | `src/lib/parseInventoryFile.js` → `ITEM_MAP` | Used by the live-Nitin upload path (older single-file flow) |

### 1.3 How to add a new SKU

1. Add to `src/data.js` `skus[]` (canonical code + name + variant + active flag + stub velocity)
2. Add to `SKU_OPERATIONS` (fg / vel / lead time — vel auto-derives from real data when available)
3. Add to `SKU_RECIPE` (kind: raw/semi + input refCode + perPack + PKG components)
4. Add to `SKU_PRICING` (sp + mrp)
5. Add to `CHANNEL_MIX` (stub units/30d per channel — fallback if no real data)
6. Add to `MOM_GROWTH` (stub MoM% — derived from Shopify data when available)
7. Add to `MARKETPLACE_NAMES` (display name per channel)
8. Add to `scripts/import-marketplace-data.cjs` `CODE_MAP` (Amazon MSKU, Flipkart SKU, Shopify SKU, Blinkit title key + variant)
9. **Mirror step 8** in `src/lib/uploadParsers.js` `CODE_MAP` (same values, browser-side)
10. Add to `scripts/import-nitin-sheet.cjs` `SKU_MATCHERS` (regex that matches Nitin's wording)

⚠ If steps 8 + 9 drift apart, the **scripts** parser will work but the **uploaded** file from the dashboard won't recognize the SKU. Always update both.

---

## 2. Component Recipes (Bill of Materials)

Each canonical SKU has exactly one **input** (either SFG or RM) plus 1–4 **PKG** components.

### 2.1 refCode catalog

| refCode | Name | Unit | Category | Used by SKUs |
|---|---|---|---|---|
| `NSMLPR` | Moringa Leaves Powder | KG | RM | NSMP100, NSMP250 |
| `NSSBPR` | SB Powder (Raw) | KG | RM | NSSB100, NSSB250, NSSB500 |
| `NSSBDBR` | SB Dry Berries (Raw) | KG | RM | NSSBDB100, NSSBDB250, NSSBDB500 |
| `NSSBJPLP` | SB Juice Pulp | Ltr | RM | NSSBJ300, NSSBJ500 |
| `NSSBOR` | SB Face Oil (Raw) | Ltr | RM | NSSBBO15, NSSBBO30 |
| `NSJOF100` | Jatamansi Hair Oil Filled Bottle | Pcs | SFG | NSJO100 |
| `NSACDSF30` | AC Tea Dip Sachets (Filled) | Pcs | SFG | NSACDT30 (30 sachets per pack) |
| `NSACTPF` | AC Tea Pouches (Filled) | Pcs | SFG | (not currently in any active SKU — secondary SFG) |
| `NSPKGMP100` | Moringa Powder Empty Pouch 100g | Pcs | PKG | NSMP100 |
| `NSPKGMP250` | Moringa Powder Empty Pouch 250g | Pcs | PKG | NSMP250 |
| `NSPKGCB100` | 100g Carton Box | Pcs | PKG | NSMP100 |
| `NSPKGCB250` | 250g Carton Box | Pcs | PKG | NSMP250 |
| `NSPKGSBP100` | SB Powder Empty Pouch 100g | Pcs | PKG | NSSB100 |
| `NSPKGSBP250` | SB Powder Empty Pouch 250g | Pcs | PKG | NSSB250 |
| `NSPKGSBP500` | SB Powder Empty Pouch 500g | Pcs | PKG | NSSB500 |
| `NSPKGDBP100` | Dry Berries Empty Pouch 100g | Pcs | PKG | NSSBDB100 |
| `NSPKGDBP250` | Dry Berries Empty Pouch 250g | Pcs | PKG | NSSBDB250 |
| `NSPKGDBP500` | Dry Berries Empty Pouch 500g | Pcs | PKG | NSSBDB500 |
| `NSPKGJBOT300` | Juice Bottle 300 ml | Pcs | PKG | NSSBJ300 |
| `NSPKGJBOT500` | Juice Bottle 500 ml | Pcs | PKG | NSSBJ500 |
| `NSPKGJB300` | Small Air Pouch 300 ml | Pcs | PKG | NSSBJ300 |
| `NSPKGJB500` | Large Air Pouch 500 ml | Pcs | PKG | NSSBJ500 |
| `NSPKGJTUB300` | Juice Tube 300 ml | Pcs | PKG | NSSBJ300 |
| `NSPKGJTUB500` | Juice Tube 500 ml | Pcs | PKG | NSSBJ500 |
| `NSPKGJLBL300` | Juice Label 300 ml | Pcs | PKG | NSSBJ300 |
| `NSPKGJLBL500` | Juice Label 500 ml | Pcs | PKG | NSSBJ500 |
| `NSPKGBOBT15` | SB Oil Bottle 15 ml | Pcs | PKG | NSSBBO15 |
| `NSPKGBOBT30` | SB Face Oil Empty Bottle 30 ml | Pcs | PKG | NSSBBO30 |
| `NSPKGBOB15` | SB Faceoil Empty Box 15 ml | Pcs | PKG | NSSBBO15 |
| `NSPKGBOB30` | SB Faceoil Empty Box 30 ml | Pcs | PKG | NSSBBO30 |
| `NSPKGBOCAP` | Bottle Cap (shared 15 + 30) | Pcs | PKG | NSSBBO15, NSSBBO30 |
| `NSPKGBODROP` | Dropper (shared 15 + 30) | Pcs | PKG | NSSBBO15, NSSBBO30 |
| `NSPKGJOB100` | Jatamansi Empty Box (with print) | Pcs | PKG | NSJO100 |
| `NSPKGACTC30` | Acacia Catechu Tea Bag Empty Pouch (green) | Pcs | PKG | NSACDT30 (30 per pack) |
| `NSPKGACTCBOX` | Acacia Catechu Tea Empty Outer Box | Pcs | PKG | NSACDT30 |

### 2.2 Per-SKU recipe (full BOM)

| Canonical | Kind | Input refCode | perPack | PKG components (refCode · unitsPerPack) |
|---|---|---|---|---|
| `NSMP100` | RM | `NSMLPR` | 0.10 kg | `NSPKGMP100` × 1 · `NSPKGCB100` × 1 |
| `NSMP250` | RM | `NSMLPR` | 0.25 kg | `NSPKGMP250` × 1 · `NSPKGCB250` × 1 |
| `NSSB100` | RM | `NSSBPR` | 0.10 kg | `NSPKGSBP100` × 1 |
| `NSSB250` | RM | `NSSBPR` | 0.25 kg | `NSPKGSBP250` × 1 |
| `NSSB500` | RM | `NSSBPR` | 0.50 kg | `NSPKGSBP500` × 1 |
| `NSSBDB100` | RM | `NSSBDBR` | 0.10 kg | `NSPKGDBP100` × 1 |
| `NSSBDB250` | RM | `NSSBDBR` | 0.25 kg | `NSPKGDBP250` × 1 |
| `NSSBDB500` | RM | `NSSBDBR` | 0.50 kg | `NSPKGDBP500` × 1 |
| `NSSBJ300` | RM | `NSSBJPLP` | 0.30 L | `NSPKGJBOT300` × 1 · `NSPKGJB300` × 1 · `NSPKGJTUB300` × 1 · `NSPKGJLBL300` × 1 |
| `NSSBJ500` | RM | `NSSBJPLP` | 0.50 L | `NSPKGJBOT500` × 1 · `NSPKGJB500` × 1 · `NSPKGJTUB500` × 1 · `NSPKGJLBL500` × 1 |
| `NSSBBO15` | RM | `NSSBOR` | 0.015 L | `NSPKGBOBT15` × 1 · `NSPKGBOB15` × 1 · `NSPKGBOCAP` × 1 · `NSPKGBODROP` × 1 |
| `NSSBBO30` | RM | `NSSBOR` | 0.030 L | `NSPKGBOBT30` × 1 · `NSPKGBOB30` × 1 · `NSPKGBOCAP` × 1 · `NSPKGBODROP` × 1 |
| `NSJO100` | SFG | `NSJOF100` | 1 pc | `NSPKGJOB100` × 1 |
| `NSACDT30` | SFG | `NSACDSF30` | 30 sachets | `NSPKGACTC30` × 30 · `NSPKGACTCBOX` × 1 |

### 2.3 Producible-FG math

```
inputCapacity     = floor(ITEM_QTY[input.refCode] / input.perPack)
pkgCapacity[k]    = floor(ITEM_QTY[pkg[k].refCode] / pkg[k].unitsPerPack)
producibleFG      = min(inputCapacity, min(pkgCapacity[*]))
bottleneck        = argmin over those terms (display labels: SFG / RM / PKG1 / PKG2 / …)
```

The slowest constraint caps how many additional FG packs we could produce today.

### 2.4 Where to look if a recipe number looks wrong

| Symptom | Likely cause | Where to fix |
|---|---|---|
| FG row shows producible 0 but should be more | `ITEM_QTY[input.refCode]` is 0 or stale | `src/data.js` → `ITEM_QTY` (snapshot from Nitin's Master). If user uploaded Nitin's sheet, the upload overwrites this via `parseInventoryFile.js`. |
| Producible capped by wrong component | `perPack` or `unitsPerPack` in recipe is wrong | `src/data.js` → `SKU_RECIPE` |
| New SKU's recipe missing entirely | not added | See § 1.3 |

---

## 3. Lead Times

### 3.1 Per-component supplier lead times (days)

| Bucket | refCodes | Lead time |
|---|---|---|
| Sea Buckthorn raw materials | `NSSBPR`, `NSSBJPLP`, `NSSBDBR`, `NSSBOR` | **50 d** |
| Moringa raw | `NSMLPR` | **25 d** |
| Semi-FG (Acacia + Jatamansi filled) | `NSACDSF30`, `NSJOF100`, `NSACTPF` | **20 d** |
| All packaging (every `NSPKG*`) | 25 refCodes | **14 d** |

Source: founder-provided 31-May-2026 (DATA-016 satisfied via `SIM-016`). Lives in `src/data.js` → `COMPONENT_LEAD_TIMES`.

### 3.2 Per-SKU lead time derivation

```
sku.leadTime = max( COMPONENT_LEAD_TIMES[input.refCode],
                    COMPONENT_LEAD_TIMES[pkg[0].refCode],
                    COMPONENT_LEAD_TIMES[pkg[1].refCode],
                    … )
```

The slowest input wins. e.g. any Sea Buckthorn powder SKU has lead time = max(50d SBPR, 14d pouch) = **50 days**. Acacia Tea = max(20d filled sachets, 14d pouch, 14d box) = **20 days**.

### 3.3 Per-marketplace inbound lead time

| Channel | Inbound days |
|---|---|
| Amazon FBA | **14 d** |
| Flipkart | **3 d** |
| Blinkit | **8 d** |

Source: founder-provided (SIM-014). Lives in `src/pages/PageInventory.jsx` → `MP_INBOUND_LEAD_DEFAULT`. User-editable in the Simulator.

---

## 4. Pricing

### 4.1 SP + MRP per SKU

| Canonical | Selling Price ₹ | MRP ₹ |
|---|---|---|
| NSMP100 | 265 | 315 |
| NSMP250 | 495 | 625 |
| NSSB100 | 450 | 500 |
| NSSB250 | 750 | 880 |
| NSSB500 | 1,350 | 1,550 |
| NSSBDB100 | 390 | 520 |
| NSSBDB250 | 690 | 920 |
| NSSBDB500 | 1,150 | 1,550 |
| NSSBJ300 | 690 | 920 |
| NSSBJ500 | 1,100 | 1,300 |
| NSSBBO15 | 1,075 | 1,250 |
| NSSBBO30 | 1,580 | 1,920 |
| NSJO100 | 1,350 | 1,500 |
| NSACDT30 | 975 | 1,150 |

Source: founder-provided 01-Jun-2026 (DATA-004 fully satisfied). Lives in `src/data.js` → `SKU_PRICING`.

### 4.2 Where price is used

- **stockValue** = `total stock units × SP` → drives Inventory / Sales / Finance value displays
- **stockValueAtRisk** = `(red + amber stock) × SP`
- **stockValue per channel** = `channel stock × SP` (channel-specific ASP would be better — currently we use the same SP everywhere, which is a known simplification)

Flipkart cells additionally show **Flipkart's listed selling price** from the inventory export (separate field, real number). The dashboard's `SP` is used for stock-value math; Flipkart's own number appears only in the Flipkart drill modal.

---

## 5. Channel Velocity Sources & Precedence

For every (SKU × channel) pair, velocity is resolved at module-init time in `src/data.js`. **First non-null wins**, top to bottom.

### 5.1 Amazon channel velocity

The Amazon channel by AMZ-001 convention = FBA orders + Shopify orders (Shopify ships through FBA).

| Priority | Source | Field | Window |
|---|---|---|---|
| 1 | Amazon "Manage Orders" 32-day report | `(fbaUnits + mcfUnits) / 32` | 32-day rolling avg |
| 2 | Nitin's "Daily Movement of FG" sheet | `byCode[code].channels.amazon.dailyOut` | 72-day rolling avg |
| 3 | Amazon "Warehouse Wise Ledger" | `totalShippedToday` | 1-day point estimate |
| 4 (stub) | `CHANNEL_MIX[code].amazon / 30` | hardcoded May-2026 unit total | stale 30-day |

### 5.2 Flipkart channel velocity

| Priority | Source | Field | Window |
|---|---|---|---|
| 1 | Flipkart "Current Inventory" CSV | `sales30d / 30` | 30-day rolling |
| 2 | Nitin's Daily Movement | `byCode[code].channels.flipkart.dailyOut` | 72-day rolling |
| 3 (stub) | `CHANNEL_MIX[code].flipkart / 30` | hardcoded | stale |

### 5.3 Blinkit channel velocity

| Priority | Source | Field | Window |
|---|---|---|---|
| 1 | Blinkit "Stock On Hand" Excel | sum(`byWh.sales30d`) / 30 | 30-day rolling |
| 2 | Nitin's Daily Movement | `byCode[code].channels.blinkit.dailyOut` | 72-day rolling |
| 3 (stub) | `CHANNEL_MIX[code].blinkit / 30` | hardcoded | stale |

### 5.4 Shopify (folded into Amazon channel)

| Priority | Source | Field | Window |
|---|---|---|---|
| 1 | Shopify "Website Sales of all SKUs" CSV | `sales30d / 30` | 30-day rolling |
| 2 | Nitin's Daily Movement | `byCode[code].channels.website.dailyOut` | 72-day rolling |
| 3 (stub) | `CHANNEL_MIX[code].shopify / 30` | hardcoded | stale |

### 5.5 Warehouse base velocity (offline + B2B + marketing)

Nitin's Daily Movement has dedicated `offline` + `marketing` columns the marketplace exports don't capture. Both feed the central WH base velocity:

```
whBaseVelocity = stubVel × max(0, 1 − stubChannelShare) + nitinOffline + nitinMarketing
```

### 5.6 Total SKU velocity

```
hasRealSignal = any of (amazon/flipkart/blinkit/shopify) has real data
sku.velocity  = hasRealSignal
                  ? channelTotalVel + whBaseVelocity
                  : stubVel
```

Rounded to 1 decimal place to avoid floating-point residual.

---

## 6. Stock Sources & Precedence

### 6.1 Central warehouse FG stock

| Priority | Source | Field |
|---|---|---|
| 1 | Uploaded Nitin's MIS via Upload modal | `multiFileStore.files.nitin.parsed.fg[code]` |
| 2 | Bundled Nitin snapshot (5-May-2026 audit) | `NITIN_DATA.warehouseInventory.fg[code]` |
| 3 (stub) | `SKU_OPERATIONS[code].fg` | hardcoded snapshot |

### 6.2 Amazon FBA stock

| Priority | Source | Field |
|---|---|---|
| 1 | Uploaded Amazon ledger | `multiFileStore.files["amazon-ledger"].parsed[code].totalSellable` |
| 2 | Bundled Amazon ledger (29-May-2026) | `REAL_MARKETPLACE_DATA[code].amazon.totalSellable` |
| 3 (stub) | derived from `CHANNEL_MIX` (7d cover heuristic) | — |

### 6.3 Flipkart stock

| Priority | Source | Field |
|---|---|---|
| 1 | Uploaded Flipkart CSV | `multiFileStore.files.flipkart.parsed[code].live` |
| 2 | Bundled Flipkart inventory | `REAL_MARKETPLACE_DATA[code].flipkart.live` |
| 3 (stub) | derived from `CHANNEL_MIX` (7d cover heuristic) | — |

### 6.4 Blinkit stock (sum across feeder WHs)

| Priority | Source | Field |
|---|---|---|
| 1 | Uploaded Blinkit Excel | `multiFileStore.files.blinkit.parsed[code].totalSellable` |
| 2 | Bundled Blinkit feeder-WH snapshot | `REAL_MARKETPLACE_DATA[code].blinkit.totalSellable` |
| 3 (stub) | derived from `CHANNEL_MIX` (7d cover heuristic) | — |

---

## 7. The Override / Overlay Order

The dashboard merges **3 layers** at module init (every page load):

```
┌────────────────────────────────────────────────────┐
│ Layer 3 — STUB                                     │
│ Hardcoded in src/data.js                           │
│ (SKU_OPERATIONS · CHANNEL_MIX · MOM_GROWTH · etc.) │
└────────────────────────────────────────────────────┘
                       ▲ overridden by
┌────────────────────────────────────────────────────┐
│ Layer 2 — BUNDLED REAL                             │
│ Auto-generated JSON committed to the repo          │
│ (src/realMarketplaceData.js · src/realNitinData.js)│
│ Regenerated by: scripts/import-marketplace-data.cjs│
│                 scripts/import-nitin-sheet.cjs     │
└────────────────────────────────────────────────────┘
                       ▲ overridden by
┌────────────────────────────────────────────────────┐
│ Layer 1 — UPLOADED                                 │
│ Per-user multi-file payload in localStorage        │
│ (ns.multiFileUpload key, set by UploadModal)       │
│ Survives reloads; cleared via "Clear all" button   │
└────────────────────────────────────────────────────┘
```

`src/data.js` uses a Proxy on `REAL_MARKETPLACE_DATA` so each SKU's per-channel slice resolves bottom-up: uploaded wins, else bundled, else null (which then falls back to stub-derived numbers in the consuming code).

---

## 8. Formulas

### 8.1 Per-channel velocity (display-side in `PageInventory.jsx`)

```
amazonOwnVel  = s.velocity × (splits.amazon  / Σ splits)
shopifyOwnVel = s.velocity × (splits.shopify / Σ splits)
flipkartVel   = s.velocity × (splits.flipkart / Σ splits)
blinkitVel    = s.velocity × (splits.blinkit  / Σ splits)

cellDisplay   = {
  amazonFBA: amazonOwnVel + shopifyOwnVel,   // AMZ-001 folds Shopify in
  flipkart:  flipkartVel,
  blinkit:   blinkitVel,
  warehouse: s.velocity,   // display only: "if WH had to supply everything alone"
}
```

All four are rounded to 1 dp before display.

### 8.2 Per-SKU MoM growth

```
if real Shopify data present:
  cur30  = real.shopify.sales30d
  prev30 = real.shopify.sales60d − cur30
  growth = (cur30 − prev30) / prev30 × 100
  growth = clamp(growth, −100, +200)        // 200% cap when prev was near zero
else:
  growth = MOM_GROWTH[code]                 // stub fallback
```

### 8.3 Required units & reorder qty (Forecast tab)

```
forecast   = velocity × forecastDays × trend
targetDays = readTargetDays(skuCode)         // per-SKU, default 30, user-editable
required   = velocity × (forecastDays + targetDays) × trend
reorder    = max(0, required − maxFg)        // maxFg = currentFG + producibleFG
```

`targetDays` is the per-SKU "desired stock cover" — settable from the SkuBreakdownModal, persisted in localStorage at key `ns.targetDays.<skuCode>`.

### 8.4 Per-row runway

```
runway = round(totalStock / sku.velocity)
totalStock = stock.warehouse + stock.amazonFBA + stock.flipkart + stock.blinkit
status: vel ≤ 0          → amber
        runway ≤ leadTime → red
        runway < 30       → amber
        else              → green
```

### 8.5 Cascade total runway (Runway tab)

The truer model — marketplaces drain at their own rates; as each empties, its demand falls back to the central WH. Total runway = the day the WH itself hits zero.

Implemented in `src/lib/runwayCascade.js` → `computeCascade({ whStock, whBaseVelocity, channels: [{stock, velocity}…] })`. Returns the day at which all stock is gone, ordered phases, and per-channel zero-out days. Used as the headline runway number in the Runway calculator tab.

### 8.6 Blinkit feeder-WH classification

For each feeder WH with stock `s` and per-WH 30-day sales `sales30d`:

```
perWhVel = sales30d / 30
red      = stock ≤ 0
amber    = (perWhVel > 0 AND stock / perWhVel ≤ 14d) OR (stock ≤ amberThreshold)
healthy  = neither

amberThreshold = readBlkThreshold(skuCode)   // per-SKU, default 25 units, user-editable
```

`amberThreshold` is editable from the Blinkit drill modal; persisted at `ns.blkAmberThreshold.<skuCode>` (BLK-005).

---

## 9. Marketplace Warehouse Maps

### 9.1 Amazon Fulfillment Centers

Per-FC display metadata used in the Amazon drill modal (and as a city-grouping for cluster-level reporting).

| FC code | Name | City |
|---|---|---|
| `BOM5` | Bhiwandi (BOM5) | Mumbai |
| `BOM7` | Bhiwandi (BOM7) | Mumbai |
| `CCX1` | Bhiwandi (CCX1) | Mumbai |
| `CCX2` | Bhiwandi (CCX2) | Mumbai |
| `CJB1` | Coimbatore | Coimbatore |
| `DED3` | Delhi East 3 | Delhi NCR |
| `DED4` | Delhi East 4 | Delhi NCR |
| `DEL4` | Delhi NCR 4 | Delhi NCR |
| `DEL5` | Delhi NCR 5 | Delhi NCR |
| `MAA4` | Chennai | Chennai |
| `PNQ3` | Pune | Pune |

Source: `src/pages/PageInventory.jsx` → `AMZ_FC_META`. New FCs in future ledgers fall through to a sensible default (`{ name: code, city: "—" }`).

### 9.2 Blinkit Feeder Warehouses (13 active)

| Long name (as it appears in Blinkit export) | Short label | City |
|---|---|---|
| `Noida N1 - Feeder` | Noida N1 | Delhi NCR |
| `Faridabad - Feeder` | Faridabad | Delhi NCR |
| `Kundli Feeder` | Kundli | Delhi NCR |
| `Mumbai M10 - Feeder` | Mumbai M10 | Mumbai |
| `Bengaluru B3` | Bengaluru B3 | Bangalore |
| `Bengaluru B5 - Feeder` | Bengaluru B5 | Bangalore |
| `Hyderabad H3 - Feeder` | Hyderabad H3 | Hyderabad |
| `Kolkata K6 - Feeder Warehouse` | Kolkata K6 | Kolkata |
| `Pune P3 - Feeder Warehouse` | Pune P3 | Pune |
| `Chennai C5 - Feeder` | Chennai C5 | Chennai |
| `Ahmedabad A2 - Feeder` | Ahmedabad A2 | Ahmedabad |
| `Jaipur J3 - Feeder` | Jaipur J3 | Jaipur |
| `Lucknow L4` | Lucknow L4 | Lucknow |

Source: `src/data.js` → `BLINKIT_FEEDER_WH_MAP`. The long-name keys must match Blinkit's export verbatim — if Blinkit renames a WH ("Pune P3 - Feeder" vs "Pune P3 Warehouse"), the parser silently drops that WH's stock and the cell undercounts.

### 9.3 Flipkart

Single warehouse: `gur_san_wh_nl_01nl` (Gurgaon Sandila NL). No per-WH disambiguation needed — every Flipkart SKU's stock lives at this one location. The drill modal therefore shows velocity-trend + reserved breakdown instead of OOS-per-WH.

---

## 10. How to Spot a Mismap

### 10.1 Run the diagnostic locally

```bash
node scripts/import-marketplace-data.cjs   # logs unmapped MSKUs, FK SKUs, Shopify SKUs, Blinkit titles
node scripts/import-nitin-sheet.cjs        # logs unmapped Nitin sheet line items
```

Output prints `unmapped <Sku ID / line name>` for every row the matcher couldn't classify. If a real-world SKU disappears from the dashboard, look for it here first.

### 10.2 Common breakage patterns

| Symptom | Most likely cause | Where to investigate |
|---|---|---|
| A SKU appears with 0 stock everywhere but you know there's stock | Marketplace renamed its SKU and `CODE_MAP` is out of date | `scripts/import-marketplace-data.cjs` + `src/lib/uploadParsers.js` `CODE_MAP` |
| Velocity dropped to near-zero overnight | A real-data source went null and stub took over | Open the SKU drill modal — look at `velocitySource` (real / stub per channel) |
| Blinkit cell shows fewer feeder WHs than expected | Blinkit changed a WH long-name | `src/data.js` `BLINKIT_FEEDER_WH_MAP` keys must match the export verbatim |
| New Nitin tab/column missing | Sheet structure changed | `scripts/import-nitin-sheet.cjs` parsers + `parseInventoryFile.js` for the upload flow |
| Producible FG = 0 but inputs are stocked | A PKG `refCode` doesn't match `ITEM_QTY` key | `src/data.js` `ITEM_QTY` keys vs `SKU_RECIPE` refCodes — typo check |
| Forecast reorder qty looks wildly off | Target days set inadvertently in localStorage | DevTools → Application → Local Storage → search `ns.targetDays.` keys |
| AI anomaly check shows nothing | `ANTHROPIC_API_KEY` not set in Vercel env, or endpoint unreachable | Vercel project settings → Environment Variables; `/api/claude-validate` should return `{ skipped: true }` otherwise |

### 10.3 Sanity check via the AI layer

The upload modal's Claude integration is the easiest way to catch silent mismaps. After every successful parse, it sends condensed before/after summaries to Claude with the prompt *"flag SKU-level anomalies that look like data-entry errors or import bugs"*. A 5×-or-more change in any metric, a non-zero metric going to zero, or a SKU disappearing entirely will surface as an inline warning in the upload modal.

---

## 11. File index

Every mapping touches one of these files. Bookmark this section.

| File | What it owns |
|---|---|
| `src/data.js` | `skus`, `SKU_OPERATIONS`, `SKU_RECIPE`, `ITEM_QTY`, `CHANNEL_MIX`, `MOM_GROWTH`, `SKU_PRICING`, `SKU_PRICE`, `MARKETPLACE_NAMES`, `COMPONENT_LEAD_TIMES`, `BLINKIT_FEEDER_WH_MAP` |
| `scripts/import-marketplace-data.cjs` | `CODE_MAP`, `byAmzMsku`, `byFkSku`, `byShpSku`, `blkMatches` (server-side) |
| `src/lib/uploadParsers.js` | `CODE_MAP` (client-side mirror) + all 6 parsers |
| `src/lib/parseInventoryFile.js` | `ITEM_MAP`, `SKIP_KEYWORDS` (browser parser for Nitin's MIS) |
| `scripts/import-nitin-sheet.cjs` | `SKU_MATCHERS`, `COMPONENT_MATCHERS` |
| `src/pages/PageInventory.jsx` | `AMZ_FC_META`, `MP_INBOUND_LEAD_DEFAULT`, all rendering + Simulator + drill modals |
| `src/lib/runwayCascade.js` | `computeCascade()` — parallel-cascade runway math |
| `src/lib/skuTargets.js` | per-SKU target-days-of-cover localStorage helpers |
| `src/lib/multiFileStore.js` | uploaded-payload localStorage + `buildRealMarketplaceOverride`, `buildNitinOverride` |
| `api/claude-validate.js` | Vercel serverless function for AI assists |

---

## 12. Snapshot dates

| Source | Date |
|---|---|
| `REAL_MARKETPLACE_DATA` (Amazon ledger, Blinkit, Flipkart) | 29-30 May 2026 |
| `REAL_MARKETPLACE_DATA.amazon.orders` (32-day FBA + MCF orders) | 01 May → 01 Jun 2026 |
| `NITIN_DATA.warehouseInventory` (central WH FG/SFG/RM/PKG counts) | 05 May 2026 (audit) |
| `NITIN_DATA.dailyMovement` (per-day per-channel sales log) | 09 Mar → 01 Jun 2026 (72 days) |
| `SKU_PRICING` (SP + MRP) | 01 Jun 2026 |
| `COMPONENT_LEAD_TIMES` (supplier lead times) | 31 May 2026 |
| `MP_INBOUND_LEAD_DEFAULT` (Amazon/FK/Blinkit inbound days) | 31 May 2026 |

Stale snapshots get refreshed by:
1. Dropping new files into `~/Downloads/` with the standard filenames
2. Running `node scripts/import-marketplace-data.cjs` (regenerates `src/realMarketplaceData.js`)
3. Running `node scripts/import-nitin-sheet.cjs` (regenerates `src/realNitinData.js`)
4. Committing + pushing — Vercel auto-deploys

OR end-users can drop files directly into the Upload modal (no commit needed; localStorage overlay handles it).

---

*End of mapping reference. If a number on the dashboard doesn't match expectations, walk the layers top-down (§ 7), check the source-precedence chain for that metric (§ 5/6), and confirm the SKU identity hop is correct in § 1.1.*
