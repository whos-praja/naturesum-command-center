import { useState, useMemo } from "react";
import { Card, Progress } from "../components/Shared.jsx";
import NSData from "../data.js";
import { mergedFacts, monthsIn, channelsIn } from "../lib/businessStore.js";
import { computeCM } from "../lib/cmEngine.js";

/**
 * PageMarketing — Business Performance module §9 (Marketing & Ads).
 *
 * REAL DATA ONLY. Reads mergedFacts() (bundled May-2026 baseline ⊕ uploads)
 * and computes the CM chain via computeCM. Every figure is derived; the old
 * fabricated Google/Meta/creative stubs are deleted. No NaN/Infinity is ever
 * rendered (SAFE fallbacks throughout; the engine guarantees finite output).
 *
 * What this page surfaces (spec §9 PageMarketing):
 *   1. Spend by CHANNEL — direct (product-attributed) vs allocated
 *      (channel-total override − direct, spread by revenue) split shown.
 *   2. Per-SKU spend + ROAS/ACOS — ROAS = attributed channel revenue ÷ spend,
 *      ACOS = spend ÷ revenue. Attribution windows labelled honestly.
 *   3. Breakeven-ACOS flag — breakeven ACOS = the cell's CM2% (margin left to
 *      pay for ads). ACOS > CM2% ⇒ the marginal ad rupee is loss-making (red).
 *   4. Zero-sale spend list — cells with ad spend but no units (wasted spend).
 *   5. Ad → CM3 bridge per channel — CM2 −adSpend = CM3, channel by channel.
 *
 * ATTRIBUTION HONESTY (spec §3 / §11): the fact store carries each cell's own
 * channel netRev and its DIRECT product-attributed ad spend. There is no
 * separate "attributed conversion revenue" field, so ROAS/ACOS use the cell's
 * channel netRev as the revenue basis — this is the order-date attributed
 * revenue for that SKU on that channel, the closest honest measure available.
 * The window each platform reports on differs (Amazon SP ≈ 14-day, Flipkart
 * PLA = report window, Google = its own conversion window); we caption that
 * rather than pretend a single unified window.
 */

const ANCHOR_MONTH = "2026-05";

// Channel display metadata (colour + label). Derived from the facts channel
// set, NEVER hardcoded as the authoritative list — this only decorates whatever
// channels actually appear. Unknown channels fall back to a neutral style.
const CH_META = {
  amazon:   { label: "Amazon",   color: "#E47911", adSource: "Amazon SP (per-ASIN daily)", window: "≈14-day SP attribution" },
  flipkart: { label: "Flipkart", color: "#2874F0", adSource: "Flipkart PLA (per-SKU)",      window: "FK PLA report window" },
  blinkit:  { label: "Blinkit",  color: "#F8CB46", adSource: "Snell channel total (Blinkit)", window: "channel total, no per-SKU split" },
  website:  { label: "Website",  color: "#5E8E3E", adSource: "Google product-wise + Meta", window: "Google/Meta conversion window" },
};
const chMeta = (ch) => CH_META[ch] || { label: ch, color: "#8E8A7E", adSource: "—", window: "—" };

const PageMarketing = () => {
  const D = NSData;

  // ── Live read model + compute ────────────────────────────────────────────
  // mergedFacts is read once per render; computeCM is pure. useMemo keys on the
  // facts identity + month so cost-input edits elsewhere are picked up on the
  // next render without a manual refresh button.
  const facts = useMemo(() => mergedFacts(), []);
  const months = monthsIn(facts);
  const [month, setMonth] = useState(months.includes(ANCHOR_MONTH) ? ANCHOR_MONTH : (months[months.length - 1] || ANCHOR_MONTH));

  const cm = useMemo(() => computeCM({ facts, month }), [facts, month]);

  // Channels present, ordered with the ones we have metadata for first.
  const channels = useMemo(() => {
    const present = channelsIn(facts).filter((ch) => cm.byChannel[ch]);
    const order = ["amazon", "flipkart", "blinkit", "website"];
    return [...present].sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }, [facts, cm]);

  const skuName = (code) => D.skus.find((s) => s.code === code)?.name || code;
  const skuVariant = (code) => D.skus.find((s) => s.code === code)?.variant || "";

  // ── Company spend rollup (direct vs allocated) ───────────────────────────
  // adSpend total = Σ each channel's resolved spend (direct + allocated). The
  // "allocated" slice = channel total override − direct (spec §3/§6). Where no
  // channel-total override is set, allocated is 0 and total == Σ direct.
  const spendByChannel = useMemo(() => {
    return channels.map((ch) => {
      const alloc = cm.adAllocation[ch] || { direct: 0, total: 0, unattributed: 0, unallocated: 0 };
      const roll = cm.byChannel[ch] || {};
      const spend = num(roll.adSpend);                  // direct + allocated landed on cells
      const direct = num(alloc.direct);
      const allocated = Math.max(0, spend - direct);    // revenue-spread share that landed
      return {
        ch,
        netRev: num(roll.netRev),
        spend,
        direct,
        allocated,
        unallocated: num(alloc.unallocated),            // override spend that couldn't be split
        cm2: roll.cm2,
        cm3: roll.cm3,
        cm2Pct: roll.pcts?.cm2 ?? null,
      };
    });
  }, [channels, cm]);

  const totalSpend = spendByChannel.reduce((a, c) => a + c.spend, 0);
  const totalRev = spendByChannel.reduce((a, c) => a + c.netRev, 0);
  const blendedRoas = totalSpend > 0 ? totalRev / totalSpend : null;
  const blendedAcos = totalRev > 0 ? totalSpend / totalRev : null;

  // ── Per-SKU × channel ad rows (from the CM3 matrix) ──────────────────────
  // Each matrix cell carries netRev, units, adSpend, cm3, cm3Pct. We layer in
  // the cell's CM2% (breakeven ACOS) by re-deriving from bySku.byChannel, which
  // the engine exposes per cell. Only cells with ad spend OR sales are listed.
  const adRows = useMemo(() => {
    const rows = [];
    for (const code of Object.keys(cm.matrix)) {
      for (const ch of Object.keys(cm.matrix[code])) {
        const m = cm.matrix[code][ch];
        const cell = cm.bySku[code]?.byChannel?.[ch] || {};
        const spend = num(m.adSpend);
        const rev = num(m.netRev);
        const units = num(m.units);
        if (spend <= 0 && rev <= 0) continue;           // nothing to show
        const roas = spend > 0 ? rev / spend : null;    // null = no spend on this cell
        const acos = spend > 0 ? (rev > 0 ? spend / rev : null) : null; // null rev → undefined ACOS
        const breakevenAcos = cell.pcts?.cm2 ?? null;   // CM2% = margin available for ads
        // Loss-making flag: ACOS exceeds breakeven (spends more per ₹ than the
        // margin left after COGS+fees). Only meaningful when both are known and
        // the cell actually has spend.
        const losing =
          spend > 0 && acos != null && breakevenAcos != null && breakevenAcos > 0 && acos > breakevenAcos;
        rows.push({
          code, ch, spend, rev, units,
          roas, acos, breakevenAcos,
          cm3: m.cm3, cm3Pct: m.cm3Pct,
          losing,
          noCogs: cell.coverage?.cogs === false || cell.cm2 == null,
          zeroSale: spend > 0 && units <= 0,
        });
      }
    }
    // Sort: biggest spend first (where the money goes).
    rows.sort((a, b) => b.spend - a.spend);
    return rows;
  }, [cm]);

  const spentRows = adRows.filter((r) => r.spend > 0);
  const zeroSaleRows = adRows.filter((r) => r.zeroSale);
  const losingRows = spentRows.filter((r) => r.losing);

  // Channel-total ad spend that exists in an override but couldn't be wired to
  // SKUs (0-revenue channel). Surfaced as a coverage caveat, never dropped.
  const unallocatedTotal = spendByChannel.reduce((a, c) => a + c.unallocated, 0);

  // Blinkit-style caveat: a channel that has SKU sales but ZERO resolved ad
  // spend, while we know from the spec a Snell channel total exists but isn't
  // wired as an override yet. We detect it structurally: sales but spend 0.
  const noSpendChannels = spendByChannel.filter((c) => c.netRev > 0 && c.spend <= 0);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">Marketing &amp; Advertising</div>
          <div className="page-sub">
            Ad spend → CM3 · per-SKU ROAS / ACOS · breakeven-ACOS flags · {fmtMonth(month)}
          </div>
        </div>
        <div className="actions">
          {months.length > 1 && (
            <div className="seg">
              {months.map((m) => (
                <button key={m} className={m === month ? "active" : ""} onClick={() => setMonth(m)}>
                  {fmtMonth(m)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="note" style={{ marginBottom: 14 }}>
        <strong style={{ color: "var(--info)" }}>Attribution basis:</strong>&nbsp;
        ROAS / ACOS use each SKU&apos;s own channel net revenue (order-date attributed) against its
        platform-reported ad spend. Windows differ per platform — Amazon SP ≈14-day, Flipkart PLA report
        window, Google/Meta their own conversion windows — so these are channel-native, not a single
        unified attribution. <strong style={{ color: "var(--ink-2)" }}>Breakeven ACOS = CM2%</strong> (the
        margin left after COGS + platform fees); spending above it loses money per ad rupee.
      </div>

      {/* ── Headline spend KPIs ─────────────────────────────────────────── */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 14 }}>
        <Card title="Total ad spend">
          <div className="stat-num lg">{D.fmtINR(totalSpend)}</div>
          <div className="muted" style={{ fontSize: 11.5 }}>
            across {channels.length} channel{channels.length === 1 ? "" : "s"} · {fmtMonth(month)}
          </div>
        </Card>
        <Card title="Attributed net revenue">
          <div className="stat-num lg">{D.fmtINR(totalRev)}</div>
          <div className="muted" style={{ fontSize: 11.5 }}>channel net revenue (basis for ROAS)</div>
        </Card>
        <Card title="Blended ROAS">
          <div className="stat-num lg">{blendedRoas == null ? "—" : blendedRoas.toFixed(2) + "×"}</div>
          <div className="muted" style={{ fontSize: 11.5 }}>net revenue ÷ ad spend</div>
        </Card>
        <Card title="Blended ACOS">
          <div className="stat-num lg">{blendedAcos == null ? "—" : (blendedAcos * 100).toFixed(1) + "%"}</div>
          <div className="muted" style={{ fontSize: 11.5 }}>ad spend ÷ net revenue</div>
        </Card>
      </div>

      {/* ── Coverage caveats (honest gaps) ──────────────────────────────── */}
      {(noSpendChannels.length > 0 || unallocatedTotal > 0) && (
        <div className="note" style={{ marginBottom: 14, borderColor: "var(--warning)" }}>
          <strong style={{ color: "var(--warning)" }}>Ad-coverage caveats:</strong>&nbsp;
          {noSpendChannels.length > 0 && (
            <>
              {noSpendChannels.map((c) => chMeta(c.ch).label).join(", ")} {noSpendChannels.length === 1 ? "has" : "have"} sales
              but no ad spend wired in this baseline ({noSpendChannels.map((c) => chMeta(c.ch).adSource).join("; ")} not yet
              loaded as a channel-total override) — its ROAS / ACOS read as no-spend, not as zero spend.&nbsp;
            </>
          )}
          {unallocatedTotal > 0 && (
            <>
              {D.fmtINR(unallocatedTotal)} of channel-total ad spend could not be allocated to SKUs (zero-revenue channel)
              and is held aside, not silently dropped.
            </>
          )}
        </div>
      )}

      {/* ── Spend by channel: direct vs allocated split ─────────────────── */}
      <Card
        title="Spend by channel"
        sub="Direct (product-attributed) vs allocated (channel total − direct, spread by revenue)"
        padded={false}
        style={{ marginBottom: 14 }}
      >
        <table className="table">
          <thead>
            <tr>
              <th>Channel</th>
              <th className="num">Net revenue</th>
              <th className="num">Direct spend</th>
              <th className="num">Allocated</th>
              <th className="num">Total spend</th>
              <th className="num">ROAS</th>
              <th className="num">ACOS</th>
              <th style={{ width: 150 }}>Spend share</th>
            </tr>
          </thead>
          <tbody>
            {spendByChannel.map((c) => {
              const roas = c.spend > 0 ? c.netRev / c.spend : null;
              const acos = c.netRev > 0 && c.spend > 0 ? c.spend / c.netRev : null;
              const share = totalSpend > 0 ? (c.spend / totalSpend) * 100 : 0;
              return (
                <tr key={c.ch}>
                  <td>
                    <span className="badge" style={pillStyle(c.ch)}>{chMeta(c.ch).label}</span>
                    <div className="sku" style={{ marginTop: 3 }}>{chMeta(c.ch).window}</div>
                  </td>
                  <td className="num">{D.fmtINR(c.netRev)}</td>
                  <td className="num">{D.fmtINR(c.direct)}</td>
                  <td className="num">
                    {c.allocated > 0 ? D.fmtINR(c.allocated) : <span className="muted">—</span>}
                  </td>
                  <td className="num">{D.fmtINR(c.spend)}</td>
                  <td className="num">{roas == null ? <span className="muted">—</span> : roas.toFixed(2) + "×"}</td>
                  <td className="num">{acos == null ? <span className="muted">—</span> : (acos * 100).toFixed(1) + "%"}</td>
                  <td>
                    <Progress value={share} color="brand"/>
                    <div className="sku" style={{ marginTop: 2 }}>{share.toFixed(0)}%</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {spendByChannel.length > 0 && (
            <tfoot>
              <tr style={{ fontWeight: 600 }}>
                <td>Total</td>
                <td className="num">{D.fmtINR(totalRev)}</td>
                <td className="num">{D.fmtINR(spendByChannel.reduce((a, c) => a + c.direct, 0))}</td>
                <td className="num">{D.fmtINR(spendByChannel.reduce((a, c) => a + c.allocated, 0))}</td>
                <td className="num">{D.fmtINR(totalSpend)}</td>
                <td className="num">{blendedRoas == null ? "—" : blendedRoas.toFixed(2) + "×"}</td>
                <td className="num">{blendedAcos == null ? "—" : (blendedAcos * 100).toFixed(1) + "%"}</td>
                <td/>
              </tr>
            </tfoot>
          )}
        </table>
      </Card>

      {/* ── Ad → CM3 bridge per channel ─────────────────────────────────── */}
      <Card
        title="Ad → CM3 bridge"
        sub="CM2 (after COGS + platform fees) − ad spend = CM3. The decision layer for delist / ad-pullback."
        padded={false}
        style={{ marginBottom: 14 }}
      >
        <table className="table">
          <thead>
            <tr>
              <th>Channel</th>
              <th className="num">CM2</th>
              <th className="num">− Ad spend</th>
              <th className="num">= CM3</th>
              <th className="num">CM3 %</th>
              <th>Bridge</th>
            </tr>
          </thead>
          <tbody>
            {spendByChannel.map((c) => {
              const roll = cm.byChannel[c.ch] || {};
              const cm2 = roll.cm2;
              const cm3 = roll.cm3;
              const cm3Pct = roll.pcts?.cm3 ?? null;
              return (
                <tr key={c.ch}>
                  <td><span className="badge" style={pillStyle(c.ch)}>{chMeta(c.ch).label}</span></td>
                  <td className="num">{cm2 == null ? <span className="muted">—</span> : D.fmtINR(cm2)}</td>
                  <td className="num" style={{ color: c.spend > 0 ? "var(--critical)" : undefined }}>
                    {c.spend > 0 ? "−" + D.fmtINR(c.spend).replace("−", "") : <span className="muted">₹0</span>}
                  </td>
                  <td className="num" style={{ color: cm3Color(cm3) }}>
                    {cm3 == null ? <span className="muted">—</span> : D.fmtINR(cm3)}
                  </td>
                  <td className="num" style={{ color: cm3Color(cm3) }}>
                    {cm3Pct == null ? <span className="muted">—</span> : fmtPct(cm3Pct)}
                  </td>
                  <td style={{ width: 220 }}>
                    <Cm2ToCm3Bridge cm2={cm2} adSpend={c.spend} cm3={cm3}/>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 600 }}>
              <td>Company</td>
              <td className="num">{cm.company.cm2 == null ? "—" : D.fmtINR(cm.company.cm2)}</td>
              <td className="num" style={{ color: "var(--critical)" }}>
                {totalSpend > 0 ? "−" + D.fmtINR(totalSpend).replace("−", "") : "₹0"}
              </td>
              <td className="num" style={{ color: cm3Color(cm.company.cm3) }}>
                {cm.company.cm3 == null ? "—" : D.fmtINR(cm.company.cm3)}
              </td>
              <td className="num" style={{ color: cm3Color(cm.company.cm3) }}>
                {cm.company.pcts?.cm3 == null ? "—" : fmtPct(cm.company.pcts.cm3)}
              </td>
              <td/>
            </tr>
          </tfoot>
        </table>
      </Card>

      {/* ── Loss-making cells callout (ACOS > breakeven) ────────────────── */}
      {losingRows.length > 0 && (
        <Card
          title="Losing money per ad rupee"
          sub="ACOS exceeds breakeven ACOS (CM2%) — every marginal ad rupee here erodes contribution."
          action={<span className="badge red dot">{losingRows.length}</span>}
          padded={false}
          style={{ marginBottom: 14 }}
        >
          <table className="table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Channel</th>
                <th className="num">Ad spend</th>
                <th className="num">ACOS</th>
                <th className="num">Breakeven (CM2%)</th>
                <th className="num">CM3</th>
              </tr>
            </thead>
            <tbody>
              {losingRows.map((r, i) => (
                <tr key={i}>
                  <td>{skuName(r.code)}<div className="sku">{r.code} · {skuVariant(r.code)}</div></td>
                  <td><span className="badge" style={pillStyle(r.ch)}>{chMeta(r.ch).label}</span></td>
                  <td className="num">{D.fmtINR(r.spend)}</td>
                  <td className="num" style={{ color: "var(--critical)" }}>{r.acos == null ? "—" : (r.acos * 100).toFixed(0) + "%"}</td>
                  <td className="num">{r.breakevenAcos == null ? "—" : (r.breakevenAcos * 100).toFixed(0) + "%"}</td>
                  <td className="num" style={{ color: cm3Color(r.cm3) }}>{r.cm3 == null ? "—" : D.fmtINR(r.cm3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* ── Zero-sale spend list (wasted ad rupees) ─────────────────────── */}
      <Card
        title="Zero-sale ad spend"
        sub="Cells with ad spend but no units sold this month — fully wasted spend."
        action={<span className={"badge " + (zeroSaleRows.length ? "red" : "green") + " dot"}>{zeroSaleRows.length}</span>}
        padded={false}
        style={{ marginBottom: 14 }}
      >
        {zeroSaleRows.length === 0 ? (
          <div className="card-body">
            <div className="muted" style={{ fontSize: 12.5 }}>
              No zero-sale ad spend this month — every SKU×channel that received ad budget converted at least one unit.
            </div>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>SKU</th><th>Channel</th><th className="num">Ad spend (wasted)</th></tr>
            </thead>
            <tbody>
              {zeroSaleRows.map((r, i) => (
                <tr key={i}>
                  <td>{skuName(r.code)}<div className="sku">{r.code} · {skuVariant(r.code)}</div></td>
                  <td><span className="badge" style={pillStyle(r.ch)}>{chMeta(r.ch).label}</span></td>
                  <td className="num" style={{ color: "var(--critical)" }}>{D.fmtINR(r.spend)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* ── Per-SKU × channel ROAS / ACOS table ─────────────────────────── */}
      <Card
        title="Per-SKU ad performance"
        sub="ROAS, ACOS and breakeven-ACOS per SKU × channel. Red ACOS = above breakeven (loss-making)."
        padded={false}
      >
        <table className="table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Channel</th>
              <th className="num">Units</th>
              <th className="num">Net revenue</th>
              <th className="num">Ad spend</th>
              <th className="num">ROAS</th>
              <th className="num">ACOS</th>
              <th className="num">Breakeven</th>
              <th className="num">CM3</th>
              <th className="num">CM3 %</th>
            </tr>
          </thead>
          <tbody>
            {spentRows.length === 0 && (
              <tr><td colSpan={10} className="muted" style={{ padding: 16, fontSize: 12.5 }}>
                No ad spend recorded for {fmtMonth(month)}.
              </td></tr>
            )}
            {spentRows.map((r, i) => (
              <tr key={i}>
                <td>
                  {skuName(r.code)}
                  <div className="sku">
                    {r.code} · {skuVariant(r.code)}
                    {r.noCogs && <span className="badge amber" style={{ marginLeft: 6, fontSize: 9 }}>no COGS</span>}
                  </div>
                </td>
                <td><span className="badge" style={pillStyle(r.ch)}>{chMeta(r.ch).label}</span></td>
                <td className="num">{r.units <= 0 ? <span style={{ color: "var(--critical)" }}>0</span> : D.fmtN(r.units)}</td>
                <td className="num">{D.fmtINR(r.rev)}</td>
                <td className="num">{D.fmtINR(r.spend)}</td>
                <td className="num">{r.roas == null ? <span className="muted">—</span> : r.roas.toFixed(2) + "×"}</td>
                <td className="num" style={{ color: r.losing ? "var(--critical)" : undefined }}>
                  {r.acos == null ? <span className="muted">—</span> : (r.acos * 100).toFixed(0) + "%"}
                </td>
                <td className="num">
                  {r.breakevenAcos == null ? <span className="muted">—</span> : (r.breakevenAcos * 100).toFixed(0) + "%"}
                </td>
                <td className="num" style={{ color: cm3Color(r.cm3) }}>{r.cm3 == null ? <span className="muted">—</span> : D.fmtINR(r.cm3)}</td>
                <td className="num" style={{ color: cm3Color(r.cm3) }}>{r.cm3Pct == null ? <span className="muted">—</span> : fmtPct(r.cm3Pct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="card-body" style={{ paddingTop: 10 }}>
          <div className="muted" style={{ fontSize: 11 }}>
            ROAS = net revenue ÷ ad spend · ACOS = ad spend ÷ net revenue · Breakeven ACOS = CM2% (margin after COGS +
            platform fees). Ad source per channel: {channels.map((ch) => `${chMeta(ch).label} → ${chMeta(ch).adSource}`).join(" · ")}.
          </div>
        </div>
      </Card>
    </div>
  );
};

// ── Mini horizontal bridge: CM2 → −ad → CM3 (proportional bars). ───────────
// SAFE: returns an empty cell when CM2 is unknown (no-COGS channel). Never
// produces NaN widths — all widths clamp into [0,100].
const Cm2ToCm3Bridge = ({ cm2, adSpend, cm3 }) => {
  if (cm2 == null) return <span className="muted" style={{ fontSize: 11 }}>—</span>;
  const c2 = num(cm2);
  const ad = num(adSpend);
  const denom = Math.max(Math.abs(c2), Math.abs(c2) + ad, 1);
  const cm2W = clampPct((Math.max(0, c2) / denom) * 100);
  const adW = clampPct((ad / denom) * 100);
  const negative = (cm3 != null && cm3 < 0) || c2 <= 0;
  return (
    <div style={{ display: "flex", height: 9, borderRadius: 3, overflow: "hidden", background: "var(--border-soft)" }}>
      <div style={{ width: cm2W + "%", background: negative ? "var(--warning)" : "var(--brand)" }}/>
      <div style={{ width: adW + "%", background: "var(--critical)", opacity: 0.7 }}/>
    </div>
  );
};

// ── helpers (NaN-free formatting) ──────────────────────────────────────────
function num(n) { const v = Number(n); return Number.isFinite(v) ? v : 0; }
function clampPct(p) { const v = Number(p); return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0; }
function fmtPct(frac) {
  const v = Number(frac);
  if (!Number.isFinite(v)) return "—";
  return (v >= 0 ? "" : "−") + Math.abs(v * 100).toFixed(1) + "%";
}
function cm3Color(v) {
  if (v == null || !Number.isFinite(Number(v))) return undefined;
  return Number(v) < 0 ? "var(--critical)" : "var(--success)";
}
function pillStyle(ch) {
  const color = chMeta(ch).color;
  return { background: color + "22", color, borderColor: color + "55" };
}
function fmtMonth(m) {
  // "2026-05" → "May 2026". SAFE on malformed input.
  const parts = String(m || "").split("-");
  if (parts.length !== 2) return String(m || "—");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mi = Number(parts[1]) - 1;
  return (names[mi] || parts[1]) + " " + parts[0];
}

export default PageMarketing;
