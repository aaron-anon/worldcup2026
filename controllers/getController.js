const express = require('express');
const router = express.Router();

const Group = require('../models/group');
const Team = require('../models/team');
const Game = require('../models/game');
const Stadium = require('../models/stadium');
const MatchTable = require('../models/matchTable');
const { syncOnDemand } = require('../sync-live');

// Cache for teams (static data)
let teamsCache = null;
let teamsCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Cache for games (dynamic data, short TTL)
let gamesCache = null;
let gamesCacheTime = 0;
let gamesCacheCursor = null;
const GAMES_CACHE_TTL = 30 * 1000; // 30 seconds

function invalidateGamesCache() {
    gamesCache = null;
    gamesCacheTime = 0;
    gamesCacheCursor = null;
}

async function syncGamesOnRequest() {
    try {
        const result = await syncOnDemand();
        if (result.changed) {
            invalidateGamesCache();
        }
    } catch (error) {
        console.error('On-demand live sync failed:', error.message);
    }
}

function encodeCursor(date, id = '') {
    return `${date.toISOString()}|${id}`;
}

function decodeCursor(rawCursor) {
    if (!rawCursor || typeof rawCursor !== 'string') {
        return null;
    }

    const separatorIndex = rawCursor.indexOf('|');
    const timestamp = separatorIndex >= 0 ? rawCursor.slice(0, separatorIndex) : rawCursor;
    const id = separatorIndex >= 0 ? rawCursor.slice(separatorIndex + 1) : '';
    const date = new Date(timestamp);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return { date, id };
}

function cursorForGames(games, fallbackDate = new Date()) {
    if (!games.length) {
        return encodeCursor(fallbackDate, '');
    }

    const sortedGames = [...games].sort((a, b) => {
        const aTime = new Date(a.updated_at || fallbackDate).getTime();
        const bTime = new Date(b.updated_at || fallbackDate).getTime();
        if (aTime !== bTime) {
            return aTime - bTime;
        }
        return String(a.id).localeCompare(String(b.id));
    });

    const lastGame = sortedGames[sortedGames.length - 1];
    const lastUpdatedAt = new Date(lastGame.updated_at || fallbackDate);

    return encodeCursor(lastUpdatedAt, String(lastGame.id || ''));
}

async function enrichGamesWithNames(games) {
    const teamMap = await getTeamsMap();

    return games.map(game => {
        const enrichedGame = { ...game };

        if (enrichedGame.home_team_id && teamMap[enrichedGame.home_team_id]) {
            enrichedGame.home_team_name_en = teamMap[enrichedGame.home_team_id].name_en;
            enrichedGame.home_team_name_fa = teamMap[enrichedGame.home_team_id].name_fa;
        }

        if (enrichedGame.away_team_id && teamMap[enrichedGame.away_team_id]) {
            enrichedGame.away_team_name_en = teamMap[enrichedGame.away_team_id].name_en;
            enrichedGame.away_team_name_fa = teamMap[enrichedGame.away_team_id].name_fa;
        }

        return enrichedGame;
    });
}

async function getTeamsMap() {
    const now = Date.now();
    if (teamsCache && (now - teamsCacheTime) < CACHE_TTL) {
        return teamsCache;
    }
    
    const teams = await Team.find({}, 'id name_en name_fa').lean();
    const teamMap = {};
    teams.forEach(team => {
        teamMap[team.id] = {
            name_en: team.name_en,
            name_fa: team.name_fa
        };
    });
    
    teamsCache = teamMap;
    teamsCacheTime = now;
    return teamMap;
}

// Group Get Routes

/**
 * @swagger
 * /get/groups:
 *   get:
 *     summary: Get all groups
 *     description: Retrieve all World Cup 2026 groups (A-L)
 *     tags: [Groups]
 *     responses:
 *       200:
 *         description: List of all groups
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 groups:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Group'
 *       400:
 *         description: Error getting groups
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/groups', async(req,res) => {
    try{
        const groups = await Group.find();

        return res.send({groups});
    }catch(err){
        return res.status(400).send({
            error: 'Error getting all groups'
        });
    };
});

/**
 * @swagger
 * /get/group:
 *   get:
 *     summary: Get group by name
 *     description: Retrieve a specific group and its teams by name
 *     tags: [Groups]
 *     parameters:
 *       - in: query
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: Group name (A-L)
 *         example: A
 *     responses:
 *       200:
 *         description: Group details with teams
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 group:
 *                   $ref: '#/components/schemas/Group'
 *                 teams:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Team'
 *       400:
 *         description: Error getting group or no query declared
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/group', async(req,res) => {
    try{
        if(req.query.name == undefined){
            return res.status(400).send({
                error: 'Error no query declared'
            });
        };
        const group = await Group.findOne({name: req.query.name});
        const teams = await Team.find({group: group._id});

        return res.send({group, teams});
    }catch(err){
        return res.status(400).send({
            error: `Error getting group with name: ${req.query.name}`
        });
    };
});

router.get('/groups', async(req,res) => {
    try{
        const groups = await Group.find();

        return res.send({groups});
    }catch(err){
        return res.status(400).send({
            error: 'Error getting all groups'
        });
    };
});


// Team Get Routes

/**
 * @swagger
 * /get/teams:
 *   get:
 *     summary: Get all teams
 *     description: Retrieve all teams or filter by group
 *     tags: [Teams]
 *     parameters:
 *       - in: query
 *         name: group
 *         required: false
 *         schema:
 *           type: string
 *         description: Filter teams by group name (A-L)
 *         example: A
 *     responses:
 *       200:
 *         description: List of teams
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 teams:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Team'
 *                 group:
 *                   $ref: '#/components/schemas/Group'
 *       400:
 *         description: Error getting teams
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */

/**
 * @swagger
 * /get/team/{idTeam}:
 *   get:
 *     summary: Get team by ID
 *     description: Retrieve a specific team with group and games by ID
 *     tags: [Teams]
 *     parameters:
 *       - in: path
 *         name: idTeam
 *         required: true
 *         schema:
 *           type: string
 *         description: Team ID
 *     responses:
 *       200:
 *         description: Team details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 team:
 *                   $ref: '#/components/schemas/Team'
 *       400:
 *         description: Error getting team
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/team/:idTeam', async(req,res) => {
    try{
        const team = await Team.findById(req.params.idTeam).lean();

        return res.send({team});
    }catch(err){
        return res.send.status(400).send({
            error: `Error getting team with id:${req.params.idTeam}`
        });
    };
});

/**
 * @swagger
 * /get/team:
 *   get:
 *     summary: Get team by name
 *     description: Retrieve a specific team with group and games by name
 *     tags: [Teams]
 *     parameters:
 *       - in: query
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: Team name
 *         example: Brazil
 *     responses:
 *       200:
 *         description: Team details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 team:
 *                   $ref: '#/components/schemas/Team'
 *       400:
 *         description: Error getting team or no query declared
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/team', async(req,res) => {
    try{
        if(req.query.name == undefined){
            return res.status(400).send({
                error: 'Error no query declared'
            });
        };
        const name = req.query.name.charAt(0).toUpperCase() + req.query.name.slice(1);
        const team = await Team.findOne({name_en: name});

        return res.send({team});
    }catch(err){
        return res.status(400).send({
            error: `Error getting team with name: ${req.query.name}`
        });
    };
});

router.get('/teams', async(req,res) => {
    console.log('GET /teams called');
    try{
        let teams;
        console.log('Query params:', req.query);
        if(req.query.group) {
            console.log('Filtering by group:', req.query.group);
            teams = await Team.find({groups: req.query.group.toUpperCase()}).lean();
        } else {
            console.log('Getting all teams...');
            teams = await Team.find({}).lean();
            console.log('Found teams:', teams.length);
        }
        console.log('Sending response...');
        return res.status(200).json({teams});
    }catch(err){
        console.error('ERROR in /get/teams:', err);
        return res.status(400).json({
            error: 'Error getting all teams',
            details: err.message
        });
    }
});

// Game Get Routes

/**
 * @swagger
 * /get/games:
 *   get:
 *     summary: Get all games
 *     description: Retrieve all World Cup 2026 matches with team names
 *     tags: [Games]
 *     responses:
 *       200:
 *         description: List of all games with team names
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 games:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/Game'
 *                       - type: object
 *                         properties:
 *                           home_team_name_en:
 *                             type: string
 *                             description: Home team English name
 *                           home_team_name_fa:
 *                             type: string
 *                             description: Home team Persian name
 *                           away_team_name_en:
 *                             type: string
 *                             description: Away team English name
 *                           away_team_name_fa:
 *                             type: string
 *                             description: Away team Persian name
 *       400:
 *         description: Error getting games
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/games', async(req,res) => {
    try{
        await syncGamesOnRequest();

        // Return cached games if still fresh
        const now = Date.now();
        if (gamesCache && (now - gamesCacheTime) < GAMES_CACHE_TTL) {
            return res.send({
                games: gamesCache,
                nextCursor: gamesCacheCursor || encodeCursor(new Date(), '')
            });
        }

        const games = await Game.find({}).sort({ date: 1, id: 1 }).lean();
        const gamesWithNames = await enrichGamesWithNames(games);
        const nextCursor = cursorForGames(games, new Date());

        // Update cache
        gamesCache = gamesWithNames;
        gamesCacheTime = now;
        gamesCacheCursor = nextCursor;

        return res.send({games: gamesWithNames, nextCursor});
    }catch(err){
        return res.status(400).send({
            error: 'Error getting all games'
        });
    };
});

router.get('/games/delta', async (req, res) => {
    try {
        await syncGamesOnRequest();

        const decodedCursor = decodeCursor(req.query.since);

        if (!decodedCursor) {
            return res.status(400).send({
                error: 'Invalid or missing since cursor'
            });
        }

        const changedGames = await Game.find({
            $or: [
                { updated_at: { $gt: decodedCursor.date } },
                { updated_at: decodedCursor.date, id: { $gt: decodedCursor.id } }
            ]
        })
            .sort({ updated_at: 1, id: 1 })
            .limit(250)
            .lean();

        const games = await enrichGamesWithNames(changedGames);
        const nextCursor = changedGames.length > 0
            ? cursorForGames(changedGames, decodedCursor.date)
            : req.query.since;

        return res.send({ games, nextCursor });
    } catch (err) {
        return res.status(400).send({
            error: 'Error getting changed games'
        });
    }
});

/**
 * @swagger
 * /get/game/{idGame}:
 *   get:
 *     summary: Get game by ID
 *     description: Retrieve a specific game with teams by ID
 *     tags: [Games]
 *     parameters:
 *       - in: path
 *         name: idGame
 *         required: true
 *         schema:
 *           type: string
 *         description: Game ID
 *     responses:
 *       200:
 *         description: Game details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 game:
 *                   $ref: '#/components/schemas/Game'
 *       400:
 *         description: Error getting game
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/game/:idGame', async(req,res) => {
    try{
        const game = await Game.findById(req.params.idGame).lean();

        return res.send({game});
    }catch(err){
        return res.status(400).send({
            error: `Error getting game with id:${req.params.idGame}`
        })
    };
});

// Stadium Get Routes

/**
 * @swagger
 * /get/stadiums:
 *   get:
 *     summary: Get all stadiums
 *     description: Retrieve all World Cup 2026 stadiums
 *     tags: [Stadiums]
 *     responses:
 *       200:
 *         description: List of all stadiums
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 stadiums:
 *                   type: array
 *       400:
 *         description: Error getting stadiums
 */
router.get('/stadiums', async(req,res) => {
    try{
        const stadiums = await Stadium.find().lean();
        return res.status(200).json({stadiums});
    }catch(err){
        console.error('Error in /get/stadiums:', err);
        return res.status(400).json({
            error: 'Error getting all stadiums',
            details: err.message
        });
    }
});

/**
 * @swagger
 * /get/stadium/{id}:
 *   get:
 *     summary: Get stadium by ID
 *     description: Retrieve a specific stadium by ID
 *     tags: [Stadiums]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Stadium ID
 *     responses:
 *       200:
 *         description: Stadium details
 *       404:
 *         description: Stadium not found
 *       400:
 *         description: Error getting stadium
 */
router.get('/stadium/:id', async(req,res) => {
    try{
        const stadium = await Stadium.findOne({id: req.params.id});
        
        if (!stadium) {
            return res.status(404).json({
                error: `Stadium not found with id: ${req.params.id}`
            });
        }
        
        return res.status(200).json({stadium});
    }catch(err){
        console.error('Error in /get/stadium:', err);
        return res.status(400).json({
            error: `Error getting stadium with id: ${req.params.id}`,
            details: err.message
        });
    }
});

module.exports = app => app.use('/get', router);
