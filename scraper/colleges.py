"""
Builds the data behind the Colleges section of the Coach Hub:

  frontend/src/data/colleges.json       every FBS + FCS team (name, mascot, city,
                                         state, conference, colors, logo)
  frontend/src/data/standings.json      records/standings + AP (FBS) and FCS Coaches
                                         poll top 25
  frontend/src/data/depth-charts.json   Ourlads depth charts (FBS only -- that's all
                                         Ourlads covers)

Sources: ESPN's public site API for the team list, standings and rankings
(the NCAA API wrapper in ncaa_api.py has standings too, but ESPN's carries the
team ids/logos we need to key everything by), and ourlads.com for depth charts.

Run from the scraper/ directory:  python3 colleges.py [colleges|standings|depth]
With no argument it runs all three.
"""

import html
import json
import unicodedata
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
ESPN_WEB = "https://site.web.api.espn.com/apis"
ESPN_CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football"
SEASON = 2026
PAUSE = 0.35

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "src", "data")
COLLEGES_PATH = os.path.join(DATA_DIR, "colleges.json")
STANDINGS_PATH = os.path.join(DATA_DIR, "standings.json")
DEPTH_PATH = os.path.join(DATA_DIR, "depth-charts.json")

GROUPS = {"FBS": 80, "FCS": 81}


def get(url, as_json=True, retries=3):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json,text/html"})
            with urllib.request.urlopen(req, timeout=45) as resp:
                body = resp.read().decode("utf-8", errors="replace")
            time.sleep(PAUSE)
            return json.loads(body) if as_json else body
        except Exception as err:  # noqa: BLE001 -- retried, then re-raised below
            last = err
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"GET failed after {retries} tries: {url}: {last}")


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"), ensure_ascii=False)
    print(f"wrote {os.path.relpath(path)} ({os.path.getsize(path) // 1024} KB)")


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def logo_url(team_id):
    return f"https://a.espncdn.com/i/teamlogos/ncaa/500/{team_id}.png"


def standings_payload(division):
    return get(f"{ESPN_WEB}/v2/sports/football/college-football/standings?group={GROUPS[division]}&season={SEASON}")


def conference_entries(conf):
    """A conference's team entries -- Sun Belt and SWAC are split into
    divisions, so their entries sit one level down."""
    if "standings" in conf:
        return conf["standings"]["entries"]
    return [e for child in conf.get("children", []) for e in conference_entries(child)]


def stat_by_type(entry):
    """Standings entries repeat every stat once per split (overall, home, away,
    vs conf...). The first block is the overall split; named summaries carry the
    W-L records."""
    out = {}
    for s in entry["stats"]:
        t = s.get("type")
        if t and t not in out:
            out[t] = s.get("displayValue", "")
    return out


# --------------------------------------------------------------------- colleges

def build_colleges():
    existing = {c["id"]: c for c in load_json(COLLEGES_PATH, [])}
    colleges = []
    for division in GROUPS:
        payload = standings_payload(division)
        for conf in payload["children"]:
            conf_name = conf.get("shortName") or conf["name"]
            if conf_name.lower().startswith("fbs ind") or conf["name"].lower().endswith("independents"):
                conf_name = "Independent"
            for entry in conference_entries(conf):
                t = entry["team"]
                tid = str(t["id"])
                prev = existing.get(tid, {})
                colleges.append({
                    "id": tid,
                    "name": t.get("location") or t["displayName"],
                    "displayName": t["displayName"],
                    "abbreviation": t.get("abbreviation", ""),
                    "nickname": prev.get("nickname", ""),
                    "city": prev.get("city", ""),
                    "state": prev.get("state", ""),
                    "color": prev.get("color", ""),
                    "conference": conf_name,
                    "conferenceName": conf["name"],
                    "division": division,
                    "logo": logo_url(tid),
                })
    # City, state and mascot only come from each team's own record -- fetched
    # once per team and kept after that.
    missing = [c for c in colleges if not c["city"] or not c["nickname"]]
    print(f"{len(colleges)} teams; fetching details for {len(missing)}")
    for i, c in enumerate(missing, 1):
        try:
            d = get(f"{ESPN_CORE}/seasons/{SEASON}/teams/{c['id']}?lang=en")
        except RuntimeError as err:
            print("  skip", c["name"], err)
            continue
        c["nickname"] = d.get("name", "")
        c["color"] = d.get("color", "")
        addr = (d.get("venue") or {}).get("address") or {}
        c["city"] = addr.get("city", "")
        c["state"] = addr.get("state", "")
        if i % 25 == 0:
            print(f"  {i}/{len(missing)}")
    colleges.sort(key=lambda c: c["name"].lower())
    write_json(COLLEGES_PATH, colleges)
    return colleges


# -------------------------------------------------------------------- standings

def build_standings():
    result = {"season": SEASON, "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "divisions": {}, "polls": {}}
    for division in GROUPS:
        payload = standings_payload(division)
        conferences = []
        for conf in payload["children"]:
            rows = []
            for entry in conference_entries(conf):
                s = stat_by_type(entry)
                rows.append({
                    "id": str(entry["team"]["id"]),
                    "overall": s.get("total", ""),
                    "conf": s.get("vsconf", ""),
                    "pf": s.get("pointsfor", ""),
                    "pa": s.get("pointsagainst", ""),
                    "pd": s.get("pointdifferential", ""),
                    "streak": s.get("streak", ""),
                })
            conferences.append({"name": conf["name"], "shortName": conf.get("shortName") or conf["name"], "teams": rows})
        result["divisions"][division] = conferences

    rankings = get(f"{ESPN_WEB}/site/v2/sports/football/college-football/rankings")
    wanted = {"AP Top 25": "FBS", "FCS Coaches Poll": "FCS"}
    for poll in rankings["rankings"]:
        division = wanted.get(poll["name"])
        if not division:
            continue
        result["polls"][division] = {
            "name": poll["name"],
            "headline": poll.get("headline", ""),
            "ranks": [
                {"rank": r["current"], "id": str(r["team"]["id"]), "record": r.get("recordSummary", ""), "points": r.get("points")}
                for r in poll["ranks"]
            ],
        }
    write_json(STANDINGS_PATH, result)


# ------------------------------------------------------------------ depth charts

OURLADS_INDEX = "https://www.ourlads.com/ncaa-football-depth-charts/"
OURLADS_CHART = "https://www.ourlads.com/ncaa-football-depth-charts/depth-chart/{slug}/{oid}"

# Ourlads spells a few schools differently from ESPN.
NAME_ALIASES = {
    "app state": "appalachian state",
    "miami fl": "miami",
    "miami oh": "miami oh",
    "miami ohio": "miami oh",
    "umass": "massachusetts",
    "uconn": "connecticut",
    "ole miss": "mississippi",
    "san jose state": "san jose state",
    "hawaii": "hawaii",
    "louisiana lafayette": "louisiana",
    "ul lafayette": "louisiana",
    "florida intl": "florida international",
    "fiu": "florida international",
    "nc state": "nc state",
    "pitt": "pittsburgh",
    "usf": "south florida",
    "ucf": "ucf",
    "unlv": "unlv",
    "utep": "utep",
    "utsa": "utsa",
    "smu": "smu",
    "tcu": "tcu",
    "byu": "byu",
    "lsu": "lsu",
    "southern miss": "southern mississippi",
    "louisiana monroe": "ul monroe",
    "uab": "uab",
    "north carolina state": "nc state",
    "central florida": "ucf",
}


def norm_name(name):
    n = unicodedata.normalize("NFKD", html.unescape(name)).encode("ascii", "ignore").decode().lower()
    n = n.replace("&", " and ").replace("'", "").replace(".", " ")
    n = re.sub(r"[^a-z ]", " ", n)
    n = re.sub(r"\s+", " ", n).strip()
    n = re.sub(r"\bst\b", "state", n)
    return NAME_ALIASES.get(n, n)


def parse_player(cell_html):
    m = re.search(r"<a href='[^']*/player/([^/']*)/(\d+)' class='([^']*)'>(.*?)</a>", cell_html)
    if not m or not m.group(4).strip():
        return None
    slug, pid, cls, label = m.groups()
    label = html.unescape(label).strip()
    if "," in label:
        last, rest = label.split(",", 1)
        rest = rest.strip()
        tokens = rest.split(" ")
        # trailing tokens are class markers: RS, FR/SO/JR/SR (+ "/TR" for a transfer)
        first_parts, marks = [], []
        for t in tokens:
            if re.fullmatch(r"(RS|FR|SO|JR|SR|GR|[A-Z]{2}/TR|TR)", t):
                marks.append(t)
            else:
                first_parts.append(t)
        first = " ".join(first_parts)
        name = f"{first} {last.strip()}".strip()
    else:
        name, marks = label, []
    year = next((m_.split("/")[0] for m_ in marks if m_ not in ("RS",)), "")
    return {
        "name": name,
        "year": year,
        "rs": "RS" in marks,
        "tag": "transfer" if "gold" in cls else "freshman" if "purple" in cls else "",
    }


def parse_depth_chart(page):
    sections = []
    parts = re.split(r"<h2 class='[^']*'>", page)[1:]
    for part in parts:
        head = re.match(r"([A-Za-z ]+?)\s*(?:<small><b>(.*?)</b></small>)?</h2>", part, re.S)
        if not head:
            continue
        title, scheme = head.group(1).strip(), (head.group(2) or "").strip()
        positions = []
        for row in re.finditer(r"<tr class='row-dc-(?:wht|grey)'>(.*?)</tr>", part, re.S):
            cells = re.findall(r"<td[^>]*>(.*?)</td>", row.group(1), re.S)
            if len(cells) < 3:
                continue
            label = re.sub(r"<[^>]+>", "", cells[0]).strip()
            players = []
            for i in range(1, len(cells) - 1, 2):
                p = parse_player(cells[i + 1])
                if p:
                    p["no"] = re.sub(r"<[^>]+>", "", cells[i]).strip()
                    players.append(p)
            if label:
                positions.append({"pos": label, "players": players})
        if positions:
            sections.append({"title": title, "scheme": scheme, "positions": positions})
    return sections


def build_depth_charts():
    colleges = load_json(COLLEGES_PATH, [])
    if not colleges:
        colleges = build_colleges()
    by_name = {}
    for c in colleges:
        if c["division"] == "FBS":
            by_name[norm_name(c["name"])] = c
    index_page = get(OURLADS_INDEX, as_json=False)
    # Each team block: logo alt text = school name, followed by its depth-chart link.
    blocks = re.findall(r"alt='([^']+)' class='nfl-dc-mm-logo'.*?depth-chart\.aspx\?s=([a-z0-9\-]+)&id=(\d+)'", index_page, re.S)
    result = {"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "source": "ourlads.com", "teams": {}}
    unmatched = []
    seen = set()
    for name, slug, oid in blocks:
        if oid in seen:
            continue
        seen.add(oid)
        college = by_name.get(norm_name(name))
        if not college:
            unmatched.append(name)
            continue
        try:
            page = get(OURLADS_CHART.format(slug=slug, oid=oid), as_json=False)
        except RuntimeError as err:
            print("  skip", name, err)
            continue
        sections = parse_depth_chart(page)
        if sections:
            result["teams"][college["id"]] = {"name": college["name"], "ourladsUrl": OURLADS_CHART.format(slug=slug, oid=oid), "sections": sections}
        time.sleep(0.4)
    print(f"depth charts: {len(result['teams'])} teams; unmatched Ourlads names: {unmatched}")
    write_json(DEPTH_PATH, result)


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    if which in ("all", "colleges"):
        build_colleges()
    if which in ("all", "standings"):
        build_standings()
    if which in ("all", "depth"):
        build_depth_charts()
