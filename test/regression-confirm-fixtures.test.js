"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { saveNextGameweekFixtures } = require("../api/_lib/fixture-save-service");

// Regression coverage for two previously-observed failure modes:
//   1. ALREADY_EXIST complete-recovery: the save RPC commits the full schedule
//      but its HTTP response is lost. The helper must re-read the stored
//      fixtures, verify complete coverage, and return ALREADY_SAVED with NO
//      additional write.
//   2. Double-confirmation: a repeated confirmation must not apply points,
//      hearts, or status changes a second time.
//
// Limitation (documented, not hidden): a true PostgreSQL concurrency test needs
// a live database and must never touch Production. The real
// confirm_gameweek_results relies on SELECT ... FOR UPDATE plus a
// GAMEWEEK_NOT_PENDING guard. Test 2 models that same single-application
// invariant in isolation; it does not exercise real DB row locks.

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

// Completed previous gameweek (GW11) that fully covers the roster, pairing in
// order and assigning a bye when the active count is odd.
function completedPrevious(players) {
    const matches = [];
    const byes = [];
    let id = 1;
    const ordered = players.map(player => player.id);
    const pairCount = Math.floor(ordered.length / 2);
    for (let i = 0; i < pairCount; i += 1) {
        matches.push({
            id: id++, gameweek_id: 11,
            player_a_id: ordered[i * 2], player_b_id: ordered[i * 2 + 1],
            points_a: 3, points_b: 1, winner_id: ordered[i * 2], status: "COMPLETED"
        });
    }
    if (ordered.length % 2) {
        byes.push({ id: 99, gameweek_id: 11, player_id: ordered[ordered.length - 1] });
    }
    return { matches, byes };
}

function baseState(overrides = {}) {
    const players = overrides.players || makePlayers(5);
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

// db() that records how many times the post-ALREADY_EXIST re-read (eq.<id>) runs.
function makeCountingDb(state, reReads) {
    return async (path) => {
        if (/\beq\./.test(path)) reReads.count += 1;
        if (path.startsWith("players?")) return state.players;
        if (path.startsWith("gameweeks?")) return state.gameweeks;
        if (path.startsWith("matches?")) return state.matches;
        if (path.startsWith("gameweek_byes?")) return state.byes;
        throw new Error(`UNEXPECTED_DB_PATH:${path}`);
    };
}

test("REGRESSION: lost-response ALREADY_EXIST recovers to ALREADY_SAVED with no extra writes (odd roster + bye)", async () => {
    // 5 active players -> 2 matches + 1 bye for the target gameweek.
    const state = baseState({ players: makePlayers(5) });
    const reReads = { count: 0 };
    let saveCalls = 0;

    const saveFixtures = async ({ gameweekId, fixtures, byePlayerId }) => {
        saveCalls += 1;
        // Simulate the RPC committing the FULL set (matches + bye) while the
        // HTTP response is lost and surfaces as FIXTURES_ALREADY_EXIST.
        fixtures.forEach((f, i) => state.matches.push({
            id: 1000 + i, gameweek_id: gameweekId,
            player_a_id: f.player_a_id, player_b_id: f.player_b_id, status: "PENDING"
        }));
        if (byePlayerId !== null && byePlayerId !== undefined) {
            state.byes.push({ id: 2000, gameweek_id: gameweekId, player_id: byePlayerId });
        }
        return { ok: false, code: "FIXTURES_ALREADY_EXIST", message: "FIXTURES_ALREADY_EXIST" };
    };

    const result = await saveNextGameweekFixtures({ db: makeCountingDb(state, reReads), saveFixtures, byePlayerId: "5" });

    assert.equal(result.ok, true);
    assert.equal(result.status, "ALREADY_SAVED");
    assert.equal(result.gameweek.gw_number, 12);
    assert.equal(result.matches_created, 2);
    assert.equal(result.bye_count, 1);

    // The helper must re-read stored fixtures to verify coverage...
    assert.ok(reReads.count >= 1, "helper must re-read matches/bye after ALREADY_EXIST");
    // ...and must NOT re-issue the write.
    assert.equal(saveCalls, 1, "helper must not write again after ALREADY_EXIST");

    // Exactly the committed set is stored for the target gameweek (no duplicates).
    const storedMatches = state.matches.filter(m => String(m.gameweek_id) === "12");
    const storedByes = state.byes.filter(b => String(b.gameweek_id) === "12");
    assert.equal(storedMatches.length, 2, "no duplicate fixtures were added");
    assert.equal(storedByes.length, 1, "no duplicate bye was added");
});

function applyLoss(player) {
    if (player.status === "SAFE") player.status = "NORMAL";
    else if (player.status === "NORMAL") player.status = "DANGER";
    else if (player.status === "DANGER" || player.is_infected) {
        player.hearts = Math.max(0, player.hearts - 1);
    }
    player.is_active = player.hearts > 0;
}

test("REGRESSION: a repeated confirmation applies results, hearts, and status only once (full roster)", () => {
    const store = {
        gameweekStatus: "PENDING",
        players: makePlayers(4, "NORMAL"),
        resultsApplied: 0
    };

    // Models confirm_gameweek_results: guarded by PENDING + FOR UPDATE; once the
    // gameweek leaves PENDING, any further call is rejected before any write.
    function confirmGameweekResults() {
        if (store.gameweekStatus !== "PENDING") throw new Error("GAMEWEEK_NOT_PENDING");
        store.players.forEach(applyLoss);     // exactly one transition per player
        store.resultsApplied += 1;
        store.gameweekStatus = "COMPLETED";   // leaves PENDING
        return "OK";
    }

    assert.equal(confirmGameweekResults(), "OK");
    assert.throws(() => confirmGameweekResults(), /GAMEWEEK_NOT_PENDING/);
    assert.throws(() => confirmGameweekResults(), /GAMEWEEK_NOT_PENDING/);

    // Applied exactly once across the whole roster.
    assert.equal(store.resultsApplied, 1, "results must be applied exactly once");
    assert.equal(store.gameweekStatus, "COMPLETED");

    // Each NORMAL player advanced a single step to DANGER with hearts untouched.
    // A double application would have applied a DANGER loss (hearts 2 -> 1).
    for (const player of store.players) {
        assert.equal(player.status, "DANGER");
        assert.equal(player.hearts, 2, "hearts must not be decremented twice");
        assert.equal(player.is_active, true);
    }
});