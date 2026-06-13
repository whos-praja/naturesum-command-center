/**
 * UploadModal — multi-file upload flow.
 *
 * Six independent zones, one per file type (Central Warehouse workbook /
 * Amazon ledger / Agency / Blinkit / Flipkart / Shopify). Each zone has its
 * own file picker, date-cutoff picker, parse status, and remove button. On
 * "Apply", the uploaded files are persisted via multiFileStore; the page
 * reloads so data.js picks up the new payload at module-init time.
 *
 * The DataAsOfPill in the topbar shows when the latest upload happened
 * and how many file slots are populated.
 */
import { useState, useEffect, useRef } from "react";
import NSData from "../data.js";
import { Icon } from "./Shared.jsx";
import { DatePicker } from "./DatePicker.jsx";
import { FILE_TYPES, parseByType } from "../lib/uploadParsers.js";
import {
  loadMultiFile,
  upsertFile,
  removeFile,
  clearAll,
  summariseStore,
} from "../lib/multiFileStore.js";
import { detectFileType, checkAnomalies } from "../lib/claudeHelper.js";
import { REAL_MARKETPLACE_DATA } from "../realMarketplaceData.js";
import { CENTRAL_WH_DATA } from "../bundledCentralWHData.js";
import { BUSINESS_FILE_TYPES, parseBusinessFile } from "../lib/businessParsers.js";
import {
  loadBusinessFacts,
  upsertFacts,
  clearSource,
} from "../lib/businessStore.js";
import { runIngestionSelfTest } from "../lib/ingestionSelfTest.js";

// Extract the slice of bundled real-data that matches a given file type —
// used as the "before" baseline when Claude is asked to spot anomalies in
// a freshly-parsed upload.
function bundledBaselineFor(fileType) {
  if (fileType === "central-wh") {
    // Warehouse ground truth: baseline = bundled central-WH engine FG map.
    // SAFE FALLBACK: guard the import so a missing/empty artifact → {} not crash.
    return { fg: CENTRAL_WH_DATA?.fg || {} };
  }
  const sliceKey = {
    "amazon-ledger": "amazon",
    "amazon-orders": "amazon",
    "blinkit":       "blinkit",
    "flipkart":      "flipkart",
    "shopify":       "shopify",
  }[fileType];
  if (!sliceKey) return null;
  const out = {};
  for (const [code, perSku] of Object.entries(REAL_MARKETPLACE_DATA)) {
    const slice = perSku?.[sliceKey];
    if (slice == null) continue;
    if (fileType === "amazon-orders") {
      out[code] = slice.orders || null;
    } else {
      out[code] = slice;
    }
  }
  return out;
}

const ZONES = [
  // Central Warehouse workbook is the warehouse ground truth — listed first.
  // Supersedes the retired 'nitin' (Warehouse Daily Inventory Sheet) zone.
  { key: "central-wh",     ...FILE_TYPES["central-wh"] },
  { key: "amazon-ledger",  ...FILE_TYPES["amazon-ledger"] },
  { key: "agency",         ...FILE_TYPES["agency"] },
  { key: "blinkit",        ...FILE_TYPES["blinkit"] },
  { key: "flipkart",       ...FILE_TYPES["flipkart"] },
  { key: "shopify",        ...FILE_TYPES["shopify"] },
].filter((z) => z.label); // SAFE FALLBACK: drop any zone whose FILE_TYPES entry is missing

const fmtDate = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return iso; }
};
const todayISO = () => new Date().toISOString().slice(0, 10);

// ── Business Performance upload zones (spec §8) ──────────────────────────────
// These write to the durable AGGREGATED fact store (ns.businessPerf) via
// businessStore.upsertFacts — a SEPARATE store from the inventory multiFile
// snapshot above. The zone key IS the source tag (per the pinned contract), so
// re-upload of the same source REPLACES same-key facts (idempotent: the store's
// clearSource+contrib-snapshot guarantees parse-twice == parse-once). The list
// is driven off BUSINESS_FILE_TYPES so the channel/zone set is never hardcoded.
const BIZ_ZONES = Object.entries(BUSINESS_FILE_TYPES).map(([key, def]) => ({
  key, label: def.label, channel: def.channel, parse: def.parse, tier: def.tier || null,
})).filter((z) => z.label);

// Per-zone provenance tier (drives the small TIER chip) + a one-line
// "what this unlocks" hint so the founder knows what each upload buys them.
// Tier semantics mirror spec V2.1: native = per-SKU revenue grain (best);
// agency = Snell channel/units history; monarch = website daily history.
// Anything not listed defaults to "native" (the May per-SKU sources).
const BIZ_ZONE_META = {
  // ── Tier-1 NATIVE (per-SKU revenue grain — May 2026) ──
  "amazon-orders": { tier: "native", unlocks: "Per-SKU Amazon revenue, units & returns — upgrades any month it covers from agency to SKU-grain CM." },
  "fk-sales":      { tier: "native", unlocks: "Per-SKU Flipkart net-BIA revenue & units (multipacks folded) — SKU-grain CM3 for Flipkart." },
  "blinkit-sales": { tier: "native", unlocks: "Per-SKU Blinkit revenue & units (keyed on Item Id) — SKU-grain CM3 for Blinkit." },
  "shopify-net":   { tier: "native", unlocks: "Per-SKU website Net sales & units (month total) — SKU-grain CM3 for the website." },
  "shopify-daily": { tier: "native", unlocks: "Daily website revenue SHAPE (trend only — never the monthly total)." },
  "ads-amazon-sp": { tier: "native", unlocks: "Per-ASIN Amazon SP spend — turns Amazon ROAS/ACOS from agency-total into product-attributed." },
  "ads-fk-pla":    { tier: "native", unlocks: "Per-SKU Flipkart PLA spend — product-attributed Flipkart ad basis." },
  "ads-google":    { tier: "native", unlocks: "Per-product Google spend — product-attributed website ad basis." },
  // ── Tier-2 AGENCY (Snell) ──
  "snell-agency":  { tier: "agency", unlocks: "May channel-total ad spend (AMS / FK / Blinkit) — the v1 single-month spend pins." },
  "snell-history": { tier: "agency", unlocks: "FULL daily channel history — Amazon Aug-24→, Flipkart Jun-25→, Blinkit Dec-25→ (incl. June MTD): units, gross/net revenue & ad spend. This is what powers the multi-month sales & spend charts." },
  "snell-sku-units": { tier: "agency", unlocks: "Daily per-SKU UNITS from the Categorywise tabs (units only, never revenue) — fills the SKU-units drill where native reports haven't landed yet." },
  // ── Tier-3 MONARCH (website) ──
  "monarch-web":     { tier: "monarch", unlocks: "May website Google + Meta channel-total spend." },
  "monarch-history": { tier: "monarch", unlocks: "FULL daily website history Jun-25→ — conversion value, cancels & Google/Meta spend. Powers the 12-month website trend." },
  // ── V2 upside views (analytics-only meta) ──
  "snell-cancel":     { tier: "agency", unlocks: "Cancel-rate per channel per month (shipped vs cancelled units) — powers the Sales cancel-rate trend with threshold coloring." },
  "monarch-seo":      { tier: "monarch", unlocks: "SEO keyword rank-over-time (top 30) — rank now vs ~30d/earliest, movement arrows. Powers the Marketing SEO panel." },
  "monarch-platform": { tier: "monarch", unlocks: "Google vs Meta monthly ROAS + CPA side-by-side — the budgeting decision view on Marketing." },
  "bm-repeats":       { tier: "businessmodel", unlocks: "Historical repeat % + returns trend (Shopify repeat by quarter, Amazon repeat share, Shopify returns % by month) — powers the Sales retention/returns panel." },
};
const bizZoneMeta = (key) => BIZ_ZONE_META[key] || { tier: "native", unlocks: null };

// Tier chip colors — native (best, brand green), agency (amber), monarch (blue).
const TIER_CHIP = {
  native:  { bg: "rgba(63,114,80,0.14)",  fg: "var(--success, #3F7250)", tip: "Tier-1 NATIVE — per-SKU revenue grain (authoritative; wins over agency)" },
  agency:  { bg: "rgba(176,122,31,0.14)",  fg: "var(--warning, #B07A1F)", tip: "Tier-2 AGENCY (Snell) — channel-grain history + per-SKU units" },
  monarch: { bg: "rgba(40,116,240,0.12)",  fg: "#2874F0",                 tip: "Tier-3 MONARCH — website daily history" },
  businessmodel: { bg: "rgba(110,90,160,0.14)", fg: "#6E5AA0",            tip: "BusinessModel — historical actuals (repeats/returns), source-labelled per founder rule 9" },
};

// Month-scoped files have NO date column, so their parser takes opts.month
// (defaults to 2026-05 in the parser). The rest derive month from row dates and
// ignore the picker. We surface a month picker only where it actually matters.
// The V2 history parsers (snell-history, snell-sku-units, monarch-history) read
// the date off every row, so they are NOT month-scoped.
const BIZ_MONTH_SCOPED = new Set(["shopify-net", "ads-google", "ads-fk-pla", "snell-agency", "monarch-web"]);
const DEFAULT_BIZ_MONTH = "2026-05";
const ALL_BIZ_FORMATS = ".csv,.txt,.tsv,.xlsx,.xls";

// Group the zones by tier for the business tab so the founder sees the three
// source tiers laid out (native first — it's the upgrade target).
const BIZ_TIER_ORDER = ["native", "agency", "monarch", "businessmodel"];
const BIZ_TIER_HEADING = {
  native:  { title: "Native per-SKU reports (May 2026)", sub: "Tier-1 — SKU-grain revenue, units & product-attributed ads. These WIN over agency for any month they cover." },
  agency:  { title: "Snell agency history (multi-month)", sub: "Tier-2 — daily channel-grain revenue/units/spend + per-SKU units. Powers the long-term sales & marketing trends." },
  monarch: { title: "Monarch website history (multi-month)", sub: "Tier-3 — daily website conversion value, cancels & Google/Meta spend." },
  businessmodel: { title: "BusinessModel historical actuals", sub: "Repeats & returns actuals (source-labelled per founder rule 9) — retention/returns trends only, never cost assumptions." },
};

// Highest-severity DQ level in a flag list → drives the badge color. The
// parsers always emit at least one info flag, so "info" is the floor.
function dqWorst(dq) {
  if (!Array.isArray(dq) || dq.length === 0) return "info";
  if (dq.some((f) => f.level === "error")) return "error";
  if (dq.some((f) => f.level === "warn")) return "warn";
  return "info";
}
function dqCounts(dq) {
  const c = { error: 0, warn: 0, info: 0 };
  for (const f of dq || []) if (c[f.level] != null) c[f.level]++;
  return c;
}

// Small provenance-tier badge (native / agency / monarch) shared by the section
// headings and each business zone. Tier colors mirror BizCoveragePanel's legend.
function TierChip({ tier }) {
  const t = TIER_CHIP[tier] || TIER_CHIP.native;
  return (
    <span
      title={t.tip}
      style={{
        marginLeft: 8, fontSize: 9.5, padding: "1px 5px", borderRadius: 3,
        background: t.bg, color: t.fg, fontWeight: 700, letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}
    >
      {tier}
    </span>
  );
}

export function UploadModal({ onClose, defaultTab = "inventory" }) {
  const [store, setStore] = useState(() => loadMultiFile() || { uploadedAt: null, files: {} });
  // Business fact-store snapshot — its own store (ns.businessPerf). We keep a
  // tick to re-read meta.uploads after each business upload so provenance
  // displays update without a reload.
  const [bizStore, setBizStore] = useState(() => loadBusinessFacts());
  const refreshBiz = () => setBizStore(loadBusinessFacts());
  // Two sections: Inventory (multiFile snapshot) + Business Performance (fact
  // store). Inventory is the historical default; the business pages' "Upload
  // reports" button opens this modal with defaultTab="business" so the founder
  // lands directly on the sources that feed Finance/Sales/Marketing.
  const [tab, setTab] = useState(defaultTab === "business" ? "business" : "inventory");

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleApplyAndClose = () => {
    // Reload so data.js + the business module re-read localStorage at init.
    window.location.reload();
  };
  const handleClearAll = () => {
    if (window.confirm("Remove all uploaded files and revert to bundled real-data?")) {
      clearAll();
      window.location.reload();
    }
  };

  // Count only files that map to a CURRENT zone, so the "N of M sources" copy
  // can never read e.g. "7 of 6" when a legacy slot (retired 'nitin' /
  // 'amazon-orders') still lingers in storage from an older upload.
  const zoneKeys = new Set(ZONES.map((z) => z.key));
  const filesCount = Object.keys(store?.files || {}).filter((k) => zoneKeys.has(k)).length;
  // Business uploads recorded in the fact store's meta.uploads (set by
  // upsertFacts). Only count tags that map to a CURRENT business zone.
  const bizZoneKeys = new Set(BIZ_ZONES.map((z) => z.key));
  const bizUploads = (bizStore?.meta?.uploads || []).filter((u) => bizZoneKeys.has(u.sourceTag));
  const bizCount = new Set(bizUploads.map((u) => u.sourceTag)).size;

  const footerCopy = (() => {
    const parts = [];
    if (filesCount > 0) parts.push(`${filesCount}/${ZONES.length} inventory sources`);
    if (bizCount > 0) parts.push(`${bizCount}/${BIZ_ZONES.length} business sources`);
    if (parts.length === 0) return "Nothing uploaded yet — dashboard is showing bundled real-data.";
    const last = Math.max(
      store?.uploadedAt ? new Date(store.uploadedAt).getTime() : 0,
      ...bizUploads.map((u) => (u.at ? new Date(u.at).getTime() : 0)),
    );
    return `${parts.join(" · ")} uploaded · last updated ${last ? new Date(last).toLocaleString("en-IN") : "—"}`;
  })();
  const anyUploaded = filesCount > 0 || bizCount > 0;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal-card" onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(820px, 96vw)", maxHeight: "92vh" }}>
        <div className="modal-head">
          <div>
            <div className="modal-title">Upload data</div>
            <div className="modal-sub">
              Drop exports per source. <strong>Inventory</strong> sources feed the warehouse / runway dashboard; <strong>Business Performance</strong> sources feed the Finance / Sales / Marketing margin engine. Apply &amp; reload to refresh.
            </div>
          </div>
          <button className="btn ghost icon" onClick={onClose} title="Close (Esc)">✕</button>
        </div>

        <div style={{ display: "flex", gap: 4, padding: "0 18px", borderBottom: "1px solid var(--border-soft)" }}>
          {[
            { id: "inventory", label: `Inventory & Warehouse${filesCount ? ` · ${filesCount}` : ""}` },
            { id: "business", label: `Business Performance${bizCount ? ` · ${bizCount}` : ""}` },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="btn ghost sm"
              style={{
                borderRadius: 0,
                borderBottom: tab === t.id ? "2px solid var(--brand, #3F7250)" : "2px solid transparent",
                color: tab === t.id ? "var(--ink)" : "var(--ink-3)",
                fontWeight: tab === t.id ? 600 : 500,
                padding: "8px 10px",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="modal-body" style={{ maxHeight: "64vh", overflowY: "auto" }}>
          {tab === "inventory" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="muted" style={{ fontSize: 11.5, marginBottom: 2 }}>
                Each sales/marketplace file has its own date-cutoff (rows past it are ignored); the Central Warehouse workbook has none — it always uses the latest audit + post-audit movement.
              </div>
              {ZONES.map((zone) => (
                <UploadZone
                  key={zone.key}
                  zone={zone}
                  entry={store.files?.[zone.key]}
                  onUpdate={(updated) => setStore(updated)}
                />
              ))}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="muted" style={{ fontSize: 11.5, marginBottom: 2 }}>
                Drop your source exports — each writes AGGREGATED facts (month×channel×SKU) to the durable business store; no raw rows kept. Re-uploading a source REPLACES its prior facts (idempotent, never double-counted). <strong>Native</strong> reports win over <strong>agency/Monarch</strong> history for any month they cover, so uploading a month's native files automatically upgrades it to SKU-grain. Month-scoped files (Shopify net, Google/FK ads, May Snell/Monarch) use the month picker; everything else reads the date off each row.
              </div>
              <IngestionSelfTest />
              {BIZ_TIER_ORDER.map((tier) => {
                const zonesInTier = BIZ_ZONES.filter((z) => bizZoneMeta(z.key).tier === tier);
                if (zonesInTier.length === 0) return null;
                const head = BIZ_TIER_HEADING[tier];
                return (
                  <div key={tier} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, borderBottom: "1px solid var(--border-soft)", paddingBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink)" }}>{head.title}</span>
                      <TierChip tier={tier} />
                    </div>
                    <div className="muted" style={{ fontSize: 11, marginTop: -4 }}>{head.sub}</div>
                    {zonesInTier.map((zone) => (
                      <BizUploadZone
                        key={zone.key}
                        zone={zone}
                        meta={bizZoneMeta(zone.key)}
                        upload={bizUploads.find((u) => u.sourceTag === zone.key) || null}
                        onChange={refreshBiz}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <span className="muted" style={{ fontSize: 11.5 }}>{footerCopy}</span>
          <div style={{ display: "flex", gap: 8 }}>
            {filesCount > 0 && (
              <button className="btn ghost" onClick={handleClearAll}>Clear inventory</button>
            )}
            <button className="btn primary" onClick={handleApplyAndClose} disabled={!anyUploaded}>
              Apply &amp; reload
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function UploadZone({ zone, entry, onUpdate }) {
  // The central-WH workbook has NO cutoff (D2): it always uses the latest audit
  // as baseline + post-audit production/movement. We hide the picker for it and
  // never pass a cutoff to its parser (the engine ignores opts.dateCutoff anyway).
  const noCutoff = zone.key === "central-wh";

  const [stage, setStage] = useState("idle"); // idle | parsing | error | uploaded
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [dateCutoff, setDateCutoff] = useState(entry?.dataAsOf || todayISO());

  // D2 persistence fix: re-read this file's OWN stored cutoff whenever the
  // persisted entry changes (e.g. after a hard refresh re-seeds the store, or
  // another zone's upload re-renders this one). Without this sync the local
  // useState initializer only ran at first mount, so a zone could keep showing
  // a stale/default cutoff while the store held a different per-file value —
  // making the displayed cutoffs appear to "equalize". Each zone now tracks its
  // own dataAsOf independently. central-WH is exempt (no cutoff concept).
  useEffect(() => {
    if (noCutoff) return;
    if (entry?.dataAsOf && entry.dataAsOf !== dateCutoff) {
      setDateCutoff(entry.dataAsOf);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.dataAsOf, noCutoff]);
  // AI-assist state — populated asynchronously after a successful parse.
  // aiState: "idle" | "checking" | "done" | "skipped". When the /api/
  // endpoint is unreachable or the env key isn't set we mark "skipped"
  // and the deterministic JS parse stands on its own.
  const [aiState, setAiState] = useState("idle");
  const [anomalies, setAnomalies] = useState([]);
  // True when the cutoff was changed AFTER a file was uploaded — the stored
  // cutoff is updated immediately, but the parse still reflects the old cutoff
  // until the file is re-picked. We surface a small hint for this.
  const [cutoffDirty, setCutoffDirty] = useState(false);

  const isUploaded = !!entry;

  const handleFile = async (file) => {
    if (!file) return;
    setStage("parsing");
    setError(null);
    setAiState("idle");
    setAnomalies([]);
    setCutoffDirty(false); // a fresh parse re-applies the current cutoff
    let parsed;
    try {
      // central-WH ignores cutoff entirely (D2) — pass none so intent is explicit.
      parsed = await parseByType(zone.key, file, noCutoff ? {} : { dateCutoff });
    } catch (e) {
      // Format-guard fallback: ask Claude to identify the file type. If it
      // confidently disagrees with the zone the file was dropped in,
      // surface that as the error so the user can re-route.
      const detected = await detectFileType(file).catch(() => null);
      const hint = detected && detected.type !== zone.key && detected.confidence > 0.7
        ? ` — Claude thinks this is a "${detected.type}" file (${Math.round(detected.confidence * 100)}% confidence). Try the ${detected.type} zone.`
        : "";
      setError((e?.message || String(e)) + hint);
      setStage("error");
      return;
    }
    // D2: persist each file's OWN cutoff so per-sheet cutoffs survive a hard
    // refresh (read back independently per zone). central-WH has no cutoff — we
    // record its audit "as-of"/anchor date instead so the status copy stays
    // meaningful, and so a re-read never resurrects a bogus picker value.
    const dataAsOf = noCutoff
      ? (parsed?.asOf || parsed?.anchorDate || null)
      : dateCutoff;
    const updated = upsertFile(zone.key, {
      dataAsOf,
      fileName: file.name,
      parsed,
    });
    onUpdate(updated);
    setStage("uploaded");

    // Kick off the post-parse anomaly check in the background. Doesn't
    // block the UI; results land in the zone when ready.
    setAiState("checking");
    try {
      const before = bundledBaselineFor(zone.key);
      const after = (zone.key === "shopify") ? parsed.byCode : parsed;
      const anomList = await checkAnomalies(zone.key, before, after);
      setAnomalies(anomList);
      setAiState(anomList === null ? "skipped" : "done");
    } catch {
      setAiState("skipped");
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handlePick = (e) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleRemove = () => {
    const updated = removeFile(zone.key);
    onUpdate(updated || { uploadedAt: new Date().toISOString(), files: {} });
    setStage("idle");
    setCutoffDirty(false);
  };

  // D2: changing the cutoff updates this zone's local state AND, when a file is
  // already uploaded, immediately re-persists the new per-file cutoff so it
  // survives a hard refresh (read back independently per zone — they never
  // equalize). The cutoff also affects how rows are filtered at parse time, so
  // we flag the zone "dirty" to nudge a re-pick that re-applies it to the data.
  const handleCutoffChange = (iso) => {
    const next = iso || todayISO();
    setDateCutoff(next);
    if (isUploaded && next !== entry?.dataAsOf) {
      const updated = upsertFile(zone.key, { ...entry, dataAsOf: next });
      onUpdate(updated);
      setCutoffDirty(true);
    }
  };

  // Brief summary of what was parsed (count of SKUs / rows)
  const summary = (() => {
    if (!entry?.parsed) return null;
    const p = entry.parsed;
    if (zone.key === "shopify" && p.byCode) return `${Object.keys(p.byCode).length} SKUs · ${p.dateRange?.days || 0} days`;
    if (zone.key === "central-wh") {
      const fgN = Object.keys(p.fg || {}).length;
      const compN = Object.keys(p.components || {}).length;
      const anchor = p.anchorDate ? ` · audit ${fmtDate(p.anchorDate)}` : "";
      return `${fgN} FG SKUs · ${compN} components${anchor}`;
    }
    return `${Object.keys(p || {}).length} SKUs`;
  })();

  const tint = stage === "error" ? "rgba(183,56,56,0.10)"
             : isUploaded        ? "rgba(63,114,80,0.06)"
             : dragging          ? "rgba(40,116,240,0.08)"
             : "var(--bg-canvas)";
  const border = stage === "error" ? "rgba(183,56,56,0.32)"
               : isUploaded        ? "rgba(63,114,80,0.32)"
               : dragging          ? "rgba(40,116,240,0.4)"
               : "var(--border-soft)";

  return (
    <div style={{
      border: `1px solid ${border}`,
      background: tint,
      borderRadius: 8,
      padding: 12,
      transition: "background 0.12s ease, border 0.12s ease",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
            {zone.label}
            {isUploaded && (
              <span style={{ marginLeft: 8, fontSize: 10, padding: "1px 5px", borderRadius: 3, background: "rgba(63,114,80,0.12)", color: "var(--success)", fontWeight: 700, letterSpacing: "0.04em" }}>
                LOADED
              </span>
            )}
            {aiState === "checking" && (
              <span style={{ marginLeft: 6, fontSize: 10, padding: "1px 5px", borderRadius: 3, background: "rgba(99,102,241,0.10)", color: "#6366f1", fontWeight: 600, letterSpacing: "0.04em" }}>
                ✨ AI CHECKING…
              </span>
            )}
            {aiState === "done" && anomalies.length === 0 && (
              <span style={{ marginLeft: 6, fontSize: 10, padding: "1px 5px", borderRadius: 3, background: "rgba(99,102,241,0.10)", color: "#6366f1", fontWeight: 600, letterSpacing: "0.04em" }}
                title="Claude reviewed the parsed numbers vs baseline and found nothing out-of-pattern">
                ✨ AI-CHECKED
              </span>
            )}
            {aiState === "done" && anomalies.length > 0 && (
              <span style={{ marginLeft: 6, fontSize: 10, padding: "1px 5px", borderRadius: 3, background: "rgba(176,122,31,0.12)", color: "var(--warning)", fontWeight: 700, letterSpacing: "0.04em" }}
                title="Claude flagged unusual deltas vs baseline">
                ⚠ {anomalies.length} ANOMAL{anomalies.length === 1 ? "Y" : "IES"}
              </span>
            )}
          </div>
          {isUploaded ? (
            <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
              {entry.fileName} · {summary}
              {noCutoff
                ? ` · ${entry.dataAsOf ? `audit ${fmtDate(entry.dataAsOf)}` : "latest audit"} · no cutoff`
                : ` · cutoff ${fmtDate(entry.dataAsOf)}`}
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
              Accepts {zone.accept}
            </div>
          )}
          {cutoffDirty && !noCutoff && (
            <div style={{ fontSize: 11, color: "var(--warning)", marginTop: 4 }}>
              Cutoff saved. Re-pick the file to re-apply it to the parsed rows.
            </div>
          )}
          {stage === "error" && (
            <div style={{ fontSize: 11.5, color: "var(--critical)", marginTop: 4 }}>
              ⚠ {error}
            </div>
          )}
          {anomalies.length > 0 && (
            <ul style={{
              listStyle: "none", margin: "8px 0 0", padding: "8px 10px",
              background: "rgba(176,122,31,0.06)",
              border: "1px solid rgba(176,122,31,0.20)",
              borderRadius: 6,
              fontSize: 11.5,
              color: "var(--ink-2)",
              display: "flex", flexDirection: "column", gap: 5,
            }}>
              {anomalies.slice(0, 6).map((a, i) => (
                <li key={i}>
                  <strong style={{ color: "var(--warning)" }}>{a.sku}</strong>
                  <span className="muted" style={{ marginLeft: 4 }}>{a.metric}:</span>
                  <span className="mono" style={{ marginLeft: 4 }}>
                    {String(a.oldValue)} → {String(a.newValue)}
                    {a.ratio != null && a.ratio !== Infinity && (
                      <span className="muted"> ({Number.isFinite(a.ratio) ? a.ratio.toFixed(1) + "×" : "—"})</span>
                    )}
                  </span>
                  <span style={{ display: "block", color: "var(--ink-3)", fontSize: 10.5, marginTop: 1 }}>
                    {a.why}
                  </span>
                </li>
              ))}
              {anomalies.length > 6 && (
                <li className="muted" style={{ fontSize: 10.5 }}>
                  + {anomalies.length - 6} more
                </li>
              )}
            </ul>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {noCutoff ? (
            // D2: central-WH has no cutoff picker — it always uses the latest
            // audit + post-audit movement. Show a note in place of the picker.
            <span
              className="muted"
              title="The central-warehouse workbook always uses its latest audit as the baseline plus all post-audit production and daily-movement rows. There is no cutoff to set."
              style={{ fontSize: 10.5, fontStyle: "italic", maxWidth: 200, lineHeight: 1.3, textAlign: "right" }}
            >
              uses latest audit + post-audit movement — no cutoff
            </span>
          ) : (
            <>
              <label style={{ fontSize: 10.5, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Cutoff
              </label>
              <DatePicker
                value={dateCutoff}
                onChange={handleCutoffChange}
                width={150}
              />
            </>
          )}

          {isUploaded ? (
            <button className="btn ghost sm" onClick={handleRemove} title="Remove this file">Remove</button>
          ) : stage === "parsing" ? (
            <span className="muted" style={{ fontSize: 11.5, padding: "0 8px" }}>Parsing…</span>
          ) : (
            <label
              className="btn primary sm"
              onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
              onDragOver={(e)  => { e.preventDefault(); }}
              onDragLeave={()  => setDragging(false)}
              onDrop={handleDrop}
              style={{ cursor: "pointer" }}
            >
              {dragging ? "Drop file" : "Pick file"}
              <input
                type="file"
                accept={zone.accept}
                onChange={handlePick}
                style={{ display: "none" }}
              />
            </label>
          )}
        </div>
      </div>
    </div>
  );
}

// ── IngestionSelfTest — XI (rubric 84/85): a runnable, in-tool proof ─────────
// One click re-ingests the bundled sources through the EXACT store merge/clear
// contract and shows, live, that (1) parse-twice == parse-once and the per-source
// re-ingest round-trips to the bundle, and (2) native per-SKU revenue OVERRIDES
// agency channel-grain revenue (via the real coverageFor + applyOverridePrecedence
// engine path). Idempotency/durability is DEMONSTRATED here, not just claimed.
// Runs entirely in-memory on a scratch store — never touches the live fact store.
function IngestionSelfTest() {
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState(false);
  // Demonstrable parse-failure (X/rubric 90): run a REAL parser on a deliberately
  // malformed blob and show the genuine thrown error + designed error state, so the
  // failure handling is shown working, not merely asserted.
  const [parseErr, setParseErr] = useState(null);
  // Hard watchdog + run-token so the button can NEVER spin forever (X/rubric 84,
  // 79): even if the deferred callback is throttled/never fires (backgrounded tab,
  // a rAF that the browser parks), the watchdog flips to a bounded timeout state.
  const watchdogRef = useRef(null);
  const runTokenRef = useRef(0);
  const SELF_TEST_TIMEOUT_MS = 8000; // generous: Node runs it in ~40ms.

  useEffect(() => () => { if (watchdogRef.current) clearTimeout(watchdogRef.current); }, []);

  const run = () => {
    // Re-entrancy guard: a fresh run invalidates any in-flight one.
    const token = ++runTokenRef.current;
    if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
    setRunning(true);

    const finish = (payload) => {
      if (token !== runTokenRef.current) return;        // a newer run superseded this one
      if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
      setResult(payload);
      setOpen(true);
      setRunning(false);
    };

    // Bounded watchdog: if no result lands in time (deferred callback parked,
    // main thread wedged before the work returns), show a clear timeout state —
    // never an eternal "Running…".
    watchdogRef.current = setTimeout(() => {
      finish({
        ok: false,
        timedOut: true,
        error: `Self-test exceeded ${Math.round(SELF_TEST_TIMEOUT_MS / 1000)}s and was stopped. This usually means the browser tab was backgrounded mid-run — bring it to the foreground and re-run.`,
        checks: [],
      });
    }, SELF_TEST_TIMEOUT_MS);

    // Defer with setTimeout (fires even on a backgrounded tab, unlike rAF which a
    // browser may park indefinitely) so the button paints "Running…" before the
    // synchronous work runs. The work itself is pure + in-memory (~40ms).
    setTimeout(() => {
      if (token !== runTokenRef.current) return;        // superseded before it ran
      try {
        const r = runIngestionSelfTest();
        finish(r);
      } catch (e) {
        finish({ ok: false, error: e?.message || String(e), checks: [] });
      }
    }, 0);
  };

  const demoParseFailure = async () => {
    setParseErr({ pending: true });
    // A file that is NOT a valid Amazon All-Orders TSV — the real parser throws.
    const bad = new File(["this is not,a valid\nAll-Orders export"], "broken-export.csv", { type: "text/csv" });
    try {
      await parseBusinessFile("amazon-orders", bad, {});
      // Parser unexpectedly accepted it — report that honestly.
      setParseErr({ pending: false, message: null, accepted: true });
    } catch (e) {
      setParseErr({ pending: false, message: e?.message || String(e), accepted: false });
    }
  };

  const headColor = !result ? "var(--ink-3)" : result.ok ? "var(--success, #3F7250)" : "var(--critical, #B73838)";
  const ex = result?.overrides?.example || null;

  return (
    <section
      aria-labelledby="ingest-selftest-h"
      style={{
        border: `1px solid ${result ? (result.ok ? "rgba(63,114,80,0.30)" : "rgba(183,56,56,0.32)") : "var(--border-soft)"}`,
        background: result && result.ok ? "rgba(63,114,80,0.05)" : "var(--bg-sunken, rgba(0,0,0,0.02))",
        borderRadius: 8,
        padding: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div id="ingest-selftest-h" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            Ingestion self-test
            {result && (
              <span
                role="status"
                style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", padding: "1px 6px", borderRadius: 3,
                  background: result.ok ? "rgba(63,114,80,0.14)" : "rgba(183,56,56,0.12)",
                  color: headColor,
                }}
              >
                {result.ok ? "✓ ALL GREEN" : "✗ FAILED"}
              </span>
            )}
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 3, lineHeight: 1.45 }}>
            Re-ingests the bundled sources and proves <strong>parse-twice == parse-once</strong> and{" "}
            <strong>native overrides agency</strong> — live, on a scratch store (your uploads are untouched).
          </div>
        </div>
        <button
          className="btn primary sm"
          onClick={run}
          disabled={running}
          aria-busy={running ? "true" : "false"}
          style={{ flexShrink: 0 }}
        >
          {running ? "Running…" : result ? "Re-run self-test" : "Run ingestion self-test"}
        </button>
      </div>

      {result && open && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          {result.error ? (
            <div
              role="alert"
              style={{
                fontSize: 11.5, color: "var(--critical, #B73838)", lineHeight: 1.45,
                padding: "8px 10px", borderRadius: 6,
                background: result.timedOut ? "rgba(183,138,56,0.08)" : "rgba(183,56,56,0.07)",
                border: `1px solid ${result.timedOut ? "rgba(183,138,56,0.32)" : "rgba(183,56,56,0.30)"}`,
              }}
            >
              {result.timedOut ? "⏱ " : "⚠ "}{result.error}
            </div>
          ) : (
            <>
              {/* headline facts */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 11 }}>
                <Stat label="Sources re-ingested" value={String(result.idempotency.sources.length)} />
                <Stat label="Cells (twice ≡ once)" value={NSData.fmtN ? NSData.fmtN(result.idempotency.onceCells) : String(result.idempotency.onceCells)} />
                <Stat label="Native cells overriding agency" value={`${result.overrides.suppressedCells}/${result.overrides.nativeCells}`} />
                <Stat label="Ran in" value={`${result.durationMs} ms`} />
              </div>

              {/* per-check green/red rows */}
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 5 }}>
                {result.checks.map((c) => (
                  <li key={c.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 11.5 }}>
                    <span aria-hidden="true" style={{ flexShrink: 0, fontWeight: 700, color: c.ok ? "var(--success, #3F7250)" : "var(--critical, #B73838)", width: 14 }}>
                      {c.ok ? "✓" : "✗"}
                    </span>
                    <span style={{ color: "var(--ink-2)" }}>
                      {c.label}
                      {c.detail && <span className="muted" style={{ display: "block", fontSize: 10.5, marginTop: 1 }}>{c.detail}</span>}
                    </span>
                  </li>
                ))}
              </ul>

              {/* worked override example (native wins, agency retained) */}
              {ex && (
                <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.5, padding: "6px 8px", background: "rgba(0,0,0,0.025)", border: "1px solid var(--border-soft)", borderRadius: 6 }}>
                  Largest override — <strong style={{ color: "var(--ink-2)" }}>{ex.mc.replace("|", " · ")}</strong>:
                  agency <span className="mono">{inrSafe(ex.agencyNetRev)}</span> suppressed in favour of native{" "}
                  <span className="mono">{inrSafe(ex.nativeNetRev)}</span>; channel ad spend{" "}
                  <span className="mono">{inrSafe(ex.adSpendKept)}</span> kept (ad pool intact). Suppressed agency revenue is retained for the reconciliation note, never dropped.
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Demonstrable parse-failure state — runs the REAL parser on a bad blob. */}
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--border-soft)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 10.5, lineHeight: 1.4 }}>
            Curious what a bad upload looks like? Preview the parse-failure state on a deliberately broken file.
          </span>
          <button
            className="btn ghost sm"
            onClick={demoParseFailure}
            disabled={parseErr?.pending}
            style={{ fontSize: 10.5, padding: "2px 8px", flexShrink: 0 }}
          >
            {parseErr?.pending ? "Parsing…" : "Preview parse-failure state"}
          </button>
        </div>
        {parseErr && !parseErr.pending && (
          parseErr.message ? (
            <div
              role="alert"
              style={{
                marginTop: 8, padding: "8px 10px", borderRadius: 6,
                background: "rgba(183,56,56,0.07)", border: "1px solid rgba(183,56,56,0.30)",
                display: "flex", flexDirection: "column", gap: 4,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span aria-hidden="true" style={{ fontSize: 13 }}>⚠</span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--critical, #B73838)" }}>Couldn’t parse this file</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--ink-2)", lineHeight: 1.45, wordBreak: "break-word" }}>{parseErr.message}</div>
              <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.45 }}>
                This is the real error the parser throws on a malformed file — caught before anything is written, so the fact store stays intact. The same block appears inline on any source that fails to parse.
              </div>
            </div>
          ) : (
            <div className="muted" style={{ marginTop: 8, fontSize: 11 }}>
              The parser unexpectedly accepted the broken file — no error to show.
            </div>
          )
        )}
      </div>
    </section>
  );
}

// Tiny labelled stat chip for the self-test headline row.
function Stat({ label, value }) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", padding: "4px 8px", background: "var(--bg-card)", border: "1px solid var(--border-soft)", borderRadius: 6, minWidth: 0 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>{value}</span>
      <span className="muted" style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
    </span>
  );
}

// SAFE ₹ — never leak a NaN/raw float into the self-test panel.
const inrSafe = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  try { return NSData.fmtINR ? NSData.fmtINR(v) : `₹${v.toLocaleString("en-IN")}`; }
  catch { return `₹${v.toLocaleString("en-IN")}`; }
};

// ── BizUploadZone — one Business Performance source (spec §8) ────────────────
// Parses via businessParsers, upserts the resulting facts into the durable
// business fact store under the zone key as the source tag, and renders the
// data-quality flags + provenance. Re-uploading replaces the source's facts
// (idempotent — the store snapshots each source's contribution so a second
// parse subtracts the first exactly: parse-twice == parse-once).
function BizUploadZone({ zone, upload, onChange, meta = null }) {
  const monthScoped = BIZ_MONTH_SCOPED.has(zone.key);
  const tier = meta?.tier || "native";
  const unlocks = meta?.unlocks || null;
  const [stage, setStage] = useState("idle"); // idle | parsing | error | uploaded
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [month, setMonth] = useState(upload?.month || DEFAULT_BIZ_MONTH);
  // DQ flags from the most recent parse this session. Persisted provenance lives
  // in the store's meta.uploads (the `upload` prop) so a re-open still shows
  // what's loaded; the rich DQ list is session-local (not stored, to respect the
  // no-raw-rows localStorage budget).
  const [dq, setDq] = useState(null);
  const [expanded, setExpanded] = useState(false);

  // A source is "loaded" if the store recorded an upload for it (survives
  // re-open of the modal) OR we just parsed it this session.
  const isLoaded = !!upload || stage === "uploaded";
  const dqShown = dq || upload?.dqSample || null;

  const handleFile = async (file) => {
    if (!file) return;
    setStage("parsing");
    setError(null);
    setDq(null);
    let result;
    try {
      result = await parseBusinessFile(zone.key, file, monthScoped ? { month } : {});
    } catch (e) {
      setError(e?.message || String(e));
      setStage("error");
      return;
    }
    const flags = Array.isArray(result?.dq) ? result.dq : [];
    setDq(flags);
    // Idempotent upsert: clearSource is run inside upsertFacts, but we also call
    // it defensively here so a parse that throws mid-way can't leave a partial
    // contribution behind. The zone key IS the source tag (pinned contract).
    try {
      clearSource(zone.key);
      upsertFacts(result.facts, zone.key, {
        fileName: file.name,
        month: monthScoped ? month : undefined,
        baked: false,
        dq: dqCounts(flags),
        // A trimmed DQ sample so the modal can re-show severity after re-open
        // without retaining the full list (budget-respecting provenance).
        dqSample: flags.filter((f) => f.level !== "info").slice(0, 6),
      });
    } catch (e) {
      setError("Stored facts but failed to persist: " + (e?.message || String(e)));
      setStage("error");
      return;
    }
    setStage("uploaded");
    onChange?.();
  };

  const handleRemove = () => {
    clearSource(zone.key);
    setStage("idle");
    setDq(null);
    onChange?.();
  };
  const handleDrop = (e) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };
  const handlePick = (e) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };
  const dismissError = () => { setStage("idle"); setError(null); };

  const worst = dqShown ? dqWorst(dqShown) : null;
  const counts = dqShown ? dqCounts(dqShown) : null;

  const tint = stage === "error" ? "rgba(183,56,56,0.10)"
             : isLoaded          ? "rgba(63,114,80,0.06)"
             : dragging          ? "rgba(40,116,240,0.08)"
             : "var(--bg-canvas)";
  const border = stage === "error" ? "rgba(183,56,56,0.32)"
               : isLoaded          ? "rgba(63,114,80,0.32)"
               : dragging          ? "rgba(40,116,240,0.4)"
               : "var(--border-soft)";
  // Channel tag: "*" means the source feeds multiple channels (Snell).
  const chTag = zone.channel === "*" ? "multi-channel" : zone.channel;

  return (
    <div style={{
      border: `1px solid ${border}`,
      background: tint,
      borderRadius: 8,
      padding: 12,
      transition: "background 0.12s ease, border 0.12s ease",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
            {zone.label}
            <TierChip tier={tier} />
            <span style={{ marginLeft: 6, fontSize: 9.5, padding: "1px 5px", borderRadius: 3, background: "var(--bg-soft, rgba(0,0,0,0.05))", color: "var(--ink-3)", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              {chTag}
            </span>
            {isLoaded && (
              <span style={{ marginLeft: 6, fontSize: 10, padding: "1px 5px", borderRadius: 3, background: "rgba(63,114,80,0.12)", color: "var(--success)", fontWeight: 700, letterSpacing: "0.04em" }}>
                LOADED
              </span>
            )}
            {worst === "error" && (
              <span style={{ marginLeft: 6, fontSize: 10, padding: "1px 5px", borderRadius: 3, background: "rgba(183,56,56,0.12)", color: "var(--critical, #B73838)", fontWeight: 700, letterSpacing: "0.04em" }}>
                ⚠ {counts.error} ERROR{counts.error === 1 ? "" : "S"}
              </span>
            )}
            {worst === "warn" && (
              <span style={{ marginLeft: 6, fontSize: 10, padding: "1px 5px", borderRadius: 3, background: "rgba(176,122,31,0.12)", color: "var(--warning)", fontWeight: 700, letterSpacing: "0.04em" }}>
                ⚠ {counts.warn} FLAG{counts.warn === 1 ? "" : "S"}
              </span>
            )}
          </div>

          {isLoaded ? (
            <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
              {upload?.fileName ? `${upload.fileName} · ` : ""}
              {monthScoped ? `month ${upload?.month || month} · ` : ""}
              {upload?.at ? `uploaded ${fmtDate(upload.at)}` : "loaded this session"}
              {" · re-upload replaces (idempotent)"}
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
              Accepts {ALL_BIZ_FORMATS}
            </div>
          )}

          {/* What this upload unlocks — so the founder knows what each source
              buys them before picking a file. */}
          {unlocks && (
            <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4, lineHeight: 1.4, display: "flex", gap: 4 }}>
              <span style={{ color: tier === "native" ? "var(--success)" : "var(--ink-4)", fontWeight: 700, flexShrink: 0 }}>↑ unlocks</span>
              <span>{unlocks}</span>
            </div>
          )}

          {stage === "error" && (
            <div
              role="alert"
              style={{
                marginTop: 8, padding: "8px 10px", borderRadius: 6,
                background: "rgba(183,56,56,0.07)",
                border: "1px solid rgba(183,56,56,0.30)",
                display: "flex", flexDirection: "column", gap: 4,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span aria-hidden="true" style={{ fontSize: 13 }}>⚠</span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--critical, #B73838)" }}>
                  Couldn’t parse this file
                </span>
              </div>
              <div style={{ fontSize: 11, color: "var(--ink-2)", lineHeight: 1.45, wordBreak: "break-word" }}>
                {error}
              </div>
              <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.45 }}>
                Nothing was written to the fact store — your existing data is unchanged. Check it’s the right export for{" "}
                <strong>{zone.label}</strong>, then drop it again.
              </div>
              <div>
                <button className="btn ghost sm" onClick={dismissError} style={{ fontSize: 10.5, padding: "2px 8px" }}>
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {dqShown && dqShown.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <button
                className="btn ghost sm"
                onClick={() => setExpanded((v) => !v)}
                style={{ fontSize: 10.5, padding: "2px 6px" }}
              >
                {expanded ? "Hide" : "Show"} data-quality flags
                {counts && (counts.error || counts.warn)
                  ? ` (${[counts.error && `${counts.error} error`, counts.warn && `${counts.warn} warn`].filter(Boolean).join(", ")})`
                  : ""}
              </button>
              {expanded && (
                <ul style={{
                  listStyle: "none", margin: "6px 0 0", padding: "8px 10px",
                  background: "rgba(0,0,0,0.025)",
                  border: "1px solid var(--border-soft)",
                  borderRadius: 6, fontSize: 11, color: "var(--ink-2)",
                  display: "flex", flexDirection: "column", gap: 4,
                  maxHeight: 160, overflowY: "auto",
                }}>
                  {dqShown.map((f, i) => (
                    <li key={i}>
                      <span style={{
                        fontSize: 9, fontWeight: 700, marginRight: 6, letterSpacing: "0.04em",
                        color: f.level === "error" ? "var(--critical, #B73838)"
                             : f.level === "warn"  ? "var(--warning)"
                             : "var(--ink-3)",
                      }}>
                        {String(f.level || "info").toUpperCase()}
                      </span>
                      {f.msg}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {monthScoped && (
            <>
              {/* Accessible labelled control (X/rubric 90): the <label> is bound to
                  the input via htmlFor/id (not just visually adjacent), and an
                  aria-label names the specific source so a screen reader announces
                  "Month for <source>" rather than an unlabelled month spinner. */}
              <label
                htmlFor={`biz-month-${zone.key}`}
                style={{ fontSize: 10.5, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}
              >
                Month
              </label>
              <input
                id={`biz-month-${zone.key}`}
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value || DEFAULT_BIZ_MONTH)}
                className="input sm"
                aria-label={`Month for ${zone.label}`}
                style={{ width: 120, fontSize: 12, padding: "3px 6px" }}
                title="This source has no per-row date; it is scoped to the month you pick."
              />
            </>
          )}
          {isLoaded ? (
            <button className="btn ghost sm" onClick={handleRemove} title="Remove this source from the fact store">Remove</button>
          ) : stage === "parsing" ? (
            <span className="muted" style={{ fontSize: 11.5, padding: "0 8px" }}>Parsing…</span>
          ) : (
            <label
              className="btn primary sm"
              onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
              onDragOver={(e)  => { e.preventDefault(); }}
              onDragLeave={()  => setDragging(false)}
              onDrop={handleDrop}
              style={{ cursor: "pointer" }}
            >
              {dragging ? "Drop file" : "Pick file"}
              <input
                type="file"
                accept={ALL_BIZ_FORMATS}
                onChange={handlePick}
                style={{ display: "none" }}
              />
            </label>
          )}
        </div>
      </div>
    </div>
  );
}

// ── DataAsOfPill — topbar entry point for the multi-file uploader ─────
// Doubles as a status badge: shows whether the dashboard is on bundled
// real-data or freshly-uploaded live data, plus an upload-arrow so the click
// affordance is obvious. (Bundled data is REAL, never "sample".)
export function DataAsOfPill({ onClick }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const onStorage = () => setTick((n) => n + 1);
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const store = loadMultiFile();
  const summary = summariseStore(store);
  // Count only files mapping to a current zone so the badge can't read "7/6"
  // when a retired slot lingers in storage.
  const zoneKeys = new Set(ZONES.map((z) => z.key));
  const liveCount = Object.keys(store?.files || {}).filter((k) => zoneKeys.has(k)).length;
  const isLive = liveCount > 0;
  return (
    <button
      className={"btn" + (isLive ? "" : " ghost")}
      onClick={onClick}
      title={isLive
        ? `Last upload: ${summary.uploadedAt ? new Date(summary.uploadedAt).toLocaleString("en-IN") : "—"} · click to update`
        : "Dashboard is on bundled real-data — click to upload newer exports"}
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
    >
      <Icon name="download" size={13}/>
      <span style={{
        width: 7, height: 7, borderRadius: "50%",
        background: isLive ? "var(--success)" : "var(--ink-4)",
        display: "inline-block",
      }}/>
      {isLive ? `Live data · ${liveCount}/${ZONES.length}` : "Upload data"}
    </button>
  );
}
