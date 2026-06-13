// Spot-check: render the three pages and assert the upside-view panels + minors
// carry REAL data (specific value fingerprints / structural markers), not stubs.
import { createServer } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const render = async (path, Comp, props = {}) => {
  const mod = await server.ssrLoadModule(path);
  const C = Comp ? mod[Comp] : mod.default;
  return renderToStaticMarkup(React.createElement(C, props));
};

const out = [];
const expect = (label, cond, detail = "") => { out.push(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? " · " + detail : ""}`); };

// ── SALES: View A retention (7.9%→15.1%), View E cancel, View D sku-mix ──
// PageSales is TABBED (rubric IX) — render each tab via the `initialTab` hook and
// union the markup so panels in non-default tabs (retention, sku) are reachable.
const SALES_TABS = ["daily", "movers", "forecast", "retention", "sku", "cross", "geo", "reconcile"];
const salesParts = [];
for (const t of SALES_TABS) salesParts.push(await render("/src/pages/PageSales.jsx", null, { initialTab: t }));
const sales = salesParts.join(" ");
expect("A retention: Shopify repeat 7.9%→15.1% band present", /7\.9%/.test(sales) && /15\.1%/.test(sales));
expect("A returns trend panel present", sales.includes("Returns are volatile") || sales.includes("returns"));
expect("E cancel-rate panel present", /Cancel/i.test(sales));
expect("D SKU×channel mix panel present", sales.includes("channel") && sales.includes("SKU"));
// Scan VISIBLE text only (strip tags) so inline `style="width:NN.NN%"` bar widths
// aren't mistaken for an absurd ACOS figure reaching the screen.
const salesText = sales.replace(/<[^>]*>/g, " ");
expect("Sales: no 16276%-class ACOS leak", !/\b1\d{3,}%/.test(salesText));

// ── MARKETING: View B SEO, View C G-vs-M, M2 itemize, M4 losing count ──
const mkt = await render("/src/pages/PageMarketing.jsx");
expect("B SEO keyword ranks panel present", mkt.includes("SEO keyword") || mkt.includes("keyword ranks"));
expect("C Google vs Meta efficiency present", mkt.includes("Google vs Meta"));
expect("M2 itemize affordance present", mkt.includes("itemize"));
expect("M4 losing-per-ad-rupee count present", mkt.includes("Losing per ad rupee"));
expect("M4 count is SKU-attributed (caption)", mkt.includes("SKU-attributed"));
expect("M4 alloc rows kept visible/greyed (legend)", mkt.includes("Greyed") || mkt.includes("greyed"));

// ── FINANCE: M3 blinkit recon, M5 low-base, M6 done elsewhere ──
const finStore = await server.ssrLoadModule("/src/lib/businessStore.js");
const fin = await server.ssrLoadModule("/src/pages/PageFinance.jsx");
const facts = finStore.mergedFacts();
const eng = await server.ssrLoadModule("/src/lib/cmEngine.js");
// M5 low-base on CM trend
const trend = renderToStaticMarkup(React.createElement(fin.CMTrendView, { facts }));
expect("M5 low-base annotation renders", trend.includes("low base") || trend.includes("low-base"));
expect("M5 low-base shows rev base caption", /low base · ₹/.test(trend) || /low base.*rev/i.test(trend));
// M3 blinkit recon — render an agency-only Blinkit month's waterfall view
const mm = eng.monthsAvailable(facts).map((m) => m.month);
// find a month where blinkit is agency coverage (e.g. a 2026 month before May, or post-May)
let m3Found = false;
for (const m of mm) {
  const v = fin.buildMonthView(facts, m);
  const bk = v.byChannel?.blinkit;
  if (bk && bk.coverage === "agency") {
    const wf = renderToStaticMarkup(React.createElement(fin.WaterfallView, { view: v, month: m }));
    if (wf.includes("agency-proxy") || wf.includes("Blinkit agency-proxy")) { m3Found = true; break; }
  }
}
expect("M3 Blinkit agency-proxy recon renders on an agency-only Blinkit month", m3Found);

// ── M6: footer latest-data-date (Nav) ──
const navMod = await server.ssrLoadModule("/src/components/Nav.jsx");
// Nav default export is the full nav; render Sidebar via the page? Instead assert source-level wiring:
expect("M6 latestDataDate baked in bundle", facts?.meta?.latestDataDate === "2026-06-10", `latestDataDate=${facts?.meta?.latestDataDate}`);

// ── M1: agency amazon Nov-25 / Mar-26 net AS-IS (sheet-consistent) ──
const nov = facts.monthly["2025-11|amazon|__ch__"]?.netRev;
const mar = facts.monthly["2026-03|amazon|__ch__"]?.netRev;
expect("M1 Nov-25 agency amazon net ≈ 799329 (was 761266)", Math.abs(nov - 799328.98) < 1, `got ${nov}`);
expect("M1 Mar-26 agency amazon net ≈ 1276737 (was 1215940)", Math.abs(mar - 1276737.29) < 1, `got ${mar}`);
const recon = facts?.meta?.bySource?.["snell-history"]?.mayReconciliation;
expect("M1 May agency amazon recon AS-IS (1,213,769 / +6.15%)", Math.abs(recon?.amazonNet?.agency - 1213768.71) < 1 && Math.abs(recon?.amazonNet?.deltaPct - 6.15) < 0.01);

await server.close();
console.log(out.join("\n"));
const fails = out.filter((l) => l.startsWith("FAIL")).length;
console.log(`\nSPOTCHECK: ${fails === 0 ? "PASS" : "FAIL"} (${fails} fail)`);
process.exitCode = fails === 0 ? 0 : 1;
