/**
 * UploadModal — multi-file upload flow.
 *
 * Six independent zones, one per file type (Amazon ledger / Amazon orders /
 * Blinkit / Flipkart / Shopify / Nitin). Each zone has its own file picker,
 * date-cutoff picker, parse status, and remove button. On "Apply", the
 * uploaded files are persisted via multiFileStore; the page reloads so
 * data.js picks up the new payload at module-init time.
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
import { NITIN_DATA } from "../realNitinData.js";

// Extract the slice of bundled real-data that matches a given file type —
// used as the "before" baseline when Claude is asked to spot anomalies in
// a freshly-parsed upload.
function bundledBaselineFor(fileType) {
  if (fileType === "nitin") {
    return {
      fg: NITIN_DATA?.warehouseInventory?.fg || {},
      dailyMovement: Object.fromEntries(
        Object.entries(NITIN_DATA?.dailyMovement?.byCode || {})
          .map(([code, d]) => [code, d.channels])
      ),
    };
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
  { key: "nitin",          ...FILE_TYPES["nitin"] },
  { key: "amazon-ledger",  ...FILE_TYPES["amazon-ledger"] },
  { key: "agency",         ...FILE_TYPES["agency"] },
  { key: "blinkit",        ...FILE_TYPES["blinkit"] },
  { key: "flipkart",       ...FILE_TYPES["flipkart"] },
  { key: "shopify",        ...FILE_TYPES["shopify"] },
];

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

  const filesCount = Object.keys(store?.files || {}).length;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal-card" onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(820px, 96vw)", maxHeight: "92vh" }}>
        <div className="modal-head">
          <div>
            <div className="modal-title">Upload data</div>
            <div className="modal-sub">
              Drop daily exports per source. Each file has its own date-cutoff (any rows past it are ignored). Apply &amp; reload to refresh the dashboard.
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
              ? `${filesCount} of 6 sources uploaded · last updated ${store.uploadedAt ? new Date(store.uploadedAt).toLocaleString("en-IN") : "—"}`
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
  const [stage, setStage] = useState("idle"); // idle | parsing | error | uploaded
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [dateCutoff, setDateCutoff] = useState(entry?.dataAsOf || todayISO());
  // AI-assist state — populated asynchronously after a successful parse.
  // aiState: "idle" | "checking" | "done" | "skipped". When the /api/
  // endpoint is unreachable or the env key isn't set we mark "skipped"
  // and the deterministic JS parse stands on its own.
  const [aiState, setAiState] = useState("idle");
  const [anomalies, setAnomalies] = useState([]);

  const isUploaded = !!entry;

  const handleFile = async (file) => {
    if (!file) return;
    setStage("parsing");
    setError(null);
    setAiState("idle");
    setAnomalies([]);
    let parsed;
    try {
      parsed = await parseByType(zone.key, file, { dateCutoff });
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
    const updated = upsertFile(zone.key, {
      dataAsOf: dateCutoff,
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
  };

  // Brief summary of what was parsed (count of SKUs / rows)
  const summary = (() => {
    if (!entry?.parsed) return null;
    const p = entry.parsed;
    if (zone.key === "shopify" && p.byCode) return `${Object.keys(p.byCode).length} SKUs · ${p.dateRange?.days || 0} days`;
    if (zone.key === "nitin") {
      const fgN = Object.keys(p.fg || {}).length;
      const days = p.dailyMovement?.days ?? 0;
      return `${fgN} FG SKUs · ${days} days movement`;
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
              {entry.fileName} · {summary} · cutoff {fmtDate(entry.dataAsOf)}
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
              Accepts {zone.accept}
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
          <label style={{ fontSize: 10.5, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Cutoff
          </label>
          <DatePicker
            value={dateCutoff}
            onChange={(iso) => setDateCutoff(iso || todayISO())}
            width={150}
          />

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
// Doubles as a status badge: shows whether the dashboard is on sample or
// live data, plus an upload-arrow so the click affordance is obvious.
export function DataAsOfPill({ onClick }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const onStorage = () => setTick((n) => n + 1);
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const store = loadMultiFile();
  const summary = summariseStore(store);
  const isLive = summary.count > 0;
  return (
    <button
      className={"btn" + (isLive ? "" : " ghost")}
      onClick={onClick}
      title={isLive
        ? `Last upload: ${summary.uploadedAt ? new Date(summary.uploadedAt).toLocaleString("en-IN") : "—"} · click to update`
        : "Dashboard is on bundled sample data — click to upload"}
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
    >
      <Icon name="download" size={13}/>
      <span style={{
        width: 7, height: 7, borderRadius: "50%",
        background: isLive ? "var(--success)" : "var(--ink-4)",
        display: "inline-block",
      }}/>
      {isLive ? `Live data · ${summary.count}/6` : "Upload data"}
    </button>
  );
}
