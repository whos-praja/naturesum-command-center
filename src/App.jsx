import { useState, useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Sidebar, Topbar, NAV } from "./components/Nav.jsx";
import NSData from "./data.js";
import { mergedFacts } from "./lib/businessStore.js";
import PageHome from "./pages/PageHome.jsx";
import PageSales from "./pages/PageSales.jsx";
import PageInventory from "./pages/PageInventory.jsx";
import PageSuppliers from "./pages/PageSuppliers.jsx";
import PageMarketing from "./pages/PageMarketing.jsx";
import PageInfluencer from "./pages/PageInfluencer.jsx";
import PageMarketplaceIntel from "./pages/PageMarketplaceIntel.jsx";
import PageFinance from "./pages/PageFinance.jsx";
import PageLaunches from "./pages/PageLaunches.jsx";
import PageAlerts from "./pages/PageAlerts.jsx";

// Naturesum Command Center — main app shell
// URL shape: /{section}/{subsection?}
//   /                 → Command Center
//   /inventory        → Inventory (defaults to /inventory/unified)
//   /inventory/runway → Inventory · Runway tab
//   /sales, /finance, /alerts, etc.

const SECTION_IDS = new Set(NAV.map(n => n.id));

const App = () => {
  const navigate = useNavigate();
  const { section, subsection } = useParams();

  // Map URL → active section. Unknown / missing → "home".
  const active = (section && SECTION_IDS.has(section)) ? section : "home";

  const [role, setRole] = useState("founder");

  // Preview-mode blur toggle (persisted)
  const [previewMode, setPreviewMode] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = window.localStorage.getItem("ns.previewMode");
    return stored === null ? true : stored === "true";
  });
  useEffect(() => {
    window.localStorage.setItem("ns.previewMode", String(previewMode));
  }, [previewMode]);

  // Dark / light theme toggle (persisted). data-theme on <html> drives the
  // CSS-variable override under html[data-theme="dark"] in index.css, so
  // every component picks up the new palette automatically — no per-page
  // logic needed.
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "light";
    return window.localStorage.getItem("ns.theme") || "light";
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    window.localStorage.setItem("ns.theme", theme);
  }, [theme]);

  const D = NSData;

  // M6 — the sidebar footer no longer reads "Last sync · 21 May" (which looked
  // like stale data). Instead it shows "Data through <latest fact date>" derived
  // from the live fact store (meta.latestDataDate, baked by the build = max date
  // across all monthly/daily facts), plus the app build date as separate context.
  // This is real provenance, not a fabricated sync clock. Computed once — the
  // bundled baseline is static within a session unless a report is uploaded.
  const dataProvenance = useMemo(() => {
    try {
      const meta = mergedFacts()?.meta || {};
      return {
        latestDataDate: meta.latestDataDate || null,
        appBuildDate: meta.appBuildDate || null,
      };
    } catch {
      return { latestDataDate: null, appBuildDate: null };
    }
  }, []);

  // Pages backed by REAL derived data (inventory + the rebuilt Business
  // Performance pages) are never preview-blurred. Spec §9: "Un-gate these
  // pages from preview/blur mode." Extensible — add a section id here as each
  // page is rebuilt onto the live fact store.
  const LIVE_DATA_PAGES = new Set(["inventory", "marketing", "finance", "sales"]);
  const isPreviewPage = !LIVE_DATA_PAGES.has(active);
  const showPreviewUI = isPreviewPage && previewMode;

  // Navigation helper passed to Sidebar / page components
  const goTo = (id, sub) => {
    if (id === "home") navigate("/");
    else if (sub) navigate(`/${id}/${sub}`);
    else navigate(`/${id}`);
  };

  // If user switches role and current page isn't allowed for them, bounce home.
  useEffect(() => {
    const nav = NAV.find(n => n.id === active);
    if (nav && !nav.roles.includes(role)) navigate("/");
  }, [role, active, navigate]);

  // Clean up bogus URLs: if section was in URL but not recognized, normalize to /.
  useEffect(() => {
    if (section && !SECTION_IDS.has(section)) navigate("/", { replace: true });
  }, [section, navigate]);

  // alert counts by role
  const visibleAlerts = D.alerts.filter(a => a.roles.includes(role) || role === "founder" || role === "office");
  const alertsByRole = {
    crit: visibleAlerts.filter(a => a.sev === "crit").length,
    warn: visibleAlerts.filter(a => a.sev === "warn").length,
    info: visibleAlerts.filter(a => a.sev === "info").length,
  };

  const navItem = NAV.find(n => n.id === active);
  const navLabel = navItem ? navItem.label : "Command Center";

  const screenLabel = `${String(NAV.findIndex(n => n.id === active) + 1).padStart(2, "0")} ${navLabel}`;

  // Browser tab title — defaults to "Naturesum Command Center", appends
  // the active section name on every other page.
  useEffect(() => {
    document.title = active === "home"
      ? "Naturesum Command Center"
      : `${navLabel} · Naturesum Command Center`;
  }, [active, navLabel]);

  return (
    <div className="app" data-screen-label={screenLabel}>
      <Sidebar active={active} onNav={goTo} role={role} alertsByRole={alertsByRole} dataProvenance={dataProvenance}/>
      <div className="main">
        <Topbar
          active={active}
          role={role}
          onRole={setRole}
          navLabel={navLabel}
          previewMode={previewMode}
          onTogglePreview={() => setPreviewMode(p => !p)}
          isPreviewPage={isPreviewPage}
          theme={theme}
          onToggleTheme={() => setTheme(t => t === "dark" ? "light" : "dark")}
        />
        {showPreviewUI && (
          <div className="preview-banner">
            <span className="preview-stripe" aria-hidden="true"/>
            <span className="preview-pill">UI Preview</span>
            <span className="preview-text">
              <strong>{navLabel}</strong> is a design preview — the layout is final but the data is
              static and the integrations aren’t wired up yet. <strong>Inventory</strong>,{" "}
              <strong>Finance</strong>, <strong>Sales</strong> and <strong>Marketing</strong> run on live data.
            </span>
            <button className="preview-cta" onClick={() => goTo("finance")}>
              Go to a live module →
            </button>
          </div>
        )}
        <div className="content" data-preview={showPreviewUI ? "true" : "false"}>
          {active === "home"        && <PageHome role={role} onNav={goTo}/>}
          {active === "sales"       && <PageSales/>}
          {active === "inventory"   && <PageInventory subsection={subsection}/>}
          {active === "suppliers"   && <PageSuppliers/>}
          {active === "marketing"   && <PageMarketing/>}
          {active === "influencer"  && <PageInfluencer/>}
          {active === "marketplace" && <PageMarketplaceIntel/>}
          {active === "finance"     && <PageFinance/>}
          {active === "launches"    && <PageLaunches/>}
          {active === "alerts"      && <PageAlerts role={role} onNav={goTo}/>}
        </div>
      </div>
    </div>
  );
};


export default App;
