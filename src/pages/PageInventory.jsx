import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Icon, Delta, Card, Sparkline, BarChart, Progress, ChannelPill } from "../components/Shared.jsx";
import NSData from "../data.js";
import { UploadModal, DataAsOfPill } from "../components/UploadModal.jsx";
import { useLiveData } from "../contexts/LiveDataContext.jsx";
import { applyLiveData } from "../lib/liveInventory.js";
import { computeCascade } from "../lib/runwayCascade.js";

// Module 3 — Inventory & Supply Chain
// Sub-routes: /inventory/{unified|runway|forecast|batches|returns}

const VALID_TABS = ["unified", "materials", "runway", "simulator", "forecast", "catalog", "batches", "returns"];

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

  // Live data: read the most recent uploaded MIS sheet from context and
  // overlay it onto the synth inventory. When no upload exists, everything
  // falls through to the sample data. Memoised to avoid re-computing the
  // merged list every render.
  const { live } = useLiveData();
  const liveInventory = useMemo(
    () => applyLiveData(D.inventory, live),
    [D.inventory, live]
  );
  // Shallow override so all child tabs see the merged inventory without
  // each one having to import the merger separately.
  const dataForTabs = useMemo(
    () => ({ ...D, inventory: liveInventory }),
    [D, liveInventory]
  );

  const [uploadOpen, setUploadOpen] = useState(false);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">Inventory & Supply Chain</div>
          <div className="page-sub">Unified stock · runway · batch & expiry · reorder logic</div>
        </div>
        <div className="actions">
          <DataAsOfPill onClick={() => setUploadOpen(true)}/>
          <button className="btn" onClick={() => setUploadOpen(true)}>
            <Icon name="download" size={13}/>Upload MIS
          </button>
          <button className="btn"><Icon name="refresh" size={13}/>Sync central warehouse</button>
          <button className="btn primary"><Icon name="plus" size={13}/>Place PO</button>
        </div>
      </div>

      {uploadOpen && <UploadModal onClose={() => setUploadOpen(false)}/>}

      <div className="tabs">
        <button className={tab === "unified" ? "active" : ""} onClick={() => setTab("unified")}>Unified stock</button>
        <button className={tab === "materials" ? "active" : ""} onClick={() => setTab("materials")}>Materials breakdown</button>
        <button className={tab === "runway" ? "active" : ""} onClick={() => setTab("runway")}>Runway calculator</button>
        <button className={tab === "simulator" ? "active" : ""} onClick={() => setTab("simulator")}>Simulator</button>
        <button className={tab === "forecast" ? "active" : ""} onClick={() => setTab("forecast")}>Demand forecast</button>
        <button className={tab === "catalog" ? "active" : ""} onClick={() => setTab("catalog")}>SKU catalog</button>
        <button className={tab === "batches" ? "active" : ""} onClick={() => setTab("batches")}>Batches & expiry</button>
        <button className={tab === "returns" ? "active" : ""} onClick={() => setTab("returns")}>Returns restocking</button>
      </div>

      {tab === "unified" && <UnifiedStockTab inventory={liveInventory}/>}
      {tab === "materials" && <MaterialsTab inventory={liveInventory}/>}
      {tab === "runway" && <RunwayTab inventory={liveInventory}/>}
      {tab === "simulator" && <SimulatorTab inventory={liveInventory}/>}
      {tab === "forecast" && (
        <ForecastTab inventory={liveInventory} days={forecastDays} setDays={setForecastDays}/>
      )}
      {tab === "catalog" && <CatalogTab inventory={liveInventory}/>}
      {tab === "batches"  && <SubtabPreviewGate label="Batches & expiry"><BatchesTab batches={D.batches}/></SubtabPreviewGate>}
      {tab === "returns"  && <SubtabPreviewGate label="Returns restocking"><ReturnsTab/></SubtabPreviewGate>}
    </div>
  );
};

// ── PlatformCell — one channel's stock + runway + velocity + growth stack ──
// Used inside the Unified Stock table for every location column. Renders:
//   1. Units on hand (hero) — with an optional inline breakdown caption to
//      the LEFT (warehouse cell uses this to expose its FG + Producible
//      composition without adding a third row that would misalign the cell
//      against the simpler marketplace cells).
//   2. Runway pill + per-channel velocity + MoM growth chip (when velocity > 0)
// Runway color tier: <14d red, <30d amber, otherwise neutral.
const PlatformCell = ({ units, breakdown, breakdownLabel, velocity, growth }) => {
  const D = NSData;
  const hasVel = velocity != null && velocity > 0;
  const runway = hasVel ? Math.round(units / velocity) : null;
  const tier = runway == null ? "" : runway < 14 ? " crit" : runway < 30 ? " warn" : "";
  return (
    <div className="pf-cell">
      <div className="pf-cell-units-row">
        {breakdown && (
          <span className="pf-cell-bd-inline" title={breakdownLabel}>{breakdown}</span>
        )}
        <div className="pf-cell-units mono">{units != null ? D.fmtN(units) : "—"}</div>
      </div>
      {hasVel && (
        <div className="pf-cell-meta">
          <span className={"pf-cell-runway" + tier}>{runway}d</span>
          <span className="pf-cell-vel mono">{velocity.toFixed(1)}/d</span>
          {growth != null && (
            <span className="pf-cell-growth">
              <Delta value={growth} hideArrow/>
            </span>
          )}
        </div>
      )}
    </div>
  );
};

const UnifiedStockTab = ({ inventory }) => {
  const D = NSData;
  const { live } = useLiveData();
  // Format the "data as of" line for the stock-meta strip.
  // Prefers the date the sheet itself says it represents; falls back to
  // upload timestamp; finally to a placeholder when no upload exists.
  const dataAsOfLabel = live
    ? (live.dataAsOf || new Date(live.uploadedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }))
    : "sample data";
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

  // Top mover — the SKU with the highest sell-through velocity. Tie-breaker
  // by stock value so we surface the bigger revenue contributor when two
  // SKUs have the same per-day rate.
  const topMover = [...inventory].sort((a, b) => {
    if (b.velocity !== a.velocity) return b.velocity - a.velocity;
    return (b.stockValue || 0) - (a.stockValue || 0);
  })[0];
  const topMoverRev = topMover
    ? Math.round((topMover.velocity * 30) * ((topMover.stockValue || 0) / Math.max(1, topMover.totalStock || 1)))
    : 0;

  // Clicking any SKU row opens the breakdown popover.
  const [popoverSku, setPopoverSku] = useState(null);
  const navigate = useNavigate();

  // ── Filter state ────────────────────────────────────────────
  // searchText: free-text filter on SKU name / code / variant
  // statusFilter: Set of runway statuses to include; empty = show all
  // statusOpen: dropdown visibility
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState(new Set()); // {} = all visible
  const [statusOpen, setStatusOpen] = useState(false);
  const statusRef = useRef(null);
  useEffect(() => {
    const onDoc = (e) => { if (statusRef.current && !statusRef.current.contains(e.target)) setStatusOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const toggleStatus = (status) => {
    setStatusFilter(prev => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  // Apply both filters: matches the search query AND (if any statuses are
  // selected) has one of the selected statuses.
  const q = searchText.trim().toLowerCase();
  const filteredInventory = inventory.filter(s => {
    const matchesSearch = !q
      || s.name.toLowerCase().includes(q)
      || s.code.toLowerCase().includes(q)
      || (s.variant || "").toLowerCase().includes(q);
    const matchesStatus = statusFilter.size === 0 || statusFilter.has(s.runwayStatus);
    return matchesSearch && matchesStatus;
  });

  // Status counts for the dropdown row labels (across the unfiltered set so
  // the user can see all available options regardless of current filter).
  const statusCounts = {
    red:   inventory.filter(s => s.runwayStatus === "red").length,
    amber: inventory.filter(s => s.runwayStatus === "amber").length,
    green: inventory.filter(s => s.runwayStatus === "green").length,
  };

  return (
    <>
      {/* Top stat row — same .rw-risk-card family as Runway + Forecast tabs
          so all three live tabs feel like one product. Three cards covering
          scale (value), threats (alerts), and concentration (top mover) so
          the founder can answer "how much / what's burning / where's the
          volume" in one glance. */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 14 }}>
        {/* 1. Total stock value — neutral hero, brand-green tint */}
        <div className="rw-risk-card ok">
          <div className="rw-risk-head">
            <span className="rw-risk-icon"><Icon name="finance" size={14}/></span>
            <div>
              <div className="rw-risk-title">Total stock value</div>
              <div className="rw-risk-sub">central warehouse FG, valued at unit cost</div>
            </div>
          </div>
          <div className="rw-risk-num" style={{ color: "var(--ink)" }}>{D.fmtINR(warehouseStockValue)}</div>
          <div className="stock-meta">
            <div className="stock-meta-item">
              <div className="stock-meta-num mono">{D.fmtN(warehouseUnits)}</div>
              <div className="stock-meta-label">FG units · central warehouse</div>
            </div>
            <div className="stock-meta-divider"/>
            <div className="stock-meta-item">
              <div className="stock-meta-num mono">{activeSkus}</div>
              <div className="stock-meta-label">active Items</div>
            </div>
            <div className="stock-meta-divider"/>
            <div className="stock-meta-item">
              <div className="stock-meta-num mono" style={{ fontSize: 13 }}>{dataAsOfLabel}</div>
              <div className="stock-meta-label">{live ? "data as of" : "last MIS sync"}</div>
            </div>
          </div>
        </div>

        {/* 2. Stock alerts — crit when items are running out, ok otherwise */}
        <div className={"rw-risk-card " + (hasCriticalAlerts ? "crit" : "ok")}>
          <div className="rw-risk-head">
            <span className="rw-risk-icon"><Icon name="alerts" size={14}/></span>
            <div>
              <div className="rw-risk-title">Stock alerts</div>
              <div className="rw-risk-sub">
                {hasCriticalAlerts
                  ? "runway ≤ supplier lead time"
                  : "all Items above lead-time floor"}
              </div>
            </div>
            <button
              className="btn sm ghost"
              onClick={(e) => { e.stopPropagation(); navigate("/inventory/runway"); }}
              title="Open Runway calculator"
              style={{ marginLeft: "auto", flexShrink: 0 }}
            >
              View runway <Icon name="arrowRight" size={11}/>
            </button>
          </div>
          <div className="rw-risk-num" style={{ color: hasCriticalAlerts ? "var(--critical)" : "var(--success)" }}>
            {skusRunningOut}
          </div>
          <div className="rw-risk-detail">
            <strong>{skusRunningOut === 1 ? "Item" : "Items"}</strong> running out
            <span className="muted"> · {materialsToReorder} material{materialsToReorder === 1 ? "" : "s"} need reordering (&lt; 30d coverage)</span>
          </div>
        </div>

        {/* 3. Top mover — where the volume is concentrated. Hero shows the
            daily sell-through; detail names the SKU + monthly contribution. */}
        <div className="rw-risk-card ok">
          <div className="rw-risk-head">
            <span className="rw-risk-icon"><Icon name="up" size={14}/></span>
            <div>
              <div className="rw-risk-title">Top mover</div>
              <div className="rw-risk-sub">highest sell-through right now</div>
            </div>
          </div>
          <div className="rw-risk-num" style={{ color: "var(--success)" }}>
            {topMover ? `${topMover.velocity}/d` : "—"}
          </div>
          <div className="rw-risk-detail">
            {topMover
              ? <><strong>{topMover.name}</strong> {topMover.variant} <span className="muted">· {topMover.code} · ~{D.fmtINR(topMoverRev)}/mo</span></>
              : "no data"}
          </div>
        </div>

      </div>

      <Card
        title="Inventory by Item × location"
        sub="Source: central warehouse MIS sheet (live). Click any Item for the full material breakdown."
        padded={false}
        action={
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              className="txt sm"
              placeholder="Filter Item…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{ width: 160, height: 24, padding: "2px 9px", fontSize: 11.5 }}
            />
            {/* Status dropdown — multi-select filter on runway status. Counts
                next to each row are the totals in the underlying inventory
                (not the post-filter result) so the user can see how many
                items fall into each bucket regardless of current selection. */}
            <div style={{ position: "relative" }} ref={statusRef}>
              <button
                className={"btn sm" + (statusFilter.size > 0 ? " is-active" : "")}
                onClick={() => setStatusOpen(o => !o)}
              >
                <Icon name="filter" size={12}/>
                Status
                {statusFilter.size > 0 && (
                  <span className="us-filter-chip-count">{statusFilter.size}</span>
                )}
              </button>
              {statusOpen && (
                <div className="us-status-menu">
                  <div className="us-status-menu-head">
                    <span className="us-status-menu-title">Filter by runway status</span>
                    {statusFilter.size > 0 && (
                      <button
                        className="us-status-menu-clear"
                        onClick={() => setStatusFilter(new Set())}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  {[
                    { key: "red",   label: "Critical",  hint: "runway ≤ lead time",  cls: "crit" },
                    { key: "amber", label: "Watch",     hint: "< 30d cover",         cls: "warn" },
                    { key: "green", label: "Healthy",   hint: "above lead + 30d",    cls: "ok"   },
                  ].map(opt => {
                    const checked = statusFilter.has(opt.key);
                    return (
                      <label key={opt.key} className={"us-status-menu-row " + opt.cls + (checked ? " is-checked" : "")}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleStatus(opt.key)}
                        />
                        <span className={"us-status-menu-dot " + opt.cls}/>
                        <div className="us-status-menu-text">
                          <div className="us-status-menu-label">{opt.label}</div>
                          <div className="us-status-menu-hint">{opt.hint}</div>
                        </div>
                        <span className="us-status-menu-count">{statusCounts[opt.key]}</span>
                      </label>
                    );
                  })}
                  {statusFilter.size > 0 && (
                    <div className="us-status-menu-foot muted">
                      Showing {filteredInventory.length} of {inventory.length} Items
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        }>
        <table className="table mat-table us-table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">Central warehouse</th>
              <th className="num">Amazon FBA<span className="footnote-ref">*</span></th>
              <th className="num">Flipkart<span className="footnote-ref">*</span></th>
              <th className="num">Blinkit<span className="footnote-ref">*</span></th>
              <th className="num">Stock value</th>
            </tr>
          </thead>
          <tbody>
            {filteredInventory.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <div className="empty">
                    No Items match your filter.{" "}
                    {(searchText || statusFilter.size > 0) && (
                      <button
                        className="link-btn"
                        onClick={() => { setSearchText(""); setStatusFilter(new Set()); }}
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : filteredInventory.map(s => {
              // Warehouse hero number = Max FG (current FG + Producible FG).
              const fg          = s.warehouseBreakdown?.fg ?? s.stock.warehouse;
              const producible  = s.warehouseBreakdown?.producibleFG ?? 0;
              const maxFg       = fg + producible;

              // Per-channel velocity = total velocity × that channel's revenue
              // share. Shopify share approximates the warehouse channel (D2C
              // ships from warehouse). Synthesised — replace once per-channel
              // sales data is wired in.
              const sp = s.splits || {};
              const revTotal = (sp.amazon || 0) + (sp.shopify || 0) + (sp.flipkart || 0) + (sp.blinkit || 0) || 1;
              // Per AMZ-001: Amazon channel velocity = amazon orders +
              // shopify orders (Shopify ships from Amazon FBA). Warehouse
              // velocity = whatever isn't claimed by a marketplace.
              const amazonOwnVel  = s.velocity * ((sp.amazon  || 0) / revTotal);
              const shopifyOwnVel = s.velocity * ((sp.shopify || 0) / revTotal);
              const vel = {
                amazonFBA: amazonOwnVel + shopifyOwnVel,
                flipkart:  s.velocity * ((sp.flipkart || 0) / revTotal),
                blinkit:   s.velocity * ((sp.blinkit  || 0) / revTotal),
                warehouse: Math.max(0, s.velocity - amazonOwnVel - shopifyOwnVel
                            - s.velocity * ((sp.flipkart || 0) / revTotal)
                            - s.velocity * ((sp.blinkit  || 0) / revTotal)),
              };

              return (
                <tr key={s.code} className="row-clickable" onClick={() => setPopoverSku(s)}>
                  <td className="mat-cell">
                    <div className="mat-cell-name">{s.name}</div>
                    <div className="sku">{s.code} · {s.variant}</div>
                  </td>
                  <td className="num mat-cell">
                    <PlatformCell
                      units={maxFg}
                      breakdown={
                        <>
                          <span className="pf-cell-bd-num">{D.fmtN(fg)}</span>
                          <span className="pf-cell-bd-op">+</span>
                          <span className="pf-cell-bd-num">{D.fmtN(producible)}</span>
                          <span className="pf-cell-bd-tag">producible</span>
                        </>
                      }
                      breakdownLabel={`Total (WH) ${D.fmtN(maxFg)} = Produced FG ${D.fmtN(fg)} + Producible FG ${D.fmtN(producible)}`}
                      velocity={vel.warehouse}
                      growth={s.growth}
                    />
                  </td>
                  <td className="num mat-cell">
                    <PlatformCell
                      units={s.stock.amazonFBA}
                      velocity={vel.amazonFBA}
                      growth={s.growth}
                      breakdown={
                        <>
                          <span className="pf-cell-bd-num mono">{amazonOwnVel.toFixed(1)}</span>
                          <span className="pf-cell-bd-tag">amz</span>
                          <span className="pf-cell-bd-op">+</span>
                          <span className="pf-cell-bd-num mono">{shopifyOwnVel.toFixed(1)}</span>
                          <span className="pf-cell-bd-tag">d2c</span>
                        </>
                      }
                      breakdownLabel={`Amazon FBA serves both Amazon orders (${amazonOwnVel.toFixed(1)}/d) + Shopify D2C (${shopifyOwnVel.toFixed(1)}/d)`}
                    />
                  </td>
                  <td className="num mat-cell">
                    <PlatformCell units={s.stock.flipkart} velocity={vel.flipkart} growth={s.growth}/>
                  </td>
                  <td className="num mat-cell">
                    <PlatformCell units={s.stock.blinkit} velocity={vel.blinkit} growth={s.growth}/>
                  </td>
                  <td className="num mat-cell">
                    <div className="mat-cell-num">{D.fmtINR(s.stock.warehouse * unitCost(s))}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="table-footnote">
          <span className="footnote-ref">*</span>
          <span>
            Amazon FBA, Flipkart and Blinkit numbers are placeholders. Per-channel velocity
            is currently estimated from the SKU's 30-day revenue mix and growth is mirrored
            from the SKU's overall MoM — once each marketplace integration is wired up, these
            values will be replaced with the real per-channel figures. For the FG / Semi-FG /
            Raw / Packaging split, click any Item row or {" "}
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
  // Bottleneck identification under the new "one input + multi-pkg" model:
  //   - kind="semi" → bottleneck candidates: SFG vs each PKG (min capacity)
  //   - kind="raw"  → bottleneck candidates: RM  vs each PKG (min capacity)
  // The bottleneck label shown in the table is the role tag ("SFG" / "RM"
  // / "PKG") of whichever capacity is the binding constraint.
  const rows = inventory.map(s => {
    const wb = s.warehouseBreakdown || { fg: 0, semiFg: 0, rawMaterial: 0, packaging: 0, producibleFG: 0, kind: null, inputs: { sfg: null, rm: null, pkg: [] } };
    const inputObj = wb.inputs?.sfg || wb.inputs?.rm;
    const inputCap = inputObj?.capacity ?? Infinity;
    const pkgList  = wb.inputs?.pkg || [];
    const pkgMinCap = pkgList.length ? Math.min(...pkgList.map(p => p.capacity)) : Infinity;
    let bottleneck = "—";
    if (inputObj && inputCap <= pkgMinCap) {
      bottleneck = wb.kind === "semi" ? "SFG" : "RM";
    } else if (pkgList.length) {
      // Identify which specific PKG component is the binding constraint
      const minIdx = pkgList.findIndex(p => p.capacity === pkgMinCap);
      bottleneck = `PKG${minIdx + 1}`;
    }
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
              <option value="fg">Produced FG (high → low)</option>
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
              <th className="num mat-h" style={{ color: MATERIAL_COLORS.fg }}>Produced FG</th>
              <th className="num mat-h" style={{ color: MATERIAL_COLORS.semiFg }}>Semi-FG</th>
              <th className="num mat-h" style={{ color: MATERIAL_COLORS.rawMaterial }}>Raw</th>
              <th className="num mat-h" style={{ color: MATERIAL_COLORS.packaging }}>Packaging</th>
              <th className="mat-h-bn">Bottleneck</th>
              <th className="num mat-h-result">Producible FG</th>
              <th className="num mat-h-result mat-h-max" title="Total (WH) = Produced FG + Producible FG — the total finished goods we could have in the central warehouse today">
                Total (WH) <span className="mat-h-formula mono">Produced + Producible</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(s => {
              const usesSemi = s.wb.kind === "semi";
              const usesRaw  = s.wb.kind === "raw";
              const bnSemi   = usesSemi && s.bottleneck === "SFG";
              const bnRaw    = usesRaw  && s.bottleneck === "RM";
              const bnPack   = s.bottleneck.startsWith("PKG");
              const rwFg     = runwayFor("fg", s);
              const rwSemi   = usesSemi ? runwayFor("semiFg", s) : null;
              const rwRaw    = usesRaw  ? runwayFor("rawMaterial", s) : null;
              const rwPkg    = runwayFor("packaging", s);
              const rwBest   = runwayFor("producibleFG", s);
              // Max FG = current packed FG + what we could additionally pack today.
              const maxFG = s.wb.fg + s.wb.producibleFG;
              const rwMax = s.velocity ? (() => {
                const days = maxFG / s.velocity;
                const status = days < 14 ? "red" : days < 30 ? "amber" : "muted";
                const label = days >= 60 ? `~${(days / 30).toFixed(1)}mo` : `~${Math.round(days)}d`;
                return { days, status, label };
              })() : null;
              const pkgCount = (s.wb.inputs?.pkg || []).length;

              // Every numeric cell shares the same structure: number on top,
              // optional runway chip below. Pass `bn` to flag a bottleneck cell
              // (gets amber tint + accent border via the .mat-cell-bn class).
              const numCell = (value, rw, isBn) => (
                <td className={"num mat-cell" + (isBn ? " mat-cell-bn" : "")}>
                  <div className="mat-cell-num">{D.fmtN(value)}</div>
                  {rw && <RunwayChip rw={rw}/>}
                </td>
              );
              // N/A cell — for the SFG/RM column the SKU doesn't use.
              const naCell = () => (
                <td className="num mat-cell mat-cell-na">
                  <div className="mat-cell-num muted">N/A</div>
                </td>
              );

              return (
                <tr key={s.code} className="row-clickable" onClick={() => setPopoverSku(s)}>
                  <td className="mat-cell mat-cell-sku">
                    <div className="mat-cell-name">{s.name}</div>
                    <div className="sku">{s.code} · {s.variant}</div>
                  </td>
                  {numCell(s.wb.fg, rwFg)}
                  {usesSemi ? numCell(s.wb.semiFg, rwSemi, bnSemi) : naCell()}
                  {usesRaw  ? numCell(s.wb.rawMaterial, rwRaw, bnRaw) : naCell()}
                  <td className={"num mat-cell" + (bnPack ? " mat-cell-bn" : "")}>
                    {pkgCount === 0 ? (
                      <div className="mat-cell-num muted">—</div>
                    ) : (
                      <div className="mat-pkg-list">
                        {s.wb.inputs.pkg.map((p, idx) => {
                          // Bottleneck pkg row = whichever pkg has the lowest capacity
                          // AND is the binding constraint overall (PKG bottleneck on this SKU)
                          const minCap = Math.min(...s.wb.inputs.pkg.map(x => x.capacity));
                          const isMinPkg = bnPack && p.capacity === minCap;
                          // Per-PKG runway = component capacity (in pack-equivalents)
                          // ÷ SKU velocity. Each PKG component drains at the
                          // SKU's sell-through rate, so the slowest pkg caps
                          // the whole producible-FG runway. Per MAT-002.
                          const days = s.velocity > 0 ? p.capacity / s.velocity : null;
                          const rwPkgRow = days != null ? {
                            days,
                            status: days < 14 ? "red" : days < 30 ? "amber" : "muted",
                            label:  days >= 60 ? `~${(days / 30).toFixed(1)}mo` : `~${Math.round(days)}d`,
                          } : null;
                          return (
                            <div key={p.refCode} className={"mat-pkg-row" + (isMinPkg ? " is-min" : "")} title={`${p.name} · supports ${D.fmtN(p.capacity)} packs`}>
                              <div className="mat-pkg-row-top">
                                <span className="mat-pkg-tag">PKG{idx + 1}</span>
                                <span className="mat-pkg-qty mono">{D.fmtN(p.qty)}</span>
                                {rwPkgRow && <RunwayChip rw={rwPkgRow}/>}
                              </div>
                              <div className="mat-pkg-name muted">{p.name}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </td>
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
  const { live } = useLiveData();
  const sourceLine = live
    ? `Source: ${live.fileName || "uploaded MIS sheet"} · data as of ${live.dataAsOf || new Date(live.uploadedAt).toLocaleDateString("en-IN")}`
    : "Source: sample data · upload the MIS sheet to see live numbers";
  const wb = sku.warehouseBreakdown;
  const unitCost = sku.totalStock ? sku.stockValue / sku.totalStock : 0;

  // Esc to close
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ── Materials breakdown rows — new model ──────────────────────────
  // The popover shows: FG + (SFG OR RM, the one not used by this SKU
  // shows as N/A) + every Packaging component (PKG1, PKG2, …). The
  // binding constraint (the row that caps Producible FG) gets the
  // bottleneck accent. Each non-FG row is clickable — it expands inline
  // to show the canonical refCode, qty + unit, per-pack ratio, and a
  // tiny cross-reference of other SKUs that share this same item.
  const inputs = wb.inputs || { sfg: null, rm: null, pkg: [] };
  const usedBy = D.itemUsedBy || {};

  // Bottleneck = the constraint that defines producibleFG.
  // It's whichever row has the lowest "capacity" (FG packs it can support).
  const allRows = [];
  if (inputs.sfg) allRows.push({ kind: "sfg", obj: inputs.sfg });
  if (inputs.rm)  allRows.push({ kind: "rm",  obj: inputs.rm  });
  inputs.pkg.forEach(p => allRows.push({ kind: "pkg", obj: p }));
  const minCap = allRows.length ? Math.min(...allRows.map(r => r.obj.capacity)) : 0;
  const bottleneckRefCode = allRows.find(r => r.obj.capacity === minCap)?.obj.refCode;

  // Per-channel velocity split — same logic as the Unified Stock table.
  // Channel velocity = total velocity × that channel's revenue share, with
  // shopify mapped to warehouse (D2C ships from warehouse).
  const sp = sku.splits || {};
  const revTotal = (sp.amazon || 0) + (sp.shopify || 0) + (sp.flipkart || 0) + (sp.blinkit || 0) || 1;
  const maxFg = wb.fg + wb.producibleFG;
  const channels = [
    { key: "warehouse", name: "Central warehouse", hint: "Total (WH) · D2C + B2B direct",  color: "#2F5E47", units: maxFg,                vel: sku.velocity * ((sp.shopify  || 0) / revTotal) },
    { key: "amazon",    name: "Amazon FBA", hint: "fulfilled by Amazon",        color: "#FF9900", units: sku.stock.amazonFBA,  vel: sku.velocity * ((sp.amazon   || 0) / revTotal) },
    { key: "flipkart",  name: "Flipkart",   hint: "FK warehouse",               color: "#2874F0", units: sku.stock.flipkart,   vel: sku.velocity * ((sp.flipkart || 0) / revTotal) },
    { key: "blinkit",   name: "Blinkit",    hint: "10-min delivery",            color: "#F8CB46", units: sku.stock.blinkit,    vel: sku.velocity * ((sp.blinkit  || 0) / revTotal) },
    { key: "transit",   name: "In Transit", hint: "arriving · 7 days",          color: "#9CA098", units: sku.stock.transit,    vel: 0 },
  ];
  const runwayTier = (days) => days < 14 ? " crit" : days < 30 ? " warn" : "";

  // Track which input row is expanded (only one at a time)
  const [expandedRow, setExpandedRow] = useState(null);

  // Materials breakdown row renderer
  // role = "fg" | "sfg" | "rm" | "pkg" — drives color swatch + label.
  // When data is null/missing we render a muted "N/A" row instead of zero.
  const InputRow = ({ role, label, data, isFG }) => {
    const swatchColor = MATERIAL_COLORS[role === "sfg" ? "semiFg" : role === "rm" ? "rawMaterial" : role === "pkg" ? "packaging" : "fg"];
    const isNA = !data && !isFG;
    const isBottleneck = !isFG && data && data.refCode === bottleneckRefCode && minCap > 0;
    const isExpanded = expandedRow === (data?.refCode || role);
    const handleClick = () => {
      if (isFG || isNA) return;
      setExpandedRow(isExpanded ? null : data.refCode);
    };
    const sharedWith = data ? (usedBy[data.refCode] || []).filter(c => c !== sku.code) : [];
    const value = isFG ? wb.fg : data?.qty ?? 0;
    const code = isFG ? sku.code : data?.refCode;

    return (
      <div
        className={"wb-row" + (isBottleneck ? " wb-row-bottleneck" : "") + (isNA ? " wb-row-na" : "") + (!isFG && !isNA ? " wb-row-clickable" : "") + (isExpanded ? " is-expanded" : "")}
        key={label}
        onClick={handleClick}
      >
        <div className="wb-row-label">
          <span className="wb-row-swatch" style={{ background: isNA ? "var(--ink-4)" : swatchColor }}/>
          <div className="wb-row-name">
            <span className="wb-row-tag">{label}</span>
            {isNA
              ? <span className="muted" style={{ fontSize: 12 }}>not applicable for this SKU</span>
              : (
                <>
                  <span style={{ fontWeight: 500 }}>{isFG ? "Produced FG (ready to ship)" : data.name}</span>
                  {code && <span className="wb-row-code sku">{code}</span>}
                  {isBottleneck && <span className="wb-row-bn-tag">bottleneck</span>}
                </>
              )}
          </div>
        </div>
        <div className="wb-row-value mono">
          {isNA ? <span className="muted">N/A</span> : <>{D.fmtN(value)} <span className="wb-row-unit muted">{isFG ? "Pcs" : data.unit}</span></>}
        </div>
        {isExpanded && data && (
          <div className="wb-row-expand" onClick={(e) => e.stopPropagation()}>
            <div className="wb-row-expand-grid">
              <div>
                <div className="wb-row-expand-label">On hand</div>
                <div className="wb-row-expand-val mono">{D.fmtN(data.qty)} {data.unit}</div>
              </div>
              <div>
                <div className="wb-row-expand-label">Per FG pack</div>
                <div className="wb-row-expand-val mono">{role === "pkg" ? data.unitsPerPack : data.perPack} {data.unit}</div>
              </div>
              <div>
                <div className="wb-row-expand-label">Supports</div>
                <div className="wb-row-expand-val mono">{D.fmtN(data.capacity)} packs</div>
              </div>
              <div>
                <div className="wb-row-expand-label">Ref code</div>
                <div className="wb-row-expand-val sku">{data.refCode}</div>
              </div>
            </div>
            {sharedWith.length > 0 && (
              <div className="wb-row-shared">
                <span className="muted">Also used by:</span>
                {sharedWith.map(c => <span key={c} className="wb-row-shared-chip sku">{c}</span>)}
              </div>
            )}
          </div>
        )}
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
          {/* Materials section — title bar carries the Max FG headline + the
              bottleneck flag so we don't need a separate hero card stealing
              vertical space (Warehouse channel row below shows the same Max
              FG number anyway). */}
          <div className="wb-section-bar">
            <span className="wb-section-bar-label">Materials breakdown</span>
            <span className="wb-section-bar-stat">
              <span className="wb-section-bar-tag">Total (WH)</span>
              <span className="wb-section-bar-num mono">{D.fmtN(wb.fg + wb.producibleFG)}</span>
              <span className="wb-section-bar-formula muted">
                · Produced {D.fmtN(wb.fg)} + Producible {D.fmtN(wb.producibleFG)}
              </span>
            </span>
          </div>
          <div className="wb-rows">
            <InputRow role="fg"  label="FG"  isFG={true}/>
            <InputRow role="sfg" label="SFG" data={inputs.sfg}/>
            <InputRow role="rm"  label="RM"  data={inputs.rm}/>
            {inputs.pkg.map((p, i) => (
              <InputRow key={p.refCode} role="pkg" label={`PKG${i + 1}`} data={p}/>
            ))}
          </div>

          {/* Channel breakdown — where stock sits across warehouse + marketplaces,
              with per-channel runway + velocity. Growth is mirrored from the
              SKU's overall MoM (per-channel growth will land with real data). */}
          <div className="wb-section-bar">
            <span className="wb-section-bar-label">By channel</span>
            <span className="wb-section-bar-stat muted" style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              units · runway · velocity · MoM growth
            </span>
          </div>
          <div className="wb-channels">
            {channels.map(ch => {
              const hasVel = ch.vel > 0;
              const runway = hasVel ? Math.round(ch.units / ch.vel) : null;
              return (
                <div className="wb-ch-row" key={ch.key} title={ch.hint}>
                  <div className="wb-ch-label">
                    <span className="wb-ch-swatch" style={{ background: ch.color }}/>
                    <div className="wb-ch-name">{ch.name}</div>
                  </div>
                  <div className="wb-ch-stats">
                    <div className="wb-ch-units mono">{D.fmtN(ch.units)}</div>
                    {hasVel ? (
                      <div className="wb-ch-meta">
                        <span className={"pf-cell-runway" + runwayTier(runway)}>{runway}d</span>
                        <span className="wb-ch-vel mono">{ch.vel.toFixed(1)}/d</span>
                        <Delta value={sku.growth} hideArrow/>
                      </div>
                    ) : (
                      <span className="wb-ch-vel muted" style={{ fontSize: 10.5 }}>transit only</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="wb-meta">
            <dl className="kv">
              <dt>FG stock value</dt>
              <dd>{D.fmtINR(wb.fg * unitCost)}</dd>
              <dt>Rolling daily velocity</dt>
              <dd>{sku.velocity} units/day</dd>
              <dt>Runway (central warehouse FG)</dt>
              <dd>{Math.round(wb.fg / sku.velocity)} days</dd>
              <dt>Supplier lead time</dt>
              <dd>{sku.leadTime} days</dd>
            </dl>
          </div>
        </div>

        <div className="modal-foot">
          <span className="muted" style={{ fontSize: 11.5 }}>{sourceLine}</span>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

// Localised preview gate for Inventory sub-tabs that aren't yet polished.
// Mirrors the global preview pattern (amber banner + blurred content +
// jump-to-live CTA) but contained inside the page so the top tabs + page
// header stay sharp and clickable. No more dead-end navigation.
const SubtabPreviewGate = ({ label, children }) => {
  const navigate = useNavigate();
  return (
    <>
      <div className="preview-banner" style={{ marginBottom: 12, borderRadius: 10, border: "1px solid #DBC487" }}>
        <span className="preview-stripe" aria-hidden="true"/>
        <span className="preview-pill">Sub-tab preview</span>
        <span className="preview-text">
          <strong>{label}</strong> isn't built yet — the layout is from the initial
          design and uses static data. Other Inventory sub-tabs are live.
        </span>
        <button className="preview-cta" onClick={() => navigate("/inventory")}>
          Unified stock →
        </button>
      </div>
      <div className="subtab-preview-content">
        {children}
      </div>
    </>
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
            {/* Input rows. Unit on Raw Material is sourced from the active
                SKU's recipe (KG/Ltr) instead of generic "units" per SIM-001.
                "Raw per pack" removed per SIM-002 (it's a config constant,
                not something to simulate). "Growth %" relabelled "MoM %"
                per SIM-004. */}
            {(() => {
              // Pull the active SKU's raw input unit from its recipe.
              const rmUnit = baseline?.warehouseBreakdown?.inputs?.rm?.unit || "units";
              const sfgUnit = baseline?.warehouseBreakdown?.inputs?.sfg?.unit || "units";
              return [
              { k: "fg",          label: "Produced FG",  unit: "units", min: 0, max: fgMax,  step: 1 },
              { k: "semiFg",      label: "Semi-FG",       unit: sfgUnit, min: 0, max: fgMax,  step: 1 },
              { k: "rawMaterial", label: "Raw Material",  unit: rmUnit,  min: 0, max: fgMax * 2, step: rmUnit === "KG" || rmUnit === "Ltr" ? 0.1 : 1 },
              { k: "packaging",   label: "Packaging",     unit: "units", min: 0, max: fgMax * 1.5, step: 1 },
              { k: "velocity",    label: "Daily velocity", unit: "/day", min: 0, max: 500,    step: 1 },
              { k: "leadTime",    label: "Supplier lead time", unit: "days", min: 1, max: 120, step: 1 },
              { k: "growth",      label: "MoM %",         unit: "%",     min: -100, max: 500, step: 1 },
              ];
            })().map(({ k, label, unit, min, max, step }) => {
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

            {/* Producible FG / Total (WH) cards removed per SIM-003 — they
                already appear in the Inputs panel above. Keep only the
                action-oriented outputs: when to reorder, what's the cap. */}
            <div className="sim-out-stats">
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

// ── RunwayChannelCell — stacked cell for a marketplace column in the
// Runway calculator table. Three short lines: stock units, runway pill
// inline with lead time, then velocity + growth. Reused across Amazon
// FBA / Flipkart / Blinkit columns.
const RunwayChannelCell = ({ units, vel, leadTime, growth, splitA, splitB, splitALabel = "amz", splitBLabel = "d2c" }) => {
  const D = NSData;
  const hasVel = vel != null && vel > 0;
  const runway = hasVel ? Math.round(units / vel) : null;
  // Use the channel's own lead time for severity, not the warehouse one.
  const tier = runway == null
    ? ""
    : runway < leadTime
      ? " crit"
      : runway < leadTime + 14
        ? " warn"
        : "";
  const hasSplit = splitA != null && splitB != null;
  return (
    <div className="rw-ch-cell">
      <div className="rw-ch-cell-stock mono">{units != null ? D.fmtN(units) : "—"}</div>
      {hasVel ? (
        <>
          <div className="rw-ch-cell-rl">
            <span className={"pf-cell-runway" + tier}>{runway}d</span>
            <span className="rw-ch-cell-lead muted">· {leadTime}d lead</span>
          </div>
          <div className="rw-ch-cell-vg">
            <span className="mono rw-ch-cell-vel">
              {hasSplit
                ? <>{splitA.toFixed(1)}<span className="rw-ch-cell-splittag muted">{splitALabel}</span>+{splitB.toFixed(1)}<span className="rw-ch-cell-splittag muted">{splitBLabel}</span>/d</>
                : <>{vel.toFixed(1)}/d</>}
            </span>
            {growth != null && <Delta value={growth} hideArrow/>}
          </div>
        </>
      ) : (
        <span className="muted" style={{ fontSize: 10.5 }}>no velocity</span>
      )}
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

  // Marketplace lead times — how long replenishment to that channel takes.
  // These are placeholders; replace with real per-channel SLAs when the
  // marketplace integrations come online.
  const CHANNEL_LEAD = { amazonFBA: 3, flipkart: 2, blinkit: 1 };

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

    // Per-channel velocity split (with MoM growth applied) — Amazon
    // channel velocity now COMBINES Amazon orders + Shopify (D2C)
    // orders per AMZ-001, because Shopify ships from Amazon FBA.
    const sp = s.splits || {};
    const revTotal = (sp.amazon||0) + (sp.shopify||0) + (sp.flipkart||0) + (sp.blinkit||0) || 1;
    const amazonOwnVel  = vel * ((sp.amazon  || 0) / revTotal);
    const shopifyOwnVel = vel * ((sp.shopify || 0) / revTotal);
    const chVel = {
      amazonFBA: amazonOwnVel + shopifyOwnVel,
      flipkart:  vel * ((sp.flipkart || 0) / revTotal),
      blinkit:   vel * ((sp.blinkit  || 0) / revTotal),
      _amazonOnly: amazonOwnVel,    // sub-component for split display
      _shopifyOnly: shopifyOwnVel,  // sub-component for split display
    };

    // ── Parallel cascade runway (RUN-001) ──────────────────────────
    // Each marketplace drains at its own velocity. As channels die,
    // their demand falls back to the central warehouse. Total runway
    // = the day the central warehouse itself hits zero.
    // whBaseVelocity = total velocity minus what's claimed by channels.
    const channelClaimed = chVel.amazonFBA + chVel.flipkart + chVel.blinkit;
    const whBaseVelocity = Math.max(0, vel - channelClaimed);
    const cascade = computeCascade({
      whStock:       maxFg,
      whBaseVelocity,
      channels: [
        { key: "amazon",   label: "Amazon FBA", stock: s.stock.amazonFBA, velocity: chVel.amazonFBA },
        { key: "flipkart", label: "Flipkart",   stock: s.stock.flipkart,  velocity: chVel.flipkart },
        { key: "blinkit",  label: "Blinkit",    stock: s.stock.blinkit,   velocity: chVel.blinkit  },
      ],
    });

    // Cascade total runway = the headline number. Status uses lead time
    // as before.
    const runway = Number.isFinite(cascade.totalRunway) ? Math.round(cascade.totalRunway) : 0;
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
      chVel,
      chLead: CHANNEL_LEAD,
      cascade,
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
      {/* Risk summary — 4 severity-tinted cards covering different facets of
          urgency. Each carries an icon, severity-tinted left border + soft
          BG, and a coloured hero number so a quick glance reads "what is
          on fire" before the eye has to parse the labels. */}
      <div className="grid rw-risk-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 12 }}>
        {/* 1. Earliest reorder — when is the next action due */}
        {(() => {
          const sev = earliestReorder
            ? (earliestReorder.adjStatus === "red" ? "crit" : "warn")
            : "ok";
          return (
            <div className={"rw-risk-card " + sev}>
              <div className="rw-risk-head">
                <span className="rw-risk-icon"><Icon name="calendar" size={14}/></span>
                <div>
                  <div className="rw-risk-title">Earliest reorder</div>
                  <div className="rw-risk-sub">most urgent action</div>
                </div>
              </div>
              <div className="rw-risk-num">
                {earliestReorder ? fmtReorderDate(earliestReorder.rb) : "All clear"}
              </div>
              <div className="rw-risk-detail">
                {earliestReorder
                  ? <>{earliestReorder.name} <span className="sku">· {earliestReorder.code}</span></>
                  : "No items need reorder in the next 30 days"}
              </div>
            </div>
          );
        })()}

        {/* 2. First stockout — when does the soonest item actually run out */}
        {(() => {
          const sev = firstToStockout?.adjStatus === "red" ? "crit"
                    : firstToStockout?.adjStatus === "amber" ? "warn"
                    : "ok";
          return (
            <div className={"rw-risk-card " + sev}>
              <div className="rw-risk-head">
                <span className="rw-risk-icon"><Icon name="alerts" size={14}/></span>
                <div>
                  <div className="rw-risk-title">First stockout</div>
                  <div className="rw-risk-sub">smallest runway right now</div>
                </div>
              </div>
              <div className="rw-risk-num">{firstToStockout?.adjRunway ?? 0}d</div>
              <div className="rw-risk-detail">
                {firstToStockout
                  ? <>{firstToStockout.name} · runs out in {firstToStockout.adjRunway}d</>
                  : "—"}
              </div>
            </div>
          );
        })()}

        {/* 3. Stock value at risk — what's the financial exposure */}
        {(() => {
          const sev = stockValueAtRisk > 0 ? "crit" : "ok";
          return (
            <div className={"rw-risk-card " + sev}>
              <div className="rw-risk-head">
                <span className="rw-risk-icon"><Icon name="finance" size={14}/></span>
                <div>
                  <div className="rw-risk-title">Stock value at risk</div>
                  <div className="rw-risk-sub">overdue items only</div>
                </div>
              </div>
              <div className="rw-risk-num">{D.fmtINR(stockValueAtRisk)}</div>
              <div className="rw-risk-detail">
                across {reds.length} overdue item{reds.length === 1 ? "" : "s"}
              </div>
            </div>
          );
        })()}

        {/* 4. Reorder volume needed — how much to actually order */}
        {(() => {
          const sev = reorderUnitsNeeded > 0 ? "warn" : "ok";
          return (
            <div className={"rw-risk-card " + sev}>
              <div className="rw-risk-head">
                <span className="rw-risk-icon"><Icon name="box" size={14}/></span>
                <div>
                  <div className="rw-risk-title">Reorder volume needed</div>
                  <div className="rw-risk-sub">to cover lead + 30d buffer</div>
                </div>
              </div>
              <div className="rw-risk-num">{D.fmtN(Math.round(reorderUnitsNeeded))}</div>
              <div className="rw-risk-detail">
                units · {suppliersToContact} supplier{suppliersToContact === 1 ? "" : "s"} to contact
              </div>
            </div>
          );
        })()}
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
            ? "Total (WH) ÷ (velocity × (1 + MoM growth %)). Growth column drives the projection."
            : "Total (WH) ÷ (velocity × (1 + Custom %)). Override any item's growth to stress-test runway."
        }
        padded={false}
      >
        <table className="table mat-table runway-table">
          <colgroup>
            <col className="rw-col-sku"/>
            <col className="rw-col-wh"/>
            <col className="rw-col-vg"/>
            <col className="rw-col-wh-rl"/>
            <col className="rw-col-mp"/>
            <col className="rw-col-mp"/>
            <col className="rw-col-mp"/>
            <col className="rw-col-action"/>
          </colgroup>
          <thead>
            <tr>
              <th>Item</th>
              <th className="num rw-h-wh">Central warehouse</th>
              <th className="num">Velocity {mode === "custom" && <span className="muted" style={{ fontWeight: 400 }}>· Custom %</span>}</th>
              <th className="num">Runway · Lead</th>
              <th className="num">Amazon FBA</th>
              <th className="num">Flipkart</th>
              <th className="num">Blinkit</th>
              <th className="num rw-h-action">Action needed</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={8}><div className="empty">No Items match this filter.</div></td></tr>
            ) : visible.map(s => {
              const rb = reorderByDate(s);
              const reorderText = fmtReorderDate(rb);
              const overdue = rb.daysFromNow < 0;
              const customVal = perRowGrowth[s.code] ?? s.actualGrowth;
              const isOverride = mode === "custom" && perRowGrowth[s.code] !== undefined && perRowGrowth[s.code] !== s.actualGrowth;
              const whTier = s.adjStatus === "red" ? " crit" : s.adjStatus === "amber" ? " warn" : "";
              return (
                <tr
                  key={s.code}
                  className={"row-clickable runway-row runway-row-" + s.adjStatus}
                  onClick={() => setPopoverSku(s)}
                >
                  {/* 1. Item */}
                  <td className="mat-cell">
                    <div className="mat-cell-name">{s.name}</div>
                    <div className="sku">{s.code} · {s.variant}</div>
                  </td>

                  {/* 2. Total (WH) = Produced FG + Producible FG, breakdown under */}
                  <td className="num mat-cell rw-cell-max"
                      title={`Total (WH) ${D.fmtN(s.maxFg)} = Produced FG ${D.fmtN(s.whFg)} + Producible FG ${D.fmtN(s.producibleFg)}`}>
                    <div className="rw-wh-stack">
                      <div className="rw-wh-max mono">{D.fmtN(s.maxFg)}</div>
                      <div className="rw-wh-sub">
                        <span className="mono">{D.fmtN(s.whFg)}</span>
                        <span className="rw-wh-op">+</span>
                        <span className="mono">{D.fmtN(s.producibleFg)}</span>
                        <span className="rw-wh-tag">producible</span>
                      </div>
                    </div>
                  </td>

                  {/* 3. Velocity & Growth — growth becomes editable in Custom mode */}
                  <td className="num mat-cell rw-cell-vg" onClick={mode === "custom" ? (e => e.stopPropagation()) : undefined}>
                    <div className="rw-vg-stack">
                      <div className="rw-vg-vel mono">{s.adjVelocity}</div>
                      {mode === "custom" ? (
                        <CustomGrowthInput
                          code={s.code}
                          initial={customVal}
                          isOverride={isOverride}
                          onCommit={(val) => setGrowthFor(s.code, val)}
                        />
                      ) : (
                        <div className={"rw-vg-growth mono " + (s.actualGrowth > 0 ? "up" : s.actualGrowth < 0 ? "down" : "flat")}>
                          {s.actualGrowth > 0 ? "+" : ""}{s.actualGrowth.toFixed(1)}%
                        </div>
                      )}
                    </div>
                  </td>

                  {/* 4. Warehouse Runway · Lead (compact) */}
                  <td className="num mat-cell rw-cell-wh-rl">
                    <div className="rw-rl-stack">
                      <span className={"pf-cell-runway" + whTier}>{s.adjRunway}d</span>
                      <span className="rw-rl-lead muted">{s.leadTime}d lead</span>
                    </div>
                  </td>

                  {/* 5-7. Marketplace channels */}
                  <td className="num mat-cell">
                    <RunwayChannelCell
                      units={s.stock.amazonFBA}
                      vel={s.chVel.amazonFBA}
                      leadTime={s.chLead.amazonFBA}
                      growth={s.actualGrowth}
                      splitA={s.chVel._amazonOnly}
                      splitB={s.chVel._shopifyOnly}
                      splitALabel="amz"
                      splitBLabel="d2c"
                    />
                  </td>
                  <td className="num mat-cell">
                    <RunwayChannelCell units={s.stock.flipkart} vel={s.chVel.flipkart} leadTime={s.chLead.flipkart} growth={s.actualGrowth}/>
                  </td>
                  <td className="num mat-cell">
                    <RunwayChannelCell units={s.stock.blinkit} vel={s.chVel.blinkit} leadTime={s.chLead.blinkit} growth={s.actualGrowth}/>
                  </td>

                  {/* 8. Action needed */}
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
  // Clicking a row opens the same per-SKU breakdown popover used across
  // Unified Stock / Materials / Runway, so the Forecast tab behaves
  // consistently with the rest of Inventory.
  const [popoverSku, setPopoverSku] = useState(null);

  // Per-item forecast math.
  //   - forecast: units we expect to ship over `days` (trend-adjusted)
  //   - maxFg:    units we can actually ship from warehouse (FG + Producible).
  //               Inventory is warehouse-only scope; this is the relevant
  //               supply number, NOT total across all channels.
  //   - required: units we need to cover the period + 30d buffer
  //   - reorder:  max(0, required − maxFg)
  //   - atRisk:   maxFg < forecast → can't meet projected demand
  const trendForIdx = (idx) =>
    [1.18, 0.94, 1.22, 1.06, 1.32, 0.98, 1.45, 0.82, 1.12, 0.66, 1.08, 1.18, 1.04, 0.92][idx] || 1;
  const rows = inventory.map((s, i) => {
    const trend = trendForIdx(i);
    const fg = s.warehouseBreakdown?.fg ?? s.stock.warehouse;
    const producibleFg = s.warehouseBreakdown?.producibleFG ?? 0;
    const maxFg = fg + producibleFg;
    const forecast = Math.round(s.velocity * days * trend);
    const required = Math.round(s.velocity * (days + 30) * trend);
    const reorder = Math.max(0, required - maxFg);
    return { ...s, trend, forecast, required, reorder, maxFg, trendPct: (trend - 1) * 100 };
  });

  // Summary metrics shown as cards at the top of the tab.
  //   Underperforming  = trend < -5% (sales declining materially)
  //   Overperforming   = trend > +20% (strong growth — may need more stock)
  //   At-risk          = current stock < forecast (won't meet projected demand)
  //   Total demand     = sum of forecast units
  //   Total reorder    = sum of recommended reorder
  const underperforming = rows.filter(r => r.trendPct < -5).length;
  const overperforming = rows.filter(r => r.trendPct > 20).length;
  const atRisk = rows.filter(r => r.maxFg < r.forecast).length;
  const totalDemand = rows.reduce((a, r) => a + r.forecast, 0);
  const totalReorder = rows.reduce((a, r) => a + r.reorder, 0);

  return (
    <>
      {/* Forecast risk summary — reuses the .rw-risk-card pattern from the
          Runway calculator so the two tabs feel like the same product.
          Severity-tinted left accent + soft BG + icon chip + colored hero
          number. */}
      <div className="grid rw-risk-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 14 }}>
        <div className="rw-risk-card ok">
          <div className="rw-risk-head">
            <span className="rw-risk-icon"><Icon name="sales" size={14}/></span>
            <div>
              <div className="rw-risk-title">{`Projected demand · ${days}d`}</div>
              <div className="rw-risk-sub">across all SKUs</div>
            </div>
          </div>
          <div className="rw-risk-num" style={{ color: "var(--ink)" }}>{D.fmtN(totalDemand)}</div>
          <div className="rw-risk-detail">units to ship over next {days} days</div>
        </div>

        <div className={"rw-risk-card " + (atRisk > 0 ? "crit" : "ok")}>
          <div className="rw-risk-head">
            <span className="rw-risk-icon"><Icon name="alerts" size={14}/></span>
            <div>
              <div className="rw-risk-title">At-risk SKUs</div>
              <div className="rw-risk-sub">Total (WH) today &lt; forecast demand</div>
            </div>
          </div>
          <div className="rw-risk-num">{atRisk}</div>
          <div className="rw-risk-detail">of {rows.length} won't meet projected demand</div>
        </div>

        <div className={"rw-risk-card " + (underperforming > 0 ? "warn" : "ok")}>
          <div className="rw-risk-head">
            <span className="rw-risk-icon"><Icon name="down" size={14}/></span>
            <div>
              <div className="rw-risk-title">Underperforming SKUs</div>
              <div className="rw-risk-sub">trend &lt; −5% (sales declining)</div>
            </div>
          </div>
          <div className="rw-risk-num">{underperforming}</div>
          <div className="rw-risk-detail">
            {overperforming > 0
              ? <>{overperforming} overperforming (&gt;+20%) on the other end</>
              : "no overperformers"}
          </div>
        </div>

        <div className={"rw-risk-card " + (totalReorder > 0 ? "warn" : "ok")}>
          <div className="rw-risk-head">
            <span className="rw-risk-icon"><Icon name="box" size={14}/></span>
            <div>
              <div className="rw-risk-title">Recommended reorder</div>
              <div className="rw-risk-sub">to cover {days}d + 30d buffer</div>
            </div>
          </div>
          <div className="rw-risk-num">{D.fmtN(totalReorder)}</div>
          <div className="rw-risk-detail">units across all suppliers</div>
        </div>
      </div>

      <Card
        title="Demand forecast"
        sub={`Per item · projected ${days}-day demand. Red Total-(WH) cell = available supply won't meet forecast.`}
        action={
          <div className="seg">
            {[30, 60, 90].map(d => (
              <button key={d} className={days === d ? "active" : ""} onClick={() => setDays(d)}>{d} days</button>
            ))}
          </div>
        }
        padded={false}
      >
        <table className="table mat-table fc-table">
          <colgroup>
            <col className="fc-col-sku"/>
            <col className="fc-col-num"/>
            <col className="fc-col-num"/>
            <col className="fc-col-num"/>
            <col className="fc-col-num"/>
            <col className="fc-col-num"/>
            <col className="fc-col-result"/>
          </colgroup>
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">Velocity</th>
              <th className="num">Trend</th>
              <th className="num">Forecast ({days}d)</th>
              <th className="num">Total (WH) today</th>
              <th className="num">Required</th>
              <th className="num fc-h-result">Reorder</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(s => {
              const atRisk = s.maxFg < s.forecast;
              return (
                <tr key={s.code} className="fc-row row-clickable" onClick={() => setPopoverSku(s)}>
                  <td className="mat-cell">
                    <div className="mat-cell-name">{s.name}</div>
                    <div className="sku">{s.code}</div>
                  </td>
                  <td className="num mat-cell">
                    <div className="mat-cell-num">{s.velocity}</div>
                  </td>
                  <td className="num mat-cell">
                    <Delta value={s.trendPct}/>
                  </td>
                  <td className="num mat-cell">
                    <div className="mat-cell-num">{D.fmtN(s.forecast)}</div>
                  </td>
                  <td className={"num mat-cell" + (atRisk ? " fc-cell-atrisk" : "")}>
                    <div className="mat-cell-num">{D.fmtN(s.maxFg)}</div>
                  </td>
                  <td className="num mat-cell">
                    <div className="mat-cell-num">{D.fmtN(s.required)}</div>
                  </td>
                  <td className="num mat-cell fc-cell-result">
                    {s.reorder > 0 ? (
                      <div
                        className="mat-cell-num result"
                        style={{ color: s.reorder > s.maxFg ? "var(--critical)" : "var(--warning)" }}
                      >
                        {D.fmtN(s.reorder)}
                      </div>
                    ) : (
                      <span className="muted">—</span>
                    )}
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

// ── SKU Catalog tab — the naming reference ────────────────────────────
// Two views the team kept asking "what's our code for X / what's it called
// on Amazon":
//   1. Internal codes — FG SKU code + its component sub-codes (SFG/RM/PKGn)
//   2. Marketplace catalog — what each SKU is listed as on every channel
const CatalogTab = ({ inventory }) => {
  const D = NSData;
  const [popoverSku, setPopoverSku] = useState(null);

  const CHANNEL_META = [
    { key: "amazon",   label: "Amazon",      color: "#FF9900" },
    { key: "flipkart", label: "Flipkart",    color: "#2874F0" },
    { key: "blinkit",  label: "Blinkit",     color: "#F8CB46" },
    { key: "shopify",  label: "Shopify · D2C", color: "#5E8E3E" },
  ];

  return (
    <>
      {/* ── View 1: internal codes ── */}
      <Card
        title="Internal SKU codes"
        sub="Our canonical code per finished good, and the sub-codes for the input + packaging components it's built from. Click a row for the full material breakdown."
        padded={false}
      >
        <table className="table mat-table cat-table">
          <colgroup>
            <col className="cat-col-item"/>
            <col className="cat-col-code"/>
            <col className="cat-col-input"/>
            <col className="cat-col-pkg"/>
          </colgroup>
          <thead>
            <tr>
              <th>Item</th>
              <th>NS code</th>
              <th>Input · SFG / RM</th>
              <th>Packaging components</th>
            </tr>
          </thead>
          <tbody>
            {inventory.map(s => {
              const wb = s.warehouseBreakdown || {};
              const inp = wb.inputs?.sfg || wb.inputs?.rm || null;
              const inpTag = wb.inputs?.sfg ? "SFG" : wb.inputs?.rm ? "RM" : null;
              const pkg = wb.inputs?.pkg || [];
              return (
                <tr key={s.code} className="row-clickable" onClick={() => setPopoverSku(s)}>
                  <td className="mat-cell">
                    <div className="mat-cell-name">{s.name}</div>
                    <div className="sku">{s.variant}</div>
                  </td>
                  <td className="mat-cell">
                    <span className="cat-code-chip cat-code-fg sku">{s.code}</span>
                  </td>
                  <td className="mat-cell">
                    {inp ? (
                      <div className="cat-comp">
                        <span className="cat-comp-tag">{inpTag}</span>
                        <span className="cat-code-chip sku">{inp.refCode}</span>
                        <span className="cat-comp-name muted">{inp.name}</span>
                      </div>
                    ) : <span className="muted">—</span>}
                  </td>
                  <td className="mat-cell">
                    <div className="cat-pkg-list">
                      {pkg.length === 0 && <span className="muted">—</span>}
                      {pkg.map((p, i) => (
                        <div className="cat-comp" key={p.refCode}>
                          <span className="cat-comp-tag">PKG{i + 1}</span>
                          <span className="cat-code-chip sku">{p.refCode}</span>
                          <span className="cat-comp-name muted">{p.name}</span>
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* ── View 2: marketplace catalog names ── */}
      <Card
        title="Marketplace catalog names"
        sub="What each SKU is listed as on every channel. Empty = not listed there yet. Sourced from the channel category reports + Shopify export."
        padded={false}
        style={{ marginTop: 14 }}
      >
        <table className="table mat-table cat-table cat-table-mp">
          <colgroup>
            <col className="cat-col-mp-code"/>
            {CHANNEL_META.map(c => <col key={c.key} className="cat-col-mp-name"/>)}
          </colgroup>
          <thead>
            <tr>
              <th>Item · NS code</th>
              {CHANNEL_META.map(c => (
                <th key={c.key}>
                  <span className="cat-mp-dot" style={{ background: c.color }}/>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {inventory.map(s => {
              const mp = s.marketplaceNames || {};
              return (
                <tr key={s.code} className="row-clickable" onClick={() => setPopoverSku(s)}>
                  <td className="mat-cell">
                    <div className="mat-cell-name">{s.name}</div>
                    <div className="sku">{s.code} · {s.variant}</div>
                  </td>
                  {CHANNEL_META.map(c => (
                    <td className="mat-cell cat-mp-cell" key={c.key}>
                      {mp[c.key]
                        ? <span className="cat-mp-name">{mp[c.key]}</span>
                        : <span className="cat-mp-none muted">not listed</span>}
                    </td>
                  ))}
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
        <Card title="Pending inspection"><div className="stat-num lg" style={{ color: "var(--warning)" }}>24</div><div className="muted" style={{ fontSize: 11.5 }}>queued at central warehouse</div></Card>
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
