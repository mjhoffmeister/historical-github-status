#!/usr/bin/env node
/*
 * Refreshes the trailing months of data/uptime.json from the live GitHub
 * status page.
 *
 * Strategy:
 *   1. Hit https://www.githubstatus.com/api/v2/incidents.json (last ~50
 *      incidents). This is officially supported and CORS-friendly.
 *   2. Map each incident to (year-month, affected component ids) and sum
 *      duration in minutes.
 *   3. Merge over the existing snapshot for the months covered. Months we
 *      don't have live data for are left untouched.
 *
 * Limitations (documented honestly in the UI):
 *   - The status API only exposes ~50 most recent incidents. For deep
 *     history we rely on the committed snapshot.
 *   - Component name → snapshot id mapping is best-effort.
 *
 * Usage: node scripts/fetch-data.js
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SNAPSHOT = path.join(DATA_DIR, 'uptime.snapshot.json');
const OUT      = path.join(DATA_DIR, 'uptime.json');

const NAME_MAP = {
  'git operations': 'git',
  'api requests': 'api',
  'issues': 'issues',
  'pull requests': 'prs',
  'webhooks': 'webhooks',
  'github pages': 'pages',
  'pages': 'pages',
  'notifications': 'notifications',
  'actions': 'actions',
  'github actions': 'actions',
  'packages': 'packages',
  'github packages': 'packages',
  'codespaces': 'codespaces',
  'github codespaces': 'codespaces',
  'copilot': 'copilot',
  'github copilot': 'copilot',
};

async function main() {
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));

  const now = new Date();
  const currentYM = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

  if (!snapshot.months.includes(currentYM)) {
    console.warn(
      `Snapshot is stale: it ends at ${snapshot.months[snapshot.months.length - 1]} ` +
      `but the current month is ${currentYM}. Run 'node scripts/build-snapshot.js' first ` +
      `so the partial-month flag can be applied.`
    );
  }

  let incidents;
  try {
    const res = await fetch('https://www.githubstatus.com/api/v2/incidents.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    incidents = body.incidents || [];
  } catch (err) {
    console.warn(`Fetch failed (${err.message}); writing snapshot unchanged.`);
    fs.writeFileSync(OUT, JSON.stringify({ ...snapshot, source: 'snapshot' }, null, 2));
    return;
  }

  // Aggregate live downtime per (component, month).
  const live = {}; // { cid: { 'YYYY-MM': minutes } }
  const touchedMonths = new Set();
  for (const inc of incidents) {
    if (!inc.resolved_at || !inc.created_at) continue;
    const start = new Date(inc.created_at);
    const end   = new Date(inc.resolved_at);
    const minutes = Math.max(0, (end - start) / 60000);
    const ym = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
    touchedMonths.add(ym);
    // De-duplicate: a single incident may list the same logical component
    // under multiple names ("Actions" + "GitHub Actions") that both map to
    // the same internal id. We must only count its duration once.
    const affected = [...new Set(
      (inc.components || []).map((c) => NAME_MAP[(c.name || '').toLowerCase()]).filter(Boolean)
    )];
    for (const cid of affected) {
      live[cid] = live[cid] || {};
      live[cid][ym] = (live[cid][ym] || 0) + minutes;
    }
  }

  // Merge: for each touched (component, month), replace snapshot with live.
  // EXCEPTION: never overwrite the current (in-progress) month, because a
  // partial-month sum visually drowns the rest of the chart and is not a
  // like-for-like comparison. Mark it as partial so the UI can render it
  // distinctly and exclude it from rolling stats.
  const months = snapshot.months;
  const merged = JSON.parse(JSON.stringify(snapshot.downtime));
  const partial = {}; // { cid: { idx: true } }
  let replaced = 0;
  for (const cid of Object.keys(live)) {
    if (!merged[cid]) continue;
    for (const ym of Object.keys(live[cid])) {
      const idx = months.indexOf(ym);
      if (idx < 0) continue;
      if (merged[cid][idx] == null) continue; // pre-launch
      if (ym === currentYM) {
        const idxOk = idx >= 0;
        if (idxOk) {
          partial[cid] = partial[cid] || {};
          partial[cid][idx] = true;
        }
        continue;
      }
      merged[cid][idx] = Math.round(live[cid][ym] * 10) / 10;
      replaced++;
    }
  }
  // Mark current month as partial for ALL components, regardless of whether
  // any live incidents touched them, so the chart treats it consistently.
  const curIdx = months.indexOf(currentYM);
  if (curIdx >= 0) {
    for (const cid of Object.keys(merged)) {
      if (merged[cid][curIdx] == null) continue;
      partial[cid] = partial[cid] || {};
      partial[cid][curIdx] = true;
    }
  }

  const out = {
    ...snapshot,
    generated_at: new Date().toISOString(),
    source: 'live+snapshot',
    live_window_months: [...touchedMonths].sort(),
    current_month: currentYM,
    downtime: merged,
    partial,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`Refreshed ${replaced} (component, month) cells across ${touchedMonths.size} months. Current month ${currentYM} marked partial.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
