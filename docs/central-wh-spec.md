# BUILD SPEC — Naturesum central-warehouse inventory + runway engine

You are building a Python tool that turns three messy Excel sheets + a fixed Bill-of-Materials
into a live inventory and runway model for a D2C wellness brand. Read this WHOLE spec before
writing code. Do not infer or guess anything that is written here — it is written here on purpose.
When a value is not derivable, FAIL LOUDLY (print it to a report), never silently drop or coerce.

---

## 0. GOAL

From one workbook (`Naturesum_Live_Inventory.xlsx`) produce, **as of the latest data date**:

1. Current central-warehouse stock for every **finished good (FG)** and every **component**
   (raw material `RM`, semi-finished `SFG`, packaging `PKG`).
2. Per-SKU: produced FG on hand, "producible" (how many more we can pack from current
   components), total available, sales velocity, runway (days of cover), supplier lead time,
   reorder flag, FG stock value, month-over-month growth.
3. Per-component: warehouse stock, consumption rate, days of cover, lead time, reorder flag,
   and which SKUs it blocks.
4. A validation/reconciliation report (unmapped names, unparsed quantities, negative balances).

Output = one Excel workbook (multiple tabs) **and** one JSON file (for an app to consume).

---

## 1. INPUTS

### 1a. The workbook (5 sheets)
- `Audit 050525` — PHYSICAL STOCK COUNT of the central warehouse on **2026-05-05**. This is the
  ANCHOR / opening balance for EVERYTHING (FG + SFG + RM + PKG). Four sections in column B,
  each introduced by a section header row (col A text contains "FINISHED", "SEMI", "RAW", "PACKAG").
  Columns: A = "#n" or section header, B = item description (free text), C = quantity, D = unit.
- `Production` — WIDE MATRIX. Row 1 = header: cell A1 = "Item Name", cells B1..onward = production
  DATES (real Excel dates). Rows 2..16 = one FG item per row (col A = free-text name), each dated
  column = units PACKED that day. Empty cell = 0 produced. NOTE: the last row(s) may be an SFG
  (e.g. "Acacia Tea Pouches(Green, Filled)") — treat any row whose name maps to an SFG code as
  SFG production (adds SFG stock), not FG.
- `Daily Movement of FG` — VERTICALLY STACKED daily blocks. Each block = exactly 16 rows:
  - row +0: col A = "On D-M-YY" (date header, free text e.g. "On 9-3-26" or "On 30-05-26");
    col B = "Stock Out"; col H = "Stock In (Orders and FBA Return)".
  - row +1: column header row → A="Item Name", B..G = Stock-Out channels
    [Amazon, Flipkart, Blinkit, Website, Offline, Marketing], H..M = Stock-In channels (same 6).
  - rows +2..+15: one FG item per row; B..G = units shipped OUT to each channel; H..M = units
    coming IN (returns) from each channel. Blank = 0.
  - The next block starts 16 rows later. Detect blocks by scanning col A for strings starting
    with "on " (case-insensitive). Do NOT assume a fixed block count; there are ~73 blocks
    spanning 2026-03-09 .. 2026-06-02. Parse the date from the "On ..." text (formats vary:
    "9-3-26", "30-05-26", "01-06-26" → all DD-M(M)-YY).
- `Master` — OLD snapshot (7 March). IGNORE for calculations (superseded by the audit).
- ` warehouse inventory` — note the LEADING SPACE in the sheet name. A partial/in-progress recount
  (~9 May), only ~20 rows filled. Treat as OPTIONAL secondary; do NOT use as the anchor. (You may
  later use it as a reconciliation check, but the primary anchor is `Audit 050525`.)

### 1b. Bill of Materials + lead times (FIXED — hard-code these; do not read from a sheet)
`perPack` = quantity of the component consumed to pack ONE finished unit of the SKU.

Lead-time buckets (days): SB raw materials = 50, Moringa Leaves Powder = 30, filled SFG = 20,
all PKG = 14. **SKU lead time = MAX lead time over the components in its BOM.**

---

## 2. CANONICAL REFERENCE DATA — HARD-CODE EXACTLY AS BELOW

### 2a. Finished-good SKUs (`code, name, variant, selling_price_INR, sku_lead_days`)
```
NSMP100,  Moringa Powder,            100 g,  265,  30
NSMP250,  Moringa Powder,            250 g,  495,  30
NSSB100,  Sea Buckthorn Powder,      100 g,  450,  50
NSSB250,  Sea Buckthorn Powder,      250 g,  750,  50
NSSB500,  Sea Buckthorn Powder,      500 g, 1350,  50
NSSBDB100, Sea Buckthorn Dry Berry,  100 g,  390,  50
NSSBDB250, Sea Buckthorn Dry Berry,  250 g,  690,  50
NSSBDB500, Sea Buckthorn Dry Berry,  500 g, 1150,  50
NSSBJ300, Sea Buckthorn Juice,       300 ml, 690,  50
NSSBJ500, Sea Buckthorn Juice,       500 ml,1100,  50
NSSBBO15, Sea Buckthorn Face Oil,    15 ml, 1075,  50
NSSBBO30, Sea Buckthorn Face Oil,    30 ml, 1580,  50
NSJO100,  Rosemary & Jatamansi Hair Oil, 100 ml, 1350, 20
NSACDT30, Acacia Catechu Diabetes Care Tea, 30 sachets, 975, 20
```
(There is also a NSSB500 "(Old)" packed variant in the audit. DEFAULT: fold its quantity into
NSSB500 and emit a note. Make this a one-line config flag `MERGE_OLD_SB500 = True`.)

### 2b. Components (`refcode, name, type, lead_days`)
```
NSMLPR,      Moringa Leaves Powder,            RM,  30
NSSBPR,      SB Powder (Raw),                  RM,  50
NSSBDBR,     SB Dry Berries (Raw),             RM,  50
NSSBJPLP,    SB Juice Pulp,                    RM,  50
NSSBOR,      SB Face Oil (Raw),                RM,  50
NSJOF100,    Jatamansi Hair Oil Filled Bottle, SFG, 20
NSACDSF30,   AC Tea Dip Sachets (Filled),      SFG, 20
NSPKGMP100,  Moringa Powder Empty Pouch 100g,  PKG, 14
NSPKGMP250,  Moringa Powder Empty Pouch 250g,  PKG, 14
NSPKGCB100,  100g Carton Box,                  PKG, 14
NSPKGCB250,  250g Carton Box,                  PKG, 14
NSPKGSBP100, SB Powder Empty Pouch 100g,       PKG, 14
NSPKGSBP250, SB Powder Empty Pouch 250g,       PKG, 14
NSPKGSBP500, SB Powder Empty Pouch 500g,       PKG, 14
NSPKGDBP100, Dry Berries Empty Pouch 100g,     PKG, 14
NSPKGDBP250, Dry Berries Empty Pouch 250g,     PKG, 14
NSPKGDBP500, Dry Berries Empty Pouch 500g,     PKG, 14
NSPKGJBOT300, Juice Bottle 300 ml,             PKG, 14
NSPKGJB300,  Small Air Pouch 300 ml,           PKG, 14
NSPKGJTUB300, Juice Tube 300 ml,               PKG, 14
NSPKGJLBL300, Juice Label 300 ml,              PKG, 14
NSPKGJBOT500, Juice Bottle 500 ml,             PKG, 14
NSPKGJB500,  Large Air Pouch 500 ml,           PKG, 14
NSPKGJTUB500, Juice Tube 500 ml,               PKG, 14
NSPKGJLBL500, Juice Label 500 ml,              PKG, 14
NSPKGBOBT15, SB Oil Bottle 15 ml,              PKG, 14
NSPKGBOB15,  SB Faceoil Empty Box 15 ml,       PKG, 14
NSPKGBOBT30, SB Oil Bottle 30 ml,              PKG, 14
NSPKGBOB30,  SB Faceoil Empty Box 30 ml,       PKG, 14
NSPKGBOCAP,  Bottle Cap,                       PKG, 14
NSPKGBODROP, Dropper,                          PKG, 14
NSPKGJOB100, Jatamansi Empty Box (with print), PKG, 14
NSPKGACTC30, Acacia Tea Bag Empty Pouch (green),PKG, 14
NSPKGACTCBOX, Acacia Tea Empty Outer Box,      PKG, 14
```

### 2c. BOM (`sku_code -> list of (refcode, perPack)`)
```
NSMP100  : NSMLPR 0.10,  NSPKGMP100 1, NSPKGCB100 1
NSMP250  : NSMLPR 0.25,  NSPKGMP250 1, NSPKGCB250 1
NSSB100  : NSSBPR 0.10,  NSPKGSBP100 1
NSSB250  : NSSBPR 0.25,  NSPKGSBP250 1
NSSB500  : NSSBPR 0.50,  NSPKGSBP500 1
NSSBDB100: NSSBDBR 0.10, NSPKGDBP100 1
NSSBDB250: NSSBDBR 0.25, NSPKGDBP250 1
NSSBDB500: NSSBDBR 0.50, NSPKGDBP500 1
NSSBJ300 : NSSBJPLP 0.30, NSPKGJBOT300 1, NSPKGJB300 1, NSPKGJTUB300 1, NSPKGJLBL300 1
NSSBJ500 : NSSBJPLP 0.50, NSPKGJBOT500 1, NSPKGJB500 1, NSPKGJTUB500 1, NSPKGJLBL500 1
NSSBBO15 : NSSBOR 0.015, NSPKGBOBT15 1, NSPKGBOB15 1, NSPKGBOCAP 1, NSPKGBODROP 1
NSSBBO30 : NSSBOR 0.030, NSPKGBOBT30 1, NSPKGBOB30 1, NSPKGBOCAP 1, NSPKGBODROP 1
NSJO100  : NSJOF100 1,   NSPKGJOB100 1
NSACDT30 : NSACDSF30 30, NSPKGACTC30 30, NSPKGACTCBOX 1
```

### 2d. NAME → CODE alias maps (the single most important part)
The three data sheets use DIFFERENT free-text names than the codes. Build a normaliser, then match
against the alias tables. Normaliser: lowercase; strip; collapse all runs of whitespace to one
space; remove the characters `.()` and the words "pure","packed","gm","gram","grams". Match on the
normalised string. If a normalised name is NOT in the map → add it to `unmapped_names` report and
SKIP that row (never guess).

**FG aliases (used by `Daily Movement` and `Production` item rows) → SKU code.** Add every variant:
```
"jatamansi & rosemary hair oil - 100 ml"          -> NSJO100
"jatamansi hair oil 100 ml"                        -> NSJO100
"sea buckthorn berry oil 15 ml"                    -> NSSBBO15
"sb face oil 15 ml"                                -> NSSBBO15
"sea buckthorn berry oil 30 ml"                    -> NSSBBO30
"sb face oil 30 ml"                                -> NSSBBO30
"pure sea buckthorn dry berries 500 gm"            -> NSSBDB500
"sb berries 500 gm"                                -> NSSBDB500
"pure sea buckthorn dry berries 250 gm"            -> NSSBDB250
"sb berries 250 gm"                                -> NSSBDB250
"pure sea buckthorn dry berries 100 gm"            -> NSSBDB100
"sb berries 100 gm"                                -> NSSBDB100
"pure sea buckthorn berries powder 500 gm"         -> NSSB500
"sb powder 500 gm"                                 -> NSSB500
"sb powder 500 gm (old)"                           -> NSSB500   # see MERGE_OLD_SB500
"pure sea buckthorn berries powder 250 gm"         -> NSSB250
"sb powder 250 gm"                                 -> NSSB250
"pure sea buckthorn berries powder 100 gm"         -> NSSB100   # note source has "Powder100 GM" (no space) – normaliser must still land here
"sb powder 100 gm"                                 -> NSSB100
"acacia catechu - 30 tea bags"                     -> NSACDT30
"ac tea (30 tea bags)"                             -> NSACDT30
"pure sea buckthorn berries juice 300ml"           -> NSSBJ300
"pure sea buckthorn berries juice 500ml"           -> NSSBJ500
"moringa powder 250g"                              -> NSMP250
"moringa powder 100g"                              -> NSMP100
```
**SFG row that appears inside the Production sheet:**
```
"acacia tea pouches (green, filled)"               -> NSACDSF30   # SFG production, +SFG stock
"jatamansi hair oil filled bottles (bo)"           -> NSJOF100
```

**Component aliases (used by the `Audit` SFG/RM/PKG sections) → refcode.** These are the audit's
own wording. Map only the ones below; everything else in the audit (machines, laptop, AC unit,
tables, chairs, printers, scanner, drums, MRP stickers, plastic seal, carpets, foam, air-wrap,
disposable caps, tea-bag roll, blank hair-oil box, etc.) is NON-BOM — push to `unmapped_components`
and EXCLUDE from runway. Do not treat equipment as inventory.
```
# RM
"sb powder (raw)"                          -> NSSBPR
"sb juice pulp"                            -> NSSBJPLP
"sb dry berries (raw)"                     -> NSSBDBR
"moringa leaves powder"                    -> NSMLPR
"sb oil"                                   -> NSSBOR     # RM section row; the SFG "SB Oil (5 cann)" is the same raw, treat as NSSBOR too
# SFG
"jatamansi hair oil filled bottles (bo)"   -> NSJOF100
"ac tea dip sachets (filled)"              -> NSACDSF30
# PKG
"100 gm packaging carton box (empty) - powder" -> NSPKGCB100
"250 gm packaging carton box (empty) - powder" -> NSPKGCB250
"100 gram pouch - berry"                   -> NSPKGDBP100
"250 gram pouch - berry"                   -> NSPKGDBP250
"500 gram pouch - berry"                   -> NSPKGDBP500
"sb faceoil empty box 15ml (box)"          -> NSPKGBOB15
"sb faceoil empty box 30ml (box)"          -> NSPKGBOB30
"acacia catechu tea box (30 packs)"        -> NSPKGACTCBOX
"acacia catechu tea bag pouch"             -> NSPKGACTC30
"sb face oil bottle caps"                  -> NSPKGBOCAP
"sb faceoil droppers"                      -> NSPKGBODROP
"moringa powder pouches 100gm"             -> NSPKGMP100
"moringa powder pouches 250gm"             -> NSPKGMP250
"sb oil empty bottles uncapped with logo (15 ml)" -> NSPKGBOBT15
"sb face oil empty bottle (30 ml)"         -> NSPKGBOBT30
"jatamasi empty box with print"            -> NSPKGJOB100
"sb powder empty pouches (500 gram)"       -> NSPKGSBP500
"sb powder empty pouches (250 gram)"       -> NSPKGSBP250
"sb powder empty pouches (100 gram)"       -> NSPKGSBP100
"juice containers (package) 300ml"         -> NSPKGJBOT300   # BEST-GUESS, flag for confirmation
"juice containers (package) 500ml"         -> NSPKGJBOT500   # BEST-GUESS, flag for confirmation
"large air pouch for juice (500 ml)"       -> NSPKGJB500     # BEST-GUESS
```
**KNOWN UNRESOLVED (emit as `bom_gaps` warnings, do NOT crash):**
- Juice `NSPKGJB300` (small air pouch 300), `NSPKGJTUB300/500` (tubes), `NSPKGJLBL300/500`
  (labels): no clean audit line. The audit splits juice glass bottles into "with/without wrap"
  (an intermediate SFG step) and lists generic "Juice air wrap" / "Juice containers". Set these
  components' audit stock to 0 and flag — the founder must confirm the real juice packaging map.
- Dry-berry and SB-powder CARTON BOXES exist in the audit (berry 100/250/500 boxes, powder 500
  box) but the simplified BOM does not consume them. Either the BOM is missing a carton for those
  lines or those boxes are unused. Flag, don't auto-add.

---

## 3. PARSING — STEP BY STEP

### 3a. Build the canonical reference (section 2) as DataFrames / dicts in code.

### 3b. Parse `Audit 050525` → opening balances
- Walk rows. Track current section from header rows (col A contains FINISH/SEMI/RAW/PACKAG).
- For each item row: name = col B, raw_qty = col C, unit = col D.
- Clean qty (see §4). Map name→refcode (components) or name→SKU (the FG section).
  - FG section rows map to SKU codes; their qty = opening FG warehouse stock.
  - SFG/RM/PKG rows map to refcodes; their qty = opening component stock.
- Unmapped → report; mapped duplicates (e.g. two SB500 lines incl. "(Old)") → SUM into the code.

### 3c. Parse `Production` → FG-in events (and SFG-in for the SFG row)
- Read date columns from row 1 (cols ≥ B that contain a real date).
- For each item row (2..last non-empty), map name→code. For each dated column with a numeric value
  > 0, emit a transaction: `(date, code, qty, type='produce')`.
- If the mapped code is an SFG (NSJOF100 / NSACDSF30): type='produce_sfg' (adds SFG stock; does
  NOT add FG and does NOT consume the SFG itself).
- For each FG production event of `sku` with qty `q`, ALSO emit component-consumption transactions:
  for every `(refcode, perPack)` in BOM[sku]: `(date, refcode, qty = q*perPack, type='consume')`.

### 3d. Parse `Daily Movement of FG` → stock-out and stock-in events
- Find block headers (col A startswith "on "). For each block: parse the date; the item rows are
  the 14 rows starting 2 rows below the header (skip the column-header row).
- For each item row: map name→SKU. Stock-Out total = sum(cols B..G). Stock-In total = sum(H..M).
  Also keep per-channel splits (you need them for the by-channel view and to exclude "Marketing").
  - Emit `(date, sku, qty=out_total, type='ship_out', channel breakdown kept)`.
  - Emit `(date, sku, qty=in_total,  type='return_in', channel breakdown kept)`.
- Channel index: Stock-Out → [Amazon, Flipkart, Blinkit, Website, Offline, Marketing] = cols B,C,D,E,F,G.
  Stock-In (returns) → same channel order = cols H,I,J,K,L,M.

### 3e. Assemble ONE tidy transaction ledger (long format), columns:
`date, item_code, item_type(FG/RM/SFG/PKG), txn_type(audit_open/produce/produce_sfg/consume/ship_out/return_in), channel(or blank), qty(signed per §5)`.

---

## 4. CLEANING RULES FOR MESSY QUANTITIES (audit col C)
Apply in this order; if none yields a number, set qty=0 and add to `unparsed_quantities`:
- Real number → use as-is.
- "NA" / "" / None → 0, and tag the item `not_counted=True` (do NOT treat 0 as confirmed zero stock).
- Pattern `A + B` (e.g. "20 + 2000") → SUM the parts (=2020). Tag `was_compound=True`.
- Pattern `A-B` where it's a RANGE/notes (e.g. "36-50", "206-100") → AMBIGUOUS. Default rule:
  take the FIRST number as the confirmed count (36, 206) and record the raw string in a
  `qty_note` column; add to `manual_review`. Do NOT subtract. (Founder convention is usually
  "packed count - loose/other"; first number = packed/usable. Make this a config:
  `RANGE_RULE = 'first'`.)
- Strip trailing units/words ("pcs","kg","ltr","roll","sheet","packs","pc") before parsing.
Keep the ORIGINAL string in `qty_raw` for every row, always.

---

## 5. INVENTORY MODEL — THE MATH (read carefully)

`ANCHOR_DATE = 2026-05-05` (the audit date). `AS_OF = max date across Production + Daily Movement`.

### 5a. Sign convention for the ledger
- audit_open: +qty (opening balance, dated ANCHOR_DATE)
- produce / produce_sfg: +qty (adds FG or SFG)
- consume: −qty (components used by production)
- ship_out: −qty (FG leaves warehouse)
- return_in: +qty (FG comes back)

### 5b. **CRITICAL ROLL-FORWARD RULE**
Current warehouse stock = opening balance (audit) **plus only the transactions dated STRICTLY
AFTER `ANCHOR_DATE`**. Transactions on/before the audit date must NOT be added to the balance —
the physical audit already reflects them. (Convention: audit counted end-of-day 5 May, so 5 May
production/movement is already in the audit → exclude `date <= ANCHOR_DATE` from the balance sum.)
Pre-anchor transactions are used ONLY for velocity history (§6), never for the stock balance.

So for every item code:
```
stock(code) = audit_open(code)
            + Σ produce/produce_sfg(code, date > ANCHOR_DATE)
            - Σ consume(code,        date > ANCHOR_DATE)
            - Σ ship_out(code,       date > ANCHOR_DATE)
            + Σ return_in(code,      date > ANCHOR_DATE)
```
(FG codes get produce/ship_out/return_in; component codes get consume; SFG codes get produce_sfg
as +, and also consume as − when an FG that uses them is produced.)

If any `stock(code) < 0` → DO NOT clamp silently. Set the value, FLAG it in `negative_stock`
(it means a mapping miss, a missing audit line, or production logged without enough recorded
input). Surface prominently.

---

## 6. VELOCITY, RUNWAY, PRODUCIBLE, REORDER, VALUE, GROWTH

Use a trailing window ending at `AS_OF`. Compute for windows W=30 and W=60 days (report both).

### 6a. FG velocity (per SKU), from `Daily Movement`
- `gross_out(sku,W)` = Σ ship_out over last W days (all 6 channels).
- `returns(sku,W)`   = Σ return_in over last W days.
- `marketing_out(sku,W)` = Σ ship_out Marketing channel only.
- **sales_velocity** = (gross_out − marketing_out − returns) / W   → commercial demand/day.
- **depletion_velocity** = (gross_out − returns) / W               → how fast WH FG actually drains
  (includes marketing giveaways; use THIS for FG runway).
- If a window has zero movement, velocity = 0 → runway = ∞ (report as blank / "no sales").

### 6b. FG runway (per SKU)
`fg_runway_days = FG_WH_stock / depletion_velocity(W=30)` (∞ if velocity 0).

### 6c. Producible & total available (per SKU) — matches the app modal
```
producible(sku) = min over (refcode,perPack) in BOM[sku] of floor( component_stock(refcode) / perPack )
total_available(sku) = FG_WH_stock(sku) + producible(sku)
binding_component(sku) = the refcode that achieves that min   # what's blocking more production
```
Example to verify against the screenshot — NSMP100 (Moringa 100g): FG_WH=201, NSMLPR=200 KG
(→ 200/0.10=2000), NSPKGMP100=0 (→ 0), NSPKGCB100=950 (→ 950). producible = min(2000,0,950) = 0,
binding = NSPKGMP100. total_available = 201. FG stock value = 201 × 265 = ₹53,265.

### 6d. Component metrics (per refcode)
- `consumption_velocity(refcode,W=30)` = Σ over SKUs using it of `sales_velocity(sku,30) * perPack`.
  (Tie component burn to actual demand, not just past production.)
- `component_days_cover = component_stock / consumption_velocity` (∞ if 0).
- `reorder_component = component_days_cover < lead_days(refcode)`.
- `blocks_skus(refcode)` = list of SKUs whose `binding_component == refcode` OR whose
  `component_days_cover < sku_lead` because of this component.

### 6e. SKU reorder flag
`reorder_sku = fg_runway_days < sku_lead_days` (i.e. FG will run out before a replenishment lands).
Also surface `worst_component_cover(sku)` = min component_days_cover across its BOM, and flag if
that is below the component's lead time (you can't even pack more in time).

### 6f. FG stock value = `FG_WH_stock(sku) * selling_price(sku)`. Report total too.

### 6g. MoM growth (per SKU)
`mom_growth = sales_units(this 30d) / sales_units(prior 30d) - 1` (this 30d = AS_OF-29..AS_OF;
prior = AS_OF-59..AS_OF-30). Blank if prior = 0.

---

## 7. BY-CHANNEL / MARKETPLACE (scope note — implement the hooks, leave inputs pluggable)
These three sheets give ONLY: central-warehouse FG, component stock, and the OUTBOUND flow per
channel. They do NOT give marketplace on-hand (units sitting at Amazon FBA / Flipkart / Blinkit).
- Build the per-SKU "by channel" table with: `central_wh_fg` (computed here) and placeholder
  columns `amazon_fba`, `flipkart`, `blinkit`, `in_transit` that default to 0 / "n/a" and can be
  filled later from the marketplace inventory exports (separate files). Do NOT fabricate these.
- "In transit" (future) = cumulative ship_out to a channel minus what that channel reports received.

---

## 8. OUTPUTS

### 8a. Excel workbook `Naturesum_Inventory_Engine.xlsx` (Arial; one accent colour #2F5D3A; clean):
1. `README` — what each tab is, the anchor-date rule, and the data-quality flags summary.
2. `FG Dashboard` — one row per SKU: code, name, variant, FG_WH, producible, total_available,
   binding_component, sales_velocity_30, depletion_velocity_30, fg_runway_days, sku_lead_days,
   reorder_sku (Yes/No), worst_component_cover, fg_stock_value, mom_growth.
3. `Component Dashboard` — one row per refcode: code, name, type, stock, unit, consumption_velocity_30,
   days_cover, lead_days, reorder_component (Yes/No), blocks_skus.
4. `Ledger` — the full tidy transaction list (§3e) so every number is auditable.
5. `Velocity` — per SKU per channel: out_30, out_60, returns_30, marketing_30, sales_vel, depletion_vel.
6. `Data Quality` — four blocks: unmapped_names, unmapped_components, unparsed_quantities/manual_review,
   negative_stock, bom_gaps. If any block is non-empty, make the README say "REVIEW REQUIRED".
- Use Excel FORMULAS for the derived columns where reasonable (stock_value = units*price,
  runway = stock/velocity with IFERROR for /0), referencing a hidden `calc` area or the Ledger,
  so the file stays auditable. Hard-coded values are acceptable only for parsed source data.
- After writing, RECALCULATE the workbook and assert zero formula errors before finishing.

### 8b. JSON `naturesum_inventory.json` — same FG + component dashboards as arrays of objects
(for an app/dashboard to render the modal in the screenshot). Include `as_of`, `anchor_date`,
and a `flags` object with counts from the Data Quality tab.

---

## 9. TECH CONSTRAINTS / NON-NEGOTIABLES
- Python 3 + `pandas` + `openpyxl`. Read the xlsx with `data_only=True`.
- Put ALL the §2 reference data in a single clearly-commented `reference.py` (or a top config block)
  so the founder can edit BOM / prices / lead times / aliases without touching logic.
- Normalisation + alias lookup must be ONE function used everywhere. Never hard-match raw strings.
- NEVER silently drop a row or coerce a bad number — everything unhandled goes to a Data-Quality
  bucket and gets printed at the end as a summary ("X unmapped names, Y unparsed qtys, Z negatives").
- Dates: parse the "On D-M-YY" text robustly (day-first, 2-digit year → 2026). Production header
  dates are already real dates.
- Make `ANCHOR_DATE`, `AS_OF` (default = max data date, overridable), `W` windows,
  `MERGE_OLD_SB500`, and `RANGE_RULE` config constants at the top.
- Code structure: `reference.py`, `parse.py` (sheets→ledger), `model.py` (ledger→balances+metrics),
  `report.py` (→xlsx+json), `main.py`. Each function small and testable.

## 10. ACCEPTANCE CHECKS (self-verify before declaring done)
- Sum of FG produced after 5-May across all SKUs equals the sum of all positive `produce` qtys in
  the Ledger after the anchor (sanity that the matrix unpivot is complete).
- For NSMP100 with the real audit numbers, `producible == 0` and `binding_component == NSPKGMP100`
  (the empty-pouch line is 0 in the audit). If not, your component mapping is wrong.
- Every FG SKU in §2a appears exactly once in `FG Dashboard`; every component in §2b appears once
  in `Component Dashboard`.
- `Data Quality` lists the known juice-packaging gaps (tubes, labels, 300ml air pouch) and any
  audit equipment lines — confirming they were detected, not silently dropped.
- No unhandled exception on the provided workbook; a one-screen summary prints at the end with the
  as-of date, total FG stock value, count of SKUs flagged reorder, and the data-quality counts.

---

### One-paragraph version to paste as the first message to Claude Code
"Build a Python inventory+runway engine for a D2C brand from one Excel workbook with sheets
`Audit 050525` (physical count on 2026-05-05 = opening balance for FG+components, 4 sections),
`Production` (SKU×date matrix of FG packed; consumes components via a fixed BOM), and
`Daily Movement of FG` (stacked 16-row daily blocks of FG stock-out per channel and returns-in).
The item names differ across sheets and from the SKU/component codes, so use the alias maps in the
spec to normalise everything to canonical codes — never guess; unmapped rows go to a Data-Quality
report. Anchor all balances on the 5-May audit and roll forward using ONLY post-5-May transactions.
Compute per-SKU FG stock, 'producible' (min over BOM components of floor(stock/perPack)), runway
(stock/velocity), lead time (max component lead), reorder flags, stock value (units×price), and
MoM growth; and per-component stock, days-of-cover and reorder flags. Output a clean multi-tab
Excel (with live formulas, recalculated, zero errors) plus a JSON for the app. Follow the attached
BUILD SPEC exactly — all reference tables, parsing rules, formulas and acceptance checks are in it."
