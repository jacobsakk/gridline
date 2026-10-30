"""
The school each current MAC player came from, straight off the schools' own football roster pages
(frontend/src/data/studies/roster-previous.json). ESPN's season log knows four-year transfers but rarely a junior
college, while a school's roster lists every newcomer's "Previous School" -- JUCO included. The Studies page uses
this first for the current season's Previous team column and the Transfers tab.

    python3 studies/roster_previous_schools.py

Output: { "season": 2026, "byPlayer": { "<letters-only name>|<letters-only team>": "Previous School" } }, only for players
with one listed.
"""

import json
import os
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_PATH = os.path.join(REPO_ROOT, "frontend", "src", "data", "studies", "roster-previous.json")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36"

# Each MAC school's football roster page, and the team name the study uses for it.
ROSTERS = {
    "Akron": "https://gozips.com/sports/football/roster",
    "Ball State": "https://ballstatesports.com/sports/football/roster",
    "Bowling Green": "https://bgsufalcons.com/sports/football/roster",
    "Buffalo": "https://ubbulls.com/sports/football/roster",
    "Central Michigan": "https://cmuchippewas.com/sports/football/roster",
    "Eastern Michigan": "https://emueagles.com/sports/football/roster",
    "Kent State": "https://kentstatesports.com/sports/football/roster",
    "Miami (OH)": "https://miamiredhawks.com/sports/football/roster",
    "Ohio": "https://ohiobobcats.com/sports/football/roster",
    "Sacramento State": "https://hornetsports.com/sports/football/roster",
    "Toledo": "https://utrockets.com/sports/football/roster",
    "UMass": "https://umassathletics.com/sports/football/roster",
    "Western Michigan": "https://wmubroncos.com/sports/football/roster",
}


def letters(text):
    return re.sub(r"[^a-z]", "", (text or "").lower())


def fetch(url):
    for _ in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=40) as resp:
                return resp.read().decode("utf-8", "ignore")
        except Exception:
            continue
    return ""


COLLEGEISH = re.compile(r"\b(college|university|cc|community|state|tech|jc|junior|institute|academy of|polytechnic)\b", re.I)
HIGHSCHOOLISH = re.compile(r"\b(high|hs|prep|preparatory|school|academy|christian|catholic)\b", re.I)


def parse(html):
    """[(name, previous school)] for every player card on a SIDEARM roster page."""
    out = {}
    names = list(re.finditer(r"<h3>([^<]{3,60})</h3>", html))
    for i, m in enumerate(names):
        block = html[m.end(): names[i + 1].start() if i + 1 < len(names) else m.end() + 6000]
        block = block[:6000]
        prev = re.search(r"Previous School:\s*([^<]+)", block)
        school = prev.group(1).strip() if prev else ""
        if not school:
            # A page with no separate "previous school" shows one "Last School": a college name means a transfer.
            last = re.search(r"Last School</span>\s*([^<]+)", block)
            text = last.group(1).strip() if last else ""
            if text and COLLEGEISH.search(text) and not HIGHSCHOOLISH.search(text):
                school = text
        # Some schools list a freshman's high school under "previous school"; a freshman with a non-college name there
        # isn't a transfer.
        year = re.search(r"Academic Year</span>\s*([^<]+)", block)
        fresh = bool(year and re.match(r"\s*(R-)?Fr", year.group(1)))
        if school and (HIGHSCHOOLISH.search(school) or (fresh and not COLLEGEISH.search(school) and not re.search(r"\bC\.?C\.?\b", school))):
            school = ""
        name = re.sub(r"\s+", " ", m.group(1)).strip()
        if school and name not in out:
            out[name] = re.sub(r"\s+", " ", school)
    return out


# ---------------------------------------------------------------------------------------------------------------
# Second pass: schools whose roster list doesn't show a previous school (Akron, Buffalo, Kent State, Sacramento State,
# UMass, Western Michigan). For the players the Studies page actually shows, read each one's own bio page: most carry
# a "Previous School" line, and the rest a "Prior to <school>:" paragraph that names the junior college or the
# four-year school he came from.

STUDY_PATH = os.path.join(REPO_ROOT, "frontend", "src", "data", "studies", "mac-best-by-position.json")
REAL_STATS = os.path.join(REPO_ROOT, "frontend", "src", "data", "real-stats.json")
WORDS = {"community", "college", "junior", "cc", "jc", "of", "the", "state", "university", "and", "at", "technical", "tech"}


def team_for(study_team):
    k = letters(study_team)
    if k.startswith("massachusetts"):
        return "UMass"
    for name in ROSTERS:
        n = letters(name)
        if k.startswith(n[:6]) or n.startswith(k[:6]):
            return name
    return ""


def bio_links(html):
    """{name: bio url} from a roster page, whichever of the two SIDEARM layouts it uses."""
    links = {}
    for m in re.finditer(r'href="(/sports/football/roster/[^"]+)"[^>]*aria-label="([^"]+?) jersey number', html):
        links.setdefault(m.group(2).strip(), m.group(1))
    for m in re.finditer(r'"name":"([^"]+)","gender":"M","url":"([^"]+)"', html):
        links.setdefault(m.group(1).strip(), m.group(2))
    return links


def juco_names():
    """The junior colleges in the Pre-Portal data, as (core words, full name)."""
    names = {}
    for r in json.load(open(REAL_STATS)):
        if r.get("division") == "JUCO":
            names[r["team"]] = None
    out = []
    for full in names:
        core = " ".join(w for w in re.sub(r"[^a-z ]", " ", full.lower()).split() if w not in WORDS)
        if len(core) >= 5:
            out.append((core, full))
    return sorted(out, key=lambda x: -len(x[0]))


def _school_like(text):
    """A school's name, not a sentence of bio prose that happens to follow a 'Previous School' label."""
    t = text.strip()
    return 2 <= len(t) <= 45 and not re.search(r"…|\.\.\.|\b(played|who|was|had|made|helped|spent|earned)\b", t, re.I)


def previous_from_bio(text, juco):
    t = re.sub(r"\s+", " ", text)
    m = re.search(r"Previous School:\s*([^|]{2,60}?)(?:\s{2,}| Summary| Media|$)", t)
    if m and _school_like(m.group(1)):
        return m.group(1).strip()
    i = t.find("Prior to")
    prose = t[i : i + 500] if i >= 0 else ""
    if not prose:
        return ""
    low = prose.lower()
    for core, full in juco:
        if core in low:
            return full
    if re.search(r"junior college|juco|njcaa|njca|community college", low):
        m = re.search(r"((?:[A-Z][\w&.'’-]*\s){1,4}(?:Community College|Junior College|College|CC|JC))", prose)
        return m.group(1).strip() if m else "Junior college"
    m = re.search(r"(?:at|from)\s+(?:the\s+)?((?:[A-Z][\w&.'’-]*\s?){1,5}?(?:University|College|State|Tech))\b", prose)
    return m.group(1).strip() if m else ""


def second_pass(result):
    study = json.load(open(STUDY_PATH))["groups"]
    wanted = {}
    for g in study.values():
        for r in g.get("2026", []):
            team = team_for(r["team"])
            if team:
                wanted.setdefault(team, set()).add(r["player"])
    juco = juco_names()
    asked = [t for t in ("Akron", "Buffalo", "Kent State", "Sacramento State", "UMass", "Western Michigan") if t in wanted]

    def one(team):
        base = ROSTERS[team].rsplit("/sports", 1)[0]
        links = bio_links(fetch(ROSTERS[team]))
        found = {}
        for player in sorted(wanted[team]):
            key = f"{letters(player)}|{letters(team)}"
            if key in result:
                continue
            url = links.get(player) or next((u for n, u in links.items() if letters(n) == letters(player)), "")
            if not url:
                continue
            url = url if url.startswith("http") else base + url
            html = fetch(url.replace("http://", "https://"))
            html = re.sub(r"<script.*?</script>|<style.*?</style>|<svg.*?</svg>", "", html, flags=re.S)
            prev = previous_from_bio(re.sub(r"<[^>]+>", " ", html), juco)
            if prev:
                found[key] = prev
        return team, found

    with ThreadPoolExecutor(max_workers=6) as pool:
        for team, found in pool.map(one, asked):
            print(f"  {team}: {len(found)} more from bio pages")
            result.update(found)


def build():
    def one(item):
        team, url = item
        return team, parse(fetch(url))

    result = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        for team, players in pool.map(one, ROSTERS.items()):
            print(f"  {team}: {len(players)} players with a previous school")
            for name, school in players.items():
                result[f"{letters(name)}|{letters(team)}"] = school
    second_pass(result)
    if len(result) < 100:  # a page layout changed or the sites were unreachable: keep what we had
        print("Too few players found; leaving the file as it is.")
        return
    with open(OUT_PATH, "w") as f:
        json.dump({"season": 2026, "byPlayer": result}, f, separators=(",", ":"), sort_keys=True)
    print(f"Wrote {OUT_PATH}: {len(result)} players")


if __name__ == "__main__":
    build()
