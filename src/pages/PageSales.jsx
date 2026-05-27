import { useState, useEffect, useRef, useMemo } from "react";
import { Icon, Delta, Card, Sparkline, BarChart, Progress, ChannelPill } from "../components/Shared.jsx";
import NSData from "../data.js";

// Module 2 — Sales & Revenue Intelligence

const PageSales = () => {
  const D = NSData;
  const [range, setRange] = useState("30d");
  const [sort, setSort] = useState("revenue");
  const [trajectory, setTrajectory] = useState("current");
  const [growthInput, setGrowthInput] = useState(15);

  const ranges = [
    { id: "today", label: "Today" }, { id: "yday", label: "Yesterday" },
    { id: "7d", label: "Last 7D" }, { id: "30d", label: "Last 30D" }, { id: "custom", label: "Custom" }
  ];

  const sorted = [...D.skuSales].sort((a, b) => {
    if (sort === "revenue") return b.revenue30 - a.revenue30;
    if (sort === "growth") return b.growth - a.growth;
    if (sort === "returns") return b.returnRate - a.returnRate;
    return 0;
  });

  // projection
  const mtdRunRate = D.revenueMTD / 21 * 31;
  const projected = trajectory === "current" ? mtdRunRate : D.revenueMTDLast * (1 + growthInput / 100);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">Sales & Revenue Intelligence</div>
          <div className="page-sub">Multi-channel performance · projections · returns</div>
        </div>
        <div className="actions">
          <div className="seg">
            {ranges.map(r => (
              <button key={r.id} className={range === r.id ? "active" : ""} onClick={() => setRange(r.id)}>{r.label}</button>
            ))}
          </div>
          <button className="btn"><Icon name="download" size={13}/>Export</button>
        </div>
      </div>

      {/* Channel cards */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(5, 1fr)", marginBottom: 16 }}>
        {D.channels.map(c => {
          const live = c.id !== "instamart";
          const rev = live ? (D.pnl.revenue[c.id] || 0) : 0;
          const units = live ? Math.round(rev / 420) : 0;
          const orders = live ? Math.round(units * 0.86) : 0;
          const aov = orders ? Math.round(rev / orders) : 0;
          const returnRate = live ? [3.4, 2.1, 4.8, 1.9][D.channels.indexOf(c)] || 2.4 : 0;
          const delta = live ? [12.4, 8.1, -3.2, 28.6][D.channels.indexOf(c)] || 4.4 : 0;
          return (
            <div key={c.id} className="card" style={{ opacity: live ? 1 : 0.55 }}>
              <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid var(--border-soft)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="badge" style={{ background: c.color + "22", color: c.color, borderColor: c.color + "55" }}>{c.short}</span>
                  {live && <Delta value={delta}/>}
                </div>
                <div className="mono" style={{ fontSize: 19, marginTop: 8, fontWeight: 500 }}>
                  {live ? D.fmtINR(rev) : "—"}
                </div>
                <div className="muted" style={{ fontSize: 11 }}>{c.name} · MTD</div>
              </div>
              <div style={{ padding: "10px 14px", fontSize: 11.5, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px" }}>
                <div className="muted">Orders</div><div className="mono text-right">{live ? D.fmtN(orders) : "—"}</div>
                <div className="muted">Units</div><div className="mono text-right">{live ? D.fmtN(units) : "—"}</div>
                <div className="muted">AOV</div><div className="mono text-right">{live ? "₹" + D.fmtN(aov) : "—"}</div>
                <div className="muted">Return rate</div><div className="mono text-right">{live ? returnRate.toFixed(1) + "%" : "—"}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Projection chart */}
      <Card title="Revenue projection · current month" sub="Rolling 30-day velocity vs target vs last month"
        action={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div className="seg">
              <button className={trajectory === "current" ? "active" : ""} onClick={() => setTrajectory("current")}>Current trajectory</button>
              <button className={trajectory === "custom" ? "active" : ""} onClick={() => setTrajectory("custom")}>Custom trajectory</button>
            </div>
            {trajectory === "custom" && (
              <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11.5 }}>
                <span className="muted">Growth</span>
                <input className="txt" style={{ width: 56 }} value={growthInput} onChange={e => setGrowthInput(parseFloat(e.target.value) || 0)}/>
                <span className="muted">% over last month</span>
              </div>
            )}
          </div>
        }
        style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 24, alignItems: "stretch" }}>
          <div>
            <ProjectionChart projected={projected} target={D.revenueMTDTarget} lastMonth={D.revenueMTDLast} mtd={D.revenueMTD}/>
          </div>
          <div style={{ borderLeft: "1px solid var(--border-soft)", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 12, justifyContent: "center" }}>
            <div>
              <div className="stat-label">MTD actual</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 500 }}>{D.fmtINR(D.revenueMTD)}</div>
            </div>
            <div>
              <div className="stat-label">Projected EOM</div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 500, color: projected >= D.revenueMTDTarget ? "var(--success)" : "var(--warning)" }}>
                {D.fmtINR(projected)}
              </div>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                {((projected / D.revenueMTDTarget) * 100).toFixed(0)}% of target · {((projected - D.revenueMTDLast)/D.revenueMTDLast*100).toFixed(1)}% vs last month
              </div>
            </div>
            <div>
              <div className="stat-label">Gap to target</div>
              <div className="mono" style={{ fontSize: 16, color: "var(--critical)" }}>
                {D.fmtINR(D.revenueMTDTarget - projected)}
              </div>
              <div className="muted" style={{ fontSize: 11.5 }}>
                {trajectory === "current" ? "Need ~15% lift to close gap" : "Custom growth applied uniformly"}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* SKU breakdown */}
      <Card title="SKU breakdown · last 30 days" sub={`${sorted.length} active SKUs`}
        action={
          <div style={{ display: "flex", gap: 8 }}>
            <div className="seg">
              <button className={sort === "revenue" ? "active" : ""} onClick={() => setSort("revenue")}>Revenue</button>
              <button className={sort === "growth" ? "active" : ""} onClick={() => setSort("growth")}>Growth</button>
              <button className={sort === "returns" ? "active" : ""} onClick={() => setSort("returns")}>Returns</button>
            </div>
            <button className="btn sm"><Icon name="filter" size={12}/>Filters</button>
          </div>
        }
        padded={false}
        style={{ marginBottom: 16 }}>
        <table className="table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Variant</th>
              <th className="num">Revenue 30d</th>
              <th className="num">Units</th>
              <th className="num">AOV</th>
              <th className="num">Growth</th>
              <th className="num">Returns</th>
              <th>Channel mix</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(s => {
              const total = s.revenue30;
              return (
                <tr key={s.code}>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span>{s.name}</span>
                      <span className="sku">{s.code}</span>
                    </div>
                  </td>
                  <td className="muted">{s.variant}</td>
                  <td className="num">{D.fmtINR(s.revenue30)}</td>
                  <td className="num">{D.fmtN(s.units30)}</td>
                  <td className="num">₹{D.fmtN(s.aov)}</td>
                  <td className="num"><Delta value={s.growth}/></td>
                  <td className="num">
                    <span style={{ color: s.returnRate > 3 ? "var(--critical)" : s.returnRate > 2 ? "var(--warning)" : "var(--ink)" }}>
                      {s.returnRate.toFixed(1)}%
                    </span>
                  </td>
                  <td style={{ minWidth: 180 }}>
                    <div style={{ display: "flex", height: 10, borderRadius: 3, overflow: "hidden", border: "1px solid var(--border-soft)" }}>
                      {D.channels.filter(c => s.splits[c.id]).map(c => (
                        <div key={c.id} title={c.name + ": " + D.fmtINR(s.splits[c.id])} style={{ width: ((s.splits[c.id] || 0) / total * 100) + "%", background: c.color }}/>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* Returns intelligence */}
      <div className="grid" style={{ gridTemplateColumns: "1.4fr 1fr" }}>
        <Card title="Returns intelligence" sub="By SKU & channel · last 30 days">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <div className="stat-label">Highest return rate</div>
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                {[...D.skuSales].sort((a,b)=>b.returnRate-a.returnRate).slice(0,5).map(s => (
                  <div key={s.code} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ flex: 1, fontSize: 12 }}>{s.name}</span>
                    <Progress value={s.returnRate * 10} max={50} color={s.returnRate > 3 ? "red" : s.returnRate > 2 ? "amber" : "brand"}/>
                    <span className="mono" style={{ fontSize: 11, width: 40, textAlign: "right" }}>{s.returnRate.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="stat-label">Top return reasons · last 30d</div>
              <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                {[
                  { reason: "Lumpy / doesn't mix", pct: 28, sku: "Plant Protein, Whey Choc 2K" },
                  { reason: "Taste / smell off", pct: 22, sku: "Collagen, Omega-3" },
                  { reason: "Damaged in transit", pct: 18, sku: "—" },
                  { reason: "Not as described", pct: 12, sku: "Biotin" },
                  { reason: "Wrong product", pct: 8, sku: "—" },
                  { reason: "Other", pct: 12, sku: "—" },
                ].map((r, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ flex: 1, fontSize: 12 }}>{r.reason}</span>
                    <span className="muted" style={{ fontSize: 10.5, flex: "0 0 auto" }}>{r.sku}</span>
                    <span className="mono" style={{ fontSize: 11, width: 32, textAlign: "right" }}>{r.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>

        <Card title="Return rate trend · all SKUs" sub="last 12 weeks">
          <div className="stat-num lg">2.6%</div>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}><Delta value={-0.3} suffix="vs prev 12w"/></div>
          <hr className="hr"/>
          <BarChart data={[2.1, 2.3, 2.2, 2.4, 2.8, 2.6, 2.5, 2.7, 3.1, 2.9, 2.7, 2.6]} w={300} h={100} color="var(--warning)"
            labels={["W1","","","W4","","","W7","","","W10","","W12"]}/>
          <div className="note" style={{ marginTop: 10 }}>
            <strong>Insight:</strong>&nbsp;Plant Protein driving recent spike. Check formulation feedback before next batch.
          </div>
        </Card>
      </div>
    </div>
  );
};

const ProjectionChart = ({ projected, target, lastMonth, mtd }) => {
  const w = 600, h = 200;
  const days = 31;
  const today = 21;
  const pad = { l: 36, r: 16, t: 14, b: 24 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const max = Math.max(projected, target, lastMonth) * 1.05;
  const yFor = v => pad.t + innerH - (v / max) * innerH;
  const xFor = d => pad.l + ((d - 1) / (days - 1)) * innerW;

  // generate three series
  const actualPts = Array.from({ length: today }, (_, i) => [xFor(i + 1), yFor(mtd / today * (i + 1))]);
  const projPts = Array.from({ length: days - today + 1 }, (_, i) => [xFor(today + i), yFor(mtd + (projected - mtd) * (i / (days - today)))]);
  const lastPts = Array.from({ length: days }, (_, i) => [xFor(i + 1), yFor(lastMonth / 31 * (i + 1))]);

  const toPath = (pts) => pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");

  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      {/* grid */}
      {[0, 0.5, 1].map((t, i) => (
        <g key={i}>
          <line x1={pad.l} y1={pad.t + innerH * t} x2={w - pad.r} y2={pad.t + innerH * t} stroke="var(--border-soft)"/>
          <text x={pad.l - 6} y={pad.t + innerH * t + 3} fontSize="9" textAnchor="end" fill="var(--ink-3)" fontFamily="var(--mono)">
            ₹{((max * (1 - t)) / 10000000).toFixed(1)}Cr
          </text>
        </g>
      ))}
      {/* target line */}
      <line x1={pad.l} x2={w - pad.r} y1={yFor(target)} y2={yFor(target)} stroke="var(--brand)" strokeDasharray="4 4" strokeWidth="1"/>
      <text x={w - pad.r - 6} y={yFor(target) - 4} fontSize="9.5" textAnchor="end" fill="var(--brand)" fontFamily="var(--mono)">target {(target/10000000).toFixed(2)}Cr</text>

      {/* last month */}
      <path d={toPath(lastPts)} fill="none" stroke="var(--ink-4)" strokeWidth="1.2" strokeDasharray="3 3"/>
      {/* actual */}
      <path d={toPath(actualPts)} fill="none" stroke="var(--ink)" strokeWidth="1.8"/>
      {/* projection */}
      <path d={toPath(projPts)} fill="none" stroke="var(--warning)" strokeWidth="1.8" strokeDasharray="2 3"/>

      {/* today marker */}
      <line x1={xFor(today)} x2={xFor(today)} y1={pad.t} y2={pad.t + innerH} stroke="var(--ink-3)" strokeWidth="0.5" strokeDasharray="2 2"/>
      <text x={xFor(today) + 4} y={pad.t + 10} fontSize="9" fill="var(--ink-3)" fontFamily="var(--mono)">today</text>

      {/* x labels */}
      {[1, 8, 15, 22, 29].map(d => (
        <text key={d} x={xFor(d)} y={h - 6} fontSize="9" textAnchor="middle" fill="var(--ink-3)" fontFamily="var(--mono)">{d}</text>
      ))}
      {/* legend */}
      <g transform={`translate(${pad.l + 8}, ${pad.t + 8})`}>
        <line x1="0" y1="0" x2="14" y2="0" stroke="var(--ink)" strokeWidth="1.8"/>
        <text x="18" y="3" fontSize="10" fill="var(--ink-2)">MTD actual</text>
        <line x1="84" y1="0" x2="98" y2="0" stroke="var(--warning)" strokeWidth="1.8" strokeDasharray="2 3"/>
        <text x="102" y="3" fontSize="10" fill="var(--ink-2)">Projected</text>
        <line x1="160" y1="0" x2="174" y2="0" stroke="var(--ink-4)" strokeWidth="1.2" strokeDasharray="3 3"/>
        <text x="178" y="3" fontSize="10" fill="var(--ink-2)">Last month</text>
      </g>
    </svg>
  );
};


export default PageSales;
