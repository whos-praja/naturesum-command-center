# Tracker auto-sync — setup (one-time, ~10 minutes)

This wires your Google Sheet tracker to the GitHub repo. Every time I push a commit, the sheet picks up the changes within an hour (or instantly if you click "Sync now").

## Part 1 — Get the tracker into Google Sheets (2 min)

1. Open https://drive.google.com in your browser.
2. Drag `~/Downloads/NatureSum Command Center Tracker - Updated 2026-05-30.xlsx` into Drive.
3. Right-click the uploaded file → **Open with → Google Sheets**.
4. Once it opens, **File → Save as Google Sheets** (this converts it from xlsx to native Sheets so Apps Script can edit it).
5. The new Google Sheets file lives in your Drive. Bookmark it.

## Part 2 — Install the Apps Script (5 min)

1. In the Google Sheet, click **Extensions → Apps Script**.
2. A new browser tab opens with the script editor.
3. Delete any starter code in `Code.gs`.
4. Open `scripts/tracker-sync.gs` from this repo, copy the **entire contents**, paste into `Code.gs`.
5. Click the **Save** icon (or Cmd+S). When prompted, name the project something like "Naturesum Tracker Sync".
6. Click the **Run** button (▶) with `onOpen` selected from the function dropdown.
7. A permissions dialog appears:
   - "Review permissions" → pick your Google account
   - It'll say "Google hasn't verified this app" — click **Advanced → Go to Naturesum Tracker Sync (unsafe)**. This is your own script, it's fine.
   - Approve the Sheets edit + URL fetch permissions.
8. Reload the Google Sheet tab (the one with the tracker).
9. You'll see a new menu **Naturesum Sync** in the menubar.

## Part 3 — First sync + auto-trigger (1 min)

1. Click **Naturesum Sync → Sync from GitHub now**. A toast confirms how many commits were processed.
2. Verify a few rows updated correctly (Tracking sheet — SIM-001, AMZ-001, etc. should be DONE).
3. Click **Naturesum Sync → Enable auto-sync (hourly)**. Done — the script now runs every hour in the background.

## Daily use (zero clicks)

Just push commits to GitHub. Within an hour, the sheet updates itself.

If you want an instant update after a fresh push, click **Naturesum Sync → Sync from GitHub now** — takes ~2 seconds.

## How commits drive the sheet

Going forward, my commit messages will include a `Tracker:` footer block when I ship sheet-relevant work. Like:

```
Sprint 3 — Simulator overhaul

[normal commit body explaining what changed in code]

Tracker:
- SIM-010 → DONE
- SIM-011 → DONE
- SIM-012 → DONE — nested editing with disable-individuals UX
- SIM-013 → DONE
- SIM-014 → DONE (using founder-supplied lead times)
- SIM-015 → DONE
- SIM-016 → DONE
- SIM-017 → DONE (cascade applied in Simulator)
- SIM-018 → DONE

Decision: BLK-005-D1 → 25 (default amber threshold)
Data: SIM-014-DATA → received
```

What the script does with this:
- Each `- KEY → STATUS` line in the Tracker block updates that row's Status column.
- Anything after a `—` or in `(parens)` becomes a Notes entry stamped with the commit SHA + date.
- A `Decision: KEY → value` line fills the Decided column in the Decisions sheet.
- A `Data: KEY → received` line marks the Data Requests sheet (Received = yes, today's date).
- When a status becomes DONE, the script also blanks out the Blocker column and sets Sprint = "Done".

## Useful menu items

| Menu item | What it does |
|---|---|
| **Sync from GitHub now** | Pulls new commits and applies their updates immediately |
| **Enable auto-sync (hourly)** | Installs a time trigger; happens automatically |
| **Disable auto-sync** | Removes the time trigger |
| **Reset sync history** | Re-processes the last ~100 commits from scratch (rarely needed; useful if you ever delete the sheet and start over) |
| **Show sync status** | Shows what SHA was last processed + whether auto-sync is on |

## Notes

- The script uses the **public** GitHub API — no auth, no tokens, no setup beyond pasting this file. GitHub's anonymous rate limit (60 req/hr per IP) is plenty.
- If you ever make the repo private, the script needs a `GITHUB_TOKEN` Script Property added — but for now, public works.
- Idempotent: re-running sync is safe. It tracks the last processed commit SHA and only processes newer ones.
- The sheet's existing COUNTIF formulas in the Dashboard tab auto-recompute as status cells change — so the top summary updates itself too.
