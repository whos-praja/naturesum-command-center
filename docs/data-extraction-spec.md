# Naturesum data-extraction spec

Source-of-truth rules for velocity (30d) and growth (MoM) for every channel.
Encoded for both the parsers (`src/lib/uploadParsers.js`) and the future
inventory-AI agent (Claude API system prompt).

---

## Source precedence — Amazon channel

The Amazon FBA modal's "velocity" hero card and the dashboard's Amazon
channel velocity follow this precedence chain (top wins when present):

1. **Agency Channel-wise Sales Sheet** → `AMZ Categorywise` tab → SKU column
2. **Amazon "Manage Orders" 32-day export** → FBA-only (MCF excluded)
3. **Nitin Daily Movement** → Amazon row · 72-day average
4. **Amazon Warehouse-Wise Ledger** → 1-day shipped proxy (fallback)

The MCF report is **not used** in this version.

---

## Agency Sheet — `AMZ Categorywise` tab

Multi-tab workbook (xlsx). Tabs:
- `AMZ Categorywise` → Amazon channel daily sales per SKU
- `Blinkit Categorywise` → Blinkit channel daily sales per SKU
- `FK Categorywise` → Flipkart channel daily sales per SKU
- `Sale` → (master sales — currently ignored)

Each channel tab has the same daily-log shape:

| Date       | Jatamansi Oil | Sea Buckthorn Berries 100g | ... | Moringa Powder (250g) | Total |
|------------|---------------|----------------------------|-----|-----------------------|-------|
| (header)   | (column 2)    | (column 3)                 |     |                       |       |
| 1/5/2026   | 0             | 7                          |     | 2                     |       |
| 2/5/2026   | 0             | 7                          |     | 0                     |       |
| ...        |               |                            |     |                       |       |
| 28/5/2026  | 2             | 0                          |     | 0                     |       |

**Header rules:**
- Column A header is `Date` (case-insensitive). Date strings parsed as
  DD/M/YYYY (Indian format) OR Excel date serials OR ISO strings.
- Columns 2..N headers are display names of products (NOT canonical SKU
  codes). They map to canonical codes via `NAME_MAP` below.
- Skip rows where column A is `Total`, blank, or unparseable.

**Extraction (per SKU column, per channel tab):**
```
sales7d  = sum of values for rows where (today − rowDate) ≤  7 days
sales15d = sum of values for rows where (today − rowDate) ≤ 15 days
sales30d = sum of values for rows where (today − rowDate) ≤ 30 days
sales60d = sum of values for rows where (today − rowDate) ≤ 60 days

dailyOut = sales30d / 30                            (= velocity)

prior30 = max(0, sales60d − sales30d)
growth  = (sales30d − prior30) / prior30 × 100      (MoM %)
       capped [−100, +200]
       prior30 = 0 and sales30d > 0  → growth = +200 (zero baseline)
       sales30d = 0 and prior30 > 0  → growth = −100 (stopped)
```

`(today)` is the snapshot/cutoff date for the run (typically the most
recent row in the sheet, not literal current time).

---

## Shopify Website Sales — daily ledger

Single-tab CSV. One row per (date × SKU × variant), columns:

| Day        | Product variant title | Product title             | Product variant SKU | Net items sold |
|------------|-----------------------|---------------------------|---------------------|----------------|
| 2026-05-01 | 100ML                 | ROSEMARY & JATAMANSI HAIR OIL | NS-HO-JT-100   | 1              |
| 2026-05-08 | 100ML                 | ROSEMARY & JATAMANSI HAIR OIL | NS-HO-JT-100   | 1              |
| 2026-05-09 | 100ML                 | ROSEMARY & JATAMANSI HAIR OIL | NS-HO-JT-100   | 0              |
| ...        |                       |                           |                     |                |

**Extraction (per SKU):**
1. Filter rows where `Product variant SKU` matches the Shopify SKU code
   (e.g. `NS-HO-JT-100` → canonical `NSJO100` via `SHOPIFY_SKU_MAP`).
2. Sum `Net items sold` (signed — negatives are returns/cancels) into
   aging buckets:
   ```
   sales7d, sales30d, sales60d, sales90d
   ```
3. Same `dailyOut` + `growth` formula as agency above.

---

## SKU name / code mapping

### NAME_MAP — agency-sheet category names → canonical codes

| Agency-sheet display name      | Canonical code |
|--------------------------------|----------------|
| `Jatamansi Oil`                | NSJO100        |
| `Sea Buckthorn Berries 100g`   | NSSBDB100      |
| `Sea Buckthorn Berries 250g`   | NSSBDB250      |
| `Sea Buckthorn Berries 500g`   | NSSBDB500      |
| `Sea Buckthorn powder 100g`    | NSSB100        |
| `Sea Buckthorn powder 250g`    | NSSB250        |
| `Sea Buckthorn powder 500g`    | NSSB500        |
| `Sea Buckthorn Oil 15ML`       | NSSBBO15       |
| `Sea Buckthorn Oil 30ML`       | NSSBBO30       |
| `Sea Buckthorn juice 300ml`    | NSSBJ300       |
| `Sea Buckthorn juice 500ml`    | NSSBJ500       |
| `Moringa Powder (100g)`        | NSMP100        |
| `Moringa Powder (250g)`        | NSMP250        |
| `Acacia Catechu`               | _(unconfirmed — currently unmapped)_ |

Matching is **case-insensitive** and tolerates surrounding whitespace,
extra spaces, and `(` `)` punctuation differences.

### Multi-pack columns (combos)

The Blinkit / FK tabs (and occasionally AMZ) have combo columns suffixed
with `*N`, e.g.:
- `Sea Buckthorn Berries 100g*4` → 4 of NSSBDB100 per cell unit
- `Jatamansi Oil*4` → 4 of NSJO100 per cell unit

Rule: each unit sold in a multipack column represents **N units of the
base SKU**. Parser multiplies raw cell value by N when aggregating into
the base SKU's aging buckets. Regex: `^(.+?)\s*\*\s*(\d+)$` against the
normalized name.

### SHOPIFY_SKU_MAP — Shopify variant SKU → canonical

See `CODE_MAP.shp` in `src/lib/uploadParsers.js`. Examples:
- `NS-HO-JT-100` → NSJO100
- `NS-SBP-100` → NSSB100
- `NS-SBDR-250` → NSSBDB250

### AMAZON_MSKU_MAP — Amazon MSKU → canonical

See `CODE_MAP.amzMsku` in `src/lib/uploadParsers.js`. Strip `_MP` suffix
before lookup (`_MP` denotes MCF; MCF is excluded but the canonical SKU
is the same).

---

## AI-agent system prompt

When the inventory AI agent is wired to the Claude API, this entire
document is passed verbatim as the system prompt. The agent's job:

1. Receive a question about a SKU's velocity or growth.
2. Identify the channel.
3. Apply the source precedence chain above.
4. Show the work — name the sheet, the SKU column / row filter, the
   aging window, and the final number with the formula.

Example exchange:

> **User**: What's NSJO100's Amazon velocity today?
>
> **Agent**: Checking the Agency Sheet → `AMZ Categorywise` tab →
> `Jatamansi Oil` column. Last 30 days of daily values sum to **128**.
> Velocity = 128 / 30 = **4.3 units/day**. Source precedence rank 1
> (Agency Sheet beats Manage Orders / Nitin / ledger proxy).

---

## Edge cases — be explicit, never silent

- Missing data in a precedence rank → fall through to the next rank.
- Sheet has fewer than 30 days → use what's available, scale by actual
  day count (`sum / actualDays`), and log the day count in the response.
- Negative net items (returns) → keep them; they reduce velocity
  honestly. Do not clip at zero.
- Snapshot date in the future → ignore those rows (data hygiene).
- Total / summary rows → identified by non-date column A; skip.
