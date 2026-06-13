/**
 * AnomalyBadge — a small, scannable badge for a detected anomaly / day flag
 * (rubric 51/70). Colour + icon read at a glance; the full reason is the title
 * and the visible label. Presentation-only; NaN-safe.
 *
 * Props (one of):
 *   anomaly — a detectAnomalies() row { z, direction, severity, label, value }
 *   flag    — a dailyFlags() row { flag, label, z, iso }
 *   text    — a plain label override
 */
import { flagColor } from "./ScorecardHelpers.jsx";

const SEV_COLOR = { severe: "var(--critical)", notable: "var(--warning)" };
const DIR_ICON = { high: "▲", low: "▼" };

export function AnomalyBadge({ anomaly, flag, text }) {
  if (anomaly) {
    const color = SEV_COLOR[anomaly.severity] || "var(--warning)";
    return (
      <span
        className="cov-badge sm"
        title={anomaly.label || `${Math.abs(anomaly.z)}σ ${anomaly.direction}`}
        style={{ background: color + "1c", color, borderColor: color + "55", display: "inline-flex", gap: 3, alignItems: "center" }}
      >
        {DIR_ICON[anomaly.direction] || "●"} {Math.abs(Number(anomaly.z)).toFixed(1)}σ {text || anomaly.direction}
      </span>
    );
  }
  if (flag) {
    if (flag.flag === "normal") return null;
    const color = flagColor(flag.flag);
    const ICON = { peak: "★", strong: "▲", soft: "▼", "anomaly-low": "▼", "anomaly-high": "▲" };
    return (
      <span
        className="cov-badge sm"
        title={flag.label}
        style={{ background: color + "1c", color, borderColor: color + "55", display: "inline-flex", gap: 3, alignItems: "center" }}
      >
        {ICON[flag.flag] || "●"} {text || flag.flag.replace("-", " ")}
      </span>
    );
  }
  return <span className="cov-badge sm">{text || "—"}</span>;
}
