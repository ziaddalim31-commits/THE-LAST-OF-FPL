"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sqlPath = path.join(__dirname, "..", "player_gameweek_history.sql");
const sql = fs.readFileSync(sqlPath, "utf8");

function extractFunction(source, name) {
    const start = source.indexOf(`function public.${name}(`);
    assert.notEqual(start, -1, `function ${name} must exist`);
    const bodyStart = source.indexOf("as $$", start);
    const bodyEnd = source.indexOf("$$;", bodyStart);
    return source.slice(bodyStart, bodyEnd);
}

test("confirm_gameweek_results gates the next-gameweek insert behind v_gw_number < 14", () => {
    const body = extractFunction(sql, "confirm_gameweek_results");

    assert.match(body, /if v_gw_number < 14 then/i,
        "GW15 creation must be guarded by 'if v_gw_number < 14 then'");

    // The insert must live inside that guard, not run unconditionally.
    const guardIndex = body.search(/if v_gw_number < 14 then/i);
    const insertIndex = body.search(/insert into public\.gameweeks/i);
    assert.ok(guardIndex !== -1 && insertIndex !== -1 && guardIndex < insertIndex,
        "the next-gameweek insert must appear after the v_gw_number < 14 guard");

    // The old unconditional CHAPTER III transition must be gone.
    assert.ok(!/CHAPTER III — THE FOREST/i.test(body),
        "confirm_gameweek_results must no longer reference a CHAPTER III transition");
});

test("save_gameweek_fixtures still rejects an already-populated gameweek", () => {
    const body = extractFunction(sql, "save_gameweek_fixtures");
    assert.match(body, /FIXTURES_ALREADY_EXIST/i);
});