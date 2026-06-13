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
import { channelsIn, coverageFor, isChannelGrainKey } from "../lib/businessStore.js";
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

  const { months, channels, grid, upgrades, recon, skuRows, skuMonth, cogsMisses, adCaveats, counts, skuResolution } = model;

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

        {/* ── 5b · SKU × MONTH × channel gap map (rubric 34, tri-axis) ─────── */}
        {!compact && skuMonth && Object.keys(skuMonth).length > 0 && (
          <SkuMonthGapMap skuMonth={skuMonth} months={months} channels={channels} />
        )}

        {/* ── 6 · SKU identity-resolution audit (param 7 + XI/84) ─────────── */}
        {!compact && skuResolution && skuResolution.total > 0 && (
          <SkuResolutionAudit res={skuResolution} />
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

// ── SKU identity-resolution audit block ──────────────────────────────────────
// Clean state → a quiet green "all N codes resolve" line (the founder learns the
// guard exists and is passing). Unresolved codes → an amber list with a nearest-
// canonical suggestion (likely rename) or a "new SKU" hint, so a slightly-renamed
// marketplace code is caught instead of silently dropping its CM (rubric 7/84).
// SKU × MONTH × channel gap map (rubric 34). The existing grids cover month×channel
// and SKU×channel; this is the missing tri-axis cut — for each SKU, a month strip
// where a cell's fill reflects how many channels carry NATIVE per-SKU coverage that
// month (blank = genuine gap, "·" = no data, not a zero). The founder sees exactly
// which SKU×channel×month cells are covered at a glance.
function SkuMonthGapMap({ skuMonth, months, channels }) {
  // newest months on the right; cap to the last 12 so the strip stays scannable.
  const monthCols = months.slice().reverse().slice(-12);
  const codes = Object.keys(skuMonth).sort();
  const nCh = Math.max(1, channels.length);
  // fill ramp: 0 channels = gap (muted dot), 1..all = greener with more coverage.
  const cellStyle = (set) => {
    const n = set ? set.size : 0;
    if (n === 0) return { bg: "transparent", fg: "var(--ink-4)", mark: "·" };
    const frac = n / nCh;
    const alpha = 0.18 + 0.55 * frac;
    return { bg: `rgba(63,114,80,${alpha.toFixed(2)})`, fg: "var(--success, #3F7250)", mark: String(n) };
  };
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)", marginBottom: 6 }}>
        SKU × month native coverage{" "}
        <span className="muted" style={{ fontWeight: 400 }}>(cell = # channels with native per-SKU data that month · blank · = no native coverage, not a zero)</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="data-table" style={{ width: "100%", fontSize: 10.5 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "4px 8px" }}>SKU</th>
              {monthCols.map((m) => (
                <th key={m} style={{ textAlign: "center", padding: "4px 4px", whiteSpace: "nowrap" }}>{fmtMonth(m)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {codes.map((code) => (
              <tr key={code}>
                <td style={{ padding: "3px 8px", fontWeight: 600 }} className="mono" title={code}>{code}</td>
                {monthCols.map((m) => {
                  const set = skuMonth[code]?.[m];
                  const st = cellStyle(set);
                  const chList = set ? [...set].map(chLabel).join(", ") : "no native per-SKU data";
                  return (
                    <td key={m} style={{ padding: 2, textAlign: "center" }}>
                      <div title={`${code} · ${fmtMonth(m)} — ${chList}`}
                        style={{ background: st.bg, color: st.fg, borderRadius: 3, padding: "3px 0", fontWeight: 700, minWidth: 22 }}>
                        {st.mark}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ fontSize: 10.5, marginTop: 6, lineHeight: 1.5 }}>
        A number is the count of channels with native per-SKU coverage for that SKU that month (darker = more channels);
        a <strong>·</strong> is an honest gap — no native per-SKU report for that SKU×month (agency months sell at channel
        grain, so per-SKU coverage there reads blank until a native export is uploaded). This is the SKU×channel×month
        cut of the month×channel grid above — nothing is a silent zero.
      </div>
    </div>
  );
}

function SkuResolutionAudit({ res }) {
  const clean = res.unresolved.length === 0;
  return (
    <div
      style={{
        background: clean ? "rgba(63,114,80,0.06)" : "rgba(176,122,31,0.07)",
        border: `1px solid ${clean ? "rgba(63,114,80,0.20)" : "rgba(176,122,31,0.28)"}`,
        borderRadius: 6, padding: "8px 10px",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.03em", marginBottom: clean ? 0 : 5, color: clean ? "var(--success, #3F7250)" : "var(--warning, #B07A1F)" }}>
        {clean ? "✓ SKU IDENTITY — ALL RESOLVE" : `⚠ SKU IDENTITY — ${res.unresolved.length} UNRESOLVED`}
      </div>
      {clean ? (
        <div className="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>
          All {res.total} per-SKU code{res.total === 1 ? "" : "s"} in the fact store map to a canonical catalog/COGS SKU.
          Re-run after any upload — a slightly-renamed marketplace code (e.g. <span className="mono">NSSBJ500</span> → <span className="mono">NSSB-J-500</span>)
          surfaces here with its nearest match instead of silently dropping its margin.
        </div>
      ) : (
        <>
          <div className="muted" style={{ fontSize: 11, lineHeight: 1.5, marginBottom: 6 }}>
            These fact-store codes don&apos;t match the canonical catalog/COGS set, so their CM is dropped.
            If it&apos;s a <strong>rename</strong>, fix the export (or add an alias); if it&apos;s a <strong>new SKU</strong>, add it to the catalog + COGS.
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            {res.unresolved.slice(0, 12).map((u) => (
              <li key={u.code} style={{ fontSize: 11.5, color: "var(--ink-2)" }}>
                <span className="mono" style={{ fontWeight: 700, color: "var(--critical, #B73838)" }}>{u.code}</span>
                <span className="muted" style={{ marginLeft: 6 }}>
                  on {u.channels.map((c) => chLabel(c)).join(", ")}
                </span>
                {u.near ? (
                  <span style={{ marginLeft: 6 }}>
                    — likely a rename of <span className="mono" style={{ fontWeight: 700, color: "var(--success, #3F7250)" }}>{u.near.code}</span>
                    <span className="muted"> (edit distance {u.near.dist})</span>
                  </span>
                ) : (
                  <span className="muted" style={{ marginLeft: 6 }}>— no close canonical match; treat as a new SKU.</span>
                )}
              </li>
            ))}
            {res.unresolved.length > 12 && (
              <li className="muted" style={{ fontSize: 10.5 }}>+ {res.unresolved.length - 12} more unresolved codes.</li>
            )}
          </ul>
        </>
      )}
    </div>
  );
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

// ── SKU identity resolution (rubric 7 + XI/84) ───────────────────────────────
// The canonical SKU universe = the data.js catalog codes ∪ the COGS-card codes.
// Any per-SKU code seen in the FACT STORE that is not in this set is "unresolved"
// — either a genuinely-new SKU (add it to the catalog/COGS) or a SLIGHT RENAME of
// an existing one (e.g. a marketplace export changed "NSSBJ500" → "NSSB-J-500").
// A silent unresolved code falls to "COGS missing" and quietly drops its CM; this
// audit makes that visible and proposes the nearest canonical match so a rename is
// caught, not mistaken for a new product. Robust + tolerant per param 7.
function canonicalSkuSet() {
  const set = new Set();
  for (const s of NSData?.skus || []) if (s && s.code) set.add(String(s.code).toUpperCase());
  // COGS cards may carry codes not in the catalog (and vice-versa) — union both so
  // a code that resolves to EITHER source is considered known.
  for (const s of NSData?.skus || []) {
    const card = safeCostCard(s.code);
    if (card && Number.isFinite(card.cogs)) set.add(String(s.code).toUpperCase());
  }
  return set;
}
// Normalise a code for fuzzy comparison: uppercase, strip non-alphanumerics
// (hyphens / underscores / spaces a renamed export might introduce).
const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
// Cheap bounded Levenshtein (early-exit at maxD) — enough to spot a slight rename
// without pulling a dependency. Returns Infinity if distance exceeds maxD.
function editDistance(a, b, maxD = 3) {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > maxD) return Infinity;
  let prev = Array.from({ length: lb + 1 }, (_, i) => i);
  for (let i = 1; i <= la; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > maxD) return Infinity; // whole row already past tolerance → bail
    prev = cur;
  }
  return prev[lb] <= maxD ? prev[lb] : Infinity;
}
// For an unresolved code, find the nearest canonical code (normalised) within a
// small edit distance → a likely-rename suggestion. null if nothing close.
function nearestCanonical(code, canon) {
  const target = normCode(code);
  let best = null, bestD = Infinity;
  for (const c of canon) {
    const d = editDistance(target, normCode(c), 3);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best && bestD <= 3 ? { code: best, dist: bestD } : null;
}

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
  // SKU × MONTH × channel coverage (rubric 34 — the tri-axis gap map). For each
  // SKU we record, per month, which channels carry native per-SKU revenue, so the
  // founder sees at a glance which SKU×channel×month cells are covered vs blank.
  const skuMonth = {};   // code → { "YYYY-MM": Set(channels) }
  for (const [key, cell] of Object.entries(facts.monthly)) {
    if (isChannelGrainKey(key)) continue; // skip the channel-grain sentinel (store contract)
    const [m, ch, code] = key.split("|");
    if (!ch || !code) continue;
    const hasRev = Number(cell.units) > 0 || Number(cell.netRev) > 0 || Number(cell.grossRev) > 0;
    if (!hasRev) continue;
    skuMap[code] = skuMap[code] || { channels: new Set() };
    skuMap[code].channels.add(ch);
    (skuMonth[code] = skuMonth[code] || {});
    (skuMonth[code][m] = skuMonth[code][m] || new Set()).add(ch);
  }
  const cogsMisses = [];
  const skuRows = Object.keys(skuMap).sort().map((code) => {
    const card = safeCostCard(code);
    const hasCogs = !!card && Number.isFinite(card.cogs);
    if (!hasCogs) cogsMisses.push(code);
    return { code, channels: skuMap[code].channels, hasCogs, pkgPlaceholder: !!card?.pkgPlaceholder };
  });

  // SKU identity resolution audit (param 7 + XI/84). For every per-SKU code in
  // the fact store, decide: resolved (in the canonical catalog/COGS set) vs
  // unresolved → propose a nearest canonical match (likely rename) or mark it a
  // genuinely-new SKU. Clean state (every code resolves) renders as a quiet "all
  // N codes resolve" line — never a scary empty panel.
  const canon = canonicalSkuSet();
  const allFactCodes = Object.keys(skuMap).sort();
  const unresolved = [];
  for (const code of allFactCodes) {
    if (canon.has(String(code).toUpperCase())) continue;
    const near = nearestCanonical(code, canon);
    unresolved.push({ code, channels: [...skuMap[code].channels], near });
  }
  const skuResolution = { total: allFactCodes.length, resolved: allFactCodes.length - unresolved.length, unresolved };

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

  return { months, channels, grid, upgrades, recon, skuRows, skuMonth, cogsMisses, adCaveats, counts, skuResolution };
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
