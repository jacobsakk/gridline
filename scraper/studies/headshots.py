"""
Headshots and team colours for the Studies page (frontend/src/data/studies/headshots.json).

A study row is just a name and a team, so this finds each player's ESPN athlete id -- the picture lives at
https://a.espncdn.com/i/headshots/college-football/players/full/<id>.png -- from two places:

  * every current MAC roster (ESPN's roster feed), which also covers the offensive linemen the stats data never
    lists, and
  * every ESPN-sourced row of frontend/src/data/real-stats.json (the Pre-Portal Tracker's data, all divisions),
    which finds a player from an earlier season who has since transferred out of the MAC.

Players are looked up by a letters-only name key (the page tries it with and without a trailing Jr./III), and
each key can carry several ids when two people share a name -- the page picks the one whose team matches.
It also writes each school's colour (ESPN's own, from colleges.json) under every spelling a study row might use.

    python3 studies/headshots.py

weekly-data-refresh.yml runs it right after the MAC study, so new rosters and transfers get their pictures.
"""

import json
import os
import re
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(REPO_ROOT, "frontend", "src", "data")
OUT_PATH = os.path.join(DATA, "studies", "headshots.json")
STUDY_PATH = os.path.join(DATA, "studies", "mac-best-by-position.json")
CORE_ATHLETES = "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/{}/teams/{}/athletes?limit=300"
CORE_ATHLETE = "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/athletes/{}"
CACHE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_headshot_cache.json")
PAST_SEASONS = ["2023", "2024", "2025"]
SEARCH_URL = "https://site.web.api.espn.com/apis/common/v3/search?query={}&limit=8&mode=prefix&type=player"
IMAGE_URL = "https://a.espncdn.com/i/headshots/college-football/players/full/{}.png"
ROSTER_URL = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/{}/roster"
# Northern Illinois played in the MAC for 2023-2025, so its alumni are in the older seasons of the study.
EXTRA_TEAM_IDS = {"2459": "Northern Illinois"}
SUFFIX = re.compile(r"(jr|sr|ii|iii|iv|v)$")


def letters(text):
    return re.sub(r"[^a-z]", "", (text or "").lower())


def name_keys(name):
    full = letters(name)
    short = SUFFIX.sub("", full) if len(full) > 5 else full
    return {full, short}


def team_variants(name):
    """Every spelling of a school a study row might carry: "Ball State", "Ball St.", "Ball St", and so on."""
    out = {name, name.replace("State", "St."), name.replace("State", "St"), name.replace("Michigan", "Mich."), name.replace("Michigan", "Mich")}
    out |= {v.replace("State", "St.").replace("Michigan", "Mich.") for v in list(out)}
    return {letters(v) for v in out if v}


EXTRA_SPELLINGS = {
    "UMass": ["Massachusetts", "UMASS"],
    "Miami (OH)": ["Miami OH", "Miami Ohio", "Miami (Ohio)"],
    "Sacramento State": ["Sac State"],
    "Western Michigan": ["W Michigan"],
    "Central Michigan": ["C Michigan"],
    "Eastern Michigan": ["E Michigan"],
    "Miami": ["Miami (FL)", "Miami FL"],
}


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def build():
    colleges = json.load(open(os.path.join(DATA, "colleges.json")))
    mac = {c["id"]: c["name"] for c in colleges if c.get("conference") == "MAC"}
    mac.update(EXTRA_TEAM_IDS)

    by_name = {}  # name key -> [[espn id, team key], ...], MAC rosters first

    def add(name, athlete_id, team):
        for key in name_keys(name):
            if not key:
                continue
            entry = [str(athlete_id), letters(team)]
            if entry not in by_name.setdefault(key, []):
                by_name[key].append(entry)

    for team_id, team in mac.items():
        try:
            data = get_json(ROSTER_URL.format(team_id))
        except Exception as e:  # one team's feed being down shouldn't lose the rest
            print(f"  {team}: roster unavailable ({e})")
            continue
        count = 0
        for group in data.get("athletes", []):
            for p in group.get("items", []):
                if p.get("headshot") and p.get("fullName"):
                    add(p["fullName"], p["id"], team)
                    count += 1
        print(f"  {team}: {count} players with a headshot")

    # Everyone in the study who isn't on a current MAC roster: look them up in the Pre-Portal data.
    study = json.load(open(STUDY_PATH))
    wanted = set()
    for rows_by_season in study["groups"].values():
        for rows in rows_by_season.values():
            for r in rows:
                wanted |= name_keys(r["player"])
    missing = {k for k in wanted if k not in by_name}
    if missing:
        for r in json.load(open(os.path.join(DATA, "real-stats.json"))):
            m = re.search(r"-espn-(\d+)$", r.get("id", ""))
            if m and name_keys(r["player"]) & missing:
                add(r["player"], m.group(1), r["team"])

    # A player from an earlier season has usually left every current roster. ESPN keeps each past season's roster
    # (ids only; a second request per athlete gives the name and picture), so every MAC player of 2023-2025 is
    # read once and remembered in _headshot_cache.json -- later runs only fetch players the cache hasn't seen.
    cache = json.load(open(CACHE_PATH)) if os.path.exists(CACHE_PATH) else {}

    def roster_ids(job):
        season, team_id = job
        try:
            return team_id, [i["$ref"].split("/athletes/")[1].split("?")[0] for i in get_json(CORE_ATHLETES.format(season, team_id)).get("items", [])]
        except Exception:
            return team_id, []

    jobs = [(y, t) for y in PAST_SEASONS for t in mac]
    team_of = {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        for team_id, ids in pool.map(roster_ids, jobs):
            for i in ids:
                team_of.setdefault(i, mac[team_id])
    todo = [i for i in team_of if i not in cache]
    print(f"  past rosters: {len(team_of)} athletes, {len(todo)} new to look up")

    def athlete(i):
        try:
            a = get_json(CORE_ATHLETE.format(i))
            return i, {"name": a.get("fullName", ""), "pic": bool(a.get("headshot"))}
        except Exception:
            return i, None

    with ThreadPoolExecutor(max_workers=16) as pool:
        for i, info in pool.map(athlete, todo):
            if info is not None:
                cache[i] = info
    json.dump(cache, open(CACHE_PATH, "w"), separators=(",", ":"), sort_keys=True)
    for i, team in team_of.items():
        info = cache.get(i)
        if info and info["pic"] and info["name"]:
            add(info["name"], i, team)

    # Still nobody: a player from an earlier season who has left college football's current rosters. ESPN's own
    # player search finds those by name; only a hit that is a college football player with a picture counts.
    wanted_names = {}
    for rows_by_season in study["groups"].values():
        for rows in rows_by_season.values():
            for r in rows:
                if not (name_keys(r["player"]) & set(by_name)):
                    wanted_names[letters(r["player"])] = (r["player"], r["team"])

    def search(item):
        key, (name, team) = item
        try:
            hits = get_json(SEARCH_URL.format(urllib.parse.quote(name))).get("items", [])
        except Exception:
            return key, None
        for h in hits:
            if h.get("league") == "college-football" and name_keys(h.get("displayName", "")) & name_keys(name):
                try:
                    urllib.request.urlopen(urllib.request.Request(IMAGE_URL.format(h["id"]), method="HEAD", headers={"User-Agent": "Mozilla/5.0"}), timeout=15)
                except Exception:
                    continue  # no picture for that athlete
                return key, (name, h["id"], team)
        return key, None

    found = 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        for key, hit in pool.map(search, wanted_names.items()):
            if hit:
                add(hit[0], hit[1], hit[2])
                found += 1
    print(f"  search: {found} of {len(wanted_names)} players not on a roster found by name")

    colors = {}
    for c in colleges:
        if c.get("color") and (c["id"] in mac or c["name"] in ("Miami", "Miami (FL)")):
            spellings = {c["name"]} | set(EXTRA_SPELLINGS.get(c["name"], []))
            for s in spellings:
                for k in team_variants(s):
                    colors[k] = "#" + c["color"].lstrip("#").lower()

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump({"byName": by_name, "colors": colors}, f, separators=(",", ":"), sort_keys=True)
    covered = sum(1 for k in wanted if k in by_name)
    print(f"Wrote {OUT_PATH}: {len(by_name)} names, study players covered {covered}/{len(wanted)} name keys")


if __name__ == "__main__":
    build()
