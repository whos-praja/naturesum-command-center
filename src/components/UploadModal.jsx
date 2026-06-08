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
import { useState, useEffect } from "react";
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

export function UploadModal({ onClose }) {
  const [store, setStore] = useState(() => loadMultiFile() || { uploadedAt: null, files: {} });

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleApplyAndClose = () => {
    // Reload so data.js re-reads localStorage at init.
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

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal-card" onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(820px, 96vw)", maxHeight: "92vh" }}>
        <div className="modal-head">
          <div>
            <div className="modal-title">Upload data</div>
            <div className="modal-sub">
              Drop daily exports per source. Each sales/marketplace file has its own date-cutoff (rows past it are ignored); the Central Warehouse workbook has none — it always uses the latest audit + post-audit movement. Apply &amp; reload to refresh the dashboard.
            </div>
          </div>
          <button className="btn ghost icon" onClick={onClose} title="Close (Esc)">✕</button>
        </div>

        <div className="modal-body" style={{ maxHeight: "70vh", overflowY: "auto" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {ZONES.map((zone) => (
              <UploadZone
                key={zone.key}
                zone={zone}
                entry={store.files?.[zone.key]}
                onUpdate={(updated) => setStore(updated)}
              />
            ))}
          </div>
        </div>

        <div className="modal-foot">
          <span className="muted" style={{ fontSize: 11.5 }}>
            {filesCount > 0
              ? `${filesCount} of ${ZONES.length} sources uploaded · last updated ${store.uploadedAt ? new Date(store.uploadedAt).toLocaleString("en-IN") : "—"}`
              : "Nothing uploaded yet — dashboard is showing bundled real-data."}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            {filesCount > 0 && (
              <button className="btn ghost" onClick={handleClearAll}>Clear all</button>
            )}
            <button className="btn primary" onClick={handleApplyAndClose} disabled={filesCount === 0}>
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
