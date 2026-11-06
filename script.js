/* =========================================================
   THE LAST OF FPL — EMPERORES KINGDOM FANTASY
   Supabase-connected JavaScript
   ========================================================= */

"use strict";

// ---------------------------------------------------------
// LIVE MATCH CENTRE — PHASE 1A (display-only)
// Set LIVE_ENABLED to true once the /api/live proxy is verified.
// ---------------------------------------------------------
const LIVE_ENABLED = true;
const LIVE_REFRESH_MS = 60000;

const liveState = {
    data: null,
    updatedAt: null,
    stale: false,
    error: null,
    timer: null,
    inFlight: false
};

// ---------------------------------------------------------
// 1. RUNTIME STATE
// Every player, gameweek, match and bye value comes from Supabase.
// If a query fails the UI shows an explicit unavailable state; no
// stale roster, fixture list or heart override is substituted.
// ---------------------------------------------------------

const roster = [];

let activeStatusFilter = "ALL";
let activeSearch = "";
let currentMatches = [];
let currentGameweek = null;
let currentGameweekBye = null;
let latestCompletedGameweek = null;
let playersLoadedFromDatabase = false;
let matchesLoadedFromDatabase = false;
let gwPointsLoaded = false;
let gwPointsGameweek = null;
let dataError = null;
const gwPointsByPlayerId = new Map();

const STATUS_ORDER = {
    SAFE: 0,
    NORMAL: 1,
    DANGER: 2,
    ELIMINATED: 3
};

const normalizeStatus = value => {
    const status = String(value || "NORMAL").trim().toUpperCase();

    return ["SAFE", "NORMAL", "DANGER"].includes(status)
        ? status
        : "NORMAL";
};

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function getPlayerById(id) {
    return roster.find(player => String(player.id) === String(id)) || null;
}

function getPlayerHearts(player) {
    return Math.max(0, Math.min(3, Number(player.hearts) || 0));
}

function getDisplayHearts(player) {
    return getPlayerHearts(player);
}

function isEliminated(player) {
    return getPlayerHearts(player) <= 0;
}

function getDisplayState(player) {
    return isEliminated(player)
        ? "ELIMINATED"
        : normalizeStatus(player.state);
}

function getStateClass(player) {
    return getDisplayState(player).toLowerCase();
}

function isInfectedPlayer(player) {
    return player?.is_infected === true;
}

function getThreatStatus(player) {
    const hearts = getPlayerHearts(player);

    if (hearts <= 0) return "ELIMINATED";
    if (hearts <= 1) return "CRITICAL";
    if (normalizeStatus(player.state) === "DANGER") return "HIGH";
    if (normalizeStatus(player.state) === "NORMAL") return "MEDIUM";

    return "LOW";
}

function getThreatTone(player) {
    const hearts = getPlayerHearts(player);

    if (hearts <= 0) return "eliminated";
    if (hearts <= 1) return "danger";

    return normalizeStatus(player.state).toLowerCase();
}

function getGameweekPoints(player) {
    const points = gwPointsByPlayerId.get(String(player.id));

    return Number.isFinite(points) ? points : null;
}

function formatGameweekPoints(player) {
    const points = getGameweekPoints(player);

    return points === null ? "—" : String(points);
}

function getCurrentGwLabel() {
    return currentGameweek ? `GW${currentGameweek.gw_number}` : "GW";
}

function getPointsGwLabel() {
    return gwPointsGameweek ? `GW${gwPointsGameweek.gw_number}` : "PTS";
}

function getPointsHeaderLabel() {
    return gwPointsGameweek ? `GW${gwPointsGameweek.gw_number} Pts` : "Pts";
}

function setDataError(message) {
    dataError = message || "Tournament registry unavailable.";
    const banner = document.getElementById("dataStatus");

    if (banner) {
        banner.textContent = dataError;
        banner.hidden = false;
    }
}

function clearDataError() {
    dataError = null;
    const banner = document.getElementById("dataStatus");

    if (banner) {
        banner.textContent = "";
        banner.hidden = true;
    }
}

function getInitials(name) {
    const parts = String(name || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function renderHeartMarks(hearts) {
    const filledHearts = Math.max(0, Math.min(3, Number(hearts) || 0));

    return Array.from({ length: 3 }, (_, index) => {
        const filled = index < filledHearts;

        return `<span class="heart ${filled ? "is-full" : "is-empty"}" aria-hidden="true">${filled ? "♥" : "♡"}</span>`;
    }).join("");
}

function getSortedRoster(players = roster) {
    return [...players].sort((a, b) =>
        (STATUS_ORDER[getDisplayState(a)] ?? 4) -
        (STATUS_ORDER[getDisplayState(b)] ?? 4)
    );
}

function getRankMap() {
    const ranks = new Map();

    getSortedRoster().forEach((player, index) => {
        ranks.set(String(player.id), index + 1);
    });

    return ranks;
}

// Keep the current state accessible for browser-console diagnostics.
function publishDebugState() {
    window.currentMatches = currentMatches;
    window.roster = roster;
    window.playersLoadedFromDatabase = playersLoadedFromDatabase;
    window.matchesLoadedFromDatabase = matchesLoadedFromDatabase;
    window.activeStatusFilter = activeStatusFilter;
    window.activeSearch = activeSearch;
    window.currentGameweek = currentGameweek;
    window.currentGameweekBye = currentGameweekBye;
    window.latestCompletedGameweek = latestCompletedGameweek;
    window.gwPointsLoaded = gwPointsLoaded;
    window.gwPointsGameweek = gwPointsGameweek;
    window.gwPointsByPlayerId = Object.fromEntries(gwPointsByPlayerId);
    window.dataError = dataError;
}

// ---------------------------------------------------------
// 2. LOAD PLAYERS, GAMEWEEKS, MATCHES AND BYES FROM SUPABASE
// ---------------------------------------------------------

async function loadPlayersFromSupabase() {
    const client = window.supabaseClient;

    if (!client) {
        setDataError("Supabase client is unavailable. Player data cannot be loaded.");
        return false;
    }

    const { data, error } = await client
        .from("players")
        .select("id, name, status, hearts, is_infected, is_active")
        .order("name", { ascending: true });

    if (error) {
        console.warn("Could not load players:", error.message);
        setDataError("Could not load players from Supabase. Player values are unavailable.");
        return false;
    }

    const loadedPlayers = (data || []).map(player => ({
        id: player.id,
        name: player.name || "Unknown player",
        state: normalizeStatus(player.status),
        hearts: Math.max(0, Math.min(3, Number(player.hearts) || 0)),
        is_infected: player.is_infected === true,
        is_active: player.is_active === true
    }));

    if (loadedPlayers.length === 0) {
        setDataError("The player registry is empty.");
        return false;
    }

    roster.splice(0, roster.length, ...loadedPlayers);
    playersLoadedFromDatabase = true;
    clearDataError();

    publishDebugState();
    console.log(`Players loaded from Supabase: ${roster.length}`);

    return true;
}

async function loadGameweeksFromSupabase() {
    const client = window.supabaseClient;

    if (!client) {
        setDataError("Supabase client is unavailable. Gameweek data cannot be loaded.");
        return null;
    }

    const { data, error } = await client
        .from("gameweeks")
        .select("id, gw_number, chapter, status")
        .order("gw_number", { ascending: true });

    if (error) {
        console.warn("Could not load gameweeks:", error.message);
        setDataError("Could not load the gameweek registry. Fixtures and points are unavailable.");
        return null;
    }

    return (data || []).map(gameweek => ({
        ...gameweek,
        status: String(gameweek.status || "").toUpperCase()
    }));
}

function pickCurrentGameweek(gameweeks) {
    const list = Array.isArray(gameweeks) ? gameweeks : [];
    const pending = list
        .filter(gameweek => gameweek.status === "PENDING")
        .sort((a, b) => Number(a.gw_number) - Number(b.gw_number));

    if (pending.length) return pending[0];

    const completed = list
        .filter(gameweek => gameweek.status === "COMPLETED")
        .sort((a, b) => Number(b.gw_number) - Number(a.gw_number));

    return completed[0] || null;
}

function pickLatestCompletedGameweek(gameweeks) {
    const completed = (Array.isArray(gameweeks) ? gameweeks : [])
        .filter(gameweek => gameweek.status === "COMPLETED")
        .sort((a, b) => Number(b.gw_number) - Number(a.gw_number));

    return completed[0] || null;
}

async function loadGameweekPoints(gameweek) {
    const client = window.supabaseClient;

    if (!client || !gameweek) return false;

    const { data, error } = await client
        .from("matches")
        .select("id, player_a_id, player_b_id, points_a, points_b, status")
        .eq("gameweek_id", gameweek.id)
        .order("id", { ascending: true });

    if (error) {
        console.warn("Could not load gameweek points:", error.message);
        return false;
    }

    const matches = data || [];
    const allCompleted = matches.length > 0 && matches.every(
        match => String(match.status || "").toUpperCase() === "COMPLETED"
    );

    if (!allCompleted) {
        console.warn("Gameweek points are not final; standings points remain unavailable.", {
            gameweek: gameweek.gw_number,
            matches: matches.length
        });
        return false;
    }

    const scores = new Map();

    matches.forEach(match => {
        [
            [match.player_a_id, match.points_a],
            [match.player_b_id, match.points_b]
        ].forEach(([playerId, points]) => {
            if (
                points === null ||
                points === undefined ||
                points === "" ||
                !Number.isFinite(Number(points))
            ) {
                return;
            }

            scores.set(String(playerId), Number(points));
        });
    });

    gwPointsByPlayerId.clear();
    scores.forEach((points, playerId) => gwPointsByPlayerId.set(playerId, points));
    gwPointsGameweek = gameweek;
    gwPointsLoaded = scores.size > 0;

    publishDebugState();
    console.log(
        `GW${gameweek.gw_number} points loaded for ${scores.size} players from ${matches.length} completed matches.`
    );

    return gwPointsLoaded;
}

async function loadCurrentGameweekMatches() {
    const client = window.supabaseClient;

    if (!client || !currentGameweek) {
        currentMatches = [];
        currentGameweekBye = null;
        matchesLoadedFromDatabase = false;
        return false;
    }

    const gameweekId = currentGameweek.id;

    const [matchesResult, byesResult] = await Promise.all([
        client
            .from("matches")
            .select("id, gameweek_id, player_a_id, player_b_id, points_a, points_b, winner_id, status")
            .eq("gameweek_id", gameweekId)
            .order("id", { ascending: true }),
        client
            .from("gameweek_byes")
            .select("id, gameweek_id, player_id")
            .eq("gameweek_id", gameweekId)
    ]);

    if (matchesResult.error || byesResult.error) {
        console.warn("Could not load current gameweek fixtures.", {
            matches: matchesResult.error?.message || null,
            byes: byesResult.error?.message || null
        });
        setDataError(`Could not load fixtures for GW${currentGameweek.gw_number}.`);
        currentMatches = [];
        currentGameweekBye = null;
        matchesLoadedFromDatabase = false;
        publishDebugState();
        return false;
    }

    currentMatches = (matchesResult.data || []).map(match => ({
        ...match,
        gw_number: currentGameweek.gw_number
    }));

    const bye = (byesResult.data || [])[0] || null;
    currentGameweekBye = bye
        ? {
            ...bye,
            player: getPlayerById(bye.player_id)
        }
        : null;

    matchesLoadedFromDatabase = true;
    publishDebugState();

    console.log(
        `GW${currentGameweek.gw_number}: ${currentMatches.length} matches, ${currentGameweekBye ? 1 : 0} bye.`
    );

    return true;
}

function syncPointsNote() {
    const note = document.getElementById("standingsPointsNote");
    if (!note) return;

    const label = getPointsGwLabel();

    note.textContent = gwPointsLoaded
        ? `Survivors are grouped SAFE → NORMAL → DANGER. Points are verified ${label} scores from the latest completed gameweek.`
        : `Survivors are grouped SAFE → NORMAL → DANGER. ${label} scores are currently unavailable.`;
}

// ---------------------------------------------------------
// 3. STANDINGS AND SURVIVOR CARDS
// ---------------------------------------------------------

function renderStandings(players = roster) {
    const container = document.getElementById("standingsTable");
    if (!container) return;

    const sortedPlayers = getSortedRoster(players);
    const rankById = getRankMap();

    if (sortedPlayers.length === 0) {
        container.innerHTML = `
            <tr class="table-empty">
                <td colspan="6">
                    <div class="empty-state">
                        <span class="empty-state-mark" aria-hidden="true"></span>
                        <span class="empty-state-title">No survivors found</span>
                        <span class="empty-state-text">Adjust the state filter or clear the search to restore the registry.</span>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    container.innerHTML = sortedPlayers.map(player => {
        const hearts = getDisplayHearts(player);
        const displayState = getDisplayState(player);
        const stateClass = getStateClass(player);
        const threat = getThreatStatus(player);
        const threatTone = getThreatTone(player);
        const rank = rankById.get(String(player.id)) || 0;
        const infected = isInfectedPlayer(player);

        return `
            <tr class="row-${stateClass}${infected ? " row-infected" : ""}" data-player-id="${escapeHTML(player.id)}">
                <td class="cell-rank" data-label="Rank">${String(rank).padStart(2, "0")}</td>
                <td class="cell-player" data-label="Participant">
                    <strong class="player-name">${escapeHTML(player.name)}</strong>${infected ? '<span class="status infected c2-infected-tag">INFECTED</span>' : ""}
                </td>
                <td class="cell-state" data-label="Current state">
                    <span class="status ${stateClass}">${escapeHTML(displayState)}</span>
                </td>
                <td class="cell-points" data-label="${escapeHTML(getPointsGwLabel())} points">
                    <strong>${formatGameweekPoints(player)}</strong>
                    <span class="unit">PTS</span>
                </td>
                <td class="cell-hearts" data-label="Hearts">
                    <span class="hearts" role="img" aria-label="${hearts} of 3 hearts remaining">
                        ${renderHeartMarks(hearts)}
                    </span>
                    <span class="heart-count">${hearts}/3</span>
                </td>
                <td class="cell-threat" data-label="Threat assessment">
                    <span class="threat-box ${threatTone}">
                        <span class="threat-dot" aria-hidden="true"></span>
                        ${escapeHTML(threat)}
                    </span>
                </td>
            </tr>
        `;
    }).join("");
}

function renderSurvivorCards(players = roster) {
    const container = document.getElementById("survivorCards");
    if (!container) return;

    const sortedPlayers = getSortedRoster(players);
    const rankById = getRankMap();

    if (sortedPlayers.length === 0) {
        container.innerHTML = `
            <div class="dossier-empty">
                <span class="empty-state-mark" aria-hidden="true"></span>
                <span class="empty-state-title">No survivors found</span>
                <span class="empty-state-text">Try another name or switch back to ALL.</span>
            </div>
        `;
        return;
    }

    container.innerHTML = sortedPlayers.map(player => {
        const hearts = getDisplayHearts(player);
        const displayState = getDisplayState(player);
        const stateClass = getStateClass(player);
        const threat = getThreatStatus(player);
        const threatTone = getThreatTone(player);
        const rank = rankById.get(String(player.id)) || 0;
        const threatLabel = threat === "ELIMINATED"
            ? "ELIMINATED"
            : `${threat} THREAT`;
        const infected = isInfectedPlayer(player);

        return `
            <article class="survivor-card ${stateClass}${infected ? " c2-infected" : ""}" data-player-id="${escapeHTML(player.id)}" data-state="${stateClass}">
                <div class="survivor-top">
                    <span class="survivor-rank">#${String(rank).padStart(2, "0")}</span>
                    ${infected ? '<span class="status infected c2-infected-tag">INFECTED</span>' : ""}
                    <span class="survivor-state">${escapeHTML(displayState)}</span>
                </div>
                <div class="survivor-identity">
                    <span class="survivor-avatar" aria-hidden="true">${escapeHTML(getInitials(player.name))}</span>
                    <div class="survivor-id">
                        <h3 class="survivor-name">${escapeHTML(player.name)}</h3>
                        <p class="survivor-points"><strong>${formatGameweekPoints(player)}</strong> ${escapeHTML(getPointsGwLabel())} PTS</p>
                    </div>
                </div>
                <div class="survivor-vitals">
                    <span class="survivor-hearts" role="img" aria-label="${hearts} of 3 hearts remaining">
                        ${renderHeartMarks(hearts)}
                    </span>
                    <span class="survivor-heart-count">${hearts}/3</span>
                </div>
                <div class="survivor-threat ${threatTone}">
                    <span class="threat-dot" aria-hidden="true"></span>
                    ${escapeHTML(threatLabel)}
                </div>
            </article>
        `;
    }).join("");
}

function renderInfected() {
    const container = document.getElementById("infectedDossier");
    const totalElement = document.getElementById("infectedTotal");

    const cases = roster.filter(isInfectedPlayer);
    const loaded = playersLoadedFromDatabase;
    const caseCount = loaded ? String(cases.length).padStart(2, "0") : "—";

    if (totalElement) {
        totalElement.textContent = caseCount;
    }

    const sectorCount = document.getElementById("sectorInfected");
    if (sectorCount) sectorCount.textContent = caseCount;

    const registryCount = document.getElementById("infectedRegistry");
    if (registryCount) {
        registryCount.textContent = loaded
            ? `Supabase \u00b7 ${caseCount} Names`
            : "Supabase \u00b7 unavailable";
    }

    const caseRange = document.getElementById("infectedCaseRange");
    if (caseRange) {
        caseRange.textContent = loaded
            ? `BIOHAZARD // CASE FILES 01\u2013${caseCount}`
            : "BIOHAZARD // CASE FILES";
    }

    if (!container) return;

    if (!loaded) {
        container.innerHTML = `
            <div class="c2-infected-empty">
                <span class="c2-label">Registry unavailable</span>
                <p>Infected player records could not be loaded from Supabase.</p>
            </div>
        `;
        return;
    }

    if (cases.length === 0) {
        container.innerHTML = `
            <div class="c2-infected-empty">
                <span class="c2-label">No case files</span>
                <p>No infected players are currently recorded in the player database.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = cases.map((player, index) => {
        const hearts = getPlayerHearts(player);
        const displayState = getDisplayState(player);
        const stateClass = getStateClass(player);
        const threat = getThreatStatus(player);

        return `
            <article class="c2-infected-card" data-player-id="${escapeHTML(player.id)}">
                <header class="c2-infected-card-head">
                    <span class="c2-file-no">Case File ${String(index + 1).padStart(2, "0")}</span>
                    <span class="status infected">Infected</span>
                </header>
                <div class="c2-infected-identity">
                    <span class="c2-infected-avatar" aria-hidden="true">${escapeHTML(getInitials(player.name))}</span>
                    <div>
                        <h3 class="c2-infected-name">${escapeHTML(player.name)}</h3>
                        <span class="c2-infected-sub">Confirmed Case // Sector 02</span>
                    </div>
                </div>
                <dl class="c2-infected-data">
                    <div class="c2-infected-row">
                        <dt>Current State</dt>
                        <dd><span class="status ${stateClass}">${escapeHTML(displayState)}</span></dd>
                    </div>
                    <div class="c2-infected-row">
                        <dt>Hearts</dt>
                        <dd>
                            <span class="hearts" role="img" aria-label="${hearts} of 3 hearts remaining">${renderHeartMarks(hearts)}</span>
                            <span class="heart-count">${hearts}/3</span>
                        </dd>
                    </div>
                    <div class="c2-infected-row">
                        <dt>${escapeHTML(getPointsGwLabel())} Points</dt>
                        <dd><strong class="c2-infected-pts">${formatGameweekPoints(player)}</strong><span class="unit">PTS</span></dd>
                    </div>
                    <div class="c2-infected-row">
                        <dt>Threat</dt>
                        <dd><span class="threat-box ${getThreatTone(player)}"><span class="threat-dot" aria-hidden="true"></span>${escapeHTML(threat)}</span></dd>
                    </div>
                </dl>
                <footer class="c2-infected-card-foot">
                    <span>Registry // Supabase</span>
                    <span>Confirmed</span>
                </footer>
            </article>
        `;
    }).join("");
}

function syncSearchClear() {
    const searchInput = document.getElementById("playerSearch");
    const clearButton = document.getElementById("searchClear");

    if (!searchInput || !clearButton) return;

    clearButton.hidden = searchInput.value.length === 0;
}

function syncFilterLabels() {
    const stateCounts = {
        ALL: roster.length,
        SAFE: roster.filter(player => getDisplayState(player) === "SAFE").length,
        NORMAL: roster.filter(player => getDisplayState(player) === "NORMAL").length,
        DANGER: roster.filter(player => getDisplayState(player) === "DANGER").length
    };

    document.querySelectorAll("[data-filter]").forEach(button => {
        const key = button.dataset.filter;
        if (!(key in stateCounts)) return;

        button.textContent = playersLoadedFromDatabase
            ? `${key} (${stateCounts[key]})`
            : `${key} (—)`;
    });
}

function filterStandings(status = null, button = null) {
    if (typeof status === "string") {
        const nextFilter = status.trim().toUpperCase();
        activeStatusFilter = ["ALL", "SAFE", "NORMAL", "DANGER"].includes(nextFilter)
            ? nextFilter
            : "ALL";
    }

    document.querySelectorAll(".filter-group .f-btn").forEach(item => {
        const active = button
            ? item === button
            : item.dataset.filter === activeStatusFilter;

        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
    });

    const searchInput = document.getElementById("playerSearch");
    activeSearch = (searchInput?.value || "").trim().toLowerCase();

    const filtered = roster.filter(player => {
        const matchesSearch = player.name.toLowerCase().includes(activeSearch);
        const matchesStatus =
            activeStatusFilter === "ALL" ||
            getDisplayState(player) === activeStatusFilter;

        return matchesSearch && matchesStatus;
    });

    renderStandings(filtered);
    renderSurvivorCards(filtered);
    syncSearchClear();

    const count = document.getElementById("survivorDossierCount");
    if (count) {
        count.textContent = playersLoadedFromDatabase
            ? `${filtered.length} ${filtered.length === 1 ? "SURVIVOR" : "SURVIVORS"} DISPLAYED`
            : "— SURVIVORS DISPLAYED";
    }

    publishDebugState();
}

function initPlayerSearch() {
    const searchInput = document.getElementById("playerSearch");
    const clearButton = document.getElementById("searchClear");

    if (searchInput) {
        searchInput.addEventListener("input", () => {
            syncSearchClear();
            filterStandings();
        });

        searchInput.addEventListener("search", () => {
            syncSearchClear();
            filterStandings();
        });

        searchInput.addEventListener("keydown", event => {
            if (event.key !== "Escape" || searchInput.value === "") return;

            event.preventDefault();
            searchInput.value = "";
            searchInput.focus();
            filterStandings();
        });
    }

    if (clearButton && searchInput) {
        clearButton.addEventListener("click", () => {
            searchInput.value = "";
            searchInput.focus();
            filterStandings();
        });
    }

    syncSearchClear();
}

// ---------------------------------------------------------
// 4. HOME PAGE METRICS
// Updates existing IDs and optional data-stat elements.
// ---------------------------------------------------------

function syncJourneyLedger() {
    const loaded = playersLoadedFromDatabase;
    const safeCount = roster.filter(p => getDisplayState(p) === "SAFE").length;
    const normalCount = roster.filter(p => getDisplayState(p) === "NORMAL").length;
    const dangerCount = roster.filter(p => getDisplayState(p) === "DANGER").length;
    const eliminatedCount = roster.filter(isEliminated).length;
    const infectedCount = roster.filter(isInfectedPlayer).length;
    const activePlayers = roster.filter(p => p.is_active === true).length;
    const heartsTotal = roster.reduce((total, player) => total + getPlayerHearts(player), 0);

    const metrics = {
        safeCount,
        normalCount,
        dangerCount,
        eliminatedCount,
        activePlayers,
        heartsTotal
    };

    Object.entries(metrics).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = loaded ? value : "—";
    });

    const dataStats = {
        safe: safeCount,
        normal: normalCount,
        danger: dangerCount,
        eliminated: eliminatedCount,
        active: activePlayers,
        infected: infectedCount,
        total: roster.length
    };

    Object.entries(dataStats).forEach(([key, value]) => {
        document.querySelectorAll(`[data-stat="${key}"]`).forEach(element => {
            element.textContent = loaded ? value : "—";
        });
    });

    const sectorHearts = document.getElementById("sectorHearts");
    if (sectorHearts) sectorHearts.textContent = loaded ? heartsTotal : "—";

    const percentages = {
        safe: safeCount,
        normal: normalCount,
        danger: dangerCount
    };

    Object.entries(percentages).forEach(([key, value]) => {
        const percentage = roster.length === 0
            ? null
            : Math.round((value / roster.length) * 100);

        document.querySelectorAll(`[data-stat-pct="${key}"]`).forEach(element => {
            element.textContent = loaded && percentage !== null
                ? `(${percentage}%)`
                : "(—%)";
        });
    });

    syncFilterLabels();
    publishDebugState();
}

function syncPageLabels() {
    const gwLabel = getCurrentGwLabel();
    const kicker = document.getElementById("standingsKicker");
    const subtitle = document.getElementById("standingsSubtitle");
    const pointsHeader = document.getElementById("standingsPointsHeader");
    const dossierKicker = document.getElementById("dossierKicker");

    if (kicker) {
        kicker.textContent = currentGameweek
            ? `Registry // ${gwLabel}`
            : "Registry // Current";
    }

    if (subtitle) {
        subtitle.textContent = currentGameweek
            ? `Field order by current state • ${gwLabel} ${String(currentGameweek.status || "").toLowerCase()}`
            : "Field order by current state • Registry unavailable";
    }

    if (pointsHeader) {
        pointsHeader.textContent = getPointsHeaderLabel();
    }

    if (dossierKicker) {
        dossierKicker.textContent = gwPointsGameweek
            ? `Field Registry // ${getPointsGwLabel()} Points`
            : "Field Registry";
    }
}

// ---------------------------------------------------------
// 5. NAVIGATION
// ---------------------------------------------------------

function switchTab(tabName) {
    const targetId = `page-${tabName}`;
    const target = document.getElementById(targetId);

    if (!target) {
        console.warn(`Page not found: ${targetId}`);
        return;
    }

    document.querySelectorAll(".tab-page").forEach(page => {
        const active = page.id === targetId;
        page.classList.toggle("active", active);
        page.hidden = !active;
    });

    document.querySelectorAll(".nav-btn").forEach(button => {
        const active =
            button.getAttribute("onclick") === `switchTab('${tabName}')`;

        button.classList.toggle("active", active);

        if (active) {
            button.setAttribute("aria-current", "page");
        } else {
            button.removeAttribute("aria-current");
        }
    });

    if (tabName === "matchups") {
        renderMatchups();
    }

    if (window.scrollY > 0) {
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    }
}

// ---------------------------------------------------------
// 6. MATCHUP CARD RENDERING
// ---------------------------------------------------------

function formatMatchPoints(points) {
    if (points === null || points === undefined || points === "") {
        return { value: "—", pending: true };
    }

    const numeric = Number(points);

    return Number.isFinite(numeric)
        ? { value: String(numeric), pending: false }
        : { value: "—", pending: true };
}

function renderMatchCard(match, number = 0, type = "other") {
    const playerA = getPlayerById(match.player_a_id);
    const playerB = getPlayerById(match.player_b_id);
    const matchNumber = number
        ? `MATCH ${String(number).padStart(2, "0")}`
        : `MATCH #${escapeHTML(match.id)}`;
    const status = String(match.status || "PENDING").trim().toUpperCase();
    const statusClass = status.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "pending";
    const pointsA = Number(match.points_a);
    const pointsB = Number(match.points_b);
    const bothScored =
        match.points_a !== null && match.points_a !== undefined && match.points_a !== "" &&
        match.points_b !== null && match.points_b !== undefined && match.points_b !== "";
    const isCompleted = status === "COMPLETED";
    let winnerId = match.winner_id === null || match.winner_id === undefined
        ? null
        : String(match.winner_id);

    if (
        !winnerId &&
        isCompleted &&
        bothScored &&
        Number.isFinite(pointsA) &&
        Number.isFinite(pointsB) &&
        pointsA !== pointsB
    ) {
        winnerId = pointsA > pointsB
            ? String(match.player_a_id)
            : String(match.player_b_id);
    }

    if (!playerA || !playerB) {
        console.warn("Missing player for match:", match.id, {
            player_a_id: match.player_a_id,
            player_b_id: match.player_b_id
        });

        return `
            <article class="match-card match-card--missing" data-match-id="${escapeHTML(match.id)}">
                <div class="match-card-head">
                    <span class="match-number">${matchNumber}</span>
                    <span class="match-badge unknown">DATA CHECK</span>
                </div>
                <div class="match-missing">
                    <strong>Pairing unavailable</strong>
                    <span>One or both player records could not be resolved.</span>
                </div>
            </article>
        `;
    }

    function playerMarkup(player, points) {
        const hearts = getDisplayHearts(player);
        const displayState = getDisplayState(player);
        const stateClass = getStateClass(player);
        const formattedPoints = formatMatchPoints(points);
        const result = isCompleted && winnerId
            ? (String(player.id) === winnerId ? "winner" : "loser")
            : "";
        const resultClass = result ? `is-${result}` : "";
        const resultTag = result
            ? `<span class="match-result-tag ${result}">${result === "winner" ? "WINNER" : "LOSER"}</span>`
            : "";

        return `
            <div class="match-player state-${stateClass} ${resultClass}" data-player-id="${escapeHTML(player.id)}">
                <span class="match-avatar" aria-hidden="true">${escapeHTML(getInitials(player.name))}</span>
                <button type="button" class="match-name match-name-trigger" title="View FPL lineup for ${escapeHTML(player.name)}" aria-haspopup="dialog" data-lineup-player="${escapeHTML(player.id)}">${escapeHTML(player.name)}</button>
                <span class="status ${stateClass}">${escapeHTML(displayState)}</span>
                ${isInfectedPlayer(player) ? '<span class="match-infected" role="img" aria-label="Infected">🦠 INFECTED</span>' : ""}
                ${resultTag}
                <div class="match-vitals">
                    <span class="match-hearts" role="img" aria-label="${hearts} of 3 hearts remaining">
                        ${renderHeartMarks(hearts)}
                    </span>
                    <span class="match-points ${formattedPoints.pending ? "is-pending" : ""}">
                        <strong>${escapeHTML(formattedPoints.value)}</strong>
                        <small>${escapeHTML(getCurrentGwLabel())} PTS</small>
                    </span>
                </div>
            </div>
        `;
    }

    return `
        <article class="match-card match-card--${type}" data-match-id="${escapeHTML(match.id)}" data-match-status="${statusClass}" data-winner-id="${escapeHTML(winnerId || "")}">
            <div class="match-card-head">
                <span class="match-number">${matchNumber}</span>
                <span class="match-badge ${statusClass}">${escapeHTML(status)}</span>
            </div>
            <div class="match-body">
                ${playerMarkup(playerA, match.points_a)}
                <div class="match-vs" aria-hidden="true">VS</div>
                ${playerMarkup(playerB, match.points_b)}
            </div>
        </article>
    `;
}

// ---------------------------------------------------------
// 7. CURRENT GAMEWEEK MATCHUPS — DATABASE DRIVEN
// Fixtures and the bye are read from the gameweek selected from
// the `gameweeks` table; nothing here is hardcoded per gameweek.
// ---------------------------------------------------------

function renderByeCard(bye) {
    if (!bye) {
        return `<div class="group-message">No bye is registered for this gameweek.</div>`;
    }

    const player = bye.player;

    if (!player) {
        return `
            <article class="match-bye-card" data-bye-player-id="${escapeHTML(bye.player_id)}">
                <div class="match-bye-head">
                    <span class="c2-label">BYE // NO MATCH</span>
                    <span class="match-badge bye">BYE</span>
                </div>
                <p class="match-bye-note">Bye record exists but the player record could not be resolved.</p>
            </article>
        `;
    }

    const hearts = getDisplayHearts(player);
    const displayState = getDisplayState(player);
    const stateClass = getStateClass(player);

    return `
        <article class="match-bye-card" data-bye-player-id="${escapeHTML(player.id)}">
            <div class="match-bye-head">
                <span class="c2-label">BYE // NO MATCH</span>
                <span class="match-badge bye">BYE</span>
            </div>
            <div class="match-bye-body">
                <span class="match-avatar" aria-hidden="true">${escapeHTML(getInitials(player.name))}</span>
                <div class="match-bye-id">
                    <h3 class="match-bye-name">${escapeHTML(player.name)}</h3>
                    <div class="match-bye-tags">
                        <span class="status ${stateClass}">${escapeHTML(displayState)}</span>
                        ${isInfectedPlayer(player) ? '<span class="match-infected" role="img" aria-label="Infected">🦠 INFECTED</span>' : ""}
                    </div>
                    <div class="match-vitals">
                        <span class="match-hearts" role="img" aria-label="${hearts} of 3 hearts remaining">
                            ${renderHeartMarks(hearts)}
                        </span>
                        <span class="heart-count">${hearts}/3</span>
                    </div>
                </div>
            </div>
            <p class="match-bye-note">No fixture this gameweek — the survivor advances without a match.</p>
        </article>
    `;
}

function renderMatchups() {
    const groupA = document.getElementById("groupA-list");
    const groupB = document.getElementById("groupB-list");

    if (!groupA && !groupB) {
        console.warn("Matchup containers not found in index.html.");
        return;
    }

    const gwLabel = getCurrentGwLabel();
    const hasGameweek = Boolean(currentGameweek);
    const matches = Array.isArray(currentMatches) ? currentMatches : [];
    const bye = currentGameweekBye;

    const kicker = document.getElementById("matchupsKicker");
    const title = document.getElementById("matchupsTitle");
    const summary = document.getElementById("matchupSummary");
    const legend = document.getElementById("matchupsLegendNote");

    if (kicker) {
        kicker.textContent = hasGameweek
            ? `Pairings // ${gwLabel}`
            : "Pairings // Current Gameweek";
    }

    if (title) {
        title.textContent = hasGameweek
            ? `${gwLabel} — MATCHUPS`
            : "CURRENT GAMEWEEK — MATCHUPS";
    }

    if (summary) {
        if (!hasGameweek || !matchesLoadedFromDatabase) {
            summary.textContent = "Current fixtures are unavailable.";
        } else {
            const fixtureText = `${matches.length} ${matches.length === 1 ? "fixture" : "fixtures"}`;
            const byeText = bye && bye.player
                ? ` • ${bye.player.name} on bye`
                : "";
            summary.textContent = `${gwLabel}: ${fixtureText}${byeText}`;
        }
    }

    if (legend) {
        const gwStatus = String(currentGameweek?.status || "").toUpperCase();
        legend.textContent = !hasGameweek
            ? "Fixtures — unavailable"
            : gwStatus === "COMPLETED"
                ? `${gwLabel} results verified`
                : `${gwLabel} fixtures — awaiting results`;
    }

    const headingA = groupA?.parentElement?.querySelector(".grp-header");
    const headingB = groupB?.parentElement?.querySelector(".grp-header");

    if (headingA) {
        headingA.classList.remove("grp-b");
        headingA.classList.add("grp-a");
        headingA.innerHTML = `
            <span class="grp-title">
                <span class="grp-chip safe">${escapeHTML(gwLabel)}</span>
                <span class="grp-vs">//</span>
                <span class="grp-chip danger">MATCHES</span>
            </span>
            <span class="grp-count" data-match-count>${matches.length} ${matches.length === 1 ? "MATCH" : "MATCHES"}</span>
        `;
        headingA.setAttribute(
            "aria-label",
            `${gwLabel} matches — ${matches.length} ${matches.length === 1 ? "match" : "matches"}`
        );
    }

    if (headingB) {
        headingB.classList.remove("grp-a");
        headingB.classList.add("grp-b");
        const byeCount = bye ? 1 : 0;
        headingB.innerHTML = `
            <span class="grp-title">
                <span class="grp-chip normal">BYE</span>
                <span class="grp-vs">//</span>
                <span class="grp-chip normal">NO MATCH</span>
            </span>
            <span class="grp-count">${byeCount} ${byeCount === 1 ? "SURVIVOR" : "SURVIVORS"}</span>
        `;
        headingB.setAttribute(
            "aria-label",
            `Bye — ${byeCount} ${byeCount === 1 ? "survivor" : "survivors"} without a match`
        );
    }

    const matchNumbers = new Map(
        matches.map((match, index) => [String(match.id), index + 1])
    );

    if (groupA) {
        if (!hasGameweek || !matchesLoadedFromDatabase) {
            groupA.innerHTML = `<div class="group-message">Fixture data is unavailable. Please try again later.</div>`;
        } else if (matches.length === 0) {
            groupA.innerHTML = `<div class="group-message">No fixtures are registered for ${escapeHTML(gwLabel)}.</div>`;
        } else {
            groupA.innerHTML = matches.map(match =>
                renderMatchCard(match, matchNumbers.get(String(match.id)), "sd")
            ).join("");
        }
        groupA.removeAttribute("aria-busy");
    }

    if (groupB) {
        groupB.innerHTML = hasGameweek && matchesLoadedFromDatabase
            ? renderByeCard(bye)
            : `<div class="group-message">Bye data is unavailable. Please try again later.</div>`;
        groupB.removeAttribute("aria-busy");
    }

    if (LIVE_ENABLED && liveState.data) {
        applyLiveScores();
    }

    publishDebugState();
}


// ---------------------------------------------------------
// 7B. LIVE MATCH CENTRE — provisional scores (display only)
// ---------------------------------------------------------

function ensureLiveMeta() {
    const page = document.getElementById("page-matchups");
    if (!page) return null;

    let meta = page.querySelector(".match-live-meta");
    if (!meta) {
        meta = document.createElement("div");
        meta.className = "match-live-meta";
        meta.setAttribute("role", "status");
        meta.setAttribute("aria-live", "polite");
        const anchor = page.querySelector(".groups-layout");
        if (anchor && anchor.parentElement) {
            anchor.parentElement.insertBefore(meta, anchor);
        } else {
            page.appendChild(meta);
        }
    }

    const stamp = liveState.updatedAt
        ? liveState.updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : "—";
    const unavailable = Boolean(liveState.error) && !liveState.data;
    const label = unavailable
        ? "LIVE SCORE UNAVAILABLE"
        : liveState.stale
            ? "LIVE · PROVISIONAL — STALE"
            : "LIVE · PROVISIONAL";
    const stampText = unavailable
        ? "Provisional live points could not be loaded."
        : liveState.stale
            ? `Last update ${stamp}`
            : `Updated ${stamp}`;

    meta.classList.toggle("is-stale", Boolean(liveState.stale) && !unavailable);
    meta.classList.toggle("is-error", unavailable);
    meta.innerHTML = unavailable
        ? `
        <span class="live-dot" aria-hidden="true"></span>
        <span class="live-label">${label}</span>
        <span class="live-stamp">${stampText}</span>
        <span class="live-note">Fixtures and stored results remain unaffected. Live points refresh automatically.</span>
    `
        : `
        <span class="live-dot" aria-hidden="true"></span>
        <span class="live-label">${label}</span>
        <span class="live-stamp">${stampText}</span>
        <span class="live-note">Bench (incl. Bench Boost) &amp; Triple Captain bonus excluded · Captain ×2 · Hits deducted · Autosubs not calculated</span>
    `;

    return meta;
}

function applyLiveScores() {
    if (!LIVE_ENABLED || !liveState.data || !liveState.data.players) return;
    if (!currentGameweek) return;
    if (
        liveState.data.gw !== undefined &&
        Number(liveState.data.gw) !== Number(currentGameweek.gw_number)
    ) {
        return;
    }

    const playersLive = liveState.data.players;
    const cards = document.querySelectorAll("#page-matchups .match-card[data-match-id]");

    cards.forEach(card => {
        if (String(card.dataset.matchStatus || "").toLowerCase() === "completed") return;

        let cardHasLive = false;

        card.querySelectorAll(".match-player[data-player-id]").forEach(playerEl => {
            const existing = playerEl.querySelector(".match-live-score");
            if (existing) existing.remove();
            playerEl.classList.remove("has-live");

            const record = playersLive[playerEl.dataset.playerId];
            if (!record || record.points === null || record.points === undefined) return;

            const chip = document.createElement("span");
            chip.className = "match-live-score" + (liveState.stale ? " is-stale" : "");
            chip.title = "Provisional live score — starting XI only (no Bench Boost); captain ×2 (no Triple Captain bonus); transfer hits deducted; autosubs not applied";
            chip.setAttribute("aria-label", "Provisional live score: " + record.points + " points");
            chip.innerHTML = `<strong>${escapeHTML(record.points)}</strong><small>LIVE</small>`;

            const name = playerEl.querySelector(".match-name");
            if (name) {
                name.insertAdjacentElement("afterend", chip);
            } else {
                playerEl.appendChild(chip);
            }

            playerEl.classList.add("has-live");
            cardHasLive = true;
        });

        card.classList.toggle("has-live", cardHasLive);

        let badge = card.querySelector(".match-badge.live-provisional");
        if (cardHasLive && !badge) {
            const head = card.querySelector(".match-card-head");
            if (head) {
                badge = document.createElement("span");
                badge.className = "match-badge live-provisional";
                badge.textContent = "LIVE · PROVISIONAL";
                head.appendChild(badge);
            }
        } else if (!cardHasLive && badge) {
            badge.remove();
        }
    });

    ensureLiveMeta();
}

async function loadLiveScores() {
    if (!LIVE_ENABLED || liveState.inFlight) return;

    if (!currentGameweek) {
        liveState.error = new Error("No current gameweek");
        ensureLiveMeta();
        return;
    }

    const gw = Number(currentGameweek.gw_number);
    liveState.inFlight = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    try {
        const response = await fetch(`/api/live?gw=${encodeURIComponent(gw)}`, {
            headers: { Accept: "application/json" },
            signal: controller.signal
        });

        if (!response.ok) throw new Error("HTTP " + response.status);

        const payload = await response.json();
        if (!payload || payload.ok !== true || !payload.players) {
            throw new Error("Invalid live payload");
        }
        if (payload.gw !== undefined && Number(payload.gw) !== gw) {
            throw new Error("Gameweek mismatch");
        }

        liveState.data = payload;
        liveState.updatedAt = payload.updated_at ? new Date(payload.updated_at) : new Date();
        liveState.stale = Boolean(payload.stale);
        liveState.error = null;
        applyLiveScores();
    } catch (error) {
        liveState.error = error;
        if (liveState.data) {
            liveState.stale = true;
            applyLiveScores();
        } else {
            ensureLiveMeta();
        }
    } finally {
        clearTimeout(timer);
        liveState.inFlight = false;
    }
}

function startLiveScores() {
    if (!LIVE_ENABLED) return;

    loadLiveScores();

    if (liveState.timer) clearInterval(liveState.timer);
    liveState.timer = setInterval(() => {
        if (document.hidden) return;
        const page = document.getElementById("page-matchups");
        if (page && page.classList.contains("active")) {
            loadLiveScores();
        }
    }, LIVE_REFRESH_MS);

    document.addEventListener("visibilitychange", () => {
        if (document.hidden) return;
        const page = document.getElementById("page-matchups");
        if (page && page.classList.contains("active")) {
            loadLiveScores();
        }
    });
}

// ---------------------------------------------------------
// 8. TEAM LINEUP VIEWER — read-only, fetched on demand
// ---------------------------------------------------------

const TEAM_LINEUP_ENDPOINT = "/api/team";
const TEAM_LINEUP_TIMEOUT_MS = 12000;
const TEAM_LINEUP_SILHOUETTE = `<svg class="tlv-silhouette" viewBox="0 0 64 76" aria-hidden="true" focusable="false"><path class="tlv-sil-head" d="M32 7c6.1 0 11 4.9 11 11s-4.9 11-11 11-11-4.9-11-11S25.9 7 32 7Z"/><path class="tlv-sil-body" d="M32 32c-9.6 0-17.2 5.9-19.5 15.2L9.1 70h11.2l3.2-14.4h17l3.2 14.4h11.2l-3.4-22.8C49.2 37.9 41.6 32 32 32Z"/><path class="tlv-sil-shirt" d="M24.6 35.4 32 40.2l7.4-4.8 5.3 2.6-3.5 6.4L32 48.9l-9.2-4.5-3.5-6.4 5.3-2.6Z"/></svg>`;

const TEAM_LINEUP_CHIPS = {
    "3xc": "Triple Captain",
    bboost: "Bench Boost",
    freehit: "Free Hit",
    wildcard: "Wildcard"
};

const teamLineupState = {
    initialized: false,
    dialog: null,
    body: null,
    participantEl: null,
    teamEl: null,
    statusEl: null,
    metaEl: null,
    announcer: null,
    closeButton: null,
    controller: null,
    requestId: 0,
    playerId: null,
    lastTrigger: null
};

function makeLineupElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
}

function formatLineupStat(value) {
    if (value === null || value === undefined || value === "") return "—";
    const numeric = Number(value);
    return Number.isFinite(numeric) ? String(numeric) : "—";
}

function formatLineupTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    try {
        return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch (error) {
        return "";
    }
}

function getLineupChipLabel(chip) {
    if (!chip) return "";
    return TEAM_LINEUP_CHIPS[chip] || String(chip);
}

function setLineupStatus(text, tone) {
    if (!teamLineupState.statusEl) return;
    teamLineupState.statusEl.textContent = text;
    teamLineupState.statusEl.dataset.tone = tone || "unknown";
}

function setLineupMeta(parts) {
    if (!teamLineupState.metaEl) return;
    teamLineupState.metaEl.textContent = (parts || []).filter(Boolean).join(" · ");
}

function announceLineup(message) {
    if (!teamLineupState.announcer) return;
    teamLineupState.announcer.textContent = message;
}

function setLineupHeader(participantName, teamName) {
    if (teamLineupState.participantEl) {
        teamLineupState.participantEl.textContent = participantName || "Participant";
    }
    if (teamLineupState.teamEl) {
        teamLineupState.teamEl.textContent = teamName || "";
    }
}

function createLineupBadge(club, className) {
    const record = club && typeof club === "object" ? club : {};
    if (!record.badge_url) return null;

    const badge = document.createElement("img");
    badge.className = className || "tlv-pcard-badge";
    badge.src = String(record.badge_url);
    badge.alt = "";
    badge.width = 12;
    badge.height = 12;
    badge.loading = "lazy";
    badge.decoding = "async";
    badge.addEventListener("error", () => badge.remove());
    return badge;
}

function buildLineupMarker(record) {
    if (record.is_captain) {
        const multiplier = Number(record.multiplier);
        const hasMultiplier = Number.isFinite(multiplier) && multiplier > 1;
        const label = hasMultiplier ? `C ×${multiplier}` : "C";
        const marker = makeLineupElement("span", "tlv-marker is-captain", label);
        marker.setAttribute("aria-label", hasMultiplier ? `Captain, multiplier ${multiplier}` : "Captain");
        return marker;
    }

    if (record.is_vice_captain) {
        const marker = makeLineupElement("span", "tlv-marker is-vice", "VC");
        marker.setAttribute("aria-label", "Vice-captain");
        return marker;
    }

    return null;
}

function getLineupPhotoSources(record) {
    const sources = [];
    const current = record && record.photo_url ? String(record.photo_url) : "";
    const previous = record && record.photo_url_previous ? String(record.photo_url_previous) : "";

    if (current) sources.push(current);
    if (previous && previous !== current) sources.push(previous);
    return sources;
}

function attachLineupPhoto(portrait, record, eager) {
    const sources = getLineupPhotoSources(record);
    portrait.dataset.photoState = sources.length ? "loading" : "fallback";

    if (!sources.length) return;

    const img = document.createElement("img");
    img.className = "tlv-pcard-img";
    img.alt = "";
    img.decoding = "async";
    img.loading = eager ? "eager" : "lazy";
    img.draggable = false;

    let sourceIndex = 0;
    let settled = false;

    img.addEventListener("load", () => {
        if (settled) return;
        settled = true;
        img.classList.add("is-loaded");
        portrait.classList.add("has-photo");
        portrait.dataset.photoState = "loaded";
    });

    img.addEventListener("error", () => {
        if (settled) return;
        sourceIndex += 1;
        if (sourceIndex < sources.length) {
            img.src = sources[sourceIndex];
            return;
        }
        settled = true;
        img.remove();
        portrait.dataset.photoState = "fallback";
    });

    portrait.appendChild(img);
    img.src = sources[0];
}

function buildLineupPitchCard(player, options) {
    const record = player && typeof player === "object" ? player : {};
    const club = record.club && typeof record.club === "object" ? record.club : {};
    const isBench = Boolean(options && options.bench);
    const nameText = record.name || record.full_name || "Unknown player";

    const card = makeLineupElement("article", "tlv-pcard" + (isBench ? " is-bench" : ""));

    const portrait = makeLineupElement("div", "tlv-pcard-photo");
    portrait.innerHTML = TEAM_LINEUP_SILHOUETTE;
    attachLineupPhoto(portrait, record, !isBench);
    card.appendChild(portrait);

    const plate = makeLineupElement("div", "tlv-pcard-plate");

    const nameRow = makeLineupElement("div", "tlv-pcard-namerow");
    const name = makeLineupElement("strong", "tlv-pcard-name", nameText);
    name.title = String(record.full_name || nameText);
    nameRow.appendChild(name);

    const marker = buildLineupMarker(record);
    if (marker) nameRow.appendChild(marker);
    plate.appendChild(nameRow);

    const metaRow = makeLineupElement("div", "tlv-pcard-meta");
    const badge = createLineupBadge(club);
    if (badge) metaRow.appendChild(badge);

    if (isBench) {
        const position = makeLineupElement(
            "span",
            "tlv-pcard-position",
            record.position_short || record.position_name || "—"
        );
        if (record.position_name) position.title = String(record.position_name);
        metaRow.appendChild(position);
    } else {
        metaRow.appendChild(makeLineupElement(
            "span",
            "tlv-pcard-club",
            club.short_name || club.name || "Club"
        ));
    }
    plate.appendChild(metaRow);

    const stats = makeLineupElement("div", "tlv-pcard-stats");
    const points = makeLineupElement("span", "tlv-pcard-stat");
    points.appendChild(makeLineupElement("strong", "", formatLineupStat(record.points)));
    points.appendChild(makeLineupElement("small", "", "PTS"));
    points.title = record.is_captain
        ? "Official raw FPL points; the captain multiplier is not included."
        : "Official FPL points";
    if (record.is_captain) {
        points.appendChild(makeLineupElement(
            "span",
            "tlv-sr-only",
            "Official raw points; captain multiplier not included."
        ));
    }
    stats.appendChild(points);

    const minutes = makeLineupElement("span", "tlv-pcard-stat");
    minutes.appendChild(makeLineupElement("strong", "", formatLineupStat(record.minutes)));
    minutes.appendChild(makeLineupElement("small", "", "MIN"));
    minutes.title = "Official FPL minutes played";
    stats.appendChild(minutes);
    plate.appendChild(stats);

    card.appendChild(plate);
    return card;
}

function buildLineupPitch(xi, formation) {
    const pitch = makeLineupElement("div", "tlv-pitch");
    pitch.setAttribute("role", "group");
    pitch.setAttribute(
        "aria-label",
        `Starting XI pitch${formation ? `, formation ${formation}` : ""}`
    );

    const markings = makeLineupElement("div", "tlv-pitch-markings");
    markings.setAttribute("aria-hidden", "true");
    ["outer", "half", "circle", "spot-top", "spot-bottom", "box-top", "box-bottom", "goal-top", "goal-bottom"]
        .forEach(mark => markings.appendChild(makeLineupElement("span", `tlv-mark is-${mark}`)));
    pitch.appendChild(markings);

    const rows = makeLineupElement("div", "tlv-pitch-rows");
    const lineKeys = ["GKP", "DEF", "MID", "FWD"];
    const lines = new Map(lineKeys.map(key => [key, []]));
    const ungrouped = [];

    xi.forEach(player => {
        const key = String(player && player.position_short || "").toUpperCase();
        if (lines.has(key)) lines.get(key).push(player);
        else ungrouped.push(player);
    });

    lineKeys.forEach(key => {
        const players = lines.get(key);
        if (!players.length) return;

        const row = makeLineupElement("div", "tlv-pitch-row");
        row.dataset.line = key;
        if (key === "GKP") row.classList.add("is-keeper");
        players.forEach(player => row.appendChild(buildLineupPitchCard(player)));
        rows.appendChild(row);
    });

    if (ungrouped.length) {
        const row = makeLineupElement("div", "tlv-pitch-row");
        row.dataset.line = "OTHER";
        ungrouped.forEach(player => row.appendChild(buildLineupPitchCard(player)));
        rows.appendChild(row);
    }

    pitch.appendChild(rows);
    return pitch;
}

function renderLineupWarnings(warnings) {
    const list = (warnings || []).filter(item => typeof item === "string" && item.trim());
    if (!list.length) return null;

    const section = makeLineupElement("section", "tlv-warnings");
    section.appendChild(makeLineupElement("h3", "", "Data notes"));
    const ul = document.createElement("ul");
    list.forEach(item => ul.appendChild(makeLineupElement("li", "", item)));
    section.appendChild(ul);
    return section;
}

function renderTeamLineup(participant, data) {
    const body = teamLineupState.body;
    if (!body) return;

    const teamName = data.entry && data.entry.team_name
        ? String(data.entry.team_name)
        : "Team name unavailable";
    setLineupHeader(participant.name, teamName);

    const final = data.final === true || String(data.status || "").toUpperCase() === "FINAL";
    const xi = Array.isArray(data.xi) ? data.xi : [];
    const bench = Array.isArray(data.bench) ? data.bench : [];

    setLineupStatus(
        final ? "FINAL" : "PROVISIONAL",
        final ? "final" : "provisional"
    );

    const meta = [];
    if (data.gw !== null && data.gw !== undefined) meta.push(`GW ${data.gw}`);
    if (data.formation) meta.push(String(data.formation));
    const chipLabel = getLineupChipLabel(data.chip);
    if (chipLabel) meta.push(chipLabel);
    const updatedAt = formatLineupTime(data.updated_at);
    if (updatedAt) meta.push(`Updated ${updatedAt}`);
    if (data.stale) meta.push("Cached data");
    setLineupMeta(meta);

    const fragment = document.createDocumentFragment();

    fragment.appendChild(makeLineupElement(
        "p",
        "tlv-banner " + (final ? "is-final" : "is-provisional"),
        final
            ? "FINAL — FPL has checked this gameweek."
            : "PROVISIONAL — FPL has not finalised this gameweek. Points, bonus and automatic substitutions may still change."
    ));

    const xiSection = makeLineupElement("section", "tlv-squad tlv-pitch-squad");
    const xiHead = makeLineupElement("div", "tlv-squad-head");
    xiHead.appendChild(makeLineupElement("h3", "", "Starting XI"));
    const xiSummary = [`${xi.length} players`];
    if (data.formation) xiSummary.push(String(data.formation));
    if (chipLabel) xiSummary.push(chipLabel);
    xiHead.appendChild(makeLineupElement("span", "", xiSummary.join(" · ")));
    xiSection.appendChild(xiHead);

    xiSection.appendChild(buildLineupPitch(xi, data.formation));
    fragment.appendChild(xiSection);

    const benchSection = makeLineupElement("section", "tlv-squad tlv-bench");
    const benchHead = makeLineupElement("div", "tlv-squad-head");
    benchHead.appendChild(makeLineupElement("h3", "", "Bench"));
    benchHead.appendChild(makeLineupElement("span", "", `${bench.length} players · not counted in the tournament LIVE SCORE`));
    benchSection.appendChild(benchHead);

    const benchGrid = makeLineupElement("div", "tlv-bench-grid");
    bench.forEach(player => benchGrid.appendChild(buildLineupPitchCard(player, { bench: true })));
    benchSection.appendChild(benchGrid);
    fragment.appendChild(benchSection);

    const warnings = renderLineupWarnings(data.warnings);
    if (warnings) fragment.appendChild(warnings);

    body.setAttribute("aria-busy", "false");
    body.replaceChildren(fragment);
    announceLineup(
        `${participant.name}: ${teamName}. ${xi.length} starters${data.formation ? ` in a ${data.formation} formation` : ""}, ${bench.length} bench players.`
    );
}

function renderLineupLoading(participant) {
    const body = teamLineupState.body;
    if (!body) return;

    setLineupStatus("LOADING", "loading");
    setLineupMeta([]);
    body.setAttribute("aria-busy", "true");

    const wrap = makeLineupElement("div", "tlv-loading");
    const spinner = makeLineupElement("span", "tlv-spinner");
    spinner.setAttribute("aria-hidden", "true");
    wrap.appendChild(spinner);
    wrap.appendChild(makeLineupElement("p", "tlv-loading-text", "Loading FPL lineup…"));
    body.replaceChildren(wrap);
    announceLineup(`Loading FPL lineup for ${participant.name}.`);
}

function renderLineupProblem(options) {
    const body = teamLineupState.body;
    if (!body) return;

    setLineupStatus(options.status, options.tone || "unknown");
    setLineupMeta([]);
    body.setAttribute("aria-busy", "false");

    const wrap = makeLineupElement("div", "tlv-state " + (options.className || ""));
    wrap.appendChild(makeLineupElement("h3", "", options.title));
    wrap.appendChild(makeLineupElement("p", "", options.message));
    if (options.detail) {
        wrap.appendChild(makeLineupElement("p", "tlv-state-detail", options.detail));
    }

    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "tlv-retry";
    retry.dataset.tlvRetry = "true";
    retry.textContent = "Try again";
    wrap.appendChild(retry);

    body.replaceChildren(wrap);
    announceLineup(options.announcement || options.title);
}

async function loadTeamLineup(playerId) {
    const participant = getPlayerById(playerId);
    if (!participant || !teamLineupState.dialog) return;

    teamLineupState.playerId = playerId;
    const requestId = ++teamLineupState.requestId;

    if (teamLineupState.controller) teamLineupState.controller.abort();
    const controller = new AbortController();
    teamLineupState.controller = controller;
    let timedOut = false;
    const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, TEAM_LINEUP_TIMEOUT_MS);

    setLineupHeader(participant.name, "Loading FPL team…");
    renderLineupLoading(participant);

    try {
        const response = await fetch(
            `${TEAM_LINEUP_ENDPOINT}?player=${encodeURIComponent(playerId)}`,
            {
                headers: { Accept: "application/json" },
                signal: controller.signal
            }
        );

        let payload = null;
        try {
            payload = await response.json();
        } catch (error) {
            payload = null;
        }

        if (requestId !== teamLineupState.requestId) return;

        if (!response.ok || !payload || payload.ok !== true) {
            const errorCode = payload && payload.error ? String(payload.error) : "";
            if (response.status === 404 || errorCode === "picks_unavailable") {
                setLineupHeader(participant.name, "Team name unavailable");
                renderLineupProblem({
                    status: "UNAVAILABLE",
                    tone: "unavailable",
                    className: "is-unavailable",
                    title: "Lineup unavailable",
                    message: "FPL has not published a lineup for this gameweek yet. Please try again later.",
                    detail: errorCode ? `Reference: ${errorCode}` : `Reference: HTTP ${response.status}`,
                    announcement: `Lineup unavailable for ${participant.name}.`
                });
                return;
            }

            setLineupHeader(participant.name, "Team name unavailable");
            renderLineupProblem({
                status: "ERROR",
                tone: "error",
                className: "is-error",
                title: "Could not load this lineup",
                message: "The lineup request failed. Check your connection and try again.",
                detail: errorCode ? `Reference: ${errorCode}` : `Reference: HTTP ${response.status}`,
                announcement: `Could not load the lineup for ${participant.name}.`
            });
            return;
        }

        const xi = Array.isArray(payload.xi) ? payload.xi : [];
        const bench = Array.isArray(payload.bench) ? payload.bench : [];

        if (!xi.length && !bench.length) {
            setLineupHeader(
                participant.name,
                payload.entry && payload.entry.team_name ? String(payload.entry.team_name) : "Team name unavailable"
            );
            renderLineupProblem({
                status: "EMPTY",
                tone: "unavailable",
                className: "is-unavailable",
                title: "No lineup available",
                message: "This team has no published picks for the current gameweek.",
                detail: "",
                announcement: `No lineup available for ${participant.name}.`
            });
            return;
        }

        renderTeamLineup(participant, payload);
    } catch (error) {
        if (error && error.name === "AbortError") {
            if (!timedOut) return;
            if (requestId !== teamLineupState.requestId) return;

            setLineupHeader(participant.name, "Team name unavailable");
            renderLineupProblem({
                status: "TIMEOUT",
                tone: "error",
                className: "is-error",
                title: "Request timed out",
                message: "The lineup request took too long to respond. Check your connection and try again.",
                detail: "Reference: timeout",
                announcement: `The lineup request for ${participant.name} timed out.`
            });
            return;
        }
        if (requestId !== teamLineupState.requestId) return;

        setLineupHeader(participant.name, "Team name unavailable");
        renderLineupProblem({
            status: "ERROR",
            tone: "error",
            className: "is-error",
            title: "Could not load this lineup",
            message: "The lineup request failed. Check your connection and try again.",
            detail: "Reference: network_error",
            announcement: `Could not load the lineup for ${participant.name}.`
        });
    } finally {
        clearTimeout(timeoutId);
        if (requestId === teamLineupState.requestId) {
            teamLineupState.controller = null;
            if (teamLineupState.body) teamLineupState.body.setAttribute("aria-busy", "false");
        }
    }
}

function openTeamLineup(playerId, trigger) {
    const dialog = teamLineupState.dialog;
    const participant = getPlayerById(playerId);
    if (!dialog || !participant) return;

    teamLineupState.lastTrigger = trigger || null;

    if (!dialog.open) {
        dialog.showModal();
        document.body.classList.add("tlv-modal-open");
    }

    setLineupHeader(participant.name, "Loading FPL team…");
    if (teamLineupState.closeButton) {
        teamLineupState.closeButton.focus({ preventScroll: true });
    }
    loadTeamLineup(playerId);
}

function handleLineupTriggerClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    const trigger = target ? target.closest(".match-name-trigger") : null;
    if (!trigger) return;

    const matchPlayer = trigger.closest(".match-player[data-player-id]");
    if (!matchPlayer) return;

    const playerId = Number(matchPlayer.dataset.playerId);
    if (!Number.isInteger(playerId) || playerId < 1 || playerId > 24) return;

    event.preventDefault();
    openTeamLineup(playerId, trigger);
}

function handleLineupClose() {
    // The close event fires asynchronously; if the dialog was reopened in the
    // meantime this close belongs to the previous open and must not cancel it.
    if (teamLineupState.dialog && teamLineupState.dialog.open) return;

    if (teamLineupState.controller) {
        teamLineupState.controller.abort();
        teamLineupState.controller = null;
    }
    teamLineupState.requestId += 1;
    document.body.classList.remove("tlv-modal-open");
    if (teamLineupState.body) teamLineupState.body.setAttribute("aria-busy", "false");

    const trigger = teamLineupState.lastTrigger;
    const playerId = teamLineupState.playerId;

    if (trigger && trigger.isConnected) {
        trigger.focus({ preventScroll: true });
    } else if (playerId !== null) {
        const fallback = document.querySelector(
            `#page-matchups .match-player[data-player-id="${Number(playerId)}"] .match-name-trigger`
        );
        if (fallback) fallback.focus({ preventScroll: true });
    }

    teamLineupState.playerId = null;
    teamLineupState.lastTrigger = null;
}

function closeTeamLineup() {
    const dialog = teamLineupState.dialog;
    if (dialog && dialog.open) {
        dialog.close();
    } else {
        document.body.classList.remove("tlv-modal-open");
    }
}

function initTeamLineupViewer() {
    if (teamLineupState.initialized) return;

    const dialog = document.getElementById("team-lineup-dialog");
    const matchups = document.getElementById("page-matchups");
    const body = document.getElementById("tlv-body");
    const participantEl = document.getElementById("tlv-participant-name");
    const teamEl = document.getElementById("tlv-team-name");
    const statusEl = document.getElementById("tlv-status");
    const metaEl = document.getElementById("tlv-meta");
    const announcer = document.getElementById("tlv-announcer");
    const closeButton = document.getElementById("tlv-close");

    if (!dialog || !matchups || !body || !participantEl || !teamEl || !statusEl || !closeButton) {
        console.warn("Team lineup viewer markup is incomplete.");
        return;
    }

    teamLineupState.dialog = dialog;
    teamLineupState.body = body;
    teamLineupState.participantEl = participantEl;
    teamLineupState.teamEl = teamEl;
    teamLineupState.statusEl = statusEl;
    teamLineupState.metaEl = metaEl;
    teamLineupState.announcer = announcer;
    teamLineupState.closeButton = closeButton;

    closeButton.addEventListener("click", closeTeamLineup);

    dialog.addEventListener("cancel", event => {
        event.preventDefault();
        closeTeamLineup();
    });

    dialog.addEventListener("click", event => {
        if (event.target === dialog) closeTeamLineup();
    });

    dialog.addEventListener("close", handleLineupClose);

    body.addEventListener("click", event => {
        const target = event.target instanceof Element ? event.target : null;
        const retry = target ? target.closest("[data-tlv-retry]") : null;
        if (!retry) return;
        event.preventDefault();
        if (teamLineupState.playerId !== null) {
            loadTeamLineup(teamLineupState.playerId);
            if (teamLineupState.closeButton) {
                teamLineupState.closeButton.focus({ preventScroll: true });
            }
        }
    });

    matchups.addEventListener("click", handleLineupTriggerClick);

    teamLineupState.initialized = true;
    console.log("Team lineup viewer ready.");
}

// ---------------------------------------------------------
// 9. STARTUP
// ---------------------------------------------------------

document.addEventListener("DOMContentLoaded", async () => {
    console.log("THE LAST OF FPL: script.js started.");

    initPlayerSearch();

    await loadPlayersFromSupabase();

    const gameweeks = await loadGameweeksFromSupabase();
    currentGameweek = pickCurrentGameweek(gameweeks || []);
    latestCompletedGameweek = pickLatestCompletedGameweek(gameweeks || []);

    publishDebugState();

    if (latestCompletedGameweek) {
        await loadGameweekPoints(latestCompletedGameweek);
    }

    if (currentGameweek) {
        await loadCurrentGameweekMatches();
    }

    syncPageLabels();
    syncPointsNote();
    filterStandings();
    renderInfected();
    syncJourneyLedger();
    renderMatchups();

    initTeamLineupViewer();
    startLiveScores();

    document.body.classList.remove("intro-pending");
    document.body.classList.add("intro-complete");

    publishDebugState();

    console.log("THE LAST OF FPL: initialization finished.", {
        gameweek: currentGameweek ? currentGameweek.gw_number : null,
        pointsGameweek: gwPointsGameweek ? gwPointsGameweek.gw_number : null,
        players: roster.length,
        matches: currentMatches.length,
        bye: currentGameweekBye ? currentGameweekBye.player_id : null
    });
});

// Public functions for existing HTML onclick handlers.
window.switchTab = switchTab;
window.filterStandings = filterStandings;
window.renderMatchups = renderMatchups;
window.loadCurrentMatches = loadCurrentGameweekMatches;
window.syncJourneyLedger = syncJourneyLedger;
window.currentMatches = currentMatches;
window.roster = roster;
