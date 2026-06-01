/**
 * skuTargets.js
 *
 * Per-SKU "target days of cover" persistence. Drives the desired-stock-
 * level calc that the Forecast tab uses to recommend reorder quantities.
 *
 * Default = 30 days (matches the pre-existing hardcoded buffer so users
 * who never touch the target see no change in numbers). Stored in
 * localStorage so each device remembers its operator's preferences;
 * same pattern as BLK-005's per-SKU amber threshold.
 *
 *   readTargetDays(skuCode)            → number     (default 30)
 *   writeTargetDays(skuCode, n)        → void
 *   targetRequired(velocity, periodDays, skuCode) → number
 *       units needed to cover `periodDays + targetDays` of demand
 */

const KEY = (sku) => `ns.targetDays.${sku}`;
export const DEFAULT_TARGET_DAYS = 30;

export function readTargetDays(skuCode) {
  if (typeof window === "undefined") return DEFAULT_TARGET_DAYS;
  const raw = window.localStorage.getItem(KEY(skuCode));
  if (raw == null) return DEFAULT_TARGET_DAYS;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TARGET_DAYS;
}

export function writeTargetDays(skuCode, n) {
  if (typeof window === "undefined") return;
  const clamped = Math.max(1, Math.min(365, Math.round(n)));
  window.localStorage.setItem(KEY(skuCode), String(clamped));
}

export function resetTargetDays(skuCode) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY(skuCode));
}

/** Units needed to cover the forecast period + the per-SKU target buffer.
 *  Matches the Forecast tab's existing `required` formula but with the
 *  hardcoded 30-day buffer replaced by the user-set target. */
export function targetRequired(velocity, periodDays, skuCode, trend = 1) {
  const target = readTargetDays(skuCode);
  return Math.round((velocity || 0) * (periodDays + target) * trend);
}
