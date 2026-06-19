const axios = require('axios');
const { MongoClient } = require('mongodb');

const MONGO_URL = process.env.MONGODB_URL;
const DB_NAME = (MONGO_URL || '').match(/\/([^/?]+)(\?|$)/)?.[1] || 'worldcup2026';

const PROVIDER_URL = process.env.LIVE_SCORE_PROVIDER_URL;
const RESPONSE_PATH = process.env.LIVE_SCORE_RESPONSE_PATH || '';
const DATE_QUERY_PARAM = process.env.LIVE_SCORE_DATE_QUERY_PARAM || '';
const DATE_QUERY_MODE = (process.env.LIVE_SCORE_DATE_QUERY_MODE || 'comma').toLowerCase();
const STATIC_QUERY = parseJSON(process.env.LIVE_SCORE_QUERY_JSON, {});
const STATIC_HEADERS = parseJSON(process.env.LIVE_SCORE_HEADERS_JSON, {});

const POLL_INTERVAL_MS = parseNumber(process.env.LIVE_SCORE_POLL_INTERVAL_MS, 60_000);
const PRE_MATCH_WINDOW_MS = parseNumber(process.env.LIVE_SCORE_PREMATCH_WINDOW_MS, 15 * 60_000);
const POST_MATCH_WINDOW_MS = parseNumber(process.env.LIVE_SCORE_POSTMATCH_WINDOW_MS, 4 * 60 * 60_000);
const MAX_IDLE_SLEEP_MS = parseNumber(process.env.LIVE_SCORE_MAX_IDLE_SLEEP_MS, 30 * 60_000);
const REQUEST_TIMEOUT_MS = parseNumber(process.env.LIVE_SCORE_REQUEST_TIMEOUT_MS, 15_000);

const FIELD_PATHS = {
  id: process.env.LIVE_SCORE_FIELD_ID || 'id',
  homeScore: process.env.LIVE_SCORE_FIELD_HOME_SCORE || 'home_score',
  awayScore: process.env.LIVE_SCORE_FIELD_AWAY_SCORE || 'away_score',
  homeScorers: process.env.LIVE_SCORE_FIELD_HOME_SCORERS || 'home_scorers',
  awayScorers: process.env.LIVE_SCORE_FIELD_AWAY_SCORERS || 'away_scorers',
  finished: process.env.LIVE_SCORE_FIELD_FINISHED || 'finished',
  timeElapsed: process.env.LIVE_SCORE_FIELD_TIME_ELAPSED || 'time_elapsed',
  homeTeamId: process.env.LIVE_SCORE_FIELD_HOME_TEAM_ID || 'home_team_id',
  awayTeamId: process.env.LIVE_SCORE_FIELD_AWAY_TEAM_ID || 'away_team_id',
  homeTeamLabel: process.env.LIVE_SCORE_FIELD_HOME_TEAM_LABEL || 'home_team_label',
  awayTeamLabel: process.env.LIVE_SCORE_FIELD_AWAY_TEAM_LABEL || 'away_team_label'
};

if (!MONGO_URL) {
  console.error('MONGODB_URL environment variable is required');
  process.exit(1);
}

let client;

function parseJSON(raw, fallback) {
  if (!raw) return fallback;

  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error(`Invalid JSON config: ${raw}`);
    return fallback;
  }
}

function parseNumber(raw, fallback) {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getByPath(source, path) {
  if (!path) return undefined;

  return path.split('.').reduce((value, key) => {
    if (value === undefined || value === null) {
      return undefined;
    }

    return value[key];
  }, source);
}

function normalizeScore(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return String(value);
}

function normalizeFinished(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }

  const normalized = String(value).trim().toLowerCase();
  return ['true', '1', 'yes', 'finished', 'fulltime', 'full_time', 'ft'].includes(normalized)
    ? 'TRUE'
    : 'FALSE';
}

function normalizeTimeElapsed(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return String(value).trim();
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    return JSON.stringify(value);
  }

  return String(value);
}

function normalizeScorers(value) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === '' || value === 'null') {
    return 'null';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    const formatted = value.map(item => {
      if (typeof item === 'string') {
        return item;
      }

      if (item && typeof item === 'object') {
        const name = item.name || item.player || item.scorer || item.label;
        const minute = item.minute || item.time || item.elapsed;

        if (name && minute) {
          return `${name} '${minute}'`;
        }

        if (name) {
          return String(name);
        }
      }

      return null;
    }).filter(Boolean);

    return formatted.length > 0 ? formatted.join(', ') : JSON.stringify(value);
  }

  return JSON.stringify(value);
}

function extractMatches(payload) {
  const source = RESPONSE_PATH ? getByPath(payload, RESPONSE_PATH) : payload;

  if (Array.isArray(source)) {
    return source;
  }

  if (Array.isArray(source?.matches)) {
    return source.matches;
  }

  return [];
}

function normalizeProviderMatch(rawMatch) {
  const id = normalizeOptionalString(getByPath(rawMatch, FIELD_PATHS.id));
  if (!id) return null;

  return {
    id,
    home_score: normalizeScore(getByPath(rawMatch, FIELD_PATHS.homeScore)),
    away_score: normalizeScore(getByPath(rawMatch, FIELD_PATHS.awayScore)),
    home_scorers: normalizeScorers(getByPath(rawMatch, FIELD_PATHS.homeScorers)),
    away_scorers: normalizeScorers(getByPath(rawMatch, FIELD_PATHS.awayScorers)),
    finished: normalizeFinished(getByPath(rawMatch, FIELD_PATHS.finished)),
    time_elapsed: normalizeTimeElapsed(getByPath(rawMatch, FIELD_PATHS.timeElapsed)),
    home_team_id: normalizeOptionalString(getByPath(rawMatch, FIELD_PATHS.homeTeamId)),
    away_team_id: normalizeOptionalString(getByPath(rawMatch, FIELD_PATHS.awayTeamId)),
    home_team_label: normalizeOptionalString(getByPath(rawMatch, FIELD_PATHS.homeTeamLabel)),
    away_team_label: normalizeOptionalString(getByPath(rawMatch, FIELD_PATHS.awayTeamLabel))
  };
}

function buildProviderRequestConfig(relevantGames) {
  const params = { ...STATIC_QUERY };

  if (DATE_QUERY_PARAM) {
    const uniqueDates = [...new Set(relevantGames.map(game => game.date.toISOString().slice(0, 10)))];

    if (uniqueDates.length > 0) {
      if (DATE_QUERY_MODE === 'repeat') {
        params[DATE_QUERY_PARAM] = uniqueDates;
      } else {
        params[DATE_QUERY_PARAM] = uniqueDates.join(',');
      }
    }
  }

  return {
    method: 'get',
    url: PROVIDER_URL,
    timeout: REQUEST_TIMEOUT_MS,
    headers: STATIC_HEADERS,
    params,
    paramsSerializer: {
      serialize(input) {
        const searchParams = new URLSearchParams();

        for (const [key, value] of Object.entries(input)) {
          if (value === undefined || value === null) continue;

          if (Array.isArray(value)) {
            for (const item of value) {
              searchParams.append(key, String(item));
            }
            continue;
          }

          searchParams.append(key, String(value));
        }

        return searchParams.toString();
      }
    }
  };
}

function buildGameUpdate(existingGame, providerMatch) {
  const fieldsToCompare = [
    'home_score',
    'away_score',
    'home_scorers',
    'away_scorers',
    'finished',
    'time_elapsed',
    'home_team_id',
    'away_team_id',
    'home_team_label',
    'away_team_label'
  ];

  const update = {};

  for (const field of fieldsToCompare) {
    const newValue = providerMatch[field];
    if (newValue !== undefined && newValue !== existingGame[field]) {
      update[field] = newValue;
    }
  }

  return update;
}

function getIdleDelayMs(nextGame) {
  if (!nextGame?.date) {
    return MAX_IDLE_SLEEP_MS;
  }

  const nextUsefulWindow = new Date(nextGame.date).getTime() - PRE_MATCH_WINDOW_MS;
  const delay = nextUsefulWindow - Date.now();

  if (delay <= 0) {
    return POLL_INTERVAL_MS;
  }

  return Math.min(Math.max(delay, POLL_INTERVAL_MS), MAX_IDLE_SLEEP_MS);
}

async function connect() {
  client = new MongoClient(MONGO_URL);
  await client.connect();
  log('Connected to MongoDB');
}

async function syncRelevantGames() {
  if (!PROVIDER_URL) {
    log('LIVE_SCORE_PROVIDER_URL is missing, live sync idle');
    return MAX_IDLE_SLEEP_MS;
  }

  const db = client.db(DB_NAME);
  const coll = db.collection('games');
  const now = Date.now();

  const relevantGames = await coll.find(
    {
      finished: { $ne: 'TRUE' },
      date: {
        $gte: new Date(now - POST_MATCH_WINDOW_MS),
        $lte: new Date(now + PRE_MATCH_WINDOW_MS)
      }
    },
    {
      projection: {
        id: 1,
        home_score: 1,
        away_score: 1,
        home_scorers: 1,
        away_scorers: 1,
        finished: 1,
        time_elapsed: 1,
        home_team_id: 1,
        away_team_id: 1,
        home_team_label: 1,
        away_team_label: 1,
        date: 1
      }
    }
  ).toArray();

  const nextUpcomingGame = await coll.findOne(
    {
      finished: { $ne: 'TRUE' },
      date: { $gt: new Date(now) }
    },
    {
      projection: { date: 1 },
      sort: { date: 1 }
    }
  );

  if (relevantGames.length === 0) {
    const sleepMs = getIdleDelayMs(nextUpcomingGame);
    log(`No useful live window, sleeping for ${Math.round(sleepMs / 1000)}s`);
    return sleepMs;
  }

  const requestConfig = buildProviderRequestConfig(relevantGames);
  log(`Polling provider for ${relevantGames.length} relevant games`);

  const response = await axios(requestConfig);
  const providerMatches = extractMatches(response.data)
    .map(normalizeProviderMatch)
    .filter(Boolean);

  const providerMatchesById = new Map(providerMatches.map(match => [match.id, match]));
  const bulkOps = [];
  const changedIds = [];

  for (const game of relevantGames) {
    const providerMatch = providerMatchesById.get(String(game.id));
    if (!providerMatch) continue;

    const update = buildGameUpdate(game, providerMatch);
    if (Object.keys(update).length === 0) continue;

    update.updated_at = new Date();

    bulkOps.push({
      updateOne: {
        filter: { id: game.id },
        update: { $set: update }
      }
    });
    changedIds.push(String(game.id));
  }

  if (bulkOps.length > 0) {
    await coll.bulkWrite(bulkOps, { ordered: false });
    log(`Updated ${bulkOps.length} live games: ${changedIds.join(', ')}`);
  } else {
    log(`Provider returned no changes for ${relevantGames.length} relevant games`);
  }

  return POLL_INTERVAL_MS;
}

async function runLoop() {
  while (true) {
    try {
      const delayMs = await syncRelevantGames();
      await sleep(delayMs);
    } catch (error) {
      log(`Live sync error: ${error.message}`);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

async function startSync() {
  await connect();
  await runLoop();
}

if (require.main === module) {
  startSync().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { startSync };
