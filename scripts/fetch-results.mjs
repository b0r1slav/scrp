import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const API_ROOT = 'https://api.citoapi.com/api/v1/tennis';
const OUTPUT = resolve('data/results.json');
const PLAYERS = [
  ['sinner-jannik', 'Jannik Sinner'],
  ['alcaraz-garfia-carlos', 'Carlos Alcaraz'],
  ['zverev-alexander', 'Alexander Zverev'],
  ['auger-aliassime-felix', 'Felix Auger-Aliassime'],
  ['shelton-ben', 'Ben Shelton'],
  ['medvedev-daniil', 'Daniil Medvedev'],
  ['de-minaur-alex', 'Alex de Minaur'],
  ['fritz-taylor', 'Taylor Fritz'],
  ['cobolli-flavio', 'Flavio Cobolli'],
  ['bublik-alexander', 'Alexander Bublik'],
  ['lehecka-jiri', 'Jiri Lehecka'],
  ['musetti-lorenzo', 'Lorenzo Musetti'],
  ['mensik-jakub', 'Jakub Mensik'],
  ['ruud-casper', 'Casper Ruud'],
  ['rublev-andrey', 'Andrey Rublev'],
  ['tiafoe-frances', 'Frances Tiafoe'],
  ['davidovich-fokina-alejandro', 'Alejandro Davidovich Fokina'],
  ['khachanov-karen', 'Karen Khachanov'],
];

const apiKey = process.env.CITO_API_KEY;
if (!apiKey) throw new Error('CITO_API_KEY is not set.');

async function api(path) {
  const response = await fetch(`${API_ROOT}${path}`, {
    headers: { 'x-api-key': apiKey, accept: 'application/json' },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    const message = body.error?.message || body.message || `HTTP ${response.status}`;
    throw new Error(`Cito API ${path}: ${message}`);
  }
  return body;
}

const exactName = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const listFrom = body => Array.isArray(body.items) ? body.items : Array.isArray(body.data) ? body.data : [];

async function fetchPlayer(slug, name) {
  const search = await api(`/players/search?q=${encodeURIComponent(name)}&tour=ATP&limit=20`);
  const candidate = listFrom(search).find(player => exactName(player.full_name || player.name) === exactName(name));
  if (!candidate?.id) throw new Error(`Could not resolve exact ATP player: ${name}`);

  const log = await api(`/players/${encodeURIComponent(candidate.id)}/matches?page=1&page_size=500`);
  const records = listFrom(log).map(match => {
    const a = match.player1 || match.winner;
    const b = match.player2 || match.loser;
    const opponent = [a, b].find(player => player?.id && player.id !== candidate.id)?.name || 'Opponent';
    return {
      player: slug,
      date: match.match_date || match.date || match.starts_at?.slice(0, 10) || '',
      opponent,
      score: match.score || match.result || '',
      draw: match.draw || match.event_type || match.type || 'singles',
      status: match.status || match.outcome || 'completed',
      source: 'Cito API',
    };
  }).filter(match => match.score);

  if (!records.length) throw new Error(`Cito returned no scored match records for ${name}`);
  return [slug, records];
}

const data = {};
for (const [slug, name] of PLAYERS) {
  const [key, records] = await fetchPlayer(slug, name);
  data[key] = records;
  console.log(`${name}: received ${records.length} scored records`);
}

const output = {
  source: 'Cito API',
  updated_at: new Date().toISOString(),
  players: data,
};
await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${OUTPUT}`);
