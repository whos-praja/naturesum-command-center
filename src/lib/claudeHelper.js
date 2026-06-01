/**
 * claudeHelper.js
 *
 * Thin browser client for /api/claude-validate. Two entry points:
 *
 *   detectFileType(file) → { type, confidence, reasoning } | null
 *     Reads the first ~3 KB of an uploaded file and asks Claude to
 *     classify it. Used when a JS parser fails or for "drop any file"
 *     auto-routing.
 *
 *   checkAnomalies(fileType, before, after) → [{ sku, metric, ... }]
 *     Sanity-checks freshly-parsed numbers against the previous bundled
 *     real-data and flags suspicious deltas.
 *
 * Failure modes are handled gracefully — if the endpoint is unreachable
 * (dev mode without vercel dev) or the env var isn't set, both functions
 * return null / [] and the upload pipeline keeps working without AI
 * assists. This way Option B never blocks the deterministic JS path.
 */

const ENDPOINT = "/api/claude-validate";
const TIMEOUT_MS = 12_000;

async function callClaude(body) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!r.ok) {
      console.warn("[claudeHelper] non-200:", r.status);
      return null;
    }
    const j = await r.json();
    if (j.skipped) {
      console.info("[claudeHelper] skipped:", j.reason);
      return null;
    }
    return j;
  } catch (e) {
    console.warn("[claudeHelper] call failed:", e.message);
    return null;
  }
}

export async function detectFileType(file) {
  if (!file) return null;
  // Read first ~4 KB. xlsx files are binary so we send their first
  // sheet-name + a hint instead.
  let sample;
  if (/\.(xlsx|xls)$/i.test(file.name)) {
    // For binary Excel files, hint with the filename and the fact it's
    // binary. The Claude prompt already knows what the xlsx sources
    // look like (Blinkit Stock On Hand / Nitin MIS) so name alone is a
    // strong signal.
    sample = `[Excel workbook: ${file.name}]\n\n(binary file, name suggests:`
           + (` ${/blinkit/i.test(file.name) ? "Blinkit feeder-WH" : ""}`)
           + (` ${/live inventory|naturesum/i.test(file.name) ? "Nitin's MIS" : ""}`)
           + ")";
  } else {
    sample = await file.slice(0, 4000).text();
  }
  const r = await callClaude({ mode: "detect", sample });
  return r?.result || null;
}

export async function checkAnomalies(fileType, before, after) {
  if (!fileType || !after) return [];
  // Condense the inputs — Claude doesn't need the full per-WH detail,
  // just the headline numbers per SKU.
  const condense = (data) => {
    if (!data || typeof data !== "object") return data;
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      if (!v || typeof v !== "object") { out[k] = v; continue; }
      // Strip large nested objects (byFc, byWh) — keep totals only.
      const { byFc, byWh, ...rest } = v;
      out[k] = {
        ...rest,
        ...(byFc ? { fcCount: Object.keys(byFc).length } : {}),
        ...(byWh ? { whCount: Object.keys(byWh).length } : {}),
      };
    }
    return out;
  };
  const r = await callClaude({
    mode: "anomaly",
    fileType,
    before: condense(before),
    after: condense(after),
  });
  return r?.result?.anomalies || [];
}
