"use strict";

// THE LAST OF FPL — Live Match Centre, Phase 1A
// Read-only proxy for Fantasy Premier League. Any valid gameweek 1–38.
// No Supabase client, no credentials, no writes of any kind.

const FPL_LINKS = require("../data/fpl-links.json");

const GW_MIN = 1;
const GW_MAX = 38;
const FPL_BASE = "https://fantasy.premierleague.com/api";
const LIVE_TTL_MS = 45 * 1000;
const PICKS_TTL_MS = 15 * 60 * 1000;
const EVENTS_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6000;
const TOTAL_BUDGET_MS = 8000;
const PICK_CONCURRENCY = 4;
const PICK_GAP_MS = 180;

const cache = {
    live: new Map(),
    picks: new Map(),
    events: { at: 0, data: null }
};

const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fplFetch(path, deadline) {
    const remaining = Math.max(0, deadline - Date.now());
    if (remaining < 400) return { ok: false, status: 0, error: "budget_exhausted" };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(FETCH_TIMEOUT_MS, remaining));

    try {
        const response = await fetch(FPL_BASE + path, {
            headers: {
                "User-Agent": USER_AGENT,
                Accept: "application/json",
                Referer: "https://fantasy.premierleague.com/"
            },
            signal: controller.signal
        });

        if (response.status === 429) return { ok: false, status: 429, error: "rate_limited" };
        if (!response.ok) return { ok: false, status: response.status, error: "http_" + response.status };

        return { ok: true, status: response.status, data: await response.json() };
    } catch (error) {
        const reason = error && error.name === "AbortError" ? "timeout" : "network";
        return { ok: false, status: 0, error: reason };
    } finally {
        clearTimeout(timer);
    }
}

function parseGameweek(value) {
    if (value === null || value === undefined) return null;

    const text = String(value).trim();
    if (!text) return null;

    const numeric = Number(text);
    if (!Number.isInteger(numeric) || numeric < GW_MIN || numeric > GW_MAX) {
        return NaN;
    }

    return numeric;
}

async function getEvents(deadline) {
    const now = Date.now();
    if (cache.events.data && now - cache.events.at < EVENTS_TTL_MS) {
        return { ok: true, data: cache.events.data, stale: false };
    }

    const result = await fplFetch("/events/", deadline);
    if (!result.ok) {
        if (cache.events.data) return { ok: true, data: cache.events.data, stale: true };
        return result;
    }

    const data = Array.isArray(result.data) ? result.data : [];
    cache.events = { at: now, data };
    return { ok: true, data, stale: false };
}

function chooseCurrentEvent(events) {
    if (!Array.isArray(events) || events.length === 0) return null;

    return (
        events.find(event => event.is_current === true) ||
        events.find(event => event.is_next === true) ||
        events.filter(event => event.finished === false).sort((a, b) => a.id - b.id)[0] ||
        events.slice().sort((a, b) => b.id - a.id)[0] ||
        null
    );
}

async function getLiveElements(gw, deadline) {
    const now = Date.now();
    const cached = cache.live.get(gw);
    if (cached && now - cached.at < LIVE_TTL_MS) {
        return { ok: true, elements: cached.elements, at: cached.at, stale: false };
    }

    const result = await fplFetch(`/event/${gw}/live/`, deadline);
    if (!result.ok) {
        if (cached) {
            return { ok: true, elements: cached.elements, at: cached.at, stale: true };
        }
        return result;
    }

    const elements = new Map();
    for (const row of result.data.elements || []) {
        const stats = row.stats || {};
        elements.set(row.id, {
            points: Number(stats.total_points) || 0,
            minutes: Number(stats.minutes) || 0
        });
    }

    cache.live.set(gw, { at: now, elements });
    return { ok: true, elements, at: now, stale: false };
}

async function getPicks(entryId, gw, deadline) {
    const key = `${entryId}:${gw}`;
    const cached = cache.picks.get(key);
    if (cached && Date.now() - cached.at < PICKS_TTL_MS) {
        return { ok: true, data: cached.data, stale: false };
    }

    const result = await fplFetch(`/entry/${entryId}/event/${gw}/picks/`, deadline);
    if (!result.ok) {
        if (cached) return { ok: true, data: cached.data, stale: true };
        return result;
    }

    cache.picks.set(key, { at: Date.now(), data: result.data });
    return { ok: true, data: result.data, stale: false };
}

async function getAllPicks(entryIds, gw, deadline) {
    const results = new Map();
    const queue = entryIds.slice();

    const workers = Array.from({ length: Math.min(PICK_CONCURRENCY, queue.length) }, async () => {
        while (queue.length) {
            const entryId = queue.shift();
            results.set(entryId, await getPicks(entryId, gw, deadline));
            await sleep(PICK_GAP_MS);
        }
    });

    await Promise.all(workers);
    return results;
}

function scoreEntry(picksPayload, elements) {
    const picks = picksPayload && Array.isArray(picksPayload.picks) ? picksPayload.picks : null;
    if (!picks) return { points: null, onField: 0, cost: 0, error: "picks_unavailable" };

    let total = 0;
    let onField = 0;
    let missing = 0;

    for (const pick of picks) {
        const position = Number(pick.position);
        if (!Number.isFinite(position) || position < 1 || position > 11) continue;

        // Bench (including Bench Boost) never counts; Triple Captain bonus is capped at x2.
        const multiplier = Math.min(Number(pick.multiplier) || 0, 2);
        if (multiplier <= 0) continue;

        const element = elements.get(pick.element);
        if (!element) {
            missing += 1;
            continue;
        }

        total += element.points * multiplier;
        onField += 1;
    }

    if (missing > 0) return { points: null, onField, cost: 0, error: "element_missing" };

    const history = picksPayload.entry_history || null;
    const rawCost = history ? Number(history.event_transfers_cost) : 0;
    const cost = Number.isFinite(rawCost) && rawCost > 0 ? rawCost : 0;

    return { points: total - cost, onField, cost, error: null };
}

function deriveStatus(event) {
    if (!event) return "UNKNOWN";
    if (event.finished) return "FINISHED";
    if (event.is_current) return "LIVE";
    return "UPCOMING";
}

function send(res, status, body, cacheControl) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", cacheControl || "no-store");
    res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
    if (!req || (req.method && String(req.method).toUpperCase() !== "GET")) {
        return send(res, 405, { ok: false, error: "method_not_allowed" });
    }

    let requestedGw = null;
    try {
        const url = new URL(req.url || "/api/live", "http://localhost");
        requestedGw = url.searchParams.get("gw");
    } catch (error) {
        requestedGw = null;
    }

    const gwParam = parseGameweek(requestedGw);
    if (Number.isNaN(gwParam)) {
        return send(res, 400, {
            ok: false,
            error: "invalid_gameweek",
            detail: `Gameweek must be an integer between ${GW_MIN} and ${GW_MAX}.`
        });
    }

    if (!FPL_LINKS || typeof FPL_LINKS !== "object") {
        return send(res, 500, { ok: false, error: "mapping_unavailable" });
    }

    const deadline = Date.now() + TOTAL_BUDGET_MS;

    const eventsResult = await getEvents(deadline);
    let event = null;
    let gw = gwParam;

    if (gw === null) {
        if (!eventsResult.ok) {
            return send(res, 503, {
                ok: false,
                error: "gameweek_unavailable",
                detail: eventsResult.error || "unknown"
            });
        }

        event = chooseCurrentEvent(eventsResult.data);
        if (!event) {
            return send(res, 503, { ok: false, error: "gameweek_not_found" });
        }

        gw = event.id;
    } else if (eventsResult.ok) {
        event = eventsResult.data.find(item => Number(item.id) === gw) || null;

        if (!event) {
            return send(res, 404, { ok: false, error: "gameweek_not_found", gw });
        }
    }

    const liveResult = await getLiveElements(gw, deadline);

    if (!liveResult.ok) {
        return send(res, 503, {
            ok: false,
            error: "live_data_unavailable",
            detail: liveResult.error || "unknown",
            gw
        });
    }

    const entries = Object.keys(FPL_LINKS).map(playerId => ({
        playerId,
        entryId: FPL_LINKS[playerId]
    }));

    const picksResults = await getAllPicks(
        entries.map(entry => entry.entryId),
        gw,
        deadline
    );

    const players = {};
    let stale = Boolean(liveResult.stale || eventsResult.stale);

    for (const { playerId, entryId } of entries) {
        const picksResult = picksResults.get(entryId);

        if (!picksResult || !picksResult.ok) {
            players[playerId] = {
                fpl_entry_id: entryId,
                points: null,
                error: picksResult ? picksResult.error || "picks_unavailable" : "picks_unavailable"
            };
            continue;
        }

        if (picksResult.stale) stale = true;
        const score = scoreEntry(picksResult.data, liveResult.elements);

        players[playerId] = {
            fpl_entry_id: entryId,
            points: score.points,
            on_field: score.onField,
            stale: Boolean(picksResult.stale),
            error: score.error
        };
    }

    const status = deriveStatus(event);

    send(res, 200, {
        ok: true,
        phase: "1A",
        gw,
        status,
        provisional: true,
        stale,
        updated_at: new Date(liveResult.at).toISOString(),
        source: "fantasy.premierleague.com",
        players,
        warnings: [
            "Provisional scores: starting XI only — bench points and Bench Boost are excluded.",
            "Triple Captain bonus is excluded; the captain is counted at x2.",
            "Transfer hits (entry_history.event_transfers_cost) are deducted.",
            "Automatic substitutions (autosubs) are not applied.",
            "Numbers may change until the gameweek is officially completed."
        ]
    }, "public, s-maxage=30, stale-while-revalidate=60");
};
