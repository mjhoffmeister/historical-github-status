# GitHub Historic Uptime — an honest reading

A single-page static visualization of GitHub's monthly downtime, built as a
deliberate counter-example to charts that use truncated axes and causal
annotations to imply a story the data does not support.

## Run it

```sh
# any static server works
npx http-server . -p 8080
# then open http://localhost:8080
```

No build step. Just `index.html`, `src/`, and `data/`.

## Refresh the data

```sh
node scripts/build-snapshot.js   # regenerate the committed fallback snapshot
node scripts/fetch-data.js       # pull recent incidents from githubstatus.com and merge
```

The status page's public API only exposes the last ~50 incidents, so the
snapshot is the source of truth for older months. The fetcher overlays live
data only for months it can fully observe.

## Design choices (the point of this project)

The reference visualization that motivated this rebuild used:

- **A y-axis from 99.5% to 100%**, which converts sub-tenth-of-a-percent
  variation into apparent cliffs.
- **A vertical "Microsoft Acquires GitHub" line** at the moment the chart
  starts looking noisier — visually planting a causal narrative the data
  cannot support.
- **Color-by-uptime-threshold** that paints 99.8% red even though it
  represents fewer than 90 minutes of downtime in a month.
- **Implicit scope drift**: components like Actions (2019), Codespaces (2021),
  and Copilot (2022) were added to the status page over time, so the
  post-acquisition window measures a strictly larger surface area.

This rebuild addresses each point:

| Issue | Fix |
| --- | --- |
| Truncated y-axis | Default metric is **downtime minutes/month** on a 0-based axis. The "Uptime %" toggle is clearly labeled "zoomed" and includes an inset 0–100% sparkline. |
| Causal annotation | The acquisition is one item in an opt-in **Context** layer alongside component launches, postmortems, and methodology changes. No vertical line splits the chart by default. |
| Misleading color | Single neutral series color. Annotations link to postmortems instead of triggering threshold colors. |
| Scope drift | Default series is the **stable core** components present for the whole window (Git, API, Issues, PRs, Webhooks). A secondary chart shows the per-month component count so scope drift is visible. |
| Single-month noise | Optional 12-month rolling mean and ±1σ band overlay. |
| Opaque methodology | Methodology and caveats section is permanently visible at the bottom of the page. |

## Data caveats (also surfaced in the UI)

- Status-page uptime ≠ user-perceived uptime.
- Status-page reporting practices have themselves changed over time.
- The snapshot is plausible historical data derived from publicly-documented
  GitHub incidents and component launch dates; it is suitable for a demo of
  the visualization but should not be cited as authoritative numbers.
- The live fetcher merges in real incident durations from the official API
  for the trailing months it covers.

## File layout

```
index.html
src/
  app.js                 entry, tab + toggle wiring
  data.js                load + derive (rolling mean, σ, stable core)
  styles.css
  charts/
    average.js           main chart (D3)
    scope.js             component-count strip chart
    breakdown.js         per-component small multiples
data/
  uptime.json            current data (live + snapshot merged)
  uptime.snapshot.json   committed fallback
scripts/
  build-snapshot.js      regenerate the snapshot
  fetch-data.js          refresh trailing months from the live API
```
