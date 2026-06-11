# First-Principles Review — Pass 4 (2026-06)

Founder asked: *from first principles, is the tool capable of achieving all its
end objectives — and is anything missing from the objectives themselves, using
only the sheets already being entered?* This is that review: every data point,
every derivation, every failure mode under imperfect inputs.

## 1 · The founder's four spot-checks (all confirmed real, all fixed)

| # | Report | Root cause | Fix |
|---|---|---|---|
| 1 | Blinkit daily velocity not visible in Unified Stock | The Blinkit cell only rendered stock + feeder OOS stats — the meta row (days-cover pill, velocity/d, MoM) that every other channel cell has was never added | Blinkit cell now renders the full meta row from `channelVelocity.blinkit` / `channelGrowth.blinkit` (max(30,15) window) |
| 2 | Action-needed date has no months/years | `fmtReorderDate` emitted a bare calendar date past 14d | All reorder horizons now read "Sep 14 · in ~3.1 mo" (`fmtDur`: <30d → d, <365d → mo, else yr) in the Runway risk cards, the materials table, and the Suppliers component tab |
| 3 | **Juice tubes misread as juice bottles** | Audit rows `"Juice containers (Package) 300/500ML"` (1826/2022 pcs) were aliased to the glass-bottle refs `NSPKGJBOT*`. They are the TUBES. The actual glass bottles have **no packaging audit line at all** (they only appear filled, under SEMI-FINISHED) | Aliases corrected → `NSPKGJTUB300/500` = 1826/2022. Bottles (+ labels) are now **UNTRACKED** — see §3 |
| 4 | **Juice air pouches not considered** | Two compounding errors: the real audit rows `"Air pouches (300ML)/(500ML)"` (910/1000 pcs) had **no alias** (silently fell to consumables), and `NSPKGJB300/500` had been classified NON-constraining on the assumption they were generic air-wrap | Aliases added (910/1000 now tracked) and air pouches **removed from NON_CONSTRAINING** — they constrain producible like any real packing component. Only outer shipping cartons remain non-constraining. The generic `"Juice air wrap"` consumable row stays excluded |

Re-derived after the fixes (file 6): NSSBJ300 BOM = pulp 0 (binds, tracked
zero) · bottle untracked · air pouch 910 · tube 1826 · label untracked.
Producible 0 via pulp — correct, and no longer accidentally-correct-for-the-
wrong-reason.

## 2 · Name robustness (the founder's "slightly altered name" scenario)

**Before:** every lookup was exact-match on a normalized string. One plural
("Pouches"→"Pouch"), one glued unit ("100gm" vs "100 gm"), or one renamed
column and the row silently fell to unmapped/consumable — stock vanishes from
producible, velocity degrades to a fallback, **no error**. This was the single
largest fragility in the tool.

**Now (R-FUZZY, all three name surfaces):**
- `norm()` (both engine twins) splits glued digit-units ("100gm" ≡ "100 g" ≡
  "100 gram") so unit spelling can never decide a match.
- After an exact miss, a **conservative fuzzy match** on stemmed word tokens:
  NUMERIC tokens must match EXACTLY (300 can never match 500 — a size change is
  a different item, not a typo), Dice similarity ≥ 0.8, unambiguous winner
  (margin ≥ 0.08). Applied to: audit FG + components, Production, Daily
  Movement (engine twins) **and** the Agency sheet column headers
  (uploadParsers + build-bundled-agency twins).
- **Every fuzzy hit is flagged** (`fuzzy_matched`, shown in the Data-Quality
  panel with the guess + similarity %) — tolerant, never silent. Genuinely
  unknown names still land in `unmapped_*` flags.
- Verified with a synthetic workbook: "SB Powders 250 gm", "Sea Buckthorn
  Berry Juice 300ML", "AC Tea Dip Sachet (Filled)", "Moringa powder pouch
  100gm", "Air pouch (300ML)" all map (flagged); "Totally Unknown Item XYZ"
  stays unmapped. Real workbook output is byte-identical.
- Bonus: the fuzzy layer immediately fixed a REAL miss — the Production tab's
  `"AC Tea Pouches(Green, Filled)"` row (unmapped for weeks) now maps to
  NSACDSF30, so Acacia tea SFG production is finally counted.

## 3 · The "untracked component" rule (phantom-zero guard, generalised)

The original founder complaint (Moringa pouch showing OOS) was a phantom zero.
The same class of bug remained for any BOM ref with no audit line: it parsed to
stock 0 and could bind producible to 0. **Rule now: "no data" ≠ "zero".** Any
BOM ref with no audit line anywhere (new or old) is `untracked`: flagged in the
DQ panel ("add an audit row"), shown as *untracked* in the Materials breakdown
and Suppliers tab instead of a fake 0, and **excluded from producible binding,
bottleneck, worst-cover, M3 allocation, and the Simulator** — exactly like the
headline. Today that's the juice glass bottles + juice labels. A tracked zero
(e.g. juice pulp = 0) still binds, as it must.

## 4 · Data sufficiency vs the objectives (existing sheets only)

O1 truthful stock / O4 value — fully served by current sheets. O2 runway / O3
reorder — served, with these additions made this pass because the data already
supports them:
- **Component suggested order quantity** (Suppliers tab): ceil(consumption ×
  (lead + 30d) − stock) at sales-based consumption — e.g. juice pulp suggests
  1,343 Ltr. The tool previously said *when* to reorder but not *how much*.
- **Blinkit cell velocity/cover/MoM** (§1.1) — the data was already parsed,
  just never displayed.
- **Reorder horizons in months/years** (§1.2).

**Gaps that need data the sheets don't carry (named, not silently absorbed):**
1. **Component inbound POs** — the engine is deplete-only; an ordered-but-not-
   arrived raw shipment isn't visible, so component cover is conservative.
   Needs a small PO sheet (component, qty, ETA).
2. **Juice glass-bottle + label stock** — untracked until the audit adds rows.
3. **Marketplace inbound transfers** — stock-in-transit to FBA/FK/Blinkit is
   invisible between WH ship-out and marketplace check-in; channel runway is
   conservative during transfers.
4. **WH-direct sales lane** (M6) — still deliberately 0; needs an isolable
   direct-sales column to avoid double-counting the website demand folded into
   Amazon.
5. **Blinkit native 60d sales** — Blinkit MoM growth leans on the agency tab;
   the native export has no 60d bucket.

## 5 · Derivation-method robustness checks (re-verified this pass)

- Velocity max(30,14|15), max-MoM growth (+75% cap), network-cascade runway,
  M3 demand-share allocation, M4 old-stock-selling, value Σ(all locations ×
  SP) — all re-derived against file (6) after the BOM corrections; **every
  headline number is unchanged** (₹72,48,755 · 3 red / 5 amber / 6 green ·
  3 reorders), which is the expected result: the juice fixes change *component*
  truth and *future* producible, not today's FG stock or sales velocities.
- Fail-loud paths re-confirmed: missing audit tab/section throws; zero FG rows
  throws; stale-default rebuild input removed; the synthetic-workbook test
  exercised the SEMI-section guard for real.
- All four originally-reported bugs (Moringa 100kg / dry-berry 0 / pouch 2935 /
  cartons) still hold.

## 6 · Verdict

With pass 4, the tool derives every objective-critical number from the sheets
actually being entered, survives realistic name drift without silent data
loss, refuses to invent zeros for data it doesn't have, and says not just when
to reorder but how much. The five named gaps above are data-availability
gaps, not tool defects; each is flagged in-product where it applies.
