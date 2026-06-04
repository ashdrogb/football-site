"""
Football data fetcher using ESPN public API.
NOTE: ESPN API only works from browser (CORS-based allowlist).
      All ESPN calls happen in frontend/static/js/app.js directly.
      This module provides URL builders and parsers for any server-side use.
"""
import httpx

ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer"

LEAGUES = {
    "eng.1":          "Premier League",
    "esp.1":          "La Liga",
    "ger.1":          "Bundesliga",
    "ita.1":          "Serie A",
    "fra.1":          "Ligue 1",
    "uefa.champions": "Champions League",
    "FIFA.WORLD":     "World Cup 2026",
}

WC_GROUPS = {
    "A": ["Qatar","Ecuador","Senegal","Netherlands"],
    "B": ["England","Iran","United States","Wales"],
    "C": ["Argentina","Saudi Arabia","Mexico","Poland"],
    "D": ["France","Australia","Denmark","Tunisia"],
    "E": ["Spain","Costa Rica","Germany","Japan"],
    "F": ["Belgium","Canada","Morocco","Croatia"],
    "G": ["Brazil","Serbia","Switzerland","Cameroon"],
    "H": ["Portugal","Ghana","Uruguay","South Korea"],
}


def espn_url(league: str, endpoint: str) -> str:
    return f"{ESPN_BASE}/{league}/{endpoint}"


def parse_scoreboard(raw: dict) -> list:
    matches = []
    for event in raw.get("events", []):
        comp = event.get("competitions", [{}])[0]
        competitors = comp.get("competitors", [])
        home = next((c for c in competitors if c.get("homeAway") == "home"), {})
        away = next((c for c in competitors if c.get("homeAway") == "away"), {})
        status_obj = event.get("status", {})
        status_type = status_obj.get("type", {})
        matches.append({
            "id": event.get("id"),
            "name": event.get("name", ""),
            "date": event.get("date"),
            "status": status_type.get("description", "Scheduled"),
            "status_short": status_type.get("shortDetail", ""),
            "completed": status_type.get("completed", False),
            "live": status_type.get("state", "") == "in",
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
            "venue": comp.get("venue", {}).get("fullName", ""),
            "group": comp.get("groups", {}).get("name", ""),
        })
    return matches


def parse_standings(raw: dict) -> list:
    """
    Robust parser that handles ESPN's multiple standings response shapes:
    - flat: raw['standings']['entries']
    - grouped: raw['children'][n]['standings']['entries']
    - league-wrapped: raw['children'][n]['children'][m]['standings']['entries']
    """
    rows = []

    def extract_entries(node):
        results = []
        if isinstance(node, dict):
            if "entries" in node:
                results.extend(node["entries"])
            for child in node.get("children", []):
                results.extend(extract_entries(child))
            if "standings" in node:
                results.extend(extract_entries(node["standings"]))
        elif isinstance(node, list):
            for item in node:
                results.extend(extract_entries(item))
        return results

    entries = extract_entries(raw)

    seen = set()
    for entry in entries:
        team = entry.get("team", {})
        tid = team.get("id")
        if not tid or tid in seen:
            continue
        seen.add(tid)
        stats = {s["name"]: s.get("displayValue", s.get("value", 0))
                 for s in entry.get("stats", [])}
        logos = team.get("logos") or team.get("logo") or []
        if isinstance(logos, str):
            logo = logos
        elif logos:
            logo = logos[0].get("href", "")
        else:
            logo = ""
        rows.append({
            "team_id": tid,
            "team_name": team.get("displayName", ""),
            "team_abbr": team.get("abbreviation", ""),
            "team_logo": logo,
            "rank": stats.get("rank", 0),
            "played": stats.get("gamesPlayed", 0),
            "wins": stats.get("wins", 0),
            "draws": stats.get("ties", 0),
            "losses": stats.get("losses", 0),
            "goals_for": stats.get("pointsFor", 0),
            "goals_against": stats.get("pointsAgainst", 0),
            "goal_diff": stats.get("pointDifferential", 0),
            "points": stats.get("points", 0),
        })

    # Sort by points desc
    rows.sort(key=lambda x: (
        -int(str(x["points"]).replace("+","").replace("-","0") or 0),
        -int(str(x["goals_for"]).replace("+","").replace("-","0") or 0),
    ))
    return rows


def parse_top_scorers(raw: dict) -> list:
    """Parse ESPN leaders/scorers response."""
    players = []
    categories = raw.get("categories", [])
    for cat in categories:
        if cat.get("name", "").lower() in ("goals", "scoring", "scorers"):
            for leader in cat.get("leaders", []):
                athlete = leader.get("athlete", {})
                team = leader.get("team", {})
                players.append({
                    "name": athlete.get("displayName", ""),
                    "team": team.get("displayName", ""),
                    "team_logo": (team.get("logos") or [{}])[0].get("href", ""),
                    "goals": leader.get("value", 0),
                    "flag": athlete.get("flag", {}).get("href", ""),
                })
    return sorted(players, key=lambda x: -int(x["goals"] or 0))
