import { useState, useMemo } from "react";
import { Delta, Card } from "../components/Shared.jsx";
import NSData from "../data.js";
import { mergedFacts, channelsIn, monthsIn } from "../lib/businessStore.js";
import { computeCM } from "../lib/cmEngine.js";

/**
 * PageSales — Business Performance §9 (Sales & Revenue Intelligence).
 *
 * Real data only. Reads the durable fact store via mergedFacts() (bundled May-26
 * baseline ⊕ any uploads) and runs the pure CM engine (computeCM) for the active
 * month. Every channel/SKU list is DERIVED from the facts (channelsIn / engine
 * rollups) — never hardcoded — so a new channel or SKU appears with no code edit.
 *
 * HONESTY (spec §11): revenue is shown on a NET basis and labelled as such;
 * absent sources read as "no data", never 0; no NaN/Infinity is ever rendered.
 * Growth is genuinely single-month for the marketplaces (only May-26 in the fact
 * store), so NO fabricated MoM number is shown — instead the page surfaces the
 * Monarch 13-month WEBSITE conversion-value trend (real history carried in
 * meta.bySource["monarch-web"].monarchWebHistory) as the one true growth series,
 * and frames the rest as a single-month snapshot until a 2nd month lands.
 *
 * Returns: the fact store nets Amazon returns OUT of Amazon revenue/units (spec
 * §11) and Flipkart's negative settlement rows auto-net into BIA; both are
 * surfaced from the per-cell returnsUnits/returnsValue fields. Website/Blinkit
 * carry no return facts in the May baseline → shown as "not in source", not 0.
 */

// Display metadata per fact-store channel. The fact-store channel set is the
// authority (channelsIn); this map is presentation-only (label + colour). An
// unknown channel SAFELY falls back to a neutral style + its raw id.
const CH_META = {
  amazon:   { name: "Amazon",   short: "AMZ", color: "#E47911" },
  flipkart: { name: "Flipkart", short: "FK",  color: "#2874F0" },
  blinkit:  { name: "Blinkit",  short: "BLK", color: "#F8CB46" },
  website:  { name: "Website",  short: "WEB", color: "#5E8E3E" },
};
const chMeta = (ch) => CH_META[ch] || { name: ch, short: ch.slice(0, 3).toUpperCase(), color: "#9CA098" };

// Pretty month label "2026-05" → "May 2026".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtMonth(ym) {
  const [y, m] = String(ym || "").split("-");
  const mi = parseInt(m, 10) - 1;
  return mi >= 0 && mi < 12 && y ? `${MONTHS[mi]} ${y}` : (ym || "—");
}

// SKU display name from the canonical code (reuses the inventory SKU table).
const SKU_NAME = Object.fromEntries(
  NSData.skus.map((s) => [s.code, `${s.name} · ${s.variant}`])
);
const skuName = (code) => SKU_NAME[code] || code;

// % of a fraction (0..1) → "12.3%"; null-safe → "—".
const pctStr = (frac) => (frac == null || !Number.isFinite(frac) ? "—" : (frac * 100).toFixed(1) + "%");

const PageSales = () => {
  const D = NSData;

  // Live read model: bundled baseline ⊕ uploaded overrides.
  const facts = useMemo(() => mergedFacts(), []);
  const months = useMemo(() => monthsIn(facts), [facts]);
  // Active month = latest month present (single-month today; future-proof).
  const month = months[months.length - 1] || "2026-05";

  const cm = useMemo(() => computeCM({ facts, month }), [facts, month]);
  const channels = useMemo(() => channelsIn(facts).filter((c) => cm.byChannel[c]), [facts, cm]);

  // Returns facts per channel (from per-cell returnsUnits/returnsValue, summed
  // for the active month). Channels with no return facts → null (not 0).
  const returnsByChannel = useMemo(() => {
    const out = {};
    for (const key of Object.keys(facts.monthly || {})) {
      const [m, ch] = key.split("|");
      if (m !== month) continue;
      const cell = facts.monthly[key] || {};
      const ru = Number(cell.returnsUnits) || 0;
      const rv = Number(cell.returnsValue) || 0;
      if (!out[ch]) out[ch] = { units: 0, value: 0, hasData: false };
      out[ch].units += ru;
      out[ch].value += rv;
      if (ru || rv) out[ch].hasData = true;
    }
    return out;
  }, [facts, month]);

  // Source-meta passthroughs (provenance the engine doesn't carry).
  const bySource = facts.meta?.bySource || {};
  const monarchHistory = bySource["monarch-web"]?.monarchWebHistory || null;
  const mcfUnits = bySource["amazon-orders"]?.mcf?.totalUnits ?? null;
  const fkCashback = bySource["fk-sales"]?.flipkartCashback || null;

  const company = cm.company;
  const multiMonth = months.length >= 2;

  // Active channel for the SKU breakdown table (default first present channel).
  const [skuChannel, setSkuChannel] = useState(channels[0] || "amazon");
  const activeSkuChannel = cm.byChannel[skuChannel] ? skuChannel : channels[0];
  const [skuSort, setSkuSort] = useState("netRev");

  // Channel-mix metric toggle.
  const [mixMetric, setMixMetric] = useState("netRev"); // netRev | units

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">Sales &amp; Revenue Intelligence</div>
          <div className="page-sub">
            Net revenue · channel &amp; SKU breakdown · returns — {fmtMonth(month)}
          </div>
        </div>
        <div className="actions">
          <span className="badge" title="Revenue basis: net of GST and returns. Authoritative monthly facts from each channel's native export.">
            Net basis · {fmtMonth(month)}
          </span>
        </div>
      </div>

      {/* Single-month framing — no fabricated growth when only one month exists. */}
      {!multiMonth && (
        <div className="note" style={{ marginBottom: 16 }}>
          <strong>Single-month snapshot.</strong>&nbsp;The fact store currently holds one
          month ({fmtMonth(month)}). Month-over-month growth needs ≥2 months and is
          intentionally <em>not</em> fabricated here. The one real growth series we
          carry — the website's 13-month conversion-value history (Monarch) — is shown
          in the Growth section below.
        </div>
      )}

      {/* ── Company headline + channel revenue/units cards ── */}
      <div className="grid" style={{ gridTemplateColumns: `repeat(${channels.length + 1}, 1fr)`, marginBottom: 16 }}>
        {/* Company total */}
        <div className="card">
          <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid var(--border-soft)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="badge brand">TOTAL</span>
            </div>
            <div className="mono" style={{ fontSize: 19, marginTop: 8, fontWeight: 500 }}>
              {D.fmtINR(company.netRev)}
            </div>
            <div className="muted" style={{ fontSize: 11 }}>Net revenue · all channels</div>
          </div>
          <div style={{ padding: "10px 14px", fontSize: 11.5, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px" }}>
            <div className="muted">Units</div><div className="mono text-right">{D.fmtN(company.units)}</div>
            <div className="muted">AOV (net)</div><div className="mono text-right">{company.units ? "₹" + D.fmtN(Math.round(company.netRev / company.units)) : "—"}</div>
            <div className="muted">CM3</div>
            <div className="mono text-right" style={{ color: company.cm3 < 0 ? "var(--critical)" : "var(--ink)" }}>{D.fmtINR(company.cm3)}</div>
            <div className="muted">CM3 %</div><div className="mono text-right">{pctStr(company.pcts.cm3)}</div>
          </div>
        </div>

        {/* One card per channel present in the facts */}
        {channels.map((ch) => {
          const c = cm.byChannel[ch];
          const meta = chMeta(ch);
          const aov = c.units ? Math.round(c.netRev / c.units) : null;
          return (
            <div key={ch} className="card">
              <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid var(--border-soft)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="badge" style={{ background: meta.color + "22", color: meta.color, borderColor: meta.color + "55" }}>{meta.short}</span>
                  <span className="muted mono" style={{ fontSize: 10.5 }}>{((c.netRev / (company.netRev || 1)) * 100).toFixed(0)}% mix</span>
                </div>
                <div className="mono" style={{ fontSize: 19, marginTop: 8, fontWeight: 500 }}>
                  {D.fmtINR(c.netRev)}
                </div>
                <div className="muted" style={{ fontSize: 11 }}>{meta.name} · net rev</div>
              </div>
              <div style={{ padding: "10px 14px", fontSize: 11.5, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px" }}>
                <div className="muted">Units</div><div className="mono text-right">{D.fmtN(c.units)}</div>
                <div className="muted">AOV (net)</div><div className="mono text-right">{aov != null ? "₹" + D.fmtN(aov) : "—"}</div>
                <div className="muted">CM3</div>
                <div className="mono text-right" style={{ color: c.cm3 != null && c.cm3 < 0 ? "var(--critical)" : "var(--ink)" }}>
                  {c.cm3 == null ? "—" : D.fmtINR(c.cm3)}
                </div>
                <div className="muted">CM3 %</div><div className="mono text-right">{pctStr(c.pcts.cm3)}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Channel mix ── */}
      <Card
        title="Channel mix"
        sub={`Share of ${mixMetric === "netRev" ? "net revenue" : "units"} · ${fmtMonth(month)}`}
        action={
          <div className="seg">
            <button className={mixMetric === "netRev" ? "active" : ""} onClick={() => setMixMetric("netRev")}>Revenue</button>
            <button className={mixMetric === "units" ? "active" : ""} onClick={() => setMixMetric("units")}>Units</button>
          </div>
        }
        style={{ marginBottom: 16 }}
      >
        <ChannelMix cm={cm} channels={channels} metric={mixMetric} D={D} />
      </Card>

      {/* ── SKU breakdown per channel ── */}
      <Card
        title="SKU breakdown by channel"
        sub={`Net revenue · units · CM3 — ${chMeta(activeSkuChannel).name} · ${fmtMonth(month)}`}
        action={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <div className="seg">
              {channels.map((ch) => (
                <button key={ch} className={activeSkuChannel === ch ? "active" : ""} onClick={() => setSkuChannel(ch)}>
                  {chMeta(ch).short}
                </button>
              ))}
            </div>
            <div className="seg">
              <button className={skuSort === "netRev" ? "active" : ""} onClick={() => setSkuSort("netRev")}>Revenue</button>
              <button className={skuSort === "units" ? "active" : ""} onClick={() => setSkuSort("units")}>Units</button>
              <button className={skuSort === "cm3" ? "active" : ""} onClick={() => setSkuSort("cm3")}>CM3</button>
            </div>
          </div>
        }
        padded={false}
        style={{ marginBottom: 16 }}
      >
        <SkuBreakdownTable cm={cm} channel={activeSkuChannel} sort={skuSort} D={D} />
      </Card>

      {/* ── Growth ── */}
      <Card
        title="Growth"
        sub="Website 13-month conversion-value trend (Monarch) · marketplaces are single-month"
        style={{ marginBottom: 16 }}
      >
        <GrowthSection history={monarchHistory} activeMonth={month} multiMonth={multiMonth} D={D} />
      </Card>

      {/* ── Returns ── */}
      <Card
        title="Returns"
        sub="What each channel's source actually carries — net-of-returns honesty (spec §11)"
      >
        <ReturnsSection
          channels={channels}
          returnsByChannel={returnsByChannel}
          cm={cm}
          fkCashback={fkCashback}
          mcfUnits={mcfUnits}
          D={D}
        />
      </Card>
    </div>
  );
};

// ── Channel mix (stacked bar + legend) ───────────────────────────────────────
const ChannelMix = ({ cm, channels, metric, D }) => {
  const rows = channels
    .map((ch) => ({
      ch,
      meta: chMeta(ch),
      value: metric === "netRev" ? cm.byChannel[ch].netRev : cm.byChannel[ch].units,
    }))
    .sort((a, b) => b.value - a.value);
  const total = rows.reduce((a, r) => a + (r.value || 0), 0) || 1;

  return (
    <div>
      {/* Single stacked bar */}
      <div style={{ display: "flex", height: 26, borderRadius: 5, overflow: "hidden", border: "1px solid var(--border-soft)" }}>
        {rows.map((r) => {
          const w = (r.value / total) * 100;
          return (
            <div
              key={r.ch}
              title={`${r.meta.name}: ${metric === "netRev" ? D.fmtINR(r.value) : D.fmtN(r.value) + " units"} (${w.toFixed(1)}%)`}
              style={{ width: w + "%", background: r.meta.color, minWidth: w > 0 ? 2 : 0 }}
            />
          );
        })}
      </div>
      {/* Legend + numbers */}
      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        {rows.map((r) => (
          <div key={r.ch} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: r.meta.color, flex: "0 0 auto" }} />
            <span style={{ flex: 1, fontSize: 12.5 }}>{r.meta.name}</span>
            <span className="mono" style={{ fontSize: 12 }}>
              {metric === "netRev" ? D.fmtINR(r.value) : D.fmtN(r.value)}
            </span>
            <span className="muted mono" style={{ fontSize: 11, width: 46, textAlign: "right" }}>
              {((r.value / total) * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── SKU breakdown table for one channel ──────────────────────────────────────
const SkuBreakdownTable = ({ cm, channel, sort, D }) => {
  // Build rows from the engine's per-SKU per-channel rollups — only SKUs that
  // actually sold on this channel in the month appear (honest coverage).
  const rows = [];
  for (const code of Object.keys(cm.bySku)) {
    const cell = cm.bySku[code]?.byChannel?.[channel];
    if (!cell || (!cell.netRev && !cell.units)) continue;
    // CM3% lives in the rollup's pcts.cm3 (the bySku/byChannel cell has no flat
    // cm3Pct — that field is matrix-only). null when COGS is missing.
    rows.push({ code, ...cell, cm3Pct: cell.pcts?.cm3 ?? null });
  }
  rows.sort((a, b) => {
    if (sort === "netRev") return b.netRev - a.netRev;
    if (sort === "units") return b.units - a.units;
    if (sort === "cm3") return (b.cm3 ?? -Infinity) - (a.cm3 ?? -Infinity);
    return 0;
  });

  const chTotal = cm.byChannel[channel]?.netRev || 0;

  if (rows.length === 0) {
    return <div className="muted" style={{ padding: "18px 14px", fontSize: 12.5 }}>No SKU sales recorded for this channel in the active month.</div>;
  }

  return (
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
          const aov = r.units ? Math.round(r.netRev / r.units) : null;
          const share = chTotal ? (r.netRev / chTotal) * 100 : 0;
          return (
            <tr key={r.code}>
              <td>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span>{skuName(r.code)}</span>
                  <span className="sku">{r.code}</span>
                </div>
              </td>
              <td className="num">{D.fmtINR(r.netRev)}</td>
              <td className="num">{D.fmtN(r.units)}</td>
              <td className="num">{aov != null ? "₹" + D.fmtN(aov) : "—"}</td>
              <td className="num">{share.toFixed(1)}%</td>
              <td className="num" style={{ color: r.cm3 != null && r.cm3 < 0 ? "var(--critical)" : "var(--ink)" }}>
                {r.cm3 == null ? "—" : D.fmtINR(r.cm3)}
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
  );
};

// ── Growth section ───────────────────────────────────────────────────────────
const GrowthSection = ({ history, activeMonth, multiMonth, D }) => {
  // Normalise the Monarch website history into a chronological series. Each
  // entry is { convValue, days }. A month is "partial" (dimmed, excluded from
  // MoM) when EITHER its recorded coverage is short (days < 28, e.g. a 7-day
  // launch month) OR it is the current / a future calendar month — the live
  // month's value is still accruing and must never read as a real decline.
  const series = useMemo(() => {
    if (!history) return [];
    const now = new Date();
    const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    return Object.keys(history)
      .sort()
      .map((m) => {
        const h = history[m] || {};
        const days = Number(h.days) || 0;
        const val = Number(h.convValue) || 0;
        const incomplete = (days > 0 && days < 28) || m >= currentYM;
        return { month: m, value: val, days, partial: incomplete };
      });
  }, [history]);

  if (series.length === 0) {
    return <div className="muted" style={{ fontSize: 12.5 }}>No website history available in the current data.</div>;
  }

  // MoM growth across consecutive FULL months only (skip partial months so a
  // clipped first/last month can't masquerade as a swing).
  const full = series.filter((s) => !s.partial);
  const latestFull = full[full.length - 1];
  const prevFull = full[full.length - 2];
  const momPct =
    prevFull && prevFull.value > 0 ? ((latestFull.value - prevFull.value) / prevFull.value) * 100 : null;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 24, alignItems: "stretch" }}>
        <TrendChart series={series} D={D} />
        <div style={{ borderLeft: "1px solid var(--border-soft)", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 14, justifyContent: "center" }}>
          <div>
            <div className="stat-label">Latest full month</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 500 }}>{D.fmtINR(latestFull.value)}</div>
            <div className="muted" style={{ fontSize: 11 }}>{fmtMonth(latestFull.month)} · website conv. value</div>
          </div>
          <div>
            <div className="stat-label">MoM (vs {prevFull ? fmtMonth(prevFull.month) : "—"})</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <Delta value={momPct} />
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
              Website only · Monarch conversion value
            </div>
          </div>
          <div>
            <div className="stat-label">Series</div>
            <div className="mono" style={{ fontSize: 13 }}>{series.length} months</div>
            <div className="muted" style={{ fontSize: 11 }}>{fmtMonth(series[0].month)} → {fmtMonth(series[series.length - 1].month)}</div>
          </div>
        </div>
      </div>
      <div className="note" style={{ marginTop: 12 }}>
        <strong>Why only website here?</strong>&nbsp;Monarch carries 13 months of website
        conversion value — the single multi-month revenue history available. Marketplace
        facts (Amazon / Flipkart / Blinkit) exist for {fmtMonth(activeMonth)} only, so
        their growth stays blank rather than invented. The Monarch series is the website's
        gross conversion value (its own scale), shown as a trend — not the same basis as
        the net-revenue cards above. Partial-coverage months are dimmed.
        {multiMonth && " A second month of marketplace facts will unlock channel MoM here automatically."}
      </div>
    </div>
  );
};

// 13-month line+area trend (self-contained SVG, partial months dimmed).
const TrendChart = ({ series, D }) => {
  const w = 560, h = 200;
  const pad = { l: 44, r: 14, t: 16, b: 26 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const max = Math.max(...series.map((s) => s.value), 1) * 1.08;
  const n = series.length;
  const xFor = (i) => pad.l + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yFor = (v) => pad.t + innerH - (Math.max(0, v) / max) * innerH;

  const pts = series.map((s, i) => [xFor(i), yFor(s.value)]);
  const line = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const area = line + ` L${pts[pts.length - 1][0].toFixed(1)},${(pad.t + innerH).toFixed(1)} L${pts[0][0].toFixed(1)},${(pad.t + innerH).toFixed(1)} Z`;

  // Label cadence: every other month to avoid crowding.
  const labelEvery = n > 8 ? 2 : 1;

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      {/* gridlines */}
      {[0, 0.5, 1].map((t, i) => (
        <g key={i}>
          <line x1={pad.l} y1={pad.t + innerH * t} x2={w - pad.r} y2={pad.t + innerH * t} stroke="var(--border-soft)" />
          <text x={pad.l - 6} y={pad.t + innerH * t + 3} fontSize="9" textAnchor="end" fill="var(--ink-3)" fontFamily="var(--mono)">
            {D.fmtINR(max * (1 - t)).replace("₹", "")}
          </text>
        </g>
      ))}
      <path d={area} fill="var(--brand)" opacity="0.08" />
      <path d={line} fill="none" stroke="var(--brand)" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      {/* points — partial months hollow/dimmed */}
      {series.map((s, i) => (
        <circle
          key={s.month}
          cx={pts[i][0]}
          cy={pts[i][1]}
          r={s.partial ? 2.5 : 3}
          fill={s.partial ? "var(--bg-card)" : "var(--brand)"}
          stroke="var(--brand)"
          strokeWidth={s.partial ? 1.2 : 0}
          opacity={s.partial ? 0.6 : 1}
        >
          <title>{`${fmtMonth(s.month)}: ${D.fmtINR(s.value)}${s.partial ? ` (partial — ${s.days}d)` : ""}`}</title>
        </circle>
      ))}
      {/* x labels */}
      {series.map((s, i) =>
        i % labelEvery === 0 ? (
          <text key={s.month} x={pts[i][0]} y={h - 8} fontSize="8.5" textAnchor="middle" fill="var(--ink-3)" fontFamily="var(--mono)">
            {MONTHS[parseInt(s.month.split("-")[1], 10) - 1]}
          </text>
        ) : null
      )}
    </svg>
  );
};

// ── Returns section ──────────────────────────────────────────────────────────
const ReturnsSection = ({ channels, returnsByChannel, cm, fkCashback, mcfUnits, D }) => {
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
          {channels.map((ch) => {
            const meta = chMeta(ch);
            const r = returnsByChannel[ch];
            const ch_ = cm.byChannel[ch];
            // grossUnits = net units + returned units (returns already netted out
            // of the units figure). rate = returns / (net + returns).
            const netUnits = ch_?.units || 0;
            const retUnits = r?.units || 0;
            const denom = netUnits + retUnits;
            const rate = denom > 0 && retUnits > 0 ? (retUnits / denom) * 100 : null;
            const treatment =
              ch === "amazon"
                ? "Netted out of rev & units (All-Orders refund rows)"
                : ch === "flipkart"
                ? "Auto-netted into Buyer Invoice Amount (negative rows)"
                : "Not itemised in source";
            return (
              <tr key={ch}>
                <td>
                  <span className="badge" style={{ background: meta.color + "22", color: meta.color, borderColor: meta.color + "55" }}>{meta.short}</span>
                  <span style={{ marginLeft: 8, fontSize: 12.5 }}>{meta.name}</span>
                </td>
                <td className="num">{r?.hasData ? D.fmtN(retUnits) : <span className="muted">—</span>}</td>
                <td className="num">{r?.hasData ? D.fmtINR(r.value) : <span className="muted">—</span>}</td>
                <td className="num">{rate != null ? rate.toFixed(1) + "%" : <span className="muted">—</span>}</td>
                <td className="muted" style={{ fontSize: 11.5 }}>{treatment}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="note" style={{ marginTop: 12 }}>
        <strong>Coverage caveat.</strong>&nbsp;Returns are surfaced from what each
        channel's native export actually carries. Amazon refund/return rows are netted
        out of both revenue and units (spec §11); Flipkart's negative settlement rows are
        absorbed into the Buyer Invoice Amount, so its return value reflects those
        netted-down rows. Blinkit and Website carry no per-order return lines in the
        {" "}{fmtMonth("2026-05")} sources — a dash here means <em>not in source</em>, not
        a zero return rate. The Shopify 18.7% blended-return trend referenced in the spec
        is not present in the bundled website source and is shown only once that history
        is uploaded.
        {fkCashback ? (
          <>
            {" "}Flipkart also reports a separate settlement-layer cashback of{" "}
            <span className="mono">{D.fmtINR(fkCashback.value)}</span> ({fkCashback.rows} rows) —
            excluded from revenue per spec §10, shown here as a net-realisation note only.
          </>
        ) : null}
        {mcfUnits != null ? (
          <>
            {" "}Note: {D.fmtN(mcfUnits)} Amazon-fulfilled (MCF) units are website orders, not
            Amazon channel sales, and are excluded from the Amazon figures above.
          </>
        ) : null}
      </div>
    </div>
  );
};

export default PageSales;
