import { Component } from "react";

/**
 * BizStateGuard — the DESIGNED empty / error states for the three business
 * modules (rubric 79: "every state is designed … never a blank or a crash").
 *
 * Two states it owns:
 *   • EMPTY  — the merged fact store has no usable sales data at all (a fresh
 *     install with the bundle stripped, or a store cleared/corrupted). Instead of
 *     a page of blank panels, the founder sees what's missing and a clear path
 *     (upload a report) to fix it.
 *   • ERROR  — a render/parse failure anywhere inside the page subtree is caught
 *     here (React error boundary) and shown as a legible, recoverable message
 *     with the actual error + an upload CTA, never a white screen or console-only
 *     crash. The rest of the app keeps working.
 *
 * Usage: wrap a page body. `facts` lets it detect EMPTY before the children even
 * try to render; the boundary catches anything thrown during render.
 *
 *   <BizStateGuard facts={facts} module="Sales" onUpload={() => setUploadOpen(true)}>
 *     …page…
 *   </BizStateGuard>
 */

function hasUsableData(facts) {
  if (!facts || typeof facts !== "object") return false;
  const monthly = facts.monthly || {};
  const daily = facts.daily || {};
  // usable = at least one monthly OR daily cell with a finite revenue/units field.
  const probe = (obj) => {
    for (const cell of Object.values(obj)) {
      if (!cell || typeof cell !== "object") continue;
      const n = Number(cell.netRev) || Number(cell.grossRev) || Number(cell.units);
      if (Number.isFinite(n) && n !== 0) return true;
    }
    return false;
  };
  return probe(monthly) || probe(daily);
}

const Shell = ({ tone = "neutral", icon, title, children, onUpload }) => (
  <div className="page">
    <div
      className="card"
      style={{
        margin: "32px auto", maxWidth: 560, padding: "32px 28px", textAlign: "center",
        border: tone === "error" ? "1px solid var(--critical)" : "1px solid var(--border)",
      }}
    >
      <div style={{ fontSize: 30, lineHeight: 1, marginBottom: 12 }} aria-hidden="true">{icon}</div>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: tone === "error" ? "var(--critical)" : "var(--ink)" }}>{title}</div>
      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 18 }}>{children}</div>
      {onUpload && (
        <button className="btn" onClick={onUpload}>Upload a report</button>
      )}
    </div>
  </div>
);

class BizStateGuard extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    // Keep a console trail for debugging without crashing the app.
    // eslint-disable-next-line no-console
    console.error(`[${this.props.module || "Business"} module] render error caught by BizStateGuard:`, error, info);
  }
  render() {
    const { facts, module = "this", onUpload, children } = this.props;
    const { error } = this.state;

    if (error) {
      return (
        <Shell tone="error" icon="⚠" title={`Couldn't render the ${module} module`} onUpload={onUpload}>
          Something in the data made a panel fail to draw — the rest of the app is fine, and nothing was changed.
          This is usually a malformed or partially-uploaded report.{" "}
          <span style={{ display: "block", marginTop: 10, fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)", wordBreak: "break-word" }}>
            {String(error && (error.message || error))}
          </span>
          <span style={{ display: "block", marginTop: 10 }}>
            Re-upload the latest export to recover, or reload the page to retry.
          </span>
        </Shell>
      );
    }

    if (!hasUsableData(facts)) {
      return (
        <Shell icon="◔" title="No business data yet" onUpload={onUpload}>
          The {module} module reads from your uploaded channel exports (Snell, Monarch, Amazon, Flipkart, Blinkit,
          Shopify). None are loaded yet, so there's nothing to show.
          <span style={{ display: "block", marginTop: 10 }}>
            Upload any one report to bring this page to life — native marketplace exports take precedence over agency
            estimates, and re-uploading the same window replaces, never double-counts.
          </span>
        </Shell>
      );
    }

    return children;
  }
}

export default BizStateGuard;
export { hasUsableData };
