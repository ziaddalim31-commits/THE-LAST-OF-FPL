"use strict";

function hasFixtures(gameweek, matches, byes) {
    return matches.some(match => String(match.gameweek_id) === String(gameweek.id)) ||
        byes.some(bye => String(bye.gameweek_id) === String(gameweek.id));
}

/**
 * Pick the earliest unassigned pending gameweek that directly follows the
 * earliest unresolved round. A pending previous round may be simulated
 * read-only for preview, but must be confirmed before fixtures can be saved.
 */
function selectNextFixtureGameweek(gameweeks, matches = [], byes = []) {
    if (!Array.isArray(gameweeks) || !Array.isArray(matches) || !Array.isArray(byes)) {
        throw new Error("GAMEWEEK_SELECTION_INPUT_INVALID");
    }

    const pending = gameweeks
        .filter(row => String(row.status || "").trim().toUpperCase() === "PENDING")
        .sort((a, b) => Number(a.gw_number) - Number(b.gw_number));

    return pending.find(row => {
        const currentGw = Number(row.gw_number);
        const previous = gameweeks.find(item => Number(item.gw_number) === currentGw - 1);
        const earlierPending = pending.some(item => Number(item.gw_number) < currentGw - 1);

        return Number.isInteger(currentGw) &&
            !hasFixtures(row, matches, byes) &&
            previous &&
            ["PENDING", "COMPLETED"].includes(String(previous.status || "").toUpperCase()) &&
            !earlierPending;
    }) || null;
}

module.exports = { selectNextFixtureGameweek };
