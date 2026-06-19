# Auto Live Updater for World Cup 2026

Automatically fetches **real-time match data** from [Varzesh3](https://www.varzesh3.com) and updates the MongoDB database. No more manual score entry — scores, scorers, and standings update automatically during live matches.

## Features

- ⚡ **Real-time scores** — updates every 3 seconds during live matches
- ⚽ **Goal scorers** with English names (114+ players mapped)
- 🟡 **Penalty goals** detected and marked with `(p)`
- 📊 **Group standings** auto-calculated after each match finishes
- 🌐 **Persian → English** team and player name translation
- 🔄 **Self-healing** — unknown players saved for later manual mapping

## How It Works

```
Varzesh3 API (web-api.varzesh3.com)
       ↓ every 3 seconds
auto-updater.js
       ↓ matches teams by Persian name → team_id
MongoDB (your worldcup2026 database)
       ↓ recalculates standings when match finishes
Your API serves updated data
```

## Setup

1. Make sure MongoDB is running and the database is seeded (see main README)

2. Install dependencies:
```bash
npm install mongodb
```

3. Start the updater:
```bash
node scripts/auto-updater.js
```

Or with PM2:
```bash
pm2 start scripts/auto-updater.js --name wc-updater
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGO_URI` | `mongodb://127.0.0.1:27017` | MongoDB connection string |
| `DB_NAME` | `football` | Database name |
| `POLL_INTERVAL` | `3000` | Polling interval in ms |

## Player Names

The file `data/player-names.json` maps Varzesh3 player IDs to English names:

```json
{
  "1546": "Lionel Messi",
  "93508": "Kylian Mbappé",
  "37814": "Harry Kane"
}
```

When a new player scores and isn't in the database, their Persian name is saved as a placeholder. You can manually update it with the correct English name — no restart needed, the file is re-read on next goal.

## Team Name Mapping

`data/team-name-map.json` handles variations in Persian team names from Varzesh3:

```json
{
  "انگلستان": "England",
  "انگلیس": "England"
}
```

## Data Source

[Varzesh3](https://www.varzesh3.com/livescore) is one of Iran's largest sports websites. Their internal API (`web-api.varzesh3.com`) provides:
- Live match scores and status
- Match events (goals, cards, substitutions)
- Player IDs for scorer identification

The API is free, requires no authentication, and updates reliably during matches.

## Contributing

Found a player showing in Persian? Add their English name to `data/player-names.json`:
1. Check the console output for the player ID
2. Add `"PLAYER_ID": "English Name"` to the JSON file
3. The updater picks it up automatically

## Credits

- Original project: [rezarahiminia/worldcup2026](https://github.com/rezarahiminia/worldcup2026)
- Live data source: [Varzesh3](https://www.varzesh3.com)
- Auto-updater by: [Nexu Team](https://app.nexuhub.net)
