"use strict";

const { saveNextGameweekFixtures } = require("../_lib/fixture-save-service");

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

async function saveFixtures({ gameweekId, fixtures, byePlayerId }) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/save_gameweek_fixtures`, {
        method: "POST",
        headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            p_gameweek_id: gameweekId,
            p_fixtures: fixtures,
            p_bye_player_id: byePlayerId
        })
    });
    const data = await response.json().catch(() => null);
    if (response.ok) return { ok: true, data };
    const message = String(data && (data.message || data.details) || "");
    return { ok: false, message, code: /ALREADY_EXIST/i.test(message) ? "FIXTURES_ALREADY_EXIST" : undefined };
}

const GENERATION_CODES = new Set([
    "FIXTURE_GENERATOR_INPUT_INVALID", "PLAYER_STATUS_INVALID",
    "NOT_ENOUGH_ACTIVE_PLAYERS", "BYE_PLAYER_SELECTION_REQUIRED",
    "BYE_PLAYER_NOT_ACTIVE", "BYE_NOT_REQUIRED",
    "ROSTER_TOO_LARGE", "REMATCH_FREE_SCHEDULE_IMPOSSIBLE",
    "FIXTURE_RECONSTRUCTION_FAILED", "CHAPTER_MATCH_HISTORY_INPUT_INVALID", "GAMEWEEK_CHAPTER_REQUIRED"
]);

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

        const byePlayerId = body.bye_player_id === null || body.bye_player_id === undefined || body.bye_player_id === ""
            ? null
            : String(body.bye_player_id);

        const result = await saveNextGameweekFixtures({
            db, saveFixtures, byePlayerId, expectedFixtures: body.fixtures
        });

        switch (result.status) {
            case "SAVED":
                return send(res, 200, {
                    success: true,
                    gameweek: result.gameweek,
                    saved: { matches_created: result.matches_created }
                });
            case "ALREADY_SAVED":
                return send(res, 409, {
                    error: "FIXTURES_ALREADY_EXIST",
                    gameweek: result.gameweek && result.gameweek.gw_number
                });
            case "NO_PENDING_GAMEWEEK":
                if (result.pending_gameweeks && result.pending_gameweeks.length) {
                    return send(res, 409, {
                        error: "NEXT_GAMEWEEK_FIXTURE_TARGET_NOT_AVAILABLE",
                        pending_gameweeks: result.pending_gameweeks
                    });
                }
                return send(res, 409, { error: "PENDING_GAMEWEEK_NOT_FOUND" });
            case "PREVIEW_MISMATCH":
                return send(res, 409, {
                    error: result.code,
                    detail: "The proposed schedule differs from the server-generated preview. Generate a fresh preview."
                });
            case "INVALID_TARGET":
                return send(res, 409, { error: result.code });
            case "PREVIOUS_NOT_READY":
                if (result.code === "PREVIOUS_GAMEWEEK_NOT_FOUND") {
                    return send(res, 404, { error: result.code, previous_gw: result.previous_gw });
                }
                return send(res, 409, {
                    error: result.code,
                    previous_gw: result.previous_gw,
                    status: result.previous_status,
                    detail: `GW${result.previous_gw} must be confirmed before the next gameweek fixtures can be saved. Generate a fresh fixture preview after confirming the previous round.`
                });
            case "HISTORY_FAILED":
                return send(res, 409, {
                    error: result.code,
                    detail: `${result.audit.code} at GW${result.audit.gameweek || (result.gameweek.gw_number - 1)}. Fixtures were not saved.`,
                    audit: result.audit
                });
            case "PARTIAL_FIXTURES":
                return send(res, 409, { error: result.code, detail: result.detail });
            case "GENERATION_FAILED":
                return send(res, 409, { error: result.code, bye_candidates: result.bye_candidates });
            case "SAVE_FAILED":
            default:
                if (result.code === "FIXTURE_SAVE_REJECTED") {
                    return send(res, 409, { error: result.code, detail: result.detail });
                }
                if (result.code === "WORKFLOW_SCHEMA_NOT_INSTALLED") {
                    return send(res, 503, { error: result.code });
                }
                console.error("Fixture save failed:", result);
                return send(res, 500, { error: "FIXTURE_SAVE_FAILED" });
        }
    } catch (error) {
        const message = String(error && error.message || "FIXTURE_SAVE_FAILED");
        if (message.includes("save_gameweek_fixtures") || message.includes("schema cache")) {
            return send(res, 503, { error: "WORKFLOW_SCHEMA_NOT_INSTALLED" });
        }
        if (GENERATION_CODES.has(message)) return send(res, 409, { error: message });
        if (message === "DATABASE_READ_FAILED") {
            console.error("Next gameweek fixture save read failed:", error);
            return send(res, 500, { error: "FIXTURE_SAVE_FAILED" });
        }
        console.error("Next gameweek fixture save failed:", error);
        return send(res, 500, { error: "FIXTURE_SAVE_FAILED" });
    }
};