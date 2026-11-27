"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

// Limitation: a true concurrent/DB-level test requires PostgreSQL. The real
// confirm_gameweek_results relies on SELECT ... FOR UPDATE plus a
// GAMEWEEK_NOT_PENDING guard, which cannot run in this JS-only suite without a
// database (and must never touch Production). This isolated test models the same
// single-application invariant: once a gameweek leaves PENDING, a second
// confirmation is rejected and applies no further player/hearts/status changes.

function applyLoss(player) {
    if (player.status === "SAFE") player.status = "NORMAL";
    else if (player.status === "NORMAL") player.status = "DANGER";
    else if (player.status === "DANGER" || player.is_infected) {
        player.hearts = Math.max(0, player.hearts - 1);
    }
    player.is_active = player.hearts > 0;
}

test("a second confirmation cannot apply results, hearts, or status twice", () => {
    const store = {
        gameweekStatus: "PENDING",
        player: { id: 1, status: "NORMAL", hearts: 2, is_infected: false, is_active: true }
    };

    function confirmGameweekResults() {
        if (store.gameweekStatus !== "PENDING") throw new Error("GAMEWEEK_NOT_PENDING");
        applyLoss(store.player);            // exactly one transition
        store.gameweekStatus = "COMPLETED"; // leaves PENDING
        return "OK";
    }

    assert.equal(confirmGameweekResults(), "OK");
    assert.throws(() => confirmGameweekResults(), /GAMEWEEK_NOT_PENDING/);

    // A single NORMAL loss moves to DANGER without touching hearts. A double
    // application would have applied a DANGER loss (hearts 2 -> 1), so
    // hearts === 2 proves the result was applied exactly once.
    assert.equal(store.player.status, "DANGER");
    assert.equal(store.player.hearts, 2);
    assert.equal(store.gameweekStatus, "COMPLETED");
});