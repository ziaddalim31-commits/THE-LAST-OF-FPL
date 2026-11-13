"use strict";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function send(res, status, data) {
    return res.status(status).json(data);
}

async function db(path, resource) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        }
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
        const error = new Error("HISTORY_READ_FAILED");
        error.diagnostic = {
            resource,
            status: response.status,
            code: String(data && data.code || "UNKNOWN"),
            message: String(data && data.message || "No database message").slice(0, 240)
        };
        throw error;
    }
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

        const [players, gameweeks, matches, byes, history] = await Promise.all([
            db("players?select=id,name", "players"),
            db("gameweeks?select=id,gw_number,chapter,status&order=gw_number.desc", "gameweeks"),
            db("matches?select=id,gameweek_id,player_a_id,player_b_id,points_a,points_b,winner_id,winner_method,tiebreak,status&order=id.asc", "matches"),
            db("gameweek_byes?select=id,gameweek_id,player_id", "gameweek_byes"),
            db("player_gameweek_history?select=gameweek_id,player_id,status_before,status_after,hearts_before,hearts_after,infected_before,infected_after,active_before,active_after,created_at&order=gameweek_id.desc,player_id.asc", "player_gameweek_history")
        ]);

        const playerById = new Map(players.map(player => [String(player.id), player]));
        const gameweekById = new Map(gameweeks.map(gameweek => [String(gameweek.id), gameweek]));

        const completedGameweeks = gameweeks
            .filter(gameweek => String(gameweek.status).toUpperCase() === "COMPLETED")
            .map(gameweek => ({
                ...gameweek,
                matches: matches
                    .filter(match => String(match.gameweek_id) === String(gameweek.id))
                    .map(match => ({
                        ...match,
                        player_a: playerById.get(String(match.player_a_id)) || null,
                        player_b: playerById.get(String(match.player_b_id)) || null,
                        winner: playerById.get(String(match.winner_id)) || null
                    })),
                byes: byes
                    .filter(bye => String(bye.gameweek_id) === String(gameweek.id))
                    .map(bye => ({
                        ...bye,
                        player: playerById.get(String(bye.player_id)) || null
                    })),
                player_history: history
                    .filter(row => String(row.gameweek_id) === String(gameweek.id))
                    .map(row => ({
                        ...row,
                        player: playerById.get(String(row.player_id)) || null
                    }))
            }));

        return send(res, 200, {
            success: true,
            gameweeks: completedGameweeks,
            totals: {
                completed_gameweeks: completedGameweeks.length,
                completed_matches: matches.filter(match => String(match.status).toUpperCase() === "COMPLETED").length,
                history_rows: history.length
            }
        });
    } catch (error) {
        if (error && error.diagnostic) {
            console.error("Round history read failed:", error.diagnostic);
            return send(res, 503, {
                error: "HISTORY_READ_FAILED",
                diagnostic: error.diagnostic
            });
        }
        console.error("Round history failed:", error);
        return send(res, 500, { error: "HISTORY_LOAD_FAILED" });
};
