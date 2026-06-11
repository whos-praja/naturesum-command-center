import { useState, useEffect } from "react";
import { Icon, Card, Progress } from "../components/Shared.jsx";
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
        <button className={tab === "components" ? "active" : ""} onClick={() => setTab("components")}>
          Component reorder
          {componentReorderCount(D) > 0 && (
            <span className="badge amber dot" style={{ marginLeft: 6 }}>{componentReorderCount(D)}</span>
          )}
        </button>
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

      {tab === "components" && <ComponentReorderTab D={D} />}

      {flagsOpen && <QualityFlagsModal D={D} onClose={() => setFlagsOpen(false)} />}
    </div>
  );
};

// ── Component reorder (FIX-SPEC D6 / D8) ──────────────────────────────────
// Surfaces the central-WH engine's PER-COMPONENT reorder coverage — raw
// materials + primary packaging (and SFG), each with its OWN supplier lead
// time. This is the only place these numbers are visible to the user; the
// Inventory page shows FG reorder + a materials COUNT, but not the per-
// component reorder DATES the engine computes. Data is D.centralWhComponents,
// already sorted most-urgent-first and carrying stock / daysCover / leadDays /
// reorder / reorderByDays / reorderDate / constrains / blocks (see data.js).
// Every field is guarded so a missing/odd payload can never white-screen.

// Count of components currently flagged for reorder — drives the tab badge.
// SAFE: missing array → 0.
function componentReorderCount(D) {
  const list = D?.centralWhComponents;
  if (!Array.isArray(list)) return 0;
  // D1: non-constraining components (cartons, juice air pouches — "quickly
  // arranged") are excluded from the reorder count so this badge matches the
  // dashboard's `reorder && constrains` filter (P2-2 — no dashboard-vs-Suppliers
  // contradiction). They still render in the table, just not counted as needed.
  return list.filter(c => c && c.reorder && c.constrains !== false).length;
}

// Human-readable reorder timing from reorderByDays (+ optional ISO date).
// Negative ⇒ overdue. SAFE: null in → "—".
function fmtReorderWhen(byDays, isoDate) {
  if (byDays == null || !Number.isFinite(byDays)) return { text: "—", tone: "muted" };
  // Pass 4 (founder): long horizons read as months/years, not a bare day count.
  const dur = (d) => {
    const a = Math.abs(Math.round(d));
    if (a < 30) return `${a}d`;
    if (a < 365) return `${(a / 30).toFixed(1).replace(/\.0$/, "")} mo`;
    return `${(a / 365).toFixed(1).replace(/\.0$/, "")} yr`;
  };
  if (byDays < 0)  return { text: `Overdue ${dur(byDays)}${isoDate ? ` · was ${isoDate}` : ""}`, tone: "red" };
  if (byDays === 0) return { text: `Order today${isoDate ? ` · ${isoDate}` : ""}`, tone: "red" };
  return { text: `In ~${dur(byDays)}${isoDate ? ` · ${isoDate}` : ""}`, tone: byDays <= 7 ? "amber" : "ok" };
}

const TYPE_LABEL = { RM: "Raw material", SFG: "Semi-FG", PKG: "Packaging" };

function ComponentReorderTab({ D }) {
  const list = Array.isArray(D?.centralWhComponents) ? D.centralWhComponents : [];
  const asOf = D?.centralWh?.asOf || D?.centralWh?.anchorDate || null;
  const fmtN = typeof D?.fmtN === "function" ? D.fmtN : (n) => (n == null ? "—" : String(n));

  // R-FAILLOUD-friendly: if the engine emitted no components, say so plainly
  // rather than render an empty table with no explanation.
  if (!list.length) {
    return (
      <Card title="Component reorder coverage"
        sub="Raw materials + primary packaging · per-component lead times · central-WH engine">
        <div className="muted" style={{ fontSize: 12.5, padding: "8px 0" }}>
          No component data available from the warehouse workbook yet. Upload a Central
          Warehouse workbook (Inventory → Upload) to populate per-component reorder dates.
        </div>
      </Card>
    );
  }

  // D1/P2-2: exclude non-constraining (cartons, juice air pouches) so the
  // tab badge agrees with the dashboard's constraining-only reorder count.
  const reorderNow = list.filter(c => c.reorder && c.constrains !== false).length;

  return (
    <Card
      title="Component reorder coverage"
      sub={`Raw materials + primary packaging · per-component lead times${asOf ? ` · as of ${asOf}` : ""}`}
      action={<span className={"badge " + (reorderNow > 0 ? "amber" : "green") + " dot"}>
        {reorderNow > 0 ? `${reorderNow} to reorder` : "All covered"}
      </span>}
      padded={false}
    >
      <table className="table">
        <thead>
          <tr>
            <th>Component</th>
            <th>Type</th>
            <th className="num">Stock</th>
            <th className="num">Consumption/d</th>
            <th className="num">Days cover</th>
            <th className="num">Lead time</th>
            <th className="num" title="Order this much now to hold cover through one replenishment cycle + a 30-day buffer at the current sales-based consumption: ceil(consumption × (lead + 30) − stock)">Suggested qty</th>
            <th>Reorder</th>
            <th>Blocks</th>
          </tr>
        </thead>
        <tbody>
          {list.map((c) => {
            const when = fmtReorderWhen(c.reorderByDays, c.reorderDate);
            const cover = Number.isFinite(c.daysCover) ? c.daysCover : null;
            const coverTone = cover == null ? "muted"
              : (Number.isFinite(c.leadDays) && cover < c.leadDays) ? "red"
              : cover < 30 ? "amber" : "";
            const blocks = Array.isArray(c.blocks) ? c.blocks : [];
            return (
              <tr key={c.ref}>
                <td>
                  <div>{c.name ?? c.ref}</div>
                  <div className="sku">
                    {c.ref}
                    {c.constrains === false && (
                      <span className="muted"> · non-constraining (quickly arranged — never blocks production)</span>
                    )}
                  </div>
                </td>
                <td className="muted" style={{ fontSize: 11.5 }}>{TYPE_LABEL[c.type] || c.type || "—"}</td>
                <td className="num">
                  {c.untracked
                    ? <span className="muted" title="No line for this component in the audit sheet — stock is UNKNOWN (not zero). Add an audit row to track it.">untracked</span>
                    : <>{fmtN(c.stock)}{c.unit ? <span className="muted"> {c.unit}</span> : null}</>}
                </td>
                <td className="num muted">{Number.isFinite(c.consumption) ? fmtN(c.consumption) : "—"}</td>
                <td className="num">
                  <span className={coverTone ? coverTone : undefined}>
                    {cover == null ? <span className="muted">no usage</span> : `${fmtN(cover)} d`}
                  </span>
                </td>
                <td className="num">{Number.isFinite(c.leadDays) ? `${c.leadDays} d` : "—"}</td>
                <td className="num">
                  {Number.isFinite(c.suggestedQty) && c.suggestedQty > 0
                    ? <strong>{fmtN(c.suggestedQty)}{c.unit ? <span className="muted" style={{ fontWeight: 400 }}> {c.unit}</span> : null}</strong>
                    : <span className="muted">{c.untracked ? "—" : "covered"}</span>}
                </td>
                <td>
                  {c.reorder
                    ? <span className={"badge " + (when.tone === "red" ? "red" : "amber") + " dot"}>{when.text}</span>
                    : <span className={"muted"}>{when.text}</span>}
                </td>
                <td className="muted" style={{ fontSize: 11 }}>
                  {blocks.length
                    ? blocks.join(", ")
                    : (c.constrains === false ? "—" : <span className="muted">—</span>)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="muted" style={{ fontSize: 10.5, padding: "8px 12px" }}>
        Reorder date = as-of + (days cover − lead time); overdue when negative. Stock is the
        latest audit baseline minus post-audit production consumption (deplete-only — no inbound
        PO sheet yet, so cover only decreases until a newer audit is uploaded). Non-constraining
        components (shipping cartons, juice air pouches) still show a reorder date but never cap
        producible. Source: central-WH engine (uploaded workbook over bundled).
      </div>
    </Card>
  );
}

// ── Data-quality flags (R-FAILLOUD / smaller-requirement #13) ─────────────
// Surfaces D.centralWh.flags.detail so unmapped SKUs / BOM gaps / negative
// stock / garbage rows / offline-marketing spikes / parser notes are VISIBLE
// rather than silently dropped. Every access is guarded so a missing/odd shape
// can never white-screen the page.

// SINGLE source of truth for every flag category the engine can emit. Both the
// badge COUNT and the modal SECTIONS derive from this list, so the count can
// never drift from what the modal actually renders (the prior bug: the badge
// + the modal's empty-state gate ignored offline_marketing_spike & notes, so a
// workbook whose ONLY issues were spikes/notes showed "parsed cleanly" while
// the modal silently hid those sections). Keys mirror centralWhEngine.js
// `state.flags.*` exactly. `summaryKey` is the scalar fallback counter on the
// flags object (flags.<summaryKey>) used when a detail array is absent.
//
// MAINTENANCE: when a NEW flag array is added to centralWhEngine.js
// `state.flags`, add one entry here — the badge, the empty-state gate, and the
// rendered sections all pick it up automatically.

// Two-column flag row (label/value), mirroring the "Last 6 POs" list styling.
// Defined before FLAG_CATEGORIES because the per-category render() closures
// reference it.
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

const FLAG_CATEGORIES = [
  {
    key: "negative_stock", summaryKey: "negativeStock",
    label: "Negative stock",
    hint: "FG codes that rolled below zero — likely a missed audit line or over-deduction.",
    render: (r, i) => (
      <div key={i} style={FLAG_ROW_STYLE}>
        <span className="mono">{r?.code ?? "—"}</span>
        <span className="badge red dot">{Number.isFinite(r?.qty) ? r.qty : "?"}</span>
      </div>
    ),
  },
  {
    key: "unmapped_components", summaryKey: "unmappedComponents",
    label: "Unmapped components",
    hint: "Audit lines with no SKU/BOM mapping — value/runway can't see them.",
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
    key: "unmapped_names", summaryKey: "unmappedNames",
    label: "Unmapped names",
    hint: "FG names in the workbook (audit / production / daily movement) that didn't match a known SKU.",
    render: (r, i) => (
      <div key={i} style={FLAG_ROW_STYLE}>
        <span>{typeof r === "string" ? r : (r?.name ?? "—")}</span>
        {r && typeof r === "object" && r.source && (
          <span className="muted" style={{ fontSize: 10.5 }}>{r.source}</span>
        )}
      </div>
    ),
  },
  {
    key: "bom_gaps", summaryKey: "bomGaps",
    label: "Untracked components (BOM gaps)",
    hint: "Bill-of-material refs with NO audit line — stock is UNKNOWN (not zero). Excluded from producible binding so they can't phantom-zero a SKU; add an audit row to track them.",
    render: (r, i) => (
      <div key={i} style={FLAG_ROW_STYLE}>
        <span className="mono">{r?.ref ?? "—"}</span>
        <span className="muted" style={{ fontSize: 10.5 }}>{r?.note ?? ""}</span>
      </div>
    ),
  },
  {
    key: "fuzzy_matched", summaryKey: "fuzzyMatched",
    label: "Fuzzy name matches",
    hint: "Sheet names that didn't match an alias exactly but were close enough to map confidently (sizes must match exactly; similarity ≥ 0.8, unambiguous). Verify each guess — if one is wrong, fix the sheet name or tell the tool.",
    render: (r, i) => (
      <div key={i} style={FLAG_ROW_STYLE}>
        <span>“{r?.name ?? "—"}”</span>
        <span className="muted" style={{ fontSize: 10.5 }}>
          → <span className="mono">{r?.ref ?? "?"}</span>{r?.score != null ? ` · ${Math.round(r.score * 100)}%` : ""}{r?.source ? ` · ${r.source}` : ""}
        </span>
      </div>
    ),
  },
  {
    key: "duplicate_component_rows", summaryKey: "duplicateComponentRows",
    label: "Duplicate component rows",
    hint: "The same material appears on two audit lines (e.g. under two sections). The tool SUMS them — verify that's physically right and not a double-count.",
    render: (r, i) => (
      <div key={i} style={FLAG_ROW_STYLE}>
        <span className="mono">{r?.ref ?? "—"}</span>
        <span className="muted" style={{ fontSize: 10.5 }}>
          {Array.isArray(r?.rows) ? r.rows.map(x => `${x.name} (${x.qty})`).join("  +  ") : ""}
        </span>
      </div>
    ),
  },
  {
    key: "manual_review", summaryKey: "manualReview",
    label: "Manual review",
    hint: "Rows the parser couldn't resolve confidently (e.g. a quantity range) — a human should confirm.",
    render: (r, i) => (
      <div key={i} style={FLAG_ROW_STYLE}>
        <span>{typeof r === "string" ? r : (r?.name ?? r?.ref ?? JSON.stringify(r))}</span>
        {r && typeof r === "object" && r.raw != null && (
          <span className="muted" style={{ fontSize: 10.5 }}>
            raw “{r.raw}”{r.picked != null ? ` → ${r.picked}` : ""}
          </span>
        )}
      </div>
    ),
  },
  {
    key: "unparsed_quantities", summaryKey: "unparsedQuantities",
    label: "Unparsed quantities",
    hint: "Quantity cells that weren't numeric — treated as 0, may distort stock.",
    render: (r, i) => (
      <div key={i} style={FLAG_ROW_STYLE}>
        <span>{typeof r === "string" ? r : (r?.name ?? r?.code ?? JSON.stringify(r))}</span>
        {r && r.raw != null && <span className="muted" style={{ fontSize: 10.5 }}>raw “{r.raw}”</span>}
      </div>
    ),
  },
  {
    key: "offline_marketing_spike", summaryKey: "offlineMarketingSpike",
    label: "Offline / marketing spike",
    hint: "Offline + marketing outflow is excluded from runway velocity but still depletes WH stock. These SKUs had an unusual spike (last 30d ≫ prior 30d) — verify it isn't masking real demand.",
    render: (r, i) => (
      <div key={i} style={FLAG_ROW_STYLE}>
        <span className="mono">{r?.code ?? "—"}</span>
        <span className="badge amber dot">{Number.isFinite(r?.recent) ? r.recent : "?"}u last 30d</span>
        <span className="muted" style={{ fontSize: 10.5 }}>vs {Number.isFinite(r?.prior) ? r.prior : "?"}u prior</span>
      </div>
    ),
  },
  {
    // Parser notes (skipped optional sheets, unparseable movement dates, etc).
    // These have no scalar summary counter on the flags object → summaryKey null.
    key: "notes", summaryKey: null,
    label: "Parser notes",
    hint: "Non-fatal ingestion notes — optional sheets skipped, unparseable dates, etc. Informational, but worth a glance.",
    render: (r, i) => (
      <div key={i} style={FLAG_ROW_STYLE}>
        <span>{typeof r === "string" ? r : (r?.note ?? JSON.stringify(r))}</span>
        {r && typeof r === "object" && r.source && (
          <span className="muted" style={{ fontSize: 10.5 }}>{r.source}</span>
        )}
      </div>
    ),
  },
];

// Resolve a category's rows from the flags object: prefer the explicit detail
// array; fall back to the scalar summary counter (rendered as N placeholder
// rows) so the badge still reflects reality if only the summary survived.
// SAFE: any missing piece collapses to an empty array.
function rowsForCategory(flags, cat) {
  const d = (flags && typeof flags === "object" && flags.detail) || {};
  const arr = d[cat.key];
  if (Array.isArray(arr)) return arr;
  if (cat.summaryKey && Number.isFinite(flags?.[cat.summaryKey]) && flags[cat.summaryKey] > 0) {
    // Detail array absent but the summary counter says there are N — emit N
    // placeholders so the count is honest even without per-row detail.
    return new Array(flags[cat.summaryKey]).fill(null);
  }
  return [];
}

// Total count of flagged issues — drives the badge on the button AND the
// modal's empty-state gate. Sums EVERY category in FLAG_CATEGORIES so it can
// never undercount relative to what the modal renders. SAFE: any missing piece
// collapses to 0.
function flagCount(D) {
  const f = D?.centralWh?.flags;
  if (!f) return 0;
  return FLAG_CATEGORIES.reduce((sum, cat) => sum + rowsForCategory(f, cat).length, 0);
}

function QualityFlagsModal({ D, onClose }) {
  // Esc-to-close, matching SettingsModal / UploadModal behaviour.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const flags = D?.centralWh?.flags || null;
  const asOf = D?.centralWh?.asOf || D?.centralWh?.anchorDate || null;

  // Build sections from the SHARED FLAG_CATEGORIES list (same list flagCount
  // sums), resolving each category's rows via rowsForCategory. This guarantees
  // every category the badge counts ALSO renders here — offline_marketing_spike
  // and notes included — so nothing the engine flags is silently hidden.
  // Only non-empty sections render.
  const activeSections = flags
    ? FLAG_CATEGORIES
        .map(cat => ({ ...cat, rows: rowsForCategory(flags, cat) }))
        .filter(s => s.rows.length > 0)
    : [];
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
