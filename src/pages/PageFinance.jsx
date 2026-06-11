import { useState, useEffect, useMemo } from "react";
import { Icon, Card } from "../components/Shared.jsx";
import NSData from "../data.js";
import { mergedFacts, monthsIn, channelsIn } from "../lib/businessStore.js";
import { computeCM } from "../lib/cmEngine.js";
import * as CostInputs from "../lib/costInputs.js";
import { runVerification, ANCHOR_MONTH } from "../lib/businessVerification.js";
import BizCoveragePanel from "../components/BizCoveragePanel.jsx";

// ─────────────────────────────────────────────────────────────────────────────
// Module 8 — Finance & Unit Economics  (spec §9 PageFinance)
//
// REAL DERIVED DATA ONLY. Every figure flows from mergedFacts() (bundled May-2026
// baseline ⊕ any uploads) → computeCM() (the pure CM1→CM4 engine) and from the
// editable costInputs registry. There is NO fabricated stub data on this page —
// the prior Whey/Collagen P&L/cash-flow mock was deleted wholesale per spec §9.
//
// HONESTY CONTRACT (spec §11): CM fields are null when a SKU's COGS is missing
// (engine emits null, not 0); CM4 is hidden until the founder enters a monthly
// fixed cost; absent ad-channel totals are surfaced, never silently zeroed.
// No NaN/Infinity is ever rendered — fmtINR/fmtPct guard every derived value.
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

// ── SAFE formatters (NaN/Infinity → em-dash, never leaked) ──
const fmtINR = (n) => (Number.isFinite(n) ? D.fmtINR(n) : "—");
const fmtN = (n) => (Number.isFinite(n) ? D.fmtN(n) : "—");
// pct fraction (0..1) → "12.3%". null/NaN → "—".
const fmtPct = (frac, dp = 1) =>
  Number.isFinite(frac) ? `${(frac * 100).toFixed(dp)}%` : "—";
// signed ₹ with typographic minus before the glyph (matches fmtINR convention).
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

const cmColor = (v) =>
  v == null ? "var(--ink-4)" : v < 0 ? "var(--critical)" : "var(--ink)";

// ─────────────────────────────────────────────────────────────────────────────
const PageFinance = () => {
  const [tab, setTab] = useState("waterfall");
  // costVersion bumps whenever the Cost Inputs panel writes an override, forcing
  // every consumer below (which reads cost data through the live registry) to
  // recompute. The facts themselves are static within a session unless uploaded.
  const [costVersion, setCostVersion] = useState(0);

  const facts = useMemo(() => mergedFacts(), []);
  const months = useMemo(() => {
    const ms = monthsIn(facts);
    return ms.length ? ms : [ANCHOR_MONTH];
  }, [facts]);
  // selectedMonth holds the user's pick; the EFFECTIVE month is derived during
  // render so a stale pick (e.g. a month no longer in the store) safely falls
  // back to the latest available — no sync effect, no cascading render.
  const [selectedMonth, setSelectedMonth] = useState(null);
  const month = selectedMonth && months.includes(selectedMonth)
    ? selectedMonth
    : months[months.length - 1];

  // The single CM computation every view on this page reads from. Recomputes on
  // month change or a cost-input edit (costVersion). Pure — no DOM, NaN-free.
  const cm = useMemo(
    () => computeCM({ facts, month }),
    // costVersion is an intentional dependency: cost overrides change the result
    // even though `facts`/`month` are unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [facts, month, costVersion]
  );

  const channels = useMemo(() => channelsIn(facts).filter((ch) => cm.byChannel[ch]), [facts, cm]);

  const onCostChange = () => setCostVersion((v) => v + 1);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">Finance &amp; Unit Economics</div>
          <div className="page-sub">
            Contribution margin CM1→CM4 · SKU×channel · derived live from the fact store
          </div>
        </div>
        <div className="actions">
          {/* Month selector — May 2026 initially; the store/engine already key on
              YYYY-MM so this list grows automatically as more months land. */}
          <label className="muted" style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 6 }}>
            <Icon name="calendar" size={13}/>
            <select
              value={month}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="fin-month-select"
              style={{
                fontSize: 12, padding: "4px 8px", borderRadius: 6,
                border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--ink)",
              }}
            >
              {months.map((m) => (
                <option key={m} value={m}>{monthLabel(m)}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="tabs">
        <button className={tab === "waterfall" ? "active" : ""} onClick={() => setTab("waterfall")}>CM waterfall</button>
        <button className={tab === "matrix" ? "active" : ""} onClick={() => setTab("matrix")}>CM3 matrix</button>
        <button className={tab === "sku" ? "active" : ""} onClick={() => setTab("sku")}>SKU economics</button>
        <button className={tab === "cost" ? "active" : ""} onClick={() => setTab("cost")}>Cost inputs</button>
        <button className={tab === "coverage" ? "active" : ""} onClick={() => setTab("coverage")}>Coverage</button>
        <button className={tab === "verify" ? "active" : ""} onClick={() => setTab("verify")}>Verification</button>
      </div>

      {!cm.coverage.cogsCovered && (
        <div className="note" style={{ marginBottom: 14, background: "var(--warning-soft)", borderColor: "#E5D3A8" }}>
          <strong style={{ color: "var(--warning)" }}>COGS gap:</strong>&nbsp;
          {cm.coverage.cogsMisses.length} cell(s) have no cost card —{" "}
          {[...new Set(cm.coverage.cogsMisses.map((x) => x.code))].map(skuLabel).join(", ")}.
          Their netRev counts but CM1→CM4 are excluded (shown as “—”, never zero). Add the COGS in the Cost inputs tab.
        </div>
      )}

      {tab === "waterfall" && <WaterfallView cm={cm} channels={channels} month={month}/>}
      {tab === "matrix" && <MatrixView cm={cm} channels={channels}/>}
      {tab === "sku" && <SkuEconomicsView cm={cm} channels={channels}/>}
      {tab === "cost" && <CostInputsView month={month} onChange={onCostChange}/>}
      {tab === "coverage" && (
        <BizCoveragePanel
          facts={facts}
          month={month}
          /* augment engine coverage with the resolved fixed amount so the panel's
             per-month CM4 line reads "fixed cost set" correctly (engine coverage
             carries hasFixedCost but the ₹ lives on company.fixedTotal). */
          coverage={{ ...cm.coverage, fixedAmount: cm.company.fixedTotal ?? null }}
        />
      )}
      {tab === "verify" && <VerificationView facts={facts}/>}
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════════════
// CM WATERFALL — company + per-channel.
// netRev → −COGS → CM1 → −fees → CM2 → −ads → CM3 → −fixed → CM4
// ═════════════════════════════════════════════════════════════════════════════
const WaterfallView = ({ cm, channels, month }) => {
  const co = cm.company;
  const hasFixed = cm.coverage.hasFixedCost;

  return (
    <>
      {/* Headline stat band — company CM milestones */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(5, 1fr)", marginBottom: 14 }}>
        <Card title="Net revenue">
          <div className="stat-num lg">{fmtINR(co.netRev)}</div>
          <div className="muted" style={{ fontSize: 11.5 }}>{fmtN(co.units)} units · {monthLabel(month)}</div>
        </Card>
        <Card title="CM1 · after COGS">
          <div className="stat-num lg" style={{ color: cmColor(co.cm1) }}>{fmtINR(co.cm1)}</div>
          <div className="muted" style={{ fontSize: 11.5 }}>{fmtPct(co.pcts.cm1)} of net rev</div>
        </Card>
        <Card title="CM2 · after fees">
          <div className="stat-num lg" style={{ color: cmColor(co.cm2) }}>{fmtINR(co.cm2)}</div>
          <div className="muted" style={{ fontSize: 11.5 }}>{fmtPct(co.pcts.cm2)} · breakeven-ACOS</div>
        </Card>
        <Card title="CM3 · after ads">
          <div className="stat-num lg" style={{ color: cmColor(co.cm3) }}>{fmtINR(co.cm3)}</div>
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
              <div className="muted" style={{ fontSize: 11.5 }}>set a fixed cost ↗ Cost inputs</div>
            </>
          )}
        </Card>
      </div>

      <Card
        title={`Company contribution margin · ${monthLabel(month)}`}
        sub="Net revenue stepped down through COGS, platform fees, ad spend, and (when set) allocated fixed cost"
      >
        <CMWaterfall cell={co} hasFixed={hasFixed}/>
        <hr className="hr"/>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "var(--ink-3)" }}>
          <span style={{ color: "var(--warning)", fontWeight: 600 }}>CM4 is a reporting view.</span>
          Fixed cost is allocated revenue-proportionally — it taxes high-revenue cells regardless of
          their actual fixed-resource use. <strong>CM3 stays the decision layer</strong> for delist / ad-budget calls.
        </div>
      </Card>

      <Card
        title="Per-channel waterfall"
        sub="Each channel's own CM chain · CM3% is the headline health number"
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
              <th className="num">CM3</th>
              <th className="num">CM3 %</th>
              <th className="num">{hasFixed ? "CM4" : ""}</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((ch) => {
              const c = cm.byChannel[ch];
              const meta = chMeta(ch);
              return (
                <tr key={ch}>
                  <td>
                    <span className="badge" style={{ background: meta.color + "22", color: meta.color, borderColor: meta.color + "55" }}>
                      {meta.label}
                    </span>
                  </td>
                  <td className="num">{fmtINR(c.netRev)}</td>
                  <td className="num muted">{c.cogsCovered ? "−" + fmtINR(c.cogs) : "—"}</td>
                  <td className="num" style={{ color: cmColor(c.cm1) }}>{c.cm1 == null ? "—" : fmtINR(c.cm1)}</td>
                  <td className="num muted">−{fmtINR(c.fees)}</td>
                  <td className="num" style={{ color: cmColor(c.cm2) }}>{c.cm2 == null ? "—" : fmtINR(c.cm2)}</td>
                  <td className="num muted">{c.adSpend > 0 ? "−" + fmtINR(c.adSpend) : <span className="muted">—</span>}</td>
                  <td className="num strong" style={{ color: cmColor(c.cm3) }}>{c.cm3 == null ? "—" : fmtINR(c.cm3)}</td>
                  <td className="num">
                    <span style={{ color: c.pcts.cm3 == null ? "var(--ink-4)" : c.pcts.cm3 < 0 ? "var(--critical)" : c.pcts.cm3 < 0.1 ? "var(--warning)" : "var(--success)" }}>
                      {fmtPct(c.pcts.cm3)}
                    </span>
                  </td>
                  <td className="num muted">{hasFixed ? (c.cm4 == null ? "—" : fmtINR(c.cm4)) : ""}</td>
                </tr>
              );
            })}
            {/* Company total row */}
            <tr style={{ background: "var(--brand-soft)", fontWeight: 600 }}>
              <td>All channels</td>
              <td className="num">{fmtINR(co.netRev)}</td>
              <td className="num muted">{co.cogsCovered ? "−" + fmtINR(co.cogs) : "—"}</td>
              <td className="num" style={{ color: cmColor(co.cm1) }}>{fmtINR(co.cm1)}</td>
              <td className="num muted">−{fmtINR(co.fees)}</td>
              <td className="num" style={{ color: cmColor(co.cm2) }}>{fmtINR(co.cm2)}</td>
              <td className="num muted">−{fmtINR(co.adSpend)}</td>
              <td className="num strong" style={{ color: cmColor(co.cm3) }}>{fmtINR(co.cm3)}</td>
              <td className="num">{fmtPct(co.pcts.cm3)}</td>
              <td className="num">{hasFixed ? fmtINR(co.cm4) : ""}</td>
            </tr>
          </tbody>
        </table>
      </Card>
    </>
  );
};

// One channel/SKU CM chain rendered as a stepped bar waterfall. `cell` is any
// rollup/cell with netRev, cogs, cm1, fees, cm2, adSpend, cm3, fixedAlloc, cm4.
const CMWaterfall = ({ cell, hasFixed }) => {
  const base = Math.max(1, Number.isFinite(cell.netRev) ? cell.netRev : 1);
  // Steps: start = netRev; each deduction is negative; CM milestones are anchors.
  const steps = [
    { label: "Net revenue", value: cell.netRev, type: "start" },
    { label: "− COGS", value: cell.cogsCovered === false ? null : -safe(cell.cogs), deduction: true },
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
            <div className="mono" style={{ fontSize: 11.5, textAlign: "right", fontWeight: isEdge ? 600 : 400, color: v == null ? "var(--ink-4)" : isMilestone ? cmColor(v) : it.deduction ? "var(--critical)" : "var(--ink)" }}>
              {v == null ? "—" : it.deduction ? "−" + fmtINR(Math.abs(v)) : fmtINR(v)}
            </div>
          </div>
        );
      })}
    </div>
  );
};
const safe = (n) => (Number.isFinite(n) ? n : 0);

// ═════════════════════════════════════════════════════════════════════════════
// CM3 MATRIX — the headline view. SKU rows × channel columns, cell = CM3 (with
// CM3% beneath). Negative cells highlighted red. Click a cell or a SKU → drill.
// ═════════════════════════════════════════════════════════════════════════════
const MatrixView = ({ cm, channels }) => {
  const [drill, setDrill] = useState(null); // { code } | { code, channel }
  // Sort SKU rows by total net revenue desc (biggest contributors first).
  const codes = useMemo(
    () => Object.keys(cm.bySku).sort((a, b) => safe(cm.bySku[b].netRev) - safe(cm.bySku[a].netRev)),
    [cm]
  );

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
                          <div className="muted" style={{ fontSize: 10 }}>{fmtPct(m.cm3Pct, 0)}</div>
                        </td>
                      );
                    })}
                    <td className="num strong" style={{ color: cmColor(sku.cm3) }} onClick={() => setDrill({ code })}>
                      <div style={{ cursor: "pointer" }}>{sku.cm3 == null ? "—" : fmtSignedINR(sku.cm3)}</div>
                      <div className="muted" style={{ fontSize: 10 }}>{fmtPct(sku.pcts.cm3, 0)}</div>
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
                      <div className="muted" style={{ fontSize: 10 }}>{fmtPct(c?.pcts?.cm3, 0)}</div>
                    </td>
                  );
                })}
                <td className="num" style={{ color: cmColor(cm.company.cm3) }}>
                  {fmtSignedINR(cm.company.cm3)}
                  <div className="muted" style={{ fontSize: 10 }}>{fmtPct(cm.company.pcts.cm3, 0)}</div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{ padding: "8px 14px", fontSize: 11, color: "var(--ink-3)", display: "flex", gap: 16, flexWrap: "wrap" }}>
          <span><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--critical-soft)", border: "1px solid var(--critical)", borderRadius: 2, marginRight: 5, verticalAlign: "middle" }}/>negative CM3 (loss-making after ads)</span>
          <span>“—” = SKU not sold on that channel, or COGS missing</span>
        </div>
      </Card>

      {drill && (
        <SkuDrillModal code={drill.code} focusChannel={drill.channel} cm={cm} channels={channels} onClose={() => setDrill(null)}/>
      )}
    </>
  );
};

// ═════════════════════════════════════════════════════════════════════════════
// SKU ECONOMICS — per-SKU cards (COGS, blended CM3, channels). Click → drill.
// ═════════════════════════════════════════════════════════════════════════════
const SkuEconomicsView = ({ cm, channels }) => {
  const [drill, setDrill] = useState(null);
  const codes = useMemo(
    () => Object.keys(cm.bySku).sort((a, b) => safe(cm.bySku[b].netRev) - safe(cm.bySku[a].netRev)),
    [cm]
  );

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        {codes.map((code) => {
          const sku = cm.bySku[code];
          const card = CostInputs.getCostCard(code);
          const activeChannels = channels.filter((ch) => sku.byChannel?.[ch]);
          const cm3Pct = sku.pcts.cm3;
          const tone = cm3Pct == null ? "var(--ink-4)" : cm3Pct < 0 ? "var(--critical)" : cm3Pct < 0.1 ? "var(--warning)" : "var(--success)";
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
                  <Stat label="CM3" value={fmtINR(sku.cm3)} color={cmColor(sku.cm3)}/>
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
  if (!sku) return null;
  const activeChannels = channels.filter((ch) => sku.byChannel?.[ch]);
  const hasFixed = cm.coverage.hasFixedCost;
  // Focus the clicked channel's waterfall if a specific cell was clicked; else
  // show the SKU's blended (all-channel) chain.
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
          {/* Per-channel CM chain table for this SKU */}
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
                  <div className="mono muted" style={{ minWidth: 56, textAlign: "right" }}>{c.adSpend > 0 ? fmtINR(c.adSpend) : "—"}</div>
                  <div className="mono" style={{ minWidth: 60, textAlign: "right", fontWeight: 600, color: cmColor(c.cm3) }}>{c.cm3 == null ? "—" : fmtINR(c.cm3)}</div>
                  <div className="mono" style={{ minWidth: 50, textAlign: "right", color: c.pcts.cm3 == null ? "var(--ink-4)" : c.pcts.cm3 < 0 ? "var(--critical)" : "var(--ink-3)" }}>{fmtPct(c.pcts.cm3, 0)}</div>
                </div>
              );
            })}
            {/* SKU blended row */}
            <div className="blk-modal-row" style={{ gridTemplateColumns: "1fr repeat(6, auto)", gap: 10, padding: "8px 14px", background: "var(--bg-sunken)", borderTop: "1px solid var(--border)", fontWeight: 600 }}>
              <div className="blk-modal-row-wh">Blended (all channels)</div>
              <div className="mono" style={{ minWidth: 70, textAlign: "right" }}>{fmtINR(sku.netRev)}</div>
              <div className="mono" style={{ minWidth: 60, textAlign: "right", color: cmColor(sku.cm1) }}>{sku.cm1 == null ? "—" : fmtINR(sku.cm1)}</div>
              <div className="mono" style={{ minWidth: 60, textAlign: "right", color: cmColor(sku.cm2) }}>{sku.cm2 == null ? "—" : fmtINR(sku.cm2)}</div>
              <div className="mono" style={{ minWidth: 56, textAlign: "right" }}>{fmtINR(sku.adSpend)}</div>
              <div className="mono" style={{ minWidth: 60, textAlign: "right", color: cmColor(sku.cm3) }}>{sku.cm3 == null ? "—" : fmtINR(sku.cm3)}</div>
              <div className="mono" style={{ minWidth: 50, textAlign: "right" }}>{fmtPct(sku.pcts.cm3, 0)}</div>
            </div>
          </div>

          {/* Waterfall for the focused channel (or blended) */}
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
// COST INPUTS — editable COGS / fee% / mcfShare / fixed cost, all with as-of +
// source labels and the two ₹0-packaging flags. Writes localStorage overrides.
// ═════════════════════════════════════════════════════════════════════════════
const CostInputsView = ({ month, onChange }) => {
  const [, setVersion] = useState(0);
  const refresh = () => { setVersion((v) => v + 1); onChange(); };
  const inputs = CostInputs.listCostInputs();
  const fixed = CostInputs.getFixedCost(month);
  const today = new Date().toISOString().slice(0, 10);

  const onReset = () => {
    if (typeof window !== "undefined" && !window.confirm("Reset ALL cost inputs to the baked defaults? Your overrides are discarded.")) return;
    CostInputs.resetCostInputs();
    refresh();
  };

  // JSON export/import of the override layer (spec §7 "export/import as JSON").
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
            {/* key includes the live value so a Save/Reset remounts each row,
                re-seeding its input draft from the new source (no sync effect). */}
            {inputs.cogs.map((c) => (
              <CogsRow key={`${c.code}:${c.cogs}`} card={c} onSaved={refresh}/>
            ))}
          </tbody>
        </table>
      </Card>

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
                <td className="num strong">{fmtPct(inputs.websiteBlendedFee.pct, 2)}</td>
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
  // Remounted via key when card.cogs changes (Save/Reset), so the initializer
  // re-seeds from the live value — no draft-sync effect needed.
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
  // Stored as a fraction (0..1); displayed + edited as a percentage. Remounted
  // via key on fee.pct change, so the initializer re-seeds the draft.
  const [draft, setDraft] = useState((fee.pct * 100).toFixed(4).replace(/0+$/, "").replace(/\.$/, ""));
  const pctNum = Number(draft);
  const dirty = Number.isFinite(pctNum) && Math.abs(pctNum / 100 - fee.pct) > 1e-9 && draft !== "";
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
  // Remounted via key on share.share change → initializer re-seeds the draft.
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
  // Remounted via key on month/amount change → initializer re-seeds the draft.
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
        Leave blank to keep CM4 hidden.
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
// VERIFICATION — the permanent regression net (spec §10). MATCH / DRIFT / PENDING
// / NO-DATA per anchor, with the exact filter string so a human can audit it.
// ═════════════════════════════════════════════════════════════════════════════
const STATUS_META = {
  MATCH:     { color: "var(--success)",  label: "MATCH" },
  DRIFT:     { color: "var(--critical)", label: "DRIFT" },
  PENDING:   { color: "var(--ink-3)",    label: "PENDING" },
  "NO-DATA": { color: "var(--warning)",  label: "NO-DATA" },
};

const VerificationView = ({ facts }) => {
  const results = useMemo(() => runVerification(facts), [facts]);
  const counts = results.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});

  return (
    <Card
      title={`Verification · ${monthLabel(ANCHOR_MONTH)} anchors`}
      sub="Every §2/§3 anchor recomputed live from the fact store · MATCH within tolerance, DRIFT surfaces the δ"
      padded={false}
    >
      <div style={{ display: "flex", gap: 14, padding: "10px 14px", borderBottom: "1px solid var(--border-soft)", fontSize: 12 }}>
        {["MATCH", "DRIFT", "PENDING", "NO-DATA"].map((s) => (
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
          {results.map((r) => {
            const sm = STATUS_META[r.status] || STATUS_META.PENDING;
            return (
              <tr key={r.id}>
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
          })}
        </tbody>
      </table>
      <div style={{ padding: "8px 14px", fontSize: 11, color: "var(--ink-3)" }}>
        PENDING anchors await a bundled-baseline pin (Snell/Monarch channel ad totals, post-return-netted Amazon).
        DRIFT means the bundled fact differs from the locked §2/§3 number — a data-baseline matter, not a UI bug.
      </div>
    </Card>
  );
};

export default PageFinance;
