"""
Supplements the NCAA API's national "leaders" lists (capped at roughly the
top 150 nationally per category -- confirmed directly against ncaa.com
itself, see README) with each conference's OWN official stats page. A
conference site shows every player who cracked THAT conference's cutoff,
not just the national one -- confirmed directly: the MAC's own site lists
25 rushers this season vs. only 6 MAC players in the NCAA's national
rushing leaderboard.

Every conference below is on the Sidearm Sports platform -- confirmed
directly across all of them: `stats.aspx?path=football&year=YYYY`,
server-rendered plain HTML (no browser needed, unlike NAIA/JUCO/CCCAA).
Two conferences (Big Ten, SoCon) use a different, newer leaderboard
platform and aren't covered here yet -- a real gap, not an oversight, left
for a follow-up since it's a second scraper for just 2 of 37 conferences.
Two more (Mountain East, SIAC) had no working stats page found at all when
checked directly (server errors on every season tried, not a URL-guessing
problem), so they're simply absent from the map below.

These leader tables don't carry each player's position at all (unlike the
NCAA API's own leaderboards), so a fixed default per category is used
instead -- right for the overwhelming majority of players in each category
(a rushing-leaders entry is essentially always a real RB) but not
guaranteed for every one, same kind of best-effort tradeoff already made
elsewhere in this project (e.g. Defense's shared leaderboard merge).
Defense itself isn't covered here: the NCAA API's build_defense_rows()
already merges 5 separate leaderboards, and these conference sites split
defense differently, with no single clean equivalent -- out of scope.
"""

import datetime
import re
import time
import urllib.request

REQUEST_PAUSE_SECONDS = 0.5

# division -> {conference name (matches the NCAA API's own conference
# tagging, confirmed against fetch_conference_map()'s real output) -> domain}
CONFERENCE_SITES = {
    "FBS": {
        "ACC": "theacc.com",
        "American": "theamerican.org",
        "Big 12": "big12sports.com",
        "CUSA": "conferenceusa.com",
        "MAC": "getsomemaction.com",
        "Mountain West": "themw.com",
        "Pac-12": "pac-12.com",
        "Sun Belt": "sunbeltsports.org",
    },
    "FCS": {
        "Big Sky": "bigskyconf.com",
        "CAA": "caasports.com",
        "MEAC": "meacsports.com",
        "MVFC": "valley-football.org",
        "NEC": "necsports.com",
        "Patriot": "patriotleague.org",
        "Pioneer": "pioneer-football.org",
        "SWAC": "swac.org",
        "Southland": "southland.org",
        "UAC": "uacsports.com",
    },
    "D2": {
        "CIAA": "theciaa.com",
        "Conference Carolinas": "conferencecarolinas.com",
        "G-MAC": "greatmidwestsports.com",
        "GAC": "greatamericanconference.com",
        "GLIAC": "gliac.org",
        "GLVC": "glvcsports.com",
        "GSC": "gscsports.org",
        "LSC": "lonestarconference.org",
        "MIAA": "themiaa.com",
        "NE-10": "northeast10.org",
        "NSIC": "northernsun.org",
        "PSAC": "psacsports.org",
        "RMAC": "rmacsports.org",
        "SAC": "thesac.com",
    },
}

# category -> (section id on the Sidearm page, default position for a
# player found only here)
CATEGORY_SECTIONS = {
    "passing": ("ind_pass", "QB"),
    "rushing": ("ind_rush", "RB"),
    "receiving": ("ind_rec", "WR"),
}

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


def _fetch_current_season_html(domain):
    """A conference's page for the newest season isn't always created yet
    -- confirmed directly (SAC's 2026 page 404s, 2025 works fine) -- so try
    this year then last year and use whichever actually has data."""
    this_year = datetime.date.today().year
    for year in (this_year, this_year - 1):
        try:
            html = _get(f"https://{domain}/stats.aspx?path=football&year={year}")
        except Exception:
            continue
        if 'id="ind_rush"' in html:
            return html
    return None


def _to_int(value, default=0):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _parse_leader_table(html, section_id):
    """Returns [{"player": ..., "team": ..., "stats": {header: value}}] for
    one Sidearm leader table. Reads the table's own <thead> for column
    names (same robustness principle as juco.py's _header_keys()) instead
    of hardcoding column positions, since 32 different conference sites
    won't all lay their tables out identically."""
    section_match = re.search(rf'id="{section_id}"[^>]*>.*?<table.*?</table>', html, re.S)
    if not section_match:
        return []
    table_html = section_match.group(0)

    header_match = re.search(r"<thead.*?</thead>", table_html, re.S)
    body_match = re.search(r"<tbody>(.*?)</tbody>", table_html, re.S)
    if not header_match or not body_match:
        return []

    headers = [re.sub(r"<[^>]+>", "", h).strip() for h in re.findall(r"<th[^>]*>(.*?)</th>", header_match.group(0), re.S)]
    stat_headers = [h for h in headers if h not in ("Index", "Player", "")]

    rows = []
    for row_html in re.findall(r"<tr>(.*?)</tr>", body_match.group(1), re.S):
        # The player name+team live in the row's one <th>, e.g.
        # "Watson III,William (Massachusetts)" -- confirmed directly.
        name_match = re.search(r"<th[^>]*>([^<(]+)\(([^)]+)\)</th>", row_html, re.S)
        if not name_match:
            continue
        raw_name, team = name_match.group(1).strip(), name_match.group(2).strip()
        if "," in raw_name:
            last, first = raw_name.split(",", 1)
            player = f"{first.strip()} {last.strip()}"
        else:
            player = raw_name

        cells = [re.sub(r"<[^>]+>", "", c).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", row_html, re.S)]
        # cells[0] is always the blank rank-index column (see module
        # docstring's captured HTML) -- the real stat values start at [1].
        stats = dict(zip(stat_headers, cells[1:]))
        rows.append({"player": player, "team": team, "stats": stats})
    return rows


def _row_from_stats(category, default_position, player, team, division, conference, stats, row_id):
    games = _to_int(stats.get("G"))
    base = {
        "id": row_id,
        "division": division,
        "week": "total",
        "category": category,
        "position": default_position,
        "player": player,
        "team": team,
        "conference": conference,
        "games": games,
        "sample": False,
    }
    if category == "passing":
        comp, att = _to_int(stats.get("COMP")), _to_int(stats.get("ATT"))
        return {
            **base, "compAtt": f"{comp}/{att}", "att": att,
            "yards": _to_int(stats.get("YDS")), "td": _to_int(stats.get("TD")),
            "int": _to_int(stats.get("INT")), "rating": stats.get("EFFIC", "0.0"),
        }
    if category == "rushing":
        return {
            **base, "att": _to_int(stats.get("ATT")), "yards": _to_int(stats.get("YDS")),
            "avg": stats.get("AVG", "0.0"), "td": _to_int(stats.get("TD")),
        }
    # receiving
    return {
        **base, "rec": _to_int(stats.get("REC")), "yards": _to_int(stats.get("YDS")),
        "avg": stats.get("AVG/C", "0.0"), "td": _to_int(stats.get("TD")),
    }


def fetch_supplemental_rows(division, existing_rows):
    """existing_rows: the NCAA-API rows already built for this division.
    Dedupes by (player name, category) rather than including team --
    confirmed the NCAA API and these conference sites abbreviate team
    names differently (e.g. "Central Mich." vs "Central Michigan"), so
    requiring an exact team match would under-dedupe and create doubled
    rows for the same real player."""
    existing_keys = {(r["player"], r["category"]) for r in existing_rows}
    conferences = CONFERENCE_SITES.get(division, {})
    new_rows = []
    counter = 0

    for conf_name, domain in conferences.items():
        html = _fetch_current_season_html(domain)
        if not html:
            print(f"    {conf_name} ({domain}): no working stats page, skipping")
            continue

        added_this_conf = 0
        for category, (section_id, default_position) in CATEGORY_SECTIONS.items():
            for entry in _parse_leader_table(html, section_id):
                key = (entry["player"], category)
                if key in existing_keys:
                    continue
                counter += 1
                added_this_conf += 1
                row_id = f"real-{division.lower()}-conf-{category}-{counter}"
                new_rows.append(
                    _row_from_stats(category, default_position, entry["player"], entry["team"], division, conf_name, entry["stats"], row_id)
                )
                existing_keys.add(key)
        print(f"    {conf_name}: +{added_this_conf} players not in the national leaderboard")
        time.sleep(REQUEST_PAUSE_SECONDS)

    return new_rows
