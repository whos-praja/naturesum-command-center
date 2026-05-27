import { useState, useEffect, useRef, useMemo } from "react";
import { Icon, Delta, Card, Sparkline, BarChart, Progress, ChannelPill } from "../components/Shared.jsx";
import NSData from "../data.js";

// Module 4 — Supplier Directory

const PageSuppliers = () => {
  const D = NSData;
  const [tab, setTab] = useState("suppliers");
  const [active, setActive] = useState(D.suppliers[0]);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">Supplier Directory</div>
          <div className="page-sub">Vendor records · lead times · PO log · feeds runway logic</div>
        </div>
        <div className="actions">
          <button className="btn"><Icon name="download" size={13}/>Export</button>
          <button className="btn primary"><Icon name="plus" size={13}/>Add supplier</button>
        </div>
      </div>

      <div className="tabs">
        <button className={tab === "suppliers" ? "active" : ""} onClick={() => setTab("suppliers")}>Suppliers</button>
        <button className={tab === "po" ? "active" : ""} onClick={() => setTab("po")}>PO log</button>
        <button className={tab === "reliability" ? "active" : ""} onClick={() => setTab("reliability")}>Reliability scorecard</button>
      </div>

      {tab === "suppliers" && (
        <div className="grid" style={{ gridTemplateColumns: "1.4fr 1fr" }}>
          <Card padded={false}>
            <table className="table">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Supplies</th>
                  <th className="num">Lead time</th>
                  <th className="num">MOQ</th>
                  <th className="num">Reliability</th>
                </tr>
              </thead>
              <tbody>
                {D.suppliers.map(s => (
                  <tr key={s.id} onClick={() => setActive(s)} style={{ cursor: "pointer", background: active.id === s.id ? "var(--bg-sunken)" : undefined }}>
                    <td>
                      <div>{s.name}</div>
                      <div className="sku">{s.id} · {s.contact}</div>
                    </td>
                    <td className="muted" style={{ fontSize: 11.5 }}>{s.supplies}</td>
                    <td className="num">{s.lead} d</td>
                    <td className="num">{s.moq}</td>
                    <td className="num">
                      <span className={"badge " + (s.reliability >= 90 ? "green" : s.reliability >= 80 ? "amber" : "red") + " dot"}>
                        {s.reliability}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title={active.name} sub={active.id + " · " + active.supplies}
            action={<button className="btn sm">Edit</button>}>
            <dl className="kv">
              <dt>Contact</dt><dd className="text-mono">{active.contact}</dd>
              <dt>Phone</dt><dd className="text-mono">{active.phone}</dd>
              <dt>MOQ</dt><dd>{active.moq}</dd>
              <dt>Lead time</dt><dd>{active.lead} days <span className="muted">(stated)</span></dd>
              <dt>Avg actual</dt><dd>{active.lead + (active.reliability < 85 ? 4 : active.reliability < 92 ? 2 : 0)} days</dd>
              <dt>Payment</dt><dd>{active.payment}</dd>
              <dt>Reliability</dt><dd>{active.reliability}% on-time</dd>
            </dl>
            <hr className="hr"/>
            <div className="stat-label" style={{ marginBottom: 6 }}>Supplies to SKUs</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {active.skus.map(sk => <span key={sk} className="badge">{sk}</span>)}
            </div>
            <hr className="hr"/>
            <div className="stat-label" style={{ marginBottom: 6 }}>Last 6 POs</div>
            <div style={{ display: "grid", gap: 4, fontSize: 11.5 }}>
              {D.poLog.filter(po => po.supplier === active.name).slice(0, 6).map(po => (
                <div key={po.id} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="mono">{po.id}</span>
                  <span className="muted">{po.date}</span>
                  <span className={po.deltaDays > 0 ? "delta down" : po.deltaDays < 0 ? "delta up" : "delta flat"}>
                    {po.deltaDays > 0 ? "+" : ""}{po.deltaDays}d
                  </span>
                </div>
              ))}
              {!D.poLog.filter(po => po.supplier === active.name).length && (
                <div className="muted">No recent purchase orders.</div>
              )}
            </div>
            <hr className="hr"/>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn primary"><Icon name="plus" size={12}/>New PO</button>
              <button className="btn">Notes & quality flags</button>
            </div>
          </Card>
        </div>
      )}

      {tab === "po" && (
        <Card title="Purchase order log" sub="Manual entry · feeds reliability scoring and cash flow projection"
          action={<button className="btn primary sm"><Icon name="plus" size={12}/>Log PO</button>} padded={false}>
          <table className="table">
            <thead>
              <tr>
                <th>PO ID</th>
                <th>Supplier</th>
                <th>Items</th>
                <th>Date placed</th>
                <th>Expected</th>
                <th>Actual</th>
                <th>Δ days</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {D.poLog.map(po => (
                <tr key={po.id}>
                  <td className="sku">{po.id}</td>
                  <td>{po.supplier}</td>
                  <td className="muted" style={{ fontSize: 11.5 }}>{po.items}</td>
                  <td>{po.date}</td>
                  <td>{po.expected}</td>
                  <td>{po.actual || <span className="muted">—</span>}</td>
                  <td>
                    {po.actual ? (
                      <span className={po.deltaDays > 0 ? "delta down" : po.deltaDays < 0 ? "delta up" : "delta flat"}>
                        {po.deltaDays > 0 ? "+" : ""}{po.deltaDays}d
                      </span>
                    ) : <span className="muted">—</span>}
                  </td>
                  <td>
                    <span className={"badge " + (po.status === "Delivered" ? "green" : "blue")}>{po.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === "reliability" && (
        <Card title="Supplier reliability" sub="Stated vs. actual lead time, last 12 months">
          <table className="table">
            <thead>
              <tr>
                <th>Supplier</th>
                <th className="num">POs (12m)</th>
                <th className="num">Stated lead</th>
                <th className="num">Avg actual</th>
                <th className="num">On-time %</th>
                <th>Performance</th>
              </tr>
            </thead>
            <tbody>
              {D.suppliers.map(s => {
                const drift = s.reliability >= 92 ? 0 : s.reliability >= 85 ? 2 : 4;
                return (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td className="num">{8 + (s.id.length % 6)}</td>
                    <td className="num">{s.lead} d</td>
                    <td className="num">{s.lead + drift} d</td>
                    <td className="num">{s.reliability}%</td>
                    <td style={{ width: 200 }}>
                      <Progress value={s.reliability} color={s.reliability >= 90 ? "green" : s.reliability >= 80 ? "amber" : "red"}/>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
};


export default PageSuppliers;
