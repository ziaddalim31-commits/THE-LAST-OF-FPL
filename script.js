/* =========================================================
   THE LAST OF FPL — EMPERORES KINGDOM FANTASY
   Supabase-connected JavaScript
   ========================================================= */

"use strict";

// ---------------------------------------------------------
// 1. FALLBACK PLAYER DATA
// Used only if Supabase cannot load the players.
// Legacy GW6 reference points are retained here but are never shown as current points.
// ---------------------------------------------------------

const fallbackRoster = [
    { name: "Saad", state: "NORMAL", points: 59, hearts: 3 },
    { name: "Yougito", state: "NORMAL", points: 61, hearts: 3 },
    { name: "Islam", state: "SAFE", points: 56, hearts: 3 },
    { name: "Ayman", state: "SAFE", points: 88, hearts: 3 },
    { name: "Adnane Elkhamayry", state: "NORMAL", points: 68, hearts: 3 },
    { name: "Abdennour", state: "NORMAL", points: 59, hearts: 3 },
    { name: "Zakaria", state: "SAFE", points: 51, hearts: 3 },
    { name: "Fatima", state: "DANGER", points: 70, hearts: 2 },
    { name: "Ismail Hadrani", state: "SAFE", points: 48, hearts: 3 },
    { name: "Wld Lhaj", state: "DANGER", points: 69, hearts: 2 },
    { name: "Ayoub Abouzar", state: "DANGER", points: 77, hearts: 3 },
    { name: "Meryem", state: "SAFE", points: 81, hearts: 3 },
    { name: "Ayoub", state: "DANGER", points: 68, hearts: 3 },
    { name: "Moulchi", state: "SAFE", points: 82, hearts: 2 },
    { name: "Anas", state: "DANGER", points: 62, hearts: 3 },
    { name: "Youness Oukhiya", state: "SAFE", points: 73, hearts: 3 },
    { name: "Nezar", state: "SAFE", points: 74, hearts: 3 },
    { name: "Nexus", state: "DANGER", points: 65, hearts: 3 },
    { name: "Abdellah Moghtanim", state: "DANGER", points: 97, hearts: 2 },
    { name: "Ahmed", state: "NORMAL", points: 61, hearts: 3 },
    { name: "Arbi", state: "NORMAL", points: 49, hearts: 3 },
    { name: "Abdelghafour", state: "DANGER", points: 50, hearts: 2 },
    { name: "Adnane", state: "NORMAL", points: 70, hearts: 3 },
    { name: "Abdel Chipi", state: "NORMAL", points: 54, hearts: 1 }
];

const roster = fallbackRoster.map((player, index) => ({
    ...player,
    id: `fallback-${index + 1}`
}));

let activeStatusFilter = "ALL";
let activeSearch = "";
let currentMatches = [];
let playersLoadedFromDatabase = false;
let matchesLoadedFromDatabase = false;
let gw8PointsLoaded = false;
const gw8PointsByPlayerId = new Map();

// Manually curated infected list. Never derived from DANGER state or hearts.
const INFECTED_ROSTER = ["Wld Lhaj", "Abdellah Moghtanim", "Abdelghafour", "Fatima"];

// Display-only heart overrides for MATCHES and STANDINGS; nothing is written to the database.
const HEARTS_DISPLAY_OVERRIDES = {
    [normalizePlayerName("Moulchi")]: 3
};

// GW9 official pairings, rendered locally; no results exist yet.
const GW9_MATCHUPS = [
    ["Islam", "Wld Lhaj"],
    ["Zakaria", "Abdellah Moghtanim"],
    ["Meryem", "Ahmed"],
    ["Ismail Hadrani", "Abdelghafour"],
    ["Youness Oukhiya", "Fatima"],
    ["Nezar", "Arbi"],
    ["Saad", "Yougito"],
    ["Adnane", "Ayoub"],
    ["Abdel Chipi", "Adnane Elkhamayry"],
    ["Abdennour", "Nexus"],
    ["Ayman", "Moulchi"],
    ["Ayoub Abouzar", "Anas"]
];

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
    const override = HEARTS_DISPLAY_OVERRIDES[normalizePlayerName(player?.name)];

    return Number.isFinite(override) ? override : getPlayerHearts(player);
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

function normalizePlayerName(value) {
    return String(value || "").trim().toLowerCase();
}

function isInfectedPlayer(player) {
    const name = normalizePlayerName(player?.name);

    return name !== "" && INFECTED_ROSTER.some(entry => normalizePlayerName(entry) === name);
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

function getReferencePoints(player) {
    const points = Number(player.points);

    return Number.isFinite(points) ? points : 0;
}

function getGW8Points(player) {
    const points = gw8PointsByPlayerId.get(String(player.id));

    return Number.isFinite(points) ? points : null;
}

function formatGW8Points(player) {
    const points = getGW8Points(player);

    return points === null ? "—" : String(points);
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
    window.gw8PointsLoaded = gw8PointsLoaded;
    window.gw8PointsByPlayerId = Object.fromEntries(gw8PointsByPlayerId);
}

// ---------------------------------------------------------
// 2. LOAD PLAYERS FROM SUPABASE
// ---------------------------------------------------------

async function loadPlayersFromSupabase() {
    const client = window.supabaseClient;

    if (!client) {
        console.warn("Supabase client is unavailable. Using fallback players.");
        return false;
    }

    const { data, error } = await client
        .from("players")
        .select("id, name, status, hearts")
        .order("name", { ascending: true });

    if (error) {
        console.error("Could not load players:", error.message);
        return false;
    }

    const fallbackByName = new Map(
        fallbackRoster.map(player => [
            player.name.trim().toLowerCase(),
            player
        ])
    );

    const loadedPlayers = (data || []).map(player => {
        const fallback = fallbackByName.get(
            String(player.name || "").trim().toLowerCase()
        );

        return {
            id: player.id,
            name: player.name || "Unknown player",
            state: normalizeStatus(player.status),
            hearts: Math.max(
                0,
                Math.min(3, Number(player.hearts ?? fallback?.hearts ?? 3))
            ),
            // Legacy reference points; GW8 scores load separately from matches.
            points: fallback ? fallback.points : 0
        };
    });

    if (loadedPlayers.length === 0) {
        console.warn("Supabase returned no players. Keeping fallback data.");
        return false;
    }

    roster.splice(0, roster.length, ...loadedPlayers);
    playersLoadedFromDatabase = true;

    publishDebugState();
    console.log(`Players loaded from Supabase: ${roster.length}`);

    return true;
}

async function loadGW8PointsFromSupabase() {
    const client = window.supabaseClient;

    if (!client) {
        console.warn("Supabase client is unavailable. GW8 points cannot be loaded.");
        return false;
    }

    const { data, error } = await client
        .from("matches")
        .select("id, player_a_id, player_b_id, points_a, points_b, status")
        .eq("gameweek_id", 6)
        .order("id", { ascending: true });

    if (error) {
        console.error("Could not load GW8 points:", error.message);
        return false;
    }

    const matches = data || [];
    const scores = new Map();
    const appearances = new Map();

    matches.forEach(match => {
        [
            [match.player_a_id, match.points_a],
            [match.player_b_id, match.points_b]
        ].forEach(([playerId, points]) => {
            const key = String(playerId);
            appearances.set(key, (appearances.get(key) || 0) + 1);

            if (
                points === null ||
                points === undefined ||
                points === "" ||
                !Number.isFinite(Number(points))
            ) {
                return;
            }

            scores.set(key, Number(points));
        });
    });

    const rosterIds = roster.map(player => String(player.id));
    const complete =
        matches.length === 12 &&
        matches.every(match => String(match.status || "").toUpperCase() === "COMPLETED") &&
        rosterIds.length === 24 &&
        new Set(rosterIds).size === 24 &&
        rosterIds.every(playerId =>
            appearances.get(playerId) === 1 && scores.has(playerId)
        ) &&
        scores.size === 24 &&
        [...scores.keys()].every(playerId => rosterIds.includes(playerId));

    if (!complete) {
        console.warn("GW8 points are incomplete; standings points remain unavailable.", {
            matches: matches.length,
            mappedScores: scores.size,
            rosterSize: rosterIds.length
        });
        return false;
    }

    gw8PointsByPlayerId.clear();
    scores.forEach((points, playerId) => gw8PointsByPlayerId.set(playerId, points));
    gw8PointsLoaded = true;

    publishDebugState();
    console.log(`GW8 points loaded for ${scores.size} players from ${matches.length} completed matches.`);

    return true;
}

function syncGW8PointsNote() {
    const note = document.getElementById("standingsPointsNote");
    if (!note) return;

    note.textContent = gw8PointsLoaded
        ? "Survivors are grouped SAFE → NORMAL → DANGER. Points are verified GW8 scores from the 12 completed matches."
        : "Survivors are grouped SAFE → NORMAL → DANGER. GW8 scores are currently unavailable.";
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
                <td class="cell-points" data-label="GW8 points">
                    <strong>${formatGW8Points(player)}</strong>
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
                        <p class="survivor-points"><strong>${formatGW8Points(player)}</strong> GW8 PTS</p>
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

    if (totalElement) {
        totalElement.textContent = String(INFECTED_ROSTER.length).padStart(2, "0");
    }

    if (!container) return;

    const cases = INFECTED_ROSTER
        .map(name => roster.find(player => normalizePlayerName(player.name) === normalizePlayerName(name)))
        .filter(Boolean);

    if (cases.length === 0) {
        container.innerHTML = `
            <div class="c2-infected-empty">
                <span class="c2-label">No case files</span>
                <p>The player registry is not available yet. The confirmed infected list is unchanged.</p>
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
                        <dt>GW8 Points</dt>
                        <dd><strong class="c2-infected-pts">${formatGW8Points(player)}</strong><span class="unit">PTS</span></dd>
                    </div>
                    <div class="c2-infected-row">
                        <dt>Threat</dt>
                        <dd><span class="threat-box ${getThreatTone(player)}"><span class="threat-dot" aria-hidden="true"></span>${escapeHTML(threat)}</span></dd>
                    </div>
                </dl>
                <footer class="c2-infected-card-foot">
                    <span>Registry // Manual</span>
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
        SAFE: roster.filter(player => player.state === "SAFE").length,
        NORMAL: roster.filter(player => player.state === "NORMAL").length,
        DANGER: roster.filter(player => player.state === "DANGER").length
    };

    document.querySelectorAll("[data-filter]").forEach(button => {
        const key = button.dataset.filter;
        if (!(key in stateCounts)) return;

        button.textContent = `${key} (${stateCounts[key]})`;
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
            player.state === activeStatusFilter;

        return matchesSearch && matchesStatus;
    });

    renderStandings(filtered);
    renderSurvivorCards(filtered);
    syncSearchClear();

    const count = document.getElementById("survivorDossierCount");
    if (count) {
        count.textContent = `${filtered.length} ${filtered.length === 1 ? "SURVIVOR" : "SURVIVORS"} DISPLAYED`;
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
    const safeCount = roster.filter(p => p.state === "SAFE").length;
    const normalCount = roster.filter(p => p.state === "NORMAL").length;
    const dangerCount = roster.filter(p => p.state === "DANGER").length;
    const eliminatedCount = roster.filter(p => p.hearts <= 0).length;
    const activePlayers = roster.length - eliminatedCount;

    const metrics = {
        safeCount,
        normalCount,
        dangerCount,
        eliminatedCount,
        activePlayers
    };

    Object.entries(metrics).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    });

    const dataStats = {
        safe: safeCount,
        normal: normalCount,
        danger: dangerCount,
        eliminated: eliminatedCount,
        active: activePlayers,
        total: roster.length
    };

    Object.entries(dataStats).forEach(([key, value]) => {
        document.querySelectorAll(`[data-stat="${key}"]`).forEach(element => {
            element.textContent = value;
        });
    });

    const percentages = {
        safe: safeCount,
        normal: normalCount,
        danger: dangerCount
    };

    Object.entries(percentages).forEach(([key, value]) => {
        const percentage = roster.length === 0
            ? 0
            : Math.round((value / roster.length) * 100);

        document.querySelectorAll(`[data-stat-pct="${key}"]`).forEach(element => {
            element.textContent = `(${percentage}%)`;
        });
    });

    syncFilterLabels();
    publishDebugState();
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
                <strong class="match-name" title="${escapeHTML(player.name)}">${escapeHTML(player.name)}</strong>
                <span class="status ${stateClass}">${escapeHTML(displayState)}</span>
                ${isInfectedPlayer(player) ? '<span class="match-infected" role="img" aria-label="Infected">🦠 INFECTED</span>' : ""}
                ${resultTag}
                <div class="match-vitals">
                    <span class="match-hearts" role="img" aria-label="${hearts} of 3 hearts remaining">
                        ${renderHeartMarks(hearts)}
                    </span>
                    <span class="match-points ${formattedPoints.pending ? "is-pending" : ""}">
                        <strong>${escapeHTML(formattedPoints.value)}</strong>
                        <small>GW9 PTS</small>
                    </span>
                </div>
            </div>
        `;
    }

    return `
        <article class="match-card match-card--${type}" data-match-id="${escapeHTML(match.id)}" data-winner-id="${escapeHTML(winnerId || "")}">
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
// 7. GW9 MATCHUPS — LOCAL FIXTURES
// GW9 results do not exist yet, so pairings are rendered from the
// curated fixture list above instead of the completed GW8 match rows.
// ---------------------------------------------------------

async function loadGW8Matches() {
    return renderMatchups();
}

function buildGW9Matches() {
    return GW9_MATCHUPS.map(([nameA, nameB], index) => {
        const playerA = roster.find(player => normalizePlayerName(player.name) === normalizePlayerName(nameA));
        const playerB = roster.find(player => normalizePlayerName(player.name) === normalizePlayerName(nameB));

        return {
            id: `gw9-${String(index + 1).padStart(2, "0")}`,
            player_a_id: playerA ? playerA.id : null,
            player_b_id: playerB ? playerB.id : null,
            points_a: null,
            points_b: null,
            status: "PENDING"
        };
    });
}

async function renderMatchups() {
    const groupA = document.getElementById("groupA-list");
    const groupB = document.getElementById("groupB-list");

    if (!groupA && !groupB) {
        console.warn("Matchup containers not found in index.html.");
        return;
    }

    currentMatches = buildGW9Matches();
    matchesLoadedFromDatabase = false;

    const matchNumbers = new Map(
        currentMatches.map((match, index) => [String(match.id), index + 1])
    );

    const safeVsDanger = [];
    const normalVsNormal = [];
    const otherMatches = [];

    currentMatches.forEach(match => {
        const a = getPlayerById(match.player_a_id);
        const b = getPlayerById(match.player_b_id);

        if (!a || !b) {
            otherMatches.push(match);
            return;
        }

        const stateA = normalizeStatus(a.state);
        const stateB = normalizeStatus(b.state);

        if (
            (stateA === "SAFE" && stateB === "DANGER") ||
            (stateA === "DANGER" && stateB === "SAFE")
        ) {
            safeVsDanger.push(match);
        } else if (stateA === "NORMAL" && stateB === "NORMAL") {
            normalVsNormal.push(match);
        } else {
            otherMatches.push(match);
        }
    });

    const headingA = groupA?.parentElement?.querySelector(".grp-header");
    const headingB = groupB?.parentElement?.querySelector(".grp-header");

    if (headingA) {
        headingA.classList.remove("grp-b");
        headingA.classList.add("grp-a");
        headingA.innerHTML = `
            <span class="grp-title">
                <span class="grp-chip safe">SAFE</span>
                <span class="grp-vs">VS</span>
                <span class="grp-chip danger">DANGER</span>
            </span>
            <span class="grp-count">${safeVsDanger.length} ${safeVsDanger.length === 1 ? "MATCH" : "MATCHES"}</span>
        `;
        headingA.setAttribute(
            "aria-label",
            `SAFE vs DANGER — ${safeVsDanger.length} ${safeVsDanger.length === 1 ? "match" : "matches"}`
        );
    }

    if (headingB) {
        headingB.classList.remove("grp-a");
        headingB.classList.add("grp-b");
        headingB.innerHTML = `
            <span class="grp-title">
                <span class="grp-chip normal">NORMAL</span>
                <span class="grp-vs">VS</span>
                <span class="grp-chip normal">NORMAL</span>
            </span>
            <span class="grp-count">${normalVsNormal.length} ${normalVsNormal.length === 1 ? "MATCH" : "MATCHES"}</span>
        `;
        headingB.setAttribute(
            "aria-label",
            `NORMAL vs NORMAL — ${normalVsNormal.length} ${normalVsNormal.length === 1 ? "match" : "matches"}`
        );
    }

    if (groupA) {
        groupA.innerHTML = safeVsDanger.length
            ? safeVsDanger.map(match =>
                renderMatchCard(match, matchNumbers.get(String(match.id)), "sd")
            ).join("")
            : `<div class="group-message">No SAFE vs DANGER pairings are listed for GW9.</div>`;
        groupA.removeAttribute("aria-busy");
    }

    if (groupB) {
        groupB.innerHTML = normalVsNormal.length
            ? normalVsNormal.map(match =>
                renderMatchCard(match, matchNumbers.get(String(match.id)), "nn")
            ).join("")
            : `<div class="group-message">No NORMAL vs NORMAL pairings are listed for GW9.</div>`;

        if (otherMatches.length) {
            const extra = document.createElement("div");
            extra.className = "match-extra";
            extra.innerHTML = `
                <h3>OTHER MATCHES (${otherMatches.length})</h3>
                <div class="match-extra-grid">
                    ${otherMatches.map(match =>
                        renderMatchCard(match, matchNumbers.get(String(match.id)), "other")
                    ).join("")}
                </div>
            `;
            groupB.appendChild(extra);
        }

        groupB.removeAttribute("aria-busy");
    }

    const summary = document.getElementById("matchupSummary");
    if (summary) {
        summary.textContent = `Quarantine Zone Battles — ${safeVsDanger.length} SAFE vs DANGER • ${normalVsNormal.length} NORMAL vs NORMAL • ${currentMatches.length} Matches`;
    }

    console.log("GW9 classification:", {
        total: currentMatches.length,
        safeVsDanger: safeVsDanger.length,
        normalVsNormal: normalVsNormal.length,
        other: otherMatches.length
    });

    publishDebugState();
}

// ---------------------------------------------------------
// 8. STARTUP
// ---------------------------------------------------------

document.addEventListener("DOMContentLoaded", async () => {
    console.log("THE LAST OF FPL: script.js started.");

    initPlayerSearch();

    await loadPlayersFromSupabase();
    await loadGW8PointsFromSupabase();
    syncGW8PointsNote();

    renderStandings();
    renderSurvivorCards();
    renderInfected();
    syncJourneyLedger();

    await loadGW8Matches();

    document.body.classList.remove("intro-pending");
    document.body.classList.add("intro-complete");

    publishDebugState();

    console.log("THE LAST OF FPL: initialization finished.");
});

// Public functions for existing HTML onclick handlers.
window.switchTab = switchTab;
window.filterStandings = filterStandings;
window.renderMatchups = renderMatchups;
window.loadGW8Matches = loadGW8Matches;
window.syncJourneyLedger = syncJourneyLedger;
window.currentMatches = currentMatches;
window.roster = roster;
