const https = require('https');
const { MongoClient } = require('mongodb');

const MONGO_URL = process.env.MONGODB_URL;
const DB_NAME = (MONGO_URL || '').match(/\/([^/?]+)(\?|$)/)?.[1] || 'worldcup2026';
const POLL_INTERVAL = 15_000;
const SOURCE_API = 'https://worldcup26.ir/get/games';

if (!MONGO_URL) {
  console.error('MONGODB_URL environment variable is required');
  process.exit(1);
}

let client;

async function connect() {
  client = new MongoClient(MONGO_URL);
  await client.connect();
  console.log('Connected to MongoDB');
}

async function syncGames() {
  try {
    const data = await new Promise((resolve, reject) => {
      https.get(SOURCE_API, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(e); }
        });
      }).on('error', reject);
    });

    const games = data.games || data;
    if (!Array.isArray(games) || games.length === 0) return;

    const db = client.db(DB_NAME);
    const coll = db.collection('games');
    let updates = 0;

    for (const game of games) {
      const existing = await coll.findOne({ id: game.id });
      if (!existing) continue;

      const fields = {};

      const sv = (v) => v === undefined || v === null ? undefined : String(v);
      const svFinished = (v) => {
        if (v === undefined || v === null) return undefined;
        const s = String(v).toLowerCase();
        return s === 'true' || s === '1' ? 'TRUE' : 'FALSE';
      };

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
        await coll.updateOne({ id: game.id }, { $set: fields });
        updates++;
      }
    }

    if (updates > 0) {
      console.log(`[${new Date().toISOString()}] Updated ${updates} games`);
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Sync error:`, err.message);
  }
}

async function main() {
  await connect();
  await syncGames();
  setInterval(syncGames, POLL_INTERVAL);
  console.log(`Sync running every ${POLL_INTERVAL / 1000}s`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
