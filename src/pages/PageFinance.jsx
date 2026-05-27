import { useState, useEffect, useRef, useMemo } from "react";
import { Icon, Delta, Card, Sparkline, BarChart, Progress, ChannelPill } from "../components/Shared.jsx";
import NSData from "../data.js";

// Module 8 — Finance & Unit Economics

const PageFinance = () => {
  const D = NSData;
  const [tab, setTab] = useState("pnl");

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">Finance & Unit Economics</div>
          <div className="page-sub">Cost cards · contribution margin · P&L · cash flow · synced with Zoho Books</div>
        </div>
        <div className="actions">
          <div className="seg">
            <button>Daily</button><button>Weekly</button><button className="active">MTD</button><button>YTD</button>
          </div>
          <button className="btn"><Icon name="download" size={13}/>Export</button>
        </div>
      </div>

      <div className="tabs">
        <button className={tab === "pnl" ? "active" : ""} onClick={() => setTab("pnl")}>P&L</button>
        <button className={tab === "cm" ? "active" : ""} onClick={() => setTab("cm")}>Contribution margin</button>
        <button className={tab === "cost" ? "active" : ""} onClick={() => setTab("cost")}>Cost cards</button>
        <button className={tab === "cash" ? "active" : ""} onClick={() => setTab("cash")}>Cash flow</button>
        <button className={tab === "wc" ? "active" : ""} onClick={() => setTab("wc")}>Working capital</button>
      </div>

      {tab === "pnl" && <PnLView/>}
      {tab === "cm" && <ContributionMarginView/>}
      {tab === "cost" && <CostCardsView/>}
      {tab === "cash" && <CashFlowView/>}
      {tab === "wc" && <WorkingCapitalView/>}
    </div>
  );
};

const PnLView = () => {
  const D = NSData;
  const revTotal = Object.values(D.pnl.revenue).reduce((a, b) => a + b, 0);
  const fees = Object.values(D.pnl.platformFees).reduce((a, b) => a + b, 0);
  const adSpend = Object.values(D.pnl.adSpend).reduce((a, b) => a + b, 0);
  const grossProfit = revTotal + D.pnl.cogs;
  const cm = grossProfit + fees + D.pnl.fulfillment + adSpend + D.pnl.influencer;
  const netBeforeOH = cm + D.pnl.overhead;

  const rows = [
    { label: "Revenue", value: revTotal, strong: true, breakdown: D.pnl.revenue },
    { label: "—  Amazon", value: D.pnl.revenue.amazon, indent: 1 },
    { label: "—  Shopify", value: D.pnl.revenue.shopify, indent: 1 },
    { label: "—  Flipkart", value: D.pnl.revenue.flipkart, indent: 1 },
    { label: "—  Blinkit", value: D.pnl.revenue.blinkit, indent: 1 },
    { label: "COGS (landed)", value: D.pnl.cogs, neg: true },
    { label: "Gross profit", value: grossProfit, strong: true, hl: true },
    { label: "Gross margin %", text: ((grossProfit / revTotal) * 100).toFixed(1) + "%", indent: 0, muted: true },
    { divider: true },
    { label: "Platform fees", value: fees, neg: true },
    { label: "—  Amazon (16%)", value: D.pnl.platformFees.amazon, indent: 1, neg: true },
    { label: "—  Flipkart (14%)", value: D.pnl.platformFees.flipkart, indent: 1, neg: true },
    { label: "—  Blinkit (7.6%)", value: D.pnl.platformFees.blinkit, indent: 1, neg: true },
    { label: "Fulfillment costs", value: D.pnl.fulfillment, neg: true },
    { label: "Ad spend", value: adSpend, neg: true },
    { label: "—  Google", value: D.pnl.adSpend.google, indent: 1, neg: true },
    { label: "—  Meta", value: D.pnl.adSpend.meta, indent: 1, neg: true },
    { label: "Influencer spend", value: D.pnl.influencer, neg: true },
    { label: "Contribution margin", value: cm, strong: true, hl: true },
    { label: "Contribution margin %", text: ((cm / revTotal) * 100).toFixed(1) + "%", muted: true },
    { divider: true },
    { label: "Overhead (Zoho)", value: D.pnl.overhead, neg: true, badge: "Zoho synced" },
    { label: "—  Salaries", value: -980000, indent: 1, neg: true },
    { label: "—  Rent + utilities", value: -240000, indent: 1, neg: true },
    { label: "—  SaaS + ops", value: -180000, indent: 1, neg: true },
    { label: "—  Misc / professional", value: -240000, indent: 1, neg: true },
    { label: "Net before tax", value: netBeforeOH, strong: true, hl: true },
    { label: "Net margin %", text: ((netBeforeOH / revTotal) * 100).toFixed(1) + "%", muted: true },
  ];

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 14 }}>
        <Card title="Revenue MTD"><div className="stat-num lg">{D.fmtINR(revTotal)}</div><div className="muted" style={{ fontSize: 11.5 }}><Delta value={19.5}/> vs last mo</div></Card>
        <Card title="Gross margin"><div className="stat-num lg">{((grossProfit/revTotal)*100).toFixed(1)}%</div><div className="muted" style={{ fontSize: 11.5 }}>{D.fmtINR(grossProfit)} gross profit</div></Card>
        <Card title="Contribution margin"><div className="stat-num lg" style={{ color: cm > 0 ? "var(--success)" : "var(--critical)" }}>{((cm/revTotal)*100).toFixed(1)}%</div><div className="muted" style={{ fontSize: 11.5 }}>{D.fmtINR(cm)} CM</div></Card>
        <Card title="Net before tax"><div className="stat-num lg" style={{ color: netBeforeOH > 0 ? "var(--success)" : "var(--critical)" }}>{D.fmtINR(netBeforeOH)}</div><div className="muted" style={{ fontSize: 11.5 }}>{((netBeforeOH/revTotal)*100).toFixed(1)}% margin</div></Card>
      </div>

      <Card title="P&L · May 2026" sub="MTD vs. prior month · synced with Zoho Books for below-the-line" padded={false}>
        <table className="table">
          <thead>
            <tr><th style={{ width: "50%" }}>Line item</th><th className="num">May (MTD)</th><th className="num">Apr</th><th className="num">Δ</th><th className="num">% of revenue</th></tr>
          </thead>
          <tbody>
            {(() => {
              // realistic per-line month-over-month deltas (May MTD vs prior month)
              const deltaByLabel = {
                "Revenue": 19.5, "—  Amazon": 16.2, "—  Shopify": 24.8, "—  Flipkart": 8.4, "—  Blinkit": 38.6,
                "COGS (landed)": 15.2, "Gross profit": 24.6,
                "Platform fees": 14.8, "—  Amazon (16%)": 16.2, "—  Flipkart (14%)": 8.4, "—  Blinkit (7.6%)": 38.6,
                "Fulfillment costs": 12.4, "Ad spend": 8.4, "—  Google": 6.2, "—  Meta": 10.2,
                "Influencer spend": -4.8, "Contribution margin": 42.1,
                "Overhead (Zoho)": 2.4, "—  Salaries": 0.0, "—  Rent + utilities": 0.0, "—  SaaS + ops": 4.2, "—  Misc / professional": 18.6,
                "Net before tax": 86.4,
              };
              const revTotal = Object.values(NSData.pnl.revenue).reduce((a,b)=>a+b,0);
              return rows.map((r, i) => {
                if (r.divider) return <tr key={i}><td colSpan={5} style={{ background: "var(--bg-sunken)", height: 4, padding: 0 }}/></tr>;
                const v = r.value;
                const dlt = deltaByLabel[r.label] ?? 0;
                const prev = (v != null && dlt !== 0) ? v / (1 + dlt/100) : (v != null ? v : 0);
                const pctOfRev = v != null && !r.muted ? Math.abs(v / revTotal) * 100 : null;
                return (
                  <tr key={i} style={{ background: r.hl ? "var(--brand-soft)" : undefined }}>
                    <td style={{ paddingLeft: 12 + (r.indent || 0) * 16, fontWeight: r.strong ? 600 : 400, color: r.muted ? "var(--ink-3)" : undefined }}>
                      {r.label}
                      {r.badge && <span className="badge brand" style={{ marginLeft: 8 }}>{r.badge}</span>}
                    </td>
                    <td className="num" style={{ fontWeight: r.strong ? 600 : 400, color: r.muted ? "var(--ink-3)" : v < 0 ? "var(--ink)" : undefined }}>
                      {r.text || (v < 0 ? "(" + D.fmtINR(Math.abs(v)) + ")" : D.fmtINR(v))}
                    </td>
                    <td className="num muted">
                      {!r.text && (prev < 0 ? "(" + D.fmtINR(Math.abs(prev)) + ")" : D.fmtINR(prev))}
                    </td>
                    <td className="num">
                      {!r.text && dlt !== 0 && <Delta value={dlt}/>}
                    </td>
                    <td className="num muted">
                      {pctOfRev != null && pctOfRev > 0 ? pctOfRev.toFixed(1) + "%" : ""}
                    </td>
                  </tr>
                );
              });
            })()}
          </tbody>
        </table>
      </Card>
    </>
  );
};

const ContributionMarginView = () => {
  const D = NSData;
  // CM per SKU per channel (simplified)
  const rows = D.skuSales.slice(0, 9).map((s, i) => {
    const card = D.costCards.find(c => c.sku === s.code) || { landed: 220, mrp: 800 };
    const channels = D.channels.filter(c => c.id !== "instamart").map(c => {
      const platformFee = { amazon: 0.16, shopify: 0.025, flipkart: 0.14, blinkit: 0.076 }[c.id] || 0.05;
      const fulfilCost = { amazon: 48, shopify: 35, flipkart: 52, blinkit: 28 }[c.id] || 35;
      const adAttrib = c.id === "shopify" ? 86 : 0;
      const sellingPrice = card.mrp * { amazon: 0.92, shopify: 1.0, flipkart: 0.88, blinkit: 0.95 }[c.id];
      const cm = sellingPrice - card.landed - (sellingPrice * platformFee) - fulfilCost - adAttrib;
      return { ch: c, cm, pct: (cm / sellingPrice) * 100, sellingPrice };
    });
    const blendedCM = channels.reduce((a, b) => a + b.cm, 0) / channels.length;
    const blendedPct = channels.reduce((a, b) => a + b.pct, 0) / channels.length;
    return { ...s, card, channels, blendedCM, blendedPct };
  });

  return (
    <>
      <Card title="Contribution margin · per SKU per channel" sub="Revenue − COGS − Packaging − Platform fee − Fulfillment − Ad attribution" padded={false} style={{ marginBottom: 14 }}>
        <table className="table">
          <thead>
            <tr>
              <th>SKU</th>
              <th className="num">MRP</th>
              <th className="num">Landed cost</th>
              <th className="num">Amazon</th>
              <th className="num">Shopify</th>
              <th className="num">Flipkart</th>
              <th className="num">Blinkit</th>
              <th className="num">Blended CM</th>
              <th className="num">CM %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.code}>
                <td>
                  <div>{r.name}</div>
                  <div className="sku">{r.code}</div>
                </td>
                <td className="num">₹{D.fmtN(r.card.mrp)}</td>
                <td className="num">₹{D.fmtN(r.card.landed)}</td>
                {r.channels.map(c => (
                  <td key={c.ch.id} className="num">
                    <div style={{ color: c.cm < 0 ? "var(--critical)" : c.pct < 15 ? "var(--warning)" : "var(--ink)" }}>
                      {c.cm < 0 ? "(₹" + D.fmtN(Math.abs(Math.round(c.cm))) + ")" : "₹" + D.fmtN(Math.round(c.cm))}
                    </div>
                    <div className="muted" style={{ fontSize: 10 }}>{c.pct.toFixed(0)}%</div>
                  </td>
                ))}
                <td className="num strong">₹{D.fmtN(Math.round(r.blendedCM))}</td>
                <td className="num">
                  <span style={{ color: r.blendedPct < 10 ? "var(--critical)" : r.blendedPct < 25 ? "var(--warning)" : "var(--success)" }}>
                    {r.blendedPct.toFixed(1)}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Card title="CM breakdown · Whey Choc 1kg · Amazon" sub="Where every rupee goes">
          <CMWaterfall mrp={1899} platformFee={279} cogs={560} fulfil={48} ad={0} cm={748} sellPrice={1747}/>
        </Card>
        <Card title="CM% over time · top SKUs" sub="last 90 days">
          <CMTrend/>
        </Card>
      </div>
    </>
  );
};

const CMWaterfall = ({ mrp, sellPrice, cogs, platformFee, fulfil, ad, cm }) => {
  const D = NSData;
  const items = [
    { label: "Selling price (Amazon)", value: sellPrice, type: "start" },
    { label: "− COGS + packaging + freight", value: -cogs },
    { label: "− Amazon fee (16%)", value: -platformFee },
    { label: "− Fulfilment", value: -fulfil },
    { label: "− Ad attribution", value: -ad },
    { label: "Contribution margin", value: cm, type: "end" },
  ];
  let running = 0;
  return (
    <div>
      <div style={{ display: "grid", gap: 4 }}>
        {items.map((it, i) => {
          const w = Math.abs(it.value) / sellPrice * 100;
          const isPos = it.value >= 0;
          const isEdge = it.type === "start" || it.type === "end";
          if (it.type === "start") { running = it.value; }
          else if (it.type !== "end") { running += it.value; }
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "180px 1fr 80px", gap: 12, alignItems: "center" }}>
              <div style={{ fontSize: 11.5, color: isEdge ? "var(--ink)" : "var(--ink-3)", fontWeight: isEdge ? 600 : 400 }}>{it.label}</div>
              <div style={{ position: "relative", height: 16, background: "var(--bg-sunken)", borderRadius: 3 }}>
                <div style={{
                  position: "absolute", left: isEdge ? 0 : ((it.value < 0 ? running : running - it.value) / sellPrice * 100) + "%",
                  width: w + "%", height: "100%",
                  background: isEdge ? "var(--brand)" : "var(--critical)",
                  opacity: isEdge ? 1 : 0.5,
                  borderRadius: 3,
                }}/>
              </div>
              <div className="mono" style={{ fontSize: 11.5, textAlign: "right", color: isEdge ? "var(--ink)" : "var(--critical)", fontWeight: isEdge ? 600 : 400 }}>
                {it.value < 0 ? "−₹" + D.fmtN(Math.abs(it.value)) : "₹" + D.fmtN(it.value)}
              </div>
            </div>
          );
        })}
      </div>
      <hr className="hr"/>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span className="muted">CM % (this channel)</span>
        <span className="mono strong" style={{ color: "var(--success)" }}>{(cm/sellPrice*100).toFixed(1)}%</span>
      </div>
    </div>
  );
};

const CMTrend = () => {
  const series = [
    { name: "Multivit W", color: "#2F5E47", data: [32,34,33,35,36,34,33,32,34,35,36,38] },
    { name: "Biotin",     color: "#B07A1F", data: [28,30,32,34,35,36,38,37,38,40,42,44] },
    { name: "Whey Choc",  color: "#3A6072", data: [22,24,23,22,21,22,24,23,22,21,20,22] },
    { name: "Collagen",   color: "#B73838", data: [18,16,14,12,10, 8, 6, 4, 6, 4, 2, 0] },
  ];
  const w = 480, h = 180;
  const pad = { l: 30, r: 90, t: 14, b: 22 };
  const innerW = w - pad.l - pad.r, innerH = h - pad.t - pad.b;
  const max = 50;
  const xFor = i => pad.l + (i / 11) * innerW;
  const yFor = v => pad.t + innerH - (v / max) * innerH;
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`}>
      {[0, 25, 50].map(v => <line key={v} x1={pad.l} x2={w-pad.r} y1={yFor(v)} y2={yFor(v)} stroke="var(--border-soft)"/>)}
      {[0, 25, 50].map(v => <text key={v} x={pad.l-6} y={yFor(v)+3} fontSize="9" fill="var(--ink-3)" textAnchor="end" fontFamily="var(--mono)">{v}%</text>)}
      {series.map((s, si) => {
        const path = s.data.map((v, i) => (i===0?"M":"L") + xFor(i).toFixed(1) + "," + yFor(v).toFixed(1)).join(" ");
        return (
          <g key={si}>
            <path d={path} fill="none" stroke={s.color} strokeWidth="1.6"/>
            <text x={w-pad.r+6} y={yFor(s.data[s.data.length-1])+3} fontSize="10" fill={s.color}>{s.name}</text>
          </g>
        );
      })}
      {[0, 5, 11].map(i => <text key={i} x={xFor(i)} y={h-6} fontSize="9" textAnchor="middle" fill="var(--ink-3)" fontFamily="var(--mono)">W{i+1}</text>)}
    </svg>
  );
};

const CostCardsView = () => {
  const D = NSData;
  return (
    <Card title="Cost cards · per SKU per batch" sub="Manually maintained · same SKU can have different COGS across batches"
      action={<button className="btn primary sm"><Icon name="plus" size={12}/>New cost card</button>}
      padded={false}>
      <table className="table">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Batch</th>
            <th className="num">COGS (raw)</th>
            <th className="num">Packaging</th>
            <th className="num">Freight</th>
            <th className="num">Landed cost</th>
            <th className="num">MRP</th>
            <th className="num">Implied gross %</th>
          </tr>
        </thead>
        <tbody>
          {D.costCards.map((c, i) => (
            <tr key={i}>
              <td>{D.skus.find(s => s.code === c.sku)?.name}<div className="sku">{c.sku}</div></td>
              <td className="sku">{c.batch}</td>
              <td className="num">₹{c.cogs}</td>
              <td className="num">₹{c.packaging}</td>
              <td className="num">₹{c.freight}</td>
              <td className="num strong">₹{c.landed}</td>
              <td className="num">₹{D.fmtN(c.mrp)}</td>
              <td className="num">
                <span style={{ color: ((c.mrp - c.landed) / c.mrp) > 0.5 ? "var(--success)" : "var(--warning)" }}>
                  {(((c.mrp - c.landed) / c.mrp) * 100).toFixed(1)}%
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
};

const CashFlowView = () => {
  const D = NSData;
  const onHand = 6240000;
  let running = onHand;
  const series = D.cashflow.map(c => {
    running += c.inflow + c.outflow;
    return { ...c, balance: running };
  });
  const breach = series.find(c => c.balance < 4000000);

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 14 }}>
        <Card title="Cash on hand"><div className="stat-num lg">{D.fmtINR(onHand)}</div><div className="muted" style={{ fontSize: 11.5 }}>across 3 bank accounts</div></Card>
        <Card title="In-transit from marketplaces"><div className="stat-num lg">{D.fmtINR(4820000)}</div><div className="muted" style={{ fontSize: 11.5 }}>earned · awaiting payout</div></Card>
        <Card title="Owed to suppliers"><div className="stat-num lg" style={{ color: "var(--warning)" }}>{D.fmtINR(2840000)}</div><div className="muted" style={{ fontSize: 11.5 }}>across 6 open POs</div></Card>
        <Card title="Cash runway"><div className="stat-num lg" style={{ color: "var(--warning)" }}>48 days</div><div className="muted" style={{ fontSize: 11.5 }}>at current burn</div></Card>
      </div>

      {breach && (
        <div className="note" style={{ marginBottom: 14, background: "var(--critical-soft)", borderColor: "#E5BFBC" }}>
          <strong style={{ color: "var(--critical)" }}>Cash crunch alert:</strong>&nbsp;
          Projection breaches ₹40L floor on {breach.date} ({D.fmtINR(breach.balance)}). Consider delaying ₹6.8L PO to Marpol by 6 days or accelerating Amazon Lending advance.
        </div>
      )}

      <Card title="Cash flow projection · next 30 days" sub="Inflows from marketplace payouts · outflows from PO log + upcoming expenses" padded={false}>
        <CashFlowChart data={series} onHand={onHand}/>
        <table className="table">
          <thead>
            <tr><th>Date</th><th>Event</th><th className="num">Inflow</th><th className="num">Outflow</th><th className="num">Balance</th></tr>
          </thead>
          <tbody>
            {series.map((c, i) => (
              <tr key={i}>
                <td className="mono">{c.date}</td>
                <td>{c.evt}</td>
                <td className="num">{c.inflow ? <span style={{ color: "var(--success)" }}>+{D.fmtINR(c.inflow)}</span> : <span className="muted">—</span>}</td>
                <td className="num">{c.outflow ? <span style={{ color: "var(--critical)" }}>−{D.fmtINR(Math.abs(c.outflow))}</span> : <span className="muted">—</span>}</td>
                <td className="num strong" style={{ color: c.balance < 4000000 ? "var(--critical)" : c.balance < 6000000 ? "var(--warning)" : undefined }}>
                  {D.fmtINR(c.balance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
};

const CashFlowChart = ({ data, onHand }) => {
  const w = 1080, h = 200;
  const pad = { l: 60, r: 24, t: 18, b: 26 };
  const innerW = w - pad.l - pad.r, innerH = h - pad.t - pad.b;
  const min = Math.min(...data.map(d => d.balance), 4000000) * 0.9;
  const max = Math.max(...data.map(d => d.balance), onHand) * 1.05;
  const xFor = i => pad.l + (i / (data.length - 1)) * innerW;
  const yFor = v => pad.t + innerH - ((v - min) / (max - min)) * innerH;
  const path = data.map((d, i) => (i === 0 ? "M" : "L") + xFor(i).toFixed(1) + "," + yFor(d.balance).toFixed(1)).join(" ");
  const area = path + ` L${xFor(data.length-1).toFixed(1)},${pad.t+innerH} L${pad.l},${pad.t+innerH} Z`;
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block", padding: "10px 14px 0" }}>
      {/* floor */}
      <line x1={pad.l} x2={w-pad.r} y1={yFor(4000000)} y2={yFor(4000000)} stroke="var(--critical)" strokeDasharray="4 4" strokeWidth="1"/>
      <text x={w-pad.r-6} y={yFor(4000000)-4} fontSize="9.5" textAnchor="end" fill="var(--critical)" fontFamily="var(--mono)">₹40L floor</text>
      <path d={area} fill="var(--brand)" opacity="0.1"/>
      <path d={path} fill="none" stroke="var(--brand)" strokeWidth="1.8"/>
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={xFor(i)} cy={yFor(d.balance)} r="3" fill={d.balance < 4000000 ? "var(--critical)" : "var(--brand)"}/>
          {i % 2 === 0 && <text x={xFor(i)} y={h-8} fontSize="9" textAnchor="middle" fill="var(--ink-3)" fontFamily="var(--mono)">{d.date}</text>}
        </g>
      ))}
      {[min, (min+max)/2, max].map((v, i) => (
        <text key={i} x={pad.l - 6} y={yFor(v)+3} fontSize="9" textAnchor="end" fill="var(--ink-3)" fontFamily="var(--mono)">
          {NSData.fmtINR(v)}
        </text>
      ))}
    </svg>
  );
};

const WorkingCapitalView = () => {
  const D = NSData;
  const data = [
    { label: "Locked in inventory", v: 7840000, c: "var(--info)" },
    { label: "In transit (marketplaces)", v: 4820000, c: "var(--brand)" },
    { label: "Receivables (other)", v: 640000, c: "var(--success)" },
    { label: "− Owed to suppliers", v: -2840000, c: "var(--critical)" },
    { label: "− Upcoming expenses", v: -1240000, c: "var(--warning)" },
  ];
  const net = data.reduce((a, b) => a + b.v, 0);
  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 14 }}>
        <Card title="Net working capital"><div className="stat-num lg">{D.fmtINR(net)}</div><div className="muted" style={{ fontSize: 11.5 }}>Current assets − liabilities</div></Card>
        <Card title="Inventory turnover"><div className="stat-num lg">3.6×</div><div className="muted" style={{ fontSize: 11.5 }}>annualised</div></Card>
        <Card title="Days inventory outstanding"><div className="stat-num lg">102 d</div><div className="muted" style={{ fontSize: 11.5 }}>blended</div></Card>
        <Card title="Cash conversion cycle"><div className="stat-num lg">86 days</div><div className="muted" style={{ fontSize: 11.5 }}>DIO 102 + DSO 14 − DPO 30</div></Card>
      </div>

      <Card title="Working capital composition" sub="Where the money lives">
        <div style={{ display: "grid", gap: 12 }}>
          {data.map(d => (
            <div key={d.label} style={{ display: "grid", gridTemplateColumns: "200px 1fr 120px", gap: 12, alignItems: "center" }}>
              <div style={{ fontSize: 12 }}>{d.label}</div>
              <div style={{ position: "relative", height: 14, background: "var(--bg-sunken)", borderRadius: 3 }}>
                <div style={{ width: Math.abs(d.v) / 9000000 * 100 + "%", height: "100%", background: d.c, borderRadius: 3 }}/>
              </div>
              <div className="mono text-right" style={{ fontSize: 12 }}>
                <span style={{ color: d.v < 0 ? "var(--critical)" : "var(--ink)" }}>
                  {d.v < 0 ? "−" + D.fmtINR(Math.abs(d.v)) : D.fmtINR(d.v)}
                </span>
              </div>
            </div>
          ))}
          <hr className="hr"/>
          <div style={{ display: "grid", gridTemplateColumns: "200px 1fr 120px", gap: 12, alignItems: "center", fontWeight: 600 }}>
            <div>Net working capital</div>
            <div></div>
            <div className="mono text-right">{D.fmtINR(net)}</div>
          </div>
        </div>
      </Card>
    </>
  );
};


export default PageFinance;
