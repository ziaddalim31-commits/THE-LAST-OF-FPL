"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { selectNextFixtureGameweek, isPreviousGameweekConfirmed } = require("../api/_lib/next-gameweek");

function gw(number, status = "PENDING") {
    return { id: number, gw_number: number, status };
}

test("selects GW11 for preview when GW10 is pending with existing fixtures", () => {
    const gameweeks = [gw(9, "COMPLETED"), gw(10), gw(11)];
    const matches = [{ gameweek_id: 10, player_a_id: 1, player_b_id: 2 }];
    assert.equal(selectNextFixtureGameweek(gameweeks, matches, []).gw_number, 11);
});

test("selects earliest pending gameweek when its previous round is completed", () => {
    const gameweeks = [gw(9, "COMPLETED"), gw(10, "COMPLETED"), gw(11), gw(12)];
    assert.equal(selectNextFixtureGameweek(gameweeks, [], []).gw_number, 11);
});

test("does not skip an earlier pending round even if a later round has no fixtures", () => {
    const gameweeks = [gw(9, "COMPLETED"), gw(10), gw(11), gw(12)];
    const matches = [{ gameweek_id: 10, player_a_id: 1, player_b_id: 2 }];
    assert.equal(selectNextFixtureGameweek(gameweeks, matches, []).gw_number, 11);
});

test("returns null when every pending gameweek already has fixtures", () => {
    const gameweeks = [gw(9, "COMPLETED"), gw(10), gw(11)];
    const matches = [
        { gameweek_id: 10, player_a_id: 1, player_b_id: 2 },
        { gameweek_id: 11, player_a_id: 3, player_b_id: 4 }
    ];
    assert.equal(selectNextFixtureGameweek(gameweeks, matches, []), null);
});

test("a BYE-only pending gameweek counts as already assigned", () => {
    const gameweeks = [gw(9, "COMPLETED"), gw(10), gw(11)];
    const byes = [{ gameweek_id: 10, player_id: 5 }];
    assert.equal(selectNextFixtureGameweek(gameweeks, [], byes).gw_number, 11);
});

test("does not select a round if the immediately previous round is missing", () => {
    const gameweeks = [gw(10, "PENDING"), gw(12, "PENDING")];
    assert.equal(selectNextFixtureGameweek(gameweeks, [], []), null);
});


test("GW11 may be previewed while GW10 is pending, but cannot be saved until GW10 is completed", () => {
    const gameweeks = [gw(9, "COMPLETED"), gw(10, "PENDING"), gw(11, "PENDING")];
    const matches = [{ gameweek_id: 10, player_a_id: 1, player_b_id: 2 }];
    const target = selectNextFixtureGameweek(gameweeks, matches, []);

    assert.equal(target.gw_number, 11);
    assert.equal(isPreviousGameweekConfirmed(gameweeks, target), false);

    gameweeks[1].status = "COMPLETED";
    assert.equal(isPreviousGameweekConfirmed(gameweeks, target), true);
});
