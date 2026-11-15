"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { auditCompletedHistory } = require("../api/_lib/history-integrity");

function fixtureData() {
    const gameweeks = [
        { id: 8, gw_number: 8, status: "COMPLETED" },
        { id: 9, gw_number: 9, status: "COMPLETED" },
        { id: 10, gw_number: 10, status: "COMPLETED" }
    ];
    const matches = [
        { id: 81, gameweek_id: 8, player_a_id: 1, player_b_id: 2, points_a: 60, points_b: 50, winner_id: 1, status: "COMPLETED" },
        { id: 91, gameweek_id: 9, player_a_id: 1, player_b_id: 2, points_a: 55, points_b: 45, winner_id: 1, status: "COMPLETED" },
        { id: 101, gameweek_id: 10, player_a_id: 1, player_b_id: 2, points_a: 40, points_b: 44, winner_id: 2, status: "COMPLETED" }
    ];
    const history = [
        { gameweek_id: 8, player_id: 1, status_before: "NORMAL", status_after: "SAFE", hearts_before: 3, hearts_after: 3, infected_before: false, infected_after: false, active_before: true, active_after: true },
        { gameweek_id: 8, player_id: 2, status_before: "NORMAL", status_after: "DANGER", hearts_before: 3, hearts_after: 2, infected_before: false, infected_after: false, active_before: true, active_after: true },
        { gameweek_id: 9, player_id: 1, status_before: "SAFE", status_after: "NORMAL", hearts_before: 3, hearts_after: 3, infected_before: false, infected_after: false, active_before: true, active_after: true },
        { gameweek_id: 9, player_id: 2, status_before: "DANGER", status_after: "DANGER", hearts_before: 2, hearts_after: 1, infected_before: false, infected_after: false, active_before: true, active_after: true },
        { gameweek_id: 10, player_id: 1, status_before: "NORMAL", status_after: "SAFE", hearts_before: 3, hearts_after: 3, infected_before: false, infected_after: false, active_before: true, active_after: true },
        { gameweek_id: 10, player_id: 2, status_before: "DANGER", status_after: "DANGER", hearts_before: 1, hearts_after: 0, infected_before: false, infected_after: false, active_before: true, active_after: false }
    ];
    return { gameweeks, matches, byes: [], history };
}

test("accepts complete round results and continuous survivor snapshots", () => {
    const data = fixtureData();
    assert.deepEqual(
        auditCompletedHistory({ ...data, throughGameweek: 10 }),
        { ok: true, checked_through: 10, first_gameweek_checked: 8, rounds_checked: 3 }
    );
});

test("rejects a round with one missing survivor snapshot", () => {
    const data = fixtureData();
    data.history = data.history.filter(row => !(row.gameweek_id === 10 && row.player_id === 2));
    const result = auditCompletedHistory({ ...data, throughGameweek: 10 });
    assert.equal(result.code, "HISTORY_SNAPSHOT_COVERAGE_MISMATCH");
    assert.deepEqual(result.missing_snapshot_player_ids, ["2"]);
});

test("rejects missing match rows even if a partial history snapshot exists", () => {
    const data = fixtureData();
    data.matches = data.matches.filter(match => match.gameweek_id !== 9);
    const result = auditCompletedHistory({ ...data, throughGameweek: 10 });
    assert.equal(result.code, "HISTORY_MATCHES_MISSING");
});

test("rejects a missing survivor from the next round using prior active_after snapshots", () => {
    const data = fixtureData();
    data.matches.push({ id: 102, gameweek_id: 10, player_a_id: 1, player_b_id: 3, points_a: 40, points_b: 44, winner_id: 3, status: "COMPLETED" });
    data.history = data.history.filter(row => !(row.gameweek_id === 10 && row.player_id === 2));
    data.history.push({ gameweek_id: 10, player_id: 3, status_before: "NORMAL", status_after: "SAFE", hearts_before: 3, hearts_after: 3, infected_before: false, infected_after: false, active_before: true, active_after: true });
    const result = auditCompletedHistory({ ...data, throughGameweek: 10 });
    assert.equal(result.code, "HISTORY_ROSTER_CONTINUITY_MISMATCH");
    assert.deepEqual(result.missing_player_ids, ["2"]);
});

test("rejects a completed round with an uncompleted match", () => {
    const data = fixtureData();
    data.matches[2].status = "PENDING";
    const result = auditCompletedHistory({ ...data, throughGameweek: 10 });
    assert.equal(result.code, "HISTORY_MATCH_NOT_COMPLETED");
});

test("rejects duplicate participants and invalid result rows", () => {
    const data = fixtureData();
    data.matches.push({ id: 103, gameweek_id: 10, player_a_id: 1, player_b_id: 3, points_a: 10, points_b: 11, winner_id: 3, status: "COMPLETED" });
    assert.equal(auditCompletedHistory({ ...data, throughGameweek: 10 }).code, "HISTORY_PLAYER_DUPLICATED_IN_ROUND");
});
