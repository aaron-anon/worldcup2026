const { MongoClient } = require('mongodb');

const MONGO_URL = process.env.MONGODB_URL;
const DB_NAME = (MONGO_URL || '').match(/\/([^/?]+)(\?|$)/)?.[1] || 'worldcup2026';
const POLL_INTERVAL = 60_000;

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

const sv = (v) => v === undefined || v === null ? undefined : String(v);
const svFinished = (v) => {
  if (v === undefined || v === null) return undefined;
  return String(v).toLowerCase() === 'true' || String(v) === '1' ? 'TRUE' : 'FALSE';
};

async function syncGames() {
  try {
    const db = client.db(DB_NAME);
    const coll = db.collection('games');

    const games = await coll.find({}, {
      projection: {
        id: 1, home_score: 1, away_score: 1, home_scorers: 1,
        away_scorers: 1, finished: 1, time_elapsed: 1
      }
    }).toArray();

    if (games.length === 0) return;

    const bulkOps = [];

    for (const game of games) {
      const fields = {};

      const hs = sv(game.home_score);
      if (hs !== undefined && hs !== game.home_score) fields.home_score = hs;

      const as = sv(game.away_score);
      if (as !== undefined && as !== game.away_score) fields.away_score = as;

      const hsc = sv(game.home_scorers);
      if (hsc !== undefined && hsc !== game.home_scorers) fields.home_scorers = hsc;

      const asc = sv(game.away_scorers);
      if (asc !== undefined && asc !== game.away_scorers) fields.away_scorers = asc;

      const fn = svFinished(game.finished);
      if (fn !== undefined && fn !== game.finished) fields.finished = fn;

      const te = sv(game.time_elapsed);
      if (te !== undefined && te !== game.time_elapsed) fields.time_elapsed = te;

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
      console.log(`[${new Date().toISOString()}] Normalized ${bulkOps.length} games`);
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
