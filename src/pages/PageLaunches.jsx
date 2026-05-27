import { useState, useEffect, useRef, useMemo } from "react";
import { Icon, Delta, Card, Sparkline, BarChart, Progress, ChannelPill } from "../components/Shared.jsx";
import NSData from "../data.js";

// Module 9 — New SKU Launch Tracker

const PageLaunches = () => {
  const D = NSData;
  const [activeId, setActiveId] = useState(D.launches[0].id);
  const active = D.launches.find(l => l.id === activeId);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">Launch Tracker</div>
          <div className="page-sub">Pre-launch milestones · post-launch performance · {D.launches.length} active</div>
        </div>
        <div className="actions">
          <button className="btn"><Icon name="download" size={13}/>Export</button>
          <button className="btn primary"><Icon name="plus" size={13}/>New launch</button>
        </div>
      </div>

      {/* Launch chips */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {D.launches.map(l => (
          <button key={l.id} onClick={() => setActiveId(l.id)}
            className="card" style={{
              cursor: "pointer", padding: "10px 14px",
              border: activeId === l.id ? "1.5px solid var(--brand)" : "1px solid var(--border)",
              minWidth: 260, textAlign: "left", background: activeId === l.id ? "var(--brand-soft)" : "var(--bg-card)"
            }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span className="sku">{l.id}</span>
              <span className={"badge " + (l.phase === "post" ? "green" : "blue")}>{l.phase === "post" ? "Post-launch" : "Pre-launch"}</span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{l.name}</div>
            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{l.target}</div>
            <div style={{ marginTop: 8 }}>
              <Progress value={l.progress} color={l.phase === "post" ? "green" : "brand"}/>
            </div>
          </button>
        ))}
      </div>

      {active.phase === "pre" ? <PreLaunchView launch={active}/> : <PostLaunchView launch={active}/>}
    </div>
  );
};

const PreLaunchView = ({ launch }) => {
  const D = NSData;
  const done = launch.milestones.filter(m => m.status === "done").length;
  const delayed = launch.milestones.filter(m => m.status === "delayed").length;
  const progress = launch.milestones.filter(m => m.status === "progress").length;
  const totalWeeks = 14;
  const weeks = Array.from({ length: totalWeeks }, (_, i) => i + 1);

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 14 }}>
        <Card title="Target launch date"><div className="stat-num lg">{launch.target}</div><div className="muted" style={{ fontSize: 11.5 }}>{launch.id} · {launch.sku}</div></Card>
        <Card title="Milestones complete"><div className="stat-num lg" style={{ color: "var(--success)" }}>{done}/{launch.milestones.length}</div><div className="muted" style={{ fontSize: 11.5 }}>{progress} in progress</div></Card>
        <Card title="Delayed milestones"><div className="stat-num lg" style={{ color: delayed ? "var(--critical)" : "var(--success)" }}>{delayed}</div><div className="muted" style={{ fontSize: 11.5 }}>{delayed ? "Listing copy · was due May 14" : "On track"}</div></Card>
        <Card title="Critical path"><div className="stat-num lg" style={{ color: "var(--warning)" }}>Listing copy</div><div className="muted" style={{ fontSize: 11.5 }}>Blocking creatives + ad copy</div></Card>
      </div>

      <Card title={"Milestone timeline · " + launch.name} sub="Drag to reschedule · click for owner notes" padded={false}>
        <div style={{ padding: "10px 12px 0", display: "grid", gridTemplateColumns: "260px 1fr", borderBottom: "1px solid var(--border-soft)" }}>
          <div className="stat-label" style={{ padding: "6px 0" }}>Milestone</div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${totalWeeks}, 1fr)`, paddingBottom: 6 }}>
            {weeks.map(w => (
              <div key={w} style={{ fontSize: 10, color: "var(--ink-3)", textAlign: "center", borderLeft: "1px solid var(--border-soft)" }}>W{w}</div>
            ))}
          </div>
        </div>
        <div className="timeline">
          {launch.milestones.map((m, i) => {
            const weekStart = m.start / (totalWeeks * 7) * 100;
            const weekW = (m.end - m.start) / (totalWeeks * 7) * 100;
            return (
              <div key={i} className="timeline-row">
                <div className="timeline-label">
                  <span style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: m.status === "done" ? "var(--success)" :
                                m.status === "progress" ? "var(--brand)" :
                                m.status === "delayed" ? "var(--critical)" : "var(--ink-4)"
                  }}/>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12 }}>{m.name}</div>
                    <div className="muted" style={{ fontSize: 10.5 }}>{m.owner}</div>
                  </div>
                </div>
                <div className="timeline-track">
                  <div className={"timeline-bar " + m.status}
                       style={{ left: weekStart + "%", width: weekW + "%" }}>
                    {m.status === "done" ? "✓" : m.status === "delayed" ? "⚠" : ""}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 14 }}>
        <Card title="Owner workload" sub="Open milestones across all launches">
          {[
            { owner: "Cristoo", open: 2 }, { owner: "Kirat", open: 1 }, { owner: "Ops", open: 4 },
            { owner: "Design", open: 3 }, { owner: "Marketing", open: 3 }, { owner: "Marketplace", open: 2 }, { owner: "Agency", open: 1 },
          ].map((o, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0" }}>
              <span style={{ flex: 1, fontSize: 12 }}>{o.owner}</span>
              <Progress value={o.open * 25} color="brand"/>
              <span className="mono" style={{ fontSize: 11, width: 24, textAlign: "right" }}>{o.open}</span>
            </div>
          ))}
        </Card>
        <Card title="Pre-launch checklist health" sub="What's blocking the launch">
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ background: "var(--critical-soft)", padding: 10, borderRadius: 5, border: "1px solid #E5BFBC" }}>
              <div style={{ fontSize: 12.5, fontWeight: 500 }}>⚠ Listing copy delayed</div>
              <div className="muted" style={{ fontSize: 11.5 }}>Marketing · due May 14 · 7 days late · blocking 3 downstream milestones</div>
              <button className="btn sm" style={{ marginTop: 6 }}>Nudge owner</button>
            </div>
            <div style={{ background: "var(--warning-soft)", padding: 10, borderRadius: 5, border: "1px solid #DBC487" }}>
              <div style={{ fontSize: 12.5, fontWeight: 500 }}>Raw materials procurement at risk</div>
              <div className="muted" style={{ fontSize: 11.5 }}>Glanbia PO not yet placed · 21d lead time → tight against target</div>
              <button className="btn sm" style={{ marginTop: 6 }}>Open Glanbia card</button>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
};

const PostLaunchView = ({ launch }) => {
  const D = NSData;
  const l = launch.live;
  const milestones = [
    { d: 1, target: l.targets.d1, actual: l.d1 },
    { d: 7, target: l.targets.d7, actual: l.d7 },
    { d: 14, target: l.targets.d14, actual: l.d14 },
    { d: 30, target: l.targets.d30, actual: l.d30 },
    { d: 60, target: 2500, actual: null },
    { d: 90, target: 3800, actual: null },
  ];

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 14 }}>
        <Card title="Days since launch"><div className="stat-num lg">34</div><div className="muted" style={{ fontSize: 11.5 }}>Apr 17 → today</div></Card>
        <Card title="Units sold · D30"><div className="stat-num lg">{D.fmtN(l.d30)}</div><div className="muted" style={{ fontSize: 11.5 }}>vs {D.fmtN(l.targets.d30)} target · <Delta value={((l.d30-l.targets.d30)/l.targets.d30)*100}/></div></Card>
        <Card title="Cumulative revenue"><div className="stat-num lg">{D.fmtINR(l.d30 * 580)}</div><div className="muted" style={{ fontSize: 11.5 }}>blended AOV ₹580</div></Card>
        <Card title="Reviews · avg rating"><div className="stat-num lg">4.2 ★</div><div className="muted" style={{ fontSize: 11.5 }}>42 reviews · accumulating well</div></Card>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1.4fr 1fr", marginBottom: 14 }}>
        <Card title="Sales velocity · D1 / D7 / D14 / D30 / D60 / D90" sub="Actual vs launch target">
          <table className="table" style={{ marginTop: -8 }}>
            <thead>
              <tr><th>Day</th><th className="num">Target</th><th className="num">Actual</th><th>Performance</th><th className="num">Variance</th></tr>
            </thead>
            <tbody>
              {milestones.map(m => (
                <tr key={m.d}>
                  <td className="mono">D{m.d}</td>
                  <td className="num">{D.fmtN(m.target)}</td>
                  <td className="num">{m.actual ? D.fmtN(m.actual) : <span className="muted">—</span>}</td>
                  <td style={{ width: 240 }}>
                    {m.actual && <Progress value={m.actual} max={Math.max(m.target, m.actual) * 1.1}
                      color={m.actual >= m.target ? "green" : "amber"}/>}
                  </td>
                  <td className="num">
                    {m.actual && <Delta value={((m.actual - m.target) / m.target) * 100}/>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="BSR climb since launch" sub="Amazon · Supplements category">
          <div style={{ padding: "8px 0" }}>
            <BSRClimbChart/>
          </div>
          <div className="kv" style={{ marginTop: 8 }}>
            <dt>Launch BSR</dt><dd>#4,820</dd>
            <dt>D7</dt><dd>#1,240</dd>
            <dt>D14</dt><dd>#680</dd>
            <dt>D30 (current)</dt><dd style={{ color: "var(--success)" }}>#180</dd>
          </div>
        </Card>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
        <Card title="Ad spend vs attributed revenue" sub="D1–D30">
          <div className="stat-num lg">2.84×</div>
          <div className="muted" style={{ fontSize: 11.5 }}>Launch ROAS · target 2.50×</div>
          <hr className="hr"/>
          <div className="kv">
            <dt>Ad spend</dt><dd>{D.fmtINR(186000)}</dd>
            <dt>Attrib rev</dt><dd>{D.fmtINR(528000)}</dd>
            <dt>CAC</dt><dd>₹248</dd>
          </div>
        </Card>
        <Card title="Inventory burn vs forecast" sub="3-month inventory at launch">
          <div className="stat-num lg">38%</div>
          <div className="muted" style={{ fontSize: 11.5 }}>burned · 62% remaining · ahead of forecast</div>
          <hr className="hr"/>
          <Progress value={38} color="amber"/>
          <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
            Forecast was 28% by D30. Velocity 1.34× plan → consider replenishment PO now.
          </div>
        </Card>
        <Card title="Early signals" sub="Return rate · review sentiment">
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="muted">D30 return rate</span><span className="mono">1.8%</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="muted">Category avg</span><span className="mono muted">2.4%</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="muted">1-2★ reviews</span><span className="mono">3 of 42</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="muted">Repeat purchase</span><span className="mono">14%</span>
            </div>
            <hr className="hr"/>
            <div className="badge green" style={{ alignSelf: "flex-start" }}>Healthy launch</div>
          </div>
        </Card>
      </div>
    </>
  );
};

const BSRClimbChart = () => {
  const w = 320, h = 100;
  const data = [4820, 4200, 3640, 2980, 2540, 2120, 1840, 1450, 1240, 980, 860, 720, 680, 580, 460, 380, 320, 280, 240, 220, 200, 184, 180];
  // higher BSR is worse — show inverted
  const max = Math.max(...data);
  const xFor = i => 4 + (i / (data.length - 1)) * (w - 8);
  const yFor = v => 4 + (v / max) * (h - 12);
  const path = data.map((v, i) => (i === 0 ? "M" : "L") + xFor(i).toFixed(1) + "," + yFor(v).toFixed(1)).join(" ");
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <path d={path + ` L${w-4},${h-4} L4,${h-4} Z`} fill="var(--success)" opacity="0.12"/>
      <path d={path} stroke="var(--success)" strokeWidth="1.6" fill="none"/>
      <text x="4" y="14" fontSize="10" fill="var(--ink-3)" fontFamily="var(--mono)">launch</text>
      <text x={w - 4} y="14" fontSize="10" textAnchor="end" fill="var(--success)" fontFamily="var(--mono)">D30</text>
    </svg>
  );
};


export default PageLaunches;
