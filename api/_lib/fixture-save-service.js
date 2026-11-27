"use strict";

const { generateFixtures, pairKey, filterPreviousMatchesToChapter } = require("./fixture-generator");
const { isPreviousGameweekConfirmed } = require("./next-gameweek");
const { auditChapterMatchHistory } = require("./chapter-history");

function isActivePlayer(player) {
    return player && player.is_active !== false && Number(player.hearts) > 0;
}

function hasFixtures(gameweek, matches, byes) {
    return matches.some(match => String(match.gameweek_id) === String(gameweek.id)) ||
        byes.some(bye => String(bye.gameweek_id) === String(gameweek.id));
}

function pendingGameweekSummary(gameweeks, matches, byes) {
    return gameweeks
        .filter(row => String(row.status || "").trim().toUpperCase() === "PENDING")
        .sort((a, b) => Number(a.gw_number) - Number(b.gw_number))
        .map(row => ({
            gw_number: row.gw_number,
            status: row.status,
            has_fixtures: hasFixtures(row, matches, byes)
        }));
}

/**
 * Verifies that the fixtures already persisted for a gameweek provide complete,
 * non-duplicated coverage of the active roster. Used to treat a repeated save as
 * success only when the stored schedule is genuinely complete.
 */
function verifyFixtureCoverage({ players, gameweek, matches, byes }) {
    const activeIds = new Set(players.filter(isActivePlayer).map(player => String(player.id)));
    const gwMatches = matches.filter(row => String(row.gameweek_id) === String(gameweek.id));
    const gwByes = byes.filter(row => String(row.gameweek_id) === String(gameweek.id));

    if (gwByes.length > 1) {
        return { ok: false, code: "FIXTURE_BYE_COUNT_INVALID", detail: "More than one bye is stored for the gameweek." };
    }

    const seen = new Set();
    for (const match of gwMatches) {
        for (const id of [match.player_a_id, match.player_b_id]) {
            if (id === null || id === undefined) {
                return { ok: false, code: "FIXTURE_PARTICIPANT_INVALID", detail: "A stored fixture has a missing player." };
            }
            const key = String(id);
            if (!activeIds.has(key) || seen.has(key)) {
                return { ok: false, code: "FIXTURE_PARTICIPANT_INVALID", detail: "A stored fixture references an inactive or duplicated player." };
            }
            seen.add(key);
        }
    }
    for (const bye of gwByes) {
        if (bye.player_id === null || bye.player_id === undefined) {
            return { ok: false, code: "FIXTURE_PARTICIPANT_INVALID", detail: "The stored bye has a missing player." };
        }
        const key = String(bye.player_id);
        if (!activeIds.has(key) || seen.has(key)) {
            return { ok: false, code: "FIXTURE_PARTICIPANT_INVALID", detail: "The stored bye references an inactive or duplicated player." };
        }
        seen.add(key);
    }

    const expectedMatches = Math.floor(activeIds.size / 2);
    const expectedByes = activeIds.size % 2;
    if (gwMatches.length !== expectedMatches || gwByes.length !== expectedByes || seen.size !== activeIds.size) {
        return {
            ok: false,
            code: "FIXTURE_COVERAGE_INCOMPLETE",
            detail: `Stored fixtures cover ${seen.size} of ${activeIds.size} active players.`
        };
    }

    return { ok: true, matches: gwMatches.length, byes: gwByes.length, players: seen.size };
}

function normalizedPairSet(fixtures) {
    return new Set(fixtures.map(match => pairKey(match.player_a_id, match.player_b_id)));
}

/**
 * Generates and persists the next gameweek's fixtures using the committed player
 * states and completed previous-gameweek data.
 *
 * Injectable dependencies keep the service unit-testable and preserve the
 * service_role boundary (callers pass service-role db/save functions):
 *   db(path) -> Promise<data>            read via Supabase REST (service role)
 *   saveFixtures({ gameweekId, fixtures, byePlayerId })
 *       -> Promise<{ ok, code?, detail?, data? }>  calls save_gameweek_fixtures RPC
 *
 * Options:
 *   byePlayerId      chosen bye player (required when the active roster is odd)
 *   expectedFixtures optional admin-submitted fixtures; when present they must
 *                    match the server-generated schedule before anything is saved
 *
 * The result is always a structured object (never throws for expected states):
 *   status: SAVED | ALREADY_SAVED | NO_PENDING_GAMEWEEK | PREVIEW_MISMATCH |
 *           PARTIAL_FIXTURES | GENERATION_FAILED | SAVE_FAILED |
 *           INVALID_TARGET | PREVIOUS_NOT_READY | HISTORY_FAILED
 */
async function saveNextGameweekFixtures({ db, saveFixtures, byePlayerId = null, expectedFixtures = null }) {
    if (typeof db !== "function" || typeof saveFixtures !== "function") {
        throw new Error("FIXTURE_SAVE_SERVICE_INPUT_INVALID");
    }

    const [players, gameweeks, allMatches, allByes] = await Promise.all([
        db("players?select=id,name,status,hearts,is_infected,is_active&order=id.asc"),
        db("gameweeks?select=id,gw_number,chapter,status&order=gw_number.asc"),
        db("matches?select=id,gameweek_id,player_a_id,player_b_id,points_a,points_b,winner_id,winner_method,status&order=id.asc"),
        db("gameweek_byes?select=id,gameweek_id,player_id")
    ]);

    const pending = pendingGameweekSummary(gameweeks, allMatches, allByes);

    // The next gameweek to populate is the earliest pending round that directly
    // follows an existing round. Unlike a pure "needs fixtures" selection, this
    // keeps a round with partial fixtures in scope so its coverage can be
    // verified instead of silently skipped.
    const pendingSorted = gameweeks
        .filter(row => String(row.status || "").trim().toUpperCase() === "PENDING")
        .sort((a, b) => Number(a.gw_number) - Number(b.gw_number));
    const gameweek = pendingSorted.find(row =>
        gameweeks.some(item => Number(item.gw_number) === Number(row.gw_number) - 1)
    ) || null;

    if (!gameweek) {
        return { ok: true, status: "NO_PENDING_GAMEWEEK", gameweek: null, pending_gameweeks: pending };
    }

    const currentGw = Number(gameweek.gw_number);
    if (!Number.isInteger(currentGw) || currentGw < 2 || currentGw > 38) {
        return { ok: false, status: "INVALID_TARGET", code: "CURRENT_GAMEWEEK_INVALID", gameweek, pending_gameweeks: pending };
    }

    const previousGameweek = gameweeks.find(row => Number(row.gw_number) === currentGw - 1);
    if (!previousGameweek) {
        return { ok: false, status: "PREVIOUS_NOT_READY", code: "PREVIOUS_GAMEWEEK_NOT_FOUND", gameweek, previous_gw: currentGw - 1 };
    }
    if (!isPreviousGameweekConfirmed(gameweeks, gameweek)) {
        return {
            ok: false, status: "PREVIOUS_NOT_READY", code: "PREVIOUS_GAMEWEEK_MUST_BE_CONFIRMED",
            gameweek, previous_gw: previousGameweek.gw_number, previous_status: previousGameweek.status
        };
    }

    const requiredPlayerIds = players.filter(isActivePlayer).map(player => player.id);
    const historyAudit = auditChapterMatchHistory({
        gameweeks, matches: allMatches, byes: allByes, players,
        currentGameweek: gameweek,
        throughGameweek: currentGw - 1,
        requiredPlayerIds
    });
    if (!historyAudit.ok) {
        return { ok: false, status: "HISTORY_FAILED", code: "CHAPTER_OPPONENT_HISTORY_FAILED", gameweek, audit: historyAudit };
    }

    if (hasFixtures(gameweek, allMatches, allByes)) {
        const coverage = verifyFixtureCoverage({ players, gameweek, matches: allMatches, byes: allByes });
        if (!coverage.ok) {
            return { ok: false, status: "PARTIAL_FIXTURES", code: coverage.code, detail: coverage.detail, gameweek, pending_gameweeks: pending };
        }
        return {
            ok: true, status: "ALREADY_SAVED", gameweek: { id: gameweek.id, gw_number: currentGw },
            matches_created: coverage.matches, bye_count: coverage.byes
        };
    }

    const previousMatches = filterPreviousMatchesToChapter(allMatches, gameweeks, gameweek);

    let generated;
    try {
        generated = generateFixtures({ players, previousMatches, byePlayerId });
    } catch (error) {
        return {
            ok: false, status: "GENERATION_FAILED", code: error.message,
            bye_candidates: error.bye_candidates, gameweek, pending_gameweeks: pending
        };
    }

    if (expectedFixtures !== null && expectedFixtures !== undefined) {
        if (!Array.isArray(expectedFixtures) || expectedFixtures.length === 0) {
            return { ok: false, status: "PREVIEW_MISMATCH", code: "FIXTURE_APPROVAL_PAYLOAD_REQUIRED", gameweek };
        }
        const submittedPairs = normalizedPairSet(expectedFixtures);
        const generatedPairs = normalizedPairSet(generated.matches);
        if (expectedFixtures.length !== generated.matches.length ||
            submittedPairs.size !== generatedPairs.size ||
            [...generatedPairs].some(pair => !submittedPairs.has(pair))) {
            return { ok: false, status: "PREVIEW_MISMATCH", code: "FIXTURE_PREVIEW_MISMATCH", gameweek, generated };
        }
    }

    const fixtures = generated.matches.map(match => ({
        player_a_id: match.player_a_id,
        player_b_id: match.player_b_id
    }));
    const resolvedByePlayerId = generated.bye ? generated.bye.player_id : null;

    let saved;
    try {
        saved = await saveFixtures({ gameweekId: gameweek.id, fixtures, byePlayerId: resolvedByePlayerId });
    } catch (error) {
        return { ok: false, status: "SAVE_FAILED", code: "FIXTURE_SAVE_FAILED", detail: String(error && error.message || ""), gameweek };
    }

    if (!saved || saved.ok !== true) {
        const message = String(saved && (saved.message || saved.detail) || "");
        if (/ALREADY_EXIST/i.test(message) || (saved && saved.code === "FIXTURES_ALREADY_EXIST")) {
            const [freshMatches, freshByes] = await Promise.all([
                db(`matches?select=id,gameweek_id,player_a_id,player_b_id&gameweek_id=eq.${encodeURIComponent(gameweek.id)}`),
                db(`gameweek_byes?select=id,gameweek_id,player_id&gameweek_id=eq.${encodeURIComponent(gameweek.id)}`)
            ]);
            const coverage = verifyFixtureCoverage({ players, gameweek, matches: freshMatches, byes: freshByes });
            if (coverage.ok) {
                return {
                    ok: true, status: "ALREADY_SAVED", gameweek: { id: gameweek.id, gw_number: currentGw },
                    matches_created: coverage.matches, bye_count: coverage.byes
                };
            }
            return { ok: false, status: "PARTIAL_FIXTURES", code: coverage.code, detail: coverage.detail, gameweek, pending_gameweeks: pending };
        }
        if (/NOT_PENDING|INVALID|COVERAGE|REMATCH|DUPLICATE/i.test(message)) {
            return { ok: false, status: "SAVE_FAILED", code: "FIXTURE_SAVE_REJECTED", detail: message, gameweek };
        }
        return { ok: false, status: "SAVE_FAILED", code: "FIXTURE_SAVE_FAILED", detail: message, gameweek };
    }

    return {
        ok: true, status: "SAVED", gameweek: { id: gameweek.id, gw_number: currentGw },
        matches_created: (saved.data && saved.data.matches_created) || generated.matches.length,
        bye_player_id: resolvedByePlayerId,
        generated
    };
}

module.exports = { saveNextGameweekFixtures, verifyFixtureCoverage };