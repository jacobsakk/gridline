"""
JUCO scraper for 4 of the 5 target PrestoSports conferences -- ICCAC,
KJCCC, MACCC, and NJCAA Region 5.

CCCAA (3c2asports.org) is NOT included here -- confirmed it needs
different handling entirely: its canonical domain resolves to
cccaa.prestosports.com and its team-stats page has no server-rendered
team links at all (0 matches vs. real data on the other 4 conferences'
identical page shape) -- worth a fresh look with the naia.py DataTables
approach when tackling it.

Scenic West is a different platform (SIDEARM Sports) and explicitly
deprioritized per the project brief -- not attempted here.

Uses Playwright even though these pages are plain server-rendered HTML
(no client-side table library involved, unlike NAIA) -- confirmed the
hard way: a plain urllib GET that worked fine minutes earlier started
getting an AWS WAF JS challenge (HTTP 202, empty body, `x-amzn-waf-
action: challenge` header) once enough rapid requests had been made
during investigation. A real browser clears that challenge like it does
Cloudflare's for NAIA; a plain HTTP client cannot. Matches the original
project brief's own finding that these sites need "a real headless
browser... and realistic pacing between requests."

Verified approach, per team:
1. GET /sports/fball/{season}/teams -> team slugs
2. GET /sports/fball/{season}/teams/{slug} -> team display name (from
   <title>, format "... - {Team Name} - {Conference Name}") and numeric
   teamId (from any players?teamId=... link on the page)
3. GET /sports/fball/{season}/players?teamId={id}&view=lineup&pos={pos}&
   sort={sort}&r=0&ajax=true&tmpl=stats-bios-template -> one HTML table
   per stat category, with FULL names already resolved server-side (no
   separate name-lookup step needed for these 4 conferences, unlike what
   the original investigation found on other PrestoSports pages).

Column layouts were verified against real rendered rows, not guessed --
e.g. Tony Palmer (ICCAC, LB) rendered as SOLO 16/AST 8/TOT 24/TFL 1.5/
FF 1/BRUP 1, which matched this parser's column mapping exactly.

Known limitations:
- NJCAA Region 5's own site currently only has 2 of its ~8 member teams
  listed (confirmed by checking its teams page directly) -- not a
  scraping bug, the site itself just doesn't have the others set up
  this season.
- NJCAA Region 5's tables also don't include Yr/Pos columns and give
  abbreviated names ("K Provost", not "Kyle Provost") -- both confirmed
  directly, unlike ICCAC/KJCCC/MACCC which give full names and Yr/Pos.
  Position falls back to "ATH". Getting full names would need a second
  per-player request; not done given this conference already has just
  2 of 8 teams.
"""

import re
import time

from ncaa_api import normalize_position as _normalize_position_base

SEASON = "2026-27"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
REQUEST_PAUSE_SECONDS = 0.4

CONFERENCES = {
    "ICCAC": "iccac.org",
    "KJCCC": "kjccc.org",
    "MACCC": "macccathletics.com",
    "NJCAA Region 5": "njcaaregion5.com",
}

# category -> query params (pos/sort/min) for the fetch URL. Column layout
# is NOT hardcoded here -- it's read from each response's own <thead>
# data-key attributes (see parse_rows), because it varies by conference:
# e.g. NJCAA Region 5's defense table omits Yr/Pos entirely, confirmed
# directly (its header is ['Rk','Name','&nbsp;','gp','tkl',...], not
# ['#','Name','Yr','Pos','gp','tkl',...] like the other 3 conferences).
CATEGORY_CONFIG = {
    "passing": {"pos": "qb", "sort": "pyd", "min": "pa"},
    "rushing": {"pos": "rb", "sort": "ryd", "min": "rat"},
    "receiving": {"pos": "wr", "sort": "wat", "min": "wat"},
    "tackling": {"pos": "d", "sort": "dtt", "min": "dtt"},
}

# Defense's table repeats the "yds" header for 4 different stats (sack
# yards, TFL yards, fumble-recovery yards, INT return yards) -- data-key
# is literally "yds" each time, so a plain dict would silently keep only
# the last one. Disambiguated by the stat column immediately before it.
_YDS_PREFIX_RENAME = {"sck": "sack", "tfl": "tfl", "fr": "fr", "int": "int"}


def normalize_position(raw_position):
    first = (raw_position or "").split("/")[0].strip()
    return _normalize_position_base(first)


def _get(page, url):
    """page is a Playwright Page, reused across all calls in one run so the
    WAF challenge (once cleared) stays cleared for the rest of the session.
    A challenged response is a near-empty page, not real content -- retry
    with a short wait (Playwright resolves the JS challenge like a real
    browser would; a plain HTTP client can't). Also retries on a transient
    network error (e.g. a WiFi blip) rather than crashing a whole multi-
    minute run over one flaky request."""
    content = ""
    for attempt in range(4):
        try:
            page.goto(url, timeout=45000, wait_until="domcontentloaded")
            content = page.content()
            if len(content) > 3000:
                return content
        except Exception:
            pass
        page.wait_for_timeout(3000 * (attempt + 1))
    return content


def _to_int(value, default=0):
    try:
        return int(float(str(value).replace("%", "").strip()))
    except (TypeError, ValueError):
        return default


def _clean_str_stat(value, default="0.0"):
    v = (value or "").strip()
    return default if v in ("", "-") else v


def get_team_slugs(page, domain):
    html = _get(page, f"https://{domain}/sports/fball/{SEASON}/teams")
    return sorted(set(re.findall(r'teams/([a-z0-9]+)"', html)))


def get_team_info(page, domain, slug):
    """Returns (team_name, team_id), or (slug, None) if either can't be found."""
    html = _get(page, f"https://{domain}/sports/fball/{SEASON}/teams/{slug}")
    team_name = slug
    title_match = re.search(r"<title>\s*([^<]+?)\s*</title>", html)
    if title_match:
        parts = [p.strip() for p in title_match.group(1).split(" - ")]
        if len(parts) >= 2 and parts[1]:
            team_name = parts[1]
    id_match = re.search(r"teamId=([a-z0-9]+)", html)
    team_id = id_match.group(1) if id_match else None
    return team_name, team_id


def _header_keys(html, category):
    """Reads the real column order for THIS response from its own <thead>
    data-key attributes. Only the defense (tackling) table repeats "yds"
    for 4 different stats -- confirmed directly, the other categories each
    have exactly one -- so disambiguation only kicks in there; otherwise a
    single genuine "yds" column would get wrongly merged with whatever
    happens to precede it (e.g. receiving's "yds" would become "rec/gyds")."""
    thead_match = re.search(r"<thead[^>]*>(.*?)</thead>", html, re.S)
    if not thead_match:
        return []
    raw_keys = re.findall(r'data-key="([^"]*)"', thead_match.group(1))
    if category != "tackling":
        return raw_keys

    resolved = []
    last_meaningful = None
    for k in raw_keys:
        if k == "yds" and last_meaningful:
            resolved.append(f"{_YDS_PREFIX_RENAME.get(last_meaningful, last_meaningful)}yds")
        else:
            resolved.append(k)
            last_meaningful = k
    return resolved


def parse_rows(html, category):
    header_keys = _header_keys(html, category)
    if "Name" not in header_keys:
        return []
    name_idx = header_keys.index("Name")
    pos_idx = header_keys.index("Pos") if "Pos" in header_keys else None

    rows = []
    for row_html in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S):
        tds = re.findall(r"<td[^>]*>(.*?)</td>", row_html, re.S)
        if len(tds) != len(header_keys):
            continue
        name_match = re.search(r'<a href="[^"]*/players/([a-z0-9]+)">\s*(.*?)\s*</a>', tds[name_idx], re.S)
        if not name_match:
            continue
        player_id = name_match.group(1)
        full_name = re.sub(r"\s+", " ", name_match.group(2)).strip()
        position = re.sub(r"<[^>]+>", "", tds[pos_idx]).strip() if pos_idx is not None else ""

        stats = {}
        for key, val in zip(header_keys, tds):
            if key in ("#", "Rk", "Name", "Yr", "Pos", "&nbsp;"):
                continue
            stats[key] = re.sub(r"<[^>]+>", "", val).strip()

        rows.append({"playerId": player_id, "fullName": full_name, "position": position, "stats": stats})
    return rows


def fetch_team_category(page, domain, team_id, category):
    cfg = CATEGORY_CONFIG[category]
    url = (
        f"https://{domain}/sports/fball/{SEASON}/players"
        f"?teamId={team_id}&view=lineup&sort={cfg['sort']}&pos={cfg['pos']}"
        f"&r=0&ajax=true&tmpl=stats-bios-template&min={cfg['min']}&cs=n"
    )
    return parse_rows(_get(page, url), category)


def transform_row(raw, category, team_name, conference, row_id_prefix):
    stats = raw["stats"]
    position = normalize_position(raw["position"])
    base = {
        "division": "JUCO",
        "week": "total",
        "position": position,
        "player": raw["fullName"],
        "team": team_name,
        "conference": conference,
        "games": _to_int(stats.get("gp")),
        "sample": False,
    }

    if category == "passing":
        att = _to_int(stats.get("att"))
        comp = _to_int(stats.get("comp"))
        return {
            **base, "id": f"{row_id_prefix}-passing", "category": "passing",
            "compAtt": f"{comp}/{att}", "att": att,
            "yards": _to_int(stats.get("yds")), "td": _to_int(stats.get("td")),
            "int": _to_int(stats.get("int")), "rating": _clean_str_stat(stats.get("effic")),
        }
    if category == "rushing":
        return {
            **base, "id": f"{row_id_prefix}-rushing", "category": "rushing",
            "att": _to_int(stats.get("rush")), "yards": _to_int(stats.get("yds")),
            "td": _to_int(stats.get("td")), "avg": _clean_str_stat(stats.get("avg")),
        }
    if category == "receiving":
        return {
            **base, "id": f"{row_id_prefix}-receiving", "category": "receiving",
            "rec": _to_int(stats.get("rec")), "yards": _to_int(stats.get("yds")),
            "td": _to_int(stats.get("td")), "avg": _clean_str_stat(stats.get("avg")),
        }

    # tackling -- JUCO only reports one combined sack total (no solo/
    # assisted split like NCAA/NAIA), so it's stored in soloSacks with
    # astSacks pinned to 0; the weekly-delta math (soloSacks + 0.5*astSacks)
    # still comes out exactly right since astSacks never contributes.
    solo = _to_int(stats.get("tkl"))
    ast = _to_int(stats.get("ast"))
    try:
        sacks_num = float(_clean_str_stat(stats.get("sck")))
    except ValueError:
        sacks_num = 0.0
    return {
        **base, "id": f"{row_id_prefix}-tackling", "category": "tackling",
        "solo": solo, "ast": ast, "total": solo + ast,
        "tfl": _clean_str_stat(stats.get("tfl")),
        "pbu": _to_int(stats.get("brup")), "int": _to_int(stats.get("int")),
        "soloSacks": sacks_num, "astSacks": 0,
        "sackYds": _to_int(stats.get("sackyds")), "sacks": f"{sacks_num:.1f}",
    }


def build_juco_rows(page):
    all_rows = []
    for conference, domain in CONFERENCES.items():
        slugs = get_team_slugs(page, domain)
        time.sleep(REQUEST_PAUSE_SECONDS)
        for slug in slugs:
            team_name, team_id = get_team_info(page, domain, slug)
            time.sleep(REQUEST_PAUSE_SECONDS)
            if not team_id:
                continue
            for category in CATEGORY_CONFIG:
                raw_rows = fetch_team_category(page, domain, team_id, category)
                for raw in raw_rows:
                    row_id_prefix = f"real-juco-{slug}-{raw['playerId']}"
                    all_rows.append(transform_row(raw, category, team_name, conference, row_id_prefix))
                time.sleep(REQUEST_PAUSE_SECONDS)
    return all_rows
