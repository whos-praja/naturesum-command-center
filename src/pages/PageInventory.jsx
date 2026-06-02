import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Icon, Delta, Card, Sparkline, BarChart, Progress, ChannelPill } from "../components/Shared.jsx";
import NSData from "../data.js";
import { UploadModal, DataAsOfPill } from "../components/UploadModal.jsx";
import { useLiveData } from "../contexts/LiveDataContext.jsx";
import { applyLiveData } from "../lib/liveInventory.js";
import { computeCascade } from "../lib/runwayCascade.js";
import { readTargetDays, writeTargetDays, DEFAULT_TARGET_DAYS } from "../lib/skuTargets.js";
import { readParam } from "../lib/formulaParams.js";
import { FormulaIcon } from "../components/FormulaIcon.jsx";
import FormulasTab from "./sub/FormulasTab.jsx";

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
          {/* DataAsOfPill IS the upload entry point — shows live/sample status,
              clicking it opens the multi-file upload modal. Removed the
              redundant "Upload MIS" button and the stub "Sync central
              warehouse" button (no handler, was reserved for a future
              Apps Script trigger). Place PO stays as the primary action. */}
          <DataAsOfPill onClick={() => setUploadOpen(true)}/>
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
        <button className={tab === "formulas" ? "active" : ""} onClick={() => setTab("formulas")}>Formulas</button>
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
      {tab === "formulas" && <FormulasTab/>}
    </div>
  );
};

// ── Blinkit feeder-WH helpers (BLK-001 → BLK-005) ─────────────────────
// Localised state key for the per-SKU amber threshold (BLK-005).
const BLK_THRESHOLD_KEY = (skuCode) => `ns.blkAmberThreshold.${skuCode}`;
const BLK_DEFAULT_AMBER = 25;

function readBlkThreshold(skuCode) {
  if (typeof window === "undefined") return BLK_DEFAULT_AMBER;
  const v = window.localStorage.getItem(BLK_THRESHOLD_KEY(skuCode));
  return v ? Number(v) || BLK_DEFAULT_AMBER : BLK_DEFAULT_AMBER;
}
function writeBlkThreshold(skuCode, val) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(BLK_THRESHOLD_KEY(skuCode), String(val));
}

// Per-WH velocity for Blinkit. When real per-WH sales are present (from the
// Blinkit Seller Panel export), use those directly. Otherwise fall back to
// the rough split-total-velocity-across-WHs heuristic.
function blkPerWhVelocity(feeders, sku, whCode) {
  if (feeders?.perWhSales30d && feeders.perWhSales30d[whCode] != null) {
    return feeders.perWhSales30d[whCode] / 30;
  }
  const ever = feeders?.ever?.length || 0;
  const blkVel = sku?.channelVelocity?.blinkit ?? 0;
  return ever > 0 ? blkVel / ever : 0;
}

// Given a SKU's blinkitFeeders + the per-SKU amber threshold, return
// counts: out-of-stock, will-go-OOS-soon (≤ threshold), healthy, and
// the lifetime "ever launched on" denominator.
function blkFeederStats(feeders, sku, threshold) {
  const ever = feeders?.ever?.length || 0;
  const current = feeders?.current || {};
  const oosSoonDays = readParam("blkOosSoonDays"); // tunable, default 14
  let red = 0, orange = 0;
  for (const code of feeders?.ever || []) {
    const stock = current[code] ?? 0;
    const perWhVel = blkPerWhVelocity(feeders, sku, code);
    if (stock <= 0) red++;
    else if (perWhVel > 0) {
      // OOS within blkOosSoonDays at this WH's velocity OR stock ≤ amber threshold
      const daysCover = stock / perWhVel;
      if (daysCover <= oosSoonDays || stock <= threshold) orange++;
    } else if (stock <= threshold) {
      orange++;
    }
  }
  return { red, orange, healthy: ever - red - orange, ever };
}

// Compact two-stat caption that goes in place of velocity/growth in the
// Blinkit cell for Unified Stock + Runway tabs.
const BlinkitFeederStats = ({ feeders, sku, threshold }) => {
  const { red, orange, ever } = blkFeederStats(feeders, sku, threshold);
  if (!ever) {
    return <span className="muted" style={{ fontSize: 10.5 }}>not on Blinkit</span>;
  }
  return (
    <div className="blk-feeder-stats">
      <span className="blk-stat blk-stat-red"
        title={`${red} of ${ever} feeder WHs are out of stock right now`}>
        <span className="blk-stat-num">{red}</span>
        <span className="blk-stat-denom">/{ever}</span>
      </span>
      <span className="blk-stat blk-stat-amber"
        title={`${orange} of ${ever} feeder WHs will run out in ≤14d at current velocity`}>
        <span className="blk-stat-num">{orange}</span>
        <span className="blk-stat-denom">/{ever}</span>
      </span>
      {feeders?.isStub && (
        <span className="blk-stub-badge" title="Stub data — swap when real Blinkit feeder-WH export arrives">STUB</span>
      )}
    </div>
  );
};

// Drill modal — per-feeder-WH stock list, severity-tinted, with the
// per-SKU amber threshold editable + persisted (BLK-004 + BLK-005).
const BlinkitFeederModal = ({ sku, onClose }) => {
  const D = NSData;
  const [threshold, setThreshold] = useState(() => readBlkThreshold(sku.code));
  const [draftThreshold, setDraftThreshold] = useState(threshold);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const feeders = sku.blinkitFeeders || { ever: [], current: {}, isStub: true };
  // Real byWh dict has per-WH sales7d / sales15d / sales30d + damaged / lost.
  const byWh = sku.realData?.blinkit?.byWh || {};

  // Per-WH biweekly growth = last 15d (sales15d) vs prior 15d (sales30d − sales15d).
  // Capped at ±200%. Returns { pct, label, tone, hasSignal }.
  //   tone: "up" / "down" / "flat" / "muted" — drives chip color
  //   hasSignal: false when both windows are 0 (no Δ to compute)
  const computeBiweeklyDelta = (cur15, sales30) => {
    const prior15 = Math.max(0, (sales30 ?? 0) - (cur15 ?? 0));
    if (cur15 === 0 && prior15 === 0) return { pct: null, label: "—", tone: "muted", hasSignal: false };
    if (prior15 === 0 && cur15 > 0)   return { pct:  200, label: "+new",   tone: "up",   hasSignal: true };
    if (cur15 === 0 && prior15 > 0)   return { pct: -100, label: "−100%",  tone: "down", hasSignal: true };
    const raw = ((cur15 - prior15) / prior15) * 100;
    const capped = Math.max(-100, Math.min(200, raw));
    const sign = capped > 0 ? "+" : capped < 0 ? "−" : "";
    const label = `${sign}${Math.abs(Math.round(capped))}%`;
    let tone = "flat";
    if (capped >=  10) tone = "up";
    else if (capped <= -10) tone = "down";
    return { pct: capped, label, tone, hasSignal: true };
  };

  const rows = feeders.ever.map(code => {
    const wh = D.blinkitFeederWhs.find(w => w.code === code) || { code, name: code, city: "—" };
    const stock = feeders.current[code] ?? 0;
    const whReal = byWh[code] || {};
    const sales7d  = whReal.sales7d  ?? 0;
    const sales15d = whReal.sales15d ?? 0;
    const sales30d = whReal.sales30d ?? 0;
    const damaged = (whReal.damaged ?? 0) + (whReal.lost ?? 0);
    const perWhVel = blkPerWhVelocity(feeders, sku, code); // sales30d/30 when real
    const days = perWhVel > 0 ? Math.round(stock / perWhVel) : null;
    const delta = computeBiweeklyDelta(sales15d, sales30d);
    let severity = "ok";
    if (stock <= 0) severity = "crit";
    else if (stock <= threshold) severity = "warn";
    else if (days != null && days <= 14) severity = "warn";
    return { wh, stock, sales7d, sales15d, sales30d, damaged, perWhVel, days, delta, severity };
  }).sort((a, b) => a.stock - b.stock);

  const stats = blkFeederStats(feeders, sku, threshold);
  // Roll-ups across all launched WHs
  const total30d = rows.reduce((a, r) => a + r.sales30d, 0);
  const total7d  = rows.reduce((a, r) => a + r.sales7d, 0);
  const totalDamaged = rows.reduce((a, r) => a + r.damaged, 0);
  const avgDaily30 = total30d / 30;
  const onSaveThreshold = () => {
    const v = Number(draftThreshold) || BLK_DEFAULT_AMBER;
    writeBlkThreshold(sku.code, v);
    setThreshold(v);
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal-card" onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(840px, 94vw)" }}>
        <div className="modal-head">
          <div>
            <div className="modal-title">
              <span style={{ background: "var(--warning-soft)", color: "var(--warning)", fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 3, marginRight: 8, letterSpacing: "0.06em" }}>BLINKIT</span>
              {sku.name}
            </div>
            <div className="modal-sub sku">
              {sku.code} · {sku.variant} ·{" "}
              {feeders.isStub
                ? "STUB DATA"
                : `live · snapshot ${NSData.realDataSnapshotDate}`}
            </div>
          </div>
          <button className="btn ghost icon" onClick={onClose} title="Close (Esc)">✕</button>
        </div>

        <div className="modal-body" style={{ gap: 10 }}>
          {/* Combined hero band — 3 health stats + 4 sales stats in one row.
              Earlier these were two stacked cards costing ~140px of vertical
              space; merging into one 7-stat band saves ~70px so all 12 feeder
              WHs fit without scrolling. */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: 8,
            padding: "10px 12px",
            background: "var(--bg-canvas)",
            border: "1px solid var(--border-soft)",
            borderRadius: 8,
          }}>
            <div title="Feeder WHs currently out of stock">
              <div className="mono" style={{ fontSize: 16, fontWeight: 700, color: "var(--critical)" }}>{stats.red}<span style={{ fontSize: 11, color: "var(--ink-4)", fontWeight: 500 }}>/{stats.ever}</span></div>
              <div className="muted" style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>OOS</div>
            </div>
            <div title="Running low — stock ≤ amber threshold or ≤ 14d cover">
              <div className="mono" style={{ fontSize: 16, fontWeight: 700, color: "var(--warning)" }}>{stats.orange}<span style={{ fontSize: 11, color: "var(--ink-4)", fontWeight: 500 }}>/{stats.ever}</span></div>
              <div className="muted" style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>low</div>
            </div>
            <div title="Healthy feeder WHs">
              <div className="mono" style={{ fontSize: 16, fontWeight: 700, color: "var(--success)" }}>{stats.healthy}<span style={{ fontSize: 11, color: "var(--ink-4)", fontWeight: 500 }}>/{stats.ever}</span></div>
              <div className="muted" style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>ok</div>
            </div>
            <div>
              <div className="mono" style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>{D.fmtN(total7d)}</div>
              <div className="muted" style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>sold 7d</div>
            </div>
            <div>
              <div className="mono" style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>{D.fmtN(total30d)}</div>
              <div className="muted" style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>sold 30d</div>
            </div>
            <div>
              <div className="mono" style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>{avgDaily30.toFixed(1)}</div>
              <div className="muted" style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>avg /d</div>
            </div>
            <div>
              <div className="mono" style={{ fontSize: 16, fontWeight: 700, color: totalDamaged > 0 ? "var(--critical)" : "var(--ink-4)" }}>{D.fmtN(totalDamaged)}</div>
              <div className="muted" style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>damaged</div>
            </div>
          </div>

          {/* Compact threshold editor — single inline row, no description block.
              Down from ~70px of vertical space to ~36px. */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", background: "var(--bg-sunken)", border: "1px solid var(--border-soft)", borderRadius: 8 }}>
            <span style={{ fontSize: 11.5, color: "var(--ink-2)" }}>
              <strong>Amber threshold:</strong>
              <span className="muted" style={{ marginLeft: 6 }}>flag a feeder WH as "low" when stock ≤</span>
            </span>
            <input
              type="number"
              className="sim-number"
              min={1} max={1000} step={1}
              value={draftThreshold}
              onChange={(e) => setDraftThreshold(parseInt(e.target.value, 10) || 0)}
              style={{ width: 64, marginLeft: "auto" }}
            />
            <button
              className="btn primary sm"
              onClick={onSaveThreshold}
              disabled={Number(draftThreshold) === threshold}
            >
              Save
            </button>
          </div>

          {/* Per-feeder-WH list — name | stock | 30d | /d | Δ biweekly | days
              Columns:
                Sold 30d : raw 30-day units (Blinkit Seller Panel export)
                /d       : sales30d ÷ 30 — feeder-WH-level velocity
                Δ 15d    : biweekly growth = last 15d vs prior 15d (sales30d−sales15d), capped ±200%
                Days     : stock ÷ /d, rounded
              Dropped "Sold 7d" — 7d total is already in the summary band; per-WH 7d
              was the noisiest column and freed the slot for velocity + growth. */}
          <div className="blk-modal-list">
            <div className="blk-modal-list-head" style={{ gridTemplateColumns: "1fr auto auto auto auto auto", gap: 12 }}>
              <span>Feeder warehouse</span>
              <span style={{ textAlign: "right", minWidth: 44 }}>Stock</span>
              <span style={{ textAlign: "right", minWidth: 50 }} title="Units sold over last 30 days at this feeder warehouse">Sold 30d</span>
              <span style={{ textAlign: "right", minWidth: 44 }} title="Per-WH daily velocity = Sold 30d ÷ 30">/d</span>
              <span style={{ textAlign: "right", minWidth: 60 }} title="Biweekly growth: last 15d vs prior 15d (sales30d − sales15d). Capped ±200%.">Δ 15d</span>
              <span style={{ textAlign: "right", minWidth: 50 }}>Days</span>
            </div>
            {rows.length === 0 && (
              <div className="muted" style={{ padding: "20px 12px", textAlign: "center" }}>
                Not launched on any Blinkit feeder warehouse yet.
              </div>
            )}
            {rows.map(({ wh, stock, sales30d, damaged, perWhVel, days, delta, severity }) => {
              const deltaColor =
                delta.tone === "up"   ? "var(--success)" :
                delta.tone === "down" ? "var(--critical)" :
                delta.tone === "flat" ? "var(--ink-3)" :
                                        "var(--ink-4)";
              return (
                <div
                  key={wh.code}
                  className={`blk-modal-row blk-modal-row-${severity}`}
                  style={{ gridTemplateColumns: "1fr auto auto auto auto auto", gap: 12, padding: "6px 14px" }}
                >
                  {/* Single-line WH name + inline code/city to free vertical
                      space (was a 2-line wh-name + subline block costing ~14px
                      per row × 12 rows). */}
                  <div className="blk-modal-row-wh" style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
                    <span className="blk-modal-row-name" style={{ whiteSpace: "nowrap" }}>{wh.name}</span>
                    <span className="sku" style={{ fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      · {wh.city}
                      {damaged > 0 && (
                        <span style={{ marginLeft: 6, color: "var(--critical)" }}>· {damaged} dmg/lost</span>
                      )}
                    </span>
                  </div>
                  <div className="blk-modal-row-stock mono">{D.fmtN(stock)}</div>
                  <div className="blk-modal-row-days mono muted" style={{ minWidth: 50, textAlign: "right" }}>
                    {sales30d > 0 ? D.fmtN(sales30d) : "—"}
                  </div>
                  <div className="blk-modal-row-days mono muted" style={{ minWidth: 44, textAlign: "right" }}>
                    {perWhVel > 0 ? perWhVel.toFixed(1) : "—"}
                  </div>
                  <div className="mono" style={{ minWidth: 60, textAlign: "right", fontSize: 11.5, color: deltaColor, fontWeight: delta.hasSignal ? 600 : 400 }}>
                    {delta.label}
                  </div>
                  <div className="blk-modal-row-days mono muted" style={{ minWidth: 50, textAlign: "right" }}>
                    {days == null ? "—" : `${days}d`}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="modal-foot">
          <span className="muted" style={{ fontSize: 11.5 }}>
            {feeders.isStub
              ? "Stub data — replaces with real Blinkit Seller Panel export when DATA-001 arrives."
              : `Source: Blinkit Seller Panel — Stock On Hand + per-WH sales (7d / 15d / 30d). /d = Sold 30d ÷ 30. Δ 15d = (last 15d − prior 15d) ÷ prior 15d, capped ±200%.`}
          </span>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Amazon FBA per-FC helpers (AMZ-003 + AMZ-004)
// ─────────────────────────────────────────────────────────────
// Maps the FC codes that appear in the Amazon ledger to a friendly name +
// city. New FCs that show up in future exports get a sensible fallback.
const AMZ_FC_META = {
  BOM5: { name: "Bhiwandi (BOM5)", city: "Mumbai"     },
  BOM7: { name: "Bhiwandi (BOM7)", city: "Mumbai"     },
  CCX1: { name: "Bhiwandi (CCX1)", city: "Mumbai"     },
  CCX2: { name: "Bhiwandi (CCX2)", city: "Mumbai"     },
  CJB1: { name: "Coimbatore",      city: "Coimbatore" },
  DED3: { name: "Delhi East 3",    city: "Delhi NCR"  },
  DED4: { name: "Delhi East 4",    city: "Delhi NCR"  },
  DEL4: { name: "Delhi NCR 4",     city: "Delhi NCR"  },
  DEL5: { name: "Delhi NCR 5",     city: "Delhi NCR"  },
  MAA4: { name: "Chennai",         city: "Chennai"    },
  PNQ3: { name: "Pune",            city: "Pune"       },
};
function amzFcMeta(code) {
  return AMZ_FC_META[code] || { name: code, city: "—" };
}

// Per-FC daily velocity for Amazon. Real per-FC velocity isn't in the
// snapshot (we only have one day of ledger), so we estimate by splitting
// the SKU's overall Amazon channel velocity EQUALLY across configured FCs.
//
// Earlier we split *proportional to stock*, which made days-of-cover collapse
// to a constant (days = stock / (vel × stock/total) = total/vel — identical
// for every FC). That was useless for spotting which FCs are at risk.
// Equal split lets days-of-cover vary with FC stock so the modal actually
// flags low-stock FCs.
function amzPerFcDailyVel(sku, fcCode) {
  const real = sku.realData?.amazon;
  if (!real?.byFc) return 0;
  const fcs = Object.keys(real.byFc);
  if (fcs.length === 0) return 0;
  const amzChVel = sku?.channelVelocity?.amazon ?? 0;
  return amzChVel / fcs.length;
}

// FC-level stats for a SKU's Amazon FBA cell. Mirrors blkFeederStats:
// "red" = OOS now, "amber" = ≤14d days-of-cover OR low absolute stock.
function amzFcStats(sku) {
  const real = sku.realData?.amazon;
  if (!real?.byFc) return { red: 0, orange: 0, healthy: 0, ever: 0, hasReal: false };
  const fcs = Object.keys(real.byFc);
  let red = 0, orange = 0;
  for (const fcCode of fcs) {
    const stock = real.byFc[fcCode]?.sellable ?? 0;
    if (stock <= 0) { red++; continue; }
    const vel = amzPerFcDailyVel(sku, fcCode);
    if (vel > 0 && stock / vel <= 14) orange++;
    else if (stock <= 10) orange++; // very low absolute threshold for FCs
  }
  return { red, orange, healthy: fcs.length - red - orange, ever: fcs.length, hasReal: true };
}

// Compact two-stat caption for the Amazon FBA cell — same shape as Blinkit.
const AmazonFcStats = ({ sku }) => {
  const { red, orange, ever, hasReal } = amzFcStats(sku);
  if (!hasReal) return <span className="muted" style={{ fontSize: 10.5 }}>—</span>;
  if (!ever)    return <span className="muted" style={{ fontSize: 10.5 }}>not on FBA</span>;
  return (
    <div className="blk-feeder-stats">
      <span className="blk-stat blk-stat-red"
        title={`${red} of ${ever} FBA fulfillment centers are out of stock right now`}>
        <span className="blk-stat-num">{red}</span>
        <span className="blk-stat-denom">/{ever}</span>
      </span>
      <span className="blk-stat blk-stat-amber"
        title={`${orange} of ${ever} FBA FCs will run out in ≤14d at their share of velocity`}>
        <span className="blk-stat-num">{orange}</span>
        <span className="blk-stat-denom">/{ever}</span>
      </span>
    </div>
  );
};

// Drill modal — Amazon channel deep-dive.
// Layout (founder priority order):
//   1. Hero metrics:        velocity (30d), MoM growth, combined runway
//   2. Channel split:       Amazon orders (agency sheet) ⊕ Shopify D2C
//                           (Shopify sheet). Both deplete FBA stock pool.
//   3. Warehouse breakdown: per-FC stock + damaged + 1-day shipped proxy.
//                           Health summary (OOS/Low/Healthy) inline above.
const AmazonFcModal = ({ sku, onClose }) => {
  const D = NSData;
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const real = sku.realData?.amazon;

  // ── Channel split derivation ───────────────────────────────────
  // sku.channelVelocity.amazon already encodes the AMZ-001 fold
  // (Amazon orders + Shopify D2C). Decompose so the two parts sum
  // back to it exactly — no drift between modal and dashboard.
  const amzChannelDaily = sku?.channelVelocity?.amazon ?? 0;
  const shopifyD2CDaily = sku?.channelVelocity?.shopify ?? 0;
  const amazonOnlyDaily = Math.max(0, amzChannelDaily - shopifyD2CDaily);

  // Where did the Amazon number come from? (Used in the channel-split
  // row's source caption — makes provenance visible to the founder.)
  const amzSourceLabel =
    sku.realData?.agency?.amazon?.dailyOut != null
      ? "Agency Channel-wise Sales Sheet"
      : real?.orders
        ? "Amazon Manage Orders feed (FBA only)"
        : (real?.totalShippedToday != null)
          ? "Amazon Warehouse-Wise Ledger (1-day proxy)"
          : "no real Amazon data";
  const shpSourceLabel =
    sku.realData?.shopify?.sales30d != null
      ? "Shopify Website Sales Sheet"
      : sku.realData?.agency?.shopify?.dailyOut != null
        ? "Agency Channel-wise Sales Sheet (Shopify row)"
        : "no real Shopify data";

  // ── Combined runway ────────────────────────────────────────────
  // FBA stock pool serves both demand streams, so runway = totalFbaStock
  // ÷ combined velocity.
  const totalFbaStock = real?.totalSellable || 0;
  const combinedRunway = amzChannelDaily > 0 ? Math.round(totalFbaStock / amzChannelDaily) : null;

  // ── MoM growth (already computed in data.js with agency precedence)
  const growthValue = sku.growth ?? null;
  const growthLabel = growthValue == null
    ? "—"
    : `${growthValue > 0 ? "+" : ""}${growthValue.toFixed(1)}%`;
  const growthColor =
    growthValue == null ? "var(--ink-4)" :
    growthValue >=  10  ? "var(--success)" :
    growthValue <= -10  ? "var(--critical)" :
                          "var(--ink-3)";

  // ── Per-FC rows (warehouse breakdown) ──────────────────────────
  const rows = real?.byFc
    ? Object.entries(real.byFc)
        .map(([fcCode, d]) => {
          const meta = amzFcMeta(fcCode);
          const stock = d.sellable || 0;
          const vel = amzPerFcDailyVel(sku, fcCode);
          let severity = "ok";
          if (stock <= 0) severity = "crit";
          else if (vel > 0 && stock / vel <= 14) severity = "warn";
          else if (stock <= 10) severity = "warn";
          return { fcCode, meta, stock, damaged: d.damaged || 0, shipped: d.shipped || 0, severity };
        })
        .sort((a, b) => a.stock - b.stock)
    : [];

  const stats = amzFcStats(sku);
  const amzShare = amzChannelDaily > 0 ? Math.round((amazonOnlyDaily / amzChannelDaily) * 100) : 0;
  const shpShare = amzChannelDaily > 0 ? Math.round((shopifyD2CDaily / amzChannelDaily) * 100) : 0;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal-card" onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(720px, 92vw)" }}>
        <div className="modal-head">
          <div>
            <div className="modal-title">
              <span style={{ background: "rgba(228, 121, 17, 0.12)", color: "#C45A0A", fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 3, marginRight: 8, letterSpacing: "0.06em" }}>AMAZON</span>
              {sku.name}
            </div>
            <div className="modal-sub sku">
              {sku.code} · {sku.variant} ·{" "}
              {real ? `live · snapshot ${D.realDataSnapshotDate}` : "no real data"}
            </div>
          </div>
          <button className="btn ghost icon" onClick={onClose} title="Close (Esc)">✕</button>
        </div>

        <div className="modal-body">
          {/* ── HERO METRICS — three cards: Velocity / MoM Growth / Runway ──
              Per founder: these are the numbers that should jump out first.
              Runway uses combined velocity (Amazon orders + Shopify D2C) over
              total FBA stock, since both demand streams pull from the same
              pool. Velocity is the 30d average. Growth is MoM (from data.js,
              with agency-sheet override applied per truth table). */}
          <div className="blk-modal-summary">
            <div className="blk-modal-summary-stat">
              <div className="blk-modal-summary-num mono" style={{ color: "var(--ink)" }}>
                {amzChannelDaily.toFixed(1)}<span className="blk-modal-summary-denom" style={{ marginLeft: 2 }}>/d</span>
              </div>
              <div className="blk-modal-summary-label">velocity · 30d avg</div>
            </div>
            <div className="blk-modal-summary-stat">
              <div className="blk-modal-summary-num mono" style={{ color: growthColor }}>{growthLabel}</div>
              <div className="blk-modal-summary-label">MoM growth</div>
            </div>
            <div className="blk-modal-summary-stat">
              <div className="blk-modal-summary-num mono" style={{ color: "var(--ink)" }}>
                {combinedRunway != null ? `${combinedRunway}d` : "—"}
              </div>
              <div className="blk-modal-summary-label">runway · combined</div>
            </div>
          </div>

          {/* ── CHANNEL SPLIT — Amazon orders + Shopify D2C ──
              Founder priority #1: see the split + the source for each leg.
              Bottom row sums both — by construction equals the Velocity hero
              card (amzChannelVel = realAmazonDaily + realShopifyDaily). */}
          <div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6, padding: "0 2px" }}>
              <strong style={{ fontSize: 13 }}>Channel split</strong>
              <span className="muted" style={{ fontSize: 11 }}>
                both streams deplete the same FBA stock pool per AMZ-001
              </span>
            </div>
            <div className="blk-modal-list">
              <div className="blk-modal-list-head" style={{ gridTemplateColumns: "1fr auto auto auto" }}>
                <span>Source</span>
                <span style={{ textAlign: "right", minWidth: 60 }}>30d units</span>
                <span style={{ textAlign: "right", minWidth: 56 }}>/d avg</span>
                <span style={{ textAlign: "right", minWidth: 52 }}>Share</span>
              </div>
              <div className="blk-modal-row" style={{ gridTemplateColumns: "1fr auto auto auto" }}>
                <div className="blk-modal-row-wh">
                  <div className="blk-modal-row-name">Amazon orders</div>
                  <div className="sku" style={{ fontSize: 10.5 }}>from {amzSourceLabel}</div>
                </div>
                <div className="blk-modal-row-stock mono" style={{ minWidth: 60 }}>{D.fmtN(Math.round(amazonOnlyDaily * 30))}</div>
                <div className="mono" style={{ minWidth: 56, textAlign: "right", color: "var(--ink-2)" }}>{amazonOnlyDaily.toFixed(1)}</div>
                <div className="mono muted" style={{ minWidth: 52, textAlign: "right", fontSize: 11.5 }}>{amzShare}%</div>
              </div>
              <div className="blk-modal-row" style={{ gridTemplateColumns: "1fr auto auto auto" }}>
                <div className="blk-modal-row-wh">
                  <div className="blk-modal-row-name">Shopify D2C</div>
                  <div className="sku" style={{ fontSize: 10.5 }}>from {shpSourceLabel}</div>
                </div>
                <div className="blk-modal-row-stock mono" style={{ minWidth: 60 }}>{D.fmtN(Math.round(shopifyD2CDaily * 30))}</div>
                <div className="mono" style={{ minWidth: 56, textAlign: "right", color: "var(--ink-2)" }}>{shopifyD2CDaily.toFixed(1)}</div>
                <div className="mono muted" style={{ minWidth: 52, textAlign: "right", fontSize: 11.5 }}>{shpShare}%</div>
              </div>
              <div className="blk-modal-row" style={{ gridTemplateColumns: "1fr auto auto auto", background: "var(--bg-sunken)", borderTop: "1px solid var(--border)" }}>
                <div className="blk-modal-row-wh">
                  <div className="blk-modal-row-name" style={{ fontWeight: 600 }}>Combined Amazon channel</div>
                  <div className="sku" style={{ fontSize: 10.5 }}>matches the velocity card above</div>
                </div>
                <div className="blk-modal-row-stock mono" style={{ minWidth: 60, fontWeight: 700 }}>{D.fmtN(Math.round(amzChannelDaily * 30))}</div>
                <div className="mono" style={{ minWidth: 56, textAlign: "right", color: "var(--ink)", fontWeight: 700 }}>{amzChannelDaily.toFixed(1)}</div>
                <div className="mono" style={{ minWidth: 52, textAlign: "right", fontSize: 11.5, color: "var(--ink-3)" }}>100%</div>
              </div>
            </div>
          </div>

          {/* ── WAREHOUSE BREAKDOWN — secondary section ──
              Founder said "if time allows" — keeping it visible but with a
              demoted heading. Health summary (OOS/Low/Healthy) folded inline
              into the section header instead of three separate cards. */}
          {real && (
            <div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6, padding: "0 2px" }}>
                <strong style={{ fontSize: 13 }}>Warehouse breakdown</strong>
                <span className="muted" style={{ fontSize: 11 }}>
                  <span style={{ color: "var(--critical)", fontWeight: 600 }}>{stats.red}</span> OOS ·{" "}
                  <span style={{ color: "var(--warning)", fontWeight: 600 }}>{stats.orange}</span> low ·{" "}
                  <span style={{ color: "var(--success)", fontWeight: 600 }}>{stats.healthy}</span> healthy{" "}
                  of {stats.ever} FCs
                </span>
              </div>
              <div className="blk-modal-list">
                <div className="blk-modal-list-head" style={{ gridTemplateColumns: "1fr auto auto" }}>
                  <span>Fulfillment center</span>
                  <span style={{ textAlign: "right" }}>Stock</span>
                  <span style={{ textAlign: "right" }}>Shipped*</span>
                </div>
                {rows.length === 0 && (
                  <div className="muted" style={{ padding: "20px 12px", textAlign: "center" }}>
                    Not active on any Amazon FBA fulfillment center.
                  </div>
                )}
                {rows.map(({ fcCode, meta, stock, damaged, shipped, severity }) => (
                  <div key={fcCode} className={`blk-modal-row blk-modal-row-${severity}`} style={{ gridTemplateColumns: "1fr auto auto" }}>
                    <div className="blk-modal-row-wh">
                      <div className="blk-modal-row-name">{meta.name}</div>
                      <div className="sku" style={{ fontSize: 10.5 }}>
                        {fcCode} · {meta.city}
                        {damaged > 0 && <span style={{ marginLeft: 6, color: "var(--critical)" }}>· {damaged} damaged</span>}
                      </div>
                    </div>
                    <div className="blk-modal-row-stock mono">{D.fmtN(stock)}</div>
                    <div className="blk-modal-row-days mono muted">{shipped > 0 ? `+${shipped}` : "—"}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="modal-foot">
          <span className="muted" style={{ fontSize: 11.5 }}>
            {real
              ? `Velocity = combined Amazon channel /day. Runway = total FBA stock ÷ combined velocity. MoM growth from data.js (agency-sheet override applied per truth table). Channel split sources cited inline. *Shipped column = one day's customer shipments per FC (multi-day per-FC ledger awaits historical exports).`
              : "No Amazon FBA data — stub fallback in use."}
          </span>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Flipkart drill (FK-001)
// ─────────────────────────────────────────────────────────────
// Flipkart only has one warehouse (gur_san_wh_nl_01nl, Gurgaon Sandila NL)
// for our account so the per-WH OOS-count pattern doesn't apply. Instead
// the cell shows a compact health pill and the drill modal shows the
// 5-window sales trend + reserved/scheduled + F-Assured + real price.
const FlipkartHealthPill = ({ sku }) => {
  const fk = sku.realData?.flipkart;
  if (!fk) return <span className="muted" style={{ fontSize: 10.5 }}>—</span>;
  const live = fk.live || 0;
  const daily30 = (fk.sales30d || 0) / 30;
  const days = daily30 > 0 ? Math.floor(live / daily30) : null;
  let tier = "ok", label = "healthy";
  if (live <= 0) { tier = "red";   label = "out of stock"; }
  else if (days != null && days <= 7)  { tier = "red";   label = `${days}d cover`; }
  else if (days != null && days <= 21) { tier = "amber"; label = `${days}d cover`; }
  return (
    <div className="blk-feeder-stats">
      <span className={`blk-stat blk-stat-${tier === "ok" ? "amber" : tier}`}
        style={tier === "ok" ? { background: "rgba(63, 114, 80, 0.10)", borderColor: "rgba(63, 114, 80, 0.32)", color: "var(--success)" } : {}}
        title={`Live: ${live} units · 30-day sales: ${fk.sales30d} · ${days != null ? `${days}d cover` : "—"}`}>
        <span className="blk-stat-num" style={{ fontFamily: "var(--sans)", fontSize: 9.5, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>{label}</span>
      </span>
      {fk.isFAssured && (
        <span className="blk-stub-badge"
          style={{ background: "rgba(40, 116, 240, 0.10)", borderStyle: "solid", borderColor: "rgba(40, 116, 240, 0.32)", color: "#2874F0" }}
          title="F-Assured badge active">F-ASSR</span>
      )}
    </div>
  );
};

const FlipkartDrillModal = ({ sku, onClose }) => {
  const D = NSData;
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fk = sku.realData?.flipkart;
  if (!fk) return null;

  // Average daily sales across 5 windows. Each value = total / window-days.
  const windows = [
    { label: "7d",  days:  7, total: fk.sales7d  },
    { label: "14d", days: 14, total: fk.sales14d },
    { label: "30d", days: 30, total: fk.sales30d },
    { label: "60d", days: 60, total: fk.sales60d },
    { label: "90d", days: 90, total: fk.sales90d },
  ].map(w => ({ ...w, daily: w.total / w.days }));
  const maxDaily = Math.max(0.1, ...windows.map(w => w.daily));

  const live = fk.live || 0;
  const daily30 = (fk.sales30d || 0) / 30;
  const daily60 = (fk.sales60d || 0) / 60;
  const days = daily30 > 0 ? Math.floor(live / daily30) : null;
  const trend7vs30 = windows[0].daily - windows[2].daily; // 7d daily vs 30d daily
  const trendPct = windows[2].daily > 0 ? (trend7vs30 / windows[2].daily) * 100 : 0;
  // MoM growth: cur 30d daily vs prior 30d daily (sales60d − sales30d ÷ 30).
  // Same shape as the dashboard's overall MoM. Capped ±200%.
  const prior30Daily = ((fk.sales60d || 0) - (fk.sales30d || 0)) / 30;
  let momPct = null;
  if (prior30Daily > 0)       momPct = Math.max(-100, Math.min(200, ((daily30 - prior30Daily) / prior30Daily) * 100));
  else if (daily30 > 0)       momPct = 200;
  const momLabel = momPct == null ? "—" :
    momPct >= 200 ? "+new" :
    `${momPct > 0 ? "+" : momPct < 0 ? "−" : ""}${Math.abs(Math.round(momPct))}%`;
  const momColor = momPct == null ? "var(--ink-4)" :
    momPct >=  10 ? "var(--success)" :
    momPct <= -10 ? "var(--critical)" :
                    "var(--ink-3)";

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal-card" onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(680px, 92vw)" }}>
        <div className="modal-head">
          <div>
            <div className="modal-title">
              <span style={{ background: "rgba(40, 116, 240, 0.12)", color: "#2874F0", fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 3, marginRight: 8, letterSpacing: "0.06em" }}>FLIPKART</span>
              {sku.name}
            </div>
            <div className="modal-sub sku">
              {sku.code} · {sku.variant} · live · snapshot {D.realDataSnapshotDate}
            </div>
          </div>
          <button className="btn ghost icon" onClick={onClose} title="Close (Esc)">✕</button>
        </div>

        <div className="modal-body">
          {/* Hero summary — velocity + MoM growth are the headline metrics
              per founder. Reserved / Live / Damaged etc. are still shown
              below in the inventory state table for completeness. */}
          <div className="blk-modal-summary">
            <div className="blk-modal-summary-stat">
              <div className="blk-modal-summary-num mono" style={{ color: "var(--ink)" }}>{daily30.toFixed(1)}<span className="blk-modal-summary-denom" style={{ marginLeft: 2 }}>/d</span></div>
              <div className="blk-modal-summary-label">velocity · 30d avg</div>
            </div>
            <div className="blk-modal-summary-stat">
              <div className="blk-modal-summary-num mono" style={{ color: momColor }}>{momLabel}</div>
              <div className="blk-modal-summary-label">MoM growth</div>
            </div>
            <div className="blk-modal-summary-stat">
              <div className="blk-modal-summary-num mono" style={{ color: "var(--ink)" }}>
                {days != null ? `${days}d` : "—"}
              </div>
              <div className="blk-modal-summary-label">days of cover</div>
            </div>
          </div>

          {/* Sales trend across 5 windows */}
          <div className="blk-modal-threshold" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
            <div className="blk-modal-threshold-label">
              <strong>Sales velocity trend</strong>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                Average daily units sold across rolling windows. {Math.abs(trendPct) >= 5
                  ? `7-day pace is ${trendPct > 0 ? "+" : ""}${trendPct.toFixed(0)}% vs the 30-day average — ${trendPct > 0 ? "accelerating" : "decelerating"}.`
                  : "7-day pace is stable vs 30-day average."}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
              {windows.map(w => {
                const heightPx = Math.max(4, Math.round((w.daily / maxDaily) * 60));
                return (
                  <div key={w.label} style={{ textAlign: "center" }}>
                    <div style={{ height: 60, display: "flex", alignItems: "flex-end", justifyContent: "center", marginBottom: 4 }}>
                      <div style={{
                        width: "60%",
                        height: heightPx,
                        background: "linear-gradient(180deg, #2874F0 0%, rgba(40, 116, 240, 0.5) 100%)",
                        borderRadius: "3px 3px 0 0",
                      }}/>
                    </div>
                    <div className="mono" style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>{w.daily.toFixed(1)}</div>
                    <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em" }}>{w.label} avg</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Inventory state detail */}
          <div className="blk-modal-list">
            <div className="blk-modal-list-head" style={{ gridTemplateColumns: "1fr auto" }}>
              <span>State</span>
              <span style={{ textAlign: "right" }}>Units</span>
            </div>
            {[
              { label: "Live on website",       value: fk.live              },
              { label: "Reserved (orders)",     value: fk.reservedOrders    },
              { label: "Reserved (internal)",   value: fk.reservedInt       },
              { label: "Incoming transfers",    value: fk.transferIncoming  },
              { label: "Damaged",               value: fk.damaged           , danger: true },
            ].map(({ label, value, danger }) => (
              <div key={label} className="blk-modal-row" style={{ gridTemplateColumns: "1fr auto", padding: "9px 14px" }}>
                <div className="blk-modal-row-name">{label}</div>
                <div className="blk-modal-row-stock mono" style={{ color: danger && value > 0 ? "var(--critical)" : "var(--ink)", fontWeight: value > 0 ? 600 : 400 }}>{D.fmtN(value)}</div>
              </div>
            ))}
          </div>

          {/* Pricing + meta */}
          <div className="blk-modal-threshold" style={{ alignItems: "flex-start" }}>
            <div className="blk-modal-threshold-label" style={{ flex: 1 }}>
              <strong>Selling price</strong>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                Listed price on Flipkart · {fk.fulfilmentType || "—"}
                {fk.isFAssured && <span style={{ marginLeft: 6, color: "#2874F0", fontWeight: 600 }}>· F-Assured</span>}
              </div>
            </div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)" }}>
              ₹{D.fmtN(fk.sellingPrice)}
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <span className="muted" style={{ fontSize: 11.5 }}>
            Source: Flipkart Seller Hub "Current Inventory" export · single WH (Gurgaon {fk.warehouseId})
          </span>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
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
  // Velocity floor — anything below this hides the runway pill. Tunable
  // from Inventory → Formulas (default 0.05 / matches 1-dp display).
  const floor = readParam("velocityFloor");
  const hasVel = velocity != null && velocity > floor;
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
  const [blinkitDrillSku,  setBlinkitDrillSku]  = useState(null);
  const [amazonDrillSku,   setAmazonDrillSku]   = useState(null);
  const [flipkartDrillSku, setFlipkartDrillSku] = useState(null);
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
            {topMover ? `${D.fmtN(topMover.velocity)}/d` : "—"}
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
              const flipkartVel   = s.velocity * ((sp.flipkart || 0) / revTotal);
              const blinkitVel    = s.velocity * ((sp.blinkit  || 0) / revTotal);
              // Round each leg to 1dp so floating-point residuals (channels
              // summing to s.velocity within 1e-15) don't leave a near-zero
              // warehouse velocity that produces 18-digit runway days when
              // divided into the central WH stock.
              const r1 = (n) => Math.round((n || 0) * 10) / 10;
              const vel = {
                amazonFBA: r1(amazonOwnVel + shopifyOwnVel),
                flipkart:  r1(flipkartVel),
                blinkit:   r1(blinkitVel),
                // WH velocity for the Unified-Stock display = total SKU velocity.
                // i.e. "if marketplaces emptied and WH had to supply all demand
                // alone, here's the drain rate". Gives every SKU a meaningful
                // WH runway pill instead of the near-zero "WH-direct only"
                // number (which was 0 for any SKU with full marketplace
                // coverage). The cascade math in data.js / runwayCascade.js
                // still uses the strict WH-direct velocity — this override is
                // display-only.
                warehouse: r1(s.velocity),
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
                  {/* AMZ-001 + AMZ-003 + AMZ-004: Amazon cell mirrors the
                      Warehouse template (stock hero + runway/vel/growth row)
                      with the velocity split as `a + b` — `a` = Amazon-direct
                      orders/day, `b` = Shopify D2C orders/day. Both demand
                      streams pull from the same FBA stock pool, so the stock
                      number is single (not split). Per-FC OOS detail lives in
                      the drill modal (click anywhere on the cell). */}
                  <td
                    className={"num mat-cell" + (s.realData?.amazon ? " blk-cell" : "")}
                    onClick={(e) => {
                      if (!s.realData?.amazon) return;
                      e.stopPropagation();
                      setAmazonDrillSku(s);
                    }}
                  >
                    <PlatformCell
                      units={s.stock.amazonFBA}
                      breakdown={
                        <>
                          <span className="pf-cell-bd-num mono">{amazonOwnVel.toFixed(1)}</span>
                          <span className="pf-cell-bd-tag">amz</span>
                          <span className="pf-cell-bd-op">+</span>
                          <span className="pf-cell-bd-num mono">{shopifyOwnVel.toFixed(1)}</span>
                          <span className="pf-cell-bd-tag">d2c</span>
                        </>
                      }
                      breakdownLabel={`Amazon channel = Amazon orders (${amazonOwnVel.toFixed(1)}/d) + Shopify D2C (${shopifyOwnVel.toFixed(1)}/d) — both ship from FBA. Click for per-FC breakdown.`}
                      velocity={vel.amazonFBA}
                      growth={s.growth}
                    />
                  </td>
                  {/* FK-001: Flipkart cell. Stock hero shows real "listed
                      quantity" from the FK Seller Hub export, NOT the bundled
                      stub split. Important caveat: Flipkart inventory lives at
                      our central WH (gur_san_wh_nl_01nl IS the central WH) —
                      it's the same physical pool, not a separate location. We
                      annotate with "@ central WH" to make the dependency clear.
                      Velocity + growth are the actually-actionable numbers. */}
                  <td
                    className={"num mat-cell" + (s.realData?.flipkart ? " blk-cell" : "")}
                    onClick={(e) => {
                      if (!s.realData?.flipkart) return;
                      e.stopPropagation();
                      setFlipkartDrillSku(s);
                    }}
                  >
                    <PlatformCell
                      units={s.realData?.flipkart?.live ?? null}
                      breakdown={
                        s.realData?.flipkart
                          ? <span style={{ fontSize: 10, color: "var(--ink-3)", letterSpacing: "0.01em" }}>@ central WH</span>
                          : null
                      }
                      breakdownLabel="Listed on Flipkart — physically stored at central WH (gur_san_wh_nl_01nl). The Central Warehouse column already includes this stock; not a separate location."
                      velocity={vel.flipkart}
                      growth={s.growth}
                    />
                  </td>
                  <td className="num mat-cell blk-cell" onClick={(e) => { e.stopPropagation(); setBlinkitDrillSku(s); }}>
                    {/* BLK-001 + BLK-002: stock headline + a/b feeder-WH counts
                        (red OOS / amber OOS-soon over total launched). Whole
                        cell clickable → drill modal. */}
                    <div className="pf-cell">
                      <div className="pf-cell-units-row">
                        <div className="pf-cell-units mono">{D.fmtN(s.stock.blinkit)}</div>
                      </div>
                      <BlinkitFeederStats
                        feeders={s.blinkitFeeders}
                        sku={s}
                        threshold={readBlkThreshold(s.code)}
                      />
                    </div>
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
            Stock + velocity now drawn from real marketplace exports (snapshot {NSData.realDataSnapshotDate}) —
            Flipkart + Blinkit use 30-day sales averages, Shopify uses website 30-day totals, Amazon FBA uses
            the latest day's customer shipments as a daily proxy (multi-day ledger will refine). MoM growth
            is derived from Shopify 30d vs prior-30d (60d window split). <strong>Flipkart inventory is the
            seller-hub "listed quantity" — physically stored at our central WH (gur_san_wh_nl_01nl), already
            included in the Central Warehouse column.</strong> Click any cell to drill into per-WH stock. For the
            FG / Semi-FG / Raw / Packaging split, click any Item row or {" "}
            <button className="link-btn" onClick={() => navigate("/inventory/materials")}>
              open the Materials breakdown
            </button>.
          </span>
        </div>
      </Card>

      {popoverSku && (
        <SkuBreakdownModal sku={popoverSku} onClose={() => setPopoverSku(null)}/>
      )}
      {blinkitDrillSku && (
        <BlinkitFeederModal sku={blinkitDrillSku} onClose={() => setBlinkitDrillSku(null)}/>
      )}
      {amazonDrillSku && (
        <AmazonFcModal sku={amazonDrillSku} onClose={() => setAmazonDrillSku(null)}/>
      )}
      {flipkartDrillSku && (
        <FlipkartDrillModal sku={flipkartDrillSku} onClose={() => setFlipkartDrillSku(null)}/>
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
            <col className="col-num"/>   {/* Produced FG */}
            <col className="col-num"/>   {/* Semi-FG    */}
            <col className="col-num"/>   {/* Raw        */}
            <col className="col-pkg"/>   {/* Packaging — wider to fit PKG names like "Moringa Powder Empty Pouch 100g" */}
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

// ── TargetCoverEditor — per-SKU "desired stock level" input ──────────
// Lets the user set how many days of cover this SKU should always carry.
// The Forecast tab's `required` formula (and the reorder-qty it derives)
// adds this many days on top of the forecast horizon. Default 30d, range
// 7–180d. Persisted in localStorage via skuTargets.js (same pattern as
// the Blinkit per-SKU amber threshold).
const TargetCoverEditor = ({ sku }) => {
  const [saved, setSaved] = useState(() => readTargetDays(sku.code));
  const [draft, setDraft] = useState(saved);
  const cover = sku.velocity > 0 ? Math.round((sku.velocity * draft)) : 0;
  const onSave = () => {
    const v = Math.max(1, Math.min(365, parseInt(draft, 10) || DEFAULT_TARGET_DAYS));
    writeTargetDays(sku.code, v);
    setSaved(v);
    setDraft(v);
  };
  const onReset = () => {
    writeTargetDays(sku.code, DEFAULT_TARGET_DAYS);
    setSaved(DEFAULT_TARGET_DAYS);
    setDraft(DEFAULT_TARGET_DAYS);
  };
  return (
    <div className="blk-modal-threshold" style={{ marginTop: 12 }}>
      <div className="blk-modal-threshold-label">
        <strong>Desired stock cover</strong>
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
          How many days of demand this SKU should always have in stock. The Forecast tab adds this on top of the forecast horizon when sizing the reorder quantity. Default is {DEFAULT_TARGET_DAYS} days.
          {saved !== DEFAULT_TARGET_DAYS && (
            <span style={{ marginLeft: 6 }}>
              · ≈ {NSData.fmtN(cover)} units at current velocity
            </span>
          )}
        </div>
      </div>
      <div className="blk-modal-threshold-controls">
        <input
          type="number"
          className="sim-number"
          min={7} max={180} step={1}
          value={draft}
          onChange={(e) => setDraft(parseInt(e.target.value, 10) || 0)}
          style={{ width: 70 }}
        />
        <span className="muted" style={{ fontSize: 11 }}>days</span>
        <button
          className="btn primary sm"
          onClick={onSave}
          disabled={Number(draft) === saved || !draft}
        >
          Save
        </button>
        {saved !== DEFAULT_TARGET_DAYS && (
          <button className="btn ghost sm" onClick={onReset} title="Reset to default 30 days">Reset</button>
        )}
      </div>
    </div>
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
              const hasVel = ch.vel > readParam("velocityFloor");
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
              <dt>FG stock value <FormulaIcon formulaId="stockValue" currentValue={D.fmtINR(wb.fg * unitCost)} valueLabel="Current (WH only)"/></dt>
              <dd>{D.fmtINR(wb.fg * unitCost)}</dd>
              <dt>Rolling daily velocity <FormulaIcon formulaId="velocity" skuCode={sku.code} skuField="velocity" currentValue={`${D.fmtN(sku.velocity)} /day`}/></dt>
              <dd>{D.fmtN(sku.velocity)} units/day</dd>
              <dt>Runway (central warehouse FG) <FormulaIcon formulaId="runway" currentValue={`${Math.round(wb.fg / sku.velocity)} days`}/></dt>
              <dd>{Math.round(wb.fg / sku.velocity)} days</dd>
              <dt>Supplier lead time <FormulaIcon formulaId="leadTime" skuCode={sku.code} skuField="leadTime" currentValue={`${sku.leadTime} days`}/></dt>
              <dd>{sku.leadTime} days</dd>
              <dt>MoM growth <FormulaIcon formulaId="growth" skuCode={sku.code} skuField="growth" currentValue={`${sku.growth > 0 ? "+" : ""}${sku.growth.toFixed(1)}%`}/></dt>
              <dd>{sku.growth > 0 ? "+" : ""}{sku.growth.toFixed(1)}%</dd>
            </dl>
          </div>

          {/* Per-SKU desired stock level (days of cover) — drives the
              Forecast tab's reorder-qty recommendation. Defaults to 30
              days; persisted per-SKU in localStorage. */}
          <TargetCoverEditor sku={sku}/>
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

// ── Simulator tab — full sandbox.
// Sprint 3 model (per founder spec):
//   - Central WH stock + per-marketplace stock (Amazon FBA / Flipkart / Blinkit)
//   - Velocity: overall OR split per channel (nested — see velocityMode)
//   - MoM % growth: same nested pattern as velocity
//   - Input (SFG or RM) + multiple PKG components with per-component qty
//   - Supplier lead time per component AND marketplace inbound lead time
//   - Total runway uses parallel cascade (lib/runwayCascade.js)
//   - Amazon channel = Amazon orders + Shopify orders combined (AMZ-001)
//
// Marketplace inbound lead times (SIM-014-DATA — founder-confirmed 31-May-2026).
// Days from "decide to ship" → "marketplace warehouse has it available to sell".
const MP_INBOUND_LEAD_DEFAULT = { amazonFBA: 14, flipkart: 3, blinkit: 8 };

const SimulatorTab = ({ inventory }) => {
  const D = NSData;
  const [selectedCode, setSelectedCode] = useState(inventory[0]?.code);
  const baseline = inventory.find(i => i.code === selectedCode) || inventory[0];

  // ── Build the sandbox state from the selected SKU's snapshot ──
  function baselineState(s) {
    if (!s) return null;
    const wb = s.warehouseBreakdown || {};
    const cv = s.channelVelocity || { amazon: 0, flipkart: 0, blinkit: 0 };
    const sp = s.splits || {};
    const revTotal = (sp.amazon || 0) + (sp.shopify || 0) + (sp.flipkart || 0) + (sp.blinkit || 0) || 1;
    const amazonOnly  = s.velocity * ((sp.amazon  || 0) / revTotal);
    const shopifyOnly = s.velocity * ((sp.shopify || 0) / revTotal);
    const flipkartVel = s.velocity * ((sp.flipkart || 0) / revTotal);
    const blinkitVel  = s.velocity * ((sp.blinkit  || 0) / revTotal);
    const whVel = Math.max(0, s.velocity - (amazonOnly + shopifyOnly + flipkartVel + blinkitVel));
    return {
      // Stock per channel
      fg:        wb.fg ?? s.stock?.warehouse ?? 0,
      stockAmz:  s.stock?.amazonFBA ?? 0,
      stockFk:   s.stock?.flipkart  ?? 0,
      stockBl:   s.stock?.blinkit   ?? 0,
      // Velocity (overall + per-channel; amazonOnly + shopifyOnly stored
      // separately so AMZ-001 split display stays accurate even if user
      // edits the combined Amazon channel velocity)
      velMode:      "overall",   // "overall" | "perChannel"
      velOverall:   s.velocity || 0,
      velAmzOwn:    amazonOnly,
      velShpOwn:    shopifyOnly,
      velFk:        flipkartVel,
      velBl:        blinkitVel,
      velWh:        whVel,
      // Growth (overall + per-channel) — currently flat per-SKU growth
      // applied to all channels; once per-channel growth data lands, swap
      // these initial values.
      growthMode:   "overall",
      growthOverall: s.growth ?? 0,
      growthAmz:    s.growth ?? 0,
      growthFk:     s.growth ?? 0,
      growthBl:     s.growth ?? 0,
      growthWh:     s.growth ?? 0,
      // Input (SFG or RM — exactly one per SKU). Lead time defaults to the
      // component's own value from COMPONENT_LEAD_TIMES (SIM-016-DATA), falls
      // back to the SKU's lead time if unmapped.
      inputKind:    wb.kind || "raw",
      inputQty:     (wb.inputs?.sfg || wb.inputs?.rm)?.qty ?? 0,
      inputName:    (wb.inputs?.sfg || wb.inputs?.rm)?.name || "—",
      inputUnit:    (wb.inputs?.sfg || wb.inputs?.rm)?.unit || "units",
      inputPerPack: (wb.inputs?.sfg || wb.inputs?.rm)?.perPack || 1,
      inputLead:    (wb.inputs?.sfg || wb.inputs?.rm)?.leadTime ?? s.leadTime ?? 21,
      // Packaging components — per-component lead time from
      // COMPONENT_LEAD_TIMES (default 14d for every PKG today).
      pkg: (wb.inputs?.pkg || []).map(p => ({
        refCode:      p.refCode,
        name:         p.name,
        unit:         p.unit,
        qty:          p.qty,
        unitsPerPack: p.unitsPerPack,
        leadTime:     p.leadTime ?? s.leadTime ?? 21,
      })),
      // Lead times
      leadAmzInbound: MP_INBOUND_LEAD_DEFAULT.amazonFBA,
      leadFkInbound:  MP_INBOUND_LEAD_DEFAULT.flipkart,
      leadBlInbound:  MP_INBOUND_LEAD_DEFAULT.blinkit,
      supplierLead:   s.leadTime ?? 21,
    };
  }

  const [sim, setSim] = useState(() => baselineState(baseline));
  useEffect(() => { setSim(baselineState(baseline)); }, [selectedCode]);

  const reset = () => setSim(baselineState(baseline));
  const setOne = (k, v) => setSim(prev => ({ ...prev, [k]: v }));
  const setPkg = (idx, k, v) => setSim(prev => {
    const next = [...prev.pkg];
    next[idx] = { ...next[idx], [k]: v };
    return { ...prev, pkg: next };
  });

  // ── Derived velocity values respecting nested mode ──
  // In "overall" mode the marketplace values come from the proportional split
  // of velOverall. In "perChannel" mode the marketplace values are user-edited
  // directly and velOverall is recomputed as their sum.
  const baseRecord = baselineState(baseline);
  const baseSplit = baseRecord ? {
    amz: baseRecord.velAmzOwn + baseRecord.velShpOwn,
    fk:  baseRecord.velFk,
    bl:  baseRecord.velBl,
    wh:  baseRecord.velWh,
  } : { amz: 0, fk: 0, bl: 0, wh: 0 };
  const baseSplitTotal = baseSplit.amz + baseSplit.fk + baseSplit.bl + baseSplit.wh || 1;

  let effVel;
  if (sim.velMode === "perChannel") {
    const amzCombined = sim.velAmzOwn + sim.velShpOwn;
    effVel = {
      amz: amzCombined,
      fk:  sim.velFk,
      bl:  sim.velBl,
      wh:  sim.velWh,
      overall: amzCombined + sim.velFk + sim.velBl + sim.velWh,
    };
  } else {
    // proportional split of velOverall by the baseline channel mix
    const scale = sim.velOverall / baseSplitTotal;
    effVel = {
      amz: baseSplit.amz * scale,
      fk:  baseSplit.fk  * scale,
      bl:  baseSplit.bl  * scale,
      wh:  baseSplit.wh  * scale,
      overall: sim.velOverall,
    };
  }

  // Effective growth (per channel) using same nested model
  const effGrowth = sim.growthMode === "perChannel"
    ? { amz: sim.growthAmz, fk: sim.growthFk, bl: sim.growthBl, wh: sim.growthWh, overall: (sim.growthAmz + sim.growthFk + sim.growthBl + sim.growthWh) / 4 }
    : { amz: sim.growthOverall, fk: sim.growthOverall, bl: sim.growthOverall, wh: sim.growthOverall, overall: sim.growthOverall };

  // Velocity after growth applied per channel (vel × (1 + g/100))
  const projVel = {
    amz: effVel.amz * (1 + effGrowth.amz / 100),
    fk:  effVel.fk  * (1 + effGrowth.fk  / 100),
    bl:  effVel.bl  * (1 + effGrowth.bl  / 100),
    wh:  effVel.wh  * (1 + effGrowth.wh  / 100),
  };

  // ── Producible FG = min(input pack-equivalents, every PKG pack-equiv) ──
  const inputPackEq = sim.inputPerPack > 0 ? Math.floor(sim.inputQty / sim.inputPerPack) : 0;
  const pkgCaps = sim.pkg.map(p => p.unitsPerPack > 0 ? Math.floor(p.qty / p.unitsPerPack) : 0);
  const producibleFg = pkgCaps.length
    ? Math.min(inputPackEq, ...pkgCaps)
    : inputPackEq;
  const maxFg = sim.fg + producibleFg;  // Total (WH)

  // ── Cascade runway across channels + central WH ──
  const cascade = computeCascade({
    whStock: maxFg,
    whBaseVelocity: projVel.wh,
    channels: [
      { key: "amazon",   label: "Amazon FBA", stock: sim.stockAmz, velocity: projVel.amz },
      { key: "flipkart", label: "Flipkart",   stock: sim.stockFk,  velocity: projVel.fk  },
      { key: "blinkit",  label: "Blinkit",    stock: sim.stockBl,  velocity: projVel.bl  },
    ],
  });
  const runway = Number.isFinite(cascade.totalRunway) ? Math.round(cascade.totalRunway) : 0;
  const status = runway <= sim.supplierLead ? "red" : runway < 30 ? "amber" : "green";
  const reorderByDays = runway - sim.supplierLead;
  const overdue = reorderByDays < 0;

  // Bottleneck for producible FG — which input row caps us?
  const bottleneckIdx = pkgCaps.length ? (() => {
    if (inputPackEq <= Math.min(...pkgCaps)) return -1;  // input is the bottleneck
    let idx = 0; let lo = Infinity;
    pkgCaps.forEach((c, i) => { if (c < lo) { lo = c; idx = i; } });
    return idx;
  })() : (inputPackEq > 0 ? -1 : null);
  const bottleneckLabel = bottleneckIdx === null ? "—"
    : bottleneckIdx === -1 ? (sim.inputKind === "semi" ? "SFG" : "RM")
    : `PKG${bottleneckIdx + 1}`;

  // ── isDelta — modified-from-baseline check, used for the reset pills ──
  const isDelta = (path) => {
    const base = baseRecord;
    if (!base) return false;
    if (Array.isArray(path)) {
      // path like ['pkg', idx, 'qty']
      const [, idx, k] = path;
      return sim.pkg[idx]?.[k] !== base.pkg[idx]?.[k];
    }
    return sim[path] !== base[path];
  };

  // ── Slider scale helpers ──
  const fgMax = Math.max(2000, Math.round((baseRecord?.fg || 100) * 5));

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
            {/* ── STOCK section ── */}
            <SimSection title="Stock on hand" hint="How many units sit in each location right now.">
              <SimRow label="Central warehouse · Produced FG" unit="units"
                value={sim.fg} onChange={v => setOne("fg", v)}
                min={0} max={fgMax} step={1}
                base={baseRecord?.fg} delta={isDelta("fg")}
                onReset={() => setOne("fg", baseRecord.fg)}/>
              <SimRow label="Amazon FBA stock" unit="units"
                value={sim.stockAmz} onChange={v => setOne("stockAmz", v)}
                min={0} max={Math.max(2000, baseRecord?.stockAmz * 5 || 500)} step={1}
                base={baseRecord?.stockAmz} delta={isDelta("stockAmz")}
                onReset={() => setOne("stockAmz", baseRecord.stockAmz)}/>
              <SimRow label="Flipkart stock" unit="units"
                value={sim.stockFk} onChange={v => setOne("stockFk", v)}
                min={0} max={Math.max(2000, baseRecord?.stockFk * 5 || 500)} step={1}
                base={baseRecord?.stockFk} delta={isDelta("stockFk")}
                onReset={() => setOne("stockFk", baseRecord.stockFk)}/>
              <SimRow label="Blinkit stock" unit="units"
                value={sim.stockBl} onChange={v => setOne("stockBl", v)}
                min={0} max={Math.max(2000, baseRecord?.stockBl * 5 || 500)} step={1}
                base={baseRecord?.stockBl} delta={isDelta("stockBl")}
                onReset={() => setOne("stockBl", baseRecord.stockBl)}/>
            </SimSection>

            {/* ── VELOCITY section (nested) ── */}
            <SimSection
              title="Daily velocity"
              hint="Set one overall number, or switch to per-channel to control each marketplace independently."
              right={
                <SimToggle
                  value={sim.velMode}
                  onChange={(v) => setOne("velMode", v)}
                  options={[{ value: "overall", label: "Overall" }, { value: "perChannel", label: "Per-channel" }]}
                />
              }>
              {sim.velMode === "overall" ? (
                <SimRow label="Total velocity (auto-splits proportionally)" unit="/day"
                  value={sim.velOverall} onChange={v => setOne("velOverall", v)}
                  min={0} max={500} step={1}
                  base={baseRecord?.velOverall} delta={isDelta("velOverall")}
                  onReset={() => setOne("velOverall", baseRecord.velOverall)}
                  hint={`Split: amz ${effVel.amz.toFixed(1)} · fk ${effVel.fk.toFixed(1)} · bl ${effVel.bl.toFixed(1)} · wh ${effVel.wh.toFixed(1)}`}/>
              ) : (
                <>
                  <SimRow label="Amazon FBA (incl. Shopify D2C)" unit="/day"
                    value={sim.velAmzOwn + sim.velShpOwn}
                    onChange={v => {
                      const totalOld = sim.velAmzOwn + sim.velShpOwn || 1;
                      setSim(prev => ({
                        ...prev,
                        velAmzOwn: prev.velAmzOwn * (v / totalOld),
                        velShpOwn: prev.velShpOwn * (v / totalOld),
                      }));
                    }}
                    min={0} max={500} step={0.1}
                    base={(baseRecord?.velAmzOwn || 0) + (baseRecord?.velShpOwn || 0)}
                    delta={sim.velAmzOwn !== baseRecord?.velAmzOwn || sim.velShpOwn !== baseRecord?.velShpOwn}
                    onReset={() => setSim(prev => ({ ...prev, velAmzOwn: baseRecord.velAmzOwn, velShpOwn: baseRecord.velShpOwn }))}
                    hint={`= ${sim.velAmzOwn.toFixed(1)} amz + ${sim.velShpOwn.toFixed(1)} d2c`}/>
                  <SimRow label="Flipkart" unit="/day"
                    value={sim.velFk} onChange={v => setOne("velFk", v)}
                    min={0} max={500} step={0.1}
                    base={baseRecord?.velFk} delta={isDelta("velFk")}
                    onReset={() => setOne("velFk", baseRecord.velFk)}/>
                  <SimRow label="Blinkit" unit="/day"
                    value={sim.velBl} onChange={v => setOne("velBl", v)}
                    min={0} max={500} step={0.1}
                    base={baseRecord?.velBl} delta={isDelta("velBl")}
                    onReset={() => setOne("velBl", baseRecord.velBl)}/>
                  <SimRow label="Central warehouse (B2B + other)" unit="/day"
                    value={sim.velWh} onChange={v => setOne("velWh", v)}
                    min={0} max={500} step={0.1}
                    base={baseRecord?.velWh} delta={isDelta("velWh")}
                    onReset={() => setOne("velWh", baseRecord.velWh)}/>
                  {/* Show the derived overall as a disabled row so the user sees
                      what their per-channel edits sum to, instead of hiding it. */}
                  <SimRow label="Total (derived)" unit="/day"
                    value={effVel.overall} onChange={() => {}}
                    min={0} max={500} step={0.1}
                    base={baseRecord?.velOverall}
                    disabled/>
                </>
              )}
            </SimSection>

            {/* ── GROWTH section (nested) ── */}
            <SimSection
              title="MoM % growth"
              hint="Month-over-month growth applied to projected velocity."
              right={
                <SimToggle
                  value={sim.growthMode}
                  onChange={(v) => setOne("growthMode", v)}
                  options={[{ value: "overall", label: "Overall" }, { value: "perChannel", label: "Per-channel" }]}
                />
              }>
              {sim.growthMode === "overall" ? (
                <SimRow label="Overall MoM %" unit="%"
                  value={sim.growthOverall} onChange={v => setOne("growthOverall", v)}
                  min={-100} max={500} step={1}
                  base={baseRecord?.growthOverall} delta={isDelta("growthOverall")}
                  onReset={() => setOne("growthOverall", baseRecord.growthOverall)}/>
              ) : (
                <>
                  <SimRow label="Amazon FBA" unit="%"
                    value={sim.growthAmz} onChange={v => setOne("growthAmz", v)}
                    min={-100} max={500} step={1}
                    base={baseRecord?.growthAmz} delta={isDelta("growthAmz")}
                    onReset={() => setOne("growthAmz", baseRecord.growthAmz)}/>
                  <SimRow label="Flipkart" unit="%"
                    value={sim.growthFk} onChange={v => setOne("growthFk", v)}
                    min={-100} max={500} step={1}
                    base={baseRecord?.growthFk} delta={isDelta("growthFk")}
                    onReset={() => setOne("growthFk", baseRecord.growthFk)}/>
                  <SimRow label="Blinkit" unit="%"
                    value={sim.growthBl} onChange={v => setOne("growthBl", v)}
                    min={-100} max={500} step={1}
                    base={baseRecord?.growthBl} delta={isDelta("growthBl")}
                    onReset={() => setOne("growthBl", baseRecord.growthBl)}/>
                  <SimRow label="Central warehouse" unit="%"
                    value={sim.growthWh} onChange={v => setOne("growthWh", v)}
                    min={-100} max={500} step={1}
                    base={baseRecord?.growthWh} delta={isDelta("growthWh")}
                    onReset={() => setOne("growthWh", baseRecord.growthWh)}/>
                </>
              )}
            </SimSection>

            {/* ── INPUT (SFG or RM) ── */}
            <SimSection title={`Input · ${sim.inputKind === "semi" ? "SFG (Semi-Finished)" : "RM (Raw Material)"}`}
              hint={sim.inputName + " — qty + supplier lead time"}>
              <SimRow label={sim.inputName} unit={sim.inputUnit}
                value={sim.inputQty} onChange={v => setOne("inputQty", v)}
                min={0} max={Math.max(2000, (baseRecord?.inputQty || 100) * 5)}
                step={sim.inputUnit === "KG" || sim.inputUnit === "Ltr" ? 0.1 : 1}
                base={baseRecord?.inputQty} delta={isDelta("inputQty")}
                onReset={() => setOne("inputQty", baseRecord.inputQty)}/>
              <SimRow label="Supplier lead time" unit="days"
                value={sim.inputLead} onChange={v => setOne("inputLead", v)}
                min={1} max={120} step={1}
                base={baseRecord?.inputLead} delta={isDelta("inputLead")}
                onReset={() => setOne("inputLead", baseRecord.inputLead)}/>
            </SimSection>

            {/* ── PKG COMPONENTS (variable per SKU) ── */}
            <SimSection title="Packaging components" hint="One row per PKG. Each can have its own qty and lead time.">
              {sim.pkg.length === 0 ? (
                <div className="sim-section-foot muted">No packaging components defined for this SKU.</div>
              ) : sim.pkg.map((p, idx) => (
                <div key={p.refCode}>
                  <SimRow
                    label={`PKG${idx + 1} · ${p.name}`}
                    unit={p.unit}
                    value={p.qty}
                    onChange={v => setPkg(idx, "qty", v)}
                    min={0} max={Math.max(2000, (baseRecord?.pkg[idx]?.qty || 100) * 5)} step={1}
                    base={baseRecord?.pkg[idx]?.qty}
                    delta={isDelta(["pkg", idx, "qty"])}
                    onReset={() => setPkg(idx, "qty", baseRecord.pkg[idx].qty)}/>
                  <SimRow
                    label={`PKG${idx + 1} supplier lead time`}
                    unit="days"
                    value={p.leadTime}
                    onChange={v => setPkg(idx, "leadTime", v)}
                    min={1} max={120} step={1}
                    base={baseRecord?.pkg[idx]?.leadTime}
                    delta={isDelta(["pkg", idx, "leadTime"])}
                    onReset={() => setPkg(idx, "leadTime", baseRecord.pkg[idx].leadTime)}/>
                </div>
              ))}
            </SimSection>

            {/* ── MARKETPLACE INBOUND LEAD TIMES (SIM-014) ── */}
            <SimSection title="Marketplace inbound lead time"
              hint="Days to get fresh stock from central warehouse to each marketplace. Placeholder until real numbers arrive.">
              <SimRow label="Amazon FBA inbound" unit="days"
                value={sim.leadAmzInbound} onChange={v => setOne("leadAmzInbound", v)}
                min={0} max={60} step={1}
                base={baseRecord?.leadAmzInbound} delta={isDelta("leadAmzInbound")}
                onReset={() => setOne("leadAmzInbound", baseRecord.leadAmzInbound)}/>
              <SimRow label="Flipkart inbound" unit="days"
                value={sim.leadFkInbound} onChange={v => setOne("leadFkInbound", v)}
                min={0} max={60} step={1}
                base={baseRecord?.leadFkInbound} delta={isDelta("leadFkInbound")}
                onReset={() => setOne("leadFkInbound", baseRecord.leadFkInbound)}/>
              <SimRow label="Blinkit inbound" unit="days"
                value={sim.leadBlInbound} onChange={v => setOne("leadBlInbound", v)}
                min={0} max={60} step={1}
                base={baseRecord?.leadBlInbound} delta={isDelta("leadBlInbound")}
                onReset={() => setOne("leadBlInbound", baseRecord.leadBlInbound)}/>
            </SimSection>
          </div>
        </Card>

        {/* OUTPUTS panel */}
        <Card title="Live outputs" sub={status === "red" ? "Action needed — runway below lead time" : status === "amber" ? "Watch — under 30 days" : "Healthy — above lead time + 30d buffer"}>
          <div className={"sim-out sim-out-" + status}>
            {/* Compact hero — same status colour but ~half the height so the
                output panel doesn't feel front-heavy. */}
            <div className="sim-out-hero sim-out-hero-compact">
              <div className="sim-out-hero-meta">
                <div className="sim-out-hero-label">Total runway (cascade)</div>
                <div className="sim-out-hero-sub muted">day Central WH hits zero · channels drain in parallel first</div>
              </div>
              <div className="sim-out-hero-num mono">{runway}d</div>
            </div>

            {/* Per-channel runway breakdown — when each channel's own stock
                runs out before falling back to central WH. Inactive channels
                (velocity ≤ formula floor) show "—" instead of "∞" / "0.0/d"
                so the row reads as "not in play" not as a glitch. */}
            <div className="sim-out-channels">
              {cascade.channels.map(c => {
                const inactive = !Number.isFinite(c.runway) || c.velocity <= readParam("velocityFloor");
                return (
                  <div key={c.key} className={"sim-out-channel" + (inactive ? " is-inactive" : "")}>
                    <span className="sim-out-channel-label">{c.label}</span>
                    <span className="sim-out-channel-runway mono">
                      {inactive ? "—" : `${Math.round(c.runway)}d`}
                    </span>
                    <span className="sim-out-channel-vel muted">
                      {inactive ? "no demand" : `${c.velocity.toFixed(1)}/d`}
                    </span>
                  </div>
                );
              })}
              <div className={"sim-out-channel" + (projVel.wh <= readParam("velocityFloor") ? " is-inactive" : "")}>
                <span className="sim-out-channel-label"><strong>Central WH (standalone)</strong></span>
                <span className="sim-out-channel-runway mono">
                  {(!Number.isFinite(cascade.wh.runway) || projVel.wh <= readParam("velocityFloor")) ? "—" : `${Math.round(cascade.wh.runway)}d`}
                </span>
                <span className="sim-out-channel-vel muted">
                  {projVel.wh <= readParam("velocityFloor") ? "no direct demand" : `${projVel.wh.toFixed(1)}/d`}
                </span>
              </div>
            </div>

            <div className="sim-out-stats">
              <div className="sim-out-stat">
                <div className="sim-out-stat-label">Reorder by</div>
                <div className={"sim-out-stat-num mono" + (overdue ? " is-overdue" : "")}>
                  {overdue ? `Overdue by ${Math.abs(reorderByDays)}d` :
                    reorderByDays === 0 ? "Today" :
                    reorderByDays === 1 ? "Tomorrow" :
                    `In ${reorderByDays}d`}
                </div>
                <div className="sim-out-stat-sub">runway − supplier lead time</div>
              </div>
              <div className="sim-out-stat">
                <div className="sim-out-stat-label">Bottleneck</div>
                <div className="sim-out-stat-num mono">{bottleneckLabel}</div>
                <div className="sim-out-stat-sub">caps Producible FG</div>
              </div>
            </div>

            <div className="sim-out-timeline">
              <RunwayTimeline runway={runway} leadTime={sim.supplierLead} status={status}/>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

// ── SimSection + SimRow — reusable input building blocks for the Simulator ──
const SimSection = ({ title, hint, right, children }) => (
  <div className="sim-section">
    <div className="sim-section-head">
      <div>
        <div className="sim-section-title">{title}</div>
        {hint && <div className="sim-section-hint muted">{hint}</div>}
      </div>
      {right}
    </div>
    <div className="sim-section-body">{children}</div>
  </div>
);

const SimRow = ({ label, unit, value, onChange, min, max, step, base, delta, onReset, hint, disabled }) => {
  const absDelta = (value || 0) - (base || 0);
  const pctDelta = base ? (absDelta / Math.abs(base)) * 100 : 0;
  const sign = absDelta > 0 ? "+" : "";
  return (
    <div className={"sim-input-row" + (delta ? " is-delta" : "") + (disabled ? " is-disabled" : "")}>
      <div className="sim-input-label">
        <span>{label}</span>
        <span className="muted">{unit}</span>
        {hint && <span className="sim-input-hint muted">{hint}</span>}
      </div>
      <input
        type="range"
        className="sim-range"
        min={min} max={max} step={step}
        value={value}
        disabled={disabled}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
      />
      <div className="sim-input-cluster">
        <input
          type="number"
          className="sim-number"
          min={min} max={max} step={step}
          value={value}
          disabled={disabled}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
        />
        {/* Baseline chip only renders when the value is modified — clean
            default state is just the input. Click the chip to revert. */}
        {delta && (
          <button
            type="button"
            className="sim-baseline-chip"
            onClick={onReset}
            title={`Reset to ${base}`}
          >
            <span className="sim-baseline-chip-reset">↺</span>
            <span className="sim-baseline-chip-was muted">was</span>
            <span className="sim-baseline-chip-num mono">{Number.isFinite(base) ? (typeof base === "number" && base % 1 !== 0 ? base.toFixed(1) : base) : "—"}</span>
            <span className={"sim-baseline-chip-delta " + (absDelta > 0 ? "up" : "down")}>
              {sign}{Math.abs(pctDelta) >= 100 ? Math.round(pctDelta) : pctDelta.toFixed(0)}%
            </span>
          </button>
        )}
      </div>
    </div>
  );
};

// SimToggle — segmented two-way switch for "Overall vs per-channel" mode.
// Used by the velocity + growth sections to replace the small text link.
const SimToggle = ({ value, onChange, options }) => (
  <div className="sim-toggle">
    {options.map(o => (
      <button
        key={o.value}
        type="button"
        className={"sim-toggle-opt" + (value === o.value ? " is-active" : "")}
        onClick={() => onChange(o.value)}
      >
        {o.label}
      </button>
    ))}
  </div>
);

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
  const hasVel = vel != null && vel > readParam("velocityFloor"); // tunable from Formulas tab
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
  const [blinkitDrillSku,  setBlinkitDrillSku]  = useState(null);
  const [amazonDrillSku,   setAmazonDrillSku]   = useState(null);
  const [flipkartDrillSku, setFlipkartDrillSku] = useState(null);

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
                  {/* AMZ-003 (Runway tab): stock + per-FC OOS counts when real
                      FBA data is present; falls back to the existing velocity
                      breakdown cell otherwise. */}
                  {/* Runway tab — Amazon: always show stock + runway + a+b
                      velocity + growth (matches Unified Stock pattern).
                      Per-FC drill stays one click away. */}
                  <td
                    className={"num mat-cell" + (s.realData?.amazon ? " blk-cell" : "")}
                    onClick={(e) => {
                      if (!s.realData?.amazon) return;
                      e.stopPropagation();
                      setAmazonDrillSku(s);
                    }}
                  >
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
                  {/* Runway tab — Flipkart: real "listed quantity" from FK
                      Seller Hub (not bundled stub). FK stock physically lives
                      at central WH — see Unified Stock cell for the caveat. */}
                  <td
                    className={"num mat-cell" + (s.realData?.flipkart ? " blk-cell" : "")}
                    onClick={(e) => {
                      if (!s.realData?.flipkart) return;
                      e.stopPropagation();
                      setFlipkartDrillSku(s);
                    }}
                  >
                    <RunwayChannelCell
                      units={s.realData?.flipkart?.live ?? null}
                      vel={s.chVel.flipkart}
                      leadTime={s.chLead.flipkart}
                      growth={s.actualGrowth}
                    />
                  </td>
                  <td className="num mat-cell blk-cell" onClick={(e) => { e.stopPropagation(); setBlinkitDrillSku(s); }}>
                    {/* BLK-003: Runway tab Blinkit cell mirrors Unified Stock.
                        Replace velocity/growth with feeder-WH OOS counts.
                        Whole cell clickable → drill modal. */}
                    <div className="rw-ch-cell">
                      <div className="rw-ch-cell-stock mono">{D.fmtN(s.stock.blinkit)}</div>
                      <BlinkitFeederStats
                        feeders={s.blinkitFeeders}
                        sku={s}
                        threshold={readBlkThreshold(s.code)}
                      />
                    </div>
                  </td>

                  {/* 8. Action needed (Runway tab) */}
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
      {blinkitDrillSku && (
        <BlinkitFeederModal sku={blinkitDrillSku} onClose={() => setBlinkitDrillSku(null)}/>
      )}
      {amazonDrillSku && (
        <AmazonFcModal sku={amazonDrillSku} onClose={() => setAmazonDrillSku(null)}/>
      )}
      {flipkartDrillSku && (
        <FlipkartDrillModal sku={flipkartDrillSku} onClose={() => setFlipkartDrillSku(null)}/>
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
    // Required-cover formula now uses the per-SKU target days set in the
    // SkuBreakdownModal (defaults to 30 — matches the previous hardcoded
    // buffer, so SKUs whose target the user hasn't touched see no change).
    const targetDays = readTargetDays(s.code);
    const required = Math.round(s.velocity * (days + targetDays) * trend);
    const reorder = Math.max(0, required - maxFg);
    return { ...s, trend, forecast, required, reorder, maxFg, targetDays, trendPct: (trend - 1) * 100 };
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
              <div className="rw-risk-title">
                Recommended reorder
                <FormulaIcon formulaId="reorder" paramKey="defaultTargetDays" currentValue={`${D.fmtN(totalReorder)} units across all SKUs`}/>
              </div>
              <div className="rw-risk-sub">to cover {days}d + per-SKU target buffer</div>
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
                    <div className="mat-cell-num">{D.fmtN(s.velocity)}</div>
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
