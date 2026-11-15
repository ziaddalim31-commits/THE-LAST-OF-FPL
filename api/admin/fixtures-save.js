"use strict";

const { generateFixtures, pairKey, filterPreviousMatchesToChapter } = require("../_lib/fixture-generator");
const { selectNextFixtureGameweek, isPreviousGameweekConfirmed } = require("../_lib/next-gameweek");
const { auditCompletedHistory } = require("../_lib/history-integrity");

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

function normalizedPairSet(fixtures) {
    return new Set(fixtures.map(match => pairKey(match.player_a_id, match.player_b_id)));
}

module.exports = async function handler(req, res) {
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
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

        const body = req.body && typeof req.body === "object"
            ? req.body
            : (typeof req.body === "string" ? JSON.parse(req.body) : {});
        if (!Array.isArray(body.fixtures) || body.fixtures.length === 0) {
            return send(res, 400, { error: "FIXTURE_APPROVAL_PAYLOAD_REQUIRED" });
        }

        const [players, gameweeks, allMatches, allByes, history] = await Promise.all([
            db("players?select=id,name,status,hearts,is_infected,is_active&order=id.asc"),
            db("gameweeks?select=id,gw_number,chapter,status&order=gw_number.asc"),
            db("matches?select=id,gameweek_id,player_a_id,player_b_id,points_a,points_b,winner_id,winner_method,status&order=id.asc"),
            db("gameweek_byes?select=id,gameweek_id,player_id"),
            db("player_gameweek_history?select=gameweek_id,player_id,status_before,status_after,hearts_before,hearts_after,infected_before,infected_after,active_before,active_after&order=gameweek_id.asc,player_id.asc")
        ]);

        const pendingGameweeks = gameweeks
            .filter(row => String(row.status || "").trim().toUpperCase() === "PENDING")
            .sort((a, b) => Number(a.gw_number) - Number(b.gw_number));
        const gameweek = selectNextFixtureGameweek(gameweeks, allMatches, allByes);
        if (!gameweek) {
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

        const currentGw = Number(gameweek.gw_number);
        if (!Number.isInteger(currentGw) || currentGw < 2 || currentGw > 38) {
            return send(res, 409, { error: "CURRENT_GAMEWEEK_INVALID" });
        }

        const previousGameweek = gameweeks.find(row => Number(row.gw_number) === currentGw - 1);
        if (!previousGameweek) {
            return send(res, 404, { error: "PREVIOUS_GAMEWEEK_NOT_FOUND", previous_gw: currentGw - 1 });
        }
        if (!isPreviousGameweekConfirmed(gameweeks, gameweek)) {
            return send(res, 409, {
                error: "PREVIOUS_GAMEWEEK_MUST_BE_CONFIRMED",
                previous_gw: previousGameweek.gw_number,
                status: previousGameweek.status,
                detail: `GW${previousGameweek.gw_number} must be confirmed before GW${currentGw} fixtures can be saved. Generate a fresh fixture preview after confirming the previous round.`
            });
        }

        const historyAudit = auditCompletedHistory({
            gameweeks,
            matches: allMatches,
            byes: allByes,
            history,
            throughGameweek: currentGw - 1
        });
        if (!historyAudit.ok) {
            return send(res, 409, {
                error: "HISTORY_INTEGRITY_FAILED",
                detail: `${historyAudit.code} at GW${historyAudit.gameweek || currentGw - 1}. Fixtures were not saved.`,
                audit: historyAudit
            });
        }

        const existingForCurrent = allMatches.some(row => String(row.gameweek_id) === String(gameweek.id)) ||
            allByes.some(row => String(row.gameweek_id) === String(gameweek.id));
        if (existingForCurrent) return send(res, 409, { error: "FIXTURES_ALREADY_EXIST", gameweek: currentGw });

        const previousMatches = filterPreviousMatchesToChapter(allMatches, gameweeks, gameweek);

        const byePlayerId = body.bye_player_id === null || body.bye_player_id === undefined || body.bye_player_id === ""
            ? null
            : String(body.bye_player_id);

        const generated = generateFixtures({
            players,
            previousMatches,
            byePlayerId
        });

        const submittedPairs = normalizedPairSet(body.fixtures);
        const generatedPairs = normalizedPairSet(generated.matches);
        if (body.fixtures.length !== generated.matches.length ||
            submittedPairs.size !== generatedPairs.size ||
            [...generatedPairs].some(pair => !submittedPairs.has(pair))) {
            return send(res, 409, {
                error: "FIXTURE_PREVIEW_MISMATCH",
                detail: "The proposed schedule differs from the server-generated preview. Generate a fresh preview."
            });
        }

        const rpcResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/save_gameweek_fixtures`, {
            method: "POST",
            headers: {
                apikey: SUPABASE_SERVICE_ROLE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                p_gameweek_id: gameweek.id,
                p_fixtures: generated.matches.map(match => ({
                    player_a_id: match.player_a_id,
                    player_b_id: match.player_b_id
                })),
                p_bye_player_id: generated.bye ? generated.bye.player_id : null
            })
        });
        const rpcData = await rpcResponse.json().catch(() => null);
        if (!rpcResponse.ok) {
            const message = String(rpcData && (rpcData.message || rpcData.details) || "");
            if (message.includes("save_gameweek_fixtures") || message.includes("schema cache")) {
                return send(res, 503, { error: "WORKFLOW_SCHEMA_NOT_INSTALLED" });
            }
            if (/ALREADY_EXIST|NOT_PENDING|INVALID|COVERAGE|REMATCH/.test(message)) {
                return send(res, 409, { error: "FIXTURE_SAVE_REJECTED", detail: message });
            }
            console.error("Fixture save RPC failed:", rpcData);
            return send(res, 500, { error: "FIXTURE_SAVE_FAILED" });
        }

        return send(res, 200, {
            success: true,
            gameweek: { id: gameweek.id, gw_number: currentGw },
            saved: rpcData
        });
    } catch (error) {
        const message = String(error && error.message || "FIXTURE_SAVE_FAILED");
        const known = [
            "FIXTURE_GENERATOR_INPUT_INVALID", "PLAYER_STATUS_INVALID",
            "NOT_ENOUGH_ACTIVE_PLAYERS", "BYE_PLAYER_SELECTION_REQUIRED",
            "BYE_PLAYER_NOT_ACTIVE", "BYE_NOT_REQUIRED",
            "ROSTER_TOO_LARGE", "REMATCH_FREE_SCHEDULE_IMPOSSIBLE",
            "FIXTURE_RECONSTRUCTION_FAILED", "CHAPTER_MATCH_HISTORY_INPUT_INVALID", "GAMEWEEK_CHAPTER_REQUIRED"
        ];
        if (known.includes(message)) return send(res, 409, { error: message });
        console.error("Next gameweek fixture save failed:", error);
        return send(res, 500, { error: "FIXTURE_SAVE_FAILED" });
    }
};
