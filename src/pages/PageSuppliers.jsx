import { useState, useEffect, useRef, useMemo } from "react";
import { Icon, Delta, Card, Sparkline, BarChart, Progress, ChannelPill } from "../components/Shared.jsx";
import NSData from "../data.js";

// Module 4 — Supplier Directory

const PageSuppliers = () => {
  const D = NSData;
  const [tab, setTab] = useState("suppliers");
  const [active, setActive] = useState(D.suppliers[0]);
  const [flagsOpen, setFlagsOpen] = useState(false);

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
              <button className="btn" onClick={() => setFlagsOpen(true)}>
                <Icon name="alerts" size={12}/>Notes & quality flags
                {flagCount(D) > 0 && (
                  <span className="badge amber dot" style={{ marginLeft: 6 }}>{flagCount(D)}</span>
                )}
              </button>
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

      {flagsOpen && <QualityFlagsModal D={D} onClose={() => setFlagsOpen(false)} />}
    </div>
  );
};

// ── Data-quality flags (R-FAILLOUD / smaller-requirement #13) ─────────────
// Surfaces D.centralWh.flags.detail so unmapped SKUs / BOM gaps / negative
// stock / garbage rows are VISIBLE rather than silently dropped. Every access
// is guarded so a missing/odd shape can never white-screen the page.

// Total count of flagged issues — drives the badge on the button. SAFE: any
// missing piece collapses to 0.
function flagCount(D) {
  const f = D?.centralWh?.flags;
  if (!f) return 0;
  const d = f.detail || {};
  const len = (a) => (Array.isArray(a) ? a.length : 0);
  // Prefer the explicit detail arrays; fall back to the summary counters when
  // a detail array is absent so the badge still reflects reality.
  return (
    len(d.negative_stock || (Number.isFinite(f.negativeStock) ? new Array(f.negativeStock) : [])) +
    len(d.unmapped_components || (Number.isFinite(f.unmappedComponents) ? new Array(f.unmappedComponents) : [])) +
    len(d.unmapped_names || (Number.isFinite(f.unmappedNames) ? new Array(f.unmappedNames) : [])) +
    len(d.bom_gaps || (Number.isFinite(f.bomGaps) ? new Array(f.bomGaps) : [])) +
    len(d.manual_review || (Number.isFinite(f.manualReview) ? new Array(f.manualReview) : [])) +
    len(d.unparsed_quantities || (Number.isFinite(f.unparsedQuantities) ? new Array(f.unparsedQuantities) : []))
  );
}

// Two-column flag row (label/value), mirroring the "Last 6 POs" list styling.
const FLAG_ROW_STYLE = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: 10,
  fontSize: 11.5,
  padding: "4px 8px",
  borderRadius: 6,
  background: "var(--bg-sunken)",
};

function QualityFlagsModal({ D, onClose }) {
  // Esc-to-close, matching SettingsModal / UploadModal behaviour.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const flags = D?.centralWh?.flags || null;
  const detail = (flags && typeof flags === "object" && flags.detail) || {};
  const arr = (v) => (Array.isArray(v) ? v : []);
  const asOf = D?.centralWh?.asOf || D?.centralWh?.anchorDate || null;

  // Each section: a flag category + how to render one of its rows. Only
  // non-empty sections render.
  const sections = [
    {
      key: "negative_stock",
      label: "Negative stock",
      hint: "FG codes that rolled below zero — likely a missed audit line or over-deduction.",
      rows: arr(detail.negative_stock),
      render: (r, i) => (
        <div key={i} style={FLAG_ROW_STYLE}>
          <span className="mono">{r?.code ?? "—"}</span>
          <span className="badge red dot">{Number.isFinite(r?.qty) ? r.qty : "?"}</span>
        </div>
      ),
    },
    {
      key: "unmapped_components",
      label: "Unmapped components",
      hint: "Audit lines with no SKU/BOM mapping — value/runway can't see them.",
      rows: arr(detail.unmapped_components),
      render: (r, i) => (
        <div key={i} style={FLAG_ROW_STYLE}>
          <span>{r?.name ?? "—"}</span>
          <span className="muted" style={{ fontSize: 10.5 }}>
            {[r?.section, r?.bucket].filter(Boolean).join(" · ") || ""}
            {r && r.raw != null ? ` · raw ${r.raw}` : ""}
          </span>
        </div>
      ),
    },
    {
      key: "unmapped_names",
      label: "Unmapped names",
      hint: "FG names in the workbook that didn't match a known SKU.",
      rows: arr(detail.unmapped_names),
      render: (r, i) => (
        <div key={i} style={FLAG_ROW_STYLE}>
          <span>{typeof r === "string" ? r : (r?.name ?? "—")}</span>
        </div>
      ),
    },
    {
      key: "bom_gaps",
      label: "BOM gaps",
      hint: "Bill-of-material refs with no clean audit line — producible may be understated.",
      rows: arr(detail.bom_gaps),
      render: (r, i) => (
        <div key={i} style={FLAG_ROW_STYLE}>
          <span className="mono">{r?.ref ?? "—"}</span>
          <span className="muted" style={{ fontSize: 10.5 }}>{r?.note ?? ""}</span>
        </div>
      ),
    },
    {
      key: "manual_review",
      label: "Manual review",
      hint: "Rows the parser couldn't resolve confidently — a human should confirm.",
      rows: arr(detail.manual_review),
      render: (r, i) => (
        <div key={i} style={FLAG_ROW_STYLE}>
          <span>{typeof r === "string" ? r : (r?.name ?? r?.ref ?? JSON.stringify(r))}</span>
        </div>
      ),
    },
    {
      key: "unparsed_quantities",
      label: "Unparsed quantities",
      hint: "Quantity cells that weren't numeric — treated as 0, may distort stock.",
      rows: arr(detail.unparsed_quantities),
      render: (r, i) => (
        <div key={i} style={FLAG_ROW_STYLE}>
          <span>{typeof r === "string" ? r : (r?.name ?? r?.code ?? JSON.stringify(r))}</span>
          {r && r.raw != null && <span className="muted" style={{ fontSize: 10.5 }}>raw “{r.raw}”</span>}
        </div>
      ),
    },
    {
      key: "offline_marketing_spike",
      label: "Offline / marketing spike",
      hint: "Offline + marketing outflow is excluded from runway velocity but still depletes WH stock. These SKUs had an unusual spike (last 30d ≫ prior 30d) — verify it isn't masking real demand.",
      rows: arr(detail.offline_marketing_spike),
      render: (r, i) => (
        <div key={i} style={FLAG_ROW_STYLE}>
          <span className="mono">{r?.code ?? "—"}</span>
          <span className="badge amber dot">{Number.isFinite(r?.recent) ? r.recent : "?"}u last 30d</span>
          <span className="muted" style={{ fontSize: 10.5 }}>vs {Number.isFinite(r?.prior) ? r.prior : "?"}u prior</span>
        </div>
      ),
    },
  ];

  const activeSections = sections.filter(s => s.rows.length > 0);
  const total = flagCount(D);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal-card" onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(620px, 94vw)" }}>
        <div className="modal-head">
          <div>
            <div className="modal-title">Notes &amp; quality flags</div>
            <div className="modal-sub muted">
              Central-warehouse ingestion flags{asOf ? ` · as of ${asOf}` : ""}
            </div>
          </div>
          <button className="btn ghost icon" onClick={onClose} title="Close (Esc)">✕</button>
        </div>

        <div className="modal-body">
          {!flags ? (
            <div className="muted" style={{ fontSize: 12.5, padding: "8px 0" }}>
              No data-quality issues flagged.
            </div>
          ) : total === 0 ? (
            <div className="muted" style={{ fontSize: 12.5, padding: "8px 0" }}>
              No data-quality issues flagged. The latest warehouse workbook parsed cleanly.
            </div>
          ) : (
            <>
              <div className="muted" style={{ fontSize: 11.5 }}>
                {total} item{total === 1 ? "" : "s"} need a look. These are surfaced from the
                warehouse workbook so nothing is silently dropped from stock, value, or runway.
              </div>
              {activeSections.map(s => (
                <div key={s.key}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span className="stat-label">{s.label}</span>
                    <span className="badge amber dot">{s.rows.length}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 10.5, marginBottom: 6 }}>{s.hint}</div>
                  <div style={{ display: "grid", gap: 4 }}>
                    {s.rows.map((r, i) => s.render(r, i))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="modal-foot">
          <span className="muted" style={{ fontSize: 11 }}>
            Source: central-WH engine (uploaded workbook over bundled).
          </span>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}


export default PageSuppliers;
