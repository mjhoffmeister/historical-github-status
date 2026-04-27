const d3 = window.d3;

const MARGIN = { top: 8, right: 24, bottom: 28, left: 64 };

export function renderScope(container, series) {
  const root = typeof container === 'string' ? document.querySelector(container) : container;
  root.innerHTML = '';
  const width = root.clientWidth || 900;
  const height = 140;
  const innerW = width - MARGIN.left - MARGIN.right;
  const innerH = height - MARGIN.top - MARGIN.bottom;

  const svg = d3.select(root).append('svg')
    .attr('width', width).attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`);
  const g = svg.append('g').attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);

  const x = d3.scaleTime().domain(d3.extent(series, (p) => p.date)).range([0, innerW]);
  const y = d3.scaleLinear().domain([0, d3.max(series, (p) => p.count) + 1]).range([innerH, 0]);

  g.append('g').attr('class', 'axis')
    .attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(x).ticks(8).tickFormat(d3.timeFormat('%Y')));
  g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(4));

  g.append('text')
    .attr('transform', `rotate(-90)`)
    .attr('x', -innerH / 2).attr('y', -44)
    .attr('text-anchor', 'middle').attr('class', 'scope-axis-label')
    .text('# components tracked');

  const area = d3.area()
    .x((p) => x(p.date)).y0(innerH).y1((p) => y(p.count))
    .curve(d3.curveStepAfter);
  g.append('path').datum(series).attr('class', 'scope-area').attr('d', area);

  const line = d3.line()
    .x((p) => x(p.date)).y((p) => y(p.count))
    .curve(d3.curveStepAfter);
  g.append('path').datum(series).attr('class', 'scope-line').attr('d', line);
}
