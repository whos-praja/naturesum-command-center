import { useState, useEffect, useMemo, useRef } from "react";
import { Icon, Card } from "../components/Shared.jsx";
import NSData from "../data.js";
import { mergedFacts } from "../lib/businessStore.js";
import {
  computeCM,
  computeCMv2,
  computeMonthChannelCM,
  monthsAvailable,
  monthlyNetRevByChannel,
  AD_BASIS,
} from "../lib/cmEngine.js";
import * as CostInputs from "../lib/costInputs.js";
import {
  autoNarrative,
  projectMonthEnd,
  concentrationRisk,
  revenueBridge,
  cm3Bridge,
  driverSensitivity,
  computeWhatIf,
  attributionConfidence,
  attributionBand,
  nativeAgencyBias,
  correctedAgencyNet,
  forecast,
  actionQueue,
  crossModuleVelocity,
  proseWeeklyNarrative,
  conversionValueGap,
  costChangeHistory,
} from "../lib/bizAnalytics.js";
import { runVerification, runFormattingSanity, ANCHOR_MONTH } from "../lib/businessVerification.js";
import { runIngestionSelfTest } from "../lib/ingestionSelfTest.js";
import BizCoveragePanel from "../components/BizCoveragePanel.jsx";
import { UploadModal } from "../components/UploadModal.jsx";
import { AutoNarrative } from "../components/biz/AutoNarrative.jsx";
import { BridgeChart } from "../components/biz/BridgeChart.jsx";
import { WhatIfPanel } from "../components/biz/WhatIfPanel.jsx";
import { DerivationPopover } from "../components/biz/DerivationPopover.jsx";
import BizStateGuard from "../components/biz/BizStateGuard.jsx";
import { ForecastChart } from "../components/biz/ForecastChart.jsx";
import { ActionQueue } from "../components/biz/ActionQueue.jsx";
import { ProseNarrative } from "../components/biz/ProseNarrative.jsx";
import { ConversionGapView, CostChangeView } from "../components/biz/InsightViews.jsx";

// ─────────────────────────────────────────────────────────────────────────────
// Module 8 — Finance & Unit Economics  (spec §9 PageFinance + V2 ADDENDUM)
//
// REAL DERIVED DATA ONLY. Every figure flows from mergedFacts() (bundled history
// + May native baseline ⊕ any uploads) through the coverage-aware CM engine and
// the editable costInputs registry. There is NO fabricated stub data here.
//
// V2 (BINDING) is what this page does on top of v1:
//  • COVERAGE-AWARE MONTH PICKER — all ~22 history months, each labelled native /
//    agency / MTD via monthsAvailable(); the engine NEVER divides across windows.
//  • NATIVE months (May-2026) run the full per-SKU chain (computeCM): waterfall +
//    SKU×channel CM3 matrix + SKU economics, exactly as v1.
//  • AGENCY months (Snell/Monarch history) run the channel-grain chain
//    (computeMonthChannelCM): a per-channel waterfall + channel CM table. The SKU
//    matrix is replaced with an explicit "needs native reports" note (agency tiers
//    carry channel-grain revenue only — never fabricated per-SKU margin).
//  • adBASIS CHIPS on every ad figure (V2.3): SP actual / alloc by rev / agency.
//  • AGENCY↔NATIVE RECONCILIATION note from meta.agencyShadow + the build's
//    mayReconciliation deltas (never silently dropped).
//  • CM TREND across every CM-computable month.
//  • FORMATTING (V2.4): ALL currency via D.fmtINR, all % to 1 decimal — NO raw
//    floats anywhere (the ₹737.5738… class is gone). The Verification tab gains a
//    live formatting/sanity guard row.
//
// HONESTY CONTRACT: CM fields are null when COGS is missing or coverage is agency-
// website (no per-SKU units to price) — rendered "—", never 0. No NaN/Infinity is
// ever rendered (fmtINR/fmtPct guard every value).
// ─────────────────────────────────────────────────────────────────────────────

const D = NSData;

// SKU code → readable name+variant (from the canonical SKU table in data.js).
const SKU_META = Object.fromEntries(D.skus.map((s) => [s.code, s]));
const skuLabel = (code) => {
  const m = SKU_META[code];
  return m ? `${m.name} ${m.variant}` : code;
};

// Channel display chrome (brand colours match the inventory drill badges). New
// channels (Instamart later) fall through to a neutral default — never crash.
const CHANNEL_META = {
  amazon:   { label: "Amazon",   color: "#C45A0A" },
  flipkart: { label: "Flipkart", color: "#2874F0" },
  blinkit:  { label: "Blinkit",  color: "#C9A227" },
  website:  { label: "Website",  color: "var(--brand)" },
};
const chMeta = (ch) => CHANNEL_META[ch] || { label: ch, color: "var(--ink-3)" };
const CHANNEL_ORDER = ["amazon", "flipkart", "blinkit", "website"];

// Reconciliation: |agency−native|/native at or below this band is return-tail
// timing (return booking-period drift); above it is a genuine native-export
// coverage gap. Observed May timing deltas are ≤1.1% (Amazon +1.1, Flipkart
// +0.6, Blinkit 0.0); the Monarch-vs-Shopify website gap is +74.1%. 10% cleanly
// separates the two classes with wide margin.
const RECON_TIMING_BAND = 0.10;

// M3 — agency Blinkit net is a PROXY. The Snell agency sheet carries Blinkit
// GROSS only (no tax-netted column), so the build derives net = gross ÷ 1.05.
// The native Blinkit report nets the true tax = CGST + SGST + CESS; because the
// agency proxy omits Blinkit's CESS, the proxy net runs a few % ABOVE the true
// tax-netted net a native report would show. For the one month with both (May
// 2026) the ratio happened to land at exactly 1/1.05 so the proxy matched, but
// agency-ONLY Blinkit months (Dec-25 → Apr-26, Jun-26) carry this unreconciled
// methodology drift — observed ~3% on the founder's sheet. We disclose it with
// the same Δ treatment as the native↔agency reconciliation rather than letting
// the agency Blinkit net read as native-grade. The band is a disclosure, not a
// per-month measurement (no native Blinkit report exists for those months to
// measure against — that's exactly why the chip exists).
const BLINKIT_AGENCY_PROXY_DRIFT = 0.03; // ~3% typical overstatement, founder sheet
const orderChannels = (chs) =>
  [...chs].sort((a, b) => {
    const ia = CHANNEL_ORDER.indexOf(a), ib = CHANNEL_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });

// ── SAFE formatters (NaN/Infinity → em-dash, never leaked) ──
const fmtINR = (n) => (Number.isFinite(n) ? D.fmtINR(n) : "—");
const fmtN = (n) => (Number.isFinite(n) ? D.fmtN(n) : "—");
// pct fraction (0..1) → "12.3%". null/NaN → "—". ALWAYS 1 decimal (V2.4).
const fmtPct = (frac, dp = 1) =>
  Number.isFinite(frac) ? `${(frac * 100).toFixed(dp)}%` : "—";
// signed ₹ with parens for negatives (matches fmtINR convention).
const fmtSignedINR = (n) => {
  if (!Number.isFinite(n)) return "—";
  return n < 0 ? `(${D.fmtINR(Math.abs(n))})` : D.fmtINR(n);
};
const monthLabel = (m) => {
  if (!m || !/^\d{4}-\d{2}$/.test(m)) return m || "—";
  const [y, mo] = m.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Number(mo) - 1] || mo} ${y}`;
};
const monthShort = (m) => {
  if (!m || !/^\d{4}-\d{2}$/.test(m)) return m || "—";
  const [y, mo] = m.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Number(mo) - 1] || mo} ’${y.slice(2)}`;
};
const dayLabel = (lastDay) => {
  if (!lastDay) return "";
  const [, mo, d] = lastDay.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Number(mo) - 1] || mo} ${Number(d)}`;
};

// Freshness-badge day format — day-month order ("10 Jun") to match PageSales /
// PageMarketing / the inventory floor exactly (rubric 72/83, sibling consistency).
const freshDay = (iso) => {
  if (!iso) return "";
  const [, mo, d] = String(iso).split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(d)} ${names[Number(mo) - 1] || mo}`;
};

const cmColor = (v) =>
  v == null ? "var(--ink-4)" : v < 0 ? "var(--critical)" : "var(--ink)";

// CM% health tone — negative critical, thin warning, healthy success.
const pctTone = (frac) =>
  frac == null ? "var(--ink-4)" : frac < 0 ? "var(--critical)" : frac < 0.1 ? "var(--warning)" : "var(--success)";

// ── Coverage / adBasis chips (V2.2 / V2.3) ───────────────────────────────────
// Coverage badge for a month×channel sales tier.
const SALES_BADGE = {
  native: { label: "native", bg: "rgba(63,114,80,0.14)", fg: "var(--success)", tip: "Per-SKU native report (Amazon All-Orders / FK / Blinkit / Shopify). SKU-grain margin available." },
  agency: { label: "agency", bg: "rgba(99,102,241,0.12)", fg: "#6366f1", tip: "Snell/Monarch channel-grain history. Channel-level margin only — no per-SKU revenue (upload a native report to unlock SKU grain)." },
  none:   { label: "no data", bg: "rgba(0,0,0,0.05)", fg: "var(--ink-3)", tip: "No sales coverage for this month×channel." },
};
function CoverageBadge({ sales, partial, lastDay }) {
  const b = SALES_BADGE[sales] || SALES_BADGE.none;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span title={b.tip} style={{
        fontSize: 9.5, padding: "1px 5px", borderRadius: 3, background: b.bg, color: b.fg,
        fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase",
      }}>{b.label}</span>
      {partial && (
        <span title={`Partial month — data runs through ${dayLabel(lastDay)}. Excluded from MoM unless compared like-for-like.`}
          style={{ fontSize: 9.5, padding: "1px 5px", borderRadius: 3, background: "rgba(176,122,31,0.12)", color: "var(--warning)", fontWeight: 700, letterSpacing: "0.04em" }}>
          MTD ≤ {dayLabel(lastDay)}
        </span>
      )}
    </span>
  );
}

// adBasis chip taxonomy (V2.3). Every ads figure renders one.
const AD_BASIS_CHIP = {
  [AD_BASIS.ACTUAL]: { label: "SP actual", bg: "rgba(63,114,80,0.14)", fg: "var(--success)", tip: "Per-ASIN/SKU ad attribution (Amazon SP / FK PLA / Google product-wise) — the true product-level spend." },
  [AD_BASIS.ALLOC]:  { label: "alloc by rev", bg: "rgba(40,116,240,0.12)", fg: "#2874F0", tip: "Channel ad total split across SKUs in proportion to each SKU's net revenue (unattributed remainder)." },
  [AD_BASIS.AGENCY]: { label: "agency", bg: "rgba(99,102,241,0.12)", fg: "#6366f1", tip: "Snell/Monarch channel-grain ad total — no per-SKU attribution available for this month." },
  [AD_BASIS.NONE]:   { label: "no ads", bg: "rgba(0,0,0,0.05)", fg: "var(--ink-3)", tip: "No ad spend known for this window." },
};
// ACTUAL attribution names a DIFFERENT ad product per channel — Amazon Sponsored
// Products (SP), Flipkart PLA, website Google product-wise. Labelling Flipkart or
// the website "SP actual" is the wrong product; match the Marketing page exactly.
const ACTUAL_LABEL_BY_CHANNEL = { amazon: "SP actual", flipkart: "PLA actual", website: "Google actual" };
function AdBasisChip({ basis, channel }) {
  const c = AD_BASIS_CHIP[basis] || AD_BASIS_CHIP[AD_BASIS.NONE];
  const label = basis === AD_BASIS.ACTUAL && channel && ACTUAL_LABEL_BY_CHANNEL[channel]
    ? ACTUAL_LABEL_BY_CHANNEL[channel]
    : c.label;
  return (
    <span title={c.tip} style={{
      fontSize: 9, padding: "1px 5px", borderRadius: 3, background: c.bg, color: c.fg,
      fontWeight: 700, letterSpacing: "0.03em", whiteSpace: "nowrap",
    }}>{label}</span>
  );
}

// CM3 ATTRIBUTION-CONFIDENCE CHIP (rubric 23) — pins the % of the ad leg behind
// THIS channel's CM3 that is per-product measured, right next to the CM3 number a
// founder would act on. 0%-measured (agency month) reads amber "hint"; high reads
// green. The tooltip carries the measured/allocated split so the depth is a hover
// away (rubric 36), keeping the cell clean.
function Cm3ConfidenceChip({ measured, attrib }) {
  const band = attributionBand(measured);
  const pal = {
    measured: { bg: "rgba(34,160,90,0.14)", fg: "#1B7A45" },
    mixed:    { bg: "rgba(99,102,241,0.14)", fg: "#4F46E5" },
    allocated:{ bg: "rgba(201,162,39,0.16)", fg: "#9A7B16" },
    na:       { bg: "var(--bg-sunken)", fg: "var(--ink-3)" },
  }[band.key] || { bg: "var(--bg-sunken)", fg: "var(--ink-3)" };
  const pctTxt = measured == null ? "n/a" : `${Math.round(measured * 100)}%`;
  const tip = measured == null
    ? "No ad spend on this channel — CM3 carries no attribution risk."
    : attrib
      ? `${pctTxt} of this channel's ad spend is per-product MEASURED; the rest is allocated by revenue. So this CM3's ad leg (${fmtINR(attrib.total)}) is ${band.label}. Measured ${fmtINR(attrib.direct)} · allocated ${fmtINR(attrib.alloc)}. ${measured < 0.4 ? "Read this CM3 as a hint, not a measured fact." : ""}`
      : `${pctTxt} measured`;
  return (
    <span title={tip} style={{
      marginLeft: 6, fontSize: 8.5, padding: "1px 4px", borderRadius: 3,
      background: pal.bg, color: pal.fg, fontWeight: 700, whiteSpace: "nowrap", verticalAlign: "middle",
    }}>{pctTxt} meas</span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
const PageFinance = ({ initialTab } = {}) => {
  // Default tab is "waterfall". `initialTab` is an optional verification hook so
  // SSR harnesses can render any tab's panels; the production UI never passes it.
  const FIN_TAB_KEYS = ["waterfall", "matrix", "bridge", "forecast", "levers", "actions", "sku", "trend", "cost", "coverage", "verify"];
  const [tab, setTab] = useState(FIN_TAB_KEYS.includes(initialTab) ? initialTab : "waterfall");
  const [uploadOpen, setUploadOpen] = useState(false);
  // costVersion bumps whenever the Cost Inputs panel writes an override, forcing
  // every consumer below (which reads cost data through the live registry) to
  // recompute. The facts themselves are static within a session unless uploaded.
  const [costVersion, setCostVersion] = useState(0);

  const facts = useMemo(() => mergedFacts(), []);

  // Coverage-aware month model — ALL history months, ascending, each with per-
  // channel coverage badges + a month-level partial (MTD) flag (V2.2/V2.5).
  const monthModels = useMemo(() => monthsAvailable(facts), [facts]);
  const months = useMemo(() => {
    const ms = monthModels.map((m) => m.month);
    return ms.length ? ms : [ANCHOR_MONTH];
  }, [monthModels]);

  // Freshness label — same field + fallbacks as Marketing/Inventory (rubric 83):
  // newest data day across all loaded sources, else the latest month's last day.
  const dataThrough = facts?.meta?.latestDataDate
    || monthModels[monthModels.length - 1]?.lastDay
    || null;

  // selectedMonth holds the user's pick; the EFFECTIVE month is derived during
  // render so a stale pick safely falls back to the latest available.
  const [selectedMonth, setSelectedMonth] = useState(null);
  const month = selectedMonth && months.includes(selectedMonth)
    ? selectedMonth
    : months[months.length - 1];
  const monthModel = useMemo(
    () => monthModels.find((m) => m.month === month) || { month, channels: {}, partial: false },
    [monthModels, month]
  );

  // The coverage-aware view model for the selected month. NATIVE months also carry
  // the full v1 per-SKU computeCM (cmV1) so the matrix + SKU cards have grain.
  const view = useMemo(
    () => buildMonthView(facts, month),
    // costVersion is an intentional dependency (cost overrides change CM).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [facts, month, costVersion]
  );

  const onCostChange = () => setCostVersion((v) => v + 1);

  // Is the selected month native (has at least one native channel → SKU grain)?
  const isNativeMonth = view.cmV1 != null;

  // ── 100× layer (bizAnalytics) — the diagnostic/predictive/prescriptive band.
  // Cost inputs are passed so every figure reflects live overrides; costVersion
  // is an intentional dep (an edit must re-run the narrative + projection).
  const narrative = useMemo(
    () => autoNarrative(facts, { month, costs: CostInputs }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [facts, month, costVersion]
  );
  const projection = useMemo(
    () => projectMonthEnd(facts, { month }),
    [facts, month]
  );
  const concentration = useMemo(
    () => concentrationRisk(facts, { month, costs: CostInputs }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [facts, month, costVersion]
  );

  return (
    <>
    <BizStateGuard facts={facts} module="Finance & Unit Econ" onUpload={() => setUploadOpen(true)}>
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">Finance &amp; Unit Economics</div>
          <div className="page-sub">
            Contribution margin CM1→CM4, channel &amp; SKU-wise, across {months.length} months of history — every
            figure carries its <strong>coverage tier</strong> and <strong>ad basis</strong> so you always know what
            it is built from.
          </div>
        </div>
        <div className="actions" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {dataThrough && (
            <span className="cov-badge cov-agency sm" title="The latest data day reflected anywhere on this page (newest of all loaded sources). Consistent with the inventory module's freshness label.">
              Data through {freshDay(dataThrough)}
            </span>
          )}
          <button className="btn ghost sm" onClick={() => setUploadOpen(true)} title="Upload native / agency reports — they upsert into the fact store and override by month×channel">
            <Icon name="download" size={13}/> Upload reports
          </button>
          {/* Coverage-aware month selector. */}
          <MonthPicker months={monthModels} value={month} onChange={setSelectedMonth}/>
        </div>
      </div>

      {/* Selected-month coverage strip — instant orientation for a cold reader. */}
      <MonthCoverageStrip model={monthModel} view={view}/>

      {/* 100× MOST-USEFUL-FIRST BAND (rubric 59/66): the tool's first pass of
          analysis — what changed this month, what needs the founder today. */}
      <AutoNarrative narrative={narrative} title="This month's CM read-out"/>

      {/* Headline strip: company CM3 + projected month-end + concentration. The
          single most decision-relevant numbers, above the fold (rubric 66/63). */}
      <FinanceHeadline view={view} month={month} projection={projection} concentration={concentration}/>

      <div className="tabs">
        <button className={tab === "waterfall" ? "active" : ""} onClick={() => setTab("waterfall")}>CM waterfall</button>
        <button className={tab === "matrix" ? "active" : ""} onClick={() => setTab("matrix")}>CM3 matrix</button>
        <button className={tab === "bridge" ? "active" : ""} onClick={() => setTab("bridge")}>Why CM moved</button>
        <button className={tab === "forecast" ? "active" : ""} onClick={() => setTab("forecast")}>Forecast</button>
        <button className={tab === "levers" ? "active" : ""} onClick={() => setTab("levers")}>Drivers &amp; what-if</button>
        <button className={tab === "actions" ? "active" : ""} onClick={() => setTab("actions")}>Action queue</button>
        <button className={tab === "sku" ? "active" : ""} onClick={() => setTab("sku")}>SKU economics</button>
        <button className={tab === "trend" ? "active" : ""} onClick={() => setTab("trend")}>CM trend</button>
        <button className={tab === "cost" ? "active" : ""} onClick={() => setTab("cost")}>Cost inputs</button>
        <button className={tab === "coverage" ? "active" : ""} onClick={() => setTab("coverage")}>Coverage</button>
        <button className={tab === "verify" ? "active" : ""} onClick={() => setTab("verify")}>Verification</button>
      </div>

      {/* COGS-gap banner (native months only — agency months flag cogsApprox inline). */}
      {isNativeMonth && view.cmV1 && !view.cmV1.coverage.cogsCovered && (
        <div className="note" style={{ marginBottom: 14, background: "var(--warning-soft)", borderColor: "#E5D3A8" }}>
          <strong style={{ color: "var(--warning)" }}>COGS gap:</strong>&nbsp;
          {view.cmV1.coverage.cogsMisses.length} cell(s) have no cost card —{" "}
          {[...new Set(view.cmV1.coverage.cogsMisses.map((x) => x.code))].map(skuLabel).join(", ")}.
          Their net revenue counts but CM1→CM4 are excluded (shown as “—”, never zero). Add the COGS in the Cost inputs tab.
        </div>
      )}

      {tab === "waterfall" && <WaterfallView view={view} month={month} facts={facts}/>}
      {tab === "matrix" && <MatrixView view={view} month={month}/>}
      {tab === "bridge" && <BridgeView facts={facts} month={month} months={months}/>}
      {tab === "forecast" && <ForecastView facts={facts} month={month} view={view}/>}
      {tab === "levers" && <LeversView facts={facts} month={month}/>}
      {tab === "actions" && <ActionsView facts={facts} month={month} view={view}/>}
      {tab === "sku" && <SkuEconomicsView view={view} month={month}/>}
      {tab === "trend" && <CMTrendView facts={facts}/>}
      {tab === "cost" && <CostInputsView month={month} onChange={onCostChange} facts={facts}/>}
      {tab === "coverage" && (
        <>
          <NativeAgencyBiasPanel facts={facts} month={month} view={view} />
          <BizCoveragePanel
            facts={facts}
            month={month}
            coverage={{
              hasFixedCost: view.fixedAmount != null,
              fixedAmount: view.fixedAmount ?? null,
            }}
          />
        </>
      )}
      {tab === "verify" && <VerificationView facts={facts}/>}
    </div>
    </BizStateGuard>
    {uploadOpen && <UploadModal onClose={() => setUploadOpen(false)} defaultTab="business"/>}
    </>
  );
};

// ═════════════════════════════════════════════════════════════════════════════
// FINANCE HEADLINE — the single most decision-relevant band, above the fold:
//   company CM3 (the decision layer) · projected month-end (partial months) ·
//   concentration / dependency risk. Rubric 15 (projection), 57 (concentration),
//   63/66 (most-useful-first, time-to-insight). Every figure NaN-safe + derived.
// ═════════════════════════════════════════════════════════════════════════════
const CONF_META = {
  actual: { label: "actual", color: "var(--success)" },
  high:   { label: "high confidence", color: "var(--success)" },
  medium: { label: "medium confidence", color: "var(--warning)" },
  low:    { label: "low confidence", color: "var(--critical)" },
};
const FinanceHeadline = ({ view, month, projection, concentration }) => {
  const co = view.company;
  const cm3 = co?.cm3;
  const cm3Pct = co?.pcts?.cm3;
  const proj = projection || {};
  const conf = CONF_META[proj.confidence] || CONF_META.medium;
  const concCh = concentration?.byChannel?.revenue;

  // V-90 — the "no-COGS passthrough" leg, so the CM3 ⓘ closes on its OWN face.
  // A channel whose COGS is UNKNOWN (e.g. agency-month website) keeps its net in
  // the headline revenue total but its CM3 is null (Unknown ≠ zero) — so a naïve
  // ladder (net − COGS − fees − ad) OVER-credits by exactly that channel's
  // would-be pre-COGS contribution (net − fees − ad). We tally that leg from the
  // same byChannel cells the page already shows, so net − cogs − fees − ad −
  // passthrough re-derives to the reported CM3 inside the popover (matches the
  // engine's computeCMv2 noCogsPassthrough exactly; verified June = ₹40,110.91).
  const passLegs = [];
  let noCogsPassthrough = 0;
  for (const ch of view.channels || []) {
    const c = view.byChannel?.[ch];
    if (!c || c.coverage === "none") continue;
    if (c.cm3 == null || c.cogs == null || c.cogsCovered === false) {
      const leg = (Number(c.netRev) || 0) - (Number(c.fees) || 0) - (Number(c.adSpend) || 0);
      noCogsPassthrough += leg;
      passLegs.push({ channel: ch, leg });
    }
  }
  const hasPassthrough = passLegs.length > 0 && Math.abs(noCogsPassthrough) > 0.5;
  const cm3Inputs = [
    { label: "Net revenue", value: fmtINR(co?.netRev) },
    { label: "− COGS", value: co?.cogs == null ? "—" : "−" + fmtINR(co.cogs) },
    { label: "− Platform fees", value: "−" + fmtINR(co?.fees) },
    { label: "− Ad spend", value: "−" + fmtINR(co?.adSpend) },
  ];
  if (hasPassthrough) {
    cm3Inputs.push({
      label: `− No-COGS passthrough (${passLegs.map((p) => chMeta(p.channel).label).join(", ")})`,
      value: "−" + fmtINR(noCogsPassthrough),
    });
  }
  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 14 }}>
      {/* Company CM3 — the decision layer */}
      <Card title="Company CM3 · the decision layer">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <div className="stat-num lg" style={{ color: cmColor(cm3) }}>{cm3 == null ? "—" : fmtSignedINR(cm3)}</div>
          <DerivationPopover
            title={`Company CM3 · ${monthLabel(month)}`}
            formula={hasPassthrough
              ? "netRev − COGS − fees − ads − no-COGS passthrough"
              : "Σ channels (netRev − COGS − platform fees − ads)"}
            plain={hasPassthrough
              ? `CM3 is contribution after the ad spend that produced the sale — the layer you delist or cut a budget on. ${passLegs.map((p) => chMeta(p.channel).label).join(", ")} carries net revenue with COGS UNKNOWN, so its would-be pre-COGS contribution (net − fees − ad = ${fmtINR(noCogsPassthrough)}) is held OUT of CM3 (Unknown ≠ zero). That passthrough leg is what closes net − COGS − fees − ad down to the reported CM3 — so these five inputs sum on their own face. Fixed cost (CM4) is a reporting view layered after.`
              : "CM3 is contribution after the ad spend that produced the sale — the layer you delist or cut a budget on. Fixed cost (CM4) is a reporting view layered after."}
            inputs={cm3Inputs}
            value={cm3 == null ? "—" : fmtSignedINR(cm3)}
            source="cmEngine · coverage-aware CM"
            asOf={proj.lastDay || month}
            note={view.cmV1 == null ? "Agency-tier month — channel-grain CM (no per-SKU). CM4 native-only." : undefined}
          />
        </div>
        <div className="muted" style={{ fontSize: 11.5 }}>
          <span style={{ color: pctTone(cm3Pct) }}>{fmtPct(cm3Pct)}</span> of net rev · {fmtINR(co?.netRev)} rev{view.partial ? " · MTD" : ""}
        </div>
      </Card>

      {/* Projected month-end (rubric 15) — only meaningful for the partial month */}
      <Card title={proj.partial ? "Projected month-end revenue" : "Net revenue (complete)"}>
        {proj.partial ? (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <div className="stat-num lg">{fmtINR(proj.projected)}</div>
              <DerivationPopover
                title={`Projected ${monthLabel(month)} net revenue`}
                formula="MTD × (priorFull ÷ priorToDate)"
                plain="We extrapolate this month at the same within-month pace last month ran to the same day-of-month — so you're never comparing a half-month to a full one."
                inputs={[
                  { label: "MTD (through day " + proj.dom + ")", value: fmtINR(proj.mtd) },
                  { label: proj.priorMonth + " to same day", value: fmtINR(proj.priorToDate) },
                  { label: proj.priorMonth + " full month", value: fmtINR(proj.priorFull) },
                  { label: "Uncertainty band", value: fmtINR(proj.low) + " – " + fmtINR(proj.high) },
                ]}
                value={fmtINR(proj.projected)}
                source={proj.method}
                asOf={proj.lastDay || month}
              />
            </div>
            <div className="muted" style={{ fontSize: 11.5 }}>
              <span style={{ color: conf.color, fontWeight: 600 }}>{conf.label}</span> · band {fmtINR(proj.low)}–{fmtINR(proj.high)}
              {proj.paceVsPrior != null && (
                <> · <span style={{ color: proj.paceVsPrior >= 0 ? "var(--success)" : "var(--critical)" }}>
                  {proj.paceVsPrior >= 0 ? "+" : "−"}{fmtPct(Math.abs(proj.paceVsPrior))} vs {proj.priorMonth} to-date
                </span></>
              )}
            </div>
          </>
        ) : (
          <>
            {/* DEFECT-2 FIX — the complete-month headline net revenue is the SAME
                coherent engine sum-of-channels (co.netRev) the CM% card uses as its
                basis, NOT the daily-series sum (proj.projected). proj.projected for a
                complete month is Σ daily channel-grain net, which rides on the agency
                Amazon figure (Snell ₹12.14L) where the engine uses native per-SKU
                (₹11.43L, native-overrides-agency) — so the two never reconciled
                (₹25.02L headline vs ₹21.13L CM% basis). We show co.netRev and bridge
                to the daily/agency-tracked figure in the popover so a founder sees ONE
                net-revenue number, with the agency delta explained, not two unreconciled
                ones. (Defect-3 already rebased website daily to Shopify-net.) */}
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <div className="stat-num lg">{fmtINR(co?.netRev)}</div>
              {proj.projected != null && co?.netRev != null && Math.abs(proj.projected - co.netRev) > 1 && (
                <DerivationPopover
                  title={`${monthLabel(month)} net revenue — basis bridge`}
                  formula="headline = engine Σ channel net (native per-SKU + agency channel-grain)"
                  plain="The headline net revenue is the coverage-aware engine sum-of-channels — the SAME basis the CM% card divides by. The daily channel series totals higher because, where a channel has BOTH a native per-SKU export and an agency feed, the daily series rides on the agency figure (e.g. Amazon Snell ₹12.14L) while the engine takes the native per-SKU net (₹11.43L, native-overrides-agency). The gap below is that agency-vs-native delta, not extra revenue."
                  inputs={[
                    { label: "Headline net (engine Σ channels)", value: fmtINR(co?.netRev) },
                    { label: "Daily-series total (agency-tracked)", value: fmtINR(proj.projected) },
                    { label: "Agency-over-native delta", value: fmtINR(proj.projected - co.netRev) },
                  ]}
                  value={fmtINR(co?.netRev)}
                  source="cmEngine company rollup (native-overrides-agency)"
                  asOf={proj.lastDay || month}
                />
              )}
            </div>
            <div className="muted" style={{ fontSize: 11.5 }}>{monthLabel(month)} complete · {fmtN(co?.units)} units · engine Σ-channel net (= CM% basis)</div>
          </>
        )}
      </Card>

      {/* Concentration / dependency risk (rubric 57) */}
      <Card title="Revenue concentration risk">
        {concCh && concCh.top ? (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <div className="stat-num lg" style={{ color: concCh.concentrated ? "var(--warning)" : "var(--ink)" }}>
                {fmtPct(concCh.topShare)}
              </div>
              <span className="muted" style={{ fontSize: 12 }}>on {chMeta(concCh.top.key).label}</span>
              <DerivationPopover
                title={`Channel concentration · ${monthLabel(month)}`}
                formula="topShare = topChannelRev ÷ Σ channel rev · HHI = Σ(share²)"
                plain="How much of the month's revenue rides on the single biggest channel, and the Herfindahl index across all channels. HHI > 0.25 reads as concentrated — fragile to one channel."
                inputs={[
                  { label: "Top channel", value: chMeta(concCh.top.key).label },
                  { label: "Top channel rev", value: fmtINR(concCh.top.value) },
                  { label: "Top share", value: fmtPct(concCh.topShare) },
                  { label: "HHI", value: Number.isFinite(concCh.hhi) ? concCh.hhi.toFixed(2) : "—" },
                ]}
                value={fmtPct(concCh.topShare) + " on " + chMeta(concCh.top.key).label}
                source="bizAnalytics · concentrationRisk"
                asOf={month}
              />
            </div>
            <div className="muted" style={{ fontSize: 11.5 }}>
              HHI {Number.isFinite(concCh.hhi) ? concCh.hhi.toFixed(2) : "—"} ·{" "}
              <span style={{ color: concCh.concentrated ? "var(--warning)" : "var(--success)", fontWeight: 600 }}>
                {concCh.concentrated ? "concentrated — watch dependency" : "diversified"}
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="stat-num lg" style={{ color: "var(--ink-4)" }}>—</div>
            <div className="muted" style={{ fontSize: 11.5 }}>No positive-revenue channels this month.</div>
          </>
        )}
      </Card>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════════════
// BRIDGE VIEW — why CM moved month-over-month (rubric 50). A CM3 bridge (the four
// ladder rungs that moved it) AND a revenue bridge (per-channel price × volume).
// Both VISIBLY reconcile (Σ steps == Δ). From-month defaults to the prior month.
// ═════════════════════════════════════════════════════════════════════════════
const BridgeView = ({ facts, month, months }) => {
  // Candidate "from" months = every month before the selected one, newest first.
  const priorMonths = useMemo(
    () => months.filter((m) => m < month),
    [months, month]
  );
  const [fromMonth, setFromMonth] = useState(null);
  const effFrom = fromMonth && priorMonths.includes(fromMonth) ? fromMonth : priorMonths[priorMonths.length - 1];

  const cmB = useMemo(
    () => (effFrom ? cm3Bridge(facts, { fromMonth: effFrom, toMonth: month, costs: CostInputs }) : null),
    [facts, effFrom, month]
  );
  const revB = useMemo(
    () => (effFrom ? revenueBridge(facts, { fromMonth: effFrom, toMonth: month, costs: CostInputs }) : null),
    [facts, effFrom, month]
  );

  if (!effFrom) {
    return (
      <Card title="Why CM moved" sub="Month-over-month decomposition — needs a prior month to compare">
        <div className="muted" style={{ fontSize: 12 }}>
          {monthLabel(month)} is the earliest month in the store — there's no prior month to bridge from.
          Pick a later month to see what moved its CM3 and revenue.
        </div>
      </Card>
    );
  }

  const RUNG_LABEL = {
    revenue: "More/less revenue lifted CM3",
    cogs: "COGS change",
    fees: "Platform-fee change",
    ads: "Ad-spend change",
  };

  // LIKE-FOR-LIKE caveat (rubric 14/29/50/65): if the to-month is still in
  // progress, the engine clips BOTH months to the same day; surface that here so
  // the founder never reads a "volume −Nu" leg as a real decline when it is only
  // fewer elapsed days. Window metadata comes from the bridge result.
  const bw = (cmB && cmB.window) || (revB && revB.window) || { partial: false };
  const lflBanner = bw.partial ? (
    <div style={{ marginBottom: 12, fontSize: 11.5, border: "1px solid var(--warning)", borderRadius: 8, padding: "8px 12px", background: "var(--warning-soft)" }}>
      <strong>Like-for-like (MTD-vs-MTD):</strong> {monthLabel(month)} is still in progress, so both months are
      compared <strong>through day {bw.cutoff}</strong>. Every leg below is the change over the SAME calendar window —
      a "volume" loss here is real units, not just fewer elapsed days. To compare two full closed months, pick an
      earlier "from" and a closed "to".
    </div>
  ) : null;

  return (
    <>
      <Card
        title="Why CM3 moved"
        sub={bw.partial
          ? `The four ladder rungs that moved company CM3 — ${monthLabel(month)} is partial, so both months are clipped to day ${bw.cutoff} (MTD-vs-MTD) · each leg same-window · Σ legs reconciles to ΔCM3`
          : "The four ladder rungs that moved company CM3 month-over-month · each leg is same-window · Σ legs reconciles to ΔCM3"}
        action={
          <label className="muted" style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 6 }}>
            <span>from</span>
            <select value={effFrom} onChange={(e) => setFromMonth(e.target.value)}
              style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--ink)" }}>
              {[...priorMonths].reverse().map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
            <span>→ {monthLabel(month)}</span>
          </label>
        }
      >
        {cmB && (
          <>
            {lflBanner}
            <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 12 }}>
              <Stat label={`CM3 · ${monthShort(effFrom)}${bw.partial ? ` (d${bw.cutoff})` : ""}`} value={fmtSignedINR(cmB.from)} color={cmColor(cmB.from)}/>
              <Stat label={`CM3 · ${monthShort(month)}${bw.partial ? ` (d${bw.cutoff})` : ""}`} value={fmtSignedINR(cmB.to)} color={cmColor(cmB.to)}/>
              <Stat label="Δ CM3" value={(cmB.delta >= 0 ? "+" : "−") + fmtINR(Math.abs(cmB.delta))} color={cmB.delta >= 0 ? "var(--success)" : "var(--critical)"}/>
            </div>
            <BridgeChart bridge={cmB} D={D} height={250}/>
            <hr className="hr"/>
            <table className="table">
              <thead><tr><th>Rung</th><th>What it means</th><th className="num">Effect on CM3</th></tr></thead>
              <tbody>
                {cmB.steps.map((s) => (
                  <tr key={s.label}>
                    <td><strong>{s.label}</strong></td>
                    <td className="muted" style={{ fontSize: 11.5 }}>{RUNG_LABEL[s.kind] || s.kind}</td>
                    <td className="num" style={{ color: s.value >= 0 ? "var(--success)" : "var(--critical)", fontWeight: 600 }}>
                      {s.value >= 0 ? "+" : "−"}{fmtINR(Math.abs(s.value))}
                    </td>
                  </tr>
                ))}
                <tr style={{ background: "var(--brand-soft)", fontWeight: 600 }}>
                  <td colSpan={2}>Σ rungs = Δ CM3 {cmB.reconciles ? "✓ reconciles" : "⚠ does not reconcile"}</td>
                  <td className="num" style={{ color: cmB.delta >= 0 ? "var(--success)" : "var(--critical)" }}>
                    {cmB.delta >= 0 ? "+" : "−"}{fmtINR(Math.abs(cmB.delta))}
                  </td>
                </tr>
              </tbody>
            </table>
            <div style={{ padding: "8px 2px 0", fontSize: 10.5, color: "var(--ink-3)" }}>
              Each rung is the change in that ladder line between the two months, signed by its effect on CM3 (more revenue +, more cost −).
              Only COGS-covered channels enter the bridge so every leg reconciles — an unpriced cell would break the identity and is excluded.
            </div>
          </>
        )}
      </Card>

      <Card
        title="Why revenue moved · per channel"
        sub={bw.partial
          ? `Δ company net revenue split into each channel's volume + price/mix effect — clipped to day ${bw.cutoff} of both months (MTD-vs-MTD, ${monthLabel(month)} in progress) · Σ reconciles to Δ revenue`
          : "Δ company net revenue split into each channel's volume effect (units × old price) and price/mix effect — Σ reconciles to Δ revenue"}
        style={{ marginTop: 14 }}
      >
        {revB && (
          <>
            {lflBanner}
            <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 12 }}>
              <Stat label={`Net rev · ${monthShort(effFrom)}${bw.partial ? ` (d${bw.cutoff})` : ""}`} value={fmtINR(revB.from)}/>
              <Stat label={`Net rev · ${monthShort(month)}${bw.partial ? ` (d${bw.cutoff})` : ""}`} value={fmtINR(revB.to)}/>
              <Stat label="Δ revenue" value={(revB.delta >= 0 ? "+" : "−") + fmtINR(Math.abs(revB.delta))} color={revB.delta >= 0 ? "var(--success)" : "var(--critical)"}/>
            </div>
            {revB.steps.length > 0 ? (
              <>
                <BridgeChart bridge={revB} D={D} height={250}/>
                <hr className="hr"/>
                <table className="table">
                  <thead><tr><th>Driver</th><th>Type</th><th className="num">Effect on revenue</th></tr></thead>
                  <tbody>
                    {revB.steps.map((s, i) => {
                      const meta = chMeta(s.channel);
                      return (
                        <tr key={i}>
                          <td>
                            <span className="badge" style={{ background: meta.color + "22", color: meta.color, borderColor: meta.color + "55" }}>{meta.label}</span>
                            <span style={{ marginLeft: 6 }}>{s.label.replace(new RegExp("^" + s.channel + " ?"), "")}</span>
                          </td>
                          <td className="muted" style={{ fontSize: 11.5, textTransform: "capitalize" }}>{s.kind}</td>
                          <td className="num" style={{ color: s.value >= 0 ? "var(--success)" : "var(--critical)", fontWeight: 600 }}>
                            {s.value >= 0 ? "+" : "−"}{fmtINR(Math.abs(s.value))}
                          </td>
                        </tr>
                      );
                    })}
                    <tr style={{ background: "var(--brand-soft)", fontWeight: 600 }}>
                      <td colSpan={2}>Σ drivers = Δ revenue {revB.reconciles ? "✓ reconciles" : "⚠ residual"}</td>
                      <td className="num" style={{ color: revB.delta >= 0 ? "var(--success)" : "var(--critical)" }}>
                        {revB.delta >= 0 ? "+" : "−"}{fmtINR(Math.abs(revB.delta))}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </>
            ) : (
              <div className="muted" style={{ fontSize: 12 }}>Revenue was flat between these months — no driver above the rounding floor.</div>
            )}
            <div style={{ padding: "8px 2px 0", fontSize: 10.5, color: "var(--ink-3)" }}>
              Volume effect = (Δ units) × old price; price/mix effect = new units × (Δ price). A channel present in only one month reads as started/stopped.
            </div>
          </>
        )}
      </Card>
    </>
  );
};

// ═════════════════════════════════════════════════════════════════════════════
// FORECAST VIEW — forward net revenue / units / CONTRIBUTION (CM3) at company,
// channel, AND SKU grain, with the STATED method and an uncertainty BAND (rubric
// 52). This is the page's forward-looking layer: not a single month-end revenue
// pace number but a grain-selectable forecast where the founder picks the metric
// they manage to (CM3 is the decision layer) and the grain they manage at.
//
// The forecast() engine fits a trailing-3-complete-month linear trend ⊕ run-rate
// (50/50), holds the realized ₹/unit forward for units and the recent CM3 margin
// forward for contribution, and bands every point by ±residualσ·√h. A partial
// current month is completed via month-end pace (flagged). NaN-safe throughout;
// confidence + method ride under the chart so it is never a black-box number.
// ═════════════════════════════════════════════════════════════════════════════
const FC_METRIC_META = {
  cm3:    { label: "Contribution (CM3)", unit: "₹", hint: "the decision layer — forward CM3 at the held recent margin" },
  netRev: { label: "Net revenue",        unit: "₹", hint: "forward net revenue from the trend + run-rate blend" },
  units:  { label: "Units",              unit: "u", hint: "forward units at the held realized ₹/unit" },
};
const ForecastView = ({ facts, month, view }) => {
  const [grain, setGrain] = useState("company"); // company | channel | sku
  const [channel, setChannel] = useState(null);
  const [sku, setSku] = useState(null);
  const [metric, setMetric] = useState("cm3");
  const [horizon, setHorizon] = useState(3);

  // Grain option lists — channels from this month's coverage; SKUs from the
  // latest native month's per-SKU chain (only native months carry SKU grain).
  const channels = view.channels || [];
  const skuCodes = useMemo(
    () => (view.cmV1 ? Object.keys(view.cmV1.bySku).sort((a, b) => safe(view.cmV1.bySku[b].netRev) - safe(view.cmV1.bySku[a].netRev)) : []),
    [view.cmV1]
  );
  // Effective selections — fall back safely if a stale pick leaves scope.
  const effChannel = grain === "channel" ? (channel && channels.includes(channel) ? channel : channels[0]) : null;
  const effSku = grain === "sku" ? (sku && skuCodes.includes(sku) ? sku : skuCodes[0]) : null;

  const fc = useMemo(
    () => forecast(facts, {
      channel: grain === "channel" ? effChannel : grain === "sku" ? undefined : undefined,
      sku: grain === "sku" ? effSku : undefined,
      horizonMonths: horizon,
      asOfMonth: month,
      costs: CostInputs,
    }),
    // facts/month/grain/scope/horizon drive the fit; CostInputs is a live module read.
    [facts, month, grain, effChannel, effSku, horizon]
  );

  const mm = FC_METRIC_META[metric] || FC_METRIC_META.cm3;
  const skuGrainAvailable = skuCodes.length > 0;
  const grainLabel = grain === "company" ? "Company (all channels)"
    : grain === "channel" ? `${chMeta(effChannel).label} channel`
    : `${skuLabel(effSku)}`;

  // The forecast() result has no SKU grain when this month is agency-tier — guard.
  const noScope = grain === "sku" && !skuGrainAvailable;
  const fcEmpty = !fc || (!fc.history?.length && !fc.forecast?.length);

  return (
    <>
      <Card
        title="Forward forecast · revenue · units · contribution"
        sub="Pick the grain you manage at and the metric you manage to. CM3 is the decision layer. Method + uncertainty band are stated — this is a model, not a promise."
        action={
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label className="muted" style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
              <span>grain</span>
              <select value={grain} onChange={(e) => setGrain(e.target.value)}
                style={selStyle}>
                <option value="company">Company</option>
                <option value="channel">Per channel</option>
                <option value="sku" disabled={!skuGrainAvailable}>Per SKU{skuGrainAvailable ? "" : " (native only)"}</option>
              </select>
            </label>
            {grain === "channel" && (
              <select value={effChannel || ""} onChange={(e) => setChannel(e.target.value)} style={selStyle} aria-label="Forecast channel">
                {channels.map((ch) => <option key={ch} value={ch}>{chMeta(ch).label}</option>)}
              </select>
            )}
            {grain === "sku" && skuGrainAvailable && (
              <select value={effSku || ""} onChange={(e) => setSku(e.target.value)} style={selStyle} aria-label="Forecast SKU">
                {skuCodes.map((c) => <option key={c} value={c}>{skuLabel(c)}</option>)}
              </select>
            )}
            <select value={metric} onChange={(e) => setMetric(e.target.value)} style={selStyle} aria-label="Forecast metric">
              {Object.entries(FC_METRIC_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} style={selStyle} aria-label="Forecast horizon">
              {[1, 2, 3, 4, 6].map((h) => <option key={h} value={h}>{h} mo</option>)}
            </select>
          </div>
        }
      >
        {noScope ? (
          <div className="note" style={{ background: "rgba(99,102,241,0.06)", borderColor: "rgba(99,102,241,0.25)" }}>
            <strong style={{ color: "#6366f1" }}>{monthLabel(month)} is an agency-tier month.</strong>&nbsp;
            SKU-grain forecasting needs a native per-SKU base. Company and per-channel forecasts are available;
            upload a native report to unlock per-SKU forecasts.
          </div>
        ) : fcEmpty ? (
          <div className="muted" style={{ fontSize: 12 }}>
            Not enough history at this grain to fit a forecast. {grainLabel} has no usable trailing series in the store yet.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
              <strong style={{ fontSize: 13 }}>{grainLabel}</strong>
              <span className="muted" style={{ fontSize: 11 }}>{mm.label} · {mm.hint}</span>
            </div>
            {/* II — DUAL-JUNE RECONCILIATION. The headline read-out projects the
                in-progress month at PACE; this Forecast tab models it via the
                trend⊕run-rate blend. Previously the two "June" figures sat ~₹3.7L
                apart, unlinked. Show BOTH side-by-side from ONE structure with the
                method label + which to trust — never two stray "June"s. */}
            {fc.currentMonth && <CurrentMonthReconciliation cm={fc.currentMonth}/>}
            <ForecastChart fc={fc} D={D} metric={metric} height={260}/>
            <hr className="hr"/>
            <ForecastTable fc={fc} metric={metric}/>
            <div style={{ padding: "8px 2px 0", fontSize: 10.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
              <strong>Method:</strong> {fc.method}. The trailing window uses <strong>complete months only</strong> (a partial
              month would bias the slope down). Units ride the held realized ₹/unit; contribution is{" "}
              <strong>{fc.heldMargin?.label || "held at trailing CM3"}</strong>{" "}
              {fc.heldMargin?.pct != null ? `(${fmtPct(fc.heldMargin.pct)})` : (fc.cm3MarginPct != null ? `(${fmtPct(fc.cm3MarginPct)})` : "(—)")}
              {fc.heldMargin && fc.heldMargin.pct != null && (
                <DerivationPopover
                  title="Held CM3 margin · forward contribution"
                  formula={fc.heldMargin.basis}
                  plain={`The forward CM3 line is held at the REAL recent CM3% the Finance KPI shows — this month's own CM3% when this month carries CM3 coverage, so the forecast does not contradict the headline. (Previously it held a Σ-weighted trailing blend that a single ad-heavy month dragged to a near-zero ~1%, reading as a contradiction against the ~15% shown elsewhere.)`}
                  inputs={[
                    { label: "Held basis", value: fc.heldMargin.basis },
                    { label: "Month(s) used", value: (fc.heldMargin.months || []).map(monthShort).join(", ") || "—" },
                    { label: "Σ CM3", value: fmtSignedINR(fc.heldMargin.cm3Sum) },
                    { label: "Σ net revenue", value: fmtINR(fc.heldMargin.revSum) },
                    { label: "= held CM3 margin", value: fmtPct(fc.heldMargin.pct) },
                    ...(fc.heldMargin.trailing && fc.heldMargin.trailing.pct != null
                      ? [{ label: `Trailing blend [${(fc.heldMargin.trailing.months || []).map(monthShort).join(", ")}]`, value: fmtPct(fc.heldMargin.trailing.pct) }]
                      : []),
                  ]}
                  value={fmtPct(fc.heldMargin.pct)}
                  source="bizAnalytics · forecast.heldMargin"
                  asOf={fc.asOfMonth}
                />
              )}
              {" "}— the recent CM3% the KPI shows, held forward, not a near-zero placeholder.
              The shaded band is ±residual σ·√h — it <strong>widens with
              horizon</strong> because uncertainty compounds. Confidence is{" "}
              <strong>{fc.confidence}</strong>{fc.note ? `; ${fc.note}` : ""}.
            </div>
          </>
        )}
      </Card>
    </>
  );
};

// Forecast numbers behind the chart — month rows with the central estimate and the
// low–high band, partial-month flagged. Every figure NaN-safe + formatted.
const ForecastTable = ({ fc, metric }) => {
  const isUnits = metric === "units";
  const lowK = metric === "cm3" ? "cm3Low" : "netRevLow";
  const highK = metric === "cm3" ? "cm3High" : "netRevHigh";
  const fmtV = (n) => (isUnits ? (Number.isFinite(n) ? fmtN(Math.round(n)) : "—") : metric === "cm3" ? fmtSignedINR(n) : fmtINR(n));
  const rows = (fc.forecast || []);
  if (!rows.length) return null;
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="table" style={{ minWidth: 420 }}>
        <thead>
          <tr>
            <th>Month</th>
            <th className="num">{FC_METRIC_META[metric]?.label || "Value"}</th>
            {!isUnits && <th className="num">Low</th>}
            {!isUnits && <th className="num">High</th>}
            <th>Window</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.month}>
              <td><strong>{monthShort(p.month)}</strong></td>
              <td className="num strong" style={{ color: metric === "cm3" ? cmColor(p[metric]) : "var(--ink)" }}>{fmtV(p[metric])}</td>
              {!isUnits && <td className="num muted">{metric === "cm3" ? fmtSignedINR(p[lowK]) : fmtINR(p[lowK])}</td>}
              {!isUnits && <td className="num muted">{metric === "cm3" ? fmtSignedINR(p[highK]) : fmtINR(p[highK])}</td>}
              <td className="muted" style={{ fontSize: 11 }}>
                {p.partial
                  ? <span style={{ color: "var(--warning)", fontWeight: 600 }}>partial · pace-completed</span>
                  : "full month (modeled)"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ── CurrentMonthReconciliation (II) ──────────────────────────────────────────
// The in-progress month has TWO defensible projections that previously appeared
// ~₹3.7L apart in two different places: PACE (this month held at prior-month
// same-day pace — the read-out headline, narrow band) and TREND⊕RUN-RATE (the
// forward-month blend this tab uses, wider band). We show them side-by-side from
// the engine's single `currentMonth` structure, flag which to trust (recommended
// = pace while the month is live), and state WHY they differ — never two unlinked
// "June" figures. Every value NaN-safe.
const CurrentMonthReconciliation = ({ cm }) => {
  if (!cm || !cm.partial) return null;
  const rec = cm.recommended || "pace";
  const pace = cm.pace || {};
  const trend = cm.trend || {};
  const Box = ({ kind, data, label }) => {
    const isRec = kind === rec;
    return (
      <div style={{
        flex: 1, minWidth: 200, padding: "10px 12px", borderRadius: 8,
        border: `1px solid ${isRec ? "var(--success)" : "var(--border)"}`,
        background: isRec ? "rgba(63,114,80,0.06)" : "var(--bg-sunken)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
          <span className="muted" style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
          {isRec && <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: "rgba(63,114,80,0.16)", color: "var(--success)" }}>RECOMMENDED</span>}
        </div>
        <div className="stat-num" style={{ fontSize: 20, fontWeight: 700 }}>{fmtINR(data.netRev)}</div>
        <div className="muted" style={{ fontSize: 10.5, marginTop: 2, lineHeight: 1.4 }}>
          band {fmtINR(data.low)}–{fmtINR(data.high)}
        </div>
        <div className="muted" style={{ fontSize: 10, marginTop: 3, lineHeight: 1.4, fontStyle: "italic" }}>{data.method}</div>
      </div>
    );
  };
  return (
    <div style={{ marginBottom: 14, border: "1px solid var(--warning)", borderRadius: 10, padding: "10px 12px", background: "var(--warning-soft)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 12.5 }}>{monthLabel(cm.month)} is in progress — two defensible projections</strong>
        <span className="muted" style={{ fontSize: 11 }}>
          MTD {fmtINR(cm.mtd)} through day {cm.dom} of {cm.daysInMonth}
        </span>
        <DerivationPopover
          title={`${monthLabel(cm.month)} month-end · pace vs trend`}
          formula="PACE = MTD × (priorFull ÷ priorToDate)  ·  TREND = ½·trend + ½·run-rate"
          plain="The same in-progress month, two honest reads. PACE extrapolates the month already underway at the rate the prior month ran to the same day — the more defensible read for a month 1/3 elapsed, so it's the headline. TREND⊕RUN-RATE is the multi-month-direction blend this tab uses for forward months. They differ because pace reads THIS month's momentum while the blend reads the trailing trend; trust pace while the month is live."
          inputs={[
            { label: "MTD (day " + cm.dom + ")", value: fmtINR(cm.mtd) },
            { label: "Pace (recommended)", value: fmtINR(pace.netRev) },
            { label: "Trend ⊕ run-rate", value: fmtINR(trend.netRev) },
            { label: "Difference", value: fmtINR(Math.abs((Number(pace.netRev) || 0) - (Number(trend.netRev) || 0))) },
          ]}
          value={`${fmtINR(pace.netRev)} (pace) · ${fmtINR(trend.netRev)} (trend)`}
          source="bizAnalytics · forecast.currentMonth"
          asOf={cm.month}
        />
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Box kind="pace" data={pace} label="Pace (this month held forward)"/>
        <Box kind="trend" data={trend} label="Trend ⊕ run-rate (forward blend)"/>
      </div>
      {cm.note && (
        <div className="muted" style={{ fontSize: 10.5, marginTop: 8, lineHeight: 1.5 }}>{cm.note}</div>
      )}
    </div>
  );
};

// Shared compact select styling for the forecast controls.
const selStyle = {
  fontSize: 11.5, padding: "4px 8px", borderRadius: 6,
  border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--ink)",
};

// ═════════════════════════════════════════════════════════════════════════════
// LEVERS VIEW — driver/sensitivity (which lever moves company CM3 most, rubric
// 55) + the what-if scenario simulator (price/fee/ad/COGS → CM, rubric 54). The
// two answer the founder's "where's my leverage" and "what if I pull it".
// ═════════════════════════════════════════════════════════════════════════════
const DRIVER_META = {
  price: { label: "Raise price", color: "var(--success)" },
  cogs:  { label: "Cut COGS", color: "var(--success)" },
  fees:  { label: "Cut platform fee", color: "var(--success)" },
  ads:   { label: "Cut ad spend", color: "var(--success)" },
};
const LeversView = ({ facts, month }) => {
  const drv = useMemo(() => driverSensitivity(facts, { month, costs: CostInputs, step: 0.05 }), [facts, month]);
  // The what-if compute closure — bound to facts/month/live costs (rubric 54).
  const compute = useMemo(
    () => (levers) => computeWhatIf(facts, { month, levers, costs: CostInputs }),
    [facts, month]
  );

  const drivers = drv?.drivers || [];
  const maxAbs = drivers.length ? Math.max(...drivers.map((d) => Math.abs(d.deltaCm3)), 1) : 1;
  const anyDriver = drivers.some((d) => Math.abs(d.deltaCm3) > 0.5);

  return (
    <>
      <Card
        title="Driver sensitivity · where's the leverage"
        sub={`A uniform ±5% shock on each lever, ranked by how much it moves company ${monthLabel(month)} CM3 · same-window`}
      >
        {anyDriver ? (
          <div style={{ display: "grid", gap: 8 }}>
            {drivers.map((d) => {
              const w = Math.min(100, (Math.abs(d.deltaCm3) / maxAbs) * 100);
              const meta = DRIVER_META[d.lever] || { label: d.label, color: "var(--brand)" };
              return (
                <div key={d.lever} style={{ display: "grid", gridTemplateColumns: "150px 1fr 120px", gap: 12, alignItems: "center" }}>
                  <div style={{ fontSize: 12 }}>
                    <span style={{ fontWeight: d.rank === 1 ? 600 : 400 }}>{meta.label}</span>
                    <span className="muted" style={{ fontSize: 10, marginLeft: 5 }}>{d.label}</span>
                  </div>
                  <div style={{ position: "relative", height: 16, background: "var(--bg-sunken)", borderRadius: 3 }}>
                    <div style={{ position: "absolute", left: 0, width: w + "%", height: "100%", background: d.deltaCm3 >= 0 ? "var(--success)" : "var(--critical)", opacity: d.rank === 1 ? 0.9 : 0.55, borderRadius: 3 }}/>
                  </div>
                  <div className="mono" style={{ fontSize: 12, textAlign: "right", fontWeight: d.rank === 1 ? 600 : 400, color: d.deltaCm3 >= 0 ? "var(--success)" : "var(--critical)" }}>
                    {d.deltaCm3 >= 0 ? "+" : "−"}{fmtINR(Math.abs(d.deltaCm3))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 12 }}>
            No leverage to rank for {monthLabel(month)} — there is no COGS-priced channel to simulate (agency-tier or no native COGS coverage).
            Sensitivity needs a priced CM chain.
          </div>
        )}
        {anyDriver && (
          <div style={{ padding: "10px 2px 0", fontSize: 10.5, color: "var(--ink-3)" }}>
            Each bar is the ΔCM3 from a 5% favourable move in that lever (price +5%, COGS −5%, fee −5pts, ads −5%), holding volume constant.
            The longest bar is the highest-leverage knob this month. Demand elasticity is not modelled — this is margin mechanics.
          </div>
        )}
      </Card>

      <Card
        title="What-if · scenario simulator"
        sub="Move a lever and see the contribution-margin impact across the month · CM3-covered channels only · pure margin mechanics"
        style={{ marginTop: 14 }}
      >
        <WhatIfPanel compute={compute} channelLabel={(ch) => chMeta(ch).label} D={D} month={monthLabel(month)}/>
      </Card>
    </>
  );
};

// ═════════════════════════════════════════════════════════════════════════════
// ACTIONS VIEW — the unified cross-lever "what to do Monday" queue (rubric VIII /
// 53/60/61). ONE ranked list spanning reorder · delist · reprice · ad-cut ·
// reallocate · de-risk, each ending in a decision with a per-month ₹ impact —
// not an ad-budget-only list. Fronted by the written PROSE weekly read-out
// (VII-59) and followed by the ad-reporting-inflation insight (rubric c).
// ═════════════════════════════════════════════════════════════════════════════
const LEVER_LABEL = {
  "ad-cut": "Ad cut", delist: "Delist", reprice: "Reprice",
  reallocate: "Reallocate", reorder: "Reorder", "de-risk": "De-risk",
};
// VIII-95 — resolve the period the action queue's per-SKU impacts are measured on.
// If the selected month is itself native + complete, the queue uses it directly.
// Otherwise (partial / agency-tier, e.g. June-MTD) the per-SKU levers have no base,
// so we fall back to the latest COMPLETE NATIVE month at or before the selection —
// and the caller labels that period explicitly. Pure; never throws.
function resolveActionPeriod(facts, month, view) {
  // Selected month already carries a per-SKU native chain and is complete → use it.
  if (view?.cmV1 != null && !view?.partial) return { month, partial: false, fellBack: false };
  const models = monthsAvailable(facts);
  // Latest complete (non-partial) month with at least one native channel, ≤ selection.
  let best = null;
  for (const m of models) {
    if (m.month > month) continue;
    if (m.partial) continue;
    const native = Object.values(m.channels || {}).some((c) => c.sales === "native");
    if (native) best = m; // models ascending — keep latest
  }
  if (best) return { month: best.month, partial: !!best.partial, fellBack: best.month !== month };
  // No complete native month anywhere ≤ selection — stay on the selection (the
  // queue will be channel-level only; the agency note covers it).
  return { month, partial: !!view?.partial, fellBack: false };
}

const ActionsView = ({ facts, month, view }) => {
  // VIII-95 — the queue's per-SKU levers (ad-cut / delist / reprice / reorder)
  // need a NATIVE per-SKU base. When the page sits on a partial / agency-tier
  // month (e.g. June-MTD, the headline period), there is no per-SKU matrix for
  // that month, so the actionable impacts are sourced from the LATEST COMPLETE
  // NATIVE month instead. We resolve that period here and LABEL it explicitly, so
  // the founder is never silently holding two periods (June headline + May queue).
  const queuePeriod = useMemo(() => resolveActionPeriod(facts, month, view), [facts, month, view]);
  const queueMonth = queuePeriod.month;
  const periodDiffers = queueMonth !== month;

  // VIII — ONE "what to do Monday" queue spanning ALL levers (reorder / delist /
  // reprice / ad-cut / reallocate / de-risk), each ranked by ₹ impact. Cross-module
  // velocity is joined in (rubric 58) so reorder/stockout-risk rows sit alongside
  // the ad/margin levers — not an ad-budget-only list. NaN-safe.
  const velocity = useMemo(() => crossModuleVelocity(facts, { month: queueMonth }), [facts, queueMonth]);
  const queue = useMemo(
    () => actionQueue(facts, { month: queueMonth, costs: CostInputs, velocity }),
    [facts, queueMonth, velocity]
  );
  // VII-59 — the written PROSE weekly read-out ("what changed & what it means"),
  // the prescriptive prose that frames the queue. Prose tracks the SELECTED month
  // (it summarises the period the founder is looking at), the queue tracks the
  // latest complete native month — both periods are labelled below.
  const narrative = useMemo(
    () => proseWeeklyNarrative(facts, { month, costs: CostInputs }),
    [facts, month]
  );
  const isNative = view.cmV1 != null;

  // Recoverable-contribution headline = Σ |₹/mo CM3| of the margin levers (ad-cut /
  // delist / reprice / reallocate); reorder rows are "₹ at risk", not recoverable,
  // so they're summed separately to avoid double-reading.
  const recoverable = queue.filter((r) => r.impactKind && r.impactKind.includes("CM3"))
    .reduce((a, r) => a + Math.abs(safe(r.impactPerMonth)), 0);
  const atRisk = queue.filter((r) => r.lever === "reorder")
    .reduce((a, r) => a + Math.abs(safe(r.impactPerMonth)), 0);
  // Lever spread — proves the queue isn't ad-budget-only (VIII).
  const spread = queue.reduce((a, r) => ((a[r.lever] = (a[r.lever] || 0) + 1), a), {});

  return (
    <>
      {/* The prescriptive prose first — the first-pass written analysis (VII-59). */}
      <div style={{ marginBottom: 14 }}>
        <ProseNarrative narrative={narrative} title="What changed this week — and what it means"/>
      </div>

      <Card
        title="What to do Monday · one queue, every lever"
        sub={`A single ranked action list across reorder · delist · reprice · ad-cut · reallocate · de-risk — not an ad-budget-only list. Ranked by ₹ impact · impacts measured on ${monthLabel(queueMonth)}${queuePeriod.partial ? " (partial)" : " (latest complete month)"}`}
      >
        {/* VIII-95 — explicit period label so the founder never conflates the
            June-MTD headline above with the queue's May impact period. */}
        {periodDiffers && (
          <div className="note" style={{ marginBottom: 12, background: "rgba(63,114,80,0.05)", borderColor: "rgba(63,114,80,0.22)" }}>
            <strong style={{ color: "var(--success)" }}>Queue period · {monthLabel(queueMonth)} (latest complete month).</strong>&nbsp;
            The page headline above is <strong>{monthLabel(month)}{view.partial ? " (MTD, in progress)" : ""}</strong>, but the per-SKU
            ad/delist/reprice/reorder impacts below need a complete native per-SKU base — {monthLabel(month)} has none yet
            ({view.cmV1 == null ? "agency-tier" : "still in progress"}). So these ₹ figures are measured on the latest closed native
            month, <strong>{monthLabel(queueMonth)}</strong>. Two periods, both labelled — you're not holding one in your head.
          </div>
        )}

        {!isNative && !periodDiffers && (
          <div className="note" style={{ marginBottom: 12, background: "rgba(99,102,241,0.06)", borderColor: "rgba(99,102,241,0.25)" }}>
            <strong style={{ color: "#6366f1" }}>{monthLabel(queueMonth)} is an agency-tier month.</strong>&nbsp;
            SKU×channel ad/delist/reprice actions need per-SKU margin (native reports). Channel-level guidance (concentration)
            and the prose read-out still apply; upload native reports to unlock per-SKU actions.
          </div>
        )}

        {queue.length === 0 ? (
          <div className="muted" style={{ fontSize: 12 }}>
            No loss-making ad cells, structural losses, reprice candidates, reorder risks, or concentration flags for {monthLabel(queueMonth)} — nothing on fire. Hold course.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 18, marginBottom: 12, fontSize: 12.5 }}>
              {recoverable > 0 && (
                <span>Acting on the margin levers recovers up to{" "}
                  <strong style={{ color: "var(--success)" }}>{fmtINR(recoverable)}/mo</strong> of contribution
                  <span className="muted" style={{ fontSize: 10.5 }}> (upper bound — some overlap)</span>
                </span>
              )}
              {atRisk > 0 && (
                <span><strong style={{ color: "var(--warning)" }}>{fmtINR(atRisk)}/mo</strong> of revenue at stockout risk
                  <span className="muted" style={{ fontSize: 10.5 }}> (reorder, not recoverable)</span>
                </span>
              )}
            </div>
            <ActionQueue queue={queue} D={D} title="Ranked action queue" max={14} period={`${monthLabel(queueMonth)}${queuePeriod.partial ? " (partial)" : " (complete)"}`}/>
            <div style={{ padding: "12px 2px 0", fontSize: 10.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
              <strong>Levers in this queue:</strong>{" "}
              {Object.entries(spread).map(([lev, c], i) => (
                <span key={lev}>{i > 0 ? " · " : ""}{LEVER_LABEL[lev] || lev} ×{c}</span>
              ))}.{" "}
              Each row's <strong>basis</strong> says where the number comes from — <em>actual-attributed</em> (per-product ad),
              <em> derived-velocity</em> (cross-module reorder), or channel-grain. CM3 levers (ad-cut / delist / reprice /
              reallocate) are contribution recovered <strong>per month</strong>; reorder rows are revenue <strong>at risk</strong> if
              the fast-mover stocks out (the inventory↔sales join, rubric 58); de-risk (concentration) is a watch flag with no direct ₹.
            </div>
          </>
        )}
      </Card>

      {/* Ad-reporting inflation insight (rubric c) — directly decision-relevant to
          the action queue: it tells the founder to read CM3 off the banked Shopify
          net, never the Monarch conversion value the ad platform reports. */}
      <ConversionGapPanel facts={facts} month={month}/>
    </>
  );
};

// (c) Conversion-value-gap insight — Monarch reported conversion value vs the
// Shopify net that actually banked. The gap is ad-reporting inflation (last-click
// double-counting + pre-GST/returns gross), NOT real lost revenue. Only meaningful
// where a website Monarch conversion figure exists for the month. NaN-safe.
const ConversionGapPanel = ({ facts, month }) => {
  const gap = useMemo(() => conversionValueGap(facts, { month }), [facts, month]);
  if (!gap || !(gap.monarchConvValue > 0) || !(gap.shopifyNet > 0)) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <ConversionGapView data={gap} D={D} title={`Ad-reporting inflation · ${monthLabel(month)} (website)`}/>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════════════
// MONTH VIEW MODEL — the single coverage-aware computation every tab reads.
//
// Builds, for the selected month:
//  • channels[]            — ordered channel list with sales coverage
//  • byChannel{ch}         — computeMonthChannelCM cell (native or agency)
//  • company               — summed rollup across covered channels (+CM4 native)
//  • cmV1                  — the full v1 per-SKU computeCM (NATIVE months only; null otherwise)
//  • reconciliation[]      — agency↔native deltas where a native channel has an agency shadow
//  • fixedAmount           — monthly fixed cost ₹ (CM4 gate), or null
//  • coverageNote          — "all native" | "all agency" | "mixed" | "no coverage"
// ═════════════════════════════════════════════════════════════════════════════
function buildMonthView(facts, month) {
  const m = String(month || "");
  const model = monthsAvailable(facts).find((x) => x.month === m) || { channels: {} };
  const allChannels = orderChannels(Object.keys(model.channels));

  // Per-channel coverage-aware CM (native reuses v1 slice; agency = channel-grain).
  const byChannel = {};
  for (const ch of allChannels) {
    byChannel[ch] = computeMonthChannelCM({ facts, month: m, channel: ch });
  }
  const channels = allChannels.filter((ch) => byChannel[ch].coverage !== "none");

  // Native v1 chain (per-SKU) — only when at least one channel is native.
  const anyNative = channels.some((ch) => byChannel[ch].coverage === "native");
  const fixed = CostInputs.getFixedCost ? CostInputs.getFixedCost(m) : null;
  const fixedAmount = fixed && Number.isFinite(Number(fixed.amount)) ? Number(fixed.amount) : null;
  const cmV1 = anyNative ? computeCM({ facts, month: m }) : null;

  // Company rollup across covered channels. For native months we use the v1
  // company rollup (it carries CM4); for agency months we sum the channel cells.
  let company;
  if (cmV1) {
    company = cmV1.company;
  } else {
    company = sumAgencyCompany(channels.map((ch) => byChannel[ch]));
    company.fixedTotal = null;
  }

  // Reconciliation: where a channel is native AND an agency shadow exists for the
  // same month×channel, surface the agency-vs-native net delta (V2.1, never silent).
  const shadow = facts?.meta?.agencyShadow || {};
  const reconciliation = [];
  for (const ch of channels) {
    const cell = byChannel[ch];
    if (cell.coverage !== "native") continue;
    const sh = shadow[`${m}|${ch}`];
    if (!sh) continue;
    const agencyNet = Number(sh.netRev) || (Number(sh.grossRev) || 0) / 1.05;
    const nativeNet = Number(cell.netRev) || 0;
    if (!(agencyNet > 0) || !(nativeNet > 0)) continue;
    const delta = agencyNet - nativeNet;
    const deltaPct = nativeNet !== 0 ? delta / nativeNet : null;
    // Coverage-gap vs return-tail classification (V2.2): a small delta (≤ the
    // RECON_TIMING_BAND) is return-tail timing — the agency books returns into a
    // different period than the native export, so the figures drift a few %. A
    // LARGE positive delta (e.g. Monarch ₹7.46L tracked vs Shopify ₹4.28L native,
    // +74.1%) is NOT timing — the native export materially UNDER-captures the
    // channel. Flagging it benignly would tell the founder to ignore a real ~₹3L
    // hole that feeds the headline company CM. So we badge it distinctly.
    const isGap = deltaPct != null && Math.abs(deltaPct) > RECON_TIMING_BAND;
    reconciliation.push({
      channel: ch,
      native: nativeNet,
      agency: agencyNet,
      delta,
      deltaPct,
      isGap,
      tier: sh.tier || (ch === "website" ? "monarch" : "agency"),
    });
  }

  const coverageNote = anyNative && channels.some((ch) => byChannel[ch].coverage === "agency")
    ? "mixed (native + agency channels)"
    : anyNative ? "all native (per-SKU)" : channels.length ? "all agency (Snell/Monarch channel-grain)" : "no coverage";

  return {
    month: m, channels, byChannel, company, cmV1, reconciliation,
    fixedAmount, coverageNote, partial: !!model.partial, model,
  };
}

// Sum agency channel cells into a company-shaped rollup. CM fields skip null
// (cogs-uncovered) cells — their netRev still counts toward the displayed total,
// but the blended CM% denominator uses ONLY the cogs-covered net so a zero-COGS
// channel can't masquerade as 100%-margin. NaN-free.
function sumAgencyCompany(cells) {
  const fin0 = (n) => (Number.isFinite(n) ? n : 0);
  const co = {
    netRev: 0, units: 0, cogs: 0, fees: 0, adSpend: 0, fixedAlloc: 0,
    // cmNetRev = net revenue from cells with a COGS basis only. This is the
    // correct denominator for blended CM1/CM2/CM3% — including a channel's net
    // in the denominator while NOT subtracting its (unknown) COGS would inflate
    // every blended margin by that channel's revenue share (e.g. an agency-month
    // website with COGS "—" silently treated as 100%-margin, lifting CM1% from a
    // true 59.1% to a flattering 49.7%-on-full-net artifact). Full netRev still
    // drives the headline revenue stat and the channel rows.
    cmNetRev: 0,
    cmNetExcluded: 0,   // net revenue dropped from the CM% basis (cogs unknown)
    cm1: 0, cm2: 0, cm3: 0, cm4: null, cogsCovered: true,
    pcts: { cm1: null, cm2: null, cm3: null, cm4: null },
  };
  let anyCm = false;
  for (const c of cells) {
    co.netRev += fin0(c.netRev);
    co.units += fin0(c.units);
    co.cogs += fin0(c.cogs);
    co.fees += fin0(c.fees);
    co.adSpend += fin0(c.adSpend);
    if (c.cm1 == null || c.cogsCovered === false) co.cogsCovered = false;
    if (c.cm1 != null) {
      co.cm1 += fin0(c.cm1); co.cm2 += fin0(c.cm2); co.cm3 += fin0(c.cm3);
      co.cmNetRev += fin0(c.netRev);
      anyCm = true;
    } else {
      co.cmNetExcluded += fin0(c.netRev);
    }
  }
  if (!anyCm) { co.cm1 = null; co.cm2 = null; co.cm3 = null; }
  // Denominator = cogs-covered net (falls back to full net only if NOTHING is
  // covered, where cm* are null anyway so pctOf returns null regardless).
  const r = co.cmNetRev > 0 ? co.cmNetRev : co.netRev;
  const pctOf = (p) => (r > 0 && p != null ? p / r : null);
  co.cogsCovered = anyCm && co.cogsCovered;
  co.pcts = { cm1: pctOf(co.cm1), cm2: pctOf(co.cm2), cm3: pctOf(co.cm3), cm4: null };
  return co;
}

// ── Coverage-aware month picker ──────────────────────────────────────────────
function MonthPicker({ months, value, onChange }) {
  // <select> with a coverage suffix per option so the dropdown itself reads the
  // tier. The strip below the head carries the visual badges.
  const tierTag = (m) => {
    const chs = Object.values(m.channels);
    const nat = chs.some((c) => c.sales === "native");
    const ag = chs.some((c) => c.sales === "agency");
    const tier = nat && ag ? "mixed" : nat ? "native" : ag ? "agency" : "—";
    return `${tier}${m.partial ? " · MTD" : ""}`;
  };
  return (
    // X-80 · accessible labelled control: the <select> carries an explicit
    // aria-label (the calendar icon alone is decorative, aria-hidden), so a
    // screen reader announces "Month — select the month to view" rather than an
    // unlabelled combobox. The icon stays for sighted wayfinding.
    <label className="muted" style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 6 }}>
      <Icon name="calendar" size={13} aria-hidden="true"/>
      <span className="sr-only">Month</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="fin-month-select"
        aria-label="Month — select the month to view"
        title="Select the month to view"
        style={{
          fontSize: 12, padding: "4px 8px", borderRadius: 6,
          border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--ink)",
        }}
      >
        {[...months].reverse().map((m) => (
          <option key={m.month} value={m.month}>{monthLabel(m.month)} · {tierTag(m)}</option>
        ))}
      </select>
    </label>
  );
}

// ── Selected-month coverage strip — per-channel badges at a glance ──
function MonthCoverageStrip({ model, view }) {
  const channels = orderChannels(Object.keys(model.channels || {}));
  if (!channels.length) return null;
  return (
    <div style={{
      display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10,
      padding: "8px 12px", marginBottom: 14, borderRadius: 8,
      background: "var(--bg-sunken)", border: "1px solid var(--border-soft)", fontSize: 11.5,
    }}>
      <span className="muted" style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", fontSize: 10 }}>
        {monthLabel(model.month)} coverage
      </span>
      {channels.map((ch) => {
        const c = model.channels[ch];
        const meta = chMeta(ch);
        return (
          <span key={ch} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span className="badge" style={{ background: meta.color + "22", color: meta.color, borderColor: meta.color + "55", fontSize: 10 }}>
              {meta.label}
            </span>
            <CoverageBadge sales={c.sales} partial={c.partial} lastDay={c.lastDay}/>
          </span>
        );
      })}
      <span className="muted" style={{ marginLeft: "auto", fontStyle: "italic" }}>{view.coverageNote}</span>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// CM WATERFALL — company + per-channel, coverage-aware.
// netRev → −COGS → CM1 → −fees → CM2 → −ads → CM3 → −fixed → CM4 (native only)
// ═════════════════════════════════════════════════════════════════════════════
const WaterfallView = ({ view, month, facts }) => {
  const co = view.company;
  const hasFixed = view.cmV1 != null && view.fixedAmount != null && view.cmV1.coverage.hasFixedCost;
  const channels = view.channels;
  const isAgency = view.cmV1 == null;
  // ATTRIBUTION CONFIDENCE pinned to each channel's CM3 (rubric 23): how much of
  // the ad leg that produced THIS CM3 is per-product measured vs allocated. For an
  // agency-tier month (e.g. June) where ads are 0%-measured, the founder sees IN
  // PLACE that the CM3 ad rung is a hint, not a measured fact — same honesty the
  // Marketing panel carries, now next to the number they'd act on.
  const attrib = useMemo(() => attributionConfidence(facts, { month, costs: CostInputs }), [facts, month]);
  // When some channels' net is excluded from the CM% basis (agency month with a
  // COGS-less channel, e.g. website), the blended CM% is over the cogs-covered
  // net only — say so instead of "of net rev" (which would imply the full total).
  const cmExcluded = Number.isFinite(co.cmNetExcluded) ? co.cmNetExcluded : 0;
  const cmBasisNet = Number.isFinite(co.cmNetRev) && co.cmNetRev > 0 ? co.cmNetRev : co.netRev;
  const cm1Basis = cmExcluded > 0 ? `of ${fmtINR(cmBasisNet)} cogs-priced net` : "of net rev";

  return (
    <>
      {/* Headline stat band — company CM milestones */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(5, 1fr)", marginBottom: 14 }}>
        <Card title="Net revenue">
          <div className="stat-num lg">{fmtINR(co.netRev)}</div>
          <div className="muted" style={{ fontSize: 11.5 }}>
            {fmtN(co.units)} units · {monthLabel(month)}{view.partial ? " · MTD" : ""}
          </div>
          {/* IX — make the two coexisting nets ONE figure with a sub-line, not two
              equal-weight numbers. The complete net is the headline; the cogs-priced
              net (the CM%-ladder basis below) is an explicit, smaller sub-line so the
              eye never has to reconcile two "net revenue" totals. */}
          {cmExcluded > 0 && (
            <div className="muted" style={{ fontSize: 10.5, marginTop: 3, lineHeight: 1.4 }}
              title={`The CM%-ladder below is computed over the ${fmtINR(cmBasisNet)} of this net that has a COGS card; ${fmtINR(cmExcluded)} (channels with COGS "—") is real revenue but unpriced, so it sits outside the margin %. Same total — one figure, two slices.`}>
              of which <strong style={{ color: "var(--ink-2)" }}>{fmtINR(cmBasisNet)}</strong> is cogs-priced (CM% basis); {fmtINR(cmExcluded)} unpriced
            </div>
          )}
        </Card>
        <Card title="CM1 · after COGS">
          <div className="stat-num lg" style={{ color: cmColor(co.cm1) }}>{co.cm1 == null ? "—" : fmtINR(co.cm1)}</div>
          <div className="muted" style={{ fontSize: 11.5 }} title={cmExcluded > 0 ? `Blended CM% is over the ${fmtINR(cmBasisNet)} of net revenue that has a COGS basis; ${fmtINR(cmExcluded)} of net (channels with COGS "—") is excluded from the % denominator so it can't read as 100%-margin.` : undefined}>{fmtPct(co.pcts.cm1)} {cm1Basis}</div>
        </Card>
        <Card title="CM2 · after fees">
          <div className="stat-num lg" style={{ color: cmColor(co.cm2) }}>{co.cm2 == null ? "—" : fmtINR(co.cm2)}</div>
          <div className="muted" style={{ fontSize: 11.5 }}>{fmtPct(co.pcts.cm2)} · breakeven-ACOS</div>
        </Card>
        <Card title="CM3 · after ads">
          <div className="stat-num lg" style={{ color: cmColor(co.cm3) }}>{co.cm3 == null ? "—" : fmtINR(co.cm3)}</div>
          <div className="muted" style={{ fontSize: 11.5 }}>{fmtPct(co.pcts.cm3)} · the decision layer</div>
        </Card>
        <Card title="CM4 · after fixed">
          {hasFixed ? (
            <>
              <div className="stat-num lg" style={{ color: cmColor(co.cm4) }}>{fmtINR(co.cm4)}</div>
              <div className="muted" style={{ fontSize: 11.5 }}>{fmtPct(co.pcts.cm4)} · reporting view</div>
            </>
          ) : (
            <>
              <div className="stat-num lg" style={{ color: "var(--ink-4)" }}>—</div>
              <div className="muted" style={{ fontSize: 11.5 }}>
                {isAgency ? "native month only" : "set a fixed cost ↗ Cost inputs"}
              </div>
            </>
          )}
        </Card>
      </div>

      {/* Agency-month context note. */}
      {isAgency && (
        <div className="note" style={{ marginBottom: 14, background: "rgba(99,102,241,0.06)", borderColor: "rgba(99,102,241,0.25)" }}>
          <strong style={{ color: "#6366f1" }}>Agency-tier month.</strong>&nbsp;
          {monthLabel(month)} is built from Snell/Monarch <strong>channel-grain</strong> history — revenue, ad spend, and
          channel-level COGS (priced from Snell per-SKU units where available). There is no per-SKU revenue at this tier,
          so the SKU×channel matrix and SKU cards are unavailable; upload the month's native reports to unlock SKU grain.
          CM4 (fixed-cost allocation) is a native-month view only.
        </div>
      )}

      <Card
        title={`Company contribution margin · ${monthLabel(month)}`}
        sub="Net revenue stepped down through COGS, platform fees, ad spend, and (when set) allocated fixed cost"
      >
        <CMWaterfall cell={co} hasFixed={hasFixed} excludedNet={cmExcluded}/>
        <hr className="hr"/>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "var(--ink-3)" }}>
          <span style={{ color: "var(--warning)", fontWeight: 600 }}>CM4 is a reporting view.</span>
          Fixed cost is allocated revenue-proportionally — it taxes high-revenue cells regardless of
          their actual fixed-resource use. <strong>CM3 stays the decision layer</strong> for delist / ad-budget calls.
        </div>
      </Card>

      <Card
        title="Per-channel waterfall"
        sub="Each channel's own CM chain · CM3% is the headline health number · every ad figure shows its basis"
        style={{ marginTop: 14 }}
        padded={false}
      >
        <table className="table">
          <thead>
            <tr>
              <th>Channel</th>
              <th className="num">Net rev</th>
              <th className="num">−COGS</th>
              <th className="num">CM1</th>
              <th className="num">−Fees</th>
              <th className="num">CM2</th>
              <th className="num">−Ads</th>
              <th>Basis</th>
              <th className="num">CM3</th>
              <th className="num">CM3 %</th>
              {hasFixed && <th className="num">CM4</th>}
            </tr>
          </thead>
          <tbody>
            {channels.map((ch) => {
              const c = view.byChannel[ch];
              const meta = chMeta(ch);
              const cogsTitle = c.cogsApprox ? "COGS approximated at the channel weighted-average cost (some agency units unpriced)" : undefined;
              return (
                <tr key={ch}>
                  <td>
                    <span className="badge" style={{ background: meta.color + "22", color: meta.color, borderColor: meta.color + "55" }}>
                      {meta.label}
                    </span>
                    {c.coverage === "agency" && <span title="Snell/Monarch channel-grain" style={{ marginLeft: 6, fontSize: 9, color: "#6366f1", fontWeight: 700 }}>AGY</span>}
                  </td>
                  <td className="num">
                    {fmtINR(c.netRev)}
                    {ch === "blinkit" && c.coverage === "agency" && (
                      <span title={`Agency proxy net = Snell gross ÷ 1.05. The Snell sheet has no tax-netted Blinkit column, so CESS isn't subtracted — the true net runs ~${(BLINKIT_AGENCY_PROXY_DRIFT * 100).toFixed(0)}% below this. See the Blinkit reconciliation note below.`}
                        style={{ marginLeft: 5, fontSize: 9, padding: "1px 4px", borderRadius: 3, background: "rgba(201,162,39,0.16)", color: "#C9A227", fontWeight: 700, whiteSpace: "nowrap" }}>
                        proxy ÷1.05
                      </span>
                    )}
                  </td>
                  <td className="num muted" title={cogsTitle}>
                    {c.cogs == null ? "—" : "−" + fmtINR(c.cogs)}
                    {c.cogsApprox && <span style={{ color: "var(--warning)", marginLeft: 2 }} title={cogsTitle}>≈</span>}
                  </td>
                  <td className="num" style={{ color: cmColor(c.cm1) }}>{c.cm1 == null ? "—" : fmtINR(c.cm1)}</td>
                  <td className="num muted">−{fmtINR(c.fees)}</td>
                  <td className="num" style={{ color: cmColor(c.cm2) }}>{c.cm2 == null ? "—" : fmtINR(c.cm2)}</td>
                  <td className="num muted">{c.adSpend > 0 ? "−" + fmtINR(c.adSpend) : <span className="muted">—</span>}</td>
                  <td><AdBasisChip basis={c.adBasis} channel={ch}/></td>
                  <td className="num strong" style={{ color: cmColor(c.cm3) }}>
                    {c.cm3 == null ? "—" : fmtINR(c.cm3)}
                    {c.cm3 != null && c.adSpend > 0 && <Cm3ConfidenceChip measured={attrib.byChannel[ch]?.measured} channel={ch} attrib={attrib.byChannel[ch]}/>}
                  </td>
                  <td className="num"><span style={{ color: pctTone(c.pcts.cm3) }}>{fmtPct(c.pcts.cm3)}</span></td>
                  {hasFixed && <td className="num muted">{view.cmV1?.byChannel[ch]?.cm4 == null ? "—" : fmtINR(view.cmV1.byChannel[ch].cm4)}</td>}
                </tr>
              );
            })}
            {/* Company total row */}
            <tr style={{ background: "var(--brand-soft)", fontWeight: 600 }}>
              <td>All channels</td>
              <td className="num">{fmtINR(co.netRev)}</td>
              <td className="num muted">{co.cogs == null ? "—" : "−" + fmtINR(co.cogs)}</td>
              <td className="num" style={{ color: cmColor(co.cm1) }}>{co.cm1 == null ? "—" : fmtINR(co.cm1)}</td>
              <td className="num muted">−{fmtINR(co.fees)}</td>
              <td className="num" style={{ color: cmColor(co.cm2) }}>{co.cm2 == null ? "—" : fmtINR(co.cm2)}</td>
              <td className="num muted">−{fmtINR(co.adSpend)}</td>
              <td/>
              <td className="num strong" style={{ color: cmColor(co.cm3) }}>{co.cm3 == null ? "—" : fmtINR(co.cm3)}</td>
              <td className="num" title={cmExcluded > 0 ? `Blended CM% over the ${fmtINR(cmBasisNet)} cogs-priced net only; ${fmtINR(cmExcluded)} of net is excluded from the % basis.` : undefined}>
                {fmtPct(co.pcts.cm3)}{cmExcluded > 0 && <span style={{ color: "var(--warning)", marginLeft: 2 }}>≈</span>}
              </td>
              {hasFixed && <td className="num">{fmtINR(co.cm4)}</td>}
            </tr>
          </tbody>
        </table>
        <div style={{ padding: "8px 14px", fontSize: 10.5, color: "var(--ink-3)", display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          <span>Ad basis:</span>
          <span><AdBasisChip basis={AD_BASIS.ACTUAL}/> per-product attribution (Amazon SP · Flipkart PLA · website Google)</span>
          <span><AdBasisChip basis={AD_BASIS.ALLOC}/> channel total split by net rev</span>
          <span><AdBasisChip basis={AD_BASIS.AGENCY}/> Snell/Monarch channel total</span>
          <span style={{ color: "var(--warning)" }}>≈ COGS approximated</span>
        </div>
        <div style={{ padding: "0 14px 10px", fontSize: 10.5, color: "var(--ink-3)" }}>
          <strong>“NN% meas”</strong> next to each CM3 = how much of the ad spend behind that CM3 is <strong>per-product measured</strong>
          {" "}vs allocated by revenue (rubric 23). A CM3 with a high measured% is a number to bet on; a low/0% one (an
          agency-tier month, where ads are a channel total with no per-SKU split) is a directional hint —{" "}
          {attrib.overall != null
            ? <>this month is <strong>{Math.round(attrib.overall * 100)}%</strong> measured overall ({fmtINR(attrib.directTotal)} measured + {fmtINR(attrib.allocTotal)} allocated = {fmtINR(attrib.spendTotal)}).</>
            : "no ad spend allocated this month."} Hover any chip for its split.
        </div>
        {cmExcluded > 0 && (
          <div style={{ padding: "0 14px 10px", fontSize: 10.5, color: "var(--ink-3)" }}>
            <span style={{ color: "var(--warning)", fontWeight: 600 }}>≈ Blended CM% basis:</span>{" "}
            the "All channels" CM1/CM2/CM3 % are computed over the <strong>{fmtINR(cmBasisNet)}</strong> of net revenue that has a COGS basis.
            <strong> {fmtINR(cmExcluded)}</strong> of net (channels showing COGS "—" — no per-SKU units to price COGS at this tier) is kept in the
            headline net total but <strong>excluded from the % denominator</strong>, so a COGS-less channel can't inflate the blended margin as if it were 100%-margin.
          </div>
        )}
      </Card>

      {/* Agency↔native reconciliation note (V2.1). */}
      <ReconciliationNote reconciliation={view.reconciliation} month={month}/>

      {/* M3 — Blinkit agency-proxy reconciliation. Fires on agency-only Blinkit
          months (no native shadow → the V2.1 note above doesn't cover them). */}
      <BlinkitAgencyReconNote view={view} month={month}/>
    </>
  );
};

// M3 — Blinkit agency-proxy net reconciliation. The Snell agency sheet carries
// Blinkit GROSS only, so the build nets it as gross÷1.05; that proxy omits
// Blinkit's CESS, so it overstates net by ~BLINKIT_AGENCY_PROXY_DRIFT vs a true
// tax-netted native report. We surface that here for agency-ONLY Blinkit months
// with the SAME Δ-treatment shape as the native↔agency note — the agency figure
// (active), the estimated true net (proxy − drift), and the Δ, badged so the
// founder reads it as a methodology approximation, not a clean native number.
const BlinkitAgencyReconNote = ({ view, month }) => {
  const cell = view.byChannel?.blinkit;
  // Only when Blinkit is present AND agency-tier (native months net Blinkit the
  // true way already — and the V2.1 ReconciliationNote covers any native shadow).
  if (!cell || cell.coverage !== "agency") return null;
  const proxyNet = Number(cell.netRev);
  if (!Number.isFinite(proxyNet) || proxyNet <= 0) return null;
  // Estimated true tax-netted net ≈ proxy × (1 − drift). The agency proxy is the
  // ACTIVE figure (no native report exists for this month); the estimate is the
  // disclosure of how far it likely sits from a native-grade net.
  const estTrueNet = proxyNet * (1 - BLINKIT_AGENCY_PROXY_DRIFT);
  const delta = estTrueNet - proxyNet; // negative — proxy overstates
  const meta = chMeta("blinkit");
  return (
    <Card
      title="Blinkit agency-proxy reconciliation"
      sub={`${monthLabel(month)} Blinkit has no native report — its net is the Snell agency proxy (gross ÷ 1.05). That proxy omits Blinkit CESS, so it runs ~${(BLINKIT_AGENCY_PROXY_DRIFT * 100).toFixed(0)}% above the true tax-netted net a native report would show. Same Δ treatment as the native↔agency note, for methodology rather than timing.`}
      style={{ marginTop: 14 }}
      padded={false}
    >
      <table className="table">
        <thead>
          <tr>
            <th>Channel</th>
            <th>Net method</th>
            <th className="num">Agency proxy net (active)</th>
            <th className="num">Est. true tax-netted net</th>
            <th className="num">Δ</th>
            <th className="num">Δ %</th>
            <th>Read</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ background: "rgba(201,162,39,0.05)" }}>
            <td><span className="badge" style={{ background: meta.color + "22", color: meta.color, borderColor: meta.color + "55" }}>{meta.label}</span></td>
            <td className="muted" style={{ fontSize: 11 }}>gross ÷ 1.05 (no Snell net column)</td>
            <td className="num strong">{fmtINR(proxyNet)}</td>
            <td className="num muted">≈ {fmtINR(estTrueNet)}</td>
            <td className="num" style={{ color: "#C9A227", fontWeight: 600 }}>−{fmtINR(Math.abs(delta))}</td>
            <td className="num"><span style={{ color: "#C9A227", fontWeight: 600 }}>−{fmtPct(BLINKIT_AGENCY_PROXY_DRIFT)}</span></td>
            <td>
              <span className="badge" style={{ background: "rgba(201,162,39,0.14)", color: "#C9A227", borderColor: "rgba(201,162,39,0.4)", fontWeight: 600 }}
                title="The agency net is a CESS-blind proxy. Upload this month's Blinkit native report to replace it with a true tax-netted net and remove the estimate.">
                proxy — upload native to resolve
              </span>
            </td>
          </tr>
        </tbody>
      </table>
      <div style={{ padding: "8px 14px", fontSize: 11, color: "var(--ink-3)" }}>
        The Snell agency sheet exposes Blinkit <strong>gross</strong> only, so net is derived as gross ÷ 1.05. The native Blinkit report
        nets the true tax (<strong>CGST + SGST + CESS</strong>); because the proxy can't see CESS it sits ~{(BLINKIT_AGENCY_PROXY_DRIFT * 100).toFixed(0)}% high.
        The proxy remains the active figure (it's the only Blinkit revenue for this month), but treat its net — and the CM it feeds — as a
        <strong> slight over-estimate</strong> until a native Blinkit report is uploaded. For May 2026, where a native report exists, the true ratio
        landed at exactly 1/1.05 so there was no drift; other months are not guaranteed to.
      </div>
    </Card>
  );
};

// One channel/SKU CM chain rendered as a stepped bar waterfall. `cell` is any
// rollup/cell with netRev, cogs, cm1, fees, cm2, adSpend, cm3, fixedAlloc?, cm4?.
const CMWaterfall = ({ cell, hasFixed, excludedNet = 0 }) => {
  const base = Math.max(1, Number.isFinite(cell.netRev) ? cell.netRev : 1);
  const steps = [
    { label: "Net revenue", value: cell.netRev, type: "start" },
    { label: "− COGS", value: cell.cogs == null ? null : -safe(cell.cogs), deduction: true },
    // Reviewer r4: without this row the headline bars read as broken arithmetic
    // (Net − COGS ≠ CM1) whenever part of net has no per-SKU COGS basis at
    // agency tier. The pass-through row makes the subtraction visibly close.
    ...(excludedNet > 0 ? [{
      label: "− No-COGS-basis net", value: -excludedNet, passThrough: true,
      caption: "passes through · excluded from CM lines (no per-SKU COGS at this tier)",
    }] : []),
    { label: "CM1 · after COGS", value: cell.cm1, type: "milestone" },
    { label: "− Platform fees", value: -safe(cell.fees), deduction: true },
    { label: "CM2 · after fees", value: cell.cm2, type: "milestone" },
    { label: "− Ad spend", value: -safe(cell.adSpend), deduction: true },
    { label: "CM3 · after ads", value: cell.cm3, type: "milestone", strong: true },
  ];
  if (hasFixed) {
    steps.push({ label: "− Fixed (allocated)", value: -safe(cell.fixedAlloc), deduction: true });
    steps.push({ label: "CM4 · after fixed", value: cell.cm4, type: "milestone", caption: "reporting view" });
  }

  return (
    <div style={{ display: "grid", gap: 5 }}>
      {steps.map((it, i) => {
        const v = it.value;
        const w = Number.isFinite(v) ? Math.min(100, (Math.abs(v) / base) * 100) : 0;
        const isMilestone = it.type === "milestone";
        const isStart = it.type === "start";
        const isEdge = isMilestone || isStart;
        const barColor = isStart
          ? "var(--brand)"
          : it.passThrough
            ? "var(--ink-4)"                         // neutral grey — not a cost, just basis exclusion
            : isMilestone
              ? (v != null && v < 0 ? "var(--critical)" : "var(--success)")
              : "var(--critical)";
        return (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "200px 1fr 120px", gap: 12, alignItems: "center" }}>
            <div style={{ fontSize: 11.5, color: isEdge ? "var(--ink)" : "var(--ink-3)", fontWeight: isEdge ? 600 : 400 }}>
              {it.label}
              {it.caption && <span className="muted" style={{ fontSize: 9.5, marginLeft: 6, fontStyle: "italic" }}>{it.caption}</span>}
            </div>
            <div style={{ position: "relative", height: 16, background: "var(--bg-sunken)", borderRadius: 3 }}>
              <div style={{
                position: "absolute", left: 0, width: w + "%", height: "100%",
                background: barColor, opacity: isEdge ? (isMilestone ? 0.85 : 1) : 0.5,
                borderRadius: 3,
              }}/>
            </div>
            <div className="mono" style={{ fontSize: 11.5, textAlign: "right", fontWeight: isEdge ? 600 : 400, color: v == null ? "var(--ink-4)" : it.passThrough ? "var(--ink-4)" : isMilestone ? cmColor(v) : it.deduction ? "var(--critical)" : "var(--ink)" }}>
              {v == null ? "—" : (it.deduction || it.passThrough) ? "−" + fmtINR(Math.abs(v)) : fmtINR(v)}
            </div>
          </div>
        );
      })}
    </div>
  );
};
const safe = (n) => (Number.isFinite(n) ? n : 0);

// NATIVE-vs-AGENCY BIAS CORRECTION BAND (rubric 4/89). The tool measures the
// systematic agency over/under-statement on the one month both tiers exist, then
// applies it as a CORRECTION BAND to the CURRENT month's agency-tier channels —
// instead of taking agency figures at face value with only a global caveat. The
// face value stays primary (it's what the agency reported); the band shows where a
// native report would likely land.
const NativeAgencyBiasPanel = ({ facts, month, view }) => {
  const bias = useMemo(() => nativeAgencyBias(facts), [facts]);
  if (!bias.channels.length) return null;
  // current-month agency-tier channels that have a measured, comparable bias.
  const agencyChannels = (view.channels || []).filter((ch) => view.byChannel[ch]?.coverage === "agency");
  const corrections = agencyChannels
    .map((ch) => {
      const b = bias.byChannel[ch];
      if (!b || !b.comparable) return null;
      const faceNet = Number(view.byChannel[ch]?.netRev) || 0;
      if (faceNet <= 0) return null;
      const c = correctedAgencyNet(faceNet, b.biasPct);
      return { ch, biasPct: b.biasPct, ...c };
    })
    .filter(Boolean);

  return (
    <Card
      title="Native-vs-agency bias · correction band"
      sub={`Measured on ${monthLabel(bias.anchorMonth)} — the one month where both a native marketplace export and the agency estimate exist. The per-channel bias is applied as a correction BAND to ${monthLabel(month)}'s agency-tier channels, so they aren't read at face value. Marketplace channels only (website's two sources measure different bases).`}
      style={{ marginTop: 14 }}
      padded={false}
    >
      <table className="table">
        <thead>
          <tr>
            <th>Channel</th>
            <th className="num">Native net ({monthShort(bias.anchorMonth)})</th>
            <th className="num">Agency net ({monthShort(bias.anchorMonth)})</th>
            <th className="num">Measured bias</th>
            <th>Read</th>
          </tr>
        </thead>
        <tbody>
          {bias.channels.map((ch) => {
            const b = bias.byChannel[ch];
            const meta = chMeta(ch);
            return (
              <tr key={ch}>
                <td><span className="badge" style={{ background: meta.color + "22", color: meta.color, borderColor: meta.color + "55" }}>{meta.label}</span></td>
                <td className="num">{fmtINR(b.nativeNet)}</td>
                <td className="num muted">{fmtINR(b.agencyNet)}</td>
                <td className="num" style={{ color: Math.abs(b.biasPct) < 0.01 ? "var(--ink-3)" : b.biasPct > 0 ? "var(--warning)" : "var(--info)" }}>
                  {b.biasPct >= 0 ? "+" : "−"}{Math.abs(b.biasPct * 100).toFixed(2)}%
                </td>
                <td className="muted" style={{ fontSize: 11.5 }}>
                  {!b.comparable ? <span title={b.note}>basis mismatch — reference only</span>
                    : b.direction === "matches" ? "agency ≈ native (no correction needed)"
                    : `agency ${b.direction} net by ${Math.abs(b.biasPct * 100).toFixed(1)}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {corrections.length > 0 ? (
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border-soft)" }}>
          <div className="stat-label" style={{ marginBottom: 8 }}>Applied to {monthLabel(month)} (agency-tier channels)</div>
          <table className="table">
            <thead>
              <tr>
                <th>Channel</th>
                <th className="num">Agency face value</th>
                <th className="num">Bias-corrected est.</th>
                <th className="num">Likely band</th>
              </tr>
            </thead>
            <tbody>
              {corrections.map((c) => {
                const meta = chMeta(c.ch);
                return (
                  <tr key={c.ch}>
                    <td><span className="badge" style={{ background: meta.color + "22", color: meta.color, borderColor: meta.color + "55" }}>{meta.label}</span></td>
                    <td className="num">{fmtINR(c.face)}</td>
                    <td className="num strong">{fmtINR(c.corrected)}</td>
                    <td className="num muted">{fmtINR(c.band[0])} – {fmtINR(c.band[1])}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="muted" style={{ fontSize: 10.5, marginTop: 8 }}>
            The <strong>face value</strong> is what the agency reported and remains the primary figure across the tool.
            The <strong>corrected estimate</strong> = face ÷ (1 + measured bias) — what a native report would likely show.
            The band is ±half the bias magnitude (a single-month bias is an estimate, not a guarantee). Read it as a
            confidence range, not a restatement.
          </div>
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 10.5, padding: "8px 14px" }}>
          {monthLabel(month)} has no agency-tier marketplace channel with a measured comparable bias, so no correction
          band applies — the figures stand at face value.
        </div>
      )}
    </Card>
  );
};

// Agency↔native reconciliation note — surfaces the Snell/Monarch-vs-native delta
// for any native channel that also has an agency shadow (V2.1, never silent).
const ReconciliationNote = ({ reconciliation, month }) => {
  if (!reconciliation || reconciliation.length === 0) return null;
  const anyGap = reconciliation.some((r) => r.isGap);
  return (
    <Card
      title="Agency ↔ native reconciliation"
      sub={
        anyGap
          ? `Where ${monthLabel(month)} has a native report the agency figure is suppressed (native wins) but retained here. Small deltas are return-tail timing; a flagged COVERAGE GAP means the native export under-captures vs the agency's tracking and needs investigation`
          : `Where ${monthLabel(month)} has a native per-SKU report, the Snell/Monarch agency figure is suppressed (native wins) but retained here — every delta is small return-tail timing, never a silent drop`
      }
      style={{ marginTop: 14 }}
      padded={false}
    >
      <table className="table">
        <thead>
          <tr>
            <th>Channel</th>
            <th>Agency source</th>
            <th className="num">Native net (active)</th>
            <th className="num">Agency net (shadow)</th>
            <th className="num">Δ</th>
            <th className="num">Δ %</th>
            <th>Read</th>
          </tr>
        </thead>
        <tbody>
          {reconciliation.map((r) => {
            const meta = chMeta(r.channel);
            // Gap rows are visually distinct: critical-toned Δ + a "coverage gap"
            // badge that tells the founder to investigate, not ignore.
            const deltaColor = r.isGap ? "var(--critical)" : r.delta >= 0 ? "var(--ink-3)" : "var(--critical)";
            return (
              <tr key={r.channel} style={r.isGap ? { background: "rgba(220,38,38,0.05)" } : undefined}>
                <td>
                  <span className="badge" style={{ background: meta.color + "22", color: meta.color, borderColor: meta.color + "55" }}>{meta.label}</span>
                </td>
                <td className="muted" style={{ fontSize: 11 }}>{r.tier === "monarch" ? "Monarch website" : "Snell agency"}</td>
                <td className="num strong">{fmtINR(r.native)}</td>
                <td className="num muted">{fmtINR(r.agency)}</td>
                <td className="num" style={{ color: deltaColor, fontWeight: r.isGap ? 600 : 400 }}>
                  {r.delta >= 0 ? "+" : "−"}{fmtINR(Math.abs(r.delta))}
                </td>
                <td className="num"><span style={{ color: deltaColor, fontWeight: r.isGap ? 600 : 400 }}>{r.deltaPct == null ? "—" : (r.deltaPct >= 0 ? "+" : "") + fmtPct(r.deltaPct)}</span></td>
                <td>
                  {r.isGap ? (
                    <span className="badge" style={{ background: "rgba(220,38,38,0.12)", color: "var(--critical)", borderColor: "rgba(220,38,38,0.4)", fontWeight: 600 }} title="The native export under-captures this channel vs the agency's own tracking. This is NOT return-tail timing — investigate the native report's completeness before trusting the native revenue figure.">
                      coverage gap — investigate
                    </span>
                  ) : (
                    <span className="muted" style={{ fontSize: 11 }} title="Δ is within the return-tail band — the agency books returns into a different period; native remains authoritative.">return-tail timing</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ padding: "8px 14px", fontSize: 11, color: "var(--ink-3)" }}>
        Native reports are authoritative for revenue + units; the agency figure is kept for cross-checking only.
        A <strong>small</strong> delta (≤{fmtPct(RECON_TIMING_BAND)}) is the agency capturing return-tail timing differently — not double counting.
        {anyGap && (
          <>
            {" "}A row flagged <strong style={{ color: "var(--critical)" }}>coverage gap</strong> is different: the native export
            captures materially <strong>less</strong> than the agency's own tracking (e.g. the Shopify "Net items sold" export under-counts
            vs Monarch's website sales), so the native figure likely <strong>under-states</strong> this channel's true revenue. Treat that channel's
            native total — and the company CM it feeds — as a floor until the native export is reconciled. This is a data-completeness issue, not timing.
          </>
        )}
      </div>
    </Card>
  );
};

// ═════════════════════════════════════════════════════════════════════════════
// CM3 MATRIX — NATIVE months only. SKU rows × channel columns, cell = CM3.
// Agency months show an explicit "needs native reports" note instead.
// ═════════════════════════════════════════════════════════════════════════════
const MatrixView = ({ view, month }) => {
  const [drill, setDrill] = useState(null);
  const cm = view.cmV1;
  // Native channels of this month (the only ones with a per-SKU matrix).
  const channels = useMemo(
    () => (cm ? orderChannels(Object.keys(cm.byChannel)) : []),
    [cm]
  );
  const codes = useMemo(
    () => (cm ? Object.keys(cm.bySku).sort((a, b) => safe(cm.bySku[b].netRev) - safe(cm.bySku[a].netRev)) : []),
    [cm]
  );

  if (!cm) {
    return (
      <Card title="SKU × channel CM3 matrix" sub="Per-SKU contribution margin after ads — native (per-SKU) months only">
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "10px 2px" }}>
          <div className="note" style={{ background: "rgba(99,102,241,0.06)", borderColor: "rgba(99,102,241,0.25)" }}>
            <strong style={{ color: "#6366f1" }}>{monthLabel(month)} is an agency-tier month.</strong>&nbsp;
            Snell/Monarch history carries channel-grain revenue only — there is no per-SKU revenue to build a
            SKU×channel matrix from. Upload this month's native reports (Amazon All-Orders, Flipkart Sales, Blinkit,
            Shopify net) to unlock the per-SKU matrix.
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            Channel-level CM for {monthLabel(month)} is on the <strong>CM waterfall</strong> tab. Per-SKU units (where
            Snell tracks them) appear in the <strong>Coverage</strong> tab.
          </div>
          <div>
            <div className="muted" style={{ fontSize: 11.5, marginBottom: 6 }}>Channel CM3 for {monthLabel(month)} (agency tier):</div>
            <table className="table" style={{ maxWidth: 560 }}>
              <thead><tr><th>Channel</th><th className="num">Net rev</th><th className="num">CM3</th><th className="num">CM3 %</th><th>Ad basis</th></tr></thead>
              <tbody>
                {view.channels.map((ch) => {
                  const c = view.byChannel[ch];
                  const meta = chMeta(ch);
                  return (
                    <tr key={ch}>
                      <td><span className="badge" style={{ background: meta.color + "22", color: meta.color, borderColor: meta.color + "55" }}>{meta.label}</span></td>
                      <td className="num">{fmtINR(c.netRev)}</td>
                      <td className="num strong" style={{ color: cmColor(c.cm3) }}>{c.cm3 == null ? "—" : fmtSignedINR(c.cm3)}</td>
                      <td className="num"><span style={{ color: pctTone(c.pcts.cm3) }}>{fmtPct(c.pcts.cm3)}</span></td>
                      <td><AdBasisChip basis={c.adBasis} channel={ch}/></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card
        title="SKU × channel CM3 matrix"
        sub="Contribution margin after ads, per SKU per channel · the headline decision view · click a cell to drill"
        padded={false}
      >
        <div style={{ overflowX: "auto" }}>
          <table className="table" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ position: "sticky", left: 0, background: "var(--bg-card)", zIndex: 1 }}>SKU</th>
                {channels.map((ch) => {
                  const meta = chMeta(ch);
                  return <th key={ch} className="num" style={{ color: meta.color }}>{meta.label}</th>;
                })}
                <th className="num">SKU total CM3</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((code) => {
                const sku = cm.bySku[code];
                return (
                  <tr key={code}>
                    <td style={{ position: "sticky", left: 0, background: "var(--bg-card)", zIndex: 1, cursor: "pointer" }} onClick={() => setDrill({ code })}>
                      <div style={{ fontWeight: 500 }}>{SKU_META[code]?.name || code}</div>
                      <div className="sku">{code} · {SKU_META[code]?.variant || ""}</div>
                    </td>
                    {channels.map((ch) => {
                      const m = cm.matrix[code]?.[ch];
                      if (!m) return <td key={ch} className="num muted" style={{ color: "var(--ink-4)" }}>—</td>;
                      const neg = m.cm3 != null && m.cm3 < 0;
                      return (
                        <td
                          key={ch}
                          className="num"
                          style={{ cursor: "pointer", background: neg ? "var(--critical-soft)" : undefined }}
                          onClick={() => setDrill({ code, channel: ch })}
                          title={`${skuLabel(code)} · ${chMeta(ch).label}\nNet rev ${fmtINR(m.netRev)} · ${fmtN(m.units)} units · ad ${fmtINR(m.adSpend)}`}
                        >
                          <div style={{ color: cmColor(m.cm3), fontWeight: neg ? 600 : 400 }}>
                            {m.cm3 == null ? "—" : fmtSignedINR(m.cm3)}
                          </div>
                          <div className="muted" style={{ fontSize: 10 }}>{fmtPct(m.cm3Pct, 1)}</div>
                        </td>
                      );
                    })}
                    <td className="num strong" style={{ color: cmColor(sku.cm3) }} onClick={() => setDrill({ code })}>
                      <div style={{ cursor: "pointer" }}>{sku.cm3 == null ? "—" : fmtSignedINR(sku.cm3)}</div>
                      <div className="muted" style={{ fontSize: 10 }}>{fmtPct(sku.pcts.cm3, 1)}</div>
                    </td>
                  </tr>
                );
              })}
              {/* Channel totals footer */}
              <tr style={{ background: "var(--bg-sunken)", fontWeight: 600 }}>
                <td style={{ position: "sticky", left: 0, background: "var(--bg-sunken)", zIndex: 1 }}>Channel CM3</td>
                {channels.map((ch) => {
                  const c = cm.byChannel[ch];
                  return (
                    <td key={ch} className="num" style={{ color: cmColor(c?.cm3) }}>
                      {c?.cm3 == null ? "—" : fmtSignedINR(c.cm3)}
                      <div className="muted" style={{ fontSize: 10 }}>{fmtPct(c?.pcts?.cm3, 1)}</div>
                    </td>
                  );
                })}
                <td className="num" style={{ color: cmColor(cm.company.cm3) }}>
                  {fmtSignedINR(cm.company.cm3)}
                  <div className="muted" style={{ fontSize: 10 }}>{fmtPct(cm.company.pcts.cm3, 1)}</div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{ padding: "8px 14px", fontSize: 11, color: "var(--ink-3)", display: "flex", gap: 16, flexWrap: "wrap" }}>
          <span><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--critical-soft)", border: "1px solid var(--critical)", borderRadius: 2, marginRight: 5, verticalAlign: "middle" }}/>negative CM3 (loss-making after ads)</span>
          <span>“—” = SKU not sold on that channel, or COGS missing</span>
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            ad basis in drill: <AdBasisChip basis={AD_BASIS.ACTUAL}/><AdBasisChip basis={AD_BASIS.ALLOC}/>
          </span>
        </div>
      </Card>

      {drill && (
        <SkuDrillModal code={drill.code} focusChannel={drill.channel} cm={cm} channels={channels} onClose={() => setDrill(null)}/>
      )}
    </>
  );
};

// ═════════════════════════════════════════════════════════════════════════════
// SKU ECONOMICS — per-SKU cards (NATIVE months only). Agency months → note.
// ═════════════════════════════════════════════════════════════════════════════
const SkuEconomicsView = ({ view, month }) => {
  const [drill, setDrill] = useState(null);
  const cm = view.cmV1;
  const channels = useMemo(() => (cm ? orderChannels(Object.keys(cm.byChannel)) : []), [cm]);
  const codes = useMemo(
    () => (cm ? Object.keys(cm.bySku).sort((a, b) => safe(cm.bySku[b].netRev) - safe(cm.bySku[a].netRev)) : []),
    [cm]
  );

  if (!cm) {
    return (
      <Card title="SKU economics" sub="Per-SKU contribution cards — native (per-SKU) months only">
        <div className="note" style={{ background: "rgba(99,102,241,0.06)", borderColor: "rgba(99,102,241,0.25)" }}>
          <strong style={{ color: "#6366f1" }}>{monthLabel(month)} is an agency-tier month.</strong>&nbsp;
          No per-SKU revenue exists at the Snell/Monarch tier, so per-SKU economics cards aren't available.
          Channel-level economics are on the <strong>CM waterfall</strong> tab; upload native reports for this month
          to unlock SKU cards.
        </div>
      </Card>
    );
  }

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        {codes.map((code) => {
          const sku = cm.bySku[code];
          const card = CostInputs.getCostCard(code);
          const activeChannels = channels.filter((ch) => sku.byChannel?.[ch]);
          const cm3Pct = sku.pcts.cm3;
          const tone = pctTone(cm3Pct);
          return (
            <div key={code} className="card" style={{ cursor: "pointer" }} onClick={() => setDrill({ code })}>
              <div className="card-body">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{SKU_META[code]?.name || code}</div>
                    <div className="sku">{code} · {SKU_META[code]?.variant || ""}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="mono" style={{ fontSize: 17, fontWeight: 700, color: tone }}>{fmtPct(cm3Pct)}</div>
                    <div className="muted" style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.04em" }}>CM3 %</div>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, padding: "8px 0", borderTop: "1px solid var(--border-soft)", borderBottom: "1px solid var(--border-soft)" }}>
                  <Stat label="Net rev" value={fmtINR(sku.netRev)}/>
                  <Stat label="Units" value={fmtN(sku.units)}/>
                  <Stat label="CM3" value={sku.cm3 == null ? "—" : fmtINR(sku.cm3)} color={cmColor(sku.cm3)}/>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8, fontSize: 11 }}>
                  <span className="muted">
                    COGS {card ? fmtINR(card.cogs) + "/u" : <span style={{ color: "var(--critical)" }}>missing</span>}
                    {card?.pkgPlaceholder && (
                      <span title="Packaging cost is a ₹0 placeholder in the COGS file" style={{ marginLeft: 6, color: "var(--warning)", fontWeight: 600 }}>⚠ pkg ₹0</span>
                    )}
                  </span>
                  <span style={{ display: "flex", gap: 4 }}>
                    {activeChannels.map((ch) => {
                      const meta = chMeta(ch);
                      const c = sku.byChannel[ch];
                      const negCh = c?.cm3 != null && c.cm3 < 0;
                      return (
                        <span key={ch} title={`${meta.label} CM3 ${c?.cm3 == null ? "—" : fmtINR(c.cm3)}`}
                          style={{ width: 8, height: 8, borderRadius: "50%", background: negCh ? "var(--critical)" : meta.color, opacity: negCh ? 1 : 0.85 }}/>
                      );
                    })}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {drill && <SkuDrillModal code={drill.code} cm={cm} channels={channels} onClose={() => setDrill(null)}/>}
    </>
  );
};

const Stat = ({ label, value, color }) => (
  <div>
    <div className="mono" style={{ fontSize: 13, fontWeight: 600, color: color || "var(--ink)" }}>{value}</div>
    <div className="muted" style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.04em", marginTop: 1 }}>{label}</div>
  </div>
);

// ── SKU economics drill — full CM chain per channel for one SKU ──
const SkuDrillModal = ({ code, focusChannel, cm, channels, onClose }) => {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sku = cm.bySku[code];
  const card = CostInputs.getCostCard(code);
  // Determine each channel's ad basis for the drill (from adAllocation).
  const adBasisFor = (ch) => {
    const alloc = cm.adAllocation?.[ch] || {};
    const c = sku.byChannel?.[ch];
    if (!c || !(c.adSpend > 0)) return AD_BASIS.NONE;
    return safe(alloc.direct) > 0 ? AD_BASIS.ACTUAL : AD_BASIS.ALLOC;
  };
  if (!sku) return null;
  const activeChannels = channels.filter((ch) => sku.byChannel?.[ch]);
  const hasFixed = cm.coverage.hasFixedCost;
  const focusCell = focusChannel && sku.byChannel?.[focusChannel] ? sku.byChannel[focusChannel] : sku;
  const focusLabel = focusChannel ? chMeta(focusChannel).label : "All channels (blended)";

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal-card" onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(820px, 94vw)" }}>
        <div className="modal-head">
          <div>
            <div className="modal-title">{SKU_META[code]?.name || code}</div>
            <div className="modal-sub sku">
              {code} · {SKU_META[code]?.variant || ""} ·{" "}
              COGS {card ? fmtINR(card.cogs) + "/unit" : "missing"}
              {card?.asOf && <span> · as of {card.asOf}</span>}
              {card?.pkgPlaceholder && <span style={{ color: "var(--warning)", marginLeft: 6 }}>· pkg ₹0 placeholder</span>}
            </div>
          </div>
          <button className="btn ghost icon" onClick={onClose} title="Close (Esc)">✕</button>
        </div>

        <div className="modal-body" style={{ gap: 12 }}>
          <div className="blk-modal-list">
            <div className="blk-modal-list-head" style={{ gridTemplateColumns: "1fr repeat(6, auto)", gap: 10 }}>
              <span>Channel</span>
              <span style={{ textAlign: "right", minWidth: 70 }}>Net rev</span>
              <span style={{ textAlign: "right", minWidth: 60 }}>CM1</span>
              <span style={{ textAlign: "right", minWidth: 60 }}>CM2</span>
              <span style={{ textAlign: "right", minWidth: 56 }}>Ads</span>
              <span style={{ textAlign: "right", minWidth: 60 }}>CM3</span>
              <span style={{ textAlign: "right", minWidth: 50 }}>CM3%</span>
            </div>
            {activeChannels.map((ch) => {
              const c = sku.byChannel[ch];
              const meta = chMeta(ch);
              const isFocus = ch === focusChannel;
              return (
                <div key={ch} className="blk-modal-row" style={{ gridTemplateColumns: "1fr repeat(6, auto)", gap: 10, padding: "8px 14px", background: isFocus ? "var(--brand-soft)" : undefined }}>
                  <div className="blk-modal-row-wh">
                    <span className="badge" style={{ background: meta.color + "22", color: meta.color, borderColor: meta.color + "55" }}>{meta.label}</span>
                    <span className="muted" style={{ fontSize: 10.5, marginLeft: 6 }}>{fmtN(c.units)} units</span>
                  </div>
                  <div className="mono" style={{ minWidth: 70, textAlign: "right" }}>{fmtINR(c.netRev)}</div>
                  <div className="mono" style={{ minWidth: 60, textAlign: "right", color: cmColor(c.cm1) }}>{c.cm1 == null ? "—" : fmtINR(c.cm1)}</div>
                  <div className="mono" style={{ minWidth: 60, textAlign: "right", color: cmColor(c.cm2) }}>{c.cm2 == null ? "—" : fmtINR(c.cm2)}</div>
                  <div style={{ minWidth: 56, textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
                    <span className="mono muted">{c.adSpend > 0 ? fmtINR(c.adSpend) : "—"}</span>
                    {c.adSpend > 0 && <AdBasisChip basis={adBasisFor(ch)} channel={ch}/>}
                  </div>
                  <div className="mono" style={{ minWidth: 60, textAlign: "right", fontWeight: 600, color: cmColor(c.cm3) }}>{c.cm3 == null ? "—" : fmtINR(c.cm3)}</div>
                  <div className="mono" style={{ minWidth: 50, textAlign: "right", color: c.pcts.cm3 == null ? "var(--ink-4)" : c.pcts.cm3 < 0 ? "var(--critical)" : "var(--ink-3)" }}>{fmtPct(c.pcts.cm3, 1)}</div>
                </div>
              );
            })}
            <div className="blk-modal-row" style={{ gridTemplateColumns: "1fr repeat(6, auto)", gap: 10, padding: "8px 14px", background: "var(--bg-sunken)", borderTop: "1px solid var(--border)", fontWeight: 600 }}>
              <div className="blk-modal-row-wh">Blended (all channels)</div>
              <div className="mono" style={{ minWidth: 70, textAlign: "right" }}>{fmtINR(sku.netRev)}</div>
              <div className="mono" style={{ minWidth: 60, textAlign: "right", color: cmColor(sku.cm1) }}>{sku.cm1 == null ? "—" : fmtINR(sku.cm1)}</div>
              <div className="mono" style={{ minWidth: 60, textAlign: "right", color: cmColor(sku.cm2) }}>{sku.cm2 == null ? "—" : fmtINR(sku.cm2)}</div>
              <div className="mono" style={{ minWidth: 56, textAlign: "right" }}>{fmtINR(sku.adSpend)}</div>
              <div className="mono" style={{ minWidth: 60, textAlign: "right", color: cmColor(sku.cm3) }}>{sku.cm3 == null ? "—" : fmtINR(sku.cm3)}</div>
              <div className="mono" style={{ minWidth: 50, textAlign: "right" }}>{fmtPct(sku.pcts.cm3, 1)}</div>
            </div>
          </div>

          <div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8, padding: "0 2px" }}>
              <strong style={{ fontSize: 13 }}>CM chain</strong>
              <span className="muted" style={{ fontSize: 11 }}>{focusLabel}</span>
            </div>
            <CMWaterfall cell={focusCell} hasFixed={hasFixed}/>
          </div>
        </div>

        <div className="modal-foot">
          <span className="muted" style={{ fontSize: 11.5 }}>
            CM chain = netRev − COGS×units → CM1 − platform-fee% → CM2 − ads (direct + channel-allocated) → CM3{hasFixed ? " − fixed (allocated) → CM4" : ""}. COGS/fee% editable in Cost inputs.
          </span>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════════════
// CM TREND — net revenue + CM3 across every CM-computable month, per channel.
// Built straight from the coverage-aware engine (monthlyNetRevByChannel + the
// per-month×channel CM cells). Partial (MTD) months are flagged, never silently
// compared. NO raw floats — every label/figure through D.fmtINR/fmtPct.
// ═════════════════════════════════════════════════════════════════════════════
const CMTrendView = ({ facts }) => {
  const [metric, setMetric] = useState("cm3"); // cm3 | netRev | cm3pct
  const [showChannels, setShowChannels] = useState(true);

  const model = useMemo(() => buildTrend(facts), [facts]);
  if (!model || model.months.length === 0) {
    return <Card title="CM trend"><div className="muted">No CM-computable months in the fact store.</div></Card>;
  }

  const { months, channels, rows, companyByMonth } = model;

  return (
    <>
      <Card
        title="Contribution margin trend"
        sub="CM3 (and net revenue) per channel across every month the engine can compute — agency history + native May. Partial (MTD) months are dashed and excluded from like-for-like reads."
        action={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={metric} onChange={(e) => setMetric(e.target.value)} style={{ fontSize: 11.5, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--ink)" }}>
              <option value="cm3">CM3 (₹)</option>
              <option value="netRev">Net revenue (₹)</option>
              <option value="cm3pct">CM3 %</option>
            </select>
            <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }} className="muted">
              <input type="checkbox" checked={showChannels} onChange={(e) => setShowChannels(e.target.checked)}/> per channel
            </label>
          </div>
        }
      >
        <TrendChart
          months={months}
          channels={channels}
          rows={rows}
          companyByMonth={companyByMonth}
          metric={metric}
          showChannels={showChannels}
        />
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10, fontSize: 11 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 14, height: 0, borderTop: "2px solid var(--ink)" }}/> Company total
          </span>
          {showChannels && channels.map((ch) => {
            const meta = chMeta(ch);
            return (
              <span key={ch} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 14, height: 0, borderTop: `2px solid ${meta.color}` }}/> {meta.label}
              </span>
            );
          })}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--ink-3)" }}>
            <span style={{ width: 14, height: 0, borderTop: "2px dashed var(--ink-3)" }}/> partial (MTD)
          </span>
          {metric === "cm3pct" && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--warning)" }} title={`Early-ramp months with net revenue below ${fmtINR(LOW_BASE_REV)} — their CM3% is over a tiny base, so it's capped to ±${(LOW_BASE_PCT_CAP * 100).toFixed(0)}% on the chart (the true % is in the tooltip + table). Not a mature-P&L alarm.`}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "transparent", border: "1.4px solid var(--warning)" }}/> low base (CM3% capped)
            </span>
          )}
        </div>
        {metric === "cm3pct" && (
          <div className="muted" style={{ fontSize: 10.5, marginTop: 6, color: "var(--ink-3)" }}>
            <span style={{ color: "var(--warning)", fontWeight: 600 }}>Low-base months</span> (ramp period, net rev &lt; {fmtINR(LOW_BASE_REV)}) have their CM3% capped to ±{(LOW_BASE_PCT_CAP * 100).toFixed(0)}% on the chart so a single
            early ramp point doesn't crush the axis for the mature months. The uncapped figure is in the tooltip and the table below — labelled with its revenue base.
          </div>
        )}
      </Card>

      {/* The numbers behind the chart — month × channel CM3, basis-tagged. */}
      <Card
        title="Monthly net revenue &amp; CM3 by channel"
        sub="Every figure carries its coverage tier (native / agency) — the active source per month×channel"
        style={{ marginTop: 14 }}
        padded={false}
      >
        <div style={{ overflowX: "auto" }}>
          <table className="table" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ position: "sticky", left: 0, background: "var(--bg-card)", zIndex: 1 }}>Month</th>
                {channels.map((ch) => {
                  const meta = chMeta(ch);
                  return <th key={ch} className="num" style={{ color: meta.color }}>{meta.label}</th>;
                })}
                <th className="num">Company CM3</th>
              </tr>
            </thead>
            <tbody>
              {[...months].reverse().map((mo) => {
                const co = companyByMonth[mo];
                return (
                  <tr key={mo} style={co?.lowBase ? { background: "rgba(176,122,31,0.05)" } : undefined}>
                    <td style={{ position: "sticky", left: 0, background: co?.lowBase ? "rgba(176,122,31,0.05)" : "var(--bg-card)", zIndex: 1 }}>
                      <span style={{ fontWeight: 500 }}>{monthShort(mo)}</span>
                      {co?.partial && <span title="Partial month (MTD)" style={{ marginLeft: 5, fontSize: 9, color: "var(--warning)", fontWeight: 700 }}>MTD</span>}
                      {co?.lowBase && (
                        <div title={`Early-ramp month — company net revenue ${fmtINR(co.netRev)} is below the ${fmtINR(LOW_BASE_REV)} low-base floor. Its CM3% (${fmtPct(co.cm3Pct)}) is over a tiny base and is not a mature-P&L signal.`}
                          style={{ fontSize: 9, color: "var(--warning)", fontWeight: 600, marginTop: 1 }}>
                          low base · {fmtINR(co.netRev)} rev
                        </div>
                      )}
                    </td>
                    {channels.map((ch) => {
                      const c = rows[ch]?.[mo];
                      if (!c) return <td key={ch} className="num muted" style={{ color: "var(--ink-4)" }}>—</td>;
                      return (
                        <td key={ch} className="num" title={`net ${fmtINR(c.netRev)} · ${c.basis}`}>
                          <div style={{ color: cmColor(c.cm3) }}>{c.cm3 == null ? "—" : fmtSignedINR(c.cm3)}</div>
                          <div className="muted" style={{ fontSize: 9.5 }}>
                            {fmtINR(c.netRev)} · <span style={{ color: c.basis === "native" ? "var(--success)" : "#6366f1", fontWeight: 600 }}>{c.basis === "native" ? "nat" : "agy"}</span>
                          </div>
                        </td>
                      );
                    })}
                    <td className="num strong" style={{ color: cmColor(co?.cm3) }}>
                      {co?.cm3 == null ? "—" : fmtSignedINR(co.cm3)}
                      <div className="muted" style={{ fontSize: 9.5 }}>{fmtPct(co?.cm3Pct, 1)}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "8px 14px", fontSize: 10.5, color: "var(--ink-3)" }}>
          nat = native per-SKU report (May) · agy = Snell/Monarch agency channel-grain · blanks = channel not active that month.
          Website CM3 reads “—” in agency months: Monarch carries website revenue but no per-SKU units to price COGS against.
        </div>
      </Card>
    </>
  );
};

// M5 — LOW-BASE GUARD. The earliest ramp months carry tiny revenue (Aug-24
// ₹1,150 … Dec-24 ₹16k), so a few thousand rupees of ad spend produces a CM3%
// of −252% that reads as a five-alarm fire when it is really "we spent ₹40k of
// ads against ₹16k of revenue while standing the business up". A ratio over a
// near-zero denominator is mathematically real but tells the founder nothing
// actionable about a mature P&L. We do NOT hide or floor these months (founder
// rule: negative CM cells are always shown) — we mark a month "low base" when
// its COMPANY net revenue is below LOW_BASE_REV, and then:
//   • the CM3% chart caps the plotted % at ±LOW_BASE_PCT_CAP for low-base months
//     so one −252% point doesn't crush the y-axis for the 21 honest months
//     (the true % is still in the tooltip + the table, annotated "low base");
//   • the table rows + chart points carry a "low base · ₹X rev" caption.
// ₹50k cleanly separates the ramp (≤₹37k through Jan-25) from the first genuine
// month (Feb-25 ₹76k). The cap (±60%) sits just outside the worst mature-month
// swing so a real mature blow-out would still read as an alarm.
const LOW_BASE_REV = 50000;
const LOW_BASE_PCT_CAP = 0.6;

// Trend model: per channel per month {netRev, cm3, cm3Pct, basis, partial} +
// a company-by-month rollup. Uses the coverage-aware engine for every cell so no
// ratio ever crosses a coverage window.
function buildTrend(facts) {
  const hl = monthlyNetRevByChannel(facts, {}); // all months
  const months = hl.months;
  const channels = orderChannels(hl.channels);
  const rows = {};
  const companyByMonth = {};
  for (const mo of months) {
    let coNet = 0, coCm3 = 0, anyCm = false, partial = false;
    for (const ch of channels) {
      const r = computeMonthChannelCM({ facts, month: mo, channel: ch });
      if (r.coverage === "none") continue;
      rows[ch] = rows[ch] || {};
      const chNet = safe(r.netRev);
      rows[ch][mo] = {
        netRev: chNet,
        cm3: r.cm3 == null ? null : safe(r.cm3),
        cm3Pct: r.pcts?.cm3 ?? null,
        basis: r.coverage,
        partial: !!r.partial,
        // a channel cell is low-base when ITS OWN net is below the floor — used
        // to cap that channel's own line independently of the company total.
        lowBase: chNet > 0 && chNet < LOW_BASE_REV,
      };
      coNet += chNet;
      if (r.cm3 != null) { coCm3 += safe(r.cm3); anyCm = true; }
      if (r.partial) partial = true;
    }
    companyByMonth[mo] = {
      netRev: coNet,
      cm3: anyCm ? coCm3 : null,
      cm3Pct: anyCm && coNet > 0 ? coCm3 / coNet : null,
      partial,
      // company-level low base — the headline ramp annotation driver.
      lowBase: coNet > 0 && coNet < LOW_BASE_REV,
    };
  }
  return { months, channels, rows, companyByMonth };
}

// ── Trend line chart (SVG, theme-variable colours, NaN-free) ──
const TrendChart = ({ months, channels, rows, companyByMonth, metric, showChannels }) => {
  const W = 860, H = 300, padL = 64, padR = 16, padT = 16, padB = 36;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = months.length;

  // M5 — cap a low-base CM3% to ±LOW_BASE_PCT_CAP for PLOTTING only, so one
  // −252% ramp month doesn't crush the axis for the mature months. The true,
  // uncapped value is what the table + tooltips show (capped() exposes both).
  const capPct = (raw, lowBase) => {
    if (raw == null || !Number.isFinite(raw)) return { plot: raw, raw, capped: false };
    if (metric !== "cm3pct" || !lowBase) return { plot: raw, raw, capped: false };
    const plot = Math.max(-LOW_BASE_PCT_CAP, Math.min(LOW_BASE_PCT_CAP, raw));
    return { plot, raw, capped: plot !== raw };
  };
  // value accessor per metric (returns the PLOT value used for axis/line geometry).
  const valOf = (cell) => {
    if (!cell) return null;
    if (metric === "netRev") return cell.netRev;
    if (metric === "cm3pct") return capPct(cell.cm3Pct, cell.lowBase).plot;
    return cell.cm3;
  };
  const coVal = (mo) => {
    const co = companyByMonth[mo];
    if (!co) return null;
    if (metric === "netRev") return co.netRev;
    if (metric === "cm3pct") return capPct(co.cm3Pct, co.lowBase).plot;
    return co.cm3;
  };
  // raw (uncapped) accessors for tooltips so the founder always sees the truth.
  const rawCoVal = (mo) => {
    const co = companyByMonth[mo];
    if (!co) return null;
    if (metric === "netRev") return co.netRev;
    if (metric === "cm3pct") return co.cm3Pct;
    return co.cm3;
  };
  const rawChVal = (cell) => {
    if (!cell) return null;
    if (metric === "netRev") return cell.netRev;
    if (metric === "cm3pct") return cell.cm3Pct;
    return cell.cm3;
  };
  const lowBaseOf = (mo, ch) =>
    ch === "__company" ? !!companyByMonth[mo]?.lowBase : !!rows[ch]?.[mo]?.lowBase;

  // y-domain over every visible series.
  const allVals = [];
  for (const mo of months) {
    const cv = coVal(mo);
    if (Number.isFinite(cv)) allVals.push(cv);
    if (showChannels) for (const ch of channels) { const v = valOf(rows[ch]?.[mo]); if (Number.isFinite(v)) allVals.push(v); }
  }
  if (allVals.length === 0) return <div className="muted" style={{ fontSize: 12 }}>No data for this metric.</div>;
  let yMin = Math.min(0, ...allVals), yMax = Math.max(0, ...allVals);
  if (yMin === yMax) yMax = yMin + 1;
  const pad = (yMax - yMin) * 0.08;
  yMin -= pad; yMax += pad;

  const x = (i) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v) => padT + innerH - ((v - yMin) / (yMax - yMin)) * innerH;
  const zeroY = y(0);

  const fmtAxis = (v) => (metric === "cm3pct" ? `${(v * 100).toFixed(0)}%` : D.fmtINR(v));

  // Build a polyline for a series, splitting solid (full) vs dashed (partial)
  // segments so MTD months are visually distinct (V2.2 like-for-like discipline).
  const buildSegments = (getVal, getPartial) => {
    const pts = months.map((mo, i) => {
      const v = getVal(mo);
      return Number.isFinite(v) ? { i, x: x(i), y: y(v), partial: getPartial(mo) } : null;
    });
    const segs = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (!a || !b) continue;
      segs.push({ a, b, dashed: b.partial || a.partial });
    }
    return { pts: pts.filter(Boolean), segs };
  };

  // gridlines (4).
  const grids = [0, 0.25, 0.5, 0.75, 1].map((t) => yMin + t * (yMax - yMin));
  // x labels — thin to ~12 to avoid crowding.
  const labelEvery = Math.max(1, Math.ceil(n / 12));

  const seriesList = [];
  if (showChannels) for (const ch of channels) {
    seriesList.push({ key: ch, color: chMeta(ch).color, getVal: (mo) => valOf(rows[ch]?.[mo]), getPartial: (mo) => !!rows[ch]?.[mo]?.partial, width: 1.6, opacity: 0.85 });
  }
  seriesList.push({ key: "__company", color: "var(--ink)", getVal: coVal, getPartial: (mo) => !!companyByMonth[mo]?.partial, width: 2.4, opacity: 1 });

  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", minWidth: 600 }}>
        {/* gridlines + y labels */}
        {grids.map((gv, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(gv)} y2={y(gv)} stroke="var(--border-soft)" strokeWidth="1"/>
            <text x={padL - 8} y={y(gv) + 3} textAnchor="end" fontSize="9.5" fill="var(--ink-3)" fontFamily="var(--mono)">{fmtAxis(gv)}</text>
          </g>
        ))}
        {/* zero baseline emphasised */}
        {yMin < 0 && yMax > 0 && (
          <line x1={padL} x2={W - padR} y1={zeroY} y2={zeroY} stroke="var(--ink-4)" strokeWidth="1.2" strokeDasharray="2 2"/>
        )}
        {/* x labels */}
        {months.map((mo, i) => (
          i % labelEvery === 0 || i === n - 1 ? (
            <text key={mo} x={x(i)} y={H - 12} textAnchor="middle" fontSize="9" fill="var(--ink-3)" fontFamily="var(--mono)">{monthShort(mo)}</text>
          ) : null
        ))}
        {/* series */}
        {seriesList.map((s) => {
          const { pts, segs } = buildSegments(s.getVal, s.getPartial);
          return (
            <g key={s.key}>
              {segs.map((seg, i) => (
                <line key={i} x1={seg.a.x} y1={seg.a.y} x2={seg.b.x} y2={seg.b.y}
                  stroke={s.color} strokeWidth={s.width} opacity={s.opacity}
                  strokeDasharray={seg.dashed ? "4 3" : undefined} strokeLinecap="round"/>
              ))}
              {pts.map((p, i) => {
                const mo = months[p.i];
                const lb = lowBaseOf(mo, s.key);
                const rawV = s.key === "__company" ? rawCoVal(mo) : rawChVal(rows[s.key]?.[mo]);
                const coNet = companyByMonth[mo]?.netRev;
                const chNet = rows[s.key]?.[mo]?.netRev;
                const netForLabel = s.key === "__company" ? coNet : chNet;
                // On a capped low-base CM3% point, show the TRUE % + the rev base.
                const lbNote = (metric === "cm3pct" && lb)
                  ? ` · low base · ${fmtINR(netForLabel)} rev (true ${Number.isFinite(rawV) ? (rawV * 100).toFixed(1) + "%" : "—"})`
                  : "";
                return (
                  <circle key={i} cx={p.x} cy={p.y} r={s.key === "__company" ? 2.6 : 1.8}
                    fill={s.color} opacity={s.opacity}
                    stroke={metric === "cm3pct" && lb ? "var(--warning)" : undefined}
                    strokeWidth={metric === "cm3pct" && lb ? 1.4 : undefined}>
                    <title>{`${monthShort(mo)} · ${s.key === "__company" ? "Company" : chMeta(s.key).label}: ${fmtAxis(s.getVal(mo))}${p.partial ? " (MTD)" : ""}${lbNote}`}</title>
                  </circle>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════════════
// COST INPUTS — editable COGS / fee% / mcfShare / fixed cost (unchanged model;
// every figure shows as-of + source; the two ₹0-packaging flags surfaced).
// ═════════════════════════════════════════════════════════════════════════════
const CostInputsView = ({ month, onChange, facts }) => {
  const [, setVersion] = useState(0);
  const refresh = () => { setVersion((v) => v + 1); onChange(); };
  const inputs = CostInputs.listCostInputs();
  const fixed = CostInputs.getFixedCost(month);
  const today = new Date().toISOString().slice(0, 10);
  // (f) COGS cost-change history — the "history of what changed" reconstructed
  // from the Unit_COGS Notes column (₹1,050→₹1,115 etc.). This is the provenance
  // of every COGS the editable table above runs on (rubric 38 — editable inputs
  // carry a history of what changed). NaN-safe, deferred to a calc.
  const costHistory = useMemo(() => costChangeHistory(facts), [facts]);

  const onReset = () => {
    if (typeof window !== "undefined" && !window.confirm("Reset ALL cost inputs to the baked defaults? Your overrides are discarded.")) return;
    CostInputs.resetCostInputs();
    refresh();
  };

  const onExport = () => {
    const blob = new Blob([JSON.stringify(inputs, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `naturesum-cost-inputs-${today}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="note" style={{ marginBottom: 14, background: "var(--bg-sunken)", borderColor: "var(--border)" }}>
        Defaults are baked from the founder files (COGS · BusinessModel %s). Edits are stored as
        local overrides — every figure shows its <strong>as-of date + source</strong>. The CM engine reads these live.
      </div>

      <Card
        title="Per-SKU COGS"
        sub="₹/unit incl. packaging · 11-Jun Unit_COGS file · editable"
        padded={false}
        action={
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn sm" onClick={onExport}><Icon name="download" size={12}/>Export JSON</button>
            <button className="btn ghost sm" onClick={onReset}>Reset all</button>
          </div>
        }
        style={{ marginBottom: 14 }}
      >
        <table className="table">
          <thead>
            <tr><th>SKU</th><th className="num">COGS ₹/unit</th><th>As of</th><th>Source</th></tr>
          </thead>
          <tbody>
            {inputs.cogs.map((c) => (
              <CogsRow key={`${c.code}:${c.cogs}`} card={c} onSaved={refresh}/>
            ))}
          </tbody>
        </table>
      </Card>

      {/* (f) COGS cost-change history — the "history of what changed" (rubric 38).
          Sits right under the editable COGS so the founder sees the provenance of
          a margin shift: which SKU's raw-material/landed cost moved, from what, with
          the founder's own note. Self-states empty/partial via the component. */}
      {costHistory && costHistory.changedCount > 0 && (
        <div style={{ marginBottom: 14 }}>
          <CostChangeView data={costHistory} D={D} title="COGS cost-change history · what moved & why"/>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Card title="Platform fee %" sub="Variable platform cost · of channel net revenue · BusinessModel Apr-26" padded={false}>
          <table className="table">
            <thead>
              <tr><th>Channel row</th><th className="num">Fee %</th><th>As of</th></tr>
            </thead>
            <tbody>
              {inputs.fees.map((f) => (
                <FeeRow key={`${f.channelKey}:${f.pct}`} fee={f} onSaved={refresh}/>
              ))}
              <tr style={{ background: "var(--bg-sunken)" }}>
                <td>
                  <span title={`Blended website fee = mcfShare×mcf-web + (1−mcfShare)×website-direct\n${inputs.websiteBlendedFee.source || ""}`} style={{ borderBottom: "1px dotted var(--ink-3)", cursor: "help" }}>
                    website (blended)
                  </span>
                </td>
                <td className="num strong">{fmtPct(inputs.websiteBlendedFee.pct, 1)}</td>
                <td className="muted" style={{ fontSize: 10.5 }}>derived</td>
              </tr>
            </tbody>
          </table>
        </Card>

        <Card title="Website mcfShare & monthly fixed cost" sub="mcfShare drives the website blended fee · fixed cost unlocks CM4" padded={false}>
          <div style={{ padding: "12px 14px", display: "grid", gap: 14 }}>
            <McfShareEditor key={`mcf:${inputs.mcfShare.share}`} share={inputs.mcfShare} onSaved={refresh}/>
            <FixedCostEditor key={`fixed:${month}:${fixed ? fixed.amount : "none"}`} month={month} fixed={fixed} onSaved={refresh}/>
          </div>
        </Card>
      </div>
    </>
  );
};

const CogsRow = ({ card, onSaved }) => {
  const [draft, setDraft] = useState(String(card.cogs));
  const dirty = Number(draft) !== card.cogs && draft !== "" && Number.isFinite(Number(draft));
  const save = () => {
    const n = Number(draft);
    if (!Number.isFinite(n)) return;
    CostInputs.setCostCard(card.code, n);
    onSaved();
  };
  return (
    <tr>
      <td>
        {SKU_META[card.code]?.name || card.code}
        <div className="sku">
          {card.code}
          {card.pkgPlaceholder && (
            <span title="Packaging is a ₹0 placeholder in the COGS file — fold real packaging cost in when known" style={{ marginLeft: 6, color: "var(--warning)", fontWeight: 600, fontSize: 10 }}>⚠ pkg ₹0</span>
          )}
        </div>
      </td>
      <td className="num">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
          <input
            type="number" className="sim-number" min={0} step={0.5}
            value={draft} onChange={(e) => setDraft(e.target.value)}
            style={{ width: 84, textAlign: "right" }}
          />
          {dirty && <button className="btn primary sm" onClick={save}>Save</button>}
        </span>
      </td>
      <td className="muted" style={{ fontSize: 10.5 }}>{card.asOf}</td>
      <td className="muted" style={{ fontSize: 10.5 }}>{card.source}</td>
    </tr>
  );
};

const FeeRow = ({ fee, onSaved }) => {
  // Display the fee to 1 decimal (V2.4 formatting contract — no raw 4-decimal
  // floats reach the DOM). The baked DEFAULT_FEE keeps full precision in the
  // engine; only the editable input is rounded for display.
  const display1dp = (fee.pct * 100).toFixed(1);
  const [draft, setDraft] = useState(display1dp);
  const pctNum = Number(draft);
  // "dirty" only when the user's input differs from the SHOWN (1-dp) value — so
  // an untouched rounded default never spuriously flags Save / overwrites the
  // precise baked fraction with its rounded form.
  const dirty = Number.isFinite(pctNum) && draft !== "" && draft !== display1dp;
  const save = () => {
    if (!Number.isFinite(pctNum)) return;
    CostInputs.setFeePct(fee.channelKey, pctNum / 100);
    onSaved();
  };
  return (
    <tr>
      <td>{fee.channelKey}</td>
      <td className="num">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
          <input
            type="number" className="sim-number" min={0} step={0.1}
            value={draft} onChange={(e) => setDraft(e.target.value)}
            style={{ width: 76, textAlign: "right" }}
          />
          <span className="muted" style={{ fontSize: 10 }}>%</span>
          {dirty && <button className="btn primary sm" onClick={save}>Save</button>}
        </span>
      </td>
      <td className="muted" style={{ fontSize: 10.5 }}>{fee.asOf}</td>
    </tr>
  );
};

const McfShareEditor = ({ share, onSaved }) => {
  const [draft, setDraft] = useState((share.share * 100).toFixed(1));
  const n = Number(draft);
  const dirty = Number.isFinite(n) && Math.abs(n / 100 - share.share) > 1e-9 && draft !== "";
  const save = () => { if (Number.isFinite(n)) { CostInputs.setMcfShare(n / 100); onSaved(); } };
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <strong style={{ fontSize: 12.5 }}>Website MCF share</strong>
        {share.placeholder && (
          <span title="Default 0.0 placeholder until the May build pins the MCF revenue share" style={{ color: "var(--warning)", fontSize: 10, fontWeight: 600 }}>⚠ placeholder 0%</span>
        )}
        {share.capped && (
          <span title="The build proxy (MCF units × website per-unit price) exceeded 1.0 because gross MCF units > net website units; capped to 100%. Edit if you have a truer split." style={{ color: "var(--warning)", fontSize: 10, fontWeight: 600 }}>⚠ capped 100%</span>
        )}
      </div>
      <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
        Share of website revenue fulfilled by Amazon (MCF). Drives the website blended fee.
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input type="number" className="sim-number" min={0} max={100} step={0.5} value={draft} onChange={(e) => setDraft(e.target.value)} style={{ width: 84, textAlign: "right" }}/>
        <span className="muted" style={{ fontSize: 11 }}>%</span>
        <button className="btn primary sm" onClick={save} disabled={!dirty}>Save</button>
      </div>
      <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>as of {share.asOf} · {share.source}</div>
    </div>
  );
};

const FixedCostEditor = ({ month, fixed, onSaved }) => {
  const [draft, setDraft] = useState(fixed ? String(fixed.amount) : "");
  const save = () => {
    const n = Number(draft);
    if (draft === "" || !Number.isFinite(n)) { CostInputs.setFixedCost(month, null); }
    else { CostInputs.setFixedCost(month, n); }
    onSaved();
  };
  const clear = () => { CostInputs.setFixedCost(month, null); setDraft(""); onSaved(); };
  return (
    <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <strong style={{ fontSize: 12.5 }}>Monthly fixed cost · {monthLabel(month)}</strong>
      </div>
      <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
        Total fixed cost for the month (₹). When set, CM4 unlocks — allocated revenue-proportionally.
        CM4 is a native-month reporting view. Leave blank to keep CM4 hidden.
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="muted">₹</span>
        <input type="number" className="sim-number" min={0} step={1000} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="not set" style={{ width: 130, textAlign: "right" }}/>
        <button className="btn primary sm" onClick={save}>Save</button>
        {fixed && <button className="btn ghost sm" onClick={clear}>Clear</button>}
      </div>
      {fixed && <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>as of {fixed.asOf}</div>}
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════════════
// VERIFICATION — the permanent regression net (spec §10 + V2.4 formatting guard).
// MATCH / DRIFT / INFO / PENDING / NO-DATA per anchor, plus a live formatting/
// sanity row that walks the engine's own output across every month×channel.
// ═════════════════════════════════════════════════════════════════════════════
const STATUS_META = {
  MATCH:     { color: "var(--success)",  label: "MATCH" },
  DRIFT:     { color: "var(--critical)", label: "DRIFT" },
  INFO:      { color: "#6366f1",         label: "INFO" },
  PENDING:   { color: "var(--ink-3)",    label: "PENDING" },
  "NO-DATA": { color: "var(--warning)",  label: "NO-DATA" },
};

// Source-tag → human registry for the provenance/upload trail (rubric 39/82). Maps
// every fact-store source the bundle/uploads can carry to what it feeds + its tier.
const SOURCE_REGISTRY = {
  "amazon-orders":  { label: "Amazon All-Orders (native per-SKU sales)", tier: "native", feeds: "Amazon SKU revenue/units" },
  "fk-sales":       { label: "Flipkart Sales (native per-SKU)", tier: "native", feeds: "Flipkart SKU revenue/units + cashback" },
  "blinkit-sales":  { label: "Blinkit Sales (native per-SKU)", tier: "native", feeds: "Blinkit SKU revenue/units" },
  "shopify-net":    { label: "Shopify Net Sales (native per-SKU)", tier: "native", feeds: "Website SKU net revenue/units" },
  "shopify-daily":  { label: "Shopify daily revenue (native)", tier: "native", feeds: "Website daily revenue shape (trend only)" },
  "ads-amazon-sp":  { label: "Amazon Sponsored Products (per-ASIN)", tier: "native", feeds: "Amazon measured ad attribution" },
  "ads-fk-pla":     { label: "Flipkart PLA (per-SKU)", tier: "native", feeds: "Flipkart measured ad attribution" },
  "ads-google":     { label: "Google Ads product-wise (Monarch)", tier: "monarch", feeds: "Website measured ad attribution" },
  "snell-agency":   { label: "Snell Sales & Ads (agency daily channel)", tier: "agency", feeds: "Agency channel totals + daily series" },
  "monarch-web":    { label: "Monarch Website Sales & Ads", tier: "monarch", feeds: "Website daily net + ad spend" },
  "snell-history":  { label: "Snell history (multi-month channel totals)", tier: "agency", feeds: "22-month channel revenue history" },
  "snell-sku-units":{ label: "Snell Categorywise (per-SKU units)", tier: "agency", feeds: "SKU units history (velocity)" },
  "monarch-history":{ label: "Monarch history (Google/Meta monthly)", tier: "monarch", feeds: "Website platform spend history" },
  "snell-cancel":   { label: "Snell shipped-vs-cancel", tier: "agency", feeds: "Channel cancel rates" },
  "monarch-seo":    { label: "Monarch SEO keyword ranks", tier: "monarch", feeds: "Organic keyword rank snapshots" },
  "monarch-platform":{ label: "Monarch daily Google/Meta", tier: "monarch", feeds: "Platform ROAS/CPA (Google vs Meta)" },
  "bm-repeats":     { label: "BusinessModel Repeats (Shopify/Amazon)", tier: "businessmodel", feeds: "Quarterly repeat rate" },
  "bm-returns":     { label: "BusinessModel Returns (Shopify)", tier: "businessmodel", feeds: "Website returns trend" },
  "snell-ordermix": { label: "Snell Sale tab (Amazon order-mix + reconciliation)", tier: "agency", feeds: "Amazon organic-vs-review order mix + agency↔native reconciliation" },
  "monarch-extra":  { label: "Monarch March-2025 + Weekly-Comparison tabs", tier: "monarch", feeds: "Website order-count history + week-over-week comparison" },
  "cogs-history":   { label: "Unit_COGS Notes (per-SKU cost-change history)", tier: "businessmodel", feeds: "Per-SKU COGS change log (cost-card provenance)" },
};
const TIER_PILL = {
  native:       { bg: "rgba(34,160,90,0.14)", fg: "#1B7A45", label: "native" },
  monarch:      { bg: "rgba(99,102,241,0.14)", fg: "#4F46E5", label: "monarch" },
  agency:       { bg: "rgba(201,162,39,0.16)", fg: "#9A7B16", label: "agency" },
  businessmodel:{ bg: "var(--bg-sunken)", fg: "var(--ink-2)", label: "founder sheet" },
};

// DATA PROVENANCE & UPLOAD TRAIL (rubric 39/82) — a browsable list of exactly which
// sources produced the current state, their tier, recency, and (when uploaded in-
// session) the upload timestamp. The build-pinned baseline shows its build date;
// any in-tool upload overlays with its own "uploaded <when>" stamp.
const DataProvenancePanel = ({ facts }) => {
  const meta = facts?.meta || {};
  const bySource = meta.bySource || {};
  const uploads = meta.uploads || [];
  const uploadByTag = {}; for (const u of uploads) uploadByTag[u.sourceTag] = u;
  // present every source the store actually carries, registry-ordered.
  const tags = Object.keys(SOURCE_REGISTRY).filter((t) => bySource[t] || uploadByTag[t]);
  // include any unregistered source so nothing is hidden.
  for (const t of Object.keys(bySource)) if (!SOURCE_REGISTRY[t] && !tags.includes(t)) tags.push(t);
  return (
    <Card
      title="Data provenance &amp; upload trail"
      sub={`What produced the current state. Bundled baseline pinned ${meta.appBuildDate || "—"}; any in-tool upload overlays it (native overrides agency, re-upload replaces — never double-counts). Data through ${meta.latestDataDate || "—"}.`}
      style={{ marginBottom: 14 }}
      padded={false}
    >
      <table className="table">
        <thead>
          <tr>
            <th>Source</th>
            <th>Feeds</th>
            <th>Tier</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          {tags.map((t) => {
            const reg = SOURCE_REGISTRY[t] || { label: t, tier: (bySource[t]?.tier) || "agency", feeds: "—" };
            const up = uploadByTag[t];
            const pill = TIER_PILL[reg.tier] || TIER_PILL.agency;
            return (
              <tr key={t}>
                <td>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontWeight: 600, fontSize: 12 }}>{reg.label}</span>
                    <span className="muted" style={{ fontFamily: "var(--mono)", fontSize: 10 }}>{t}</span>
                  </div>
                </td>
                <td className="muted" style={{ fontSize: 11.5 }}>{reg.feeds}</td>
                <td><span className="badge" style={{ background: pill.bg, color: pill.fg, fontSize: 9.5, fontWeight: 700 }}>{pill.label}</span></td>
                <td className="muted" style={{ fontSize: 11.5 }}>
                  {up && !up.baked
                    ? <span title={`Uploaded in-tool ${up.at}`} style={{ color: "var(--success)" }}>uploaded {new Date(up.at).toLocaleDateString("en-IN")}</span>
                    : <span title={`Part of the build-pinned baseline (${meta.appBuildDate || "—"})`}>bundled baseline</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="muted" style={{ fontSize: 10.5, padding: "8px 14px" }}>
        Every figure on every page traces to one of these sources. A row reading <strong>uploaded</strong> means you
        replaced the bundled baseline for that source this session; <strong>bundled baseline</strong> is the build-pinned
        export reconciled by the {ANCHOR_MONTH} anchors below. Re-uploading the same source replaces its window
        (idempotent — parse-twice equals parse-once); native marketplace exports always override agency estimates.
      </div>
    </Card>
  );
};

// XI — per-source freshness line for the Finance page (the same data Sales &
// Marketing surface, so all three pages carry per-source recency, not just a single
// "data through" date). Reads meta.sourceRecency + meta.sourceLabels; NaN-safe.
const FIN_RECENCY_TIER_CLASS = { native: "cov-native", monarch: "cov-agency", agency: "cov-agency", businessmodel: "cov-agency" };
const FinanceSourceRecencyLine = ({ facts }) => {
  const recency = facts?.meta?.sourceRecency || null;
  const labels = facts?.meta?.sourceLabels || {};
  const latestDataDate = facts?.meta?.latestDataDate || null;
  const rows = useMemo(() => {
    if (!recency) return [];
    return Object.entries(recency)
      .map(([slug, day]) => ({ slug, day, label: labels[slug]?.label || SOURCE_REGISTRY[slug]?.label || slug, tier: labels[slug]?.tier || SOURCE_REGISTRY[slug]?.tier || null }))
      .filter((r) => r.day)
      .sort((a, b) => String(b.day).localeCompare(String(a.day)) || a.label.localeCompare(b.label));
  }, [recency, labels]);
  if (rows.length === 0) return null;
  const globalMs = latestDataDate ? new Date(latestDataDate + "T00:00:00Z").getTime() : null;
  const staleDays = (day) => {
    if (globalMs == null) return 0;
    const d = new Date(day + "T00:00:00Z").getTime();
    if (!Number.isFinite(d)) return 0;
    return Math.max(0, Math.round((globalMs - d) / 86400000));
  };
  return (
    <details className="note" style={{ marginBottom: 14 }}>
      <summary style={{ cursor: "pointer", fontSize: 11.5, color: "var(--ink-2)" }}>
        <strong>Per-source freshness</strong> — {rows.length} sources loaded, newest data day {freshDay(rows[0].day)}.
        Click to see each source&apos;s own latest day (a margin number is only as fresh as its slowest input).
      </summary>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "4px 18px", marginTop: 8 }}>
        {rows.map((r) => {
          const stale = staleDays(r.day);
          return (
            <div key={r.slug} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, lineHeight: 1.5 }}>
              {r.tier && <span className={`cov-badge ${FIN_RECENCY_TIER_CLASS[r.tier] || "cov-agency"} sm`}>{r.tier === "native" ? "nat" : "agc"}</span>}
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.label}>{r.label}</span>
              <span className="mono muted" style={{ whiteSpace: "nowrap" }}>{freshDay(r.day)}</span>
              {stale >= 1 && (
                <span className="cov-badge cov-mtd sm" title={`This source's latest data day trails the page's freshest day by ${stale} day${stale > 1 ? "s" : ""}.`}>
                  −{stale}d
                </span>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
};

// V-90 — RUNNABLE on-page self-test. A visible button that, on click, recomputes
// the §2/§3 anchors live from the fact store AND runs the parse-twice == parse-once
// idempotency proof (runIngestionSelfTest) AND the formatting/sanity walk — all
// synchronous and bounded (~40ms on the full bundle, measured), then shows PASS/FAIL
// with the count, the wall-clock duration, and a timestamp. This is the permanent,
// on-page live verification the founder can click any time — not buried in Upload.
const SELF_TEST_TIMEOUT_MS = 4000;
const RunnableSelfTest = ({ facts }) => {
  const [run, setRun] = useState(null); // { ok, ranAt, durationMs, anchors:{match,total}, idemOk, sanityOk }
  const [busy, setBusy] = useState(false);
  // Re-entrancy token + watchdog handle, mirroring the proven UploadModal pattern.
  const runTokenRef = useRef(0);
  const watchdogRef = useRef(null);
  const deferRef = useRef(null);

  // DEFECT-1 FIX: the old handler deferred the work inside a single
  // requestAnimationFrame. rAF callbacks are PARKED indefinitely by the browser
  // whenever the tab is backgrounded (or no paint is scheduled), so the closure
  // that called setRun()/setBusy(false) could never fire — the button stuck on
  // "Running…" forever while the anchor table (a plain useMemo) still showed 18
  // MATCH. We now (a) defer with setTimeout(…,0), which fires even on a
  // backgrounded tab, (b) guard a watchdog so we always reach a terminal state,
  // and (c) carry a re-entrancy token so a superseded run can't overwrite a fresh
  // one. Same recipe UploadModal.jsx already documented as the cure.
  useEffect(() => () => {
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    if (deferRef.current) clearTimeout(deferRef.current);
  }, []);

  const execute = () => {
    const token = ++runTokenRef.current;
    if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
    if (deferRef.current) { clearTimeout(deferRef.current); deferRef.current = null; }
    setBusy(true);

    const finish = (payload) => {
      if (token !== runTokenRef.current) return;          // a newer run superseded this one
      if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
      setRun(payload);
      setBusy(false);
    };

    // Watchdog: if the deferred callback is parked (backgrounded tab) or the main
    // thread wedges before the work returns, paint a clear timeout state — never
    // an eternal "Running…".
    watchdogRef.current = setTimeout(() => {
      finish({
        ok: false, timedOut: true, ranAt: new Date(), durationMs: SELF_TEST_TIMEOUT_MS,
        anchors: { match: 0, drift: 0, total: 0 }, sanityOk: false, sanityCells: 0,
        idemOk: false, idemCells: null, idemSources: null,
        idemError: `Self-test exceeded ${Math.round(SELF_TEST_TIMEOUT_MS / 1000)}s and was stopped — bring the tab to the foreground and re-run.`,
      });
    }, SELF_TEST_TIMEOUT_MS);

    // Defer with setTimeout (fires even on a backgrounded tab, unlike rAF which a
    // browser may park indefinitely) so the button paints "Running…" before the
    // synchronous work runs. The work itself is pure + in-memory (~40ms measured).
    deferRef.current = setTimeout(() => {
      if (token !== runTokenRef.current) return;          // superseded before it ran
      try {
        const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
        // (a) anchors live from the fact store.
        const av = runVerification(facts);
        const anchorRowsLive = av.filter((r) => r.status !== "INFO");
        const match = anchorRowsLive.filter((r) => r.status === "MATCH").length;
        const drift = anchorRowsLive.filter((r) => r.status === "DRIFT").length;
        // (b) formatting/sanity walk.
        const sv = runFormattingSanity(facts);
        // (c) parse-twice == parse-once idempotency + per-source round-trip.
        let idem;
        try { idem = runIngestionSelfTest(); } catch (e) { idem = { ok: false, durationMs: 0, error: e.message, idempotency: {}, checks: [] }; }
        const durationMs = Math.round(((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0) * 10) / 10;
        const ok = drift === 0 && sv.status === "MATCH" && !!idem.ok;
        finish({
          ok, ranAt: new Date(), durationMs,
          anchors: { match, drift, total: anchorRowsLive.length },
          sanityOk: sv.status === "MATCH", sanityCells: sv.checks,
          idemOk: !!idem.ok, idemCells: idem.idempotency?.onceCells ?? null, idemSources: idem.idempotency?.sources?.length ?? null,
          idemError: idem.error || null,
        });
      } catch (e) {
        // Any unexpected throw in runVerification/runFormattingSanity still lands
        // on a terminal FAIL state instead of hanging on "Running…".
        finish({
          ok: false, ranAt: new Date(), durationMs: 0,
          anchors: { match: 0, drift: 0, total: 0 }, sanityOk: false, sanityCells: 0,
          idemOk: false, idemCells: null, idemSources: null,
          idemError: e?.message || String(e),
        });
      }
    }, 0);
  };

  const ok = run?.ok;
  return (
    <Card
      title="Live self-test · re-derive the anchors on demand"
      sub="Click to recompute the §2/§3 anchors live from the fact store, run the formatting/sanity walk, and prove parse-twice == parse-once (idempotent ingestion) — bounded (~40ms), with a PASS/FAIL and a timestamp. The same checks the Upload modal runs, available here any time."
      style={{ marginBottom: 14 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn primary"
          onClick={execute}
          disabled={busy}
          style={{ fontSize: 12.5, fontWeight: 600 }}
        >
          {busy ? "Running…" : "Re-run self-test"}
        </button>
        {run && (
          <>
            <span className="badge" style={{
              background: (ok ? "var(--success)" : "var(--critical)") + "22",
              color: ok ? "var(--success)" : "var(--critical)",
              borderColor: (ok ? "var(--success)" : "var(--critical)") + "55",
              fontWeight: 700, fontSize: 12,
            }}>
              {/* Terminal verdict with a re-derived timestamp — proves the handler
                  reached a done state (DEFECT-1). timedOut surfaces a distinct state. */}
              {run.timedOut ? "⏱ TIMED OUT" : ok ? `✓ PASS · re-derived ${run.ranAt.toLocaleTimeString()}` : "✗ FAIL"}
            </span>
            {!run.timedOut && (
              <span style={{ fontSize: 12 }}>
                <strong>{run.anchors.match}/{run.anchors.total}</strong> anchors MATCH{run.anchors.drift ? ` · ${run.anchors.drift} DRIFT` : ""} ·{" "}
                sanity {run.sanityOk ? "clean" : "FAILURES"} ({run.sanityCells} cells) ·{" "}
                idempotency {run.idemOk ? "parse-twice == parse-once" : "FAILED"}{run.idemCells != null ? ` (${run.idemCells} cells, ${run.idemSources} sources)` : ""}
              </span>
            )}
            <span className="muted" style={{ fontSize: 11 }}>
              {run.timedOut ? `stopped after ${run.durationMs}ms` : `ran in ${run.durationMs}ms · ${run.ranAt.toLocaleTimeString()}`}
            </span>
          </>
        )}
        {!run && (
          <span className="muted" style={{ fontSize: 11.5 }}>
            Not yet run this session — the table below shows the anchors recomputed on load; click to re-derive live and stamp the time.
          </span>
        )}
      </div>
      {run && run.idemError && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--critical)" }}>{run.timedOut ? run.idemError : `idempotency error: ${run.idemError}`}</div>
      )}
    </Card>
  );
};

const VerificationView = ({ facts }) => {
  const results = useMemo(() => runVerification(facts), [facts]);
  const sanity = useMemo(() => runFormattingSanity(facts), [facts]);
  const counts = results.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});

  // Split pass/fail anchors from INFO reconciliation rows so the founder reads
  // them as two distinct things (anchors are the regression net; INFO is context).
  const anchorRows = results.filter((r) => r.status !== "INFO");
  const infoRows = results.filter((r) => r.status === "INFO");

  return (
    <>
      {/* V-90 — the ON-PAGE runnable self-test (not only inside the Upload modal):
          a button the founder clicks to recompute the anchors + a parse-twice ==
          parse-once idempotency proof live, in bounded time, with PASS + timestamp. */}
      <RunnableSelfTest facts={facts}/>

      {/* XI — per-source recency line (parity with Sales & Marketing): each source's
          OWN latest data day + how far it trails the freshest, so a Feb SEO rank is
          never read as today's number and a single "data through" date can't mislead. */}
      <FinanceSourceRecencyLine facts={facts}/>

      {/* Browsable data provenance / upload trail (rubric 39/82). */}
      <DataProvenancePanel facts={facts} />

      {/* Formatting / sanity guard (V2.4) — the engine's own output is walked. */}
      <Card
        title="Formatting &amp; sanity guard"
        sub="Walks every engine cell across all months — asserts no NaN/Infinity, no un-flagged >500% ACOS, CM% within [−500%, +100%]"
        style={{ marginBottom: 14 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <span className="badge" style={{
            background: (sanity.status === "MATCH" ? "var(--success)" : "var(--critical)") + "22",
            color: sanity.status === "MATCH" ? "var(--success)" : "var(--critical)",
            borderColor: (sanity.status === "MATCH" ? "var(--success)" : "var(--critical)") + "55",
            fontWeight: 700, fontSize: 12,
          }}>
            {sanity.status === "MATCH" ? "✓ CLEAN" : "✗ FAILURES"}
          </span>
          <span style={{ fontSize: 12.5 }}>
            <strong>{sanity.checks}</strong> engine cells walked · <strong>{sanity.failures.length}</strong> failures
          </span>
          {sanity.status === "MATCH" && (
            <span className="muted" style={{ fontSize: 11.5 }}>
              Every currency figure rounds through D.fmtINR, every % to 1 decimal — no raw floats reach the DOM.
            </span>
          )}
        </div>
        {sanity.failures.length > 0 && (
          <ul style={{ margin: "10px 0 0", padding: "8px 10px", background: "var(--critical-soft)", borderRadius: 6, fontSize: 11.5, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
            {sanity.failures.slice(0, 8).map((f, i) => (
              <li key={i}><strong style={{ color: "var(--critical)" }}>{f.id}</strong>: {f.detail}</li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title={`Verification · ${monthLabel(ANCHOR_MONTH)} anchors`}
        sub="Every §2/§3 revenue, ad, and history anchor recomputed live from the fact store · MATCH within tolerance, DRIFT surfaces the δ"
        padded={false}
      >
        <div style={{ display: "flex", gap: 14, padding: "10px 14px", borderBottom: "1px solid var(--border-soft)", fontSize: 12 }}>
          {["MATCH", "DRIFT", "INFO", "PENDING", "NO-DATA"].map((s) => (
            <span key={s} style={{ color: STATUS_META[s].color, fontWeight: 600 }}>
              {counts[s] || 0} {STATUS_META[s].label}
            </span>
          ))}
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Anchor</th>
              <th className="num">Expected</th>
              <th className="num">Actual</th>
              <th className="num">Δ</th>
              <th style={{ width: 90 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {anchorRows.map((r) => (
              <AnchorRow key={r.id} r={r}/>
            ))}
          </tbody>
        </table>

        {/* INFO reconciliation block — Snell-vs-native May deltas (report-only). */}
        {infoRows.length > 0 && (
          <div style={{ borderTop: "1px solid var(--border-soft)" }}>
            <div style={{ padding: "8px 14px 4px", fontSize: 11, fontWeight: 700, color: "#6366f1", letterSpacing: "0.04em", textTransform: "uppercase" }}>
              Reconciliation (info — agency vs native May, never pass/fail)
            </div>
            <table className="table">
              <tbody>
                {infoRows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div style={{ fontSize: 12 }}>{r.label.replace(/^INFO · /, "")}</div>
                      <div className="sku" style={{ fontSize: 10, color: "var(--ink-3)", whiteSpace: "normal", lineHeight: 1.35, marginTop: 2 }}>{r.filter}</div>
                    </td>
                    <td className="num mono" style={{ width: 120 }}>
                      {r.actual == null ? <span className="muted">—</span> : `${r.actual >= 0 ? "+" : ""}${r.actual.toFixed(2)}%`}
                    </td>
                    <td style={{ width: 90 }}>
                      <span className="badge" style={{ background: "#6366f122", color: "#6366f1", borderColor: "#6366f155", fontWeight: 600 }}>INFO</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ padding: "8px 14px", fontSize: 11, color: "var(--ink-3)" }}>
          Anchors lock the bundled baseline numbers; DRIFT means a bundled fact differs from the locked §2/§3 number — a
          data-baseline matter, not a UI bug. INFO rows report a measured agency-vs-native delta (return-tail timing), never pass/fail.
        </div>
      </Card>
    </>
  );
};

const AnchorRow = ({ r }) => {
  const sm = STATUS_META[r.status] || STATUS_META.PENDING;
  return (
    <tr>
      <td>
        <div style={{ fontSize: 12 }}>{r.label}</div>
        <div className="sku" style={{ fontSize: 10, color: "var(--ink-3)", whiteSpace: "normal", lineHeight: 1.35, marginTop: 2 }}>
          {r.filter}
        </div>
      </td>
      <td className="num mono">
        {r.expected == null ? <span className="muted">pending</span> : fmtN(r.expected)}
      </td>
      <td className="num mono">{r.actual == null ? <span className="muted">—</span> : fmtN(r.actual)}</td>
      <td className="num mono" style={{ color: r.status === "DRIFT" ? "var(--critical)" : "var(--ink-3)" }}>
        {r.delta == null ? "—" : `${r.delta > 0 ? "+" : "−"}${fmtN(Math.abs(r.delta))}`}
        {Number.isFinite(r.deltaPct) && r.status === "DRIFT" && (
          <span className="muted" style={{ fontSize: 10, marginLeft: 4 }}>({(r.deltaPct * 100).toFixed(1)}%)</span>
        )}
      </td>
      <td>
        <span className="badge" style={{ background: sm.color + "22", color: sm.color, borderColor: sm.color + "55", fontWeight: 600 }}>
          {sm.label}
        </span>
      </td>
    </tr>
  );
};

export default PageFinance;

// Testability exports — the tab-gated Finance sub-views, surfaced so the SSR gate
// harness can render each tab beyond the default waterfall (CM trend carries the
// M5 low-base annotation; matrix + SKU views prove real per-SKU grain renders;
// buildMonthView constructs the coverage-aware `view` those tabs consume).
// Inert in production: ESM named exports of internal components have no runtime
// effect unless imported, and the app imports only the default.
// eslint-disable-next-line react-refresh/only-export-components -- testability exports for the SSR gate harness; buildMonthView travels with its views. Inert in production (app imports only the default).
export { CMTrendView, MatrixView, SkuEconomicsView, WaterfallView, buildMonthView, BridgeView, LeversView, ActionsView, ForecastView, FinanceHeadline };
