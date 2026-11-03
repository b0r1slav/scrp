# Baseline

Baseline tracks even/odd match parity streaks for ATP tennis players and top-flight football teams.

- `index.html` is the ATP singles tracker.
- `football.html` is the combined Premier League, La Liga, Bundesliga, and Serie A tracker.
- Football results load from football-data.org through the Cloudflare Worker in `workers/football-data.js`. Manual CSV/JSON imports remain available and are stored locally in the browser.

Football parity uses the combined goals scored in each completed match. Each fixture is counted for both teams.

## Football API setup

Create a free API token at [football-data.org](https://www.football-data.org/client/register), then set it as a server environment variable. Do not put the token in `football.js` or another browser file.

The existing tennis Worker now also serves football at `/api/football-data`. It uses `CITO_API_KEY` for tennis and `FOOTBALL_DATA_TOKEN` for football; the football response is cached at the edge for 15 minutes. Add the football token as a Cloudflare secret and deploy the combined Worker:

```sh
npx wrangler secret put FOOTBALL_DATA_TOKEN
npx wrangler deploy
```

Run those commands from this repository after authenticating Wrangler with the Cloudflare account used for the tennis Worker. `CITO_API_KEY` must remain configured. The football endpoint is `https://raspy-frog-d6b6.borislav-madzharov.workers.dev/api/football-data`, configured in `football.js`. The Worker requests the current calendar year for Premier League (`PL`), La Liga (`PD`), Bundesliga (`BL1`), and Serie A (`SA`) and serves all four competitions in one browser request.

For local development, serve the static files with any local HTTP server and make sure the Worker is deployed. `api/football-data.php` is retained as a legacy local/server proxy; the frontend no longer calls it.
