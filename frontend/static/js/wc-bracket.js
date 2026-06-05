/**
 * wc-bracket.js
 * Renders the FIFA World Cup 2026 knockout bracket as an interactive SVG.
 * Groups stage → Round of 32 → R16 → QF → SF → Final → Champion
 *
 * Before tournament: shows the seeding paths (which group winners face which runners-up).
 * After matches played: shows real team names + scores.
 */

// ── WC 2026 Bracket structure ─────────────────────────────────
// 48 teams, 12 groups (A-L), top 2 + 8 best 3rd-place teams advance → Round of 32 (32 teams)
// Simplified bracket showing the path from R32 → R16 → QF → SF → Final

const BRACKET_ROUNDS = ['R32', 'R16', 'QF', 'SF', 'FINAL'];

// R32 seedings (group winner vs runner-up pairings, confirmed by FIFA draw)
// Format: [Team A label, Team B label]
const R32_MATCHES = [
  // Top half of bracket
  ['1A', '2C'],
  ['1B', '2D'],
  ['1C', '2A'],
  ['1D', '2B'],
  ['1E', '2G'],
  ['1F', '2H'],
  ['1G', '2E'],
  ['1H', '2F'],
  // Bottom half
  ['1I', '2K'],
  ['1J', '2L'],
  ['1K', '2I'],
  ['1L', '2J'],
  // Best 3rd-place matchups (TBD based on group results)
  ['3rd (A/B/C/D)', '3rd (E/F/G/H)'],
  ['3rd (A/B/C/D)', '3rd (I/J/K/L)'],
  ['3rd (E/F/G/H)', '3rd (I/J/K/L)'],
  ['3rd best',      '3rd 4th'],
];

// Live bracket data — populated from ESPN API if available
let bracketData = {
  r32:   Array(16).fill({ home: null, away: null, homeScore: null, awayScore: null, winnerId: null }),
  r16:   Array(8).fill({ home: null, away: null, homeScore: null, awayScore: null, winnerId: null }),
  qf:    Array(4).fill({ home: null, away: null, homeScore: null, awayScore: null, winnerId: null }),
  sf:    Array(2).fill({ home: null, away: null, homeScore: null, awayScore: null, winnerId: null }),
  final: Array(1).fill({ home: null, away: null, homeScore: null, awayScore: null, winnerId: null }),
};

// ── Main render ───────────────────────────────────────────────
async function renderBracket(container) {
  container.innerHTML = `<div class="loading-row"><div class="spinner"></div> Building bracket…</div>`;

  // Try to fetch live bracket data from ESPN
  try {
    const raw = await espnFetch('FIFA.WORLD', 'bracket');
    parseLiveBracket(raw);
  } catch (e) {
    // No live data yet — show pre-tournament bracket
  }

  container.innerHTML = buildBracketHTML();
  attachBracketInteractions(container);
}

function parseLiveBracket(raw) {
  // ESPN bracket endpoint returns rounds array
  const rounds = raw.rounds || raw.bracket?.rounds || [];
  rounds.forEach(round => {
    const key = roundKey(round.name || round.type || '');
    if (!key) return;
    (round.matches || round.competitors || []).forEach((match, i) => {
      const comps = match.competitors || [];
      const home = comps[0] || {};
      const away = comps[1] || {};
      bracketData[key][i] = {
        home:       home.team?.displayName || home.displayName || null,
        away:       away.team?.displayName || away.displayName || null,
        homeScore:  home.score != null ? home.score : null,
        awayScore:  away.score != null ? away.score : null,
        winnerId:   match.winner?.id || null,
        status:     match.status?.type?.description || '',
      };
    });
  });
}

function roundKey(name) {
  const n = name.toLowerCase();
  if (n.includes('32') || n.includes('r32')) return 'r32';
  if (n.includes('16') || n.includes('r16')) return 'r16';
  if (n.includes('quarter')) return 'qf';
  if (n.includes('semi'))    return 'sf';
  if (n.includes('final') && !n.includes('semi') && !n.includes('quarter')) return 'final';
  return null;
}

// ── HTML builder ──────────────────────────────────────────────
function buildBracketHTML() {
  return `
    <div style="margin-bottom:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <div style="font-size:0.72rem;color:var(--text3);letter-spacing:1px">
        ✦ Bracket updates live once Round of 32 begins · Hover matches for details
      </div>
      <div style="display:flex;gap:8px;margin-left:auto">
        <button class="bracket-zoom-btn" id="zoom-out" onclick="bracketZoom(-1)"
          style="background:var(--bg3);border:1px solid var(--border);color:var(--text2);
          padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.8rem">−</button>
        <button class="bracket-zoom-btn" id="zoom-reset" onclick="bracketZoom(0)"
          style="background:var(--bg3);border:1px solid var(--border);color:var(--text2);
          padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.8rem">Reset</button>
        <button class="bracket-zoom-btn" id="zoom-in" onclick="bracketZoom(1)"
          style="background:var(--bg3);border:1px solid var(--border);color:var(--text2);
          padding:4px 10px;border-radius:5px;cursor:pointer;font-size:0.8rem">+</button>
      </div>
    </div>
    <div id="bracket-scroll-wrap" style="overflow-x:auto;overflow-y:auto;
      border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);
      max-height:72vh;cursor:grab">
      ${buildBracketSVG()}
    </div>
    <div id="bracket-tooltip" style="display:none;position:fixed;z-index:300;
      background:var(--card);border:1px solid var(--border);border-radius:8px;
      padding:10px 14px;font-size:0.8rem;pointer-events:none;max-width:200px;
      box-shadow:0 8px 24px rgba(0,0,0,0.4)"></div>
  `;
}

// ── SVG construction ──────────────────────────────────────────
const SLOT_H  = 52;   // height per match slot
const SLOT_W  = 180;  // width of one match box
const COL_GAP = 60;   // gap between rounds
const PAD     = 30;   // outer padding

function buildBracketSVG() {
  // 5 rounds: R32(16), R16(8), QF(4), SF(2), Final(1)
  const roundCounts = [16, 8, 4, 2, 1];
  const numRounds   = roundCounts.length;
  const totalH      = roundCounts[0] * SLOT_H * 2 + PAD * 2;
  const totalW      = numRounds * (SLOT_W + COL_GAP) + PAD * 2;

  let svgParts = [];

  // Column headers
  const headers = ['Round of 32', 'Round of 16', 'Quarter-Finals', 'Semi-Finals', 'Final'];
  headers.forEach((h, col) => {
    const x = PAD + col * (SLOT_W + COL_GAP) + SLOT_W / 2;
    svgParts.push(`<text x="${x}" y="${PAD - 8}" text-anchor="middle"
      font-family="var(--font-display)" font-size="11" letter-spacing="1.5"
      fill="rgba(255,255,255,0.25)">${h}</text>`);
  });

  // Draw matches for each round
  roundCounts.forEach((count, col) => {
    const roundKey = ['r32','r16','qf','sf','final'][col];
    const colX = PAD + col * (SLOT_W + COL_GAP);
    const spacing = totalH / count;

    for (let i = 0; i < count; i++) {
      const matchY = PAD + spacing * i + (spacing - SLOT_H) / 2;
      const match = bracketData[roundKey]?.[i] || {};
      const isR32 = col === 0;
      const home  = match.home  || R32_MATCHES[isR32 ? i : -1]?.[0] || '?';
      const away  = match.away  || R32_MATCHES[isR32 ? i : -1]?.[1] || '?';

      // Determine display labels
      const homeLabel = match.home || (isR32 ? R32_MATCHES[i][0] : '⟵ Winner');
      const awayLabel = match.away || (isR32 ? R32_MATCHES[i][1] : '⟵ Winner');
      const homeScore = match.homeScore != null ? match.homeScore : '';
      const awayScore = match.awayScore != null ? match.awayScore : '';
      const isLive    = match.status?.toLowerCase().includes('progress');
      const isDone    = match.winnerId != null || match.homeScore != null;

      const cardColor  = isLive ? 'rgba(245,166,35,0.12)' : isDone ? 'rgba(0,230,118,0.05)' : 'rgba(26,31,43,0.9)';
      const borderCol  = isLive ? 'rgba(245,166,35,0.5)'  : isDone ? 'rgba(0,230,118,0.2)'  : 'rgba(37,44,58,0.8)';

      svgParts.push(`
        <g class="bracket-match" data-round="${roundKey}" data-idx="${i}"
           data-home="${homeLabel}" data-away="${awayLabel}"
           data-hs="${homeScore}" data-as="${awayScore}" data-status="${match.status||''}">
          <!-- Card background -->
          <rect x="${colX}" y="${matchY}" width="${SLOT_W}" height="${SLOT_H}"
            rx="6" ry="6" fill="${cardColor}" stroke="${borderCol}" stroke-width="1"/>
          ${isLive ? `<rect x="${colX}" y="${matchY}" width="3" height="${SLOT_H}" rx="1" fill="#f5a623"/>` : ''}

          <!-- Divider -->
          <line x1="${colX+8}" y1="${matchY + SLOT_H/2}" x2="${colX+SLOT_W-8}" y2="${matchY + SLOT_H/2}"
            stroke="rgba(37,44,58,0.8)" stroke-width="1"/>

          <!-- Home team -->
          <text x="${colX+10}" y="${matchY + SLOT_H/2 - 8}"
            font-family="var(--font-body)" font-size="11" fill="rgba(232,234,240,0.9)"
            class="bracket-team-name">${truncate(homeLabel, 18)}</text>
          ${homeScore !== '' ? `
          <text x="${colX+SLOT_W-8}" y="${matchY + SLOT_H/2 - 8}"
            text-anchor="end" font-family="var(--font-mono)" font-size="13" font-weight="600"
            fill="${isLive ? '#f5a623' : 'rgba(232,234,240,0.95)'}">${homeScore}</text>` : ''}

          <!-- Away team -->
          <text x="${colX+10}" y="${matchY + SLOT_H/2 + 16}"
            font-family="var(--font-body)" font-size="11" fill="rgba(232,234,240,0.9)"
            class="bracket-team-name">${truncate(awayLabel, 18)}</text>
          ${awayScore !== '' ? `
          <text x="${colX+SLOT_W-8}" y="${matchY + SLOT_H/2 + 16}"
            text-anchor="end" font-family="var(--font-mono)" font-size="13" font-weight="600"
            fill="${isLive ? '#f5a623' : 'rgba(232,234,240,0.95)'}">${awayScore}</text>` : ''}
        </g>
      `);

      // Draw connector line to next round (except for final)
      if (col < numRounds - 1) {
        const nextCount    = roundCounts[col + 1];
        const nextSpacing  = totalH / nextCount;
        const nextMatchIdx = Math.floor(i / 2);
        const nextMatchY   = PAD + nextSpacing * nextMatchIdx + (nextSpacing - SLOT_H) / 2;
        const isTopOfPair  = i % 2 === 0;

        // Horizontal out from this match
        const outX = colX + SLOT_W;
        const outY = matchY + SLOT_H / 2;

        // Vertical junction point
        const junctionX = colX + SLOT_W + COL_GAP / 2;
        const targetY    = isTopOfPair
          ? nextMatchY + SLOT_H / 4
          : nextMatchY + (3 * SLOT_H) / 4;
        const inX  = colX + SLOT_W + COL_GAP;

        svgParts.push(`
          <path d="M${outX},${outY} H${junctionX} V${targetY} H${inX}"
            fill="none" stroke="rgba(37,44,58,0.9)" stroke-width="1.5"
            stroke-dasharray="${isDone ? 'none' : '4,3'}"/>
        `);
      }
    }
  });

  // Trophy icon at the end
  const finalMatchY = PAD + (totalH / 2) - SLOT_H / 2;
  const trophyX = PAD + numRounds * (SLOT_W + COL_GAP) - COL_GAP + 10;
  svgParts.push(`
    <text x="${trophyX}" y="${finalMatchY + SLOT_H / 2 + 6}"
      font-size="28" text-anchor="middle" fill="rgba(255,215,0,0.7)">🏆</text>
  `);

  return `
    <svg id="bracket-svg" viewBox="0 0 ${totalW + 50} ${totalH}"
      xmlns="http://www.w3.org/2000/svg"
      style="width:max(100%, ${totalW + 50}px);min-width:900px;display:block">
      ${svgParts.join('\n')}
    </svg>`;
}

// ── Bracket interactions ──────────────────────────────────────
let bracketScale = 1;

function attachBracketInteractions(container) {
  const wrap = container.querySelector('#bracket-scroll-wrap');
  const tip  = container.querySelector('#bracket-tooltip') || document.getElementById('bracket-tooltip');

  // Tooltip on hover
  container.querySelectorAll('.bracket-match').forEach(el => {
    el.style.cursor = 'pointer';
    el.addEventListener('mouseenter', (e) => {
      const d = e.currentTarget.dataset;
      const hasScore = d.hs !== '' && d.as !== '';
      tip.innerHTML = `
        <div style="font-size:0.68rem;color:var(--text3);letter-spacing:1px;margin-bottom:6px">
          ${d.round?.toUpperCase()} · MATCH ${+d.idx + 1}
        </div>
        <div style="display:flex;justify-content:space-between;gap:16px;font-weight:500">
          <span>${d.home}</span>
          ${hasScore ? `<span style="font-family:var(--font-mono);color:var(--accent)">${d.hs}</span>` : ''}
        </div>
        <div style="display:flex;justify-content:space-between;gap:16px;margin-top:4px">
          <span>${d.away}</span>
          ${hasScore ? `<span style="font-family:var(--font-mono);color:var(--accent)">${d.as}</span>` : ''}
        </div>
        ${d.status ? `<div style="font-size:0.68rem;color:var(--text2);margin-top:6px">${d.status}</div>` : ''}
      `;
      tip.style.display = 'block';
    });

    el.addEventListener('mousemove', (e) => {
      tip.style.left = (e.clientX + 14) + 'px';
      tip.style.top  = (e.clientY - 10) + 'px';
    });

    el.addEventListener('mouseleave', () => {
      tip.style.display = 'none';
    });
  });

  // Drag to scroll
  let dragging = false, startX, startY, scrollLeft, scrollTop;
  wrap.addEventListener('mousedown', e => {
    dragging = true; wrap.style.cursor = 'grabbing';
    startX = e.pageX - wrap.offsetLeft; startY = e.pageY - wrap.offsetTop;
    scrollLeft = wrap.scrollLeft; scrollTop = wrap.scrollTop;
  });
  wrap.addEventListener('mouseleave', () => { dragging = false; wrap.style.cursor = 'grab'; });
  wrap.addEventListener('mouseup', () => { dragging = false; wrap.style.cursor = 'grab'; });
  wrap.addEventListener('mousemove', e => {
    if (!dragging) return;
    e.preventDefault();
    wrap.scrollLeft = scrollLeft - (e.pageX - wrap.offsetLeft - startX);
    wrap.scrollTop  = scrollTop  - (e.pageY - wrap.offsetTop  - startY);
  });
}

function bracketZoom(dir) {
  const svg = document.getElementById('bracket-svg');
  if (!svg) return;
  if (dir === 0) { bracketScale = 1; }
  else { bracketScale = Math.max(0.5, Math.min(2, bracketScale + dir * 0.15)); }
  svg.style.transform = `scale(${bracketScale})`;
  svg.style.transformOrigin = 'top left';
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}
