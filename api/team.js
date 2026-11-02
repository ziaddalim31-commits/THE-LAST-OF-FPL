"use strict";

// THE LAST OF FPL — Participant Team View, Phase 2 (API only)
// Read-only proxy for one participant's FPL squad. GW selection is dynamic.
// No Supabase client, no credentials, no writes of any kind.

const FPL_LINKS = require("../data/fpl-links.json");

const FPL_BASE = "https://fantasy.premierleague.com/api";
const PHOTO_BASE = "https://resources.premierleague.com/premierleague/photos/players/110x140";
const BADGE_BASE = "https://resources.premierleague.com/premierleague/badges/50";

const BOOTSTRAP_TTL_MS = 12 * 60 * 1000;
const PICKS_TTL_MS = 15 * 60 * 1000;
const LIVE_TTL_MS = 45 * 1000;
const ENTRY_TTL_MS = 30 * 60 * 1000;
const STATUS_TTL_MS = 10 * 60 * 1000;

const FETCH_TIMEOUT_MS = 6000;
const TOTAL_BUDGET_MS = 8500;
const MAX_GW_FALLBACK = 3;

const RESPONSE_CACHE_CONTROL = "public, s-maxage=30, stale-while-revalidate=60";

const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

const cache = {
    bootstrap: new Map(),
    picks: new Map(),
    live: new Map(),
    entry: new Map(),
    eventStatus: new Map()
};

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

async function cachedJson(store, key, ttl, loader) {
    const now = Date.now();
    const hit = store.get(key);
    if (hit && now - hit.at < ttl) {
        return { ok: true, data: hit.data, at: hit.at, stale: false };
    }

    const result = await loader();
    if (result.ok) {
        const at = Date.now();
        store.set(key, { at, data: result.data });
        return { ok: true, data: result.data, at, stale: false };
    }

    if (hit) return { ok: true, data: hit.data, at: hit.at, stale: true, error: result.error };
    return result;
}

function indexBootstrap(payload) {
    const events = (Array.isArray(payload.events) ? payload.events : []).map(event => ({
        id: Number(event.id),
        name: event.name || "Gameweek " + event.id,
        finished: Boolean(event.finished),
        data_checked: Boolean(event.data_checked),
        is_current: Boolean(event.is_current),
        is_next: Boolean(event.is_next),
        deadline_time: event.deadline_time || null
    }));

    const elements = new Map();
    for (const element of payload.elements || []) {
        elements.set(Number(element.id), {
            id: Number(element.id),
            web_name: element.web_name || null,
            first_name: element.first_name || "",
            second_name: element.second_name || "",
            element_type: Number(element.element_type),
            team: Number(element.team),
            code: Number(element.code) || null,
            status: element.status || null,
            chance_of_playing_next_round:
                element.chance_of_playing_next_round === null || element.chance_of_playing_next_round === undefined
                    ? null
                    : Number(element.chance_of_playing_next_round),
            total_points: Number(element.total_points) || 0
        });
    }

    const teams = new Map();
    for (const team of payload.teams || []) {
        teams.set(Number(team.id), {
            id: Number(team.id),
            name: team.name || null,
            short_name: team.short_name || null,
            code: Number(team.code) || null
        });
    }

    const types = new Map();
    for (const type of payload.element_types || []) {
        types.set(Number(type.id), {
            name: type.singular_name || null,
            short: type.singular_name_short || null
        });
    }

    return { events, elements, teams, types };
}

async function getBootstrap(deadline) {
    return cachedJson(cache.bootstrap, "bootstrap", BOOTSTRAP_TTL_MS, async () => {
        const result = await fplFetch("/bootstrap-static/", deadline);
        if (!result.ok) return result;
        return { ok: true, status: result.status, data: indexBootstrap(result.data) };
    });
}

async function getEntry(entryId, deadline) {
    return cachedJson(cache.entry, String(entryId), ENTRY_TTL_MS, async () => {
        const result = await fplFetch(`/entry/${entryId}/`, deadline);
        if (!result.ok) return result;

        const data = result.data || {};
        const managerName = [data.player_first_name, data.player_last_name]
            .filter(Boolean)
            .join(" ")
            .trim();

        return {
            ok: true,
            status: result.status,
            data: {
                team_name: data.name || null,
                manager_name: managerName || null,
                favourite_team_id: data.favourite_team === null || data.favourite_team === undefined
                    ? null
                    : Number(data.favourite_team),
                overall_points: Number(data.summary_overall_points) || 0,
                overall_rank: Number(data.summary_overall_rank) || null
            }
        };
    });
}

async function getPicks(entryId, gw, deadline) {
    return cachedJson(cache.picks, `${entryId}:${gw}`, PICKS_TTL_MS, async () => {
        const result = await fplFetch(`/entry/${entryId}/event/${gw}/picks/`, deadline);
        if (!result.ok) {
            if (result.status === 404) {
                return { ok: false, status: 404, notFound: true, error: "picks_not_public" };
            }
            return result;
        }
        return { ok: true, status: result.status, data: result.data };
    });
}

async function getLive(gw, deadline) {
    return cachedJson(cache.live, String(gw), LIVE_TTL_MS, async () => {
        const result = await fplFetch(`/event/${gw}/live/`, deadline);
        if (!result.ok) return result;

        const elements = new Map();
        for (const row of (result.data && result.data.elements) || []) {
            const stats = row.stats || {};
            elements.set(Number(row.id), {
                points: Number(stats.total_points) || 0,
                minutes: Number(stats.minutes) || 0
            });
        }

        return { ok: true, status: result.status, data: elements };
    });
}

async function getEventStatus(gw, deadline) {
    return cachedJson(cache.eventStatus, "event-status", STATUS_TTL_MS, async () => {
        const result = await fplFetch("/event-status/", deadline);
        if (!result.ok) return result;

        const rows = (result.data && Array.isArray(result.data.status) ? result.data.status : [])
            .filter(row => Number(row.event) === Number(gw));

        return {
            ok: true,
            status: result.status,
            data: rows.length ? Boolean(rows[rows.length - 1].bonus_added) : null
        };
    });
}

function chooseCurrentEvent(bootstrap) {
    const events = bootstrap.events || [];
    const current =
        events.find(event => event.is_current) ||
        events.find(event => event.is_next) ||
        [...events].reverse().find(event => event.finished) ||
        events[events.length - 1];

    return current || null;
}

function buildPlayer(pick, bootstrap, liveElements) {
    const element = bootstrap.elements.get(Number(pick.element)) || null;
    const team = element ? bootstrap.teams.get(Number(element.team)) || null : null;
    const type = element ? bootstrap.types.get(Number(element.element_type)) || null : null;
    const liveRow = liveElements ? liveElements.get(Number(pick.element)) || null : null;
    const position = Number(pick.position);

    return {
        element_id: Number(pick.element),
        position: Number.isFinite(position) ? position : null,
        multiplier: Number(pick.multiplier) || 0,
        is_captain: Boolean(pick.is_captain),
        is_vice_captain: Boolean(pick.is_vice_captain),
        is_bench: Number.isFinite(position) ? position > 11 : null,
        name: element ? element.web_name : null,
        full_name: element ? `${element.first_name} ${element.second_name}`.trim() || null : null,
        position_short: type ? type.short : null,
        position_name: type ? type.name : null,
        club: team
            ? {
                id: team.id,
                name: team.name,
                short_name: team.short_name,
                badge_url: team.code ? `${BADGE_BASE}/t${team.code}.png` : null
            }
            : null,
        photo_url: element && element.code ? `${PHOTO_BASE}/p${element.code}.png` : null,
        points: liveRow ? liveRow.points : null,
        minutes: liveRow ? liveRow.minutes : null,
        season_points: element ? element.total_points : null,
        availability: element
            ? { status: element.status, chance_of_playing: element.chance_of_playing_next_round }
            : null,
        missing_metadata: !element
    };
}

function deriveFormation(xi) {
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const player of xi) {
        const typeId = player.position_short === "GKP" ? 1
            : player.position_short === "DEF" ? 2
                : player.position_short === "MID" ? 3
                    : player.position_short === "FWD" ? 4
                        : 0;
        if (typeId) counts[typeId] += 1;
    }

    if (!counts[1] && !counts[2] && !counts[3] && !counts[4]) return null;
    return `${counts[2]}-${counts[3]}-${counts[4]}`;
}

function deriveStatus(event) {
    if (!event) return "UNKNOWN";
    if (event.finished && event.data_checked) return "FINAL";
    if (event.finished) return "CHECKING";
    if (event.is_current) return "LIVE";
    return "UPCOMING";
}

function send(res, status, body, cacheControl, extraHeaders) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", cacheControl || "no-store");
    if (extraHeaders) {
        for (const [name, value] of Object.entries(extraHeaders)) res.setHeader(name, value);
    }
    res.end(JSON.stringify(body));
}

function ageSeconds(at) {
    return Math.max(0, Math.round((Date.now() - at) / 1000));
}

module.exports = async function handler(req, res) {
    const method = String((req && req.method) || "GET").toUpperCase();
    if (method !== "GET") {
        return send(res, 405, { ok: false, error: "method_not_allowed" }, undefined, { Allow: "GET" });
    }

    if (!FPL_LINKS || typeof FPL_LINKS !== "object") {
        return send(res, 500, { ok: false, error: "mapping_unavailable" });
    }

    let requestedPlayer = null;
    try {
        const url = new URL(req.url || "/api/team", "http://localhost");
        requestedPlayer = url.searchParams.get("player");
    } catch (error) {
        requestedPlayer = null;
    }

    if (requestedPlayer === null || requestedPlayer === "") {
        return send(res, 400, { ok: false, error: "missing_player", expected: "?player=<1-24>" });
    }

    if (!/^\d{1,3}$/.test(requestedPlayer)) {
        return send(res, 400, { ok: false, error: "invalid_player", expected: "?player=<1-24>" });
    }

    if (!Object.prototype.hasOwnProperty.call(FPL_LINKS, requestedPlayer)) {
        return send(res, 400, { ok: false, error: "invalid_player", expected: "?player=<1-24>" });
    }

    const entryId = Number(FPL_LINKS[requestedPlayer]);
    if (!Number.isInteger(entryId) || entryId <= 0) {
        return send(res, 500, { ok: false, error: "mapping_invalid", player: requestedPlayer });
    }

    const deadline = Date.now() + TOTAL_BUDGET_MS;

    const bootstrapResult = await getBootstrap(deadline);
    if (!bootstrapResult.ok) {
        const status = bootstrapResult.status === 429 ? 503 : 502;
        return send(res, status, {
            ok: false,
            error: bootstrapResult.status === 429 ? "upstream_rate_limited" : "bootstrap_unavailable",
            detail: bootstrapResult.error || "unknown"
        }, undefined, bootstrapResult.status === 429 ? { "Retry-After": "60" } : undefined);
    }

    const bootstrap = bootstrapResult.data;
    const currentEvent = chooseCurrentEvent(bootstrap);
    if (!currentEvent) {
        return send(res, 502, { ok: false, error: "event_not_found" });
    }

    let gw = currentEvent.id;
    let picksResult = null;
    let fallbackSteps = 0;

    while (gw >= 1) {
        picksResult = await getPicks(entryId, gw, deadline);
        if (picksResult.ok) break;
        if (picksResult.notFound && gw > 1 && fallbackSteps < MAX_GW_FALLBACK) {
            gw -= 1;
            fallbackSteps += 1;
            continue;
        }
        break;
    }

    if (!picksResult || !picksResult.ok) {
        const status = picksResult && (picksResult.status === 429 || picksResult.error === "rate_limited") ? 503
            : picksResult && picksResult.notFound ? 404 : 502;

        return send(res, status, {
            ok: false,
            error: picksResult && picksResult.notFound ? "picks_unavailable" : "picks_fetch_failed",
            detail: picksResult ? picksResult.error || "unknown" : "unknown",
            player: requestedPlayer,
            gw,
            current_gw: currentEvent.id
        }, undefined, status === 503 ? { "Retry-After": "60" } : undefined);
    }

    const picks = picksResult.data || {};
    const pickList = Array.isArray(picks.picks) ? picks.picks : [];

    if (pickList.length === 0) {
        return send(res, 502, {
            ok: false,
            error: "empty_picks",
            player: requestedPlayer,
            gw
        });
    }

    const [entryResult, liveResult, statusResult] = await Promise.all([
        getEntry(entryId, deadline),
        getLive(gw, deadline),
        getEventStatus(gw, deadline)
    ]);

    const event = bootstrap.events.find(item => item.id === gw) || null;
    const liveElements = liveResult.ok ? liveResult.data : null;
    const final = Boolean(event && event.finished && event.data_checked);
    const bonusAdded = statusResult.ok ? statusResult.data : null;

    const xi = [];
    const bench = [];

    for (const pick of pickList) {
        const player = buildPlayer(pick, bootstrap, liveElements);
        if (player.is_bench) bench.push(player);
        else xi.push(player);
    }

    xi.sort((a, b) => (a.position || 99) - (b.position || 99));
    bench.sort((a, b) => (a.position || 99) - (b.position || 99));

    const captain = xi.find(player => player.is_captain) || null;
    const viceCaptain = xi.find(player => player.is_vice_captain) || null;

    const entry = entryResult.ok ? entryResult.data : null;
    const favouriteTeam = entry && entry.favourite_team_id
        ? bootstrap.teams.get(entry.favourite_team_id) || null
        : null;

    const history = picks.entry_history || null;
    const chip = picks.active_chip || null;
    const warnings = [];

    if (!final) {
        warnings.push(
            "This gameweek is not final: FPL has not marked it as checked, so points, bonus and automatic substitutions may still change."
        );
    }

    if (gw !== currentEvent.id) {
        warnings.push(
            `Gameweek ${currentEvent.id} picks are not public yet; showing the latest available squad from ${event ? event.name : "GW " + gw}.`
        );
    }

    if (chip === "bboost") {
        warnings.push("Bench Boost is active: bench multipliers come from FPL and bench players count this gameweek.");
    } else if (chip === "3xc") {
        warnings.push("Triple Captain is active: the captain multiplier is 3 in the FPL data.");
    } else if (chip === "freehit") {
        warnings.push("Free Hit is active: this squad is temporary for this gameweek.");
    } else if (chip === "wildcard") {
        warnings.push("Wildcard was played: this squad is a permanent rebuild.");
    } else if (chip) {
        warnings.push(`Active chip: ${chip}.`);
    }

    if (!liveResult.ok) {
        warnings.push("Live player points are unavailable right now; lineup data is still shown with null points.");
    } else if (liveElements && liveElements.size === 0) {
        warnings.push("FPL has not published live player data for this gameweek yet.");
    }

    if (!final) {
        warnings.push("Automatic substitutions are applied by FPL only when the gameweek is checked.");
    }

    if (!entryResult.ok) {
        warnings.push("FPL manager details are unavailable; the squad itself is unaffected.");
    }

    if (bootstrapResult.stale || picksResult.stale || liveResult.stale) {
        warnings.push("Served from cache older than the refresh window because FPL was unreachable.");
    }

    if (xi.some(player => player.missing_metadata) || bench.some(player => player.missing_metadata)) {
        warnings.push("Some player metadata is missing from the FPL bootstrap payload.");
    }

    const stale = Boolean(bootstrapResult.stale || picksResult.stale || (liveResult.ok && liveResult.stale));
    const updatedAt = liveResult.ok ? liveResult.at : (picksResult.at || Date.now());

    send(res, 200, {
        ok: true,
        phase: "TEAM-VIEW-2",
        source: "fantasy.premierleague.com",
        player: {
            id: requestedPlayer,
            fpl_entry_id: entryId
        },
        gw,
        gw_name: event ? event.name : null,
        current_gw: currentEvent.id,
        fallback: gw !== currentEvent.id,
        status: deriveStatus(event),
        provisional: !final,
        final,
        finished: Boolean(event && event.finished),
        data_checked: Boolean(event && event.data_checked),
        bonus_added: bonusAdded,
        updated_at: new Date(updatedAt).toISOString(),
        stale,
        entry: entry
            ? {
                team_name: entry.team_name,
                manager_name: entry.manager_name,
                favourite_team: favouriteTeam
                    ? {
                        id: favouriteTeam.id,
                        name: favouriteTeam.name,
                        short_name: favouriteTeam.short_name,
                        badge_url: favouriteTeam.code ? `${BADGE_BASE}/t${favouriteTeam.code}.png` : null
                    }
                    : null,
                overall_points: entry.overall_points,
                overall_rank: entry.overall_rank
            }
            : null,
        chip,
        formation: deriveFormation(xi),
        lineup_size: pickList.length,
        xi,
        bench,
        captain: captain
            ? { element_id: captain.element_id, name: captain.name, multiplier: captain.multiplier }
            : null,
        vice_captain: viceCaptain
            ? { element_id: viceCaptain.element_id, name: viceCaptain.name, multiplier: viceCaptain.multiplier }
            : null,
        automatic_subs: Array.isArray(picks.automatic_subs)
            ? picks.automatic_subs.map(sub => ({
                element_in: sub.element_in === undefined ? null : Number(sub.element_in),
                element_out: sub.element_out === undefined ? null : Number(sub.element_out)
            }))
            : [],
        entry_history: history
            ? {
                event_points: history.points === undefined ? null : Number(history.points),
                total_points: history.total_points === undefined ? null : Number(history.total_points),
                overall_rank: history.overall_rank === undefined ? null : Number(history.overall_rank),
                event_transfers: history.event_transfers === undefined ? null : Number(history.event_transfers),
                event_transfers_cost: history.event_transfers_cost === undefined ? null : Number(history.event_transfers_cost),
                points_on_bench: history.points_on_bench === undefined ? null : Number(history.points_on_bench),
                bank_tenths: history.bank === undefined ? null : Number(history.bank),
                value_tenths: history.value === undefined ? null : Number(history.value)
            }
            : null,
        live: {
            available: Boolean(liveResult.ok),
            stale: Boolean(liveResult.ok && liveResult.stale),
            age_seconds: liveResult.at ? ageSeconds(liveResult.at) : null
        },
        meta: {
            bootstrap_age_seconds: ageSeconds(bootstrapResult.at),
            picks_age_seconds: ageSeconds(picksResult.at),
            entry_age_seconds: entryResult.at ? ageSeconds(entryResult.at) : null,
            bonus_age_seconds: statusResult.at ? ageSeconds(statusResult.at) : null
        },
        warnings
    }, RESPONSE_CACHE_CONTROL);
};
