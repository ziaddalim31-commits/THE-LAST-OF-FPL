"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildGameweekPreview } = require("../api/_lib/tournament-engine");

function makeInput(overrides = {}) {
    const players = [
        { id: 1, name: "Infected", status: "DANGER", hearts: 2, is_infected: true, is_active: true },
        { id: 2, name: "Safe", status: "SAFE", hearts: 3, is_infected: false, is_active: true }
    ];
    const live = {
        ok: true, final: true, data_checked: true, stale: false, status: "FINAL",
        players: {
            "1": { points: 80, vice_captain_points: 6, bench_points: [1, 2, 3, 4] },
            "2": { points: 70, vice_captain_points: 5, bench_points: [2, 2, 2, 2] }
        }
    };
    return {
        gameweek: { id: 9, gw_number: 9, chapter: "Chapter II", status: "PENDING" },
        players,
        matches: [{ id: 101, player_a_id: 1, player_b_id: 2, status: "PENDING" }],
        byes: [],
        live,
        ...overrides
    };
}

test("infected winner transmits infection without taking a heart from a SAFE loser", () => {
    const preview = buildGameweekPreview(makeInput());
    const infected = preview.player_updates.find(player => player.player_id === 1);
    const loser = preview.player_updates.find(player => player.player_id === 2);

    assert.equal(preview.results[0].winner_id, 1);
    assert.equal(infected.is_infected, true);
    assert.equal(infected.status, "NORMAL");
    assert.equal(loser.is_infected, true);
    assert.equal(loser.status, "NORMAL");
    assert.equal(loser.hearts, 3);
    assert.equal(loser.player_name, "Safe");
    assert.equal(loser.before.status, "SAFE");
    assert.equal(loser.before.hearts, 3);
});

test("GW10 infected wins transfer infection to both opponents, including a vice-captain tiebreak", () => {
    const input = makeInput();
    input.players = [
        { id: 11, name: "Ismail Hadrani", status: "NORMAL", hearts: 3, is_infected: true, is_active: true },
        { id: 12, name: "Moulchi", status: "SAFE", hearts: 2, is_infected: false, is_active: true },
        { id: 13, name: "Abdelghafour", status: "NORMAL", hearts: 1, is_infected: true, is_active: true },
        { id: 14, name: "Abdennour", status: "SAFE", hearts: 3, is_infected: false, is_active: true }
    ];
    input.matches = [
        { id: 201, player_a_id: 11, player_b_id: 12, status: "PENDING" },
        { id: 202, player_a_id: 13, player_b_id: 14, status: "PENDING" }
    ];
    input.live.players = {
        "11": { points: 74, vice_captain_points: 10, bench_points: [1, 1, 1, 1] },
        "12": { points: 74, vice_captain_points: 5, bench_points: [2, 2, 2, 2] },
        "13": { points: 66, vice_captain_points: 6, bench_points: [1, 1, 1, 1] },
        "14": { points: 58, vice_captain_points: 5, bench_points: [2, 2, 2, 2] }
    };

    const preview = buildGameweekPreview(input);
    const infectedNames = preview.player_updates
        .filter(player => player.is_infected)
        .map(player => player.player_name)
        .sort();

    assert.deepEqual(infectedNames, [
        "Abdelghafour",
        "Abdennour",
        "Ismail Hadrani",
        "Moulchi"
    ]);
    assert.equal(preview.results[0].winner_method, "VICE_CAPTAIN_POINTS");
    assert.equal(preview.summary.infection_transfers, 2);
    assert.equal(preview.player_updates.find(player => player.player_id === 12).hearts, 2);
    assert.equal(preview.player_updates.find(player => player.player_id === 14).hearts, 3);
});

test("a DANGER player who loses loses exactly one heart", () => {
    const input = makeInput();
    input.players[0] = { ...input.players[0], is_infected: false, status: "DANGER", hearts: 2 };
    input.live.players["1"].points = 40;
    input.live.players["2"].points = 70;

    const preview = buildGameweekPreview(input);
    const loser = preview.player_updates.find(player => player.player_id === 1);

    assert.equal(loser.hearts, 1);
    assert.equal(loser.status, "DANGER");
    assert.equal(loser.is_active, true);
});

test("equal FPL points use vice-captain points before bench points", () => {
    const input = makeInput();
    input.live.players["1"].points = 70;
    input.live.players["2"].points = 70;

    const preview = buildGameweekPreview(input);
    assert.equal(preview.results[0].winner_id, 1);
    assert.equal(preview.results[0].winner_method, "VICE_CAPTAIN_POINTS");
});

test("equal vice-captain points use the sum of exactly four bench players", () => {
    const input = makeInput();
    input.live.players["1"].points = 70;
    input.live.players["2"].points = 70;
    input.live.players["1"].vice_captain_points = 5;
    input.live.players["2"].vice_captain_points = 5;

    const preview = buildGameweekPreview(input);
    assert.equal(preview.results[0].winner_id, 1);
    assert.equal(preview.results[0].winner_method, "BENCH_POINTS");
});

test("an unresolved tie blocks the preview", () => {
    const input = makeInput();
    input.live.players["1"].points = 70;
    input.live.players["2"].points = 70;
    input.live.players["1"].vice_captain_points = 5;
    input.live.players["2"].vice_captain_points = 5;
    input.live.players["1"].bench_points = [2, 2, 2, 2];
    input.live.players["2"].bench_points = [2, 2, 2, 2];

    assert.throws(() => buildGameweekPreview(input), /UNRESOLVED_TIE/);
});

test("provisional or stale FPL data cannot be processed", () => {
    const input = makeInput();
    input.live.final = false;
    assert.throws(() => buildGameweekPreview(input), /FPL_GAMEWEEK_NOT_FINAL/);
});
