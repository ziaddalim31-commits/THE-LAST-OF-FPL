"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { generateFixtures } = require("../api/_lib/fixture-generator");

function players(states) {
    return states.map((status, index) => ({
        id: index + 1,
        name: "Player " + (index + 1),
        status,
        hearts: status === "SAFE" ? 3 : status === "NORMAL" ? 2 : 1,
        is_active: true
    }));
}

test("maximizes SAFE vs DANGER first and pairs leftover NORMAL players together", () => {
    const roster = players([
        ...Array(10).fill("SAFE"),
        ...Array(10).fill("DANGER"),
        ...Array(4).fill("NORMAL")
    ]);
    const preview = generateFixtures({ players: roster });

    assert.equal(preview.matches_count, 12);
    assert.equal(preview.active_players, 24);
    assert.equal(preview.priority_counts["SAFE vs DANGER"], 10);
    assert.equal(preview.priority_counts["NORMAL vs NORMAL"], 2);
    assert.equal(preview.rematches, 0);
});

test("never repeats a historical opponent when an alternative exists", () => {
    const roster = players(["SAFE", "SAFE", "DANGER", "DANGER"]);
    const preview = generateFixtures({
        players: roster,
        previousMatches: [{ player_a_id: 1, player_b_id: 3 }]
    });

    assert.equal(preview.matches_count, 2);
    assert.ok(!preview.matches.some(match =>
        (match.player_a_id === 1 && match.player_b_id === 3) ||
        (match.player_a_id === 3 && match.player_b_id === 1)
    ));
});

test("requires an explicit BYE selection for an odd roster", () => {
    const roster = players(["SAFE", "NORMAL", "DANGER"]);
    assert.throws(
        () => generateFixtures({ players: roster }),
        /BYE_PLAYER_SELECTION_REQUIRED/
    );
    const preview = generateFixtures({ players: roster, byePlayerId: 3 });
    assert.equal(preview.bye.player_id, 3);
    assert.equal(preview.matches_count, 1);
});

test("excludes inactive and zero-heart players", () => {
    const roster = players(["SAFE", "DANGER", "NORMAL", "SAFE"]);
    roster[2].hearts = 0;
    roster[3].is_active = false;
    const preview = generateFixtures({ players: roster });
    assert.equal(preview.active_players, 2);
    assert.equal(preview.matches_count, 1);
});

test("is deterministic for the same roster and history", () => {
    const input = { players: players(["SAFE", "SAFE", "NORMAL", "DANGER", "DANGER", "NORMAL"]) };
    assert.deepEqual(generateFixtures(input), generateFixtures(input));
});

test("blocks generation when all remaining pairings require a rematch", () => {
    const roster = players(["SAFE", "DANGER"]);
    assert.throws(
        () => generateFixtures({
            players: roster,
            previousMatches: [{ player_a_id: 1, player_b_id: 2 }]
        }),
        /REMATCH_FREE_SCHEDULE_IMPOSSIBLE/
    );
});
