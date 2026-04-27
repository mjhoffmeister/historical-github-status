// Data layer: load JSON, derive series, rolling stats, etc.

const MINUTES_PER_MONTH = 30 * 24 * 60;

export async function loadData() {
  const res = await fetch('data/uptime.json');
  if (!res.ok) throw new Error(`Failed to load data: ${res.status}`);
  return res.json();
}

// Parse "YYYY-MM" -> Date at month midpoint (UTC).
export function parseMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 15));
}

// For each month, average downtime minutes across the selected components,
// counting only components that had launched by that month.
// A month is marked `partial` if ANY contributing component is partial for
// that month (typically: the current in-progress month).
export function avgSeries(data, componentIds) {
  const ids = new Set(componentIds);
  const partial = data.partial || {};
  return data.months.map((ym, i) => {
    let sum = 0, n = 0, isPartial = false;
    for (const c of data.components) {
      if (!ids.has(c.id)) continue;
      const v = data.downtime[c.id]?.[i];
      if (v == null) continue;
      sum += v; n++;
      if (partial[c.id]?.[i]) isPartial = true;
    }
    return { ym, date: parseMonth(ym), minutes: n ? sum / n : null, n, partial: isPartial };
  });
}

// Per-month count of how many components were tracked (i.e. had launched).
export function componentCountSeries(data) {
  return data.months.map((ym, i) => {
    let n = 0;
    for (const c of data.components) if (data.downtime[c.id]?.[i] != null) n++;
    return { ym, date: parseMonth(ym), count: n };
  });
}

// Trailing rolling mean and standard deviation over `window` months.
// Skips nulls AND partial months (since partial sums would distort the mean).
// Returns null where the window has fewer than `min` valid points.
export function rolling(series, window = 12, min = 6) {
  return series.map((_, i) => {
    const slice = series.slice(Math.max(0, i - window + 1), i + 1)
      .filter((p) => p.minutes != null && !p.partial)
      .map((p) => p.minutes);
    if (slice.length < min) return { mean: null, sd: null };
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / slice.length;
    return { mean, sd: Math.sqrt(variance) };
  });
}

export function stableCoreIds(data) {
  return data.components.filter((c) => c.stable_core).map((c) => c.id);
}

export function allIds(data) {
  return data.components.map((c) => c.id);
}

export function minutesToUptimePct(min) {
  if (min == null) return null;
  return 1 - min / MINUTES_PER_MONTH;
}

export { MINUTES_PER_MONTH };
