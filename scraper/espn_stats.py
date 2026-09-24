"""
ESPN as the PRIMARY source of FBS + FCS player stats, with the NCAA API and
the conferences' own stats pages as fallbacks for anything ESPN lacks.

Why ESPN first: its player-statistics feed returns every player with any
production in one paged list (about 6,400 athletes across FBS and FCS), with
every category on the same record. The NCAA's national leaderboards drop
anyone below roughly the top 150 per category, and the conference pages only
show that conference's cutoff.

How the sources combine (merge_division):
  1. ESPN rows are built for every FBS/FCS player (build_espn_rows).
  2. Each NCAA row, then each conference-site row, is matched to an ESPN row
     of the same college + category + player. A match keeps ESPN's numbers
     and only borrows what ESPN doesn't carry (exact solo/assist sack split,
     a more specific position). No match means the fallback row is added --
     that's the "extra data points" a fallback exists for.
  3. scrub_duplicates() then runs over the whole finished dataset (every
     division), collapsing the same player listed twice.

Row shape is the same one the NCAA pipeline produces, so snapshots, weekly
diffs and the front-end are untouched. Each row also carries `source`
("espn" / "ncaa" / "conference") for auditing.
"""

import json
import os
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from naming import compact_name, same_person_name, team_key
from ncaa_api import _avg, _to_int, normalize_position, passing_efficiency

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
ESPN_STATS = "https://site.web.api.espn.com/apis/common/v3/sports/football/college-football/statistics/byathlete"
SEASON = 2026
PAGE_SIZE = 1000
PAUSE = 0.5
ATHLETE_STATS = "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/{season}/types/2/athletes/{id}/statistics/0?lang=en&region=us"
WORKERS = 8

COLLEGES_PATH = os.path.join(os.path.dirname(__file__), "..", "frontend", "src", "data", "colleges.json")

SOURCE_PRIORITY = {"espn": 3, "ncaa": 2, "conference": 1}

# ESPN spells positions per-slot (OT, ILB, FS...); fold them into the same
# canonical set the rest of the pipeline uses.
ESPN_POSITION_MAP = {
    "OT": "OL", "OG": "OL", "C": "OL", "OL": "OL", "LS": "LS",
    "DL": "DL", "DE": "DL", "DT": "DL", "NT": "DL", "EDGE": "DL",
    "LB": "LB", "ILB": "LB", "OLB": "LB", "MLB": "LB",
    "S": "SAF", "SS": "SAF", "FS": "SAF", "DB": "SAF",
}


def load_colleges():
    with open(COLLEGES_PATH, encoding="utf-8") as f:
        return json.load(f)


class NotFound(RuntimeError):
    """ESPN has no record at this URL (e.g. a player who never played)."""


def _get_json(url, retries=3):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            if err.code == 404:
                raise NotFound(url) from err
            last = err
        except Exception as err:  # noqa: BLE001 -- retried, then re-raised below
            last = err
        if attempt < retries - 1:
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"ESPN request failed after {retries} tries: {url}: {last}")


def fetch_espn_athletes():
    """Every athlete ESPN has season activity for (id, school, position, games),
    all pages. ESPN's bulk list only carries games played for college players,
    so the actual stat lines come from fetch_athlete_lines()."""
    athletes = []
    page, pages = 1, 1
    while page <= pages:
        url = f"{ESPN_STATS}?isqualified=false&limit={PAGE_SIZE}&season={SEASON}&seasontype=2&page={page}"
        data = _get_json(url)
        pages = data["pagination"]["pages"]
        athletes.extend(data["athletes"])
        page += 1
        time.sleep(PAUSE)
    return athletes


def _flatten(payload):
    """{category: {stat name: value}} from one athlete's season-statistics payload."""
    out = {}
    for cat in payload.get("splits", {}).get("categories", []):
        out[cat["name"]] = {s["name"]: s.get("value") for s in cat.get("stats", [])}
    return out


def fetch_athlete_lines(athletes, colleges):
    """Full season stat line for every listed athlete on an FBS/FCS team, fetched
    in parallel. A player with no record (never played) is simply skipped; only
    real errors count as failures. Returns ({athlete id: stats}, failures)."""
    college_ids = {c["id"] for c in colleges}
    wanted = [a["athlete"]["id"] for a in athletes if str(a["athlete"].get("teamId")) in college_ids]

    def one(aid):
        url = ATHLETE_STATS.format(season=SEASON, id=aid)
        try:
            return aid, _flatten(_get_json(url, retries=3)), False
        except NotFound:
            return aid, None, False
        except RuntimeError:
            return aid, None, True

    lines, failures = {}, []
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for aid, stats, failed in pool.map(one, wanted):
            if failed:
                failures.append(aid)
            elif stats is not None:
                lines[aid] = stats
    return lines, failures


# Positions with no stats the tracker uses -- skipped when listing a roster.
NO_STATS_POSITIONS = {"OL", "OT", "OG", "C", "LS", "K", "P", "PK"}


def fetch_roster_athletes(colleges, division, skip_ids=()):
    """Players on each team's roster, shaped like the bulk list's entries. ESPN's
    bulk list barely covers FCS (a few dozen players), but every FCS team has a
    full roster feed and each player's season line is available the same way,
    so FCS goes team by team. Skips ids already in `skip_ids`.

    The roster feed also carries each player's home state (birthPlace), which
    the bulk list doesn't -- collected here into `birth_state` for every player
    on the roster, not just the new ones `out` is for, since most of them
    (anyone the bulk list already found) are in `skip_ids` and would otherwise
    be skipped entirely. Returns (out, birth_state, failed_teams)."""
    skip = set(skip_ids)
    teams = [c for c in colleges if c["division"] == division]

    def one(college):
        try:
            data = _get_json(f"https://site.web.api.espn.com/apis/site/v2/sports/football/college-football/teams/{college['id']}/roster", retries=3)
        except RuntimeError:
            return college, None
        return college, data

    out, birth_state, failed_teams = [], {}, []
    with ThreadPoolExecutor(max_workers=6) as pool:
        for college, data in pool.map(one, teams):
            if data is None:
                failed_teams.append(college["name"])
                continue
            for group in data.get("athletes", []):
                for a in group.get("items", []):
                    state = (a.get("birthPlace") or {}).get("state") or ""
                    if state:
                        birth_state[a["id"]] = state
                    pos = ((a.get("position") or {}).get("abbreviation") or "").upper()
                    if a["id"] in skip or pos in NO_STATS_POSITIONS:
                        continue
                    out.append({"athlete": {"id": a["id"], "displayName": a.get("displayName", ""), "teamId": college["id"], "position": a.get("position")}})
    return out, birth_state, failed_teams


def _num(value):
    return 0 if value is None else value


def _fmt(value):
    value = _num(value)
    return str(int(value)) if float(value).is_integer() else f"{value:.1f}"


def _position(abbreviation):
    label = (abbreviation or "").upper()
    return ESPN_POSITION_MAP.get(label) or normalize_position(label)


def _general_games(athlete):
    """Games played from the bulk list, for athletes whose own payload omits it."""
    for cat in athlete.get("categories", []):
        if cat["name"] == "general" and cat["values"] and cat["values"][0] is not None:
            return cat["values"][0]
    return 0


def build_espn_rows(division, colleges, athletes, lines, birth_state=None):
    """Season-total rows for one division ("FBS" or "FCS") in the pipeline's
    row shape. `team` is the ESPN school name for now; merge_division swaps in
    the NCAA spelling where one exists so weekly diffs keep matching."""
    birth_state = birth_state or {}
    college_by_id = {c["id"]: c for c in colleges if c["division"] == division}
    slug = division.lower()
    rows = []
    for a in athletes:
        info = a["athlete"]
        college = college_by_id.get(str(info.get("teamId")))
        if not college:
            continue
        s = lines.get(info.get("id"))
        if not s:
            continue
        games = _to_int(_num(s.get("general", {}).get("gamesPlayed") or _general_games(a)))
        position = _position((info.get("position") or {}).get("abbreviation"))
        base = {
            "division": division,
            "week": "total",
            "position": position,
            "player": info.get("displayName", ""),
            "team": college["name"],
            "conference": college["conference"],
            "games": games,
            "sample": False,
            "source": "espn",
            "_collegeId": college["id"],
            "homeState": birth_state.get(info.get("id"), ""),
        }
        rid = f"real-{slug}-%s-espn-{info.get('id')}"

        p = s.get("passing", {})
        if _num(p.get("passingAttempts")) > 0:
            att, comp = _to_int(p.get("passingAttempts")), _to_int(p.get("completions"))
            yards, td, ints = _to_int(p.get("passingYards")), _to_int(p.get("passingTouchdowns")), _to_int(p.get("interceptions"))
            rows.append({**base, "id": rid % "passing", "category": "passing", "compAtt": f"{comp}/{att}", "att": att,
                         "yards": yards, "td": td, "int": ints, "rating": passing_efficiency(yards, td, comp, ints, att)})

        r = s.get("rushing", {})
        if _num(r.get("rushingAttempts")) > 0:
            att, yards = _to_int(r.get("rushingAttempts")), _to_int(r.get("rushingYards"))
            rows.append({**base, "id": rid % "rushing", "category": "rushing", "att": att, "yards": yards,
                         "avg": _avg(yards, att), "td": _to_int(r.get("rushingTouchdowns"))})

        rc = s.get("receiving", {})
        if _num(rc.get("receptions")) > 0:
            rec, yards = _to_int(rc.get("receptions")), _to_int(rc.get("receivingYards"))
            rows.append({**base, "id": rid % "receiving", "category": "receiving", "rec": rec, "yards": yards,
                         "avg": _avg(yards, rec), "td": _to_int(rc.get("receivingTouchdowns"))})

        d = s.get("defensive", {})
        di = s.get("defensiveInterceptions") or s.get("defensiveinterceptions") or {}
        solo, ast = _to_int(d.get("soloTackles")), _to_int(d.get("assistTackles"))
        sacks, tfl = float(_num(d.get("sacks"))), float(_num(d.get("tacklesForLoss")))
        pbu, ints = _to_int(d.get("passesDefended")), _to_int(di.get("interceptions"))
        if solo + ast > 0 or sacks > 0 or tfl > 0 or pbu > 0 or ints > 0:
            # ESPN reports total sacks only; solo/assist is estimated from it
            # (x.5 = one assist) until an NCAA row supplies the exact split.
            solo_sacks = int(sacks)
            ast_sacks = round((sacks - int(sacks)) * 2)
            rows.append({**base, "id": rid % "tackling", "category": "tackling", "solo": solo, "ast": ast, "total": _to_int(d.get("totalTackles")) or solo + ast,
                         "tfl": _fmt(tfl), "pbu": pbu, "int": ints, "soloSacks": solo_sacks, "astSacks": ast_sacks,
                         "sackYds": _to_int(d.get("sackYards")), "sacks": _fmt(sacks), "_sackSplitEstimated": True})
    return rows


# ----------------------------------------------------------------------- merge

def _college_lookup(colleges):
    lookup = {}
    for c in colleges:
        for name in (c["name"], c["displayName"]):
            lookup[team_key(name)] = c
    return lookup


def merge_division(division, espn_rows, fallback_sets, colleges):
    """espn_rows: primary. fallback_sets: [(source_name, rows), ...] in priority
    order (NCAA first, then conference sites). Returns (rows, stats) where stats
    counts what each fallback contributed."""
    lookup = _college_lookup([c for c in colleges if c["division"] == division])
    rows = [dict(r) for r in espn_rows]
    index = {}
    for r in rows:
        index.setdefault((r["_collegeId"], r["category"]), []).append(r)

    ncaa_label = {}  # college id -> the NCAA/conference spelling of the team, kept for diff continuity
    for _, fb_rows in fallback_sets:
        for fb in fb_rows:
            c = lookup.get(team_key(fb["team"]))
            if c and c["id"] not in ncaa_label:
                ncaa_label[c["id"]] = fb["team"]

    stats = {}
    for source, fb_rows in fallback_sets:
        merged = added = 0
        for fb in fb_rows:
            college = lookup.get(team_key(fb["team"]))
            cid = college["id"] if college else None
            match = None
            if cid:
                for cand in index.get((cid, fb["category"]), []):
                    if same_person_name(cand["player"], fb["player"]):
                        match = cand
                        break
            if match:
                merged += 1
                if match.get("_sackSplitEstimated") and fb["category"] == "tackling" and source == "ncaa":
                    for key in ("soloSacks", "astSacks", "sackYds"):
                        match[key] = fb.get(key, match[key])
                    match.pop("_sackSplitEstimated", None)
                if match.get("position") == "ATH" and fb.get("position") not in (None, "ATH"):
                    match["position"] = fb["position"]
                continue
            new = dict(fb)
            new["source"] = source
            if college:
                new["_collegeId"] = cid
                new["division"] = division
                new.setdefault("conference", college["conference"])
                index.setdefault((cid, fb["category"]), []).append(new)
            rows.append(new)
            added += 1
        stats[source] = {"matched_into_espn": merged, "added": added}

    for r in rows:
        cid = r.get("_collegeId")
        if cid and cid in ncaa_label:
            r["team"] = ncaa_label[cid]
        r.pop("_collegeId", None)
        r.pop("_sackSplitEstimated", None)
    return rows, stats


# ----------------------------------------------------------------------- scrub

PRIMARY_STAT = {"passing": "yards", "rushing": "yards", "receiving": "yards", "tackling": "total"}


def _weight(row):
    return (
        SOURCE_PRIORITY.get(row.get("source"), 2),
        _to_int(row.get("games")),
        _to_int(row.get(PRIMARY_STAT.get(row["category"], "yards"))),
    )


def _compatible_positions(a, b):
    return a == b or "ATH" in (a, b) or not a or not b


def scrub_duplicates(rows):
    """Collapses the same player listed twice: same division, week, category and
    team (spellings of the school compared by normalized key), and a player name
    that is the same person -- identical after normalizing ("Reginald Vick, Jr."
    / "Jr.,Reginald Vick"), or the same last name with a compatible first name
    (Sam / Samuel) at a compatible position. The row from the better source
    wins (ESPN > NCAA > conference), then the one with more games/production.
    Different players who merely share a name are safe: they sit on different
    teams, or (same team, same last name) disagree on first name.
    Returns (rows, report)."""
    groups = {}
    for i, r in enumerate(rows):
        groups.setdefault((r["division"], r["week"], r["category"], team_key(r["team"])), []).append(i)

    drop = set()
    examples = []
    for indexes in groups.values():
        if len(indexes) < 2:
            continue
        kept = []  # indexes of rows kept so far in this group
        for i in sorted(indexes, key=lambda i: _weight(rows[i]), reverse=True):
            row = rows[i]
            twin = next(
                (k for k in kept if same_person_name(rows[k]["player"], row["player"]) and _compatible_positions(rows[k].get("position"), row.get("position"))),
                None,
            )
            if twin is None:
                kept.append(i)
                continue
            keeper = rows[twin]
            for key, value in row.items():
                if key not in keeper or keeper[key] in (None, ""):
                    keeper[key] = value
            drop.add(i)
            if len(examples) < 12:
                examples.append(f"{row['division']} {row['category']} {row['team']}: '{row['player']}' ({row.get('source', '?')}) folded into '{keeper['player']}' ({keeper.get('source', '?')})")

    out = [r for i, r in enumerate(rows) if i not in drop]

    # Ids must be unique -- the front-end keys rows by them.
    seen = set()
    renamed = 0
    for r in out:
        rid = r["id"]
        if rid in seen:
            n = 2
            while f"{rid}-dup{n}" in seen:
                n += 1
            r["id"] = f"{rid}-dup{n}"
            renamed += 1
        seen.add(r["id"])

    return out, {"removed": len(drop), "ids_repaired": renamed, "examples": examples}
