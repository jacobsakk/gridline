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
an assumption. So D2 conference tagging falls back to a hand-built
team->conference mapping (see D2_KNOWN_CONFERENCES below), built by
cross-referencing each D2 football conference's own Wikipedia "current
members" list against the ~160 team names that actually appear in our
fetched stats (rather than guessed from memory -- a handful of these,
e.g. Seton Hill's football being PSAC and not G-MAC, were verified
directly against Wikipedia edit history/sourcing since the school's
other sports and its football can genuinely sit in different
conferences). Anything not in this list is tagged "Independent".
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
    # "tackling" (Defense) is not in this list -- it's built separately by
    # merging five leaderboards together, sacks included (see
    # build_defense_rows / STAT_IDS_DEFENSE_MERGE)
}

STAT_IDS_DEFENSE_MERGE = {
    "tackles": 34,  # Total Tackles -- primary source, highest coverage
    "tfl": 39,       # Tackles For Loss
    "pbu": 38,       # Passes Defended
    "int": 14,       # Interceptions Per Game (has the raw INT count too)
    "sacks": 36,     # Sacks -- merged into Defense rather than its own category
}

# See module docstring for how this was built.
D2_KNOWN_CONFERENCES = {
    'Adams St.': 'RMAC',
    'Albany St. (GA)': 'SIAC',
    'Allen': 'SIAC',
    "American Int'l": 'NE-10',
    'Anderson (SC)': 'SAC',
    'Angelo St.': 'LSC',
    'Ark.-Monticello': 'GAC',
    'Arkansas Tech': 'GAC',
    'Ashland': 'G-MAC',
    'Assumption': 'NE-10',
    'Augustana (SD)': 'NSIC',
    'Barton': 'Conference Carolinas',
    'Bemidji St.': 'NSIC',
    'Benedict': 'SIAC',
    'Bentley': 'NE-10',
    'Black Hills St.': 'RMAC',
    'Bloomsburg': 'PSAC',
    'Bluefield St.': 'CIAA',
    'Bowie St.': 'CIAA',
    'CSU Pueblo': 'RMAC',
    'California (PA)': 'PSAC',
    'Carson-Newman': 'SAC',
    'Catawba': 'SAC',
    'Central Mo.': 'MIAA',
    'Central Okla.': 'MIAA',
    'Central St. (OH)': 'SIAC',
    'Central Wash.': 'LSC',
    'Chadron St.': 'RMAC',
    'Charleston (WV)': 'MEC',
    'Chowan': 'Conference Carolinas',
    'Clarion': 'PSAC',
    'Clark Atlanta': 'SIAC',
    'Colo. Sch. of Mines': 'RMAC',
    'Colorado Mesa': 'RMAC',
    'Concord': 'MEC',
    'Concordia-St. Paul': 'NSIC',
    'Davenport': 'GLIAC',
    'Delta St.': 'GSC',
    'East Central': 'GAC',
    'East Stroudsburg': 'PSAC',
    'Eastern N.M.': 'LSC',
    'Edinboro': 'PSAC',
    'Edward Waters': 'SIAC',
    'Elizabeth City St.': 'CIAA',
    'Emory & Henry': 'Conference Carolinas',
    'Emporia St.': 'MIAA',
    'Erskine': 'Conference Carolinas',
    'Fairmont St.': 'MEC',
    'Fayetteville St.': 'CIAA',
    'Ferris St.': 'GLIAC',
    'Findlay': 'G-MAC',
    'Fort Hays St.': 'MIAA',
    'Fort Lewis': 'RMAC',
    'Fort Valley St.': 'SIAC',
    'Franklin Pierce': 'NE-10',
    'Frostburg St.': 'MEC',
    'Gannon': 'PSAC',
    'Glenville St.': 'MEC',
    'Grand Valley St.': 'GLIAC',
    'Harding': 'GAC',
    'Henderson St.': 'GAC',
    'Hillsdale': 'G-MAC',
    'Indiana (PA)': 'PSAC',
    'Jamestown': 'NSIC',
    'Johnson C. Smith': 'CIAA',
    'Kentucky St.': 'SIAC',
    'Kutztown': 'PSAC',
    'Ky. Wesleyan': 'G-MAC',
    'Lake Erie': 'G-MAC',
    'Lane': 'SIAC',
    'Lenoir-Rhyne': 'SAC',
    'Lincoln (MO)': 'GLVC',
    'Lincoln (PA)': 'CIAA',
    'Livingstone': 'CIAA',
    'Lock Haven': 'PSAC',
    'MSU Moorhead': 'NSIC',
    'Mars Hill': 'SAC',
    'Mary': 'NSIC',
    'McKendree': 'GLVC',
    'Michigan Tech': 'GLIAC',
    'Midwestern St.': 'LSC',
    'Miles': 'SIAC',
    'Millersville': 'PSAC',
    'Minn. Duluth': 'NSIC',
    'Minnesota St.': 'NSIC',
    'Minot St.': 'NSIC',
    'Missouri S&T': 'GLVC',
    'Missouri Western': 'MIAA',
    'Mo. Southern St.': 'MIAA',
    'Morehouse': 'SIAC',
    'N.M. Highlands': 'RMAC',
    'Neb.-Kearney': 'MIAA',
    'Newberry': 'SAC',
    'North Greenville': 'Conference Carolinas',
    'Northeastern St.': 'MIAA',
    'Northern Mich.': 'GLIAC',
    'Northern St.': 'NSIC',
    'Northwest Mo. St.': 'MIAA',
    'Northwestern Okla.': 'GAC',
    'Northwood': 'G-MAC',
    'Ohio Dominican': 'G-MAC',
    'Okla. Baptist': 'GAC',
    'Ouachita Baptist': 'GAC',
    'Pace': 'NE-10',
    'Pittsburg St.': 'MIAA',
    'Post': 'NE-10',
    'Quincy': 'GLVC',
    'Roosevelt': 'GLIAC',
    'Saginaw Valley': 'GLIAC',
    'Saint Anselm': 'NE-10',
    'Savannah St.': 'SIAC',
    'Seton Hill': 'PSAC',
    'Shaw': 'CIAA',
    'Shepherd': 'PSAC',
    'Shippensburg': 'PSAC',
    'Shorter': 'Conference Carolinas',
    'Sioux Falls': 'NSIC',
    'Slippery Rock': 'PSAC',
    'South Dakota Mines': 'RMAC',
    'Southeastern Okla.': 'GAC',
    'Southern Ark.': 'GAC',
    'Southern Conn. St.': 'NE-10',
    'Southern Nazarene': 'GAC',
    'Southwest Baptist': 'GLVC',
    'Southwest Minn. St.': 'NSIC',
    'Southwestern Okla.': 'GAC',
    'Sul Ross St.': 'LSC',
    'Tex. A&M-Kingsville': 'LSC',
    'Thomas More': 'G-MAC',
    'Tiffin': 'G-MAC',
    'Truman St.': 'GLVC',
    'Tusculum': 'SAC',
    'Tuskegee': 'SIAC',
    'UIndy': 'GLVC',
    'UNC Pembroke': 'Conference Carolinas',
    'UT Permian Basin': 'LSC',
    'UVA Wise': 'SAC',
    'Upper Iowa': 'GLVC',
    'Valdosta St.': 'GSC',
    'Virginia St.': 'CIAA',
    'Virginia Union': 'CIAA',
    'Walsh': 'G-MAC',
    'Washburn': 'MIAA',
    'Wayne St. (MI)': 'GLIAC',
    'Wayne St. (NE)': 'NSIC',
    'West Ala.': 'GSC',
    'West Chester': 'PSAC',
    'West Liberty': 'MEC',
    'West Tex. A&M': 'LSC',
    'West Va. Wesleyan': 'MEC',
    'West Virginia St.': 'MEC',
    'Western Colo.': 'RMAC',
    'Western N.M.': 'LSC',
    'Western Ore.': 'LSC',
    'Wheeling': 'MEC',
    'William Jewell': 'GLVC',
    'Wingate': 'SAC',
    'Winona St.': 'NSIC',
    'Winston-Salem': 'CIAA',
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


# The NCAA's raw position labels are finer-grained and inconsistent (DE/DT
# vs DL, DB vs S vs CB, offense's own TE bucket, etc.) than we want exposed
# as filter options. Collapsed to one canonical set of 9 the front-end
# filters against.
POSITION_MAP = {
    "QB": "QB",
    "RB": "RB", "FB": "RB",
    "WR": "WR", "TE": "WR",
    "OL": "OL", "LS": "OL",
    "DL": "DL", "DE": "DL", "DT": "DL",
    "LB": "LB",
    "CB": "CB",
    "S": "SAF", "SAF": "SAF", "DB": "SAF",
    "ATH": "ATH",
}


def normalize_position(raw_position):
    return POSITION_MAP.get(raw_position, "ATH")


def transform_row(division, category, conference_lookup, raw, row_id):
    position = normalize_position(raw.get("Position"))
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
            d_tfl = float(current["tfl"]) - float(previous["tfl"])
            d_pbu = current["pbu"] - previous["pbu"]
            d_int = current["int"] - previous["int"]
            d_soloSacks = current["soloSacks"] - previous["soloSacks"]
            d_astSacks = current["astSacks"] - previous["astSacks"]
            d_sackYds = current["sackYds"] - previous["sackYds"]
            if min(d_solo, d_ast, d_tfl, d_pbu, d_int, d_soloSacks, d_astSacks, d_sackYds) < 0:
                return None
            row.update({
                "solo": d_solo, "ast": d_ast, "total": d_solo + d_ast,
                "tfl": f"{d_tfl:.1f}" if d_tfl % 1 else str(int(d_tfl)),
                "pbu": d_pbu, "int": d_int,
                "soloSacks": d_soloSacks, "astSacks": d_astSacks, "sackYds": d_sackYds,
                "sacks": f"{d_soloSacks + 0.5 * d_astSacks:.1f}",
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


def build_defense_rows(division_slug, division_label, conference_lookup):
    """The "tackling" (Defense) category merges five separate NCAA
    leaderboards -- Total Tackles, Tackles For Loss, Passes Defended,
    Interceptions, and Sacks -- into one row per player, keyed by
    (player, team). Any player who appears on *any* of the five gets a
    row; fields from a leaderboard they don't appear on default to 0
    (a "best effort, not exhaustive" tradeoff -- explained in README.md)."""
    merged = {}  # (player, team) -> row dict

    def get_or_create(raw):
        key = (raw["Name"], raw["Team"])
        if key not in merged:
            position = normalize_position(raw.get("Position"))
            merged[key] = {
                "id": f"real-{division_slug}-tackling-{len(merged)}",
                "division": division_label,
                "week": "total",
                "category": "tackling",
                "position": position,
                "player": raw["Name"],
                "team": raw["Team"],
                "conference": conference_lookup(raw["Team"]),
                "games": _to_int(raw.get("G")),
                "sample": False,
                "solo": 0, "ast": 0, "total": 0, "tfl": 0, "pbu": 0, "int": 0,
                "soloSacks": 0, "astSacks": 0, "sackYds": 0, "sacks": "0.0",
            }
        return merged[key]

    for raw in fetch_all_pages(division_slug, STAT_IDS_DEFENSE_MERGE["tackles"]):
        row = get_or_create(raw)
        row["solo"] = _to_int(raw.get("Solo Tack"))
        row["ast"] = _to_int(raw.get("Asst Tack"))
        row["total"] = _to_int(raw.get("TT"))
    time.sleep(REQUEST_PAUSE_SECONDS)

    for raw in fetch_all_pages(division_slug, STAT_IDS_DEFENSE_MERGE["tfl"]):
        row = get_or_create(raw)
        row["tfl"] = raw.get("TTFL", "0")  # e.g. "8.5" -- half-TFLs are real (split between two players)
        row["games"] = max(row["games"], _to_int(raw.get("G")))
    time.sleep(REQUEST_PAUSE_SECONDS)

    for raw in fetch_all_pages(division_slug, STAT_IDS_DEFENSE_MERGE["pbu"]):
        row = get_or_create(raw)
        row["pbu"] = _to_int(raw.get("PBU"))
        row["games"] = max(row["games"], _to_int(raw.get("G")))
    time.sleep(REQUEST_PAUSE_SECONDS)

    for raw in fetch_all_pages(division_slug, STAT_IDS_DEFENSE_MERGE["int"]):
        row = get_or_create(raw)
        row["int"] = _to_int(raw.get("Int"))
        row["games"] = max(row["games"], _to_int(raw.get("G")))
    time.sleep(REQUEST_PAUSE_SECONDS)

    for raw in fetch_all_pages(division_slug, STAT_IDS_DEFENSE_MERGE["sacks"]):
        row = get_or_create(raw)
        row["soloSacks"] = _to_int(raw.get("Solo Sack"))
        row["astSacks"] = _to_int(raw.get("Asst Sack"))
        row["sackYds"] = _to_int(raw.get("Sack Yds"))
        row["sacks"] = raw.get("Tot Sack", "0")
        row["games"] = max(row["games"], _to_int(raw.get("G")))
    time.sleep(REQUEST_PAUSE_SECONDS)

    return list(merged.values())


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
    rows.extend(build_defense_rows(division_slug, division_label, conference_lookup))
    return rows
