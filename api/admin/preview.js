"use strict";

const { buildGameweekPreview } = require("./_lib/tournament-engine");

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
        const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
        });
        if (!authResponse.ok) return send(res, 401, { error: "INVALID_SESSION" });

        const adminResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_site_admin`, {
            method: "POST",
            headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: "{}"
        });
        if (!adminResponse.ok || await adminResponse.json() !== true) {
            return send(res, 403, { error: "ACCESS_DENIED" });
        }

        const [players, gameweeks] = await Promise.all([
            db("players?select=id,name,status,hearts,is_infected,is_active&order=id.asc"),
            db("gameweeks?select=id,gw_number,chapter,status&order=gw_number.asc")
        ]);
        const pending = gameweeks
            .filter(row => String(row.status || "").toUpperCase() === "PENDING")
            .sort((a, b) => Number(a.gw_number) - Number(b.gw_number));
        const gameweek = pending[0] || null;
        if (!gameweek) return send(res, 404, { error: "PENDING_GAMEWEEK_NOT_FOUND" });

        const [matches, byes] = await Promise.all([
            db(`matches?select=id,gameweek_id,player_a_id,player_b_id,status&gameweek_id=eq.${encodeURIComponent(gameweek.id)}&order=id.asc`),
            db(`gameweek_byes?select=id,gameweek_id,player_id&gameweek_id=eq.${encodeURIComponent(gameweek.id)}`)
        ]);

        const host = req.headers["x-forwarded-host"] || req.headers.host;
        const protocol = req.headers["x-forwarded-proto"] || "https";
        if (!host) return send(res, 500, { error: "REQUEST_HOST_UNAVAILABLE" });
        const liveUrl = `${protocol}://${host}/api/live?gw=${encodeURIComponent(gameweek.gw_number)}`;
        const liveResponse = await fetch(liveUrl, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(15000)
        });
        const live = await liveResponse.json().catch(() => null);
        if (!liveResponse.ok || !live || live.ok !== true) {
            return send(res, 503, { error: "FPL_DATA_UNAVAILABLE", detail: live && live.error || "LIVE_API_FAILED" });
        }

        const preview = buildGameweekPreview({ gameweek, players, matches, byes, live });
        return send(res, 200, { success: true, preview });
    } catch (error) {
        const message = String(error && error.message || "PREVIEW_FAILED");
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
        console.error("Gameweek preview failed:", error);
        return send(res, 500, { error: "PREVIEW_FAILED" });
    }
};
