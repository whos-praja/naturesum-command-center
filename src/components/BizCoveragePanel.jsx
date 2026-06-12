/**
 * BizCoveragePanel — V2 data-coverage panel (spec §9 + V2.2/V2.5).
 *
 * The HONEST source-coverage map for the Business Performance module. V1 showed
 * a per-month source table; V2 (this) is a single month × channel GRID colored
 * by the active SOURCE TIER, with MTD markers, ad-basis flags, native-vs-agency
 * reconciliation, and concrete UPGRADE HINTS ("upload Amazon All-Orders for June
 * to unlock SKU-grain"). It answers, at a glance, for every month × channel:
 *   • What's the active sales source — native (per-SKU), agency (Snell), or none?
 *   • Is it a partial / MTD month, and through what day?
 *   • What's the ad-spend basis — product-attributed, agency-total, or none?
 *   • Which agency-tier cells could be UPGRADED by uploading a native report?
 *   • Where native + agency both exist, how big is the reconciliation delta?
 * Below the grid (full mode) it keeps the SKU×channel gap matrix + COGS coverage.
 *
 * BINDING constraints honoured:
 *   • Channels/months are DERIVED from the facts (monthsAvailable/coverageFor) —
 *     never hardcoded; adding a channel needs no edit here.
 *   • ABSENT ≠ 0. A month×channel with no sales coverage renders a muted "no
 *     data" cell, never a fabricated zero or a margin against near-zero revenue.
 *   • Tier precedence is exactly the store's (native > agency > none); MTD months
 *     are flagged and never silently compared like full months.
 *   • All currency via D.fmtINR (never raw floats); % to 1 decimal; units integer.
 *
 * Pure-read: takes `facts` (mergedFacts() payload). Optional `month` narrows the
 * grid to that month's row (still shows the full grid context by default). No DOM
 * side-effects.
 */
import { useMemo } from "react";
import { Card } from "./Shared.jsx";
import NSData from "../data.js";
import { channelsIn, coverageFor } from "../lib/businessStore.js";
import { monthsAvailable } from "../lib/cmEngine.js";
import { getCostCard } from "../lib/costInputs.js";

const D = NSData;
// SAFE currency — never leak a NaN/Infinity or a raw float; D.fmtINR rounds.
const inr = (n) => (Number.isFinite(Number(n)) ? D.fmtINR(Number(n)) : "—");
const pct1 = (frac) => (Number.isFinite(frac) ? `${(frac * 100).toFixed(1)}%` : "—");

// ── Tier visual language (shared mental model with the upload modal) ─────────
// sales tier → cell color. native is the authoritative per-SKU grain (green);
// agency is Snell channel-grain history (amber); none is an honest gap (muted).
const SALES_TIER = {
  native:  { bg: "rgba(63,114,80,0.16)",  fg: "var(--success, #3F7250)", label: "native",  tip: "Per-SKU revenue (Amazon All-Orders / FK / Blinkit / Shopify) — authoritative." },
  agency:  { bg: "rgba(176,122,31,0.14)", fg: "var(--warning, #B07A1F)", label: "agency",  tip: "Snell channel-grain history — revenue & units at channel level (no per-SKU split)." },
  none:    { bg: "transparent",           fg: "var(--ink-4)",            label: "no data", tip: "No sales source for this month×channel (absent ≠ 0)." },
};
// ad basis → a tiny corner flag on the cell.
const ADS_FLAG = {
  actual: { mark: "◆", fg: "#2874F0",                tip: "Ads: product-attributed (per-SKU SP/PLA/Google)." },
  agency: { mark: "◇", fg: "var(--warning,#B07A1F)", tip: "Ads: agency channel-total (Snell/Monarch), not per-SKU." },
  none:   { mark: "·", fg: "var(--ink-4)",           tip: "Ads: none loaded for this cell." },
};

const CHANNEL_LABEL = { amazon: "Amazon", flipkart: "Flipkart", blinkit: "Blinkit", website: "Website" };
const chLabel = (ch) => CHANNEL_LABEL[ch] || ch;

function fmtMonth(ym) {
  if (!ym) return "—";
  const [y, m] = String(ym).split("-").map(Number);
  if (!y || !m) return ym;
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[m - 1] || "?"} ${y}`;
}
function fmtDay(iso) {
  if (!iso) return "—";
  const [, m, d] = String(iso).split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(d)} ${names[Number(m) - 1] || "?"}`;
}

export default function BizCoveragePanel({ facts, month = null, compact = false }) {
  const model = useMemo(() => buildModel(facts), [facts]);

  if (!model) {
    return (
      <Card title="Data coverage" sub="Business fact store">
        <div className="muted" style={{ fontSize: 12.5, padding: "8px 0" }}>
          No business facts loaded yet. Upload the Snell/Monarch history (or rely on the bundled baseline) to populate coverage.
        </div>
      </Card>
    );
  }

  const { months, channels, grid, upgrades, recon, skuRows, cogsMisses, adCaveats, counts } = model;

  return (
    <Card
      title="Data coverage"
      sub={`${channels.length} channels · ${months.length} months · ${counts.native} native + ${counts.agency} agency cells · ${counts.partial} MTD`}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Plain-language framing — the founder lands cold and understands. */}
        <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
          Each cell is one month × channel, colored by the <strong>active sales source</strong> the engine uses there.
          {" "}<TierKey t="native" /> is per-SKU revenue (best), <TierKey t="agency" /> is Snell channel-grain history, and a blank cell means <strong>no sales data</strong> — never a zero.
          The corner mark shows the ad-spend basis (◆ product-attributed · ◇ agency-total · · none). <em>MTD</em> = partial month, through the day shown — never compared like a full month.
        </div>

        {/* ── 1 · month × channel tier GRID ──────────────────────────────── */}
        <div style={{ overflowX: "auto" }}>
          <table className="data-table" style={{ width: "100%", fontSize: 11.5, borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "5px 8px", position: "sticky", left: 0, background: "var(--bg-card)" }}>Month</th>
                {channels.map((ch) => (
                  <th key={ch} style={{ textAlign: "center", padding: "5px 10px" }}>{chLabel(ch)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {months.map((m) => {
                const row = grid[m] || {};
                const partialMonth = channels.some((ch) => row[ch]?.partial);
                return (
                  <tr key={m} style={month && m === month ? { outline: "2px solid var(--brand, #3F7250)", outlineOffset: -2 } : undefined}>
                    <td style={{ padding: "5px 8px", fontWeight: 600, whiteSpace: "nowrap", position: "sticky", left: 0, background: "var(--bg-card)" }}>
                      {fmtMonth(m)}
                      {partialMonth && (
                        <span title={`Partial month — data through ${fmtDay(row[channels.find((ch) => row[ch]?.partial)]?.lastDay)}`}
                          style={{ marginLeft: 6, fontSize: 9, padding: "0 4px", borderRadius: 3, background: "rgba(40,116,240,0.10)", color: "#2874F0", fontWeight: 700, letterSpacing: "0.03em" }}>
                          MTD
                        </span>
                      )}
                    </td>
                    {channels.map((ch) => <CoverageCell key={ch} cell={row[ch]} />)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── 2 · UPGRADE HINTS — concrete, actionable ───────────────────── */}
        {upgrades.length > 0 && (
          <div style={{ background: "rgba(63,114,80,0.06)", border: "1px solid rgba(63,114,80,0.20)", borderRadius: 6, padding: "8px 10px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--success, #3F7250)", letterSpacing: "0.03em", marginBottom: 4 }}>
              ↑ UNLOCK SKU-GRAIN
            </div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 3 }}>
              {upgrades.slice(0, 8).map((u, i) => (
                <li key={i} style={{ fontSize: 11.5, color: "var(--ink-2)" }}>
                  Upload <strong>{u.report}</strong> for <strong>{fmtMonth(u.month)}</strong> to upgrade{" "}
                  <span style={{ textTransform: "capitalize" }}>{chLabel(u.channel)}</span> from agency to SKU-grain CM
                  {u.partial ? " (currently MTD)" : ""}.
                </li>
              ))}
              {upgrades.length > 8 && (
                <li className="muted" style={{ fontSize: 10.5 }}>+ {upgrades.length - 8} more month×channel cells could be upgraded with native reports.</li>
              )}
            </ul>
          </div>
        )}

        {/* ── 3 · native-vs-agency reconciliation (where both exist) ──────── */}
        {recon.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)", marginBottom: 6 }}>
              Native vs agency reconciliation
              <span className="muted" style={{ fontWeight: 400, marginLeft: 6 }}>
                — where native won, what the Snell agency figure was (retained, never dropped)
              </span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="data-table" style={{ width: "100%", fontSize: 11.5 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "4px 8px" }}>Month · Channel</th>
                    <th style={{ textAlign: "right", padding: "4px 8px" }}>Native net rev</th>
                    <th style={{ textAlign: "right", padding: "4px 8px" }}>Agency net rev</th>
                    <th style={{ textAlign: "right", padding: "4px 8px" }}>Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {recon.map((r) => (
                    <tr key={r.mc}>
                      <td style={{ padding: "4px 8px", fontWeight: 600 }}>
                        {fmtMonth(r.month)} · <span style={{ textTransform: "capitalize" }}>{chLabel(r.channel)}</span>
                        {r.artifact && (
                          <span title="Native cell is a stray-date returns-tail sliver; the engine reroutes to the agency figure (V2.2). The agency value here IS the real month."
                            style={{ marginLeft: 6, fontSize: 9, padding: "0 4px", borderRadius: 3, background: "rgba(176,122,31,0.12)", color: "var(--warning)", fontWeight: 700 }}>
                            reroute
                          </span>
                        )}
                      </td>
                      <td className="mono" style={{ padding: "4px 8px", textAlign: "right" }}>
                        {r.artifact ? <span className="muted" title="Stray-date sliver — engine uses the agency figure">{inr(r.native)}</span> : inr(r.native)}
                      </td>
                      <td className="mono" style={{ padding: "4px 8px", textAlign: "right" }}>{inr(r.agency)}</td>
                      <td className="mono" style={{ padding: "4px 8px", textAlign: "right", color: !r.artifact && Number.isFinite(r.deltaPct) && Math.abs(r.deltaPct) > 0.05 ? "var(--warning)" : "var(--ink-3)" }}>
                        {r.artifact
                          ? <span className="muted" title="Native is a stray-date sliver; no meaningful delta">n/a</span>
                          : (Number.isFinite(r.deltaPct) ? (r.deltaPct >= 0 ? "+" : "") + pct1(r.deltaPct) : "—")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── 4 · ad-coverage caveats ────────────────────────────────────── */}
        {adCaveats.length > 0 && (
          <div style={{ background: "rgba(176,122,31,0.06)", border: "1px solid rgba(176,122,31,0.20)", borderRadius: 6, padding: "8px 10px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--warning, #B07A1F)", letterSpacing: "0.03em", marginBottom: 4 }}>
              AD-SPEND CAVEATS
            </div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 3 }}>
              {adCaveats.map((c, i) => (
                <li key={i} style={{ fontSize: 11.5, color: "var(--ink-2)" }}>
                  <strong style={{ textTransform: "capitalize" }}>{chLabel(c.channel)}</strong>: {c.msg}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── 5 · SKU-gap matrix + COGS coverage (full mode) ─────────────── */}
        {!compact && skuRows.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)", marginBottom: 6 }}>
              SKU coverage <span className="muted" style={{ fontWeight: 400 }}>(• sells on channel · COGS gap flagged — SKU grain needs native reports)</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="data-table" style={{ width: "100%", fontSize: 11.5 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "4px 8px" }}>SKU</th>
                    {channels.map((ch) => (
                      <th key={ch} style={{ textAlign: "center", padding: "4px 6px" }}>{chLabel(ch)}</th>
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
              {cogsMisses.length > 0 && (
                <> {cogsMisses.length} SKU{cogsMisses.length === 1 ? "" : "s"} missing COGS: {cogsMisses.join(", ")}.</>
              )}
              {" "}SKU rows reflect every code seen with native per-SKU revenue; agency-only months sell at channel grain (no per-SKU split until native reports are uploaded).
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// ── One coverage cell in the month×channel grid ──────────────────────────────
function CoverageCell({ cell }) {
  if (!cell) {
    return <td style={{ padding: 0, textAlign: "center" }}><div style={cellBox("none")}><span style={{ color: SALES_TIER.none.fg, fontSize: 10.5 }}>—</span></div></td>;
  }
  const tier = SALES_TIER[cell.sales] || SALES_TIER.none;
  const ad = ADS_FLAG[cell.ads] || ADS_FLAG.none;
  const tip = `${tier.tip} ${ad.tip}${cell.partial ? ` Data through ${fmtDay(cell.lastDay)}.` : ""}${cell.skuGrain ? " SKU-grain present." : ""}`;
  return (
    <td style={{ padding: 0, textAlign: "center" }}>
      <div title={tip} style={cellBox(cell.sales)}>
        <span style={{ fontSize: 10, fontWeight: 700, color: tier.fg, letterSpacing: "0.02em" }}>{tier.label}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3, marginTop: 1 }}>
          <span title={ad.tip} style={{ fontSize: 9, color: ad.fg }}>{ad.mark}</span>
          {cell.partial && <span style={{ fontSize: 8, color: "#2874F0", fontWeight: 700 }}>MTD</span>}
          {cell.skuGrain && cell.sales === "native" && <span title="SKU-grain CM available" style={{ fontSize: 8, color: "var(--success)", fontWeight: 700 }}>SKU</span>}
        </span>
      </div>
    </td>
  );
}
function cellBox(sales) {
  const tier = SALES_TIER[sales] || SALES_TIER.none;
  return {
    margin: 2, padding: "4px 6px", borderRadius: 5, minWidth: 56,
    display: "inline-flex", flexDirection: "column", alignItems: "center",
    background: tier.bg,
    border: sales === "none" ? "1px dashed var(--border-soft)" : `1px solid ${tier.fg}33`,
  };
}

// Inline tier legend pill used in the framing copy.
function TierKey({ t }) {
  const tier = SALES_TIER[t] || SALES_TIER.none;
  return (
    <span style={{ display: "inline-block", padding: "0 5px", borderRadius: 3, background: tier.bg, color: tier.fg, fontWeight: 700, fontSize: 10.5 }}>
      {tier.label}
    </span>
  );
}

// ── Model builder (pure; NaN-free) ───────────────────────────────────────────
// Source role lookup — which upload tag feeds ads for a channel (for caveats).
const NATIVE_REPORT_FOR = {
  amazon: "Amazon All-Orders (TSV)",
  flipkart: "Flipkart Sales Report",
  blinkit: "Blinkit Sales Report",
  website: "Shopify Net Sales CSV",
};

function buildModel(facts) {
  if (!facts || !facts.monthly || Object.keys(facts.monthly).length === 0) return null;
  const cov = coverageFor(facts);
  const channels = channelsIn(facts);
  // monthsAvailable gives the canonical month list + per-channel coverage; we
  // present newest-first so the most relevant months are at the top.
  const monthRows = monthsAvailable(facts);
  if (monthRows.length === 0) return null;
  const months = monthRows.map((mr) => mr.month).reverse();

  // grid[month][channel] = coverage cell (sales/skuGrain/ads/partial/lastDay).
  const grid = {};
  const counts = { native: 0, agency: 0, none: 0, partial: 0 };
  for (const mr of monthRows) {
    grid[mr.month] = {};
    for (const ch of channels) {
      const c = mr.channels[ch] || cov[`${mr.month}|${ch}`] || null;
      grid[mr.month][ch] = c;
      if (!c) continue;
      if (c.sales === "native") counts.native++;
      else if (c.sales === "agency") counts.agency++;
      else counts.none++;
      if (c.partial) counts.partial++;
    }
  }

  // Upgrade hints — every agency-tier sales cell could become native by
  // uploading that channel's native report for that month. Newest months first
  // (most actionable), capped in the UI.
  const upgrades = [];
  for (const m of months) {
    for (const ch of channels) {
      const c = grid[m][ch];
      if (c && c.sales === "agency" && NATIVE_REPORT_FOR[ch]) {
        upgrades.push({ month: m, channel: ch, report: NATIVE_REPORT_FOR[ch], partial: !!c.partial });
      }
    }
  }

  // Native-vs-agency reconciliation — meta.agencyShadow holds the agency revenue
  // that native SUPPRESSED (retained, never dropped). Pair it with the native
  // netRev for the same month×channel so the founder sees the delta.
  const shadow = (facts.meta && facts.meta.agencyShadow) || {};
  const recon = [];
  for (const [mc, sh] of Object.entries(shadow)) {
    const [month, channel] = mc.split("|");
    if (!month || !channel) continue;
    const agency = Number(sh.netRev) || 0;
    // Agency carries no comparable net revenue here (e.g. website — Monarch is
    // gross-only) → nothing to reconcile, skip rather than show a bogus −100%.
    if (Math.abs(agency) < 1) continue;
    const native = nativeNetRev(facts, month, channel);
    // Artifact: the native cell is a stray-date returns-tail sliver (a tiny or
    // negative number) while the agency figure is the real month — the engine
    // reroutes to agency per V2.2. Flag so the Δ isn't misread as a real gap.
    const artifact = !(native > 0) || (agency > 0 && native / agency < 0.02);
    // Δ% only meaningful when native is a genuine positive figure.
    const deltaPct = native > 0 ? (agency - native) / native : null;
    recon.push({ mc, month, channel, native, agency, deltaPct, artifact });
  }
  recon.sort((a, b) => b.mc.localeCompare(a.mc));

  // SKU×channel presence + COGS coverage (native per-SKU cells only — agency is
  // channel grain with no SKU split).
  const skuMap = {};
  for (const [key, cell] of Object.entries(facts.monthly)) {
    const [, ch, code] = key.split("|");
    if (!ch || !code || code === "__ch__") continue;
    const hasRev = Number(cell.units) > 0 || Number(cell.netRev) > 0 || Number(cell.grossRev) > 0;
    if (!hasRev) continue;
    skuMap[code] = skuMap[code] || { channels: new Set() };
    skuMap[code].channels.add(ch);
  }
  const cogsMisses = [];
  const skuRows = Object.keys(skuMap).sort().map((code) => {
    const card = safeCostCard(code);
    const hasCogs = !!card && Number.isFinite(card.cogs);
    if (!hasCogs) cogsMisses.push(code);
    return { code, channels: skuMap[code].channels, hasCogs, pkgPlaceholder: !!card?.pkgPlaceholder };
  });

  // Ad-coverage caveats — channels whose latest native month carries no ad
  // source (CM3 would be ad-free / overstated there).
  const adCaveats = [];
  for (const ch of channels) {
    // Find the most recent month with sales coverage for this channel.
    const latest = months.find((m) => grid[m][ch] && grid[m][ch].sales !== "none");
    const c = latest ? grid[latest][ch] : null;
    if (c && c.ads === "none") {
      adCaveats.push({ channel: ch, msg: `${fmtMonth(latest)} has sales but no ad source — CM3 here is ad-free (likely overstated). Upload that channel's ad report or set a channel-total override.` });
    }
  }

  return { months, channels, grid, upgrades, recon, skuRows, cogsMisses, adCaveats, counts };
}

// Native per-SKU net revenue summed for a month×channel (excludes the agency
// __ch__ cell). Used for the reconciliation delta.
function nativeNetRev(facts, month, channel) {
  let s = 0;
  for (const [key, cell] of Object.entries(facts.monthly || {})) {
    const [m, ch, code] = key.split("|");
    if (m === month && ch === channel && code && code !== "__ch__") s += Number(cell.netRev) || 0;
  }
  return s;
}

function safeCostCard(code) {
  try { return getCostCard(code); } catch { return null; }
}
