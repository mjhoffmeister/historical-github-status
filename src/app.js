import {
  loadData, avgSeries, componentCountSeries,
  stableCoreIds, allIds, MINUTES_PER_MONTH,
} from './data.js';
import { renderAverage } from './charts/average.js';
import { renderScope } from './charts/scope.js';
import { renderBreakdown } from './charts/breakdown.js';

const ANN_KINDS = ['incident', 'launch', 'corporate'];

const state = {
  data: null,
  metric: 'minutes',
  scope: 'core',
  showRolling: true,
  showOutliers: false,
  enabledKinds: new Set(),  // start with all annotation kinds off
  tab: 'average',
};

async function init() {
  state.data = await loadData();
  setMeta();
  populateAnnCounts();
  bindControls();
  bindTabs();
  bindTheme();
  syncLegendVisibility();
  draw();
}

function bindTheme() {
  const buttons = [...document.querySelectorAll('.theme-seg button[data-theme-choice]')];
  if (!buttons.length || !window.__theme) return;

  function syncChecked() {
    const current = window.__theme.get();
    buttons.forEach((b) => {
      const on = b.dataset.themeChoice === current;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      // Roving tabindex: only the active radio is in the tab sequence.
      b.setAttribute('tabindex', on ? '0' : '-1');
    });
  }

  buttons.forEach((b, i) => {
    b.addEventListener('click', () => {
      window.__theme.set(b.dataset.themeChoice);
      syncChecked();
    });
    b.addEventListener('keydown', (e) => {
      let next = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = buttons[(i + 1) % buttons.length];
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = buttons[(i - 1 + buttons.length) % buttons.length];
      else if (e.key === 'Home') next = buttons[0];
      else if (e.key === 'End') next = buttons[buttons.length - 1];
      if (next) { e.preventDefault(); next.focus(); next.click(); }
    });
  });

  syncChecked();

  // Charts are CSS-driven, but re-draw defensively on theme change so any
  // future inline color usage picks up the new palette.
  window.addEventListener('themechange', () => draw());
}

function populateAnnCounts() {
  const counts = {};
  for (const a of state.data.annotations || []) {
    counts[a.kind] = (counts[a.kind] || 0) + 1;
  }
  document.querySelectorAll('.chip-count[data-count-for]').forEach((el) => {
    const k = el.dataset.countFor;
    el.textContent = counts[k] ? `(${counts[k]})` : '';
  });
}

function setMeta() {
  const d = state.data;
  const fetched = new Date(d.generated_at).toISOString().slice(0, 10);
  const text = document.getElementById('data-meta-text');
  const badge = document.getElementById('data-meta-badge');
  if (text) {
    text.textContent =
      `Refreshed ${fetched}${d.current_month ? ` · current month (${d.current_month}) shown as partial` : ''}.`;
  }
  if (badge) {
    const kind = (d.source || 'snapshot').includes('live') ? 'live' : 'snapshot';
    badge.textContent = kind === 'live' ? 'Live + snapshot' : 'Snapshot';
    badge.className = `badge ${kind}`;
  }
}

function bindControls() {
  document.querySelectorAll('input[name="metric"]').forEach((el) => {
    el.addEventListener('change', () => { state.metric = el.value; draw(); });
  });
  document.querySelectorAll('input[name="scope"]').forEach((el) => {
    el.addEventListener('change', () => { state.scope = el.value; draw(); });
  });
  document.getElementById('opt-rolling').addEventListener('change', (e) => {
    state.showRolling = e.target.checked; syncLegendVisibility(); draw();
  });
  document.getElementById('opt-outliers').addEventListener('change', (e) => {
    state.showOutliers = e.target.checked; draw();
  });

  // Annotation chips: each one toggles its kind on/off.
  document.querySelectorAll('.chip[data-kind]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.kind;
      if (state.enabledKinds.has(kind)) state.enabledKinds.delete(kind);
      else state.enabledKinds.add(kind);
      btn.setAttribute('aria-pressed', state.enabledKinds.has(kind) ? 'true' : 'false');
      draw();
    });
  });

  window.addEventListener('resize', () => draw());
}

function syncLegendVisibility() {
  document.querySelectorAll('.legend-item.rolling-only').forEach((el) => {
    el.classList.toggle('hidden', !state.showRolling);
  });
  // Always show the partial-month legend item (the current month is always partial).
}

function bindTabs() {
  const tabs = [...document.querySelectorAll('.tab')];
  function activate(btn, { focus = false } = {}) {
    tabs.forEach((b) => {
      const on = b === btn;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    const which = btn.dataset.tab;
    document.getElementById('tab-average').hidden = which !== 'average';
    document.getElementById('tab-breakdown').hidden = which !== 'breakdown';
    state.tab = which;
    if (focus) btn.focus();
    draw();
  }
  tabs.forEach((btn, i) => {
    btn.addEventListener('click', () => activate(btn));
    btn.addEventListener('keydown', (e) => {
      let next = null;
      if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
      else if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
      else if (e.key === 'Home') next = tabs[0];
      else if (e.key === 'End') next = tabs[tabs.length - 1];
      if (next) { e.preventDefault(); activate(next, { focus: true }); }
    });
  });
}

function draw() {
  if (state.tab === 'average') drawAverage();
  else drawBreakdown();
}

function drawAverage() {
  const ids = state.scope === 'core' ? stableCoreIds(state.data) : allIds(state.data);
  const series = avgSeries(state.data, ids);
  renderAverage('#chart-average', {
    metric: state.metric,
    showRolling: state.showRolling,
    showOutliers: state.showOutliers,
    enabledKinds: state.enabledKinds,
    annotations: state.data.annotations,
    series,
  });
  renderScope('#chart-scope', componentCountSeries(state.data));
  updateCaption(ids.length, series);
  renderTable(series);
}

function drawBreakdown() {
  renderBreakdown('#chart-breakdown', state.data);
}

function updateCaption(nComponents, series) {
  const cap = document.getElementById('average-caption');
  const scopeText = state.scope === 'core'
    ? `stable-core component set (${nComponents} components present 2016–today)`
    : `all ${nComponents} components currently on the status page (scope changes over time — see chart below)`;
  const metricText = state.metric === 'minutes'
    ? 'Average monthly downtime (minutes)'
    : 'Average monthly uptime % — note: y-axis is zoomed; see inset for true 0–100% scale';
  const partialNote = series.some((p) => p.partial)
    ? ' Hollow markers are partial (in-progress) months and are excluded from the rolling stats.'
    : '';
  cap.textContent = `${metricText} across the ${scopeText}.${partialNote}`;
}

function renderTable(series) {
  const wrap = document.getElementById('data-table');
  const valid = series.filter((p) => p.minutes != null);
  let html = '<table><thead><tr><th>Month</th><th>Downtime (min)</th><th>Uptime %</th><th>Status</th></tr></thead><tbody>';
  for (const p of valid) {
    const pct = ((1 - p.minutes / MINUTES_PER_MONTH) * 100).toFixed(3);
    html += `<tr><td>${p.ym}</td><td>${p.minutes.toFixed(1)}</td><td>${pct}</td><td>${p.partial ? 'partial' : 'final'}</td></tr>`;
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

init().catch((err) => {
  const stale = /null|undefined/i.test(err.message);
  document.body.innerHTML = `
    <div style="padding:24px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:720px;margin:0 auto">
      <h2 style="color:#cf222e;margin:0 0 8px">Failed to load</h2>
      <pre style="background:#f6f8fa;padding:12px;border:1px solid #d0d7de;border-radius:4px;white-space:pre-wrap">${err.message}\n${err.stack || ''}</pre>
      ${stale ? '<p>This often means the browser cached an older version of <code>index.html</code>. Try a hard refresh (<b>Ctrl+Shift+R</b> on Windows / Linux, <b>Cmd+Shift+R</b> on macOS).</p>' : ''}
      <p>If you are opening the file directly via <code>file://</code>, serve it instead with <code>npx http-server . -p 8080</code> so <code>fetch()</code> can load <code>data/uptime.json</code>.</p>
    </div>`;
});
