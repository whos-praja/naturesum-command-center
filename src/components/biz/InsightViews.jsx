/**
 * InsightViews — the round-3 "left-on-the-table" insight panels (rubric param 89:
 * every meaningful analysis the data supports is built or visibly deferred). One
 * presentation-only, NaN-safe component per insight calc, so page builders mount
 * exactly the ones a page needs:
 *
 *   OrderMixView          ← orderMixTrend(facts)              (a)
 *   TotalVsDailyView      ← totalVsDailyReconciliation(facts) (b)
 *   ConversionGapView     ← conversionValueGap(facts, {month})(c)
 *   CashbackTrendView     ← cashbackTrend(facts)              (d)
 *   ReturningRevenueView  ← returningRevenue(facts)           (e)
 *   CostChangeView        ← costChangeHistory(facts)          (f)
 *   GeoConcentrationView  ← geoConcentration(facts, {month})  (g)
 *   BasketTrendView       ← basketTrend(facts)                (VI-45)
 *
 * Every ₹ via D.fmtINR (inr), %→1dp (pct1), integer units. Tables use overflowX
 * auto (no 390px overflow). Shared with the three biz pages.
 */
import { D as defaultD, inr as defaultInr, pct1 } from "./ScorecardHelpers.jsx";

const inrOf = (D) => (n) => (D && D.fmtINR ? (Number.isFinite(Number(n)) ? D.fmtINR(Number(n)) : "—") : defaultInr(n));
const u = (n) => (Number.isFinite(Number(n)) ? Math.round(Number(n)).toLocaleString("en-IN") : "—");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtMonth = (ym) => { const [y, m] = String(ym || "").split("-"); const mi = parseInt(m, 10) - 1; return mi >= 0 && mi < 12 ? `${MONTHS[mi]} ’${String(y).slice(2)}` : (ym || "—"); };

function Shell({ title, badge, children, note }) {
  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div className="muted" style={{ fontSize: 10.5, letterSpacing: 0.4, textTransform: "uppercase" }}>{title}</div>
        {badge}
      </div>
      <div style={{ marginTop: 10 }}>{children}</div>
      {note && <div className="muted" style={{ fontSize: 10.5, marginTop: 10, lineHeight: 1.45 }}>{note}</div>}
    </div>
  );
}

// Stacked-share bar (organic / review / paid) — honest 100%-width encoding.
function MixBar({ organic, review, paid }) {
  const seg = [
    { v: organic, c: "var(--success)", t: "organic" },
    { v: review, c: "#2874F0", t: "review" },
    { v: paid, c: "#E47911", t: "paid" },
  ].filter((s) => Number.isFinite(s.v) && s.v > 0);
  return (
    <div style={{ display: "flex", width: "100%", height: 14, borderRadius: 3, overflow: "hidden", background: "var(--border-soft)" }} title={seg.map((s) => `${s.t} ${pct1(s.v)}`).join(" · ")}>
      {seg.map((s, i) => <div key={i} style={{ width: `${s.v * 100}%`, background: s.c }} />)}
    </div>
  );
}

// ── (a) Snell order-mix decomposition over time ──
export function OrderMixView({ data, D = defaultD, title = "Order mix (organic / review / paid)" }) {
  const inr = inrOf(D);
  if (!data || !Array.isArray(data.months) || data.months.length === 0) return <Shell title={title}><div className="muted" style={{ fontSize: 12.5 }}>No order-mix data.</div></Shell>;
  return (
    <Shell title={title} badge={<span className="cov-badge cov-agency sm">Snell · amazon</span>} note={data.note}>
      <div style={{ display: "flex", gap: 12, marginBottom: 8, fontSize: 10.5 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 9, height: 9, background: "var(--success)", borderRadius: 2 }} /> Organic</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 9, height: 9, background: "#2874F0", borderRadius: 2 }} /> Review</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 9, height: 9, background: "#E47911", borderRadius: 2 }} /> Paid/non-advt</span>
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {data.months.map((m) => (
          <div key={m.month} style={{ display: "grid", gridTemplateColumns: "62px 1fr auto", gap: 8, alignItems: "center" }}>
            <span className="muted" style={{ fontSize: 11 }}>{fmtMonth(m.month)}</span>
            <MixBar organic={m.organicPct} review={m.reviewPct} paid={m.paidPct} />
            <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)" }}>{u(m.totalUnits)}u · {inr(m.organicAmt)} organic</span>
          </div>
        ))}
      </div>
    </Shell>
  );
}

// ── (VI-b + left-on-table #2) Amazon order composition: single-vs-multi-unit
//    basket, FBA-vs-MFN fulfillment, B2B-vs-B2C — from the order-id grouping. ──
// Two-segment share bar (a vs b) — honest 100%-width split.
function SplitBar({ a, b, ca, cb, ta, tb }) {
  const av = Number.isFinite(a) ? a : 0, bv = Number.isFinite(b) ? b : 0;
  const tot = av + bv;
  if (tot <= 0) return <div style={{ height: 14, background: "var(--border-soft)", borderRadius: 3 }} />;
  return (
    <div style={{ display: "flex", width: "100%", height: 14, borderRadius: 3, overflow: "hidden", background: "var(--border-soft)" }} title={`${ta} ${u(av)} · ${tb} ${u(bv)}`}>
      <div style={{ width: `${(av / tot) * 100}%`, background: ca }} />
      <div style={{ width: `${(bv / tot) * 100}%`, background: cb }} />
    </div>
  );
}
export function OrderCompositionView({ data, D = defaultD, title = "Order composition · basket / fulfillment / B2B (Amazon)" }) {
  const inr = inrOf(D);
  if (!data || !data.available || !data.months.length) return <Shell title={title}><div className="muted" style={{ fontSize: 12.5 }}>No Amazon order-composition data (needs the All-Orders export with order-id).</div></Shell>;
  const latest = data.latest;
  const maxUpo = Math.max(1.0001, ...data.months.map((m) => Number(m.upo) || 0));
  return (
    <Shell title={title} badge={<span className="cov-badge cov-native sm">Amazon · native</span>} note={data.note}>
      {/* Latest-month headline split bars. */}
      {latest && (
        <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, marginBottom: 3 }}>
              <span>Basket · single vs multi-unit orders</span>
              <span className="muted">{pct1(latest.multiPct)} multi · {Number.isFinite(latest.upo) ? latest.upo.toFixed(2) : "—"} units/order</span>
            </div>
            <SplitBar a={latest.singleOrders} b={latest.multiOrders} ca="#2874F0" cb="#E47911" ta="single" tb="multi" />
            <div className="muted" style={{ fontSize: 9.5, marginTop: 2 }}><span style={{ color: "#2874F0" }}>■</span> {u(latest.singleOrders)} single · <span style={{ color: "#E47911" }}>■</span> {u(latest.multiOrders)} multi ({u(latest.multiUnits)}u)</div>
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, marginBottom: 3 }}>
              <span>Fulfillment · FBA vs MFN</span>
              <span className="muted">{pct1(latest.fbaPct)} FBA</span>
            </div>
            <SplitBar a={latest.fbaOrders} b={latest.mfnOrders} ca="var(--success)" cb="#9A7B16" ta="FBA" tb="MFN" />
            <div className="muted" style={{ fontSize: 9.5, marginTop: 2 }}><span style={{ color: "var(--success)" }}>■</span> {u(latest.fbaOrders)} FBA ({u(latest.fbaUnits)}u) · <span style={{ color: "#9A7B16" }}>■</span> {u(latest.mfnOrders)} MFN ({u(latest.mfnUnits)}u)</div>
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, marginBottom: 3 }}>
              <span>Buyer · B2B vs B2C</span>
              <span className="muted">{pct1(latest.b2bPct)} B2B</span>
            </div>
            <SplitBar a={latest.b2cOrders} b={latest.b2bOrders} ca="#7C5CFC" cb="#E4477C" ta="B2C" tb="B2B" />
            <div className="muted" style={{ fontSize: 9.5, marginTop: 2 }}><span style={{ color: "#7C5CFC" }}>■</span> {u(latest.b2cOrders)} B2C · <span style={{ color: "#E4477C" }}>■</span> {u(latest.b2bOrders)} B2B ({u(latest.b2bUnits)}u)</div>
          </div>
        </div>
      )}
      {/* Multi-unit share + UPO trend across months. */}
      {data.months.length > 1 && (
        <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 8 }}>
          <div className="muted" style={{ fontSize: 10, marginBottom: 4 }}>Multi-unit order share + units-per-order, by month</div>
          <div style={{ display: "grid", gap: 5 }}>
            {data.months.map((m) => (
              <div key={m.month} style={{ display: "grid", gridTemplateColumns: "62px 1fr auto", gap: 8, alignItems: "center" }}>
                <span className="muted" style={{ fontSize: 11 }}>{fmtMonth(m.month)}</span>
                <div style={{ display: "flex", width: "100%", height: 10, borderRadius: 2, overflow: "hidden", background: "var(--border-soft)" }} title={`${pct1(m.multiPct)} multi-unit`}>
                  <div style={{ width: `${(Number(m.multiPct) || 0) * 100}%`, background: "#E47911" }} />
                </div>
                <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>{Number.isFinite(m.upo) ? m.upo.toFixed(2) : "—"} u/o · {u(m.orders)} ord</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Shell>
  );
}

// ── (b) Total-row vs daily-series reconciliation ──
export function TotalVsDailyView({ data, D = defaultD, title = "Snell Total-row vs daily series" }) {
  const inr = inrOf(D);
  if (!data || !data.available) return <Shell title={title}><div className="muted" style={{ fontSize: 12.5 }}>{data?.note || "Reconciliation not available."}</div></Shell>;
  return (
    <Shell title={title} badge={<span className="cov-badge cov-agency sm">reconciliation</span>} note={data.note}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 18 }}>
        <div><div className="muted" style={{ fontSize: 10 }}>Total row (founder snapshot)</div><div className="mono" style={{ fontSize: 15 }}>{inr(data.totalRow.grossValue)}</div><div className="muted" style={{ fontSize: 10.5 }}>{u(data.totalRow.shippedUnits)} units</div></div>
        <div style={{ alignSelf: "center", fontSize: 16, color: "var(--ink-3)" }}>vs</div>
        <div><div className="muted" style={{ fontSize: 10 }}>Daily series (authoritative)</div><div className="mono" style={{ fontSize: 15 }}>{inr(data.dailySeries.grossValue)}</div><div className="muted" style={{ fontSize: 10.5 }}>{u(data.dailySeries.shippedUnits)} units · {u(data.dailySeries.dayRows)} rows</div></div>
        <div style={{ alignSelf: "center" }}><div className="muted" style={{ fontSize: 10 }}>Gap (daily − total)</div><div className="mono" style={{ fontSize: 15, color: "var(--warning)" }}>{inr(data.deltaGross)} {Number.isFinite(data.deltaGrossPct) ? `(${pct1(data.deltaGrossPct)})` : ""}</div><div className="muted" style={{ fontSize: 10.5 }}>+{u(data.deltaUnits)} units</div></div>
      </div>
    </Shell>
  );
}

// ── (c) Conversion-value gap (ad-reporting inflation) ──
export function ConversionGapView({ data, D = defaultD, title = "Ad-reporting inflation (website)" }) {
  const inr = inrOf(D);
  if (!data) return null;
  return (
    <Shell title={title} badge={<span className="cov-badge cov-mtd sm">{data.month}</span>} note={data.note}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center" }}>
        <div><div className="muted" style={{ fontSize: 10 }}>Monarch conversion value (ad-reported)</div><div className="mono" style={{ fontSize: 16 }}>{inr(data.monarchConvValue)}</div></div>
        <div><div className="muted" style={{ fontSize: 10 }}>Shopify net (banked)</div><div className="mono" style={{ fontSize: 16, color: "var(--success)" }}>{inr(data.shopifyNet)}</div></div>
        <div><div className="muted" style={{ fontSize: 10 }}>Inflation</div><div className="mono" style={{ fontSize: 16, color: "var(--warning)" }}>{Number.isFinite(data.gapPct) ? pct1(data.gapPct) : "—"}</div><div className="muted" style={{ fontSize: 10.5 }}>{inr(data.gapAbs)} over-attributed</div></div>
      </div>
    </Shell>
  );
}

// ── (d) Flipkart cashback (settlement drag) trend ──
export function CashbackTrendView({ data, D = defaultD, title = "Flipkart cashback (settlement drag)" }) {
  const inr = inrOf(D);
  if (!data || !data.available) return <Shell title={title}><div className="muted" style={{ fontSize: 12.5 }}>{data?.note || "No cashback data."}</div></Shell>;
  return (
    <Shell title={title} badge={<span className="cov-badge cov-agency sm">Flipkart</span>} note={data.note}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "baseline" }}>
        <div><div className="muted" style={{ fontSize: 10 }}>Total in source</div><div className="mono" style={{ fontSize: 16, color: "var(--critical)" }}>−{inr(data.total)}</div></div>
        {data.months.map((m) => (
          <div key={m.month}><div className="muted" style={{ fontSize: 10 }}>{fmtMonth(m.month)}</div><div className="mono" style={{ fontSize: 13 }}>−{inr(m.value)}</div><div className="muted" style={{ fontSize: 9.5 }}>{u(m.rows)} rows</div></div>
        ))}
      </div>
    </Shell>
  );
}

// ── (e) Returning-customer revenue + new-vs-returning AOV gap ──
export function ReturningRevenueView({ data, D = defaultD, title = "Returning-customer revenue & AOV gap" }) {
  const inr = inrOf(D);
  const q = data?.shopify?.quarters || [];
  if (!q.length) return <Shell title={title}><div className="muted" style={{ fontSize: 12.5 }}>No repeat data.</div></Shell>;
  return (
    <Shell title={title} badge={<span className="cov-badge cov-native sm">Shopify</span>} note={data.note}>
      <div style={{ width: "100%", overflowX: "auto" }}>
        <table className="data-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
          <thead>
            <tr style={{ textAlign: "right", color: "var(--ink-3)", borderBottom: "1px solid var(--border)" }}>
              <th style={{ textAlign: "left", padding: "5px 8px" }}>Quarter</th>
              <th style={{ padding: "5px 8px" }}>Returning rev</th>
              <th style={{ padding: "5px 8px" }}>Returning rev %</th>
              <th style={{ padding: "5px 8px" }}>New AOV</th>
              <th style={{ padding: "5px 8px" }}>Ret. AOV</th>
              <th style={{ padding: "5px 8px" }}>AOV gap</th>
            </tr>
          </thead>
          <tbody>
            {q.map((r) => (
              <tr key={r.quarter} style={{ borderBottom: "1px solid var(--border-soft)" }}>
                <td style={{ textAlign: "left", padding: "5px 8px" }}>{r.quarter}</td>
                <td className="mono" style={{ textAlign: "right", padding: "5px 8px" }}>{inr(r.returningSales)}</td>
                <td className="mono" style={{ textAlign: "right", padding: "5px 8px" }}>{pct1(r.returningSalesPct)}</td>
                <td className="mono" style={{ textAlign: "right", padding: "5px 8px" }}>{inr(r.newAOV)}</td>
                <td className="mono" style={{ textAlign: "right", padding: "5px 8px", color: "var(--success)" }}>{inr(r.returningAOV)}</td>
                <td className="mono" style={{ textAlign: "right", padding: "5px 8px" }}>{inr(r.aovGap)} ({pct1(r.aovGapPct)})</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}

// ── (f) COGS cost-change history ──
export function CostChangeView({ data, D = defaultD, title = "COGS cost-change history" }) {
  const inr = inrOf(D);
  if (!data) return null;
  return (
    <Shell title={title} badge={data.asOf ? <span className="cov-badge cov-agency sm">as of {data.asOf}</span> : null} note={data.note}>
      {data.changes.length === 0
        ? <div className="muted" style={{ fontSize: 12.5 }}>No cost changes recorded.</div>
        : (
          <div style={{ width: "100%", overflowX: "auto" }}>
            <table className="data-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
              <thead>
                <tr style={{ textAlign: "right", color: "var(--ink-3)", borderBottom: "1px solid var(--border)" }}>
                  <th style={{ textAlign: "left", padding: "5px 8px" }}>SKU</th>
                  <th style={{ textAlign: "left", padding: "5px 8px" }}>Product</th>
                  <th style={{ padding: "5px 8px" }}>RM was</th>
                  <th style={{ padding: "5px 8px" }}>RM now</th>
                  <th style={{ padding: "5px 8px" }}>Total COGS</th>
                </tr>
              </thead>
              <tbody>
                {data.changes.map((c) => {
                  const up = Number.isFinite(c.currentRmPerKg) && Number.isFinite(c.priorRmPerKg) && c.currentRmPerKg > c.priorRmPerKg;
                  return (
                    <tr key={c.code} style={{ borderBottom: "1px solid var(--border-soft)" }}>
                      <td style={{ textAlign: "left", padding: "5px 8px" }}>{c.code}</td>
                      <td style={{ textAlign: "left", padding: "5px 8px", color: "var(--ink-2)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.productName}>{c.productName}</td>
                      <td className="mono" style={{ textAlign: "right", padding: "5px 8px", color: "var(--ink-3)" }}>{inr(c.priorRmPerKg)}</td>
                      <td className="mono" style={{ textAlign: "right", padding: "5px 8px", color: up ? "var(--critical)" : "var(--success)" }}>{up ? "▲" : "▼"} {inr(c.currentRmPerKg)}</td>
                      <td className="mono" style={{ textAlign: "right", padding: "5px 8px" }}>{inr(c.currentTotalCogs)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      <div className="muted" style={{ fontSize: 10.5, marginTop: 6 }}>{data.changedCount} of {data.changedCount + (data.unchanged?.length || 0)} SKUs changed.</div>
    </Shell>
  );
}

// ── (g) Amazon geo demand / returns concentration ──
export function GeoConcentrationView({ data, D = defaultD, title = "Amazon demand by state", max = 10 }) {
  const inr = inrOf(D);
  if (!data || !data.available) return <Shell title={title}><div className="muted" style={{ fontSize: 12.5 }}>{data?.note || "No geo data."}</div></Shell>;
  const top = data.states.slice(0, max);
  const maxRev = top.length ? Math.max(...top.map((s) => s.netRev)) : 1;
  const hotspotStates = new Set((data.returnHotspots || []).map((h) => h.state));
  return (
    <Shell title={title} badge={<span className="cov-badge cov-native sm">{data.month} · HHI {data.hhi}</span>} note={data.note}>
      <div style={{ display: "grid", gap: 5 }}>
        {top.map((s) => (
          <div key={s.state} style={{ display: "grid", gridTemplateColumns: "120px 1fr auto", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 11, textTransform: "capitalize", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={s.state}>
              {s.state.toLowerCase()}{hotspotStates.has(s.state) ? <span title="elevated return rate" style={{ color: "var(--critical)" }}> ⚑</span> : ""}
            </span>
            <div style={{ width: "100%", height: 12, background: "var(--border-soft)", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ width: `${(s.netRev / maxRev) * 100}%`, height: "100%", background: hotspotStates.has(s.state) ? "var(--critical)" : "var(--brand)", opacity: 0.8 }} />
            </div>
            <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{inr(s.netRev)} · {pct1(s.revShare)} · ret {pct1(s.returnRate)}</span>
          </div>
        ))}
      </div>
      {(data.returnHotspots || []).length > 0 && (
        <div style={{ marginTop: 8, fontSize: 10.5, color: "var(--critical)" }}>
          ⚑ Return hotspots (&gt;1.5× the {pct1(data.avgReturnRate)} avg): {data.returnHotspots.map((h) => `${h.state.toLowerCase()} ${pct1(h.returnRate)}`).join(", ")}
        </div>
      )}
    </Shell>
  );
}

// ── (VI-45) Basket / units-per-order trend ──
export function BasketTrendView({ data, D = defaultD, title = "Basket / units-per-order" }) {
  const inr = inrOf(D);
  const w = data?.byChannel?.website || [];
  const oh = data?.ordersHistory || [];
  if (!w.length && !oh.length) return <Shell title={title} note={data?.note}><div className="muted" style={{ fontSize: 12.5 }}>No website order-count data.</div></Shell>;
  // VI-a — em-dash + "no order grain" tag where units/AOV aren't joinable, NEVER 0.
  const cell = (v, fmt) => (v == null ? <span className="muted" title="Order count exists, but no native per-SKU units this month — units-per-order / order-AOV not joinable.">— <span style={{ fontSize: 9 }}>no order grain</span></span> : fmt(v));
  // BUG-2 (II-88) — UPO is its OWN deferral: a true units-per-order needs an
  // order-level export (website units = Shopify net items, orders = Monarch gross
  // count — different sources, so their ratio is not a valid UPO and a sub-1 value
  // is logically impossible). NEVER print a number here; show the honest reason.
  const upoCell = (r) => (
    Number.isFinite(r.upo) && r.upo >= 1
      ? r.upo.toFixed(2)
      : <span className="muted" title={r.upoReason || "needs order-level export — website units (Shopify net items) and orders (Monarch gross count) are different sources/grains"}>— <span style={{ fontSize: 9 }}>needs order-level export</span></span>
  );
  const maxOrders = Math.max(1, ...oh.map((r) => Number(r.orders) || 0));
  const cov = data?.coverage || {};
  return (
    <Shell title={title} badge={<span className="cov-badge cov-agency sm">website · Monarch</span>} note={data?.note}>
      {/* VI-a — Monarch website ORDER-COUNT history, charted for every month it
          exists (even where per-SKU units aren't joinable, so it isn't blank). */}
      {oh.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div className="muted" style={{ fontSize: 10, marginBottom: 4 }}>
            Website orders / month {Number.isFinite(cov.monthsWithUnitGrain) ? `· ${cov.monthsWithUnitGrain} of ${cov.monthsWithOrders} months also have unit grain (UPO/AOV)` : ""}
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 42 }}>
            {oh.map((r) => (
              <div key={r.month} title={`${fmtMonth(r.month)}: ${u(r.orders)} orders`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                <div style={{ width: "100%", maxWidth: 22, height: `${Math.max(4, ((Number(r.orders) || 0) / maxOrders) * 100)}%`, background: "var(--accent, #2874F0)", borderRadius: "2px 2px 0 0" }} />
                <span className="muted" style={{ fontSize: 8, whiteSpace: "nowrap" }}>{fmtMonth(r.month).split(" ")[0]}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{ width: "100%", overflowX: "auto" }}>
        <table className="data-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
          <thead>
            <tr style={{ textAlign: "right", color: "var(--ink-3)", borderBottom: "1px solid var(--border)" }}>
              <th style={{ textAlign: "left", padding: "5px 8px" }}>Month</th>
              <th style={{ padding: "5px 8px" }}>Orders</th>
              <th style={{ padding: "5px 8px" }}>Units</th>
              <th style={{ padding: "5px 8px" }}>UPO</th>
              <th style={{ padding: "5px 8px" }} title="Revenue per ORDER — Monarch net ÷ Monarch orders (same-source). Not a true AOV (no order-level units).">Rev/order</th>
            </tr>
          </thead>
          <tbody>
            {w.map((r) => (
              <tr key={r.month} style={{ borderBottom: "1px solid var(--border-soft)" }}>
                <td style={{ textAlign: "left", padding: "5px 8px" }}>{fmtMonth(r.month)}</td>
                <td className="mono" style={{ textAlign: "right", padding: "5px 8px" }}>{u(r.orders)}</td>
                <td className="mono" style={{ textAlign: "right", padding: "5px 8px" }}>{cell(r.units, u)}</td>
                <td className="mono" style={{ textAlign: "right", padding: "5px 8px" }}>{upoCell(r)}</td>
                <td className="mono" style={{ textAlign: "right", padding: "5px 8px" }}>{cell(r.aov, inr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}

// ── I · Monarch supplementary tabs (March-2025 daily ramp + Weekly Comparison
//        Google-vs-Meta blocks) — parsed-but-previously-unshown source fields. ──
export function MonarchSourceTabsView({ data, D = defaultD, title = "Monarch source tabs · March 2025 + Weekly Comparison" }) {
  const inr = inrOf(D);
  if (!data || !data.available) {
    return <Shell title={title}><div className="muted" style={{ fontSize: 12.5 }}>Monarch supplementary tabs not present in the current bundle.</div></Shell>;
  }
  const m = data.march2025;
  const wk = data.weekly;
  const ramp = m ? m.rows.filter((r) => r.netSalesValue >= 0) : [];
  const maxNet = m ? Math.max(1, m.maxNet) : 1;
  return (
    <Shell
      title={title}
      badge={<span className="cov-badge cov-agency sm">Monarch · website</span>}
      note={data.note}
    >
      {m && (
        <div style={{ marginBottom: wk ? 16 : 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
            <div style={{ fontWeight: 600, fontSize: 12.5 }}>{m.tab} · the website 0→1 ramp</div>
            <div className="muted" style={{ fontSize: 10.5 }}>{u(m.monthly.dayRows)} day rows</div>
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 8 }}>
            <div><div className="muted" style={{ fontSize: 9.5 }}>Net sales</div><div className="mono" style={{ fontWeight: 600 }}>{inr(m.monthly.netSalesValue)}</div></div>
            <div><div className="muted" style={{ fontSize: 9.5 }}>Gross</div><div className="mono">{inr(m.monthly.salesValue)}</div></div>
            <div><div className="muted" style={{ fontSize: 9.5 }}>Orders (net)</div><div className="mono">{u(m.monthly.netOrders)}</div></div>
            <div><div className="muted" style={{ fontSize: 9.5 }}>Cancel rate</div><div className="mono">{pct1(m.monthly.cancelRate)}</div></div>
            <div><div className="muted" style={{ fontSize: 9.5 }}>AOV (net)</div><div className="mono">{inr(m.monthly.avgOrderValueNet)}</div></div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 1, height: 34, marginBottom: 4 }}>
            {ramp.map((r, i) => (
              <div key={i} title={`${r.date}: ${inr(r.netSalesValue)} net · ${u(r.totalOrders)} orders`}
                style={{ flex: 1, minWidth: 2, height: `${Math.max(2, (r.netSalesValue / maxNet) * 100)}%`, background: "var(--accent, #2874F0)", borderRadius: "1px 1px 0 0" }} />
            ))}
          </div>
          {m.storedAggregate?.doubled && (
            <div className="muted" style={{ fontSize: 10, lineHeight: 1.4, marginTop: 6 }}>
              ⓘ Reconciliation: the parser&apos;s stored monthly aggregate read {inr(m.storedAggregate.netSalesValue)} net (2× the day rows — it had summed the sheet&apos;s embedded &quot;Total&quot; row on top of the days). The figures above use the reconciled day-row sum, which matches the sheet&apos;s own Total row.
            </div>
          )}
        </div>
      )}
      {wk && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
            <div style={{ fontWeight: 600, fontSize: 12.5 }}>{wk.tab} · Google vs Meta ({u(wk.blockCount)} blocks)</div>
            <span className={`badge ${wk.verdict === "google" ? "blue" : wk.verdict === "meta" ? "amber" : ""}`} style={{ fontSize: 9.5 }}>
              ROAS wins · Google {u(wk.googleWins)} · Meta {u(wk.metaWins)}
            </span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="data-table" style={{ width: "100%", fontSize: 11 }}>
              <thead><tr>
                <th style={{ textAlign: "left", padding: "4px 8px" }}>Block · date</th>
                <th style={{ textAlign: "right", padding: "4px 8px" }}>Google ROAS</th>
                <th style={{ textAlign: "right", padding: "4px 8px" }}>Meta ROAS</th>
                <th style={{ textAlign: "right", padding: "4px 8px" }}>Google CPA</th>
                <th style={{ textAlign: "right", padding: "4px 8px" }}>Meta CPA</th>
                <th style={{ textAlign: "center", padding: "4px 8px" }}>Winner</th>
              </tr></thead>
              <tbody>
                {wk.blocks.flatMap((b) => b.pairs.map((p, j) => (
                  <tr key={`${b.id}-${j}`}>
                    <td style={{ textAlign: "left", padding: "4px 8px" }}>
                      {j === 0 && <span className="muted" style={{ fontSize: 9.5, display: "block" }}>{b.title}</span>}
                      {p.date}
                    </td>
                    <td className="mono" style={{ textAlign: "right", padding: "4px 8px" }}>{Number.isFinite(p.google?.roas) ? `${p.google.roas.toFixed(2)}×` : "—"}</td>
                    <td className="mono" style={{ textAlign: "right", padding: "4px 8px" }}>{Number.isFinite(p.meta?.roas) ? `${p.meta.roas.toFixed(2)}×` : "—"}</td>
                    <td className="mono" style={{ textAlign: "right", padding: "4px 8px" }}>{Number.isFinite(p.google?.cpa) ? inr(p.google.cpa) : "—"}</td>
                    <td className="mono" style={{ textAlign: "right", padding: "4px 8px" }}>{Number.isFinite(p.meta?.cpa) ? inr(p.meta.cpa) : "—"}</td>
                    <td style={{ textAlign: "center", padding: "4px 8px" }}>
                      {p.winner ? <span className={`badge ${p.winner === "google" ? "blue" : "amber"}`} style={{ fontSize: 9 }}>{p.winner === "google" ? "Google" : "Meta"}</span> : "—"}
                    </td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Shell>
  );
}
