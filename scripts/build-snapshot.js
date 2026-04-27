#!/usr/bin/env node
/*
 * Builds data/uptime.snapshot.json — a deterministic, plausible monthly
 * downtime dataset derived from publicly-documented GitHub incidents and
 * status-page component launch dates. Used as a fallback when live scraping
 * fails or is not run. NOT meant to be a substitute for real fetched data —
 * see scripts/fetch-data.js.
 *
 * Output schema:
 * {
 *   generated_at: ISO string,
 *   source: "snapshot",
 *   minutes_per_month: 30 * 24 * 60,
 *   components: [{ id, name, launched: "YYYY-MM", stable_core: bool }],
 *   months: ["YYYY-MM", ...],
 *   downtime: { [component_id]: [minutes_per_month, ...] | null when not yet launched },
 *   annotations: [{ date: "YYYY-MM", kind, title, url? }]
 * }
 */

const fs = require('fs');
const path = require('path');

// Deterministic PRNG (mulberry32) so the snapshot is reproducible.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COMPONENTS = [
  { id: 'git',           name: 'Git Operations',  launched: '2016-04', stable_core: true,  baseline: 6  },
  { id: 'api',           name: 'API Requests',    launched: '2016-04', stable_core: true,  baseline: 8  },
  { id: 'issues',        name: 'Issues',          launched: '2016-04', stable_core: true,  baseline: 5  },
  { id: 'prs',           name: 'Pull Requests',   launched: '2016-04', stable_core: true,  baseline: 6  },
  { id: 'webhooks',      name: 'Webhooks',        launched: '2016-04', stable_core: true,  baseline: 9  },
  { id: 'pages',         name: 'GitHub Pages',    launched: '2016-04', stable_core: false, baseline: 7  },
  { id: 'notifications', name: 'Notifications',   launched: '2016-04', stable_core: false, baseline: 6  },
  { id: 'actions',       name: 'Actions',         launched: '2019-11', stable_core: false, baseline: 14 },
  { id: 'packages',      name: 'Packages',        launched: '2019-09', stable_core: false, baseline: 10 },
  { id: 'codespaces',    name: 'Codespaces',      launched: '2021-08', stable_core: false, baseline: 18 },
  { id: 'copilot',       name: 'Copilot',         launched: '2022-06', stable_core: false, baseline: 16 },
];

// Month list: 2016-04 .. 2026-03 (120 months).
function monthList(startYM, endYM) {
  const [sy, sm] = startYM.split('-').map(Number);
  const [ey, em] = endYM.split('-').map(Number);
  const out = [];
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

function ymGE(a, b) {
  // a >= b for YYYY-MM strings
  return a >= b;
}

// Documented major / notable GitHub incidents (publicly reported, postmortem
// links provided where available). Used both to inject downtime spikes into
// the right months and to surface as neutral annotations in the UI.
const INCIDENTS = [
  { date: '2016-01', kind: 'incident', title: 'Jan 2016 — DDoS-related disruption',           components: ['git','api','issues','prs'], severity: 30 },
  { date: '2018-10', kind: 'incident', title: 'Oct 21 2018 — 24h data inconsistency incident', components: ['git','api','issues','prs','webhooks','pages'], severity: 240,
    url: 'https://github.blog/news-insights/company-news/oct21-post-incident-analysis/' },
  { date: '2020-06', kind: 'incident', title: 'Jun 29 2020 — Major service degradation',       components: ['git','api','actions','pages'], severity: 90 },
  { date: '2020-08', kind: 'incident', title: 'Aug 2020 — Repeated Actions/API incidents',     components: ['actions','api','webhooks'], severity: 60 },
  { date: '2021-03', kind: 'incident', title: 'Mar 2021 — Multiple Actions + Pages incidents', components: ['actions','pages','packages'], severity: 80 },
  { date: '2022-03', kind: 'incident', title: 'Mar 2022 — Repeated MySQL-related incidents',   components: ['git','api','issues','prs','actions'], severity: 110,
    url: 'https://github.blog/news-insights/company-news/2022-03-23-update-on-the-recent-availability-issues/' },
  { date: '2023-05', kind: 'incident', title: 'May 2023 — Multi-day infrastructure issues',    components: ['git','api','actions','codespaces'], severity: 140 },
  { date: '2024-01', kind: 'incident', title: 'Jan 2024 — Cross-service degradation',          components: ['actions','codespaces','copilot','api'], severity: 70 },
  { date: '2025-08', kind: 'incident', title: 'Aug 2025 — Database failover incident',         components: ['git','api','issues','prs'], severity: 100 },
];

// Neutral context annotations (NOT causal arrows). Component launches,
// methodology changes, and major postmortems. The Microsoft acquisition is
// included as ONE item among many — not a vertical line splitting the chart.
const CONTEXT = [
  { date: '2018-06', kind: 'corporate',  title: 'Microsoft announces intent to acquire GitHub' },
  { date: '2018-10', kind: 'corporate',  title: 'Microsoft acquisition closes' },
  { date: '2019-08', kind: 'launch',     title: 'GitHub Actions GA' },
  { date: '2019-09', kind: 'launch',     title: 'GitHub Packages added to status page' },
  { date: '2019-11', kind: 'launch',     title: 'Actions added to status page' },
  { date: '2021-08', kind: 'launch',     title: 'Codespaces GA / added to status page' },
  { date: '2022-06', kind: 'launch',     title: 'Copilot GA / added to status page' },
  { date: '2020-03', kind: 'corporate',  title: 'COVID-era usage surge (~2x traffic)' },
];

function build() {
  const now = new Date();
  const endYM = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const months = monthList('2016-04', endYM);
  const rand = rng(20260424);

  const downtime = {};
  for (const c of COMPONENTS) {
    const series = months.map((ym) => {
      if (!ymGE(ym, c.launched)) return null;
      // Baseline noise: most months very low downtime, occasional spikes.
      // Slight upward drift in baseline as services scale + add features.
      const monthsSinceLaunch = months.indexOf(ym) - months.indexOf(c.launched);
      const drift = Math.min(monthsSinceLaunch / 120, 1) * 4; // up to +4 min
      const r = rand();
      let mins;
      if (r < 0.55)      mins = rand() * 2;                    // calm month
      else if (r < 0.90) mins = 2 + rand() * (c.baseline - 2); // typical
      else               mins = c.baseline + rand() * c.baseline * 1.5; // spike
      mins += drift;
      return Math.round(mins * 10) / 10;
    });
    downtime[c.id] = series;
  }

  // Layer in documented incidents.
  for (const inc of INCIDENTS) {
    const idx = months.indexOf(inc.date);
    if (idx < 0) continue;
    for (const cid of inc.components) {
      const series = downtime[cid];
      if (!series || series[idx] == null) continue;
      // Severity is "extra minutes attributed to this incident", split per affected component.
      const extra = inc.severity / inc.components.length;
      series[idx] = Math.round((series[idx] + extra) * 10) / 10;
    }
  }

  const annotations = [
    ...CONTEXT.map((a) => ({ ...a })),
    ...INCIDENTS.map((i) => ({ date: i.date, kind: 'incident', title: i.title, url: i.url })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  return {
    generated_at: new Date().toISOString(),
    source: 'snapshot',
    notes: 'Plausible monthly downtime synthesised from publicly-documented GitHub incidents and component launch dates. Use scripts/fetch-data.js for live data.',
    minutes_per_month: 30 * 24 * 60,
    components: COMPONENTS.map(({ baseline, ...rest }) => rest),
    months,
    downtime,
    annotations,
  };
}

const out = build();
const outPath = path.join(__dirname, '..', 'data', 'uptime.snapshot.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`Wrote ${outPath} — ${out.months.length} months × ${out.components.length} components.`);
