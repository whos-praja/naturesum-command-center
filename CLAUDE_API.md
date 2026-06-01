# Claude API integration (upload pipeline)

Sprint 13 wired Claude API into the daily-data upload flow as a **format-guard + anomaly checker**. Pure-JS parsing still runs first and handles the happy path for free. Claude is only invoked when a parser fails (to suggest the right file type) or after a successful parse to sanity-check numbers vs the bundled real-data baseline.

## How it's wired

- `api/claude-validate.js` — Vercel serverless function. Two modes:
  - `detect` — given a file sample, returns `{ type, confidence, reasoning }`.
  - `anomaly` — given before/after snapshots, returns a list of suspicious deltas.
- `src/lib/claudeHelper.js` — browser client. Calls the endpoint, returns `null` / `[]` if unreachable so the UI degrades gracefully.
- `src/components/UploadModal.jsx` — wires both calls into each upload zone. Shows `✨ AI-CHECKING…` while a check is in flight, `✨ AI-CHECKED` when no anomalies, `⚠ N ANOMALIES` with an inline list otherwise.

## Setup

1. Get an Anthropic API key from <https://console.anthropic.com/>.
2. Add it to Vercel project env vars:
   ```
   ANTHROPIC_API_KEY = sk-ant-api03-...
   ```
   Scope: Production (and Preview if you want PR previews to use AI).
3. Redeploy (Vercel does this automatically on the next push).

Local development (`npm run dev`) does **not** hit the API by default — the `/api/*` path 404s without `vercel dev`. To test AI assists locally, install Vercel CLI and run:
```
npm install -g vercel
vercel link              # one-time, picks your project
vercel env pull          # downloads .env.local with ANTHROPIC_API_KEY
vercel dev               # runs frontend + serverless functions
```

The upload modal degrades cleanly when the endpoint is missing — JS parsing still works, no AI badges or anomaly hints surface.

## Model & cost

- Model: `claude-sonnet-4-5` (current Sonnet generation).
- Pricing: $3 / M input tokens, $15 / M output tokens.

Typical per-upload cost breakdown (one of each file type, 6 files daily):

| Call | Tokens (in / out) | Per call | Daily |
|------|------------------|----------|-------|
| Format-detect (only on parser failure) | ~500 / 50 | ~$0.003 | $0–0.02 |
| Anomaly check (per successful parse) | ~2 000 / 500 | ~$0.013 | ~$0.08 |
| **Estimated total** | | | **~$0.08–0.10** |
| **Monthly (30 days)** | | | **~$2.50–3.00** |

At very light usage (1–2 anomaly calls per day, occasional format-detect on errors) the bill stays well under $5/month. Heavier validation (e.g. checking every file even when no error) caps around $7–10/month.

## Privacy & data flow

- Only **summary stats** (per-SKU headline numbers) are sent to Claude — not full per-warehouse / per-order detail.
- Raw files never leave the browser. The browser parses, condenses, then sends the condensed view.
- The API key never reaches the browser (serverless-only).

## Switching it off

Either:
- Delete `ANTHROPIC_API_KEY` from Vercel env vars → endpoint returns `{ skipped: true }` → UI silently skips AI badges.
- Or revert `src/components/UploadModal.jsx` to skip the `checkAnomalies` call.
