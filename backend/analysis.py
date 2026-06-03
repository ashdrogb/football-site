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
