/**
 * match-analytics.js
 * Fetches match summary from ESPN (browser), sends to backend for analysis,
 * then renders rich analytics charts and tables in the match modal.
 */

// ── Entry point called from app.js openMatch() ────────────────
async function loadMatchAnalytics(league, eventId, container) {
  container.innerHTML = loadingHTML('Fetching match data…');

  let rawSummary;
  try {
    rawSummary = await getMatchSummary(league, eventId);
  } catch (e) {
    container.innerHTML = errHTML('Could not load match from ESPN: ' + e.message);
    return;
  }

  container.innerHTML = loadingHTML('Running analytics…');

  let analytics;
  try {
    const res = await fetch('http://localhost:8000/api/analysis/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rawSummary),
    });
    if (!res.ok) throw new Error('Backend ' + res.status);
    analytics = await res.json();
  } catch (e) {
    // Fallback: do basic parsing client-side
    analytics = parseBasicAnalytics(rawSummary);
  }

  renderMatchAnalytics(rawSummary, analytics, container);
}

// ── Main render ───────────────────────────────────────────────
function renderMatchAnalytics(raw, analytics, container) {
  const comp  = raw.header?.competitions?.[0] || {};
  const comps = comp.competitors || [];
  const home  = comps.find(c => c.homeAway === 'home') || {};
  const away  = comps.find(c => c.homeAway === 'away') || {};

  const homeTeam  = analytics.match_stats?.home?.team  || home.team?.displayName || 'Home';
  const awayTeam  = analytics.match_stats?.away?.team  || away.team?.displayName || 'Away';
  const homeLogo  = analytics.match_stats?.home?.team_logo || home.team?.logo || '';
  const awayLogo  = analytics.match_stats?.away?.team_logo || away.team?.logo || '';
  const homeScore = home.score ?? '–';
  const awayScore = away.score ?? '–';
  const status    = comp.status?.type?.description || '';

  container.innerHTML = `
    <!-- Score header -->
    <div class="ma-header">
      <div class="ma-team-block">
        ${homeLogo ? `<img src="${homeLogo}" class="ma-team-logo" onerror="this.style.display='none'">` : ''}
        <div class="ma-team-name">${homeTeam}</div>
      </div>
      <div class="ma-score-block">
        <div class="ma-score">${homeScore} <span class="ma-dash">–</span> ${awayScore}</div>
        <div class="ma-status">${status}</div>
        <div class="ma-xg-label">xG: <span class="ma-xg-h">${analytics.xg_estimate?.home?.xg ?? '—'}</span>
          &nbsp;–&nbsp; <span class="ma-xg-a">${analytics.xg_estimate?.away?.xg ?? '—'}</span></div>
      </div>
      <div class="ma-team-block right">
        ${awayLogo ? `<img src="${awayLogo}" class="ma-team-logo" onerror="this.style.display='none'">` : ''}
        <div class="ma-team-name">${awayTeam}</div>
      </div>
    </div>

    <!-- Analytics tabs -->
    <div class="ma-tab-bar">
      <button class="ma-tab active" onclick="switchMATab('ma-timeline',this)">Timeline</button>
      <button class="ma-tab" onclick="switchMATab('ma-stats',this)">Stats</button>
      <button class="ma-tab" onclick="switchMATab('ma-shots',this)">Shots</button>
      <button class="ma-tab" onclick="switchMATab('ma-pressure',this)">Pressure</button>
      <button class="ma-tab" onclick="switchMATab('ma-ratings',this)">Ratings</button>
      <button class="ma-tab" onclick="switchMATab('ma-lineups',this)">Lineups</button>
    </div>

    <!-- Timeline tab -->
    <div id="ma-timeline" class="ma-tab-panel active" style="padding:16px">
      ${renderTimeline(analytics.key_events || [], analytics.goal_timeline || [], homeTeam, awayTeam)}
    </div>

    <!-- Stats tab -->
    <div id="ma-stats" class="ma-tab-panel" style="display:none;padding:16px">
      ${renderStatsComparison(analytics.match_stats, homeTeam, awayTeam)}
    </div>

    <!-- Shots tab -->
    <div id="ma-shots" class="ma-tab-panel" style="display:none;padding:16px">
      ${renderShotBreakdown(analytics.shot_breakdown, analytics.xg_estimate)}
    </div>

    <!-- Pressure tab -->
    <div id="ma-pressure" class="ma-tab-panel" style="display:none;padding:16px">
      <div id="pressure-chart-wrap"></div>
    </div>

    <!-- Ratings tab -->
    <div id="ma-ratings" class="ma-tab-panel" style="display:none;padding:16px">
      ${renderPlayerRatings(analytics.player_ratings || [], homeTeam, awayTeam)}
    </div>

    <!-- Lineups tab -->
    <div id="ma-lineups" class="ma-tab-panel" style="display:none;padding:16px">
      ${renderLineups(raw)}
    </div>
  `;

  // Render pressure SVG after DOM is ready
  setTimeout(() => {
    renderPressureChart(
      analytics.pressure_map || { labels:[], home:[], away:[] },
      homeTeam, awayTeam,
      document.getElementById('pressure-chart-wrap')
    );
  }, 50);
}

// ── Timeline ──────────────────────────────────────────────────
function renderTimeline(events, goals, homeTeam, awayTeam) {
  if (!events.length && !goals.length) {
    return `<div style="color:var(--text3);text-align:center;padding:24px">No event data available for this match</div>`;
  }

  const allEvents = events.length ? events : goals.map(g => ({
    minute: g.minute, icon: '⚽', type: g.type, side: g.side,
    player: g.scorer, text: `${g.type} — ${g.scorer}`,
    home_score: g.home_score, away_score: g.away_score, scoring: true,
  }));

  return `
    <div style="font-size:.68rem;letter-spacing:1.5px;color:var(--text3);margin-bottom:14px">
      KEY EVENTS · ${allEvents.length} total
    </div>
    <div class="tl-container">
      <div class="tl-axis"></div>
      ${allEvents.map(e => {
        const isHome = e.side === 'home';
        const scoreTag = (e.home_score !== '' && e.away_score !== '' && e.scoring)
          ? `<span class="tl-score-tag">${e.home_score}–${e.away_score}</span>` : '';
        return `
          <div class="tl-event ${isHome ? 'tl-home' : 'tl-away'}">
            ${!isHome ? `<div class="tl-content right">
              <div class="tl-player">${e.player || ''}</div>
              <div class="tl-desc">${e.type}</div>
              ${scoreTag}
            </div>` : '<div class="tl-spacer"></div>'}
            <div class="tl-node">
              <div class="tl-min">${e.minute}'</div>
              <div class="tl-icon">${e.icon}</div>
            </div>
            ${isHome ? `<div class="tl-content">
              <div class="tl-player">${e.player || ''}</div>
              <div class="tl-desc">${e.type}</div>
              ${scoreTag}
            </div>` : '<div class="tl-spacer"></div>'}
          </div>`;
      }).join('')}
    </div>`;
}

// ── Stats comparison ──────────────────────────────────────────
function renderStatsComparison(stats, homeTeam, awayTeam) {
  if (!stats?.home || !stats?.away) return `<div style="color:var(--text3);text-align:center;padding:24px">No stats available</div>`;
  const h = stats.home;
  const a = stats.away;

  const rows = [
    { label: 'Possession', hv: h.possession, av: a.possession, unit: '%', format: v => v.toFixed(1) },
    { label: 'Shots', hv: h.shots, av: a.shots },
    { label: 'Shots on Target', hv: h.shotsOnTarget, av: a.shotsOnTarget },
    { label: 'Pass Accuracy', hv: h.passAccuracy, av: a.passAccuracy, unit: '%', format: v => v.toFixed(1) },
    { label: 'Passes', hv: h.passes, av: a.passes },
    { label: 'Fouls', hv: h.fouls, av: a.fouls },
    { label: 'Corners', hv: h.corners, av: a.corners },
    { label: 'Yellow Cards', hv: h.yellowCards, av: a.yellowCards },
    { label: 'Red Cards', hv: h.redCards, av: a.redCards },
    { label: 'Offsides', hv: h.offsides, av: a.offsides },
    { label: 'Saves', hv: h.saves, av: a.saves },
    { label: 'Free Kicks', hv: h.freeKicks, av: a.freeKicks },
  ].filter(r => r.hv || r.av);

  return `
    <div class="stats-header-row">
      <span class="sh-team home">${homeTeam}</span>
      <span></span>
      <span class="sh-team away">${awayTeam}</span>
    </div>
    ${rows.map(r => {
      const fmt  = r.format || (v => Math.round(v));
      const hVal = fmt(r.hv || 0);
      const aVal = fmt(r.av || 0);
      const tot  = (r.hv || 0) + (r.av || 0);
      const hPct = tot > 0 ? ((r.hv || 0) / tot * 100).toFixed(1) : 50;
      const aPct = tot > 0 ? ((r.av || 0) / tot * 100).toFixed(1) : 50;
      const unit = r.unit || '';
      return `
        <div class="stat-comp-row">
          <div class="scr-val home">${hVal}${unit}</div>
          <div class="scr-bar-wrap">
            <div class="scr-bar home" style="width:${hPct}%"></div>
            <div class="scr-bar away" style="width:${aPct}%"></div>
          </div>
          <div class="scr-val away">${aVal}${unit}</div>
          <div class="scr-label">${r.label}</div>
        </div>`;
    }).join('')}`;
}

// ── Shot breakdown ────────────────────────────────────────────
function renderShotBreakdown(shots, xg) {
  if (!shots?.home && !shots?.away) return `<div style="color:var(--text3);text-align:center;padding:24px">No shot data available</div>`;

  const sides = [
    { key: 'home', color: 'var(--accent)',  label: shots?.home?.team || 'Home' },
    { key: 'away', color: 'var(--accent2)', label: shots?.away?.team || 'Away' },
  ];

  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      ${sides.map(s => {
        const d   = shots?.[s.key] || {};
        const xgd = xg?.[s.key]   || {};
        const bars = [
          { label: 'Total Shots', val: d.total || 0, max: 20, color: 'rgba(255,255,255,.15)' },
          { label: 'On Target',   val: d.on_target || 0, max: 20, color: s.color },
          { label: 'Goals',       val: d.goals || 0, max: 10, color: '#ffd700' },
          { label: 'Blocked',     val: d.blocked || 0, max: 10, color: 'var(--loss)' },
          { label: 'Off Target',  val: d.off_target || 0, max: 15, color: 'var(--text3)' },
        ];
        return `
          <div class="shot-panel">
            <div class="shot-title">${s.label}</div>
            ${bars.map(b => `
              <div class="shot-row">
                <div class="shot-label">${b.label}</div>
                <div class="shot-bar-bg">
                  <div class="shot-bar-fill" style="width:${Math.min(100, b.val/b.max*100).toFixed(1)}%;background:${b.color}"></div>
                </div>
                <div class="shot-val">${b.val}</div>
              </div>`).join('')}
            <div class="xg-display">
              <span style="color:var(--text3);font-size:.68rem;letter-spacing:1px">xG</span>
              <span style="font-family:var(--font-display);font-size:1.6rem;color:${s.color};margin-left:8px">${xgd.xg ?? '—'}</span>
              ${xgd.actual_goals != null ? `<span style="font-size:.72rem;color:var(--text3);margin-left:6px">(actual: ${xgd.actual_goals})</span>` : ''}
            </div>
          </div>`;
      }).join('')}
    </div>
    <div style="margin-top:14px;padding:10px 14px;background:var(--bg3);border-radius:8px;
      font-size:.72rem;color:var(--text3)">
      ⓘ xG (expected goals) estimated from shot volume and target accuracy. 
      Precise xG requires shot position data not available in this API.
    </div>`;
}

// ── Pressure chart (SVG) ──────────────────────────────────────
function renderPressureChart(data, homeTeam, awayTeam, container) {
  if (!container) return;
  const { labels, home, away } = data;
  if (!labels?.length) {
    container.innerHTML = `<div style="color:var(--text3);text-align:center;padding:24px">No pressure data available</div>`;
    return;
  }

  const W = 480, H = 220, PAD = { top:30, right:20, bottom:40, left:36 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top  - PAD.bottom;
  const n = labels.length;
  const barW = chartW / n * 0.35;
  const maxVal = Math.max(...home, ...away, 1);
  const scaleY = v => chartH - (v / maxVal * chartH);

  const homeColor = '#00e676';
  const awayColor = '#00b0ff';

  let bars = '';
  labels.forEach((lbl, i) => {
    const x = PAD.left + (i + 0.5) * (chartW / n);
    const hH = (home[i] / maxVal) * chartH;
    const aH = (away[i] / maxVal) * chartH;

    bars += `
      <rect x="${x - barW - 2}" y="${PAD.top + chartH - hH}" width="${barW}" height="${hH}"
        fill="${homeColor}" rx="3" opacity=".85"/>
      <rect x="${x + 2}" y="${PAD.top + chartH - aH}" width="${barW}" height="${aH}"
        fill="${awayColor}" rx="3" opacity=".85"/>
      <text x="${x}" y="${H - 8}" text-anchor="middle" font-size="10"
        fill="rgba(255,255,255,.4)" font-family="var(--font-mono)">${lbl}</text>
    `;
  });

  // Y axis gridlines
  let gridlines = '';
  for (let v = 0; v <= maxVal; v++) {
    const y = PAD.top + scaleY(v);
    gridlines += `
      <line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}"
        stroke="rgba(255,255,255,.06)" stroke-width="1"/>
      <text x="${PAD.left - 6}" y="${y + 4}" text-anchor="end" font-size="9"
        fill="rgba(255,255,255,.25)" font-family="var(--font-mono)">${v}</text>
    `;
  }

  container.innerHTML = `
    <div style="font-size:.68rem;letter-spacing:1.5px;color:var(--text3);margin-bottom:12px">
      SCORING ATTEMPTS BY 15-MIN INTERVAL
    </div>
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;display:block">
      ${gridlines}
      <line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top+chartH}"
        stroke="rgba(255,255,255,.1)" stroke-width="1"/>
      <line x1="${PAD.left}" y1="${PAD.top+chartH}" x2="${W-PAD.right}" y2="${PAD.top+chartH}"
        stroke="rgba(255,255,255,.1)" stroke-width="1"/>
      ${bars}
      <!-- Legend -->
      <rect x="${PAD.left}" y="8" width="10" height="10" rx="2" fill="${homeColor}"/>
      <text x="${PAD.left+14}" y="18" font-size="10" fill="rgba(255,255,255,.6)" font-family="var(--font-body)">${homeTeam}</text>
      <rect x="${PAD.left + 140}" y="8" width="10" height="10" rx="2" fill="${awayColor}"/>
      <text x="${PAD.left + 154}" y="18" font-size="10" fill="rgba(255,255,255,.6)" font-family="var(--font-body)">${awayTeam}</text>
    </svg>
    <div style="font-size:.7rem;color:var(--text3);margin-top:8px">
      Counts goals and penalty events per 15-minute window
    </div>`;
}

// ── Player ratings ────────────────────────────────────────────
function renderPlayerRatings(players, homeTeam, awayTeam) {
  if (!players?.length) return `<div style="color:var(--text3);text-align:center;padding:24px">No player data available for this match</div>`;

  const homePlayers = players.filter(p => p.side === 'home' || p.team === homeTeam).slice(0, 11);
  const awayPlayers = players.filter(p => p.side === 'away' || p.team === awayTeam).slice(0, 11);

  const ratingColor = r => r >= 8 ? '#ffd700' : r >= 7 ? 'var(--accent)' : r >= 6 ? 'var(--accent2)' : r >= 5 ? 'var(--text2)' : 'var(--loss)';

  const playerRow = p => `
    <div class="rating-row" onclick="togglePlayerStats(this)">
      <div class="rr-num">${p.number || ''}</div>
      <div class="rr-pos">${p.position}</div>
      <div class="rr-name">${p.name}${p.goals ? ` <span style="color:#ffd700">⚽×${p.goals}</span>` : ''}${p.assists ? ` <span style="color:var(--accent2)">🎯×${p.assists}</span>` : ''}</div>
      <div class="rr-rating-bar">
        <div style="width:${p.rating*10}%;height:4px;border-radius:2px;background:${ratingColor(p.rating)};transition:width .6s"></div>
      </div>
      <div class="rr-rating" style="color:${ratingColor(p.rating)}">${p.rating}</div>
      <div class="rr-stats" style="display:none">
        ${Object.entries(p.stats || {}).slice(0,8).map(([k,v]) => `<span class="rr-stat-badge">${k}: ${v}</span>`).join('')}
      </div>
    </div>`;

  const teamBlock = (team, players) => `
    <div>
      <div style="font-size:.68rem;letter-spacing:2px;color:var(--text3);margin-bottom:10px">${team.toUpperCase()}</div>
      ${players.map(playerRow).join('')}
    </div>`;

  return `
    <div style="font-size:.72rem;color:var(--text3);margin-bottom:14px;letter-spacing:.3px">
      Ratings computed from goals, assists, saves, passes and defensive actions. Click a player to see stats.
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">
      ${teamBlock(homeTeam, homePlayers)}
      ${teamBlock(awayTeam, awayPlayers)}
    </div>`;
}

function togglePlayerStats(row) {
  const statsEl = row.querySelector('.rr-stats');
  if (statsEl) statsEl.style.display = statsEl.style.display === 'none' ? 'flex' : 'none';
}

// ── Lineups ───────────────────────────────────────────────────
function renderLineups(raw) {
  const rosters = raw.rosters || [];
  if (!rosters.length) return `<div style="color:var(--text3);text-align:center;padding:24px">Lineup data not available</div>`;

  const sides = ['home', 'away'];
  const cols = sides.map(side => {
    const r = rosters.find(r => r.homeAway === side) || {};
    const team = r.team?.displayName || side;
    const starters = (r.roster || []).filter(p => p.starter);
    const subs     = (r.roster || []).filter(p => !p.starter);
    const playerEl = (p, isSub) => {
      const a = p.athlete || {};
      return `<div class="lineup-row ${isSub ? 'sub' : ''}">
        <span class="ln-num">${p.jersey || ''}</span>
        <span class="ln-pos">${a.position?.abbreviation || ''}</span>
        <span class="ln-name">${a.displayName || ''}</span>
      </div>`;
    };
    return `
      <div>
        <div style="font-size:.72rem;font-weight:600;margin-bottom:10px">${team}</div>
        ${starters.map(p => playerEl(p, false)).join('')}
        ${subs.length ? `
          <div style="font-size:.6rem;letter-spacing:1.5px;color:var(--text3);margin:10px 0 6px">SUBSTITUTES</div>
          ${subs.slice(0,7).map(p => playerEl(p, true)).join('')}
        ` : ''}
      </div>`;
  });

  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">${cols.join('')}</div>`;
}

// ── Tab switching ─────────────────────────────────────────────
function switchMATab(id, btn) {
  document.querySelectorAll('.ma-tab-panel').forEach(p => { p.style.display = 'none'; p.classList.remove('active'); });
  document.querySelectorAll('.ma-tab').forEach(b => b.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) { el.style.display = 'block'; el.classList.add('active'); }
  btn.classList.add('active');
}

// ── Fallback client-side parsing ──────────────────────────────
function parseBasicAnalytics(raw) {
  return {
    match_stats:    null,
    goal_timeline:  [],
    key_events:     [],
    pressure_map:   { labels: [], home: [], away: [] },
    player_ratings: [],
    shot_breakdown: null,
    xg_estimate:    null,
  };
}

function loadingHTML(msg) {
  return `<div style="display:flex;align-items:center;justify-content:center;padding:40px;gap:12px;color:rgba(255,255,255,.4)">
    <div style="width:16px;height:16px;border:2px solid rgba(255,255,255,.1);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite"></div>
    ${msg}
  </div>`;
}
function errHTML(m) { return `<div style="padding:20px;color:var(--loss);text-align:center">⚠ ${m}</div>`; }
