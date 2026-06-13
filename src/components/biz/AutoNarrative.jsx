/**
 * AutoNarrative — renders the autoNarrative() digest as a "most-useful-first"
 * band (rubric 59/66): a headline, tone-coded bullets (the founder's "what
 * needs me today"), and an expandable prose body. Presentation-only.
 *
 * Takes autoNarrative() output { headline, paragraphs, bullets:[{tone,text}],
 * asOf }. Tone maps to the standard status colours.
 */
import { useState } from "react";

const TONE = {
  good: { color: "var(--success)", dot: "var(--success)" },
  warn: { color: "var(--warning)", dot: "var(--warning)" },
  critical: { color: "var(--critical)", dot: "var(--critical)" },
  neutral: { color: "var(--ink-2)", dot: "var(--ink-3)" },
};

export function AutoNarrative({ narrative, title = "What changed & what it means" }) {
  const [expanded, setExpanded] = useState(false);
  if (!narrative) return null;
  const { headline, paragraphs = [], bullets = [], asOf } = narrative;
  return (
    <div className="card" style={{ marginBottom: 16, padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div className="muted" style={{ fontSize: 10.5, letterSpacing: 0.4, textTransform: "uppercase" }}>{title}</div>
          <div style={{ fontSize: 16, fontWeight: 500, marginTop: 3 }}>{headline}</div>
        </div>
        {asOf && <span className="cov-badge cov-agency sm" title="Latest data day reflected">as of {asOf}</span>}
      </div>
      {bullets.length > 0 && (
        <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "grid", gap: 6 }}>
          {bullets.map((b, i) => {
            const t = TONE[b.tone] || TONE.neutral;
            return (
              <li key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, lineHeight: 1.5 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.dot, marginTop: 6, flexShrink: 0 }} />
                <span style={{ color: t.color }}>{b.text}</span>
              </li>
            );
          })}
        </ul>
      )}
      {paragraphs.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <button className="btn ghost sm" onClick={() => setExpanded((x) => !x)} aria-expanded={expanded}>
            {expanded ? "Hide detail" : "Read the full read-out"}
          </button>
          {expanded && (
            <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
              {paragraphs.map((p, i) => (
                <p key={i} className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, margin: 0 }}>{p}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
