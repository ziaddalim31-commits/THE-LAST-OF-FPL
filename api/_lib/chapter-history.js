"use strict";

const VALID_STATUS_BEFORE = new Set(["SAFE", "NORMAL", "DANGER"]);
const VALID_STATUS_AFTER = new Set(["SAFE", "NORMAL", "DANGER", "ELIMINATED"]);
function finite(value) {
    return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}
function fail(code, gameweek, details = {}) {
    return { ok: false, code, gameweek: Number(gameweek), ...details };
}

/** Audits the recorded opponent pairs in the current chapter; snapshots are not required. */
function auditChapterMatchHistory({ gameweeks, matches, byes, players, currentGameweek, throughGameweek, fromGameweek = null, requiredPlayerIds = [] }) {
    if (![gameweeks, matches, byes, players, requiredPlayerIds].every(Array.isArray) ||
        !currentGameweek || !Number.isInteger(Number(currentGameweek.gw_number)) ||
        !String(currentGameweek.chapter || "").trim()) {
        return { ok: false, code: "CHAPTER_HISTORY_INPUT_INVALID" };
    }
    const chapter = String(currentGameweek.chapter).trim().toUpperCase();
    const targetGw = Number(throughGameweek);
    const currentGw = Number(currentGameweek.gw_number);
    if (!Number.isInteger(targetGw) || targetGw < 0 || targetGw >= currentGw) {
        return fail("CHAPTER_HISTORY_RANGE_INVALID", targetGw);
    }
    const firstRequestedGw = fromGameweek === null || fromGameweek === undefined ? null : Number(fromGameweek);
    const rounds = gameweeks
        .filter(row => String(row.chapter || "").trim().toUpperCase() === chapter && Number(row.gw_number) <= targetGw && (firstRequestedGw === null || Number(row.gw_number) >= firstRequestedGw))
        .sort((a, b) => Number(a.gw_number) - Number(b.gw_number));
    if (!rounds.length) {
        return { ok: true, checked_through: targetGw, first_gameweek_checked: null, rounds_checked: 0, matches_checked: 0, required_players_checked: requiredPlayerIds.length };
    }
    const firstGw = Number(rounds[0].gw_number);
    const knownPlayers = new Set(players.map(player => String(player.id)));
    const requiredIds = new Set(requiredPlayerIds.map(String));
    const unknownRequired = [...requiredIds].filter(id => !knownPlayers.has(id));
    if (unknownRequired.length) return fail("CHAPTER_HISTORY_UNKNOWN_ACTIVE_PLAYER", targetGw, { missing_player_ids: unknownRequired });

    let roundsChecked = 0, matchesChecked = 0;
    for (let gw = firstGw; gw <= targetGw; gw += 1) {
        const rows = rounds.filter(row => Number(row.gw_number) === gw);
        if (rows.length !== 1) return fail("CHAPTER_HISTORY_GAMEWEEK_SEQUENCE_INVALID", gw);
        const round = rows[0];
        if (String(round.status || "").trim().toUpperCase() !== "COMPLETED") {
            return fail("CHAPTER_HISTORY_GAMEWEEK_NOT_COMPLETED", gw, { status: round.status || null });
        }
        const roundMatches = matches.filter(row => String(row.gameweek_id) === String(round.id));
        const roundByes = byes.filter(row => String(row.gameweek_id) === String(round.id));
        if (!roundMatches.length) return fail("CHAPTER_HISTORY_MATCHES_MISSING", gw);
        if (roundByes.length > 1) return fail("CHAPTER_HISTORY_BYE_COUNT_INVALID", gw);

        const participants = new Set();
        for (const match of roundMatches) {
            if (String(match.status || "").trim().toUpperCase() !== "COMPLETED") {
                return fail("CHAPTER_HISTORY_MATCH_NOT_COMPLETED", gw, { match_id: match.id });
            }
            const a = match.player_a_id, b = match.player_b_id;
            if (a === null || a === undefined || b === null || b === undefined ||
                String(a) === String(b) || !knownPlayers.has(String(a)) || !knownPlayers.has(String(b))) {
                return fail("CHAPTER_HISTORY_MATCH_PLAYERS_INVALID", gw, { match_id: match.id });
            }
            const aId = String(a), bId = String(b);
            if (participants.has(aId) || participants.has(bId)) {
                return fail("CHAPTER_HISTORY_DUPLICATE_PARTICIPANT", gw, { match_id: match.id });
            }
            if (!finite(match.points_a) || !finite(match.points_b) || ![aId, bId].includes(String(match.winner_id))) {
                return fail("CHAPTER_HISTORY_MATCH_RESULT_INVALID", gw, { match_id: match.id });
            }
            participants.add(aId);
            participants.add(bId);
            matchesChecked += 1;
        }
        for (const bye of roundByes) {
            const id = String(bye.player_id);
            if (bye.player_id === null || bye.player_id === undefined || !knownPlayers.has(id) || participants.has(id)) {
                return fail("CHAPTER_HISTORY_BYE_PLAYER_INVALID", gw, { bye_id: bye.id });
            }
            participants.add(id);
        }
        const missingRequired = [...requiredIds].filter(id => !participants.has(id));
        if (missingRequired.length) {
            return fail("CHAPTER_HISTORY_ACTIVE_ROSTER_COVERAGE_MISMATCH", gw, { missing_player_ids: missingRequired });
        }
        roundsChecked += 1;
    }
    return {
        ok: true, checked_through: targetGw, first_gameweek_checked: firstGw,
        rounds_checked: roundsChecked, matches_checked: matchesChecked,
        required_players_checked: requiredIds.size
    };
}

/** Snapshot completeness is reported separately and never gates rematch checks. */
function auditRoundSnapshotCoverage({ matches, byes, history }) {
    if (![matches, byes, history].every(Array.isArray)) return { ok: false, code: "SNAPSHOT_AUDIT_INPUT_INVALID" };
    const participants = new Set();
    for (const match of matches) {
        if (match.player_a_id === null || match.player_a_id === undefined || match.player_b_id === null || match.player_b_id === undefined) {
            return { ok: false, code: "SNAPSHOT_MATCH_PLAYERS_INVALID" };
        }
        const a = String(match.player_a_id), b = String(match.player_b_id);
        if (a === b || participants.has(a) || participants.has(b)) return { ok: false, code: "SNAPSHOT_DUPLICATE_PARTICIPANT" };
        participants.add(a); participants.add(b);
    }
    if (byes.length > 1) return { ok: false, code: "SNAPSHOT_BYE_COUNT_INVALID" };
    for (const bye of byes) {
        const id = String(bye.player_id);
        if (bye.player_id === null || bye.player_id === undefined || participants.has(id)) return { ok: false, code: "SNAPSHOT_BYE_PLAYER_INVALID" };
        participants.add(id);
    }
    if (!history.length) return { ok: false, code: "SURVIVOR_SNAPSHOTS_MISSING", missing_snapshot_count: participants.size };

    const snapshots = new Set();
    for (const row of history) {
        const id = String(row.player_id);
        if (row.player_id === null || row.player_id === undefined || snapshots.has(id)) return { ok: false, code: "SNAPSHOT_DUPLICATED", player_id: row.player_id ?? null };
        snapshots.add(id);
        const statusBefore = String(row.status_before || "").toUpperCase();
        const statusAfter = String(row.status_after || "").toUpperCase();
        const heartsAfter = Number(row.hearts_after);
        const valid = VALID_STATUS_BEFORE.has(statusBefore) &&
            VALID_STATUS_AFTER.has(statusAfter) &&
            (statusAfter !== "ELIMINATED" || heartsAfter === 0) &&
            (statusAfter === "ELIMINATED" || heartsAfter > 0) &&
            [row.hearts_before, row.hearts_after].every(value => finite(value) && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 3) &&
            [row.infected_before, row.infected_after, row.active_before, row.active_after].every(value => typeof value === "boolean") &&
            row.active_before === true && Number(row.hearts_before) > 0 &&
            row.active_after === (Number(row.hearts_after) > 0);
        if (!valid) return { ok: false, code: "SNAPSHOT_ROW_INVALID", player_id: id, invalid_fields: {
            status_before: row.status_before, status_after: row.status_after,
            hearts_before: row.hearts_before, hearts_after: row.hearts_after,
            infected_before: row.infected_before, infected_after: row.infected_after,
            active_before: row.active_before, active_after: row.active_after
        } };
    }
    const missing = [...participants].filter(id => !snapshots.has(id));
    const unexpected = [...snapshots].filter(id => !participants.has(id));
    if (missing.length || unexpected.length) {
        return { ok: false, code: "SNAPSHOT_COVERAGE_MISMATCH", missing_snapshot_player_ids: missing, unexpected_snapshot_player_ids: unexpected };
    }
    return { ok: true, participants_checked: participants.size, snapshots_checked: snapshots.size };
}
module.exports = { auditChapterMatchHistory, auditRoundSnapshotCoverage };
