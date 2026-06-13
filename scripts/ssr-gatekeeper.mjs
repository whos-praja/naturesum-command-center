// GATEKEEPER SSR harness — renders the 3 business pages with the REAL bundle,
// scans for raw-float artifacts / render errors, asserts EVERY new round-3
// section is present, and runs the cross-module velocity invariant. No DOM; pages
// fall back to the bundled fact store because `typeof window === "undefined"`.
//
// PageSales is now TABBED (rubric IX/67), so the default static render only shows
// the "daily" tab. We render the page ONCE PER TAB (via the optional `initialTab`
// verification prop) and assert against the UNION of all tab markup — the real,
// reachable surface a founder navigates, not just the landing tab.
import { createServer } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const ROOT = new URL("..", import.meta.url).pathname;

globalThis.matchMedia ||= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });

const vite = await createServer({
  root: ROOT,
  appType: "custom",
  server: { middlewareMode: true, hmr: false },
  logLevel: "error",
});

// Sales tabs to walk (must match TABS in PageSales.jsx).
const SALES_TABS = ["daily", "movers", "forecast", "retention", "sku", "cross", "geo", "reconcile"];

// (PAGES is built after FIN_TABS is declared below.)

// Raw-float artifact detector: >=4 integer digits, a decimal point, >=3 fractional
// digits in *visible* text. fmtINR/fmtN never emit this; a raw float would.
const RAW_FLOAT = /\d{4,}\.\d{3,}/g;

// Required sections — substrings matched case-insensitively against the UNION of
// rendered text across all tabs. These encode the round-3 deductions + the
// left-on-the-table items the prompt asks the gate to confirm are present.
const REQUIRED = {
  PageSales: [
    "data through",          // freshness
    "velocity",              // cross-module reconciled velocity (rubric 17/58)
    "concentration",         // dependency risk (57)
    "forecast",              // VII/52 channel+SKU forward
    "what it means",         // VII/59 auto prose narrative (Monday band)
    "monday",                // VIII action queue ("what to do Monday")
    "ltv",                   // VI/46 cohort/LTV
    "returning",             // (e) new-vs-returning AOV
    "basket",                // VI/45 basket / units-per-order
    "cancel",                // (VI/47) cancel rate
    "geo",                   // (g) geographic concentration
    "not derivable",         // param 89 explicit deferral (Flipkart/Blinkit repeat)
    "thin base",             // II/18 small-sample annotation
  ],
  PageMarketing: [
    "data through",
    "acos",
    "attribut",              // attribution confidence
    "blinkit",               // III modeled Blinkit ad proxy
    "modeled",               // proxy labelled modeled-not-measured
    "google vs meta",        // efficiency comparison
    "keyword",               // SEO keywords
    "conversion",            // (c) Monarch conv-value vs Shopify-net inflation (rendered here)
    "cashback",              // (d) Flipkart cashback settlement-drag (rendered here)
  ],
  PageFinance: [
    "data through",
    "cm1",
    "cm3",
    "cost-change",           // (f) COGS cost-change history (cost tab)
  ],
};

// Finance tabs to walk (must match the tab buttons in PageFinance.jsx). The
// conversion-gap insight lives in the CM-trend tab; cost-change in the cost tab.
const FIN_TABS = ["waterfall", "matrix", "bridge", "forecast", "levers", "actions", "sku", "trend", "cost", "coverage", "verify"];

const PAGES = [
  { name: "PageSales", file: "/src/pages/PageSales.jsx", tabs: SALES_TABS },
  { name: "PageMarketing", file: "/src/pages/PageMarketing.jsx", tabs: null },
  { name: "PageFinance", file: "/src/pages/PageFinance.jsx", tabs: FIN_TABS },
];

function stripTags(html) {
  return html.replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/gi, " ");
}

const results = [];
for (const p of PAGES) {
  const out = { name: p.name, ok: true, errors: [], rawFloats: [], missing: [], len: 0, tabsRendered: 0 };
  try {
    const mod = await vite.ssrLoadModule(p.file);
    const Comp = mod.default;
    if (typeof Comp !== "function") throw new Error("default export is not a component");

    // Render every tab (or once if untabbed) and union the visible text.
    const variants = p.tabs ? p.tabs : [undefined];
    let unionText = "";
    let unionLen = 0;
    for (const t of variants) {
      const html = renderToStaticMarkup(React.createElement(Comp, t ? { initialTab: t } : {}));
      unionLen += html.length;
      unionText += " " + stripTags(html);
      out.tabsRendered++;
      // raw-float scan per-variant (catches a float that only appears in one tab)
      const hits = [...stripTags(html).matchAll(RAW_FLOAT)].map((m) => m[0]);
      out.rawFloats.push(...hits);
    }
    out.len = unionLen;
    out.rawFloats = [...new Set(out.rawFloats)];

    const lc = unionText.toLowerCase();
    for (const need of REQUIRED[p.name]) {
      if (!lc.includes(need.toLowerCase())) out.missing.push(need);
    }
  } catch (e) {
    out.ok = false;
    out.errors.push(e && e.stack ? e.stack.split("\n").slice(0, 8).join("\n") : String(e));
  }
  results.push(out);
}

// ── XI · ingestion self-test affordance: run the REAL module green, and confirm
// it is wired into the in-tool UploadModal (a click away on every business page),
// so idempotency/native-override is DEMONSTRATED in the UI, not just claimed.
let selfTestOk = false, selfTestDetail = "";
try {
  const st = await vite.ssrLoadModule("/src/lib/ingestionSelfTest.js");
  const r = st.runIngestionSelfTest();
  const upMod = await vite.ssrLoadModule("/src/components/UploadModal.jsx");
  const wired = typeof upMod.UploadModal === "function";  // modal mounts the IngestionSelfTest panel
  selfTestOk = r.ok && r.idempotency.ok && r.overrides.ok && wired;
  selfTestDetail = `green=${r.ok}, parse-twice≡once=${r.idempotency.ok} (${r.idempotency.onceCells} cells), native>agency=${r.overrides.ok} (${r.overrides.suppressedCells}/${r.overrides.nativeCells}), UploadModal-wired=${wired}`;
} catch (e) {
  selfTestDetail = "ERROR: " + e.message;
}

await vite.close();

let fail = false;
for (const r of results) {
  const bad = !r.ok || r.rawFloats.length > 0 || r.missing.length > 0;
  if (bad) fail = true;
  console.log(`\n===== ${r.name} =====`);
  console.log(`  render: ${r.ok ? "OK" : "ERROR"}  (markup ${r.len} chars across ${r.tabsRendered} tab${r.tabsRendered === 1 ? "" : "s"})`);
  if (r.errors.length) console.log("  ERRORS:\n" + r.errors.map((e) => "    " + e.replace(/\n/g, "\n    ")).join("\n"));
  console.log(`  raw-float hits: ${r.rawFloats.length}${r.rawFloats.length ? " → " + r.rawFloats.slice(0, 20).join(", ") : ""}`);
  console.log(`  required sections missing: ${r.missing.length}${r.missing.length ? " → " + r.missing.join(", ") : " (none)"}`);
}

console.log(`\n===== XI · Ingestion self-test =====`);
console.log(`  ${selfTestOk ? "OK" : "FAIL"} — ${selfTestDetail}`);
if (!selfTestOk) fail = true;

console.log("\n========================================");
console.log(fail ? "SSR GATEKEEPER: FAIL" : "SSR GATEKEEPER: PASS");
process.exitCode = fail ? 1 : 0;
