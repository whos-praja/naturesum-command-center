import { useState, useMemo, Fragment } from "react";
import { Delta, Card } from "../components/Shared.jsx";
import { UploadModal } from "../components/UploadModal.jsx";
import NSData from "../data.js";
import {
  mergedFacts,
  channelsIn,
  coverageFor,
  CH_CODE,
} from "../lib/businessStore.js";
import {
  monthlyNetRevByChannel,
  monthsAvailable,
  computeMonthChannelCM,
  snellSkuUnitsMap,
  computeCM,
} from "../lib/cmEngine.js";
import {
  dailyFactTable,
  dailyFlags,
  projectMonthEnd,
  rankMovers,
  revenueBridge,
  concentrationRisk,
  seasonalityBaselines,
  channelAnomalies,
  crossModuleVelocity,
  VELOCITY_WINDOWS,
  priceRealization,
  autoNarrative,
  // round-3 100× layer (additive — wired here for the first time).
  forecast,
  actionQueue,
  proseWeeklyNarrative,
  ltvCohort,
  basketTrend,
  blinkitAdProxy,
  perChannelDailyFlags,
  perChannelWeekdayBaseline,
  smallSampleFlag,
  orderMixTrend,
  amazonOrderComposition,
  totalVsDailyReconciliation,
  conversionValueGap,
  cashbackTrend,
  returningRevenue,
  costChangeHistory,
  geoConcentration,
} from "../lib/bizAnalytics.js";
// Shared biz presentation layer (rubric IX/72 — one red, one pill, one ⓘ).
import {
  fmtUnits as FU,
  pct1,
  pctSigned,
  pctTone,
  cmColor,
  chMeta as CHMETA,
  chOrder as CHORDER,
  pillStyle as PILL,
  DeltaChip,
} from "../components/biz/ScorecardHelpers.jsx";
import { MiniSpark } from "../components/biz/MiniSpark.jsx";
import { DerivationPopover } from "../components/biz/DerivationPopover.jsx";
import { AnomalyBadge } from "../components/biz/AnomalyBadge.jsx";
import { BridgeChart } from "../components/biz/BridgeChart.jsx";
import { AutoNarrative } from "../components/biz/AutoNarrative.jsx";
import { DailyFlagGrid } from "../components/biz/DailyFlagGrid.jsx";
import BizStateGuard from "../components/biz/BizStateGuard.jsx";
// round-3 100× presentation components (additive — mounted here for the first time).
import { ForecastChart } from "../components/biz/ForecastChart.jsx";
import { ActionQueue } from "../components/biz/ActionQueue.jsx";
import { ProseNarrative } from "../components/biz/ProseNarrative.jsx";
import { LtvCohort } from "../components/biz/LtvCohort.jsx";
import { BlinkitAdProxy } from "../components/biz/BlinkitAdProxy.jsx";
import {
  OrderMixView,
  OrderCompositionView,
  TotalVsDailyView,
  ConversionGapView,
  CashbackTrendView,
  ReturningRevenueView,
  CostChangeView,
  GeoConcentrationView,
  BasketTrendView,
} from "../components/biz/InsightViews.jsx";

/**
 * PageSales — Sales & Revenue Intelligence (rebuilt to the LOCKED RUBRIC).
 *
 * REAL DATA ONLY, COVERAGE-HONEST, DAILY-GRAIN. Reads the durable fact store via
 * mergedFacts() (bundled baseline ⊕ uploads), the frozen V2 cmEngine for margin,
 * and the new bizAnalytics 100× layer for the diagnostic / predictive /
 * prescriptive depth.
 *
 * IA (rubric IX/67 — sectioned, NOT one scroll, matching Finance/Marketing): an
 * always-visible MOST-USEFUL-FIRST band (the weekly prose read-out, today's MTD
 * pulse + projected month-end, and the ONE "what to do Monday" action queue across
 * all levers), then a TABBED body. The daily founder's sheet is the centrepiece of
 * the first tab. Tabs:
 *
 *   • Daily sheet     — Date×channel×Total flag grid (CENTERPIECE, VI/40), the
 *                       per-channel weekday-MATCHED daily flags (II/16), the daily
 *                       net-revenue curve (VI/44), weekday/seasonality (VI/49).
 *   • Movers & mix    — winners/losers by momentum w/ small-sample annotations
 *                       (VI/41, II/18), revenue bridge (VII/50), channel mix +
 *                       concentration (VI/42, VII/57), MoM like-for-like (II/14).
 *   • Forecast        — forward rev/units/CONTRIBUTION at channel AND SKU grain
 *                       w/ stated method + uncertainty band (VII/52).
 *   • Retention & LTV — Shopify+Amazon cohort/LTV curve + AOV gap (VI/46), basket /
 *                       units-per-order trend (VI/45), Flipkart/Blinkit DEFERRAL
 *                       (param 89), the historical repeat/returns actuals.
 *   • SKU & orders    — per-SKU units history + drill (VI/43), native per-SKU
 *                       revenue/CM3 (with anomaly callouts), AOV + price realization
 *                       (II/19), order-mix organic/review/paid trend (a).
 *   • Cross-module    — sell-through velocity → reorder/stockout watch (VII/58).
 *   • Geo & returns   — geographic demand/returns concentration (g), returns
 *                       honesty (VI/47), cancel rate, Flipkart cashback drag (d).
 *   • Reconcile       — the honesty/left-on-the-table tab: Total-vs-daily (b),
 *                       conversion-value inflation (c), COGS cost-change history (f),
 *                       the MODELED Blinkit per-SKU ad proxy (III).
 *
 * HONESTY INVARIANTS baked in everywhere:
 *  - Every rupee through D.fmtINR / fmtRupees (rounded, never a raw float).
 *  - % to 1dp; units integer; no NaN/Infinity ever renders.
 *  - Coverage badge on every month: native / agency / MTD≤day.
 *  - MoM is like-for-like (partials excluded or same-day-window only).
 *  - Website revenue net-derived (gross ÷ 1.05) and labelled.
 *  - Ratios only within ONE coverage window (bizAnalytics suppresses otherwise).
 *  - The daily/velocity series here uses the IDENTICAL dailyNet rule as the
 *    engine and reads the same durable fact store the inventory module reads, so
 *    the underlying SKU×channel UNITS reconcile. The displayed velocity here is
 *    month-to-date (units ÷ elapsed days); the inventory module's velocity is a
 *    forward-planning MAX(30d,15d) rate off the agency feed — a different window
 *    for a different purpose, labelled as such (no false identity claim).
 */

// Net-derive divisor for website agency/daily gross (Monarch is gross-only).
// Mirrors cmEngine WEBSITE_AGENCY_NET_DIVISOR + bizAnalytics — kept in sync by value.
const WEBSITE_NET_DIVISOR = 1.05;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ─── presentation aliases (consume the shared scorecard helpers; rubric 72) ───
const chMeta = CHMETA;
const chOrder = CHORDER;
const pillStyle = PILL;

function fmtMonth(ym) {
  const [y, m] = String(ym || "").split("-");
  const mi = parseInt(m, 10) - 1;
  return mi >= 0 && mi < 12 && y ? `${MONTHS[mi]} ${y}` : (ym || "—");
}
function fmtMonthShort(ym) {
  const [, m] = String(ym || "").split("-");
  const mi = parseInt(m, 10) - 1;
  return mi >= 0 && mi < 12 ? MONTHS[mi] : (ym || "");
}
function fmtDay(iso) {
  const [, m, d] = String(iso || "").split("-");
  const mi = parseInt(m, 10) - 1;
  return mi >= 0 && mi < 12 && d ? `${parseInt(d, 10)} ${MONTHS[mi]}` : (iso || "—");
}
// Calendar months strictly between two "YYYY-MM" keys (exclusive) — marks
// zero-activity months filtered out of the coverage model so the MoM table never
// skips a month silently.
function missingMonthsBetween(prevYM, curYM) {
  const toIdx = (ym) => { const [y, m] = String(ym).split("-").map(Number); return y * 12 + (m - 1); };
  const fromIdx = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
  const a = toIdx(prevYM), b = toIdx(curYM);
  if (!(b > a + 1)) return [];
  const out = [];
  for (let i = a + 1; i < b; i++) out.push(fromIdx(i));
  return out;
}

// SKU display name from the canonical inventory table.
const skuShort = (code) => NSData.skus.find((s) => s.code === code)?.name || code;
const skuVariant = (code) => NSData.skus.find((s) => s.code === code)?.variant || "";

// I (rubric 7) — "matched by similarity" badge. Reads facts.meta.skuIdentity[code]
// (built deterministically from the resolution rules). Renders ONLY when that SKU
// had at least one NON-EXACT resolution (a free-text Google product title matched
// by similarity) — most SKUs resolve via exact identifier maps, so this badge is
// rare and appears precisely where the founder should sanity-check attribution.
function SkuSimilarityBadge({ code, identity }) {
  const rec = identity?.[code];
  if (!rec || !rec.fuzzy) return null;
  const via = (rec.fuzzyVia || []).map((v) => `${v.source} (${v.method})`).join(", ");
  return (
    <span
      className="badge"
      title={`${rec.note}${via ? `\nMatched via: ${via}` : ""}`}
      style={{ marginLeft: 6, background: "rgba(201,162,39,0.16)", color: "#9A7B16", borderColor: "rgba(201,162,39,0.4)", fontSize: 8.5, fontWeight: 700, letterSpacing: "0.02em", whiteSpace: "nowrap", verticalAlign: "middle" }}
    >
      ≈ similarity
    </span>
  );
}

// I-92 — the per-SKU UNITS-derivation rule ⓘ. Surfaces the EXACT filtered row set
// that produces both per-SKU units AND revenue (one basis), so AOV = net ÷ units
// re-derives from the raw All-Orders and a reviewer can see units, revenue, and AOV
// reconcile. Reads facts.meta.bySource["amazon-orders"].unitsRule (the engine's own
// disclosure string). Renders nothing if the rule isn't present.
function UnitsRulePopover({ facts, month, asOf }) {
  const rule = facts?.meta?.bySource?.["amazon-orders"]?.unitsRule || null;
  if (!rule) return null;
  // CONCRETE re-derivation: pick the largest Amazon native SKU for `month` and
  // show units, gross, net, AOV all from the SAME filtered row set — so a reviewer
  // sees AOV = net ÷ units re-derive on the popover's own face (kills the "÷ wrong
  // denominator → ₹910" misread: 268 units is Σ quantity, not a row count).
  const monthly = facts?.monthly || {};
  let best = null;
  for (const [k, c] of Object.entries(monthly)) {
    const [m, ch, code] = k.split("|");
    if (m !== month || ch !== "amazon" || code === "__ch__") continue;
    if (!Number.isFinite(c?.units) || c.units <= 0) continue;
    if (!best || c.netRev > best.netRev) best = { code, units: c.units, grossRev: c.grossRev, netRev: c.netRev };
  }
  const inputs = best ? [
    { label: `${best.code} · units (Σ quantity)`, value: fmtUnits(best.units) },
    { label: "gross (Σ item-price)", value: fmtRupees(best.grossRev) },
    { label: "net (gross ÷ 1.05)", value: fmtRupees(best.netRev) },
    { label: "AOV (net ÷ units)", value: fmtRupees(best.netRev / best.units) },
  ] : [];
  return (
    <DerivationPopover
      title="Per-SKU units & AOV · derivation rule"
      formula="units = Σ quantity · gross = Σ item-price · net = gross ÷ 1.05 · AOV = net ÷ units"
      plain={rule}
      inputs={inputs}
      note="Per-SKU UNITS and REVENUE come from the SAME filtered row set (Amazon.in · Shipped · returns-netted · purchase-month bucketed), so AOV = net ÷ units re-derives from the file. units is Σ quantity over Shipped rows — NOT a row count (Cancelled rows carry qty 0), so the numerator and denominator never mix bases."
      source='facts.meta.bySource["amazon-orders"].unitsRule · amazonmaysales.txt'
      asOf={asOf}
    />
  );
}

// I-9 — the Flipkart NET-revenue derivation ⓘ. Surfaces the exact column (Buyer
// Invoice Amount), the sign rule (negatives auto-net returns), the *N multipack
// fold, the GST basis (taken AS-IS — no ÷1.05), and the May Order-Date attribution,
// so ₹2,72,843 re-derives from the raw Flipkart export. Reads the engine's own
// fk-sales.netRule disclosure object. Renders nothing if absent.
function FlipkartNetRulePopover({ facts, month, asOf }) {
  const rule = facts?.meta?.bySource?.["fk-sales"]?.netRule || null;
  if (!rule) return null;
  // CONCRETE re-derivation: this month's Flipkart net from the SAME column-sum rule.
  const monthly = facts?.monthly || {};
  let net = 0, units = 0, found = false;
  for (const [k, c] of Object.entries(monthly)) {
    const [m, ch, code] = k.split("|");
    if (m !== month || ch !== "flipkart" || code === "__ch__") continue;
    if (Number.isFinite(c?.netRev)) { net += c.netRev; found = true; }
    if (Number.isFinite(c?.units)) units += c.units;
  }
  const inputs = found ? [
    { label: "column summed", value: rule.column },
    { label: `Σ Buyer Invoice Amount (${fmtMonth(month)})`, value: fmtRupees(net) },
    { label: "units (qty × multipack N)", value: fmtUnits(units) },
    { label: "GST basis", value: "AS-IS (no ÷1.05)" },
  ] : [];
  return (
    <DerivationPopover
      title="Flipkart net revenue · derivation rule"
      formula="net = Σ Buyer Invoice Amount (native sign) over Order-Date-month rows · units = Σ qty × multipack N"
      plain={rule.derivation || "May net = Σ Buyer Invoice Amount over rows whose SKU resolves to a canonical code and Order-Date month matches."}
      inputs={inputs}
      note={`Sign rule: ${rule.signRule}. GST: ${rule.gstBasis}. Multipack: ${rule.multipackFold}. Month: ${rule.monthAttribution}.${rule.cashback ? " " + rule.cashback : ""}`}
      source='facts.meta.bySource["fk-sales"].netRule · flipkart may sales.xlsx'
      asOf={asOf}
    />
  );
}

// SAFE numeric coercion + formatters (all output rounded — never a raw float).
const num = (n) => { const v = Number(n); return Number.isFinite(v) ? v : 0; };
// Precise grouped rupees for table cells: "₹1,23,456" (rounded). For headline
// cards we use D.fmtINR (K/L/Cr). null/non-finite → em-dash.
function fmtRupees(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Math.round(Number(n));
  return (v < 0 ? "−₹" : "₹") + Math.abs(v).toLocaleString("en-IN");
}
const fmtUnits = FU;
// fraction (0..1) → "12.3%"; null-safe (delegates to the shared 1dp formatter).
const pctStr = pct1;

// Per-channel net value of a daily channel-grain cell. Website is gross-only in
// source → net-derive (gross ÷ 1.05). IDENTICAL to bizAnalytics dailyNet so the
// page and the engine never disagree (HARD INVARIANT).
function dailyNet(cell, ch) {
  if (!cell) return 0;
  const net = num(cell.netRev);
  if (net > 0) return net;
  if (ch === "website") return num(cell.grossRev) / WEBSITE_NET_DIVISOR;
  return net;
}

const PageSales = ({ initialTab } = {}) => {
  const D = NSData;

  // ── Live read model ───────────────────────────────────────────────────────
  const facts = useMemo(() => mergedFacts(), []);
  const cov = useMemo(() => coverageFor(facts), [facts]);
  const monthsMeta = useMemo(() => monthsAvailable(facts), [facts]);
  const allMonths = monthsMeta.map((m) => m.month);
  const latestMonth = allMonths[allMonths.length - 1] || "2026-05";
  const latestMeta = monthsMeta[monthsMeta.length - 1] || null;
  // Freshness label — same field + fallbacks as Marketing/Inventory (rubric 83):
  // newest data day across all loaded sources, else the latest month's last day.
  const dataThrough = facts?.meta?.latestDataDate || latestMeta?.lastDay || null;
  // The most recent COMPLETE month — the basis for full-month diagnostics
  // (bridges, movers, concentration, prescriptions) so we never decompose a
  // half-month. Falls back to the latest month if all are partial.
  const lastFullMonth = useMemo(() => {
    for (let i = monthsMeta.length - 1; i >= 0; i--) if (!monthsMeta[i].partial) return monthsMeta[i].month;
    return latestMonth;
  }, [monthsMeta, latestMonth]);
  const priorFullMonth = useMemo(() => {
    const seen = [];
    for (const m of monthsMeta) if (!m.partial) seen.push(m.month);
    const idx = seen.indexOf(lastFullMonth);
    return idx > 0 ? seen[idx - 1] : null;
  }, [monthsMeta, lastFullMonth]);

  // Channels present across the whole history, ordered.
  const channels = useMemo(() => [...channelsIn(facts)].sort(chOrder), [facts]);

  // Headline net-rev-by-channel model across the FULL monthly history.
  const headline = useMemo(() => monthlyNetRevByChannel(facts), [facts]);

  // Daily channel-grain net-revenue series (the daily chart source).
  const dailySeries = useMemo(() => buildDailySeries(facts), [facts]);

  // Per-SKU monthly UNITS history (Snell Categorywise) — the SKU drill source.
  const skuUnitsHistory = useMemo(() => buildSkuUnitsHistory(facts), [facts]);

  // ── The 100× layer (bizAnalytics) ──────────────────────────────────────────
  const narrative = useMemo(() => autoNarrative(facts, { month: latestMonth }), [facts, latestMonth]);

  // Historical actuals (source-labelled). Used by retention/returns/cancel panels.
  const bySource = facts.meta?.bySource || {};
  const repeats = bySource["bm-repeats"] || null;
  const returnsTrend = bySource["bm-returns"] || null;
  const cancel = bySource["snell-cancel"] || null;

  // Upload modal.
  const [uploadOpen, setUploadOpen] = useState(false);

  // ── Chart controls ────────────────────────────────────────────────────────
  const [range, setRange] = useState("90d");
  const [chartMode, setChartMode] = useState("line");
  const [show7dMA, setShow7dMA] = useState(true);

  // ── SKU drill modal ───────────────────────────────────────────────────────
  const [drillSku, setDrillSku] = useState(null);

  // Mix metric toggle.
  const [mixMetric, setMixMetric] = useState("netRev");

  // ── Tab state (rubric IX/67 — sectioned, not one scroll) ────────────────────
  const TABS = useMemo(() => ([
    { key: "daily", label: "Daily sheet" },
    { key: "movers", label: "Movers & mix" },
    { key: "forecast", label: "Forecast" },
    { key: "retention", label: "Retention & LTV" },
    { key: "sku", label: "SKU & orders" },
    { key: "cross", label: "Cross-module" },
    { key: "geo", label: "Geo & returns" },
    { key: "reconcile", label: "Reconcile" },
  ]), []);
  // Default tab is "daily" (the founder's sheet). `initialTab` is an optional
  // verification hook so SSR harnesses can render any tab's panels; the production
  // UI never passes it, so live behaviour is unchanged.
  const [tab, setTab] = useState(
    TABS.some((t) => t.key === initialTab) ? initialTab : "daily"
  );

  // ── The 100× prose + Monday-action band (always-visible, above the tabs) ────
  const prose = useMemo(() => proseWeeklyNarrative(facts, { month: latestMonth }), [facts, latestMonth]);
  // Velocity rows feeding the reorder lever. monthlyRunRate is a units quantity, so
  // round it to an integer here (HARD INVARIANT: integer units, no raw floats) — the
  // engine returns the unrounded rate (it's a per-day rate × days), and the action
  // queue interpolates it into its rationale text, so we sanitise at the boundary.
  const velocityRows = useMemo(() => {
    return crossModuleVelocity(facts, { month: lastFullMonth, window: "t30" })
      .map((v) => ({ ...v, monthlyRunRate: v.monthlyRunRate == null ? null : Math.round(v.monthlyRunRate) }));
  }, [facts, lastFullMonth]);
  const queue = useMemo(() => actionQueue(facts, { month: lastFullMonth, velocity: velocityRows }), [facts, lastFullMonth, velocityRows]);

  return (
    <>
    <BizStateGuard facts={facts} module="Sales & Revenue" onUpload={() => setUploadOpen(true)}>
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">Sales &amp; Revenue Intelligence</div>
          <div className="page-sub">
            What changed, what&apos;s pacing, and what needs you today — net-of-GST, coverage-honest, daily grain
          </div>
        </div>
        <div className="actions" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {dataThrough && (
            <span className="cov-badge cov-agency sm" title="The latest data day reflected anywhere on this page (newest of all loaded sales sources). Consistent with the inventory module's freshness label.">
              Data through {fmtDay(dataThrough)}
            </span>
          )}
          <button className="btn sm" onClick={() => setUploadOpen(true)} title="Upload channel exports — Snell, Monarch, Amazon, Flipkart, Blinkit, Shopify">
            Upload reports
          </button>
          {latestMeta && <MonthBadge meta={latestMeta} />}
        </div>
      </div>

      {/* Orientation note — a cold reader understands the whole page from here. */}
      <div className="note" style={{ marginBottom: 16 }}>
        <span style={{ lineHeight: 1.55 }}>
          <strong>How to read this page.</strong>&nbsp;Revenue is <strong>net of GST and returns</strong>
          {" "}throughout. The page is ordered most-urgent-first: the <strong>read-out</strong> and{" "}
          <strong>today&apos;s pulse</strong> sit at the top, then the daily <strong>founder&apos;s sheet</strong> (the
          centrepiece), then who&apos;s winning/losing and why. Monthly views span the full agency history — Amazon
          from <strong>Aug-2024</strong> (the 0-to-1 ramp), Flipkart and website from Jun-2025, Blinkit from Dec-2025.
          A <span className="cov-badge cov-native">native</span> badge means the channel&apos;s own per-SKU export is
          loaded (overrides agency); <span className="cov-badge cov-agency">agency</span> is Snell/Monarch
          channel-grain. The current month is <span className="cov-badge cov-mtd">MTD</span> (partial) and is kept out
          of month-over-month unless compared day-for-day. Website revenue is gross in source, shown net-derived
          (÷1.05). Every non-trivial number has an <span className="formula-icon" style={{ position: "static", display: "inline" }}>ⓘ</span> with its formula, actual inputs, and source.
        </span>
      </div>

      {/* PER-SOURCE RECENCY (rubric XI/83) — the latest data day each loaded source
          actually carries, so the founder reads each figure's freshness, not just
          the page-level "Data through". Each day is clamped at build time to the
          global latest day, so a forward-dated agency label can't overstate it. */}
      <SourceRecencyLine facts={facts} latestDataDate={dataThrough} />

      {/* ════════ MOST-USEFUL-FIRST BAND (always visible, above the tabs) ════════
          What changed, what's pacing, and the ONE Monday action queue — the founder
          grasps the state of the business and what needs them in seconds (rubric
          63/66), then navigates the depth by tab (rubric 67). */}
      <AutoNarrative narrative={narrative} title="What changed & what needs you today" />

      {/* The written WEEKLY read-out in prose (VII/59) — distinct from the bullets. */}
      <div style={{ marginBottom: 16 }}>
        <ProseNarrative narrative={prose} title="This week, in words" />
      </div>

      {/* TODAY — MTD pulse per channel + projected month-end (II/15, VIII/63). */}
      <MtdPulse facts={facts} latestMonth={latestMonth} latestMeta={latestMeta} channels={channels} cov={cov} D={D} />

      {/* ONE "what to do Monday" queue across ALL levers, ranked by ₹ (VIII). */}
      <div style={{ marginBottom: 16 }}>
        <ActionQueue queue={queue} D={D} max={10} period={fmtMonth(lastFullMonth)} />
        <div className="muted" style={{ fontSize: 10.5, marginTop: 6, lineHeight: 1.45 }}>
          One queue spanning every lever — ad-cut, delist, reprice, reallocate, and reorder/stockout (the
          inventory↔sales join). Ranked by monthly ₹ impact off the latest complete month ({fmtMonth(lastFullMonth)});
          reorder rows use the 30-day sell-through run-rate. Each row ends in a decision with a number.
        </div>
      </div>

      {/* ════════ TABBED BODY (rubric IX/67 — sectioned, not one scroll) ════════ */}
      <div
        className="tabs"
        role="tablist"
        aria-label="Sales sections"
        style={{ overflowX: "auto", flexWrap: "nowrap", WebkitOverflowScrolling: "touch" }}
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? "active" : ""}
            onClick={() => setTab(t.key)}
            style={{ whiteSpace: "nowrap" }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ─────────── DAILY SHEET (centerpiece) ─────────── */}
      {tab === "daily" && (
        <>
          {/* THE FOUNDER'S SHEET — daily flag grid (CENTERPIECE) (VI/40, II/16). */}
          <FounderSheet facts={facts} channels={channels} D={D} />

          {/* Per-channel weekday-MATCHED daily flags (II/16 — not company-level). */}
          <PerChannelFlagsCard facts={facts} channels={channels} D={D} />

          {/* DAILY net-revenue curve (VI/44). */}
          <Card
            title="Daily net revenue · the shape of the business"
            sub="Every channel, day by day. Amazon runs back to Aug-2024 (the early ramp); other channels begin when their daily feed does. Net-of-GST; website net-derived (÷1.05)."
            action={
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <div className="seg">
                  <button className={chartMode === "line" ? "active" : ""} onClick={() => setChartMode("line")}>Lines</button>
                  <button className={chartMode === "stack" ? "active" : ""} onClick={() => setChartMode("stack")}>Stacked</button>
                </div>
                <div className="seg">
                  {["30d", "90d", "12m", "all"].map((r) => (
                    <button key={r} className={range === r ? "active" : ""} onClick={() => setRange(r)}>{r}</button>
                  ))}
                </div>
                {chartMode === "line" && (
                  <button
                    className={"btn sm" + (show7dMA ? " primary" : "")}
                    onClick={() => setShow7dMA((v) => !v)}
                    title="Toggle 7-day moving average overlay"
                  >
                    7d&nbsp;avg
                  </button>
                )}
              </div>
            }
            style={{ marginBottom: 16 }}
          >
            <DailyChart series={dailySeries} channels={channels} range={range} mode={chartMode} show7dMA={show7dMA} D={D} />
          </Card>

          {/* WEEKDAY / SEASONALITY (VI/49). */}
          <Card
            title="Weekday & seasonality"
            sub="The day-of-week structure of demand — so a daily red/green read is interpreted correctly (a structurally-low Sunday isn't a problem). Company-level, from the daily series."
            style={{ marginBottom: 16 }}
          >
            <SeasonalityPanel facts={facts} D={D} />
          </Card>
        </>
      )}

      {/* ─────────── MOVERS & MIX ─────────── */}
      {tab === "movers" && (
        <>
          {/* WINNERS & LOSERS — channel + SKU momentum, small-sample-annotated (VI/41, II/18). */}
          <MoversPanel facts={facts} month={lastFullMonth} priorMonth={priorFullMonth} />

          {/* WHY IT MOVED — revenue bridge MoM (VII/50). */}
          {priorFullMonth && (
            <Card
              title="Why revenue moved"
              sub={`Month-over-month revenue bridge — ${fmtMonth(priorFullMonth)} → ${fmtMonth(lastFullMonth)} decomposed into per-channel volume and price/mix effects. Each leg reconciles to the total change.`}
              style={{ marginBottom: 16 }}
            >
              <RevenueBridgePanel facts={facts} fromMonth={priorFullMonth} toMonth={lastFullMonth} D={D} />
            </Card>
          )}

          {/* CHANNEL MIX + concentration risk (VI/42, VII/57). */}
          <Card
            title="Channel mix & concentration"
            sub="How the revenue split is shifting, and how much of the business rides on one channel — the fragility to watch."
            action={
              <div className="seg">
                <button className={mixMetric === "netRev" ? "active" : ""} onClick={() => setMixMetric("netRev")}>₹ value</button>
                <button className={mixMetric === "share" ? "active" : ""} onClick={() => setMixMetric("share")}>% share</button>
              </div>
            }
            style={{ marginBottom: 16 }}
          >
            <ChannelMixArea headline={headline} channels={channels} metric={mixMetric} monthsMeta={monthsMeta} D={D} />
            <ConcentrationStrip facts={facts} month={lastFullMonth} />
          </Card>

          {/* THE MONTH — MoM growth table (like-for-like) (II/14). */}
          <Card
            title="Month-over-month net revenue"
            sub="Full agency history per channel (Amazon from Aug-2024), with like-for-like growth. Partial (MTD) months are dimmed and excluded from MoM. Small-base months carry a thin-base annotation rather than a bare %."
            padded={false}
            style={{ marginBottom: 16 }}
          >
            <MoMTable headline={headline} monthsMeta={monthsMeta} facts={facts} channels={channels} />
          </Card>
        </>
      )}

      {/* ─────────── FORECAST ─────────── */}
      {tab === "forecast" && (
        <ForecastTab facts={facts} channels={channels} D={D} />
      )}

      {/* ─────────── RETENTION & LTV ─────────── */}
      {tab === "retention" && (
        <>
          {/* Cohort / LTV curve (Shopify+Amazon) + AOV gap + Flipkart/Blinkit deferral (VI/46, param 89). */}
          <div style={{ marginBottom: 16 }}>
            <LtvCohort ltv={ltvCohort(facts)} D={D} title="Retention & LTV · Shopify + Amazon cohorts" />
          </div>

          {/* Returning-customer revenue ₹ + new-vs-returning AOV gap (e). */}
          <div style={{ marginBottom: 16 }}>
            <ReturningRevenueView data={returningRevenue(facts)} D={D} title="Returning-customer revenue & AOV gap" />
          </div>

          {/* Basket / units-per-order (VI/45) + website ORDER-COUNT history (VI-a).
              BUG-2 (II-88): UPO is a DEFERRAL — never a sub-1 cross-source ratio. The
              order-count history charts every month it exists; the table shows
              revenue-per-order (same-source Monarch) and a "— needs order-level export"
              cell for UPO, never a fabricated value. */}
          <div style={{ marginBottom: 16 }}>
            <BasketTrendView data={basketTrend(facts)} D={D} title="Website basket · orders, units-per-order & rev/order" />
          </div>

          {/* Historical repeat/returns actuals (the underlying source view). */}
          {(repeats || returnsTrend) && (
            <Card
              title="Customer retention & returns · historical actuals"
              sub="Are we keeping customers and are they sending product back? Shopify repeat rate climbing says the storefront is starting to retain. Returns are a separate, noisier signal."
              padded={false}
              style={{ marginBottom: 16 }}
            >
              <RetentionReturnsPanel repeats={repeats} returnsTrend={returnsTrend} />
            </Card>
          )}
        </>
      )}

      {/* ─────────── SKU & ORDERS ─────────── */}
      {tab === "sku" && (
        <>
          {/* PER-SKU units history + drill (VI/43). */}
          <Card
            title="Per-SKU sales history"
            sub="Monthly units per SKU across the full agency history (Snell Categorywise). Click a row to drill into its trend + weekday pattern."
            padded={false}
            style={{ marginBottom: 16 }}
          >
            <SkuHistoryTable skuUnitsHistory={skuUnitsHistory} onDrill={setDrillSku} />
          </Card>

          {/* MAY per-SKU revenue breakdown (native) + anomaly callouts. */}
          <Card
            title={`${fmtMonth(lastFullMonth)} · per-SKU net revenue (native)`}
            sub="The month with full per-SKU revenue grain (native exports). CM3 = after COGS, platform fees, and ads."
            action={
              <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                <UnitsRulePopover facts={facts} month={lastFullMonth} asOf={dataThrough ? fmtDay(dataThrough) : null} />
                <FlipkartNetRulePopover facts={facts} month={lastFullMonth} asOf={dataThrough ? fmtDay(dataThrough) : null} />
              </span>
            }
            padded={false}
            style={{ marginBottom: 16 }}
          >
            <MaySkuBreakdown facts={facts} month={lastFullMonth} channels={channels} />
          </Card>

          {/* AOV trend + price realization (VI/45, II/19). */}
          <Card
            title="Order value & price realization"
            sub="Net revenue ÷ units per channel over months, and (native month) the price actually banked per unit vs the gross — discount/GST leakage."
            action={<UnitsRulePopover facts={facts} month={lastFullMonth} asOf={dataThrough ? fmtDay(dataThrough) : null} />}
            style={{ marginBottom: 16 }}
          >
            <AovTrend facts={facts} monthsMeta={monthsMeta} channels={channels} D={D} />
            <PriceRealizationStrip facts={facts} month={lastFullMonth} />
          </Card>

          {/* Order-mix organic/review/paid decomposition over time (a). */}
          <div style={{ marginBottom: 16 }}>
            <OrderMixView data={orderMixTrend(facts)} D={D} title="Order mix · organic / review / paid (Amazon)" />
          </div>

          {/* VI-b + left-on-table #2 — basket composition (single-vs-multi-unit
              orders) + FBA/MFN fulfillment + B2B/B2C, from order-id grouping. */}
          <div style={{ marginBottom: 16 }}>
            <OrderCompositionView data={amazonOrderComposition(facts)} D={D} />
          </div>
        </>
      )}

      {/* ─────────── CROSS-MODULE ─────────── */}
      {tab === "cross" && (
        <CrossModuleCard facts={facts} month={lastFullMonth} />
      )}

      {/* ─────────── GEO & RETURNS ─────────── */}
      {tab === "geo" && (
        <>
          {/* Geographic demand / returns concentration (g). */}
          <div style={{ marginBottom: 16 }}>
            <GeoConcentrationView data={geoConcentration(facts, { month: lastFullMonth })} D={D} title="Amazon demand by state · returns concentration" max={12} />
          </div>

          {/* RETURNS honesty (VI/47). */}
          <Card
            title="Returns"
            sub="What each channel's source actually carries — net-of-returns honesty. A dash means not in source, not a zero rate."
            style={{ marginBottom: 16 }}
          >
            <ReturnsSection facts={facts} month={lastFullMonth} channels={channels} />
          </Card>

          {/* CANCEL-RATE trend per channel. */}
          {cancel && (
            <Card
              title="Order cancel rate by channel"
              sub="Shipped vs cancelled units per channel, month by month. A rising cancel rate burns ad spend and inventory before a sale ever lands — watched against an 8% / 15% threshold."
              padded={false}
              style={{ marginBottom: 16 }}
            >
              <CancelRatePanel cancel={cancel} channels={channels} />
            </Card>
          )}

          {/* Flipkart cashback (settlement drag) trend (d). */}
          <div style={{ marginBottom: 16 }}>
            <CashbackTrendView data={cashbackTrend(facts)} D={D} title="Flipkart cashback · settlement drag" />
          </div>
        </>
      )}

      {/* ─────────── RECONCILE (honesty / left-on-the-table) ─────────── */}
      {tab === "reconcile" && (
        <>
          <div className="note" style={{ marginBottom: 16 }}>
            <span style={{ lineHeight: 1.55 }}>
              <strong>Why this tab exists.</strong>&nbsp;The hardest honesty calls live here: where two sources of the
              same truth disagree, the gap is shown as an explicit fact (not silently reconciled), and where a number
              can only be modelled it is labelled modelled-not-measured with a band. Nothing the data could support is
              quietly dropped.
            </span>
          </div>

          {/* (b) Snell Total-row vs daily-series reconciliation. */}
          <div style={{ marginBottom: 16 }}>
            <TotalVsDailyView data={totalVsDailyReconciliation(facts)} D={D} title="Snell Total-row vs daily series (window gap)" />
          </div>

          {/* (c) Monarch conversion value vs Shopify-net (ad-reporting inflation). */}
          <div style={{ marginBottom: 16 }}>
            <ConversionGapView data={conversionValueGap(facts, { month: lastFullMonth })} D={D} title="Ad-reporting inflation · Monarch conversion value vs Shopify net" />
          </div>

          {/* (f) COGS cost-change history. */}
          <div style={{ marginBottom: 16 }}>
            <CostChangeView data={costChangeHistory(facts)} D={D} title="COGS cost-change history · what changed" />
          </div>

          {/* (III) MODELED Blinkit per-SKU ad proxy, banded, modeled-not-measured. */}
          <div style={{ marginBottom: 16 }}>
            <BlinkitAdProxy proxy={blinkitAdProxy(facts, { month: lastFullMonth })} D={D} title="Blinkit per-SKU ad attribution (modeled)" max={10} />
          </div>
        </>
      )}

      {drillSku && (
        <SkuDrillModal
          code={drillSku}
          history={skuUnitsHistory.bySku[drillSku]}
          facts={facts}
          onClose={() => setDrillSku(null)}
          D={D}
        />
      )}
    </div>
    </BizStateGuard>
    {uploadOpen && <UploadModal onClose={() => setUploadOpen(false)} defaultTab="business" />}
    </>
  );
};

// ════════════════════════════════════════════════════════════════════════════
// Coverage badge — the per-month honesty marker used everywhere.
// ════════════════════════════════════════════════════════════════════════════
function MonthBadge({ meta }) {
  if (!meta) return null;
  if (meta.partial) {
    return (
      <span className="cov-badge cov-mtd" title={`Partial month — data through ${fmtDay(meta.lastDay)}`}>
        MTD ≤ {fmtDay(meta.lastDay)}
      </span>
    );
  }
  const anyNative = Object.values(meta.channels || {}).some((c) => c.sales === "native");
  return anyNative ? (
    <span className="cov-badge cov-native" title="At least one channel has native per-SKU revenue this month">native</span>
  ) : (
    <span className="cov-badge cov-agency" title="Channel-grain agency revenue (Snell / Monarch)">agency</span>
  );
}

function CovChip({ basis, partial }) {
  if (partial) return <span className="cov-badge cov-mtd sm">MTD</span>;
  if (basis === "native") return <span className="cov-badge cov-native sm">nat</span>;
  if (basis === "agency") return <span className="cov-badge cov-agency sm">agc</span>;
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// PER-SOURCE RECENCY (rubric XI/83) — every loaded source's true latest data day,
// with its human label + tier, so freshness is read per-figure, not just at the
// page level. Reads facts.meta.sourceRecency (per-slug latest day, clamped at build
// time to the global latest day) and facts.meta.sourceLabels (slug → human label).
// A source whose latest day trails the global "Data through" by ≥1 day is flagged so
// the founder knows that figure is staler than the freshest part of the page.
// ════════════════════════════════════════════════════════════════════════════
const RECENCY_TIER_CLASS = { native: "cov-native", agency: "cov-agency" };
function SourceRecencyLine({ facts, latestDataDate }) {
  const recency = facts?.meta?.sourceRecency || null;
  const labels = facts?.meta?.sourceLabels || {};
  const rows = useMemo(() => {
    if (!recency) return [];
    return Object.entries(recency)
      .map(([slug, day]) => ({
        slug,
        day,
        label: labels[slug]?.label || slug,
        tier: labels[slug]?.tier || null,
      }))
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
    <details className="note" style={{ marginBottom: 16 }}>
      <summary style={{ cursor: "pointer", fontSize: 11.5, color: "var(--ink-2)" }}>
        <strong>Per-source freshness</strong> — {rows.length} sources loaded, newest data day {fmtDay(rows[0].day)}.
        Click to see each source&apos;s own latest day (a figure is only as fresh as its source).
      </summary>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "4px 18px", marginTop: 8 }}>
        {rows.map((r) => {
          const stale = staleDays(r.day);
          return (
            <div key={r.slug} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, lineHeight: 1.5 }}>
              {r.tier && <span className={`cov-badge ${RECENCY_TIER_CLASS[r.tier] || "cov-agency"} sm`}>{r.tier === "native" ? "nat" : "agc"}</span>}
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.label}>{r.label}</span>
              <span className="mono muted" style={{ whiteSpace: "nowrap" }}>{fmtDay(r.day)}</span>
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
}

// ════════════════════════════════════════════════════════════════════════════
// 1 · MTD PULSE — today's snapshot for the live month + projected month-end.
// ════════════════════════════════════════════════════════════════════════════
function MtdPulse({ facts, latestMonth, latestMeta, channels, cov, D }) {
  const rows = useMemo(() => {
    return channels
      .map((ch) => {
        const r = computeMonthChannelCM({ facts, month: latestMonth, channel: ch, coverage: cov });
        return { ch, r };
      })
      .filter((x) => x.r.coverage !== "none")
      .sort((a, b) => b.r.netRev - a.r.netRev);
  }, [facts, latestMonth, channels, cov]);

  const totalNet = rows.reduce((a, x) => a + num(x.r.netRev), 0);
  const totalUnits = rows.reduce((a, x) => a + num(x.r.units), 0);
  const partial = !!latestMeta?.partial;
  const lastDay = latestMeta?.lastDay;

  // Projected month-end (company) — the headline founder number (rubric 15).
  const proj = useMemo(() => projectMonthEnd(facts, { month: latestMonth }), [facts, latestMonth]);

  return (
    <div style={{ marginBottom: 16 }}>
      <div className="grid" style={{ gridTemplateColumns: `repeat(${Math.min(rows.length + 1, 5)}, minmax(0,1fr))`, gap: 12 }}>
        {/* Company total card — carries the projection */}
        <div className="card">
          <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid var(--border-soft)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="badge brand">TOTAL</span>
              {partial
                ? <span className="cov-badge cov-mtd sm" title={`Through ${fmtDay(lastDay)}`}>MTD</span>
                : <MonthBadge meta={latestMeta} />}
            </div>
            <div className="mono" style={{ fontSize: 19, marginTop: 8, fontWeight: 500 }}>{D.fmtINR(totalNet)}</div>
            <div className="muted" style={{ fontSize: 11 }}>
              Net revenue · {fmtMonth(latestMonth)}{partial ? ` (to ${fmtDay(lastDay)})` : ""}
            </div>
          </div>
          <div style={{ padding: "10px 14px", fontSize: 11.5, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px" }}>
            <div className="muted">Units</div><div className="mono text-right">{fmtUnits(totalUnits)}</div>
            <div className="muted">AOV (net)</div>
            <div className="mono text-right">{totalUnits ? fmtRupees(totalNet / totalUnits) : "—"}</div>
            <div className="muted">Channels live</div><div className="mono text-right">{rows.length}</div>
          </div>
          {partial && proj.partial && (
            <div style={{ padding: "8px 14px 12px", borderTop: "1px solid var(--border-soft)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="muted" style={{ fontSize: 11 }}>Projected month-end</span>
                <ConfidencePill confidence={proj.confidence} />
                <ProjectionDerivation proj={proj} D={D} />
              </div>
              <div className="mono" style={{ fontSize: 17, fontWeight: 500, marginTop: 3 }}>{D.fmtINR(proj.projected)}</div>
              <div className="muted" style={{ fontSize: 10.5 }}>
                band {D.fmtINR(proj.low)}–{D.fmtINR(proj.high)}
                {proj.paceVsPrior != null && (
                  <> · <span style={{ color: pctTone(proj.paceVsPrior) }}>{pctSigned(proj.paceVsPrior)}</span> vs {fmtMonthShort(proj.priorMonth)} to-date</>
                )}
              </div>
            </div>
          )}
        </div>

        {rows.slice(0, 4).map(({ ch, r }) => {
          const meta = chMeta(ch);
          const aov = r.units ? r.netRev / r.units : null;
          const share = totalNet ? (r.netRev / totalNet) * 100 : 0;
          return (
            <div key={ch} className="card">
              <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid var(--border-soft)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="badge" style={pillStyle(ch)}>{meta.short}</span>
                  <CovChip basis={r.coverage} partial={r.partial} />
                </div>
                <div className="mono" style={{ fontSize: 19, marginTop: 8, fontWeight: 500 }}>{D.fmtINR(r.netRev)}</div>
                <div className="muted" style={{ fontSize: 11 }}>{meta.name} · {share.toFixed(0)}% of month</div>
              </div>
              <div style={{ padding: "10px 14px", fontSize: 11.5, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px" }}>
                <div className="muted">Units</div><div className="mono text-right">{fmtUnits(r.units)}</div>
                <div className="muted">AOV (net)</div><div className="mono text-right">{aov != null ? fmtRupees(aov) : "—"}</div>
                <div className="muted">CM3</div>
                <div className="mono text-right" style={{ color: cmColor(r.cm3) }}>
                  {r.cm3 == null ? "—" : D.fmtINR(r.cm3)}
                </div>
                <div className="muted">CM3 %</div>
                <div className="mono text-right" style={{ color: pctTone(r.pcts?.cm3) }}>{pctStr(r.pcts?.cm3)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ConfidencePill({ confidence }) {
  const cls = confidence === "high" ? "cov-native" : confidence === "low" ? "cov-mtd" : "cov-agency";
  return <span className={`cov-badge ${cls} sm`} title="Projection confidence — rises with elapsed days of the month">{confidence}</span>;
}

function ProjectionDerivation({ proj, D }) {
  return (
    <DerivationPopover
      title={`Projected month-end · ${fmtMonth(proj.month)}`}
      formula="mtd × (priorFull ÷ priorToDate)"
      plain={`Extrapolate this month at the SAME within-month pace ${fmtMonthShort(proj.priorMonth)} ran to the same day-of-month — never a half-month compared to a full one.`}
      inputs={[
        { label: `MTD (to day ${proj.dom})`, value: D.fmtINR(proj.mtd) },
        { label: `${fmtMonthShort(proj.priorMonth)} to day ${proj.dom}`, value: D.fmtINR(proj.priorToDate) },
        { label: `${fmtMonthShort(proj.priorMonth)} full month`, value: D.fmtINR(proj.priorFull) },
        { label: "Days elapsed / in month", value: `${proj.dom} / ${proj.daysInMonth}` },
        { label: "Uncertainty band ±", value: D.fmtINR((proj.high - proj.low) / 2) },
      ]}
      value={`${D.fmtINR(proj.projected)} (${D.fmtINR(proj.low)}–${D.fmtINR(proj.high)})`}
      note={proj.confidence === "low" ? "Low confidence — few days elapsed; treat as directional." : null}
      source="bizAnalytics.projectMonthEnd"
      asOf={proj.lastDay || proj.month}
    />
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 2 · THE FOUNDER'S SHEET — daily Date×channel×Total flag grid (CENTERPIECE).
// ════════════════════════════════════════════════════════════════════════════
function FounderSheet({ facts, channels, D }) {
  const [metric, setMetric] = useState("netRev");          // netRev | units
  const [span, setSpan] = useState(60);                    // rows shown
  const [chanFilter, setChanFilter] = useState("all");     // all | <channel>

  const table = useMemo(
    () => dailyFactTable(facts, {
      metric, lastN: 95,
      channels: chanFilter === "all" ? channels : [chanFilter],
    }),
    [facts, metric, chanFilter, channels]
  );
  // company-level flags keyed by iso (so a colour answers the stated question).
  const flags = useMemo(() => dailyFlags(facts, { channel: chanFilter === "all" ? undefined : chanFilter }), [facts, chanFilter]);
  const flagsByIso = useMemo(() => Object.fromEntries(flags.map((f) => [f.iso, f])), [flags]);

  // Quick "days that broke pattern" count for the strap.
  const recentFlagged = flags.slice(-span).filter((f) => f.flag !== "normal").length;

  return (
    <Card
      title="The daily sheet · Date × channel × Total"
      sub="Your tracking sheet, surpassed — subtotals, a running cumulative, day-over-day growth, and a seasonality-honest day flag. Newest at the top. The flag answers two different questions (beat the recent peak vs softening below its own weekday)."
      action={
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <div className="seg">
            <button className={metric === "netRev" ? "active" : ""} onClick={() => setMetric("netRev")}>₹ net rev</button>
            <button className={metric === "units" ? "active" : ""} onClick={() => setMetric("units")}>Units</button>
          </div>
          <div className="seg">
            <button className={chanFilter === "all" ? "active" : ""} onClick={() => setChanFilter("all")}>All</button>
            {channels.map((ch) => (
              <button key={ch} className={chanFilter === ch ? "active" : ""} onClick={() => setChanFilter(ch)}>{chMeta(ch).short}</button>
            ))}
          </div>
          <div className="seg">
            {[30, 60, 95].map((s) => (
              <button key={s} className={span === s ? "active" : ""} onClick={() => setSpan(s)}>{s === 95 ? "max" : `${s}d`}</button>
            ))}
          </div>
        </div>
      }
      style={{ marginBottom: 16 }}
    >
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>
        {recentFlagged > 0
          ? <>In the last {span} days, <strong>{recentFlagged}</strong> day{recentFlagged > 1 ? "s" : ""} broke their normal weekday pattern — the coloured flags below. Hover a flag for the reason.</>
          : <>No days broke pattern in the last {span} days — demand is tracking its weekday baseline.</>}
        {" "}
        <DerivationPopover
          title="Daily flag baseline"
          formula="beatPeak: net > max(trailing 7) · softening: net < weekday-matched avg − 15% · anomaly: |z| ≥ 2σ"
          plain="Two different questions, seasonality-honest: 'beat the recent peak' (a new high vs the trailing-7 peak) and 'is demand softening' (below this day's own weekday average, so a structurally-low Sunday isn't flagged red against a Tuesday peak). A 2σ break is flagged as an anomaly."
          source="bizAnalytics.dailyFlags"
        />
      </div>
      <DailyFlagGrid table={table} flagsByIso={flagsByIso} D={D} newestFirst maxRows={span} />
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 2b · PER-CHANNEL WEEKDAY-MATCHED daily flags (rubric II/16) — every signal vs
// the channel's OWN weekday baseline + trailing window, NOT the company level. So
// a structurally-low channel-Sunday is never flagged red against the channel's own
// Tuesday peak, and the anomaly z is scored against that channel's own variance.
// ════════════════════════════════════════════════════════════════════════════
const FLAG_TONE = {
  peak: { color: "var(--success)", bg: "var(--success-soft)", label: "Beat peak" },
  strong: { color: "var(--success)", bg: "var(--success-soft)", label: "Above avg" },
  soft: { color: "var(--warning)", bg: "var(--warning-soft)", label: "Softening" },
  "anomaly-low": { color: "var(--critical)", bg: "var(--critical-soft)", label: "Anomaly ↓" },
  "anomaly-high": { color: "var(--info)", bg: "var(--bg-sunken)", label: "Unusual ↑" },
  normal: { color: "var(--ink-3)", bg: "transparent", label: "Normal" },
};
function PerChannelFlagsCard({ facts, channels, D }) {
  const [ch, setCh] = useState(channels[0] || "amazon");
  const active = channels.includes(ch) ? ch : channels[0];
  const base = useMemo(() => perChannelWeekdayBaseline(facts, { channel: active }), [facts, active]);
  const flags = useMemo(() => perChannelDailyFlags(facts, { channel: active, window: 28, lastN: 28 }), [facts, active]);
  const rows = [...flags].reverse(); // newest first
  const broke = flags.filter((f) => f.flag !== "normal" && f.flag !== "strong").length;

  return (
    <Card
      title="Per-channel daily flags · weekday-matched"
      sub={`Each day flagged against ${chMeta(active).name}'s OWN weekday baseline and its own trailing-28-day variance — not a company-level average. A structurally quiet ${chMeta(active).name} weekday is judged against that weekday, so a normal-for-it Sunday is never red against its Tuesday peak.`}
      action={
        <div className="seg">
          {channels.map((c) => (
            <button key={c} className={active === c ? "active" : ""} onClick={() => setCh(c)}>{chMeta(c).short}</button>
          ))}
        </div>
      }
      padded={false}
      style={{ marginBottom: 16 }}
    >
      <div className="card-body" style={{ paddingBottom: 8 }}>
        <div className="muted" style={{ fontSize: 11.5 }}>
          {broke > 0
            ? <>In {chMeta(active).name}&apos;s last {flags.length} days, <strong>{broke}</strong> broke its own weekday pattern.</>
            : <>{chMeta(active).name} is tracking its own weekday baseline — no pattern breaks in the last {flags.length} days.</>}
          {" "}
          <DerivationPopover
            title={`${chMeta(active).name} weekday baseline`}
            formula="wdExpected = (weekday index) × (channel overall daily mean) · softening: net < weekday-trailing-avg − 15% · anomaly: |z| ≥ 2σ over the channel's trailing 28d"
            plain={`Every signal is computed within ${chMeta(active).name} only: the weekday-matched average is over the same channel + same day-of-week in the trailing window, and the anomaly z divides by this channel's own trailing standard deviation. This is the per-channel weekday-matched baseline the rubric (II/16) asks for, distinct from the company-level flag on the founder's sheet above.`}
            inputs={[
              { label: "Channel overall daily mean", value: D.fmtINR(base.overallMean) },
              { label: "Days in channel series", value: String(base.totalDays) },
              ...base.weekday.names.map((nm, i) => ({ label: `${nm} index`, value: base.weekday.index[i] != null ? `${base.weekday.index[i].toFixed(2)}×` : "—" })),
            ]}
            source="bizAnalytics.perChannelDailyFlags"
          />
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Day</th>
              <th className="num">Net</th>
              <th className="num">Units</th>
              <th className="num">Its weekday avg</th>
              <th className="num">vs weekday</th>
              <th className="num">z (channel)</th>
              <th>Flag</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="muted" style={{ fontSize: 12.5, padding: "16px 14px" }}>No daily series for {chMeta(active).name}.</td></tr>
            ) : rows.map((f) => {
              const tone = FLAG_TONE[f.flag] || FLAG_TONE.normal;
              return (
                <tr key={f.iso} style={{ background: tone.bg !== "transparent" ? tone.bg : undefined }}>
                  <td>
                    <span>{fmtDay(f.iso)}</span>
                    <span className="muted" style={{ fontSize: 10.5, marginLeft: 6 }}>{f.dowName}</span>
                  </td>
                  <td className="num">{fmtRupees(f.net)}</td>
                  <td className="num muted">{fmtUnits(f.units)}</td>
                  <td className="num muted">{f.wdAvg != null ? fmtRupees(f.wdAvg) : "—"}</td>
                  <td className="num" style={{ color: f.softPct == null ? "var(--ink-3)" : f.softPct < 0 ? "var(--warning)" : "var(--success)" }}>
                    {f.softPct != null ? pctSigned(f.softPct) : "—"}
                  </td>
                  <td className="num muted">{f.z != null ? `${f.z >= 0 ? "+" : ""}${f.z.toFixed(1)}σ` : "—"}</td>
                  <td>
                    <span title={f.label} style={{ color: tone.color, fontSize: 11.5, fontWeight: f.flag === "normal" ? 400 : 500 }}>
                      {tone.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="card-body" style={{ paddingTop: 10 }}>
        <div className="muted" style={{ fontSize: 11 }}>
          The flag answers two distinct, seasonality-honest questions for <strong>this channel</strong>:
          {" "}<span style={{ color: "var(--success)" }}>Beat peak</span> = a new high vs its own trailing-7 peak;
          {" "}<span style={{ color: "var(--warning)" }}>Softening</span> = below its own weekday average by &gt;15%;
          {" "}<span style={{ color: "var(--critical)" }}>Anomaly ↓</span> = ≥2σ below its own trailing-28-day variance.
          Per-channel weekday-matched (rubric II/16) — distinct from the company-level flag on the founder&apos;s sheet.
        </div>
      </div>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 3a · FORECAST TAB — forward rev/units/CONTRIBUTION at channel AND SKU grain,
// with the STATED method + uncertainty band (rubric VII/52). Channel and SKU
// selectors; the metric toggle picks rev/units/CM3; the band + confidence + method
// ride under the chart (never a black-box number). A SKU-grain forecast off one
// complete native month is shown but flagged very-low (the engine's own note).
// ════════════════════════════════════════════════════════════════════════════
function ForecastTab({ facts, channels, D }) {
  const [grain, setGrain] = useState("company"); // company | channel | sku
  const [channel, setChannel] = useState(channels[0] || "amazon");
  const [metric, setMetric] = useState("netRev"); // netRev | units | cm3

  // SKU options from the native per-SKU history (richest forecastable grain).
  const skuOptions = useMemo(() => {
    const sm = snellSkuUnitsMap(facts);
    const set = new Set();
    for (const k of Object.keys(sm)) { const code = k.split("|")[2]; if (code) set.add(code); }
    return [...set].sort((a, b) => skuShort(a).localeCompare(skuShort(b)));
  }, [facts]);
  const [sku, setSku] = useState(skuOptions[0] || null);

  const allCh = !channels.includes(channel); // "__all__" sentinel for SKU-all-channels
  const fcArgs = grain === "sku"
    ? { sku: sku || skuOptions[0], channel: allCh ? undefined : channel }
    : grain === "channel"
      ? { channel: channels.includes(channel) ? channel : channels[0] }
      : {};
  const fc = useMemo(() => forecast(facts, { ...fcArgs, horizonMonths: 3 }), [facts, grain, channel, sku, allCh]); // eslint-disable-line react-hooks/exhaustive-deps

  const grainLabel = grain === "company" ? "Company (all channels)"
    : grain === "channel" ? chMeta(channels.includes(channel) ? channel : channels[0]).name
      : `${skuShort(sku)}${allCh ? " · all channels" : ` · ${chMeta(channel).name}`}`;
  const next = (fc.forecast || [])[0] || null;

  return (
    <Card
      title="Forward forecast · revenue · units · contribution"
      sub="Forward projection at company, channel, or SKU grain — with a stated method and an honest uncertainty band. The forecast is rear-view-free: a trailing-trend ⊕ run-rate blend, units at the held ₹/unit, and contribution at the held CM3 margin, so the forward CONTRIBUTION is the forecast revenue × the grain's own recent margin (not a separate guess)."
      action={
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <div className="seg">
            <button className={grain === "company" ? "active" : ""} onClick={() => setGrain("company")}>Company</button>
            <button className={grain === "channel" ? "active" : ""} onClick={() => setGrain("channel")}>Channel</button>
            <button className={grain === "sku" ? "active" : ""} onClick={() => setGrain("sku")}>SKU</button>
          </div>
          <div className="seg">
            <button className={metric === "netRev" ? "active" : ""} onClick={() => setMetric("netRev")}>Revenue</button>
            <button className={metric === "units" ? "active" : ""} onClick={() => setMetric("units")}>Units</button>
            <button className={metric === "cm3" ? "active" : ""} onClick={() => setMetric("cm3")}>CM3</button>
          </div>
        </div>
      }
      style={{ marginBottom: 16 }}
    >
      {/* grain selectors */}
      {(grain === "channel" || grain === "sku") && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          {grain === "sku" && (
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <span className="muted">SKU</span>
              <select className="input sm" value={sku || ""} onChange={(e) => setSku(e.target.value)} aria-label="Forecast SKU">
                {skuOptions.map((c) => <option key={c} value={c}>{skuShort(c)} ({c})</option>)}
              </select>
            </label>
          )}
          <div className="seg" aria-label="Forecast channel">
            {grain === "sku" && (
              <button className={allCh ? "active" : ""} onClick={() => setChannel("__all__")}>All ch</button>
            )}
            {channels.map((c) => (
              <button key={c} className={channel === c ? "active" : ""} onClick={() => setChannel(c)}>{chMeta(c).short}</button>
            ))}
          </div>
        </div>
      )}

      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        Forecasting <strong>{grainLabel}</strong> ·{" "}
        {metric === "netRev" ? "net revenue" : metric === "units" ? "units" : "CM3 contribution"}
        {next && (
          <> · next month ({fmtMonth(next.month)}):{" "}
            <strong>
              {metric === "units"
                ? `${fmtUnits(next.units)} u`
                : metric === "cm3"
                  ? (next.cm3 == null ? "—" : D.fmtINR(next.cm3))
                  : D.fmtINR(next.netRev)}
            </strong>
            {metric !== "units" && (
              <span className="muted"> (band {metric === "cm3"
                ? `${next.cm3Low == null ? "—" : D.fmtINR(next.cm3Low)}–${next.cm3High == null ? "—" : D.fmtINR(next.cm3High)}`
                : `${D.fmtINR(next.netRevLow)}–${D.fmtINR(next.netRevHigh)}`})</span>
            )}
            {next.partial && <span className="muted"> · current month completed via month-end pace</span>}
          </>
        )}
      </div>

      <ForecastChart fc={fc} D={D} metric={metric} height={260} />
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 3 · WINNERS & LOSERS — channel + SKU movers by momentum.
// ════════════════════════════════════════════════════════════════════════════
function MoversPanel({ facts, month, priorMonth }) {
  const [dim, setDim] = useState("channel");      // channel | sku
  const [metric, setMetric] = useState("netRev"); // netRev | units | cm3
  const movers = useMemo(
    () => (priorMonth ? rankMovers(facts, { dimension: dim, month, priorMonth, metric }) : []),
    [facts, dim, month, priorMonth, metric]
  );
  const labelOf = (key) => (dim === "sku" ? `${skuShort(key)}` : chMeta(key).name);
  const fmtVal = (v) => (metric === "units" ? fmtUnits(v) : fmtRupees(v));

  if (!priorMonth) {
    return (
      <Card title="Winners & losers" style={{ marginBottom: 16 }}>
        <div className="muted" style={{ fontSize: 12.5 }}>Need two complete months for a like-for-like mover ranking.</div>
      </Card>
    );
  }

  const shown = movers.filter((m) => m.deltaAbs !== 0 || m.cur !== 0).slice(0, dim === "sku" ? 12 : 8);
  const win = movers.window || { partial: false, mode: "full-vs-full" };
  const baseSub = win.partial
    ? `Who accelerated and who decelerated, ${fmtMonth(priorMonth)} → ${fmtMonth(month)}, compared like-for-like through day ${win.cutoff} of BOTH months (MTD-vs-MTD — ${fmtMonth(month)} is still in progress). Sorted by the size of the move.`
    : `Who accelerated and who decelerated, ${fmtMonth(priorMonth)} → ${fmtMonth(month)} (full-month, like-for-like). Sorted by the size of the move.`;

  return (
    <Card
      title="Winners & losers · momentum"
      sub={baseSub}
      padded={false}
      action={
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <div className="seg">
            <button className={dim === "channel" ? "active" : ""} onClick={() => setDim("channel")}>Channels</button>
            <button className={dim === "sku" ? "active" : ""} onClick={() => setDim("sku")}>SKUs</button>
          </div>
          <div className="seg">
            <button className={metric === "netRev" ? "active" : ""} onClick={() => setMetric("netRev")}>Revenue</button>
            <button className={metric === "units" ? "active" : ""} onClick={() => setMetric("units")}>Units</button>
            <button className={metric === "cm3" ? "active" : ""} onClick={() => setMetric("cm3")}>CM3</button>
          </div>
        </div>
      }
      style={{ marginBottom: 16 }}
    >
      {shown.length === 0 ? (
        <div className="card-body"><div className="muted" style={{ fontSize: 12.5 }}>No movers in this cut.</div></div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{dim === "sku" ? "SKU" : "Channel"}</th>
              <th className="num">{fmtMonthShort(priorMonth)}{win.partial ? ` ·d${win.cutoff}` : ""}</th>
              <th className="num">{fmtMonthShort(month)}{win.partial ? ` ·d${win.cutoff}` : ""}</th>
              <th className="num">Δ {metric === "cm3" ? "CM3" : metric === "units" ? "units" : "₹"}</th>
              <th className="num">Momentum</th>
              <th>Move</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => {
              const upGood = metric !== "cm3" ? m.direction === "up" : m.deltaAbs > 0;
              const barFrac = Math.max(...shown.map((x) => Math.abs(x.deltaAbs))) || 1;
              const w = Math.min(100, (Math.abs(m.deltaAbs) / barFrac) * 100);
              return (
                <tr key={m.key}>
                  <td>
                    {dim === "sku" ? (
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span>{labelOf(m.key)}</span>
                        <span className="sku">{m.key}</span>
                      </div>
                    ) : (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span className="badge" style={{ ...pillStyle(m.key), fontSize: 9 }}>{chMeta(m.key).short}</span>
                        {chMeta(m.key).name}
                      </span>
                    )}
                  </td>
                  <td className="num muted">{fmtVal(m.prior)}</td>
                  <td className="num">{fmtVal(m.cur)}</td>
                  <td className="num" style={{ color: m.deltaAbs === 0 ? "var(--ink-3)" : (upGood ? "var(--success)" : "var(--critical)") }}>
                    {m.deltaAbs > 0 ? "+" : ""}{fmtVal(m.deltaAbs)}
                  </td>
                  <td className="num">
                    {m.momentum == null
                      ? <span className="cov-badge cov-native sm" title="No prior-month base — new this month">new</span>
                      : m.pctReliable === false
                        ? <span className="muted" style={{ fontSize: 11 }} title={`Prior base too small (${fmtVal(m.prior)}) for a meaningful %. Read the absolute Δ instead.`}>n/m</span>
                        : <DeltaChip frac={m.momentum} />}
                  </td>
                  <td>
                    <div style={{ height: 8, background: "var(--bg-sunken)", borderRadius: 4, overflow: "hidden", minWidth: 80 }}>
                      <div style={{ width: `${w}%`, height: "100%", background: upGood ? "var(--success)" : "var(--critical)", opacity: 0.7 }} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="card-body" style={{ paddingTop: 10 }}>
        <div className="muted" style={{ fontSize: 11 }}>
          Momentum = % change vs the {win.partial ? `prior month through the same day (day ${win.cutoff})` : "prior full month"} (a positive CM3 momentum means margin is accelerating).
          {win.partial ? ` Because ${fmtMonth(month)} is still in progress, both months are clipped to day ${win.cutoff} — so a "down" channel is a real decline, not just fewer elapsed days.` : ""} A
          channel/SKU present in only one month shows <span className="cov-badge cov-native sm">new</span>; a % off a base too small to be a trend shows <span className="muted">n/m</span> (read the absolute Δ). Source:
          coverage-aware CM (native where present, agency otherwise) — same basis on both months.
        </div>
      </div>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 4 · REVENUE BRIDGE — why revenue moved MoM (volume × price/mix per channel).
// ════════════════════════════════════════════════════════════════════════════
function RevenueBridgePanel({ facts, fromMonth, toMonth, D }) {
  const bridge = useMemo(() => revenueBridge(facts, { fromMonth, toMonth }), [facts, fromMonth, toMonth]);
  if (!bridge.steps.length) {
    return <div className="muted" style={{ fontSize: 12.5 }}>Not enough overlap to build a revenue bridge for these months.</div>;
  }
  const w = bridge.window || { partial: false };
  return (
    <div>
      {w.partial && (
        <div style={{ marginBottom: 10, fontSize: 11, border: "1px solid var(--border-soft)", borderRadius: 6, padding: "6px 10px", background: "var(--bg-sunken)" }}>
          <strong>Like-for-like:</strong> {fmtMonth(toMonth)} is still in progress, so both months are clipped to
          day {w.cutoff} (MTD-vs-MTD). The volume leg is a real change in units sold through the same calendar day —
          not an artifact of fewer elapsed days.
        </div>
      )}
      <BridgeChart bridge={bridge} D={D} height={250} />
      <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: "6px 10px", fontSize: 11.5 }}>
        {bridge.steps.map((s, i) => (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "1px solid var(--border-soft)", borderRadius: 6, padding: "3px 8px" }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: s.value >= 0 ? "var(--success)" : "var(--critical)" }} />
            {s.label}
            <span className="mono" style={{ color: s.value >= 0 ? "var(--success)" : "var(--critical)" }}>{s.value >= 0 ? "+" : ""}{fmtRupees(s.value)}</span>
          </span>
        ))}
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
        Each channel&apos;s change splits into a <strong>volume effect</strong> (units moved × old price) and a{" "}
        <strong>price/mix effect</strong> (new units × price change). Channels that started or stopped appear as a
        single new/lost bar. {w.partial ? `Compared like-for-like through day ${w.cutoff} of both months. ` : ""}{bridge.reconciles ? "All legs reconcile to the total change exactly." : "⚠ legs do not fully reconcile — treat as approximate."}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 5b · CONCENTRATION — share + HHI on one channel / SKU (fragility to watch).
// ════════════════════════════════════════════════════════════════════════════
function ConcentrationStrip({ facts, month }) {
  const conc = useMemo(() => concentrationRisk(facts, { month }), [facts, month]);
  const blocks = [
    { key: "ch-rev", label: "Channel · revenue", c: conc.byChannel.revenue, isCh: true },
    { key: "ch-mar", label: "Channel · margin (CM3)", c: conc.byChannel.margin, isCh: true },
    { key: "sku-rev", label: "SKU · revenue", c: conc.bySku.revenue, isCh: false },
    { key: "sku-mar", label: "SKU · margin (CM3)", c: conc.bySku.margin, isCh: false },
  ];
  // IV-98/IX-94 — the window label is RESOLVED from the engine (complete month vs
  // MTD-through-day-N) and shown ADJACENT to the headline, so this May "complete
  // month" 54.1%/0.37 is never confused with the read-out's June-MTD 51%/0.34. Both
  // concentration figures on the page now carry their own window label.
  const winLabel = conc.window?.label || fmtMonth(month);
  return (
    <div style={{ marginTop: 16, borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        <span className="stat-label">Concentration risk</span>
        <span className={`cov-badge ${conc.partial ? "cov-mtd" : "cov-agency"} sm`} title={conc.partial ? "Partial (MTD) window — not comparable like-for-like to a complete month." : "Complete-month window."}>
          {winLabel}
        </span>
        <DerivationPopover
          title="Concentration (HHI)"
          formula="HHI = Σ(share²) over the positive-value pool"
          plain={`How much of THIS window (${winLabel}) rides on one channel or SKU. HHI runs 0 (perfectly spread) to 1 (everything on one). Above 0.25 we call it concentrated — a fragility to watch. The window label is shown here AND on the read-out's concentration line so a complete-month figure is never compared to an MTD one.`}
          source="bizAnalytics.concentrationRisk"
          asOf={conc.window?.label || month}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        {blocks.map(({ key, label, c, isCh }) => {
          if (!c.top) return (
            <div key={key} style={{ border: "1px solid var(--border-soft)", borderRadius: 8, padding: "8px 12px", background: "var(--bg-sunken)" }}>
              <div className="muted" style={{ fontSize: 10.5 }}>{label}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>—</div>
            </div>
          );
          const topLabel = isCh ? chMeta(c.top.key).name : skuShort(c.top.key);
          return (
            <div key={key} style={{
              border: "1px solid var(--border-soft)", borderRadius: 8, padding: "8px 12px",
              background: c.concentrated ? "var(--warning-soft)" : "var(--bg-sunken)",
            }}>
              <div className="muted" style={{ fontSize: 10.5 }}>{label}</div>
              <div className="mono" style={{ fontSize: 16, fontWeight: 500, marginTop: 2, color: c.concentrated ? "var(--warning)" : "var(--ink)" }}>
                {pct1(c.topShare)}
              </div>
              <div className="muted" style={{ fontSize: 10.5 }}>
                on {topLabel} · HHI {c.hhi.toFixed(2)}{c.concentrated ? " · concentrated" : ""}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 6 · CROSS-MODULE — sell-through velocity → reorder / stockout watch.
// ════════════════════════════════════════════════════════════════════════════
// RECONCILED VELOCITY (rubric 17): ONE definition family, a window toggle — never
// two unreconciled "velocity" numbers. The panel computes all windows from the same
// fact cells; the toggle picks which one drives the headline, and every row exposes
// the full reconciled set so the founder can see they tie to one definition.
// IX-94 — the "current month" window TITLE is RESOLVED from the engine's own
// label (partial → "MTD through day N of M"; complete → "complete month, N days"),
// so a complete month (e.g. May, 31 days) is NEVER mislabelled "This month (MTD)"
// with DAYS=31 — that read as a 3× overstatement against a real June-to-day-10
// window. t30/t90 are static (true trailing windows regardless of month state).
const VEL_WINDOW_TITLE = {
  t30: "30-day reorder-planning rate — the window the inventory module plans at",
  t90: "90-day steady-state rate",
};
function velWindowTitle(winKey, curLabel) {
  if (winKey === "mtd") {
    const lbl = curLabel || "current-month window";
    return `Current-month rate (units ÷ days) over the ${lbl}`;
  }
  return VEL_WINDOW_TITLE[winKey] || "current window";
}
function CrossModuleCard({ facts, month }) {
  const [winKey, setWinKey] = useState("t30"); // default to the reorder-planning window (the decision this card drives)
  // Resolve the current-month label ONCE from the engine so the header, the toggle
  // tooltip, and the panel all read the SAME true window — never a static "MTD".
  const vel = useMemo(() => crossModuleVelocity(facts, { month, window: winKey }), [facts, month, winKey]);
  const curLabel = vel.meta?.currentMonthLabel || null;
  const curPartial = !!vel.meta?.currentMonthPartial;
  // A human label for the "Current month" toggle button — "May (complete)" not "MTD".
  const curBtnLabel = curPartial ? `${fmtMonthShort(month)} MTD` : `${fmtMonthShort(month)} (full)`;
  return (
    <Card
      title="Sell-through velocity · reorder & stockout watch"
      sub={`Sales × inventory together: how fast each SKU×channel is selling and which fast-movers or loss-makers need a reorder decision. ${velWindowTitle(winKey, curLabel)}. These rows are PER-CHANNEL (one SKU×channel each); the Inventory "Top mover" reads the same SKU ALL-CHANNEL at max(30,15)d — same SKU, two grains. All three windows are the SAME definition (units ÷ days) from the same fact store — pick the one your decision needs; the 30-day rate is what the inventory module plans at, so the two modules reconcile. Native per-SKU month only.`}
      padded={false}
      style={{ marginBottom: 16 }}
      action={
        <div className="seg" title="One velocity definition (units ÷ days); the toggle only changes the window — the numbers reconcile across modules.">
          {VELOCITY_WINDOWS.map((w) => {
            // The current-month window's button + tooltip resolve to the TRUE window
            // ("May complete, 31 days") rather than the static "Current month" / MTD.
            const isCur = w.key === "mtd";
            const lbl = isCur ? curBtnLabel : w.label;
            const ttl = isCur ? (curLabel ? `Units ÷ days over the ${curLabel}` : w.question) : w.question;
            return (
              <button key={w.key} className={winKey === w.key ? "active" : ""} onClick={() => setWinKey(w.key)} title={ttl}>{lbl}</button>
            );
          })}
        </div>
      }
    >
      <CrossModulePanel facts={facts} month={month} winKey={winKey} vel={vel} curLabel={curLabel} curPartial={curPartial} />
    </Card>
  );
}

function CrossModulePanel({ facts, month, winKey = "t30", vel: velProp, curLabel, curPartial }) {
  const velLocal = useMemo(() => crossModuleVelocity(facts, { month, window: winKey }), [facts, month, winKey]);
  const vel = velProp || velLocal;
  // Join CM3 sign per SKU×channel (loss-maker about to reorder) from the matrix.
  const cm = useMemo(() => computeCM({ facts, month }), [facts, month]);
  const cm3Of = (code, ch) => cm.matrix?.[code]?.[ch]?.cm3 ?? null;

  if (vel.length === 0) {
    return <div className="card-body"><div className="muted" style={{ fontSize: 12.5 }}>No native per-SKU sell-through for {fmtMonth(month)} — velocity needs per-SKU units.</div></div>;
  }
  const rows = vel.slice(0, 14);
  // IX-94 — the current-month column resolves to the TRUE window from the engine
  // ("May (complete month, 31 days)" or "June MTD through day 10 of 30"), never the
  // static "Current month"/"MTD" label that would read 31 days as an MTD overstatement.
  const resolvedCurLabel = curLabel || vel.meta?.currentMonthLabel || `${month} current month`;
  const curShort = curPartial != null
    ? (curPartial ? `${fmtMonthShort(month)} MTD` : `${fmtMonthShort(month)} (full)`)
    : (vel.meta?.currentMonthPartial ? `${fmtMonthShort(month)} MTD` : `${fmtMonthShort(month)} (full)`);
  const winLabel = winKey === "mtd" ? curShort : ((VELOCITY_WINDOWS.find((w) => w.key === winKey) || {}).label || winKey);
  const curColLabel = curShort; // header for the per-window column triple

  return (
    <div>
      {/* Window label, adjacent to the table — the founder always knows which window
          the numbers describe (IX-94: a complete month reads "complete month, N days",
          never "This month (MTD)"). */}
      <div className="card-body" style={{ paddingTop: 0, paddingBottom: 8 }}>
        <span className="cov-badge cov-agency sm" title="The exact window these velocity numbers cover, resolved from the latest data day — a complete month reads its true day count, a live month reads MTD through day N.">
          window · {resolvedCurLabel}
        </span>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>SKU · channel</th>
            <th className="num">Units ({winLabel})</th>
            <th className="num">Days</th>
            <th className="num" title={`Per-channel ${winLabel} velocity (units ÷ days for THIS SKU on THIS channel). The Inventory "Top mover" headline reads the SAME SKU at all-channel · max(30,15)d grain — same SKU, two grains; switch the window toggle to 30d to bridge them.`}>
              Velocity /day<br/><span className="muted" style={{ fontSize: 9.5, fontWeight: 500, textTransform: "none" }}>per-channel · {winLabel}</span>
            </th>
            <th className="num" title="The same SKU×channel velocity over all three windows (units ÷ days). The current-month window resolves to its true span (complete month or MTD).">All windows ({curColLabel} · 30d · 90d)</th>
            <th className="num">Run-rate /mo</th>
            <th className="num">CM3 sign</th>
            <th>Signal</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => {
            const c3 = cm3Of(v.code, v.channel);
            const lossMaker = c3 != null && c3 < 0;
            const fast = v.velocityPerDay != null && v.velocityPerDay >= 5;
            const signal = lossMaker
              ? { text: "Loss-maker — don't reorder blind", color: "var(--critical)" }
              : fast
                ? { text: "Fast-mover — watch stock", color: "var(--warning)" }
                : { text: "Steady", color: "var(--ink-3)" };
            const bw = v.byWindow || {};
            const f2 = (x) => (x != null ? x.toFixed(2) : "—");
            return (
              <tr key={`${v.code}|${v.channel}`}>
                <td>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      {skuShort(v.code)}
                      <span className="badge" style={{ ...pillStyle(v.channel), fontSize: 9 }}>{chMeta(v.channel).short}</span>
                    </span>
                    <span className="sku">{v.code}</span>
                  </div>
                </td>
                <td className="num">{fmtUnits(v.units)}</td>
                <td className="num muted">{v.days}</td>
                <td className="num">
                  {v.velocityPerDay != null ? v.velocityPerDay.toFixed(2) : "—"}
                  {v.velocityPerDay != null && (
                    <VelocityDerivation v={v} month={month} winKey={winKey} />
                  )}
                </td>
                <td className="num muted" style={{ fontSize: 11, fontFamily: "var(--mono)" }}
                  title="One definition (units ÷ days) over three windows. The toggle above picks which drives the row; these reconcile — there is no second 'velocity'.">
                  {f2(bw.mtd?.velocityPerDay)} · {f2(bw.t30?.velocityPerDay)} · {f2(bw.t90?.velocityPerDay)}
                </td>
                <td className="num muted">{v.monthlyRunRate != null ? fmtUnits(v.monthlyRunRate) : "—"}</td>
                <td className="num" style={{ color: cmColor(c3) }}>{c3 == null ? "—" : (c3 < 0 ? "negative" : "positive")}</td>
                <td><span style={{ color: signal.color, fontSize: 11.5 }}>{signal.text}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="card-body" style={{ paddingTop: 10 }}>
        <div className="muted" style={{ fontSize: 11 }}>
          <strong>One velocity definition</strong> — units ÷ days — shown over three windows you can toggle. The
          <strong> current-month</strong> rate ({resolvedCurLabel}) answers "how is this window going" — over a{" "}
          <em>complete</em> month it divides by the full day count, over a <em>live</em> month only the elapsed days,
          so it&apos;s never a partial-month rate dressed up as a full one. The <strong>30-day</strong> rate is the
          reorder-planning rate the <em>inventory module plans at</em>, so the two modules read the same number for the
          same window (rubric 17 — no two conflicting velocities). The inventory module's <em>runway</em> additionally
          folds in central-warehouse depletion and stock-on-hand for the stockout date — read that for the PO timing.
          A <span style={{ color: "var(--critical)" }}>loss-maker</span> with high velocity is the trap: flying off the
          shelf <em>and</em> losing money per unit, so a reflex reorder compounds the loss. A
          <span style={{ color: "var(--warning)" }}> fast-mover</span> (≥5 u/day) is a stockout-risk to cross-check
          against the inventory runway.
        </div>
      </div>
    </div>
  );
}

function VelocityDerivation({ v, month, winKey = "mtd" }) {
  const bw = v.byWindow || {};
  const f2 = (x) => (x != null ? x.toFixed(2) : "—");
  return (
    <DerivationPopover
      title={`Velocity · ${v.code} · ${chMeta(v.channel).name}`}
      formula="units ÷ days, over the selected window (mtd = month units ÷ elapsed days · 30d/90d = trailing-window units ÷ window days)"
      plain="One definition (units ÷ days) computed over three windows from the durable per-SKU fact store. The 30-day window is the SAME rate the inventory module plans reorders at — the two modules never show two different velocity numbers for the same window. The inventory runway additionally folds in central-WH depletion and stock-on-hand for the stockout date."
      inputs={[
        { label: `Units (${winKey})`, value: fmtUnits(v.units) },
        { label: "Window days", value: String(v.days) },
        { label: "MTD rate", value: `${f2(bw.mtd?.velocityPerDay)} /day` },
        { label: "30-day rate (inventory-planning window)", value: `${f2(bw.t30?.velocityPerDay)} /day` },
        { label: "90-day rate", value: `${f2(bw.t90?.velocityPerDay)} /day` },
        { label: "Monthly run-rate", value: v.monthlyRunRate != null ? fmtUnits(v.monthlyRunRate) : "—" },
      ]}
      value={`${v.velocityPerDay != null ? v.velocityPerDay.toFixed(2) : "—"} units/day (${winKey})`}
      source="bizAnalytics.crossModuleVelocity"
      asOf={v.asOf || month}
    />
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 7 · DAILY CHART — multi-channel daily net revenue, line/stack, 7d MA, presets.
// ════════════════════════════════════════════════════════════════════════════
function buildDailySeries(facts) {
  const daily = facts.daily || {};
  const byChannel = {};
  const dateSet = new Set();
  for (const [key, cell] of Object.entries(daily)) {
    const [iso, ch, code] = key.split("|");
    if (code !== CH_CODE) continue;
    if (!iso || !ch) continue;
    const v = dailyNet(cell, ch);
    if (!Number.isFinite(v)) continue;
    byChannel[ch] = byChannel[ch] || {};
    byChannel[ch][iso] = (byChannel[ch][iso] || 0) + v;
    dateSet.add(iso);
  }
  const dates = [...dateSet].sort();
  return { dates, byChannel, channels: Object.keys(byChannel).sort(chOrder) };
}

function DailyChart({ series, channels, range, mode, show7dMA, D }) {
  const { dates, byChannel } = series;
  const present = channels.filter((ch) => byChannel[ch]);

  const windowed = useMemo(() => {
    if (dates.length === 0) return [];
    const last = dates[dates.length - 1];
    if (range === "all") return dates;
    let cutoff;
    if (range === "12m") {
      const dt = new Date(last + "T00:00:00"); dt.setMonth(dt.getMonth() - 12);
      cutoff = dt.toISOString().slice(0, 10);
    } else {
      const days = range === "30d" ? 30 : 90;
      const dt = new Date(last + "T00:00:00"); dt.setDate(dt.getDate() - days);
      cutoff = dt.toISOString().slice(0, 10);
    }
    return dates.filter((d) => d > cutoff);
  }, [dates, range]);

  if (windowed.length === 0) {
    return <div className="muted" style={{ padding: "20px 4px", fontSize: 12.5 }}>No daily revenue in this range.</div>;
  }

  const w = 760, h = 280;
  const pad = { l: 52, r: 14, t: 14, b: 30 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const n = windowed.length;
  const xFor = (i) => pad.l + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);

  const valOf = (ch, iso) => num(byChannel[ch]?.[iso]);
  const stacked = mode === "stack";

  let yMax;
  if (stacked) {
    yMax = Math.max(1, ...windowed.map((iso) => present.reduce((a, ch) => a + valOf(ch, iso), 0)));
  } else {
    yMax = Math.max(1, ...present.flatMap((ch) => windowed.map((iso) => valOf(ch, iso))));
  }
  yMax *= 1.08;
  const yFor = (v) => pad.t + innerH - (Math.max(0, v) / yMax) * innerH;

  const ma7 = (ch) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let j = Math.max(0, i - 6); j <= i; j++) { s += valOf(ch, windowed[j]); c++; }
      out.push(c ? s / c : 0);
    }
    return out;
  };

  const labelStep = Math.max(1, Math.ceil(n / 8));

  const stackBands = () => {
    const cum = new Array(n).fill(0);
    const bands = [];
    for (const ch of present) {
      const top = windowed.map((iso, i) => cum[i] + valOf(ch, iso));
      const bottomPts = windowed.map((iso, i) => [xFor(i), yFor(cum[i])]);
      const topPts = windowed.map((iso, i) => [xFor(i), yFor(top[i])]);
      let d = "M" + topPts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" L");
      for (let i = bottomPts.length - 1; i >= 0; i--) d += ` L${bottomPts[i][0].toFixed(1)},${bottomPts[i][1].toFixed(1)}`;
      d += " Z";
      bands.push({ ch, d });
      for (let i = 0; i < n; i++) cum[i] = top[i];
    }
    return bands;
  };

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
        {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
          <g key={i}>
            <line x1={pad.l} y1={pad.t + innerH * t} x2={w - pad.r} y2={pad.t + innerH * t} stroke="var(--border-soft)" />
            <text x={pad.l - 6} y={pad.t + innerH * t + 3} fontSize="9" textAnchor="end" fill="var(--ink-3)" fontFamily="var(--mono)">
              {D.fmtINR(yMax * (1 - t)).replace("₹", "")}
            </text>
          </g>
        ))}

        {stacked
          ? stackBands().map((b) => (
              <path key={b.ch} d={b.d} fill={chMeta(b.ch).color} opacity="0.55" stroke={chMeta(b.ch).color} strokeWidth="0.6" />
            ))
          : present.map((ch) => {
              const pts = windowed.map((iso, i) => [xFor(i), yFor(valOf(ch, iso))]);
              const line = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
              const maPts = show7dMA ? ma7(ch).map((v, i) => [xFor(i), yFor(v)]) : null;
              const maLine = maPts ? maPts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ") : null;
              return (
                <g key={ch}>
                  <path d={line} fill="none" stroke={chMeta(ch).color} strokeWidth={show7dMA ? 0.8 : 1.4}
                        opacity={show7dMA ? 0.32 : 0.95} strokeLinejoin="round" strokeLinecap="round" />
                  {maLine && <path d={maLine} fill="none" stroke={chMeta(ch).color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />}
                </g>
              );
            })}

        {windowed.map((iso, i) =>
          i % labelStep === 0 || i === n - 1 ? (
            <text key={iso} x={xFor(i)} y={h - 8} fontSize="8.5" textAnchor="middle" fill="var(--ink-3)" fontFamily="var(--mono)">
              {fmtDay(iso)}
            </text>
          ) : null
        )}
      </svg>

      <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: "8px 18px" }}>
        {present.map((ch) => {
          const total = windowed.reduce((a, iso) => a + valOf(ch, iso), 0);
          const chDays = Object.keys(byChannel[ch] || {});
          const firstDay = chDays.length ? chDays.sort()[0] : null;
          return (
            <div key={ch} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <span style={{ width: 11, height: 11, borderRadius: 2, background: chMeta(ch).color, display: "inline-block" }} />
              <span>{chMeta(ch).name}</span>
              <span className="mono muted" style={{ fontSize: 11 }}>{D.fmtINR(total)} in range</span>
              {firstDay && <span className="muted" style={{ fontSize: 10 }}>· since {fmtDay(firstDay)}</span>}
            </div>
          );
        })}
        <div style={{ marginLeft: "auto", fontSize: 11 }} className="muted">
          {fmtDay(windowed[0])} → {fmtDay(windowed[n - 1])} · {n} days
          {mode === "line" && show7dMA && " · bold = 7-day average"}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 8 · MoM TABLE — net rev per channel per month + like-for-like growth chips.
// ════════════════════════════════════════════════════════════════════════════
function MoMTable({ headline, monthsMeta, facts, channels }) {
  const { months, table } = headline;
  const present = channels.filter((ch) => headline.channels.includes(ch));
  const metaByMonth = Object.fromEntries(monthsMeta.map((m) => [m.month, m]));

  const dailySeries = useMemo(() => buildDailySeries(facts), [facts]);

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="table">
        <thead>
          <tr>
            <th>Month</th>
            {present.map((ch) => (
              <th key={ch} className="num">
                <span className="badge" style={{ ...pillStyle(ch), fontSize: 9 }}>{chMeta(ch).short}</span>
              </th>
            ))}
            <th className="num">Total</th>
            <th className="num">MoM total</th>
          </tr>
        </thead>
        <tbody>
          {table.map((row, ri) => {
            const meta = metaByMonth[row.month];
            const partial = row.partial;
            const total = present.reduce((a, ch) => a + num(row[ch]), 0);
            const gapMonths = ri > 0 ? missingMonthsBetween(table[ri - 1].month, row.month) : [];
            const gapRow = gapMonths.length > 0 ? (
              <tr key={`gap-${row.month}`} style={{ opacity: 0.6 }}>
                <td colSpan={present.length + 3} style={{ fontSize: 10.5, fontStyle: "italic", color: "var(--ink-3)", padding: "4px 14px", background: "var(--bg-sunken)" }}>
                  {gapMonths.map((g) => fmtMonth(g)).join(", ")}: no recorded sales in source (zero-activity {gapMonths.length > 1 ? "months" : "month"} — omitted, not dropped)
                </td>
              </tr>
            ) : null;
            let momTotal = null, momBase = null;
            if (!partial) {
              for (let k = ri - 1; k >= 0; k--) {
                if (table[k].partial) continue;
                const prevTotal = present.reduce((a, ch) => a + num(table[k][ch]), 0);
                if (prevTotal > 0) { momTotal = ((total - prevTotal) / prevTotal) * 100; momBase = prevTotal; }
                break;
              }
            }
            // Thin-base honesty (rubric II/18): a +900% MoM off ₹2k is not a trend.
            // Floor is generous (₹50k) for a COMPANY-level monthly total — a real
            // base below that is the 0→1 ramp, where a bare % misleads.
            const thin = momTotal != null && momBase != null && smallSampleFlag(total, momBase, { floor: 50000 });
            return (
              <Fragment key={row.month}>
              {gapRow}
              <tr style={partial ? { opacity: 0.78 } : undefined}>
                <td>
                  <span style={{ marginRight: 6 }}>{fmtMonth(row.month)}</span>
                  <MonthBadge meta={meta} />
                </td>
                {present.map((ch) => {
                  const v = row[ch];
                  const basis = meta?.channels?.[ch]?.sales;
                  return (
                    <td key={ch} className="num" title={basis ? `source: ${basis}` : "no coverage"}>
                      {v == null ? <span className="muted">—</span> : fmtRupees(v)}
                    </td>
                  );
                })}
                <td className="num" style={{ fontWeight: 600 }}>{fmtRupees(total)}</td>
                <td className="num">
                  {partial ? (
                    (() => {
                      const dom = meta?.lastDay ? parseInt(meta.lastDay.split("-")[2], 10) : null;
                      const lf = dom ? lflTotal(dailySeries, present, row.month, months[ri - 1], dom) : null;
                      return lf == null ? (
                        <span className="muted" title="partial month — no like-for-like base">MTD</span>
                      ) : (
                        <span title={`Like-for-like vs ${fmtMonthShort(months[ri - 1])} 1–${dom}`}>
                          <Delta value={lf} />
                          <span className="muted" style={{ fontSize: 9, marginLeft: 3 }}>LfL</span>
                        </span>
                      );
                    })()
                  ) : thin && thin.thin ? (
                    <span title={`Thin base — ${fmtMonthShort(momBaseMonth(table, ri))} was only ${fmtRupees(momBase)}; a % off so small a base is noise, not a trend (the 0→1 ramp).`}>
                      <Delta value={momTotal} />
                      <span className="cov-badge cov-mtd sm" style={{ marginLeft: 4 }}>thin base {fmtRupees(momBase)}</span>
                    </span>
                  ) : (
                    <Delta value={momTotal} />
                  )}
                </td>
              </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <div className="card-body" style={{ paddingTop: 10 }}>
        <div className="muted" style={{ fontSize: 11 }}>
          MoM = full-month vs prior full month. The current partial month shows a <strong>like-for-like (LfL)</strong>
          {" "}delta — its day-1-to-today revenue against the same window of the previous month — never a misleading
          full-vs-partial drop. A <span className="cov-badge cov-mtd sm">thin base ₹X</span> tag means the prior
          month&apos;s revenue was below ₹50k — the early 0→1 ramp — so the % is annotated as noise, not a trend
          (rubric II/18). <span className="cov-badge cov-native sm">nat</span> = native per-SKU revenue,
          {" "}<span className="cov-badge cov-agency sm">agc</span> = agency channel-grain.
        </div>
      </div>
    </div>
  );
}

// The prior FULL month that fed a row's MoM (for the thin-base annotation tooltip).
function momBaseMonth(table, ri) {
  for (let k = ri - 1; k >= 0; k--) { if (!table[k].partial) return table[k].month; }
  return null;
}

function sumChannelMonthToDay(series, ch, month, dom) {
  const map = series.byChannel?.[ch];
  if (!map) return 0;
  let s = 0;
  for (const [iso, v] of Object.entries(map)) {
    if (iso.slice(0, 7) !== month) continue;
    if (parseInt(iso.split("-")[2], 10) > dom) continue;
    s += num(v);
  }
  return s;
}
function lflTotal(series, chans, month, prevMonth, dom) {
  if (!prevMonth) return null;
  let cur = 0, prev = 0;
  for (const ch of chans) {
    cur += sumChannelMonthToDay(series, ch, month, dom);
    prev += sumChannelMonthToDay(series, ch, prevMonth, dom);
  }
  if (prev <= 0) return null;
  return ((cur - prev) / prev) * 100;
}

// ════════════════════════════════════════════════════════════════════════════
// 5 · CHANNEL MIX — stacked area / share over months.
// ════════════════════════════════════════════════════════════════════════════
function ChannelMixArea({ headline, channels, metric, monthsMeta, D }) {
  const { months, table } = headline;
  const present = channels.filter((ch) => headline.channels.includes(ch));
  const metaByMonth = Object.fromEntries(monthsMeta.map((m) => [m.month, m]));
  const n = months.length;
  if (n === 0) return <div className="muted" style={{ fontSize: 12.5 }}>No multi-month history yet.</div>;

  const share = metric === "share";
  const w = 760, h = 240;
  const pad = { l: 48, r: 14, t: 12, b: 28 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const xFor = (i) => pad.l + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);

  const rawTotal = (i) => present.reduce((a, ch) => a + num(table[i][ch]), 0);
  const valOf = (ch, i) => {
    const v = num(table[i][ch]);
    if (!share) return v;
    const t = rawTotal(i);
    return t > 0 ? (v / t) * 100 : 0;
  };
  const yMax = share ? 100 : Math.max(1, ...months.map((_, i) => rawTotal(i))) * 1.04;
  const yFor = (v) => pad.t + innerH - (Math.max(0, v) / yMax) * innerH;

  const cum = new Array(n).fill(0);
  const bands = [];
  for (const ch of present) {
    const top = months.map((_, i) => cum[i] + valOf(ch, i));
    const topPts = months.map((_, i) => [xFor(i), yFor(top[i])]);
    const botPts = months.map((_, i) => [xFor(i), yFor(cum[i])]);
    let d = "M" + topPts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" L");
    for (let i = botPts.length - 1; i >= 0; i--) d += ` L${botPts[i][0].toFixed(1)},${botPts[i][1].toFixed(1)}`;
    d += " Z";
    bands.push({ ch, d });
    for (let i = 0; i < n; i++) cum[i] = top[i];
  }

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
        {[0, 0.5, 1].map((t, i) => (
          <g key={i}>
            <line x1={pad.l} y1={pad.t + innerH * t} x2={w - pad.r} y2={pad.t + innerH * t} stroke="var(--border-soft)" />
            <text x={pad.l - 6} y={pad.t + innerH * t + 3} fontSize="9" textAnchor="end" fill="var(--ink-3)" fontFamily="var(--mono)">
              {share ? `${Math.round(yMax * (1 - t))}%` : D.fmtINR(yMax * (1 - t)).replace("₹", "")}
            </text>
          </g>
        ))}
        {bands.map((b) => (
          <path key={b.ch} d={b.d} fill={chMeta(b.ch).color} opacity="0.62" stroke="var(--bg-card)" strokeWidth="0.5" />
        ))}
        {months.map((m, i) =>
          i % (n > 9 ? 2 : 1) === 0 || i === n - 1 ? (
            <text key={m} x={xFor(i)} y={h - 8} fontSize="8.5" textAnchor="middle" fill="var(--ink-3)" fontFamily="var(--mono)">
              {fmtMonthShort(m)}{metaByMonth[m]?.partial ? "*" : ""}
            </text>
          ) : null
        )}
      </svg>
      <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
        {present.map((ch) => (
          <div key={ch} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <span style={{ width: 11, height: 11, borderRadius: 2, background: chMeta(ch).color, display: "inline-block" }} />
            <span>{chMeta(ch).name}</span>
          </div>
        ))}
        <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>* partial (MTD) month</span>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 10 · AOV TREND — net rev ÷ units per channel per month.
// ════════════════════════════════════════════════════════════════════════════
function AovTrend({ facts, monthsMeta, channels, D }) {
  const data = useMemo(() => {
    const months = monthsMeta.map((m) => m.month);
    const byChannel = {};
    for (const mm of monthsMeta) {
      for (const ch of Object.keys(mm.channels)) {
        const r = computeMonthChannelCM({ facts, month: mm.month, channel: ch });
        if (r.coverage === "none" || !r.units) continue;
        byChannel[ch] = byChannel[ch] || {};
        byChannel[ch][mm.month] = r.netRev / r.units;
      }
    }
    return { months, byChannel };
  }, [facts, monthsMeta]);

  const present = channels.filter((ch) => data.byChannel[ch] && Object.keys(data.byChannel[ch]).length >= 2);
  const months = data.months;
  const n = months.length;
  if (present.length === 0) return <div className="muted" style={{ fontSize: 12.5 }}>Not enough months for an AOV trend.</div>;

  const w = 760, h = 200;
  const pad = { l: 50, r: 14, t: 12, b: 26 };
  const innerW = w - pad.l - pad.r, innerH = h - pad.t - pad.b;
  const xFor = (i) => pad.l + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yMax = Math.max(1, ...present.flatMap((ch) => Object.values(data.byChannel[ch]))) * 1.1;
  const yFor = (v) => pad.t + innerH - (Math.max(0, v) / yMax) * innerH;

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
        {[0, 0.5, 1].map((t, i) => (
          <g key={i}>
            <line x1={pad.l} y1={pad.t + innerH * t} x2={w - pad.r} y2={pad.t + innerH * t} stroke="var(--border-soft)" />
            <text x={pad.l - 6} y={pad.t + innerH * t + 3} fontSize="9" textAnchor="end" fill="var(--ink-3)" fontFamily="var(--mono)">
              {D.fmtINR(yMax * (1 - t)).replace("₹", "")}
            </text>
          </g>
        ))}
        {present.map((ch) => {
          const pts = months.map((m, i) => (data.byChannel[ch][m] != null ? [xFor(i), yFor(data.byChannel[ch][m])] : null));
          let d = "", started = false;
          pts.forEach((p) => {
            if (!p) { started = false; return; }
            d += (started ? " L" : " M") + p[0].toFixed(1) + "," + p[1].toFixed(1);
            started = true;
          });
          return (
            <g key={ch}>
              <path d={d.trim()} fill="none" stroke={chMeta(ch).color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
              {pts.map((p, i) => (p ? <circle key={i} cx={p[0]} cy={p[1]} r="2" fill={chMeta(ch).color} /> : null))}
            </g>
          );
        })}
        {months.map((m, i) =>
          i % (n > 9 ? 2 : 1) === 0 || i === n - 1 ? (
            <text key={m} x={xFor(i)} y={h - 8} fontSize="8.5" textAnchor="middle" fill="var(--ink-3)" fontFamily="var(--mono)">
              {fmtMonthShort(m)}
            </text>
          ) : null
        )}
      </svg>
      <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
        {present.map((ch) => {
          const vals = months.map((m) => data.byChannel[ch][m]).filter((v) => v != null);
          const latest = vals[vals.length - 1];
          return (
            <div key={ch} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <span style={{ width: 11, height: 11, borderRadius: 2, background: chMeta(ch).color, display: "inline-block" }} />
              <span>{chMeta(ch).name}</span>
              <span className="mono muted" style={{ fontSize: 11 }}>now {fmtRupees(latest)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Price realization strip (native month): banked-per-unit vs gross leakage.
function PriceRealizationStrip({ facts, month }) {
  const rows = useMemo(() => priceRealization(facts, { month }), [facts, month]);
  if (rows.length === 0) return null;
  const top = rows.slice(0, 8);
  return (
    <div style={{ marginTop: 16, borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <span className="stat-label">Price realization · {fmtMonth(month)} (native per-SKU)</span>
        <DerivationPopover
          title="Price realization"
          formula="realized net = netRev ÷ units · leakage = (gross − net) ÷ gross"
          plain="The price actually banked per unit (after GST and returns) vs the gross. Leakage is how much of gross never reaches net — GST plus returns. Native per-SKU cells only."
          source="bizAnalytics.priceRealization"
          asOf={month}
        />
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>SKU · channel</th>
              <th className="num">Units</th>
              <th className="num">Realized net /u</th>
              <th className="num">Realized gross /u</th>
              <th className="num">Leakage</th>
            </tr>
          </thead>
          <tbody>
            {top.map((r) => (
              <tr key={`${r.code}|${r.channel}`}>
                <td>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    {skuShort(r.code)}
                    <span className="badge" style={{ ...pillStyle(r.channel), fontSize: 9 }}>{chMeta(r.channel).short}</span>
                  </span>
                </td>
                <td className="num">{fmtUnits(r.units)}</td>
                <td className="num">{r.realizedNet != null ? fmtRupees(r.realizedNet) : "—"}</td>
                <td className="num muted">{r.realizedGross != null ? fmtRupees(r.realizedGross) : "—"}</td>
                <td className="num" style={{ color: r.leakagePct != null && r.leakagePct > 0.12 ? "var(--warning)" : "var(--ink-3)" }}>
                  {r.leakagePct != null ? pct1(r.leakagePct) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 11 · SEASONALITY — weekday + month-of-year structure (company).
// ════════════════════════════════════════════════════════════════════════════
function SeasonalityPanel({ facts, D }) {
  const seas = useMemo(() => seasonalityBaselines(facts, {}), [facts]);
  const wd = seas.weekday;
  const max = Math.max(1, ...wd.mean);
  const w = 760, h = 150;
  const pad = { l: 50, r: 14, t: 10, b: 24 };
  const innerW = w - pad.l - pad.r, innerH = h - pad.t - pad.b;
  const bw = innerW / 7;

  return (
    <div>
      <div className="stat-label" style={{ marginBottom: 8 }}>Average daily net revenue by weekday</div>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
        {[0, 0.5, 1].map((t, i) => (
          <g key={i}>
            <line x1={pad.l} y1={pad.t + innerH * t} x2={w - pad.r} y2={pad.t + innerH * t} stroke="var(--border-soft)" />
            <text x={pad.l - 6} y={pad.t + innerH * t + 3} fontSize="9" textAnchor="end" fill="var(--ink-3)" fontFamily="var(--mono)">
              {D.fmtINR(max * (1 - t)).replace("₹", "")}
            </text>
          </g>
        ))}
        {/* overall-mean reference */}
        <line x1={pad.l} y1={pad.t + innerH - (seas.overallMean / max) * innerH} x2={w - pad.r}
              y2={pad.t + innerH - (seas.overallMean / max) * innerH} stroke="var(--ink-3)" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.7" />
        {wd.mean.map((v, i) => {
          const bh = (v / max) * innerH;
          const x = pad.l + i * bw + bw * 0.16;
          const idx = wd.index[i];
          const low = idx != null && idx < 0.85;
          return (
            <g key={i}>
              <rect x={x} y={pad.t + innerH - bh} width={bw * 0.68} height={Math.max(0, bh)}
                    fill={low ? "var(--ink-3)" : "var(--brand)"} opacity="0.85" rx="2">
                <title>{`${WEEKDAYS[i]}: ${D.fmtINR(v)}/day avg (index ${idx != null ? idx.toFixed(2) : "—"}× vs overall)`}</title>
              </rect>
              <text x={x + bw * 0.34} y={h - 6} fontSize="9" textAnchor="middle" fill="var(--ink-3)" fontFamily="var(--mono)">{WEEKDAYS[i]}</text>
            </g>
          );
        })}
      </svg>
      <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
        Dashed line = overall daily average ({D.fmtINR(seas.overallMean)}/day across {seas.totalDays} days). The index
        under each bar (in the tooltip) is that weekday ÷ overall — the daily flag divides by this so a structurally-low
        day isn&apos;t flagged red against a peak. Greyed bars run more than 15% below the overall average.
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 9 · PER-SKU UNITS HISTORY — table + drill.
// ════════════════════════════════════════════════════════════════════════════
function buildSkuUnitsHistory(facts) {
  const sm = snellSkuUnitsMap(facts);
  const bySku = {};
  const monthSet = new Set();
  for (const [key, u] of Object.entries(sm)) {
    const [m, ch, code] = key.split("|");
    if (!m || !ch || !code) continue;
    monthSet.add(m);
    const s = (bySku[code] = bySku[code] || { months: {}, byChannel: {}, channels: new Set(), total: 0 });
    s.months[m] = (s.months[m] || 0) + num(u);
    s.byChannel[ch] = s.byChannel[ch] || {};
    s.byChannel[ch][m] = (s.byChannel[ch][m] || 0) + num(u);
    s.channels.add(ch);
    s.total += num(u);
  }
  return { bySku, monthList: [...monthSet].sort() };
}

function SkuHistoryTable({ skuUnitsHistory, onDrill }) {
  const { bySku, monthList } = skuUnitsHistory;
  const codes = Object.keys(bySku).sort((a, b) => bySku[b].total - bySku[a].total);
  if (codes.length === 0) {
    return <div className="card-body"><div className="muted" style={{ fontSize: 12.5 }}>No per-SKU unit history in the current data (Snell Categorywise not loaded).</div></div>;
  }
  const last = monthList[monthList.length - 1];
  const prevFull = monthList[monthList.length - 2];

  return (
    <table className="table">
      <thead>
        <tr>
          <th>SKU</th>
          <th>Channels</th>
          <th className="num">Total units</th>
          <th className="num">{fmtMonthShort(prevFull)} u</th>
          <th className="num">{fmtMonthShort(last)} u</th>
          <th>Trend</th>
          <th className="num">Months</th>
        </tr>
      </thead>
      <tbody>
        {codes.map((code) => {
          const s = bySku[code];
          const sortedMonths = Object.keys(s.months).sort();
          const seriesVals = sortedMonths.map((m) => s.months[m]);
          const lastU = s.months[last] || 0;
          const prevU = s.months[prevFull] || 0;
          return (
            <tr key={code} className="row-clickable" style={{ cursor: "pointer" }} onClick={() => onDrill(code)}>
              <td>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span>{skuShort(code)} <span className="muted" style={{ fontSize: 11 }}>{skuVariant(code)}</span></span>
                  <span className="sku">{code}</span>
                </div>
              </td>
              <td>
                {[...s.channels].sort(chOrder).map((ch) => (
                  <span key={ch} className="badge" style={{ ...pillStyle(ch), fontSize: 9, marginRight: 3 }}>{chMeta(ch).short}</span>
                ))}
              </td>
              <td className="num">{fmtUnits(s.total)}</td>
              <td className="num">{prevU ? fmtUnits(prevU) : <span className="muted">—</span>}</td>
              <td className="num">{lastU ? fmtUnits(lastU) : <span className="muted">—</span>}</td>
              <td><MiniSpark data={seriesVals} /></td>
              <td className="num muted">{sortedMonths.length}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── SKU drill modal: monthly units bars (per channel stacked) + weekday pattern.
function SkuDrillModal({ code, history, facts, onClose, D }) {
  const sortedMonths = history ? Object.keys(history.months).sort() : [];
  const chans = history ? [...history.channels].sort(chOrder) : [];
  const maxMonth = Math.max(1, ...sortedMonths.map((m) => history.months[m]));

  const primaryCh = chans
    .map((ch) => ({ ch, u: Object.values(history.byChannel[ch] || {}).reduce((a, v) => a + num(v), 0) }))
    .sort((a, b) => b.u - a.u)[0]?.ch;
  const weekday = useMemo(() => buildWeekdayPattern(facts, primaryCh), [facts, primaryCh]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal-card" onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(720px, 94vw)" }}>
        <div className="modal-head">
          <div>
            <div className="modal-title">{skuShort(code)} · {skuVariant(code)}</div>
            <div className="modal-sub sku">{code} · {chans.map((c) => chMeta(c).name).join(" · ")} · {sortedMonths.length} months of units</div>
          </div>
          <button className="btn ghost icon" onClick={onClose} title="Close (Esc)">✕</button>
        </div>
        <div className="modal-body">
          <div>
            <div className="stat-label" style={{ marginBottom: 8 }}>Monthly units · stacked by channel</div>
            <SkuMonthlyBars history={history} months={sortedMonths} chans={chans} maxMonth={maxMonth} />
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
              {chans.map((ch) => (
                <span key={ch} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: chMeta(ch).color }} />
                  {chMeta(ch).name}
                  <span className="mono muted">{fmtUnits(Object.values(history.byChannel[ch] || {}).reduce((a, v) => a + num(v), 0))}u</span>
                </span>
              ))}
            </div>
          </div>

          {chans.length > 1 && (
            <div>
              <div className="stat-label" style={{ marginBottom: 8 }}>
                Per-channel monthly units · where this SKU wins
              </div>
              <SkuChannelMix history={history} months={sortedMonths} chans={chans} />
              <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                Each panel is this SKU&apos;s monthly units on one channel, on its own scale —
                the arrow reads the latest full-month move vs the prior month. Source: Snell Categorywise
                (agency, monthly grain).
              </div>
            </div>
          )}

          <div>
            <div className="stat-label" style={{ marginBottom: 8 }}>
              Weekday revenue pattern · {chMeta(primaryCh).name} channel
            </div>
            <WeekdayBars weekday={weekday} color={chMeta(primaryCh).color} D={D} />
            <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
              The agency feed carries per-SKU units at monthly grain only, so the weekday shape is shown from
              {" "}{chMeta(primaryCh).name}&apos;s daily channel revenue (this SKU&apos;s primary channel) — a directional
              read of which days convert, not a SKU-level split.
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <span className="muted" style={{ fontSize: 11.5 }}>
            Units from Snell Categorywise (agency, multipacks folded). Revenue grain available natively for the latest full month.
          </span>
          <button className="btn sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function SkuMonthlyBars({ history, months, chans, maxMonth }) {
  const w = 660, h = 150;
  const pad = { l: 36, r: 8, t: 8, b: 22 };
  const innerW = w - pad.l - pad.r, innerH = h - pad.t - pad.b;
  const bw = innerW / Math.max(1, months.length);
  const yFor = (v) => pad.t + innerH - (v / maxMonth) * innerH;
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      {[0, 0.5, 1].map((t, i) => (
        <g key={i}>
          <line x1={pad.l} y1={pad.t + innerH * t} x2={w - pad.r} y2={pad.t + innerH * t} stroke="var(--border-soft)" />
          <text x={pad.l - 5} y={pad.t + innerH * t + 3} fontSize="8.5" textAnchor="end" fill="var(--ink-3)" fontFamily="var(--mono)">
            {Math.round(maxMonth * (1 - t))}
          </text>
        </g>
      ))}
      {months.map((m, i) => {
        let cum = 0;
        const x = pad.l + i * bw + bw * 0.16;
        const bWidth = bw * 0.68;
        return (
          <g key={m}>
            {chans.map((ch) => {
              const u = num(history.byChannel[ch]?.[m]);
              if (!u) return null;
              const y0 = yFor(cum);
              const y1 = yFor(cum + u);
              cum += u;
              return <rect key={ch} x={x} y={y1} width={bWidth} height={Math.max(0, y0 - y1)} fill={chMeta(ch).color} opacity="0.9" />;
            })}
            {(i % (months.length > 10 ? 2 : 1) === 0 || i === months.length - 1) && (
              <text x={x + bWidth / 2} y={h - 7} fontSize="8" textAnchor="middle" fill="var(--ink-3)" fontFamily="var(--mono)">
                {fmtMonthShort(m)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function SkuChannelMix({ history, months, chans }) {
  const ranked = [...chans]
    .map((ch) => ({ ch, total: Object.values(history.byChannel[ch] || {}).reduce((a, v) => a + num(v), 0) }))
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total);
  if (ranked.length === 0) return null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(ranked.length, 2)}, minmax(0,1fr))`, gap: 10 }}>
      {ranked.map(({ ch, total }) => {
        const map = history.byChannel[ch] || {};
        const present = months.filter((m) => num(map[m]) > 0);
        const lastM = present[present.length - 1];
        const prevM = present[present.length - 2];
        const mom = lastM && prevM && num(map[prevM]) > 0
          ? ((num(map[lastM]) - num(map[prevM])) / num(map[prevM])) * 100
          : null;
        const meta = chMeta(ch);
        const max = Math.max(1, ...months.map((m) => num(map[m])));
        const w = 320, h = 96;
        const pad = { l: 4, r: 4, t: 6, b: 14 };
        const innerW = w - pad.l - pad.r, innerH = h - pad.t - pad.b;
        const bw = innerW / Math.max(1, months.length);
        return (
          <div key={ch} style={{ border: "1px solid var(--border-soft)", borderRadius: 8, padding: "8px 10px", background: "var(--bg-sunken)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="badge" style={{ ...pillStyle(ch), fontSize: 9 }}>{meta.short}</span>
                <span style={{ fontSize: 12, fontWeight: 500 }}>{meta.name}</span>
                <span className="mono muted" style={{ fontSize: 10.5 }}>{fmtUnits(total)}u total</span>
              </span>
              {mom != null
                ? <Delta value={mom} suffix="MoM" />
                : <span className="muted" style={{ fontSize: 10 }}>—</span>}
            </div>
            <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
              <line x1={pad.l} y1={pad.t + innerH} x2={w - pad.r} y2={pad.t + innerH} stroke="var(--border-soft)" />
              {months.map((m, i) => {
                const u = num(map[m]);
                const bh = (u / max) * innerH;
                const x = pad.l + i * bw + bw * 0.16;
                const isLast = m === lastM;
                return (
                  <g key={m}>
                    {u > 0 && (
                      <rect x={x} y={pad.t + innerH - bh} width={bw * 0.68} height={Math.max(0, bh)}
                            fill={meta.color} opacity={isLast ? 0.95 : 0.55} rx="1.5">
                        <title>{`${fmtMonth(m)}: ${fmtUnits(u)} units`}</title>
                      </rect>
                    )}
                    {(i % (months.length > 8 ? 3 : 2) === 0 || i === months.length - 1) && (
                      <text x={x + bw * 0.34} y={h - 4} fontSize="7.5" textAnchor="middle" fill="var(--ink-3)" fontFamily="var(--mono)">
                        {fmtMonthShort(m)}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        );
      })}
    </div>
  );
}

function buildWeekdayPattern(facts, ch) {
  const sums = [0, 0, 0, 0, 0, 0, 0];
  const counts = [0, 0, 0, 0, 0, 0, 0];
  if (!ch) return sums.map(() => 0);
  for (const [key, cell] of Object.entries(facts.daily || {})) {
    const [iso, c, code] = key.split("|");
    if (code !== CH_CODE || c !== ch) continue;
    const day = new Date(iso + "T00:00:00").getDay();
    if (Number.isNaN(day)) continue;
    sums[day] += dailyNet(cell, ch);
    counts[day]++;
  }
  return sums.map((s, i) => (counts[i] ? s / counts[i] : 0));
}

function WeekdayBars({ weekday, color, D }) {
  const max = Math.max(1, ...weekday);
  const w = 660, h = 120;
  const pad = { l: 36, r: 8, t: 8, b: 20 };
  const innerW = w - pad.l - pad.r, innerH = h - pad.t - pad.b;
  const bw = innerW / 7;
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      {weekday.map((v, i) => {
        const bh = (v / max) * innerH;
        const x = pad.l + i * bw + bw * 0.16;
        return (
          <g key={i}>
            <rect x={x} y={pad.t + innerH - bh} width={bw * 0.68} height={bh} fill={color} opacity="0.85" rx="2" />
            <text x={x + bw * 0.34} y={h - 6} fontSize="9" textAnchor="middle" fill="var(--ink-3)" fontFamily="var(--mono)">{WEEKDAYS[i]}</text>
            <title>{`${WEEKDAYS[i]}: ${D.fmtINR(v)}/day avg`}</title>
          </g>
        );
      })}
    </svg>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 12a · per-SKU revenue breakdown (native) — with anomaly callouts.
// ════════════════════════════════════════════════════════════════════════════
function MaySkuBreakdown({ facts, month, channels }) {
  const cm = useMemo(() => computeCM({ facts, month, costs: undefined }), [facts, month]);
  const skuIdentity = facts?.meta?.skuIdentity || {};
  const nativeChannels = channels.filter((ch) => cm.byChannel?.[ch]);
  const [chTab, setChTab] = useState(nativeChannels[0] || "amazon");
  const active = cm.byChannel?.[chTab] ? chTab : nativeChannels[0];
  const [sort, setSort] = useState("netRev");

  // Channel daily-revenue anomalies for the active channel (callout).
  const anomalies = useMemo(() => channelAnomalies(facts, { channel: active }), [facts, active]);
  const recentAnoms = anomalies.slice(-3);

  const rows = [];
  for (const code of Object.keys(cm.bySku || {})) {
    const cell = cm.bySku[code]?.byChannel?.[active];
    if (!cell || (!cell.netRev && !cell.units)) continue;
    rows.push({ code, ...cell, cm3Pct: cell.pcts?.cm3 ?? null });
  }
  rows.sort((a, b) => {
    if (sort === "netRev") return b.netRev - a.netRev;
    if (sort === "units") return b.units - a.units;
    if (sort === "cm3") return (b.cm3 ?? -Infinity) - (a.cm3 ?? -Infinity);
    return 0;
  });
  const chTotal = cm.byChannel[active]?.netRev || 0;

  return (
    <div>
      <div className="card-body" style={{ paddingBottom: 8, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "space-between", alignItems: "center" }}>
        <div className="seg">
          {nativeChannels.map((ch) => (
            <button key={ch} className={active === ch ? "active" : ""} onClick={() => setChTab(ch)}>{chMeta(ch).short}</button>
          ))}
        </div>
        <div className="seg">
          <button className={sort === "netRev" ? "active" : ""} onClick={() => setSort("netRev")}>Revenue</button>
          <button className={sort === "units" ? "active" : ""} onClick={() => setSort("units")}>Units</button>
          <button className={sort === "cm3" ? "active" : ""} onClick={() => setSort("cm3")}>CM3</button>
        </div>
      </div>
      {recentAnoms.length > 0 && (
        <div className="card-body" style={{ paddingTop: 0, paddingBottom: 8, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 11 }}>Recent {chMeta(active).name} daily anomalies:</span>
          {recentAnoms.map((a) => (
            <span key={a.iso} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <AnomalyBadge anomaly={a} text={fmtDay(a.iso)} />
            </span>
          ))}
        </div>
      )}
      {rows.length === 0 ? (
        <div className="muted" style={{ padding: "18px 16px", fontSize: 12.5 }}>No native SKU sales for {chMeta(active).name} in {fmtMonth(month)}.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>SKU</th>
              <th className="num">Net rev</th>
              <th className="num">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3, justifyContent: "flex-end" }}>
                  Units
                  {active === "amazon" && <UnitsRulePopover facts={facts} asOf={month} />}
                </span>
              </th>
              <th className="num">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3, justifyContent: "flex-end" }}>
                  AOV
                  {active === "amazon" && <UnitsRulePopover facts={facts} asOf={month} />}
                </span>
              </th>
              <th className="num">Rev share</th>
              <th className="num">CM3</th>
              <th className="num">CM3 %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const aov = r.units ? r.netRev / r.units : null;
              const share = chTotal ? (r.netRev / chTotal) * 100 : 0;
              return (
                <tr key={r.code}>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span>{skuShort(r.code)} <span className="muted" style={{ fontSize: 11 }}>{skuVariant(r.code)}</span><SkuSimilarityBadge code={r.code} identity={skuIdentity} /></span>
                      <span className="sku">{r.code}</span>
                    </div>
                  </td>
                  <td className="num">{fmtRupees(r.netRev)}</td>
                  <td className="num">{fmtUnits(r.units)}</td>
                  <td className="num">{aov != null ? fmtRupees(aov) : "—"}</td>
                  <td className="num">{share.toFixed(1)}%</td>
                  <td className="num" style={{ color: cmColor(r.cm3) }}>
                    {r.cm3 == null ? "—" : fmtRupees(r.cm3)}
                    {r.cm3 != null && (
                      <Cm3Derivation r={r} channel={active} month={month} />
                    )}
                  </td>
                  <td className="num">
                    {r.cm3 == null ? (
                      <span className="muted" title="COGS not on file for this SKU">—</span>
                    ) : (
                      <span style={{ color: r.cm3Pct < 0 ? "var(--critical)" : r.cm3Pct < 0.05 ? "var(--warning)" : "var(--ink)" }}>
                        {pctStr(r.cm3Pct)}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="card-body" style={{ paddingTop: 10 }}>
        <div className="muted" style={{ fontSize: 11 }}>
          Native per-SKU revenue from {chMeta(active).name}&apos;s own export. CM3 = net revenue − COGS − platform fees −
          attributed/allocated ads. A dash in CM3 means no COGS card on file for that SKU.
          {active === "amazon" && (
            <> Per-SKU <strong>units and revenue share one filtered row set</strong> (Amazon.in · Shipped · returns-netted ·
            bucketed by purchase-month), so <strong>AOV = net ÷ units re-derives from the All-Orders file</strong> — the ⓘ on the
            Units/AOV headers carries the exact rule (a unit purchased in April but shipped in May counts to April, not May).</>
          )}{" "}A{" "}
          <span className="badge" style={{ background: "rgba(201,162,39,0.16)", color: "#9A7B16", borderColor: "rgba(201,162,39,0.4)", fontSize: 8.5, fontWeight: 700 }}>≈ similarity</span>{" "}
          badge marks a SKU whose Google ad spend was attributed from a free-text product title by similarity (not an exact identifier) — sales/units still resolve by exact maps.
        </div>
      </div>
    </div>
  );
}

function Cm3Derivation({ r, channel, month }) {
  return (
    <DerivationPopover
      title={`CM3 · ${r.code} · ${chMeta(channel).name} · ${fmtMonthShort(month)}`}
      formula="CM3 = netRev − COGS − platform fees − ads"
      plain="The contribution after the costs that scale with each sale: cost of goods, the platform's cut, and the ad spend attributed to it. Negative means the SKU loses money per sale on this channel."
      inputs={[
        { label: "Net revenue", value: fmtRupees(r.netRev) },
        { label: "COGS", value: r.cogs != null ? fmtRupees(-r.cogs) : "—" },
        { label: "Platform fees", value: r.fees != null ? fmtRupees(-r.fees) : "—" },
        { label: "Ads", value: r.adSpend != null ? fmtRupees(-r.adSpend) : "—" },
        { label: "Units", value: fmtUnits(r.units) },
      ]}
      value={`${fmtRupees(r.cm3)} (${pct1(r.cm3Pct)})`}
      source={`${channel} native export · COGS card`}
      asOf={month}
    />
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 12d · RETURNS — net-of-returns honesty.
// ════════════════════════════════════════════════════════════════════════════
function ReturnsSection({ facts, month, channels }) {
  const cm = useMemo(() => computeCM({ facts, month }), [facts, month]);
  const present = channels.filter((ch) => cm.byChannel?.[ch]);

  const returnsByChannel = useMemo(() => {
    const out = {};
    for (const [key, cell] of Object.entries(facts.monthly || {})) {
      const [m, ch, code] = key.split("|");
      if (m !== month || code === CH_CODE) continue;
      const ru = num(cell.returnsUnits), rv = num(cell.returnsValue);
      out[ch] = out[ch] || { units: 0, value: 0, hasData: false };
      out[ch].units += ru; out[ch].value += rv;
      if (ru || rv) out[ch].hasData = true;
    }
    return out;
  }, [facts, month]);

  const bySource = facts.meta?.bySource || {};
  const fkCashback = bySource["fk-sales"]?.flipkartCashback || null;
  const mcfUnits = bySource["amazon-orders"]?.mcf?.totalUnits ?? null;

  return (
    <div>
      <table className="table" style={{ marginBottom: 4 }}>
        <thead>
          <tr>
            <th>Channel</th>
            <th className="num">Return units</th>
            <th className="num">Return value</th>
            <th className="num">Return rate (units)</th>
            <th>Treatment in revenue</th>
          </tr>
        </thead>
        <tbody>
          {present.map((ch) => {
            const meta = chMeta(ch);
            const r = returnsByChannel[ch];
            const netUnits = num(cm.byChannel[ch]?.units);
            const retUnits = num(r?.units);
            const denom = netUnits + retUnits;
            const rate = denom > 0 && retUnits > 0 ? (retUnits / denom) * 100 : null;
            const treatment =
              ch === "amazon" ? "Netted out of rev & units (All-Orders refund rows)"
                : ch === "flipkart" ? "Auto-netted into Buyer Invoice Amount (negative rows)"
                  : "Not itemised in source";
            return (
              <tr key={ch}>
                <td>
                  <span className="badge" style={pillStyle(ch)}>{meta.short}</span>
                  <span style={{ marginLeft: 8, fontSize: 12.5 }}>{meta.name}</span>
                </td>
                <td className="num">{r?.hasData ? fmtUnits(retUnits) : <span className="muted">—</span>}</td>
                <td className="num">{r?.hasData ? fmtRupees(r.value) : <span className="muted">—</span>}</td>
                <td className="num" style={{ color: rate != null && rate > 8 ? "var(--warning)" : "var(--ink)" }}>{rate != null ? rate.toFixed(1) + "%" : <span className="muted">—</span>}</td>
                <td className="muted" style={{ fontSize: 11.5 }}>{treatment}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="note" style={{ marginTop: 12 }}>
        <span style={{ lineHeight: 1.55 }}>
          <strong>Coverage caveat.</strong>&nbsp;Returns are surfaced from what each channel&apos;s native export
          actually carries ({fmtMonth(month)}). Amazon refund/return rows are netted out of both revenue and units;
          Flipkart&apos;s negative settlement rows are absorbed into the Buyer Invoice Amount. Blinkit and Website
          carry no per-order return lines in the sources — a dash means <em>not in source</em>, not a zero rate.
          {fkCashback ? (
            <> Flipkart also reports a settlement-layer cashback of{" "}
              <span className="mono">{fmtRupees(fkCashback.value)}</span> ({fkCashback.rows} rows) — excluded from
              revenue, shown as a net-realisation note only.</>
          ) : null}
          {mcfUnits != null ? (
            <> Note: {fmtUnits(mcfUnits)} Amazon-fulfilled (MCF) units are website orders, not Amazon channel
              sales, and are excluded from the Amazon figures.</>
          ) : null}
        </span>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// A · RETENTION & RETURNS — historical actuals from the BusinessModel workbook.
// ════════════════════════════════════════════════════════════════════════════
function RetentionReturnsPanel({ repeats, returnsTrend }) {
  const sq = repeats?.shopify || [];
  const aq = repeats?.amazon || [];
  const rm = returnsTrend?.monthly || [];

  const repFirst = sq[0]?.repeatPct, repLast = sq[sq.length - 1]?.repeatPct;
  const amzLast = aq[aq.length - 1]?.repeatShare;

  return (
    <div>
      <div className="card-body" style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 18, paddingBottom: 8 }}>
        <div>
          <div className="stat-label" style={{ marginBottom: 8 }}>
            Shopify repeat-customer rate · by quarter
          </div>
          {sq.length >= 2 ? (
            <ShopifyRepeatBars rows={sq} />
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>Not enough quarters.</div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", marginTop: 8, fontSize: 11.5 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: chMeta("website").color }} /> Repeat % of customers
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 14, height: 2, background: "var(--info)" }} /> Returning-customer sales %
            </span>
          </div>
          {repFirst != null && repLast != null && (
            <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
              Repeat rate moved <strong style={{ color: "var(--success)" }}>{repFirst.toFixed(1)}% → {repLast.toFixed(1)}%</strong>
              {" "}across {sq[0].quarter} → {sq[sq.length - 1].quarter}. Returning buyers now drive{" "}
              <strong>{num(sq[sq.length - 1].returningSalesPct).toFixed(1)}%</strong> of Shopify sales.
            </div>
          )}
        </div>

        <div>
          <div className="stat-label" style={{ marginBottom: 8 }}>
            Shopify returns % · by month
          </div>
          {rm.length >= 2 ? (
            <ReturnsTrendLine rows={rm} />
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>Not enough months.</div>
          )}
          {rm.length >= 2 && (
            <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
              Returns are volatile month to month ({Math.min(...rm.map((r) => num(r.returnPct))).toFixed(1)}%–
              {Math.max(...rm.map((r) => num(r.returnPct))).toFixed(1)}% range, latest{" "}
              <strong>{num(rm[rm.length - 1].returnPct).toFixed(1)}%</strong>) — read the trend, not any one spike.
            </div>
          )}
        </div>
      </div>

      {aq.length > 0 && (
        <div className="card-body" style={{ paddingTop: 4, paddingBottom: 8 }}>
          <div className="stat-label" style={{ marginBottom: 6 }}>Amazon repeat-customer share · by quarter</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {aq.map((r) => (
              <div key={r.quarter} style={{
                border: "1px solid var(--border-soft)", borderRadius: 8, padding: "6px 12px",
                background: "var(--bg-sunken)", minWidth: 96,
              }}>
                <div className="muted" style={{ fontSize: 10.5 }}>{r.quarter}</div>
                <div className="mono" style={{ fontSize: 15, fontWeight: 500 }}>{num(r.repeatShare).toFixed(1)}%</div>
                <div className="muted" style={{ fontSize: 10 }}>
                  {fmtUnits(r.repeatCustomers)} repeat buyers · {num(r.salesFromRepeatShare).toFixed(1)}% of sales
                </div>
              </div>
            ))}
            {amzLast != null && (
              <div style={{ display: "flex", alignItems: "center", fontSize: 11.5, color: "var(--ink-2)", paddingLeft: 4 }}>
                Amazon repeat share holds near <strong style={{ margin: "0 4px" }}>{amzLast.toFixed(1)}%</strong> — a
                marketplace pattern (lower stickiness than the owned storefront).
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card-body" style={{ paddingTop: 6 }}>
        <div className="muted" style={{ fontSize: 11 }}>
          Source: <strong>BusinessModel workbook</strong> — &ldquo;Repeats(Shopify &amp; Amazon)&rdquo; and
          &ldquo;Returns(Shopify)&rdquo; tabs (historical actuals, not cost assumptions; quarterly / monthly grain).
          {repeats?.sourceLabel ? <> File: <span className="mono">{repeats.sourceLabel}</span>.</> : null}
        </div>
      </div>
    </div>
  );
}

function ShopifyRepeatBars({ rows }) {
  const w = 360, h = 150;
  const pad = { l: 30, r: 30, t: 12, b: 26 };
  const innerW = w - pad.l - pad.r, innerH = h - pad.t - pad.b;
  const n = rows.length;
  const bw = innerW / n;
  const maxPct = Math.max(
    1,
    ...rows.map((r) => num(r.repeatPct)),
    ...rows.map((r) => num(r.returningSalesPct))
  ) * 1.15;
  const yFor = (v) => pad.t + innerH - (num(v) / maxPct) * innerH;
  const xMid = (i) => pad.l + i * bw + bw / 2;
  const barColor = chMeta("website").color;
  const linePts = rows.map((r, i) => [xMid(i), yFor(r.returningSalesPct)]);
  const line = linePts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      {[0, 0.5, 1].map((t, i) => (
        <g key={i}>
          <line x1={pad.l} y1={pad.t + innerH * t} x2={w - pad.r} y2={pad.t + innerH * t} stroke="var(--border-soft)" />
          <text x={pad.l - 4} y={pad.t + innerH * t + 3} fontSize="8.5" textAnchor="end" fill="var(--ink-3)" fontFamily="var(--mono)">
            {Math.round(maxPct * (1 - t))}%
          </text>
        </g>
      ))}
      {rows.map((r, i) => {
        const v = num(r.repeatPct);
        const bh = (v / maxPct) * innerH;
        const x = pad.l + i * bw + bw * 0.2;
        return (
          <g key={r.quarter}>
            <rect x={x} y={pad.t + innerH - bh} width={bw * 0.6} height={Math.max(0, bh)} fill={barColor} opacity="0.85" rx="2">
              <title>{`${r.quarter}: ${v.toFixed(1)}% repeat customers (${fmtUnits(r.returningCustomers)}/${fmtUnits(r.totalCustomers)})`}</title>
            </rect>
            <text x={xMid(i)} y={pad.t + innerH - bh - 4} fontSize="8.5" textAnchor="middle" fill="var(--ink-2)" fontFamily="var(--mono)">
              {v.toFixed(1)}
            </text>
            <text x={xMid(i)} y={h - 8} fontSize="8" textAnchor="middle" fill="var(--ink-3)" fontFamily="var(--mono)">
              {r.quarter.replace(/\s*20/, " '")}
            </text>
          </g>
        );
      })}
      <path d={line} fill="none" stroke="var(--info)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      {linePts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="2.4" fill="var(--info)">
          <title>{`${rows[i].quarter}: ${num(rows[i].returningSalesPct).toFixed(1)}% of sales from returning customers`}</title>
        </circle>
      ))}
    </svg>
  );
}

function ReturnsTrendLine({ rows }) {
  const w = 360, h = 150;
  const pad = { l: 30, r: 12, t: 12, b: 26 };
  const innerW = w - pad.l - pad.r, innerH = h - pad.t - pad.b;
  const n = rows.length;
  const xFor = (i) => pad.l + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yMax = Math.max(1, ...rows.map((r) => num(r.returnPct))) * 1.12;
  const yFor = (v) => pad.t + innerH - (num(v) / yMax) * innerH;
  const mean = rows.reduce((a, r) => a + num(r.returnPct), 0) / n;
  const pts = rows.map((r, i) => [xFor(i), yFor(r.returnPct)]);
  const line = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const ymOf = (iso) => String(iso || "").slice(0, 7);
  const labelStep = Math.max(1, Math.ceil(n / 7));

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      {[0, 0.5, 1].map((t, i) => (
        <g key={i}>
          <line x1={pad.l} y1={pad.t + innerH * t} x2={w - pad.r} y2={pad.t + innerH * t} stroke="var(--border-soft)" />
          <text x={pad.l - 4} y={pad.t + innerH * t + 3} fontSize="8.5" textAnchor="end" fill="var(--ink-3)" fontFamily="var(--mono)">
            {Math.round(yMax * (1 - t))}%
          </text>
        </g>
      ))}
      <line x1={pad.l} y1={yFor(mean)} x2={w - pad.r} y2={yFor(mean)} stroke="var(--ink-3)" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.7" />
      <text x={w - 12} y={yFor(mean) - 3} fontSize="8" textAnchor="end" fill="var(--ink-3)" fontFamily="var(--mono)">avg {mean.toFixed(1)}%</text>
      <path d={line} fill="none" stroke={chMeta("amazon").color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="2" fill={chMeta("amazon").color}>
          <title>{`${fmtMonth(ymOf(rows[i].month))}: ${num(rows[i].returnPct).toFixed(1)}% returns`}</title>
        </circle>
      ))}
      {rows.map((r, i) =>
        i % labelStep === 0 || i === n - 1 ? (
          <text key={i} x={xFor(i)} y={h - 8} fontSize="8" textAnchor="middle" fill="var(--ink-3)" fontFamily="var(--mono)">
            {fmtMonthShort(ymOf(r.month))}
          </text>
        ) : null
      )}
    </svg>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// E · CANCEL RATE — shipped vs cancelled units per channel, monthly.
// ════════════════════════════════════════════════════════════════════════════
const CANCEL_OK = 8, CANCEL_WATCH = 15;
function cancelColor(pct) {
  if (pct == null || !Number.isFinite(pct)) return "var(--ink-3)";
  if (pct > CANCEL_WATCH) return "var(--critical)";
  if (pct > CANCEL_OK) return "var(--warning)";
  return "var(--success)";
}
function cancelSoft(pct) {
  if (pct == null || !Number.isFinite(pct)) return "var(--bg-sunken)";
  if (pct > CANCEL_WATCH) return "var(--critical-soft)";
  if (pct > CANCEL_OK) return "var(--warning-soft)";
  return "var(--success-soft)";
}

function CancelRatePanel({ cancel, channels }) {
  const byChannel = cancel?.byChannel || {};
  const latestByChannel = cancel?.latestByChannel || {};
  const present = channels.filter((ch) => byChannel[ch] && Object.keys(byChannel[ch]).length > 0);
  const monthSet = new Set();
  for (const ch of present) for (const m of Object.keys(byChannel[ch])) monthSet.add(m);
  const months = [...monthSet].sort();
  const n = months.length;
  if (present.length === 0 || n === 0) {
    return <div className="card-body"><div className="muted" style={{ fontSize: 12.5 }}>No shipped-vs-cancel data in source.</div></div>;
  }

  const w = 760, h = 230;
  const pad = { l: 40, r: 14, t: 14, b: 28 };
  const innerW = w - pad.l - pad.r, innerH = h - pad.t - pad.b;
  const xFor = (i) => pad.l + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yMax = Math.max(
    CANCEL_WATCH + 3,
    ...present.flatMap((ch) => months.map((m) => num(byChannel[ch][m]?.cancelPct)))
  ) * 1.06;
  const yFor = (v) => pad.t + innerH - (Math.max(0, num(v)) / yMax) * innerH;

  return (
    <div>
      <div className="card-body" style={{ paddingBottom: 6, display: "flex", flexWrap: "wrap", gap: 8 }}>
        {present.map((ch) => {
          const meta = chMeta(ch);
          const latest = latestByChannel[ch];
          const cell = latest ? byChannel[ch][latest.month] : null;
          const pct = latest ? num(latest.cancelPct) : null;
          return (
            <div key={ch} style={{
              border: "1px solid var(--border-soft)", borderRadius: 8, padding: "8px 12px",
              background: cancelSoft(pct), minWidth: 132,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="badge" style={{ ...pillStyle(ch), fontSize: 9 }}>{meta.short}</span>
                <span style={{ fontSize: 12, fontWeight: 500 }}>{meta.name}</span>
              </div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 500, marginTop: 4, color: cancelColor(pct) }}>
                {pct != null ? pct.toFixed(1) + "%" : "—"}
              </div>
              <div className="muted" style={{ fontSize: 10 }}>
                cancel rate · {latest ? fmtMonthShort(latest.month) : "—"}
                {cell ? ` · ${fmtUnits(cell.cancelled)}/${fmtUnits(cell.total)}u` : ""}
              </div>
            </div>
          );
        })}
      </div>

      <div className="card-body" style={{ paddingTop: 4 }}>
        <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
          <rect x={pad.l} y={yFor(yMax)} width={innerW} height={yFor(CANCEL_WATCH) - yFor(yMax)} fill="var(--critical-soft)" opacity="0.5" />
          <rect x={pad.l} y={yFor(CANCEL_WATCH)} width={innerW} height={yFor(CANCEL_OK) - yFor(CANCEL_WATCH)} fill="var(--warning-soft)" opacity="0.45" />
          <rect x={pad.l} y={yFor(CANCEL_OK)} width={innerW} height={pad.t + innerH - yFor(CANCEL_OK)} fill="var(--success-soft)" opacity="0.4" />
          {[CANCEL_OK, CANCEL_WATCH].map((thr) => (
            <g key={thr}>
              <line x1={pad.l} y1={yFor(thr)} x2={w - pad.r} y2={yFor(thr)} stroke="var(--ink-3)" strokeWidth="0.7" strokeDasharray="3 3" opacity="0.6" />
              <text x={w - pad.r} y={yFor(thr) - 2} fontSize="8" textAnchor="end" fill="var(--ink-3)" fontFamily="var(--mono)">{thr}%</text>
            </g>
          ))}
          {[0, 0.5, 1].map((t, i) => (
            <text key={i} x={pad.l - 5} y={pad.t + innerH * t + 3} fontSize="8.5" textAnchor="end" fill="var(--ink-3)" fontFamily="var(--mono)">
              {Math.round(yMax * (1 - t))}%
            </text>
          ))}
          {present.map((ch) => {
            const pts = months.map((m, i) => (byChannel[ch][m] ? [xFor(i), yFor(byChannel[ch][m].cancelPct)] : null));
            let d = "", started = false;
            pts.forEach((p) => {
              if (!p) { started = false; return; }
              d += (started ? " L" : " M") + p[0].toFixed(1) + "," + p[1].toFixed(1);
              started = true;
            });
            return (
              <g key={ch}>
                <path d={d.trim()} fill="none" stroke={chMeta(ch).color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
                {pts.map((p, i) => (p ? (
                  <circle key={i} cx={p[0]} cy={p[1]} r="1.9" fill={chMeta(ch).color}>
                    <title>{`${chMeta(ch).name} · ${fmtMonth(months[i])}: ${num(byChannel[ch][months[i]].cancelPct).toFixed(1)}% (${fmtUnits(byChannel[ch][months[i]].cancelled)}/${fmtUnits(byChannel[ch][months[i]].total)}u)`}</title>
                  </circle>
                ) : null))}
              </g>
            );
          })}
          {months.map((m, i) =>
            i % (n > 9 ? 2 : 1) === 0 || i === n - 1 ? (
              <text key={m} x={xFor(i)} y={h - 8} fontSize="8" textAnchor="middle" fill="var(--ink-3)" fontFamily="var(--mono)">
                {fmtMonthShort(m)}
              </text>
            ) : null
          )}
        </svg>
        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
          {present.map((ch) => (
            <div key={ch} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <span style={{ width: 11, height: 11, borderRadius: 2, background: chMeta(ch).color }} />
              <span>{chMeta(ch).name}</span>
            </div>
          ))}
          <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>
            band: <span style={{ color: "var(--success)" }}>≤{CANCEL_OK}% ok</span> ·{" "}
            <span style={{ color: "var(--warning)" }}>≤{CANCEL_WATCH}% watch</span> ·{" "}
            <span style={{ color: "var(--critical)" }}>&gt;{CANCEL_WATCH}% alarm</span>
          </span>
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
          Source: <strong>Snell Sale tab</strong> — shipped vs cancelled units per channel (daily, rolled to month).
          Cancel rate = cancelled ÷ (shipped + cancelled). A cancellation is an order that never converts — it
          still consumed ad spend and reserved inventory, so it precedes and is distinct from the returns below.
        </div>
      </div>
    </div>
  );
}

export default PageSales;
