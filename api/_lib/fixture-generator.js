"use strict";

const STATUS_ORDER = { SAFE: 0, DANGER: 1, NORMAL: 2 };
const STATUS_TIERS = [
    ["SAFE", "DANGER"],
    ["SAFE", "NORMAL"],
    ["NORMAL", "NORMAL"],
    ["NORMAL", "DANGER"],
    ["SAFE", "SAFE"],
    ["DANGER", "DANGER"]
];

function activePlayer(player) {
    return player && player.is_active !== false && Number(player.hearts) > 0;
}

function pairKey(a, b) {
    return [String(a), String(b)].sort().join("::");
}

function getTier(a, b) {
    const x = String(a.status || "").toUpperCase();
    const y = String(b.status || "").toUpperCase();
    for (let i = 0; i < STATUS_TIERS.length; i += 1) {
        const [left, right] = STATUS_TIERS[i];
        if ((x === left && y === right) || (x === right && y === left)) return i;
    }
    throw new Error("PLAYER_STATUS_INVALID");
}

function compareCounts(a, b) {
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
    }
    return 0;
}

/**
 * Deterministic, read-only fixture generation.
 * Pairing priority: SAFE×DANGER, SAFE×NORMAL, NORMAL×NORMAL,
 * NORMAL×DANGER, SAFE×SAFE, DANGER×DANGER.
 * Previous opponents are hard-blocked; the generator never silently rematches.
 */
function generateFixtures(input) {
    const { players, previousMatches = [], byePlayerId = null } = input || {};
    if (!Array.isArray(players) || !Array.isArray(previousMatches)) {
        throw new Error("FIXTURE_GENERATOR_INPUT_INVALID");
    }

    let roster = players.filter(activePlayer).map(player => ({
        ...player,
        status: String(player.status || "").trim().toUpperCase()
    }));

    if (roster.some(player => !Object.prototype.hasOwnProperty.call(STATUS_ORDER, player.status))) {
        throw new Error("PLAYER_STATUS_INVALID");
    }
    if (roster.length < 2) throw new Error("NOT_ENOUGH_ACTIVE_PLAYERS");

    roster.sort((a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        Number(b.hearts) - Number(a.hearts) ||
        String(a.id).localeCompare(String(b.id), undefined, { numeric: true })
    );

    const statusCounts = { SAFE: 0, NORMAL: 0, DANGER: 0 };
    for (const player of roster) statusCounts[player.status] += 1;
    const infectedPlayers = roster
        .filter(player => player.is_infected === true)
        .map(player => ({
            id: player.id,
            name: player.name,
            status: player.status,
            hearts: Number(player.hearts)
        }));

    let bye = null;
    if (roster.length % 2 === 1) {
        if (byePlayerId === null || byePlayerId === undefined || byePlayerId === "") {
            const error = new Error("BYE_PLAYER_SELECTION_REQUIRED");
            error.bye_candidates = roster.map(player => ({
                id: player.id, name: player.name, status: player.status, hearts: Number(player.hearts)
            }));
            throw error;
        }
        const byeIndex = roster.findIndex(player => String(player.id) === String(byePlayerId));
        if (byeIndex < 0) throw new Error("BYE_PLAYER_NOT_ACTIVE");
        bye = roster[byeIndex];
        roster = roster.filter((_, index) => index !== byeIndex);
    } else if (byePlayerId !== null && byePlayerId !== undefined && byePlayerId !== "") {
        throw new Error("BYE_NOT_REQUIRED");
    }

    if (roster.length > 24) throw new Error("ROSTER_TOO_LARGE");

    const previousPairs = new Set();
    for (const match of previousMatches) {
        if (match.player_a_id !== null && match.player_a_id !== undefined &&
            match.player_b_id !== null && match.player_b_id !== undefined) {
            previousPairs.add(pairKey(match.player_a_id, match.player_b_id));
        }
    }

    const n = roster.length;
    const fullMask = (1 << n) - 1;
    const score = new Int32Array(1 << n);
    score.fill(-1);
    const choice = new Int8Array(1 << n);
    choice.fill(-1);
    score[0] = 0;

    const pairCount = n / 2;
    const base = pairCount + 1;
    const weights = STATUS_TIERS.map((_, index) => Math.pow(base, STATUS_TIERS.length - index - 1));

    function solve(mask) {
        if (score[mask] !== -1) return score[mask];

        let first = 0;
        while ((mask & (1 << first)) === 0) first += 1;

        const withoutFirst = mask & ~(1 << first);
        let bestScore = -1;
        let bestPartner = -1;

        for (let j = first + 1; j < n; j += 1) {
            if ((withoutFirst & (1 << j)) === 0) continue;
            if (previousPairs.has(pairKey(roster[first].id, roster[j].id))) continue;

            const rest = withoutFirst & ~(1 << j);
            const restScore = solve(rest);
            if (restScore < 0) continue;

            const tier = getTier(roster[first], roster[j]);
            const candidate = restScore + weights[tier];
            if (candidate > bestScore) {
                bestScore = candidate;
                bestPartner = j;
            }
        }

        score[mask] = bestScore;
        choice[mask] = bestPartner;
        return bestScore;
    }

    if (solve(fullMask) < 0) {
        throw new Error("REMATCH_FREE_SCHEDULE_IMPOSSIBLE");
    }

    const matches = [];
    const tierCounts = {
        "SAFE vs DANGER": 0,
        "SAFE vs NORMAL": 0,
        "NORMAL vs NORMAL": 0,
        "NORMAL vs DANGER": 0,
        "SAFE vs SAFE": 0,
        "DANGER vs DANGER": 0
    };

    let mask = fullMask;
    while (mask !== 0) {
        let first = 0;
        while ((mask & (1 << first)) === 0) first += 1;
        const partner = choice[mask];
        if (partner < 0) throw new Error("FIXTURE_RECONSTRUCTION_FAILED");

        const a = roster[first];
        const b = roster[partner];
        const tier = getTier(a, b);
        const tierLabel = STATUS_TIERS[tier].join(" vs ");
        tierCounts[tierLabel] += 1;
        matches.push({
            player_a_id: a.id,
            player_a_name: a.name,
            player_a_status: a.status,
            player_a_hearts: Number(a.hearts),
            player_a_is_infected: a.is_infected === true,
            player_b_id: b.id,
            player_b_name: b.name,
            player_b_status: b.status,
            player_b_hearts: Number(b.hearts),
            player_b_is_infected: b.is_infected === true,
            priority: tierLabel,
            priority_rank: tier + 1
        });

        mask &= ~(1 << first);
        mask &= ~(1 << partner);
    }

    return {
        active_players: players.filter(activePlayer).length,
        matches_count: matches.length,
        bye: bye ? {
            player_id: bye.id,
            name: bye.name,
            status: bye.status,
            hearts: Number(bye.hearts),
            is_infected: bye.is_infected === true
        } : null,
        status_counts: statusCounts,
        infected_count: infectedPlayers.length,
        infected_players: infectedPlayers,
        priority_counts: tierCounts,
        rematches: 0,
        matches
    };
}

module.exports = { generateFixtures, pairKey };
