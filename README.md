# ⚽ PITCH — Football Analysis Dashboard

A full-stack soccer analysis website using the **ESPN public API** — no registration, no API key needed.

## Features
- 🟢 **Live scores** with auto-refresh every 60 seconds
- 📊 **League standings** table for 6 major leagues
- 📈 **Analysis**: top scoring teams, goal stats, highest-scoring matches
- 🗂 **Match detail** modal with goal timeline
- ⚽ Covers: Premier League, La Liga, Bundesliga, Serie A, Ligue 1, Champions League

---

## Project Structure

```
football-site/
├── backend/
│   ├── main.py          # FastAPI app — all routes
│   ├── fetcher.py       # ESPN API calls + response parsers
│   ├── analysis.py      # pandas stats logic
│   ├── models.py        # SQLAlchemy DB models
│   ├── database.py      # Async SQLite setup
│   └── scheduler.py     # Background polling (every 2 min)
├── frontend/
│   ├── index.html       # Main dashboard
│   └── static/
│       ├── css/style.css
│       └── js/app.js
├── requirements.txt
├── start.sh
└── README.md
```

---

## Quick Start

### Option 1 — One command (Linux/Mac)
```bash
chmod +x start.sh
./start.sh
```

### Option 2 — Manual
```bash
# Install dependencies
pip install -r requirements.txt

# Start the backend
cd backend
uvicorn main:app --reload --port 8000
```

Then open **http://localhost:8000** in your browser.

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/leagues` | All available leagues |
| GET | `/api/scores/{league}` | Live + recent scores |
| GET | `/api/standings/{league}` | League table |
| GET | `/api/analysis/league-stats/{league}` | Goals, averages, clean sheets |
| GET | `/api/analysis/top-scorers/{league}` | Top scoring teams |
| GET | `/api/match/{league}/{event_id}` | Match detail + goal timeline |
| GET | `/api/teams/{league}` | All teams in a league |

Interactive API docs: **http://localhost:8000/docs**

---

## League IDs

| League | ID |
|--------|-----|
| Premier League | `eng.1` |
| La Liga | `esp.1` |
| Bundesliga | `ger.1` |
| Serie A | `ita.1` |
| Ligue 1 | `fra.1` |
| Champions League | `uefa.champions` |

---

## Extending the App

**Add fantasy points estimation:**
Edit `analysis.py` — use goals scored, clean sheets, and form to compute a simple fantasy score per team.

**Add a chart:**
Add Chart.js to `index.html` and call `/api/standings/{league}` to plot a points bar chart.

**Add a database:**
`models.py` and `database.py` are already set up with SQLite. Call `await init_db()` in `main.py`'s lifespan to activate persistent storage.

**Add more leagues:**
Add entries to the `LEAGUES` dict in `fetcher.py`. Find slugs at:
`https://site.api.espn.com/apis/site/v2/sports/soccer/`
