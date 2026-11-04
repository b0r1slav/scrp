const HISTORY_COMPETITIONS = { PL: 'Premier League', PD: 'La Liga', BL1: 'Bundesliga', SA: 'Serie A' };
const HISTORY_CACHE_KEY = 'baseline_football_history_v2';
const HISTORY_REQUEST_GAP_MS = 300;
let reportRows = [];
let reportMatches = 0;

const byId = id => document.getElementById(id);
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function readCache() {
  try { return JSON.parse(localStorage.getItem(HISTORY_CACHE_KEY) || '{}'); }
  catch { return {}; }
}

function writeCache(cache) {
  try { localStorage.setItem(HISTORY_CACHE_KEY, JSON.stringify(cache)); }
  catch { setStatus('Browser storage is full. This report can still be exported, but the raw match cache could not be saved.', true); }
}

function compactMatches(payload) {
  const out = [];
  for (const match of payload.matches || []) {
    if (String(match.status || '').toUpperCase() !== 'FINISHED') continue;
    const home = match.homeTeam || {};
    const away = match.awayTeam || {};
    const score = match.score?.fullTime || {};
    const homeGoals = Number(score.home);
    const awayGoals = Number(score.away);
    if (!home.name || !away.name || !Number.isInteger(homeGoals) || !Number.isInteger(awayGoals)) continue;
    const date = String(match.utcDate || match.date || '').slice(0, 10);
    if (!date) continue;
    const season = Number(payload.season);
    const comp = payload.competition;
    out.push([String(home.id ?? home.name), home.name, comp, date, homeGoals + awayGoals, season]);
    out.push([String(away.id ?? away.name), away.name, comp, date, homeGoals + awayGoals, season]);
  }
  return out;
}

async function fetchSeason(competition, season) {
  const response = await fetch(`api/football-history.php?competition=${encodeURIComponent(competition)}&season=${season}`, { cache: 'no-store' });
  const body = await response.text();
  let payload;
  try { payload = JSON.parse(body); }
  catch { throw new Error(`${competition} ${season}: proxy returned non-JSON (HTTP ${response.status}): ${body.slice(0, 180)}`); }
  if (!response.ok) throw new Error(payload.error || `${competition} ${season}: HTTP ${response.status}`);
  if (!Array.isArray(payload.matches)) {
    const detail = payload.error || `response fields: ${Object.keys(payload).join(', ') || 'none'}`;
    throw new Error(`${competition} ${season}: missing matches array (${detail})`);
  }
  return compactMatches(payload);
}

function calculate(rows) {
  const grouped = new Map();
  for (const [teamId, teamName, comp, date, goals, season] of rows) {
    const key = `${comp}|${teamId}`;
    if (!grouped.has(key)) grouped.set(key, { teamId, team: teamName, competition: comp, matches: [] });
    const team = grouped.get(key);
    team.team = teamName;
    team.matches.push({ date, parity: Number(goals) % 2 ? 'odd' : 'even', season: Number(season) });
  }

  return [...grouped.values()].map(team => {
    team.matches.sort((a, b) => a.date.localeCompare(b.date) || a.season - b.season);
    const streaks = { even: {}, odd: {} };
    let currentParity = null;
    let currentLength = 0;
    const record = () => {
      if (!currentParity || !currentLength) return;
      streaks[currentParity][currentLength] = (streaks[currentParity][currentLength] || 0) + 1;
    };
    for (const match of team.matches) {
      if (match.parity === currentParity) currentLength++;
      else {
        record();
        currentParity = match.parity;
        currentLength = 1;
      }
    }
    record();
    const allRuns = Object.entries(streaks).flatMap(([parity, counts]) =>
      Object.keys(counts).map(length => ({ parity, length: Number(length), count: counts[length] })),
    );
    allRuns.sort((a, b) => b.length - a.length || a.parity.localeCompare(b.parity));
    return { ...team, longest: allRuns[0] || null, streaks, allRuns };
  }).sort((a, b) => (b.longest?.length || 0) - (a.longest?.length || 0)
    || a.team.localeCompare(b.team) || a.competition.localeCompare(b.competition));
}

function setStatus(message, error = false) {
  const node = byId('history-status');
  node.textContent = message;
  node.classList.toggle('error', error);
}

function render() {
  const query = byId('team-search').value.trim().toLowerCase();
  const rows = reportRows.filter(row => `${row.team} ${HISTORY_COMPETITIONS[row.competition]}`.toLowerCase().includes(query));
  byId('history-rows').innerHTML = rows.length ? rows.map((row, index) => {
    const detail = row.allRuns.map(run => `<span class="run-chip ${run.parity}"><b>${run.length}</b>: ${run.count} ${run.count === 1 ? 'time' : 'times'}</span>`).join('');
    const longest = row.longest ? `<span class="latest-pill ${row.longest.parity}"><i></i>${row.longest.length} ${row.longest.parity.toUpperCase()}</span>` : '—';
    return `<tr class="player-row"><td class="rank">${String(index + 1).padStart(2, '0')}</td><td><span class="team-name">${esc(row.team)}</span></td><td class="team-league">${esc(HISTORY_COMPETITIONS[row.competition])}</td><td class="metric">${row.matches.length}</td><td>${longest}</td><td><div class="run-list">${detail || '—'}</div></td></tr>`;
  }).join('') : '<tr><td colspan="6" class="empty-state">No matching teams.</td></tr>';
  byId('history-teams').textContent = reportRows.length || '—';
  byId('history-matches').textContent = reportMatches.toLocaleString();
  byId('history-longest').textContent = reportRows[0]?.longest?.length || '—';
  byId('history-row-count').textContent = `${rows.length} TEAM${rows.length === 1 ? '' : 'S'}`;
}

async function loadHistory() {
  const start = Number(byId('start-season').value);
  const end = Number(byId('end-season').value);
  const currentYear = new Date().getUTCFullYear();
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 2000 || end > currentYear || end < start) {
    setStatus(`Enter a valid range from 2000 through ${currentYear}.`, true);
    return;
  }

  const button = byId('load-history');
  button.disabled = true;
  byId('export-history').disabled = true;
  byId('history-rows').innerHTML = '<tr><td colspan="6" class="empty-state">Loading match history…</td></tr>';
  const cache = readCache();
  const rawRows = [];
  const requests = [];
  for (let season = start; season <= end; season++) {
    for (const competition of Object.keys(HISTORY_COMPETITIONS)) {
      const key = `${competition}-${season}`;
      if (Array.isArray(cache[key])) rawRows.push(...cache[key]);
      else requests.push({ competition, season, key });
    }
  }
  byId('history-seasons').textContent = end - start + 1;

  try {
    for (let index = 0; index < requests.length; index++) {
      const { competition, season, key } = requests[index];
      setStatus(`Downloading ${competition} ${season} (${index + 1} of ${requests.length}) from the historical CSV archive.`);
      if (index > 0) await wait(HISTORY_REQUEST_GAP_MS);
      const rows = await fetchSeason(competition, season);
      cache[key] = rows;
      rawRows.push(...rows);
      writeCache(cache);
    }
    reportMatches = rawRows.length / 2;
    reportRows = calculate(rawRows);
    render();
    byId('export-history').disabled = reportRows.length === 0;
    setStatus(`Loaded ${reportMatches.toLocaleString()} completed matches across ${end - start + 1} seasons. Results are saved in this browser; export the CSV to keep a separate copy.`);
    byId('history-footer').textContent = `Streaks are maximal uninterrupted runs across the full selected range, including runs that cross season boundaries. ${rawRows.length.toLocaleString()} team-match results counted.`;
  } catch (error) {
    reportRows = calculate(rawRows);
    reportMatches = rawRows.length / 2;
    render();
    setStatus(`${error.message} Successfully fetched seasons remain cached. Fix the proxy response, then load again to retry only missing seasons.`, true);
  } finally {
    button.disabled = false;
  }
}

function exportCsv() {
  const records = [];
  for (const team of reportRows) {
    for (const [parity, counts] of Object.entries(team.streaks)) {
      for (const [length, occurrences] of Object.entries(counts)) {
        records.push([team.team, HISTORY_COMPETITIONS[team.competition], team.competition, parity, length, occurrences, team.matches.length, team.longest?.length || 0]);
      }
    }
  }
  const quote = value => `"${String(value).replace(/"/g, '""')}"`;
  const csv = [['team', 'competition', 'competition_code', 'parity', 'streak_length', 'occurrences', 'completed_team_matches', 'team_longest_streak'], ...records]
    .map(row => row.map(quote).join(',')).join('\r\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `football-parity-streaks-${byId('start-season').value}-${byId('end-season').value}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

byId('load-history').addEventListener('click', loadHistory);
byId('export-history').addEventListener('click', exportCsv);
byId('team-search').addEventListener('input', render);
byId('history-seasons').textContent = Number(byId('end-season').value) - Number(byId('start-season').value) + 1;
