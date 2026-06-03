import httpx
from datetime import datetime
from typing import Optional

ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer"

LEAGUES = {
    "eng.1": "Premier League",
    "esp.1": "La Liga",
    "ger.1": "Bundesliga",
    "ita.1": "Serie A",
    "fra.1": "Ligue 1",
    "uefa.champions": "Champions League",
}


async def fetch_scoreboard(league: str = "eng.1") -> dict:
    """Fetch live/recent scoreboard for a league."""
    url = f"{ESPN_BASE}/{league}/scoreboard"
    async with httpx.AsyncClient(timeout=10.0) as client:
        res = await client.get(url)
        res.raise_for_status()
        return res.json()


async def fetch_standings(league: str = "eng.1") -> dict:
    """Fetch league standings/table."""
    url = f"{ESPN_BASE}/{league}/standings"
    async with httpx.AsyncClient(timeout=10.0) as client:
        res = await client.get(url)
        res.raise_for_status()
        return res.json()


async def fetch_team(league: str, team_id: str) -> dict:
    """Fetch a specific team's details."""
    url = f"{ESPN_BASE}/{league}/teams/{team_id}"
    async with httpx.AsyncClient(timeout=10.0) as client:
        res = await client.get(url)
        res.raise_for_status()
        return res.json()


async def fetch_match_summary(league: str, event_id: str) -> dict:
    """Fetch detailed summary for a specific match."""
    url = f"{ESPN_BASE}/{league}/summary"
    async with httpx.AsyncClient(timeout=10.0) as client:
        res = await client.get(url, params={"event": event_id})
        res.raise_for_status()
        return res.json()


async def fetch_all_teams(league: str = "eng.1") -> dict:
    """Fetch all teams in a league."""
    url = f"{ESPN_BASE}/{league}/teams"
    async with httpx.AsyncClient(timeout=10.0) as client:
        res = await client.get(url)
        res.raise_for_status()
        return res.json()


def parse_scoreboard(raw: dict) -> list[dict]:
    """Parse ESPN scoreboard response into clean match dicts."""
    matches = []
    for event in raw.get("events", []):
        competition = event.get("competitions", [{}])[0]
        competitors = competition.get("competitors", [])

        home = next((c for c in competitors if c.get("homeAway") == "home"), {})
        away = next((c for c in competitors if c.get("homeAway") == "away"), {})

        status_obj = event.get("status", {})
        status_type = status_obj.get("type", {})

        match = {
            "id": event.get("id"),
            "name": event.get("name"),
            "date": event.get("date"),
            "status": status_type.get("description", "Scheduled"),
            "status_short": status_type.get("shortDetail", ""),
            "completed": status_type.get("completed", False),
            "clock": status_obj.get("displayClock", ""),
            "period": status_obj.get("period", 0),
            "home_team": home.get("team", {}).get("displayName", ""),
            "home_team_abbr": home.get("team", {}).get("abbreviation", ""),
            "home_team_logo": home.get("team", {}).get("logo", ""),
            "home_score": home.get("score", "-"),
            "home_winner": home.get("winner", False),
            "away_team": away.get("team", {}).get("displayName", ""),
            "away_team_abbr": away.get("team", {}).get("abbreviation", ""),
            "away_team_logo": away.get("team", {}).get("logo", ""),
            "away_score": away.get("score", "-"),
            "away_winner": away.get("winner", False),
            "venue": competition.get("venue", {}).get("fullName", ""),
        }
        matches.append(match)
    return matches


def parse_standings(raw: dict) -> list[dict]:
    """Parse ESPN standings into clean rows."""
    rows = []
    groups = raw.get("standings", {}).get("entries", [])

    # ESPN standings can be nested under groups
    if not groups:
        for group in raw.get("children", []):
            entries = group.get("standings", {}).get("entries", [])
            groups.extend(entries)

    for entry in groups:
        team = entry.get("team", {})
        stats = {s["name"]: s.get("displayValue", s.get("value", 0))
                 for s in entry.get("stats", [])}
        rows.append({
            "team_id": team.get("id"),
            "team_name": team.get("displayName", ""),
            "team_abbr": team.get("abbreviation", ""),
            "team_logo": team.get("logos", [{}])[0].get("href", "") if team.get("logos") else "",
            "rank": entry.get("note", {}).get("rank", stats.get("rank", 0)),
            "played": stats.get("gamesPlayed", 0),
            "wins": stats.get("wins", 0),
            "draws": stats.get("ties", 0),
            "losses": stats.get("losses", 0),
            "goals_for": stats.get("pointsFor", 0),
            "goals_against": stats.get("pointsAgainst", 0),
            "goal_diff": stats.get("pointDifferential", 0),
            "points": stats.get("points", 0),
        })
    return rows
