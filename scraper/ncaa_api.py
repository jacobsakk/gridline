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

import glob
import json
import os
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


SNAPSHOT_DIR = os.path.join(os.path.dirname(__file__), "snapshots")


def passing_efficiency(yards, td, comp, ints, att):
    """The NCAA's own passer-rating formula. Verified against real data,
    not guessed: reproduces Fall 2026 FCS leaders' published ratings
    (e.g. 66 att/46 comp/1 int/727 yds/11 td -> 214.19) exactly."""
    if att <= 0:
        return "0.0"
    return f"{(8.4 * yards + 330 * td + 100 * comp - 200 * ints) / att:.2f}"


def _row_key(row):
    """Identifies "the same player's line in this category" across two
    snapshots. Not globally unique across a transfer/name collision, but
    good enough for a weekly diff."""
    return (row["category"], row["player"], row["team"])


def snapshot_path(division_slug, run_date):
    return os.path.join(SNAPSHOT_DIR, f"{division_slug}-{run_date}.json")


def save_snapshot(division_slug, run_date, rows):
    os.makedirs(SNAPSHOT_DIR, exist_ok=True)
    with open(snapshot_path(division_slug, run_date), "w") as f:
        json.dump(rows, f, indent=2)


def load_previous_snapshot(division_slug, run_date):
    """Returns (previous_run_date, rows) for the most recent snapshot
    strictly before run_date, or (None, None) if this is the first one."""
    pattern = os.path.join(SNAPSHOT_DIR, f"{division_slug}-*.json")
    candidates = []
    for path in glob.glob(pattern):
        date_part = os.path.basename(path)[len(division_slug) + 1 : -len(".json")]
        if date_part < run_date:
            candidates.append(date_part)
    if not candidates:
        return None, None
    latest = max(candidates)
    with open(snapshot_path(division_slug, latest)) as f:
        return latest, json.load(f)


def build_delta_row(current, previous, week_label):
    """Given the same player's "season to date" row from two snapshots,
    returns a row representing just the stats added in between -- or None
    if it can't be computed cleanly (no new game played, or a data
    correction made a number go down, which happens occasionally on the
    NCAA's end)."""
    d_games = current["games"] - previous["games"]
    if d_games <= 0:
        return None

    row = {
        **current,
        "id": f"{current['id']}-wk-{week_label}",
        "week": week_label,
        "games": d_games,
    }

    category = current["category"]
    try:
        if category == "passing":
            d_att = current["att"] - previous["att"]
            d_comp = int(current["compAtt"].split("/")[0]) - int(previous["compAtt"].split("/")[0])
            d_yards = current["yards"] - previous["yards"]
            d_td = current["td"] - previous["td"]
            d_int = current["int"] - previous["int"]
            if min(d_att, d_comp, d_yards, d_td, d_int) < 0:
                return None
            row.update({
                "compAtt": f"{d_comp}/{d_att}",
                "att": d_att,
                "yards": d_yards,
                "td": d_td,
                "int": d_int,
                "rating": passing_efficiency(d_yards, d_td, d_comp, d_int, d_att),
            })
        elif category in ("rushing", "receiving"):
            count_key = "att" if category == "rushing" else "rec"
            d_count = current[count_key] - previous[count_key]
            d_yards = current["yards"] - previous["yards"]
            d_td = current["td"] - previous["td"]
            if min(d_count, d_yards, d_td) < 0:
                return None
            row.update({count_key: d_count, "yards": d_yards, "avg": _avg(d_yards, d_count), "td": d_td})
        elif category == "tackling":
            d_solo = current["solo"] - previous["solo"]
            d_ast = current["ast"] - previous["ast"]
            if min(d_solo, d_ast) < 0:
                return None
            row.update({"solo": d_solo, "ast": d_ast, "total": d_solo + d_ast})
        elif category == "sacksTfl":
            d_solo = current["soloSacks"] - previous["soloSacks"]
            d_ast = current["astSacks"] - previous["astSacks"]
            d_yds = current["sackYds"] - previous["sackYds"]
            if min(d_solo, d_ast, d_yds) < 0:
                return None
            row.update({
                "soloSacks": d_solo,
                "astSacks": d_ast,
                "sackYds": d_yds,
                "sacks": f"{d_solo + 0.5 * d_ast:.1f}",
            })
    except (KeyError, ValueError, ZeroDivisionError):
        return None

    return row


def build_weekly_delta_rows(current_rows, previous_rows, week_label):
    previous_by_key = {_row_key(r): r for r in previous_rows}
    weekly = []
    for row in current_rows:
        previous = previous_by_key.get(_row_key(row))
        if previous is None:
            continue  # player wasn't in the prior snapshot -- can't diff, skip
        delta = build_delta_row(row, previous, week_label)
        if delta is not None:
            weekly.append(delta)
    return weekly


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
