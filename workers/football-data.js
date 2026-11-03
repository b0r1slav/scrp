const CITO_API_ROOT = 'https://api.citoapi.com/api/v1/tennis';
const FOOTBALL_LEAGUES = {
  PL: 'Premier League',
  PD: 'La Liga',
  BL1: 'Bundesliga',
  SA: 'Serie A',
};
const PLAYERS = {
  'sinner-jannik': 'Jannik Sinner',
  'alcaraz-garfia-carlos': 'Carlos Alcaraz',
  'zverev-alexander': 'Alexander Zverev',
  'auger-aliassime-felix': 'Felix Auger-Aliassime',
  'shelton-ben': 'Ben Shelton',
  'medvedev-daniil': 'Daniil Medvedev',
  'de-minaur-alex': 'Alex de Minaur',
  'fritz-taylor': 'Taylor Fritz',
  'cobolli-flavio': 'Flavio Cobolli',
  'bublik-alexander': 'Alexander Bublik',
  'lehecka-jiri': 'Jiri Lehecka',
  'musetti-lorenzo': 'Lorenzo Musetti',
  'mensik-jakub': 'Jakub Mensik',
  'ruud-casper': 'Casper Ruud',
  'rublev-andrey': 'Andrey Rublev',
  'tiafoe-frances': 'Frances Tiafoe',
  'davidovich-fokina-alejandro': 'Alejandro Davidovich Fokina',
  'khachanov-karen': 'Karen Khachanov',
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

async function handleCito(slug, env, corsHeaders) {
  let decodedSlug;
  try {
    decodedSlug = decodeURIComponent(slug);
  } catch {
    return json({ error: 'Unknown player' }, 404, corsHeaders);
  }
  const playerName = PLAYERS[decodedSlug];
  if (!playerName) return json({ error: 'Unknown player' }, 404, corsHeaders);
  const apiKey = env.CITO_API_KEY;
  if (!apiKey) return json({ error: 'Cito API is not configured' }, 503, corsHeaders);

  const cached = playerCache.get(decodedSlug);
  if (cached && cached.expiresAt > Date.now()) {
    return json(
      { player: decodedSlug, matches: cached.matches, cached: true },
      200,
      { ...corsHeaders, 'Cache-Control': PLAYER_CACHE_CONTROL },
    );
  }

  try {
    const search = await cito(
      `/players/search?q=${encodeURIComponent(playerName)}&tour=ATP&limit=20`,
      apiKey,
    );
    const normalizedName = normalizeName(playerName);
    const candidate = apiList(search).find((item) =>
      item && typeof item === 'object' && normalizeName(item.full_name || item.name || '') === normalizedName,
    );
    const candidateId = candidate?.id;
    if (candidateId === undefined || candidateId === null) {
      return json({ error: `Could not resolve ${playerName} with Cito` }, 502, corsHeaders);
    }

    const log = await cito(
      `/players/${encodeURIComponent(String(candidateId))}/matches?page=1&page_size=500`,
      apiKey,
    );
    const matches = apiList(log)
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const a = item.player1 || item.winner;
        const b = item.player2 || item.loser;
        return {
          player: decodedSlug,
          date: item.match_date || item.date || item.starts_at?.slice(0, 10) || '',
          opponent: [a, b].find((player) => player?.id != null && String(player.id) !== String(candidateId))?.name || 'Opponent',
          score: item.score || item.result || '',
          draw: item.draw || item.event_type || item.type || 'singles',
          status: item.status || item.outcome || 'completed',
        };
      })
      .filter((match) => match && match.score);

    if (!matches.length) return json({ error: `Cito returned no scored matches for ${playerName}` }, 502, corsHeaders);
    playerCache.set(decodedSlug, { expiresAt: Date.now() + PLAYER_CACHE_TTL_MS, matches });
    return json(
      { player: decodedSlug, matches, cached: false },
      200,
      { ...corsHeaders, 'Cache-Control': PLAYER_CACHE_CONTROL },
    );
  } catch (error) {
    console.error(`Cito player fetch failed for ${decodedSlug}:`, error instanceof Error ? error.message : 'Cito request failed');
    return json({ error: 'Could not fetch player matches from Cito' }, 502, corsHeaders);
  }
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
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-place-admin-token',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

    const url = new URL(request.url);
    if (url.pathname === '/api/football-data') {
      return handleFootball(request, env, ctx, url, corsHeaders);
    }
    const routeMatch = url.pathname.match(/^\/api\/cito\/players\/([^/]+)\/matches\/?$/);
    if (request.method !== 'GET' || !routeMatch) return json({ error: 'Not found' }, 404, corsHeaders);
    return handleCito(routeMatch[1], env, corsHeaders);
  },
};
