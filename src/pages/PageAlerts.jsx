import { useState, useEffect, useRef, useMemo } from "react";
import { Icon, Delta, Card, Sparkline, BarChart, Progress, ChannelPill } from "../components/Shared.jsx";
import NSData from "../data.js";

// Module 10 — Alerts & Notifications Center

const PageAlerts = ({ role, onNav }) => {
  const D = NSData;
  const [filter, setFilter] = useState("all");
  const [cat, setCat] = useState("all");

  const visible = D.alerts.filter(a =>
    (a.roles.includes(role) || role === "founder" || role === "office") &&
    (filter === "all" || a.sev === filter) &&
    (cat === "all" || a.cat === cat)
  );

  const counts = {
    crit: D.alerts.filter(a => a.sev === "crit" && (a.roles.includes(role) || role === "founder" || role === "office")).length,
    warn: D.alerts.filter(a => a.sev === "warn" && (a.roles.includes(role) || role === "founder" || role === "office")).length,
    info: D.alerts.filter(a => a.sev === "info" && (a.roles.includes(role) || role === "founder" || role === "office")).length,
  };
  const cats = ["Inventory", "Sales", "Marketing", "Marketplace", "Finance"];

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">Alerts & Notifications</div>
          <div className="page-sub">Real-time signal feed · role-filtered · routed to digest</div>
        </div>
        <div className="actions">
          <button className="btn"><Icon name="settings" size={13}/>Alert rules</button>
          <button className="btn"><Icon name="calendar" size={13}/>Digest settings</button>
          <button className="btn primary"><Icon name="plus" size={13}/>Custom alert</button>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 14 }}>
        <Card title="Critical">
          <div className="stat-num lg" style={{ color: "var(--critical)" }}>{counts.crit}</div>
          <div className="muted" style={{ fontSize: 11.5 }}>Immediate action required</div>
        </Card>
        <Card title="Warning">
          <div className="stat-num lg" style={{ color: "var(--warning)" }}>{counts.warn}</div>
          <div className="muted" style={{ fontSize: 11.5 }}>Action needed soon</div>
        </Card>
        <Card title="Insight">
          <div className="stat-num lg" style={{ color: "var(--info)" }}>{counts.info}</div>
          <div className="muted" style={{ fontSize: 11.5 }}>High-confidence recommendation</div>
        </Card>
        <Card title="Daily digest">
          <div className="stat-num lg" style={{ fontSize: 22 }}>08:00 IST</div>
          <div className="muted" style={{ fontSize: 11.5 }}>Sent to 4 recipients · Cristoo, Kirat, Naina, vCFO</div>
        </Card>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
        <div className="seg">
          <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All</button>
          <button className={filter === "crit" ? "active" : ""} onClick={() => setFilter("crit")}>Critical</button>
          <button className={filter === "warn" ? "active" : ""} onClick={() => setFilter("warn")}>Warning</button>
          <button className={filter === "info" ? "active" : ""} onClick={() => setFilter("info")}>Insight</button>
        </div>
        <span className="muted" style={{ fontSize: 11.5 }}>Category:</span>
        <div className="seg">
          <button className={cat === "all" ? "active" : ""} onClick={() => setCat("all")}>All</button>
          {cats.map(c => <button key={c} className={cat === c ? "active" : ""} onClick={() => setCat(c)}>{c}</button>)}
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1.4fr 1fr" }}>
        <Card title={`Alert feed · ${visible.length} active`} padded={false}>
          {visible.length === 0 && <div className="empty">No alerts matching the current filters.</div>}
          {visible.map(a => (
            <div key={a.id} className={"alert " + (a.sev === "crit" ? "crit" : a.sev === "warn" ? "warn" : "info")}>
              <span className="dot"/>
              <div className="body">
                <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
                  <div className="title">{a.title}</div>
                  <span className="muted" style={{ fontSize: 11 }}>{a.time}</span>
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{a.detail}</div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
                  <span className="tag">{a.cat}</span>
                  <span className={"badge " + (a.sev === "crit" ? "red" : a.sev === "warn" ? "amber" : "blue") + " dot"}>
                    {a.sev === "crit" ? "Critical" : a.sev === "warn" ? "Warning" : "Insight"}
                  </span>
                  <button className="btn ghost sm" onClick={() => onNav(a.module)}>
                    Open module <Icon name="arrowRight" size={11}/>
                  </button>
                  <button className="btn ghost sm">Snooze 24h</button>
                  <button className="btn ghost sm">Acknowledge</button>
                </div>
              </div>
            </div>
          ))}
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Card title="Daily email digest preview" sub="08:00 IST · sent tomorrow morning">
            <DigestPreview/>
          </Card>

          <Card title="Alert routing · who sees what" sub="Domain-restricted">
            <table className="table" style={{ fontSize: 11.5 }}>
              <thead>
                <tr><th>Role</th><th>Routes</th></tr>
              </thead>
              <tbody>
                <tr><td>Founder · Office</td><td className="muted">All categories</td></tr>
                <tr><td>Operations</td><td className="muted">Inventory, expiry, stockout, warehouse</td></tr>
                <tr><td>Ad Agency</td><td className="muted">Ad performance, ROAS, budget pacing</td></tr>
                <tr><td>Marketplace Agency</td><td className="muted">Listing, buy box, BSR, ratings, FBA</td></tr>
                <tr><td>vCFO Agency</td><td className="muted">Cash, P&L, payment obligations</td></tr>
              </tbody>
            </table>
          </Card>
        </div>
      </div>
    </div>
  );
};

const DigestPreview = () => {
  const D = NSData;
  return (
    <div style={{ background: "var(--bg-canvas)", border: "1px solid var(--border)", borderRadius: 6, padding: 14, fontSize: 12 }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Naturesum daily · Thu 22 May</div>
      <div className="muted" style={{ fontSize: 11, marginBottom: 10 }}>To: Cristoo, Kirat, Naina, vCFO@sastr.co</div>

      <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 8 }}>
        <div className="stat-label" style={{ marginBottom: 4 }}>Yesterday's revenue</div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>{D.fmtINR(1059000)}</span>
          <span className="delta up">+9.7% vs day -2</span>
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
          AMZ ₹485K · SHP ₹312K · FK ₹168K · BLK ₹94K
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div className="stat-label" style={{ marginBottom: 4, color: "var(--critical)" }}>🔴 Critical (3)</div>
        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11.5 }}>
          <li>Multivitamin (Women) — runway 8d, lead 18d</li>
          <li>Whey Choc 2K listing suppressed (Amazon)</li>
          <li>Cash projection breaches ₹40L floor Jun 04</li>
        </ul>
      </div>

      <div style={{ marginTop: 10 }}>
        <div className="stat-label" style={{ marginBottom: 4, color: "var(--warning)" }}>🟡 Warnings (4)</div>
        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11.5 }}>
          <li>Meta Ads overpacing 18% above daily budget</li>
          <li>Collagen Peptides rating drop to 3.9★</li>
          <li>Batch B-2412-OMG3 expiring 47d · 1,840 units</li>
          <li>Plant Protein returns 3.2× monthly avg</li>
        </ul>
      </div>

      <div style={{ marginTop: 10 }}>
        <div className="stat-label" style={{ marginBottom: 4, color: "var(--info)" }}>🔵 Insights (3)</div>
        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11.5 }}>
          <li>Biotin+Hair ROAS +45% — scale Meta budget?</li>
          <li>Whey Choc 1K — FBA 8d, warehouse 45d → replenish</li>
          <li>Blinkit revenue +60% WoW — investigate driver</li>
        </ul>
      </div>

      <div style={{ marginTop: 12, padding: 10, background: "var(--brand-soft)", borderRadius: 5 }}>
        <div className="stat-label" style={{ color: "var(--brand)", marginBottom: 4 }}>Cash & inventory</div>
        <div style={{ fontSize: 11.5 }}>
          ₹62L on hand · 48d runway · 7 SKUs &lt; 30d · 4 batches expiring &lt;60d
        </div>
      </div>
    </div>
  );
};


export default PageAlerts;
