"""
Where each player in the Studies played before (frontend/src/data/studies/previous-teams.json).

ESPN keeps a season-by-season log for every athlete -- the team he was on each year. For every ESPN athlete id the
Studies page can show (headshots.json), this reads that log and keeps the ones who have played for more than one
team: { "<espn id>": [[season, "Team"], ...] }, newest season first. The page then answers "who was he with before?"
for the row it is showing by taking the latest earlier season on a different team than that row's.

Results are remembered in _previous_teams_cache.json (an id's log is re-read after three weeks, to catch a new
season), so a weekly run only reads players it hasn't seen. Run after headshots.py:

    python3 studies/previous_teams.py
"""

import json
import os
import re
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
DATA = os.path.join(REPO_ROOT, "frontend", "src", "data")
HEADSHOTS = os.path.join(DATA, "studies", "headshots.json")
OUT_PATH = os.path.join(DATA, "studies", "previous-teams.json")
CACHE_PATH = os.path.join(HERE, "_previous_teams_cache.json")
TEAM_CACHE_PATH = os.path.join(HERE, "_team_names_cache.json")
CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football"
RECHECK_DAYS = 21


def get_json(url):
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=25) as resp:
                return json.load(resp)
        except Exception:
            time.sleep(1 + attempt)
    return None


def season_team(entry):
    """(season, team id) for one entry of an athlete's statistics log."""
    season = re.search(r"/seasons/(\d{4})", entry.get("season", {}).get("$ref", ""))
    team = None
    for stat in entry.get("statistics", []):
        m = re.search(r"/teams/(\d+)", (stat.get("team") or {}).get("$ref", ""))
        if m:
            team = m.group(1)
    return (int(season.group(1)), team) if season and team else None


def read_log(athlete_id):
    data = get_json(f"{CORE}/athletes/{athlete_id}/statisticslog")
    if data is None:
        return None
    pairs = [p for p in (season_team(e) for e in data.get("entries", data.get("items", []))) if p]
    return sorted(set(pairs), reverse=True)


def build():
    ids = sorted({e[0] for v in json.load(open(HEADSHOTS))["byName"].values() for e in v})
    cache = json.load(open(CACHE_PATH)) if os.path.exists(CACHE_PATH) else {}
    today = date.today()

    def stale(entry):
        return entry is None or (today - date.fromisoformat(entry["checked"])).days >= RECHECK_DAYS

    todo = [i for i in ids if stale(cache.get(i))]
    print(f"  {len(ids)} athletes, {len(todo)} logs to read")
    with ThreadPoolExecutor(max_workers=16) as pool:
        for i, log in zip(todo, pool.map(read_log, todo)):
            if log is not None:
                cache[i] = {"log": log, "checked": today.isoformat()}
    json.dump(cache, open(CACHE_PATH, "w"), separators=(",", ":"), sort_keys=True)

    # Team names: the college list first, then ESPN's own team record for schools it doesn't carry.
    names = {c["id"]: c["name"] for c in json.load(open(os.path.join(DATA, "colleges.json")))}
    names.update(json.load(open(TEAM_CACHE_PATH)) if os.path.exists(TEAM_CACHE_PATH) else {})
    wanted = {t for i in ids if i in cache for _, t in cache[i]["log"] if len({x for _, x in cache[i]["log"]}) > 1}
    missing = sorted(t for t in wanted if t not in names)

    def team_name(team_id):
        data = get_json(f"{CORE}/teams/{team_id}")
        return team_id, (data or {}).get("location") or ""

    with ThreadPoolExecutor(max_workers=16) as pool:
        for team_id, name in pool.map(team_name, missing):
            if name:
                names[team_id] = name
    json.dump({k: v for k, v in names.items() if k in wanted and k not in {c["id"] for c in json.load(open(os.path.join(DATA, "colleges.json")))}}, open(TEAM_CACHE_PATH, "w"), separators=(",", ":"), sort_keys=True)

    out = {}
    for i in ids:
        log = cache.get(i, {}).get("log", [])
        if len({t for _, t in log}) > 1:  # only players who have been on more than one team
            out[i] = [[y, names.get(t, "")] for y, t in log if names.get(t)]
    with open(OUT_PATH, "w") as f:
        json.dump(out, f, separators=(",", ":"), sort_keys=True)
    print(f"Wrote {OUT_PATH}: {len(out)} players with more than one team")


if __name__ == "__main__":
    build()
