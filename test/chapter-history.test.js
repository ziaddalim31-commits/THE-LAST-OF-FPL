"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { auditChapterMatchHistory, auditRoundSnapshotCoverage } = require("../api/_lib/chapter-history");

function data() {
    return {
        players: [1, 2, 3, 4].map(id => ({ id, name: "Player " + id, hearts: 3, is_active: true })),
        gameweeks: [
            { id: 9, gw_number: 9, chapter: "CHAPTER II", status: "COMPLETED" },
            { id: 10, gw_number: 10, chapter: "CHAPTER II", status: "COMPLETED" },
            { id: 11, gw_number: 11, chapter: "CHAPTER II", status: "PENDING" }
        ],
        matches: [
            { id: 91, gameweek_id: 9, player_a_id: 1, player_b_id: 2, points_a: 60, points_b: 50, winner_id: 1, status: "COMPLETED" },
            { id: 92, gameweek_id: 9, player_a_id: 3, player_b_id: 4, points_a: 45, points_b: 55, winner_id: 4, status: "COMPLETED" },
            { id: 101, gameweek_id: 10, player_a_id: 1, player_b_id: 3, points_a: 70, points_b: 65, winner_id: 1, status: "COMPLETED" }
        ],
        byes: [{ id: 100, gameweek_id: 10, player_id: 4 }],
        requiredPlayerIds: [1, 3, 4]
    };
}
function audit(input, throughGameweek = 10) {
    return auditChapterMatchHistory({
        ...input, currentGameweek: { chapter: "CHAPTER II", gw_number: 11 },
        throughGameweek, requiredPlayerIds: input.requiredPlayerIds || []
    });
}
test("accepts chapter match history when historical snapshots are absent", () => {
    const result = audit(data());
    assert.equal(result.ok, true);
    assert.equal(result.first_gameweek_checked, 9);
    assert.equal(result.rounds_checked, 2);
    assert.equal(result.matches_checked, 3);
});
test("ignores earlier chapters when auditing current chapter opponents", () => {
    const input = data();
    input.gameweeks.unshift(
        { id: 7, gw_number: 7, chapter: "CHAPTER I", status: "COMPLETED" },
        { id: 8, gw_number: 8, chapter: "CHAPTER I", status: "COMPLETED" }
    );
    assert.equal(audit(input).ok, true);
});
test("blocks when an active survivor has no recorded opponent in a chapter round", () => {
    const input = data();
    input.matches = input.matches.filter(match => match.id !== 92);
    input.byes = [];
    const result = audit(input);
    assert.equal(result.code, "CHAPTER_HISTORY_ACTIVE_ROSTER_COVERAGE_MISMATCH");
    assert.deepEqual(result.missing_player_ids, ["3", "4"]);
});
test("blocks missing or pending chapter match results", () => {
    const missing = data();
    missing.matches = missing.matches.filter(match => match.gameweek_id !== 9);
    assert.equal(audit(missing).code, "CHAPTER_HISTORY_MATCHES_MISSING");
    const pending = data();
    pending.matches[0].status = "PENDING";
    assert.equal(audit(pending).code, "CHAPTER_HISTORY_MATCH_NOT_COMPLETED");
});
test("blocks duplicate participants and invalid winners", () => {
    const duplicate = data();
    duplicate.matches.push({ id: 93, gameweek_id: 9, player_a_id: 1, player_b_id: 3, points_a: 1, points_b: 2, winner_id: 3, status: "COMPLETED" });
    assert.equal(audit(duplicate).code, "CHAPTER_HISTORY_DUPLICATE_PARTICIPANT");
    const invalidWinner = data();
    invalidWinner.matches[0].winner_id = 4;
    assert.equal(audit(invalidWinner).code, "CHAPTER_HISTORY_MATCH_RESULT_INVALID");
});
test("reports absent snapshots separately from usable opponent history", () => {
    const input = data();
    const result = auditRoundSnapshotCoverage({ matches: input.matches.filter(match => match.gameweek_id === 9), byes: [], history: [] });
    assert.equal(result.code, "SURVIVOR_SNAPSHOTS_MISSING");
    assert.equal(result.missing_snapshot_count, 4);
});
test("detects per-round snapshot coverage mismatch without failing opponent audit", () => {
    const input = data();
    const history = [1, 2, 3].map(player_id => ({
        player_id, status_before: "SAFE", status_after: "SAFE", hearts_before: 3, hearts_after: 3,
        infected_before: false, infected_after: false, active_before: true, active_after: true
    }));
    const snapshot = auditRoundSnapshotCoverage({
        matches: input.matches.filter(match => match.gameweek_id === 9), byes: [], history
    });
    assert.equal(snapshot.code, "SNAPSHOT_COVERAGE_MISMATCH");
    assert.deepEqual(snapshot.missing_snapshot_player_ids, ["4"]);
    assert.equal(audit(input).ok, true);
});
