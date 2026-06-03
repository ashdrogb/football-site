from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
import logging

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()

# Cache store: league -> parsed data
_cache: dict = {
    "scoreboards": {},
    "standings": {},
}


def get_cache() -> dict:
    return _cache


async def refresh_all_leagues():
    """Background job: refresh scoreboards for all leagues."""
    from fetcher import fetch_scoreboard, fetch_standings, parse_scoreboard, parse_standings, LEAGUES
    for league_id in LEAGUES:
        try:
            raw_scores = await fetch_scoreboard(league_id)
            _cache["scoreboards"][league_id] = parse_scoreboard(raw_scores)

            raw_standings = await fetch_standings(league_id)
            _cache["standings"][league_id] = parse_standings(raw_standings)

            logger.info(f"Refreshed cache for {league_id}")
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
    logger.info("Scheduler started — polling every 2 minutes")


def stop_scheduler():
    scheduler.shutdown()
