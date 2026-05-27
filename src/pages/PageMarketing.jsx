import { useState, useEffect, useRef, useMemo } from "react";
import { Icon, Delta, Card, Sparkline, BarChart, Progress, ChannelPill } from "../components/Shared.jsx";
import NSData from "../data.js";

// Module 5 — Marketing & Advertising

const PageMarketing = () => {
  const D = NSData;
  const [tab, setTab] = useState("blended");

  const total = {
    spend: D.adAccounts.google.spendMTD + D.adAccounts.meta.spendMTD,
    rev: D.adAccounts.google.revAttrib + D.adAccounts.meta.revAttrib,
    impressions: D.adAccounts.google.impressions + D.adAccounts.meta.impressions,
    clicks: D.adAccounts.google.clicks + D.adAccounts.meta.clicks,
    conv: D.adAccounts.google.conversions + D.adAccounts.meta.conversions,
  };
  total.roas = total.rev / total.spend;
  total.cac = total.spend / total.conv;
  total.ctr = (total.clicks / total.impressions) * 100;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">Marketing & Advertising</div>
          <div className="page-sub">Google Ads · Meta Ads · attribution → Shopify · marketplace halo noted</div>
        </div>
        <div className="actions">
          <div className="seg">
            <button>Today</button><button>7D</button><button className="active">MTD</button><button>QTD</button>
          </div>
          <button className="btn"><Icon name="download" size={13}/>Export</button>
        </div>
      </div>

      <div className="note" style={{ marginBottom: 14 }}>
        <strong style={{ color: "var(--info)" }}>Attribution scope:</strong>&nbsp;
        Google/Meta ROAS shown here attributes only to Shopify revenue (via UTM). Marketplace revenue likely sees a halo lift but is not directly attributable — see "halo correlation" panel below.
      </div>

      <div className="tabs">
        <button className={tab === "blended" ? "active" : ""} onClick={() => setTab("blended")}>Blended view</button>
        <button className={tab === "google" ? "active" : ""} onClick={() => setTab("google")}>Google Ads</button>
        <button className={tab === "meta" ? "active" : ""} onClick={() => setTab("meta")}>Meta Ads</button>
        <button className={tab === "halo" ? "active" : ""} onClick={() => setTab("halo")}>Halo & correlation</button>
      </div>

      {tab === "blended" && (
        <>
          <div className="grid" style={{ gridTemplateColumns: "repeat(5, 1fr)", marginBottom: 14 }}>
            <Card title="Total spend MTD"><div className="stat-num lg">{D.fmtINR(total.spend)}</div><div className="muted" style={{ fontSize: 11.5 }}><Delta value={8.4} suffix="vs last mo"/></div></Card>
            <Card title="Attrib revenue"><div className="stat-num lg">{D.fmtINR(total.rev)}</div><div className="muted" style={{ fontSize: 11.5 }}>Shopify · UTM-tagged</div></Card>
            <Card title="Blended ROAS"><div className="stat-num lg">{total.roas.toFixed(2)}×</div><div className="muted" style={{ fontSize: 11.5 }}>Target 3.20× · <Delta value={6.2}/></div></Card>
            <Card title="Blended CAC"><div className="stat-num lg">₹{D.fmtN(Math.round(total.cac))}</div><div className="muted" style={{ fontSize: 11.5 }}><Delta value={-4.2}/></div></Card>
            <Card title="Spend mix"><div className="stat-num lg">46/54</div><div className="muted" style={{ fontSize: 11.5 }}>Google / Meta</div></Card>
          </div>

          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 14 }}>
            <PlatformCard name="Google Ads" data={D.adAccounts.google} color="#4285F4"/>
            <PlatformCard name="Meta Ads"   data={D.adAccounts.meta}   color="#1877F2"/>
          </div>

          <Card title="Spend vs revenue · last 30 days" sub="Daily, blended">
            <SpendRevenueChart/>
          </Card>
        </>
      )}

      {tab === "google" && (
        <>
          <PlatformDetail platform="Google Ads" data={D.adAccounts.google} color="#4285F4" budget={D.adAccounts.google.budget}/>
          <Card title="Campaigns · Google Ads" sub="Account · campaign · product level" padded={false}>
            <table className="table">
              <thead>
                <tr><th>Campaign</th><th>Status</th><th className="num">Spend</th><th className="num">ROAS</th><th className="num">CAC</th><th className="num">Conv</th><th>Performance</th></tr>
              </thead>
              <tbody>
                {D.googleCampaigns.map((c, i) => (
                  <tr key={i}>
                    <td>{c.name}</td>
                    <td><span className={"badge " + (c.status === "Active" ? "green" : "amber") + " dot"}>{c.status}</span></td>
                    <td className="num">{D.fmtINR(c.spend)}</td>
                    <td className="num"><span style={{ color: c.roas >= 3 ? "var(--success)" : c.roas >= 2 ? "var(--warning)" : "var(--critical)" }}>{c.roas.toFixed(2)}×</span></td>
                    <td className="num">₹{D.fmtN(c.cac)}</td>
                    <td className="num">{D.fmtN(c.conv)}</td>
                    <td style={{ width: 160 }}><Progress value={c.roas * 20} color={c.roas >= 3 ? "green" : c.roas >= 2 ? "amber" : "red"}/></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {tab === "meta" && (
        <>
          <PlatformDetail platform="Meta Ads" data={D.adAccounts.meta} color="#1877F2" budget={D.adAccounts.meta.budget}/>
          <Card title="Top creatives · last 30 days" sub="By ROAS · Meta Ads" style={{ marginBottom: 14 }} padded={false}>
            <table className="table">
              <thead><tr><th>Creative</th><th>Format</th><th className="num">Spend</th><th className="num">ROAS</th><th className="num">CAC</th><th className="num">CTR</th><th className="num">Thumb-stop</th></tr></thead>
              <tbody>
                {[
                  { id: "BIO-V3", desc: "Biotin · UGC testimonial 15s", fmt: "Reel", spend: 84000, roas: 5.21, cac: 268, ctr: 2.4, ts: 38 },
                  { id: "WHEY-S2", desc: "Whey Choc · scoop scroll-stopper", fmt: "Static", spend: 162000, roas: 4.84, cac: 312, ctr: 1.8, ts: 24 },
                  { id: "MUL-V1", desc: "Multivit · 'why I switched' founder VO", fmt: "Reel", spend: 124000, roas: 4.42, cac: 348, ctr: 2.1, ts: 32 },
                  { id: "ASH-S1", desc: "Ashwagandha · 'sleep better' carousel", fmt: "Carousel", spend: 78000, roas: 3.14, cac: 412, ctr: 1.4, ts: 18 },
                  { id: "PROT-V2", desc: "Plant Protein · launch hero reel", fmt: "Reel", spend: 218000, roas: 1.86, cac: 712, ctr: 1.2, ts: 14 },
                ].map(c => (
                  <tr key={c.id}>
                    <td>
                      <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
                        <div style={{ width: 36, height: 36, borderRadius: 4, background: "linear-gradient(135deg,#E5EEE7,#B9D0BF)", display: "grid", placeItems: "center", color: "var(--brand)", fontFamily: "var(--mono)", fontSize: 10 }}>{c.id}</div>
                        <div>
                          <div>{c.desc}</div>
                          <div className="sku">#{c.id}</div>
                        </div>
                      </div>
                    </td>
                    <td>{c.fmt}</td>
                    <td className="num">{D.fmtINR(c.spend)}</td>
                    <td className="num"><span style={{ color: c.roas >= 3 ? "var(--success)" : c.roas >= 2 ? "var(--warning)" : "var(--critical)" }}>{c.roas.toFixed(2)}×</span></td>
                    <td className="num">₹{D.fmtN(c.cac)}</td>
                    <td className="num">{c.ctr.toFixed(1)}%</td>
                    <td className="num">{c.ts}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Campaigns · Meta Ads" padded={false}>
            <table className="table">
              <thead>
                <tr><th>Campaign</th><th>Status</th><th className="num">Spend</th><th className="num">ROAS</th><th className="num">CAC</th><th className="num">Conv</th><th>Performance</th></tr>
              </thead>
              <tbody>
                {D.metaCampaigns.map((c, i) => (
                  <tr key={i}>
                    <td>{c.name}</td>
                    <td><span className={"badge " + (c.status === "Active" ? "green" : "amber") + " dot"}>{c.status}</span></td>
                    <td className="num">{D.fmtINR(c.spend)}</td>
                    <td className="num"><span style={{ color: c.roas >= 3 ? "var(--success)" : c.roas >= 2 ? "var(--warning)" : "var(--critical)" }}>{c.roas.toFixed(2)}×</span></td>
                    <td className="num">₹{D.fmtN(c.cac)}</td>
                    <td className="num">{D.fmtN(c.conv)}</td>
                    <td style={{ width: 160 }}><Progress value={c.roas * 20} color={c.roas >= 3 ? "green" : c.roas >= 2 ? "amber" : "red"}/></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {tab === "halo" && (
        <>
          <Card title="Halo correlation" sub="Did marketplace revenue move with ad spend? Context, not attribution.">
            <SpendRevenueChart halo/>
            <div className="note" style={{ marginTop: 14 }}>
              <strong style={{ color: "var(--info)" }}>How to read:</strong>&nbsp;
              The two lines often move together — strong evidence ads lift marketplace sales — but the platforms (Amazon, Flipkart, Blinkit) don't expose source attribution. Treat this as a directional signal, not a ROAS calculation. To formalise, consider an MTA tool (Northbeam / Rockerbox).
            </div>
          </Card>
        </>
      )}
    </div>
  );
};

const PlatformCard = ({ name, data, color }) => {
  const D = NSData;
  const pacing = (data.spendMTD / data.budget) * 100;
  return (
    <Card title={name}
      action={<span className="badge" style={{ background: color + "22", color, borderColor: color + "55" }}>Live</span>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div>
          <div className="stat-label">Spend MTD</div>
          <div className="stat-num lg">{D.fmtINR(data.spendMTD)}</div>
          <div className="muted" style={{ fontSize: 11 }}>of {D.fmtINR(data.budget)} budget</div>
          <Progress value={pacing} color={pacing > 100 ? "amber" : "brand"}/>
        </div>
        <div>
          <div className="stat-label">ROAS</div>
          <div className="stat-num lg">{data.roas.toFixed(2)}×</div>
          <div className="muted" style={{ fontSize: 11 }}>CAC ₹{data.cac} · {D.fmtN(data.conversions)} conv</div>
        </div>
        <div>
          <div className="stat-label">Impressions</div>
          <div className="mono" style={{ fontSize: 14 }}>{(data.impressions/1000000).toFixed(2)}M</div>
        </div>
        <div>
          <div className="stat-label">Clicks · CTR</div>
          <div className="mono" style={{ fontSize: 14 }}>{D.fmtN(data.clicks)} · {((data.clicks/data.impressions)*100).toFixed(2)}%</div>
        </div>
      </div>
    </Card>
  );
};

const PlatformDetail = ({ platform, data, color, budget }) => {
  const D = NSData;
  const pacing = (data.spendMTD / budget) * 100;
  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(5, 1fr)", marginBottom: 14 }}>
      <Card title={platform + " · spend MTD"}>
        <div className="stat-num lg">{D.fmtINR(data.spendMTD)}</div>
        <div className="muted" style={{ fontSize: 11.5 }}>vs ₹{(budget/100000).toFixed(0)}L budget</div>
        <div style={{ marginTop: 6 }}><Progress value={pacing} color={pacing > 110 ? "amber" : "brand"}/></div>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
          {pacing > 100 ? `Overpacing ${(pacing-100).toFixed(0)}%` : `Underpacing ${(100-pacing).toFixed(0)}%`}
        </div>
      </Card>
      <Card title="ROAS"><div className="stat-num lg">{data.roas.toFixed(2)}×</div><div className="muted" style={{ fontSize: 11.5 }}><Delta value={6.1}/> vs last mo</div></Card>
      <Card title="CAC"><div className="stat-num lg">₹{D.fmtN(data.cac)}</div><div className="muted" style={{ fontSize: 11.5 }}><Delta value={-3.4}/></div></Card>
      <Card title="Impressions"><div className="stat-num lg">{(data.impressions/1000000).toFixed(2)}M</div><div className="muted" style={{ fontSize: 11.5 }}>{D.fmtN(data.clicks)} clicks</div></Card>
      <Card title="Conversions"><div className="stat-num lg">{D.fmtN(data.conversions)}</div><div className="muted" style={{ fontSize: 11.5 }}>CTR {((data.clicks/data.impressions)*100).toFixed(2)}% · CVR {((data.conversions/data.clicks)*100).toFixed(2)}%</div></Card>
    </div>
  );
};

const SpendRevenueChart = ({ halo }) => {
  const w = 1080, h = 220;
  const pad = { l: 50, r: 60, t: 14, b: 26 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const days = 30;
  // mock series
  const spend = [62,68,71,74,78,72,76,82,85,88,92,90,86,84,89,94,96,98,102,100,104,108,112,110,108,116,120,118,122,128];
  const revShop = [248,272,284,300,316,288,308,332,348,364,388,372,348,336,372,396,412,428,444,432,464,488,512,500,488,532,556,548,572,608];
  const revMP = [820,860,872,896,912,884,908,948,964,988,1024,1004,968,944,996,1040,1064,1092,1124,1100,1148,1196,1240,1212,1188,1268,1308,1284,1336,1416];

  const max1 = Math.max(...spend);
  const max2 = halo ? Math.max(...revMP) : Math.max(...revShop);

  const xFor = i => pad.l + (i / (days - 1)) * innerW;
  const y1For = v => pad.t + innerH - (v / max1) * innerH;
  const y2For = v => pad.t + innerH - (v / max2) * innerH;

  const path = (data, yFn) => data.map((v, i) => (i === 0 ? "M" : "L") + xFor(i).toFixed(1) + "," + yFn(v).toFixed(1)).join(" ");

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
        <line key={i} x1={pad.l} x2={w - pad.r} y1={pad.t + innerH * t} y2={pad.t + innerH * t} stroke="var(--border-soft)"/>
      ))}
      {/* spend bars */}
      {spend.map((v, i) => {
        const bh = (v / max1) * innerH;
        return <rect key={i} x={xFor(i) - 8} y={pad.t + innerH - bh} width="16" height={bh} fill="var(--ink-3)" opacity="0.18" rx="1"/>;
      })}
      {/* primary revenue line */}
      <path d={path(halo ? revMP : revShop, y2For)} fill="none" stroke={halo ? "var(--warning)" : "var(--brand)"} strokeWidth="1.8"/>
      {halo && (
        <path d={path(revShop, y2For)} fill="none" stroke="var(--brand)" strokeWidth="1.8" strokeDasharray="3 3"/>
      )}
      {/* y axes */}
      <text x={pad.l - 8} y={pad.t + 4} fontSize="10" textAnchor="end" fill="var(--ink-3)" fontFamily="var(--mono)">spend</text>
      <text x={w - pad.r + 8} y={pad.t + 4} fontSize="10" textAnchor="start" fill="var(--ink-3)" fontFamily="var(--mono)">revenue</text>
      {/* x */}
      {[0, 7, 14, 21, 28].map(d => <text key={d} x={xFor(d)} y={h - 8} fontSize="10" textAnchor="middle" fill="var(--ink-3)" fontFamily="var(--mono)">{`D${d+1}`}</text>)}
      {/* legend */}
      <g transform={`translate(${pad.l + 8}, ${pad.t + 12})`}>
        <rect x="0" y="-4" width="14" height="8" fill="var(--ink-3)" opacity="0.18" rx="1"/>
        <text x="20" y="2" fontSize="10" fill="var(--ink-2)">Ad spend</text>
        <line x1="84" y1="0" x2="98" y2="0" stroke={halo ? "var(--warning)" : "var(--brand)"} strokeWidth="1.8"/>
        <text x="102" y="3" fontSize="10" fill="var(--ink-2)">{halo ? "Marketplace revenue" : "Shopify (attributed)"}</text>
        {halo && <><line x1="240" y1="0" x2="254" y2="0" stroke="var(--brand)" strokeWidth="1.8" strokeDasharray="3 3"/><text x="258" y="3" fontSize="10" fill="var(--ink-2)">Shopify (attributed)</text></>}
      </g>
    </svg>
  );
};


export default PageMarketing;
