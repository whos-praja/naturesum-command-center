import { useState, useEffect, useRef, useMemo } from "react";
import { Icon, Delta, Card, Sparkline, BarChart, Progress, ChannelPill } from "../components/Shared.jsx";
import NSData from "../data.js";

// Module 7 — Marketplace Intelligence

const PageMarketplaceIntel = () => {
  const D = NSData;
  const [tab, setTab] = useState("amazon");

  const buyBoxWins = D.marketplaceAmazon.filter(s => s.buyBox === "Winning").length;
  const suppressed = D.marketplaceAmazon.filter(s => s.listing === "Suppressed").length;
  const avgRating = D.marketplaceAmazon.reduce((a, b) => a + b.rating, 0) / D.marketplaceAmazon.length;
  const lowRated = D.marketplaceAmazon.filter(s => s.rating < 4.0).length;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">Marketplace Intelligence</div>
          <div className="page-sub">BSR · buy box · listing health · review monitoring</div>
        </div>
        <div className="actions">
          <div className="seg">
            <button>7D</button><button className="active">30D</button><button>90D</button>
          </div>
          <button className="btn"><Icon name="refresh" size={13}/>Sync now</button>
        </div>
      </div>

      <div className="tabs">
        <button className={tab === "amazon" ? "active" : ""} onClick={() => setTab("amazon")}>Amazon</button>
        <button className={tab === "flipkart" ? "active" : ""} onClick={() => setTab("flipkart")}>Flipkart</button>
        <button className={tab === "blinkit" ? "active" : ""} onClick={() => setTab("blinkit")}>Blinkit</button>
        <button className={tab === "reviews" ? "active" : ""} onClick={() => setTab("reviews")}>Reviews & ratings</button>
      </div>

      {tab === "amazon" && (
        <>
          <div className="grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 14 }}>
            <Card title="Buy box win rate">
              <div className="stat-num lg">{Math.round(D.marketplaceAmazon.reduce((a,b)=>a+b.buyBoxRate,0)/D.marketplaceAmazon.length)}%</div>
              <div className="muted" style={{ fontSize: 11.5 }}>{buyBoxWins}/{D.marketplaceAmazon.length} ASINs winning · 1 losing</div>
            </Card>
            <Card title="Listings suppressed">
              <div className="stat-num lg" style={{ color: suppressed ? "var(--critical)" : "var(--success)" }}>{suppressed}</div>
              <div className="muted" style={{ fontSize: 11.5 }}>Whey Choc 2K · image policy flag</div>
            </Card>
            <Card title="Avg rating">
              <div className="stat-num lg">{avgRating.toFixed(2)}<span style={{ color: "var(--warning)", fontSize: 16 }}> ★</span></div>
              <div className="muted" style={{ fontSize: 11.5 }}>{lowRated} SKU below 4.0★ threshold</div>
            </Card>
            <Card title="FBA units total">
              <div className="stat-num lg">{D.fmtN(D.inventory.reduce((a,b)=>a+b.stock.amazonFBA,0))}</div>
              <div className="muted" style={{ fontSize: 11.5 }}>2 SKUs need replenishment</div>
            </Card>
          </div>

          <Card title="ASIN-level performance" sub="BSR · buy box · listing · rating" padded={false} style={{ marginBottom: 14 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>SKU / ASIN</th>
                  <th>Category</th>
                  <th className="num">BSR</th>
                  <th className="num">Trend</th>
                  <th>Buy box</th>
                  <th className="num">Win %</th>
                  <th>Listing</th>
                  <th className="num">Rating</th>
                  <th className="num">Reviews</th>
                </tr>
              </thead>
              <tbody>
                {D.marketplaceAmazon.map(m => (
                  <tr key={m.asin}>
                    <td>
                      <div>{D.skus.find(s => s.code === m.sku)?.name}</div>
                      <div className="sku">{m.sku} · {m.asin}</div>
                    </td>
                    <td className="muted" style={{ fontSize: 11.5 }}>{m.cat}</td>
                    <td className="num">{m.bsr ? "#" + m.bsr : <span className="muted">—</span>}</td>
                    <td className="num">
                      {m.bsr && m.bsrPrev ? (
                        <Delta value={((m.bsrPrev - m.bsr) / m.bsrPrev) * 100} suffix="rank"/>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td>
                      <span className={"badge dot " + (m.buyBox === "Winning" ? "green" : m.buyBox === "Losing" ? "red" : "")}>
                        {m.buyBox}
                      </span>
                    </td>
                    <td className="num">{m.buyBoxRate}%</td>
                    <td>
                      <span className={"badge " + (m.listing === "Active" ? "green" : m.listing === "Suppressed" ? "red" : "amber") + " dot"}>
                        {m.listing}
                      </span>
                    </td>
                    <td className="num">
                      <span style={{ color: m.rating < 4 ? "var(--critical)" : m.rating < 4.4 ? "var(--warning)" : "var(--ink)" }}>
                        {m.rating.toFixed(1)} ★
                      </span>
                      {m.ratingTrend !== 0 && (
                        <span style={{ fontSize: 10, marginLeft: 4, color: m.ratingTrend > 0 ? "var(--success)" : "var(--critical)" }}>
                          {m.ratingTrend > 0 ? "▲" : "▼"}{Math.abs(m.ratingTrend).toFixed(1)}
                        </span>
                      )}
                    </td>
                    <td className="num">{D.fmtN(m.reviews)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <Card title="BSR trend · top 4 SKUs" sub="Lower = better">
              <BSRChart data={D.marketplaceAmazon.slice(0, 4)}/>
            </Card>
            <Card title="Buy box loss · Collagen Peptides" sub="Sustained loss · 14 days">
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Current win rate</span>
                  <span className="mono" style={{ color: "var(--critical)" }}>62%</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">30-day avg</span>
                  <span className="mono">82%</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Competing offer</span>
                  <span className="mono">Seller "WellnessCart" · ₹1,124</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Our price</span>
                  <span className="mono">₹1,199</span>
                </div>
                <hr className="hr"/>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn primary sm">Adjust price</button>
                  <button className="btn sm">Open in Seller Central <Icon name="external" size={11}/></button>
                </div>
              </div>
            </Card>
          </div>
        </>
      )}

      {tab === "flipkart" && (
        <>
          <div className="note" style={{ marginBottom: 14 }}>
            <strong style={{ color: "var(--info)" }}>API depth:</strong>&nbsp;Flipkart exposes listing status, inventory, and order data via Seller Hub. BSR-equivalent visibility score limited; ratings pulled where available.
          </div>
          <Card padded={false}>
            <table className="table">
              <thead>
                <tr><th>SKU</th><th>FSN</th><th>Status</th><th className="num">Visibility</th><th className="num">Inventory</th><th className="num">30d orders</th><th className="num">Rating</th></tr>
              </thead>
              <tbody>
                {D.marketplaceAmazon.slice(0, 9).map((m, i) => {
                  const status = i === 2 ? "Inactive" : "Active";
                  const visibility = [82, 76, 0, 91, 94, 84, 88, 64, 79][i] || 70;
                  return (
                    <tr key={m.sku}>
                      <td>
                        <div>{D.skus.find(s => s.code === m.sku)?.name}</div>
                        <div className="sku">{m.sku}</div>
                      </td>
                      <td className="sku">FSN{m.asin.slice(2)}</td>
                      <td><span className={"badge " + (status === "Active" ? "green" : "red") + " dot"}>{status}</span></td>
                      <td className="num">{visibility}</td>
                      <td className="num">{D.fmtN(D.inventory[i].stock.flipkart)}</td>
                      <td className="num">{D.fmtN([840, 620, 0, 1840, 1640, 1280, 980, 480, 720][i] || 400)}</td>
                      <td className="num">{(m.rating - 0.1).toFixed(1)} ★</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {tab === "blinkit" && (
        <>
          <div className="grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 14 }}>
            <Card title="Dark stores stocked"><div className="stat-num lg">142</div><div className="muted" style={{ fontSize: 11.5 }}>of 184 in active cities</div></Card>
            <Card title="Listed SKUs"><div className="stat-num lg">7</div><div className="muted" style={{ fontSize: 11.5 }}>of 13 active SKUs</div></Card>
            <Card title="Avg fulfilment time"><div className="stat-num lg">11 min</div><div className="muted" style={{ fontSize: 11.5 }}>Delhi NCR · Mumbai</div></Card>
            <Card title="30d revenue"><div className="stat-num lg">{D.fmtINR(D.pnl.revenue.blinkit)}</div><div className="muted" style={{ fontSize: 11.5 }}><Delta value={28.6}/></div></Card>
          </div>
          <Card title="SKU presence by city" padded={false}>
            <table className="table">
              <thead><tr><th>SKU</th><th className="num">Delhi NCR</th><th className="num">Mumbai</th><th className="num">Bangalore</th><th className="num">Hyderabad</th><th className="num">Total stock</th><th>Status</th></tr></thead>
              <tbody>
                {D.skuSales.slice(0, 7).map((s, i) => {
                  const cities = [
                    [48, 42, 36, 28],
                    [38, 34, 28, 22],
                    [22, 18, 14, 12],
                    [62, 54, 44, 38],
                    [58, 48, 38, 32],
                    [44, 38, 28, 24],
                    [28, 22, 18, 14],
                  ][i];
                  const status = cities[0] > 30 ? "Healthy" : "Low";
                  return (
                    <tr key={s.code}>
                      <td>{s.name}<div className="sku">{s.code}</div></td>
                      <td className="num">{cities[0]}</td>
                      <td className="num">{cities[1]}</td>
                      <td className="num">{cities[2]}</td>
                      <td className="num">{cities[3]}</td>
                      <td className="num">{cities.reduce((a,b)=>a+b,0)}</td>
                      <td><span className={"badge " + (status === "Healthy" ? "green" : "amber") + " dot"}>{status}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {tab === "reviews" && (
        <>
          <div className="grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 14 }}>
            <Card title="Avg rating · all SKUs"><div className="stat-num lg">4.42 ★</div><div className="muted" style={{ fontSize: 11.5 }}><Delta value={-0.03}/></div></Card>
            <Card title="Below 4.0★"><div className="stat-num lg" style={{ color: "var(--critical)" }}>2 SKUs</div><div className="muted" style={{ fontSize: 11.5 }}>Collagen, Plant Protein</div></Card>
            <Card title="1-2★ in 48h"><div className="stat-num lg" style={{ color: "var(--warning)" }}>4</div><div className="muted" style={{ fontSize: 11.5 }}>3 on Collagen Peptides</div></Card>
            <Card title="New reviews · 7d"><div className="stat-num lg">218</div><div className="muted" style={{ fontSize: 11.5 }}>Amazon 158 · Flipkart 60</div></Card>
          </div>

          <div className="grid" style={{ gridTemplateColumns: "1.4fr 1fr" }}>
            <Card title="Recent reviews" sub="Filterable · last 48 hours"
              action={
                <div className="seg">
                  <button className="active">All</button><button>1-2★</button><button>5★</button>
                </div>
              } padded={false}>
              <div>
                {D.recentReviews.map((r, i) => (
                  <div key={i} style={{ padding: "12px 14px", borderBottom: "1px solid var(--border-soft)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ color: r.rating <= 2 ? "var(--critical)" : "var(--warning)", fontSize: 13 }}>
                          {"★".repeat(r.rating) + "☆".repeat(5-r.rating)}
                        </span>
                        <span style={{ fontWeight: 500, fontSize: 12.5 }}>{r.title}</span>
                      </div>
                      <span className="muted" style={{ fontSize: 11 }}>{r.platform} · {r.time}</span>
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>{r.body}</div>
                    <div style={{ marginTop: 4 }}>
                      <span className="sku">{r.sku}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Rating drops · last 30d" sub="SKUs with deteriorating sentiment">
              <div style={{ display: "grid", gap: 12 }}>
                {[
                  { sku: "Collagen Peptides",    code: "NS-COL-PEP-250", from: 4.2, to: 3.9, reviews: 18 },
                  { sku: "Plant Protein — Choco",code: "NS-PRO-VEG-1K", from: 4.0, to: 3.8, reviews: 12 },
                  { sku: "Whey Protein — Vanilla", code: "NS-WHT-VAN-1K", from: 4.5, to: 4.4, reviews: 8 },
                ].map((r, i) => (
                  <div key={i} style={{ padding: 10, background: "var(--bg-sunken)", borderRadius: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontWeight: 500, fontSize: 12.5 }}>{r.sku}</span>
                      <span className="mono" style={{ fontSize: 12 }}>
                        <span className="muted">{r.from.toFixed(1)}</span> → <span style={{ color: "var(--critical)" }}>{r.to.toFixed(1)} ★</span>
                      </span>
                    </div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
                      {r.code} · {r.reviews} new reviews · most cite taste/mix
                    </div>
                    <button className="btn sm" style={{ marginTop: 8 }}>Investigate</button>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
};

const BSRChart = ({ data }) => {
  const w = 540, h = 180;
  const pad = { l: 30, r: 90, t: 14, b: 24 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const series = data.map((d, i) => ({
    name: d.sku.split("-").slice(2,3).join(""),
    color: ["#2F5E47", "#B07A1F", "#3A6072", "#7C4A6B"][i],
    points: Array.from({length: 14}, (_, j) => {
      const base = d.bsrPrev;
      const end = d.bsr || base;
      const v = base + (end - base) * (j / 13) + Math.sin(j * 0.8) * 12;
      return Math.max(8, v);
    })
  }));
  const allValues = series.flatMap(s => s.points);
  const min = Math.min(...allValues), max = Math.max(...allValues);
  const yFor = v => pad.t + ((v - min) / (max - min)) * innerH; // higher BSR = worse = lower on chart visually (inverted)
  const xFor = i => pad.l + (i / 13) * innerW;

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      {[0, 0.5, 1].map((t, i) => (
        <line key={i} x1={pad.l} x2={w - pad.r} y1={pad.t + innerH * t} y2={pad.t + innerH * t} stroke="var(--border-soft)"/>
      ))}
      {series.map((s, si) => {
        const path = s.points.map((v, i) => (i === 0 ? "M" : "L") + xFor(i).toFixed(1) + "," + yFor(v).toFixed(1)).join(" ");
        return (
          <g key={si}>
            <path d={path} fill="none" stroke={s.color} strokeWidth="1.6"/>
            <text x={w - pad.r + 6} y={yFor(s.points[s.points.length-1]) + 3} fontSize="10" fill={s.color} fontFamily="var(--mono)">
              #{Math.round(s.points[s.points.length-1])}
            </text>
            <text x={w - pad.r + 50} y={yFor(s.points[s.points.length-1]) + 3} fontSize="10" fill="var(--ink-2)">
              {NSData.skus.find(k => k.code === NSData.marketplaceAmazon[si].sku)?.name?.split("—")[0]?.trim().slice(0, 14)}
            </text>
          </g>
        );
      })}
      {[0, 7, 13].map(i => <text key={i} x={xFor(i)} y={h - 6} fontSize="9" textAnchor="middle" fill="var(--ink-3)" fontFamily="var(--mono)">D-{14-i}</text>)}
    </svg>
  );
};


export default PageMarketplaceIntel;
