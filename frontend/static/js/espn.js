/**
 * espn.js — All ESPN API calls happen here in the browser.
 * ESPN blocks server-side requests but works fine from browser JS.
 */

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
// const API_BASE  = 'http://localhost:8000/api';  // our FastAPI backend
const API_BASE = `${window.location.origin}/api`;

// ── Core ESPN fetch ───────────────────────────────────────────
async function espnFetch(league, endpoint, params = {}) {
  const url = new URL(`${ESPN_BASE}/${league}/${endpoint}`);
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`ESPN ${res.status} for ${league}/${endpoint}`);
  return res.json();
}

// ── Backend analysis fetch ────────────────────────────────────
async function backendPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Backend ${res.status}`);
  return res.json();
}

async function backendGet(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`Backend ${res.status}`);
  return res.json();
}

// ── Scoreboard: fetch from ESPN, send to backend for analysis ─
async function getScoreboard(league) {
  const raw = await espnFetch(league, 'scoreboard');
  // Also run analysis on backend (it parses + computes stats)
  const analysis = await backendPost('/analysis/scoreboard', raw);
  return analysis; // { matches, stats, highlights }
}

// ── Standings: fetch ESPN, parse on backend ───────────────────
async function getStandings(league) {
  const raw = await espnFetch(league, 'standings');
  const result = await backendPost('/analysis/standings', raw);
  return result.standings || [];
}

// ── Top scoring teams: fetch standings ESPN, analyse backend ──
async function getTopScorers(league, standings) {
  const result = await backendPost('/analysis/top-scorers', { standings, n: 8 });
  return result.top_teams || [];
}

// ── Match detail: fetch ESPN directly ────────────────────────
async function getMatchSummary(league, eventId) {
  return espnFetch(league, 'summary', { event: eventId });
}

// ── WC-specific ───────────────────────────────────────────────
async function getWCScoreboard() {
  return espnFetch('FIFA.WORLD', 'scoreboard');
}

async function getWCStandings() {
  // Returns nested group standings from ESPN
  return espnFetch('FIFA.WORLD', 'standings');
}

async function getWCLeaders() {
  return espnFetch('FIFA.WORLD', 'leaders');
}

// ── Parse WC groups from ESPN standings response ──────────────
function parseWCGroups(raw) {
  const groups = {};

  function walk(node, groupName) {
    if (!node || typeof node !== 'object') return;
    const name = groupName || node.name || node.abbreviation || '';
    const entries = node.standings?.entries || node.entries || [];

    if (entries.length > 0 && name) {
      const teams = entries.map(e => {
        const team = e.team || {};
        const stats = Object.fromEntries(
          (e.stats || []).map(s => [s.name, s.displayValue ?? s.value ?? 0])
        );
        const logos = team.logos || [];
        return {
          team_id:       team.id,
          team_name:     team.displayName || '',
          team_abbr:     team.abbreviation || '',
          team_logo:     logos[0]?.href || '',
          played:        +stats.gamesPlayed || 0,
          wins:          +stats.wins || 0,
          draws:         +stats.ties || 0,
          losses:        +stats.losses || 0,
          goals_for:     +stats.pointsFor || 0,
          goals_against: +stats.pointsAgainst || 0,
          goal_diff:     +stats.pointDifferential || 0,
          points:        +stats.points || 0,
        };
      });
      groups[name] = teams;
    }

    for (const child of node.children || []) {
      walk(child, '');
    }
  }

  walk(raw, '');
  return groups;
}

// ── Parse top scorers from ESPN leaders response ──────────────
function parseTopScorers(raw) {
  const players = [];
  for (const cat of raw.categories || []) {
    if (/goal|scor/i.test(cat.name || '')) {
      for (const leader of cat.leaders || []) {
        const a = leader.athlete || {};
        const t = leader.team || {};
        players.push({
          name:      a.displayName || '',
          team:      t.displayName || '',
          team_logo: (t.logos || [])[0]?.href || '',
          goals:     leader.value || 0,
        });
      }
    }
  }
  return players.sort((a,b) => b.goals - a.goals);
}

// ── WC Player stats (called from browser) ────────────────────

async function getWCLeadersByCategory() {
  // ESPN leaders endpoint returns multiple stat categories
  const raw = await espnFetch('FIFA.WORLD', 'leaders');
  return parseAllLeaderCategories(raw);
}

function parseAllLeaderCategories(raw) {
  const result = {
    goals: [], assists: [], saves: [], cleanSheets: [],
    yellowCards: [], redCards: [], minutesPlayed: [],
  };

  const catMap = {
    goals:         ['goals', 'goal'],
    assists:       ['assists', 'assist'],
    saves:         ['saves', 'save'],
    cleanSheets:   ['cleansheets', 'clean sheet', 'clean_sheet'],
    yellowCards:   ['yellowcards', 'yellow card', 'yellow'],
    redCards:      ['redcards', 'red card', 'red'],
    minutesPlayed: ['minutesplayed', 'minutes played', 'minutes'],
  };

  for (const cat of (raw.categories || [])) {
    const catName = (cat.name || cat.displayName || '').toLowerCase().replace(/\s+/g, '');
    for (const [key, aliases] of Object.entries(catMap)) {
      if (aliases.some(a => catName.includes(a.replace(/\s+/g,'')))) {
        result[key] = (cat.leaders || []).map(l => parseLeader(l));
        break;
      }
    }
  }
  return result;
}

function parseLeader(l) {
  const a = l.athlete || {};
  const t = l.team   || {};
  return {
    id:        a.id || '',
    name:      a.displayName || a.shortName || '',
    shortName: a.shortName   || a.displayName || '',
    team:      t.displayName || t.shortDisplayName || '',
    teamAbbr:  t.abbreviation || '',
    teamLogo:  (t.logos || [])[0]?.href || t.logo || '',
    flag:      a.flag?.href || a.headshot?.href || '',
    headshot:  a.headshot?.href || '',
    position:  a.position?.displayName || a.position?.abbreviation || '',
    value:     +(l.value || l.displayValue || 0),
    display:   l.displayValue || String(l.value || 0),
  };
}

// Fantasy points computation (Dream11-style, soccer version)
function computeSoccerFantasy(player, stats) {
  let pts = 0;
  const breakdown = {};

  const goals   = stats.goals   || 0;
  const assists  = stats.assists  || 0;
  const saves    = stats.saves    || 0;
  const clean    = stats.cleanSheets || 0;
  const yellow   = stats.yellowCards || 0;
  const red      = stats.redCards    || 0;
  const mins     = stats.minutesPlayed || 0;
  const isGK     = /goalkeeper|keeper|gk/i.test(player.position || '');

  breakdown.played_bonus = mins >= 60 ? 4 : mins > 0 ? 2 : 0;
  breakdown.goals        = goals   * (isGK ? 12 : player.position?.toLowerCase().includes('defend') ? 10 : 8);
  breakdown.assists      = assists * 5;
  breakdown.saves        = saves   * 1;          // per save for GKs
  breakdown.clean_sheet  = clean   * (isGK ? 12 : 0);
  breakdown.yellow_card  = yellow  * -2;
  breakdown.red_card     = red     * -4;

  pts = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { total: pts, breakdown };
}

// Build fantasy leaderboard by merging all stat categories
function buildWCFantasyLeaderboard(categories) {
  const playerMap = {};

  const merge = (list, statKey) => {
    list.forEach(p => {
      if (!playerMap[p.id || p.name]) {
        playerMap[p.id || p.name] = { ...p, stats: {} };
      }
      playerMap[p.id || p.name].stats[statKey] = p.value;
    });
  };

  merge(categories.goals,         'goals');
  merge(categories.assists,        'assists');
  merge(categories.saves,          'saves');
  merge(categories.cleanSheets,    'cleanSheets');
  merge(categories.yellowCards,    'yellowCards');
  merge(categories.redCards,       'redCards');
  merge(categories.minutesPlayed,  'minutesPlayed');

  return Object.values(playerMap)
    .map(p => {
      const fp = computeSoccerFantasy(p, p.stats);
      return { ...p, fantasyPoints: fp.total, breakdown: fp.breakdown };
    })
    .filter(p => p.fantasyPoints > 0)
    .sort((a, b) => b.fantasyPoints - a.fantasyPoints);
}
