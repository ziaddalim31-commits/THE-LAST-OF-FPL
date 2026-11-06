
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
