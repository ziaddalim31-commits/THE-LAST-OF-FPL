"use strict";

const { generateFixtures } = require("../_lib/fixture-generator");
const { buildGameweekPreview } = require("../_lib/tournament-engine");
const liveHandler = require("../live");
const { invokeLiveHandler } = require("../_lib/invoke-live-handler");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function send(res, status, data) {
    return res.status(status).json(data);
}

async function db(path) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        }
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error("DATABASE_READ_FAILED");
    return data;
}

async function requireAdmin(token) {
    const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
    });
    if (!authResponse.ok) return false;

    const adminResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_site_admin`, {
        method: "POST",
        headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
        },
        body: "{}"
    });
    return adminResponse.ok && await adminResponse.json() === true;
}

module.exports = async function handler(req, res) {
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return send(res, 405, { error: "METHOD_NOT_ALLOWED" });
    }
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
        return send(res, 500, { error: "SERVER_CONFIGURATION_ERROR" });
    }

    const authorization = req.headers.authorization || "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token) return send(res, 401, { error: "AUTHENTICATION_REQUIRED" });

    try {
        if (!await requireAdmin(token)) return send(res, 403, { error: "ACCESS_DENIED" });

        const [players, gameweeks, allMatches, allByes] = await Promise.all([
            db("players?select=id,name,status,hearts,is_infected,is_active&order=id.asc"),
            db("gameweeks?select=id,gw_number,chapter,status&order=gw_number.asc"),
            db("matches?select=id,gameweek_id,player_a_id,player_b_id,status&order=id.asc"),
            db("gameweek_byes?select=id,gameweek_id,player_id")
        ]);

        const gw10 = gameweeks.find(row => Number(row.gw_number) === 10);
        const gw11 = gameweeks.find(row => Number(row.gw_number) === 11);
        if (!gw10) return send(res, 404, { error: "GW10_NOT_FOUND" });
        if (!gw11) return send(res, 404, { error: "GW11_NOT_FOUND" });
        if (String(gw11.status || "").toUpperCase() !== "PENDING") {
            return send(res, 409, { error: "GW11_NOT_PENDING", detail: gw11.status });
        }

        const matches10 = allMatches.filter(row => String(row.gameweek_id) === String(gw10.id));
        const byes10 = allByes.filter(row => String(row.gameweek_id) === String(gw10.id));
        const matches11 = allMatches.filter(row => String(row.gameweek_id) === String(gw11.id));
        const byes11 = allByes.filter(row => String(row.gameweek_id) === String(gw11.id));

        if (matches11.length || byes11.length) {
            return send(res, 409, {
                error: "GW11_FIXTURES_ALREADY_EXIST",
                existing_matches: matches11.length,
                existing_byes: byes11.length
            });
        }

        let rosterForGw11 = players.map(player => ({ ...player }));
        let source = "GW10_ALREADY_COMPLETED";

        if (String(gw10.status || "").toUpperCase() === "PENDING") {
            if (!matches10.length) return send(res, 409, { error: "GW10_FIXTURES_MISSING" });

            const liveResult = await invokeLiveHandler(liveHandler, 10);
            const live = liveResult.payload;
            if (liveResult.statusCode < 200 || liveResult.statusCode >= 300 || live.ok !== true) {
                return send(res, 503, {
                    error: "GW10_FPL_DATA_UNAVAILABLE",
                    detail: live.detail || live.error || `LIVE_API_HTTP_${liveResult.statusCode}`
                });
            }

            const gw10Preview = buildGameweekPreview({
                gameweek: gw10,
                players,
                matches: matches10,
                byes: byes10,
                live
            });
            const updates = new Map(
                gw10Preview.player_updates.map(update => [String(update.player_id), update])
            );
            rosterForGw11 = rosterForGw11.map(player => {
                const update = updates.get(String(player.id));
                return update ? {
                    ...player,
                    status: update.status,
                    hearts: update.hearts,
                    is_infected: update.is_infected,
                    is_active: update.is_active
                } : player;
            });
            source = "GW10_READ_ONLY_RESULTS_PREVIEW";
        } else if (String(gw10.status || "").toUpperCase() !== "COMPLETED") {
            return send(res, 409, { error: "GW10_STATUS_NOT_READY", detail: gw10.status });
        }

        const historicalMatches = allMatches.filter(match => {
            const matchGameweek = gameweeks.find(row => String(row.id) === String(match.gameweek_id));
            return matchGameweek && Number(matchGameweek.gw_number) < 11;
        });

        const byePlayerId = req.query && req.query.bye_player_id
            ? String(req.query.bye_player_id)
            : null;

        const preview = generateFixtures({
            players: rosterForGw11,
            previousMatches: historicalMatches,
            byePlayerId
        });

        return send(res, 200, {
            success: true,
            gameweek: { id: gw11.id, gw_number: 11, chapter: gw11.chapter },
            roster_source: source,
            previous_gameweek: {
                gw_number: 10,
                status: gw10.status,
                simulated_in_memory: source === "GW10_READ_ONLY_RESULTS_PREVIEW"
            },
            history_checked_through: 10,
            preview
        });
    } catch (error) {
        const message = String(error && error.message || "FIXTURE_PREVIEW_FAILED");
        if (message.startsWith("UNRESOLVED_TIE:")) {
            return send(res, 409, { error: "GW10_TIE_UNRESOLVED", detail: message });
        }
        const known = [
            "PREVIEW_INPUT_INVALID", "GAMEWEEK_NOT_PENDING",
            "CHAPTER_RULESET_NOT_CONFIGURED", "FPL_GAMEWEEK_NOT_FINAL",
            "MATCH_ALREADY_COMPLETED", "FIXTURE_ROSTER_INVALID",
            "FIXTURE_COVERAGE_INCOMPLETE", "MULTIPLE_BYES_FOUND",
            "NO_MATCHES_FOUND", "FPL_PLAYER_POINTS_UNAVAILABLE",
            "FIXTURE_GENERATOR_INPUT_INVALID", "PLAYER_STATUS_INVALID",
            "NOT_ENOUGH_ACTIVE_PLAYERS", "BYE_PLAYER_SELECTION_REQUIRED",
            "BYE_PLAYER_NOT_ACTIVE", "BYE_NOT_REQUIRED",
            "ROSTER_TOO_LARGE", "REMATCH_FREE_SCHEDULE_IMPOSSIBLE",
            "FIXTURE_RECONSTRUCTION_FAILED"
        ];
        if (known.includes(message)) {
            return send(res, 409, {
                error: message,
                bye_candidates: error.bye_candidates || undefined
            });
        }
        console.error("GW11 fixture preview failed:", error);
        return send(res, 500, { error: "FIXTURE_PREVIEW_FAILED" });
    }
};
