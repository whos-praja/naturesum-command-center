/**
 * BizCoveragePanel — BUILDER B3d.
 *
 * A compact, HONEST data-coverage panel for the Business Performance module
 * (spec §9 "Data-coverage panel"). It answers, at a glance:
 *   1. month × channel × source — which fact sources have landed (sales, ads)?
 *   2. SKU-gap matrix — which SKUs sell on which channels (e.g. Blinkit sells
 *      only 5 of 14 SKUs), and which carry COGS so the CM chain is computable?
 *   3. Ad-coverage caveats — channels whose ad spend is product-attributed only
 *      vs. a channel-total override still unset (CM3 understated there).
 *
 * BINDING constraints honoured:
 *   • Channels/months/SKUs are DERIVED from the facts (channelsIn/monthsIn) —
 *     never hardcoded; adding a channel needs no edit here.
 *   • ABSENT ≠ 0. A missing source renders as a muted "—" gap cell, never a
 *     fabricated zero. COGS-missing SKUs are flagged, not silently dropped.
 *   • No NaN/Infinity: every count is integer-guarded; shares use SAFE division.
 *
 * Pure-read: takes `facts` (mergedFacts() payload) + optional `coverage`
 * (computeCM().coverage) as props so a page can pass what it already computed,
 * or the panel derives everything itself from `facts` alone. No DOM side-effects.
 */
import { useMemo } from "react";
import { Card } from "./Shared.jsx";
import { channelsIn, monthsIn } from "../lib/businessStore.js";
import { getCostCard } from "../lib/costInputs.js";

// ── Source taxonomy ──────────────────────────────────────────────────────────
// Maps each upload `src` tag (written by businessParsers → businessStore) to the
// channel it feeds and whether it is a SALES (revenue/units) or ADS (spend)
// source. Channel-total ad overrides (Snell/Monarch) are recorded as META
// sources — they don't write per-SKU cells, so we detect them from facts.meta.
// NEVER hardcode the channel set from this — it's only a label/role lookup.
const SRC_ROLE = {
  "amazon-orders": { channel: "amazon", role: "sales", label: "Amazon All-Orders" },
  "fk-sales": { channel: "flipkart", role: "sales", label: "Flipkart Sales" },
  "blinkit-sales": { channel: "blinkit", role: "sales", label: "Blinkit Sales" },
  "shopify-net": { channel: "website", role: "sales", label: "Shopify Net (monthly)" },
  "shopify-daily": { channel: "website", role: "shape", label: "Shopify Daily (shape)" },
  "ads-amazon-sp": { channel: "amazon", role: "ads", label: "Amazon SP ads" },
  "ads-fk-pla": { channel: "flipkart", role: "ads", label: "Flipkart PLA ads" },
  "ads-google": { channel: "website", role: "ads", label: "Google product ads" },
  // snell-agency + monarch-web write only meta (channel-total spend), surfaced
  // via the ad-coverage caveats block, not the per-cell grid.
};

const ROLE_BADGE = {
  sales: { bg: "rgba(63,114,80,0.14)", fg: "var(--success, #3F7250)", tip: "Revenue + units source present" },
  ads: { bg: "rgba(40,116,240,0.12)", fg: "#2874F0", tip: "Ad-spend source present" },
  shape: { bg: "rgba(99,102,241,0.10)", fg: "#6366f1", tip: "Daily shape/trend only (not the monthly total)" },
};

// Split a fact `src` field ("amazon-orders,ads-amazon-sp") into its source tags.
function srcTags(src) {
  return String(src || "").split(",").map((s) => s.trim()).filter(Boolean);
}

export default function BizCoveragePanel({ facts, coverage = null, month = null, compact = false }) {
  const model = useMemo(() => buildCoverage(facts, coverage, month), [facts, coverage, month]);
  if (!model) {
    return (
      <Card title="Data coverage" sub="Business fact store">
        <div className="muted" style={{ fontSize: 12.5, padding: "8px 0" }}>
          No business facts loaded yet. Upload the May sources (or rely on the bundled baseline) to populate coverage.
        </div>
      </Card>
    );
  }

  const { months, channels, gridByMonth, skuRows, adCaveats, fixedByMonth } = model;

  return (
    <Card
      title="Data coverage"
      sub={`${channels.length} channels · ${months.length} month${months.length === 1 ? "" : "s"} · ${skuRows.length} SKUs`}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* ── 1 · month × channel × source grid ─────────────────────────── */}
        {months.map((m) => (
          <div key={m}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>{fmtMonth(m)}</div>
              <div className="muted" style={{ fontSize: 11 }}>
                {fixedByMonth[m] != null
                  ? `fixed cost set · ₹${Math.round(fixedByMonth[m]).toLocaleString("en-IN")} (CM4 live)`
                  : "no fixed cost set · CM4 hidden"}
              </div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="data-table" style={{ width: "100%", fontSize: 11.5 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "4px 8px" }}>Channel</th>
                    <th style={{ textAlign: "left", padding: "4px 8px" }}>Sales</th>
                    <th style={{ textAlign: "left", padding: "4px 8px" }}>Ads</th>
                    <th style={{ textAlign: "right", padding: "4px 8px" }}>SKUs w/ sales</th>
                    <th style={{ textAlign: "right", padding: "4px 8px" }}>Net rev</th>
                  </tr>
                </thead>
                <tbody>
                  {channels.map((ch) => {
                    const cell = gridByMonth[m]?.[ch] || { sales: false, ads: false, shape: false, skus: 0, netRev: 0 };
                    return (
                      <tr key={ch}>
                        <td style={{ padding: "4px 8px", fontWeight: 600, textTransform: "capitalize" }}>{ch}</td>
                        <td style={{ padding: "4px 8px" }}>{cell.sales ? <SrcBadge role="sales" /> : <Gap />}</td>
                        <td style={{ padding: "4px 8px" }}>
                          {cell.ads ? <SrcBadge role="ads" /> : <Gap />}
                          {cell.shape && <SrcBadge role="shape" />}
                        </td>
                        <td style={{ padding: "4px 8px", textAlign: "right" }} className="mono">{cell.skus || "—"}</td>
                        <td style={{ padding: "4px 8px", textAlign: "right" }} className="mono">
                          {cell.netRev ? "₹" + Math.round(cell.netRev).toLocaleString("en-IN") : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {/* ── 3 · ad-coverage caveats ───────────────────────────────────── */}
        {adCaveats.length > 0 && (
          <div style={{
            background: "rgba(176,122,31,0.06)",
            border: "1px solid rgba(176,122,31,0.20)",
            borderRadius: 6, padding: "8px 10px",
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--warning, #B07A1F)", letterSpacing: "0.03em", marginBottom: 4 }}>
              AD-SPEND CAVEATS
            </div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 3 }}>
              {adCaveats.map((c, i) => (
                <li key={i} style={{ fontSize: 11.5, color: "var(--ink-2)" }}>
                  <strong style={{ textTransform: "capitalize" }}>{c.channel}</strong>: {c.msg}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── 2 · SKU-gap matrix ────────────────────────────────────────── */}
        {!compact && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)", marginBottom: 6 }}>
              SKU coverage <span className="muted" style={{ fontWeight: 400 }}>(• sells on channel · COGS gap flagged)</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="data-table" style={{ width: "100%", fontSize: 11.5 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "4px 8px" }}>SKU</th>
                    {channels.map((ch) => (
                      <th key={ch} style={{ textAlign: "center", padding: "4px 6px", textTransform: "capitalize" }}>{ch}</th>
                    ))}
                    <th style={{ textAlign: "center", padding: "4px 8px" }}>COGS</th>
                  </tr>
                </thead>
                <tbody>
                  {skuRows.map((row) => (
                    <tr key={row.code}>
                      <td style={{ padding: "4px 8px", fontWeight: 600 }} className="mono" title={row.code}>{row.code}</td>
                      {channels.map((ch) => (
                        <td key={ch} style={{ padding: "4px 6px", textAlign: "center" }}>
                          {row.channels.has(ch)
                            ? <span style={{ color: "var(--success, #3F7250)", fontWeight: 700 }}>•</span>
                            : <span className="muted" style={{ opacity: 0.4 }}>·</span>}
                        </td>
                      ))}
                      <td style={{ padding: "4px 8px", textAlign: "center" }}>
                        {row.hasCogs
                          ? (row.pkgPlaceholder
                              ? <span title="COGS present but packaging is a ₹0 placeholder" style={{ color: "var(--warning, #B07A1F)", fontWeight: 700 }}>◐</span>
                              : <span style={{ color: "var(--success, #3F7250)", fontWeight: 700 }}>✓</span>)
                          : <span title="No COGS — CM chain not computable for this SKU" style={{ color: "var(--critical, #B73838)", fontWeight: 700 }}>✗</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="muted" style={{ fontSize: 10.5, marginTop: 6, lineHeight: 1.5 }}>
              ✓ COGS present · ◐ COGS present, packaging is a ₹0 placeholder · ✗ COGS missing (CM hidden for that SKU).
              {model.cogsMisses.length > 0 && (
                <> {model.cogsMisses.length} SKU{model.cogsMisses.length === 1 ? "" : "s"} missing COGS: {model.cogsMisses.join(", ")}.</>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function SrcBadge({ role }) {
  const b = ROLE_BADGE[role] || ROLE_BADGE.sales;
  return (
    <span
      title={b.tip}
      style={{
        display: "inline-block", fontSize: 9.5, padding: "1px 5px", borderRadius: 3,
        background: b.bg, color: b.fg, fontWeight: 700, letterSpacing: "0.04em", marginRight: 4,
      }}
    >
      {role.toUpperCase()}
    </span>
  );
}
function Gap() {
  return <span className="muted" style={{ opacity: 0.5 }} title="No source for this cell (absent ≠ 0)">—</span>;
}

function fmtMonth(ym) {
  if (!ym) return "—";
  const [y, m] = String(ym).split("-").map(Number);
  if (!y || !m) return ym;
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[m - 1] || "?"} ${y}`;
}

// ── Coverage model builder (pure; NaN-free) ──────────────────────────────────
// Returns null when there are no monthly facts at all. Otherwise a fully-derived
// view: per-month channel rows, a SKU×channel presence matrix, COGS coverage,
// and ad-spend caveats keyed off facts.meta (Snell/Monarch channel totals) +
// per-cell adSpendDirect presence.
function buildCoverage(facts, coverage, monthFilter) {
  if (!facts || !facts.monthly || Object.keys(facts.monthly).length === 0) return null;
  const allMonths = monthsIn(facts);
  const months = monthFilter ? allMonths.filter((m) => m === monthFilter) : allMonths;
  if (months.length === 0) return null;
  const channels = channelsIn(facts);

  const meta = facts.meta || {};
  const adTotals = readAdTotals();              // ns.bizCost.adTotal overrides (engine + panel share this)
  const snell = pickMeta(meta, "snellChannelSpend");
  const monarch = pickMeta(meta, "monarchWebSpend");

  // Per (month, channel): sales/ads/shape source presence + SKU count + netRev.
  const gridByMonth = {};
  const skuMap = {};                            // code → { channels:Set, ... }
  const fixedByMonth = {};

  for (const [key, cell] of Object.entries(facts.monthly)) {
    const [m, ch, code] = key.split("|");
    if (!m || !ch || !code) continue;
    if (!months.includes(m)) continue;
    gridByMonth[m] = gridByMonth[m] || {};
    const g = (gridByMonth[m][ch] = gridByMonth[m][ch] || { sales: false, ads: false, shape: false, skus: 0, netRev: 0, skuSet: new Set() });
    const tags = srcTags(cell.src);
    for (const t of tags) {
      const role = SRC_ROLE[t]?.role;
      if (role === "sales") g.sales = true;
      else if (role === "ads") g.ads = true;
      else if (role === "shape") g.shape = true;
    }
    // Ad presence can also be inferred from a non-zero adSpendDirect even if the
    // src tag is unknown (SAFE: never under-report ad coverage).
    if (Number(cell.adSpendDirect) > 0) g.ads = true;
    // A cell with revenue/units counts as a "sells here" signal for the SKU.
    const hasRev = Number(cell.units) > 0 || Number(cell.netRev) > 0 || Number(cell.grossRev) > 0;
    if (hasRev) {
      g.skuSet.add(code);
      g.netRev += Number.isFinite(Number(cell.netRev)) ? Number(cell.netRev) : 0;
      skuMap[code] = skuMap[code] || { channels: new Set() };
      skuMap[code].channels.add(ch);
    }
  }
  for (const m of months) {
    for (const ch of channels) {
      const g = gridByMonth[m]?.[ch];
      if (g) g.skus = g.skuSet.size;
    }
    // Fixed-cost presence per month (CM4 gate) — from injected coverage when
    // available, else null (we don't import costInputs.getFixedCost here to keep
    // the month read on the page that owns the CM4 input; SAFE default = null).
    fixedByMonth[m] = coverage && coverage.hasFixedCost ? (coverage.fixedAmount ?? null) : null;
  }

  // Daily shape presence (shopify-daily writes daily cells only).
  for (const key of Object.keys(facts.daily || {})) {
    const [d, ch] = key.split("|");
    const m = d ? d.slice(0, 7) : null;
    if (!m || !months.includes(m) || !ch) continue;
    if (gridByMonth[m]?.[ch]) gridByMonth[m][ch].shape = true;
  }

  // SKU rows — union of every code seen with revenue, sorted, with COGS lookup.
  const cogsMisses = [];
  const skuRows = Object.keys(skuMap).sort().map((code) => {
    const card = safeCostCard(code);
    const hasCogs = !!card && Number.isFinite(card.cogs);
    if (!hasCogs) cogsMisses.push(code);
    return {
      code,
      channels: skuMap[code].channels,
      hasCogs,
      pkgPlaceholder: !!card?.pkgPlaceholder,
    };
  });

  // Ad-spend caveats — per channel, compare product-attributed (per-cell sum) to
  // the channel total the ENGINE actually consumes. Honestly flags where CM3 is
  // understated because no channel total is wired AT ALL.
  // CONSTRAINT (must mirror engine precedence — cmEngine.deriveChannelAdTotals):
  // the engine resolves a channel total from (a) ns.bizCost.adTotal localStorage
  // OR (b) the Snell/Monarch meta totals baked into facts.meta. If EITHER is a
  // finite > direct figure, the channel total is already deducted in CM3, so the
  // caveat must NOT fire. Checking only the localStorage override (the prior bug)
  // would falsely warn that Blinkit/website CM3 is ad-free when the engine has
  // already charged the Snell/Monarch total.
  const adCaveats = [];
  for (const ch of channels) {
    const directByMonth = months.reduce((acc, m) => {
      let s = 0;
      for (const [key, cell] of Object.entries(facts.monthly)) {
        const [mm, cc] = key.split("|");
        if (mm === m && cc === ch) s += Number(cell.adSpendDirect) || 0;
      }
      return acc + s;
    }, 0);
    // Channel-total the engine consumes: localStorage override OR meta-derived
    // Snell/Monarch total (same precedence as cmEngine.deriveChannelAdTotals).
    const lsOverride = Number(adTotals?.[ch]);
    let metaTotal = null;
    if (ch === "amazon" && Number.isFinite(Number(snell?.amazon))) metaTotal = Number(snell.amazon);
    else if (ch === "flipkart" && Number.isFinite(Number(snell?.flipkart))) metaTotal = Number(snell.flipkart);
    else if (ch === "blinkit" && Number.isFinite(Number(snell?.blinkit))) metaTotal = Number(snell.blinkit);
    else if (ch === "website" && monarch) metaTotal = (Number(monarch.googleTotal) || 0) + (Number(monarch.metaTotal) || 0);
    // The total the engine will actually use (override wins, else meta).
    const engineTotal = Number.isFinite(lsOverride) && lsOverride > 0 ? lsOverride
      : (Number.isFinite(metaTotal) ? metaTotal : null);
    // "Wired" = the engine has a channel total it will deduct (≥ direct spend).
    const wired = Number.isFinite(engineTotal) && engineTotal >= directByMonth - 1;

    if (!wired && directByMonth === 0) {
      // No product-attributed ads AND no channel total the engine can deduct →
      // CM3 here is genuinely ad-free (likely overstated). Surface the agency
      // hint if one exists so the founder knows what to wire.
      adCaveats.push({
        channel: ch,
        msg: Number.isFinite(metaTotal) && metaTotal > 0
          ? `no product-attributed ads and channel total ≈ ₹${fmtK(metaTotal)} not deducted — CM3 here is ad-free (overstated).`
          : `no ad source loaded — CM3 here is ad-free (likely overstated).`,
      });
    } else if (!wired && Number.isFinite(metaTotal) && metaTotal > directByMonth + 1) {
      // Some direct spend lands, but a larger agency total exists and is NOT
      // being deducted (no override, no usable meta) — the remainder is missing.
      const gap = metaTotal - directByMonth;
      adCaveats.push({
        channel: ch,
        msg: `product-attributed ₹${fmtK(directByMonth)} vs channel-total ≈ ₹${fmtK(metaTotal)} (gap ₹${fmtK(gap)} unallocated — set a channel-total override to fold it into CM3).`,
      });
    }
  }

  return { months, channels, gridByMonth, skuRows, cogsMisses, adCaveats, fixedByMonth };
}

// ── helpers ──────────────────────────────────────────────────────────────────
function safeCostCard(code) {
  try { return getCostCard(code); } catch { return null; }
}
// Read the channel-total ad overrides the Cost Inputs panel writes (shared with
// the engine + verification). SSR/quota-safe. Shape: { [channel]: ₹ }.
function readAdTotals() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem("ns.bizCost.adTotal");
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" ? v : {};
  } catch { return {}; }
}
// Pull a meta sub-object that lives either flat on meta or under meta.bySource.*.
function pickMeta(meta, key) {
  if (meta?.[key]) return meta[key];
  const bs = meta?.bySource;
  if (bs) for (const s of Object.values(bs)) if (s?.[key]) return s[key];
  return null;
}
function fmtK(n) {
  const a = Math.abs(Number(n) || 0);
  if (a >= 100000) return (a / 100000).toFixed(2) + "L";
  if (a >= 1000) return (a / 1000).toFixed(1) + "k";
  return String(Math.round(a));
}
