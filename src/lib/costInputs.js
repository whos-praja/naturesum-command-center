/**
 * costInputs.js
 *
 * Editable cost-input registry for the Business Performance module (spec §4,
 * §5, §7). Bakes the founder-approved defaults and layers per-key localStorage
 * overrides on top (the "no-sheet-next-time" provision). Every figure exposes
 * its as-of date + source so the UI can caption provenance.
 *
 * STORAGE — overrides live under the "ns.bizCost.*" namespace, one key each:
 *   ns.bizCost.cogs       JSON { [code]: { cogs, asOf, source } }  (per-SKU patch)
 *   ns.bizCost.fee        JSON { [channelKey]: { pct, asOf, source } }
 *   ns.bizCost.mcfShare   JSON { share, asOf, source }
 *   ns.bizCost.fixed      JSON { [month]: { amount, asOf } }       ("YYYY-MM")
 *
 * Defaults are NEVER mutated; setters write the override layer, getters merge
 * (override wins per field). SSR-safe (window guards) — same pattern as
 * skuTargets.js / multiFileStore.js. NaN-free: every numeric getter SAFE-falls
 * back to its baked default on a malformed override.
 *
 * CONSTRAINT (spec §9): fee channel keys are the BusinessModel cost rows
 * (amazon, mcf-web, flipkart, website-direct, blinkit) — NOT the same set as
 * the fact-store `channel` dimension. The website *channel* fee is a BLENDED
 * rate derived from mcf-web + website-direct via mcfShare (getFeePct("website")).
 */

// ─── Namespaced override keys ────────────────────────────────
const K_COGS  = "ns.bizCost.cogs";
const K_FEE   = "ns.bizCost.fee";
const K_MCF   = "ns.bizCost.mcfShare";
const K_FIXED = "ns.bizCost.fixed";

// ─── Baked defaults (founder files — provenance pinned) ──────
// §4 COGS (₹/unit incl packaging), revised 11-Jun file. The two ₹0-packaging
// placeholders (NSACDT30, NSJO100) are flagged so the UI can warn that pkg
// cost is not yet folded in — their `cogs` is still the real per-unit number,
// only the packaging component is a placeholder.
const COGS_AS_OF  = "2026-06-11";
const COGS_SOURCE = "Unit_COGS file";
const DEFAULT_COGS = {
  NSACDT30:  { cogs: 150,    pkgPlaceholder: true },
  NSJO100:   { cogs: 375,    pkgPlaceholder: true },
  NSSB100:   { cogs: 133 },
  NSSB250:   { cogs: 305.25 },
  NSSB500:   { cogs: 582.5 },
  NSSBDB100: { cogs: 136.5 },
  NSSBDB250: { cogs: 314 },
  NSSBDB500: { cogs: 600 },
  NSMP100:   { cogs: 39.5 },
  NSMP250:   { cogs: 71.5 },
  NSSBBO15:  { cogs: 180.5 },
  NSSBBO30:  { cogs: 353 },
  NSSBJ300:  { cogs: 232.7 },
  NSSBJ500:  { cogs: 342.3 },
};

// §5 variable platform cost % (of the channel's OWN net revenue). As-of Apr-26,
// the ONLY BusinessModel numbers used (spec §9). Stored as fractions (0..1).
const FEE_AS_OF  = "2026-04";
const FEE_SOURCE = "BusinessModel Channel CM (corrected)";
const DEFAULT_FEE = {
  amazon:           0.275413,
  "mcf-web":        0.248011, // website fulfilled-by-Amazon leg
  flipkart:         0.103647,
  "website-direct": 0.232627, // website self-fulfilled leg
  blinkit:          0.256940,
};

// §5 website blended-fee rule. mcfShare = MCF revenue share of website,
// derived at build from All-Orders Non-Amazon units × website per-unit net
// price and CAPPED to [0,1] (the proxy can overshoot 1.0 — see build script).
// The baked May number rides in the bundled fact-store meta
// (meta.bySource["amazon-orders"].mcfShare); bakedMcfShare() reads it so the
// default is the real computed share, not a 0.0 placeholder. If the bundled
// value is ever missing, we fall back to a flagged 0.0 lower-bound (website fee
// == website-direct, an honest under-charge, never NaN).
const MCF_AS_OF          = "2026-06-12";
const MCF_SOURCE         = "All-Orders Non-Amazon × website net price (May build, capped [0,1])";
const MCF_FALLBACK_SHARE = { share: 0.0, asOf: MCF_AS_OF, source: MCF_SOURCE, placeholder: true };

// Pull the build-baked mcfShare out of the bundled baseline meta. Kept lazy +
// fail-soft so a malformed/absent bundle can never throw into a render — it just
// falls through to the 0.0 lower-bound. Synchronous require-free import.
import { BUNDLED_BUSINESS } from "../bundledBusinessData.js";
function bakedMcfShare() {
  try {
    const baked = BUNDLED_BUSINESS?.meta?.bySource?.["amazon-orders"]?.mcfShare;
    if (baked && Number.isFinite(Number(baked.share))) {
      return {
        share: Math.max(0, Math.min(1, Number(baked.share))),
        asOf: baked.asOf || MCF_AS_OF,
        source: baked.source || MCF_SOURCE,
        ...(baked.capped ? { capped: true } : {}),
      };
    }
  } catch { /* fall through to the flagged lower-bound */ }
  return null;
}

// ─── localStorage helpers (SSR-safe, fail-quiet) ─────────────
function readJson(key) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeJson(key, val) {
  if (typeof window === "undefined") return;
  try {
    if (val == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(val));
  } catch {
    /* quota / private-mode — defaults still serve, never throw into a render */
  }
}
const fin = (n, fallback) => (Number.isFinite(n) ? n : fallback);

// ─── COGS ────────────────────────────────────────────────────
/** getCostCard(code) → { cogs, asOf, source, pkgPlaceholder? } | null.
 *  Override (ns.bizCost.cogs[code]) wins per field; null for unknown codes so
 *  the engine can treat absent COGS honestly (null ≠ 0). */
export function getCostCard(code) {
  const base = DEFAULT_COGS[code];
  const ov = readJson(K_COGS)?.[code];
  if (!base && !ov) return null;
  const cogs = fin(Number(ov?.cogs), base?.cogs);
  if (!Number.isFinite(cogs)) return null;
  return {
    cogs,
    asOf:   ov?.asOf   || COGS_AS_OF,
    source: ov?.source || (ov ? `user-edited ${ov.asOf || ""}`.trim() : COGS_SOURCE),
    ...(base?.pkgPlaceholder ? { pkgPlaceholder: true } : {}),
  };
}
/** setCostCard(code, cogs, asOf?) — patches one SKU's COGS override. */
export function setCostCard(code, cogs, asOf) {
  const n = Number(cogs);
  if (!Number.isFinite(n)) return;
  const cur = readJson(K_COGS) || {};
  cur[code] = { cogs: n, asOf: asOf || todayISO(), source: `user-edited ${asOf || todayISO()}` };
  writeJson(K_COGS, cur);
}

// ─── Fees ────────────────────────────────────────────────────
/** getFeePct(channel) → { pct, asOf, source }.
 *  channel here is the BUSINESSMODEL fee row OR the fact-store channel name.
 *  For the fact-store "website" channel the pct is the BLENDED rate (§5):
 *    mcfShare × mcf-web + (1 − mcfShare) × website-direct.
 *  Unknown channel → pct 0 (SAFE: an unknown channel charges no modelled fee
 *  rather than crashing; coverage panel surfaces the gap). */
export function getFeePct(channel) {
  if (channel === "website") {
    const { share } = getMcfShare();
    const mcf = getRawFee("mcf-web");
    const dir = getRawFee("website-direct");
    const s = fin(Number(share), 0);
    const blended = s * mcf.pct + (1 - s) * dir.pct;
    return {
      pct: fin(blended, 0),
      asOf: dir.asOf,
      source: `${dir.source} · blended @ mcfShare=${(s * 100).toFixed(1)}%`,
    };
  }
  return getRawFee(channel);
}
/** Raw (non-blended) fee row lookup for a BusinessModel key. */
function getRawFee(channelKey) {
  const base = DEFAULT_FEE[channelKey];
  const ov = readJson(K_FEE)?.[channelKey];
  const pct = fin(Number(ov?.pct), base);
  return {
    pct: fin(pct, 0),
    asOf:   ov?.asOf   || FEE_AS_OF,
    source: ov?.source || (ov ? `user-edited ${ov.asOf || ""}`.trim() : FEE_SOURCE),
    known:  base != null || ov != null,
  };
}
/** setFeePct(channelKey, pct, asOf?) — pct as a FRACTION (0..1). */
export function setFeePct(channelKey, pct, asOf) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return;
  const cur = readJson(K_FEE) || {};
  cur[channelKey] = { pct: n, asOf: asOf || todayISO(), source: `user-edited ${asOf || todayISO()}` };
  writeJson(K_FEE, cur);
}

// ─── MCF share (website blended-fee input) ───────────────────
/** getMcfShare() → { share, asOf, source, placeholder?, capped? }.
 *  Precedence: localStorage override → build-baked bundled default → 0.0
 *  flagged lower-bound. */
export function getMcfShare() {
  const ov = readJson(K_MCF);
  if (ov && Number.isFinite(Number(ov.share))) {
    return { share: Number(ov.share), asOf: ov.asOf || todayISO(), source: ov.source || `user-edited ${ov.asOf || ""}`.trim() };
  }
  return bakedMcfShare() || { ...MCF_FALLBACK_SHARE };
}
/** setMcfShare(share, asOf?) — share as a FRACTION (0..1). */
export function setMcfShare(share, asOf) {
  const n = Number(share);
  if (!Number.isFinite(n)) return;
  writeJson(K_MCF, { share: n, asOf: asOf || todayISO(), source: `user-edited ${asOf || todayISO()}` });
}

// ─── Fixed cost (monthly, CM4) ───────────────────────────────
/** getFixedCost(month) → { amount, asOf } | null. Null (no default) → the CM4
 *  row stays HIDDEN until the founder enters a fixed-cost figure (spec §6/§11).
 *  month = "YYYY-MM". */
export function getFixedCost(month) {
  const ov = readJson(K_FIXED)?.[month];
  if (ov && Number.isFinite(Number(ov.amount))) {
    return { amount: Number(ov.amount), asOf: ov.asOf || todayISO() };
  }
  return null;
}
/** setFixedCost(month, amount, asOf?) — monthly fixed ₹. null clears it. */
export function setFixedCost(month, amount, asOf) {
  const cur = readJson(K_FIXED) || {};
  if (amount == null || amount === "") {
    delete cur[month];
  } else {
    const n = Number(amount);
    if (!Number.isFinite(n)) return;
    cur[month] = { amount: n, asOf: asOf || todayISO() };
  }
  writeJson(K_FIXED, cur);
}

// ─── Introspection (Cost Inputs panel) ───────────────────────
/** listCostInputs() → a flat snapshot of every editable figure with its
 *  effective value + provenance, for the Cost Inputs panel + JSON export. */
export function listCostInputs() {
  return {
    cogs: Object.keys(DEFAULT_COGS).map((code) => ({ code, ...getCostCard(code) })),
    fees: Object.keys(DEFAULT_FEE).map((channelKey) => ({ channelKey, ...getRawFee(channelKey) })),
    websiteBlendedFee: getFeePct("website"),
    mcfShare: getMcfShare(),
    fixedCosts: readJson(K_FIXED) || {},
  };
}

/** Reset all overrides back to baked defaults (Cost Inputs panel "reset"). */
export function resetCostInputs() {
  writeJson(K_COGS, null);
  writeJson(K_FEE, null);
  writeJson(K_MCF, null);
  writeJson(K_FIXED, null);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Greppable export of the placeholder-flagged SKUs (spec §4 — the two ₹0
// packaging placeholders) so the UI can render a warning badge without
// re-deriving the flag.
export const PKG_PLACEHOLDER_CODES = Object.entries(DEFAULT_COGS)
  .filter(([, v]) => v.pkgPlaceholder)
  .map(([code]) => code);
