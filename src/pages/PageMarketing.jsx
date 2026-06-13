import { useState, useMemo, useEffect } from "react";
import { Card } from "../components/Shared.jsx";
import { UploadModal, DataAsOfPill } from "../components/UploadModal.jsx";
import NSData from "../data.js";
import { mergedFacts } from "../lib/businessStore.js";
import {
  computeMonthChannelCM,
  computeCM,
  monthsAvailable,
  guardRatio,
  AD_BASIS,
} from "../lib/cmEngine.js";
import * as COSTS from "../lib/costInputs.js";
import {
  autoNarrative,
  adPrescriptions,
  detectAnomalies,
  computeWhatIf,
  driverSensitivity,
  dailyChannelSeries,
  attributionConfidence,
  channelDailyEfficiency,
  blinkitAdProxy,
  cashbackTrend,
  conversionValueGap,
  forecast,
  actionQueue,
  monarchSourceTabs,
} from "../lib/bizAnalytics.js";
import { DerivationPopover } from "../components/biz/DerivationPopover.jsx";
import { AutoNarrative } from "../components/biz/AutoNarrative.jsx";
import { AnomalyBadge } from "../components/biz/AnomalyBadge.jsx";
import { WhatIfPanel } from "../components/biz/WhatIfPanel.jsx";
import BizStateGuard from "../components/biz/BizStateGuard.jsx";
import { BlinkitAdProxy } from "../components/biz/BlinkitAdProxy.jsx";
import { ForecastChart } from "../components/biz/ForecastChart.jsx";
import { ActionQueue } from "../components/biz/ActionQueue.jsx";
import { CashbackTrendView, ConversionGapView, MonarchSourceTabsView, AmazonSpDailyView } from "../components/biz/InsightViews.jsx";

/**
 * PageMarketing — Business Performance module, V2 ADDENDUM (2026-06-12).
 *
 * The founder rejected v1 as "rich data, little used": a single-month page that
 * ignored 14 months of Snell/Monarch ad history and emitted absurd un-gated
 * ratios (e.g. a five-figure-% ACOS from cross-window division). V2 rebuilds it
 * around the full agency/native history with coverage honesty + ratio guards.
 *
 * REAL DATA ONLY (mergedFacts() = bundled May-2026 native ⊕ Snell/Monarch tiers
 * ⊕ uploads). Every number flows through D.fmtINR / D.fmtN (never a raw float),
 * every % to 1 decimal, every ratio through guardRatio() so a cross-window or
 * near-zero-denominator division renders as "window mismatch ⓘ" — NEVER a raw
 * absurd number. No NaN/Infinity is ever produced (SAFE fallbacks throughout).
 *
 * What this page surfaces (spec V2.5 Marketing):
 *   1. Monthly spend vs net-revenue PER CHANNEL across the FULL history
 *      (grouped bars + TCOS% line). TCOS = ad spend ÷ net revenue, computed
 *      same-window per month×channel — cross-checked against the Snell sheet's
 *      own revenue/spend columns the data layer parsed.
 *   2. Spend mix by channel over time (stacked share, every month).
 *   3. May per-SKU deep-dive: ROAS / ACOS / breakeven-ACOS with an adBasis chip
 *      on every figure; breakeven flag ONLY where the window is same-tier;
 *      zero-sale ad spend list.
 *   4. Google vs Meta website split (Monarch), monthly.
 *   5. AMS daily ad-spend sparkline (Snell daily channel-grain + the May SP file
 *      product-attributed total as the native cross-check).
 *
 * COVERAGE HONESTY: months Jun-2025 → Apr-2026 + Jun-2026 are AGENCY-tier
 * (Snell channel-grain net + ad spend, no per-SKU attribution); only May-2026 is
 * NATIVE per-SKU. The per-SKU deep-dive is therefore May-only and clearly badged;
 * the history charts are channel-grain and badged "agency". June is partial-MTD
 * and excluded from trend conclusions unless compared like-for-like.
 */

const ANCHOR_MONTH = "2026-05";          // the only native per-SKU month
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Channel display metadata — colour + label + the ad source each channel's spend
// comes from. DERIVED-DECORATION ONLY: the authoritative channel list always
// comes from the facts; this just styles whatever appears. Unknown → neutral.
const CH_META = {
  amazon:   { label: "Amazon",   color: "#E47911", adSource: "Amazon SP / Snell AMS (daily channel total)" },
  flipkart: { label: "Flipkart", color: "#2874F0", adSource: "Flipkart PLA / Snell FK spend" },
  blinkit:  { label: "Blinkit",  color: "#F8CB46", adSource: "Snell Blinkit spend (channel total)" },
  website:  { label: "Website",  color: "#5E8E3E", adSource: "Monarch Google + Meta spend" },
};
const CH_ORDER = ["amazon", "flipkart", "blinkit", "website"];
const chMeta = (ch) => CH_META[ch] || { label: ch, color: "#8E8A7E", adSource: "—" };

const PageMarketing = () => {
  const D = NSData;
  const [uploadOpen, setUploadOpen] = useState(false);

  // Re-read the live fact store after an upload+reload; the modal reloads the
  // page on Apply, so a plain mount read is enough. Keyed empty → once.
  const facts = useMemo(() => mergedFacts(), []);

  // ── Coverage-aware month model (single source of truth) ──────────────────
  const months = useMemo(() => monthsAvailable(facts), [facts]);

  // The history we actually chart: every month that has ≥1 channel with real
  // (native|agency) sales coverage. Ascending. June is the partial-MTD tail.
  const history = useMemo(() => {
    const rows = [];
    for (const mm of months) {
      const byCh = {};
      let any = false;
      for (const ch of CH_ORDER) {
        if (!mm.channels[ch]) continue;
        const r = computeMonthChannelCM({ facts, month: mm.month, channel: ch });
        if (r.coverage === "none") continue;
        byCh[ch] = {
          netRev: num(r.netRev),
          adSpend: num(r.adSpend),
          coverage: r.coverage,        // native | agency
          partial: !!r.partial,
          adBasis: r.adBasis,
        };
        any = true;
      }
      if (any) rows.push({ month: mm.month, partial: !!mm.partial, lastDay: mm.lastDay, byCh });
    }
    return rows;
  }, [facts, months]);

  // Channels actually present anywhere in the history (ordered).
  const channels = useMemo(() => {
    const set = new Set();
    for (const row of history) for (const ch of Object.keys(row.byCh)) set.add(ch);
    return CH_ORDER.filter((c) => set.has(c)).concat([...set].filter((c) => !CH_ORDER.includes(c)));
  }, [history]);

  // Default the deep-dive month to the native anchor (only month with per-SKU).
  const nativeMonths = useMemo(
    () => months.filter((m) => Object.values(m.channels).some((c) => c.sales === "native")).map((m) => m.month),
    [months]
  );
  const skuMonth = nativeMonths.includes(ANCHOR_MONTH) ? ANCHOR_MONTH : (nativeMonths[nativeMonths.length - 1] || ANCHOR_MONTH);

  const skuName = (code) => D.skus.find((s) => s.code === code)?.name || code;
  const skuVariant = (code) => D.skus.find((s) => s.code === code)?.variant || "";

  // ── History totals + blended TCOS (for KPI strip) ────────────────────────
  // Full-period and last-complete-month figures. "Last complete" = the most
  // recent month with NO partial channel (June is MTD, so this lands on May).
  const lastComplete = useMemo(() => [...history].reverse().find((r) => !r.partial) || history[history.length - 1], [history]);
  // The CURRENT month-to-date row = the LATEST partial month (June 2026), not the
  // first. The first partial row is Aug-2024 (data started 2-Aug, lastDay 11 Aug);
  // .find() would pick that up and leak "11 Aug" into the June MTD label.
  const mtd = useMemo(() => [...history].reverse().find((r) => r.partial) || null, [history]);

  const periodTotals = useMemo(() => {
    let rev = 0, spend = 0;
    // M2 — itemize the all-period ad-spend headline by channel, with the window
    // boundaries (first→last complete month each channel contributes) so the
    // ₹-total is traceable, same style as the AMS card. Excludes MTD.
    const byCh = {};                                 // ch → { spend, first, last, months }
    for (const r of history) {
      if (r.partial) continue;                       // exclude MTD from the period roll
      for (const ch of Object.keys(r.byCh)) {
        rev += r.byCh[ch].netRev; spend += r.byCh[ch].adSpend;
        const s = num(r.byCh[ch].adSpend);
        if (!byCh[ch]) byCh[ch] = { spend: 0, first: r.month, last: r.month, months: 0 };
        byCh[ch].spend += s;
        if (s > 0) {                                 // window boundary = months that actually spent
          if (!byCh[ch].firstSpend || r.month < byCh[ch].firstSpend) byCh[ch].firstSpend = r.month;
          if (!byCh[ch].lastSpend || r.month > byCh[ch].lastSpend) byCh[ch].lastSpend = r.month;
          byCh[ch].months += 1;
        }
        if (r.month < byCh[ch].first) byCh[ch].first = r.month;
        if (r.month > byCh[ch].last) byCh[ch].last = r.month;
      }
    }
    return { rev, spend, months: history.filter((r) => !r.partial).length, byCh };
  }, [history]);

  // Period blended TCOS — same-window (all complete months pooled), so a direct
  // ratio is legitimate (numerator + denominator share the agency/native pool).
  const periodTcos = guardRatio({
    numerator: periodTotals.spend, denominator: periodTotals.rev,
    numWindow: "period", denWindow: "period", kind: "acos",
  });

  // ── Snell own-TCOS cross-check (data report: Snell carries its own spend +
  // net columns; our derived TCOS must reconcile against the sheet's columns) ─
  const snellMeta = facts?.meta?.bySource?.["snell-history"] || {};
  const recon = snellMeta.mayReconciliation || null;

  // ── Freshness — true to the latest data day (rubric 83), consistent with the
  // inventory module's "Data through <date>" label. Latest amongst all sources.
  const dataThrough = facts?.meta?.latestDataDate || mtd?.lastDay || lastComplete?.lastDay || null;

  // ── 59/66 · Auto-narrative — the founder's morning read, most-useful-first.
  // Built for the CURRENT (MTD) month so the headline answers "how are ads doing
  // and what needs me today"; falls back to the last complete month if no MTD.
  const narrativeMonth = mtd?.month || lastComplete?.month || skuMonth;
  const narrative = useMemo(
    () => safeCall(() => autoNarrative(facts, { month: narrativeMonth, costs: COSTS })),
    [facts, narrativeMonth]
  );

  // ── 53 · Ranked ad prescriptions (₹ impact) — the deep-dive month is the only
  // per-SKU window, so SKU-level ad cut/optimise actions are computed there; the
  // Google↔Meta reallocation hint reads platform efficiency (any month).
  const adRx = useMemo(
    () => safeCall(() => adPrescriptions(facts, { month: skuMonth, costs: COSTS })) || [],
    [facts, skuMonth]
  );

  // ── 23 · Attribution-confidence per channel — what fraction of THIS month's ad
  // spend (and thus its CM3) is real per-product attribution vs allocated-by-rev.
  // Read straight from the verified cmEngine adAllocation surface (direct/total).
  const attrConfidence = useMemo(
    () => safeCall(() => buildAttributionConfidence(facts, skuMonth)) || { channels: [], total: null },
    [facts, skuMonth]
  );

  // ── III-99 · MODELED Blinkit per-SKU ad proxy (band, labelled modeled). Blinkit
  // gives no per-SKU ad data — a SOURCE GAP. Rather than omit (silent) or fabricate,
  // the engine models each SKU's ad = its Blinkit net × Amazon's measured TCOS, ±50%
  // band, rescaled to the real Blinkit channel ad total. Native deep-dive month.
  const blkProxy = useMemo(
    () => safeCall(() => blinkitAdProxy(facts, { month: skuMonth, costs: COSTS, refChannel: "amazon" })) || null,
    [facts, skuMonth]
  );

  // ── (d) · Flipkart cashback as a settlement-drag trend (a deduction on net
  // realization). Honest to source: one populated month in the current export → a
  // single-point baseline, flagged as such by the engine note.
  const cashback = useMemo(() => safeCall(() => cashbackTrend(facts)) || null, [facts]);
  // I-2 · the two parsed-but-unsurfaced Monarch tabs (March-2025 daily ramp +
  // Weekly-Comparison Google-vs-Meta blocks). Stored by the parser but never
  // reached a view — wired here so ingestion completeness has no silent omission.
  const monarchTabs = useMemo(() => safeCall(() => monarchSourceTabs(facts)) || null, [facts]);

  // ── (c) · Ad-reporting inflation — Monarch Total Conversion Value (ad-reported
  // gross) vs Shopify-net (banked). The website ad rupee's "conversion value" is
  // inflated vs what actually landed; reading CM3 off the conversion value would
  // overstate ad efficiency. Same-window (one month). A marketing-honesty insight.
  const convGap = useMemo(
    () => safeCall(() => conversionValueGap(facts, { month: skuMonth, costs: COSTS })) || null,
    [facts, skuMonth]
  );

  // ── VII-52 · Forward WEBSITE ad-channel revenue + CONTRIBUTION with a stated
  // method and an uncertainty band (the marketing budgeting horizon — how much the
  // website channel is pacing toward, so spend can be planned, not just reviewed).
  // Channel-grain so the band is meaningful (Monarch website history is deep).
  const webForecast = useMemo(
    () => safeCall(() => forecast(facts, { channel: "website", costs: COSTS, horizonMonths: 2 })) || null,
    [facts]
  );

  // ── VIII · The MARKETING SLICE of the ONE shared "what to do Monday" queue. The
  // full queue spans every lever (reorder/delist/reprice/ad-cut/reallocate); here
  // we surface the AD levers (ad-cut + reallocate) so the marketing page ends in
  // the SAME ranked-by-₹ decision contract the other pages share — not a second
  // bespoke list. Computed for the native deep-dive month (the per-SKU ad window).
  // raw cross-lever queue (memoized like adRx — proven clean); the cheap ad-lever
  // slice is derived at render (a small filter/sort, no memo needed).
  const fullQueue = useMemo(
    () => safeCall(() => actionQueue(facts, { month: skuMonth, costs: COSTS })) || [],
    [facts, skuMonth]
  );
  const adQueue = marketingSliceOfQueue(fullQueue);

  return (
    <>
    <BizStateGuard facts={facts} module="Marketing & Ads" onUpload={() => setUploadOpen(true)}>
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">Marketing &amp; Advertising</div>
          <div className="page-sub">
            Attribution confidence per channel · ranked ad actions (₹ impact) in the shared Monday queue · spend vs net revenue &amp; TCOS across {history.length} months ·
            channel spend forecast (banded) · Google vs Meta ROAS/CPA · all {seoCount(facts)} SEO keywords · modeled Blinkit per-SKU ad · per-SKU ROAS / ACOS ·
            AMS daily spend + anomaly flags · ad-reporting inflation · Flipkart cashback drag · ad-budget what-if
          </div>
        </div>
        <div className="actions" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {dataThrough && (
            <span className="cov-badge cov-agency sm" title="The latest data day reflected anywhere on this page (newest of all loaded ad/sales sources). Consistent with the inventory module's freshness label.">
              Data through {fmtDay(dataThrough)}
            </span>
          )}
          <DataAsOfPill onClick={() => setUploadOpen(true)} />
          <button className="btn primary" onClick={() => setUploadOpen(true)}>Upload reports</button>
        </div>
      </div>

      {/* ── 59/66 · Auto-narrative — most-useful-first: what changed in ads & what
          needs the founder today. Headline + tone bullets + expandable read-out. */}
      {narrative && <AutoNarrative narrative={narrative} title="Marketing read-out · what changed & what needs you" />}

      <div className="note" style={{ marginBottom: 14 }}>
        <span style={{ lineHeight: 1.55 }}>
          <strong style={{ color: "var(--info)" }}>How to read this page.</strong>&nbsp;
          Months <strong>Jun-2025 → Apr-2026</strong> and <strong>Jun-2026</strong> are <em>agency-tier</em>
          {" "}(Snell/Monarch channel totals — net revenue + ad spend per channel, no per-SKU attribution).
          Only <strong>May-2026</strong> is <em>native</em> per-SKU, so the SKU-level ROAS/ACOS deep-dive is
          May-only and badged as such. <strong>TCOS</strong> = ad spend ÷ net revenue, computed inside one
          month×channel window (never across windows). Any ratio that would cross coverage windows or divide
          by ~zero is suppressed and shown as <span className="badge amber" style={{ fontSize: 9 }}>window mismatch ⓘ</span>,
          never a raw number. June is partial — <strong>MTD through {fmtDay(mtd?.lastDay)}</strong> — and excluded from trend reads.
        </span>
      </div>

      {/* ── Headline KPI strip ─────────────────────────────────────────────── */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 14 }}>
        <Card title="Ad spend · period">
          <div className="stat-num lg" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {D.fmtINR(periodTotals.spend)}
            <PeriodSpendItemization byCh={periodTotals.byCh} total={periodTotals.spend} months={periodTotals.months} D={D} />
          </div>
          <div className="muted" style={{ fontSize: 11.5 }}>
            {periodTotals.months} complete months · {history.length}-mo history
          </div>
        </Card>
        <Card title="Net revenue · period">
          <div className="stat-num lg">{D.fmtINR(periodTotals.rev)}</div>
          <div className="muted" style={{ fontSize: 11.5 }}>basis for blended TCOS</div>
        </Card>
        <Card title="Blended TCOS · period">
          <div className="stat-num lg" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {periodTcos.suppressed ? "—" : fmtPct1(periodTcos.value)}
            {!periodTcos.suppressed && (
              <DerivationPopover
                title="Blended TCOS · all complete months"
                formula="Σ ad spend ÷ Σ net revenue (pooled, same-window)"
                plain="Total Cost of Sale — every ad rupee as a share of every net-revenue rupee, pooled across all complete months so numerator and denominator share one window."
                inputs={[
                  { label: "Σ ad spend (complete mo)", value: D.fmtINR(periodTotals.spend) },
                  { label: "Σ net revenue (complete mo)", value: D.fmtINR(periodTotals.rev) },
                  { label: "Complete months", value: D.fmtN(periodTotals.months) },
                ]}
                value={fmtPct1(periodTcos.value)}
                source="Snell Sale-tab ad spend + net columns; Monarch website Google/Meta spend"
                asOf={dataThrough ? fmtDay(dataThrough) : undefined}
                note="MTD (June) is excluded so the ratio never mixes a partial month into the pool."
              />
            )}
          </div>
          <div className="muted" style={{ fontSize: 11.5 }}>ad spend ÷ net revenue (same-window)</div>
        </Card>
        <Card title={`Spend · ${fmtMonth(lastComplete?.month)}`}>
          <div className="stat-num lg">{D.fmtINR(channelSum(lastComplete, "adSpend"))}</div>
          <div className="muted" style={{ fontSize: 11.5 }}>
            last complete month · TCOS {monthTcosLabel(lastComplete)}
          </div>
        </Card>
      </div>

      {/* ── 23 · Attribution-confidence meter per channel + 53 · ranked ad
          prescriptions. Most-useful-first after the KPI strip: how trustworthy
          each channel's ad economics are, and the ranked ₹-impact actions. ───── */}
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <AttributionConfidence conf={attrConfidence} month={skuMonth} D={D} />
        <AdPrescriptions rx={adRx} month={skuMonth} D={D} skuName={skuName} />
      </div>

      {/* ── VIII · The MARKETING SLICE of the shared "what to do Monday" queue.
          The ad levers (ad-cut + reallocate) from the ONE cross-lever action queue,
          ranked by ₹ impact, in the same contract the Sales/Finance pages share —
          so marketing actions live in the founder's single Monday list, not a
          page-private one. The reorder/delist/reprice levers live on Sales. ─────── */}
      <MarketingActionQueue queue={adQueue} month={skuMonth} D={D} />

      {/* ── 1. Monthly spend vs net revenue + TCOS line, per channel ──────── */}
      <SpendVsRevenue
        history={history}
        channels={channels}
        D={D}
        recon={recon}
        netColumnChoice={snellMeta.netColumnChoice}
      />

      {/* ── VII-52 · Forward WEBSITE ad-channel revenue + contribution (banded).
          Spend planning needs a forward view, not just rear-view spend. Stated
          method + uncertainty band; the website channel (deepest Monarch history). */}
      <SpendForecast fc={webForecast} D={D} />

      {/* ── 2. Spend mix by channel over time ─────────────────────────────── */}
      <SpendMix history={history} channels={channels} D={D} />

      {/* ── 3. AMS daily spend sparkline (+ Google/Meta website split) ────── */}
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <AmsDailySpend facts={facts} D={D} skuMonth={skuMonth} />
        <WebsiteSplit facts={facts} D={D} />
      </div>

      {/* ── 3b. XI/III · Amazon SP per-DAY spend series (per-ASIN file's OWN daily
          granularity). The AMS panel above uses the Snell channel-grain total and
          cites the SP file's total only as a scalar cross-check; this surfaces the
          SP file's per-day series so the ₹3,55,115 attributed-SP anchor is
          re-derivable end-to-end (Σ by-day = total, reconciliation ties). ──────── */}
      <div style={{ marginBottom: 14 }}>
        <AmazonSpDailyView data={facts?.meta?.bySource?.["ads-amazon-sp"]} D={D} title="Amazon SP per-day spend · per-ASIN file (₹ anchor re-derived)" />
      </div>

      {/* ── (c) · Ad-reporting inflation + (d) Flipkart cashback settlement drag.
          Two marketing-honesty signals side by side: the gap between what the ad
          platform REPORTS as conversion value and what Shopify actually banked
          (read CM3 off the banked number, never the inflated conv value); and the
          Flipkart cashback deduction that drags net realization. ─────────────────── */}
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        {convGap ? <ConversionGapView data={convGap} D={D} /> : <div />}
        {cashback ? <CashbackTrendView data={cashback} D={D} /> : <div />}
      </div>

      {/* ── 4. (View C) Google vs Meta efficiency — the budgeting decision view ─ */}
      <PlatformEfficiency facts={facts} D={D} />

      {/* ── 4b. Website DAILY ROAS + anomaly — the same daily treatment Amazon AMS
          gets, for the website ad rupee (rubric 51/52). ───────────────────────── */}
      <WebsiteDailyEfficiency facts={facts} D={D} />

      {/* ── XI / 83 · Per-source freshness — each ad/sales feed's true latest data
          day + days behind the live front. Placed just above the SEO panel since the
          SEO tab is the slow-cadence feed the founder most needs framed by recency. */}
      <SourceRecency facts={facts} />

      {/* ── 5. (View B) SEO keyword-rank panel ────────────────────────────── */}
      <SeoKeywordRanks facts={facts} />

      {/* ── 5b. I-2 · Monarch SUPPLEMENTARY tabs — "March 2025" (the website 0→1
          daily ramp) and "Weekly Comparison" (the founder's own Google-vs-Meta
          7-/3-day ROAS/CPA blocks). These two tabs are parsed but were never
          surfaced; mounted here so EVERY field of every Monarch tab reaches a
          view (rubric I / param 2). The March aggregate is shown reconciled to
          its day rows (the stored monthly was a 2× double-count) so it ties to
          source. ──────────────────────────────────────────────────────────── */}
      {monarchTabs && monarchTabs.available && (
        <div style={{ marginBottom: 14 }}>
          <MonarchSourceTabsView data={monarchTabs} D={D} />
        </div>
      )}

      {/* ── 6. May per-SKU deep-dive (native) ─────────────────────────────── */}
      <SkuDeepDive facts={facts} month={skuMonth} D={D} skuName={skuName} skuVariant={skuVariant} />

      {/* ── III-99 · MODELED Blinkit per-SKU ad proxy. Blinkit gives NO per-SKU ad
          attribution (a source gap the deep-dive above cannot fill — Blinkit ad is
          0% measured). Rather than a silent omission OR a fabricated number, the
          engine MODELS each SKU's ad (Blinkit net × Amazon's measured TCOS, ±50%
          band, rescaled to Blinkit's real channel ad total) and labels it
          MODELED-NOT-MEASURED with a striped banner. Honest to param 89 / Dim IV. */}
      {blkProxy && (
        <Card
          title="Blinkit per-SKU ad · MODELED proxy"
          sub="Blinkit reports no per-SKU ad spend (a source gap — Blinkit ad attribution is 0% measured). Instead of omitting it or inventing a number, each SKU's Blinkit ad is MODELED from its Blinkit net × Amazon's measured TCOS, banded ±50%, and rescaled so the per-SKU sum ties to Blinkit's real channel ad total. Clearly labelled modeled, never measured — would need Blinkit's own per-Item-Id ad report to measure."
          action={<span className="badge amber" style={{ fontSize: 9 }}>modeled · NOT measured</span>}
        >
          <BlinkitAdProxy proxy={blkProxy} D={D} title={`Blinkit ad attribution · ${fmtMonth(skuMonth)}`} max={8} />
          <div className="muted" style={{ fontSize: 10.5, marginTop: 10, lineHeight: 1.5 }}>
            Why a proxy and not a blank: the founder still needs a per-SKU read on where the Blinkit ad budget likely
            went. The band (±50%) and the striped MODELED banner make its lower confidence impossible to miss; this is a
            hint to direct attention, never a figure to bet a budget on. The Amazon reference TCOS is the
            measured intensity we have closest to Blinkit&apos;s quick-commerce dynamics.
          </div>
        </Card>
      )}

      {/* ── 7. (54/55) Ad-budget what-if + driver sensitivity — the reallocation
          decision as a simulator: move the ad lever, see CM3 across channels. ─── */}
      <AdScenario facts={facts} month={skuMonth} D={D} />
    </div>
    </BizStateGuard>
    {uploadOpen && <UploadModal onClose={() => setUploadOpen(false)} defaultTab="business" />}
    </>
  );
};

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 1 — Monthly spend vs net revenue + TCOS line, per channel.
 * Grouped bars (net rev vs spend) with a TCOS% overlay line, one small-multiple
 * chart per channel. TCOS is gated through guardRatio (same-window per month).
 * A Snell-vs-native reconciliation note proves our net column reconciles with
 * the sheet's own columns (the data report's cross-check).
 * ════════════════════════════════════════════════════════════════════════ */
const SpendVsRevenue = ({ history, channels, D, recon, netColumnChoice }) => {
  const [active, setActive] = useState("all");
  const shown = active === "all" ? channels : [active];

  return (
    <Card
      title="Monthly spend vs net revenue · TCOS trend"
      sub="Net revenue (bar) vs ad spend (bar) per month, with TCOS% = spend ÷ net revenue overlaid. One window per month×channel — no cross-window ratios. Agency-tier months from Snell/Monarch; May native."
      action={
        <div className="seg">
          <button className={active === "all" ? "active" : ""} onClick={() => setActive("all")}>All</button>
          {channels.map((ch) => (
            <button key={ch} className={active === ch ? "active" : ""} onClick={() => setActive(ch)}>
              {chMeta(ch).label}
            </button>
          ))}
        </div>
      }
      style={{ marginBottom: 14 }}
    >
      <div className="grid" style={{ gridTemplateColumns: shown.length > 1 ? "1fr 1fr" : "1fr", gap: 16 }}>
        {shown.map((ch) => (
          <ChannelSpendChart key={ch} ch={ch} history={history} D={D} />
        ))}
      </div>

      {/* Snell own-column cross-check — proves the agency net we plot reconciles
          with the sheet's own revenue columns the data layer parsed (≤1.1% in May). */}
      {recon && (
        <div className="note" style={{ marginTop: 14 }}>
          <span style={{ lineHeight: 1.55 }}>
            <strong style={{ color: "var(--ink-2)" }}>Snell column cross-check (May).</strong>&nbsp;
            The agency net revenue plotted above comes from the Snell sheet&apos;s own net columns; against the
            independent native May reports it reconciles to{" "}
            {recon.amazonNet && <>Amazon <strong>{fmtPct1(recon.amazonNet.deltaPct / 100)}</strong>, </>}
            {recon.flipkartNet && <>Flipkart <strong>{fmtPct1(recon.flipkartNet.deltaPct / 100)}</strong>, </>}
            {recon.blinkitGross && <>Blinkit <strong>{fmtPct1(recon.blinkitGross.deltaPct / 100)}</strong></>}
            {" "}— so the TCOS denominators are trustworthy.
            {netColumnChoice?.amazon && (
              <span className="muted" style={{ fontSize: 10.5, display: "block", marginTop: 5 }}>
                Net column chosen — Amazon: Final Net Without Review ÷ 1.05. Flipkart: Total Net Value as-is.
                Blinkit: gross ÷ 1.05 (no tax-netted column in the sheet).
              </span>
            )}
          </span>
        </div>
      )}
    </Card>
  );
};

// One channel's grouped-bar + TCOS-line small multiple.
const ChannelSpendChart = ({ ch, history, D }) => {
  const [hover, setHover] = useState(null);
  const meta = chMeta(ch);
  const rows = history
    .filter((r) => r.byCh[ch])
    .map((r) => {
      const c = r.byCh[ch];
      // TCOS gated: numerator (spend) and denominator (net) are the SAME
      // month×channel window, so the ratio is always legitimate when net > 0.
      const t = guardRatio({
        numerator: c.adSpend, denominator: c.netRev,
        numWindow: r.month + ch, denWindow: r.month + ch, kind: "acos",
      });
      return { month: r.month, netRev: c.netRev, adSpend: c.adSpend, partial: r.partial, coverage: c.coverage, tcos: t.value };
    });
  if (rows.length === 0) return null;

  const W = 100 / rows.length;                          // % width per month slot
  const maxBar = Math.max(1, ...rows.map((r) => Math.max(r.netRev, r.adSpend)));
  const tcosVals = rows.map((r) => r.tcos).filter((v) => v != null && Number.isFinite(v));
  const maxTcos = Math.max(0.5, ...tcosVals);           // axis top for the line (≥50%)

  const hv = hover != null ? rows[hover] : null;

  // TCOS polyline points (only for months with a finite ratio).
  const linePts = rows
    .map((r, i) => (r.tcos == null ? null : `${(i + 0.5) * W},${(1 - Math.min(1, r.tcos / maxTcos)) * 100}`))
    .filter(Boolean)
    .join(" ");

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span className="badge" style={pillStyle(ch)}>{meta.label}</span>
        <span className="muted" style={{ fontSize: 11 }}>net revenue vs ad spend · TCOS line</span>
      </div>

      <div style={{ position: "relative", height: 150 }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: 130, display: "block", overflow: "visible" }}>
          {/* gridlines */}
          {[0.25, 0.5, 0.75].map((g) => (
            <line key={g} x1="0" y1={g * 100} x2="100" y2={g * 100} stroke="var(--border-soft)" strokeWidth="0.3" />
          ))}
          {/* grouped bars: net rev (channel colour) + spend (critical tint) */}
          {rows.map((r, i) => {
            const x = i * W;
            const revH = (r.netRev / maxBar) * 100;
            const adH = (r.adSpend / maxBar) * 100;
            const bw = W * 0.32;
            return (
              <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={x + W * 0.5 - bw - 1} y={100 - revH} width={bw} height={revH} fill={meta.color} opacity={r.partial ? 0.45 : 0.9} />
                <rect x={x + W * 0.5 + 1} y={100 - adH} width={bw} height={adH} fill="var(--critical)" opacity={r.partial ? 0.4 : 0.75} />
                {/* invisible hover target spanning the slot */}
                <rect x={x} y={0} width={W} height={100} fill="transparent" />
              </g>
            );
          })}
          {/* TCOS line + dots */}
          {linePts && <polyline points={linePts} fill="none" stroke="var(--ink-2)" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />}
          {rows.map((r, i) =>
            r.tcos == null ? null : (
              <circle key={i} cx={(i + 0.5) * W} cy={(1 - Math.min(1, r.tcos / maxTcos)) * 100} r="1.1" fill="var(--ink)" vectorEffect="non-scaling-stroke" />
            )
          )}
        </svg>
        {/* month axis */}
        <div style={{ display: "flex", marginTop: 2 }}>
          {rows.map((r, i) => (
            <div key={i} style={{ width: W + "%", textAlign: "center", fontSize: 8.5, color: hover === i ? "var(--ink)" : "var(--ink-4)", fontFamily: "var(--mono)" }}>
              {MONTH_NAMES[Number(r.month.split("-")[1]) - 1]}{r.partial ? "*" : ""}
            </div>
          ))}
        </div>
      </div>

      {/* hover detail */}
      <div className="muted" style={{ fontSize: 11, marginTop: 6, minHeight: 30 }}>
        {hv ? (
          <span>
            <strong style={{ color: "var(--ink-2)" }}>{fmtMonth(hv.month)}{hv.partial ? " (MTD)" : ""}</strong> ·
            net {D.fmtINR(hv.netRev)} · spend <span style={{ color: "var(--critical)" }}>{D.fmtINR(hv.adSpend)}</span> ·
            TCOS {hv.tcos == null ? "—" : fmtPct1(hv.tcos)} ·
            <span className="badge" style={{ fontSize: 8.5, marginLeft: 4, ...basisPill(hv.coverage === "native" ? "native" : "agency") }}>
              {hv.coverage}
            </span>
          </span>
        ) : (
          <span>Hover a month. Bars = net revenue (channel colour) vs ad spend (red); line = TCOS%. Faded = partial-MTD.</span>
        )}
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 2 — Spend mix by channel over time (stacked share + ₹ table).
 * ════════════════════════════════════════════════════════════════════════ */
const SpendMix = ({ history, channels, D }) => {
  const rows = history.map((r) => {
    const spends = {};
    let total = 0;
    for (const ch of channels) { const s = r.byCh[ch]?.adSpend || 0; spends[ch] = s; total += s; }
    return { month: r.month, partial: r.partial, spends, total };
  });
  const grand = {};
  let grandTotal = 0;
  for (const ch of channels) { grand[ch] = rows.reduce((a, r) => a + r.spends[ch], 0); grandTotal += grand[ch]; }

  return (
    <Card
      title="Ad spend mix by channel"
      sub="Where the ad budget went each month. Stacked share (left) + rupees (table). Reads the shift from Amazon-led spend toward website/Blinkit over the period."
      padded={false}
      style={{ marginBottom: 14 }}
    >
      {/* stacked share bars */}
      <div className="card-body" style={{ paddingBottom: 4 }}>
        {rows.map((r) => (
          <div key={r.month} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 5 }}>
            <div style={{ width: 64, fontSize: 10.5, color: "var(--ink-3)", fontFamily: "var(--mono)" }}>
              {fmtMonthShort(r.month)}{r.partial ? "*" : ""}
            </div>
            <div style={{ flex: 1, display: "flex", height: 16, borderRadius: 3, overflow: "hidden", background: "var(--border-soft)" }}>
              {channels.map((ch) => {
                const pct = r.total > 0 ? (r.spends[ch] / r.total) * 100 : 0;
                if (pct <= 0) return null;
                return (
                  <div key={ch} title={`${chMeta(ch).label}: ${D.fmtINR(r.spends[ch])} (${pct.toFixed(0)}%)`}
                    style={{ width: pct + "%", background: chMeta(ch).color, opacity: r.partial ? 0.5 : 0.9 }} />
                );
              })}
            </div>
            <div style={{ width: 86, textAlign: "right", fontSize: 10.5, fontFamily: "var(--mono)", color: "var(--ink-3)" }}>
              {D.fmtINR(r.total)}
            </div>
          </div>
        ))}
      </div>

      {/* legend */}
      <div className="card-body" style={{ display: "flex", gap: 14, flexWrap: "wrap", paddingTop: 6, paddingBottom: 6, borderTop: "1px solid var(--border-soft)" }}>
        {channels.map((ch) => (
          <span key={ch} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--ink-3)" }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: chMeta(ch).color, display: "inline-block" }} />
            {chMeta(ch).label} · {grandTotal > 0 ? ((grand[ch] / grandTotal) * 100).toFixed(0) : 0}% of period spend
          </span>
        ))}
      </div>
    </Card>
  );
};

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 3a — AMS daily ad-spend sparkline.
 * Amazon daily channel-grain spend (Snell Sale tab, daily) for the deep-dive
 * month, with the native SP-file product-attributed total as a cross-check.
 * ════════════════════════════════════════════════════════════════════════ */
const AmsDailySpend = ({ facts, D, skuMonth }) => {
  // pull amazon daily channel-grain adSpend for the deep-dive month, ordered.
  const series = useMemo(() => {
    const daily = facts?.daily || {};
    const out = [];
    const prefix0 = `${skuMonth}-`;
    for (const [k, cell] of Object.entries(daily)) {
      const [d, ch, code] = k.split("|");
      if (ch !== "amazon" || code !== "__ch__") continue;
      if (!d.startsWith(prefix0)) continue;
      out.push({ date: d, spend: num(cell.adSpend) });
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  }, [facts, skuMonth]);

  // 51 · spend anomaly flags — z-score of each day's Amazon ad spend vs its own
  // trailing window. The detector runs on the FULL amazon daily-spend history (so
  // the trailing baseline is real), then we keep only the deep-dive-month points
  // → a spend spike/collapse is flagged, never invented (sd=0 days are skipped).
  const anomByDate = useMemo(() => {
    const adSeries = safeCall(() => dailyChannelSeries(facts))?.adByChannel?.amazon || {};
    const pts = Object.keys(adSeries).sort().map((iso) => ({ label: iso, value: num(adSeries[iso]) }));
    const anoms = safeCall(() => detectAnomalies(pts, { window: 14, z: 2 })) || [];
    const map = {};
    for (const a of anoms) map[a.label] = a;
    return map;
  }, [facts]);
  const monthAnoms = series.map((s) => anomByDate[s.date]).filter(Boolean);

  const total = series.reduce((a, s) => a + s.spend, 0);
  const spTotal = num(facts?.meta?.bySource?.["ads-amazon-sp"]?.amazonSpTotal);
  const maxV = Math.max(1, ...series.map((s) => s.spend));
  const avg = series.length ? total / series.length : 0;

  // SP-attributed share of the channel total (same May window → legitimate ratio).
  const attrib = guardRatio({
    numerator: spTotal, denominator: total,
    numWindow: skuMonth, denWindow: skuMonth, kind: "acos",
  });

  return (
    <Card
      title="Amazon AMS daily spend"
      sub={`Daily Amazon ad spend across ${fmtMonth(skuMonth)} (Snell Sale tab, channel total). SP-file per-ASIN total cross-checks the channel.`}
    >
      {series.length === 0 ? (
        <div className="muted" style={{ fontSize: 12.5 }}>No daily Amazon ad-spend rows for {fmtMonth(skuMonth)}.</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 18, marginBottom: 10 }}>
            <div>
              <div className="stat-num">{D.fmtINR(total)}</div>
              <div className="muted" style={{ fontSize: 10.5 }}>month total · {series.length} days</div>
            </div>
            <div>
              <div className="stat-num">{D.fmtINR(avg)}</div>
              <div className="muted" style={{ fontSize: 10.5 }}>avg / day</div>
            </div>
            <div>
              <div className="stat-num">{spTotal > 0 ? D.fmtINR(spTotal) : "—"}</div>
              <div className="muted" style={{ fontSize: 10.5 }}>
                SP per-ASIN {attrib.suppressed ? "" : `· ${fmtPct1(attrib.value)} of total`}
              </div>
            </div>
          </div>
          {/* daily bars — anomaly days (≥2σ vs trailing) tinted red/info + dotted */}
          <svg viewBox="0 0 100 30" preserveAspectRatio="none" style={{ width: "100%", height: 64, display: "block" }}>
            {series.map((s, i) => {
              const bw = 100 / series.length;
              const h = (s.spend / maxV) * 28;
              const an = anomByDate[s.date];
              const fill = an ? (an.direction === "high" ? "var(--critical)" : "var(--info)") : "#E47911";
              return <rect key={i} x={i * bw + bw * 0.12} y={30 - h} width={bw * 0.76} height={Math.max(0.4, h)} fill={fill} opacity={an ? 0.95 : 0.8}>
                {an && <title>{`${fmtDay(s.date)} · ${D.fmtINR(s.spend)} · ${Math.abs(an.z).toFixed(1)}σ ${an.direction === "high" ? "spike" : "collapse"} vs trailing`}</title>}
              </rect>;
            })}
          </svg>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
            <span className="muted" style={{ fontSize: 9.5, fontFamily: "var(--mono)" }}>{fmtDay(series[0].date)}</span>
            <span className="muted" style={{ fontSize: 9.5, fontFamily: "var(--mono)" }}>{fmtDay(series[series.length - 1].date)}</span>
          </div>
          {/* 51 · spend anomaly callout — names the days that broke pattern. */}
          {monthAnoms.length > 0 && (
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              <span className="muted" style={{ fontSize: 10.5 }}>Spend anomalies:</span>
              {monthAnoms.slice(0, 4).map((a) => (
                <span key={a.label} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span className="muted" style={{ fontSize: 10, fontFamily: "var(--mono)" }}>{fmtDay(a.label)}</span>
                  <AnomalyBadge anomaly={a} text={a.direction === "high" ? "spike" : "collapse"} />
                </span>
              ))}
              {monthAnoms.length > 4 && <span className="muted" style={{ fontSize: 10 }}>+{monthAnoms.length - 4} more</span>}
            </div>
          )}
          <div className="muted" style={{ fontSize: 10.5, marginTop: 8 }}>
            The channel daily total (Snell) and the SP per-ASIN file (₹{D.fmtN(spTotal)}) cover the SAME May window — the
            remainder ({attrib.suppressed ? "—" : D.fmtINR(Math.max(0, total - spTotal))}) is unattributed AMS spend allocated by revenue in the deep-dive below.
          </div>
        </>
      )}
    </Card>
  );
};

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 4b — Website DAILY ROAS + anomaly (rubric 51/52).
 * The website ad view was monthly; this gives the website ad rupee the SAME
 * daily ROAS + anomaly treatment the Amazon AMS daily series gets. ROAS is
 * same-day net ÷ same-day ad (window-integral — no cross-window artifact). Days
 * that broke pattern (≥2σ on the ROAS series vs its trailing window) are named.
 * ════════════════════════════════════════════════════════════════════════ */
const WINDOW_PRESETS = [30, 60, 90];
const WebsiteDailyEfficiency = ({ facts, D }) => {
  const [span, setSpan] = useState(60);
  const eff = useMemo(() => safeCall(() => channelDailyEfficiency(facts, { channel: "website", window: 14, lastN: span })) || { days: [], roasAnomalies: [], summary: {} }, [facts, span]);
  const days = eff.days || [];
  if (days.length === 0) {
    return (
      <Card title="Website daily ad efficiency · ROAS & anomalies" sub="Daily website ROAS (net ÷ ad, same day) with ≥2σ anomaly flags — the same daily treatment Amazon AMS gets." style={{ marginBottom: 14 }}>
        <div className="muted" style={{ fontSize: 12.5 }}>No daily website ad-spend rows in the fact store.</div>
      </Card>
    );
  }
  const maxRoas = Math.max(1, ...days.map((d) => num(d.roas)));
  const anomDays = days.filter((d) => d.anomaly || d.flag === "zero-sale");
  const sum = eff.summary || {};
  // breakeven ROAS ≈ 1 / CM2% is channel-specific; here we anchor the visual on a
  // ROAS=1 (revenue == spend) reference line — below it, the day's ad lost money
  // on a pure-revenue basis (margin makes the true breakeven higher; shown in ⓘ).
  const refY = (1 / maxRoas) * 28;
  return (
    <Card
      title="Website daily ad efficiency · ROAS & anomalies"
      sub={`Daily website ROAS (same-day net ÷ same-day ad — window-safe) across the last ${span} ad-days, with ≥2σ ROAS anomalies named. Parity with the Amazon AMS daily view.`}
      style={{ marginBottom: 14 }}
      action={
        <div className="seg">
          {WINDOW_PRESETS.map((p) => <button key={p} className={span === p ? "active" : ""} onClick={() => setSpan(p)}>{p}d</button>)}
        </div>
      }
    >
      <div style={{ display: "flex", gap: 18, marginBottom: 10, flexWrap: "wrap" }}>
        <div>
          <div className="stat-num">{sum.roas != null ? sum.roas.toFixed(2) + "×" : "—"}</div>
          <div className="muted" style={{ fontSize: 10.5 }}>blended ROAS · {sum.days} ad-days</div>
        </div>
        <div>
          <div className="stat-num">{D.fmtINR(sum.ad)}</div>
          <div className="muted" style={{ fontSize: 10.5 }}>total ad spend</div>
        </div>
        <div>
          <div className="stat-num">{D.fmtINR(sum.net)}</div>
          <div className="muted" style={{ fontSize: 10.5 }}>net rev on ad-days</div>
        </div>
      </div>
      {/* daily ROAS bars — anomaly days tinted; a ROAS=1 reference line. */}
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" style={{ width: "100%", height: 70, display: "block" }}>
        <line x1="0" y1={30 - refY} x2="100" y2={30 - refY} stroke="var(--border)" strokeWidth="0.2" strokeDasharray="0.8 0.8" />
        {days.map((d, i) => {
          const bw = 100 / days.length;
          const h = (num(d.roas) / maxRoas) * 28;
          const fill = d.flag === "zero-sale" ? "var(--critical)"
            : d.flag === "roas-drop" ? "var(--info)"
            : d.flag === "roas-spike" ? "var(--success)"
            : num(d.roas) < 1 ? "#C9A227" : "#4F46E5";
          return <rect key={i} x={i * bw + bw * 0.12} y={30 - h} width={bw * 0.76} height={Math.max(0.4, h)} fill={fill} opacity={d.anomaly ? 0.98 : 0.78}>
            <title>{`${fmtDay(d.iso)} · ROAS ${num(d.roas).toFixed(2)}× · net ${D.fmtINR(d.net)} / ad ${D.fmtINR(d.ad)}${d.anomaly ? ` · ${Math.abs(num(d.z)).toFixed(1)}σ ${d.flag === "roas-drop" ? "ROAS drop" : "ROAS spike"}` : ""}${d.flag === "zero-sale" ? " · ZERO-SALE ad day" : ""}`}</title>
          </rect>;
        })}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
        <span className="muted" style={{ fontSize: 9.5, fontFamily: "var(--mono)" }}>{fmtDay(days[0].iso)}</span>
        <span className="muted" style={{ fontSize: 9.5, fontFamily: "var(--mono)" }}>{fmtDay(days[days.length - 1].iso)}</span>
      </div>
      {anomDays.length > 0 && (
        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 10.5 }}>ROAS anomalies:</span>
          {anomDays.slice(0, 5).map((d) => (
            <span key={d.iso} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span className="muted" style={{ fontSize: 10, fontFamily: "var(--mono)" }}>{fmtDay(d.iso)}</span>
              {d.flag === "zero-sale"
                ? <span className="badge" style={{ fontSize: 8.5, background: "rgba(214,69,69,0.14)", color: "var(--critical)" }}>0× zero-sale</span>
                : <AnomalyBadge anomaly={{ z: num(d.z), direction: d.flag === "roas-spike" ? "high" : "low" }} text={d.flag === "roas-spike" ? "ROAS spike" : "ROAS drop"} />}
            </span>
          ))}
          {anomDays.length > 5 && <span className="muted" style={{ fontSize: 10 }}>+{anomDays.length - 5} more</span>}
        </div>
      )}
      <div className="muted" style={{ fontSize: 10.5, marginTop: 8 }}>
        Each bar is one ad-day's <strong>ROAS = same-day net ÷ same-day ad spend</strong> (both sides one day → no
        cross-window artifact). The dashed line is ROAS = 1 (revenue == spend); below it the day lost money on a
        pure-revenue basis (the true margin breakeven is higher — see the per-SKU breakeven-ACOS below).
        Anomalies are ≥2σ moves on the ROAS series vs its trailing-14d window. Source: Monarch daily (net) + website
        daily ad spend, both already in the fact store.
      </div>
    </Card>
  );
};

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 3b — Website Google vs Meta split (Monarch), monthly.
 * ════════════════════════════════════════════════════════════════════════ */
const WebsiteSplit = ({ facts, D }) => {
  const byMonth = facts?.meta?.bySource?.["monarch-history"]?.byMonth || {};
  const rows = Object.entries(byMonth)
    .map(([month, v]) => ({
      month,
      google: num(v.googleSpend),
      meta: num(v.metaSpend),
      total: num(v.googleSpend) + num(v.metaSpend),
      partial: !!(v.lastDay && v.lastDay < monthEndISO(month)),
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const maxV = Math.max(1, ...rows.map((r) => r.total));
  const gTot = rows.reduce((a, r) => a + r.google, 0);
  const mTot = rows.reduce((a, r) => a + r.meta, 0);
  const grand = gTot + mTot;

  // III-96 · website ad-total reconciliation. The Google+Meta per-platform columns
  // (what we plot) vs Monarch's OWN "Total Spend" column — surface the delta as an
  // explicit reconciliation line (the same discipline Amazon's AMS / SP recon gets),
  // never silently absorbing the un-broken-out remainder. Same-window (per month).
  const webSpend = facts?.meta?.bySource?.["monarch-web"]?.monarchWebSpend || null;
  const webHistory = facts?.meta?.bySource?.["monarch-web"]?.monarchWebHistory || {};
  // months where Monarch's own total exceeds the platform split (a real delta to show).
  const reconMonths = Object.entries(webHistory)
    .map(([month, v]) => ({ month, googleMeta: num(v.googleMeta), totalSpend: num(v.totalSpend), reconDelta: num(v.reconDelta) }))
    .filter((r) => Math.abs(r.reconDelta) > 0.5)
    .sort((a, b) => a.month.localeCompare(b.month));

  return (
    <Card
      title="Website spend · Google vs Meta"
      sub="Monarch monthly website ad split. Meta starts Aug-2025; the rest is Google. Stacked monthly + period share."
    >
      {rows.length === 0 ? (
        <div className="muted" style={{ fontSize: 12.5 }}>No Monarch website-spend history loaded.</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 18, marginBottom: 10 }}>
            <div>
              <div className="stat-num" style={{ color: "#4285F4" }}>{D.fmtINR(gTot)}</div>
              <div className="muted" style={{ fontSize: 10.5 }}>Google · {grand > 0 ? ((gTot / grand) * 100).toFixed(0) : 0}%</div>
            </div>
            <div>
              <div className="stat-num" style={{ color: "#0866FF" }}>{D.fmtINR(mTot)}</div>
              <div className="muted" style={{ fontSize: 10.5 }}>Meta · {grand > 0 ? ((mTot / grand) * 100).toFixed(0) : 0}%</div>
            </div>
          </div>
          <svg viewBox="0 0 100 30" preserveAspectRatio="none" style={{ width: "100%", height: 64, display: "block" }}>
            {rows.map((r, i) => {
              const bw = 100 / rows.length;
              const gh = (r.google / maxV) * 28;
              const mh = (r.meta / maxV) * 28;
              return (
                <g key={i} opacity={r.partial ? 0.5 : 1}>
                  <rect x={i * bw + bw * 0.12} y={30 - gh} width={bw * 0.76} height={gh} fill="#4285F4" />
                  <rect x={i * bw + bw * 0.12} y={30 - gh - mh} width={bw * 0.76} height={mh} fill="#0866FF" />
                </g>
              );
            })}
          </svg>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
            <span className="muted" style={{ fontSize: 9.5, fontFamily: "var(--mono)" }}>{fmtMonthShort(rows[0].month)}</span>
            <span className="muted" style={{ fontSize: 9.5, fontFamily: "var(--mono)" }}>{fmtMonthShort(rows[rows.length - 1].month)}{rows[rows.length - 1].partial ? "*" : ""}</span>
          </div>
          <div className="muted" style={{ fontSize: 10.5, marginTop: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, marginRight: 12 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: "#4285F4", display: "inline-block" }} /> Google
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: "#0866FF", display: "inline-block" }} /> Meta
            </span>
            &nbsp;· * = partial MTD
          </div>

          {/* III-96 · website ad-total reconciliation — Monarch's own "Total Spend"
              column vs the Google+Meta platform split we plot. The ~₹5.1K (May) delta
              is the un-broken-out spend in Monarch's total not attributed to a
              platform; surfaced as an explicit recon line (like Amazon's), not absorbed. */}
          {webSpend && Math.abs(num(webSpend.reconDelta)) > 0.5 && (
            <div className="note" style={{ marginTop: 12, borderLeft: "3px solid var(--warning)", paddingLeft: 10 }}>
              <div style={{ fontSize: 11.5, lineHeight: 1.55 }}>
                <strong style={{ color: "var(--ink-2)" }}>Spend reconciliation · {fmtMonth(webSpend.month)}.</strong>{" "}
                Google <strong>{D.fmtINR(webSpend.googleTotal)}</strong> + Meta <strong>{D.fmtINR(webSpend.metaTotal)}</strong> ={" "}
                <strong>{D.fmtINR(webSpend.attributed)}</strong> attributed by platform; Monarch&apos;s own{" "}
                <em>Total&nbsp;Spend</em> column reads <strong>{D.fmtINR(webSpend.monarchTotalSpend)}</strong> ·{" "}
                <span style={{ color: "var(--warning)", fontWeight: 600 }}>delta {D.fmtINR(webSpend.reconDelta)}</span>.
              </div>
              <div className="muted" style={{ fontSize: 10.5, marginTop: 4, lineHeight: 1.5 }}>
                The {D.fmtINR(webSpend.reconDelta)} is un-broken-out website spend in Monarch&apos;s total that isn&apos;t split per
                platform — shown here, not folded silently into the chart. The Google-vs-Meta efficiency view below uses only the
                platform-attributed split (so each ROAS/CPA stays same-window). Source: Monarch website Master Sheet — Google Spend +
                Meta Spend columns vs the Total Spend column.
                {reconMonths.length > 1 && (
                  <>
                    {" "}This delta appears in {reconMonths.length} month{reconMonths.length === 1 ? "" : "s"}
                    {" "}({reconMonths.map((r) => `${fmtMonthShort(r.month)} ${D.fmtINR(r.reconDelta)}`).join(" · ")}); every other month the
                    platform split equals Monarch&apos;s total exactly (delta ₹0).
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
};

/* ══════════════════════════════════════════════════════════════════════════
 * XI / 83 — PER-SOURCE RECENCY LINE.
 * The page header carries a single "Data through <latest>" pill, but the ad/sales
 * feeds update on DIFFERENT cadences — Amazon/Flipkart/Google ad files land monthly
 * (May), Snell + Monarch website run daily (to Jun-10), and the Monarch SEO tab lags
 * a quarter (Feb-18). One global date hides that. This line shows, per source this
 * page reads, its true latest data day and how many days behind the live front it
 * sits — so the founder never reads a Feb SEO rank as today's. Reads the engine's
 * meta.sourceRecency (already clamped to latestDataDate so a forward-dated label can't
 * overstate freshness) + meta.sourceLabels for the human name + tier.
 * ════════════════════════════════════════════════════════════════════════ */
// the ad/sales sources THIS page surfaces, in reading order. Only sources actually
// present in the store render; anything missing is skipped (never a blank row).
const MKT_RECENCY_SOURCES = [
  "ads-amazon-sp", "ads-fk-pla", "ads-google",
  "snell-history", "snell-agency",
  "monarch-web", "monarch-platform", "monarch-seo",
];
const RECENCY_TIER_PILL = {
  native:        { bg: "var(--success-soft)", fg: "var(--success)" },
  "native-fuzzy":{ bg: "rgba(183,121,31,0.16)", fg: "#B7791F" },
  agency:        { bg: "var(--info-soft)", fg: "var(--info)" },
  monarch:       { bg: "rgba(99,102,241,0.14)", fg: "#4F46E5" },
};
const SourceRecency = ({ facts }) => {
  const recency = facts?.meta?.sourceRecency || {};
  const labels = facts?.meta?.sourceLabels || {};
  const latest = facts?.meta?.latestDataDate || null;
  const rows = MKT_RECENCY_SOURCES
    .filter((slug) => recency[slug] || labels[slug])               // present at all
    .map((slug) => {
      const day = recency[slug] || null;                            // already clamped to latest
      const st = staleness(day, latest);                            // whole-day lag behind the live front
      return { slug, day, label: labels[slug]?.label || slug, tier: labels[slug]?.tier || "agency", stale: st };
    });
  if (rows.length === 0) return null;
  return (
    <Card
      title="Per-source freshness"
      sub={`Each ad/sales feed this page reads, with its true latest data day and how far it sits behind the live front (${fmtDay(latest)}). The feeds update on different cadences — the marketplace ad files are monthly, Snell + Monarch website are daily, the SEO tab lags — so a single "data through" date would hide which numbers are current.`}
      style={{ marginBottom: 14 }}
      padded={false}
    >
      <table className="table">
        <thead>
          <tr>
            <th>Source</th>
            <th>Tier</th>
            <th className="num">Latest data</th>
            <th className="num">Behind live front</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pill = RECENCY_TIER_PILL[r.tier] || RECENCY_TIER_PILL.agency;
            const severe = r.stale?.severe;
            return (
              <tr key={r.slug}>
                <td>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontWeight: 600, fontSize: 12 }}>{r.label}</span>
                    <span className="muted" style={{ fontFamily: "var(--mono)", fontSize: 10 }}>{r.slug}</span>
                  </div>
                </td>
                <td><span className="badge" style={{ background: pill.bg, color: pill.fg, fontSize: 9.5, fontWeight: 700 }}>{r.tier}</span></td>
                <td className="num" style={{ fontFamily: "var(--mono)", fontSize: 11.5 }}>{r.day ? fmtDay(r.day) : <span className="muted">—</span>}</td>
                <td className="num" style={{ fontFamily: "var(--mono)", fontSize: 11.5 }}>
                  {!r.day ? <span className="muted">—</span>
                    : !r.stale ? <span style={{ color: "var(--success)" }}>current</span>
                    : <span style={{ color: severe ? "var(--critical)" : "var(--warning)", fontWeight: 600 }}>{severe ? "⚠ " : ""}{r.stale.days}d behind</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="muted" style={{ fontSize: 10.5, padding: "8px 14px", lineHeight: 1.5 }}>
        &quot;Behind live front&quot; = whole days between this source&apos;s latest data day and the page&apos;s live
        data-through date ({fmtDay(latest)}); <strong>current</strong> means it reaches the front. Recency is clamped to
        the live front, so a forward-dated label can never overstate freshness. The per-ASIN / per-SKU / Google ad files
        are monthly (latest May), Snell and Monarch website run daily, and the Monarch SEO tab is on a slower cadence —
        re-upload any source from the Upload panel to refresh its window. Consistent with the inventory module&apos;s
        &quot;Data through&quot; freshness label.
      </div>
    </Card>
  );
};

/* ══════════════════════════════════════════════════════════════════════════
 * VIEW C — Google vs Meta efficiency side-by-side (the budgeting decision view).
 * Monthly ROAS + CPA per platform from Monarch's own daily columns (pre-computed
 * same-window per platform×month in meta.bySource["monarch-platform"]). This is
 * the "where should the next rupee go" comparison. Months where a platform did
 * not run (Meta starts Aug-2025) render "—", never a fake 0 ROAS. The latest
 * month (June) is partial-MTD and badged; excluded from the headline averages.
 * Ratio discipline: ROAS = convValue/spend, CPA = spend/sales — both sides of
 * each ratio are the SAME platform×month window, so they are same-window-legit.
 * ════════════════════════════════════════════════════════════════════════ */
const PlatformEfficiency = ({ facts, D }) => {
  const rows = useMemo(() => {
    const plat = facts?.meta?.bySource?.["monarch-platform"]?.byMonth || {};
    // partial-month detection reuses the Monarch history lastDay vs month-end, the
    // same signal WebsiteSplit uses (the platform tab carries no lastDay itself).
    const hist = facts?.meta?.bySource?.["monarch-history"]?.byMonth || {};
    return Object.entries(plat)
      .map(([month, v]) => {
        const g = v.google || {}, m = v.meta || {};
        const ld = hist[month]?.lastDay || null;
        const partial = !!(ld && ld < monthEndISO(month));
        // A platform "ran" this month iff it spent. ROAS/CPA only meaningful then.
        const gRan = num(g.spend) > 0, mRan = num(m.spend) > 0;
        return {
          month, partial, lastDay: ld,
          google: gRan ? { spend: num(g.spend), roas: numOrNull(g.roas), cpa: numOrNull(g.cpa), sales: num(g.sales) } : null,
          meta:   mRan ? { spend: num(m.spend), roas: numOrNull(m.roas), cpa: numOrNull(m.cpa), sales: num(m.sales) } : null,
        };
      })
      .sort((a, b) => a.month.localeCompare(b.month));
  }, [facts]);

  // Headline averages — complete months only, spend-weighted ROAS / CPA per
  // platform. Spend-weighting keeps the blended ratio same-window-honest (pooled
  // numerator ÷ pooled denominator within one platform), not a mean-of-ratios.
  const headline = useMemo(() => {
    const acc = { google: { spend: 0, convValue: 0, sales: 0 }, meta: { spend: 0, convValue: 0, sales: 0 } };
    for (const r of rows) {
      if (r.partial) continue;
      for (const p of ["google", "meta"]) {
        const cell = r[p]; if (!cell) continue;
        acc[p].spend += num(cell.spend);
        acc[p].convValue += num(cell.roas) * num(cell.spend);  // roas×spend ≈ convValue
        acc[p].sales += num(cell.sales);
      }
    }
    const blend = (p) => {
      const a = acc[p];
      const roas = guardRatio({ numerator: a.convValue, denominator: a.spend, numWindow: "period" + p, denWindow: "period" + p, kind: "roas" });
      const cpa = guardRatio({ numerator: a.spend, denominator: a.sales, numWindow: "period" + p, denWindow: "period" + p, kind: "acos" });
      return { spend: a.spend, roas: roas.suppressed ? null : roas.value, cpa: cpa.suppressed ? null : cpa.value };
    };
    return { google: blend("google"), meta: blend("meta") };
  }, [rows]);

  if (rows.length === 0) {
    return (
      <Card title="Google vs Meta · efficiency" sub="Monthly ROAS & CPA per platform — the budgeting decision view." style={{ marginBottom: 14 }}>
        <div className="muted" style={{ fontSize: 12.5 }}>No Monarch platform (Google/Meta) history loaded.</div>
      </Card>
    );
  }

  // axis tops for the two mini-charts (ROAS and CPA), complete + partial pooled.
  const allRoas = rows.flatMap((r) => [r.google?.roas, r.meta?.roas]).filter((v) => v != null && Number.isFinite(v));
  const allCpa = rows.flatMap((r) => [r.google?.cpa, r.meta?.cpa]).filter((v) => v != null && Number.isFinite(v));
  const maxRoas = Math.max(1, ...allRoas);
  const maxCpa = Math.max(1, ...allCpa);

  return (
    <Card
      title="Google vs Meta · efficiency"
      sub="Monthly ROAS (revenue ÷ spend, higher = better) and CPA (cost per acquisition, lower = better) per platform, from Monarch's own daily columns. The budgeting decision view: where the next website rupee earns more. Each ratio is same-window (one platform × one month). Meta starts Aug-2025; months a platform didn't run show — not a fake zero."
      style={{ marginBottom: 14 }}
    >
      {/* headline blended ROAS / CPA per platform (complete months, spend-weighted) */}
      <div style={{ display: "flex", gap: 28, flexWrap: "wrap", marginBottom: 14 }}>
        <PlatformHeadline label="Google" color="#4285F4" h={headline.google} D={D} />
        <PlatformHeadline label="Meta" color="#0866FF" h={headline.meta} D={D} />
        <div style={{ alignSelf: "center", maxWidth: 260 }}>
          <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.5 }}>
            {decisionNote(headline)}
          </div>
        </div>
      </div>

      {/* two side-by-side mini line charts: ROAS (left), CPA (right) */}
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <PlatformMetricChart title="ROAS (higher = better)" rows={rows} metric="roas" max={maxRoas} fmt={(v) => v.toFixed(2) + "×"} />
        <PlatformMetricChart title="CPA (lower = better)" rows={rows} metric="cpa" max={maxCpa} fmt={(v) => "₹" + D.fmtN(Math.round(v))} invertGood />
      </div>

      <div className="muted" style={{ fontSize: 10.5, marginTop: 12, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 14, height: 3, borderRadius: 2, background: "#4285F4", display: "inline-block" }} /> Google
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 14, height: 3, borderRadius: 2, background: "#0866FF", display: "inline-block" }} /> Meta
        </span>
        <span>· * = partial MTD (excluded from blended averages) · gap = platform did not run that month</span>
      </div>
    </Card>
  );
};

// Headline ROAS/CPA block for one platform.
const PlatformHeadline = ({ label, color, h, D }) => (
  <div>
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: "inline-block" }} />
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)" }}>{label}</span>
    </div>
    <div style={{ display: "flex", gap: 16 }}>
      <div>
        <div className="stat-num" style={{ color }}>{h.roas == null ? "—" : h.roas.toFixed(2) + "×"}</div>
        <div className="muted" style={{ fontSize: 10 }}>blended ROAS</div>
      </div>
      <div>
        <div className="stat-num">{h.cpa == null ? "—" : "₹" + D.fmtN(Math.round(h.cpa))}</div>
        <div className="muted" style={{ fontSize: 10 }}>blended CPA</div>
      </div>
    </div>
    <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>{D.fmtINR(h.spend)} spend · complete mo</div>
  </div>
);

// One metric (ROAS or CPA) as two overlaid monthly lines (Google + Meta).
const PlatformMetricChart = ({ title, rows, metric, max, fmt, invertGood }) => {
  const [hover, setHover] = useState(null);
  const W = 100 / rows.length;
  const ptsFor = (p) =>
    rows
      .map((r, i) => { const v = r[p]?.[metric]; return v == null || !Number.isFinite(v) ? null : `${(i + 0.5) * W},${(1 - Math.min(1, v / max)) * 100}`; })
      .filter(Boolean)
      .join(" ");
  const gPts = ptsFor("google"), mPts = ptsFor("meta");
  const hv = hover != null ? rows[hover] : null;

  return (
    <div style={{ position: "relative" }}>
      <div style={{ fontSize: 11, color: "var(--ink-3)", marginBottom: 6 }}>{title}</div>
      <div style={{ position: "relative", height: 120 }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: 100, display: "block", overflow: "visible" }}>
          {[0.25, 0.5, 0.75].map((g) => (
            <line key={g} x1="0" y1={g * 100} x2="100" y2={g * 100} stroke="var(--border-soft)" strokeWidth="0.3" />
          ))}
          {gPts && <polyline points={gPts} fill="none" stroke="#4285F4" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
          {mPts && <polyline points={mPts} fill="none" stroke="#0866FF" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
          {rows.map((r, i) => {
            const gv = r.google?.[metric], mv = r.meta?.[metric];
            return (
              <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                {gv != null && Number.isFinite(gv) && <circle cx={(i + 0.5) * W} cy={(1 - Math.min(1, gv / max)) * 100} r="1.1" fill="#4285F4" opacity={r.partial ? 0.5 : 1} vectorEffect="non-scaling-stroke" />}
                {mv != null && Number.isFinite(mv) && <circle cx={(i + 0.5) * W} cy={(1 - Math.min(1, mv / max)) * 100} r="1.1" fill="#0866FF" opacity={r.partial ? 0.5 : 1} vectorEffect="non-scaling-stroke" />}
                <rect x={i * W} y={0} width={W} height={100} fill="transparent" />
              </g>
            );
          })}
        </svg>
        <div style={{ display: "flex", marginTop: 2 }}>
          {rows.map((r, i) => (
            <div key={i} style={{ width: W + "%", textAlign: "center", fontSize: 8, color: hover === i ? "var(--ink)" : "var(--ink-4)", fontFamily: "var(--mono)" }}>
              {MONTH_NAMES[Number(r.month.split("-")[1]) - 1]}{r.partial ? "*" : ""}
            </div>
          ))}
        </div>
      </div>
      <div className="muted" style={{ fontSize: 10.5, marginTop: 6, minHeight: 26 }}>
        {hv ? (
          <span>
            <strong style={{ color: "var(--ink-2)" }}>{fmtMonth(hv.month)}{hv.partial ? " (MTD)" : ""}</strong> ·{" "}
            <span style={{ color: "#4285F4" }}>G {hv.google?.[metric] != null ? fmt(hv.google[metric]) : "—"}</span> ·{" "}
            <span style={{ color: "#0866FF" }}>M {hv.meta?.[metric] != null ? fmt(hv.meta[metric]) : "—"}</span>
          </span>
        ) : (
          <span>Hover a month. {invertGood ? "Lower CPA is better." : "Higher ROAS is better."} Faded dot = partial-MTD; gap = platform did not run.</span>
        )}
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════════════════
 * VIEW B — SEO keyword-rank panel (Monarch "SEO - Keywords" tab).
 * Top keywords with rank now vs 30/90d ago and a movement arrow. Lower rank =
 * better (rank 1 is #1), so an UP arrow (improvement) = the rank NUMBER dropped.
 * movement = prev − latest (+ve = improved). No ratios → no guardRatio needed;
 * this is rank arithmetic, not a same-window division.
 * ════════════════════════════════════════════════════════════════════════ */
const SeoKeywordRanks = ({ facts }) => {
  const seo = facts?.meta?.bySource?.["monarch-seo"] || null;
  const [showAll, setShowAll] = useState(false);

  const kws = useMemo(() => {
    const list = (seo?.keywords || []).slice();
    // Sort: best current rank first; ties broken by bigger 30d improvement.
    list.sort((a, b) => (num(a.latest) - num(b.latest)) || (num(b.movement30) - num(a.movement30)));
    return list;
  }, [seo]);

  if (!seo || kws.length === 0) {
    return (
      <Card title="SEO keyword ranks" sub="Top keyword positions over time (Monarch SEO tab)." style={{ marginBottom: 14 }}>
        <div className="muted" style={{ fontSize: 12.5 }}>No Monarch SEO keyword history loaded.</div>
      </Card>
    );
  }

  const shown = showAll ? kws : kws.slice(0, 12);
  const latestDate = seo.staleAsOf || seo.latestDate || seo.dates?.[seo.dates.length - 1];
  const firstDate = seo.dates?.[0];
  // VI-96 · staleness — how many days since the last SEO snapshot, vs the live
  // data-through date. The SEO tab is a separate cadence from sales/ad data and
  // tends to lag; the founder must read these ranks knowing how old they are.
  const stale = staleness(latestDate, facts?.meta?.latestDataDate);
  // counts for the headline: top-3 / top-10 at the latest snapshot + net movers.
  const top3 = kws.filter((k) => num(k.latest) > 0 && num(k.latest) <= 3).length;
  const top10 = kws.filter((k) => num(k.latest) > 0 && num(k.latest) <= 10).length;
  const improved = kws.filter((k) => num(k.movement30) > 0).length;
  const declined = kws.filter((k) => num(k.movement30) < 0).length;

  return (
    <Card
      title="SEO keyword ranks"
      sub={`Where Naturesum ranks on its tracked keywords, latest vs 30 days ago (Monarch SEO tab). Lower rank = better — rank 1 is the #1 result. An ↑ arrow means the position improved (the rank number dropped). ${seo.totalKeywords} keywords tracked across ${seo.dates?.length || 0} snapshots (${fmtSeoDate(firstDate)} → ${fmtSeoDate(latestDate)}).`}
      padded={false}
      action={
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {stale && (
            <span
              className="cov-badge sm"
              style={{ background: stale.severe ? "var(--critical)" : "var(--warning)", color: stale.severe ? "#fff" : "#1a1206", borderColor: "transparent", fontWeight: 600, fontSize: 10 }}
              title={`The SEO tab's latest snapshot is ${fmtSeoDate(latestDate)} — ${stale.days} days before the page's live data-through date. SEO ranks are on a slower cadence than sales/ad data; re-upload the Monarch SEO tab to refresh.`}
            >
              ⚠ SEO stale · {fmtSeoDate(latestDate)} ({stale.days}d old)
            </span>
          )}
          {kws.length > 12 ? (
            <button className="btn ghost" style={{ fontSize: 11 }} onClick={() => setShowAll((s) => !s)}>
              {showAll ? "Show top 12" : `Show all ${kws.length}`}
            </button>
          ) : null}
        </div>
      }
    >
      {/* VI-96 · prominent staleness banner — the ranks below are a stale snapshot;
          say so loudly so the founder never reads them as current. */}
      {stale && (
        <div className="card-body" style={{ paddingTop: 10, paddingBottom: 10 }}>
          <div className="note" style={{ borderLeft: `3px solid ${stale.severe ? "var(--critical)" : "var(--warning)"}`, paddingLeft: 10 }}>
            <span style={{ lineHeight: 1.55, fontSize: 11.5 }}>
              <strong style={{ color: stale.severe ? "var(--critical)" : "var(--warning)" }}>
                Stale snapshot — ranks as of {fmtSeoDate(latestDate)}, {stale.days} days old.
              </strong>{" "}
              The Monarch SEO tab updates on a slower cadence than the sales and ad feeds; this page&apos;s live data
              runs through {fmtDay(facts?.meta?.latestDataDate)}, but the latest keyword-rank snapshot is{" "}
              {fmtSeoDate(latestDate)}. Read these positions as a point-in-time reference, not today&apos;s ranks —
              re-upload the Monarch SEO tab to refresh.
            </span>
          </div>
        </div>
      )}

      {/* headline counts */}
      <div className="card-body" style={{ display: "flex", gap: 24, flexWrap: "wrap", paddingTop: 10, paddingBottom: 10, borderBottom: "1px solid var(--border-soft)" }}>
        <div>
          <div className="stat-num" style={{ color: "var(--success)" }}>{top3}</div>
          <div className="muted" style={{ fontSize: 10.5 }}>in top 3</div>
        </div>
        <div>
          <div className="stat-num">{top10}</div>
          <div className="muted" style={{ fontSize: 10.5 }}>in top 10</div>
        </div>
        <div>
          <div className="stat-num" style={{ color: improved ? "var(--success)" : undefined }}>↑ {improved}</div>
          <div className="muted" style={{ fontSize: 10.5 }}>improved · 30d</div>
        </div>
        <div>
          <div className="stat-num" style={{ color: declined ? "var(--critical)" : undefined }}>↓ {declined}</div>
          <div className="muted" style={{ fontSize: 10.5 }}>declined · 30d</div>
        </div>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Keyword</th>
            <th className="num">Rank now</th>
            <th className="num">30d ago</th>
            <th className="num">Move · 30d</th>
            <th className="num">First seen</th>
            <th className="num">Best</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((k, i) => (
            <tr key={i}>
              <td>
                {k.kw}
                <div className="sku">latest {fmtSeoDate(k.latestDate)}</div>
              </td>
              <td className="num"><strong>{rankLabel(k.latest)}</strong></td>
              <td className="num"><span className="muted">{rankLabel(k.prev30)}</span></td>
              <td className="num">{movementCell(k.movement30)}</td>
              <td className="num"><span className="muted">{rankLabel(k.earliest)}</span></td>
              <td className="num"><span className="muted">{rankLabel(k.best)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="card-body" style={{ paddingTop: 10 }}>
        <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.5 }}>
          <strong style={{ color: "var(--ink-3)" }}>Source:</strong> Monarch Master Sheet · &quot;SEO - Keywords&quot; tab (rank-over-time snapshots).
          Movement = rank 30 days ago − rank now: a positive number means the position climbed (rank number fell).
          A blank rank means the keyword was not tracked at that snapshot. Showing {shown.length} of {kws.length} ranked keywords.
        </div>
      </div>
    </Card>
  );
};

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 4 — May per-SKU deep-dive (NATIVE only).
 * Per-SKU × channel ROAS / ACOS / breakeven-ACOS with an adBasis chip on every
 * row, breakeven flag ONLY where same-window, and a zero-sale spend list.
 * ════════════════════════════════════════════════════════════════════════ */
const SkuDeepDive = ({ facts, month, D, skuName, skuVariant }) => {
  const cm = useMemo(() => computeCM({ facts, month }), [facts, month]);

  // Per-SKU × channel rows from the v1 matrix (this IS the native month). Each
  // cell's adBasis: ACTUAL if the channel has direct attribution, else ALLOC
  // (channel total spread by revenue), else AGENCY/NONE.
  const rows = useMemo(() => {
    // I-7 · SKU fuzzy-match identity. Most SKUs resolve by exact identifier across
    // every source; the website Google ad spend, however, is attributed from a
    // free-text product TITLE (numeric size pinned exactly, brand/variant by needle)
    // — a non-exact match. Flag ONLY where it's non-exact, and ONLY on the source it
    // affects (Google → website ad attribution), so the founder reads the website ad
    // figures knowing the join is title-based and verifies if a title is renamed.
    const skuIdentity = facts?.meta?.skuIdentity || {};
    const fuzzyChannelFor = (code) => {
      const id = skuIdentity[code];
      if (!id || !id.fuzzy || !Array.isArray(id.fuzzyVia)) return null;
      // ads-google fuzz feeds the WEBSITE channel's actual ad attribution.
      return id.fuzzyVia.some((v) => v.source === "ads-google") ? { channel: "website", note: id.note } : null;
    };
    const out = [];
    for (const code of Object.keys(cm.matrix)) {
      for (const ch of Object.keys(cm.matrix[code])) {
        const m = cm.matrix[code][ch];
        const cell = cm.bySku[code]?.byChannel?.[ch] || {};
        const spend = num(m.adSpend);
        const rev = num(m.netRev);
        const units = num(m.units);
        if (spend <= 0 && rev <= 0) continue;
        // adBasis per cell: direct attribution exists at channel → actual; else
        // this cell got an allocated share of a channel total → alloc.
        const alloc = cm.adAllocation[ch] || {};
        const basis = num(alloc.direct) > 0 ? AD_BASIS.ACTUAL : (spend > 0 ? AD_BASIS.ALLOC : AD_BASIS.NONE);

        // ROAS / ACOS gated through guardRatio — same window (native May, this
        // SKU×channel cell), so legitimate when both > 0; never Infinity.
        const win = month + ch + code;
        const roas = guardRatio({ numerator: rev, denominator: spend, numWindow: win, denWindow: win, kind: "roas" });
        const acos = guardRatio({ numerator: spend, denominator: rev, numWindow: win, denWindow: win, kind: "acos" });
        const breakevenAcos = cell.pcts?.cm2 ?? null;     // CM2% = margin available for ads
        // Loss flag ONLY when both ACOS and breakeven are known same-window.
        const losing = !acos.suppressed && acos.value != null && breakevenAcos != null && breakevenAcos > 0 && acos.value > breakevenAcos;
        // fuzzy ad-attribution flag for THIS row: only when the SKU's fuzzy match
        // feeds the same channel as this row (website ⇐ Google title match).
        const fz = fuzzyChannelFor(code);
        const fuzzy = fz && fz.channel === ch ? fz : null;
        out.push({
          code, ch, spend, rev, units,
          roas: roas.value, roasSup: roas.suppressed,
          acos: acos.value, acosSup: acos.suppressed,
          breakevenAcos, basis, losing,
          cm3: m.cm3, cm3Pct: m.cm3Pct,
          noCogs: cell.coverage?.cogs === false || cell.cm2 == null,
          zeroSale: spend > 0 && units <= 0,
          fuzzy,
        });
      }
    }
    out.sort((a, b) => b.spend - a.spend);
    return out;
  }, [cm, month, facts]);

  const spent = rows.filter((r) => r.spend > 0);
  const zeroSale = rows.filter((r) => r.zeroSale);
  // I-7 · distinct SKUs whose ad spend on a shown channel was title-matched (fuzzy).
  const fuzzyCodes = [...new Set(spent.filter((r) => r.fuzzy).map((r) => r.code))];
  // M4 — the "losing per ad rupee" COUNT is SKU-ATTRIBUTED only. Alloc-by-rev
  // rows share one channel-level ACOS, so an above-breakeven channel would flag
  // every SKU on it — that is ONE channel decision, not N SKU decisions, and
  // inflates the count. Alloc loss-rows stay visible (greyed) in the table; they
  // are surfaced separately as a channel-level note, never folded into the count.
  const losingAll = spent.filter((r) => r.losing);
  const losing = losingAll.filter((r) => r.basis !== AD_BASIS.ALLOC);   // count = SKU-attributed
  const losingAlloc = losingAll.filter((r) => r.basis === AD_BASIS.ALLOC);
  // distinct channels whose alloc-by-rev total is above breakeven (the real unit
  // of decision for alloc rows — one channel, not its many SKUs).
  const losingAllocChannels = [...new Set(losingAlloc.map((r) => r.ch))];

  return (
    <Card
      title={`May per-SKU ad deep-dive · ${fmtMonth(month)}`}
      sub="The only native per-SKU month: ROAS, ACOS and breakeven-ACOS (= CM2%) per SKU × channel. Every figure carries an ad-basis chip; breakeven flags only where the window is same-tier. Red ACOS = above breakeven (loss-making per ad rupee). The loss COUNT is SKU-attributed only — alloc-by-rev rows stay visible (greyed) but are reported at the channel level, not counted as SKU verdicts."
      action={<span className="badge" style={basisPill("native")}>native · per-SKU</span>}
      padded={false}
    >
      {/* basis legend */}
      <div className="card-body" style={{ paddingBottom: 8, borderBottom: "1px solid var(--border-soft)" }}>
        <div className="muted" style={{ fontSize: 11 }}>
          <strong style={{ color: "var(--ink-2)" }}>Ad-basis chips:</strong>&nbsp;
          <span className="badge" style={basisPill(AD_BASIS.ACTUAL)}>SP / PLA / Google actual</span> = platform per-product attribution (Amazon SP, Flipkart PLA, website Google product-wise) ·&nbsp;
          <span className="badge" style={basisPill(AD_BASIS.ALLOC)}>alloc by rev</span> = channel total split across SKUs by net revenue ·&nbsp;
          <span className="badge" style={basisPill(AD_BASIS.AGENCY)}>agency</span> = channel-grain total, no per-SKU split.
          No margin figure is shown without its basis.
          {fuzzyCodes.length > 0 && (
            <>
              {" "}<span className="badge amber" style={{ fontSize: 8.5 }}>~ title-matched</span> = the website Google ad spend on
              that SKU was attributed from a free-text product <em>title</em> (size token pinned exactly, brand/variant by needle),
              not an exact identifier — sales/units still resolve exactly; verify the ad join if a title is renamed
              ({fuzzyCodes.length} SKU{fuzzyCodes.length === 1 ? "" : "s"} flagged).
            </>
          )}
          {spent.some((r) => r.basis === AD_BASIS.ALLOC) && (
            <>
              {" "}<span style={{ color: "var(--ink-4)", fontStyle: "italic" }}>Greyed ROAS/ACOS/breakeven</span> cells are <span className="badge" style={basisPill(AD_BASIS.ALLOC)}>alloc by rev</span> rows — those
              ratios are identical for every SKU on the channel (a revenue split, not measured per-SKU ad efficiency); read them at the channel level, not as SKU verdicts.
            </>
          )}
        </div>
      </div>

      {/* loss-making + zero-sale callouts */}
      {(losingAll.length > 0 || zeroSale.length > 0) && (
        <div className="card-body" style={{ display: "flex", gap: 20, flexWrap: "wrap", paddingTop: 10, paddingBottom: 10, borderBottom: "1px solid var(--border-soft)" }}>
          <div>
            <div className="muted" style={{ fontSize: 10.5 }}>
              Losing per ad rupee (ACOS &gt; breakeven) · <span style={{ fontStyle: "italic" }}>SKU-attributed</span>
            </div>
            <div className="stat-num" style={{ color: losing.length ? "var(--critical)" : "var(--success)" }}>{losing.length}</div>
            {losingAllocChannels.length > 0 && (
              <div className="muted" style={{ fontSize: 9.5, fontStyle: "italic", maxWidth: 220 }} title="Alloc-by-rev SKUs share one channel-level ACOS, so an above-breakeven channel flags every SKU on it. That is one channel decision, not N SKU decisions — so these are reported as channels here and kept out of the SKU count above (the rows stay visible, greyed, in the table).">
                + {losingAllocChannels.length} alloc-by-rev channel{losingAllocChannels.length === 1 ? "" : "s"} above breakeven
                {" "}({losingAllocChannels.map((ch) => chMeta(ch).label).join(", ")}) — channel-level, excluded from the count
              </div>
            )}
          </div>
          <div>
            <div className="muted" style={{ fontSize: 10.5 }}>Zero-sale ad spend</div>
            <div className="stat-num" style={{ color: zeroSale.length ? "var(--critical)" : "var(--success)" }}>
              {zeroSale.length === 0 ? "₹0" : D.fmtINR(zeroSale.reduce((a, r) => a + r.spend, 0))}
            </div>
            <div className="muted" style={{ fontSize: 10 }}>{zeroSale.length} cell{zeroSale.length === 1 ? "" : "s"} · fully wasted</div>
          </div>
        </div>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Channel</th>
            <th className="num">Units</th>
            <th className="num">Net revenue</th>
            <th className="num">Ad spend</th>
            <th>Basis</th>
            <th className="num">ROAS</th>
            <th className="num">ACOS</th>
            <th className="num">Breakeven</th>
            <th className="num">CM3</th>
            <th className="num">CM3 %</th>
          </tr>
        </thead>
        <tbody>
          {spent.length === 0 && (
            <tr><td colSpan={11} className="muted" style={{ padding: 16, fontSize: 12.5 }}>No ad spend recorded for {fmtMonth(month)}.</td></tr>
          )}
          {spent.map((r, i) => {
            // alloc-by-rev rows have NO per-SKU ad data: ad spend is a uniform
            // revenue split, so ROAS/ACOS are identical across every SKU on the
            // channel and the breakeven flag carries no SKU-specific signal. Mute
            // those three cells (grey, no red loss tint) so the founder doesn't
            // over-trust a SKU-level verdict that is really just the revenue mix.
            const isAlloc = r.basis === AD_BASIS.ALLOC;
            const allocTip = "Ad spend is a revenue-proportional split of the channel total (no per-SKU ad data), so ROAS/ACOS are identical for every SKU on this channel and the breakeven flag is not SKU-specific. Read at the channel level.";
            const ratioStyle = isAlloc ? { color: "var(--ink-4)", fontStyle: "italic" } : undefined;
            return (
            <tr key={i}>
              <td>
                {skuName(r.code)}
                <div className="sku">
                  {r.code} · {skuVariant(r.code)}
                  {r.noCogs && <span className="badge amber" style={{ marginLeft: 6, fontSize: 9 }}>no COGS</span>}
                </div>
              </td>
              <td><span className="badge" style={pillStyle(r.ch)}>{chMeta(r.ch).label}</span></td>
              <td className="num">{r.units <= 0 ? <span style={{ color: "var(--critical)" }}>0</span> : D.fmtN(r.units)}</td>
              <td className="num">{D.fmtINR(r.rev)}</td>
              <td className="num">{D.fmtINR(r.spend)}</td>
              <td>
                <span className="badge" style={basisPill(r.basis)}>{basisLabel(r.basis, r.ch)}</span>
                {/* I-7 · fuzzy-match badge — ONLY on the website rows whose ad spend
                    was attributed from a Google product TITLE (non-exact), and only
                    when that channel carries actual (Google product-wise) attribution. */}
                {r.basis === AD_BASIS.ACTUAL && r.fuzzy && (
                  <span className="badge amber" style={{ marginLeft: 5, fontSize: 8.5, cursor: "help" }} title={r.fuzzy.note}>
                    ~ title-matched
                  </span>
                )}
              </td>
              <td className="num" style={ratioStyle} title={isAlloc ? allocTip : undefined}>{r.roasSup ? <WindowMismatch /> : (r.roas == null ? <span className="muted">—</span> : r.roas.toFixed(2) + "×")}</td>
              <td className="num" style={isAlloc ? ratioStyle : { color: r.losing ? "var(--critical)" : undefined }} title={isAlloc ? allocTip : undefined}>
                {r.acosSup ? <WindowMismatch /> : (r.acos == null ? <span className="muted">—</span> : fmtPct0(r.acos))}
              </td>
              <td className="num" style={ratioStyle} title={isAlloc ? allocTip : undefined}>{r.breakevenAcos == null ? <span className="muted">—</span> : fmtPct0(r.breakevenAcos)}</td>
              <td className="num" style={{ color: cm3Color(r.cm3) }}>{r.cm3 == null ? <span className="muted">—</span> : D.fmtINR(r.cm3)}</td>
              <td className="num" style={{ color: cm3Color(r.cm3) }}>{r.cm3Pct == null ? <span className="muted">—</span> : fmtPct1(r.cm3Pct)}</td>
            </tr>
            );
          })}
        </tbody>
      </table>

      {/* zero-sale spend detail */}
      {zeroSale.length > 0 && (
        <div className="card-body" style={{ borderTop: "1px solid var(--border-soft)" }}>
          <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
            <strong style={{ color: "var(--critical)" }}>Zero-sale ad spend</strong> — budget that converted no units this month:
          </div>
          {zeroSale.map((r, i) => (
            <div key={i} style={{ fontSize: 11.5, color: "var(--ink-3)", marginBottom: 2 }}>
              {skuName(r.code)} <span className="sku">{r.code}</span> · {chMeta(r.ch).label} ·{" "}
              <span style={{ color: "var(--critical)" }}>{D.fmtINR(r.spend)}</span> wasted
            </div>
          ))}
        </div>
      )}

      <div className="card-body" style={{ paddingTop: 10 }}>
        <div className="muted" style={{ fontSize: 11 }}>
          ROAS = net revenue ÷ ad spend · ACOS = ad spend ÷ net revenue · Breakeven ACOS = CM2% (margin left after COGS + platform fees).
          Both sides of every ratio come from the SAME native-May window, so the figures are directly comparable — a cross-window or
          near-zero-denominator division is suppressed as <WindowMismatch />, never shown as a raw number.
        </div>
      </div>
    </Card>
  );
};

// "window mismatch ⓘ" badge with a hover-explained popover — NEVER a raw number.
const WindowMismatch = () => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    const onDoc = () => setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDoc); };
  }, [open]);
  return (
    <span style={{ position: "relative", display: "inline-block" }} onMouseDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="badge amber"
        style={{ fontSize: 9, cursor: "pointer", border: "none" }}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        title="Why this ratio is suppressed"
      >
        window mismatch ⓘ
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", right: 0, marginTop: 4, width: 240, zIndex: 50,
          background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 6,
          boxShadow: "var(--shadow-md, 0 4px 16px rgba(0,0,0,0.18))", padding: 10, textAlign: "left",
          fontSize: 11, color: "var(--ink-2)", lineHeight: 1.5, fontWeight: 400,
        }}>
          This ratio was suppressed because its numerator and denominator do not share the same coverage window,
          or the denominator is ~zero. Dividing ad spend from one window by revenue from another produces a
          meaningless blow-up (the kind of absurd ACOS the founder flagged), so the figure is withheld rather than faked.
        </div>
      )}
    </span>
  );
};

/* ══════════════════════════════════════════════════════════════════════════
 * M2 — period ad-spend itemization footnote.
 * The all-period ad-spend headline (₹51.15L) is opaque without a breakdown; this
 * popover itemizes the total by channel — naming each channel's ad source incl.
 * the FK-side Google Spend column for website — with the window boundary (first→
 * last month that channel actually spent) so the ₹-total is fully traceable. Same
 * hover-popover style as the AMS / window-mismatch cards.
 * ════════════════════════════════════════════════════════════════════════ */
const PeriodSpendItemization = ({ byCh, total, months, D }) => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    const onDoc = () => setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDoc); };
  }, [open]);

  // Ordered channel rows, biggest spend first; only channels that actually spent.
  const rows = CH_ORDER.filter((ch) => byCh[ch])
    .map((ch) => ({ ch, ...byCh[ch] }))
    .filter((r) => num(r.spend) > 0)
    .sort((a, b) => b.spend - a.spend);

  return (
    <span style={{ position: "relative", display: "inline-block", fontWeight: 400 }} onMouseDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="badge"
        style={{ fontSize: 9, cursor: "pointer", border: "1px solid var(--border)", background: "var(--bg-soft, transparent)", color: "var(--ink-3)" }}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        title="Itemize this total by channel"
      >
        itemize ⓘ
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, marginTop: 4, width: 320, zIndex: 50,
          background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 6,
          boxShadow: "var(--shadow-md, 0 4px 16px rgba(0,0,0,0.18))", padding: 12, textAlign: "left",
          fontSize: 11, color: "var(--ink-2)", lineHeight: 1.5, fontWeight: 400, whiteSpace: "normal",
        }}>
          <div style={{ fontWeight: 600, color: "var(--ink-2)", marginBottom: 7 }}>
            Period ad spend by channel · {months} complete months
          </div>
          {rows.map((r) => {
            const pct = total > 0 ? (r.spend / total) * 100 : 0;
            return (
              <div key={r.ch} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 7 }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: chMeta(r.ch).color, display: "inline-block", marginTop: 3, flex: "0 0 auto" }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>{chMeta(r.ch).label}</span>
                    <span style={{ fontFamily: "var(--mono)" }}>{D.fmtINR(r.spend)} · {pct.toFixed(0)}%</span>
                  </div>
                  <div className="muted" style={{ fontSize: 9.5, lineHeight: 1.45 }}>
                    {chMeta(r.ch).adSource}
                    <br />
                    window {fmtMonthShort(r.firstSpend || r.first)} → {fmtMonthShort(r.lastSpend || r.last)} · {r.months} mo
                  </div>
                </div>
              </div>
            );
          })}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, borderTop: "1px solid var(--border-soft)", paddingTop: 6, marginTop: 2, fontWeight: 600 }}>
            <span>Total</span>
            <span style={{ fontFamily: "var(--mono)" }}>{D.fmtINR(total)}</span>
          </div>
          <div className="muted" style={{ fontSize: 9.5, marginTop: 6, fontStyle: "italic" }}>
            Website = Monarch Google Spend + Meta Spend columns (the FK-side Google Spend column on the Master Sheet);
            marketplace channels from Snell Sale-tab ad-spend columns. MTD (June) excluded.
          </div>
        </div>
      )}
    </span>
  );
};

/* ══════════════════════════════════════════════════════════════════════════
 * NEW · 23 — ATTRIBUTION-CONFIDENCE METER (per channel).
 * The keystone marketing-honesty gap: for the native month, what FRACTION of
 * each channel's ad spend (and therefore its CM3) is REAL per-product
 * attribution (Amazon SP / Flipkart PLA / Google product-wise) vs ALLOCATED by
 * revenue share. A CM3 that's 97%-measured is trustworthy; one that's 3%-measured
 * is a hint — and the founder must see which. Reads cmEngine.adAllocation
 * (direct / total / unattributed) — the SAME surface the verified engine uses,
 * so the equation `attributed + allocated = channel total` ties to the rupee.
 * ════════════════════════════════════════════════════════════════════════ */
const AttributionConfidence = ({ conf, month, D }) => {
  const rows = conf?.channels || [];
  return (
    <Card
      title="Ad attribution confidence"
      sub={`How much of each channel's ${fmtMonth(month)} ad spend is measured per-product vs allocated by revenue. A CM3 built on mostly-measured spend is trustworthy; one built on allocated spend is a hint. attributed + allocated = the channel's source total (shown).`}
      action={<span className="badge" style={basisPill("native")}>native · per-SKU</span>}
    >
      {rows.length === 0 ? (
        <div className="muted" style={{ fontSize: 12.5 }}>No ad allocation available for {fmtMonth(month)}.</div>
      ) : (
        <>
          {conf.total != null && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span className="stat-num lg">{fmtPct0(conf.total)}</span>
                <span className="muted" style={{ fontSize: 11.5 }}>of all ad spend is per-product measured</span>
              </div>
              <div className="muted" style={{ fontSize: 10.5 }}>
                {D.fmtINR(conf.directTotal)} measured + {D.fmtINR(conf.allocTotal)} allocated = {D.fmtINR(conf.spendTotal)} total
              </div>
            </div>
          )}
          {rows.map((r) => {
            const measuredPct = r.measured == null ? 0 : r.measured * 100;
            return (
              <div key={r.ch} style={{ marginBottom: 11 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span className="badge" style={pillStyle(r.ch)}>{chMeta(r.ch).label}</span>
                    <span className="muted" style={{ fontSize: 10.5 }}>{D.fmtINR(r.total)} spend</span>
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, fontFamily: "var(--mono)", color: confColor(r.measured) }}>
                      {r.measured == null ? "—" : fmtPct0(r.measured)} measured
                    </span>
                    <DerivationPopover
                      title={`Attribution · ${chMeta(r.ch).label} · ${fmtMonth(month)}`}
                      formula="measured% = direct-attributed spend ÷ channel total spend"
                      plain={`${ATTR_SOURCE[r.ch] || "Per-product ad attribution"} gives the measured share; the remainder is the channel total spread across SKUs by net-revenue share (allocated, not measured per SKU).`}
                      inputs={[
                        { label: "Per-product measured", value: D.fmtINR(r.direct) },
                        { label: "Allocated by revenue", value: D.fmtINR(r.alloc) },
                        { label: "Channel total (source)", value: D.fmtINR(r.total) },
                        { label: "attributed + allocated", value: D.fmtINR(r.direct + r.alloc) },
                      ]}
                      value={r.measured == null ? "—" : fmtPct0(r.measured) + " measured"}
                      source={ATTR_SOURCE[r.ch] || "channel total"}
                      asOf={fmtMonth(month)}
                      note={r.reconciles ? undefined : "⚠ attributed + allocated does not exactly equal the source total — see the inputs."}
                    />
                  </span>
                </div>
                {/* the meter: measured (green) vs allocated (amber) */}
                <div style={{ display: "flex", height: 9, borderRadius: 3, overflow: "hidden", background: "var(--border-soft)" }} title={`${fmtPct0(r.measured)} measured · ${fmtPct0(r.alloc / (r.total || 1))} allocated`}>
                  <div style={{ width: Math.max(0, Math.min(100, measuredPct)) + "%", background: "var(--success)" }} />
                  <div style={{ flex: 1, background: "#B7791F" }} />
                </div>
              </div>
            );
          })}
          <div className="muted" style={{ fontSize: 10.5, marginTop: 4, display: "flex", gap: 14, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: "var(--success)", display: "inline-block" }} /> measured (per-product)
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: "#B7791F", display: "inline-block" }} /> allocated by revenue
            </span>
          </div>
        </>
      )}
    </Card>
  );
};

/* ══════════════════════════════════════════════════════════════════════════
 * NEW · 53 — RANKED AD PRESCRIPTIONS (₹ impact).
 * Each ad-spend problem ends in a decision with a rupee/month estimate: stop
 * zero-sale ads (full spend recovered), cut/optimise CM3-negative ad cells
 * (the loss recovered toward breakeven), and a Google↔Meta reallocation hint.
 * Straight from bizAnalytics.adPrescriptions — sorted by |impact| desc, every
 * ratio gated, every claim sourced. "Losing per ad rupee" made actionable.
 * ════════════════════════════════════════════════════════════════════════ */
const SEV_META = {
  critical: { label: "Stop now", color: "var(--critical)" },
  warn: { label: "Optimise", color: "var(--warning)" },
  opportunity: { label: "Reallocate", color: "var(--info)" },
};
const AdPrescriptions = ({ rx, month, D, skuName }) => {
  const [showAll, setShowAll] = useState(false);
  const list = showAll ? rx : rx.slice(0, 6);
  const totalRecoverable = rx.filter((r) => r.impactPerMonth > 0).reduce((a, r) => a + r.impactPerMonth, 0);
  return (
    <Card
      title="Ad actions · ranked by ₹ impact"
      sub={`What to do about the ad budget this ${fmtMonth(month)}, highest rupee impact first: stop zero-sale spend, cut/optimise loss-making ad cells (ACOS above breakeven), reallocate between platforms. Each line is a decision, not a number.`}
      action={
        totalRecoverable > 0 ? (
          <span className="badge" style={{ ...basisPill(AD_BASIS.ACTUAL), fontSize: 10 }}
            title="Recoverable ₹ holds demand constant. Cutting ads usually loses some sales, so the realised CM3 gain is lower than this figure if demand falls — treat it as an upper bound.">
            ~{D.fmtINR(totalRecoverable)}/mo recoverable*
          </span>
        ) : null
      }
      padded={false}
    >
      {rx.length === 0 ? (
        <div className="card-body"><div className="muted" style={{ fontSize: 12.5 }}>No ad-spend problems flagged for {fmtMonth(month)} — every ad cell is at or above breakeven and converting.</div></div>
      ) : (
        <>
          <div className="card-body" style={{ paddingTop: 6, paddingBottom: 4 }}>
            {list.map((r) => {
              const sev = SEV_META[r.severity] || SEV_META.warn;
              return (
                <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0", borderBottom: "1px solid var(--border-soft)" }}>
                  <span style={{ width: 3, alignSelf: "stretch", borderRadius: 2, background: sev.color, flex: "0 0 auto", minHeight: 28 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>
                        {r.sku ? <>{actionVerb(r)} <span style={{ color: sev.color }}>{skuName(r.sku)}</span> · {chMeta(r.channel).label}</> : r.action}
                      </span>
                      <span className="badge" style={{ background: sev.color + "1c", color: sev.color, borderColor: sev.color + "55", fontSize: 9, flex: "0 0 auto" }}>{sev.label}</span>
                    </div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 2, lineHeight: 1.45 }}>{r.rationale}</div>
                  </div>
                  {r.impactPerMonth > 0 && (
                    <div style={{ textAlign: "right", flex: "0 0 auto" }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, fontFamily: "var(--mono)", color: "var(--success)" }}>+{D.fmtINR(r.impactPerMonth)}</div>
                      <div className="muted" style={{ fontSize: 9 }}>/mo</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {rx.length > 6 && (
            <div className="card-body" style={{ paddingTop: 6 }}>
              <button className="btn ghost" style={{ fontSize: 11 }} onClick={() => setShowAll((s) => !s)}>
                {showAll ? "Show top 6" : `Show all ${rx.length} actions`}
              </button>
            </div>
          )}
          <div className="card-body" style={{ paddingTop: 8, borderTop: "1px solid var(--border-soft)" }}>
            <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.5 }}>
              Impact = the CM3 recovered if the action is taken (zero-sale: the full wasted spend; loss cell: the loss erased toward breakeven). Reallocation hints carry no ₹ because the gain depends on headroom. All per-SKU, native-window, same-tier — every ratio gated.
              <br /><strong style={{ color: "#9A7B16" }}>* Assumes no demand loss.</strong> These figures hold volume constant; cutting an ad or raising price typically loses some sales, so the realised gain is lower (and could reverse) if demand falls. Read each ₹ as an upper bound, not a riskless saving.
            </div>
          </div>
        </>
      )}
    </Card>
  );
};

/* ══════════════════════════════════════════════════════════════════════════
 * NEW · 54/55 — AD-BUDGET WHAT-IF + DRIVER SENSITIVITY.
 * The reallocation decision as a simulator: move the ad-spend lever (and price/
 * COGS/fee) and watch CM3 move across every channel. Beside it, the driver
 * ranking — which lever moves company CM3 most for an equal shock — so the
 * founder spends effort on the highest-leverage knob. Pure margin mechanics
 * (no demand elasticity), stated. Same-window; COGS-uncovered channels excluded.
 * ════════════════════════════════════════════════════════════════════════ */
const AdScenario = ({ facts, month, D }) => {
  const compute = useMemo(() => (levers) => computeWhatIf(facts, { month, levers, costs: COSTS }), [facts, month]);
  const drivers = useMemo(() => safeCall(() => driverSensitivity(facts, { month, costs: COSTS, step: 0.05 }))?.drivers || [], [facts, month]);
  const maxDrv = Math.max(1, ...drivers.map((d) => Math.abs(d.deltaCm3)));

  return (
    <Card
      title="Ad-budget what-if · driver sensitivity"
      sub={`Move the ad-spend (or price / COGS / fee) lever and see the contribution-margin impact across ${fmtMonth(month)}, per channel. The driver ranking shows which lever moves company CM3 most for an equal 5% shock — where the founder's effort pays off. Margin mechanics only; demand response is not modelled.`}
      style={{ marginBottom: 14 }}
    >
      <div className="grid" style={{ gridTemplateColumns: "1.4fr 1fr", gap: 20 }}>
        <div>
          <WhatIfPanel compute={compute} channelLabel={(c) => chMeta(c).label} D={D} month={fmtMonth(month)} />
        </div>
        <div>
          <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
            <strong style={{ color: "var(--ink-2)" }}>Highest-leverage lever first</strong> · ΔCM3 from a 5% shock
          </div>
          {drivers.length === 0 ? (
            <div className="muted" style={{ fontSize: 12.5 }}>No driver data for {fmtMonth(month)}.</div>
          ) : (
            drivers.map((d) => {
              const w = (Math.abs(d.deltaCm3) / maxDrv) * 100;
              const pos = d.deltaCm3 >= 0;
              return (
                <div key={d.lever} style={{ marginBottom: 9 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 2 }}>
                    <span><span className="muted" style={{ fontFamily: "var(--mono)", marginRight: 5 }}>#{d.rank}</span>{d.label}</span>
                    <span style={{ fontFamily: "var(--mono)", fontWeight: 600, color: pos ? "var(--success)" : "var(--critical)" }}>
                      {pos ? "+" : "−"}{D.fmtINR(Math.abs(d.deltaCm3))}
                    </span>
                  </div>
                  <div style={{ height: 7, borderRadius: 3, background: "var(--border-soft)", overflow: "hidden" }}>
                    <div style={{ width: w + "%", height: "100%", background: pos ? "var(--success)" : "var(--critical)", opacity: 0.85 }} />
                  </div>
                </div>
              );
            })
          )}
          <div className="muted" style={{ fontSize: 10, marginTop: 6, lineHeight: 1.5 }}>
            Each bar = the company CM3 change from a uniform 5% shock to that lever (price +5%, COGS −5%, fees −5pts, ad spend −5%). The longest bar is the lever to pull first.
          </div>
        </div>
      </div>
    </Card>
  );
};

/* ══════════════════════════════════════════════════════════════════════════
 * NEW · VIII — MARKETING SLICE OF THE SHARED "WHAT TO DO MONDAY" QUEUE.
 * The cross-lever actionQueue() engine owns every lever (reorder/delist/reprice/
 * ad-cut/reallocate). This page surfaces only its AD levers (ad-cut + reallocate)
 * so the marketing decisions live in the SAME ranked-by-₹ contract the other pages
 * share — the founder works one Monday list, not three. The mounted <ActionQueue>
 * component is the shared presentation; the empty state is designed (rubric 79).
 * ════════════════════════════════════════════════════════════════════════ */
const MarketingActionQueue = ({ queue, month, D }) => {
  const recoverable = queue.filter((r) => num(r.impactPerMonth) > 0).reduce((a, r) => a + num(r.impactPerMonth), 0);
  return (
    <Card
      title="Ad levers in the Monday queue"
      sub={`The marketing slice of the ONE shared "what to do Monday" action queue, ranked by rupee impact for ${fmtMonth(month)}. Ad-cut and reallocate rows only — the same queue (and the same contract) the Sales and Finance pages share, so the reorder / delist / reprice levers sit alongside these on Sales. One list, every lever, ranked by ₹.`}
      action={recoverable > 0 ? <span className="badge" style={{ ...basisPill(AD_BASIS.ACTUAL), fontSize: 10 }}>~{D.fmtINR(recoverable)}/mo CM3 recoverable</span> : null}
      style={{ marginBottom: 14 }}
    >
      <ActionQueue queue={queue} D={D} title="Ad actions · ranked by ₹/mo" max={10} period={fmtMonth(month)} />
      <div className="muted" style={{ fontSize: 10.5, marginTop: 10, lineHeight: 1.5 }}>
        These rows are the <strong>ad-cut</strong> and <strong>reallocate</strong> levers of the shared cross-lever
        queue (the engine&apos;s <code style={{ fontFamily: "var(--mono)" }}>actionQueue()</code>). The full queue —
        which also carries reorder, delist and reprice levers across all SKUs and channels — is the founder&apos;s
        single Monday list; it lives in full on the Sales page so the levers are never split across views. Impact = the
        CM3 recovered per month if the action is taken; every ratio behind it is same-window and gated.
      </div>
    </Card>
  );
};

/* ══════════════════════════════════════════════════════════════════════════
 * NEW · VII-52 — FORWARD WEBSITE AD-CHANNEL REVENUE + CONTRIBUTION (banded).
 * Spend planning is forward-looking; a rear-view-only marketing page leaves the
 * founder guessing where the channel is pacing. The engine's forecast() gives
 * channel-grain forward net revenue, units AND contribution with a stated method
 * and an uncertainty band; the mounted <ForecastChart> draws history solid, the
 * forecast dashed, the band shaded, and rides the method + confidence under it.
 * Three metrics togglable (revenue / contribution / units). Designed empty state.
 * ════════════════════════════════════════════════════════════════════════ */
const FC_METRICS = [
  { key: "netRev", label: "Net revenue" },
  { key: "cm3", label: "Contribution (CM3)" },
  { key: "units", label: "Units" },
];
const SpendForecast = ({ fc, D }) => {
  const [metric, setMetric] = useState("netRev");
  const has = fc && Array.isArray(fc.forecast) && (fc.history?.length || fc.forecast.length);
  return (
    <Card
      title="Website channel · forward revenue, contribution & units"
      sub="Where the website ad channel is pacing, so spend is planned not just reviewed. Trailing-3-complete-month linear trend ⊕ run-rate (50/50); units at held ₹/unit, CM3 at held margin; the shaded ribbon is the ±residual-σ uncertainty band that widens with horizon. The current month is completed via month-end pace (marked *). Method and confidence ride under the chart — never a black-box number."
      action={
        <div className="seg">
          {FC_METRICS.map((m) => (
            <button key={m.key} className={metric === m.key ? "active" : ""} onClick={() => setMetric(m.key)}>{m.label}</button>
          ))}
        </div>
      }
      style={{ marginBottom: 14 }}
    >
      {!has ? (
        <div className="muted" style={{ fontSize: 12.5 }}>Not enough website history to project — a forecast needs at least one complete month of channel data.</div>
      ) : (
        <ForecastChart fc={fc} D={D} metric={metric} title={`${fmtMonth(fc.asOfMonth)} as-of · ${fc.grain}-grain ${FC_METRICS.find((m) => m.key === metric)?.label.toLowerCase()}`} height={240} />
      )}
    </Card>
  );
};

/* ─── helpers (NaN-free, formatting) ─────────────────────────────────────── */
function num(n) { const v = Number(n); return Number.isFinite(v) ? v : 0; }
function numOrNull(n) { const v = Number(n); return Number.isFinite(v) ? v : null; }

// Guard a possibly-throwing engine call so one bad section never blanks the page
// (rubric 79 — designed error state). Returns null on throw; callers fall back.
function safeCall(fn) { try { return fn(); } catch { return null; } }

// VIII · the marketing slice of the shared cross-lever queue — the ad-cut and
// reallocate levers only, re-ranked by |₹ impact| within the slice. The full
// queue (with reorder/delist/reprice) is the founder's single Monday list on Sales;
// this is the same contract, filtered to the levers this page owns.
function marketingSliceOfQueue(q) {
  return q
    .filter((r) => r.lever === "ad-cut" || r.lever === "reallocate")
    .sort((a, b) => Math.abs(num(b.impactPerMonth)) - Math.abs(num(a.impactPerMonth)))
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

// SEO keyword count for the header sub — true to the source (all tracked keywords,
// not a truncated 30). Reads the parsed total; falls back to the array length.
function seoCount(facts) {
  const seo = facts?.meta?.bySource?.["monarch-seo"];
  return seo ? (Number(seo.totalKeywords) || (seo.keywords || []).length || 0) : 0;
}

// VI-96 · staleness in whole days between an ISO snapshot date and the live
// data-through date (or today as a fallback). >45d is flagged severe (a quarter+
// of drift on a slow-cadence feed). Returns null when either date is unparseable.
function staleness(snapISO, throughISO) {
  const a = Date.parse(String(snapISO || ""));
  const b = Date.parse(String(throughISO || "")) || Date.now();
  if (!Number.isFinite(a)) return null;
  const days = Math.max(0, Math.round((b - a) / 86400000));
  if (days <= 0) return null;
  return { days, severe: days > 45 };
}

// 23 · per-channel attribution-confidence model. Delegates to the SHARED engine
// `attributionConfidence` in bizAnalytics so the Finance CM3 waterfall and this
// Marketing panel read ONE source (no two definitions of "% measured"). The
// shared result is ordered CH_ORDER-first for this panel's display, and exposes
// `total` as the overall-measured alias the existing UI consumes.
function buildAttributionConfidence(facts, month) {
  const ac = attributionConfidence(facts, { month, costs: COSTS });
  const order = (ch) => { const i = CH_ORDER.indexOf(ch); return i === -1 ? 99 : i; };
  const channels = ac.channels.slice().sort((a, b) => order(a.ch) - order(b.ch) || b.total - a.total);
  return {
    channels,
    directTotal: ac.directTotal, allocTotal: ac.allocTotal, spendTotal: ac.spendTotal,
    total: ac.overall,
  };
}

// per-channel measured-attribution source label (used in the confidence popover).
const ATTR_SOURCE = {
  amazon: "Amazon Sponsored Products (per-ASIN)",
  flipkart: "Flipkart PLA (per-SKU)",
  blinkit: "Snell Blinkit channel total (no per-SKU split → all allocated)",
  website: "Google Ads product-wise (Monarch)",
};
// confidence colour: ≥80% measured = green, ≥40% = ink, else amber (caution).
function confColor(measured) {
  if (measured == null) return "var(--ink-3)";
  if (measured >= 0.8) return "var(--success)";
  if (measured >= 0.4) return "var(--ink)";
  return "#B7791F";
}
// prescription action verb — derive a tight imperative from the action id so the
// founder reads "Stop / Cut / Optimise" without the full sentence repeating the SKU.
function actionVerb(r) {
  if (r.id?.startsWith("zerosale")) return "Stop zero-sale ads on";
  if (r.id?.startsWith("cutad")) return "Cut / optimise ads on";
  if (r.id?.startsWith("realloc")) return "Reallocate";
  return r.action;
}

// View C — a one-line budgeting steer from the blended ROAS comparison. Honest:
// only speaks when both platforms have a same-window blended ROAS to compare.
function decisionNote(h) {
  const g = h.google?.roas, m = h.meta?.roas;
  if (g == null || m == null) return "One platform has no complete-month history to compare yet.";
  if (Math.abs(g - m) < 0.15) return "Google and Meta are running at similar efficiency this period — split by headroom, not ROAS.";
  const winner = g > m ? "Google" : "Meta";
  const lead = (Math.max(g, m) / Math.max(0.01, Math.min(g, m)) - 1) * 100;
  return `${winner} returns ${lead.toFixed(0)}% more per rupee this period (blended, complete months) — the marginal website rupee earns more there.`;
}

// View B — SEO rank formatting. Lower rank = better; rank 1 is #1. A null/0 rank
// means "not tracked at that snapshot" → blank, never a fake number.
function fmtSeoDate(iso) {
  if (!iso) return "—";
  const p = String(iso).split("-");
  if (p.length !== 3) return String(iso);
  return Number(p[2]) + " " + (MONTH_NAMES[Number(p[1]) - 1] || p[1]);
}
function rankLabel(r) {
  const v = Number(r);
  if (!Number.isFinite(v) || v <= 0) return "—";
  return "#" + Math.round(v);
}
// movement = rank(prev) − rank(now). +ve → climbed (rank number fell) → green ↑.
function movementCell(mv) {
  const v = Number(mv);
  if (!Number.isFinite(v) || v === 0) return <span className="muted">— 0</span>;
  const up = v > 0;
  return (
    <span style={{ color: up ? "var(--success)" : "var(--critical)", fontWeight: 600 }}>
      {up ? "↑" : "↓"} {Math.abs(v)}
    </span>
  );
}
function channelSum(row, field) {
  if (!row) return 0;
  return Object.keys(row.byCh).reduce((a, ch) => a + num(row.byCh[ch][field]), 0);
}
function monthTcosLabel(row) {
  if (!row) return "—";
  const rev = channelSum(row, "netRev"), spend = channelSum(row, "adSpend");
  const g = guardRatio({ numerator: spend, denominator: rev, numWindow: "m", denWindow: "m", kind: "acos" });
  return g.suppressed ? "—" : fmtPct1(g.value);
}
function fmtPct1(frac) {
  const v = Number(frac);
  if (!Number.isFinite(v)) return "—";
  return (v >= 0 ? "" : "−") + Math.abs(v * 100).toFixed(1) + "%";
}
function fmtPct0(frac) {
  const v = Number(frac);
  if (!Number.isFinite(v)) return "—";
  return (v >= 0 ? "" : "−") + Math.abs(v * 100).toFixed(0) + "%";
}
function cm3Color(v) {
  if (v == null || !Number.isFinite(Number(v))) return undefined;
  return Number(v) < 0 ? "var(--critical)" : "var(--success)";
}
function pillStyle(ch) {
  const color = chMeta(ch).color;
  return { background: color + "22", color, borderColor: color + "55" };
}
// adBasis chip styling — distinct hue per basis so the eye reads attribution fast.
const BASIS_STYLE = {
  [AD_BASIS.ACTUAL]: { bg: "#2E7D3220", fg: "#2E7D32" },   // green-ish: real attribution
  [AD_BASIS.ALLOC]:  { bg: "#B7791F22", fg: "#B7791F" },   // amber: allocated
  [AD_BASIS.AGENCY]: { bg: "#5B5BD622", fg: "#5B5BD6" },   // indigo: agency total
  native:            { bg: "#2E7D3220", fg: "#2E7D32" },
  agency:            { bg: "#5B5BD622", fg: "#5B5BD6" },
};
function basisPill(basis) {
  const s = BASIS_STYLE[basis] || { bg: "#8E8A7E22", fg: "#8E8A7E" };
  return { background: s.bg, color: s.fg, borderColor: s.fg + "55", fontSize: 9 };
}
// adBasis chip text. For "actual" attribution the platform differs per channel
// (Amazon SP / Flipkart PLA / website Google product-wise) — name it precisely so
// the founder reads the true attribution source, not a generic "SP".
const ACTUAL_LABEL = { amazon: "SP actual", flipkart: "PLA actual", website: "Google actual" };
function basisLabel(basis, ch) {
  if (basis === AD_BASIS.ACTUAL) return ACTUAL_LABEL[ch] || "actual";
  if (basis === AD_BASIS.ALLOC) return "alloc by rev";
  if (basis === AD_BASIS.AGENCY) return "agency";
  return "—";
}
function fmtMonth(m) {
  const parts = String(m || "").split("-");
  if (parts.length !== 2) return String(m || "—");
  const mi = Number(parts[1]) - 1;
  return (MONTH_NAMES[mi] || parts[1]) + " " + parts[0];
}
function fmtMonthShort(m) {
  const parts = String(m || "").split("-");
  if (parts.length !== 2) return String(m || "—");
  const mi = Number(parts[1]) - 1;
  return (MONTH_NAMES[mi] || parts[1]) + " '" + parts[0].slice(2);
}
function fmtDay(d) {
  if (!d) return "—";
  const parts = String(d).split("-");
  if (parts.length !== 3) return String(d);
  return Number(parts[2]) + " " + (MONTH_NAMES[Number(parts[1]) - 1] || parts[1]);
}
function monthEndISO(ym) {
  const [y, m] = String(ym).split("-").map(Number);
  if (!y || !m) return ym + "-31";
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export default PageMarketing;
