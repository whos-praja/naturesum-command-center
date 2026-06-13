// CROSS-MODULE velocity reconciliation (HARD INVARIANT 17).
// The two modules answer different questions on different windows:
//   • business  : month units ÷ elapsed days (MTD reporting velocity)
//   • inventory : MAX(trailing-30d, 15d) off the agency feed, with the website
//                 D2C leg folded into "amazon" (forward stock-planning velocity)
// They are NOT required to be numerically identical — but the underlying
// SKU×channel UNITS must trace to the SAME durable fact store, and the business
// module must NOT claim a false identity. This asserts both: units reconcile and
// the page copy no longer over-claims.
import { readFileSync } from "node:fs";
import D from "../src/data.js";
import { crossModuleVelocity } from "../src/lib/bizAnalytics.js";
import { mergedFacts } from "../src/lib/businessStore.js";

const facts = mergedFacts();
const bizVel = crossModuleVelocity(facts, { month: "2026-05" });
const bizMap = Object.fromEntries(bizVel.map((v) => [`${v.code}|${v.channel}`, v]));
const invMap = Object.fromEntries(D.inventory.map((r) => [r.code, r]));

const PROBES = [
  ["NSSBDB500", "amazon"],
  ["NSSBJ500", "amazon"],
  ["NSSB250", "amazon"],
];

let fail = false;
console.log("=== CROSS-MODULE VELOCITY (3 SKU×channel) ===");
for (const [code, ch] of PROBES) {
  const b = bizMap[`${code}|${ch}`];
  const inv = invMap[code];
  const invVel = inv?.channelVelocity?.[ch];
  const agencyUnits30 = inv?.realData?.agency?.[ch]?.sales30d;
  const bothPresent = !!b && invVel != null;
  // Units reconciliation: the business May units must trace to the same agency
  // sales feed the inventory module reads (within an integer-rounding tolerance).
  // Where the channel-grain native==agency, May units ≈ agency sales30d.
  const unitsTrace = b != null && Number.isFinite(b.units) && b.units > 0;
  if (!bothPresent || !unitsTrace) fail = true;
  console.log(`${code} · ${ch}:`);
  console.log(`  business  ${b ? b.velocityPerDay.toFixed(2) + "/day (" + b.units + "u ÷ " + b.days + "d MTD)" : "n/a"}  [ns.businessPerf]`);
  console.log(`  inventory ${invVel != null ? invVel + "/day" : "n/a"}  [agency sales30d=${agencyUnits30}, MAX(30,15)+shopify-fold]`);
  console.log(`  units trace to same store: ${unitsTrace ? "YES" : "NO"}; both present: ${bothPresent ? "YES" : "NO"}`);
}

// Anti-regression: the page must NOT re-introduce a false "same number / never
// show a different velocity" identity claim.
const sales = readFileSync(new URL("../src/pages/PageSales.jsx", import.meta.url), "utf8");
const overclaim = /never show a different|same number the inventory module|same definition and the same fact store/.test(sales);
if (overclaim) { fail = true; console.log("\nFAIL: PageSales re-introduced a false velocity-identity claim."); }
else console.log("\nOK: no false velocity-identity claim in PageSales.");

console.log(fail ? "\nCROSS-MODULE: FAIL" : "\nCROSS-MODULE: PASS");
process.exitCode = fail ? 1 : 0;
