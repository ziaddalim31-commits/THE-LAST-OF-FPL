// قاعدة البيانات المحدثة بالكامل طبقاً لبوستر GW6 الرسمي
const roster = [
    // SAFE (6)
    { id: 1, name: "Saad", state: "SAFE", points: 59, hearts: 3 },
    { id: 2, name: "Yougito", state: "SAFE", points: 61, hearts: 3 },
    { id: 3, name: "Islam", state: "SAFE", points: 56, hearts: 3 },
    { id: 4, name: "Ayman", state: "SAFE", points: 88, hearts: 3 },
    { id: 5, name: "Adnane Elkhamayry", state: "SAFE", points: 68, hearts: 3 },
    { id: 6, name: "Abdennour", state: "SAFE", points: 59, hearts: 3 },

    // NORMAL (12)
    { id: 7, name: "Zakaria", state: "NORMAL", points: 51, hearts: 3 },
    { id: 8, name: "Fatima", state: "NORMAL", points: 70, hearts: 2 }, // 2/3 ❤️
    { id: 9, name: "Ismail Hadrani", state: "NORMAL", points: 48, hearts: 3 },
    { id: 10, name: "Wld Lhaj", state: "NORMAL", points: 69, hearts: 2 }, // 2/3 ❤️
    { id: 11, name: "Ayoub Abouzar", state: "NORMAL", points: 77, hearts: 3 },
    { id: 12, name: "Meryem", state: "NORMAL", points: 81, hearts: 3 },
    { id: 13, name: "Ayoub", state: "NORMAL", points: 68, hearts: 3 },
    { id: 14, name: "Moulchi", state: "NORMAL", points: 82, hearts: 2 }, // 2/3 ❤️
    { id: 15, name: "Anas", state: "NORMAL", points: 62, hearts: 3 },
    { id: 16, name: "Youness Oukhiya", state: "NORMAL", points: 73, hearts: 3 },
    { id: 17, name: "Nezar", state: "NORMAL", points: 74, hearts: 3 },
    { id: 18, name: "Nexus", state: "NORMAL", points: 65, hearts: 3 },

    // DANGER (6)
    { id: 19, name: "Abdellah Moghtanim", state: "DANGER", points: 97, hearts: 3 },
    { id: 20, name: "Ahmed", state: "DANGER", points: 61, hearts: 3 },
    { id: 21, name: "Arbi", state: "DANGER", points: 49, hearts: 3 },
    { id: 22, name: "Abdelghafour", state: "DANGER", points: 50, hearts: 3 },
    { id: 23, name: "Adnane", state: "DANGER", points: 70, hearts: 3 },
    { id: 24, name: "Abdel Chipi", state: "DANGER", points: 54, hearts: 1 } // 1/3 ❤️
];

function switchTab(tabId) {
    document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

    const activePage = document.getElementById(`page-${tabId}`);
    if (activePage) activePage.classList.add('active');

    const targetBtn = Array.from(document.querySelectorAll('.nav-btn')).find(b => b.getAttribute('onclick')?.includes(tabId));
    if (targetBtn) targetBtn.classList.add('active');
}

function renderStandings(filter = 'ALL') {
    const tableBody = document.getElementById('standingsTable');
    if(!tableBody) return;
    tableBody.innerHTML = '';

    const filtered = roster.filter(p => filter === 'ALL' || p.state === filter);

    filtered.forEach((p, idx) => {
        const tr = document.createElement('tr');
        const heartsVisual = '❤️'.repeat(p.hearts) + '🖤'.repeat(3 - p.hearts);
        
        let stateClass = p.state.toLowerCase();

        tr.innerHTML = `
            <td>${idx + 1}</td>
            <td><strong>${p.name}</strong></td>
            <td><span class="badge-mini ${stateClass}">${p.state}</span></td>
            <td><strong>${p.points} PTS</strong></td>
            <td>${heartsVisual} (${p.hearts}/3)</td>
            <td>${getThreatStatus(p.state, p.hearts)}</td>
        `;
        tableBody.appendChild(tr);
    });
}

function getThreatStatus(state, hearts) {
    if (state === 'SAFE') return '🟢 Safe Zone';
    if (state === 'NORMAL') return '🔵 Neutral Zone';
    if (state === 'DANGER' && hearts > 1) return '🟠 Critical Danger';
    return '🔴 Extreme Risk (1 Heart Left)';
}

function filterStandings(type) {
    document.querySelectorAll('.f-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    renderStandings(type);
}

// مواجهات الجولة 7 الرسمية مطابقة للبوستر الثامن
function renderMatchups() {
    const safeVsDanger = [
        { p1: "Saad", s1: "SAFE", p2: "Ahmed", s2: "DANGER" },
        { p1: "Yougito", s1: "SAFE", p2: "Arbi", s2: "DANGER" },
        { p1: "Islam", s1: "SAFE", p2: "Abdelghafour", s2: "DANGER" },
        { p1: "Ayman", s1: "SAFE", p2: "Abdellah Moghtanim", s2: "DANGER" },
        { p1: "Adnane Elkhamayry", s1: "SAFE", p2: "Abdel Chipi", s2: "DANGER" },
        { p1: "Abdennour", s1: "SAFE", p2: "Adnane", s2: "DANGER" }
    ];

    const normalVsNormal = [
        { p1: "Zakaria", s1: "NORMAL", p2: "Wld Lhaj", s2: "NORMAL" },
        { p1: "Fatima", s1: "NORMAL", p2: "Meryem", s2: "NORMAL" },
        { p1: "Ismail Hadrani", s1: "NORMAL", p2: "Ayoub", s2: "NORMAL" },
        { p1: "Ayoub Abouzar", s1: "NORMAL", p2: "Youness Oukhiya", s2: "NORMAL" },
        { p1: "Moulchi", s1: "NORMAL", p2: "Nexus", s2: "NORMAL" },
        { p1: "Anas", s1: "NORMAL", p2: "Nezar", s2: "NORMAL" }
    ];

    populateGroup('groupA-list', safeVsDanger);
    populateGroup('groupB-list', normalVsNormal);
}

function populateGroup(elemId, matches) {
    const container = document.getElementById(elemId);
    if (!container) return;
    container.innerHTML = '';

    matches.forEach(m => {
        container.innerHTML += `
            <div class="match-item">
                <span><strong>${m.p1}</strong> <span class="text-dim">(${m.s1})</span></span>
                <span class="green-text">VS</span>
                <span><strong>${m.p2}</strong> <span class="text-dim">(${m.s2})</span></span>
            </div>
        `;
    });
}

// Admin Panel & Calculator
const ADMIN_PIN = "1234";

function openAdminModal() {
    document.getElementById('adminModal').classList.remove('hidden');
    document.getElementById('adminPinScreen').classList.remove('hidden');
    document.getElementById('adminPanelScreen').classList.add('hidden');
}

function closeAdminModal() {
    document.getElementById('adminModal').classList.add('hidden');
}

function verifyAdminPin() {
    const inputPin = document.getElementById('adminPinInput').value;
    if (inputPin === ADMIN_PIN) {
        document.getElementById('adminPinScreen').classList.add('hidden');
        document.getElementById('adminPanelScreen').classList.remove('hidden');
        populateAdminDropdowns();
    } else {
        alert("Incorrect PIN Code!");
    }
}

function populateAdminDropdowns() {
    const p1 = document.getElementById('p1Select');
    const p2 = document.getElementById('p2Select');
    p1.innerHTML = ''; p2.innerHTML = '';

    roster.forEach(player => {
        p1.innerHTML += `<option value="${player.id}">${player.name} (${player.state})</option>`;
        p2.innerHTML += `<option value="${player.id}">${player.name} (${player.state})</option>`;
    });
}

function executeMatchProcessing() {
    const p1Id = parseInt(document.getElementById('p1Select').value);
    const p2Id = parseInt(document.getElementById('p2Select').value);
    const s1 = parseInt(document.getElementById('p1Score').value);
    const s2 = parseInt(document.getElementById('p2Score').value);

    if (p1Id === p2Id || isNaN(s1) || isNaN(s2)) {
        alert("Please select two different participants and valid scores.");
        return;
    }

    const player1 = roster.find(r => r.id === p1Id);
    const player2 = roster.find(r => r.id === p2Id);

    const winner = s1 > s2 ? player1 : player2;
    const loser = s1 > s2 ? player2 : player1;

    const outBox = document.getElementById('calcOutput');
    outBox.classList.remove('hidden');
    outBox.innerHTML = `
        <strong>🏆 WINNER: ${winner.name}</strong> (${s1 > s2 ? s1 : s2} pts)<br>
        <strong>💀 LOSER: ${loser.name}</strong> (${s1 < s2 ? s1 : s2} pts)
    `;
}

document.addEventListener('DOMContentLoaded', () => {
    renderStandings();
    renderMatchups();
});