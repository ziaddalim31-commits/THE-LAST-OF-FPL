"use strict";

// THE LAST OF FPL — Live Match Centre, Phase 1A
// Read-only proxy for Fantasy Premier League. GW9 only.
// No Supabase client, no credentials, no writes of any kind.

const FPL_LINKS = require("../data/fpl-links.json");

const GW = 9;
const FPL_BASE = "https://fantasy.premierleague.com/api";
const LIVE_TTL_MS = 45 * 1000;
const PICKS_TTL_MS = 15 * 60 * 1000;
const EVENTS_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6000;
const TOTAL_BUDGET_MS = 8000;
const PICK_CONCURRENCY = 4;
const PICK_GAP_MS = 180;

const cache = {
    live: { at: 0, elements: null },
    picks: { byEntry: new Map() },
    events: { at: 0, event: null }
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

async function getEvent(deadline) {
    const now = Date.now();
    if (cache.events.event && now - cache.events.at < EVENTS_TTL_MS) {
        return { ok: true, data: cache.events.event, stale: false };
    }

    const result = await fplFetch("/events/", deadline);
    if (!result.ok) {
        if (cache.events.event) return { ok: true, data: cache.events.event, stale: true };
        return result;
    }

    const event = Array.isArray(result.data) ? result.data.find(item => item.id === GW) : null;
    if (!event) return { ok: false, status: 502, error: "gameweek_not_found" };

    cache.events = { at: now, event };
    return { ok: true, data: event, stale: false };
}

async function getLiveElements(deadline) {
    const now = Date.now();
    if (cache.live.elements && now - cache.live.at < LIVE_TTL_MS) {
        return { ok: true, elements: cache.live.elements, at: cache.live.at, stale: false };
    }

    const result = await fplFetch(`/event/${GW}/live/`, deadline);
    if (!result.ok) {
        if (cache.live.elements) {
            return { ok: true, elements: cache.live.elements, at: cache.live.at, stale: true };
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

    cache.live = { at: now, elements };
    return { ok: true, elements, at: now, stale: false };
}

async function getPicks(entryId, deadline) {
    const cached = cache.picks.byEntry.get(entryId);
    if (cached && Date.now() - cached.at < PICKS_TTL_MS) {
        return { ok: true, data: cached.data, stale: false };
    }

    const result = await fplFetch(`/entry/${entryId}/event/${GW}/picks/`, deadline);
    if (!result.ok) {
        if (cached) return { ok: true, data: cached.data, stale: true };
        return result;
    }

    cache.picks.byEntry.set(entryId, { at: Date.now(), data: result.data });
    return { ok: true, data: result.data, stale: false };
}

async function getAllPicks(entryIds, deadline) {
    const results = new Map();
    const queue = entryIds.slice();

    const workers = Array.from({ length: Math.min(PICK_CONCURRENCY, queue.length) }, async () => {
        while (queue.length) {
            const entryId = queue.shift();
            results.set(entryId, await getPicks(entryId, deadline));
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

    if (requestedGw && String(requestedGw) !== String(GW)) {
        return send(res, 400, { ok: false, error: "only_gw9_supported", gw: GW });
    }

    if (!FPL_LINKS || typeof FPL_LINKS !== "object") {
        return send(res, 500, { ok: false, error: "mapping_unavailable" });
    }

    const deadline = Date.now() + TOTAL_BUDGET_MS;

    const [eventResult, liveResult] = await Promise.all([
        getEvent(deadline),
        getLiveElements(deadline)
    ]);

    if (!liveResult.ok) {
        return send(res, 503, {
            ok: false,
            error: "live_data_unavailable",
            detail: liveResult.error || "unknown",
            gw: GW
        });
    }

    const entries = Object.keys(FPL_LINKS).map(playerId => ({
        playerId,
        entryId: FPL_LINKS[playerId]
    }));

    const picksResults = await getAllPicks(entries.map(entry => entry.entryId), deadline);

    const players = {};
    let stale = Boolean(liveResult.stale);

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

    const status = deriveStatus(eventResult.ok ? eventResult.data : null);

    send(res, 200, {
        ok: true,
        phase: "1A",
        gw: GW,
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
