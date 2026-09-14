"""
Fetches real D2/FCS individual stat leaders from the NCAA API wrapper
(https://github.com/henrygd/ncaa-api) and normalizes them into Gridline's
row shape.

Uses the public demo instance (https://ncaa-api.henrygd.me). Rate-limited
to 5 req/s per the project's own docs -- we stay well under that with a
0.4s pause between requests and this is not something that needs to run
more than once a week, so being polite costs us nothing.

Known limitation: the wrapper's conference-standings scraper works for
FCS but currently errors (HTTP 500) for D2/D3 -- confirmed by hand, not
an assumption. So D2 conference tagging falls back to a small hardcoded
list of known team->conference pairs (see D2_KNOWN_CONFERENCES below);
anything not in that list is tagged "Independent" until a full mapping
is built (e.g. from Wikipedia's D2 conference-by-conference rosters).
"""

import json
import time
import urllib.error
import urllib.request

API_BASE = "https://ncaa-api.henrygd.me"
USER_AGENT = "curl/8.0"  # the default urllib UA gets blocked; a plain curl UA does not
REQUEST_PAUSE_SECONDS = 0.4

# category key -> NCAA stat category id (same id works across fbs/fcs/d2/d3,
# only the division changes in the URL path)
STAT_IDS = {
    "passing": 8,  # "Passing Efficiency" -- the one endpoint that includes
                   # attempts/completions/yards/TD/INT *and* the rating,
                   # so no need to merge it with the plain "Passing Yards" id
    "rushing": 469,
    "receiving": 455,
    "tackling": 34,
    "sacksTfl": 36,
}

# A partial, hand-maintained team -> conference mapping for D2, since the
# API's D2 standings scraper is broken. Carried over from the original
# prototype's sample TEAMS.D2 list (these are real D2 programs/conferences,
# just not an exhaustive list of all ~300 D2 football schools).
D2_KNOWN_CONFERENCES = {
    "Ferris St.": "GLIAC", "Grand Valley St.": "GLIAC",
    "Colorado Mines": "RMAC", "CSU Pueblo": "RMAC",
    "Valdosta St.": "GSC", "Delta St.": "GSC",
    "Slippery Rock": "PSAC", "California (PA)": "PSAC", "Cal (PA)": "PSAC",
    "Minn. St.": "NSIC", "Sioux Falls": "NSIC",
    "Barton": "Conference Carolinas", "Emory & Henry": "Conference Carolinas",
    "Virginia Union": "CIAA", "Winston-Salem": "CIAA",
    "Harding": "GAC", "Southern Ark.": "GAC",
    "Indianapolis": "GLVC", "Lindenwood": "GLVC",
    "Ohio Dominican": "G-MAC", "Tiffin": "G-MAC",
    "Angelo St.": "LSC", "West Texas A&M": "LSC",
    "Glenville St.": "MEC", "West Liberty": "MEC",
    "Central Mo.": "MIAA", "Pittsburg St.": "MIAA",
    "Bentley": "NE-10", "American Int'l": "NE-10",
    "Newberry": "SAC", "Wingate": "SAC",
    "Miles": "SIAC", "Tuskegee": "SIAC",
}


def _get(path, params=None):
    url = f"{API_BASE}{path}"
    if params:
        query = "&".join(f"{k}={v}" for k, v in params.items())
        url = f"{url}?{query}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.load(resp)


def fetch_all_pages(division, stat_id):
    """Fetches every page of a stat leaderboard and returns the combined rows."""
    rows = []
    page = 1
    while True:
        data = _get(f"/stats/football/{division}/current/individual/{stat_id}", {"page": page})
        rows.extend(data["data"])
        if page >= data.get("pages", 1):
            break
        page += 1
        time.sleep(REQUEST_PAUSE_SECONDS)
    return rows


def fetch_fcs_conference_map():
    """Returns {team_name: conference_name} for every FCS team, from the
    NCAA API's conference standings (confirmed working for FCS)."""
    data = _get("/standings/football/fcs")
    mapping = {}
    for conf in data["data"]:
        for team in conf["standings"]:
            mapping[team["School"]] = conf["conference"]
    return mapping


def d2_conference_for(team_name):
    return D2_KNOWN_CONFERENCES.get(team_name, "Independent")


def _to_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _avg(yards, count):
    return f"{(yards / count):.1f}" if count else "0.0"


def transform_row(division, category, conference_lookup, raw, row_id):
    position = raw.get("Position") or "ATH"
    base = {
        "id": row_id,
        "division": division,
        "week": "total",  # NCAA reports season-to-date, not per-week splits
        "category": category,
        "position": position,
        "player": raw["Name"],
        "team": raw["Team"],
        "conference": conference_lookup(raw["Team"]),
        "games": _to_int(raw.get("G")),
        "sample": False,
    }

    if category == "passing":
        att = _to_int(raw.get("Pass Att"))
        comp = _to_int(raw.get("Pass Com"))
        base.update({
            "compAtt": f"{comp}/{att}",
            "att": att,
            "yards": _to_int(raw.get("Pass Yds")),
            "td": _to_int(raw.get("Pass TD")),
            "int": _to_int(raw.get("Int")),
            "rating": raw.get("Pass Eff", "0.0"),
        })
    elif category == "rushing":
        att = _to_int(raw.get("Rush"))
        yards = _to_int(raw.get("Rush Yds"))
        base.update({"att": att, "yards": yards, "avg": _avg(yards, att), "td": _to_int(raw.get("Rush TD"))})
    elif category == "receiving":
        rec = _to_int(raw.get("Rec"))
        yards = _to_int(raw.get("Rec Yds"))
        base.update({"rec": rec, "yards": yards, "avg": _avg(yards, rec), "td": _to_int(raw.get("Rec TD"))})
    elif category == "tackling":
        base.update({
            "solo": _to_int(raw.get("Solo Tack")),
            "ast": _to_int(raw.get("Asst Tack")),
            "total": _to_int(raw.get("TT")),
        })
    elif category == "sacksTfl":
        # The real "Sacks" leaderboard doesn't include forced fumbles/
        # recoveries per player (those are separate leaderboards covering
        # a different set of players), so this category's columns are
        # adapted to what one source actually reports cleanly.
        base.update({
            "soloSacks": _to_int(raw.get("Solo Sack")),
            "astSacks": _to_int(raw.get("Asst Sack")),
            "sackYds": _to_int(raw.get("Sack Yds")),
            "sacks": raw.get("Tot Sack", "0"),
        })

    return base


def build_division_rows(division_slug, division_label, conference_lookup):
    """division_slug is the NCAA API's URL path segment (e.g. "fcs", "d2");
    division_label is what Gridline's front-end expects (e.g. "FCS", "D2")."""
    rows = []
    for category, stat_id in STAT_IDS.items():
        raw_rows = fetch_all_pages(division_slug, stat_id)
        for i, raw in enumerate(raw_rows):
            row_id = f"real-{division_slug}-{category}-{i}"
            rows.append(transform_row(division_label, category, conference_lookup, raw, row_id))
        time.sleep(REQUEST_PAUSE_SECONDS)
    return rows
