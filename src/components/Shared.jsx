// Shared UI components and icon set for Naturesum Command Center
import { useState, useEffect, useRef, useMemo } from "react";

// ── Icons (inline SVG, 16px) ─────────────────────────────
const Icon = ({ name, size = 16 }) => {
  const paths = {
    home:        <><path d="M3 9l5-5 5 5v4H3V9z" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M6.5 13v-2.5h3V13" stroke="currentColor" strokeWidth="1.4" fill="none"/></>,
    sales:       <><path d="M2.5 12.5l3.5-4 2.5 2.5 5-5.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/><path d="M10 5.5h3.5V9" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"/></>,
    inventory:   <><rect x="2.5" y="3.5" width="11" height="9" rx="1" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M2.5 6.5h11M6 3.5v9" stroke="currentColor" strokeWidth="1.4" fill="none"/></>,
    suppliers:   <><circle cx="8" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M3 13c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5" stroke="currentColor" strokeWidth="1.4" fill="none"/></>,
    marketing:   <><path d="M2.5 7v2L11 12V4L2.5 7z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round"/><path d="M11 5.5v5M4 9v2.5h2" stroke="currentColor" strokeWidth="1.4" fill="none"/></>,
    influencer:  <><circle cx="5.5" cy="5.5" r="2" stroke="currentColor" strokeWidth="1.4" fill="none"/><circle cx="11" cy="9" r="1.5" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M2 13c0-2 1.5-3.5 3.5-3.5S9 11 9 13M8.5 13c0-1.4 1.1-2.5 2.5-2.5s2.5 1.1 2.5 2.5" stroke="currentColor" strokeWidth="1.4" fill="none"/></>,
    marketplace: <><path d="M2.5 5l1-2h9l1 2-1 1.5h-9L2.5 5z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round"/><path d="M3.5 6.5V13h9V6.5M6.5 13V9.5h3V13" stroke="currentColor" strokeWidth="1.4" fill="none"/></>,
    finance:     <><circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M8 5v6M6 7h4M6 9h4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"/></>,
    launches:    <><path d="M11.5 4.5l-7 7M11 4.5h-3.5V8" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/><circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.4" fill="none"/></>,
    alerts:      <><path d="M8 2.5c-2 0-3.5 1.5-3.5 3.5v3l-1 2h9l-1-2V6c0-2-1.5-3.5-3.5-3.5z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round"/><path d="M6.5 12.5c.3.6 1 1 1.5 1s1.2-.4 1.5-1" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"/></>,
    search:      <><circle cx="7" cy="7" r="3.5" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M10 10l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></>,
    chev:        <path d="M4 6l3 3 3-3" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/>,
    up:          <path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>,
    down:        <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>,
    arrowRight:  <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/>,
    download:    <><path d="M8 2.5v8M4.5 7l3.5 3.5L11.5 7" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 13h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></>,
    filter:      <path d="M2.5 4h11l-4 5v3l-3 1V9l-4-5z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round"/>,
    plus:        <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>,
    dots:        <><circle cx="4" cy="8" r="1.2" fill="currentColor"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="12" cy="8" r="1.2" fill="currentColor"/></>,
    refresh:     <><path d="M13 8a5 5 0 1 1-1.5-3.5L13 6" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"/><path d="M13 3v3h-3" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/></>,
    settings:    <><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.5 3.5l1.5 1.5M11 11l1.5 1.5M3.5 12.5L5 11M11 5l1.5-1.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"/></>,
    calendar:    <><rect x="2.5" y="3.5" width="11" height="10" rx="1" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" stroke="currentColor" strokeWidth="1.4"/></>,
    external:    <><path d="M9 3h4v4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/><path d="M13 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M11 9v4H3V5h4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/></>,
    star:        <path d="M8 2l1.7 3.7 4 .4-3 2.8.9 4-3.6-2.1L4.4 13l.9-4-3-2.8 4-.4L8 2z" stroke="currentColor" strokeWidth="1.2" fill="currentColor" strokeLinejoin="round"/>,
    box:         <path d="M8 2.5l5.5 2.7v5.6L8 13.5l-5.5-2.7V5.2L8 2.5z M2.5 5.2L8 8l5.5-2.8M8 8v5.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round"/>,
    truck:       <><path d="M1.5 5.5h7v5h-7zM8.5 7h3l2 2v1.5h-5z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round"/><circle cx="4" cy="11.5" r="1.2" stroke="currentColor" strokeWidth="1.4" fill="none"/><circle cx="11" cy="11.5" r="1.2" stroke="currentColor" strokeWidth="1.4" fill="none"/></>,
    eye:         <><path d="M1.5 8s2.5-4 6.5-4 6.5 4 6.5 4-2.5 4-6.5 4S1.5 8 1.5 8z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round"/><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" fill="none"/></>,
    eyeOff:      <><path d="M1.5 8s2.5-4 6.5-4c1.4 0 2.6.5 3.7 1.2M14.5 8s-2.5 4-6.5 4c-1.4 0-2.6-.5-3.7-1.2" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round"/><path d="M2 2l12 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></>,
    sun:         <><circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.3 3.3l1.3 1.3M11.4 11.4l1.3 1.3M3.3 12.7l1.3-1.3M11.4 4.6l1.3-1.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></>,
    moon:        <path d="M13 9.5A5.5 5.5 0 1 1 6.5 3a4.5 4.5 0 0 0 6.5 6.5z" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round"/>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 16 16">
      {paths[name] || null}
    </svg>
  );
};

// ── Stat / Delta ─────────────────────────────────────────
const Delta = ({ value, unit = "%", suffix, hideArrow }) => {
  // Bug #8 — null-safe. parseFloat(null) → NaN → "NaN%" used to leak through.
  // Now we render an "—" muted chip instead, matching the rest of the design.
  if (value == null) return <span className="delta flat muted">—</span>;
  const v = parseFloat(value);
  if (!Number.isFinite(v)) return <span className="delta flat muted">—</span>;
  const cls = v > 0.05 ? "up" : v < -0.05 ? "down" : "flat";
  return (
    <span className={"delta " + cls}>
      {!hideArrow && (cls === "up" ? <Icon name="up" size={10}/> : cls === "down" ? <Icon name="down" size={10}/> : null)}
      {v > 0 ? "+" : ""}{v.toFixed(1)}{unit}{suffix ? " " + suffix : ""}
    </span>
  );
};

// ── Card ─────────────────────────────────────────────────
const Card = ({ title, sub, action, children, padded = true, style }) => (
  <div className="card" style={style}>
    {(title || action) && (
      <div className="card-head">
        <div>
          {title && <div className="title">{title}</div>}
          {sub && <div className="sub">{sub}</div>}
        </div>
        {action && <div>{action}</div>}
      </div>
    )}
    <div className={"card-body" + (padded ? "" : " flush")}>{children}</div>
  </div>
);

// ── Sparkline ────────────────────────────────────────────
const Sparkline = ({ data, w = 120, h = 36, color = "var(--brand)", fill = true }) => {
  if (!data || data.length === 0) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const r = max - min || 1;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => [i * step, h - 4 - ((v - min) / r) * (h - 8)]);
  const path = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const area = path + ` L${w},${h} L0,${h} Z`;
  return (
    <svg width={w} height={h} className="spark">
      {fill && <path d={area} fill={color} opacity="0.08"/>}
      <path d={path} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round"/>
      <circle cx={pts[pts.length-1][0]} cy={pts[pts.length-1][1]} r="2" fill={color}/>
    </svg>
  );
};

// ── Bar chart (vertical bars) ───────────────────────────
const BarChart = ({ data, w = 380, h = 140, color = "var(--brand)", labels = [] }) => {
  const max = Math.max(...data);
  const barW = w / data.length;
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      {data.map((v, i) => {
        const bh = (v / max) * (h - 24);
        return (
          <g key={i}>
            <rect x={i * barW + barW * 0.15} y={h - 16 - bh} width={barW * 0.7} height={bh} fill={color} rx="2"/>
            {labels[i] && <text x={i * barW + barW/2} y={h - 4} textAnchor="middle" fontSize="9" fill="var(--ink-3)" fontFamily="var(--mono)">{labels[i]}</text>}
          </g>
        );
      })}
    </svg>
  );
};

// ── Progress bar ─────────────────────────────────────────
const Progress = ({ value, max = 100, color = "brand", label, sub }) => {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const cls = color === "red" ? "red" : color === "amber" ? "amber" : color === "green" ? "green" : "";
  return (
    <div>
      {label && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
          <span className="muted">{label}</span>
          {sub && <span className="mono">{sub}</span>}
        </div>
      )}
      <div className="bar-track">
        <div className={"bar-fill " + cls} style={{ width: pct + "%" }}/>
      </div>
    </div>
  );
};

// ── Channel pill ─────────────────────────────────────────
const ChannelPill = ({ ch }) => (
  <span className="badge" style={{ background: ch.color + "22", color: ch.color, borderColor: ch.color + "55" }}>
    {ch.short}
  </span>
);

// expose globally

export { Icon, Delta, Card, Sparkline, BarChart, Progress, ChannelPill };
