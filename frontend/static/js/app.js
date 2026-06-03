// ── Config ──────────────────────────────────────────────────
const API = 'http://localhost:8000/api';
let currentLeague = 'eng.1';
let scoreChart = null;
let pollingInterval = null;

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadLeagues();
  await loadAll(currentLeague);
  startLivePolling();
});

// ── Polling ───────────────────────────────────────────────────
function startLivePolling() {
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = setInterval(() => loadScores(currentLeague), 60000);
}

// ── League buttons ────────────────────────────────────────────
async function loadLeagues() {
  try {
    const data = await apiFetch('/leagues');
    const bar = document.getElementById('league-bar');
    bar.innerHTML = '';
    data.forEach(({ id, name }) => {
      const btn = document.createElement('button');
      btn.className = 'league-btn' + (id === currentLeague ? ' active' : '');
      btn.textContent = name;
      btn.onclick = () => switchLeague(id);
      bar.appendChild(btn);
    });
  } catch (e) {
    console.error('Failed to load leagues', e);
  }
}

async function switchLeague(leagueId) {
  currentLeague = leagueId;
  document.querySelectorAll('.league-btn').forEach(b => {
    b.classList.toggle('active', b.textContent === leagueIdToName(leagueId));
  });
  await loadAll(leagueId);
}

function leagueIdToName(id) {
  const map = {
    'eng.1': 'Premier League', 'esp.1': 'La Liga',
    'ger.1': 'Bundesliga', 'ita.1': 'Serie A',
    'fra.1': 'Ligue 1', 'uefa.champions': 'Champions League',
  };
  return map[id] || id;
}

// ── Load all sections ─────────────────────────────────────────
async function loadAll(league) {
  await Promise.all([
    loadScores(league),
    loadStandings(league),
    loadLeagueStats(league),
  ]);
}

// ── Scores ────────────────────────────────────────────────────
async function loadScores(league) {
  const container = document.getElementById('scores-container');
  showLoading(container);
  try {
    const data = await apiFetch(`/scores/${league}`);
    renderScores(data.matches);
  } catch (e) {
    container.innerHTML = errorHTML('Could not load scores');
  }
}

function renderScores(matches) {
  const container = document.getElementById('scores-container');
  if (!matches || matches.length === 0) {
    container.innerHTML = emptyHTML('No matches found for this league today');
    return;
  }

  // Group by status
  const live = matches.filter(m => isLive(m));
  const upcoming = matches.filter(m => isUpcoming(m));
  const finished = matches.filter(m => m.completed);

  let html = '';
  if (live.length) html += matchGroup('LIVE NOW', live, true);
  if (upcoming.length) html += matchGroup('UPCOMING', upcoming);
  if (finished.length) html += matchGroup('RESULTS', finished);
  if (!html) html = emptyHTML('No matches scheduled');

  container.innerHTML = html;
}

function matchGroup(title, matches, isLiveGroup = false) {
  return `
    <div style="margin-bottom:24px">
      <div class="section-title">${isLiveGroup ? '🟢 ' : ''}${title}</div>
      <div class="card">
        ${matches.map(renderMatchCard).join('')}
      </div>
    </div>`;
}

function renderMatchCard(m) {
  const live = isLive(m);
  const statusText = live
    ? `<span class="status-live">⬤ ${m.clock || m.status_short}</span>`
    : formatMatchDate(m.date);

  const score = (m.home_score !== '-' && m.away_score !== '-')
    ? `${m.home_score} <span style="color:var(--text3)">-</span> ${m.away_score}`
    : 'vs';

  return `
    <div class="match-card ${live ? 'live' : ''}" onclick="openMatchDetail('${m.id}')">
      <div class="team-side home">
        ${teamLogo(m.home_team_logo, m.home_team_abbr)}
        <span class="team-name ${m.home_winner ? 'winner' : ''}">${m.home_team}</span>
      </div>
      <div class="score-block">
        <div class="score-display ${live ? 'live' : ''}">${score}</div>
        <div class="match-status">${statusText}</div>
      </div>
      <div class="team-side away">
        ${teamLogo(m.away_team_logo, m.away_team_abbr)}
        <span class="team-name ${m.away_winner ? 'winner' : ''}">${m.away_team}</span>
      </div>
    </div>`;
}

function teamLogo(src, abbr) {
  if (src) return `<img class="team-logo" src="${src}" alt="${abbr}" onerror="this.style.display='none'">`;
  return `<div class="team-logo-placeholder">${abbr || '?'}</div>`;
}

// ── Standings ─────────────────────────────────────────────────
async function loadStandings(league) {
  const container = document.getElementById('standings-container');
  showLoading(container);
  try {
    const data = await apiFetch(`/standings/${league}`);
    renderStandings(data.standings);
  } catch (e) {
    container.innerHTML = errorHTML('Could not load standings');
  }
}

function renderStandings(rows) {
  const container = document.getElementById('standings-container');
  if (!rows || !rows.length) {
    container.innerHTML = emptyHTML('No standings available');
    return;
  }

  const tableRows = rows.slice(0, 20).map((r, i) => {
    const rank = i + 1;
    const rankClass = rank <= 3 ? 'top3' : '';
    const logo = r.team_logo
      ? `<img src="${r.team_logo}" style="width:18px;height:18px;object-fit:contain" onerror="this.style.display='none'">`
      : '';
    return `
      <tr>
        <td><span class="rank-num ${rankClass}">${rank}</span></td>
        <td>
          <div class="team-row">
            ${logo}
            <span>${r.team_name}</span>
          </div>
        </td>
        <td style="color:var(--text2)">${r.played}</td>
        <td style="color:var(--win)">${r.wins}</td>
        <td style="color:var(--draw)">${r.draws}</td>
        <td style="color:var(--loss)">${r.losses}</td>
        <td style="color:var(--text2)">${r.goals_for}:${r.goals_against}</td>
        <td><span class="pts">${r.points}</span></td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <table class="standings-table">
      <thead>
        <tr>
          <th>#</th><th>Team</th><th>P</th>
          <th>W</th><th>D</th><th>L</th>
          <th>GF:GA</th><th>Pts</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>`;
}

// ── League Stats & Analysis ────────────────────────────────────
async function loadLeagueStats(league) {
  try {
    const data = await apiFetch(`/analysis/league-stats/${league}`);
    renderStatTiles(data.stats);
    renderTopScorers(data.top_scoring_teams);
    renderHighlightMatches(data.highest_scoring_matches);
  } catch (e) {
    console.warn('Stats unavailable:', e.message);
  }
}

function renderStatTiles(stats) {
  if (!stats || !Object.keys(stats).length) return;
  document.getElementById('stat-total-goals').textContent = stats.total_goals ?? '-';
  document.getElementById('stat-matches').textContent = stats.total_matches ?? '-';
  document.getElementById('stat-avg').textContent = stats.avg_goals_per_match ?? '-';
  document.getElementById('stat-clean').textContent = stats.clean_sheets ?? '-';
}

function renderTopScorers(teams) {
  const container = document.getElementById('top-scorers-container');
  if (!teams || !teams.length) {
    container.innerHTML = emptyHTML('No data available');
    return;
  }
  const max = Math.max(...teams.map(t => t.goals_for));
  container.innerHTML = teams.map(t => `
    <div class="scorer-bar-row">
      <span class="scorer-name">${t.team_name}</span>
      <div class="scorer-bar-bg">
        <div class="scorer-bar-fill" style="width:${(t.goals_for / max * 100).toFixed(1)}%"></div>
      </div>
      <span class="scorer-goals">${t.goals_for}</span>
    </div>`).join('');
}

function renderHighlightMatches(matches) {
  const container = document.getElementById('highlights-container');
  if (!matches || !matches.length) {
    container.innerHTML = emptyHTML('No highlight matches');
    return;
  }
  container.innerHTML = matches.map((m, i) => `
    <div class="fantasy-card">
      <div class="fantasy-rank ${i === 0 ? 'gold' : i === 1 ? 'silver' : 'bronze'}">${i + 1}</div>
      <div class="fantasy-info">
        <div class="fantasy-team-name">${m.home_team} vs ${m.away_team}</div>
        <div class="fantasy-sub">${m.home_score} – ${m.away_score} goals</div>
      </div>
      <div class="fantasy-pts">${m.total_goals}</div>
    </div>`).join('');
}

// ── Match Detail Modal ─────────────────────────────────────────
async function openMatchDetail(eventId) {
  const modal = document.getElementById('match-modal');
  const body = document.getElementById('modal-body');
  modal.style.display = 'flex';
  body.innerHTML = loadingHTML();

  try {
    const data = await apiFetch(`/match/${currentLeague}/${eventId}`);
    renderMatchDetail(data, body);
  } catch (e) {
    body.innerHTML = errorHTML('Could not load match details');
  }
}

function renderMatchDetail(data, container) {
  const header = data.header?.competitions?.[0];
  if (!header) { container.innerHTML = emptyHTML('No detail available'); return; }

  const competitors = header.competitors || [];
  const home = competitors.find(c => c.homeAway === 'home') || {};
  const away = competitors.find(c => c.homeAway === 'away') || {};

  const scoringPlays = (data.scoring?.periods || []).flatMap(p =>
    (p.scoringPlays || []).map(sp => ({ ...sp, period: p.displayName }))
  );

  const homeGoals = scoringPlays.filter(s => s.team?.id === home.id);
  const awayGoals = scoringPlays.filter(s => s.team?.id === away.id);

  container.innerHTML = `
    <div style="text-align:center;padding:24px 0 16px">
      <div style="display:flex;justify-content:center;align-items:center;gap:24px">
        <div style="text-align:center">
          <img src="${home.team?.logos?.[0]?.href || ''}" style="width:60px;height:60px;object-fit:contain" onerror="this.style.display='none'">
          <div style="font-size:0.85rem;margin-top:8px;font-weight:500">${home.team?.displayName || ''}</div>
        </div>
        <div>
          <div style="font-family:var(--font-display);font-size:3rem;letter-spacing:6px;color:var(--accent)">
            ${home.score ?? '-'} <span style="color:var(--text3)">–</span> ${away.score ?? '-'}
          </div>
          <div style="font-size:0.7rem;color:var(--text2);letter-spacing:1px;text-align:center;margin-top:4px">
            ${header.status?.type?.description || ''}
          </div>
        </div>
        <div style="text-align:center">
          <img src="${away.team?.logos?.[0]?.href || ''}" style="width:60px;height:60px;object-fit:contain" onerror="this.style.display='none'">
          <div style="font-size:0.85rem;margin-top:8px;font-weight:500">${away.team?.displayName || ''}</div>
        </div>
      </div>
    </div>

    ${scoringPlays.length ? `
      <div style="padding:0 16px 16px">
        <div class="section-title" style="font-size:0.9rem">GOAL TIMELINE</div>
        ${scoringPlays.map(s => `
          <div style="display:flex;gap:12px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
            <span style="font-family:var(--font-mono);font-size:0.72rem;color:var(--accent);width:36px">${s.clock?.displayValue || ''}</span>
            <span style="font-size:0.82rem">⚽ ${s.scoringPlay?.type?.text || 'Goal'}</span>
            <span style="font-size:0.78rem;color:var(--text2);margin-left:auto">${s.period || ''}</span>
          </div>`).join('')}
      </div>` : ''}
  `;
}

document.getElementById('modal-close').onclick = () => {
  document.getElementById('match-modal').style.display = 'none';
};

document.getElementById('match-modal').onclick = (e) => {
  if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
};

// ── Helpers ───────────────────────────────────────────────────
async function apiFetch(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function isLive(m) {
  const s = (m.status || '').toLowerCase();
  return s.includes('progress') || s.includes('half') || s.includes('live');
}

function isUpcoming(m) {
  return !m.completed && !isLive(m);
}

function formatMatchDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return dateStr; }
}

function showLoading(el) {
  el.innerHTML = loadingHTML();
}

function loadingHTML() {
  return `<div class="loading-row"><div class="spinner"></div> Loading...</div>`;
}

function emptyHTML(msg) {
  return `<div class="loading-row" style="color:var(--text3)">${msg}</div>`;
}

function errorHTML(msg) {
  return `<div class="loading-row" style="color:var(--loss)">⚠ ${msg}</div>`;
}
