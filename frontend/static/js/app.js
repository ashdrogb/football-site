/**
 * app.js — Main application logic.
 * All ESPN data fetching is done via espn.js (browser-side).
 * Analysis is done via backend POST endpoints.
 */

const LEAGUES = {
  'FIFA.WORLD':     '🏆 World Cup 2026',
  'eng.1':          'Premier League',
  'esp.1':          'La Liga',
  'ger.1':          'Bundesliga',
  'ita.1':          'Serie A',
  'fra.1':          'Ligue 1',
  'uefa.champions': 'Champions League',
};

let currentLeague = 'eng.1';
let pollingTimer   = null;

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  buildLeagueBar();
  loadLeague(currentLeague);
  pollingTimer = setInterval(() => loadLeague(currentLeague, true), 90000);
});

// ── League bar ────────────────────────────────────────────────
function buildLeagueBar() {
  const bar = document.getElementById('league-bar');
  bar.innerHTML = Object.entries(LEAGUES).map(([id, name]) => `
    <button class="league-btn ${id === currentLeague ? 'active' : ''}"
      onclick="selectLeague('${id}', this)">${name}</button>
  `).join('');
}

function selectLeague(id, btn) {
  currentLeague = id;
  document.querySelectorAll('.league-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  clearError();

  const isWC = id === 'FIFA.WORLD';
  document.getElementById('wc-banner').style.display    = isWC ? 'flex'    : 'none';
  document.getElementById('regular-view').style.display = isWC ? 'none'    : 'contents';
  document.getElementById('wc-view').style.display      = isWC ? 'block'   : 'none';

  if (isWC) loadWC();
  else      loadLeague(id);
}

// ── Regular league ────────────────────────────────────────────
async function loadLeague(league, silent = false) {
  if (league === 'FIFA.WORLD') return;

  if (!silent) {
    showLoading(document.getElementById('scores-container'));
    showLoading(document.getElementById('standings-container'));
    showLoading(document.getElementById('top-scorers-container'));
  }

  clearError();

  try {
    // 1 — scores + stats (ESPN → backend analysis)
    const scoreData = await getScoreboard(league);
    renderScores(scoreData.matches || []);
    renderStatTiles(scoreData.stats || {});
    renderHighlights(scoreData.highlights || []);
  } catch (e) {
    showError('Scores: ' + e.message);
    document.getElementById('scores-container').innerHTML = errHTML('Could not load scores');
  }

  try {
    // 2 — standings (ESPN → backend parse)
    const standings = await getStandings(league);
    renderStandings(standings);

    // 3 — top scoring teams (backend analysis on standings)
    const top = await getTopScorers(league, standings);
    renderTopScorers(top);
  } catch (e) {
    showError('Standings: ' + e.message);
    document.getElementById('standings-container').innerHTML = errHTML('Could not load standings');
  }
}

// ── Scores ────────────────────────────────────────────────────
function renderScores(matches) {
  const el = document.getElementById('scores-container');
  if (!matches.length) { el.innerHTML = emptyHTML('No matches found'); return; }

  const live     = matches.filter(m => m.live);
  const upcoming = matches.filter(m => !m.completed && !m.live);
  const done     = matches.filter(m => m.completed);

  let html = '';
  if (live.length)     html += matchSection('🟢 LIVE NOW', live);
  if (upcoming.length) html += matchSection('UPCOMING', upcoming);
  if (done.length)     html += matchSection('RESULTS', done);
  el.innerHTML = html || emptyHTML('No matches scheduled');
}

function matchSection(label, matches) {
  return `
    <div style="margin-bottom:22px">
      <div class="section-title">${label}</div>
      <div class="card">${matches.map(matchCard).join('')}</div>
    </div>`;
}

function matchCard(m) {
  const live  = m.live;
  const score = (m.home_score != null && m.home_score !== '-')
    ? `${m.home_score} <span style="color:var(--text3)">–</span> ${m.away_score}`
    : 'vs';
  const status = live
    ? `<span class="status-live">⬤ ${m.clock || m.status_short || 'LIVE'}</span>`
    : formatDate(m.date);

  return `
    <div class="match-card ${live ? 'live' : ''}" onclick="openMatch('${m.id}')">
      <div class="team-side home">
        ${logoEl(m.home_team_logo, m.home_team_abbr)}
        <span class="team-name ${m.home_winner ? 'winner' : ''}">${m.home_team}</span>
      </div>
      <div class="score-block">
        <div class="score-display ${live ? 'live' : ''}">${score}</div>
        <div class="match-status">${status}</div>
      </div>
      <div class="team-side away">
        ${logoEl(m.away_team_logo, m.away_team_abbr)}
        <span class="team-name ${m.away_winner ? 'winner' : ''}">${m.away_team}</span>
      </div>
    </div>`;
}

// ── Standings ─────────────────────────────────────────────────
function renderStandings(rows) {
  const el = document.getElementById('standings-container');
  if (!rows.length) {
    el.innerHTML = emptyHTML('Standings not available — league may be off-season');
    return;
  }
  el.innerHTML = `
    <table class="standings-table">
      <thead><tr>
        <th>#</th><th>Team</th><th>P</th>
        <th>W</th><th>D</th><th>L</th>
        <th>GF:GA</th><th>GD</th><th>Pts</th>
      </tr></thead>
      <tbody>${rows.slice(0,22).map((r,i) => {
        const rank = i + 1;
        const gd   = r.goal_diff > 0 ? `+${r.goal_diff}` : r.goal_diff;
        const logo = r.team_logo
          ? `<img src="${r.team_logo}" style="width:18px;height:18px;object-fit:contain" onerror="this.style.display='none'">`
          : '';
        return `<tr>
          <td><span class="rank-num ${rank <= 4 ? 'top4' : ''}">${rank}</span></td>
          <td><div class="team-row">${logo}<span>${r.team_name}</span></div></td>
          <td style="color:var(--text2)">${r.played}</td>
          <td style="color:var(--win)">${r.wins}</td>
          <td style="color:var(--draw)">${r.draws}</td>
          <td style="color:var(--loss)">${r.losses}</td>
          <td style="color:var(--text2)">${r.goals_for}:${r.goals_against}</td>
          <td style="font-family:var(--font-mono);font-size:0.72rem;color:var(--text3)">${gd}</td>
          <td><span class="pts">${r.points}</span></td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
}

// ── Stat tiles ────────────────────────────────────────────────
function renderStatTiles(stats) {
  document.getElementById('stat-total-goals').textContent = stats.total_goals        ?? '—';
  document.getElementById('stat-matches').textContent     = stats.total_matches      ?? '—';
  document.getElementById('stat-avg').textContent         = stats.avg_goals_per_match ?? '—';
  document.getElementById('stat-clean').textContent       = stats.clean_sheets       ?? '—';
}

// ── Top scoring teams ─────────────────────────────────────────
function renderTopScorers(teams) {
  const el = document.getElementById('top-scorers-container');
  if (!teams.length) { el.innerHTML = emptyHTML('No data yet'); return; }
  const max = Math.max(...teams.map(t => Number(t.goals_for) || 0), 1);
  el.innerHTML = teams.map(t => `
    <div class="scorer-bar-row">
      <span class="scorer-name">${t.team_name}</span>
      <div class="scorer-bar-bg">
        <div class="scorer-bar-fill" style="width:${(Number(t.goals_for)/max*100).toFixed(1)}%"></div>
      </div>
      <span class="scorer-goals">${t.goals_for}</span>
    </div>`).join('');
}

// ── Highlights ────────────────────────────────────────────────
function renderHighlights(matches) {
  const el = document.getElementById('highlights-container');
  if (!matches.length) { el.innerHTML = emptyHTML('No highlight matches yet'); return; }
  el.innerHTML = matches.map((m,i) => `
    <div class="fantasy-card">
      <div class="fantasy-rank ${i===0?'gold':i===1?'silver':'bronze'}">${i+1}</div>
      <div class="fantasy-info">
        <div class="fantasy-team-name">${m.home_team} vs ${m.away_team}</div>
        <div class="fantasy-sub">${m.home_score} – ${m.away_score}</div>
      </div>
      <div class="fantasy-pts">${m.total_goals}</div>
    </div>`).join('');
}

// ── Match modal ───────────────────────────────────────────────
async function openMatch(eventId) {
  const modal = document.getElementById('match-modal');
  const body  = document.getElementById('modal-body');
  modal.style.display = 'flex';
  body.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading…</div>`;
  try {
    const data = await getMatchSummary(currentLeague, eventId);
    renderMatchDetail(data, body);
  } catch (e) {
    body.innerHTML = errHTML('Could not load match details: ' + e.message);
  }
}

function renderMatchDetail(data, el) {
  const comp = data.header?.competitions?.[0];
  if (!comp) { el.innerHTML = emptyHTML('No detail available'); return; }
  const [home, away] = [
    comp.competitors?.find(c => c.homeAway === 'home') || {},
    comp.competitors?.find(c => c.homeAway === 'away') || {},
  ];

  // Scoring plays
  const goals = (data.scoring?.periods || []).flatMap(p =>
    (p.scoringPlays || []).map(sp => ({ ...sp, period: p.displayName })));

  // Venue + referee
  const venue = data.gameInfo?.venue?.fullName || comp.venue?.fullName || '';
  const attendance = data.gameInfo?.attendance ? `Attendance: ${data.gameInfo.attendance.toLocaleString()}` : '';

  // Box score stats
  const homeStats = home.statistics || [];
  const awayStats = away.statistics || [];

  const statKeys = ['shotsOnTarget','shots','possession','fouls','yellowCards','redCards','cornerKicks','offsides'];
  const statLabels = { shotsOnTarget:'Shots on Target', shots:'Shots', possession:'Possession %',
    fouls:'Fouls', yellowCards:'Yellow Cards', redCards:'Red Cards',
    cornerKicks:'Corners', offsides:'Offsides' };

  const statRows = statKeys.map(key => {
    const hStat = homeStats.find(s => s.name === key);
    const aStat = awayStats.find(s => s.name === key);
    if (!hStat && !aStat) return '';
    const hVal = hStat?.displayValue ?? '—';
    const aVal = aStat?.displayValue ?? '—';
    return `<tr>
      <td style="text-align:right;font-family:var(--font-mono);font-size:0.85rem;color:var(--accent)">${hVal}</td>
      <td style="text-align:center;font-size:0.68rem;color:var(--text3);letter-spacing:1px;padding:0 12px">${statLabels[key]||key}</td>
      <td style="font-family:var(--font-mono);font-size:0.85rem;color:var(--accent2)">${aVal}</td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div style="padding:20px">
      <!-- Score header -->
      <div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:12px;margin-bottom:16px">
        <div style="text-align:center">
          <img src="${home.team?.logos?.[0]?.href||''}" style="width:52px;height:52px;object-fit:contain" onerror="this.style.display='none'">
          <div style="font-size:0.82rem;font-weight:600;margin-top:6px">${home.team?.displayName||''}</div>
        </div>
        <div style="text-align:center">
          <div style="font-family:var(--font-display);font-size:2.8rem;letter-spacing:6px;color:var(--accent);line-height:1">
            ${home.score??'–'} <span style="color:var(--text3);font-size:2rem">–</span> ${away.score??'–'}
          </div>
          <div style="font-size:0.65rem;color:var(--text2);margin-top:5px;letter-spacing:1px">${comp.status?.type?.description||''}</div>
          ${venue ? `<div style="font-size:0.65rem;color:var(--text3);margin-top:3px">${venue}</div>` : ''}
          ${attendance ? `<div style="font-size:0.62rem;color:var(--text3)">${attendance}</div>` : ''}
        </div>
        <div style="text-align:center">
          <img src="${away.team?.logos?.[0]?.href||''}" style="width:52px;height:52px;object-fit:contain" onerror="this.style.display='none'">
          <div style="font-size:0.82rem;font-weight:600;margin-top:6px">${away.team?.displayName||''}</div>
        </div>
      </div>

      <!-- Stats -->
      ${statRows ? `
        <div style="margin-bottom:16px">
          <div style="font-size:0.65rem;letter-spacing:2px;color:var(--text3);margin-bottom:8px">MATCH STATS</div>
          <table style="width:100%;border-collapse:collapse">${statRows}</table>
        </div>` : ''}

      <!-- Goal timeline -->
      ${goals.length ? `
        <div style="font-size:0.65rem;letter-spacing:2px;color:var(--text3);margin-bottom:8px">GOALS</div>
        ${goals.map(g => `
          <div style="display:flex;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
            <span style="font-family:var(--font-mono);font-size:0.7rem;color:var(--accent);width:32px">${g.clock?.displayValue||''}'</span>
            <span style="font-size:0.8rem">⚽ ${g.scoringPlay?.type?.text||'Goal'}</span>
            <span style="font-size:0.72rem;color:var(--text2);margin-left:auto">${g.period||''}</span>
          </div>`).join('')}` : ''}

      <!-- Lineups -->
      ${renderLineups(data)}
    </div>`;
}

function renderLineups(data) {
  const rosters = data.rosters;
  if (!rosters?.length) return '';
  const home = rosters.find(r => r.homeAway === 'home');
  const away = rosters.find(r => r.homeAway === 'away');
  if (!home && !away) return '';

  const playerList = (roster) => (roster?.roster || [])
    .filter(p => p.starter)
    .map(p => `<div style="font-size:0.78rem;padding:3px 0;color:var(--text2)">
      <span style="color:var(--text3);font-family:var(--font-mono);font-size:0.7rem;width:20px;display:inline-block">${p.jersey||''}</span>
      ${p.athlete?.displayName||''}
      <span style="color:var(--text3);font-size:0.68rem"> ${p.position?.abbreviation||''}</span>
    </div>`).join('');

  return `
    <div style="margin-top:14px">
      <div style="font-size:0.65rem;letter-spacing:2px;color:var(--text3);margin-bottom:8px">LINEUPS</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><div style="font-size:0.72rem;font-weight:600;margin-bottom:6px;color:var(--text)">${home?.team?.displayName||''}</div>${playerList(home)}</div>
        <div><div style="font-size:0.72rem;font-weight:600;margin-bottom:6px;color:var(--text)">${away?.team?.displayName||''}</div>${playerList(away)}</div>
      </div>
    </div>`;
}

document.getElementById('modal-close').onclick = () =>
  document.getElementById('match-modal').style.display = 'none';
document.getElementById('match-modal').onclick = e => {
  if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
};

// ── World Cup ─────────────────────────────────────────────────
async function loadWC() {
  loadWCGroups();
  loadWCSchedule();
  loadWCScorersTab();
}

async function loadWCGroups() {
  const el = document.getElementById('wc-groups');
  el.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading groups…</div>`;
  try {
    const raw    = await getWCStandings();
    const groups = parseWCGroups(raw);
    if (Object.keys(groups).length) {
      el.innerHTML = renderGroupsHTML(groups);
    } else {
      el.innerHTML = renderGroupsStaticHTML();
    }
  } catch (e) {
    el.innerHTML = renderGroupsStaticHTML();
  }
}

function renderGroupsHTML(groups) {
  const letters = Object.keys(groups).sort();
  return `
    <div style="margin-bottom:14px;font-size:0.72rem;color:var(--text2);letter-spacing:1px">
      ✦ Top 2 teams in each group advance · Best 8 third-placed teams also advance to Round of 32
    </div>
    <div class="groups-grid">${letters.map(l => groupCard(l, groups[l])).join('')}</div>`;
}

function renderGroupsStaticHTML() {
  const groups2026 = {
    'Group A': ['Mexico','South Africa','South Korea','Czechia'],
    'Group B': ['USA','Paraguay','Panama','New Zealand'],
    'Group C': ['Brazil','Germany','Colombia','Japan'],
    'Group D': ['Argentina','Ecuador','Croatia','Morocco'],
    'Group E': ['France','England','Netherlands','Portugal'],
    'Group F': ['Spain','Belgium','Uruguay','Serbia'],
    'Group G': ['Italy','Switzerland','Australia','Algeria'],
    'Group H': ['Iran','Canada','Senegal','Uzbekistan'],
    'Group I': ['Netherlands','Poland','Tunisia','Curacao'],
    'Group J': ['Denmark','Croatia','Saudi Arabia','Jordan'],
    'Group K': ['Ghana','Ireland','Austria','Ivory Coast'],
    'Group L': ['Cameroon','Venezuela','Slovakia','Cabo Verde'],
  };
  const rows = Object.fromEntries(
    Object.entries(groups2026).map(([g, teams]) => [
      g, teams.map(name => ({ team_name: name, played:0, wins:0, draws:0, losses:0, goals_for:0, goals_against:0, goal_diff:0, points:0 }))
    ])
  );
  return `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">
      <div style="background:rgba(255,215,0,0.1);border:1px solid rgba(255,215,0,0.2);color:#ffd700;
        padding:5px 14px;border-radius:6px;font-size:0.72rem;letter-spacing:1px">
        ● TOURNAMENT STARTS JUN 11
      </div>
      <span style="font-size:0.72rem;color:var(--text3)">
        Group draw confirmed · Live standings update once matches begin
      </span>
    </div>
    <div class="groups-grid">${Object.entries(rows).map(([g, teams]) => groupCard(g, teams)).join('')}</div>`;
}

function groupCard(letter, teams) {
  const rows = teams.map((t, i) => {
    const qualified = i < 2 && t.played > 0;
    const gd = t.goal_diff > 0 ? `+${t.goal_diff}` : (t.goal_diff || 0);
    const logo = t.team_logo
      ? `<img src="${t.team_logo}" style="width:15px;height:15px;object-fit:contain;flex-shrink:0" onerror="this.style.display='none'">`
      : '';
    return `<tr class="${qualified ? 'qualified' : ''}">
      <td style="color:var(--text3);font-family:var(--font-mono);font-size:0.68rem;width:18px">${i+1}</td>
      <td><div style="display:flex;align-items:center;gap:5px">${logo}<span style="white-space:nowrap">${t.team_name}</span></div></td>
      <td style="color:var(--text2);text-align:center">${t.played}</td>
      <td style="color:var(--win);text-align:center">${t.wins}</td>
      <td style="color:var(--draw);text-align:center">${t.draws}</td>
      <td style="color:var(--loss);text-align:center">${t.losses}</td>
      <td style="color:var(--text2);font-size:0.7rem;text-align:center">${t.goals_for}:${t.goals_against}</td>
      <td style="color:var(--text3);font-size:0.7rem;text-align:center">${gd}</td>
      <td><span class="wc-pts">${t.points}</span></td>
    </tr>`;
  }).join('');
  return `
    <div class="group-card">
      <div class="group-header">
        <span class="group-letter">${letter}</span>
        <span style="font-size:0.62rem;color:rgba(255,215,0,0.4);letter-spacing:2px">WC 2026</span>
      </div>
      <table class="group-table">
        <thead><tr>
          <th></th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF:GA</th><th>GD</th><th>Pts</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

async function loadWCSchedule() {
  const el = document.getElementById('wc-schedule');
  el.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading schedule…</div>`;
  try {
    const raw     = await getWCScoreboard();
    const matches = (raw.events || []).map(parseEvent);
    if (matches.length) {
      renderWCScheduleHTML(el, matches);
    } else {
      renderWCScheduleStatic(el);
    }
  } catch {
    renderWCScheduleStatic(el);
  }
}

function parseEvent(event) {
  const comp = event.competitions?.[0] || {};
  const competitors = comp.competitors || [];
  const home = competitors.find(c => c.homeAway === 'home') || {};
  const away = competitors.find(c => c.homeAway === 'away') || {};
  const st   = event.status?.type || {};
  return {
    id:         event.id,
    date:       event.date,
    status:     st.description || '',
    status_short: st.shortDetail || '',
    completed:  st.completed || false,
    live:       st.state === 'in',
    clock:      event.status?.displayClock || '',
    home_team:  home.team?.displayName || '',
    home_logo:  home.team?.logo || '',
    home_score: home.score ?? '-',
    home_winner: home.winner || false,
    away_team:  away.team?.displayName || '',
    away_logo:  away.team?.logo || '',
    away_score: away.score ?? '-',
    away_winner: away.winner || false,
    venue:      comp.venue?.fullName || '',
    group:      comp.groups?.name || comp.group?.name || '',
  };
}

function renderWCScheduleHTML(el, matches) {
  const byDate = {};
  matches.forEach(m => {
    const key = m.date ? new Date(m.date).toLocaleDateString('en-US', {weekday:'long',month:'long',day:'numeric'}) : 'TBD';
    (byDate[key] = byDate[key] || []).push(m);
  });
  const live = matches.filter(m => m.live);
  let html = '';
  if (live.length) {
    html += `<div style="margin-bottom:18px"><div class="section-title">🟡 LIVE NOW</div>
      <div class="card">${live.map(wcMatchRow).join('')}</div></div>`;
  }
  html += Object.entries(byDate).map(([date, ms]) => `
    <div class="schedule-day">
      <div class="schedule-day-label">${date}
        ${ms.some(m=>m.live)?'<span class="day-badge">LIVE</span>':''}
        ${ms.every(m=>m.completed)?'<span class="day-badge" style="color:var(--text3)">DONE</span>':''}
      </div>
      <div class="card">${ms.map(wcMatchRow).join('')}</div>
    </div>`).join('');
  el.innerHTML = html;
}

function wcMatchRow(m) {
  const live  = m.live;
  const score = (m.home_score != null && m.home_score !== '-')
    ? `${m.home_score} <span style="color:var(--text3)">–</span> ${m.away_score}`
    : 'vs';
  return `
    <div class="wc-match-row ${live ? 'wc-live' : ''}" onclick="openMatch('${m.id}')">
      <div class="wc-team ${m.home_winner ? 'winner' : ''}">
        ${m.home_logo ? `<img src="${m.home_logo}" style="width:22px;height:22px;object-fit:contain" onerror="this.style.display='none'">` : ''}
        ${m.home_team}
      </div>
      <div class="wc-score-block">
        <div class="wc-score ${live ? 'live' : ''}">${score}</div>
        <div class="wc-time">${live ? '⬤ LIVE ' + (m.clock||'') : formatDate(m.date)}</div>
        ${m.group ? `<div class="wc-time" style="margin-top:2px"><span class="wc-group-badge">${m.group}</span></div>` : ''}
      </div>
      <div class="wc-team right ${m.away_winner ? 'winner' : ''}">
        ${m.away_team}
        ${m.away_logo ? `<img src="${m.away_logo}" style="width:22px;height:22px;object-fit:contain" onerror="this.style.display='none'">` : ''}
      </div>
    </div>`;
}

function renderWCScheduleStatic(el) {
  const schedule = [
    { date:'Thu, June 11', matches:[
      {home:'Mexico',away:'South Africa',time:'3:00 PM ET',venue:'Estadio Azteca, Mexico City',group:'A'},
      {home:'South Korea',away:'Czechia',time:'9:00 PM ET',venue:'SoFi Stadium, Los Angeles',group:'A'},
    ]},
    { date:'Fri, June 12', matches:[
      {home:'USA',away:'Paraguay',time:'6:00 PM ET',venue:'MetLife Stadium, New York',group:'B'},
      {home:'Canada',away:'Argentina',time:'9:00 PM ET',venue:'BMO Field, Toronto',group:'D'},
    ]},
    { date:'Sat, June 13', matches:[
      {home:'Germany',away:'Japan',time:'12:00 PM ET',venue:'AT&T Stadium, Dallas',group:'C'},
      {home:'Brazil',away:'Colombia',time:'3:00 PM ET',venue:'Hard Rock Stadium, Miami',group:'C'},
      {home:'Morocco',away:'Croatia',time:'6:00 PM ET',venue:'Levi\'s Stadium, San Francisco',group:'D'},
      {home:'Spain',away:'Belgium',time:'9:00 PM ET',venue:'Estadio Akron, Guadalajara',group:'F'},
    ]},
    { date:'Sun, June 14', matches:[
      {home:'France',away:'England',time:'3:00 PM ET',venue:'AT&T Stadium, Dallas',group:'E'},
      {home:'Netherlands',away:'Portugal',time:'6:00 PM ET',venue:'Lincoln Financial Field, Philadelphia',group:'E'},
      {home:'Uruguay',away:'Serbia',time:'9:00 PM ET',venue:'Gillette Stadium, Boston',group:'F'},
    ]},
  ];
  el.innerHTML = `
    <div style="background:rgba(255,215,0,0.06);border:1px solid rgba(255,215,0,0.15);
      border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:0.8rem;color:var(--text2)">
      ⏱ Tournament begins June 11, 2026 · Live schedule loads once matches start
    </div>
    ${schedule.map(day=>`
      <div class="schedule-day">
        <div class="schedule-day-label">${day.date}</div>
        <div class="card">${day.matches.map(m=>`
          <div class="wc-match-row">
            <div class="wc-team">${m.home}</div>
            <div class="wc-score-block">
              <div class="wc-score" style="font-size:0.9rem;color:var(--text2)">vs</div>
              <div class="wc-time">${m.time}</div>
              <div class="wc-time"><span class="wc-group-badge">GROUP ${m.group}</span></div>
              <div class="wc-time" style="margin-top:2px">${m.venue}</div>
            </div>
            <div class="wc-team right">${m.away}</div>
          </div>`).join('')}</div>
      </div>`).join('')}
    <div style="text-align:center;padding:20px;color:var(--text3);font-size:0.78rem">Full 104-match schedule loads from ESPN once the tournament begins</div>`;
}

async function loadWCScorersTab() {
  const el = document.getElementById('wc-scorers');
  el.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading scorers…</div>`;
  try {
    const raw     = await getWCLeaders();
    const scorers = parseTopScorers(raw);
    if (scorers.length) {
      renderWCScorers(el, scorers);
    } else {
      renderWCScorersStatic(el);
    }
  } catch {
    renderWCScorersStatic(el);
  }
}

function renderWCScorers(el, scorers) {
  el.innerHTML = `<div class="card">
    ${scorers.slice(0,15).map((p,i)=>{
      const rc = i===0?'gold':i===1?'silver':i===2?'bronze':'';
      const logo = p.team_logo ? `<img src="${p.team_logo}" style="width:18px;height:18px;object-fit:contain" onerror="this.style.display='none'">` : '';
      return `<div class="scorer-row">
        <div class="scorer-rank ${rc}">${i+1}</div>
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

function renderWCScorersStatic(el) {
  const historical = [
    {name:'Miroslav Klose',  team:'Germany',  goals:16, note:'All-time record'},
    {name:'Ronaldo (R9)',    team:'Brazil',   goals:15, note:'2002 champion'},
    {name:'Gerd Müller',     team:'Germany',  goals:14, note:'1974 champion'},
    {name:'Lionel Messi',    team:'Argentina',goals:13, note:'2022 champion'},
    {name:'Just Fontaine',   team:'France',   goals:13, note:'1958 — single tournament'},
    {name:'Kylian Mbappé',   team:'France',   goals:12, note:'2026 favourite'},
    {name:'Pelé',            team:'Brazil',   goals:12, note:'3× World Champion'},
    {name:'Vinicius Jr.',    team:'Brazil',   goals:2,  note:'2026 contender'},
    {name:'Cristiano Ronaldo',team:'Portugal',goals:8,  note:'Final tournament'},
    {name:'Erling Haaland',  team:'Norway',   goals:0,  note:'Did not qualify'},
  ];
  el.innerHTML = `
    <div style="background:rgba(255,215,0,0.06);border:1px solid rgba(255,215,0,0.15);
      border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:0.8rem;color:var(--text2)">
      🏆 Live scoring updates from June 11 · Showing all-time records &amp; 2026 contenders
    </div>
    <div class="card">
      <div style="padding:10px 20px;border-bottom:1px solid var(--border);font-size:0.65rem;letter-spacing:2px;color:var(--text3)">
        ALL-TIME WC TOP SCORERS &amp; 2026 CONTENDERS
      </div>
      ${historical.map((p,i)=>{
        const rc = i===0?'gold':i===1?'silver':i===2?'bronze':'';
        return `<div class="scorer-row">
          <div class="scorer-rank ${rc}">${i+1}</div>
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

// ── WC Info ───────────────────────────────────────────────────
const WC_VENUES = [
  {city:'New York/New Jersey',stadium:'MetLife Stadium',      country:'USA'},
  {city:'Los Angeles',        stadium:'SoFi Stadium',         country:'USA'},
  {city:'Dallas',             stadium:'AT&T Stadium',         country:'USA'},
  {city:'San Francisco',      stadium:"Levi's Stadium",       country:'USA'},
  {city:'Miami',              stadium:'Hard Rock Stadium',    country:'USA'},
  {city:'Seattle',            stadium:'Lumen Field',          country:'USA'},
  {city:'Boston',             stadium:'Gillette Stadium',     country:'USA'},
  {city:'Houston',            stadium:'NRG Stadium',          country:'USA'},
  {city:'Atlanta',            stadium:'Mercedes-Benz Stadium',country:'USA'},
  {city:'Kansas City',        stadium:'Arrowhead Stadium',    country:'USA'},
  {city:'Philadelphia',       stadium:'Lincoln Financial Field',country:'USA'},
  {city:'Mexico City',        stadium:'Estadio Azteca',       country:'Mexico'},
  {city:'Guadalajara',        stadium:'Estadio Akron',        country:'Mexico'},
  {city:'Monterrey',          stadium:'Estadio BBVA',         country:'Mexico'},
  {city:'Toronto',            stadium:'BMO Field',            country:'Canada'},
  {city:'Vancouver',          stadium:'BC Place',             country:'Canada'},
];

function renderWCInfo(el) {
  if (el.innerHTML.trim()) return;
  el.innerHTML = `
    <div class="info-grid" style="margin-bottom:24px">
      ${[
        {icon:'🌍',title:'HOST NATIONS', value:'3 Countries',    sub:'USA · Mexico · Canada'},
        {icon:'⚽',title:'FORMAT',       value:'48 Teams',        sub:'104 matches · 12 groups of 4 · Round of 32 onwards'},
        {icon:'📅',title:'DATES',        value:'Jun 11 – Jul 19', sub:'2026 · 38 days of football'},
        {icon:'🏟️',title:'VENUES',       value:'16 Stadiums',     sub:'11 USA · 3 Mexico · 2 Canada'},
        {icon:'🎯',title:'OPENING MATCH',value:'Mexico vs S. Africa',sub:'June 11 · Estadio Azteca · 3:00 PM ET'},
        {icon:'🏆',title:'FINAL',        value:'July 19, 2026',   sub:'MetLife Stadium · East Rutherford, NJ'},
      ].map(c=>`
        <div class="info-card">
          <div class="info-card-icon">${c.icon}</div>
          <div class="info-card-title">${c.title}</div>
          <div class="info-card-value">${c.value}</div>
          <div class="info-card-sub">${c.sub}</div>
        </div>`).join('')}
    </div>
    <div class="section-title">ALL 16 VENUES</div>
    <div class="card" style="margin-bottom:24px">
      <table class="standings-table">
        <thead><tr><th>Stadium</th><th>City</th><th>Country</th></tr></thead>
        <tbody>${WC_VENUES.map(v=>`<tr>
          <td style="font-weight:500">${v.stadium}</td>
          <td style="color:var(--text2)">${v.city}</td>
          <td><span style="font-size:0.7rem;padding:2px 8px;border-radius:4px;background:var(--bg3);color:var(--text2)">${v.country}</span></td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;
}

// ── Helpers ───────────────────────────────────────────────────
function logoEl(src, abbr) {
  if (src) return `<img class="team-logo" src="${src}" alt="${abbr||''}" onerror="this.outerHTML='<div class=team-logo-placeholder>${abbr||'?'}</div>'">`;
  return `<div class="team-logo-placeholder">${abbr||'?'}</div>`;
}

function formatDate(str) {
  if (!str) return '';
  try {
    return new Date(str).toLocaleString(undefined, {
      weekday:'short', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'
    });
  } catch { return str; }
}

function showLoading(el) { if (el) el.innerHTML = `<div class="loading-row"><div class="spinner"></div></div>`; }
function emptyHTML(m)   { return `<div class="loading-row" style="color:var(--text3)">${m}</div>`; }
function errHTML(m)     { return `<div class="loading-row" style="color:var(--loss)">⚠ ${m}</div>`; }

function showError(msg) {
  const bar = document.getElementById('error-bar');
  bar.style.display = 'block';
  bar.textContent = '⚠ ESPN API: ' + msg + ' — data fetched directly from your browser; check browser console for details.';
}
function clearError() {
  document.getElementById('error-bar').style.display = 'none';
}
