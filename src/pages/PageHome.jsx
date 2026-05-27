import { useState, useEffect, useRef, useMemo } from "react";
import { Icon, Delta, Card, Sparkline, BarChart, Progress, ChannelPill } from "../components/Shared.jsx";
import NSData from "../data.js";

// Module 1 — Command Center Dashboard (Home)

const PageHome = ({ role, onNav }) => {
  const D = NSData;
  const todayTotal = Object.values(D.revenueToday).reduce((a, b) => a + b, 0);
  const ydayTotal = Object.values(D.revenueYesterday).reduce((a, b) => a + b, 0);
  const dod = ((todayTotal - ydayTotal) / ydayTotal) * 100;
  const mtdPct = (D.revenueMTD / D.revenueMTDTarget) * 100;
  const mtdGrowth = ((D.revenueMTD - D.revenueMTDLast) / D.revenueMTDLast) * 100;

  // alerts visible for this role
  const visible = D.alerts.filter(a => a.roles.includes(role) || role === "founder" || role === "office");
  const crit = visible.filter(a => a.sev === "crit");
  const warn = visible.filter(a => a.sev === "warn");
  const info = visible.filter(a => a.sev === "info");

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">Command Center</div>
          <div className="page-sub">Thursday, 21 May 2026 · 10:42 IST · live</div>
        </div>
        <div className="actions">
          <div className="seg">
            <button>Today</button>
            <button className="active">Live</button>
          </div>
          <button className="btn"><Icon name="download" size={13}/>Export digest</button>
        </div>
      </div>

      {/* Health scorecards */}
      <div className="health" style={{ marginBottom: 16 }}>
        <div className="health-card amber">
          <div className="ribbon"/>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div className="stat-label">Sales Health</div>
            <span className="badge amber">Amber</span>
          </div>
          <div className="stat-num lg" style={{ marginTop: 6 }}>82.7%</div>
          <div className="stat-sub muted">of MTD target · {D.fmtINR(D.revenueMTD)} / {D.fmtINR(D.revenueMTDTarget)}</div>
          <div style={{ marginTop: 10 }}>
            <Progress value={D.revenueMTD} max={D.revenueMTDTarget} color="amber"/>
          </div>
        </div>

        <div className="health-card red">
          <div className="ribbon"/>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div className="stat-label">Inventory Health</div>
            <span className="badge red">Critical</span>
          </div>
          <div className="stat-num lg" style={{ marginTop: 6 }}>3 SKUs</div>
          <div className="stat-sub muted">Need reordering of packaging/raw material urgently</div>
          <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
            <span className="badge red dot">3 red</span>
            <span className="badge amber dot">4 amber</span>
            <span className="badge green dot">6 green</span>
          </div>
        </div>

        <div className="health-card green">
          <div className="ribbon"/>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div className="stat-label">Ad Performance</div>
            <span className="badge green">On target</span>
          </div>
          <div className="stat-num lg" style={{ marginTop: 6 }}>3.56×</div>
          <div className="stat-sub muted">blended ROAS · target 3.20×</div>
          <div style={{ marginTop: 10, fontSize: 11, color: "var(--ink-3)" }}>
            <span className="mono">Google 3.39× · Meta 3.73×</span>
          </div>
        </div>

        <div className="health-card amber">
          <div className="ribbon"/>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div className="stat-label">Cash Position</div>
            <span className="badge amber">Watch</span>
          </div>
          <div className="stat-num lg" style={{ marginTop: 6 }}>48 days</div>
          <div className="stat-sub muted">runway · ₹62L on hand · breach Jun 04</div>
          <div style={{ marginTop: 10 }}>
            <Progress value={48} max={90} color="amber"/>
          </div>
        </div>
      </div>

      {/* Live revenue + alerts */}
      <div className="grid" style={{ gridTemplateColumns: "2fr 1fr", marginBottom: 16 }}>
        <Card title="Live revenue" sub="snapshot · all channels"
          action={<div className="seg"><button className="active">Today</button><button>WTD</button><button>MTD</button></div>}>
          <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 24, alignItems: "center" }}>
            <div>
              <div className="stat-label">Revenue today</div>
              <div className="stat-num xl tnum">{D.fmtINR(todayTotal)}</div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6 }}>
                <Delta value={dod}/>
                <span className="muted" style={{ fontSize: 11 }}>vs yesterday {D.fmtINR(ydayTotal)}</span>
              </div>
              <hr className="hr"/>
              <div className="kv">
                <dt>WTD</dt>           <dd>{D.fmtINR(6840000)} <span className="delta up">+12.4%</span></dd>
                <dt>MTD</dt>           <dd>{D.fmtINR(D.revenueMTD)} <span className="delta up">+{mtdGrowth.toFixed(1)}%</span></dd>
                <dt>Target</dt>        <dd>{D.fmtINR(D.revenueMTDTarget)}</dd>
                <dt>Pacing</dt>        <dd>{mtdPct.toFixed(0)}% of target</dd>
              </div>
            </div>

            <div>
              <div className="legend" style={{ marginBottom: 8 }}>
                {D.channels.filter(c => D.revenueToday[c.id]).map(c => (
                  <span key={c.id}><span className="swatch" style={{ background: c.color }}/>{c.name}</span>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                {D.channels.filter(c => c.id !== "instamart").map(c => {
                  const t = D.revenueToday[c.id], avg = D.revenue7dAvg[c.id];
                  const d = ((t - avg) / Math.max(avg, 1)) * 100;
                  return (
                    <div key={c.id} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "10px 11px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span className="badge" style={{ background: c.color + "22", color: c.color, borderColor: c.color + "55" }}>{c.short}</span>
                        <Delta value={d}/>
                      </div>
                      <div className="mono" style={{ fontSize: 16, marginTop: 6, fontWeight: 500 }}>{D.fmtINR(t)}</div>
                      <div className="muted" style={{ fontSize: 10.5, marginTop: 2 }}>{c.name} · 7d avg {D.fmtINR(avg)}</div>
                    </div>
                  );
                })}
                <div style={{ border: "1px dashed var(--border)", borderRadius: 6, padding: "10px 11px", color: "var(--ink-3)" }}>
                  <span className="badge">INS</span>
                  <div className="mono" style={{ fontSize: 13, marginTop: 6 }}>—</div>
                  <div style={{ fontSize: 10.5, marginTop: 2 }}>Instamart · onboarding</div>
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <div className="stat-label" style={{ marginBottom: 4 }}>Last 30 days · revenue (₹ lakhs)</div>
                <Sparkline data={D.trend30} w={620} h={56} color="var(--brand)"/>
              </div>
            </div>
          </div>
        </Card>

        <Card title="Active alerts" sub={`${crit.length} critical · ${warn.length} warning · ${info.length} insight`}
          action={<button className="btn ghost sm" onClick={() => onNav("alerts")}>View all <Icon name="arrowRight" size={12}/></button>}
          padded={false}>
          <div>
            {[...crit, ...warn, ...info].slice(0, 6).map(a => (
              <div key={a.id} className={"alert " + (a.sev === "crit" ? "crit" : a.sev === "warn" ? "warn" : "info")} onClick={() => onNav(a.module)}>
                <span className="dot"/>
                <div className="body">
                  <div className="title">{a.title}</div>
                  <div className="meta">
                    <span className="tag">{a.cat}</span>
                    <span>{a.time}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Cash flow expected */}
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 16 }}>
        <Card title="Cash inflow · next 7 days" sub="expected payouts + receivables">
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <div className="stat-num xl tnum" style={{ color: "var(--success)" }}>
              {D.fmtINR(D.cashExpected.inflow7d)}
            </div>
            <Delta value={18.4}/>
          </div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
            Across Amazon, Shopify, Flipkart and Blinkit payouts
          </div>
          <hr className="hr"/>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span className="stat-label">Next 30 days · expected inflow</span>
            <span className="mono" style={{ fontSize: 12.5, fontWeight: 500 }}>{D.fmtINR(D.cashExpected.inflow30d)}</span>
          </div>
        </Card>

        <Card title="Cash outflow · next 7 days" sub="supplier payments + opex due">
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <div className="stat-num xl tnum" style={{ color: "var(--critical)" }}>
              {D.fmtINR(D.cashExpected.outflow7d)}
            </div>
            <Delta value={-6.2}/>
          </div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
            Glanbia 70% balance · packaging invoices
          </div>
          <hr className="hr"/>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span className="stat-label">Next 30 days · expected outflow</span>
            <span className="mono" style={{ fontSize: 12.5, fontWeight: 500 }}>{D.fmtINR(D.cashExpected.outflow30d)}</span>
          </div>
        </Card>
      </div>

      {/* Summary numbers row */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 16 }}>
        <Card title="Active SKUs">
          <div className="stat-num lg">13</div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>Combined stock value · <span className="mono">₹78.4L</span></div>
        </Card>
        <Card title="Blended ROAS">
          <div className="stat-num lg">3.56×</div>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginTop: 2 }}>
            <span className="muted" style={{ fontSize: 11.5 }}>Today</span>
            <Delta value={4.2}/>
            <span className="muted" style={{ fontSize: 11.5 }}>WTD 3.41×</span>
          </div>
        </Card>
        <Card title="Runway < 30 days">
          <div className="stat-num lg" style={{ color: "var(--critical)" }}>7 SKUs</div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>3 below supplier lead time</div>
        </Card>
        <Card title="Batches expiring · 60d">
          <div className="stat-num lg" style={{ color: "var(--warning)" }}>4 batches</div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>~3,070 units at risk · <span className="mono">₹6.8L</span> exposure</div>
        </Card>
      </div>

      {/* Channel mix + activity */}
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Card title="Channel mix · MTD">
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <svg width="140" height="140" viewBox="0 0 140 140">
              {(() => {
                const totals = D.channels.filter(c => c.id !== "instamart").map(c => ({ c, v: (D.pnl.revenue[c.id] || 0) }));
                const sum = totals.reduce((a, b) => a + b.v, 0);
                let a0 = -Math.PI / 2;
                return totals.map(({ c, v }) => {
                  const a1 = a0 + (v / sum) * Math.PI * 2;
                  const large = a1 - a0 > Math.PI ? 1 : 0;
                  const x1 = 70 + 60 * Math.cos(a0), y1 = 70 + 60 * Math.sin(a0);
                  const x2 = 70 + 60 * Math.cos(a1), y2 = 70 + 60 * Math.sin(a1);
                  const d = `M70,70 L${x1.toFixed(1)},${y1.toFixed(1)} A60,60 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z`;
                  const out = <path key={c.id} d={d} fill={c.color} opacity="0.88" stroke="white" strokeWidth="1.5"/>;
                  a0 = a1;
                  return out;
                });
              })()}
              <circle cx="70" cy="70" r="34" fill="white"/>
              <text x="70" y="68" textAnchor="middle" fontSize="11" fill="var(--ink-3)" fontFamily="var(--mono)">MTD</text>
              <text x="70" y="82" textAnchor="middle" fontSize="13" fill="var(--ink)" fontFamily="var(--mono)" fontWeight="600">₹2.89 Cr</text>
            </svg>
            <div style={{ flex: 1 }}>
              {D.channels.filter(c => c.id !== "instamart").map(c => {
                const v = D.pnl.revenue[c.id] || 0;
                const sum = Object.values(D.pnl.revenue).reduce((a,b)=>a+b,0);
                const p = (v / sum) * 100;
                return (
                  <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "1px solid var(--border-soft)" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span className="swatch" style={{ background: c.color, display: "inline-block", width: 10, height: 10, borderRadius: 2 }}/>
                      <span style={{ fontSize: 12 }}>{c.name}</span>
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                      <span className="mono" style={{ fontSize: 11.5 }}>{p.toFixed(0)}%</span>
                      <span className="mono" style={{ fontSize: 11.5, width: 64, textAlign: "right" }}>{D.fmtINR(v)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>

        <Card title="Today's signal" sub="What needs your attention right now">
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 10 }}>
            <li style={{ display: "flex", gap: 10 }}>
              <span style={{ width: 4, background: "var(--critical)", borderRadius: 2 }}/>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 500 }}>Place reorder for <span className="mono">NS-MUL-WMN-60</span> today</div>
                <div className="muted" style={{ fontSize: 11.5 }}>8d runway on FBA · Lonza lead time 18d · already past reorder window</div>
              </div>
            </li>
            <li style={{ display: "flex", gap: 10 }}>
              <span style={{ width: 4, background: "var(--critical)", borderRadius: 2 }}/>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 500 }}>Resolve Amazon suppression — Whey Choc 2kg</div>
                <div className="muted" style={{ fontSize: 11.5 }}>Image policy flag · listing inactive 4h · ListLogic notified</div>
              </div>
            </li>
            <li style={{ display: "flex", gap: 10 }}>
              <span style={{ width: 4, background: "var(--warning)", borderRadius: 2 }}/>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 500 }}>Decide on Omega-3 Batch B-2412 — flash sale window closing</div>
                <div className="muted" style={{ fontSize: 11.5 }}>47 days to expiry · 1,840 units · won't clear at current velocity</div>
              </div>
            </li>
            <li style={{ display: "flex", gap: 10 }}>
              <span style={{ width: 4, background: "var(--info)", borderRadius: 2 }}/>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 500 }}>Scale Biotin+Hair Meta budget — CAC 36% under blended</div>
                <div className="muted" style={{ fontSize: 11.5 }}>Creative #BIO-V3 · ROAS 5.21× · suggested +25% daily</div>
              </div>
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
};


export default PageHome;
