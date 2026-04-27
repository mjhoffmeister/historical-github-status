import { parseMonth, rolling, MINUTES_PER_MONTH, minutesToUptimePct } from '../data.js';

const d3 = window.d3;

const MARGIN = { top: 16, right: 24, bottom: 36, left: 64 };
const ANN_STRIP_H = 22; // slim ticks-only strip below the x-axis

/**
 * opts: {
 *   metric: 'minutes' | 'uptime',
 *   showRolling: bool,
 *   enabledKinds: Set<string>,   // which annotation kinds to draw ticks for
 *   annotations: [{date, kind, title, url?}],
 *   series: [{ym, date, minutes, partial}],
 *   onFocusMonth?: (i) => void   // optional callback for keyboard nav
 * }
 */
export function renderAverage(container, opts) {
  const root = typeof container === 'string' ? document.querySelector(container) : container;
  root.innerHTML = '';

  const width = root.clientWidth || 900;
  const annOn = opts.enabledKinds && opts.enabledKinds.size > 0;
  const stripH = annOn ? ANN_STRIP_H : 0;
  const height = 420 + stripH;
  const innerW = width - MARGIN.left - MARGIN.right;
  const innerH = 420 - MARGIN.top - MARGIN.bottom;

  const svg = d3.select(root).append('svg')
    .attr('width', width).attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`);

  const g = svg.append('g').attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);

  const valid = opts.series.filter((p) => p.minutes != null);
  if (valid.length === 0) {
    g.append('text').attr('x', innerW / 2).attr('y', innerH / 2)
      .attr('text-anchor', 'middle').attr('class', 'axis-empty').text('No data.');
    return { focusIndex: () => {} };
  }

  const x = d3.scaleTime()
    .domain(d3.extent(opts.series, (p) => p.date))
    .range([0, innerW]);

  const isUptime = opts.metric === 'uptime';
  const valueOf = isUptime
    ? (p) => (p.minutes == null ? null : minutesToUptimePct(p.minutes) * 100)
    : (p) => p.minutes;

  // For y-domain, exclude partial-month values so a partial spike doesn't
  // rescale the whole chart. Fall back to ALL values (including partial) if
  // the scope/metric combo somehow has no complete months — better to draw
  // an honest chart than a broken one with NaN domains.
  let stableValues = opts.series
    .filter((p) => p.minutes != null && !p.partial)
    .map(valueOf);
  if (stableValues.length === 0) {
    stableValues = opts.series.filter((p) => p.minutes != null).map(valueOf);
  }
  let yDomain;
  if (isUptime) {
    const minV = stableValues.length ? Math.min(...stableValues) : 100;
    const floor = Math.max(99, Math.floor(minV * 10) / 10 - 0.05);
    yDomain = [floor, 100];
  } else {
    if (stableValues.length === 0) {
      yDomain = [0, 1];
    } else if (opts.showOutliers) {
      const maxV = Math.max(...stableValues);
      yDomain = [0, Math.max(1, Math.ceil(maxV * 1.1))];
    } else {
      // Cap at p95 * 1.5 so a single outlier month doesn't crush the rest of
      // the historical signal. Outlier months get ▲ markers + true value in
      // the tooltip; a checkbox restores full-range view.
      const p95 = quantile(stableValues, 0.95);
      const maxV = Math.max(...stableValues);
      const cap = Math.max(1, Math.ceil(Math.max(p95 * 1.5, 5)));
      yDomain = [0, Math.min(cap, Math.ceil(maxV * 1.1))];
    }
  }
  const y = d3.scaleLinear().domain(yDomain).nice().range([innerH, 0]);

  // Gridlines.
  g.append('g').attr('class', 'grid')
    .selectAll('line').data(y.ticks(6)).enter().append('line')
    .attr('class', 'gridline')
    .attr('x1', 0).attr('x2', innerW)
    .attr('y1', (d) => y(d)).attr('y2', (d) => y(d));

  // Axes.
  g.append('g').attr('class', 'axis x-axis')
    .attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(x).ticks(8).tickFormat(d3.timeFormat('%b %Y')));

  const yFmt = isUptime ? ((d) => d.toFixed(2) + '%') : ((d) => d + ' min');
  g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(6).tickFormat(yFmt));

  g.append('text')
    .attr('transform', `rotate(-90)`)
    .attr('x', -innerH / 2).attr('y', -48)
    .attr('text-anchor', 'middle').attr('class', 'axis-label')
    .text(isUptime ? 'Monthly uptime % (zoomed — see inset)' : 'Downtime minutes / month');

  // ±1σ band + rolling mean. Excludes partial months by virtue of rolling().
  if (opts.showRolling) {
    const roll = rolling(opts.series, 12, 6);
    const bandData = opts.series.map((p, i) => {
      const r = roll[i];
      if (r.mean == null) return { date: p.date, lo: null, hi: null, mean: null };
      if (isUptime) {
        return {
          date: p.date,
          mean: (1 - r.mean / MINUTES_PER_MONTH) * 100,
          lo:   (1 - (r.mean + r.sd) / MINUTES_PER_MONTH) * 100,
          hi:   (1 - Math.max(0, r.mean - r.sd) / MINUTES_PER_MONTH) * 100,
        };
      }
      return { date: p.date, mean: r.mean, lo: Math.max(0, r.mean - r.sd), hi: r.mean + r.sd };
    });
    const bandPts = bandData.filter((d) => d.lo != null);
    if (bandPts.length) {
      const area = d3.area()
        .x((d) => x(d.date)).y0((d) => y(d.lo)).y1((d) => y(d.hi));
      g.append('path').datum(bandPts).attr('class', 'band').attr('d', area);

      const meanLine = d3.line()
        .defined((d) => d.mean != null)
        .x((d) => x(d.date)).y((d) => y(d.mean));
      g.append('path').datum(bandPts).attr('class', 'mean-line').attr('d', meanLine);
    }
  }

  // Raw series line — connects only complete (non-partial) months.
  const line = d3.line()
    .defined((p) => valueOf(p) != null && !p.partial)
    .x((p) => x(p.date)).y((p) => y(valueOf(p)));
  g.append('path').datum(opts.series).attr('class', 'series-line').attr('d', line);

  // Dots: complete months solid, partial months hollow + clamped to y-domain.
  const dots = g.selectAll('.series-dot').data(valid).enter().append('circle')
    .attr('class', (p) => p.partial ? 'series-dot partial' : 'series-dot')
    .attr('cx', (p) => x(p.date))
    .attr('cy', (p) => {
      const v = valueOf(p);
      // clamp partial-month values to the visible y-domain so an in-progress
      // outlier shows as a hollow marker at the chart edge instead of
      // disappearing.
      const [y0, y1] = y.domain();
      const clamped = Math.max(y0, Math.min(y1, v));
      return y(clamped);
    })
    .attr('r', (p) => p.partial ? 4 : 2.5);

  // Outlier markers: any non-partial month whose value exceeds the y-domain
  // gets a ▲ at the top of its column with the true value in the tooltip.
  // Drawn ABOVE the plot area (negative y inside g) so they sit in the top
  // margin and aren't covered by the .plot-overlay rect (which spans y=0..innerH
  // and would otherwise block native <title> hover).
  if (!isUptime) {
    const yMax = y.domain()[1];
    const outliers = valid.filter((p) => !p.partial && valueOf(p) > yMax);
    g.selectAll('.outlier-mark').data(outliers).enter().append('path')
      .attr('class', 'outlier-mark')
      .attr('d', 'M -5 -1 L 5 -1 L 0 -10 Z')
      .attr('transform', (p) => `translate(${x(p.date)},0)`)
      .append('title')
      .text((p) => `${p.ym}: ${valueOf(p).toFixed(1)} min — clipped (toggle "Show outliers" to view at full scale)`);
  }

  // Annotation timeline strip below the x-axis.
  if (annOn) drawAnnotationStrip(svg, x, opts.annotations, opts.enabledKinds, MARGIN.left, MARGIN.top + innerH + 22, innerW, stripH, root);

  // Inset 0–100% sparkline rendered OUTSIDE the chart SVG so it can never
  // occlude data. Lives in a sibling host element above the plot.
  renderUptimeInset(opts.series, isUptime, isUptime ? yDomain : null);

  // Crosshair + focus ring + tooltip overlay.
  const interaction = attachInteraction(svg, g, x, y, opts.series, valueOf, isUptime, opts.annotations, innerW, innerH);

  return { focusIndex: interaction.focusIndex };
}

// ---------- Annotation strip ----------

function drawAnnotationStrip(svg, x, annotations, enabledKinds, ox, oy, w, h, root) {
  const strip = svg.append('g').attr('class', 'ann-strip').attr('transform', `translate(${ox},${oy})`);
  strip.append('rect').attr('class', 'ann-strip-bg').attr('width', w).attr('height', h).attr('rx', 3);

  const items = (annotations || [])
    .filter((a) => enabledKinds.has(a.kind))
    .map((a) => ({ ...a, x: x(parseMonth(a.date)) }))
    .filter((a) => a.x >= 0 && a.x <= w)
    .sort((a, b) => a.x - b.x);

  // Color-coded ticks. No inline labels — they collide too easily and are
  // truncated mid-word at any reasonable density. Hover or focus a tick to
  // see the full label + date + URL in the tooltip.
  strip.selectAll('line.ann-tick').data(items).enter().append('line')
    .attr('class', (a) => `ann-tick ${a.kind}`)
    .attr('x1', (a) => a.x).attr('x2', (a) => a.x)
    .attr('y1', 2).attr('y2', h - 2);

  // Wider invisible hit-areas for easier hover/focus on the thin ticks.
  strip.selectAll('rect.ann-tick-hit').data(items).enter().append('rect')
    .attr('class', 'ann-tick-hit')
    .attr('x', (a) => a.x - 5).attr('y', 0)
    .attr('width', 10).attr('height', h)
    .attr('tabindex', 0)
    .attr('role', 'button')
    .attr('aria-label', (a) => `${a.kind}: ${a.title} (${a.date})`)
    .on('mouseenter', (event, a) => showAnnTip(event, a, root))
    .on('mouseleave', () => hideTip())
    .on('focus', (event, a) => showAnnTip(event, a, root))
    .on('blur', () => hideTip());
}

function quantile(values, q) {
  const sorted = values.slice().sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// ---------- Inset (rendered into a sibling HTML host, NOT into the chart SVG) ----------

// A clear "Y-axis zoom" indicator: a horizontal 0%..100% scale bar with the
// slice that the main chart's zoomed y-axis actually covers highlighted in
// accent. The label spells out the slice in plain numbers so the reader
// doesn't have to decode anything.
function renderUptimeInset(series, isUptime, zoomDomain) {
  const host = document.getElementById('uptime-inset-host');
  if (!host) return;
  host.innerHTML = '';
  if (!isUptime) { host.hidden = true; host.setAttribute('aria-hidden', 'true'); return; }
  host.hidden = false;
  host.setAttribute('aria-hidden', 'false');

  const [zMin, zMax] = zoomDomain; // e.g. [99.00, 100.00]
  const slicePct = zMax - zMin;

  const w = 240, h = 64;
  const svg = d3.select(host).append('svg')
    .attr('viewBox', `0 0 ${w} ${h}`)
    .attr('role', 'img')
    .attr('aria-label',
      `Y-axis is zoomed: the chart shows uptime between ${zMin.toFixed(2)} percent and ${zMax.toFixed(2)} percent, ` +
      `which is only the top ${slicePct.toFixed(2)} percent of the full 0 to 100 percent scale.`);

  // Title.
  svg.append('text').attr('class', 'inset-title')
    .attr('x', 0).attr('y', 11).text('Y-axis is zoomed');

  // Scale bar.
  const barY = 22, barH = 10;
  const xs = d3.scaleLinear().domain([0, 100]).range([0, w]);
  svg.append('rect').attr('class', 'scale-bar-bg')
    .attr('x', 0).attr('y', barY).attr('width', w).attr('height', barH).attr('rx', 2);

  // Highlighted slice = the y-domain the main chart is actually showing.
  // Clamp width to >=3px so a tiny slice (e.g. 1% of full scale) stays visible.
  const sliceX0 = xs(zMin);
  const sliceX1 = xs(zMax);
  const rawW = sliceX1 - sliceX0;
  const sliceW = Math.max(3, rawW);
  const sliceX = Math.min(sliceX0, w - sliceW);
  svg.append('rect').attr('class', 'scale-bar-slice')
    .attr('x', sliceX).attr('y', barY - 2).attr('width', sliceW).attr('height', barH + 4);

  // Pointer (▲) directly below the slice center.
  const pX = sliceX + sliceW / 2;
  const pY = barY + barH + 6;
  svg.append('path').attr('class', 'scale-pointer')
    .attr('d', `M ${pX - 3.5} ${pY} L ${pX + 3.5} ${pY} L ${pX} ${pY - 4} Z`);

  // Tick labels for the bar endpoints.
  svg.append('text').attr('class', 'inset-tick').attr('x', 0).attr('y', h - 14).text('0%');
  svg.append('text').attr('class', 'inset-tick').attr('x', w).attr('y', h - 14).attr('text-anchor', 'end').text('100%');

  // Plain-language explanation of the slice.
  svg.append('text').attr('class', 'inset-explain')
    .attr('x', w).attr('y', h - 1).attr('text-anchor', 'end')
    .text(`chart shows ${zMin.toFixed(2)}–${zMax.toFixed(2)}% (top ${slicePct.toFixed(2)}%)`);
}

// ---------- Interaction ----------

function attachInteraction(svg, g, x, y, series, valueOf, isUptime, annotations, innerW, innerH) {
  const root = svg.node().parentElement;

  const crossX = g.append('line').attr('class', 'crosshair')
    .attr('y1', 0).attr('y2', innerH);
  const ring = g.append('circle').attr('class', 'focus-ring').attr('r', 6);

  g.append('rect').attr('class', 'plot-overlay')
    .attr('width', innerW).attr('height', innerH)
    .on('mousemove', onMove).on('mouseleave', onLeave);

  const bisect = d3.bisector((p) => p.date).left;

  function indexAt(mouseX) {
    const date = x.invert(mouseX);
    const i = bisect(series, date);
    // pick nearest of i-1 / i
    const a = series[i - 1], b = series[i];
    if (!a) return i;
    if (!b) return i - 1;
    return (date - a.date) < (b.date - date) ? i - 1 : i;
  }

  function showAt(i) {
    const p = series[i];
    if (!p || p.minutes == null) { hideAll(); return; }
    const px = x(p.date);
    const v = valueOf(p);
    const [y0, y1] = y.domain();
    const py = y(Math.max(y0, Math.min(y1, v)));
    crossX.attr('x1', px).attr('x2', px).style('opacity', 0.7);
    ring.attr('cx', px).attr('cy', py).style('opacity', 1);
    const pct = ((1 - p.minutes / MINUTES_PER_MONTH) * 100).toFixed(3);
    const ann = (annotations || []).filter((a) => a.date === p.ym);
    const partialNote = p.partial
      ? `<div class="partial-tag">⚠ Partial month — value not yet final and is excluded from rolling stats.</div>`
      : '';
    const html =
      `<div class="ttl">${p.ym}</div>` +
      `Downtime: <b>${p.minutes.toFixed(1)} min</b>&nbsp; Uptime: <b>${pct}%</b>` +
      partialNote +
      (ann.length ? '<hr class="tip-sep">' +
        ann.map((a) => a.url ? `<a href="${a.url}" target="_blank" rel="noopener">${a.title}</a>` : a.title).join('<br>') : '');
    showTip(html, root, MARGIN.left + px, MARGIN.top + py);
  }

  function onMove(event) {
    const [mx] = d3.pointer(event);
    showAt(indexAt(mx));
  }
  function onLeave() { hideAll(); }
  function hideAll() {
    crossX.style('opacity', 0);
    ring.style('opacity', 0);
    hideTip();
  }

  // Keyboard: when the chart container is focused, ←/→ step focus by month.
  // Remove any previous handler before attaching a new one — renderAverage
  // is called repeatedly on toggle/resize and would otherwise leak listeners
  // (and fire showAt on stale series references).
  let focusedIdx = series.length - 1;
  if (root._kbHandler) root.removeEventListener('keydown', root._kbHandler);
  const handler = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const dir = e.key === 'ArrowLeft' ? -1 : 1;
    let next = focusedIdx + dir;
    while (next >= 0 && next < series.length && series[next].minutes == null) next += dir;
    if (next < 0 || next >= series.length) return;
    focusedIdx = next;
    showAt(focusedIdx);
  };
  root._kbHandler = handler;
  root.addEventListener('keydown', handler);

  return { focusIndex: (i) => { focusedIdx = i; showAt(i); } };
}

// ---------- Tooltip helpers (singleton DOM node) ----------

function getTip() {
  let tip = document.querySelector('.tooltip');
  if (!tip) { tip = document.createElement('div'); tip.className = 'tooltip'; document.body.appendChild(tip); }
  return tip;
}

function showTip(html, root, localX, localY) {
  const tip = getTip();
  tip.innerHTML = html;
  const rect = root.getBoundingClientRect();
  tip.style.left = (rect.left + window.scrollX + localX + 12) + 'px';
  tip.style.top  = (rect.top  + window.scrollY + localY - 8) + 'px';
  tip.style.opacity = 1;
}

function showAnnTip(event, a, root) {
  const html = `<div class="ttl">${a.title}</div>` +
    `<div style="opacity:0.8">${a.date} · ${a.kind}</div>` +
    (a.url ? `<div><a href="${a.url}" target="_blank" rel="noopener">postmortem ↗</a></div>` : '');
  const rect = root.getBoundingClientRect();
  const tip = getTip();
  tip.innerHTML = html;
  // Position near the cursor / focused element
  const x = event.clientX != null ? event.clientX : (event.target.getBoundingClientRect().left);
  const yT = event.clientY != null ? event.clientY : (event.target.getBoundingClientRect().top);
  tip.style.left = (x + window.scrollX + 10) + 'px';
  tip.style.top  = (yT + window.scrollY + 10) + 'px';
  tip.style.opacity = 1;
}

function hideTip() {
  const tip = document.querySelector('.tooltip');
  if (tip) tip.style.opacity = 0;
}
