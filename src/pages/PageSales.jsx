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

/**
 * PageSales — Business Performance §9 / V2.5 (Sales & Revenue Intelligence).
 *
 * REAL DATA ONLY, COVERAGE-HONEST, DAILY-GRAIN. Reads the durable fact store via
 * mergedFacts() (bundled baseline ⊕ uploads) and the V2 engine. The page is a
 * single top-to-bottom narrative: TODAY (MTD pulse) → the DAILY net-revenue
 * curve per channel → THE MONTH (MoM growth table + channel mix over months) →
 * THE YEAR (where revenue compounded) → the SKU (per-SKU units history drill) →
 * AOV trend → returns honesty → May per-SKU revenue breakdown.
 *
 * V2 honesty rules baked in everywhere:
 *  - Every month label carries a coverage badge: "native" (per-SKU revenue),
 *    "agency" (Snell/Monarch channel-grain), or "MTD ≤ <day>" (partial).
 *  - Multi-month history is built from tier-2/3 (Snell daily channel-grain +
 *    Monarch website) and upgrades to native automatically where present.
 *  - MoM growth compares LIKE-FOR-LIKE: partial (MTD) months are excluded from
 *    full-month MoM and only ever compared against a same-day-window slice.
 *  - Website daily/agency revenue is GROSS in source (Monarch carries no net
 *    column); shown on a net-derived basis (gross ÷ 1.05) and labelled as such,
 *    matching the engine's WEBSITE_AGENCY_NET_DIVISOR.
 *  - All currency through D.fmtINR / fmtRupees (rounded — never a raw float);
 *    all % to 1 decimal; all units integers. No NaN/Infinity ever renders.
 */

// Net-derive divisor for website agency/daily gross (Monarch is gross-only).
// Mirrors cmEngine WEBSITE_AGENCY_NET_DIVISOR — kept in sync by value.
const WEBSITE_NET_DIVISOR = 1.05;

const ORDER = ["amazon", "flipkart", "blinkit", "website"];

// Channel display metadata. The fact-store channel set is the AUTHORITY
// (channelsIn); this map is presentation-only. Unknown channel → neutral.
const CH_META = {
  amazon:   { name: "Amazon",   short: "AMZ", color: "#E47911" },
  flipkart: { name: "Flipkart", short: "FK",  color: "#2874F0" },
  blinkit:  { name: "Blinkit",  short: "BLK", color: "#F8CB46" },
  website:  { name: "Website",  short: "WEB", color: "#5E8E3E" },
};
const chMeta = (ch) => CH_META[ch] || { name: ch, short: String(ch).slice(0, 3).toUpperCase(), color: "#9CA098" };
const chOrder = (a, b) => {
  const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
};
const pillStyle = (ch) => {
  const c = chMeta(ch).color;
  return { background: c + "22", color: c, borderColor: c + "55" };
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
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
// Calendar months strictly between two "YYYY-MM" keys (exclusive). Used to mark
// zero-activity months that were filtered out of the coverage model (e.g.
// Oct-2024 between Sep and Nov) so the MoM table never skips a month silently.
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

// SAFE numeric coercion + formatters (all output rounded — never a raw float).
const num = (n) => { const v = Number(n); return Number.isFinite(v) ? v : 0; };
// Precise grouped rupees for table cells: "₹1,23,456" (rounded). For headline
// cards we use D.fmtINR (K/L/Cr). null/non-finite → em-dash.
function fmtRupees(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Math.round(Number(n));
  return (v < 0 ? "−₹" : "₹") + Math.abs(v).toLocaleString("en-IN");
}
function fmtUnits(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Math.round(Number(n)).toLocaleString("en-IN");
}
// fraction (0..1) → "12.3%"; null-safe.
const pctStr = (frac) => (frac == null || !Number.isFinite(frac) ? "—" : (frac * 100).toFixed(1) + "%");

// Per-channel net value of a daily channel-grain cell. Website is gross-only in
// source → net-derive (gross ÷ 1.05). Everyone else carries a real netRev.
function dailyNet(cell, ch) {
  if (!cell) return 0;
  const net = num(cell.netRev);
  if (net > 0) return net;
  if (ch === "website") return num(cell.grossRev) / WEBSITE_NET_DIVISOR;
  return net;
}

const PageSales = () => {
  const D = NSData;

  // ── Live read model ───────────────────────────────────────────────────────
  const facts = useMemo(() => mergedFacts(), []);
  const cov = useMemo(() => coverageFor(facts), [facts]);
  const monthsMeta = useMemo(() => monthsAvailable(facts), [facts]);
  const allMonths = monthsMeta.map((m) => m.month);
  const latestMonth = allMonths[allMonths.length - 1] || "2026-05";
  const latestMeta = monthsMeta[monthsMeta.length - 1] || null;

  // Channels present across the whole history, ordered.
  const channels = useMemo(() => [...channelsIn(facts)].sort(chOrder), [facts]);

  // Headline net-rev-by-channel model across the FULL monthly history (MoM table
  // + channel-mix + AOV source). NO lastN cap — the monthly fact store carries
  // Amazon back to Aug-2024 (the 0-to-1 ramp), and truncating it threw away ~9
  // months of real early-revenue history the founder explicitly wants surfaced.
  const headline = useMemo(() => monthlyNetRevByChannel(facts), [facts]);

  // Daily channel-grain net-revenue series (the daily chart source). One series
  // per channel, ascending by date, net-of-GST (website net-derived).
  const dailySeries = useMemo(() => buildDailySeries(facts), [facts]);

  // Per-SKU monthly UNITS history (Snell Categorywise) — the SKU drill source.
  const skuUnitsHistory = useMemo(() => buildSkuUnitsHistory(facts), [facts]);

  // Historical actuals baked into the fact store's meta.bySource (founder rule 9 —
  // source-labelled). These are ACTUALS (not cost assumptions) so they are allowed
  // beyond the cost-%-only rule. Used by the retention/returns panel (A) and the
  // cancel-rate panel (E). Absent in a stripped bundle → the panels self-hide.
  const bySource = facts.meta?.bySource || {};
  const repeats = bySource["bm-repeats"] || null;   // A — Shopify/Amazon repeat
  const returnsTrend = bySource["bm-returns"] || null; // A — Shopify returns % monthly
  const cancel = bySource["snell-cancel"] || null;  // E — shipped-vs-cancel per channel

  // Upload modal (V2.5: a visible "Upload reports" entry on every page).
  const [uploadOpen, setUploadOpen] = useState(false);

  // ── Chart controls ────────────────────────────────────────────────────────
  const [range, setRange] = useState("90d");    // 30d | 90d | 12m | all
  const [chartMode, setChartMode] = useState("line"); // line | stack
  const [show7dMA, setShow7dMA] = useState(true);

  // ── SKU drill modal ───────────────────────────────────────────────────────
  const [drillSku, setDrillSku] = useState(null);

  // Mix metric toggle.
  const [mixMetric, setMixMetric] = useState("netRev"); // netRev | share

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">Sales &amp; Revenue Intelligence</div>
          <div className="page-sub">
            Daily net revenue · multi-month growth · channel mix · per-SKU history — net-of-GST, coverage-honest
          </div>
        </div>
        <div className="actions">
          <button className="btn sm" onClick={() => setUploadOpen(true)} title="Upload channel exports — Snell, Monarch, Amazon, Flipkart, Blinkit, Shopify">
            Upload reports
          </button>
          {latestMeta && <MonthBadge meta={latestMeta} />}
        </div>
      </div>

      {/* Orientation note — a cold reader understands the whole page from here.
          .note is display:flex, so the whole prose body must be ONE flex child
          (a single span) for the text + inline badges to flow normally. */}
      <div className="note" style={{ marginBottom: 16 }}>
        <span style={{ lineHeight: 1.55 }}>
          <strong>How to read this page.</strong>&nbsp;Revenue is <strong>net of GST and returns</strong>
          {" "}throughout. The monthly views (month-over-month, channel mix, AOV) span the <strong>full agency
          history</strong> — Amazon from <strong>Aug-2024</strong> (the 0-to-1 ramp), Flipkart and the website
          from Jun-2025, Blinkit from Dec-2025. The daily chart carries day-level grain over the same per-channel
          windows (Amazon daily back to Aug-2024; the other channels begin Jun-2025). Months where a channel&apos;s
          own per-SKU export is loaded show a <span className="cov-badge cov-native">native</span> badge and
          override the agency figure, the rest show <span className="cov-badge cov-agency">agency</span>. The
          current month is partial — labelled <span className="cov-badge cov-mtd">MTD</span> — and is kept out of
          month-over-month growth unless compared day-for-day. Website revenue is gross in source, so it is shown
          net-derived (÷1.05).
        </span>
      </div>

      {/* ════════ 1 · TODAY — MTD pulse ════════ */}
      <MtdPulse facts={facts} latestMonth={latestMonth} latestMeta={latestMeta} channels={channels} cov={cov} D={D} />

      {/* ════════ 2 · DAILY net-revenue curve ════════ */}
      <Card
        title="Daily net revenue"
        sub="Every channel, day by day — the real shape of the business. Amazon runs back to Aug-2024 (the early ramp); other channels begin when their daily feed does. Net-of-GST; website net-derived (÷1.05)."
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
        <DailyChart
          series={dailySeries}
          channels={channels}
          range={range}
          mode={chartMode}
          show7dMA={show7dMA}
          D={D}
        />
      </Card>

      {/* ════════ 3 · THE MONTH — MoM growth table + per-channel bars ════════ */}
      <Card
        title="Month-over-month net revenue"
        sub="Full agency history per channel (Amazon from Aug-2024), with like-for-like growth. Partial (MTD) months are dimmed and excluded from MoM."
        padded={false}
        style={{ marginBottom: 16 }}
      >
        <MoMTable headline={headline} monthsMeta={monthsMeta} facts={facts} channels={channels} D={D} />
      </Card>

      {/* ════════ 4 · CHANNEL MIX over months (stacked area) ════════ */}
      <Card
        title="Channel mix over time"
        sub="How the revenue split shifted month to month — Blinkit arrives Dec-2025, the website holds a steady base."
        action={
          <div className="seg">
            <button className={mixMetric === "netRev" ? "active" : ""} onClick={() => setMixMetric("netRev")}>₹ value</button>
            <button className={mixMetric === "share" ? "active" : ""} onClick={() => setMixMetric("share")}>% share</button>
          </div>
        }
        style={{ marginBottom: 16 }}
      >
        <ChannelMixArea headline={headline} channels={channels} metric={mixMetric} monthsMeta={monthsMeta} D={D} />
      </Card>

      {/* ════════ 5 · AOV trend ════════ */}
      <Card
        title="Average order value"
        sub="Net revenue ÷ units per channel, month by month. AOV drift signals discounting, mix shift, or pack-size moves."
        style={{ marginBottom: 16 }}
      >
        <AovTrend facts={facts} monthsMeta={monthsMeta} channels={channels} D={D} />
      </Card>

      {/* ════════ 5b · RETENTION & RETURNS trend (historical actuals) ════════ */}
      {(repeats || returnsTrend) && (
        <Card
          title="Customer retention & returns"
          sub="Are we keeping customers and are they sending product back? Shopify repeat rate climbing 7.9%→15.1% says the storefront is starting to retain. Returns are a separate, noisier signal."
          padded={false}
          style={{ marginBottom: 16 }}
        >
          <RetentionReturnsPanel repeats={repeats} returnsTrend={returnsTrend} />
        </Card>
      )}

      {/* ════════ 6 · PER-SKU units history ════════ */}
      <Card
        title="Per-SKU sales history"
        sub="Monthly units per SKU across the full agency history (Snell Categorywise). Click a row to drill into its trend + weekday pattern."
        padded={false}
        style={{ marginBottom: 16 }}
      >
        <SkuHistoryTable skuUnitsHistory={skuUnitsHistory} onDrill={setDrillSku} D={D} />
      </Card>

      {/* ════════ 7 · MAY per-SKU revenue breakdown (native) ════════ */}
      <Card
        title="May 2026 · per-SKU net revenue (native)"
        sub="The one month with full per-SKU revenue grain (native exports). CM3 = after COGS, platform fees, and ads."
        padded={false}
        style={{ marginBottom: 16 }}
      >
        <MaySkuBreakdown facts={facts} channels={channels} D={D} />
      </Card>

      {/* ════════ 7b · CANCEL-RATE trend per channel ════════ */}
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

      {/* ════════ 8 · RETURNS ════════ */}
      <Card
        title="Returns"
        sub="What each channel's source actually carries — net-of-returns honesty (spec §11). A dash means not in source, not a zero rate."
      >
        <ReturnsSection facts={facts} channels={channels} D={D} />
      </Card>

      {drillSku && (
        <SkuDrillModal
          code={drillSku}
          history={skuUnitsHistory.bySku[drillSku]}
          facts={facts}
          onClose={() => setDrillSku(null)}
          D={D}
        />
      )}
      {uploadOpen && <UploadModal onClose={() => setUploadOpen(false)} defaultTab="business" />}
    </div>
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
  // Month-level basis: native if ANY channel is native, else agency.
  const anyNative = Object.values(meta.channels || {}).some((c) => c.sales === "native");
  return anyNative ? (
    <span className="cov-badge cov-native" title="At least one channel has native per-SKU revenue this month">native</span>
  ) : (
    <span className="cov-badge cov-agency" title="Channel-grain agency revenue (Snell / Monarch)">agency</span>
  );
}

// Inline coverage chip for a single (month×channel) cell.
function CovChip({ basis, partial }) {
  if (partial) return <span className="cov-badge cov-mtd sm">MTD</span>;
  if (basis === "native") return <span className="cov-badge cov-native sm">nat</span>;
  if (basis === "agency") return <span className="cov-badge cov-agency sm">agc</span>;
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// 1 · MTD PULSE — today's snapshot for the live month, per channel.
// ════════════════════════════════════════════════════════════════════════════
function MtdPulse({ facts, latestMonth, latestMeta, channels, cov, D }) {
  // Per-channel CM for the latest month (coverage-aware engine).
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

  return (
    <div className="grid" style={{ gridTemplateColumns: `repeat(${rows.length + 1}, minmax(0,1fr))`, marginBottom: 16 }}>
      {/* Company total card */}
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
      </div>

      {rows.map(({ ch, r }) => {
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
              <div className="mono text-right" style={{ color: r.cm3 != null && r.cm3 < 0 ? "var(--critical)" : "var(--ink)" }}>
                {r.cm3 == null ? "—" : D.fmtINR(r.cm3)}
              </div>
              <div className="muted">CM3 %</div><div className="mono text-right">{pctStr(r.pcts?.cm3)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 2 · DAILY CHART — multi-channel daily net revenue, line/stack, 7d MA, presets.
// ════════════════════════════════════════════════════════════════════════════
// Build { dates:[iso…], byChannel:{ ch:{ iso:net } }, channels:[…] } ascending.
function buildDailySeries(facts) {
  const daily = facts.daily || {};
  const byChannel = {};
  const dateSet = new Set();
  for (const [key, cell] of Object.entries(daily)) {
    const [iso, ch, code] = key.split("|");
    if (code !== CH_CODE) continue;           // channel-grain only
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

  // Window the dates per the active preset (anchored to the latest data day).
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

  // Layout.
  const w = 760, h = 280;
  const pad = { l: 52, r: 14, t: 14, b: 30 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const n = windowed.length;
  const xFor = (i) => pad.l + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);

  // Per-channel windowed arrays.
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

  // 7-day moving average (line mode only) per channel.
  const ma7 = (ch) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let j = Math.max(0, i - 6); j <= i; j++) { s += valOf(ch, windowed[j]); c++; }
      out.push(c ? s / c : 0);
    }
    return out;
  };

  // X-axis label cadence.
  const labelStep = Math.max(1, Math.ceil(n / 8));

  // Stacked-area path builder (cumulative bands).
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
        {/* gridlines + y labels */}
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

        {/* x labels */}
        {windowed.map((iso, i) =>
          i % labelStep === 0 || i === n - 1 ? (
            <text key={iso} x={xFor(i)} y={h - 8} fontSize="8.5" textAnchor="middle" fill="var(--ink-3)" fontFamily="var(--mono)">
              {fmtDay(iso)}
            </text>
          ) : null
        )}
      </svg>

      {/* Legend + per-channel windowed totals */}
      <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: "8px 18px" }}>
        {present.map((ch) => {
          const total = windowed.reduce((a, iso) => a + valOf(ch, iso), 0);
          // First daily-data day for this channel (its true coverage horizon) —
          // surfaced so the per-channel window is explicit, never implied.
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
// 3 · MoM TABLE — net rev per channel per month + like-for-like growth chips.
// ════════════════════════════════════════════════════════════════════════════
function MoMTable({ headline, monthsMeta, facts, channels, D }) {
  const { months, table } = headline;
  const present = channels.filter((ch) => headline.channels.includes(ch));
  const metaByMonth = Object.fromEntries(monthsMeta.map((m) => [m.month, m]));

  // Like-for-like growth for a partial (MTD) month: recompute the PRIOR month's
  // net rev clipped to the same day-of-month window from the daily series so a
  // half-month doesn't masquerade as a crash. Cached per (ch).
  const dailySeries = useMemo(() => buildDailySeries(facts), [facts]);
  const lfl = (ch, month, lastDay) => {
    if (!lastDay) return null;
    const dom = parseInt(lastDay.split("-")[2], 10);
    const idx = months.indexOf(month);
    if (idx <= 0) return null;
    const prevMonth = months[idx - 1];
    const cur = sumChannelMonthToDay(dailySeries, ch, month, dom);
    const prev = sumChannelMonthToDay(dailySeries, ch, prevMonth, dom);
    if (prev <= 0) return null;
    return { pct: ((cur - prev) / prev) * 100, cur, prev, prevMonth, dom };
  };

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
            // Calendar-gap marker: if the prior table row is more than one month
            // back (a zero-activity month was filtered out of the coverage model,
            // e.g. Oct-2024 between Sep and Nov — genuinely 0 in Snell), render a
            // thin dimmed note so a reader counting months isn't left wondering
            // whether a month was silently dropped.
            const gapMonths = ri > 0 ? missingMonthsBetween(table[ri - 1].month, row.month) : [];
            const gapRow = gapMonths.length > 0 ? (
              <tr key={`gap-${row.month}`} style={{ opacity: 0.6 }}>
                <td colSpan={present.length + 3} style={{ fontSize: 10.5, fontStyle: "italic", color: "var(--ink-3)", padding: "4px 14px", background: "var(--bg-sunken)" }}>
                  {gapMonths.map((g) => fmtMonth(g)).join(", ")}: no recorded sales in source (zero-activity {gapMonths.length > 1 ? "months" : "month"} — omitted, not dropped)
                </td>
              </tr>
            ) : null;
            // Full-month MoM total: prior FULL month only (skip partials).
            let momTotal = null;
            if (!partial) {
              for (let k = ri - 1; k >= 0; k--) {
                if (table[k].partial) continue;
                const prevTotal = present.reduce((a, ch) => a + num(table[k][ch]), 0);
                if (prevTotal > 0) momTotal = ((total - prevTotal) / prevTotal) * 100;
                break;
              }
            }
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
                      // like-for-like total across present channels.
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
          full-vs-partial drop. <span className="cov-badge cov-native sm">nat</span> = native per-SKU revenue,
          {" "}<span className="cov-badge cov-agency sm">agc</span> = agency channel-grain.
        </div>
      </div>
    </div>
  );
}

// Sum a channel's daily net rev for month up to day-of-month `dom` (inclusive).
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
// LfL growth across a SET of channels (month total to-day vs prev month to-day).
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
// 4 · CHANNEL MIX — stacked area / share over months.
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

  // cumulative stacked bands
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
// 5 · AOV TREND — net rev ÷ units per channel per month.
// ════════════════════════════════════════════════════════════════════════════
function AovTrend({ facts, monthsMeta, channels, D }) {
  // Build per-channel AOV from the coverage-aware engine (uses native units
  // where present, agency units otherwise — same basis as the rev figure).
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
          // draw connected segments only across consecutive present points
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

// ════════════════════════════════════════════════════════════════════════════
// 6 · PER-SKU UNITS HISTORY — table + drill.
// ════════════════════════════════════════════════════════════════════════════
// Build { bySku: { code: { months:{ym:units}, byChannelMonths:{ch:{ym:u}}, channels:Set, total } }, monthList }.
function buildSkuUnitsHistory(facts) {
  const sm = snellSkuUnitsMap(facts); // "YYYY-MM|channel|CODE" → units
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

function SkuHistoryTable({ skuUnitsHistory, onDrill, D }) {
  const { bySku, monthList } = skuUnitsHistory;
  const codes = Object.keys(bySku).sort((a, b) => bySku[b].total - bySku[a].total);
  if (codes.length === 0) {
    return <div className="card-body"><div className="muted" style={{ fontSize: 12.5 }}>No per-SKU unit history in the current data (Snell Categorywise not loaded).</div></div>;
  }
  const last = monthList[monthList.length - 1];
  const prevFull = monthList[monthList.length - 2]; // approximate; both may be partial — units, so fine as trend

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

// Tiny inline sparkline for table rows (units, brand colour).
function MiniSpark({ data, w = 110, h = 26 }) {
  if (!data || data.length < 2) return <span className="muted" style={{ fontSize: 11 }}>—</span>;
  const min = Math.min(...data), max = Math.max(...data);
  const r = max - min || 1;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => [i * step, h - 3 - ((v - min) / r) * (h - 6)]);
  const path = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <path d={path} fill="none" stroke="var(--brand)" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2" fill="var(--brand)" />
    </svg>
  );
}

// ── SKU drill modal: monthly units bars (per channel stacked) + weekday pattern.
function SkuDrillModal({ code, history, facts, onClose, D }) {
  // monthly stacked-bar series.
  const sortedMonths = history ? Object.keys(history.months).sort() : [];
  const chans = history ? [...history.channels].sort(chOrder) : [];
  const maxMonth = Math.max(1, ...sortedMonths.map((m) => history.months[m]));

  // Weekday pattern: the SKU has no daily grain, so we show the channel-grain
  // weekday revenue pattern for THIS SKU's primary channel (the channel it sells
  // most on), built from the daily channel-grain net series. Honest caption.
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
          {/* Monthly units, stacked by channel */}
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

          {/* D · per-SKU × channel monthly mix — which channel this SKU is
              winning or losing on. Same byChannel source as the stack above,
              but split one chart per channel so each trajectory reads on its
              own (the stack hides a channel that is shrinking while total holds). */}
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

          {/* Weekday pattern (channel-grain) */}
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
            Units from Snell Categorywise (agency, multipacks folded). Revenue grain available natively for May 2026.
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
              const rect = <rect key={ch} x={x} y={y1} width={bWidth} height={Math.max(0, y0 - y1)} fill={chMeta(ch).color} opacity="0.9" />;
              return rect;
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

// D · per-channel small-multiples — one monthly-units mini-bar chart per channel,
// each on its OWN scale so a channel doing 30u/mo and one doing 600u/mo are both
// legible. The header chip carries the channel's all-time units + the latest
// full-month MoM move so "winning / losing" reads at a glance.
function SkuChannelMix({ history, months, chans }) {
  // Rank channels by all-time units (the SKU's biggest channel first).
  const ranked = [...chans]
    .map((ch) => ({ ch, total: Object.values(history.byChannel[ch] || {}).reduce((a, v) => a + num(v), 0) }))
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total);
  if (ranked.length === 0) return null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(ranked.length, 2)}, minmax(0,1fr))`, gap: 10 }}>
      {ranked.map(({ ch, total }) => {
        const map = history.byChannel[ch] || {};
        const vals = months.map((m) => num(map[m]));
        const max = Math.max(1, ...vals);
        // latest full-month MoM (last vs prev present month with units).
        const present = months.filter((m) => num(map[m]) > 0);
        const lastM = present[present.length - 1];
        const prevM = present[present.length - 2];
        const mom = lastM && prevM && num(map[prevM]) > 0
          ? ((num(map[lastM]) - num(map[prevM])) / num(map[prevM])) * 100
          : null;
        const meta = chMeta(ch);
        // mini bar layout
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
// 7 · MAY per-SKU revenue breakdown (native) — kept from v1, floats fixed.
// ════════════════════════════════════════════════════════════════════════════
function MaySkuBreakdown({ facts, channels, D }) {
  const MAY = "2026-05";
  const cm = useMemo(() => computeCM({ facts, month: MAY, costs: undefined }), [facts]);
  const nativeChannels = channels.filter((ch) => cm.byChannel?.[ch]);
  const [chTab, setChTab] = useState(nativeChannels[0] || "amazon");
  const active = cm.byChannel?.[chTab] ? chTab : nativeChannels[0];
  const [sort, setSort] = useState("netRev");

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
      {rows.length === 0 ? (
        <div className="muted" style={{ padding: "18px 16px", fontSize: 12.5 }}>No native SKU sales for {chMeta(active).name} in May 2026.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>SKU</th>
              <th className="num">Net rev</th>
              <th className="num">Units</th>
              <th className="num">AOV</th>
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
                      <span>{skuShort(r.code)} <span className="muted" style={{ fontSize: 11 }}>{skuVariant(r.code)}</span></span>
                      <span className="sku">{r.code}</span>
                    </div>
                  </td>
                  <td className="num">{fmtRupees(r.netRev)}</td>
                  <td className="num">{fmtUnits(r.units)}</td>
                  <td className="num">{aov != null ? fmtRupees(aov) : "—"}</td>
                  <td className="num">{share.toFixed(1)}%</td>
                  <td className="num" style={{ color: r.cm3 != null && r.cm3 < 0 ? "var(--critical)" : "var(--ink)" }}>
                    {r.cm3 == null ? "—" : fmtRupees(r.cm3)}
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
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 8 · RETURNS — net-of-returns honesty.
// ════════════════════════════════════════════════════════════════════════════
function ReturnsSection({ facts, channels, D }) {
  const MAY = "2026-05";
  const cm = useMemo(() => computeCM({ facts, month: MAY }), [facts]);
  const present = channels.filter((ch) => cm.byChannel?.[ch]);

  // Returns facts from per-cell returnsUnits/returnsValue (May native cells).
  const returnsByChannel = useMemo(() => {
    const out = {};
    for (const [key, cell] of Object.entries(facts.monthly || {})) {
      const [m, ch, code] = key.split("|");
      if (m !== MAY || code === CH_CODE) continue;
      const ru = num(cell.returnsUnits), rv = num(cell.returnsValue);
      out[ch] = out[ch] || { units: 0, value: 0, hasData: false };
      out[ch].units += ru; out[ch].value += rv;
      if (ru || rv) out[ch].hasData = true;
    }
    return out;
  }, [facts]);

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
                <td className="num">{rate != null ? rate.toFixed(1) + "%" : <span className="muted">—</span>}</td>
                <td className="muted" style={{ fontSize: 11.5 }}>{treatment}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="note" style={{ marginTop: 12 }}>
        <span style={{ lineHeight: 1.55 }}>
          <strong>Coverage caveat.</strong>&nbsp;Returns are surfaced from what each channel&apos;s native export
          actually carries (May 2026). Amazon refund/return rows are netted out of both revenue and units;
          Flipkart&apos;s negative settlement rows are absorbed into the Buyer Invoice Amount. Blinkit and Website
          carry no per-order return lines in the May sources — a dash means <em>not in source</em>, not a zero rate.
          {fkCashback ? (
            <> Flipkart also reports a settlement-layer cashback of{" "}
              <span className="mono">{fmtRupees(fkCashback.value)}</span> ({fkCashback.rows} rows) — excluded from
              revenue (spec §10), shown as a net-realisation note only.</>
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
//   Left: Shopify repeat-rate + returning-customer sales-share by quarter (bars +
//   a returning-sales-% overlay) with Amazon repeat-share alongside. Right: the
//   Shopify monthly returns-% trend line. All figures are ACTUALS, source-labelled
//   per founder rule 9 — they are not cost assumptions, so allowed on this page.
// ════════════════════════════════════════════════════════════════════════════
function RetentionReturnsPanel({ repeats, returnsTrend }) {
  const sq = repeats?.shopify || [];
  const aq = repeats?.amazon || [];
  const rm = returnsTrend?.monthly || [];

  // headline movers (first → latest) for the strap line.
  const repFirst = sq[0]?.repeatPct, repLast = sq[sq.length - 1]?.repeatPct;
  const amzLast = aq[aq.length - 1]?.repeatShare;

  return (
    <div>
      <div className="card-body" style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 18, paddingBottom: 8 }}>
        {/* ── Shopify repeat-rate by quarter ── */}
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

        {/* ── Shopify monthly returns % trend ── */}
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

      {/* ── Amazon repeat share row ── */}
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

// Shopify repeat-rate bars (customers) + returning-sales-% overlay line.
function ShopifyRepeatBars({ rows }) {
  const w = 360, h = 150;
  const pad = { l: 30, r: 30, t: 12, b: 26 };
  const innerW = w - pad.l - pad.r, innerH = h - pad.t - pad.b;
  const n = rows.length;
  const bw = innerW / n;
  // shared 0..max scale for both % series (whichever is larger, padded).
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
      {/* returning-sales-% overlay */}
      <path d={line} fill="none" stroke="var(--info)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      {linePts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="2.4" fill="var(--info)">
          <title>{`${rows[i].quarter}: ${num(rows[i].returningSalesPct).toFixed(1)}% of sales from returning customers`}</title>
        </circle>
      ))}
    </svg>
  );
}

// Shopify monthly returns-% trend line (volatile — annotated as such above).
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
      {/* mean reference */}
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
// E · CANCEL RATE — shipped vs cancelled units per channel, monthly, with
//   threshold coloring (≤8% ok · ≤15% watch · >15% alarm). Per-channel trend
//   lines + a "latest" KPI strip. Source: Snell Sale-tab shipped/cancel cols.
// ════════════════════════════════════════════════════════════════════════════
const CANCEL_OK = 8, CANCEL_WATCH = 15; // % thresholds
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
  // present channels in the canonical order.
  const present = channels.filter((ch) => byChannel[ch] && Object.keys(byChannel[ch]).length > 0);
  // union of all months across present channels, ascending.
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
      {/* latest-KPI strip per channel */}
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

      {/* per-channel trend lines + threshold bands */}
      <div className="card-body" style={{ paddingTop: 4 }}>
        <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
          {/* threshold bands (ok / watch / alarm) */}
          <rect x={pad.l} y={yFor(yMax)} width={innerW} height={yFor(CANCEL_WATCH) - yFor(yMax)} fill="var(--critical-soft)" opacity="0.5" />
          <rect x={pad.l} y={yFor(CANCEL_WATCH)} width={innerW} height={yFor(CANCEL_OK) - yFor(CANCEL_WATCH)} fill="var(--warning-soft)" opacity="0.45" />
          <rect x={pad.l} y={yFor(CANCEL_OK)} width={innerW} height={pad.t + innerH - yFor(CANCEL_OK)} fill="var(--success-soft)" opacity="0.4" />
          {[CANCEL_OK, CANCEL_WATCH].map((thr) => (
            <g key={thr}>
              <line x1={pad.l} y1={yFor(thr)} x2={w - pad.r} y2={yFor(thr)} stroke="var(--ink-3)" strokeWidth="0.7" strokeDasharray="3 3" opacity="0.6" />
              <text x={w - pad.r} y={yFor(thr) - 2} fontSize="8" textAnchor="end" fill="var(--ink-3)" fontFamily="var(--mono)">{thr}%</text>
            </g>
          ))}
          {/* y labels */}
          {[0, 0.5, 1].map((t, i) => (
            <text key={i} x={pad.l - 5} y={pad.t + innerH * t + 3} fontSize="8.5" textAnchor="end" fill="var(--ink-3)" fontFamily="var(--mono)">
              {Math.round(yMax * (1 - t))}%
            </text>
          ))}
          {/* channel lines — segmented across present months only */}
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
          {/* x labels */}
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
