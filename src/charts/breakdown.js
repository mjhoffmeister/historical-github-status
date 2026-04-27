import { parseMonth } from '../data.js';
const d3 = window.d3;

const W = 280, H = 130;
const M = { top: 8, right: 8, bottom: 22, left: 36 };

export function renderBreakdown(container, data) {
  const root = typeof container === 'string' ? document.querySelector(container) : container;
  root.innerHTML = '';

  // Shared y-domain across all components for fair comparison.
  let maxV = 0;
  for (const c of data.components) {
    for (const v of (data.downtime[c.id] || [])) if (v != null && v > maxV) maxV = v;
  }
  const yDomain = [0, Math.ceil(maxV * 1.1)];
  const xDomain = [parseMonth(data.months[0]), parseMonth(data.months[data.months.length - 1])];

  for (const c of data.components) {
    const cell = document.createElement('div');
    cell.className = 'small-multiple';
    const title = document.createElement('div');
    title.className = 'small-multiple-title';
    title.textContent = c.name;
    cell.appendChild(title);
    root.appendChild(cell);

    const innerW = W - M.left - M.right;
    const innerH = H - M.top - M.bottom;
    const svg = d3.select(cell).append('svg')
      .attr('width', W).attr('height', H).attr('viewBox', `0 0 ${W} ${H}`);
    const g = svg.append('g').attr('transform', `translate(${M.left},${M.top})`);

    const x = d3.scaleTime().domain(xDomain).range([0, innerW]);
    const y = d3.scaleLinear().domain(yDomain).range([innerH, 0]);

    g.append('g').attr('class', 'axis')
      .attr('transform', `translate(0,${innerH})`)
      .call(d3.axisBottom(x).ticks(3).tickFormat(d3.timeFormat('%Y')));
    g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(3));

    // Launch marker.
    const launchX = x(parseMonth(c.launched));
    g.append('line')
      .attr('class', 'bd-launch-line')
      .attr('x1', launchX).attr('x2', launchX)
      .attr('y1', 0).attr('y2', innerH);

    const points = data.months.map((ym, i) => ({
      date: parseMonth(ym),
      v: data.downtime[c.id]?.[i],
    })).filter((p) => p.v != null);

    const line = d3.line().x((p) => x(p.date)).y((p) => y(p.v));
    g.append('path').datum(points).attr('class', 'bd-line').attr('d', line);
  }
}
