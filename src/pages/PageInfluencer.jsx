import { useState, useEffect, useRef, useMemo } from "react";
import { Icon, Delta, Card, Sparkline, BarChart, Progress, ChannelPill } from "../components/Shared.jsx";
import NSData from "../data.js";

// Module 6 — Influencer Tracker

const PageInfluencer = () => {
  const D = NSData;
  const totalSpend = D.influencers.reduce((a, b) => a + b.spend + b.boost, 0);
  const attribRev = D.influencers.filter(i => i.attribRev).reduce((a, b) => a + b.attribRev, 0);
  const attribSpend = D.influencers.filter(i => i.attribRev).reduce((a, b) => a + b.spend + b.boost, 0);
  const totalViews = D.influencers.reduce((a, b) => a + b.views, 0);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">Influencer Tracker</div>
          <div className="page-sub">Campaign log · best-effort ROI · no fabricated attribution</div>
        </div>
        <div className="actions">
          <button className="btn"><Icon name="download" size={13}/>Export</button>
          <button className="btn primary"><Icon name="plus" size={13}/>Log campaign</button>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(5, 1fr)", marginBottom: 14 }}>
        <Card title="Total spend MTD"><div className="stat-num lg">{D.fmtINR(totalSpend)}</div><div className="muted" style={{ fontSize: 11.5 }}>Fee + boost · {D.influencers.length} campaigns</div></Card>
        <Card title="Attributed revenue"><div className="stat-num lg">{D.fmtINR(attribRev)}</div><div className="muted" style={{ fontSize: 11.5 }}>via coupon · UTM</div></Card>
        <Card title="Influencer ROAS"><div className="stat-num lg">{(attribRev/attribSpend).toFixed(2)}×</div><div className="muted" style={{ fontSize: 11.5 }}>where attribution exists</div></Card>
        <Card title="Total reach"><div className="stat-num lg">{(totalViews/1000000).toFixed(1)}M</div><div className="muted" style={{ fontSize: 11.5 }}>views · this month</div></Card>
        <Card title="Boost ratio"><div className="stat-num lg">22%</div><div className="muted" style={{ fontSize: 11.5 }}>of total influencer spend</div></Card>
      </div>

      <div className="note" style={{ marginBottom: 14 }}>
        <strong style={{ color: "var(--info)" }}>How attribution works:</strong>&nbsp;
        Where the creator runs with a coupon code or UTM-tagged link, attributed revenue and ROAS are shown. Where no attribution is set up, we report spend + content performance side by side — no estimates, no fabricated attribution.
      </div>

      <Card title="Campaign log" sub={`${D.influencers.length} campaigns · MTD`} padded={false}
        action={<div style={{ display: "flex", gap: 6 }}>
          <button className="btn sm"><Icon name="filter" size={12}/>Tier</button>
          <button className="btn sm"><Icon name="filter" size={12}/>Platform</button>
        </div>}>
        <table className="table">
          <thead>
            <tr>
              <th>Creator</th><th>Tier · platform</th><th>Product</th><th>Format</th>
              <th className="num">Spend (fee+boost)</th>
              <th className="num">Views</th>
              <th className="num">Engagement</th>
              <th>Attribution</th>
              <th className="num">Attrib rev</th>
              <th className="num">ROAS</th>
            </tr>
          </thead>
          <tbody>
            {D.influencers.map((i, idx) => (
              <tr key={idx}>
                <td>
                  <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg,#E5EEE7,#B9D0BF)", display: "grid", placeItems: "center", color: "var(--brand)", fontSize: 10, fontWeight: 600 }}>
                      {i.name.split(" ").map(s => s[0]).slice(0,2).join("")}
                    </div>
                    <div>
                      <div>{i.name}</div>
                      <div className="sku">{i.handle} · {i.followers}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <span className="badge">{i.tier}</span>
                  <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>{i.platform}</span>
                </td>
                <td className="muted" style={{ fontSize: 11.5 }}>{i.product}</td>
                <td>{i.format}</td>
                <td className="num">{D.fmtINR(i.spend + i.boost)}<div className="muted" style={{ fontSize: 10 }}>{D.fmtINR(i.spend)} + {D.fmtINR(i.boost)}</div></td>
                <td className="num">{D.fmtN(i.views)}</td>
                <td className="num">{i.engagement}</td>
                <td>
                  {i.coupon ? <span className="badge brand">{i.coupon}</span> : <span className="muted" style={{ fontSize: 11 }}>None</span>}
                </td>
                <td className="num">
                  {i.attribRev ? D.fmtINR(i.attribRev) : <span className="muted">—</span>}
                </td>
                <td className="num">
                  {i.attribRev
                    ? <span style={{ color: (i.attribRev/(i.spend+i.boost)) >= 3 ? "var(--success)" : (i.attribRev/(i.spend+i.boost)) >= 1.5 ? "var(--warning)" : "var(--critical)" }}>
                        {(i.attribRev/(i.spend+i.boost)).toFixed(2)}×
                      </span>
                    : <span className="muted">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 14 }}>
        <Card title="Best performing · by ROAS" sub="Where attribution exists">
          {[...D.influencers].filter(i => i.attribRev).sort((a,b) => (b.attribRev/(b.spend+b.boost)) - (a.attribRev/(a.spend+a.boost))).slice(0,4).map((i, idx) => (
            <div key={idx} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border-soft)" }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--brand-soft)", display: "grid", placeItems: "center", color: "var(--brand)", fontSize: 10, fontWeight: 600 }}>
                {i.name.split(" ").map(s => s[0]).slice(0,2).join("")}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12 }}>{i.name}</div>
                <div className="muted" style={{ fontSize: 11 }}>{i.product} · {i.format}</div>
              </div>
              <div className="text-right">
                <div className="mono" style={{ fontSize: 14, color: "var(--success)" }}>{(i.attribRev/(i.spend+i.boost)).toFixed(2)}×</div>
                <div className="muted" style={{ fontSize: 10.5 }}>{D.fmtINR(i.attribRev)}</div>
              </div>
            </div>
          ))}
        </Card>

        <Card title="Best performing · by engagement" sub="When attribution isn't set up, this is the next-best signal">
          {[...D.influencers].sort((a,b) => parseFloat(b.engagement) - parseFloat(a.engagement)).slice(0,4).map((i, idx) => (
            <div key={idx} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border-soft)" }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--brand-soft)", display: "grid", placeItems: "center", color: "var(--brand)", fontSize: 10, fontWeight: 600 }}>
                {i.name.split(" ").map(s => s[0]).slice(0,2).join("")}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12 }}>{i.name}</div>
                <div className="muted" style={{ fontSize: 11 }}>{i.tier} · {i.followers} followers</div>
              </div>
              <div className="text-right">
                <div className="mono" style={{ fontSize: 14 }}>{i.engagement}</div>
                <div className="muted" style={{ fontSize: 10.5 }}>{D.fmtN(i.views)} views</div>
              </div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
};


export default PageInfluencer;
