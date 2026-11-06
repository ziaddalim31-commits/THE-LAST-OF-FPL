"use strict";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function send(res, status, data) {
  return res.status(status).json(data);
}

async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...options.headers
    }
  });

  const result = await response.json().catch(() => null);

  if (!response.ok) {
    console.error("Supabase request failed:", response.status, result);
    throw new Error("DATABASE_REQUEST_FAILED");
  }

  return result;
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
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  if (!token) {
    return send(res, 401, { error: "AUTHENTICATION_REQUIRED" });
  }

  try {
    // 1. Verify the user's access token with Supabase Auth.
    const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`
      }
    });

    if (!authResponse.ok) {
      return send(res, 401, { error: "INVALID_SESSION" });
    }

    const user = await authResponse.json();

    // 2. Verify that this authenticated user is a site administrator.
    const adminResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/is_site_admin`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: "{}"
      }
    );

    if (!adminResponse.ok) {
      return send(res, 403, { error: "ADMIN_VERIFICATION_FAILED" });
    }

    const isAdmin = await adminResponse.json();

    if (isAdmin !== true) {
      return send(res, 403, { error: "ACCESS_DENIED" });
    }

    // 3. Load the current player records.
    const players = await supabaseRequest(
      "players?select=id,name,status,hearts,is_infected,is_active&order=id.asc"
    );

    // 4. Find GW10.
    const gameweeks = await supabaseRequest(
      "gameweeks?select=id,gw_number,chapter,status&gw_number=eq.10&limit=1"
    );

    if (!gameweeks || gameweeks.length === 0) {
      return send(res, 404, { error: "GW10_NOT_FOUND" });
    }

    const gameweek = gameweeks[0];

    // 5. Load GW10 matches.
    const matches = await supabaseRequest(
      `matches?select=id,gameweek_id,player_a_id,player_b_id,points_a,points_b,winner_id,status&gameweek_id=eq.${gameweek.id}&order=id.asc`
    );

    // 6. Load the GW10 BYE record.
    const byes = await supabaseRequest(
      `gameweek_byes?select=id,gameweek_id,player_id&gameweek_id=eq.${gameweek.id}`
    );

    const byeRecords = byes.map((bye) => ({
      ...bye,
      player: players.find((player) => player.id === bye.player_id) || null
    }));

    // 7. Attach player names to each match.
    const enrichedMatches = matches.map((match) => ({
      ...match,
      player_a: players.find(
        (player) => player.id === match.player_a_id
      ) || null,
      player_b: players.find(
        (player) => player.id === match.player_b_id
      ) || null
    }));

    return send(res, 200, {
      success: true,
      admin: {
        id: user.id,
        email: user.email
      },
      gameweek,
      players,
      matches: enrichedMatches,
      byes: byeRecords
    });

  } catch (error) {
    console.error("Admin API error:", error);
    return send(res, 500, { error: "INTERNAL_SERVER_ERROR" });
  }
};