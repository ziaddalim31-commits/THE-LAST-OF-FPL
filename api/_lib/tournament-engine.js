"use strict";

function normalizeStatus(value) {
    const status = String(value || "NORMAL").trim().toUpperCase();
    return ["SAFE", "NORMAL", "DANGER"].includes(status) ? status : "NORMAL";
}

function isActive(player) {
    return player && player.is_active !== false && Number(player.hearts) > 0;
}

function getScore(livePlayer) {
    const value = livePlayer && livePlayer.points;
    return value === null || value === undefined || value === "" || !Number.isFinite(Number(value))
        ? null
        : Number(value);
}

function resolveTie(a, b, liveA, liveB) {
    const viceA = liveA && liveA.vice_captain_points;
    const viceB = liveB && liveB.vice_captain_points;

    if (!Number.isFinite(Number(viceA)) || !Number.isFinite(Number(viceB)) ||
        viceA === null || viceA === undefined || viceB === null || viceB === undefined) {
        return { winner: null, method: "UNRESOLVED", reason: "VICE_CAPTAIN_DATA_MISSING" };
    }

    if (Number(viceA) !== Number(viceB)) {
        return {
            winner: Number(viceA) > Number(viceB) ? a.id : b.id,
            method: "VICE_CAPTAIN_POINTS",
            values: { [String(a.id)]: Number(viceA), [String(b.id)]: Number(viceB) }
        };
    }

    const benchA = liveA && liveA.bench_points;
    const benchB = liveB && liveB.bench_points;
    if (!Array.isArray(benchA) || !Array.isArray(benchB) ||
        benchA.length !== 4 || benchB.length !== 4 ||
        [...benchA, ...benchB].some(value => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)))) {
        return { winner: null, method: "UNRESOLVED", reason: "BENCH_TIEBREAK_DATA_INCOMPLETE" };
    }

    const totalA = benchA.reduce((sum, value) => sum + Number(value), 0);
    const totalB = benchB.reduce((sum, value) => sum + Number(value), 0);
    if (totalA === totalB) {
        return {
            winner: null,
            method: "UNRESOLVED",
            reason: "TIEBREAK_STILL_EQUAL",
            values: { [String(a.id)]: totalA, [String(b.id)]: totalB }
        };
    }

    return {
        winner: totalA > totalB ? a.id : b.id,
        method: "BENCH_POINTS",
        values: { [String(a.id)]: totalA, [String(b.id)]: totalB }
    };
}

function applyPlayerResult(player, won, opponentWasInfected) {
    const before = {
        status: normalizeStatus(player.status),
        hearts: Math.max(0, Math.min(3, Number(player.hearts) || 0)),
        is_infected: player.is_infected === true,
        is_active: player.is_active !== false
    };

    let status = before.status;
    let hearts = before.hearts;
    let infected = before.is_infected;

    if (won) {
        if (status === "NORMAL") status = "SAFE";
        else if (status === "DANGER") status = "NORMAL";
    } else {
        if (status === "SAFE") status = "NORMAL";
        else if (status === "NORMAL") status = "DANGER";

        if (before.status === "DANGER" || before.is_infected) {
            hearts = Math.max(0, hearts - 1);
        }
        if (opponentWasInfected) infected = true;
    }

    const active = hearts > 0 && before.is_active;
    // Infection is permanent throughout Chapter II, even when the player is eliminated.

    return {
        player_id: player.id,
        player_name: player.name,
        status,
        hearts,
        is_infected: infected,
        is_active: active,
        before
    };
}

function buildGameweekPreview(input) {
    const { gameweek, players, matches, byes, live } = input || {};
    if (!gameweek || !Array.isArray(players) || !Array.isArray(matches) || !Array.isArray(byes)) {
        throw new Error("PREVIEW_INPUT_INVALID");
    }
    if (String(gameweek.status || "").toUpperCase() !== "PENDING") {
        throw new Error("GAMEWEEK_NOT_PENDING");
    }
    const gw = Number(gameweek.gw_number);
    if (!Number.isInteger(gw) || gw < 9 || gw > 14) {
        throw new Error("CHAPTER_RULESET_NOT_CONFIGURED");
    }
    if (!live || live.ok !== true || live.final !== true || live.data_checked !== true || live.stale === true) {
        throw new Error("FPL_GAMEWEEK_NOT_FINAL");
    }

    const activePlayers = players.filter(isActive);
    const activeById = new Map(activePlayers.map(player => [String(player.id), player]));
    const seen = new Set();

    for (const match of matches) {
        if (String(match.status || "").toUpperCase() === "COMPLETED") {
            throw new Error("MATCH_ALREADY_COMPLETED");
        }
        for (const id of [match.player_a_id, match.player_b_id]) {
            const key = String(id);
            if (!activeById.has(key) || seen.has(key)) throw new Error("FIXTURE_ROSTER_INVALID");
            seen.add(key);
        }
    }
    for (const bye of byes) {
        const key = String(bye.player_id);
        if (!activeById.has(key) || seen.has(key)) throw new Error("FIXTURE_ROSTER_INVALID");
        seen.add(key);
    }
    if (seen.size !== activeById.size) throw new Error("FIXTURE_COVERAGE_INCOMPLETE");
    if (matches.length === 0) throw new Error("NO_MATCHES_FOUND");
    if (byes.length > 1) throw new Error("MULTIPLE_BYES_FOUND");

    const updates = new Map();
    const results = [];

    for (const match of matches) {
        const a = activeById.get(String(match.player_a_id));
        const b = activeById.get(String(match.player_b_id));
        const liveA = live.players && live.players[String(a.id)];
        const liveB = live.players && live.players[String(b.id)];
        const pointsA = getScore(liveA);
        const pointsB = getScore(liveB);

        if (pointsA === null || pointsB === null ||
            (liveA && liveA.error) || (liveB && liveB.error)) {
            throw new Error("FPL_PLAYER_POINTS_UNAVAILABLE");
        }

        let winnerId;
        let method = "FPL_POINTS";
        let tiebreak = null;
        if (pointsA > pointsB) winnerId = a.id;
        else if (pointsB > pointsA) winnerId = b.id;
        else {
            tiebreak = resolveTie(a, b, liveA, liveB);
            if (tiebreak.winner === null) {
                throw new Error("UNRESOLVED_TIE:" + String(match.id) + ":" + tiebreak.reason);
            }
            winnerId = tiebreak.winner;
            method = tiebreak.method;
        }

        const winner = String(winnerId) === String(a.id) ? a : b;
        const loser = winner === a ? b : a;
        const winnerBefore = winner.is_infected === true;
        const winnerAfter = applyPlayerResult(winner, true, false);
        const loserAfter = applyPlayerResult(loser, false, winnerBefore);

        updates.set(String(winner.id), winnerAfter);
        updates.set(String(loser.id), loserAfter);

        results.push({
            match_id: match.id,
            player_a_id: a.id,
            player_b_id: b.id,
            points_a: pointsA,
            points_b: pointsB,
            winner_id: winnerId,
            winner_method: method,
            tiebreak,
            winner: { id: winner.id, name: winner.name },
            loser: { id: loser.id, name: loser.name }
        });
    }

    // A bye is still a survivor's gameweek record: preserve an unchanged snapshot.
    for (const bye of byes) {
        const player = activeById.get(String(bye.player_id));
        const before = {
            status: normalizeStatus(player.status),
            hearts: Math.max(0, Math.min(3, Number(player.hearts) || 0)),
            is_infected: player.is_infected === true,
            is_active: player.is_active !== false
        };
        updates.set(String(player.id), {
            player_id: player.id,
            player_name: player.name,
            status: before.status,
            hearts: before.hearts,
            is_infected: before.is_infected,
            is_active: before.is_active,
            before
        });
    }

    return {
        gameweek: { id: gameweek.id, gw_number: gw, chapter: gameweek.chapter },
        fpl: {
            status: live.status,
            final: live.final,
            data_checked: live.data_checked,
            updated_at: live.updated_at,
            stale: live.stale
        },
        summary: {
            matches: results.length,
            byes: byes.length,
            active_players: activePlayers.length,
            wins: results.length,
            eliminations: [...updates.values()].filter(player => !player.is_active).length,
            infection_transfers: [...updates.values()].filter(player => player.is_infected && !player.before.is_infected).length
        },
        results,
        player_updates: [...updates.values()],
        byes: byes.map(bye => ({
            player_id: bye.player_id,
            name: activeById.get(String(bye.player_id))?.name || null
        }))
    };
}

module.exports = { buildGameweekPreview };
