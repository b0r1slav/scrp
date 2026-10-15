# Baseline — ATP parity tracker

A static GitHub Pages dashboard for even/odd game totals across each player's latest 20 completed ATP singles matches. The board reads `data/results.json`; GitHub Actions refreshes that file from Cito without exposing the API key to the browser.

## Local test

Use Node.js 20 or newer. In Terminal, set your Cito key for the current shell, fetch the data, and serve the folder:

```sh
export CITO_API_KEY='your-cito-live-key'
node scripts/fetch-results.mjs
python3 -m http.server 8000
```

Open `http://localhost:8000`. Keep the key in your shell environment; never put it in `app.js`, `index.html`, a checked-in `.env` file, or a browser request. The generated `data/results.json` contains match results, not the key.

## GitHub Pages and scheduled refresh

1. In repository **Settings → Secrets and variables → Actions**, add the repository secret `CITO_API_KEY` with a Cito live key.
2. In **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**.
3. Push this workflow and site to `main`. The first push publishes the site using demo rows; then go to **Actions → Publish ATP parity board → Run workflow** to fetch real results and publish them.

The workflow refreshes results weekly on Monday and also supports manual runs. It resolves each player, fetches each ATP singles match log, stores the latest source records in `data/results.json`, and deploys the refreshed page. It needs repository **Actions → General → Workflow permissions** set to allow read and write permissions so it can commit the refreshed JSON file. Each refresh uses about 36 API requests (one player search and one match-log request for each of the 18 players).

## Data and calculation rules

The provided 18 player links are tracked. Each set's two game counts are summed across the match; `6-3 6-4` is 19 games, or odd. Matches are sorted newest first, doubles and abandoned/retired/cancelled results are excluded, and a match is skipped if neither side has 6 or more games in the last set. The board counts parity over the latest 20 qualifying results. Strike is the number of consecutive results with the latest match's parity.

The API key is read only by the local Node script or the GitHub Actions runner. The published JSON contains only match results and the refresh time. Cito requires attribution for displayed data; the page links to Cito. Review the provider's current coverage and data terms for your intended use.

## Manual import

The **Import results** control also accepts CSV or JSON in the browser. Imports are stored in that browser's `localStorage`. CSV columns are `player,date,opponent,score,draw,status`; use the slug (for example `sinner-jannik`) as the player value. JSON may be a match array with `player` values or an object keyed by player slug.
