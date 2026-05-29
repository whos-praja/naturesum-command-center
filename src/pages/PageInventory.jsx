import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Icon, Delta, Card, Sparkline, BarChart, Progress, ChannelPill } from "../components/Shared.jsx";
import NSData from "../data.js";

// Module 3 — Inventory & Supply Chain
// Sub-routes: /inventory/{unified|runway|forecast|batches|returns}

const VALID_TABS = ["unified", "materials", "runway", "simulator", "forecast", "batches", "returns"];

// Color palette used by every warehouse-breakdown surface (mini-bar in the
// Unified Stock table, the dedicated Materials tab, and the per-SKU popover).
// Keeping it centralized so the legend → cell → tab → modal all match.
const MATERIAL_COLORS = {
  fg:          "#2F5E47", // brand — the only shippable thing
  semiFg:      "#5C8E6E", // brand-light — bulk awaiting packing
  rawMaterial: "#B07A1F", // warning — ingredients needing processing
  packaging:   "#3A6072", // info — containers, labels
};
const MATERIAL_LABELS = {
  fg:          "FG",
  semiFg:      "Semi-FG",
  rawMaterial: "Raw",
  packaging:   "Packaging",
};

const PageInventory = ({ subsection }) => {
  const D = NSData;
  const navigate = useNavigate();
  const tab = VALID_TABS.includes(subsection) ? subsection : "unified";
  const setTab = (next) => {
    if (next === "unified") navigate("/inventory");
    else navigate(`/inventory/${next}`);
  };
  const [forecastDays, setForecastDays] = useState(60);
  // RunwayTab now manages its own trajectory + per-row growth state.

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">Inventory & Supply Chain</div>
          <div className="page-sub">Unified stock · runway · batch & expiry · reorder logic</div>
        </div>
        <div className="actions">
          <button className="btn"><Icon name="download" size={13}/>Upload MIS</button>
          <button className="btn"><Icon name="refresh" size={13}/>Sync warehouses</button>
          <button className="btn primary"><Icon name="plus" size={13}/>Place PO</button>
        </div>
      </div>

      <div className="tabs">
        <button className={tab === "unified" ? "active" : ""} onClick={() => setTab("unified")}>Unified stock</button>
        <button className={tab === "materials" ? "active" : ""} onClick={() => setTab("materials")}>Materials breakdown</button>
        <button className={tab === "runway" ? "active" : ""} onClick={() => setTab("runway")}>Runway calculator</button>
        <button className={tab === "simulator" ? "active" : ""} onClick={() => setTab("simulator")}>Simulator</button>
        <button className={tab === "forecast" ? "active" : ""} onClick={() => setTab("forecast")}>Demand forecast</button>
        <button className={tab === "batches" ? "active" : ""} onClick={() => setTab("batches")}>Batches & expiry</button>
        <button className={tab === "returns" ? "active" : ""} onClick={() => setTab("returns")}>Returns restocking</button>
      </div>

      {tab === "unified" && <UnifiedStockTab inventory={D.inventory}/>}
      {tab === "materials" && <MaterialsTab inventory={D.inventory}/>}
      {tab === "runway" && <RunwayTab inventory={D.inventory}/>}
      {tab === "simulator" && <SimulatorTab inventory={D.inventory}/>}
      {tab === "forecast" && (
        <ForecastTab inventory={D.inventory} days={forecastDays} setDays={setForecastDays}/>
      )}
      {tab === "batches" && <BatchesTab batches={D.batches}/>}
      {tab === "returns" && <ReturnsTab/>}
    </div>
  );
};

const UnifiedStockTab = ({ inventory }) => {
  const D = NSData;
  // Warehouse-only scope.
  const warehouseUnits = inventory.reduce((a, b) => a + b.stock.warehouse, 0);
  const unitCost = (s) => (s.totalStock ? s.stockValue / s.totalStock : 0);
  const warehouseStockValue = inventory.reduce((a, b) => a + b.stock.warehouse * unitCost(b), 0);
  const activeSkus = inventory.filter(s => s.active !== false).length;

  // Stock-runway alerts:
  //   skusRunningOut = SKUs where current runway ≤ supplier lead time (red).
  //     i.e. the reorder window has closed — we will run out before new stock lands.
  //   materialsToReorder = count of (sku, materialType) pairs where coverage < 30d.
  //     Raw coverage  = rawMaterial / (velocity × perPacketRaw)
  //     Pkg coverage  = packaging   / velocity
  const skusRunningOut = inventory.filter(s => s.runwayStatus === "red").length;
  let materialsToReorder = 0;
  inventory.forEach(s => {
    const wb = s.warehouseBreakdown;
    if (!wb || !s.velocity) return;
    const rawCoverage = wb.rawMaterial / (s.velocity * (wb.perPacketRaw || 1));
    const pkgCoverage = wb.packaging / s.velocity;
    if (rawCoverage < 30) materialsToReorder++;
    if (pkgCoverage < 30) materialsToReorder++;
  });
  const hasCriticalAlerts = skusRunningOut > 0;

  // Clicking any SKU row opens the breakdown popover.
  const [popoverSku, setPopoverSku] = useState(null);
  const navigate = useNavigate();

  return (
    <>
      <div className="grid stat-row-3" style={{ marginBottom: 14 }}>
        {/* Stock-value summary: ₹ headline + FG-units / SKU-count / sync meta */}
        <Card title="Total stock value">
          <div className="stat-num xl">{D.fmtINR(warehouseStockValue)}</div>
          <div className="stock-meta">
            <div className="stock-meta-item">
              <div className="stock-meta-num mono">{D.fmtN(warehouseUnits)}</div>
              <div className="stock-meta-label">FG units · main warehouse</div>
            </div>
            <div className="stock-meta-divider"/>
            <div className="stock-meta-item">
              <div className="stock-meta-num mono">{activeSkus}</div>
              <div className="stock-meta-label">active Items</div>
            </div>
            <div className="stock-meta-divider"/>
            <div className="stock-meta-item">
              <div className="stock-meta-num mono" style={{ fontSize: 13 }}>4d ago</div>
              <div className="stock-meta-label">last MIS sync</div>
            </div>
          </div>
        </Card>

        {/* Stock-runway critical alerts */}
        <div className={"stock-alert-card" + (hasCriticalAlerts ? " is-critical" : " is-clear")}>
          <div className="stock-alert-head">
            <div className="stock-alert-title">
              <span className={"stock-alert-dot" + (hasCriticalAlerts ? " crit" : " ok")}/>
              Stock alerts
            </div>
            <button
              className="btn sm ghost"
              onClick={() => navigate("/inventory/runway")}
              title="Open Runway calculator"
            >
              View runway <Icon name="arrowRight" size={11}/>
            </button>
          </div>
          {hasCriticalAlerts ? (
            <>
              <div className="stock-alert-main">
                <span className="stock-alert-num mono">{skusRunningOut}</span>
                <span className="stock-alert-main-label">
                  Item{skusRunningOut === 1 ? "" : "s"} running out
                </span>
              </div>
              <div className="stock-alert-sub">
                runway ≤ supplier lead time — reorder window has already closed
              </div>
              <div className="stock-alert-secondary">
                <span className="stock-alert-num-sm mono">{materialsToReorder}</span>
                material{materialsToReorder === 1 ? "" : "s"} need reordering
                <span className="muted"> · &lt; 30 days coverage</span>
              </div>
            </>
          ) : (
            <>
              <div className="stock-alert-main">
                <span className="stock-alert-num mono" style={{ color: "var(--success)" }}>0</span>
                <span className="stock-alert-main-label">Items running out</span>
              </div>
              <div className="stock-alert-sub">all Items above supplier lead-time floor</div>
              <div className="stock-alert-secondary">
                <span className="stock-alert-num-sm mono">{materialsToReorder}</span>
                material{materialsToReorder === 1 ? "" : "s"} need reordering
                <span className="muted"> · &lt; 30 days coverage</span>
              </div>
            </>
          )}
        </div>

        {/* In transit (deferred — comes online once the integration is wired up) */}
        <div className="is-deferred">
          <span className="deferred-tag" title="Pending integration">Pending integration</span>
          <Card title="In transit">
            <div className="stat-num lg">{D.fmtN(inventory.reduce((a,b)=>a+b.stock.transit,0))}</div>
            <div className="muted" style={{ fontSize: 11.5 }}>units · arriving over next 7 days</div>
          </Card>
        </div>
      </div>

      <Card
        title="Inventory by Item × location"
        sub="Source: warehouse MIS sheet (live). Click any Item for the full material breakdown."
        padded={false}
        action={
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input className="txt sm" placeholder="Filter Item…" style={{ width: 160, height: 24, padding: "2px 9px", fontSize: 11.5 }}/>
            <button className="btn sm"><Icon name="filter" size={12}/>Status</button>
          </div>
        }>
        <table className="table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">Warehouse</th>
              <th className="num col-deferred">Amazon FBA</th>
              <th className="num col-deferred">Flipkart</th>
              <th className="num col-deferred">Blinkit</th>
              <th className="num col-deferred">In Transit</th>
              <th className="num">Total<span className="footnote-ref">*</span></th>
              <th className="num">Velocity /d</th>
              <th>Runway</th>
              <th className="num">Stock value</th>
            </tr>
          </thead>
          <tbody>
            {inventory.map(s => (
              <tr key={s.code} className="row-clickable" onClick={() => setPopoverSku(s)}>
                <td>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span>{s.name}</span>
                    <span className="sku">{s.code} · {s.variant}</span>
                  </div>
                </td>
                <td className="num">{D.fmtN(s.stock.warehouse)}</td>
                <td className="num col-deferred">{D.fmtN(s.stock.amazonFBA)}</td>
                <td className="num col-deferred">{D.fmtN(s.stock.flipkart)}</td>
                <td className="num col-deferred">{D.fmtN(s.stock.blinkit)}</td>
                <td className="num col-deferred">{s.stock.transit ? <span className="badge blue">{D.fmtN(s.stock.transit)}</span> : <span className="muted">—</span>}</td>
                <td className="num strong">{D.fmtN(s.stock.warehouse)}</td>
                <td className="num">{s.velocity}</td>
                <td>
                  <span className={"badge " + (s.runwayStatus === "red" ? "red" : s.runwayStatus === "amber" ? "amber" : "green") + " dot"}>
                    {s.runway}d
                  </span>
                </td>
                <td className="num">{D.fmtINR(s.stock.warehouse * unitCost(s))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="table-footnote">
          <span className="footnote-ref">*</span>
          <span>
            <strong>Total</strong> currently reflects <strong>warehouse FG stock only</strong>.
            Amazon FBA, Flipkart, Blinkit and In-Transit columns are placeholders — they'll go live
            once each channel's integration is wired up. For the FG / Semi-FG / Raw / Packaging split,
            click any Item row or {" "}
            <button className="link-btn" onClick={() => navigate("/inventory/materials")}>
              open the Materials breakdown
            </button>.
          </span>
        </div>
      </Card>

      {popoverSku && (
        <SkuBreakdownModal sku={popoverSku} onClose={() => setPopoverSku(null)}/>
      )}
    </>
  );
};

// ── Materials breakdown tab — focused deep-dive view ────────────────────
const MaterialsTab = ({ inventory }) => {
  const D = NSData;
  const [sortBy, setSortBy] = useState("bottleneck"); // bottleneck | best | name | fg
  const [popoverSku, setPopoverSku] = useState(null);

  // Augment each SKU with computed metrics for sorting / display.
  const rows = inventory.map(s => {
    const wb = s.warehouseBreakdown || { fg: 0, semiFg: 0, rawMaterial: 0, packaging: 0, producibleFG: 0 };
    const bottleneck = wb.semiFg <= wb.packaging ? "Semi-FG" : "Packaging";
    // "Bottleneck severity" = how much best-case is constrained vs the max
    // input we have. Lower ratio = tighter constraint.
    const maxInput = Math.max(wb.fg, wb.semiFg, wb.rawMaterial, wb.packaging, 1);
    const constraint = wb.producibleFG / maxInput;
    return { ...s, wb, bottleneck, constraint };
  });

  const sorted = [...rows].sort((a, b) => {
    if (sortBy === "bottleneck") return a.constraint - b.constraint; // tightest first
    if (sortBy === "best") return b.wb.producibleFG - a.wb.producibleFG;
    if (sortBy === "fg") return b.wb.fg - a.wb.fg;
    return a.name.localeCompare(b.name);
  });

  const totals = ["fg", "semiFg", "rawMaterial", "packaging", "producibleFG"].reduce((acc, k) => {
    acc[k] = rows.reduce((a, r) => a + r.wb[k], 0);
    return acc;
  }, {});

  // Runway helper — days of coverage at the SKU's current sell-through velocity.
  //   FG, Semi-FG, Packaging: 1 unit covers 1 pack → days = stock / velocity
  //   Raw: needs `perPacketRaw` units to make 1 pack → days = stock / (velocity × perPacketRaw)
  //   Producible FG: already in FG-pack units → days = stock / velocity
  // Returns { days, status, label } where status drives the color (red/amber/muted).
  const runwayFor = (key, sku) => {
    const wb = sku.warehouseBreakdown;
    if (!wb || !sku.velocity) return null;
    let days;
    if (key === "rawMaterial") {
      days = wb.rawMaterial / (sku.velocity * (wb.perPacketRaw || 1));
    } else if (key === "producibleFG") {
      days = wb.producibleFG / sku.velocity;
    } else {
      days = wb[key] / sku.velocity;
    }
    const status = days < 14 ? "red" : days < 30 ? "amber" : "muted";
    const label = days >= 60
      ? `~${(days / 30).toFixed(1)}mo`
      : `~${Math.round(days)}d`;
    return { days, status, label };
  };

  const RunwayChip = ({ rw }) => rw ? (
    <div className={"cell-runway runway-" + rw.status} title={`${rw.days.toFixed(1)} days at current velocity`}>
      {rw.label}
    </div>
  ) : null;

  return (
    <>
      <Card
        title="Material composition by Item"
        sub="The bottleneck column is the input that caps Producible FG. Click any row for the per-Item popover."
        padded={false}
        action={
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span className="muted" style={{ fontSize: 11.5 }}>Sort:</span>
            <select className="sel" value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ height: 26, fontSize: 11.5 }}>
              <option value="bottleneck">Tightest bottleneck</option>
              <option value="best">Producible FG (high → low)</option>
              <option value="fg">FG count (high → low)</option>
              <option value="name">Item name</option>
            </select>
          </div>
        }
      >
        <table className="table mat-table">
          <colgroup>
            <col className="col-sku"/>
            <col className="col-num"/>
            <col className="col-num"/>
            <col className="col-num"/>
            <col className="col-num"/>
            <col className="col-bn"/>
            <col className="col-result"/>
            <col className="col-result"/>
          </colgroup>
          <thead>
            <tr>
              <th>Item</th>
              <th className="num mat-h" style={{ color: MATERIAL_COLORS.fg }}>FG</th>
              <th className="num mat-h" style={{ color: MATERIAL_COLORS.semiFg }}>Semi-FG</th>
              <th className="num mat-h" style={{ color: MATERIAL_COLORS.rawMaterial }}>Raw</th>
              <th className="num mat-h" style={{ color: MATERIAL_COLORS.packaging }}>Packaging</th>
              <th className="mat-h-bn">Bottleneck</th>
              <th className="num mat-h-result">Producible FG</th>
              <th className="num mat-h-result mat-h-max" title="FG + Producible FG — the maximum FG inventory we could have today">
                Max FG <span className="mat-h-formula mono">FG + Prod.</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(s => {
              const bnSemi = s.bottleneck === "Semi-FG";
              const bnPack = s.bottleneck === "Packaging";
              const rwFg   = runwayFor("fg", s);
              const rwSemi = runwayFor("semiFg", s);
              const rwRaw  = runwayFor("rawMaterial", s);
              const rwPkg  = runwayFor("packaging", s);
              const rwBest = runwayFor("producibleFG", s);
              // Max FG = current packed FG + what we could additionally pack today.
              const maxFG = s.wb.fg + s.wb.producibleFG;
              const rwMax = s.velocity ? (() => {
                const days = maxFG / s.velocity;
                const status = days < 14 ? "red" : days < 30 ? "amber" : "muted";
                const label = days >= 60 ? `~${(days / 30).toFixed(1)}mo` : `~${Math.round(days)}d`;
                return { days, status, label };
              })() : null;

              // Every numeric cell shares the same structure: number on top,
              // optional runway chip below. Pass `bn` to flag a bottleneck cell
              // (gets amber tint + accent border via the .mat-cell-bn class).
              const numCell = (value, rw, isBn) => (
                <td className={"num mat-cell" + (isBn ? " mat-cell-bn" : "")}>
                  <div className="mat-cell-num">{D.fmtN(value)}</div>
                  {rw && <RunwayChip rw={rw}/>}
                </td>
              );

              return (
                <tr key={s.code} className="row-clickable" onClick={() => setPopoverSku(s)}>
                  <td className="mat-cell mat-cell-sku">
                    <div className="mat-cell-name">{s.name}</div>
                    <div className="sku">{s.code} · {s.variant}</div>
                  </td>
                  {numCell(s.wb.fg, rwFg)}
                  {numCell(s.wb.semiFg, rwSemi, bnSemi)}
                  {numCell(s.wb.rawMaterial, rwRaw)}
                  {numCell(s.wb.packaging, rwPkg, bnPack)}
                  <td className="mat-cell mat-cell-bnlabel">
                    <span className="mat-bn-pill">{s.bottleneck}</span>
                  </td>
                  <td className="num mat-cell mat-cell-result">
                    <div className="mat-cell-num result">{D.fmtN(s.wb.producibleFG)}</div>
                    {rwBest && <RunwayChip rw={rwBest}/>}
                  </td>
                  <td className="num mat-cell mat-cell-result mat-cell-max">
                    <div className="mat-cell-num result max">{D.fmtN(maxFG)}</div>
                    {rwMax && <RunwayChip rw={rwMax}/>}
                  </td>
                </tr>
              );
            })}
            <tr className="row-total mat-row-total">
              <td className="strong">Total</td>
              <td className="num strong">{D.fmtN(totals.fg)}</td>
              <td className="num strong">{D.fmtN(totals.semiFg)}</td>
              <td className="num strong">{D.fmtN(totals.rawMaterial)}</td>
              <td className="num strong">{D.fmtN(totals.packaging)}</td>
              <td/>
              <td className="num strong mat-cell-result mat-row-total-result">{D.fmtN(totals.producibleFG)}</td>
              <td className="num strong mat-cell-result mat-cell-max mat-row-total-result mat-row-total-max">{D.fmtN(totals.fg + totals.producibleFG)}</td>
            </tr>
          </tbody>
        </table>
      </Card>

      {popoverSku && (
        <SkuBreakdownModal sku={popoverSku} onClose={() => setPopoverSku(null)}/>
      )}
    </>
  );
};

// ── Per-SKU warehouse breakdown popover ─────────────────────────────────
const SkuBreakdownModal = ({ sku, onClose }) => {
  const D = NSData;
  const wb = sku.warehouseBreakdown;
  const unitCost = sku.totalStock ? sku.stockValue / sku.totalStock : 0;

  // Esc to close
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Which input is the bottleneck for producible FG?
  const bottleneck = wb.semiFg <= wb.packaging ? "Semi-FG" : "Packaging";

  // Material rows — label + per-item code + number + hint stack.
  // The bottleneck row gets a subtle highlight so the eye lands on the cap.
  const codes = wb.codes || {};
  const row = (key, label, value, hint) => {
    const isBottleneck = (bottleneck === "Semi-FG" && key === "semiFg") ||
                          (bottleneck === "Packaging" && key === "packaging");
    // For FG row, the code is the SKU itself; for others, look it up in wb.codes
    const itemCode = key === "fg" ? sku.code : codes[key];
    return (
      <div className={"wb-row" + (isBottleneck ? " wb-row-bottleneck" : "")} key={key}>
        <div className="wb-row-label">
          <span className="wb-row-swatch" style={{ background: MATERIAL_COLORS[key] }}/>
          <div>
            <div className="wb-row-name">
              {label}
              {itemCode && <span className="wb-row-code sku">{itemCode}</span>}
              {isBottleneck && <span className="wb-row-bn-tag">bottleneck</span>}
            </div>
            {hint && <div className="wb-row-hint muted">{hint}</div>}
          </div>
        </div>
        <div className="wb-row-value mono">{D.fmtN(value)}</div>
      </div>
    );
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">{sku.name}</div>
            <div className="modal-sub sku">{sku.code} · {sku.variant}</div>
          </div>
          <button className="btn ghost icon" onClick={onClose} title="Close (Esc)">✕</button>
        </div>

        <div className="modal-body">
          <div className="wb-best">
            <div className="wb-best-label">Max FG · today</div>
            <div className="wb-best-num mono">{D.fmtN(wb.fg + wb.producibleFG)}</div>
            <div className="wb-best-formula muted">
              <span className="mono">FG + Producible</span> · bottleneck: <strong>{bottleneck}</strong>
            </div>
            <div className="wb-best-substats">
              <div className="wb-best-sub">
                <span className="wb-best-sub-label">Current FG</span>
                <span className="wb-best-sub-num mono">{D.fmtN(wb.fg)}</span>
              </div>
              <div className="wb-best-sub">
                <span className="wb-best-sub-label">Producible FG</span>
                <span className="wb-best-sub-num mono">{D.fmtN(wb.producibleFG)}</span>
              </div>
            </div>
          </div>

          <div className="wb-rows">
            {row("fg", "FG (ready to ship)", wb.fg, "shippable today — this is the warehouse number")}
            {row("semiFg", "Semi-FG", wb.semiFg, "bulk product, needs packing")}
            {row("rawMaterial", "Raw Material", wb.rawMaterial, `${wb.perPacketRaw} unit(s) raw → 1 pack`)}
            {row("packaging", "Packaging", wb.packaging, "containers + labels ready")}
          </div>

          <div className="wb-meta">
            <dl className="kv">
              <dt>FG stock value</dt>
              <dd>{D.fmtINR(wb.fg * unitCost)}</dd>
              <dt>Rolling daily velocity</dt>
              <dd>{sku.velocity} units/day</dd>
              <dt>Runway (warehouse FG)</dt>
              <dd>{Math.round(wb.fg / sku.velocity)} days</dd>
              <dt>Supplier lead time</dt>
              <dd>{sku.leadTime} days</dd>
            </dl>
          </div>
        </div>

        <div className="modal-foot">
          <span className="muted" style={{ fontSize: 11.5 }}>
            Source: warehouse MIS sheet · last sync 4d ago
          </span>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

// Custom item picker (replaces native <select> which can't be styled when
// open). Search-as-you-type, click-outside to close, Esc to dismiss.
const ItemPicker = ({ items, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const selected = items.find(i => i.code === value);
  const q = query.trim().toLowerCase();
  const filtered = !q ? items : items.filter(i =>
    i.code.toLowerCase().includes(q) ||
    i.name.toLowerCase().includes(q) ||
    (i.variant || "").toLowerCase().includes(q)
  );

  return (
    <div className="ipick" ref={ref}>
      <button
        type="button"
        className={"ipick-trigger" + (open ? " is-open" : "")}
        onClick={() => setOpen(o => !o)}
      >
        <div className="ipick-trigger-text">
          <span className="ipick-trigger-name">{selected?.name || "Pick item"}</span>
          {selected && <span className="ipick-trigger-meta">{selected.variant} · {selected.code}</span>}
        </div>
        <Icon name="chev" size={14}/>
      </button>
      {open && (
        <div className="ipick-menu">
          <div className="ipick-search">
            <Icon name="search" size={13}/>
            <input
              type="text"
              placeholder="Search by name or code…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoFocus
            />
          </div>
          <div className="ipick-list">
            {filtered.length === 0 ? (
              <div className="ipick-empty">No items match "{query}"</div>
            ) : filtered.map(i => (
              <button
                key={i.code}
                className={"ipick-item" + (i.code === value ? " is-active" : "")}
                onClick={() => { onChange(i.code); setOpen(false); setQuery(""); }}
              >
                <div className="ipick-item-name">{i.name}</div>
                <div className="ipick-item-meta sku">{i.variant} · {i.code}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Simulator tab — full sandbox. Pick an item, tweak any value, see
// every downstream number (Producible FG, Max FG, Runway, Reorder by,
// Status) recompute instantly. Use "Reset" to snap back to baseline.
const SimulatorTab = ({ inventory }) => {
  const D = NSData;
  const [selectedCode, setSelectedCode] = useState(inventory[0]?.code);
  const baseline = inventory.find(i => i.code === selectedCode) || inventory[0];

  // Local sandbox state — what the user is "playing with". Initialised
  // from the selected item's baseline; resets when the item changes.
  const [sim, setSim] = useState(() => baselineState(baseline));
  useEffect(() => { setSim(baselineState(baseline)); }, [selectedCode]);

  function baselineState(s) {
    const wb = s?.warehouseBreakdown || {};
    return {
      fg:         s?.warehouseBreakdown?.fg ?? s?.stock?.warehouse ?? 0,
      semiFg:     wb.semiFg ?? 0,
      rawMaterial: wb.rawMaterial ?? 0,
      packaging:  wb.packaging ?? 0,
      perPacketRaw: wb.perPacketRaw ?? 1,
      velocity:   s?.velocity ?? 0,
      leadTime:   s?.leadTime ?? 21,
      growth:     s?.growth ?? 0,
    };
  }

  const set = (k) => (e) => {
    const v = parseFloat(e.target.value);
    setSim(prev => ({ ...prev, [k]: Number.isFinite(v) ? v : 0 }));
  };
  const reset = () => setSim(baselineState(baseline));

  // Live computations
  const producibleFg = Math.min(sim.semiFg, sim.packaging);
  const maxFg = sim.fg + producibleFg;
  const effectiveVel = sim.velocity * (1 + sim.growth / 100);
  const runway = effectiveVel > 0 ? Math.round(maxFg / effectiveVel) : 0;
  const status = runway <= sim.leadTime ? "red" : runway < 30 ? "amber" : "green";
  const buffer = runway - sim.leadTime;
  const overdue = buffer < 0;
  const reorderByDays = buffer;

  // What changed from baseline (highlight modified inputs)
  const isDelta = (k) => sim[k] !== baselineState(baseline)[k];

  // For input min/max so sliders feel sane
  const fgMax = Math.max(2000, Math.round((baseline?.warehouseBreakdown?.fg || 100) * 5));

  return (
    <div className="sim-shell">
      <Card style={{ overflow: "visible", position: "relative", zIndex: 50 }}>
        <div className="sim-head">
          <div>
            <div className="sim-head-label">Sandbox</div>
            <div className="sim-head-sub">Pick an item. Change any value. Watch the math.</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ItemPicker
              items={inventory}
              value={selectedCode}
              onChange={setSelectedCode}
            />
            <button className="btn sm" onClick={reset} title="Snap all inputs back to current values">
              Reset
            </button>
          </div>
        </div>
      </Card>

      <div className="sim-grid">
        {/* INPUTS panel */}
        <Card title="Inputs" sub="Edit any cell — outputs recompute instantly. Modified values get a clickable pill to reset.">
          <div className="sim-inputs">
            <div className="sim-input-row sim-input-head">
              <div></div>
              <div className="sim-input-head-label">Tweak ↔</div>
              <div className="sim-input-head-cluster">
                <span className="sim-input-head-new">New value</span>
                <span className="sim-input-head-current">Current</span>
              </div>
            </div>
            {[
              { k: "fg",          label: "Warehouse FG",  unit: "units", min: 0, max: fgMax,  step: 1 },
              { k: "semiFg",      label: "Semi-FG",       unit: "units", min: 0, max: fgMax,  step: 1 },
              { k: "rawMaterial", label: "Raw Material",  unit: "units", min: 0, max: fgMax * 2, step: 1 },
              { k: "packaging",   label: "Packaging",     unit: "units", min: 0, max: fgMax * 1.5, step: 1 },
              { k: "velocity",    label: "Daily velocity", unit: "/day", min: 0, max: 500,    step: 1 },
              { k: "leadTime",    label: "Supplier lead time", unit: "days", min: 1, max: 120, step: 1 },
              { k: "growth",      label: "Growth %",      unit: "%",     min: -100, max: 500, step: 1 },
              { k: "perPacketRaw",label: "Raw per pack",  unit: "ratio", min: 0.01, max: 10,   step: 0.05 },
            ].map(({ k, label, unit, min, max, step }) => {
              const base = baselineState(baseline)[k];
              const delta = isDelta(k);
              const absDelta = sim[k] - base;
              const pctDelta = base !== 0 ? (absDelta / Math.abs(base)) * 100 : 0;
              const sign = absDelta > 0 ? "+" : "";
              const resetOne = () => setSim(prev => ({ ...prev, [k]: base }));
              return (
                <div key={k} className={"sim-input-row" + (delta ? " is-delta" : "")}>
                  <div className="sim-input-label">
                    <span>{label}</span>
                    <span className="muted">{unit}</span>
                  </div>
                  <input
                    type="range"
                    className="sim-range"
                    min={min} max={max} step={step}
                    value={sim[k]}
                    onChange={set(k)}
                  />
                  <div className="sim-input-cluster">
                    <input
                      type="number"
                      className="sim-number"
                      min={min} max={max} step={step}
                      value={sim[k]}
                      onChange={set(k)}
                    />
                    <button
                      type="button"
                      className={"sim-baseline-pill" + (delta ? " is-changed" : "")}
                      onClick={delta ? resetOne : undefined}
                      title={delta ? `Reset to baseline (${base})` : `Baseline value from the sheet`}
                      disabled={!delta}
                    >
                      {delta && <span className="sim-baseline-reset">↺</span>}
                      <span className="sim-baseline-num mono">{Number.isFinite(base) ? base : "—"}</span>
                      {delta && (
                        <span className={"sim-baseline-delta " + (absDelta > 0 ? "up" : "down")}>
                          {sign}{Math.abs(pctDelta) >= 100
                            ? Math.round(pctDelta)
                            : pctDelta.toFixed(0)}%
                        </span>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* OUTPUTS panel */}
        <Card title="Live outputs" sub={status === "red" ? "Action needed — runway below lead time" : status === "amber" ? "Watch — under 30 days" : "Healthy — above lead time + 30d buffer"}>
          <div className={"sim-out sim-out-" + status}>
            <div className="sim-out-hero">
              <div className="sim-out-hero-label">RUNWAY</div>
              <div className="sim-out-hero-num mono">{runway}d</div>
              <div className="sim-out-hero-sub">
                at {Math.round(effectiveVel)} units/day
                {sim.growth !== 0 && <span> ({sim.growth > 0 ? "+" : ""}{sim.growth}% growth)</span>}
              </div>
            </div>

            <div className="sim-out-stats">
              <div className="sim-out-stat">
                <div className="sim-out-stat-label">Producible FG</div>
                <div className="sim-out-stat-num mono">{D.fmtN(producibleFg)}</div>
                <div className="sim-out-stat-sub">min(Semi-FG, Packaging)</div>
              </div>
              <div className="sim-out-stat">
                <div className="sim-out-stat-label">Max FG today</div>
                <div className="sim-out-stat-num mono" style={{ color: "var(--brand-deep)" }}>{D.fmtN(maxFg)}</div>
                <div className="sim-out-stat-sub">FG + Producible</div>
              </div>
              <div className="sim-out-stat">
                <div className="sim-out-stat-label">Reorder by</div>
                <div className={"sim-out-stat-num mono" + (overdue ? " is-overdue" : "")}>
                  {overdue ? `Overdue by ${Math.abs(reorderByDays)}d` :
                    reorderByDays === 0 ? "Today" :
                    reorderByDays === 1 ? "Tomorrow" :
                    `In ${reorderByDays}d`}
                </div>
                <div className="sim-out-stat-sub">runway − lead time</div>
              </div>
              <div className="sim-out-stat">
                <div className="sim-out-stat-label">Bottleneck</div>
                <div className="sim-out-stat-num mono">{sim.semiFg <= sim.packaging ? "Semi-FG" : "Packaging"}</div>
                <div className="sim-out-stat-sub">the input that caps producible FG</div>
              </div>
            </div>

            <div className="sim-out-timeline">
              <RunwayTimeline runway={runway} leadTime={sim.leadTime} status={status}/>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

// Runway × Lead time infographic — single horizontal bar showing:
//   • Filled colored segment (0 → runway days) = "we have stock until here"
//   • Vertical marker at leadTime position = "must reorder by here"
//   • If marker sits past the bar end → reorder overdue (gap visible)
//   • If marker sits inside the bar → buffer days visible
// Scale per-row to max(runway, leadTime) × 1.2 so both fit comfortably.
const RunwayTimeline = ({ runway, leadTime, status }) => {
  const scale = Math.max(runway, leadTime, 14) * 1.25;
  const runwayPct = Math.max(2, (runway / scale) * 100);
  const leadPct = (leadTime / scale) * 100;
  const buffer = runway - leadTime;
  const overdue = buffer < 0;
  // Anchor labels AWAY from each other so they can't collide:
  //   • runway < lead  → runway label right-anchored, lead label left-anchored (gap between them)
  //   • runway > lead  → runway label left-anchored, lead label right-anchored
  //   • runway = lead  → labels merge (acceptable — they're at the same point)
  const runwayBeforeLead = runway < leadTime;
  const runwayAnchor = runwayBeforeLead
    ? { transform: "translateX(-100%)", paddingRight: "5px" }
    : { transform: "translateX(0)",     paddingLeft: "5px" };
  const leadAnchor = runwayBeforeLead
    ? { transform: "translateX(0)",     paddingLeft: "5px" }
    : { transform: "translateX(-100%)", paddingRight: "5px" };
  return (
    <div
      className={"rw-timeline rw-timeline-" + status}
      title={`${runway}d runway · ${leadTime}d lead time · ${overdue ? "overdue by" : "buffer"} ${Math.abs(buffer)}d`}
    >
      <div className="rw-timeline-track">
        <div className="rw-timeline-fill" style={{ width: runwayPct + "%" }}/>
        <div className="rw-timeline-marker" style={{ left: `clamp(0%, ${leadPct}%, 100%)` }}/>
      </div>
      <div className="rw-timeline-labels">
        <span
          className="rw-timeline-runway-label"
          style={{ left: `clamp(0%, ${runwayPct}%, 100%)`, ...runwayAnchor }}
        >
          <span className="mono">{runway}d</span> runway
        </span>
        <span
          className="rw-timeline-lead-label"
          style={{ left: `clamp(0%, ${leadPct}%, 100%)`, ...leadAnchor }}
        >
          <span className="mono">{leadTime}d</span> lead
        </span>
      </div>
    </div>
  );
};

// Per-row growth override input — uncontrolled, commits on Enter or blur.
// Keeps the typed value local until the user confirms; only then does the
// parent's perRowGrowth state update and the runway recalculate.
const CustomGrowthInput = ({ code, initial, isOverride, onCommit }) => {
  const [val, setVal] = useState(String(initial));
  // When the upstream "actual growth" changes (e.g. mode toggle), reset
  // the input to match unless the user is mid-edit and has a different value.
  useEffect(() => { setVal(String(initial)); }, [code, initial]);

  const commit = () => {
    const n = parseFloat(val);
    if (Number.isFinite(n)) onCommit(n);
  };
  return (
    <div className={"rw-growth-input-wrap" + (isOverride ? " is-override" : "")}>
      <input
        className="rw-growth-input mono"
        type="number"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); e.target.blur(); }
          if (e.key === "Escape") { e.preventDefault(); setVal(String(initial)); e.target.blur(); }
        }}
        onBlur={commit}
        step="any"
        min={-100}
        max={1000}
        title="Type a growth % (negative values allowed for projected slowdown) and press Enter"
      />
      <span className="rw-growth-pct">%</span>
    </div>
  );
};

const RunwayTab = ({ inventory: rawInventory }) => {
  const D = NSData;

  // Trajectory mode + per-row growth overrides — managed locally.
  // - In "current" mode: growth column shows each item's recent actual
  //   growth (read-only). Velocity uses base velocity.
  // - In "custom" mode: growth column becomes editable per-row. Each
  //   item's velocity = base × (1 + perRowGrowth / 100).
  const [mode, setMode] = useState("current");
  const [perRowGrowth, setPerRowGrowth] = useState({}); // { [code]: number }

  // Runway = MaxFG ÷ projected velocity, where projected velocity =
  // base velocity × (1 + MoM growth %). MoM growth represents the
  // observed month-over-month trend; applying it projects next month's
  // expected sales rate.
  //   • Current mode  → uses each item's actual MoM growth
  //   • Custom mode   → defaults to actual MoM; user can override per row
  // Toggling without overriding = identical numbers (no surprise jumps).
  const inventory = rawInventory.map(s => {
    const actualGrowth = s.growth ?? 0;
    const customGrowth = perRowGrowth[s.code] ?? actualGrowth;
    const effectiveGrowth = mode === "custom" ? customGrowth : actualGrowth;
    const baseVel = s.velocity;
    const vel = baseVel * (1 + effectiveGrowth / 100);
    const whFg = s.warehouseBreakdown?.fg ?? s.stock.warehouse;
    const producibleFg = s.warehouseBreakdown?.producibleFG ?? 0;
    const maxFg = whFg + producibleFg;
    const runway = vel > 0 ? Math.round(maxFg / vel) : 0;
    const status = runway <= s.leadTime ? "red" : runway < 30 ? "amber" : "green";
    return {
      ...s,
      adjRunway: runway,
      adjVelocity: Math.round(vel),
      adjStatus: status,
      whFg,
      producibleFg,
      maxFg,
      actualGrowth,
      effectiveGrowth,
    };
  });

  const reds = inventory.filter(s => s.adjStatus === "red");
  const ambers = inventory.filter(s => s.adjStatus === "amber");
  const greens = inventory.filter(s => s.adjStatus === "green");

  const [statusFilter, setStatusFilter] = useState("all"); // all | red | amber | green
  const [popoverSku, setPopoverSku] = useState(null);

  // Per-row growth input change handler
  const setGrowthFor = (code, val) => {
    setPerRowGrowth(prev => ({ ...prev, [code]: val }));
  };
  // Reset all overrides → back to actual growth
  const resetGrowth = () => setPerRowGrowth({});

  // Earliest reorder-by date across all at-risk SKUs (red + amber). The
  // tightest deadline tells the founder when they need to act next.
  const today = new Date();
  const reorderByDate = (s) => {
    // Reorder = stock runs out − lead time. If buffer < 0, already overdue.
    const buffer = s.adjRunway - s.leadTime;
    const d = new Date(today);
    d.setDate(d.getDate() + buffer);
    return { date: d, daysFromNow: buffer };
  };
  const atRisk = [...reds, ...ambers].map(s => ({ ...s, rb: reorderByDate(s) }));
  atRisk.sort((a, b) => a.rb.daysFromNow - b.rb.daysFromNow);
  const earliestReorder = atRisk[0] || null;

  // Risk summary metrics for the top stat cards.
  //   - First stockout: smallest adjRunway across all items
  //   - Inventory at risk value: sum of stock value across red items
  //   - Suppliers to contact: distinct supplier count for red items
  //   - Reorder units needed: rough sum of (lead time × velocity) − stock for red items
  const allSorted = [...inventory].sort((a, b) => a.adjRunway - b.adjRunway);
  const firstToStockout = allSorted[0];
  const stockValueAtRisk = reds.reduce((sum, s) => sum + (s.stockValue || 0), 0);
  const suppliersToContact = new Set(
    reds.flatMap(s => D.suppliers.filter(sup => sup.skus.includes(s.code)).map(sup => sup.id))
  ).size;
  const reorderUnitsNeeded = reds.reduce((sum, s) => {
    const projDemand = s.adjVelocity * (s.leadTime + 30);
    const shortfall = Math.max(0, projDemand - s.maxFg);
    return sum + shortfall;
  }, 0);

  // Filter for the main table
  const visible = inventory.filter(s => statusFilter === "all" || s.adjStatus === statusFilter);

  const fmtReorderDate = (rb) => {
    if (rb.daysFromNow < 0) return `Overdue by ${Math.abs(rb.daysFromNow)}d`;
    if (rb.daysFromNow === 0) return "Today";
    if (rb.daysFromNow === 1) return "Tomorrow";
    if (rb.daysFromNow <= 14) return `In ${rb.daysFromNow}d`;
    const opts = { month: "short", day: "numeric" };
    return rb.date.toLocaleDateString("en-US", opts);
  };

  return (
    <>
      {/* Risk summary — 4 stat cards covering different facets of urgency */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 12 }}>
        <Card title="Earliest reorder" sub="most urgent action">
          {earliestReorder ? (
            <>
              <div className={"stat-num lg " + (earliestReorder.adjStatus === "red" ? "rw-stat-crit" : "rw-stat-warn")}>
                {fmtReorderDate(earliestReorder.rb)}
              </div>
              <div className="muted" style={{ fontSize: 11.5 }}>
                {earliestReorder.name} · {earliestReorder.code}
              </div>
            </>
          ) : (
            <>
              <div className="stat-num lg" style={{ color: "var(--success)" }}>All clear</div>
              <div className="muted" style={{ fontSize: 11.5 }}>No items need reorder in 30d</div>
            </>
          )}
        </Card>
        <Card title="First stockout" sub="smallest runway right now">
          <div className="stat-num lg" style={{ color: firstToStockout?.adjStatus === "red" ? "var(--critical)" : firstToStockout?.adjStatus === "amber" ? "var(--warning)" : "var(--success)" }}>
            {firstToStockout?.adjRunway ?? 0}d
          </div>
          <div className="muted" style={{ fontSize: 11.5 }}>
            {firstToStockout ? `${firstToStockout.name} · runs out in ${firstToStockout.adjRunway}d` : "—"}
          </div>
        </Card>
        <Card title="Stock value at risk" sub="overdue items only">
          <div className="stat-num lg" style={{ color: stockValueAtRisk > 0 ? "var(--critical)" : "var(--success)" }}>
            {D.fmtINR(stockValueAtRisk)}
          </div>
          <div className="muted" style={{ fontSize: 11.5 }}>
            across {reds.length} overdue item{reds.length === 1 ? "" : "s"}
          </div>
        </Card>
        <Card title="Reorder volume needed" sub="to cover lead + 30d buffer">
          <div className="stat-num lg" style={{ color: reorderUnitsNeeded > 0 ? "var(--warning)" : "var(--ink-3)" }}>
            {D.fmtN(Math.round(reorderUnitsNeeded))}
          </div>
          <div className="muted" style={{ fontSize: 11.5 }}>
            units · {suppliersToContact} supplier{suppliersToContact === 1 ? "" : "s"} to contact
          </div>
        </Card>
      </div>

      {/* Filter + trajectory controls */}
      <Card style={{ marginBottom: 12 }}>
        <div className="runway-head">
          <div className="runway-filters" style={{ paddingTop: 0, borderTop: 0 }}>
            {[
              { id: "all",   label: "All",          count: inventory.length, cls: "" },
              { id: "red",   label: "Below lead",   count: reds.length,      cls: "crit" },
              { id: "amber", label: "Under 30d",    count: ambers.length,    cls: "warn" },
              { id: "green", label: "Healthy",      count: greens.length,    cls: "ok" },
            ].map(f => (
              <button
                key={f.id}
                className={"runway-chip " + f.cls + (statusFilter === f.id ? " active" : "")}
                onClick={() => setStatusFilter(f.id)}
              >
                <span className="runway-chip-label">{f.label}</span>
                <span className="runway-chip-count">{f.count}</span>
              </button>
            ))}
          </div>

          <div className="runway-controls">
            <div className="seg">
              <button className={mode === "current" ? "active" : ""} onClick={() => setMode("current")}>Current trajectory</button>
              <button className={mode === "custom" ? "active" : ""} onClick={() => setMode("custom")}>Custom trajectory</button>
            </div>
            {mode === "custom" && Object.keys(perRowGrowth).length > 0 && (
              <button className="btn sm ghost" onClick={resetGrowth} title="Reset all rows back to their actual growth rate">
                Reset all
              </button>
            )}
          </div>
        </div>
      </Card>

      <Card
        title="Runway by Item"
        sub={
          mode === "current"
            ? "Max FG ÷ (velocity × (1 + MoM growth %)). Growth column drives the projection."
            : "Max FG ÷ (velocity × (1 + Custom %)). Override any item's growth to stress-test runway."
        }
        padded={false}
      >
        <table className="table mat-table runway-table">
          <colgroup>
            <col className="rw-col-sku"/>
            <col className="rw-col-num"/>
            <col className="rw-col-num"/>
            <col className="rw-col-max"/>
            <col className="rw-col-num"/>
            <col className="rw-col-growth"/>
            {mode === "custom" && <col className="rw-col-growth"/>}
            <col className="rw-col-timeline"/>
            <col className="rw-col-reorder"/>
          </colgroup>
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">FG</th>
              <th className="num">Producible</th>
              <th className="num rw-h-max">Max FG</th>
              <th className="num">Velocity</th>
              <th className="num">Growth</th>
              {mode === "custom" && <th className="num rw-h-custom">Custom %</th>}
              <th className="rw-h-timeline">Runway × Lead time</th>
              <th className="num rw-h-action">Action needed</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={mode === "custom" ? 9 : 8}><div className="empty">No Items match this filter.</div></td></tr>
            ) : visible.map(s => {
              const rb = reorderByDate(s);
              const reorderText = fmtReorderDate(rb);
              const overdue = rb.daysFromNow < 0;
              const customVal = perRowGrowth[s.code] ?? s.actualGrowth;
              const isOverride = mode === "custom" && perRowGrowth[s.code] !== undefined && perRowGrowth[s.code] !== s.actualGrowth;
              return (
                <tr
                  key={s.code}
                  className={"row-clickable runway-row runway-row-" + s.adjStatus}
                  onClick={() => setPopoverSku(s)}
                >
                  <td className="mat-cell">
                    <div className="mat-cell-name">{s.name}</div>
                    <div className="sku">{s.code} · {s.variant}</div>
                  </td>
                  <td className="num mat-cell">
                    <div className="mat-cell-num">{D.fmtN(s.whFg)}</div>
                  </td>
                  <td className="num mat-cell">
                    <div className="mat-cell-num" style={{ color: "var(--success)" }}>{D.fmtN(s.producibleFg)}</div>
                  </td>
                  <td className="num mat-cell rw-cell-max">
                    <div className="mat-cell-num result max">{D.fmtN(s.maxFg)}</div>
                  </td>
                  <td className="num mat-cell">
                    <div className="mat-cell-num">{s.adjVelocity}</div>
                  </td>
                  <td className="num mat-cell rw-cell-growth">
                    <div className={"rw-growth-display mono " + (s.actualGrowth > 0 ? "up" : s.actualGrowth < 0 ? "down" : "flat")}>
                      {s.actualGrowth > 0 ? "+" : ""}{s.actualGrowth.toFixed(1)}%
                    </div>
                  </td>
                  {mode === "custom" && (
                    <td className="num mat-cell rw-cell-custom" onClick={e => e.stopPropagation()}>
                      <CustomGrowthInput
                        code={s.code}
                        initial={customVal}
                        isOverride={isOverride}
                        onCommit={(val) => setGrowthFor(s.code, val)}
                      />
                    </td>
                  )}
                  <td className="mat-cell rw-cell-timeline">
                    <RunwayTimeline
                      runway={s.adjRunway}
                      leadTime={s.leadTime}
                      status={s.adjStatus}
                    />
                  </td>
                  <td className="mat-cell rw-cell-action">
                    <div className="rw-action-stack">
                      <div className={"runway-reorder" + (overdue ? " is-overdue" : "")}>
                        {reorderText}
                      </div>
                      {s.adjStatus === "red"
                        ? <span className="rw-action-flag rw-action-flag-crit">Reorder now</span>
                        : s.adjStatus === "amber"
                          ? <span className="rw-action-flag rw-action-flag-warn">Schedule PO</span>
                          : <span className="muted" style={{ fontSize: 11 }}>—</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {popoverSku && (
        <SkuBreakdownModal sku={popoverSku} onClose={() => setPopoverSku(null)}/>
      )}
    </>
  );
};

const ForecastTab = ({ inventory, days, setDays }) => {
  const D = NSData;

  // Per-item forecast math (same logic used in table below — pre-computed
  // here so the summary cards can aggregate across the portfolio).
  const trendForIdx = (idx) =>
    [1.18, 0.94, 1.22, 1.06, 1.32, 0.98, 1.45, 0.82, 1.12, 0.66, 1.08, 1.18, 1.04, 0.92][idx] || 1;
  const rows = inventory.map((s, i) => {
    const trend = trendForIdx(i);
    const forecast = Math.round(s.velocity * days * trend);
    const required = Math.round(s.velocity * (days + 30) * trend);
    const reorder = Math.max(0, required - s.totalStock);
    return { ...s, trend, forecast, required, reorder, trendPct: (trend - 1) * 100 };
  });

  // Summary metrics shown as cards at the top of the tab.
  //   Underperforming  = trend < -5% (sales declining materially)
  //   Overperforming   = trend > +20% (strong growth — may need more stock)
  //   At-risk          = current stock < forecast (won't meet projected demand)
  //   Total demand     = sum of forecast units
  //   Total reorder    = sum of recommended reorder
  const underperforming = rows.filter(r => r.trendPct < -5).length;
  const overperforming = rows.filter(r => r.trendPct > 20).length;
  const atRisk = rows.filter(r => r.totalStock < r.forecast).length;
  const totalDemand = rows.reduce((a, r) => a + r.forecast, 0);
  const totalReorder = rows.reduce((a, r) => a + r.reorder, 0);

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 14 }}>
        <Card title={`Projected demand · ${days}d`} sub="across all SKUs">
          <div className="stat-num lg">{D.fmtN(totalDemand)}</div>
          <div className="muted" style={{ fontSize: 11.5 }}>units to ship over next {days} days</div>
        </Card>
        <Card title="At-risk SKUs" sub="current stock < forecast demand">
          <div className="stat-num lg" style={{ color: atRisk > 0 ? "var(--critical)" : "var(--success)" }}>
            {atRisk}
          </div>
          <div className="muted" style={{ fontSize: 11.5 }}>
            of {rows.length} won't meet projected demand
          </div>
        </Card>
        <Card title="Underperforming SKUs" sub="trend < −5% (sales declining)">
          <div className="stat-num lg" style={{ color: underperforming > 0 ? "var(--warning)" : "var(--success)" }}>
            {underperforming}
          </div>
          <div className="muted" style={{ fontSize: 11.5 }}>
            {overperforming > 0 && <>· {overperforming} overperforming (&gt;+20%)</>}
          </div>
        </Card>
        <Card title="Recommended reorder" sub={`to cover ${days}d + 30d buffer`}>
          <div className="stat-num lg" style={{ color: totalReorder > 0 ? "var(--warning)" : "var(--ink-3)" }}>
            {D.fmtN(totalReorder)}
          </div>
          <div className="muted" style={{ fontSize: 11.5 }}>units across all suppliers</div>
        </Card>
      </div>

      <Card title="Demand forecast" sub={`Per SKU · projected ${days}-day demand`}
        action={
          <div className="seg">
            {[30, 60, 90].map(d => (
              <button key={d} className={days === d ? "active" : ""} onClick={() => setDays(d)}>{d} days</button>
            ))}
          </div>
        } padded={false}>
        <table className="table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">Velocity /d</th>
              <th className="num">Trend</th>
              <th className="num">Forecast ({days}d)</th>
              <th className="num">Current stock</th>
              <th className="num">Required (with 30d buffer)</th>
              <th className="num">Recommended reorder</th>
              <th>Supplier</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(s => {
              const supplier = D.suppliers.find(sup => sup.skus.includes(s.code))?.name || "—";
              return (
                <tr key={s.code}>
                  <td>
                    <span>{s.name}</span>
                    <div className="sku">{s.code}</div>
                  </td>
                  <td className="num">{s.velocity}</td>
                  <td className="num">
                    <Delta value={s.trendPct}/>
                  </td>
                  <td className="num">{D.fmtN(s.forecast)}</td>
                  <td className="num">{D.fmtN(s.totalStock)}</td>
                  <td className="num">{D.fmtN(s.required)}</td>
                  <td className="num">
                    {s.reorder > 0
                      ? <span className="mono" style={{ color: s.reorder > s.totalStock ? "var(--critical)" : "var(--warning)", fontWeight: 500 }}>{D.fmtN(s.reorder)}</span>
                      : <span className="muted">—</span>}
                  </td>
                  <td className="muted" style={{ fontSize: 11.5 }}>{supplier}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
};

const BatchesTab = ({ batches }) => {
  const D = NSData;
  const months = ["Jun '26", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan '27", "Feb", "Mar", "Apr", "May"];

  // pin batches to months
  const monthMap = { "Jun 2026": 0, "Jul 2026": 1, "Aug 2026": 2, "Sep 2026": 3, "Oct 2026": 4, "Nov 2026": 5, "Dec 2026": 6, "Jan 2027": 7, "Feb 2027": 8, "Mar 2027": 9, "Apr 2027": 10, "May 2027": 11 };

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 14 }}>
        <Card title="Batches at risk · 60d">
          <div className="stat-num lg" style={{ color: "var(--critical)" }}>2</div>
          <div className="muted" style={{ fontSize: 11.5 }}>2,760 units · {D.fmtINR(720000)} exposure</div>
        </Card>
        <Card title="At risk · 60–120d">
          <div className="stat-num lg" style={{ color: "var(--warning)" }}>2</div>
          <div className="muted" style={{ fontSize: 11.5 }}>1,550 units</div>
        </Card>
        <Card title="Healthy batches">
          <div className="stat-num lg" style={{ color: "var(--success)" }}>5</div>
          <div className="muted" style={{ fontSize: 11.5 }}>Will sell through at current velocity</div>
        </Card>
      </div>

      <Card title="Expiry timeline" sub="Each bar is a batch · width represents months to expiry · red = write-off risk" padded={false} style={{ marginBottom: 14 }}>
        <div style={{ padding: "10px 14px 0", display: "grid", gridTemplateColumns: "220px 1fr", borderBottom: "1px solid var(--border-soft)" }}>
          <div className="stat-label" style={{ padding: "6px 0" }}>Batch</div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${months.length}, 1fr)`, paddingBottom: 6 }}>
            {months.map((m, i) => (
              <div key={i} style={{ fontSize: 10, color: "var(--ink-3)", textAlign: "center", borderLeft: "1px solid var(--border-soft)" }}>
                {m}
              </div>
            ))}
          </div>
        </div>
        <div>
          {batches.map(b => {
            const colIdx = monthMap[b.exp] ?? 8;
            return (
              <div key={b.id} style={{ display: "grid", gridTemplateColumns: "220px 1fr", borderBottom: "1px solid var(--border-soft)" }}>
                <div style={{ padding: "10px 14px" }}>
                  <div className="mono" style={{ fontSize: 11.5 }}>{b.id}</div>
                  <div className="muted" style={{ fontSize: 10.5 }}>{b.sku} · {b.units} units · {b.loc}</div>
                </div>
                <div style={{ position: "relative", display: "grid", gridTemplateColumns: `repeat(${months.length}, 1fr)` }}>
                  {months.map((m, i) => (
                    <div key={i} style={{ borderLeft: "1px solid var(--border-soft)", height: 36 }}/>
                  ))}
                  <div style={{
                    position: "absolute", top: 11, left: 0,
                    width: `calc(${((colIdx + 0.5) / months.length) * 100}% - 12px)`,
                    height: 14, borderRadius: 3,
                    background: b.risk === "red" ? "var(--critical)" : b.risk === "amber" ? "var(--warning)" : "var(--success)",
                    display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "0 6px",
                    color: "white", fontSize: 10, fontFamily: "var(--mono)",
                  }}>
                    exp {b.exp}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="All active batches" padded={false}>
        <table className="table">
          <thead>
            <tr>
              <th>Batch ID</th>
              <th>Item</th>
              <th>Manufacture</th>
              <th>Expiry</th>
              <th className="num">Units remaining</th>
              <th>Location</th>
              <th>Risk</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {batches.map(b => (
              <tr key={b.id}>
                <td className="sku">{b.id}</td>
                <td className="sku">{b.sku}</td>
                <td>{b.mfg}</td>
                <td>{b.exp}</td>
                <td className="num">{D.fmtN(b.units)}</td>
                <td>{b.loc}</td>
                <td>
                  <span className={"badge dot " + (b.risk === "red" ? "red" : b.risk === "amber" ? "amber" : "green")}>
                    {b.risk === "red" ? "Write-off risk" : b.risk === "amber" ? "At risk" : "Healthy"}
                  </span>
                </td>
                <td>
                  {b.risk === "red" ? <button className="btn sm primary">Flash sale</button> :
                   b.risk === "amber" ? <button className="btn sm">Push to channels</button> :
                   <span className="muted" style={{ fontSize: 11.5 }}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
};

const ReturnsTab = () => {
  const D = NSData;
  const returns = [
    { id: "RET-2026-2841", sku: "NS-WHT-CHO-1K", channel: "amazon", qty: 1, status: "Inspected · OK", action: "Restock", date: "May 20" },
    { id: "RET-2026-2840", sku: "NS-PRO-VEG-1K", channel: "shopify",qty: 1, status: "Inspected · Defect", action: "Write off", date: "May 20" },
    { id: "RET-2026-2839", sku: "NS-MUL-WMN-60",channel: "flipkart",qty: 2, status: "Pending inspection", action: "—", date: "May 20" },
    { id: "RET-2026-2838", sku: "NS-COL-PEP-250",channel: "amazon", qty: 1, status: "Inspected · Damaged seal", action: "Write off", date: "May 19" },
    { id: "RET-2026-2837", sku: "NS-OMG-3-90",   channel: "amazon", qty: 1, status: "Restocked", action: "Done", date: "May 19" },
    { id: "RET-2026-2836", sku: "NS-BIO-HAIR-60",channel: "blinkit",qty: 1, status: "Restocked", action: "Done", date: "May 18" },
    { id: "RET-2026-2835", sku: "NS-PRO-VEG-1K",channel: "amazon", qty: 1, status: "Pending inspection", action: "—", date: "May 18" },
    { id: "RET-2026-2834", sku: "NS-WHT-VAN-1K",channel: "shopify",qty: 1, status: "Restocked", action: "Done", date: "May 17" },
  ];

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 14 }}>
        <Card title="Returns this month"><div className="stat-num lg">142</div><div className="muted" style={{ fontSize: 11.5 }}>units · 2.6% blended rate</div></Card>
        <Card title="Pending inspection"><div className="stat-num lg" style={{ color: "var(--warning)" }}>24</div><div className="muted" style={{ fontSize: 11.5 }}>queued at warehouse</div></Card>
        <Card title="Restocked this month"><div className="stat-num lg" style={{ color: "var(--success)" }}>96</div><div className="muted" style={{ fontSize: 11.5 }}>units back to inventory</div></Card>
        <Card title="Written off"><div className="stat-num lg" style={{ color: "var(--critical)" }}>22</div><div className="muted" style={{ fontSize: 11.5 }}>units · {D.fmtINR(38000)} P&L impact</div></Card>
      </div>

      <Card title="Recent returns" sub="Returned → Inspected → Restocked or Written off" padded={false}>
        <table className="table">
          <thead>
            <tr>
              <th>Return ID</th><th>Item</th><th>Channel</th><th className="num">Qty</th><th>Status</th><th>Action</th><th>Received</th><th></th>
            </tr>
          </thead>
          <tbody>
            {returns.map(r => (
              <tr key={r.id}>
                <td className="sku">{r.id}</td>
                <td className="sku">{r.sku}</td>
                <td>{D.channels.find(c => c.id === r.channel)?.name}</td>
                <td className="num">{r.qty}</td>
                <td>{r.status}</td>
                <td>{r.action === "Done" ? <span className="badge green">Done</span> : r.action === "—" ? <span className="muted">—</span> : <span className="badge amber">{r.action}</span>}</td>
                <td className="muted">{r.date}</td>
                <td>
                  {r.status === "Pending inspection" ?
                    <button className="btn sm">Inspect</button> :
                    r.action === "Restock" ?
                    <button className="btn sm primary">Confirm restock</button> :
                    null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
};


export default PageInventory;
