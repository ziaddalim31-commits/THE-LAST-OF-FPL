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
    document.querySelectorAll('.nav-btn').forEach(b => {
        b.classList.remove('active');
        b.removeAttribute('aria-current');
    });

    const activePage = document.getElementById(`page-${tabId}`);
    if (activePage) activePage.classList.add('active');

    const targetBtn = Array.from(document.querySelectorAll('.nav-btn')).find(b => b.getAttribute('onclick')?.includes(tabId));
    if (targetBtn) {
        targetBtn.classList.add('active');
        targetBtn.setAttribute('aria-current', 'page');
    }
}

function renderStandings(filter = 'ALL') {
    const tableBody = document.getElementById('standingsTable');
    if(!tableBody) return;
    tableBody.innerHTML = '';

    const filtered = roster.filter(p => filter === 'ALL' || p.state === filter);

    filtered.forEach((p, idx) => {
        const tr = document.createElement('tr');
        const heartsVisual = [0, 1, 2].map(i => `
            <span class="heart ${i < p.hearts ? 'is-full' : 'is-empty'}" aria-hidden="true">${i < p.hearts ? '♥' : '♡'}</span>
        `).join('');
        
        let stateClass = p.state.toLowerCase();

        tr.innerHTML = `
            <td class="cell-rank">${idx + 1}</td>
            <td class="cell-player"><strong>${p.name}</strong></td>
            <td class="cell-state"><span class="badge-mini ${stateClass}">${p.state}</span></td>
            <td class="cell-points"><strong>${p.points}</strong> <span class="unit">PTS</span></td>
            <td class="cell-hearts"><span class="hearts" role="img" aria-label="${p.hearts} of 3 hearts remaining">${heartsVisual}</span> <span class="heart-count">(${p.hearts}/3)</span></td>
            <td class="cell-threat"><span class="threat-box ${stateClass}">${getThreatStatus(p.state, p.hearts)}</span></td>
        `;
        tableBody.appendChild(tr);
    });

    renderSurvivorCards(filtered, filter);
}

function renderSurvivorCards(players, filter) {
    const grid = document.getElementById('survivorCards');
    if (!grid) return;

    grid.innerHTML = '';

    players.forEach((p, idx) => {
        const stateClass = p.state.toLowerCase();
        const initials = p.name.split(/\s+/).map(part => part.charAt(0)).slice(0, 2).join('').toUpperCase();
        const hearts = [0, 1, 2].map(i => `
            <span class="heart ${i < p.hearts ? 'is-full' : 'is-empty'}" aria-hidden="true">${i < p.hearts ? '♥' : '♡'}</span>
        `).join('');

        const card = document.createElement('article');
        card.className = `survivor-card ${stateClass}`;
        card.innerHTML = `
            <div class="survivor-top">
                <span class="survivor-rank">#${String(idx + 1).padStart(2, '0')}</span>
                <span class="survivor-state">${p.state}</span>
            </div>
            <div class="survivor-identity">
                <span class="survivor-avatar" aria-hidden="true">${initials}</span>
                <div class="survivor-id">
                    <h4 class="survivor-name">${p.name}</h4>
                    <span class="survivor-points"><strong>${p.points}</strong> PTS</span>
                </div>
            </div>
            <div class="survivor-vitals">
                <span class="survivor-hearts" role="img" aria-label="${p.hearts} of 3 hearts remaining">${hearts}</span>
                <span class="survivor-heart-count">${p.hearts}/3</span>
            </div>
            <div class="survivor-threat">${getThreatStatus(p.state, p.hearts)}</div>
        `;
        grid.appendChild(card);
    });

    const count = document.getElementById('survivorDossierCount');
    if (count) {
        count.textContent = filter === 'ALL'
            ? `${players.length} SURVIVORS DISPLAYED`
            : `${players.length} OF ${roster.length} ${filter} SURVIVORS`;
    }
}

function getThreatStatus(state, hearts) {
    let label = 'Extreme Risk (1 Heart Left)';
    if (state === 'SAFE') label = 'Safe Zone';
    else if (state === 'NORMAL') label = 'Neutral Zone';
    else if (state === 'DANGER' && hearts > 1) label = 'Critical Danger';
    return `<span class="threat-dot" aria-hidden="true"></span>${label}`;
}

function filterStandings(type, btn) {
    const targetBtn = btn || document.querySelector(`.f-btn[onclick*="${type}"]`);
    document.querySelectorAll('.f-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
    });
    if (targetBtn) {
        targetBtn.classList.add('active');
        targetBtn.setAttribute('aria-pressed', 'true');
    }
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

    const initialsOf = name => name.split(/\s+/).map(part => part.charAt(0)).slice(0, 2).join('').toUpperCase();
    const rankOf = name => {
        const idx = roster.findIndex(p => p.name === name);
        return idx === -1 ? '—' : String(idx + 1).padStart(2, '0');
    };

    matches.forEach(m => {
        container.innerHTML += `
            <div class="match-item">
                <div class="match-side">
                    <span class="match-avatar" aria-hidden="true">${initialsOf(m.p1)}</span>
                    <div class="match-id">
                        <strong>${m.p1}</strong>
                        <span class="match-meta">
                            <span class="match-rank">#${rankOf(m.p1)}</span>
                            <span class="match-state ${m.s1.toLowerCase()}">${m.s1}</span>
                        </span>
                    </div>
                </div>
                <div class="match-center" aria-hidden="true">
                    <span class="match-line"></span>
                    <span class="vs-mark">VS</span>
                    <span class="match-line"></span>
                </div>
                <div class="match-side match-side--right">
                    <div class="match-id">
                        <strong>${m.p2}</strong>
                        <span class="match-meta">
                            <span class="match-state ${m.s2.toLowerCase()}">${m.s2}</span>
                            <span class="match-rank">#${rankOf(m.p2)}</span>
                        </span>
                    </div>
                    <span class="match-avatar" aria-hidden="true">${initialsOf(m.p2)}</span>
                </div>
            </div>
        `;
    });
}

function syncJourneyLedger() {
    const counts = { completed: 0, active: 0, locked: 0 };
    document.querySelectorAll('.chapter-row').forEach(row => {
        if (row.classList.contains('completed')) counts.completed += 1;
        else if (row.classList.contains('active-now')) counts.active += 1;
        else if (row.classList.contains('locked')) counts.locked += 1;
    });

    const setCount = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(value).padStart(2, '0');
    };

    setCount('journeyCompleted', counts.completed);
    setCount('journeyActive', counts.active);
    setCount('journeyLocked', counts.locked);
}




document.addEventListener('DOMContentLoaded', () => {
    renderStandings();
    renderMatchups();
    syncJourneyLedger();
});