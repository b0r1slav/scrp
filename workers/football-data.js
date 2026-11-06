const CITO_API_ROOT = 'https://api.citoapi.com/api/v1/tennis';
const FOOTBALL_LEAGUES = {
  PL: 'Premier League',
  PD: 'La Liga',
  BL1: 'Bundesliga',
  SA: 'Serie A',
};
const playerCache = new Map();
const PLAYER_CACHE_TTL_MS = 5 * 60 * 1000;
const PLAYER_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=240';
const FOOTBALL_CACHE_TTL = 900;

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

function apiList(body) {
  if (Array.isArray(body.items)) return body.items;
  if (Array.isArray(body.data)) return body.data;
  return [];
}

async function cito(path, apiKey) {
  const response = await fetch(`${CITO_API_ROOT}${path}`, {
    headers: { 'x-api-key': apiKey, accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    throw new Error(body.error?.message || body.message || `Cito returned HTTP ${response.status}`);
  }
  return body;
}

async function fetchCitoPlayer(player, apiKey) {
  const { slug, name } = player;
  const cached = playerCache.get(slug);
  if (cached && cached.name === name && cached.expiresAt > Date.now()) {
    return { slug, matches: cached.matches };
  }

  const search = await cito(`/players/search?q=${encodeURIComponent(name)}&tour=ATP&limit=20`, apiKey);
  const candidate = apiList(search).find((item) => item && typeof item === 'object' &&
    normalizeName(item.full_name || item.name || '') === normalizeName(name));
  const candidateId = candidate?.id;
  if (candidateId === undefined || candidateId === null) throw new Error(`Could not resolve ${name} with Cito`);

  const log = await cito(`/players/${encodeURIComponent(String(candidateId))}/matches?page=1&page_size=500`, apiKey);
  const matches = apiList(log).map((item) => {
    if (!item || typeof item !== 'object') return null;
    const a = item.player1 || item.winner;
    const b = item.player2 || item.loser;
    return {
      player: slug,
      date: item.match_date || item.date || item.starts_at?.slice(0, 10) || '',
      opponent: [a, b].find((opponent) => opponent?.id != null && String(opponent.id) !== String(candidateId))?.name || 'Opponent',
      score: item.score || item.result || '',
      draw: item.draw || item.event_type || item.type || 'singles',
      status: item.status || item.outcome || 'completed',
    };
  }).filter((match) => match && match.score);
  if (!matches.length) throw new Error(`Cito returned no scored matches for ${name}`);

  playerCache.set(slug, { name, expiresAt: Date.now() + PLAYER_CACHE_TTL_MS, matches });
  return { slug, matches };
}

async function handleCito(request, env, corsHeaders) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders);
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Expected a JSON request body' }, 400, corsHeaders); }
  if (!Array.isArray(body?.players) || body.players.length < 1 || body.players.length > 10) {
    return json({ error: 'Send between 1 and 10 players per request' }, 400, corsHeaders);
  }
  const players = [];
  const seen = new Set();
  for (const player of body.players) {
    const slug = typeof player?.slug === 'string' ? player.slug.trim() : '';
    const name = typeof player?.name === 'string' ? player.name.trim() : '';
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !name || name.length > 100) {
      return json({ error: 'Each player needs a valid slug and name' }, 400, corsHeaders);
    }
    if (!seen.has(slug)) players.push({ slug, name });
    seen.add(slug);
  }
  const apiKey = env.CITO_API_KEY;
  if (!apiKey) return json({ error: 'Cito API is not configured' }, 503, corsHeaders);

  const results = await Promise.all(players.map(async (player) => {
    try { return { ...await fetchCitoPlayer(player, apiKey), error: null }; }
    catch (error) {
      console.error(`Cito player fetch failed for ${player.slug}:`, error instanceof Error ? error.message : 'Cito request failed');
      return { slug: player.slug, error: `Could not fetch matches for ${player.name}` };
    }
  }));
  return json({ results }, 200, { ...corsHeaders, 'Cache-Control': PLAYER_CACHE_CONTROL });
}

function normalizeName(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

async function handleFootball(request, env, ctx, url, corsHeaders) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, corsHeaders);
  if (!env.FOOTBALL_DATA_TOKEN) return json({ error: 'Football API is not configured.' }, 503, corsHeaders);

  const season = new Date().getUTCFullYear();
  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}${url.pathname}?season=${season}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const result = { season, updatedAt: new Date().toISOString(), competitions: {} };
  try {
    for (const [code, name] of Object.entries(FOOTBALL_LEAGUES)) {
      const upstream = await fetch(
        `https://api.football-data.org/v4/competitions/${encodeURIComponent(code)}/matches?season=${season}`,
        { headers: { 'X-Auth-Token': env.FOOTBALL_DATA_TOKEN, accept: 'application/json' } },
      );
      const data = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        return json({ error: data.message || `football-data.org returned HTTP ${upstream.status}` }, upstream.status, corsHeaders);
      }
      if (!Array.isArray(data.matches)) return json({ error: 'Unexpected response from football-data.org' }, 502, corsHeaders);
      result.competitions[code] = { name, matches: data.matches };
    }
  } catch (error) {
    return json({ error: error.message || 'Could not reach football-data.org' }, 502, corsHeaders);
  }

  const response = json(result, 200, {
    ...corsHeaders,
    'Cache-Control': `public, max-age=${FOOTBALL_CACHE_TTL}`,
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-place-admin-token',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

    const url = new URL(request.url);
    if (url.pathname === '/api/football-data') {
      return handleFootball(request, env, ctx, url, corsHeaders);
    }
    if (url.pathname === '/api/cito/players/matches') return handleCito(request, env, corsHeaders);
    return json({ error: 'Not found' }, 404, corsHeaders);
  },
};
