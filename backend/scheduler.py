from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
import httpx
import logging

logger = logging.getLogger(__name__)
scheduler = AsyncIOScheduler()
_cache: dict = {"scoreboards": {}, "standings": {}}

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Origin": "https://www.espn.com",
    "Referer": "https://www.espn.com/",
}


def get_cache() -> dict:
    return _cache


async def refresh_all_leagues():
    from fetcher import LEAGUES, ESPN_BASE, parse_scoreboard, parse_standings
    for league_id in LEAGUES:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r_scores = await client.get(
                    f"{ESPN_BASE}/{league_id}/scoreboard", headers=BROWSER_HEADERS)
                if r_scores.status_code == 200:
                    _cache["scoreboards"][league_id] = parse_scoreboard(r_scores.json())

                r_stand = await client.get(
                    f"{ESPN_BASE}/{league_id}/standings", headers=BROWSER_HEADERS)
                if r_stand.status_code == 200:
                    parsed = parse_standings(r_stand.json())
                    if parsed:
                        _cache["standings"][league_id] = parsed

            logger.info(f"Refreshed {league_id}: "
                        f"{len(_cache['scoreboards'].get(league_id, []))} matches, "
                        f"{len(_cache['standings'].get(league_id, []))} standings rows")
        except Exception as e:
            logger.warning(f"Failed to refresh {league_id}: {e}")


def start_scheduler():
    scheduler.add_job(
        refresh_all_leagues,
        trigger=IntervalTrigger(minutes=2),
        id="refresh_leagues",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("Scheduler started")


def stop_scheduler():
    scheduler.shutdown()
