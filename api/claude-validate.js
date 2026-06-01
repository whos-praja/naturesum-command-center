/**
 * /api/claude-validate — Vercel serverless function
 *
 * Proxies to Claude for two upload-pipeline use cases:
 *
 *   mode: "detect"
 *     Identify which of the 6 known file types a freshly-dropped file is.
 *     Input:  { mode: "detect", sample: "<first 2-3 lines of file>" }
 *     Output: { type: "amazon-orders" | "blinkit" | ... | "unknown",
 *               confidence: 0..1, reasoning: "..." }
 *
 *   mode: "anomaly"
 *     After a successful parse, sanity-check the numbers vs the prior
 *     bundled real-data and flag anything that looks like a data entry
 *     error or import bug.
 *     Input:  { mode: "anomaly", fileType, before: {...}, after: {...} }
 *     Output: { anomalies: [{ sku, metric, oldValue, newValue, ratio, why }] }
 *
 * Security: ANTHROPIC_API_KEY lives in Vercel env vars (never exposed
 * to the browser). When the env var is missing the endpoint returns
 * { skipped: true } so the upload pipeline falls back to JS-only
 * deterministic parsing without surfacing an error.
 */
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-5";

const SYSTEM_DETECT = `You are a file-type classifier for a D2C supplements brand's data pipeline.
Given the first few lines of an uploaded file, identify which of these 6 file types it is:

1. amazon-ledger — Amazon "Warehouse Wise Ledger" CSV. Header includes columns like Date, FNSKU, ASIN, MSKU, Disposition, Starting Warehouse Balance, Customer Shipments, Location.

2. amazon-orders — Amazon "Manage Orders" report, tab-separated. Header includes amazon-order-id, merchant-order-id, purchase-date, fulfillment-channel, sales-channel, sku, quantity, item-price.

3. blinkit — Blinkit feeder-WH "Stock On Hand" Excel export. First few rows mention "This sheet was generated at...", and column headers include "Item ID", "Item Name", "Warehouse Facility Name", "Total sellable", "Last 7 days", "Last 30 days".

4. flipkart — Flipkart Seller Hub "Current Inventory" CSV. Header includes Warehouse Id, SKU, Title, Listing Id, FSN, Flipkart Selling Price, Sales 7D, Sales 14D, Sales 30D.

5. shopify — Shopify website daily sales CSV. Header is: Day, Product variant title, Product title, Product variant SKU, Net items sold.

6. nitin — Naturesum internal MIS Excel workbook. Has sheets named "Master", "Daily Movement of FG", "Production", "Audit ...", " warehouse inventory". First row often reads "NATURESUM — MASTER CONSOLIDATE".

Respond ONLY with a JSON object via the file_type tool. Set confidence 0..1.
If nothing matches well, use "unknown".`;

const SYSTEM_ANOMALY = `You are a data-quality auditor for a D2C supplements brand's daily data uploads.
Given two snapshots — "before" (the previous bundled real-data) and "after" (the freshly uploaded data) — for the same file source, identify SKU-level anomalies that look like data-entry errors or import bugs.

Heuristics:
- A metric (stock, velocity, sales count) changing by more than 5× day-over-day is suspicious unless the absolute number is tiny.
- A metric going from non-zero to exactly zero overnight is suspicious.
- A metric flipping sign (negative → positive or vice versa) is worth flagging.
- SKUs newly appearing or disappearing entirely are worth noting.

Respond ONLY with a JSON object via the anomalies tool. Each anomaly has: sku, metric, oldValue, newValue, ratio (newValue / oldValue, or null if oldValue is 0), why (one short sentence). Order by severity (most suspicious first). Return up to 8 anomalies. Empty list is fine if everything looks normal.`;

const TOOLS_DETECT = [{
  name: "file_type",
  description: "Report which of the 6 file types the input is, with a confidence score.",
  input_schema: {
    type: "object",
    required: ["type", "confidence", "reasoning"],
    properties: {
      type:       { type: "string", enum: ["amazon-ledger", "amazon-orders", "blinkit", "flipkart", "shopify", "nitin", "unknown"] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      reasoning:  { type: "string", description: "One-sentence justification." },
    },
  },
}];

const TOOLS_ANOMALY = [{
  name: "anomalies",
  description: "Report data anomalies that look like data-entry errors or import bugs.",
  input_schema: {
    type: "object",
    required: ["anomalies"],
    properties: {
      anomalies: {
        type: "array",
        items: {
          type: "object",
          required: ["sku", "metric", "oldValue", "newValue", "why"],
          properties: {
            sku:      { type: "string" },
            metric:   { type: "string" },
            oldValue: { type: ["number", "string", "null"] },
            newValue: { type: ["number", "string", "null"] },
            ratio:    { type: ["number", "null"] },
            why:      { type: "string" },
          },
        },
      },
    },
  },
}];

export default async function handler(req, res) {
  // CORS for local dev (vite at :5173 → vercel dev at :3000)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Graceful fall-through: upload pipeline keeps working without AI checks.
    return res.status(200).json({ skipped: true, reason: "ANTHROPIC_API_KEY not set" });
  }

  const client = new Anthropic({ apiKey });
  const { mode } = req.body || {};

  try {
    if (mode === "detect") {
      const { sample } = req.body;
      if (!sample) return res.status(400).json({ error: "Missing sample" });
      const r = await client.messages.create({
        model: MODEL,
        max_tokens: 256,
        system: SYSTEM_DETECT,
        tools: TOOLS_DETECT,
        tool_choice: { type: "tool", name: "file_type" },
        messages: [{ role: "user", content: `First lines of the file:\n\n${String(sample).slice(0, 4000)}` }],
      });
      const toolUse = r.content.find(c => c.type === "tool_use");
      if (!toolUse) return res.status(502).json({ error: "Claude did not return a tool call" });
      return res.status(200).json({ ok: true, result: toolUse.input, usage: r.usage });
    }

    if (mode === "anomaly") {
      const { fileType, before, after } = req.body;
      if (!fileType || !after) return res.status(400).json({ error: "Missing fileType or after" });
      const r = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_ANOMALY,
        tools: TOOLS_ANOMALY,
        tool_choice: { type: "tool", name: "anomalies" },
        messages: [{
          role: "user",
          content: `File source: ${fileType}\n\nBefore (bundled real-data, condensed):\n${JSON.stringify(before, null, 0).slice(0, 6000)}\n\nAfter (freshly uploaded, condensed):\n${JSON.stringify(after, null, 0).slice(0, 6000)}\n\nList anomalies.`,
        }],
      });
      const toolUse = r.content.find(c => c.type === "tool_use");
      if (!toolUse) return res.status(502).json({ error: "Claude did not return a tool call" });
      return res.status(200).json({ ok: true, result: toolUse.input, usage: r.usage });
    }

    return res.status(400).json({ error: "Unknown mode. Use 'detect' or 'anomaly'." });
  } catch (err) {
    console.error("[claude-validate]", err);
    return res.status(500).json({ error: err.message || String(err) });
  }
}
