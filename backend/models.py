from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime

Base = declarative_base()


class Match(Base):
    __tablename__ = "matches"

    id = Column(String, primary_key=True)
    league = Column(String, index=True)
    home_team = Column(String)
    away_team = Column(String)
    home_score = Column(Integer, nullable=True)
    away_score = Column(Integer, nullable=True)
    status = Column(String)  # scheduled, in_progress, final
    date = Column(DateTime)
    venue = Column(String, nullable=True)
    home_team_logo = Column(String, nullable=True)
    away_team_logo = Column(String, nullable=True)
    last_updated = Column(DateTime, default=datetime.utcnow)


class TeamStat(Base):
    __tablename__ = "team_stats"

    id = Column(Integer, primary_key=True, autoincrement=True)
    team_id = Column(String, index=True)
    team_name = Column(String)
    league = Column(String)
    wins = Column(Integer, default=0)
    draws = Column(Integer, default=0)
    losses = Column(Integer, default=0)
    goals_for = Column(Integer, default=0)
    goals_against = Column(Integer, default=0)
    points = Column(Integer, default=0)
    rank = Column(Integer, default=0)
    last_updated = Column(DateTime, default=datetime.utcnow)


class PlayerStat(Base):
    __tablename__ = "player_stats"

    id = Column(Integer, primary_key=True, autoincrement=True)
    player_id = Column(String, index=True)
    player_name = Column(String)
    team_name = Column(String)
    league = Column(String)
    goals = Column(Integer, default=0)
    assists = Column(Integer, default=0)
    appearances = Column(Integer, default=0)
    last_updated = Column(DateTime, default=datetime.utcnow)
