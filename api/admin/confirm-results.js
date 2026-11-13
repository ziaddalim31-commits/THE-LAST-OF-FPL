"use strict";

const { createHash, timingSafeEqual } = require("crypto");
const liveHandler = require("../live");
const { invokeLiveHandler } = require("../_lib/invoke-live-handler");
const { buildGameweekPreview } = require("../_lib/tournament-engine");

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

function sameToken(a, b) {
    if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
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
        if (!body.preview_token) return send(res, 400, { error: "PREVIEW_TOKEN_REQUIRED" });

        const [players, gameweeks] = await Promise.all([
            db("players?select=id,name,status,hearts,is_infected,is_active&order=id.asc"),
            db("gameweeks?select=id,gw_number,chapter,status&order=gw_number.asc")
        ]);

        const gameweek = gameweeks
            .filter(row => String(row.status || "").trim().toUpperCase() === "PENDING")
            .sort((a, b) => Number(a.gw_number) - Number(b.gw_number))[0];

        if (!gameweek) return send(res, 404, { error: "PENDING_GAMEWEEK_NOT_FOUND" });

        const [matches, byes] = await Promise.all([
            db(`matches?select=id,gameweek_id,player_a_id,player_b_id,status&gameweek_id=eq.${encodeURIComponent(gameweek.id)}&order=id.asc`),
            db(`gameweek_byes?select=id,gameweek_id,player_id&gameweek_id=eq.${encodeURIComponent(gameweek.id)}`)
        ]);

        const liveResult = await invokeLiveHandler(liveHandler, gameweek.gw_number);
        const live = liveResult.payload;
        if (liveResult.statusCode < 200 || liveResult.statusCode >= 300 || live.ok !== true) {
            return send(res, 503, {
                error: "FPL_DATA_UNAVAILABLE",
                detail: live.detail || live.error || `LIVE_API_HTTP_${liveResult.statusCode}`
            });
        }

        const preview = buildGameweekPreview({ gameweek, players, matches, byes, live });
        const currentToken = createHash("sha256")
            .update(JSON.stringify({ gameweek_id: gameweek.id, results: preview.results, player_updates: preview.player_updates }))
            .digest("hex");

        if (!sameToken(body.preview_token, currentToken)) {
            return send(res, 409, {
                error: "PREVIEW_EXPIRED",
                detail: "The live results or tournament state changed. Generate a fresh preview before confirming."
            });
        }

        const rpcResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/confirm_gameweek_results`, {
            method: "POST",
            headers: {
                apikey: SUPABASE_SERVICE_ROLE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                p_gameweek_id: gameweek.id,
                p_results: preview.results.map(result => ({
                    match_id: result.match_id,
                    points_a: result.points_a,
                    points_b: result.points_b,
                    winner_id: result.winner_id,
                    winner_method: result.winner_method,
                    tiebreak: result.tiebreak
                })),
                p_player_updates: preview.player_updates
            })
        });
        const rpcData = await rpcResponse.json().catch(() => null);

        if (!rpcResponse.ok) {
            const message = String(rpcData && (rpcData.message || rpcData.details) || "");
            if (message.includes("confirm_gameweek_results") || message.includes("schema cache")) {
                return send(res, 503, { error: "WORKFLOW_SCHEMA_NOT_INSTALLED" });
            }
            if (/NOT_PENDING|CHANGED_SINCE_PREVIEW|RACE|COUNT_MISMATCH|COVERAGE|INVALID|DUPLICATE/.test(message)) {
                return send(res, 409, { error: "CONFIRMATION_REJECTED", detail: message });
            }
            console.error("Gameweek confirmation RPC failed:", rpcData);
            return send(res, 500, { error: "CONFIRMATION_FAILED" });
        }

        return send(res, 200, {
            success: true,
            confirmation: rpcData,
            gameweek: { id: gameweek.id, gw_number: gameweek.gw_number }
        });
    } catch (error) {
        const message = String(error && error.message || "CONFIRMATION_FAILED");
        if (message.startsWith("UNRESOLVED_TIE:")) {
            return send(res, 409, { error: "UNRESOLVED_TIE", detail: message });
        }
        const known = [
            "GAMEWEEK_NOT_PENDING", "CHAPTER_RULESET_NOT_CONFIGURED",
            "FPL_GAMEWEEK_NOT_FINAL", "MATCH_ALREADY_COMPLETED",
            "FIXTURE_ROSTER_INVALID", "FIXTURE_COVERAGE_INCOMPLETE",
            "MULTIPLE_BYES_FOUND", "NO_MATCHES_FOUND",
            "FPL_PLAYER_POINTS_UNAVAILABLE", "PREVIEW_INPUT_INVALID"
        ];
        if (known.includes(message)) return send(res, 409, { error: message });
        console.error("Gameweek confirmation failed:", error);
        return send(res, 500, { error: "CONFIRMATION_FAILED" });
    }
};
