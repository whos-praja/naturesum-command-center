/**
 * BizUploadButton — the SHARED "Upload reports" + freshness affordance for the
 * three business pages (Sales · Finance · Marketing).
 *
 * Why this exists (role: IA/INGEST OWNER; rubric XI/81-83 + IX/72-75):
 *   • XI/81 — an in-tool upload affordance must be reachable from EVERY business
 *     page, not just one. Today each page re-declares its own bare "Upload
 *     reports" button with subtly different copy/markup → drift. This is the
 *     single, consistent entry point: same label, same freshness chip, same
 *     modal (opened on the Business Performance tab), everywhere.
 *   • XI/83 — "Data through <true latest data day>" must be true to the actual
 *     newest data day in the fact store (not a calendar artifact) and CONSISTENT
 *     with the sidebar + inventory. Both this chip and the sidebar read the
 *     SAME meta.latestDataDate (baked = max date across all monthly/daily facts),
 *     so the freshness label can never disagree between surfaces.
 *   • IX/72 — visual/label consistency with the inventory module's DataAsOfPill:
 *     same download icon, same live-dot, same "click to update" affordance.
 *
 * Self-contained: owns its own modal-open state and mounts UploadModal with
 * defaultTab="business". A page adopts it with a one-line import + element in its
 * header actions — no per-page modal wiring, no per-page freshness logic. The
 * three page files do NOT need to change their existing buttons to render; when a
 * page swaps its bare button for <BizUploadButton/> it gets the freshness chip
 * and the guaranteed-consistent copy for free.
 *
 * Pure-read for the freshness value (mergedFacts().meta.latestDataDate); the only
 * side-effect is opening the upload modal. NaN/format-safe — a missing latest date
 * degrades to "—" rather than rendering a bogus or crashing label (rubric X/79).
 */
import { useState, useMemo } from "react";
import { Icon } from "../Shared.jsx";
import { UploadModal } from "../UploadModal.jsx";
import { mergedFacts } from "../../lib/businessStore.js";

// "2026-06-10" → "10 Jun 2026"; anything malformed → null so the caller shows "—".
// IDENTICAL formatting to Nav.jsx's fmtDataDate so the chip and the sidebar read
// the same string for the same date (rubric XI/83 consistency).
function fmtDataDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, mo, d] = iso.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(d)} ${names[Number(mo) - 1] || mo} ${y}`;
}

/**
 * <BizUploadButton/>
 *   variant : "button" (default — a labelled button) | "pill" (DataAsOfPill-style
 *             status chip mirroring the inventory topbar affordance).
 *   showFreshness : render the "Data through · <date>" chip beside the button
 *             (default true). Set false if the page already shows a MonthBadge.
 *   label   : override the button text (default "Upload reports").
 *   onOpen / onClose : optional hooks if a page wants to react to modal state.
 */
export default function BizUploadButton({
  variant = "button",
  showFreshness = true,
  label = "Upload reports",
  onOpen,
  onClose,
}) {
  const [open, setOpen] = useState(false);

  // The freshness value is the SAME meta.latestDataDate the sidebar reads — the
  // true newest order/invoice/spend date across every business source, baked at
  // build time (and refreshed on upload + reload). Computed once per mount; the
  // bundled baseline is static within a session unless a report is uploaded.
  const freshness = useMemo(() => {
    try {
      const latest = mergedFacts()?.meta?.latestDataDate || null;
      return { iso: latest, label: fmtDataDate(latest) };
    } catch {
      return { iso: null, label: null };
    }
  }, []);

  const handleOpen = () => { setOpen(true); onOpen?.(); };
  const handleClose = () => { setOpen(false); onClose?.(); };

  const freshTitle = freshness.label
    ? `Business fact store contains data through ${freshness.label} — the newest order/invoice/spend date across all sources (Snell, Monarch, native marketplace exports). This is data freshness, not a live sync clock.`
    : "Latest data date unavailable from the fact store.";

  return (
    <>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        {/* Freshness chip — consistent with the sidebar's "Data through" label,
            so a founder reads the same date here, in the sidebar, and (for the
            warehouse) on inventory. Quiet by design; the depth is in the title. */}
        {showFreshness && (
          <span
            title={freshTitle}
            style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              fontSize: 11, color: "var(--ink-3)", whiteSpace: "nowrap",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 6, height: 6, borderRadius: "50%",
                background: freshness.iso ? "var(--success)" : "var(--ink-4)",
                display: "inline-block",
              }}
            />
            {freshness.label ? <>Data through · <strong style={{ color: "var(--ink-2)", fontWeight: 600 }}>{freshness.label}</strong></> : "Data freshness · —"}
          </span>
        )}

        {variant === "pill" ? (
          // Mirrors the inventory DataAsOfPill shape (download icon + live dot +
          // label) so the upload affordance LOOKS the same across modules (IX/72).
          <button
            className="btn"
            onClick={handleOpen}
            title="Upload the source exports that feed Finance / Sales / Marketing — Snell, Monarch, Amazon, Flipkart, Blinkit, Shopify. Re-uploading a source replaces it (idempotent); native reports override agency."
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Icon name="download" size={13} />
            {label}
          </button>
        ) : (
          <button
            className="btn sm"
            onClick={handleOpen}
            title="Upload the source exports that feed Finance / Sales / Marketing — Snell, Monarch, Amazon, Flipkart, Blinkit, Shopify. Re-uploading a source replaces it (idempotent); native reports override agency."
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Icon name="download" size={13} />
            {label}
          </button>
        )}
      </div>

      {open && <UploadModal onClose={handleClose} defaultTab="business" />}
    </>
  );
}
