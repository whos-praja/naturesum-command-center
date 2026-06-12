import { useState, useEffect, useRef } from "react";
import { UserButton } from "@clerk/clerk-react";
import { Icon } from "./Shared.jsx";

// Auth-aware flag — derived from the env var at import time. When false,
// main.jsx doesn't mount a ClerkProvider, so we must NOT render any Clerk
// components or call any Clerk hooks. We gate the UserButton on this.
const AUTH_ENABLED = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

// Sidebar and Topbar for Naturesum Command Center

const ROLES = [
  { id: "founder",     name: "Cristoo Arora",     sub: "Founder · full access" },
  { id: "office",      name: "Founder's Office",  sub: "Internal senior — full access" },
  { id: "ops",         name: "Naina (Ops)",        sub: "Operations · inventory, supply, warehouse" },
  { id: "ads",         name: "Pixelweave Media",  sub: "Ad agency · ads + ROAS" },
  { id: "marketplace", name: "ListLogic Agency",  sub: "Marketplace · sales, listings, ratings" },
  { id: "vcfo",        name: "Sastr & Co · vCFO", sub: "Finance · P&L, cash, cost cards" },
];

const NAV = [
  { id: "home",        label: "Command Center", icon: "home",        roles: ["founder","office","ops","ads","marketplace","vcfo"] },
  { id: "sales",       label: "Sales & Revenue", icon: "sales",       roles: ["founder","office","ads","marketplace"] },
  { id: "inventory",   label: "Inventory",       icon: "inventory",   roles: ["founder","office","ops","marketplace"] },
  { id: "suppliers",   label: "Suppliers",       icon: "suppliers",   roles: ["founder","office","ops","vcfo"] },
  { id: "marketing",   label: "Marketing & Ads", icon: "marketing",   roles: ["founder","office","ads"] },
  { id: "influencer",  label: "Influencers",     icon: "influencer",  roles: ["founder","office","ads"] },
  { id: "marketplace", label: "Marketplace Intel", icon: "marketplace", roles: ["founder","office","marketplace"] },
  { id: "finance",     label: "Finance & Unit Econ", icon: "finance", roles: ["founder","office","vcfo"] },
  { id: "launches",    label: "Launch Tracker",  icon: "launches",    roles: ["founder","office","ops","marketplace","ads"] },
  { id: "alerts",      label: "Alerts",          icon: "alerts",      roles: ["founder","office","ops","ads","marketplace","vcfo"] },
];

// "2026-06-10" → "10 Jun 2026". Bad/missing input → null (caller falls back).
const fmtDataDate = (iso) => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, mo, d] = iso.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(d)} ${names[Number(mo) - 1] || mo} ${y}`;
};

const Sidebar = ({ active, onNav, role, alertsByRole, dataProvenance }) => {
  const visible = NAV.filter(n => n.roles.includes(role));
  // M6 — provenance footer. "Data through <latest fact date>" is the honest
  // label: it is the newest date present in the fact store, NOT a sync clock.
  // The build date is shown separately so neither reads as data staleness.
  const dataThrough = fmtDataDate(dataProvenance?.latestDataDate);
  const buildDate = fmtDataDate(dataProvenance?.appBuildDate);
  // simple split: first is Home, rest grouped under "WORKSPACE", alerts at end
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="mark">N</div>
        <div>
          <div className="name">Naturesum</div>
          <div className="sub">Command Center</div>
        </div>
      </div>

      <div className="sidebar-section">Overview</div>
      <button className={"nav-item" + (active === "home" ? " active" : "")} onClick={() => onNav("home")}>
        <span className="ico"><Icon name="home"/></span> Command Center
      </button>

      <div className="sidebar-section">Workspace</div>
      {visible.filter(n => n.id !== "home" && n.id !== "alerts").map(n => (
        <button key={n.id} className={"nav-item" + (active === n.id ? " active" : "")} onClick={() => onNav(n.id)}>
          <span className="ico"><Icon name={n.icon}/></span>
          {n.label}
          {n.id === "inventory" && <span className="live-pill">LIVE</span>}
        </button>
      ))}

      <div className="sidebar-section">Signal</div>
      <button className={"nav-item" + (active === "alerts" ? " active" : "")} onClick={() => onNav("alerts")}>
        <span className="ico"><Icon name="alerts"/></span>
        Alerts
        {alertsByRole.crit > 0 && <span className="count crit">{alertsByRole.crit}</span>}
        {alertsByRole.crit === 0 && alertsByRole.warn > 0 && <span className="count">{alertsByRole.warn}</span>}
      </button>

      <div className="sidebar-footer">
        <div className="status-line">
          <span className="dot"/>
          All integrations live
        </div>
        <div
          style={{ paddingLeft: 12, color: "#6F756B", fontSize: 10.5 }}
          title={
            dataThrough
              ? `Business fact store contains data up to ${dataThrough} (newest order/invoice/spend date across all sources). This is data freshness, not a live sync clock.`
              : "Latest data date unavailable from the fact store."
          }
        >
          {dataThrough ? `Data through · ${dataThrough}` : "Data freshness · —"}
        </div>
        <div style={{ marginTop: 8, color: "#9CA098" }}>
          {buildDate ? `app build · ${buildDate}` : "v1.0.4"}
        </div>
      </div>
    </aside>
  );
};

const Topbar = ({ active, role, onRole, navLabel, previewMode, onTogglePreview, isPreviewPage, theme, onToggleTheme }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const r = ROLES.find(x => x.id === role) || ROLES[0];
  const initials = r.name.split(" ").map(s => s[0]).slice(0, 2).join("").toUpperCase();

  return (
    <header className="topbar">
      <div className="crumbs">
        <span>Naturesum</span>
        <span className="sep">/</span>
        <span className="here">{navLabel}</span>
      </div>
      <div className="topbar-spacer"/>

      <div className="search">
        <Icon name="search" size={14}/>
        <input placeholder="Search SKU, supplier, alert…"/>
        <kbd>⌘K</kbd>
      </div>

      <button
        className={"preview-toggle" + (previewMode ? "" : " is-off")}
        onClick={onTogglePreview}
        title={
          previewMode
            ? "Preview mode is ON. Non-live modules are blurred. Click to show full UI."
            : "Full view: all modules visible. Click to re-enable preview blur."
        }
      >
        <Icon name={previewMode ? "eye" : "eyeOff"} size={13}/>
        <span className="preview-toggle-label">
          {previewMode ? "Preview mode" : "Full view"}
        </span>
        <span className={"preview-toggle-state " + (previewMode ? "on" : "off")}>
          {previewMode ? "ON" : "OFF"}
        </span>
      </button>

      <button className="btn ghost icon" title="Refresh data"><Icon name="refresh"/></button>
      <button
        className="btn ghost icon"
        onClick={onToggleTheme}
        title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        aria-label="Toggle theme"
      >
        <Icon name={theme === "dark" ? "sun" : "moon"}/>
      </button>

      <div className="role-switch" ref={ref} onClick={() => setOpen(o => !o)}>
        <div className="avatar">{initials}</div>
        <div>
          <div className="role-name">{r.name}</div>
          <div className="role-sub">{r.sub}</div>
        </div>
        <span className="chev"><Icon name="chev" size={14}/></span>
        {open && (
          <div className="role-menu" onClick={e => e.stopPropagation()}>
            <div style={{ padding: "8px 10px 6px", fontSize: 10.5, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              View as role
            </div>
            {ROLES.map(R => (
              <div key={R.id} className={"role-menu-item" + (R.id === role ? " active" : "")} onClick={() => { onRole(R.id); setOpen(false); }}>
                <div className="avatar" style={{ width: 26, height: 26, fontSize: 10 }}>
                  {R.name.split(" ").map(s=>s[0]).slice(0,2).join("").toUpperCase()}
                </div>
                <div>
                  <div className="role-name">{R.name}</div>
                  <div className="role-sub">{R.sub}</div>
                </div>
              </div>
            ))}
            <div style={{ padding: "8px 10px", fontSize: 11, color: "var(--ink-3)", borderTop: "1px solid var(--border-soft)", marginTop: 4 }}>
              Each role sees only the modules in their access scope.
            </div>
          </div>
        )}
      </div>

      {AUTH_ENABLED && (
        <>
          <div className="topbar-divider"/>
          <div className="topbar-user">
            <UserButton
              afterSignOutUrl="/sign-in"
              appearance={{
                elements: {
                  avatarBox: { width: 28, height: 28 },
                },
              }}
            />
          </div>
        </>
      )}
    </header>
  );
};


export { Sidebar, Topbar, ROLES, NAV };
