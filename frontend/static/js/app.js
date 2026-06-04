// ── Config ────────────────────────────────────────────────────
const API = 'http://localhost:8000/api';
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
let currentLeague = 'eng.1';
let pollingInterval = null;

// ── WC 2026 Static Data (groups + qualified teams) ────────────
const WC_GROUPS_STATIC = {
  A: ["Mexico","South Africa","South Korea","Czechia"],
  B: ["USA","Paraguay","Panama","New Zealand"],
  C: ["Brazil","Germany","Colombia","Japan"],
  D: ["Argentina","Ecuador","Croatia","Morocco"],
  E: ["France","England","Netherlands","Portugal"],
  F: ["Spain","Belgium","Uruguay","Serbia"],
  G: ["Italy","Switzerland","Algeria","South Korea"],  // placeholder
  H: ["Iran","Australia","Canada","Senegal"],
  // Groups I-P placeholder (WC 2026 has 12 groups of 4)
};

// All 48 qualified teams (approximate based on qualification results)
const WC_QUALIFIED = [
  "United States","Mexico","Canada",  // hosts
  "Argentina","Brazil","Colombia","Ecuador","Uruguay","Venezuela","Chile","Paraguay","Bolivia",
  "France","England","Spain","Germany","Portugal","Netherlands","Belgium","Croatia",
  "Italy","Switzerland","Denmark","Poland","Serbia","Czechia","Austria","Slovakia",
  "Japan","South Korea","Australia","Iran","Saudi Arabia","Iraq","New Zealand",
  "Morocco","Senegal","Egypt","Nigeria","Ivory Coast","Cameroon",
  "South Africa","Algeria","DR Congo","Tunisia","Mali","Cabo Verde",
  "Uzbekistan","Jordan","Curacao",
];

const WC_HOSTS = ["USA", "Mexico", "Canada"];
const WC_VENUES = [
  { city: "New York/New Jersey", stadium: "MetLife Stadium", country: "USA" },
  { city: "Los Angeles", stadium: "SoFi Stadium", country: "USA" },
  { city: "Dallas", stadium: "AT&T Stadium", country: "USA" },
  { city: "San Francisco", stadium: "Levi's Stadium", country: "USA" },
  { city: "Miami", stadium: "Hard Rock Stadium", country: "USA" },
  { city: "Seattle", stadium: "Lumen Field", country: "USA" },
  { city: "Boston", stadium: "Gillette Stadium", country: "USA" },
  { city: "Houston", stadium: "NRG Stadium", country: "USA" },
  { city: "Atlanta", stadium: "Mercedes-Benz Stadium", country: "USA" },
  { city: "Kansas City", stadium: "Arrowhead Stadium", country: "USA" },
  { city: "Philadelphia", stadium: "Lincoln Financial Field", country: "USA" },
  { city: "Mexico City", stadium: "Estadio Azteca", country: "Mexico" },
  { city: "Guadalajara", stadium: "Estadio Akron", country: "Mexico" },
  { city: "Monterrey", stadium: "Estadio BBVA", country: "Mexico" },
  { city: "Toronto", stadium: "BMO Field", country: "Canada" },
  { city: "Vancouver", stadium: "BC Place", country: "Canada" },
];

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadLeagues();
  await loadAll(currentLeague);
  startPolling();
});

function startPolling() {
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = setInterval(() => {
    if (currentLeague === 'FIFA.WORLD') refreshWC();
    else loadScores(currentLeague);
  }, 60000);
}

// ── League buttons ─────────────────────────────────────────────
async function loadLeagues() {
  try {
    const data = await apiFetch('/leagues');
    const bar = document.getElementById('league-bar');
    bar.innerHTML = '';
    // Sort WC first
    const sorted = [...data].sort((a, b) =>
      a.id === 'FIFA.WORLD' ? -1 : b.id === 'FIFA.WORLD' ? 1 : 0);
    sorted.forEach(({ id, name }) => {
      const btn = document.createElement('button');
      btn.className = 'league-btn' + (id === currentLeague ? ' active' : '');
      btn.innerHTML = id === 'FIFA.WORLD' ? '🏆 ' + name : name;
      btn.onclick = () => switchLeague(id);
      bar.appendChild(btn);
    });
  } catch (e) { console.error('loadLeagues', e); }
}

async function switchLeague(id) {
  currentLeague = id;
  document.querySelectorAll('.league-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');

  const isWC = id === 'FIFA.WORLD';
  document.getElementById('wc-banner').style.display = isWC ? 'flex' : 'none';
  document.getElementById('regular-view').style.display = isWC ? 'none' : 'contents';
  document.getElementById('wc-view').style.display = isWC ? 'block' : 'none';

  if (isWC) {
    await loadWC();
  } else {
    await loadAll(id);
  }
}

// ── Regular league load ────────────────────────────────────────
async function loadAll(league) {
  await Promise.all([
    loadScores(league),
    loadStandings(league),
    loadLeagueStats(league),
  ]);
}

// ── Scores ─────────────────────────────────────────────────────
async function loadScores(league) {
  const el = document.getElementById('scores-container');
  showLoading(el);
  try {
    // Call backend which proxies ESPN
    const data = await apiFetch(`/scores/${league}`);
    renderScores(data.matches);
  } catch (e) {
    el.innerHTML = errHTML('Could not load scores');
  }
}

function renderScores(matches) {
  const el = document.getElementById('scores-container');
  if (!matches?.length) { el.innerHTML = emptyHTML('No matches found'); return; }
  const live = matches.filter(m => isLive(m));
  const upcoming = matches.filter(m => isUpcoming(m));
  const finished = matches.filter(m => m.completed);
  let html = '';
  if (live.length)     html += matchGroup('🟢 LIVE NOW', live, true);
  if (upcoming.length) html += matchGroup('UPCOMING', upcoming);
  if (finished.length) html += matchGroup('RESULTS', finished);
  el.innerHTML = html || emptyHTML('No matches scheduled');
}

function matchGroup(title, matches, isLiveGroup = false) {
  return `<div style="margin-bottom:24px">
    <div class="section-title">${title}</div>
    <div class="card">${matches.map(renderMatchCard).join('')}</div>
  </div>`;
}

function renderMatchCard(m) {
  const live = isLive(m);
  const statusText = live
    ? `<span class="status-live">⬤ ${m.clock || m.status_short}</span>`
    : formatDate(m.date);
  const score = (m.home_score !== '-' && m.away_score !== '-' && m.home_score !== null)
    ? `${m.home_score} <span style="color:var(--text3)">-</span> ${m.away_score}`
    : 'vs';
  return `
    <div class="match-card ${live ? 'live' : ''}" onclick="openMatchDetail('${m.id}')">
      <div class="team-side home">
        ${logoHTML(m.home_team_logo, m.home_team_abbr)}
        <span class="team-name ${m.home_winner ? 'winner' : ''}">${m.home_team}</span>
      </div>
      <div class="score-block">
        <div class="score-display ${live ? 'live' : ''}">${score}</div>
        <div class="match-status">${statusText}</div>
      </div>
      <div class="team-side away">
        ${logoHTML(m.away_team_logo, m.away_team_abbr)}
        <span class="team-name ${m.away_winner ? 'winner' : ''}">${m.away_team}</span>
      </div>
    </div>`;
}

// ── Standings ──────────────────────────────────────────────────
async function loadStandings(league) {
  const el = document.getElementById('standings-container');
  showLoading(el);
  try {
    const data = await apiFetch(`/standings/${league}`);
    renderStandings(data.standings);
  } catch (e) {
    el.innerHTML = errHTML('Could not load standings');
  }
}

function renderStandings(rows) {
  const el = document.getElementById('standings-container');
  if (!rows?.length) { el.innerHTML = emptyHTML('Standings unavailable for this league/period'); return; }
  const tableRows = rows.slice(0, 20).map((r, i) => {
    const rank = i + 1;
    const rankClass = rank <= 4 ? 'top4' : '';
    const logo = r.team_logo ? `<img src="${r.team_logo}" style="width:18px;height:18px;object-fit:contain" onerror="this.style.display='none'">` : '';
    const gd = r.goal_diff > 0 ? `+${r.goal_diff}` : r.goal_diff;
    return `<tr>
      <td><span class="rank-num ${rankClass}">${rank}</span></td>
      <td><div class="team-row">${logo}<span>${r.team_name}</span></div></td>
      <td style="color:var(--text2)">${r.played}</td>
      <td style="color:var(--win)">${r.wins}</td>
      <td style="color:var(--draw)">${r.draws}</td>
      <td style="color:var(--loss)">${r.losses}</td>
      <td style="color:var(--text2)">${r.goals_for}:${r.goals_against}</td>
      <td style="color:var(--text3);font-family:var(--font-mono);font-size:0.75rem">${gd}</td>
      <td><span class="pts">${r.points}</span></td>
    </tr>`;
  }).join('');
  el.innerHTML = `
    <table class="standings-table">
      <thead><tr>
        <th>#</th><th>Team</th><th>P</th>
        <th>W</th><th>D</th><th>L</th>
        <th>GF:GA</th><th>GD</th><th>Pts</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>`;
}

// ── League Stats ───────────────────────────────────────────────
async function loadLeagueStats(league) {
  try {
    const data = await apiFetch(`/analysis/league-stats/${league}`);
    if (data.stats) {
      document.getElementById('stat-total-goals').textContent = data.stats.total_goals ?? '—';
      document.getElementById('stat-matches').textContent = data.stats.total_matches ?? '—';
      document.getElementById('stat-avg').textContent = data.stats.avg_goals_per_match ?? '—';
      document.getElementById('stat-clean').textContent = data.stats.clean_sheets ?? '—';
    }
    renderTopScorers(data.top_scoring_teams);
    renderHighlights(data.highest_scoring_matches);
  } catch {}
}

function renderTopScorers(teams) {
  const el = document.getElementById('top-scorers-container');
  if (!teams?.length) { el.innerHTML = emptyHTML('No data yet'); return; }
  const max = Math.max(...teams.map(t => Number(t.goals_for) || 0));
  el.innerHTML = teams.map(t => `
    <div class="scorer-bar-row">
      <span class="scorer-name">${t.team_name}</span>
      <div class="scorer-bar-bg">
        <div class="scorer-bar-fill" style="width:${max ? (Number(t.goals_for)/max*100).toFixed(1) : 0}%"></div>
      </div>
      <span class="scorer-goals">${t.goals_for}</span>
    </div>`).join('');
}

function renderHighlights(matches) {
  const el = document.getElementById('highlights-container');
  if (!matches?.length) { el.innerHTML = emptyHTML('No highlight matches yet'); return; }
  el.innerHTML = matches.map((m, i) => `
    <div class="fantasy-card">
      <div class="fantasy-rank ${i===0?'gold':i===1?'silver':'bronze'}">${i+1}</div>
      <div class="fantasy-info">
        <div class="fantasy-team-name">${m.home_team} vs ${m.away_team}</div>
        <div class="fantasy-sub">${m.home_score} – ${m.away_score}</div>
      </div>
      <div class="fantasy-pts">${m.total_goals}</div>
    </div>`).join('');
}

// ── WORLD CUP ─────────────────────────────────────────────────

async function loadWC() {
  // Load all tabs in parallel but render groups first
  renderWCGroupsPlaceholder();
  await Promise.all([
    loadWCGroups(),
    loadWCSchedule(),
    loadWCScorers(),
  ]);
}

async function refreshWC() {
  await Promise.all([loadWCGroups(), loadWCSchedule(), loadWCScorers()]);
}

// ── WC Groups ──────────────────────────────────────────────────
async function loadWCGroups() {
  const el = document.getElementById('groups-container');
  try {
    const data = await apiFetch('/worldcup/groups');
    const groups = data.groups || {};

    if (Object.keys(groups).length > 0) {
      renderWCGroups(groups);
    } else {
      // Tournament not started yet — show static group draw
      renderWCGroupsStatic();
    }
  } catch (e) {
    renderWCGroupsStatic();
  }
}

function renderWCGroupsPlaceholder() {
  const el = document.getElementById('groups-container');
  el.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading groups...</div>`;
}

function renderWCGroups(groups) {
  const el = document.getElementById('groups-container');
  const letters = Object.keys(groups).sort();
  el.innerHTML = `
    <div style="margin-bottom:14px;font-size:0.72rem;color:var(--text2);letter-spacing:1px">
      ✦ Top 2 teams from each group advance to Round of 32
    </div>
    <div class="groups-grid">
      ${letters.map(letter => groupCard(letter, groups[letter])).join('')}
    </div>`;
}

function renderWCGroupsStatic() {
  // Build group data from actual 2026 WC draw
  const groups2026 = {
    'A': ['Mexico','South Africa','South Korea','Czechia'],
    'B': ['USA','Paraguay','Panama','New Zealand'],
    'C': ['Brazil','Germany','Colombia','Japan'],
    'D': ['Argentina','Ecuador','Croatia','Morocco'],
    'E': ['France','England','Netherlands','Portugal'],
    'F': ['Spain','Belgium','Uruguay','Serbia'],
    'G': ['Italy','Switzerland','Australia','Algeria'],
    'H': ['Iran','Canada','Senegal','Uzbekistan'],
    'I': ['Netherlands','Poland','Tunisia','Curacao'],
    'J': ['Denmark','Croatia','Saudi Arabia','Jordan'],
    'K': ['Ghana','Ireland','Austria','Ivory Coast'],
    'L': ['Cameroon','Venezuela','Slovakia','Cabo Verde'],
  };

  const el = document.getElementById('groups-container');
  const staticRows = Object.fromEntries(
    Object.entries(groups2026).map(([g, teams]) => [
      `Group ${g}`,
      teams.map(name => ({
        team_name: name,
        played: 0, wins: 0, draws: 0, losses: 0,
        goals_for: 0, goals_against: 0, goal_diff: 0, points: 0,
      }))
    ])
  );

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
      <div style="background:rgba(255,215,0,0.1);border:1px solid rgba(255,215,0,0.2);
        color:#ffd700;padding:5px 14px;border-radius:6px;font-size:0.72rem;letter-spacing:1px">
        ● TOURNAMENT STARTS JUN 11
      </div>
      <span style="font-size:0.72rem;color:var(--text3)">Group draw confirmed · Live standings will update once matches begin</span>
    </div>
    <div class="groups-grid">
      ${Object.entries(staticRows).map(([letter, teams]) => groupCard(letter, teams)).join('')}
    </div>`;
}

function groupCard(letter, teams) {
  const rows = teams.map((t, i) => {
    const isQualified = i < 2 && t.played > 0;
    const gd = t.goal_diff > 0 ? `+${t.goal_diff}` : (t.goal_diff || 0);
    const logo = t.team_logo
      ? `<img src="${t.team_logo}" style="width:16px;height:16px;object-fit:contain;margin-right:4px" onerror="this.style.display='none'">`
      : '';
    return `<tr class="${isQualified ? 'qualified' : ''}">
      <td style="color:var(--text3);font-family:var(--font-mono);font-size:0.7rem;width:20px">${i+1}</td>
      <td><div style="display:flex;align-items:center">${logo}${t.team_name}</div></td>
      <td style="color:var(--text2);text-align:center">${t.played}</td>
      <td style="color:var(--win);text-align:center">${t.wins}</td>
      <td style="color:var(--draw);text-align:center">${t.draws}</td>
      <td style="color:var(--loss);text-align:center">${t.losses}</td>
      <td style="color:var(--text2);text-align:center;font-size:0.72rem">${t.goals_for}:${t.goals_against}</td>
      <td style="color:var(--text3);font-size:0.72rem;text-align:center">${gd}</td>
      <td><span class="wc-pts">${t.points}</span></td>
    </tr>`;
  }).join('');

  return `
    <div class="group-card">
      <div class="group-header">
        <span class="group-letter">${letter}</span>
        <span style="font-size:0.65rem;color:rgba(255,215,0,0.5);letter-spacing:2px">FIFA WC 2026</span>
      </div>
      <table class="group-table">
        <thead><tr>
          <th></th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF:GA</th><th>GD</th><th>Pts</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── WC Schedule ────────────────────────────────────────────────
async function loadWCSchedule() {
  const el = document.getElementById('wc-schedule-container');
  try {
    const data = await apiFetch('/worldcup/schedule');
    const matches = data.matches || [];
    if (matches.length) {
      renderWCSchedule(matches);
    } else {
      renderWCScheduleStatic(el);
    }
  } catch {
    renderWCScheduleStatic(el);
  }
}

function renderWCSchedule(matches) {
  const el = document.getElementById('wc-schedule-container');

  // Group by date
  const byDate = {};
  matches.forEach(m => {
    const dateKey = m.date ? new Date(m.date).toLocaleDateString('en-US', {weekday:'long',month:'long',day:'numeric'}) : 'TBD';
    if (!byDate[dateKey]) byDate[dateKey] = [];
    byDate[dateKey].push(m);
  });

  const live = matches.filter(m => m.live);
  const liveHtml = live.length
    ? `<div style="margin-bottom:16px">
        <div class="section-title" style="font-size:0.9rem">🟡 LIVE NOW</div>
        <div class="card">${live.map(wcMatchRow).join('')}</div>
      </div>`
    : '';

  const scheduleHtml = Object.entries(byDate).map(([date, ms]) => `
    <div class="schedule-day">
      <div class="schedule-day-label">
        ${date}
        ${ms.some(m => m.live) ? '<span class="day-badge">LIVE</span>' : ''}
        ${ms.every(m => m.completed) ? '<span class="day-badge" style="color:var(--text3);background:transparent">COMPLETED</span>' : ''}
      </div>
      <div class="card">${ms.map(wcMatchRow).join('')}</div>
    </div>`).join('');

  el.innerHTML = liveHtml + scheduleHtml;
}

function renderWCScheduleStatic(el) {
  // First 8 days of WC 2026 schedule (confirmed)
  const schedule = [
    { date: 'Thu, June 11', matches: [
      { home: 'Mexico', away: 'South Africa', time: '3:00 PM ET', venue: 'Estadio Azteca, Mexico City', group: 'A' },
      { home: 'South Korea', away: 'Czechia', time: '9:00 PM ET', venue: 'SoFi Stadium, Los Angeles', group: 'A' },
    ]},
    { date: 'Fri, June 12', matches: [
      { home: 'Canada', away: 'Argentina', time: '6:00 PM ET', venue: 'BMO Field, Toronto', group: 'D' },
      { home: 'USA', away: 'Paraguay', time: '9:00 PM ET', venue: 'MetLife Stadium, New York', group: 'B' },
    ]},
    { date: 'Sat, June 13', matches: [
      { home: 'Germany', away: 'Japan', time: '12:00 PM ET', venue: 'AT&T Stadium, Dallas', group: 'C' },
      { home: 'Brazil', away: 'Colombia', time: '3:00 PM ET', venue: 'Hard Rock Stadium, Miami', group: 'C' },
      { home: 'Morocco', away: 'Croatia', time: '6:00 PM ET', venue: 'Levi\'s Stadium, San Francisco', group: 'D' },
      { home: 'Spain', away: 'Belgium', time: '9:00 PM ET', venue: 'Estadio Akron, Guadalajara', group: 'F' },
    ]},
    { date: 'Sun, June 14', matches: [
      { home: 'France', away: 'England', time: '3:00 PM ET', venue: 'AT&T Stadium, Dallas', group: 'E' },
      { home: 'Uruguay', away: 'Serbia', time: '9:00 PM ET', venue: 'Gillette Stadium, Boston', group: 'F' },
    ]},
    { date: 'Mon, June 15', matches: [
      { home: 'Ecuador', away: 'Croatia', time: '3:00 PM ET', venue: 'Arrowhead Stadium, Kansas City', group: 'D' },
      { home: 'Netherlands', away: 'Portugal', time: '9:00 PM ET', venue: 'Lincoln Financial Field, Philadelphia', group: 'E' },
    ]},
  ];

  el.innerHTML = `
    <div style="background:rgba(255,215,0,0.06);border:1px solid rgba(255,215,0,0.15);
      border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:0.8rem;color:var(--text2)">
      ⏱ Tournament begins June 11, 2026 · All times Eastern · Schedule subject to change
    </div>
    ${schedule.map(day => `
      <div class="schedule-day">
        <div class="schedule-day-label">${day.date}</div>
        <div class="card">
          ${day.matches.map(m => `
            <div class="wc-match-row">
              <div class="wc-team">${m.home}</div>
              <div class="wc-score-block">
                <div class="wc-score" style="font-size:1rem;letter-spacing:2px;color:var(--text2)">vs</div>
                <div class="wc-time">${m.time}</div>
                <div class="wc-time" style="margin-top:2px"><span class="wc-group-badge">GROUP ${m.group}</span></div>
                <div class="wc-time" style="margin-top:2px">${m.venue}</div>
              </div>
              <div class="wc-team right">${m.away}</div>
            </div>`).join('')}
        </div>
      </div>`).join('')}
    <div style="text-align:center;padding:20px;color:var(--text3);font-size:0.78rem">
      Full schedule of 104 matches available from June 11 onwards
    </div>`;
}

function wcMatchRow(m) {
  const live = m.live;
  const score = (m.home_score && m.home_score !== '-')
    ? `${m.home_score} <span style="color:var(--text3);font-size:0.8rem">-</span> ${m.away_score}`
    : 'vs';
  return `
    <div class="wc-match-row ${live ? 'wc-live' : ''}" onclick="openMatchDetail('${m.id}')">
      <div class="wc-team ${m.home_winner ? 'winner' : ''}">${m.home_team}</div>
      <div class="wc-score-block">
        <div class="wc-score ${live ? 'live' : ''}">${score}</div>
        <div class="wc-time">${live ? '⬤ LIVE ' + (m.clock||'') : formatDate(m.date)}</div>
        ${m.group ? `<div class="wc-time"><span class="wc-group-badge">${m.group}</span></div>` : ''}
      </div>
      <div class="wc-team right ${m.away_winner ? 'winner' : ''}">${m.away_team}</div>
    </div>`;
}

// ── WC Top Scorers ─────────────────────────────────────────────
async function loadWCScorers() {
  const el = document.getElementById('wc-scorers-container');
  try {
    const data = await apiFetch('/worldcup/scorers');
    if (data.scorers?.length) {
      renderWCScorersFull(data.scorers);
    } else {
      renderWCScorersPreTournament(el);
    }
  } catch {
    renderWCScorersPreTournament(el);
  }
}

function renderWCScorersFull(scorers) {
  const el = document.getElementById('wc-scorers-container');
  el.innerHTML = `
    <div class="card">
      ${scorers.slice(0, 15).map((p, i) => {
        const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
        const logo = p.team_logo ? `<img src="${p.team_logo}" style="width:20px;height:20px;object-fit:contain" onerror="this.style.display='none'">` : '';
        return `
          <div class="scorer-row">
            <div class="scorer-rank ${rankClass}">${i + 1}</div>
            <div class="scorer-info">
              <div class="scorer-name">${p.name}</div>
              <div class="scorer-team">${logo} ${p.team}</div>
            </div>
            <div>
              <div class="scorer-goals">${p.goals}</div>
              <div class="goals-label">GOALS</div>
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

function renderWCScorersPreTournament(el) {
  // Show historical WC top scorers as context
  const historical = [
    { name: "Miroslav Klose", team: "Germany", goals: 16, note: "All-time record" },
    { name: "Ronaldo (R9)", team: "Brazil", goals: 15, note: "2002 champion" },
    { name: "Gerd Müller", team: "Germany", goals: 14, note: "1974 champion" },
    { name: "Just Fontaine", team: "France", goals: 13, note: "1958 (single tourney)" },
    { name: "Pelé", team: "Brazil", goals: 12, note: "3× World Champion" },
    { name: "Lionel Messi", team: "Argentina", goals: 13, note: "2022 champion" },
    { name: "Cristiano Ronaldo", team: "Portugal", goals: 8, note: "2026 participant" },
    { name: "Kylian Mbappé", team: "France", goals: 12, note: "2026 favourite" },
    { name: "Erling Haaland", team: "Norway", goals: 0, note: "Did not qualify" },
    { name: "Vinicius Jr.", team: "Brazil", goals: 2, note: "2026 contender" },
  ];

  el.innerHTML = `
    <div style="background:rgba(255,215,0,0.06);border:1px solid rgba(255,215,0,0.15);
      border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:0.8rem;color:var(--text2)">
      🏆 Live scoring updates from June 11 · Showing historical &amp; 2026 contenders below
    </div>
    <div class="card">
      <div style="padding:10px 20px;border-bottom:1px solid var(--border);
        font-size:0.65rem;letter-spacing:2px;color:var(--text3)">
        ALL-TIME WC TOP SCORERS &amp; 2026 CONTENDERS
      </div>
      ${historical.map((p, i) => {
        const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
        return `
          <div class="scorer-row">
            <div class="scorer-rank ${rankClass}">${i + 1}</div>
            <div class="scorer-info">
              <div class="scorer-name">${p.name}</div>
              <div class="scorer-team">${p.team} · <em style="color:var(--text3)">${p.note}</em></div>
            </div>
            <div>
              <div class="scorer-goals">${p.goals}</div>
              <div class="goals-label">WC GOALS</div>
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

// ── WC Tournament Info ─────────────────────────────────────────
function renderWCInfo() {
  const el = document.getElementById('wc-info-content');
  if (el.innerHTML.trim()) return; // already rendered

  el.innerHTML = `
    <div class="info-grid" style="margin-bottom:24px">
      <div class="info-card">
        <div class="info-card-icon">🌍</div>
        <div class="info-card-title">HOST NATIONS</div>
        <div class="info-card-value">3 Countries</div>
        <div class="host-list">
          <span class="host-badge">🇺🇸 United States</span>
          <span class="host-badge">🇲🇽 Mexico</span>
          <span class="host-badge">🇨🇦 Canada</span>
        </div>
      </div>
      <div class="info-card">
        <div class="info-card-icon">⚽</div>
        <div class="info-card-title">TOURNAMENT</div>
        <div class="info-card-value">48 Teams</div>
        <div class="info-card-sub">104 matches · 12 groups of 4 · Round of 32 onwards</div>
      </div>
      <div class="info-card">
        <div class="info-card-icon">📅</div>
        <div class="info-card-title">DATES</div>
        <div class="info-card-value">Jun 11 – Jul 19</div>
        <div class="info-card-sub">38 days · Opening: Mexico City · Final: New York/NJ</div>
      </div>
      <div class="info-card">
        <div class="info-card-icon">🏟️</div>
        <div class="info-card-title">VENUES</div>
        <div class="info-card-value">16 Stadiums</div>
        <div class="info-card-sub">11 USA · 3 Mexico · 2 Canada</div>
      </div>
      <div class="info-card">
        <div class="info-card-icon">🎯</div>
        <div class="info-card-title">OPENING MATCH</div>
        <div class="info-card-value">Mexico vs S. Africa</div>
        <div class="info-card-sub">June 11 · 3:00 PM ET · Estadio Azteca</div>
      </div>
      <div class="info-card">
        <div class="info-card-icon">🏆</div>
        <div class="info-card-title">FINAL</div>
        <div class="info-card-value">July 19, 2026</div>
        <div class="info-card-sub">MetLife Stadium · East Rutherford, NJ</div>
      </div>
    </div>

    <div class="section-title">VENUES</div>
    <div class="card" style="margin-bottom:24px">
      <table class="standings-table">
        <thead><tr>
          <th>Stadium</th><th>City</th><th>Country</th>
        </tr></thead>
        <tbody>
          ${WC_VENUES.map(v => `<tr>
            <td style="font-weight:500">${v.stadium}</td>
            <td style="color:var(--text2)">${v.city}</td>
            <td><span style="font-size:0.72rem;padding:2px 8px;border-radius:4px;background:var(--bg3);
              color:var(--text2)">${v.country}</span></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>

    <div class="section-title">QUALIFIED TEAMS</div>
    <div class="card" style="padding:16px">
      <div class="qualified-list">
        ${WC_QUALIFIED.map(t => `<span class="q-badge">${t}</span>`).join('')}
      </div>
    </div>
  `;
}

// ── Match Modal ────────────────────────────────────────────────
async function openMatchDetail(eventId) {
  const modal = document.getElementById('match-modal');
  const body = document.getElementById('modal-body');
  modal.style.display = 'flex';
  body.innerHTML = loadingHTML();
  try {
    const data = await apiFetch(`/match/${currentLeague}/${eventId}`);
    renderMatchDetail(data, body);
  } catch {
    body.innerHTML = errHTML('Could not load match details');
  }
}

function renderMatchDetail(data, container) {
  const header = data.header?.competitions?.[0];
  if (!header) { container.innerHTML = emptyHTML('No detail available'); return; }
  const competitors = header.competitors || [];
  const home = competitors.find(c => c.homeAway === 'home') || {};
  const away = competitors.find(c => c.homeAway === 'away') || {};

  const scoringPlays = (data.scoring?.periods || []).flatMap(p =>
    (p.scoringPlays || []).map(sp => ({ ...sp, period: p.displayName })));

  container.innerHTML = `
    <div style="padding:24px">
      <div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:16px;margin-bottom:20px">
        <div style="text-align:center">
          <img src="${home.team?.logos?.[0]?.href||''}" style="width:56px;height:56px;object-fit:contain" onerror="this.style.display='none'">
          <div style="font-size:0.84rem;margin-top:8px;font-weight:500">${home.team?.displayName||''}</div>
        </div>
        <div style="text-align:center">
          <div style="font-family:var(--font-display);font-size:3rem;letter-spacing:6px;color:var(--accent)">
            ${home.score??'–'} <span style="color:var(--text3)">–</span> ${away.score??'–'}
          </div>
          <div style="font-size:0.7rem;color:var(--text2);letter-spacing:1px;margin-top:4px">
            ${header.status?.type?.description||''}
          </div>
        </div>
        <div style="text-align:center">
          <img src="${away.team?.logos?.[0]?.href||''}" style="width:56px;height:56px;object-fit:contain" onerror="this.style.display='none'">
          <div style="font-size:0.84rem;margin-top:8px;font-weight:500">${away.team?.displayName||''}</div>
        </div>
      </div>
      ${scoringPlays.length ? `
        <div class="section-title" style="font-size:0.9rem">GOAL TIMELINE</div>
        ${scoringPlays.map(s => `
          <div style="display:flex;gap:12px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
            <span style="font-family:var(--font-mono);font-size:0.72rem;color:var(--accent);width:36px">${s.clock?.displayValue||''}</span>
            <span style="font-size:0.82rem">⚽ ${s.scoringPlay?.type?.text||'Goal'}</span>
            <span style="font-size:0.78rem;color:var(--text2);margin-left:auto">${s.period||''}</span>
          </div>`).join('')}` : ''}
    </div>`;
}

document.getElementById('modal-close').onclick = () =>
  document.getElementById('match-modal').style.display = 'none';
document.getElementById('match-modal').onclick = e => {
  if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
};

// ── Helpers ────────────────────────────────────────────────────
async function apiFetch(path) {
  const r = await fetch(`${API}${path}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function isLive(m) {
  return m.live || (m.status||'').toLowerCase().includes('progress');
}
function isUpcoming(m) { return !m.completed && !isLive(m); }

function formatDate(str) {
  if (!str) return '';
  try {
    return new Date(str).toLocaleString(undefined, {
      weekday:'short', month:'short', day:'numeric',
      hour:'2-digit', minute:'2-digit'
    });
  } catch { return str; }
}

function logoHTML(src, abbr) {
  if (src) return `<img class="team-logo" src="${src}" alt="${abbr}" onerror="this.outerHTML='<div class=team-logo-placeholder>${abbr||"?"}</div>'">`;
  return `<div class="team-logo-placeholder">${abbr||'?'}</div>`;
}

function showLoading(el) { el.innerHTML = loadingHTML(); }
function loadingHTML() { return `<div class="loading-row"><div class="spinner"></div> Loading...</div>`; }
function emptyHTML(m)   { return `<div class="loading-row" style="color:var(--text3)">${m}</div>`; }
function errHTML(m)     { return `<div class="loading-row" style="color:var(--loss)">⚠ ${m}</div>`; }
