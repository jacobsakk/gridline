"""
NJCAA (national junior college) football player stats, from the same public
GraphQL API njcaa.org's own site loads its pages from. No browser is needed:
this is plain HTTPS, so it's unaffected by the bot checks that now sit in front
of the PrestoSports stats sites (NAIA, CCCAA, the JUCO conference sites).

Coverage: the 50-odd NJCAA football programs. California's community colleges
are the CCCAA, a separate body that isn't in this feed.

The query is the one njcaa.org's stats pages send, trimmed to the fields used
here; the API accepts it without any key.
"""

import json
import re
import urllib.request

from ncaa_api import normalize_position

API_URL = "https://public-graphql-api.ardorsportshub.com/public/graphql"
TENANT_ID = "404933495157163011"  # NJCAA
SEASON = "2026-27"
PAGE_SIZE = 250  # the API caps a page at 250 players

QUERY = """
query SiteTemplateSeasonStats(
  $tenantId: ID!, $season: String!, $sport: String!, $playerOffset: Int, $playerLimit: Int,
  $playerSortKey: String, $playerSortDirection: String, $playerScope: String,
  $includePlayers: Boolean!, $includeGames: Boolean!, $useRegionLeaders: Boolean!
) {
  seasonStats(
    tenantId: $tenantId, season: $season, sport: $sport, playerOffset: $playerOffset, playerLimit: $playerLimit,
    playerSortKey: $playerSortKey, playerSortDirection: $playerSortDirection, playerScope: $playerScope,
    includePlayers: $includePlayers, includeGames: $includeGames, useRegionLeaders: $useRegionLeaders
  ) {
    playerTotal
    schools { school teamId players { playerId name position year stats } }
  }
}
"""

TEAMS_QUERY = """
query SiteTemplateTeams($tenantId: ID!, $limit: Int, $sport: String!, $season: String!) {
  listTeams(tenantId: $tenantId, limit: $limit, sport: $sport, season: $season) { schoolName displayName regionName }
}
"""


def _post(operation, query, variables):
    body = json.dumps({"operationName": operation, "query": query, "variables": variables}).encode()
    req = urllib.request.Request(
        API_URL, data=body,
        headers={"Content-Type": "application/json", "User-Agent": "gridline-stats/1.0", "Origin": "https://www.njcaa.org"},
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        payload = json.loads(resp.read())
    if payload.get("errors"):
        raise RuntimeError(f"NJCAA API error: {payload['errors'][0].get('message')}")
    return payload["data"]


def _num(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _int(value):
    return int(round(_num(value)))


def _one_decimal(value):
    return f"{_num(value):.1f}"


def fetch_players():
    """[(school name, player dict)] for every football player with a season line."""
    players = []
    offset = 0
    while True:
        data = _post("SiteTemplateSeasonStats", QUERY, {
            "tenantId": TENANT_ID, "season": SEASON, "sport": "fball",
            "playerOffset": offset, "playerLimit": PAGE_SIZE, "playerSortKey": "name", "playerSortDirection": "asc",
            "playerScope": "overall", "includePlayers": True, "includeGames": False, "useRegionLeaders": False,
        })["seasonStats"]
        page = [(s["school"], p) for s in data["schools"] for p in (s["players"] or [])]
        players += page
        offset += len(page)
        if not page or offset >= (data["playerTotal"] or 0):
            return players


# NJCAA's API only groups football teams by region, not by conference, so the conference is looked up here (from
# the public list of junior college football programs on Wikipedia, in the acronym style the rest of the JUCO data
# uses). Teams already saved under a conference from their own conference site keep that label instead. A program
# that isn't listed is a newer program with no conference, shown as Independent.
CONFERENCES = {
    "SWJCFC": [  # Southwest Junior College Football Conference
        "Blinn College", "Kilgore College", "Navarro College", "Northeastern Oklahoma A&M College",
        "Trinity Valley Community College", "Tyler Junior College", "Cisco College", "New Mexico Military Institute",
    ],
    "KJCCC": [  # Kansas Jayhawk Community College Conference
        "Butler Community College-KS", "Highland Community College-Kansas", "Coffeyville Community College", "Dodge City Community College",
        "Garden City Community College", "Hutchinson Community College", "Independence Community College",
    ],
    "MCAC": [  # Minnesota College Athletic Conference
        "Central Lakes College-Brainerd", "Minnesota North College - Mesabi Range", "Minnesota North College - Vermilion",
        "Minnesota State Community and Technical College", "Minnesota West Community and Technical College",
        "North Dakota State College of Science", "Rochester Community and Technical College",
    ],
    "NEFC": ["Nassau Community College"],  # Northeast Football Conference
    "MACCC": [  # Mississippi (labelled MACCC throughout the tracker)
        "Coahoma Community College", "Copiah-Lincoln Community College", "East Central Community College",
        "East Mississippi Community College", "Hinds Community College", "Holmes Community College", "Itawamba Community College",
        "Jones College", "Mississippi Delta Community College", "Mississippi Gulf Coast Community College",
        "Northeast Mississippi Community College", "Northwest Mississippi Community College", "Pearl River Community College",
        "Southwest Mississippi Community College",
    ],
    "ICCAC": ["Ellsworth Community College", "Iowa Central Community College", "Iowa Western Community College"],  # Iowa
}
_CONFERENCE_OF = {name: conf for conf, names in CONFERENCES.items() for name in names}


def conference_for(school):
    return _CONFERENCE_OF.get(school, "Independent")


def _slug(text):
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def to_rows(school, player, conference):
    """One tracker row per stat category the player has numbers in (same shapes as juco.transform_row)."""
    s = player.get("stats") or {}
    base = {
        "division": "JUCO", "week": "total", "position": normalize_position((player.get("position") or "").upper().split("_")[0]),
        "player": player["name"], "team": school, "conference": conference, "games": _int(s.get("gp")),
        "sample": False, "profileUrl": "",
    }
    prefix = f"real-juco-{_slug(school)}-njcaa{player['playerId']}"
    rows = []
    if _num(s.get("passatt")) > 0:
        rows.append({
            **base, "id": f"{prefix}-passing", "category": "passing", "compAtt": f"{_int(s.get('passcomp'))}/{_int(s.get('passatt'))}",
            "att": _int(s.get("passatt")), "yards": _int(s.get("passyds")), "td": _int(s.get("passtd")), "int": _int(s.get("passint")),
            "rating": _one_decimal(s.get("rating")),
        })
    if _num(s.get("rushatt")) > 0:
        rows.append({
            **base, "id": f"{prefix}-rushing", "category": "rushing", "att": _int(s.get("rushatt")), "yards": _int(s.get("rushyds")),
            "td": _int(s.get("rushtd")), "avg": _one_decimal(s.get("rushavg")),
        })
    if _num(s.get("rec")) > 0:
        rows.append({
            **base, "id": f"{prefix}-receiving", "category": "receiving", "rec": _int(s.get("rec")), "yards": _int(s.get("recyds")),
            "td": _int(s.get("rectd")), "avg": _one_decimal(s.get("recavg")),
        })
    solo, ast = _int(s.get("tackua")), _int(s.get("tacka"))
    if solo + ast > 0 or _num(s.get("tackles")) > 0:
        if solo + ast == 0:
            solo = _int(s.get("tackles"))
        sacks = _num(s.get("sacks"))
        rows.append({
            **base, "id": f"{prefix}-tackling", "category": "tackling", "solo": solo, "ast": ast, "total": solo + ast,
            "tfl": _one_decimal(s.get("tfl")), "pbu": _int(s.get("brup")), "int": _int(s.get("int")),
            "soloSacks": sacks, "astSacks": 0, "sackYds": _int(s.get("sackyds")), "sacks": f"{sacks:.1f}",
        })
    return rows


def build_njcaa_rows():
    rows = []
    for school, player in fetch_players():
        rows += to_rows(school, player, conference_for(school))
    return rows


if __name__ == "__main__":
    out = build_njcaa_rows()
    teams = {r["team"] for r in out}
    print(f"{len(out)} rows from {len(teams)} teams")
