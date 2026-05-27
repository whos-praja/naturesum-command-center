# Naturesum Command Center

Internal business-intelligence and operations platform for the Naturesum team. Replaces
fragmented agency reports, WhatsApp updates, and manual Excel consolidation with a single
real-time view across sales, inventory, marketing, finance, and operations.

> **Status** — Phase 1 in progress. The Inventory module (warehouse-only) is the only
> live module. Every other module is a UI preview, blurred and gated behind the
> "Preview mode" toggle in the top bar.

## Stack

- **Vite + React 19** — UI
- **React Router DOM** — section + sub-section routing (`/inventory/materials`, etc.)
- **Bespoke CSS** — "Quiet Ops" design system (DM Sans + JetBrains Mono)
- **Vercel** — hosting (`team.naturesum.com`)
- **Cloudflare Access** — auth (email allowlist, runs in front of the site, no app code)

## Local development

```bash
npm install
npm run dev   # http://localhost:5173
```

A LaunchAgent (`com.naturesum.dev`) auto-runs the dev server on login at port 5173.
To stop it permanently: `launchctl bootout gui/$(id -u)/com.naturesum.dev`.

## Project layout

```
src/
  main.jsx                # Vite entry — wires BrowserRouter
  App.jsx                 # Shell: sidebar + topbar + active page, role gating, preview-mode toggle
  data.js                 # Mock NSData (SKUs, channels, inventory, alerts, etc.)
  index.css               # Full design system + module-specific styles
  components/
    Shared.jsx            # Icon, Delta, Card, Sparkline, BarChart, Progress, ChannelPill
    Nav.jsx               # Sidebar + Topbar
  pages/
    PageHome.jsx          # Module 1 — Command Center dashboard
    PageSales.jsx         # Module 2
    PageInventory.jsx     # Module 3 — LIVE (warehouse-only)
    PageSuppliers.jsx     # Module 4
    PageMarketing.jsx     # Module 5
    PageInfluencer.jsx    # Module 6
    PageMarketplaceIntel.jsx  # Module 7
    PageFinance.jsx       # Module 8
    PageLaunches.jsx      # Module 9
    PageAlerts.jsx        # Module 10
```

## Deployment

`main` branch → auto-deploys to Vercel → `team.naturesum.com` (via Cloudflare DNS + Access).
SPA rewrite and security headers are in `vercel.json`.
