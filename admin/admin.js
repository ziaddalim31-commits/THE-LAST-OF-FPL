
"use strict";

const SUPABASE_URL = "https://xpaouenjkfdynjkhbsrb.supabase.co";
const SUPABASE_KEY = "sb_publishable_VhZK3TH1dyphsH8HzoWGmQ_kF4VLQie";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

const loginPanel = document.getElementById("login-panel");
const dashboard = document.getElementById("dashboard");
const loginForm = document.getElementById("login-form");
const loginButton = document.getElementById("login-button");
const logoutButton = document.getElementById("logout-button");
const message = document.getElementById("message");
const adminEmail = document.getElementById("admin-email");

const adminData = document.getElementById("admin-data");

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

async function loadAdminData(accessToken) {
  adminData.innerHTML = "<p>LOADING TOURNAMENT DATA...</p>";

  try {
    const response = await fetch("/api/admin", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "DATA_LOAD_FAILED");
    }

    adminData.innerHTML = `
      <h2>TOURNAMENT DATABASE</h2>
      <p>PLAYERS: ${result.players.length}</p>
      <p>GAMEWEEK: GW${result.gameweek.gw_number}</p>
      <p>MATCHES: ${result.matches.length}</p>
      <p>BYES: ${result.byes.length}</p>
    `;
    renderMatchManagement(result);
  } catch (error) {
    console.error("Admin data error:", error);
    adminData.innerHTML =
      "<p>COULD NOT LOAD TOURNAMENT DATA. CHECK API CONNECTION.</p>";
  }
}
function showMessage(text, success = false) {
  message.textContent = text;
  message.style.color = success ? "#a9d995" : "#d66d63";
}

function showDashboard(user) {
  loginPanel.hidden = true;
  dashboard.hidden = false;
  adminEmail.textContent = user.email || "Authorized administrator";
}

function showLogin() {
  dashboard.hidden = true;
  loginPanel.hidden = false;
}

async function verifyAdmin() {
  const { data: sessionData, error: sessionError } =
    await supabaseClient.auth.getSession();

  if (sessionError || !sessionData.session) {
    showLogin();
    return false;
  }

  const { data, error } = await supabaseClient.rpc("is_site_admin");

  if (error || data !== true) {
    await supabaseClient.auth.signOut();
    showLogin();
    showMessage("ACCESS DENIED — This account is not authorized.");
    return false;
  }
showDashboard(sessionData.session.user);

await loadAdminData(sessionData.session.access_token);

return true;
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  loginButton.disabled = true;
  loginButton.textContent = "AUTHENTICATING...";
  showMessage("");

  try {
    const { error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      showMessage("LOGIN FAILED — Check your email and password.");
      return;
    }

    const authorized = await verifyAdmin();

    if (authorized) {
      showMessage("");
    }
  } catch (error) {
    console.error("Admin login error:", error);
    showMessage("A connection error occurred. Please try again.");
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = "AUTHENTICATE";
  }
});

logoutButton.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  showLogin();
  loginForm.reset();
  showMessage("You have been logged out.", true);
});

verifyAdmin().catch((error) => {
  console.error("Admin verification error:", error);
  showLogin();
  showMessage("Could not verify administrator access.");
});


const previewButton = document.getElementById("preview-gameweek-button");
const previewPanel = document.getElementById("gameweek-preview");

let lastPreviewToken = null;

function renderGameweekPreview(preview, previewToken) {
  lastPreviewToken = previewToken || null;
  const rows = preview.results.map((result) => {
    const winnerIsA = String(result.winner_id) === String(result.player_a_id);
    const winnerPoints = winnerIsA ? result.points_a : result.points_b;
    const loserPoints = winnerIsA ? result.points_b : result.points_a;
    const tieValues = result.tiebreak && result.tiebreak.values;
    const decision = tieValues
      ? `${result.winner_method} (Winner: ${tieValues[String(result.winner_id)]} · Opponent: ${tieValues[String(winnerIsA ? result.player_b_id : result.player_a_id)]})`
      : result.winner_method;
    return `
      <tr>
        <td>${escapeHTML(result.winner.name)}</td>
        <td>${winnerPoints} – ${loserPoints}</td>
        <td>${escapeHTML(result.loser.name)}</td>
        <td>${escapeHTML(decision)}</td>
      </tr>
    `;
  }).join("");

  const updates = preview.player_updates.map((player) => {
    const before = player.before || {};
    const beforeInfection = before.is_infected ? "INFECTED" : "CLEAR";
    const afterInfection = player.is_infected ? "INFECTED" : "CLEAR";
    const beforeState = before.is_active ? "ACTIVE" : "ELIMINATED";
    const afterState = player.is_active ? "ACTIVE" : "ELIMINATED";
    return `
      <tr>
        <td>${escapeHTML(player.player_name || player.player_id)} (#${escapeHTML(player.player_id)})</td>
        <td>${escapeHTML(before.status)} → ${escapeHTML(player.status)}</td>
        <td>${before.hearts}/3 → ${player.hearts}/3</td>
        <td>${beforeInfection} → ${afterInfection}</td>
        <td>${beforeState} → ${afterState}</td>
      </tr>
    `;
  }).join("");

  const byeText = preview.byes.length
    ? preview.byes.map(bye => escapeHTML(bye.name || bye.player_id)).join(", ")
    : "No bye";

  previewPanel.innerHTML = `
    <h3>GW${preview.gameweek.gw_number} — RESULTS PREVIEW</h3>
    <p>FPL: ${escapeHTML(preview.fpl.status)} · Updated: ${escapeHTML(preview.fpl.updated_at || "—")}</p>
    <p>Matches: ${preview.summary.matches} · Active players: ${preview.summary.active_players} · Eliminations: ${preview.summary.eliminations} · Infection transfers: ${preview.summary.infection_transfers}</p>
    <p>BYE: ${byeText}</p>
    <h4>Fixture results</h4>
    <div class="table-scroll"><table><thead><tr><th>Winner</th><th>Winner – opponent points</th><th>Opponent</th><th>Decision</th></tr></thead><tbody>${rows}</tbody></table></div>
    <h4>Survivor changes</h4>
    <div class="table-scroll"><table><thead><tr><th>Player</th><th>Status (before → after)</th><th>Hearts (before → after)</th><th>Infection (before → after)</th><th>State (before → after)</th></tr></thead><tbody>${updates}</tbody></table></div>
    <p><strong>PREVIEW ONLY — no tournament data has been changed.</strong></p>
    <button id="confirm-results-button" type="button" ${lastPreviewToken ? "" : "disabled"}>CONFIRM AND SAVE RESULTS</button>
  `;
}

if (previewButton) {
  previewButton.addEventListener("click", async () => {
    const { data: sessionData } = await supabaseClient.auth.getSession();
    const accessToken = sessionData && sessionData.session && sessionData.session.access_token;
    if (!accessToken) {
      showMessage("SESSION EXPIRED — Please authenticate again.");
      showLogin();
      return;
    }

    previewButton.disabled = true;
    previewButton.textContent = "FETCHING FPL & CALCULATING...";
    previewPanel.textContent = "Checking final FPL data and validating fixtures...";
    try {
      const response = await fetch("/api/admin/preview", {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        const detail = result.detail;
        const readableDetail = typeof detail === "string"
          ? detail
          : detail && typeof detail === "object"
            ? JSON.stringify(detail)
            : "";
        throw new Error(readableDetail || result.error || "PREVIEW_FAILED");
      }
      renderGameweekPreview(result.preview, result.preview_token);
      setupConfirmResultsButton();
      showMessage("PREVIEW GENERATED — DATABASE UNCHANGED.", true);
    } catch (error) {
      previewPanel.textContent = `PREVIEW BLOCKED: ${error.message}. No database changes were made.`;
      showMessage("Could not generate a safe results preview.");
    } finally {
      previewButton.disabled = false;
      previewButton.textContent = "GENERATE RESULTS PREVIEW";
    }
  });
}


// Next-gameweek fixture generation is deliberately read-only.
const generateGw11Button = document.getElementById("generate-gw11-button");
const gw11FixturePanel = document.getElementById("gw11-fixture-preview");

let lastGw11FixturePreview = null;

function renderGw11FixturePreview(result) {
  lastGw11FixturePreview = result;
  const preview = result.preview;
  const priorityRows = Object.entries(preview.priority_counts)
    .filter(([, count]) => count > 0)
    .map(([priority, count]) => `<tr><td>${escapeHTML(priority)}</td><td>${count}</td></tr>`)
    .join("");

  const fixtureRows = preview.matches.map((match, index) => `
    <tr>
      <td>${index + 1}</td>
      <td><strong>${escapeHTML(match.player_a_name)}</strong><small>${escapeHTML(match.player_a_status)} · ${match.player_a_hearts}/3 hearts${match.player_a_is_infected ? " · 🦠 INFECTED" : ""}</small></td>
      <td>VS</td>
      <td><strong>${escapeHTML(match.player_b_name)}</strong><small>${escapeHTML(match.player_b_status)} · ${match.player_b_hearts}/3 hearts${match.player_b_is_infected ? " · 🦠 INFECTED" : ""}</small></td>
      <td>${escapeHTML(match.priority)}</td>
    </tr>
  `).join("");

  const bye = preview.bye
    ? `<p><strong>BYE:</strong> ${escapeHTML(preview.bye.name)} · ${escapeHTML(preview.bye.status)} · ${preview.bye.hearts}/3 hearts</p>`
    : "<p><strong>BYE:</strong> None — even number of active players.</p>";

  gw11FixturePanel.innerHTML = `
    <h3>GW${escapeHTML(result.gameweek.gw_number)} — FIXTURE PREVIEW</h3>
    <p>Roster source: ${escapeHTML(result.roster_source)} · Previous opponents checked through GW${result.history_checked_through} · Verified chapter opponent history through GW${result.history_integrity_checked_through} (${result.opponent_history_integrity.rounds_checked} rounds)</p>
    <p>Active players: ${preview.active_players} · Matches: ${preview.matches_count} · Repeated matchups: ${preview.rematches}</p>
    <p>SAFE: ${preview.status_counts.SAFE} · NORMAL: ${preview.status_counts.NORMAL} · DANGER: ${preview.status_counts.DANGER} · INFECTED: ${preview.infected_count}</p>
    ${preview.infected_count ? `<p><strong>INFECTED SURVIVORS:</strong> ${preview.infected_players.map(player => escapeHTML(player.name)).join(", ")}</p>` : ""}
    ${bye}
    <h4>Pairing priority breakdown</h4>
    <div class="table-scroll"><table><thead><tr><th>Priority</th><th>Matches</th></tr></thead><tbody>${priorityRows || "<tr><td colspan='2'>No matches</td></tr>"}</tbody></table></div>
    <h4>Proposed fixtures</h4>
    <div class="table-scroll"><table><thead><tr><th>#</th><th>Player A</th><th></th><th>Player B</th><th>Rule</th></tr></thead><tbody>${fixtureRows}</tbody></table></div>
    <p><strong>PREVIEW ONLY — no fixtures or tournament records were saved.</strong></p>
    <button id="save-gw11-fixtures-button" type="button">SAVE APPROVED GW${escapeHTML(result.gameweek.gw_number)} FIXTURES</button>
  `;
}

async function requestNextGameweekFixturePreview(accessToken, byePlayerId = null) {
  const endpoint = byePlayerId
    ? `/api/admin/fixtures-preview?bye_player_id=${encodeURIComponent(byePlayerId)}`
    : "/api/admin/fixtures-preview";
  const response = await fetch(endpoint, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const result = await response.json();

  if (!response.ok || !result.success) {
    if (result.error === "BYE_PLAYER_SELECTION_REQUIRED" && Array.isArray(result.bye_candidates)) {
      renderByePlayerSelection(result.bye_candidates, accessToken);
      return;
    }
    throw new Error(result.detail || result.error || "FIXTURE_PREVIEW_FAILED");
  }

  renderGw11FixturePreview(result);
  setupSaveGw11FixturesButton();
  showMessage(`GW${result.gameweek.gw_number} FIXTURE PREVIEW GENERATED — DATABASE UNCHANGED.`, true);
}

function renderByePlayerSelection(candidates, accessToken) {
  const options = candidates.map(player =>
    `<option value="${escapeHTML(player.id)}">${escapeHTML(player.name)} — ${escapeHTML(player.status)} — ${escapeHTML(player.hearts)}/3 hearts</option>`
  ).join("");

  gw11FixturePanel.innerHTML = `
    <h3>BYE PLAYER SELECTION REQUIRED</h3>
    <p>The active roster is odd. Select the survivor who will receive the BYE this gameweek.</p>
    <label for="next-bye-player">SELECT BYE PLAYER</label>
    <select id="next-bye-player">${options}</select>
    <button id="generate-with-bye-button" type="button">CONFIRM BYE & GENERATE FIXTURES</button>
  `;

  const button = document.getElementById("generate-with-bye-button");
  button.addEventListener("click", async () => {
    const select = document.getElementById("next-bye-player");
    if (!select || !select.value) return;
    button.disabled = true;
    button.textContent = "GENERATING FIXTURES...";
    try {
      await requestNextGameweekFixturePreview(accessToken, select.value);
    } catch (error) {
      gw11FixturePanel.textContent = `GENERATION BLOCKED: ${error.message}. No database changes were made.`;
      showMessage("Could not generate a safe next-gameweek fixture preview.");
    }
  });
}

if (generateGw11Button) {
  generateGw11Button.addEventListener("click", async () => {
    const { data: sessionData } = await supabaseClient.auth.getSession();
    const accessToken = sessionData && sessionData.session && sessionData.session.access_token;
    if (!accessToken) {
      showMessage("SESSION EXPIRED — Please authenticate again.");
      showLogin();
      return;
    }

    generateGw11Button.disabled = true;
    generateGw11Button.textContent = "CHECKING ROSTER & MATCH HISTORY...";
    gw11FixturePanel.textContent = "Checking the previous gameweek, simulating results in memory when necessary, then generating a rematch-free schedule...";
    try {
      await requestNextGameweekFixturePreview(accessToken);
    } catch (error) {
      gw11FixturePanel.textContent = `GENERATION BLOCKED: ${error.message}. No database changes were made.`;
      showMessage("Could not generate a safe next-gameweek fixture preview.");
    } finally {
      generateGw11Button.disabled = false;
      generateGw11Button.textContent = "GENERATE NEXT GAMEWEEK FIXTURE PREVIEW";
    }
  });
}

// Match Management: persisted fixtures are read-only here; FPL is the score source.
function renderMatchManagement(data) {
  const panel = document.getElementById("match-management-content");
  if (!panel) return;

  if (!data.matches || data.matches.length === 0) {
    panel.innerHTML = "<p>No fixtures are saved for the current gameweek yet. Generate and review the next-gameweek preview above.</p>";
    return;
  }

  const rows = data.matches.map((match, index) => {
    const a = match.player_a || {};
    const b = match.player_b || {};
    const status = String(match.status || "PENDING").toUpperCase();
    const score = match.points_a === null || match.points_a === undefined
      ? "—"
      : `${match.points_a} – ${match.points_b}`;
    const winner = match.winner
      ? escapeHTML(match.winner.name)
      : (match.winner_id ? escapeHTML(match.winner_id) : "Pending");
    return `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHTML(a.name || match.player_a_id)}</td>
        <td>${score}</td>
        <td>${escapeHTML(b.name || match.player_b_id)}</td>
        <td>${winner}</td>
        <td>${escapeHTML(status)}</td>
      </tr>
    `;
  }).join("");

  const byes = (data.byes || []).map(bye =>
    escapeHTML(bye.player && bye.player.name || bye.player_id)
  ).join(", ") || "None";

  panel.innerHTML = `
    <p><strong>GW${escapeHTML(data.gameweek.gw_number)} · ${data.matches.length} FIXTURES · BYE: ${byes}</strong></p>
    <div class="table-scroll"><table><thead><tr><th>#</th><th>Player A</th><th>Score</th><th>Player B</th><th>Winner</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="workflow-note">Scores are populated from the official FPL feed during Results Preview. This screen does not permit manual score changes.</p>
  `;
}

async function setupConfirmResultsButton() {
  const button = document.getElementById("confirm-results-button");
  if (!button) return;

  button.addEventListener("click", async () => {
    if (!lastPreviewToken) {
      showMessage("GENERATE A FRESH RESULTS PREVIEW FIRST.");
      return;
    }
    if (!window.confirm("Confirm this exact results preview and save all match results, player changes and history? This action cannot be repeated.")) {
      return;
    }

    const { data: sessionData } = await supabaseClient.auth.getSession();
    const accessToken = sessionData && sessionData.session && sessionData.session.access_token;
    if (!accessToken) {
      showMessage("SESSION EXPIRED — Please authenticate again.");
      showLogin();
      return;
    }

    button.disabled = true;
    button.textContent = "CONFIRMING RESULTS...";
    try {
      const response = await fetch("/api/admin/confirm-results", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ preview_token: lastPreviewToken })
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.detail || result.error || "CONFIRMATION_FAILED");
      }

      lastPreviewToken = null;
      previewPanel.innerHTML = `
        <h3>GW${escapeHTML(result.gameweek.gw_number)} — RESULTS CONFIRMED</h3>
        <p>${escapeHTML(result.confirmation.matches_completed)} matches completed · ${escapeHTML(result.confirmation.players_updated)} survivors updated · ${escapeHTML(result.confirmation.history_rows_created)} history records created.</p>
      `;
      showMessage("RESULTS CONFIRMED AND SAVED.", true);
      await loadAdminData(accessToken).catch(error => {
        showMessage(`RESULTS ARE SAVED, BUT THE DASHBOARD REFRESH FAILED: ${error.message}`);
      });
    } catch (error) {
      button.disabled = false;
      button.textContent = "CONFIRM AND SAVE RESULTS";
      showMessage(`RESULTS NOT CONFIRMED: ${error.message}`);
    }
  });
}

async function setupSaveGw11FixturesButton() {
  const button = document.getElementById("save-gw11-fixtures-button");
  if (!button || !lastGw11FixturePreview) return;

  let saveInProgress = false;

  button.addEventListener("click", async () => {
    if (saveInProgress || !lastGw11FixturePreview) return;

    const approvedPreview = lastGw11FixturePreview;
    const targetGameweek = approvedPreview.gameweek.gw_number;
    const preview = approvedPreview.preview;

    if (!window.confirm(`Save these exact GW${targetGameweek} fixtures and the displayed bye to Supabase?`)) return;

    saveInProgress = true;
    button.disabled = true;
    button.textContent = "SAVING APPROVED FIXTURES...";

    const controller = new AbortController();
    let requestStarted = false;
    let saved = false;
    let saveOutcomeUnknown = false;
    const timeoutId = window.setTimeout(() => controller.abort(), 30000);

    try {
      const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
      if (sessionError) throw new Error(`SESSION_CHECK_FAILED: ${sessionError.message}`);

      const accessToken = sessionData && sessionData.session && sessionData.session.access_token;
      if (!accessToken) {
        showLogin();
        throw new Error("SESSION_EXPIRED — Please authenticate again.");
      }

      requestStarted = true;
      const response = await fetch("/api/admin/fixtures-save", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fixtures: preview.matches,
          bye_player_id: preview.bye ? preview.bye.player_id : null
        }),
        signal: controller.signal
      });

      const result = await response.json().catch(() => null);
      if (!result) {
        saveOutcomeUnknown = response.ok;
        throw new Error(response.ok ? "SAVE_RESPONSE_UNREADABLE" : `HTTP_${response.status}`);
      }

      if (!response.ok || !result.success) {
        const detail = result.detail || result.error || "FIXTURE_SAVE_FAILED";

        if (result.error === "PREVIOUS_GAMEWEEK_MUST_BE_CONFIRMED") {
          lastGw11FixturePreview = null;
          button.textContent = "REGENERATE AFTER PREVIOUS RESULTS";
          const note = document.createElement("p");
          note.textContent = `${detail} The old preview is no longer valid; confirm the previous gameweek, then generate a fresh fixture preview.`;
          gw11FixturePanel.appendChild(note);
        }

        throw new Error(detail);
      }

      if (Number(result.gameweek && result.gameweek.gw_number) !== Number(targetGameweek)) {
        saveOutcomeUnknown = true;
        throw new Error("SERVER_GAMEWEEK_MISMATCH — verify saved fixtures before taking another action.");
      }

      saved = true;
      lastGw11FixturePreview = null;
      gw11FixturePanel.innerHTML = `
        <h3>GW${escapeHTML(targetGameweek)} — FIXTURES SAVED</h3>
        <p>${escapeHTML(result.saved && result.saved.matches_created)} fixtures saved successfully.</p>
        <p>Bye: ${preview.bye ? escapeHTML(preview.bye.name) : "None"}</p>
      `;
      showMessage(`GW${targetGameweek} FIXTURES SAVED.`, true);
      await loadAdminData(accessToken).catch(error => {
        showMessage(`GW${targetGameweek} FIXTURES ARE SAVED, BUT THE DASHBOARD REFRESH FAILED: ${error.message}`);
      });
    } catch (error) {
      const uncertain = requestStarted && (
        saveOutcomeUnknown ||
        error.name === "AbortError" ||
        error instanceof TypeError
      );

      if (uncertain) {
        saveOutcomeUnknown = true;
        button.disabled = true;
        button.textContent = "SAVE STATUS UNKNOWN — REFRESH TO VERIFY";
        showMessage("SAVE RESULT UNKNOWN — the request may have reached the server. Refresh the admin page and check the target gameweek's fixtures before retrying.");
      } else {
        button.disabled = false;
        if (lastGw11FixturePreview) {
          button.textContent = `SAVE APPROVED GW${targetGameweek} FIXTURES`;
        }
        showMessage(`FIXTURES NOT SAVED: ${error.message}`);
      }
    } finally {
      window.clearTimeout(timeoutId);
      saveInProgress = false;
      if (!saved && !saveOutcomeUnknown && lastGw11FixturePreview) {
        button.disabled = false;
      }
    }
  });
}

async function loadRoundHistory() {
  const panel = document.getElementById("round-history-content");
  const button = document.getElementById("load-history-button");
  const { data: sessionData } = await supabaseClient.auth.getSession();
  const accessToken = sessionData && sessionData.session && sessionData.session.access_token;
  if (!accessToken) {
    showMessage("SESSION EXPIRED — Please authenticate again.");
    showLogin();
    return;
  }

  button.disabled = true;
  button.textContent = "LOADING HISTORY...";
  panel.textContent = "Loading completed gameweeks...";
  try {
    const response = await fetch("/api/admin/history", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || "HISTORY_LOAD_FAILED");
    }
    renderRoundHistory(result);
  } catch (error) {
    panel.textContent = `HISTORY UNAVAILABLE: ${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = "LOAD ROUND HISTORY";
  }
}

function renderRoundHistory(data) {
  const panel = document.getElementById("round-history-content");
  if (!data.gameweeks || data.gameweeks.length === 0) {
    panel.innerHTML = "<p>No completed gameweeks with history records yet.</p>";
    return;
  }

  panel.innerHTML = `
    <p><strong>${data.totals.completed_gameweeks} completed gameweeks · ${data.totals.completed_matches} matches · ${data.totals.history_rows} survivor history records</strong></p>
    ${data.totals.gameweeks_missing_matches || data.totals.gameweeks_missing_survivor_history || data.totals.gameweeks_opponent_history_failed || data.totals.gameweeks_snapshot_integrity_failed
      ? `<p class="workflow-warning">DATA INTEGRITY WARNING: ${data.totals.gameweeks_missing_matches || 0} completed gameweeks have no match rows; ${data.totals.gameweeks_missing_survivor_history || 0} have no survivor snapshots; ${data.totals.gameweeks_opponent_history_failed || 0} fail the chapter opponent-history audit; ${data.totals.gameweeks_snapshot_integrity_failed || 0} have incomplete snapshot coverage. Snapshot gaps are diagnostic only and do not block rematch checks.</p>`
      : ""}
    ${data.gameweeks.map(gameweek => {
      const matchRows = gameweek.matches.length
        ? gameweek.matches.map(match => `
        <tr>
          <td>${escapeHTML(match.player_a && match.player_a.name || match.player_a_id)}</td>
          <td>${match.points_a ?? "—"} – ${match.points_b ?? "—"}</td>
          <td>${escapeHTML(match.player_b && match.player_b.name || match.player_b_id)}</td>
          <td>${escapeHTML(match.winner && match.winner.name || "—")}</td>
        </tr>
      `).join("")
        : `<tr><td colspan="4">No match results are stored for this gameweek.</td></tr>`;
      const byeNames = (gameweek.byes || []).map(bye => escapeHTML(bye.player && bye.player.name || bye.player_id)).join(", ") || "None";
      const historyRows = gameweek.player_history.length
        ? gameweek.player_history.map(row => `
        <tr>
          <td>${escapeHTML(row.player && row.player.name || row.player_id)}</td>
          <td>${escapeHTML(row.status_before)} → ${escapeHTML(row.status_after)}</td>
          <td>${row.hearts_before}/3 → ${row.hearts_after}/3</td>
          <td>${row.infected_before ? "INFECTED" : "CLEAR"} → ${row.infected_after ? "INFECTED" : "CLEAR"}</td>
          <td>${row.active_before ? "ACTIVE" : "OUT"} → ${row.active_after ? "ACTIVE" : "ELIMINATED"}</td>
        </tr>
      `).join("")
        : `<tr><td colspan="5">No survivor snapshots are stored for this gameweek.</td></tr>`;

      return `
        <article class="history-round">
          <h3>GW${escapeHTML(gameweek.gw_number)} — ${escapeHTML(gameweek.chapter)}</h3>
          <p class="workflow-note">BYE: ${byeNames}</p>
          ${gameweek.data_quality && !gameweek.data_quality.opponent_history_ok
            ? `<p class="workflow-warning">OPPONENT HISTORY AUDIT FAILED: ${escapeHTML(gameweek.data_quality.opponent_history_error && gameweek.data_quality.opponent_history_error.code || "UNKNOWN")}.</p>`
            : `<p class="workflow-note">CHAPTER OPPONENT HISTORY: ${gameweek.data_quality && gameweek.data_quality.opponent_history_ok ? "VERIFIED" : "NOT VERIFIED"}</p>`}
          ${gameweek.data_quality && !gameweek.data_quality.snapshot_integrity_ok
            ? `<p class="workflow-warning">SURVIVOR SNAPSHOTS: ${escapeHTML(gameweek.data_quality.snapshot_integrity_error && gameweek.data_quality.snapshot_integrity_error.code || "INCOMPLETE")} — diagnostic only; not used to determine previous opponents.</p>`
            : `<p class="workflow-note">SURVIVOR SNAPSHOTS: ${gameweek.data_quality && gameweek.data_quality.snapshot_integrity_ok ? "COMPLETE" : "NOT VERIFIED"}</p>`}
          <h4>Match Results</h4>
          <div class="table-scroll"><table><thead><tr><th>Player A</th><th>Score</th><th>Player B</th><th>Winner</th></tr></thead><tbody>${matchRows}</tbody></table></div>
          <h4>Survivor Changes</h4>
          <div class="table-scroll"><table><thead><tr><th>Player</th><th>Status</th><th>Hearts</th><th>Infection</th><th>State</th></tr></thead><tbody>${historyRows}</tbody></table></div>
        </article>
      `;
    }).join("")}
  `;
}

const refreshMatchesButton = document.getElementById("refresh-matches-button");
if (refreshMatchesButton) {
  refreshMatchesButton.addEventListener("click", async () => {
    const { data: sessionData } = await supabaseClient.auth.getSession();
    const accessToken = sessionData && sessionData.session && sessionData.session.access_token;
    if (!accessToken) {
      showMessage("SESSION EXPIRED — Please authenticate again.");
      showLogin();
      return;
    }
    await loadAdminData(accessToken);
  });
}

const loadHistoryButton = document.getElementById("load-history-button");
if (loadHistoryButton) loadHistoryButton.addEventListener("click", loadRoundHistory);
