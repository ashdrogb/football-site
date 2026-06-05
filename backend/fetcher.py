"""
Configuration and parsers for ESPN soccer API.
NOTE: All ESPN HTTP calls happen in the browser (frontend JS).
      This module provides the league config and response parsers
      used by the analysis endpoints when browser POSTs raw ESPN data.
"""

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

SERIES_META = {
    "FIFA.WORLD": {
        "name": "FIFA World Cup 2026",
        "start": "2026-06-11",
        "end": "2026-07-19",
        "final_venue": "MetLife Stadium, New York/NJ",
        "hosts": ["USA", "Mexico", "Canada"],
        "teams": 48,
        "matches": 104,
        "groups": 12,
    }
}


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
    Robust recursive parser for ESPN standings — handles flat, grouped,
    and deeply nested structures.
    """
    def extract_entries(node):
        results = []
        if isinstance(node, dict):
            if "entries" in node:
                results.extend(node["entries"])
            for child in node.get("children", []):
                results.extend(extract_entries(child))
            if "standings" in node and isinstance(node["standings"], dict):
                results.extend(extract_entries(node["standings"]))
        elif isinstance(node, list):
            for item in node:
                results.extend(extract_entries(item))
        return results

    entries = extract_entries(raw)
    seen, rows = set(), []

    for entry in entries:
        team = entry.get("team", {})
        tid = team.get("id")
        if not tid or tid in seen:
            continue
        seen.add(tid)

        stats = {s["name"]: s.get("displayValue", s.get("value", 0))
                 for s in entry.get("stats", [])}
        logos = team.get("logos") or []
        logo = logos[0].get("href", "") if logos else team.get("logo", "")

        def num(v):
            try: return int(float(str(v).replace("+","").replace("—","0") or 0))
            except: return 0

        rows.append({
            "team_id": tid,
            "team_name": team.get("displayName", ""),
            "team_abbr": team.get("abbreviation", ""),
            "team_logo": logo,
            "played":       num(stats.get("gamesPlayed", 0)),
            "wins":         num(stats.get("wins", 0)),
            "draws":        num(stats.get("ties", 0)),
            "losses":       num(stats.get("losses", 0)),
            "goals_for":    num(stats.get("pointsFor", 0)),
            "goals_against":num(stats.get("pointsAgainst", 0)),
            "goal_diff":    num(stats.get("pointDifferential", 0)),
            "points":       num(stats.get("points", 0)),
        })

    rows.sort(key=lambda x: (-x["points"], -x["goals_for"]))
    return rows
