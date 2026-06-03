from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
import logging

from fetcher import (
    fetch_scoreboard, fetch_standings, fetch_match_summary,
    fetch_all_teams, parse_scoreboard, parse_standings, LEAGUES
)
from analysis import (
    standings_dataframe, top_scoring_teams, form_summary,
    highest_scoring_matches, league_goal_stats
)
from scheduler import start_scheduler, stop_scheduler, get_cache, refresh_all_leagues

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: warm up cache then start background polling
    logger.info("Warming up data cache...")
    await refresh_all_leagues()
    start_scheduler()
    yield
    # Shutdown
    stop_scheduler()


app = FastAPI(
    title="Football Analysis API",
    description="Soccer stats powered by ESPN public API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve frontend static files
app.mount("/static", StaticFiles(directory="../frontend/static"), name="static")


@app.get("/", include_in_schema=False)
async def root():
    return FileResponse("../frontend/index.html")


# ── League info ──────────────────────────────────────────────

@app.get("/api/leagues")
async def get_leagues():
    """Return all available leagues."""
    return [{"id": k, "name": v} for k, v in LEAGUES.items()]


# ── Scoreboard ───────────────────────────────────────────────

@app.get("/api/scores/{league}")
async def get_scores(league: str):
    """Get live/recent scores for a league. Uses cache if available."""
    if league not in LEAGUES:
        raise HTTPException(status_code=404, detail=f"League '{league}' not found")
    cache = get_cache()
    if league in cache["scoreboards"]:
        return {"league": LEAGUES[league], "matches": cache["scoreboards"][league]}
    try:
        raw = await fetch_scoreboard(league)
        matches = parse_scoreboard(raw)
        return {"league": LEAGUES[league], "matches": matches}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ── Standings ────────────────────────────────────────────────

@app.get("/api/standings/{league}")
async def get_standings(league: str):
    """Get current league table."""
    if league not in LEAGUES:
        raise HTTPException(status_code=404, detail=f"League '{league}' not found")
    cache = get_cache()
    if league in cache["standings"]:
        return {"league": LEAGUES[league], "standings": cache["standings"][league]}
    try:
        raw = await fetch_standings(league)
        standings = parse_standings(raw)
        return {"league": LEAGUES[league], "standings": standings}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ── Analysis endpoints ───────────────────────────────────────

@app.get("/api/analysis/top-scorers/{league}")
async def get_top_scoring_teams(league: str, n: int = Query(5, ge=1, le=20)):
    """Top N teams by goals scored in a league."""
    if league not in LEAGUES:
        raise HTTPException(status_code=404, detail=f"League '{league}' not found")
    cache = get_cache()
    standings = cache["standings"].get(league)
    if not standings:
        try:
            raw = await fetch_standings(league)
            standings = parse_standings(raw)
        except Exception as e:
            raise HTTPException(status_code=502, detail=str(e))
    return {"league": LEAGUES[league], "top_teams": top_scoring_teams(standings, n)}


@app.get("/api/analysis/league-stats/{league}")
async def get_league_stats(league: str):
    """Aggregate goal stats for a league (total goals, avg/game, clean sheets)."""
    if league not in LEAGUES:
        raise HTTPException(status_code=404, detail=f"League '{league}' not found")
    cache = get_cache()
    matches = cache["scoreboards"].get(league, [])
    stats = league_goal_stats(matches)
    top = top_scoring_teams(cache["standings"].get(league, []), 5)
    high = highest_scoring_matches(matches, 5)
    return {
        "league": LEAGUES[league],
        "stats": stats,
        "top_scoring_teams": top,
        "highest_scoring_matches": high,
    }


@app.get("/api/analysis/form/{league}")
async def get_team_form(league: str, team: str = Query(..., description="Team display name")):
    """Get last-5 match form (W/D/L) for a team."""
    if league not in LEAGUES:
        raise HTTPException(status_code=404, detail=f"League '{league}' not found")
    cache = get_cache()
    matches = cache["scoreboards"].get(league, [])
    form = form_summary(matches, team)
    return {"team": team, "league": LEAGUES[league], "form": form}


# ── Match detail ─────────────────────────────────────────────

@app.get("/api/match/{league}/{event_id}")
async def get_match_detail(league: str, event_id: str):
    """Get detailed summary for a specific match."""
    if league not in LEAGUES:
        raise HTTPException(status_code=404, detail=f"League '{league}' not found")
    try:
        data = await fetch_match_summary(league, event_id)
        return data
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ── Teams ─────────────────────────────────────────────────────

@app.get("/api/teams/{league}")
async def get_teams(league: str):
    """Get all teams in a league."""
    if league not in LEAGUES:
        raise HTTPException(status_code=404, detail=f"League '{league}' not found")
    try:
        data = await fetch_all_teams(league)
        teams = [
            {
                "id": t["team"]["id"],
                "name": t["team"]["displayName"],
                "abbreviation": t["team"]["abbreviation"],
                "logo": t["team"].get("logos", [{}])[0].get("href", "") if t["team"].get("logos") else "",
            }
            for t in data.get("sports", [{}])[0].get("leagues", [{}])[0].get("teams", [])
        ]
        return {"league": LEAGUES[league], "teams": teams}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
