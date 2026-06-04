from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from contextlib import asynccontextmanager
import httpx
import logging

from fetcher import (
    parse_scoreboard, parse_standings, parse_top_scorers,
    LEAGUES, ESPN_BASE
)
from analysis import (
    standings_dataframe, top_scoring_teams,
    form_summary, highest_scoring_matches, league_goal_stats
)
from scheduler import start_scheduler, stop_scheduler, get_cache, refresh_all_leagues

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Origin": "https://www.espn.com",
    "Referer": "https://www.espn.com/",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Warming up cache...")
    await refresh_all_leagues()
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title="Football Analysis API", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="../frontend/static"), name="static")


@app.get("/", include_in_schema=False)
async def root():
    return FileResponse("../frontend/index.html")


# ── Proxy ESPN API calls (browser-only API; backend proxies them) ──────────────
@app.get("/api/proxy/espn/{league}/{endpoint}")
async def proxy_espn(league: str, endpoint: str, request: Request):
    """
    Proxy ESPN API calls through the backend so browser requests aren't blocked.
    Passes query params through transparently.
    """
    params = dict(request.query_params)
    url = f"{ESPN_BASE}/{league}/{endpoint}"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url, params=params, headers=BROWSER_HEADERS)
            if r.status_code == 200:
                return r.json()
            raise HTTPException(r.status_code, f"ESPN returned {r.status_code}")
    except httpx.HTTPError as e:
        raise HTTPException(502, str(e))


# ── Leagues ───────────────────────────────────────────────────
@app.get("/api/leagues")
async def get_leagues():
    return [{"id": k, "name": v} for k, v in LEAGUES.items()]


# ── Scores ────────────────────────────────────────────────────
@app.get("/api/scores/{league}")
async def get_scores(league: str):
    if league not in LEAGUES:
        raise HTTPException(404, f"League '{league}' not found")
    cache = get_cache()
    if league in cache["scoreboards"]:
        return {"league": LEAGUES[league], "matches": cache["scoreboards"][league]}
    try:
        url = f"{ESPN_BASE}/{league}/scoreboard"
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url, headers=BROWSER_HEADERS)
            raw = r.json()
        matches = parse_scoreboard(raw)
        return {"league": LEAGUES[league], "matches": matches}
    except Exception as e:
        raise HTTPException(502, str(e))


# ── Standings ─────────────────────────────────────────────────
@app.get("/api/standings/{league}")
async def get_standings(league: str):
    if league not in LEAGUES:
        raise HTTPException(404, f"League '{league}' not found")
    cache = get_cache()
    if league in cache["standings"] and cache["standings"][league]:
        return {"league": LEAGUES[league], "standings": cache["standings"][league]}
    try:
        url = f"{ESPN_BASE}/{league}/standings"
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url, headers=BROWSER_HEADERS)
            raw = r.json()
        standings = parse_standings(raw)
        return {"league": LEAGUES[league], "standings": standings, "raw_keys": list(raw.keys())}
    except Exception as e:
        raise HTTPException(502, str(e))


# ── Analysis ──────────────────────────────────────────────────
@app.get("/api/analysis/league-stats/{league}")
async def get_league_stats(league: str):
    if league not in LEAGUES:
        raise HTTPException(404, f"League '{league}' not found")
    cache = get_cache()
    matches = cache["scoreboards"].get(league, [])
    standings = cache["standings"].get(league, [])
    stats = league_goal_stats(matches)
    top = top_scoring_teams(standings, 5)
    high = highest_scoring_matches(matches, 5)
    return {
        "league": LEAGUES[league],
        "stats": stats,
        "top_scoring_teams": top,
        "highest_scoring_matches": high,
    }


# ── Match detail ──────────────────────────────────────────────
@app.get("/api/match/{league}/{event_id}")
async def get_match_detail(league: str, event_id: str):
    if league not in LEAGUES:
        raise HTTPException(404, f"League '{league}' not found")
    try:
        url = f"{ESPN_BASE}/{league}/summary"
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url, params={"event": event_id}, headers=BROWSER_HEADERS)
            return r.json()
    except Exception as e:
        raise HTTPException(502, str(e))


# ── Teams ─────────────────────────────────────────────────────
@app.get("/api/teams/{league}")
async def get_teams(league: str):
    if league not in LEAGUES:
        raise HTTPException(404, f"League '{league}' not found")
    try:
        url = f"{ESPN_BASE}/{league}/teams"
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url, headers=BROWSER_HEADERS)
            data = r.json()
        teams = [
            {
                "id": t["team"]["id"],
                "name": t["team"]["displayName"],
                "abbreviation": t["team"]["abbreviation"],
                "logo": (t["team"].get("logos") or [{}])[0].get("href", ""),
            }
            for t in data.get("sports", [{}])[0].get("leagues", [{}])[0].get("teams", [])
        ]
        return {"league": LEAGUES[league], "teams": teams}
    except Exception as e:
        raise HTTPException(502, str(e))


# ── World Cup specific endpoints ──────────────────────────────
@app.get("/api/worldcup/groups")
async def get_wc_groups():
    """Fetch World Cup group standings from ESPN."""
    try:
        url = f"{ESPN_BASE}/FIFA.WORLD/standings"
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url, headers=BROWSER_HEADERS)
            raw = r.json()

        # ESPN WC standings come grouped by group letter under children
        groups = {}
        raw_keys = list(raw.keys())

        def walk(node, depth=0):
            if not isinstance(node, dict):
                return
            name = node.get("name", "") or node.get("abbreviation", "")
            entries = node.get("standings", {}).get("entries", [])
            if entries and name:
                teams = []
                for e in entries:
                    team = e.get("team", {})
                    stats = {s["name"]: s.get("displayValue", s.get("value", 0))
                             for s in e.get("stats", [])}
                    logos = team.get("logos") or []
                    logo = logos[0].get("href", "") if logos else ""
                    teams.append({
                        "team_id": team.get("id"),
                        "team_name": team.get("displayName", ""),
                        "team_abbr": team.get("abbreviation", ""),
                        "team_logo": logo,
                        "played": stats.get("gamesPlayed", 0),
                        "wins": stats.get("wins", 0),
                        "draws": stats.get("ties", 0),
                        "losses": stats.get("losses", 0),
                        "goals_for": stats.get("pointsFor", 0),
                        "goals_against": stats.get("pointsAgainst", 0),
                        "goal_diff": stats.get("pointDifferential", 0),
                        "points": stats.get("points", 0),
                    })
                groups[name] = teams
            for child in node.get("children", []):
                walk(child, depth + 1)

        walk(raw)
        return {"groups": groups, "raw_keys": raw_keys}
    except Exception as e:
        raise HTTPException(502, str(e))


@app.get("/api/worldcup/scorers")
async def get_wc_scorers():
    """Fetch World Cup top scorers."""
    try:
        url = f"{ESPN_BASE}/FIFA.WORLD/leaders"
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url, headers=BROWSER_HEADERS)
            raw = r.json()
        scorers = parse_top_scorers(raw)
        return {"scorers": scorers, "raw_keys": list(raw.keys())}
    except Exception as e:
        raise HTTPException(502, str(e))


@app.get("/api/worldcup/schedule")
async def get_wc_schedule():
    """All WC fixtures from ESPN scoreboard."""
    try:
        url = f"{ESPN_BASE}/FIFA.WORLD/scoreboard"
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url, headers=BROWSER_HEADERS)
            raw = r.json()
        matches = parse_scoreboard(raw)
        return {
            "matches": matches,
            "season": raw.get("season", {}),
            "leagues": [l.get("name") for l in raw.get("leagues", [])],
        }
    except Exception as e:
        raise HTTPException(502, str(e))


# ── Debug endpoint ─────────────────────────────────────────────
@app.get("/api/debug/{league}/{endpoint}")
async def debug_raw(league: str, endpoint: str):
    """Returns raw ESPN response for debugging structure issues."""
    try:
        url = f"{ESPN_BASE}/{league}/{endpoint}"
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url, headers=BROWSER_HEADERS)
        if r.status_code != 200:
            return {"error": f"ESPN returned {r.status_code}", "body": r.text[:300]}
        raw = r.json()
        # Return structure summary
        def summarise(node, depth=0):
            if depth > 3: return "..."
            if isinstance(node, dict):
                return {k: summarise(v, depth+1) for k, v in list(node.items())[:8]}
            elif isinstance(node, list):
                return [summarise(node[0], depth+1), f"... ({len(node)} items)"] if node else []
            return type(node).__name__
        return {"structure": summarise(raw), "top_keys": list(raw.keys())}
    except Exception as e:
        return {"error": str(e)}
