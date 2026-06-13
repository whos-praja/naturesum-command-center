# NATURESUM BUSINESS MODULES — JUDGEMENT PARAMETERS (Sales & Revenue · Finance & Unit Econ · Marketing & Ads)

**What this is.** The complete set of parameters on which these three modules
can and should be judged — defined and explained. No weights, no point caps, no
"acceptable" thresholds. The frame is **100× better**: for each parameter, the
bar described is what *world-class* looks like for a founder running a real D2C
business day to day, not what is merely adequate. A reviewer (or builder) uses
this as the full map of what "excellent" must cover; nothing valuable the data
could support should fall outside it.

**Reference points the parameters assume:**
- The **inventory module** is the FLOOR for craft (multi-cut, ⓘ-derivations,
  status filters, drill modals, "Data through" live labels) — the business
  modules must exceed it because their data is richer.
- The **data reach** is large: 22 months × 4 channels × daily grain (Snell
  agency daily channel + per-SKU units back to Aug-2024; Monarch daily website +
  Google/Meta + SEO ranks; native May exports; COGS; variable-platform-%s;
  retention; returns).
- The founder's **own daily tracking sheet** is the shape "Date rows × SKU
  columns × Total, with subtotals and a running total" — the tool should
  replicate and surpass it.

---

## I · DATA FOUNDATION & INTEGRITY
*If a number is wrong or a source is unused, everything above it is decoration.*

1. **Reconciliation to source.** Every displayed figure re-derives from the raw
   files to the rupee/unit. World-class: a reviewer can pick any number on any
   screen and reproduce it from the source export. Falls short: any figure that
   doesn't tie out, or ties out only "approximately" without saying so.
2. **Ingestion completeness.** Every source, every month, every *field* the
   files contain is loaded and used — not just the convenient columns. 100×: the
   tool exploits signal the founder forgot was in the sheet (e.g. Snell's
   shipped-vs-cancel split, Monarch's SEO tab). Falls short: a column/month that
   exists in a file but never reaches a view.
3. **Source-of-truth precedence.** Clear, correct tiering when sources overlap
   (native marketplace export > agency Snell/Monarch estimate) with the losing
   source retained for reconciliation, never silently discarded.
4. **Cross-source reconciliation.** Where two sources describe the same thing,
   the delta is computed and shown (agency-vs-native), so divergence is a visible
   fact, not a hidden inconsistency.
5. **Idempotency / dedup.** Re-uploading an overlapping file upserts, never
   double-counts (parse-twice == parse-once). Overlapping windows replace, not
   sum.
6. **Granularity preservation.** Daily kept as daily, SKU kept as SKU — the tool
   never throws away resolution the source had. Monthly-only where daily exists
   is a loss.
7. **SKU identity resolution.** Every naming variant across Amazon MSKU/ASIN,
   Flipkart SKU (+*N multipacks), Shopify SKU, Blinkit Item-Id, Google ad title,
   agency column, COGS-sheet name resolves to one canonical SKU — robustly, and
   tolerant of slight renames, with any fuzzy match flagged.
8. **Gross / net / tax consistency.** One declared revenue basis (net-of-GST)
   applied consistently and labelled; never a column double-discounted or a gross
   shown where net is meant.
9. **Returns / cancellations / refunds.** Handled per the real settlement logic
   (Amazon netted, Flipkart sign-corrected, etc.) and also surfaced as their own
   signal — not silently swallowed.
10. **Numeric integrity.** No NaN/Infinity, no raw floats, correct rounding,
    integer units — never a `₹457.1165…` reaching a screen.
11. **Historical depth exploited.** The full multi-month history is not just
    stored but *visible* — long-run trends, seasonality, and the 0→1 ramp of new
    channels are all readable.

---

## II · METRIC & METHODOLOGY RIGOUR
*The definitions behind the numbers must be defensible to a CFO.*

12. **CM ladder correctness.** CM1 (−COGS) → CM2 (−variable platform) → CM3
    (−ads) → CM4 (−allocated fixed) computed correctly per channel, per SKU, and
    as a SKU×channel matrix; each level's definition stated.
13. **Contribution per unit and per order.** Not just channel totals — the
    economics of a *single sale* (₹ contribution per unit, per order/AOV), the
    number a founder uses to decide pricing and promos.
14. **Growth methodology.** MoM computed like-for-like (full-vs-full, or
    matched MTD windows), never full-vs-partial; the method stated.
15. **Run-rate & projection.** For the in-progress month, a defensible projected
    month-end (pace vs prior-month-to-same-day), so the founder isn't comparing a
    half-month to a full one.
16. **Daily flag baseline.** The green/red day signal rests on a stated,
    defensible baseline and is seasonality-honest (a structurally-low Sunday
    isn't flagged red against a peak). "Beat the recent peak" (vs Max-7) and "is
    demand softening" (vs trailing/weekday-matched average) are different
    questions and the tool is explicit about which a colour answers.
17. **Velocity-definition consistency.** The sales velocity shown here matches
    the inventory module's velocity for the same SKU×channel — the tool never
    shows two different "Amazon velocity" numbers.
18. **Statistical honesty.** Small samples, low-base months, and high-variance
    series are treated as such (a +900% MoM off ₹2k of revenue is annotated, not
    presented as a trend); variance/noise acknowledged.
19. **Price realization.** Effective realized price vs MRP, discount/promo
    leakage, AOV trend — where the data supports it.
20. **Methodology disclosure.** Every derived metric's formula is stated
    somewhere reachable; no black-box numbers.

---

## III · AD-SPEND & ATTRIBUTION
*The hardest data problem here — it must be both complete and honest.*

21. **Full allocation.** Every rupee of ad spend is placed: product-attributed
    actuals where they exist (Amazon SP per-ASIN, FK PLA per-SKU, Google
    per-product), the unattributable remainder spread by a stated rule
    (revenue-proportional), nothing dropped.
22. **Reconciliation to channel totals.** The attributed + allocated spend ties
    exactly and visibly to the channel's source total (e.g. SP-attributed +
    allocated remainder = Snell AMS total), shown as an explicit equation.
23. **Attribution confidence.** The tool shows *what fraction* of each channel's
    spend (and thus each CM3) is real-attributed vs allocated-by-guess — a CM3
    that's 97%-measured is trustworthy; one that's 3%-measured is a hint, and the
    founder must see which.
24. **Window integrity.** ROAS/ACOS and any ratio divide only same-window
    quantities; cross-window combinations are suppressed and explained, never
    shown as a real number (no ACOS-16276% artifacts).
25. **Breakeven economics.** Breakeven-ACOS (= CM2%) computed per SKU×channel
    and compared to actual ACOS, so "losing money per ad rupee" is an explicit,
    same-window verdict.
26. **Efficiency comparison.** Where two platforms compete for the same budget
    (Google vs Meta on website), their ROAS/CPA sit side by side — the actual
    reallocation decision.
27. **Wasted-spend surfacing.** Zero-sale spend, and spend on CM3-negative
    SKU×channels, are called out as money to stop.

---

## IV · COVERAGE, HONESTY & TRUST
*The tool must never let the founder over-trust a thin number.*

28. **Coverage tiering visible.** Every figure/section is labelled native /
    agency / none, so the founder knows the pedigree of what they're reading.
29. **Partial-period honesty.** MTD / partial months are marked and excluded
    from like-for-like comparison.
30. **Absurd-ratio suppression.** Any ill-defined or window-mismatched ratio is
    replaced by a plain-language explanation, never displayed as a finding.
31. **Assumption & placeholder flagging.** Editable assumptions (fee %s, the ₹0
    packaging COGS placeholders) are visibly flagged as assumptions, not treated
    as measured truth.
32. **"Unknown ≠ zero."** Missing data reads as "no data" (and where), never as a
    zero that silently drags a sum or a margin.
33. **Confidence/provenance per number.** A figure carries, or can reveal, how
    solid it is and where it came from.
34. **Data-gap map.** The tool shows, at a glance, what's missing — which
    SKU×channel×month has no coverage — so blanks are understood, not mistaken
    for zeroes.

---

## V · TRACEABILITY & EXPLAINABILITY
*Any number, in two clicks, to its full origin.*

35. **Per-number derivation.** Every non-trivial figure exposes its formula, the
    ACTUAL inputs that produced THIS value, the source file, and the as-of date.
36. **Explanations behind affordances, not on the page.** Caveats and methods
    live behind ⓘ buttons / hovers (the inventory FormulaIcon pattern), keeping
    the surface clean; the page is numbers, the depth is a click away.
37. **Live verification.** A panel re-derives the headline numbers from the fact
    store against raw-file ground truth and shows MATCH/DRIFT — a permanent,
    runnable self-check.
38. **Editable inputs with provenance.** Cost/fee/fixed inputs are editable
    in-tool, each carrying source + as-of, with a history of what changed.
39. **Upload/audit trail.** The founder can see what files produced the current
    state and when.

---

## VI · ANALYTICAL DEPTH — DESCRIPTIVE
*Every cut of the data a founder would want to look at.*

40. **The daily tabular view.** Date rows × SKU/channel columns × Total, with
    subtotals and a running cumulative — the founder's sheet, surpassed: per
    channel and combined, pivotable, ~3 months scrollable, with growth columns
    and the day flags.
41. **Winners & losers.** SKU and channel leaders/laggards by revenue, units,
    and margin — and by *momentum* (who's accelerating/decelerating).
42. **Channel mix & its shift.** Share of revenue/units/margin by channel, and
    how the mix is moving over time.
43. **SKU×channel matrices.** Revenue, units, and CM3 each as a SKU×channel grid
    — where a product makes or loses money, and on which channel.
44. **Trend depth.** Daily, weekly, monthly views of every core series, with
    moving averages and range presets, across the full history.
45. **AOV / basket.** Order value trends, units-per-order, multipack behaviour.
46. **Retention & repeat.** Repeat-customer rate and returning-revenue share over
    time (the data exists) — the leading indicator of D2C health.
47. **Returns & cancellations.** Rate and trend per channel, with spike flags —
    early operational warning.
48. **SEO / organic.** Keyword rank movement for the website (the data exists),
    since website is a meaningful share of revenue and spend.
49. **Weekday / seasonality patterns.** Day-of-week and month-of-year structure,
    so daily reads are interpreted correctly.

---

## VII · DIAGNOSTIC, PREDICTIVE & PRESCRIPTIVE — THE 100× LAYER
*Beyond "what happened" to "why, what next, and what to do."*

50. **Decomposition / bridges.** When a number moves, the tool explains WHY — a
    CM3 bridge (price × volume × cost × mix), a revenue bridge month-to-month, a
    "this channel fell because that SKU did" attribution.
51. **Anomaly detection.** The tool proactively flags the day/SKU/channel that
    broke pattern (a 2σ drop, a returns spike, an ACOS blow-out) instead of
    waiting for the founder to find it.
52. **Forecasting.** Forward revenue/units/contribution at channel and SKU grain,
    with the method and uncertainty shown — not just rear-view.
53. **Prescription / recommendations.** Ranked, specific actions with their
    rupee impact ("cut Diabetes-Tea Amazon ads → +₹X CM3/mo"), so each view ends
    in a decision, not a number.
54. **Scenario / what-if.** Change a price, a fee %, an ad budget, a COGS → see
    the CM impact across the matrix (the Simulator pattern, for economics).
55. **Driver / sensitivity analysis.** What moves company CM3 most — which lever
    (a SKU, a channel, a cost line) has the highest leverage.
56. **Targets & benchmarks.** Actuals vs goals/targets and vs prior period,
    so performance is read against an intention, not in a vacuum.
57. **Concentration & dependency risk.** How much revenue/margin rides on one
    SKU or one channel — the fragility the founder should watch.
58. **Cross-module synthesis.** Sales × inventory together: the fast-mover about
    to stock out, the CM3-negative SKU you're about to reorder — insight that
    only exists by joining modules.
59. **Auto-narrative.** A written "here's what changed and what it means this
    week" digest — the tool doing the first pass of analysis for the founder.

---

## VIII · DECISION-FIT & ACTIONABILITY
*Does it change what the founder does on Monday?*

60. **Maps to real decisions.** Every primary view ties to an actual recurring
    decision (reorder, raise/cut ad budget, delist, reprice, push a channel).
61. **Prioritisation.** The tool tells the founder what to look at first / what's
    on fire — not an undifferentiated wall of equal-weight metrics.
62. **Surfaces the non-obvious.** It tells the founder something they didn't
    already know from their spreadsheet — otherwise it's a prettier sheet.
63. **Time-to-insight.** The key state of the business is graspable in seconds,
    not assembled by the founder across tabs.
64. **Replaces the manual sheet.** The honest test: after this, does the founder
    stop maintaining their own tracking sheet?
65. **Trust to bet on.** Would the founder commit a PO or an ad-budget change on
    a number here without re-checking it elsewhere?

---

## IX · INFORMATION ARCHITECTURE & VISUAL DESIGN
*Land cold, understand instantly, depth never in the way.*

66. **Most-useful-first.** The single most decision-relevant thing is first and
    above the fold; trivia is demoted or behind a click.
67. **Sectioned / columned, not one scroll.** Tabbed or columned structure; the
    founder navigates, doesn't endlessly scroll.
68. **Land-cold comprehension.** A founder who has never seen a screen
    understands what it shows and what it means without a manual.
69. **Progressive disclosure.** Headline → section → drill → derivation; depth is
    available at each level but never forced on the surface.
70. **Scannability.** Colour + number read at a glance (red = losing/softening);
    the eye finds the problem before parsing labels.
71. **Visual-encoding correctness.** The right chart for the data; honest axes
    (no truncated baselines that exaggerate); tables where numbers matter more
    than shape; no chartjunk.
72. **Consistency.** With the inventory module (labels, status colours, ⓘ
    pattern, drill behaviour) and internally across the three pages.
73. **Labelling clarity.** No unexplained jargon — CM3/TCOS/ACOS/MCF either
    self-evident in context or one hover from an explanation.
74. **Density vs calm.** Rich but not noisy; the page informs without inducing
    anxiety or fatigue.
75. **Wayfinding.** The founder always knows where they are, what period/filter
    is active, and how to get back.

---

## X · INTERACTION, PERFORMANCE & STATES
*The tool feels alive and never breaks.*

76. **Interaction affordances.** Filters, period/range pickers, channel/SKU
    toggles, drill modals, hover detail — present where they help, predictable.
77. **Responsiveness / layout robustness.** No horizontal overflow; works at
    laptop width and degrades gracefully narrower (the founder on a phone).
78. **Performance.** Fast load and interaction with the full 22-month dataset; no
    jank on filter/drill; scales as months and SKUs grow.
79. **Empty / loading / partial / error states.** Every state is designed — a
    channel with no data, a month not yet uploaded, a parse failure — and reads
    clearly, never a blank or a crash.
80. **Accessibility.** Sufficient contrast, keyboard reachability, not
    colour-only encoding for critical signals.

---

## XI · OPERATIONAL — INGESTION, FRESHNESS, EXTENSIBILITY
*A living tool the founder feeds irregularly.*

81. **In-tool upload.** Reports upload from inside the tool (visible on the
    pages), with clear per-zone "what this unlocks", last-upload, and tier.
82. **Ingest semantics communicated.** The founder understands that re-uploading
    replaces, that native overrides agency, that order matters not at all — the
    dedup/override rules are explained, not assumed.
83. **Freshness labelling.** "Data through <date>" and per-source recency, true
    to the actual latest data day (not a calendar artifact), consistent with
    inventory.
84. **Resilience to messy files.** Slightly-renamed columns/SKUs are tolerated
    (flagged), genuinely-broken files fail loud with a clear message — never a
    silent wrong number.
85. **Extensibility.** Adding a channel (Instamart) is a parser + a fee row, with
    zero changes to the engine or the views — channel is a first-class dimension
    everywhere.
86. **Durability.** History accumulates correctly across many irregular uploads
    over months; nothing is lost, nothing double-counts, the store stays within
    its budget.

---

## XII · FOUNDER-FIT — "WOULD I LIVE IN THIS?"
*The synthesis test that no feature list can fake.*

87. **Daily-habit fit.** Is this the first thing the founder opens each morning,
    and does it answer "how are we doing and what needs me today" immediately?
88. **Completeness of the picture.** Sales, margin, ads, retention, returns, and
    their interplay form ONE coherent picture of the business, not three
    disconnected dashboards.
89. **Nothing left on the table.** Every meaningful analysis the available data
    could support is either built or consciously, visibly deferred — the reviewer
    hunts for unexploited signal and finds none.
90. **Calm confidence.** The founder trusts it enough to make money decisions
    from it, and it makes a complex multi-channel business feel legible rather
    than overwhelming.

---

*Use: a fresh-context founder-analyst runs the tool against the real data,
cross-checks numbers against the raw sheets, lands cold on each screen, hunts for
left-on-the-table signal, and judges the tool against each parameter above —
describing, per parameter, where it stands relative to the 100× bar and what
specifically would move it closer.*
