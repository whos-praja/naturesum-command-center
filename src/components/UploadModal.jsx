/**
 * UploadModal — drag-and-drop / click-to-pick MIS sheet upload flow.
 * Stages:
 *   1. idle      → empty drop zone, prompt to pick a file
 *   2. parsing   → spinner while the parser does its work
 *   3. preview   → parse succeeded; show what was extracted + Confirm/Cancel
 *   4. error     → parse failed; show the error + Retry
 *
 * On confirm, the payload is committed via useLiveData().setLive() which
 * writes to localStorage and re-renders any consumer that's reading from
 * the live data context.
 */
import { useState, useEffect, useRef } from "react";
import { Icon } from "./Shared.jsx";
import { parseInventoryFile } from "../lib/parseInventoryFile.js";
import { summariseLive } from "../lib/liveInventory.js";
import { useLiveData } from "../contexts/LiveDataContext.jsx";

const formatDateTime = (iso) => {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

export function UploadModal({ onClose }) {
  const { live, setLive, clearLive } = useLiveData();
  const [stage, setStage] = useState("idle"); // idle | parsing | preview | error
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState(null);
  const [pickedFile, setPickedFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  // Esc to close
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleFile = async (file) => {
    if (!file) return;
    setPickedFile(file);
    setStage("parsing");
    setError(null);
    try {
      const result = await parseInventoryFile(file);
      setParsed(result);
      setStage("preview");
    } catch (e) {
      setError(e?.message || String(e));
      setStage("error");
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handleConfirm = () => {
    if (parsed) setLive(parsed);
    onClose();
  };

  const handleRevert = () => {
    if (window.confirm("Revert to sample data? The currently uploaded sheet will be discarded.")) {
      clearLive();
      onClose();
    }
  };

  const summary = parsed ? summariseLive(parsed) : null;
  const currentSummary = live ? summariseLive(live) : null;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal-card upload-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">Upload MIS sheet</div>
            <div className="modal-sub muted">
              {currentSummary
                ? <>Currently loaded: <strong>{currentSummary.fileName}</strong> · data as of <strong>{currentSummary.dataAsOf || "Unknown"}</strong></>
                : "No sheet uploaded yet — dashboard is showing sample data."}
            </div>
          </div>
          <button className="btn ghost icon" onClick={onClose} title="Close (Esc)">✕</button>
        </div>

        <div className="modal-body">
          {stage === "idle" && (
            <div
              className={"upload-dropzone" + (isDragging ? " is-dragging" : "")}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => handleFile(e.target.files?.[0])}
                style={{ display: "none" }}
              />
              <div className="upload-dropzone-icon"><Icon name="download" size={28}/></div>
              <div className="upload-dropzone-title">Drop the MIS sheet here</div>
              <div className="upload-dropzone-sub">
                or <strong>click to choose</strong> a file (.xlsx, .xls, .csv)
              </div>
              <div className="upload-dropzone-hint muted">
                Expected tabs: <code>Master</code>, <code>warehouse inventory</code>, <code>Daily Movement of FG</code>.
                Other tabs are ignored.
              </div>
            </div>
          )}

          {stage === "parsing" && (
            <div className="upload-state">
              <div className="upload-state-spinner"/>
              <div className="upload-state-title">Parsing <strong>{pickedFile?.name}</strong>…</div>
              <div className="upload-state-sub muted">Mapping items to SKU codes and rolling up 30-day velocity</div>
            </div>
          )}

          {stage === "error" && (
            <div className="upload-state">
              <div className="upload-state-icon crit"><Icon name="alerts" size={22}/></div>
              <div className="upload-state-title">Couldn't parse this file</div>
              <div className="upload-state-sub" style={{ color: "var(--critical)" }}>{error}</div>
              <button className="btn" onClick={() => setStage("idle")} style={{ marginTop: 12 }}>Try another file</button>
            </div>
          )}

          {stage === "preview" && summary && (
            <div className="upload-preview">
              <div className="upload-preview-head">
                <div>
                  <div className="upload-preview-title">{summary.fileName}</div>
                  <div className="upload-preview-sub muted">
                    {summary.sheetNames.length} sheet{summary.sheetNames.length === 1 ? "" : "s"}: {summary.sheetNames.join(" · ")}
                  </div>
                </div>
                <div className="upload-preview-asof">
                  <div className="upload-preview-asof-label">Data as of</div>
                  <div className="upload-preview-asof-value mono">{summary.dataAsOf || "Unknown"}</div>
                </div>
              </div>

              <div className="upload-preview-grid">
                <div className="upload-preview-stat">
                  <div className="upload-preview-stat-num mono">{summary.fgCount}</div>
                  <div className="upload-preview-stat-label">FG SKUs</div>
                </div>
                <div className="upload-preview-stat">
                  <div className="upload-preview-stat-num mono">{summary.semiFgCount}</div>
                  <div className="upload-preview-stat-label">Semi-FG</div>
                </div>
                <div className="upload-preview-stat">
                  <div className="upload-preview-stat-num mono">{summary.rawCount}</div>
                  <div className="upload-preview-stat-label">Raw materials</div>
                </div>
                <div className="upload-preview-stat">
                  <div className="upload-preview-stat-num mono">{summary.pkgCount}</div>
                  <div className="upload-preview-stat-label">Packaging</div>
                </div>
                <div className="upload-preview-stat">
                  <div className="upload-preview-stat-num mono">{summary.velocityCount}</div>
                  <div className="upload-preview-stat-label">SKUs with velocity</div>
                </div>
                <div className="upload-preview-stat">
                  <div className={"upload-preview-stat-num mono" + (summary.unmappedCount > 0 ? " warn" : "")}>
                    {summary.unmappedCount}
                  </div>
                  <div className="upload-preview-stat-label">Unmapped rows</div>
                </div>
              </div>

              {parsed.unmapped?.length > 0 && (
                <details className="upload-unmapped">
                  <summary>
                    {parsed.unmapped.length} unmapped item{parsed.unmapped.length === 1 ? "" : "s"} (first 50 shown)
                  </summary>
                  <ul>
                    {parsed.unmapped.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                  <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                    These rows didn't match any known SKU. Add aliases to the parser if they should be tracked.
                  </div>
                </details>
              )}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <div className="muted" style={{ fontSize: 11.5 }}>
            {currentSummary && (
              <button className="link-btn" onClick={handleRevert} style={{ color: "var(--critical)" }}>
                Revert to sample data
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            {stage === "preview" && (
              <button className="btn primary" onClick={handleConfirm}>
                Apply to dashboard
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Compact "data as of" pill — shows the most recent upload's data-as-of
 * date with a click target to open the upload modal. Drop into the
 * topbar or any header where users need to see data freshness at a
 * glance.
 */
export function DataAsOfPill({ onClick }) {
  const { live } = useLiveData();
  if (!live) {
    return (
      <button className="data-asof-pill is-sample" onClick={onClick} title="No sheet uploaded yet — click to upload">
        <span className="data-asof-pill-dot is-sample"/>
        <span className="data-asof-pill-label">Sample data</span>
      </button>
    );
  }
  return (
    <button className="data-asof-pill is-live" onClick={onClick} title={`Uploaded ${formatDateTime(live.uploadedAt)}`}>
      <span className="data-asof-pill-dot is-live"/>
      <span className="data-asof-pill-label">
        Data as of <strong className="mono">{live.dataAsOf || formatDateTime(live.uploadedAt)}</strong>
      </span>
    </button>
  );
}
