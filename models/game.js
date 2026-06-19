const mongoose = require('../database');

const GameSchema = new mongoose.Schema({
    id: {
        type: String,
        required: true,
        unique: true
    },
    home_team_id: {
        type: String,
        required: true
    },
    away_team_id: {
        type: String,
        required: true
    },
    home_score: {
        type: String,
        default: "0"
    },
    away_score: {
        type: String,
        default: "0"
    },
    home_scorers: {
        type: String,
        default: "null"
    },
    away_scorers: {
        type: String,
        default: "null"
    },
    group: {
        type: String
    },
    matchday: {
        type: String
    },
    local_date: {
        type: String
    },
    persian_date: {
        type: String
    },
    stadium_id: {
        type: String,
        required: true
    },
    finished: {
        type: String,
        default: "FALSE"
    },
    time_elapsed: {
        type: String,
        default: "notstarted"
    },
    type: {
        type: String,
        default: "group"
    },
    home_team_label: {
        type: String,
        default: ""
    },
    away_team_label: {
        type: String,
        default: ""
    },
    homeTeam: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Team'
    },
    visitingTeam: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Team'
    },
    date: {
        type: Date,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updated_at: {
        type: Date,
        default: Date.now
    }
});

GameSchema.index({ updated_at: 1, id: 1 });

const Game = mongoose.model('Game', GameSchema);

module.exports = Game;
