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

        const pendingGameweeks = gameweeks
            .filter(row => String(row.status || "").trim().toUpperCase() === "PENDING")
            .sort((a, b) => Number(a.gw_number) - Number(b.gw_number));

        // Generate fixtures for the earliest pending gameweek that has no
        // fixtures yet and directly follows the earliest unresolved round.
        // This lets GW11 be previewed while GW10 is still pending, without
        // accidentally skipping an unresolved gameweek.
        const pendingGameweek = pendingGameweeks.find(row => {
            const candidateGw = Number(row.gw_number);
            const previous = gameweeks.find(item => Number(item.gw_number) === candidateGw - 1);
            const hasFixtures = allMatches.some(match => String(match.gameweek_id) === String(row.id)) ||
                allByes.some(bye => String(bye.gameweek_id) === String(row.id));
            const earlierPending = pendingGameweeks.some(item => Number(item.gw_number) < candidateGw - 1);
            return !hasFixtures && previous &&
                ["PENDING", "COMPLETED"].includes(String(previous.status || "").toUpperCase()) &&
                !earlierPending;
        });

        if (!pendingGameweek) {
            return send(res, 409, {
                error: pendingGameweeks.length
                    ? "NEXT_GAMEWEEK_FIXTURE_TARGET_NOT_AVAILABLE"
                    : "PENDING_GAMEWEEK_NOT_FOUND",
                pending_gameweeks: pendingGameweeks.map(row => ({
                    gw_number: row.gw_number,
                    status: row.status,
                    has_fixtures: allMatches.some(match => String(match.gameweek_id) === String(row.id)) ||
                        allByes.some(bye => String(bye.gameweek_id) === String(row.id))
                }))
            });
        }

        const currentGw = Number(pendingGameweek.gw_number);
        if (!Number.isInteger(currentGw) || currentGw < 2 || currentGw > 38) {
            return send(res, 409, { error: "CURRENT_GAMEWEEK_INVALID" });
        }

        const previousGameweek = gameweeks.find(row => Number(row.gw_number) === currentGw - 1);
        if (!previousGameweek) {
            return send(res, 404, { error: "PREVIOUS_GAMEWEEK_NOT_FOUND", previous_gw: currentGw - 1 });
        }

        let rosterForCurrent = players.map(player => ({ ...player }));
        let source = "PREVIOUS_GAMEWEEK_ALREADY_COMPLETED";

        if (String(previousGameweek.status || "").toUpperCase() === "PENDING") {
            const previousMatches = allMatches.filter(row => String(row.gameweek_id) === String(previousGameweek.id));
            const previousByes = allByes.filter(row => String(row.gameweek_id) === String(previousGameweek.id));
            if (!previousMatches.length) {
                return send(res, 409, { error: "PREVIOUS_GAMEWEEK_FIXTURES_MISSING", previous_gw: currentGw - 1 });
            }

            const liveResult = await invokeLiveHandler(liveHandler, currentGw - 1);
            const live = liveResult.payload;
            if (liveResult.statusCode < 200 || liveResult.statusCode >= 300 || live.ok !== true) {
                return send(res, 503, {
                    error: "PREVIOUS_GAMEWEEK_FPL_DATA_UNAVAILABLE",
                    detail: live.detail || live.error || `LIVE_API_HTTP_${liveResult.statusCode}`
                });
            }

            const previousPreview = buildGameweekPreview({
                gameweek: previousGameweek,
                players,
                matches: previousMatches,
                byes: previousByes,
                live
            });
            const updates = new Map(
                previousPreview.player_updates.map(update => [String(update.player_id), update])
            );
            rosterForCurrent = rosterForCurrent.map(player => {
                const update = updates.get(String(player.id));
                return update ? {
                    ...player,
                    status: update.status,
                    hearts: update.hearts,
                    is_infected: update.is_infected,
                    is_active: update.is_active
                } : player;
            });
            source = `GW${currentGw - 1}_READ_ONLY_RESULTS_PREVIEW`;
        } else if (String(previousGameweek.status || "").toUpperCase() !== "COMPLETED") {
            return send(res, 409, {
                error: "PREVIOUS_GAMEWEEK_STATUS_NOT_READY",
                previous_gw: currentGw - 1,
                status: previousGameweek.status
            });
        }

        const historicalMatches = allMatches.filter(match => {
            const matchGameweek = gameweeks.find(row => String(row.id) === String(match.gameweek_id));
            return matchGameweek && Number(matchGameweek.gw_number) < currentGw;
        });

        const byePlayerId = req.query && req.query.bye_player_id
            ? String(req.query.bye_player_id)
            : null;

        const preview = generateFixtures({
            players: rosterForCurrent,
            previousMatches: historicalMatches,
            byePlayerId
        });

        return send(res, 200, {
            success: true,
            gameweek: { id: pendingGameweek.id, gw_number: currentGw, chapter: pendingGameweek.chapter },
            roster_source: source,
            previous_gameweek: {
                gw_number: currentGw - 1,
                status: previousGameweek.status,
                simulated_in_memory: source === `GW${currentGw - 1}_READ_ONLY_RESULTS_PREVIEW`
            },
            history_checked_through: currentGw - 1,
            preview
        });
    } catch (error) {
        const message = String(error && error.message || "FIXTURE_PREVIEW_FAILED");
        if (message.startsWith("UNRESOLVED_TIE:")) {
            return send(res, 409, { error: "PREVIOUS_GAMEWEEK_TIE_UNRESOLVED", detail: message });
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
        console.error("Next gameweek fixture preview failed:", error);
        return send(res, 500, { error: "FIXTURE_PREVIEW_FAILED" });
    }
};
