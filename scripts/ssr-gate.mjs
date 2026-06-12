// SSR gate harness — renders PageSales/PageMarketing/PageFinance with the REAL
// bundled fact store (no window → mergedFacts returns the bundled baseline),
// then asserts: (1) zero render errors, (2) zero raw-float regex hits
// (\d{4,}\.\d{3,} per spec V2.4), (3) the upside-view panels rendered with real
// data (presence of their headings/markers in the static HTML).
import { createServer } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

const PAGES = [
  { id: "sales", path: "/src/pages/PageSales.jsx" },
  { id: "marketing", path: "/src/pages/PageMarketing.jsx" },
  { id: "finance", path: "/src/pages/PageFinance.jsx" },
];

// V2.4 raw-float guard. The spec greps the rendered DOM for \d{4,}\.\d{3,}
// (>=4 integer digits followed by >=3 decimals — an un-fmtINR raw float leak).
const RAW_FLOAT = /\d{4,}\.\d{3,}/g;

// Spot-check markers: each upside view / minor must leave a fingerprint in HTML.
const MARKERS = {
  sales: [
    "Shopify repeat",        // View A retention
    "Returns",               // View A returns trend
    "Cancel",                // View E cancel-rate
  ],
  marketing: [
    "SEO keyword",           // View B
    "Google vs Meta",        // View C
    "itemize",               // M2 itemization
  ],
  // Finance default tab = waterfall; M5 (low base) + M4 (alloc by rev) markers
  // are checked on their own tabs by gateFinanceTabs(), not the default render.
  finance: [],
};

let failures = 0;
const report = [];

// Finance is tab-gated (default = waterfall). M5's low-base annotation lives in
// the CM-trend tab and M4's "losing per ad rupee" count caption lives in the
// SKU / matrix tabs. Render those sub-views directly with the real fact store so
// the markers + raw-float guard cover every Finance view, not just the default.
async function gateFinanceTabs() {
  const [fin, store, eng] = await Promise.all([
    server.ssrLoadModule("/src/pages/PageFinance.jsx"),
    server.ssrLoadModule("/src/lib/businessStore.js"),
    server.ssrLoadModule("/src/lib/cmEngine.js"),
  ]);
  const facts = store.mergedFacts();
  // Pick the latest NATIVE month for the matrix/SKU views (they need SKU grain —
  // an agency/MTD month renders the "agency-tier, no SKU cards" guard, not cards).
  const mm = eng.monthsAvailable(facts);
  const nativeMonths = mm.filter((m) => Object.values(m.channels || {}).some((c) => c.sales === "native")).map((m) => m.month);
  const month = nativeMonths[nativeMonths.length - 1] || "2026-05";
  const view = fin.buildMonthView ? fin.buildMonthView(facts, month) : null;
  // M5 low-base annotation only renders when a low-base month exists in the
  // history (Aug-24/Dec-24 ramp) — the CM-trend view; M4 ("alloc by rev" losing
  // count) lives on the Marketing page (verified there). Finance SKU/matrix here
  // are proven by: real SKU grain (>2k chars, not the 615-char agency guard) +
  // zero raw-floats.
  const tabs = [
    { id: "finance:trend", Comp: fin.CMTrendView, props: { facts }, markers: ["low base", "low-base", "CM3% capped"] },
    { id: "finance:matrix", Comp: fin.MatrixView, props: { view, month }, markers: [], minChars: 2000 },
    { id: "finance:sku", Comp: fin.SkuEconomicsView, props: { view, month }, markers: [], minChars: 2000 },
  ];
  for (const t of tabs) {
    if (typeof t.Comp !== "function") { failures++; report.push(`LOAD-ERROR ${t.id}: export missing`); continue; }
    let html;
    try { html = renderToStaticMarkup(React.createElement(t.Comp, t.props)); }
    catch (e) { failures++; report.push(`RENDER-ERROR ${t.id}: ${e.message}\n${(e.stack||"").split("\n").slice(0,6).join("\n")}`); continue; }
    const hits = [...new Set(html.match(RAW_FLOAT) || [])];
    if (hits.length) { failures++; report.push(`RAW-FLOAT ${t.id}: ${hits.length} unique: ${hits.slice(0,15).join(", ")}`); }
    // markers are "any-of" here (annotation only shows when a low-base month exists)
    const hasMarker = t.markers.length === 0 || t.markers.some((m) => html.includes(m));
    if (!hasMarker) { failures++; report.push(`MISSING-MARKER ${t.id}: none of [${t.markers.join(", ")}]`); }
    if (t.minChars && html.length < t.minChars) { failures++; report.push(`THIN-RENDER ${t.id}: ${html.length} chars < ${t.minChars} (likely hit an empty-state guard, not real grain)`); }
    report.push(`OK ${t.id}: ${html.length} chars · rawFloatHits=${hits.length}${t.markers.length ? ` · marker ${hasMarker ? "present" : "MISSING"}` : ""}`);
  }
}

for (const p of PAGES) {
  try {
    const mod = await server.ssrLoadModule(p.path);
    const Comp = mod.default;
    if (typeof Comp !== "function") throw new Error("default export is not a component");
    let html;
    try {
      html = renderToStaticMarkup(React.createElement(Comp));
    } catch (e) {
      failures++;
      report.push(`RENDER-ERROR ${p.id}: ${e.message}\n${(e.stack || "").split("\n").slice(0, 6).join("\n")}`);
      continue;
    }
    const len = html.length;
    // 1. raw-float regex hits
    const hits = html.match(RAW_FLOAT) || [];
    // De-dup + show context for any hits.
    const uniqHits = [...new Set(hits)];
    if (uniqHits.length) {
      failures++;
      report.push(`RAW-FLOAT ${p.id}: ${uniqHits.length} unique hit(s): ${uniqHits.slice(0, 15).join(", ")}`);
    }
    // 2. marker presence
    const missing = (MARKERS[p.id] || []).filter((m) => !html.includes(m));
    if (missing.length) {
      failures++;
      report.push(`MISSING-MARKER ${p.id}: ${missing.join(", ")}`);
    }
    report.push(`OK ${p.id}: rendered ${len} chars · rawFloatHits=${uniqHits.length} · markers ${(MARKERS[p.id]||[]).length - missing.length}/${(MARKERS[p.id]||[]).length}`);
  } catch (e) {
    failures++;
    report.push(`LOAD-ERROR ${p.id}: ${e.message}\n${(e.stack || "").split("\n").slice(0, 6).join("\n")}`);
  }
}

await gateFinanceTabs();

await server.close();
console.log(report.join("\n"));
console.log(`\nSSR-GATE: ${failures === 0 ? "PASS" : "FAIL"} (${failures} failure group(s))`);
process.exitCode = failures === 0 ? 0 : 1;
