"use strict";

const { generateFixtures, pairKey } = require("../_lib/fixture-generator");

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

        const [players, gameweeks, allMatches, allByes] = await Promise.all([
            db("players?select=id,name,status,hearts,is_infected,is_active&order=id.asc"),
            db("gameweeks?select=id,gw_number,chapter,status&order=gw_number.asc"),
            db("matches?select=id,gameweek_id,player_a_id,player_b_id,status&order=id.asc"),
            db("gameweek_byes?select=id,gameweek_id,player_id")
        ]);

        const gameweek = gameweeks
            .filter(row => String(row.status || "").trim().toUpperCase() === "PENDING")
            .sort((a, b) => Number(a.gw_number) - Number(b.gw_number))[0];
        if (!gameweek) return send(res, 404, { error: "PENDING_GAMEWEEK_NOT_FOUND" });
        if (Number(gameweek.gw_number) !== 11) {
            return send(res, 409, { error: "FIXTURE_SAVE_SUPPORTED_GW11_ONLY" });
        }

        const previousGameweek = gameweeks.find(row => Number(row.gw_number) === 10);
        if (!previousGameweek) return send(res, 404, { error: "GW10_NOT_FOUND" });

        if (String(previousGameweek.status || "").toUpperCase() === "PENDING") {
            return send(res, 409, {
                error: "PREVIOUS_GAMEWEEK_MUST_BE_CONFIRMED",
                detail: "Confirm GW10 results first. Then regenerate and approve the GW11 fixtures using the updated survivor roster."
            });
        }
        if (String(previousGameweek.status || "").toUpperCase() !== "COMPLETED") {
            return send(res, 409, { error: "GW10_STATUS_NOT_READY" });
        }

        const roster = players.map(player => ({ ...player }));

        const existingForCurrent = allMatches.some(row => String(row.gameweek_id) === String(gameweek.id)) ||
            allByes.some(row => String(row.gameweek_id) === String(gameweek.id));
        if (existingForCurrent) return send(res, 409, { error: "FIXTURES_ALREADY_EXIST" });

        const previousMatches = allMatches.filter(match => {
            const matchGw = gameweeks.find(row => String(row.id) === String(match.gameweek_id));
            return matchGw && Number(matchGw.gw_number) < 11;
        });

        const byePlayerId = body.bye_player_id === null || body.bye_player_id === undefined || body.bye_player_id === ""
            ? null
            : String(body.bye_player_id);

        const generated = generateFixtures({
            players: roster,
            previousMatches,
            byePlayerId
        });

        const submittedPairs = normalizedPairSet(body.fixtures);
        const generatedPairs = normalizedPairSet(generated.matches);
        if (submittedPairs.size !== generatedPairs.size ||
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
            gameweek: { id: gameweek.id, gw_number: gameweek.gw_number },
            saved: rpcData
        });
    } catch (error) {
        const message = String(error && error.message || "FIXTURE_SAVE_FAILED");
        const known = [
            "FIXTURE_GENERATOR_INPUT_INVALID", "PLAYER_STATUS_INVALID",
            "NOT_ENOUGH_ACTIVE_PLAYERS", "BYE_PLAYER_SELECTION_REQUIRED",
            "BYE_PLAYER_NOT_ACTIVE", "BYE_NOT_REQUIRED",
            "ROSTER_TOO_LARGE", "REMATCH_FREE_SCHEDULE_IMPOSSIBLE",
            "FIXTURE_RECONSTRUCTION_FAILED", "GAMEWEEK_NOT_PENDING",
            "CHAPTER_RULESET_NOT_CONFIGURED", "FPL_GAMEWEEK_NOT_FINAL",
            "MATCH_ALREADY_COMPLETED", "FIXTURE_ROSTER_INVALID",
            "FIXTURE_COVERAGE_INCOMPLETE", "MULTIPLE_BYES_FOUND",
            "NO_MATCHES_FOUND", "FPL_PLAYER_POINTS_UNAVAILABLE",
            "PREVIEW_INPUT_INVALID"
        ];
        if (known.includes(message) || message.startsWith("UNRESOLVED_TIE:")) {
            return send(res, 409, { error: message });
        }
        console.error("GW11 fixture save failed:", error);
        return send(res, 500, { error: "FIXTURE_SAVE_FAILED" });
    }
};
