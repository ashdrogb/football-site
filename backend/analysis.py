import pandas as pd
from typing import List


def standings_dataframe(standings: list[dict]) -> pd.DataFrame:
    """Convert standings list into a sorted DataFrame."""
    if not standings:
        return pd.DataFrame()
    df = pd.DataFrame(standings)
    numeric_cols = ["played", "wins", "draws", "losses",
                    "goals_for", "goals_against", "goal_diff", "points"]
    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0).astype(int)
    df = df.sort_values("points", ascending=False).reset_index(drop=True)
    df.index += 1  # 1-based rank
    return df


def top_scoring_teams(standings: list[dict], n: int = 5) -> list[dict]:
    """Return top N teams by goals scored."""
    df = standings_dataframe(standings)
    if df.empty:
        return []
    top = df.nlargest(n, "goals_for")[["team_name", "goals_for", "team_logo"]]
    return top.to_dict(orient="records")


def form_summary(matches: list[dict], team_name: str, last_n: int = 5) -> list[str]:
    """Return W/D/L form for the last N matches of a team."""
    relevant = [
        m for m in matches
        if team_name in (m.get("home_team", ""), m.get("away_team", ""))
        and m.get("completed")
    ]
    recent = relevant[-last_n:]
    form = []
    for m in recent:
        is_home = m["home_team"] == team_name
        try:
            hs = int(m["home_score"])
            as_ = int(m["away_score"])
        except (ValueError, TypeError):
            form.append("?")
            continue
        if is_home:
            form.append("W" if hs > as_ else ("D" if hs == as_ else "L"))
        else:
            form.append("W" if as_ > hs else ("D" if hs == as_ else "L"))
    return form


def match_results_dataframe(matches: list[dict]) -> pd.DataFrame:
    """Convert matches list to DataFrame with goal diff column."""
    if not matches:
        return pd.DataFrame()
    df = pd.DataFrame(matches)
    completed = df[df["completed"] == True].copy()
    if completed.empty:
        return completed
    completed["home_score"] = pd.to_numeric(completed["home_score"], errors="coerce")
    completed["away_score"] = pd.to_numeric(completed["away_score"], errors="coerce")
    completed["goal_diff"] = (completed["home_score"] - completed["away_score"]).abs()
    return completed


def highest_scoring_matches(matches: list[dict], n: int = 5) -> list[dict]:
    """Return N matches with the most combined goals."""
    df = match_results_dataframe(matches)
    if df.empty:
        return []
    df["total_goals"] = df["home_score"] + df["away_score"]
    top = df.nlargest(n, "total_goals")[
        ["home_team", "away_team", "home_score", "away_score", "total_goals", "date"]
    ]
    return top.to_dict(orient="records")


def league_goal_stats(matches: list[dict]) -> dict:
    """Return aggregate stats: total goals, avg per game, clean sheets."""
    df = match_results_dataframe(matches)
    if df.empty:
        return {}
    total_goals = int(df["home_score"].sum() + df["away_score"].sum())
    total_matches = len(df)
    avg_goals = round(total_goals / total_matches, 2) if total_matches else 0
    clean_sheets = int(
        (df["home_score"] == 0).sum() + (df["away_score"] == 0).sum()
    )
    return {
        "total_goals": total_goals,
        "total_matches": total_matches,
        "avg_goals_per_match": avg_goals,
        "clean_sheets": clean_sheets,
    }


# ── Match event analytics (called via POST /api/analysis/match) ──

def analyse_match_summary(raw: dict) -> dict:
    """
    Takes a raw ESPN summary response (POSTed from browser)
    and returns a rich analytics object ready for the frontend.
    """
    import pandas as pd

    result = {
        "match_stats":    _parse_team_stats(raw),
        "goal_timeline":  _parse_goals(raw),
        "key_events":     _parse_key_events(raw),
        "pressure_map":   _parse_pressure_map(raw),
        "player_ratings": _parse_player_ratings(raw),
        "shot_breakdown": _parse_shot_breakdown(raw),
        "xg_estimate":    _compute_xg(raw),
    }
    return result


def _parse_team_stats(raw: dict) -> dict:
    """Extract and normalise per-team statistics."""
    comps = raw.get("header", {}).get("competitions", [{}])
    comp  = comps[0] if comps else {}
    competitors = comp.get("competitors", [])

    home = next((c for c in competitors if c.get("homeAway") == "home"), {})
    away = next((c for c in competitors if c.get("homeAway") == "away"), {})

    # Also try boxscore teams
    bs_teams = raw.get("boxscore", {}).get("teams", [])
    if bs_teams and not home.get("statistics"):
        home_bs = next((t for t in bs_teams if t.get("homeAway") == "home"), {})
        away_bs = next((t for t in bs_teams if t.get("homeAway") == "away"), {})
        if home_bs: home["statistics"] = home_bs.get("statistics", [])
        if away_bs: away["statistics"] = away_bs.get("statistics", [])

    def extract(competitor):
        stats = {s["name"]: s.get("displayValue", s.get("value", "0"))
                 for s in competitor.get("statistics", [])}
        def num(k, default=0):
            try: return float(str(stats.get(k, default)).replace("%", ""))
            except: return default
        return {
            "team":           competitor.get("team", {}).get("displayName", ""),
            "team_logo":      competitor.get("team", {}).get("logo", ""),
            "score":          competitor.get("score", "0"),
            "shots":          num("shots"),
            "shotsOnTarget":  num("shotsOnTarget"),
            "possession":     num("possession"),
            "passes":         num("passes"),
            "passAccuracy":   num("passesAccurate") / max(num("passes"), 1) * 100 if num("passes") else num("passesAccurate"),
            "fouls":          num("fouls"),
            "yellowCards":    num("yellowCards"),
            "redCards":       num("redCards"),
            "corners":        num("cornerKicks"),
            "offsides":       num("offsides"),
            "saves":          num("saves"),
            "freeKicks":      num("freeKicks"),
            "goals":          num("goalsScored"),
            "raw_stats":      stats,
        }

    return {
        "home": extract(home),
        "away": extract(away),
    }


def _parse_goals(raw: dict) -> list:
    """Extract goal events with minute, player, team, type."""
    goals = []
    for period in raw.get("scoring", {}).get("periods", []):
        period_name = period.get("displayName", "")
        for sp in period.get("scoringPlays", []):
            clock = sp.get("clock", {}).get("displayValue", "")
            team  = sp.get("team", {}).get("displayName", "")
            side  = sp.get("team", {}).get("homeAway", "")
            play  = sp.get("scoringPlay", {})
            goal_type = play.get("shortText") or play.get("type", {}).get("text", "Goal")
            athletes = sp.get("athletesInvolved", [])
            scorer   = athletes[0].get("displayName", "") if athletes else ""
            assister = athletes[1].get("displayName", "") if len(athletes) > 1 else ""
            try:
                minute = int(str(clock).replace("'", "").strip())
            except:
                minute = 0
            goals.append({
                "minute":   minute,
                "period":   period_name,
                "team":     team,
                "side":     side,
                "type":     goal_type,
                "scorer":   scorer,
                "assister": assister,
                "home_score": sp.get("homeScore", ""),
                "away_score": sp.get("awayScore", ""),
            })
    return sorted(goals, key=lambda g: g["minute"])


def _parse_key_events(raw: dict) -> list:
    """Parse plays/key events: goals, cards, subs."""
    events = []
    for play in raw.get("plays", []):
        ptype = play.get("type", {})
        type_id   = str(ptype.get("id", ""))
        type_text = ptype.get("text", "")

        # Filter to meaningful event types only
        # ESPN type IDs: 27=Goal, 28=OwnGoal, 38=YellowCard, 39=SecondYellow, 40=RedCard, 41=Sub, 51=Penalty
        INTERESTING = {"27","28","38","39","40","41","51","52"}
        if type_id not in INTERESTING and not any(k in type_text.lower() for k in ["goal","card","sub","penalty"]):
            continue

        clock = play.get("clock", {}).get("displayValue", "")
        try: minute = int(str(clock).replace("'","").strip())
        except: minute = 0

        team   = play.get("team", {}).get("displayName", "")
        side   = play.get("team", {}).get("homeAway", "")
        text   = play.get("text", type_text)
        parts  = play.get("participants", [])
        player = parts[0].get("athlete", {}).get("displayName", "") if parts else ""

        icon = (
            "⚽" if "goal" in type_text.lower() and "own" not in type_text.lower()
            else "🔴" if "red" in type_text.lower() or type_id == "40"
            else "🟡" if "yellow" in type_text.lower() or type_id in ("38","39")
            else "🔄" if "sub" in type_text.lower() or type_id == "41"
            else "🎯" if "penalty" in type_text.lower() or type_id == "51"
            else "⚽🙈" if "own" in type_text.lower()
            else "•"
        )

        events.append({
            "minute": minute,
            "type":   type_text,
            "type_id": type_id,
            "icon":   icon,
            "team":   team,
            "side":   side,
            "player": player,
            "text":   text,
            "scoring": play.get("scoringPlay", False),
            "home_score": play.get("homeScore", ""),
            "away_score": play.get("awayScore", ""),
        })
    return sorted(events, key=lambda e: e["minute"])


def _parse_pressure_map(raw: dict) -> dict:
    """
    Compute 15-minute interval scoring attempts for each team.
    Returns buckets: 0-15, 16-30, 31-45, 46-60, 61-75, 76-90+
    """
    buckets_home = [0]*6
    buckets_away = [0]*6

    def bucket(minute):
        if minute <= 15: return 0
        if minute <= 30: return 1
        if minute <= 45: return 2
        if minute <= 60: return 3
        if minute <= 75: return 4
        return 5

    for play in raw.get("plays", []):
        if not play.get("scoringPlay") and play.get("type", {}).get("id") not in ("27","28","51"):
            continue
        clock = play.get("clock", {}).get("displayValue", "")
        try:   minute = int(str(clock).replace("'","").strip())
        except: continue
        side = play.get("team", {}).get("homeAway", "home")
        b = bucket(minute)
        if side == "home": buckets_home[b] += 1
        else:              buckets_away[b] += 1

    labels = ["0–15", "16–30", "31–45", "46–60", "61–75", "76–90"]
    return {"labels": labels, "home": buckets_home, "away": buckets_away}


def _parse_player_ratings(raw: dict) -> list:
    """
    Compute a simple performance rating (0-10) for each player
    from roster stats: goals, assists, saves, passes, tackles, etc.
    """
    players = []
    for team_roster in raw.get("rosters", []):
        team_name = team_roster.get("team", {}).get("displayName", "")
        side      = team_roster.get("homeAway", "")
        for entry in team_roster.get("roster", []):
            athlete  = entry.get("athlete", {})
            position = athlete.get("position", {}).get("abbreviation", "")
            stats    = {s["name"]: s.get("displayValue", s.get("value", 0))
                        for s in entry.get("stats", [])}

            def n(k):
                try: return float(str(stats.get(k, 0)).replace("%","") or 0)
                except: return 0.0

            # Base rating components
            rating = 6.0  # baseline for playing
            if not entry.get("starter", False):
                rating = 5.5  # subs start lower

            # Attacking contributions
            rating += n("goals")      * 1.5
            rating += n("assists")    * 1.0
            rating += n("shotsOnTarget") * 0.2
            rating -= n("shotsOffTarget") * 0.05

            # Defensive contributions
            rating += n("tackles")    * 0.2
            rating += n("interceptions") * 0.2
            rating += n("clearances") * 0.1
            rating -= n("foulsCommitted") * 0.15

            # GK specific
            rating += n("saves")      * 0.4
            rating -= n("goalsAllowed") * 0.5

            # Passing
            pa_pct = n("passesAccurate") / max(n("totalPasses"), 1) * 100 if n("totalPasses") else 0
            if pa_pct >= 90: rating += 0.5
            elif pa_pct < 70: rating -= 0.3

            # Cards
            rating -= n("yellowCards") * 0.5
            rating -= n("redCards")    * 2.0

            rating = round(max(1.0, min(10.0, rating)), 1)

            players.append({
                "name":     athlete.get("displayName", ""),
                "number":   entry.get("jersey", ""),
                "position": position,
                "team":     team_name,
                "side":     side,
                "starter":  entry.get("starter", False),
                "rating":   rating,
                "goals":    int(n("goals")),
                "assists":  int(n("assists")),
                "saves":    int(n("saves")),
                "minutes":  int(n("minutesPlayed") or (90 if entry.get("starter") else 30)),
                "stats":    {k: stats[k] for k in list(stats.keys())[:12]},
            })

    return sorted(players, key=lambda p: (-p["starter"], -p["rating"]))


def _parse_shot_breakdown(raw: dict) -> dict:
    """
    Return shot counts: total / on target / off target / blocked / goals
    for each team from stats.
    """
    team_stats = _parse_team_stats(raw)
    result = {}
    for side in ("home", "away"):
        ts = team_stats.get(side, {})
        total   = int(ts.get("shots", 0))
        on_tgt  = int(ts.get("shotsOnTarget", 0))
        goals   = int(ts.get("goals", 0))
        off_tgt = max(0, total - on_tgt)
        blocked = max(0, on_tgt - goals)
        result[side] = {
            "team":       ts.get("team", ""),
            "total":      total,
            "on_target":  on_tgt,
            "off_target": off_tgt,
            "blocked":    blocked,
            "goals":      goals,
        }
    return result


def _compute_xg(raw: dict) -> dict:
    """
    Estimate xG (expected goals) per team from available data.
    Without positional data we use a heuristic:
      xG ≈ shots_on_target × 0.33 + shots_off_target × 0.04
    This is a rough approximation; real xG needs shot location.
    """
    sb = _parse_shot_breakdown(raw)
    result = {}
    for side in ("home", "away"):
        shots = sb.get(side, {})
        xg = round(
            shots.get("on_target",  0) * 0.33 +
            shots.get("off_target", 0) * 0.04,
            2
        )
        result[side] = {
            "team": shots.get("team", ""),
            "xg":   xg,
            "actual_goals": shots.get("goals", 0),
        }
    return result
