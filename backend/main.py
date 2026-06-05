"""
Football Analysis API
ESPN data is fetched directly in the browser JS (ESPN blocks server IPs).
This backend serves static files and provides analysis endpoints on data
POSTed to it from the browser.
"""
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
from typing import List
import logging

from fetcher import LEAGUES, SERIES_META
from analysis import (
    standings_dataframe, top_scoring_teams,
    form_summary, highest_scoring_matches, league_goal_stats
)

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Football Analysis API ready — ESPN data fetched client-side")
    yield


app = FastAPI(title="Football Analysis API", version="3.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

app.mount(
    "/static",
    StaticFiles(directory=str(FRONTEND_DIR / "static")),
    name="static",
)


@app.get("/", include_in_schema=False)
async def root():
    return FileResponse(str(FRONTEND_DIR / "index.html"))


# ── Meta ──────────────────────────────────────────────────────
@app.get("/api/leagues")
async def get_leagues():
    return [{"id": k, "name": v} for k, v in LEAGUES.items()]


@app.get("/api/config")
async def get_config():
    """Return ESPN base URL and league slugs so JS can call ESPN directly."""
    return {
        "espn_base": "https://site.api.espn.com/apis/site/v2/sports/soccer",
        "leagues": LEAGUES,
        "series_meta": SERIES_META,
    }


# ── Analysis (browser posts raw ESPN data; backend analyses it) ──
@app.post("/api/analysis/standings")
async def analyse_standings(payload: dict):
    """Receive raw ESPN standings JSON from browser, return parsed standings."""
    from fetcher import parse_standings
    try:
        rows = parse_standings(payload)
        return {"standings": rows}
    except Exception as e:
        raise HTTPException(400, str(e))


@app.post("/api/analysis/scoreboard")
async def analyse_scoreboard(payload: dict):
    """Receive raw ESPN scoreboard JSON, return stats + highlights."""
    from fetcher import parse_scoreboard
    try:
        matches = parse_scoreboard(payload)
        stats = league_goal_stats(matches)
        highlights = highest_scoring_matches(matches, 5)
        return {
            "matches": matches,
            "stats": stats,
            "highlights": highlights,
        }
    except Exception as e:
        raise HTTPException(400, str(e))


@app.post("/api/analysis/top-scorers")
async def analyse_top_scorers(payload: dict):
    """Receive parsed standings list, return top scoring teams."""
    try:
        standings = payload.get("standings", [])
        n = payload.get("n", 5)
        top = top_scoring_teams(standings, n)
        return {"top_teams": top}
    except Exception as e:
        raise HTTPException(400, str(e))
