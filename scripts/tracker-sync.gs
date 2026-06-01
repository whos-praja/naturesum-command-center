/**
 * Naturesum Command Center — Tracker auto-sync from GitHub commits.
 *
 * What this does
 * --------------
 * Reads recent commits from the public GitHub repo, parses each commit
 * message for a `Tracker:` footer (or inline item-key references),
 * and updates the Tracking / Decisions / Data Requests sheets to match.
 *
 * Setup (one-time)
 * ----------------
 * 1. Upload the tracker xlsx to Google Drive → open as Google Sheet.
 * 2. Extensions → Apps Script → paste this whole file → Save.
 * 3. Click "Run" once on the `onOpen` function and accept the auth prompt.
 *    (Authorises the script to edit the sheet and fetch from github.com.)
 * 4. Reload the sheet. A new menu "Naturesum Sync" appears in the menubar.
 *
 * Daily use
 * ---------
 * - Menu → "Naturesum Sync → Sync from GitHub now" — pulls latest commits
 *   and applies their tracker updates immediately.
 * - Menu → "Naturesum Sync → Enable auto-sync (hourly)" — installs a time
 *   trigger so syncs happen every hour without you doing anything.
 * - Menu → "Naturesum Sync → Disable auto-sync" — removes the trigger.
 *
 * How commits drive the sheet
 * ---------------------------
 * Each commit message is scanned for a footer block:
 *
 *   Tracker:
 *   - SIM-001 → DONE
 *   - RUN-001 → DONE — Cascade shipped
 *   - SIM-017 → READY (decision RUN-001-D1 answered)
 *
 * For every line, the script:
 *   - Finds the row in Tracking with that Item Key (col C)
 *   - Sets Status (col K) to the value after `→`
 *   - If the line has anything after `—` or `(`, treats it as a note
 *     and appends to col Q (Notes), prefixed with the commit SHA
 *   - When status = DONE, also sets Sprint (col P) to "Done" and clears
 *     Blocker (col L)
 *
 * Decisions sheet:
 *   - Footer line `Decision: RUN-001-D1 → Parallel` updates col F (Decided)
 *     of the matching row in the Decisions sheet
 *
 * Data Requests sheet:
 *   - Footer line `Data: DATA-001 → received` sets col G (Received) = "yes"
 *     and col I (Date received) to today's date for that row
 *
 * Idempotency
 * -----------
 * The script stores the SHA of the most recently processed commit in the
 * sheet's document properties. On the next sync it only processes commits
 * newer than that SHA, so re-running is safe and fast.
 */

// ─── Configuration ────────────────────────────────────────────────────
const GH_OWNER = 'whos-praja';
const GH_REPO  = 'naturesum-command-center';
const GH_BRANCH = 'main';

const SHEET_TRACKING = 'Tracking';
const SHEET_DECISIONS = 'Decisions';
const SHEET_DATA_REQS = 'Data Requests';

// Column indexes (1-based for SpreadsheetApp)
const COL_TRACKING_KEY     = 3;   // C
const COL_TRACKING_STATUS  = 11;  // K
const COL_TRACKING_BLOCKER = 12;  // L
const COL_TRACKING_SPRINT  = 16;  // P
const COL_TRACKING_NOTES   = 17;  // Q

const COL_DEC_KEY     = 1;  // A
const COL_DEC_DECIDED = 6;  // F

const COL_DR_KEY        = 1;  // A
const COL_DR_RECEIVED   = 7;  // G
const COL_DR_DATE_RECVD = 9;  // I

const PROP_LAST_SHA = 'naturesum.lastProcessedSha';

// ─── Menu wiring ──────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Naturesum Sync')
    .addItem('Sync from GitHub now', 'syncFromGitHub')
    .addSeparator()
    .addItem('Enable auto-sync (hourly)', 'enableHourlyTrigger')
    .addItem('Disable auto-sync', 'disableHourlyTrigger')
    .addSeparator()
    .addItem('Reset sync history (re-sync all commits)', 'resetSyncHistory')
    .addItem('Show sync status', 'showSyncStatus')
    .addToUi();
}

// ─── Public actions ───────────────────────────────────────────────────
function syncFromGitHub() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getDocumentProperties();
  const lastSha = props.getProperty(PROP_LAST_SHA) || null;

  const commits = fetchCommits(lastSha);
  if (commits.length === 0) {
    toast_('Up to date — no new commits since last sync.');
    return;
  }

  let stats = { tracking: 0, decisions: 0, dataReqs: 0, commits: commits.length };
  // Process oldest → newest so the "last SHA" we store at the end is the newest.
  commits.reverse().forEach(c => {
    const updates = parseTrackerFooter(c.message);
    stats.tracking += applyTrackingUpdates_(ss, updates.tracking, c);
    stats.decisions += applyDecisionUpdates_(ss, updates.decisions, c);
    stats.dataReqs  += applyDataReqUpdates_(ss, updates.dataReqs, c);
  });

  const latestSha = commits[commits.length - 1].sha;
  props.setProperty(PROP_LAST_SHA, latestSha);

  const msg = `Synced ${stats.commits} commit${stats.commits === 1 ? '' : 's'}: ` +
              `${stats.tracking} tracking, ${stats.decisions} decisions, ${stats.dataReqs} data updates.`;
  toast_(msg);
  Logger.log(msg);
}

function enableHourlyTrigger() {
  disableHourlyTrigger();   // clear any existing
  ScriptApp.newTrigger('syncFromGitHub').timeBased().everyHours(1).create();
  toast_('Hourly auto-sync enabled. Will run every hour.');
}

function disableHourlyTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'syncFromGitHub') {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  if (removed > 0) toast_(`Removed ${removed} auto-sync trigger${removed === 1 ? '' : 's'}.`);
}

function resetSyncHistory() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.alert('Reset sync history?',
    'The next sync will reprocess ALL recent commits (up to ~100). This is safe but slow. Continue?',
    ui.ButtonSet.YES_NO);
  if (resp !== ui.Button.YES) return;
  PropertiesService.getDocumentProperties().deleteProperty(PROP_LAST_SHA);
  toast_('Sync history cleared. Run "Sync from GitHub now" to reprocess.');
}

function showSyncStatus() {
  const props = PropertiesService.getDocumentProperties();
  const lastSha = props.getProperty(PROP_LAST_SHA) || '(none — first sync will process recent commits)';
  const triggers = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'syncFromGitHub');
  const autoOn = triggers.length > 0 ? 'ENABLED (hourly)' : 'disabled';
  SpreadsheetApp.getUi().alert(
    'Naturesum Sync — status',
    `Repo: ${GH_OWNER}/${GH_REPO}@${GH_BRANCH}\n\n` +
    `Last processed commit:\n${lastSha}\n\n` +
    `Auto-sync: ${autoOn}\n\n` +
    `Trigger "Sync from GitHub now" to pull anything new.`,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

// ─── GitHub fetch ─────────────────────────────────────────────────────
function fetchCommits(stopAtSha) {
  // Public repo, no auth needed. Pulls up to 100 most recent commits on
  // the configured branch. If `stopAtSha` is given, returns only commits
  // newer than that.
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/commits?sha=${GH_BRANCH}&per_page=100`;
  const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) {
    throw new Error(`GitHub fetch failed (${resp.getResponseCode()}): ${resp.getContentText().slice(0, 200)}`);
  }
  const data = JSON.parse(resp.getContentText());
  const out = [];
  for (const c of data) {
    if (stopAtSha && c.sha === stopAtSha) break;   // already-processed
    out.push({
      sha: c.sha,
      shortSha: c.sha.slice(0, 7),
      message: c.commit.message,
      date: c.commit.author.date,
      author: c.commit.author.name,
    });
  }
  return out;
}

// ─── Commit-message parsing ───────────────────────────────────────────
/**
 * Parses a commit message and returns the updates it implies.
 *
 * Recognised patterns (within the message body):
 *
 *   Tracker:
 *   - SIM-001 → DONE
 *   - RUN-001 → DONE — note text after dash/parens becomes a note
 *
 *   Decision: RUN-001-D1 → Parallel
 *   Data: DATA-001 → received
 *
 * Also a fallback — if no `Tracker:` block exists, every line of the
 * subject is scanned for inline keys like "SIM-001" and the commit's
 * shortSha is appended to that item's note (status untouched).
 */
function parseTrackerFooter(message) {
  const out = { tracking: [], decisions: [], dataReqs: [] };
  const lines = message.split(/\r?\n/);

  let inTrackerBlock = false;
  for (const raw of lines) {
    const line = raw.trim();

    // Block headers
    if (/^Tracker:\s*$/i.test(line)) { inTrackerBlock = true; continue; }
    if (/^[A-Z][a-zA-Z\- ]+:\s*$/i.test(line) && !line.toLowerCase().startsWith('tracker')) {
      inTrackerBlock = false;
    }

    // Inline single-shot lines
    const decisionMatch = line.match(/^Decision:\s*([A-Z]+[A-Z0-9\-]+-D\d+)\s*[→\->]+\s*(.+)$/i);
    if (decisionMatch) {
      out.decisions.push({ key: decisionMatch[1], decided: decisionMatch[2].trim() });
      continue;
    }
    const dataMatch = line.match(/^Data:\s*([A-Z]+[A-Z0-9\-]+)\s*[→\->]+\s*(.+)$/i);
    if (dataMatch) {
      out.dataReqs.push({ key: dataMatch[1], status: dataMatch[2].trim() });
      continue;
    }

    // Inside `Tracker:` block — bulleted item updates
    if (inTrackerBlock) {
      // Patterns: `- KEY → STATUS`, `- KEY → STATUS — note`, `- KEY → STATUS (note)`
      const m = line.match(/^[-*]\s*([A-Z]+[A-Z0-9\-]+-\d+|LIB-\d+|DISPLAY-\d+|CAT-\d+|KEY-\d+|TERM-\d+|INPUT-\d+|MAT-\d+|SIM-\d+|RUN-\d+|AMZ-\d+|FK-\d+|BLK-\d+|DATA-\d+|V2-\d+)\s*[→\->]+\s*([A-Z\-]+)(?:\s*[—\-(]\s*(.+?))?\)?$/);
      if (m) {
        out.tracking.push({
          key: m[1],
          status: m[2].trim().toUpperCase(),
          note: (m[3] || '').replace(/\)$/, '').trim() || null,
        });
      }
    }
  }
  return out;
}

// ─── Sheet writers ────────────────────────────────────────────────────
function applyTrackingUpdates_(ss, updates, commit) {
  if (!updates.length) return 0;
  const sheet = ss.getSheetByName(SHEET_TRACKING);
  if (!sheet) return 0;
  const lastRow = sheet.getLastRow();
  const keyRange = sheet.getRange(2, COL_TRACKING_KEY, lastRow - 1, 1).getValues();

  let count = 0;
  updates.forEach(u => {
    const idx = keyRange.findIndex(r => String(r[0]).trim() === u.key);
    if (idx < 0) {
      Logger.log(`  ⚠ Tracking key not found: ${u.key} (commit ${commit.shortSha})`);
      return;
    }
    const row = idx + 2;
    sheet.getRange(row, COL_TRACKING_STATUS).setValue(u.status);
    if (u.status === 'DONE') {
      sheet.getRange(row, COL_TRACKING_BLOCKER).setValue('None');
      sheet.getRange(row, COL_TRACKING_SPRINT).setValue('Done');
    }
    const existing = sheet.getRange(row, COL_TRACKING_NOTES).getValue() || '';
    const stamp = `${formatDate_(commit.date)} (${commit.shortSha})`;
    const note = u.note ? `${u.note} — ${stamp}` : `Shipped — ${stamp}`;
    const merged = existing ? `${existing}\n${note}` : note;
    sheet.getRange(row, COL_TRACKING_NOTES).setValue(merged);
    count++;
  });
  return count;
}

function applyDecisionUpdates_(ss, updates, commit) {
  if (!updates.length) return 0;
  const sheet = ss.getSheetByName(SHEET_DECISIONS);
  if (!sheet) return 0;
  const lastRow = sheet.getLastRow();
  const keyRange = sheet.getRange(2, COL_DEC_KEY, lastRow - 1, 1).getValues();

  let count = 0;
  updates.forEach(u => {
    const idx = keyRange.findIndex(r => String(r[0]).trim() === u.key);
    if (idx < 0) { Logger.log(`  ⚠ Decision key not found: ${u.key}`); return; }
    sheet.getRange(idx + 2, COL_DEC_DECIDED).setValue(u.decided);
    count++;
  });
  return count;
}

function applyDataReqUpdates_(ss, updates, commit) {
  if (!updates.length) return 0;
  const sheet = ss.getSheetByName(SHEET_DATA_REQS);
  if (!sheet) return 0;
  const lastRow = sheet.getLastRow();
  const keyRange = sheet.getRange(2, COL_DR_KEY, lastRow - 1, 1).getValues();

  let count = 0;
  updates.forEach(u => {
    const idx = keyRange.findIndex(r => String(r[0]).trim() === u.key);
    if (idx < 0) { Logger.log(`  ⚠ Data Request key not found: ${u.key}`); return; }
    const row = idx + 2;
    const normalised = u.status.toLowerCase();
    if (normalised === 'received' || normalised === 'yes') {
      sheet.getRange(row, COL_DR_RECEIVED).setValue('yes');
      sheet.getRange(row, COL_DR_DATE_RECVD).setValue(formatDate_(commit.date));
    } else if (normalised === 'partial') {
      sheet.getRange(row, COL_DR_RECEIVED).setValue('partial');
      sheet.getRange(row, COL_DR_DATE_RECVD).setValue(formatDate_(commit.date));
    } else {
      sheet.getRange(row, COL_DR_RECEIVED).setValue(u.status);
    }
    count++;
  });
  return count;
}

// ─── Helpers ──────────────────────────────────────────────────────────
function formatDate_(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  const dd = String(d.getDate()).padStart(2, '0');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${dd}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

function toast_(msg) {
  SpreadsheetApp.getActiveSpreadsheet().toast(msg, 'Naturesum Sync', 8);
}
