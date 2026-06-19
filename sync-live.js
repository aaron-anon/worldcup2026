const https = require('https');
const { MongoClient } = require('mongodb');

const MONGO_URL = process.env.MONGODB_URL;
const DB_NAME = (MONGO_URL || '').match(/\/([^/?]+)(\?|$)/)?.[1] || 'worldcup2026';
const POLL_INTERVAL = 60_000;
const SOURCE_API = 'https://worldcup26.ir/get/games';
const REQUEST_TIMEOUT = 10_000;
const MAX_RETRIES = 3;

if (!MONGO_URL) {
  console.error('MONGODB_URL environment variable is required');
  process.exit(1);
}

let client;

const agent = new https.Agent({ keepAlive: true });

async function connect() {
  client = new MongoClient(MONGO_URL);
  await client.connect();
  console.log('Connected to MongoDB');
}

function fetchWithTimeout(url, timeout) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`Invalid JSON (HTTP ${res.statusCode}): ${body.slice(0, 200)}`)); }
      });
    });
    req.setTimeout(timeout, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.on('error', reject);
  });
}

async function fetchWithRetry(url, timeout = REQUEST_TIMEOUT, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchWithTimeout(url, timeout);
    } catch (err) {
      if (attempt < retries) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
}

async function syncGames() {
  try {
    const data = await fetchWithRetry(SOURCE_API);

    const games = data.games || data;
    if (!Array.isArray(games) || games.length === 0) return;

    const db = client.db(DB_NAME);
    const coll = db.collection('games');

    const sv = (v) => v === undefined || v === null ? undefined : String(v);
    const svFinished = (v) => {
      if (v === undefined || v === null) return undefined;
      return String(v).toLowerCase() === 'true' || String(v) === '1' ? 'TRUE' : 'FALSE';
    };

    const existingGames = await coll.find({}, {
      projection: {
        id: 1, home_score: 1, away_score: 1, home_scorers: 1,
        away_scorers: 1, finished: 1, time_elapsed: 1
      }
    }).toArray();

    const existingMap = new Map(existingGames.map(g => [g.id, g]));
    const bulkOps = [];

    for (const game of games) {
      const existing = existingMap.get(game.id);
      if (!existing) continue;

      const fields = {};

      const hs = sv(game.home_score);
      if (hs !== undefined && hs !== existing.home_score) fields.home_score = hs;

      const as = sv(game.away_score);
      if (as !== undefined && as !== existing.away_score) fields.away_score = as;

      const hsc = sv(game.home_scorers);
      if (hsc !== undefined && hsc !== existing.home_scorers) fields.home_scorers = hsc;

      const asc = sv(game.away_scorers);
      if (asc !== undefined && asc !== existing.away_scorers) fields.away_scorers = asc;

      const fn = svFinished(game.finished);
      if (fn !== undefined && fn !== existing.finished) fields.finished = fn;

      const te = sv(game.time_elapsed);
      if (te !== undefined && te !== existing.time_elapsed) fields.time_elapsed = te;

      if (Object.keys(fields).length > 0) {
        fields.updated_at = new Date();
        bulkOps.push({
          updateOne: {
            filter: { id: game.id },
            update: { $set: fields }
          }
        });
      }
    }

    if (bulkOps.length > 0) {
      await coll.bulkWrite(bulkOps);
      console.log(`[${new Date().toISOString()}] Updated ${bulkOps.length} games`);
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Sync error:`, err.message);
  }
}

async function startSync() {
  await connect();
  await syncGames();
  setInterval(syncGames, POLL_INTERVAL);
  console.log(`Sync running every ${POLL_INTERVAL / 1000}s`);
}

if (require.main === module) {
  startSync().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { startSync };
