"use strict";

const VALID_STATUS = new Set(["SAFE", "NORMAL", "DANGER"]);

function finite(value) {
    return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function sameSet(a, b) {
    if (a.size !== b.size) return false;
    for (const value of a) if (!b.has(value)) return false;
    return true;
}

function failure(code, gameweek, details = {}) {
    return { ok: false, code, gameweek: Number(gameweek), ...details };
}

/**
 * Fail-closed audit of all recorded rounds through the requested gameweek.
 * It verifies match results, bye records, one snapshot per participant, and
 * survivor continuity between consecutive rounds. It is read-only.
 */
function auditCompletedHistory({ gameweeks, matches, byes, history, throughGameweek }) {
    if (![gameweeks, matches, byes, history].every(Array.isArray) ||
        !Number.isInteger(Number(throughGameweek))) {
        return { ok: false, code: "HISTORY_AUDIT_INPUT_INVALID" };
    }

    const target = Number(throughGameweek);
    const gameweekRows = gameweeks.filter(row => Number(row.gw_number) <= target);
    if (!gameweekRows.length || !gameweekRows.some(row => Number(row.gw_number) === target)) {
        return failure("HISTORY_GAMEWEEK_MISSING", target);
    }

    const recordedIds = new Set();
    for (const row of gameweekRows) {
        const id = String(row.id);
        if (matches.some(match => String(match.gameweek_id) === id) ||
            byes.some(bye => String(bye.gameweek_id) === id) ||
            history.some(item => String(item.gameweek_id) === id)) {
            recordedIds.add(Number(row.gw_number));
        }
    }
    if (!recordedIds.size) return failure("HISTORY_RECORDS_MISSING", target);
    const firstGw = Math.min(...recordedIds);

    let previousActive = null;
    let previousSnapshots = null;
    let previousChapter = null;
    let roundsChecked = 0;
    for (let gw = firstGw; gw <= target; gw += 1) {
        const rows = gameweekRows.filter(row => Number(row.gw_number) === gw);
        if (rows.length !== 1) return failure("HISTORY_GAMEWEEK_SEQUENCE_INVALID", gw);
        const round = rows[0];
        if (String(round.status || "").trim().toUpperCase() !== "COMPLETED") {
            return failure("HISTORY_GAMEWEEK_NOT_COMPLETED", gw, { status: round.status || null });
        }

        const roundMatches = matches.filter(item => String(item.gameweek_id) === String(round.id));
        const roundByes = byes.filter(item => String(item.gameweek_id) === String(round.id));
        const roundHistory = history.filter(item => String(item.gameweek_id) === String(round.id));
        if (!roundMatches.length) return failure("HISTORY_MATCHES_MISSING", gw);
        if (roundByes.length > 1) return failure("HISTORY_BYE_COUNT_INVALID", gw);

        const participantIds = new Set();
        for (const match of roundMatches) {
            if (String(match.status || "").trim().toUpperCase() !== "COMPLETED") {
                return failure("HISTORY_MATCH_NOT_COMPLETED", gw, { match_id: match.id });
            }
            const a = match.player_a_id;
            const b = match.player_b_id;
            if (a === null || a === undefined || b === null || b === undefined || String(a) === String(b)) {
                return failure("HISTORY_MATCH_PLAYERS_INVALID", gw, { match_id: match.id });
            }
            const aId = String(a), bId = String(b);
            if (participantIds.has(aId) || participantIds.has(bId)) {
                return failure("HISTORY_PLAYER_DUPLICATED_IN_ROUND", gw, { match_id: match.id });
            }
            participantIds.add(aId);
            participantIds.add(bId);
            if (!finite(match.points_a) || !finite(match.points_b) ||
                ![aId, bId].includes(String(match.winner_id))) {
                return failure("HISTORY_MATCH_RESULT_INCOMPLETE", gw, { match_id: match.id });
            }
        }

        for (const bye of roundByes) {
            if (bye.player_id === null || bye.player_id === undefined) {
                return failure("HISTORY_BYE_PLAYER_INVALID", gw, { bye_id: bye.id });
            }
            const id = String(bye.player_id);
            if (participantIds.has(id)) {
                return failure("HISTORY_PLAYER_DUPLICATED_IN_ROUND", gw, { player_id: id });
            }
            participantIds.add(id);
        }

        const snapshotIds = new Set();
        for (const row of roundHistory) {
            const id = String(row.player_id);
            if (row.player_id === null || row.player_id === undefined || snapshotIds.has(id)) {
                return failure("HISTORY_SNAPSHOT_DUPLICATED", gw, { player_id: row.player_id ?? null });
            }
            snapshotIds.add(id);
            const valid = VALID_STATUS.has(String(row.status_before || "").toUpperCase()) &&
                VALID_STATUS.has(String(row.status_after || "").toUpperCase()) &&
                [row.hearts_before, row.hearts_after].every(value =>
                    finite(value) && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 3
                ) &&
                [row.infected_before, row.infected_after, row.active_before, row.active_after]
                    .every(value => typeof value === "boolean") &&
                row.active_before === true &&
                (Number(row.hearts_before) > 0) &&
                (row.active_after === (Number(row.hearts_after) > 0));
            if (!valid) return failure("HISTORY_SNAPSHOT_INVALID", gw, { player_id: id });
        }

        if (!sameSet(participantIds, snapshotIds)) {
            return failure("HISTORY_SNAPSHOT_COVERAGE_MISMATCH", gw, {
                missing_snapshot_player_ids: [...participantIds].filter(id => !snapshotIds.has(id)),
                unexpected_snapshot_player_ids: [...snapshotIds].filter(id => !participantIds.has(id))
            });
        }

        if (previousActive !== null && !sameSet(previousActive, participantIds)) {
            return failure("HISTORY_ROSTER_CONTINUITY_MISMATCH", gw, {
                missing_player_ids: [...previousActive].filter(id => !participantIds.has(id)),
                unexpected_player_ids: [...participantIds].filter(id => !previousActive.has(id))
            });
        }
        if (previousSnapshots !== null) {
            const previousByPlayer = new Map(previousSnapshots.map(row => [String(row.player_id), row]));
            for (const row of roundHistory) {
                const prior = previousByPlayer.get(String(row.player_id));
                const sameChapter = String(previousChapter || "").trim().toUpperCase() ===
                    String(round.chapter || "").trim().toUpperCase();
                if (!prior ||
                    String(prior.status_after).toUpperCase() !== String(row.status_before).toUpperCase() ||
                    Number(prior.hearts_after) !== Number(row.hearts_before) ||
                    (sameChapter && prior.infected_after !== row.infected_before) ||
                    prior.active_after !== row.active_before) {
                    return failure("HISTORY_PLAYER_STATE_CONTINUITY_MISMATCH", gw, {
                        player_id: String(row.player_id)
                    });
                }
            }
        }

        previousSnapshots = roundHistory;
        previousChapter = round.chapter;
        previousActive = new Set(roundHistory
            .filter(row => row.active_after === true)
            .map(row => String(row.player_id)));
        roundsChecked += 1;
    }

    return {
        ok: true,
        checked_through: target,
        first_gameweek_checked: firstGw,
        rounds_checked: roundsChecked
    };
}

module.exports = { auditCompletedHistory };
