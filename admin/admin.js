
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

function renderGameweekPreview(preview) {
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
      renderGameweekPreview(result.preview);
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


// GW11 fixture generation is deliberately read-only.
const generateGw11Button = document.getElementById("generate-gw11-button");
const gw11FixturePanel = document.getElementById("gw11-fixture-preview");

function renderGw11FixturePreview(result) {
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
    <h3>GW11 — FIXTURE PREVIEW</h3>
    <p>Roster source: ${escapeHTML(result.roster_source)} · Previous opponents checked through GW${result.history_checked_through}</p>
    <p>Active players: ${preview.active_players} · Matches: ${preview.matches_count} · Repeated matchups: ${preview.rematches}</p>
    <p>SAFE: ${preview.status_counts.SAFE} · NORMAL: ${preview.status_counts.NORMAL} · DANGER: ${preview.status_counts.DANGER} · INFECTED: ${preview.infected_count}</p>
    ${preview.infected_count ? `<p><strong>INFECTED SURVIVORS:</strong> ${preview.infected_players.map(player => escapeHTML(player.name)).join(", ")}</p>` : ""}
    ${bye}
    <h4>Pairing priority breakdown</h4>
    <div class="table-scroll"><table><thead><tr><th>Priority</th><th>Matches</th></tr></thead><tbody>${priorityRows || "<tr><td colspan='2'>No matches</td></tr>"}</tbody></table></div>
    <h4>Proposed fixtures</h4>
    <div class="table-scroll"><table><thead><tr><th>#</th><th>Player A</th><th></th><th>Player B</th><th>Rule</th></tr></thead><tbody>${fixtureRows}</tbody></table></div>
    <p><strong>PREVIEW ONLY — no fixtures or tournament records were saved.</strong></p>
  `;
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
    gw11FixturePanel.textContent = "Simulating GW10 updates in memory when needed, then generating a rematch-free GW11 schedule...";
    try {
      const response = await fetch("/api/admin/fixtures-preview", {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        const details = result.bye_candidates
          ? " BYE candidates: " + result.bye_candidates.map(player => player.name + " (" + player.status + ")").join(", ")
          : "";
        throw new Error((result.detail || result.error || "FIXTURE_PREVIEW_FAILED") + details);
      }
      renderGw11FixturePreview(result);
      showMessage("GW11 FIXTURE PREVIEW GENERATED — DATABASE UNCHANGED.", true);
    } catch (error) {
      gw11FixturePanel.textContent = `GENERATION BLOCKED: ${error.message}. No database changes were made.`;
      showMessage("Could not generate a safe GW11 fixture preview.");
    } finally {
      generateGw11Button.disabled = false;
      generateGw11Button.textContent = "GENERATE GW11 FIXTURE PREVIEW";
    }
  });
}
