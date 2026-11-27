"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { saveNextGameweekFixtures, verifyFixtureCoverage } = require("../api/_lib/fixture-save-service");

function makePlayers(count, status = "NORMAL") {
    return Array.from({ length: count }, (_, index) => ({
        id: index + 1,
        name: `Player ${index + 1}`,
        status,
        hearts: 2,
        is_infected: false,
        is_active: true
    }));
}

function makeDb(state) {
    return async (path) => {
        if (path.startsWith("players?")) return state.players;
        if (path.startsWith("gameweeks?")) return state.gameweeks;
        if (path.startsWith("matches?")) return state.matches;
        if (path.startsWith("gameweek_byes?")) return state.byes;
        throw new Error(`UNEXPECTED_DB_PATH:${path}`);
    };
}

// Builds a completed previous gameweek (GW11) that fully covers the roster,
// pairing players in order and assigning a bye when the count is odd.
function completedPrevious(players) {
    const matches = [];
    const byes = [];
    let id = 1;
    const ordered = players.map(player => player.id);
    const byeCount = ordered.length % 2;
    const pairCount = Math.floor(ordered.length / 2);
    for (let i = 0; i < pairCount; i += 1) {
        matches.push({
            id: id++, gameweek_id: 11,
            player_a_id: ordered[i * 2], player_b_id: ordered[i * 2 + 1],
            points_a: 3, points_b: 1, winner_id: ordered[i * 2], status: "COMPLETED"
        });
    }
    if (byeCount) byes.push({ id: 99, gameweek_id: 11, player_id: ordered[ordered.length - 1] });
    return { matches, byes };
}

function baseState(overrides = {}) {
    const players = overrides.players || makePlayers(4);
    const prev = completedPrevious(players);
    return {
        players,
        gameweeks: [
            { id: 11, gw_number: 11, chapter: "CHAPTER II — THE INFECTION", status: "COMPLETED" },
            { id: 12, gw_number: 12, chapter: "CHAPTER II — THE INFECTION", status: "PENDING" }
        ],
        matches: prev.matches,
        byes: prev.byes,
        ...overrides
    };
}

test("generates and saves fixtures for the next pending gameweek", async () => {
    const state = baseState();
    let savedArgs = null;
    const saveFixtures = async (args) => {
        savedArgs = args;
        return { ok: true, data: { matches_created: args.fixtures.length } };
    };

    const result = await saveNextGameweekFixtures({ db: makeDb(state), saveFixtures });

    assert.equal(result.ok, true);
    assert.equal(result.status, "SAVED");
    assert.equal(result.gameweek.gw_number, 12);
    assert.equal(result.matches_created, 2);
    assert.equal(savedArgs.gameweekId, 12);
    assert.equal(savedArgs.fixtures.length, 2);
    assert.equal(savedArgs.byePlayerId, null);
});

test("treats a complete existing schedule as ALREADY_SAVED without re-saving", async () => {
    const state = baseState({
        matches: [
            { id: 1, gameweek_id: 11, player_a_id: 1, player_b_id: 2, points_a: 3, points_b: 1, winner_id: 1, status: "COMPLETED" },
            { id: 2, gameweek_id: 11, player_a_id: 3, player_b_id: 4, points_a: 2, points_b: 2, winner_id: 3, status: "COMPLETED" },
            { id: 3, gameweek_id: 12, player_a_id: 1, player_b_id: 3, status: "PENDING" },
            { id: 4, gameweek_id: 12, player_a_id: 2, player_b_id: 4, status: "PENDING" }
        ]
    });
    let saveCalled = false;
    const saveFixtures = async () => { saveCalled = true; return { ok: true, data: {} }; };

    const result = await saveNextGameweekFixtures({ db: makeDb(state), saveFixtures });

    assert.equal(result.ok, true);
    assert.equal(result.status, "ALREADY_SAVED");
    assert.equal(result.matches_created, 2);
    assert.equal(saveCalled, false);
});

test("rejects partial existing coverage as PARTIAL_FIXTURES", async () => {
    const state = baseState({
        matches: [
            { id: 1, gameweek_id: 11, player_a_id: 1, player_b_id: 2, points_a: 3, points_b: 1, winner_id: 1, status: "COMPLETED" },
            { id: 2, gameweek_id: 11, player_a_id: 3, player_b_id: 4, points_a: 2, points_b: 2, winner_id: 3, status: "COMPLETED" },
            { id: 3, gameweek_id: 12, player_a_id: 1, player_b_id: 3, status: "PENDING" }
        ]
    });
    const saveFixtures = async () => { throw new Error("should not save"); };

    const result = await saveNextGameweekFixtures({ db: makeDb(state), saveFixtures });

    assert.equal(result.ok, false);
    assert.equal(result.status, "PARTIAL_FIXTURES");
    assert.equal(result.code, "FIXTURE_COVERAGE_INCOMPLETE");
});

test("returns NO_PENDING_GAMEWEEK when the chapter is complete (GW14 confirmed)", async () => {
    const state = baseState({
        gameweeks: [
            { id: 13, gw_number: 13, chapter: "CHAPTER II — THE INFECTION", status: "COMPLETED" },
            { id: 14, gw_number: 14, chapter: "CHAPTER II — THE INFECTION", status: "COMPLETED" }
        ],
        matches: []
    });
    const saveFixtures = async () => { throw new Error("should not save"); };

    const result = await saveNextGameweekFixtures({ db: makeDb(state), saveFixtures });

    assert.equal(result.ok, true);
    assert.equal(result.status, "NO_PENDING_GAMEWEEK");
    assert.equal(result.gameweek, null);
});

test("reports PREVIOUS_NOT_READY when the prior gameweek is still pending", async () => {
    const state = baseState({
        gameweeks: [
            { id: 11, gw_number: 11, chapter: "CHAPTER II — THE INFECTION", status: "PENDING" },
            { id: 12, gw_number: 12, chapter: "CHAPTER II — THE INFECTION", status: "PENDING" }
        ]
    });
    const saveFixtures = async () => { throw new Error("should not save"); };

    const result = await saveNextGameweekFixtures({ db: makeDb(state), saveFixtures });

    assert.equal(result.ok, false);
    assert.equal(result.status, "PREVIOUS_NOT_READY");
    assert.equal(result.code, "PREVIOUS_GAMEWEEK_MUST_BE_CONFIRMED");
});

test("surfaces BYE_PLAYER_SELECTION_REQUIRED for an odd active roster", async () => {
    const state = baseState({ players: makePlayers(5) });
    const saveFixtures = async () => { throw new Error("should not save"); };

    const result = await saveNextGameweekFixtures({ db: makeDb(state), saveFixtures });

    assert.equal(result.ok, false);
    assert.equal(result.status, "GENERATION_FAILED");
    assert.equal(result.code, "BYE_PLAYER_SELECTION_REQUIRED");
    assert.ok(Array.isArray(result.bye_candidates));
    assert.equal(result.bye_candidates.length, 5);
});

test("saves an odd roster when a valid bye player is supplied", async () => {
    const state = baseState({ players: makePlayers(5) });
    let savedArgs = null;
    const saveFixtures = async (args) => { savedArgs = args; return { ok: true, data: { matches_created: args.fixtures.length } }; };

    const result = await saveNextGameweekFixtures({ db: makeDb(state), saveFixtures, byePlayerId: "5" });

    assert.equal(result.ok, true);
    assert.equal(result.status, "SAVED");
    assert.equal(result.matches_created, 2);
    assert.equal(String(savedArgs.byePlayerId), "5");
});

test("rejects submitted fixtures that differ from the generated schedule", async () => {
    const state = baseState();
    let saveCalled = false;
    const saveFixtures = async () => { saveCalled = true; return { ok: true, data: {} }; };

    const result = await saveNextGameweekFixtures({
        db: makeDb(state), saveFixtures,
        expectedFixtures: [{ player_a_id: 1, player_b_id: 2 }]
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, "PREVIEW_MISMATCH");
    assert.equal(saveCalled, false);
});

test("recovers from an ALREADY_EXIST race when stored fixtures are complete", async () => {
    const state = baseState();
    const saveFixtures = async () => ({ ok: false, code: "FIXTURES_ALREADY_EXIST", message: "FIXTURES_ALREADY_EXIST" });

    const result = await saveNextGameweekFixtures({ db: makeDb(state), saveFixtures });

    // No fixtures were actually stored in state, so coverage is incomplete.
    assert.equal(result.ok, false);
    assert.equal(result.status, "PARTIAL_FIXTURES");
});

test("verifyFixtureCoverage accepts a complete schedule and rejects duplicates", () => {
    const players = makePlayers(4);
    const gameweek = { id: 12, gw_number: 12 };
    const complete = [
        { gameweek_id: 12, player_a_id: 1, player_b_id: 2 },
        { gameweek_id: 12, player_a_id: 3, player_b_id: 4 }
    ];
    assert.equal(verifyFixtureCoverage({ players, gameweek, matches: complete, byes: [] }).ok, true);

    const duplicate = [
        { gameweek_id: 12, player_a_id: 1, player_b_id: 2 },
        { gameweek_id: 12, player_a_id: 1, player_b_id: 3 }
    ];
    assert.equal(verifyFixtureCoverage({ players, gameweek, matches: duplicate, byes: [] }).ok, false);
});

test("lost-response ALREADY_EXIST recovers to ALREADY_SAVED with no extra writes", async () => {
    const state = baseState();
    let saveCalls = 0;
    const saveFixtures = async ({ gameweekId, fixtures }) => {
        saveCalls += 1;
        // Simulate the RPC committing the full set while the HTTP response is lost.
        fixtures.forEach((f, i) => state.matches.push({
            id: 1000 + i, gameweek_id: gameweekId,
            player_a_id: f.player_a_id, player_b_id: f.player_b_id, status: "PENDING"
        }));
        return { ok: false, code: "FIXTURES_ALREADY_EXIST", message: "FIXTURES_ALREADY_EXIST" };
    };

    const result = await saveNextGameweekFixtures({ db: makeDb(state), saveFixtures });

    assert.equal(result.ok, true);
    assert.equal(result.status, "ALREADY_SAVED");
    assert.equal(result.matches_created, 2);
    assert.equal(saveCalls, 1, "helper must not re-issue the write after ALREADY_EXIST");
    const storedForTarget = state.matches.filter(match => String(match.gameweek_id) === "12");
    assert.equal(storedForTarget.length, 2, "no duplicate fixtures were added");
});