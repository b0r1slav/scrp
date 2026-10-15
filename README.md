# Baseline — ATP parity tracker

A static GitHub Pages dashboard for tracking even/odd game totals across each player's latest 20 completed ATP singles matches.

## Run locally

Open `index.html` in a browser, or serve this folder with any static web server. No build step or server-side code is required.

## Add match results

Use **Import results** to load a CSV or JSON file. Imported records are stored in browser `localStorage` and do not leave the device. The table starts with illustrative demo rows, visibly marked **DEMO**. The seeded top-player list contains the 18 Flashscore player links provided for the project.

CSV headers:

```csv
player,date,opponent,score,draw,status
sinner-jannik,2026-10-12,Player Name,"6-3 6-4",singles,completed
```

Use the player slug from the first path segment after `/player/` (for example `sinner-jannik`). JSON can be either an array of match records with a `player` field or an object keyed by slug whose values are arrays of records. Match score can be a string such as `6-3 6-4` or an array of set pairs such as `[[6,3],[6,4]]`. Dates should use `YYYY-MM-DD` so newest-first sorting is reliable.

The app filters out doubles and statuses containing abandoned/retired (also cancelled/canceled). It also drops scores whose final set has no side at 6 games or more, matching the project's abandoned-match rule. It sums both players' games across all sets to get parity. The strike is the count of consecutive same-parity matches starting at the latest result. Only the latest 20 qualifying matches contribute to totals.

## Publish with GitHub Pages

Push this directory to a GitHub repository. In **Settings → Pages**, choose **Deploy from a branch**, select the default branch and `/ (root)`, then save. GitHub Pages serves the static files directly; no API key, backend, or build action is needed.

## Data source note

This page does not scrape Flashscore. Flashscore's published terms restrict scraping, aggregation, embedding, and recreation of its content without express permission. A static Pages site also cannot generally fetch another site's results HTML because of browser cross-origin rules. Use a data feed whose license permits this use, then import its results. Some third-party tennis APIs offer free tiers, but historical-results coverage, quotas, browser access, and API-key exposure vary; check the provider's current plan and terms before wiring one in.
