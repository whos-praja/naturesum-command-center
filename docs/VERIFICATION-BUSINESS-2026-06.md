# Business Performance Module — Verification (2026-06)

Permanent verification record for the Business Performance module (built against
`docs/BUSINESS-MODULE-SPEC.md`, founder-approved 2026-06-11). This is the human-
readable companion to the in-tool regression net `src/lib/businessVerification.js`
(spec §10). Every number here was RE-DERIVED independently from the raw May-2026
files — never copied from the tool's own output.

Status as of 2026-06-12: **GATE GREEN · 15/15 anchors MATCH · 0 DRIFT · 0 NaN ·
`npm run build` clean.** No code changes were required at the final gate.

---

## 1 · Method — independent builder / verifier separation

The module was built and verified by SEPARATE agents so the verification is a true
second derivation, not a self-check:

- **Builders (B1/B2/…)** implemented the pinned internal API contract — the fact
  store, the offline `scripts/build-business-data.cjs` twin that bakes
  `src/bundledBusinessData.js`, the cost-input registry, the pure CM engine, the
  UI pages, and the in-tool verification panel.
- **Verifiers (V1–V4) + the final gate** never trusted the builders' arithmetic.
  Each verifier re-parsed the raw `~/Downloads` files (`amazonmaysales.txt`,
  `flipkart may sales.xlsx`, `blinkit may sales.xlsx`, `shopify net sales net
  units.csv`, `may_product_wise_sp.xlsx`, `flipkart may ads.csv`, `google may
  ads.csv`, `SnellSales&AdsSheet.xlsx`, `MonarchWebsiteSales&AdsSheet (1).xlsx`,
  `Naturesum_Unit_COGS_116 (1).xlsx`) with their OWN node + `xlsx` scripts and
  hand-recomputed the CM chain, then compared cell-by-cell against the engine.
  - **V1** — anchor-source / labelling audit (§2/§3 numbers vs the raw files).
  - **V2** — rules audit: all 11 founder decisions re-derived from first principles.
  - **V3** — durability / idempotency: drove the SHIPPED store + parsers behind
    `localStorage`/`File` shims (no reimplementation).
  - **V4** — UI / honesty: coverage panel, ad caveats, `₹NaN` leak scan.
- **Two layers of regression net.** (a) `runVerification(facts)` recomputes every
  §2/§3 anchor from the live fact store and shows MATCH/DRIFT(δ) in the Finance
  Verification panel — the founder's permanent lock. (b) `node` self-tests in
  `cmEngine.js` (17/17) and `businessVerification.js` (19/19) guard the engine and
  anchor wiring with hand-checkable synthetic cases.

Reproduce the gate from `/Users/shivamprajapati/naturesum-command-center`:

```
node src/lib/cmEngine.js              # 17/17 PASS
node src/lib/businessVerification.js  # 19/19 PASS, PENDING_ANCHORS empty
node scripts/build-business-data.cjs  # reproduces bundledBusinessData.js (zero git diff)
npm run build                         # clean Vite production build
```

---

## 2 · Anchor table — `runVerification(BUNDLED_BUSINESS)` (15/15 MATCH)

Each anchor stores `{ id, label, expected, filter, compute(facts) }`. `compute()`
sums the live fact-store map; `filter` states EXACTLY which keys it touches so a
human can audit the filter against the data. Tolerance = max(₹1 absolute, 0.5% of
expected) — covers ÷1.05 paisa rounding and unit counts.

| Status | Anchor | Filter (which fact keys) | Actual | Expected | δ |
|---|---|---|---|---|---|
| MATCH | amazon-net-rev | Σ netRev `2026-05\|amazon\|*` (Amazon.in, shipped−returns, ÷1.05) | 1,143,449.84 | 1,143,449.84 | 0 |
| MATCH | amazon-units | Σ units `2026-05\|amazon\|*` (shipped − return rows) | 1,380 | 1,380 | 0 |
| MATCH | amazon-gross-rev | Σ grossRev `2026-05\|amazon\|*` (item-price, returns netted) | 1,200,623 | 1,200,623 | 0 |
| MATCH | flipkart-net-rev | Σ netRev `2026-05\|flipkart\|*` (Σ BIA native-sign, *N folded, AS-IS) | 272,842.99 | 272,842.99 | 0 |
| MATCH | blinkit-gross-rev | Σ grossRev `2026-05\|blinkit\|*` (gross bill, keyed Item Id) | 281,560 | 281,560 | 0 |
| MATCH | blinkit-net-rev | Σ netRev `2026-05\|blinkit\|*` (gross − CGST/SGST/cess) | 268,152.70 | 268,153 | −0.30 |
| MATCH | blinkit-units | Σ units `2026-05\|blinkit\|*` | 386 | 386 | 0 |
| MATCH | website-net-rev | Σ netRev `2026-05\|website\|*` (Shopify Net sales AS-IS, NOT ÷1.05) | 428,377.84 | 428,378 | −0.16 |
| MATCH | website-units | Σ units `2026-05\|website\|*` (Net items sold) | 610 | 610 | 0 |
| MATCH | amazon-sp-attributed | Σ adSpendDirect `2026-05\|amazon\|*` (SP per-ASIN daily) | 355,114.86 | 355,115 | −0.14 |
| MATCH | amazon-ams-total | Snell Sale-tab "Actual AMS Spend" May (meta channel total) | 367,123.20 | 367,123.20 | 0 |
| MATCH | flipkart-pla-attributed | Σ adSpendDirect `2026-05\|flipkart\|*` (PLA per-SKU) | 47,405.56 | 47,406 | −0.44 |
| MATCH | blinkit-ad-total | Snell Sale-tab Blinkit spend May (meta channel total) | 66,415 | 66,415 | 0 |
| MATCH | website-google-attributed | Σ adSpendDirect `2026-05\|website\|*` (Google product-wise) | 116,648.42 | 116,648.42 | 0 |
| MATCH | website-ad-total | Monarch May Google (135,008.32) + Meta (77,950.03) | 212,958.35 | 212,958.35 | 0 |

**MATCH = 15 · DRIFT = 0 · NO-DATA = 0 · PENDING = 0.** Sub-rupee deltas are
÷1.05 / per-cell rounding only, well inside tolerance.

### Anchor subtleties worth recording (verified independently)
- **amazon-units = 1,380, not the §2 "1,430".** May purchase-date gross = 1,403
  units; − 23 "Returned to Seller" units = 1,380 net. The §2 "1,430" is the
  ALL-ROWS count (returns un-netted, incl. 4 April-dated units) — it is *not*
  1,430 − 23. The anchor comment was reworded (V1 [P3]) to state this precisely.
- **amazon-gross-rev = 1,200,623, not the §2 "1,238,808".** The store's `grossRev`
  field is already return-netted (the ₹17,155 return value subtracted); the §2
  "≈1,238,808" guide is the pre-return-netting gross, kept as `guide`.
- **flipkart-net-rev = 272,842.99, not the §2 "271,408".** Σ BIA over all 588 rows
  = 271,407.99, but −₹1,435.00 of the Return rows carry an APRIL order date and so
  land in `2026-04|flipkart|*` under channel-native date attribution. The May-only
  fact sum is 271,407.99 + 1,435.00 = 272,842.99. BIA is AS-IS (NOT ÷1.05; ÷1.05
  would yield 258,484, a false DRIFT — the §2 "÷1.05" note is the gross-marketplace
  rule and does not apply to Flipkart BIA).

---

## 3 · Hand-recomputed CM chains (V2 — match engine to the rupee)

CM chain per cell (spec §6): `netRev − COGS×units → CM1 − feePct×netRev → CM2 −
adSpend → CM3 − fixedAlloc → CM4`. Fees use §5 (amazon 27.5413%, blinkit 25.694%,
website blended 24.8011%, flipkart 10.3647%). adSpend = direct + share of the
channel's unattributed pool by netRev. Two SKUs × two channels, recomputed by hand
from the raw files and re-confirmed against `computeCM` output:

| Cell | CM1 | CM2 | CM3 | adSpend | Engine match |
|---|---|---|---|---|---|
| amazon · NSSB250 | 75,877.90 | 38,418.39 | −9,056.49 | 47,474.88 | to the paisa |
| amazon · NSSBDB500 | 123,609.71 | 45,279.58 | −8,699.54 | 53,979.12 | to the paisa |
| blinkit · NSSB100 | 39,312.10 | 24,666.24 | 10,548.43 | 14,117.81 | to the paisa |
| blinkit · NSSBDB500 | 40,609.68 | 17,533.98 | −4,709.73 | 22,243.71 | to the paisa |

Worked example — **amazon · NSSB250** (netRev 136,012.15, units pinned from facts):
- COGS 305.25/unit → CM1 = 75,877.90.
- fee 27.5413% × 136,012.15 = 37,459.51 → CM2 = 38,418.39.
- Amazon unattributed pool = 367,123.20 (Snell AMS) − 355,114.86 (Σ SP direct) =
  12,008.34; NSSB250's share = (136,012.15 / 1,143,449.84) × 12,008.34 = 1,428.38;
  adSpend = 46,046.50 SP-direct + 1,428.38 = 47,474.88 → CM3 = −9,056.49.

### Ad-pool conservation (V2 — every pool fully allocated, nothing dropped)
For each channel, Σ(direct + allocated-unattributed) over its SKUs equals the
channel total (verified against the engine's `adAllocation`):
- **amazon** Σ = 367,123.20 (= Snell AMS total; unattributed 12,008.34 split by netRev).
- **blinkit** Σ = 66,415 (direct 0 → the full Snell total is unattributed, split by netRev).
- **website** Σ = 212,958.35 (= Monarch Google+Meta; direct Google product-wise
  116,648.42 + unattributed 96,309.93).
- **flipkart** total 47,347.64 < direct PLA 47,405.56 ⇒ unattributed floored to 0
  (the spec §3 "if ≈PLA, total=PLA" edge). No `unallocated` leakage on any channel.

### Company May 2026 headline (live costs)
- netRev **₹21,12,823** · units **2,874** · CM1 **₹11,63,961** (55.1%) ·
  CM2 **₹6,45,619** (30.6%) · CM3 **−₹48,283 (−2.29%)** · CM4 = `null` (no fixed
  cost set → correctly hidden, spec §6/§11). `cogsCovered = true` (zero COGS misses
  across all 14 SKUs).
- By-channel CM3: flipkart +₹54,699 (+20.0%) · blinkit +₹13,822 (+5.2%) ·
  amazon −₹26,822 (−2.3%) · website **−₹89,982 (−21.0%)**.
- **CM4 behaviour proof:** injecting ₹2,00,000 fixed cost yields company
  CM4 = CM3 − 200,000 = −₹2,48,283, with per-cell `fixedAlloc` revenue-proportional
  (amazon · NSSB250 = 136,012.15 / 2,112,823.37 × 200,000 = ₹12,874.92, verified).

---

## 4 · Durability / idempotency proofs (V3 — CLEAN)

V3 imported the SHIPPED `src/lib/businessStore.js` + `src/lib/businessParsers.js`
into node behind `window.localStorage` and `File` shims and drove the real
`parseBusinessFile` dispatcher + real `upsertFacts`/`clearSource`/`mergedFacts` —
no reimplementation.

- **(a) parse-twice == parse-once.** Each of the 8 May sources parsed + upserted
  twice produces byte-identical persisted facts (monthly + daily, key-sorted) vs
  once. Combined all-8 once == twice at 53,460 B. Mechanism: `upsertFacts` calls
  `clearSource` first (subtracts the `meta.contrib` snapshot), then re-adds.
- **(b) overlapping window REPLACE, not SUM.** Re-upserting the same source with
  the same keys / different values REPLACES (`2026-05|amazon|NSSBJ300` units
  190 → 999, not 190+999). Cross-source field discipline holds: sales fields and
  `adSpendDirect` on the same key merge field-wise; re-uploading sales replaces
  sales fields while `adSpendDirect` survives. A re-upload with FEWER keys removes
  the dropped key (no ghost).
- **(c) malformed / renamed column → fail-loud.** Renaming the critical column in
  the Amazon (`item-price`), shopify-net (`Net sales`), and fk-pla (`Ad Spend`)
  parsers, and a header-only Amazon file, each THREW — never returned silent-zero
  facts (spec §11).
- **(d) 6-month serialized size — within budget.** One full May persisted blob =
  94,831 B (48 monthly + 533 daily cells). A 6-distinct-month simulation =
  600,426 B ≈ 586 KiB — ~9× under the ~5 MiB localStorage budget. The `meta.contrib`
  idempotency snapshot roughly doubles persisted size but is BOUNDED: 5× re-upload
  of one source kept exactly ONE contrib entry, and contrib is deleted by
  `clearSource`. No unbounded growth.
- **(e) mergedFacts override + clean clearSource.** An uploaded key overrides the
  bundled baseline (uploaded wins); `clearSource` restores the exact bundled value
  and leaves zero residue (no monthly key, no `meta.contrib`, no `meta.bySource`).
  A genuinely-new key (month 2025-12, absent from baseline) added then cleared is
  gone from both the merged view and the store. Full upsert → clearSource round-trip
  on blinkit (5 monthly + 116 daily) returns the store to 0/0 — `clearSource` is a
  true inverse and removes daily facts too.
- **Extra guards:** `clearSource` on a never-uploaded source is a safe no-op;
  NaN/Infinity inputs to `upsertFacts` are coerced to 0 / skipped (stored cell
  stays all-finite); xlsx-path parsers (blinkit/snell/monarch) are idempotent
  through the `arrayBuffer` path.

---

## 5 · Known caveats (carry forward)

1. **₹0 packaging placeholders.** NSACDT30 (₹150) and NSJO100 (₹375) COGS carry a
   ₹0 packaging component in the 11-Jun file. The per-unit COGS is real; only the
   packaging leg is a placeholder. Flagged in the UI ("⚠ pkg ₹0") and exported as
   `PKG_PLACEHOLDER_CODES`. Fold real packaging in when known — it will lower CM1
   for those two SKUs.
2. **Single-month growth.** Only May 2026 is baked, so MoM growth has no prior
   month to trend against. Monarch (13-mo website history) and Snell history are
   trend CONTEXT only, never revenue. Real MoM lights up once a second month is
   uploaded; `ANCHOR_MONTH` is fixed to "2026-05" until then.
3. **Ad attribution windows.** Product-attributed ad spend (Amazon SP, Flipkart
   PLA, Google product-wise) is taken per the platform's own attribution window;
   it does NOT necessarily reconcile day-for-day with channel totals. The model
   reconciles at the CHANNEL level: unattributed = max(0, channelTotal − Σ direct),
   allocated by netRev share within the channel (spec §3/§6). Blinkit has no
   product-attributed feed, so its entire Snell total is unattributed.
4. **MCF share assumption.** The §5 website blended fee needs `mcfShare` = MCF
   revenue share of website. The spec proxy (Non-Amazon units × website per-unit
   net price ÷ website net) = ₹438,742.10 / ₹428,377.84 = **1.0242**, non-physical
   (>1.0) because gross MCF units (652) exceed net website units (610). The build
   **caps to [0,1]**, baking `mcfShare.share = 1` with `rawProxy 1.02`, `capped:
   true`. So the website blended fee resolves to **24.8011%** (the pure mcf-web
   rate) and the UI shows "⚠ capped 100%". Bounded impact: at the 0.0 lower-bound
   the fee would be 23.2627% (website-direct), understating website fees by at most
   ~₹6,590 (~1.54% of website netRev). The blend math itself is correct; the share
   is editable in the Cost Inputs panel — enter a truer split when available.
5. **CM4 caption.** CM4 is allocated revenue-proportionally across channels then
   SKUs (founder decision §11). This taxes high-revenue cells regardless of actual
   fixed-resource use, so the UI captions CM4 as a **reporting view** ("CM4 is a
   reporting view", per-step caption "reporting view") and keeps **CM3 as the
   decision layer** (delist / ads calls). CM4 stays HIDDEN until the founder enters
   a monthly fixed-cost figure (default `getFixedCost` → null).

---

## 6 · Verdicts

| Pass | Verdict |
|---|---|
| V1 (anchor/source/labelling) | Clean after [P3] comment rewordings (amazon-units, §2 gross labelling). |
| V2 (rules / 11 founder decisions) | ISSUES(1): website mcfShare placeholder (P2, bounded ≤₹6,590, root-caused to broken spec proxy) — FIXED via the capped [0,1] build. All other 10 decisions implemented exactly; full CM chain matches to the rupee. |
| V3 (durability / idempotency) | CLEAN — no double-count, replace-not-sum, dropped keys don't strand, malformed files fail loud, ~9× headroom, clearSource is an exact inverse. |
| V4 (UI / honesty) | Fixed: Coverage panel mounted (§9), Blinkit ad caveat logic mirrors engine precedence (zero false caveats), `fmtINR` NaN leak, mcfShare UI flag. |
| Final gate | **GREEN** — 15/15 MATCH, 0 DRIFT, 0 NaN, build clean. No code changes required. |

All 11 founder decisions (spec §1) verified by independent computation. The
in-tool Verification panel (`businessVerification.js`) is the permanent regression
net: anchors change ONLY when a new bundled baseline ships.
