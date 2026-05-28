import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Sidebar, Topbar, NAV } from "./components/Nav.jsx";
import NSData from "./data.js";
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

  const D = NSData;
  const isPreviewPage = active !== "inventory";
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
      <Sidebar active={active} onNav={goTo} role={role} alertsByRole={alertsByRole}/>
      <div className="main">
        <Topbar
          active={active}
          role={role}
          onRole={setRole}
          navLabel={navLabel}
          previewMode={previewMode}
          onTogglePreview={() => setPreviewMode(p => !p)}
          isPreviewPage={isPreviewPage}
        />
        {showPreviewUI && (
          <div className="preview-banner">
            <span className="preview-stripe" aria-hidden="true"/>
            <span className="preview-pill">UI Preview</span>
            <span className="preview-text">
              <strong>{navLabel}</strong> is a design preview — the layout is final but the data is
              static and the integrations aren’t wired up yet. Only <strong>Inventory</strong> is live.
            </span>
            <button className="preview-cta" onClick={() => goTo("inventory")}>
              Go to live module →
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
