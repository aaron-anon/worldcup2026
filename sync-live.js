const https = require('https');
const { MongoClient } = require('mongodb');

const MONGO_URL = process.env.MONGODB_URL;
const DB_NAME = 'worldcup';
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
      if (game.home_score !== undefined && game.home_score !== existing.home_score) fields.home_score = game.home_score;
      if (game.away_score !== undefined && game.away_score !== existing.away_score) fields.away_score = game.away_score;
      if (game.home_scorers !== undefined && game.home_scorers !== existing.home_scorers) fields.home_scorers = game.home_scorers;
      if (game.away_scorers !== undefined && game.away_scorers !== existing.away_scorers) fields.away_scorers = game.away_scorers;
      if (game.finished !== undefined && game.finished !== existing.finished) fields.finished = game.finished;
      if (game.time_elapsed !== undefined && game.time_elapsed !== existing.time_elapsed) fields.time_elapsed = game.time_elapsed;

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
