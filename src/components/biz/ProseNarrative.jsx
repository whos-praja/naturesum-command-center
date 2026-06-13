/**
 * ProseNarrative — renders the proseWeeklyNarrative() read-out as flowing PROSE
 * (rubric VII-59) — real paragraphs, not bullets. The "what changed and what it
 * means this week" first-pass analysis, in the tool's own words.
 *
 * Takes proseWeeklyNarrative() output:
 *   { month, asOf, weekLabel, prose:[…paragraphs], coveredChannels, topSkuLine }.
 *
 * Presentation-only. The last paragraph (the "what it means for Monday" call) is
 * visually lifted so the action is the eye's resting point.
 *
 * Props: narrative, title.
 */
export function ProseNarrative({ narrative, title = "This week, in words" }) {
  if (!narrative || !Array.isArray(narrative.prose) || narrative.prose.length === 0) return null;
  const { prose, weekLabel, asOf } = narrative;
  const body = prose.slice(0, -1);
  const closer = prose[prose.length - 1];
  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div className="muted" style={{ fontSize: 10.5, letterSpacing: 0.4, textTransform: "uppercase" }}>{title}</div>
        {weekLabel && <span className="cov-badge cov-agency sm" title={asOf ? `latest data day ${asOf}` : ""}>{weekLabel}</span>}
      </div>
      <div style={{ marginTop: 10, display: "grid", gap: 9 }}>
        {body.map((p, i) => (
          <p key={i} style={{ fontSize: 13, lineHeight: 1.65, margin: 0, color: "var(--ink)" }}>{p}</p>
        ))}
        {closer && (
          <p style={{
            fontSize: 13, lineHeight: 1.65, margin: 0, color: "var(--ink)", fontWeight: 500,
            padding: "10px 12px", borderRadius: 8, background: "var(--bg-canvas)", borderLeft: "3px solid var(--brand)",
          }}>{closer}</p>
        )}
      </div>
    </div>
  );
}
