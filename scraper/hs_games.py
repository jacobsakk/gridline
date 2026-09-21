"""High school game results for the HS Game Update tab.

For every school the staff is tracking, pulls the football schedule/results
from two independent sources -- MaxPreps (structured JSON embedded in the
page) and ScoreStream (rendered by a headless browser) -- lines the games up
by date and opponent, and flags any game where the two disagree on the score.

Privacy: which recruits are being tracked never touches this repository. The
list of team pages is read from the app's own database (hsPlayers) using a
service account held in a GitHub secret, and the results are written back to
the database (hsTeams), keyed by school -- no player names, no contact info.

    python3 hs_games.py                       # Firestore in, Firestore out
    python3 hs_games.py --urls urls.json      # local file of {maxpreps, scorestream} pairs
    python3 hs_games.py --dump out.json       # also/instead write the results to a file
"""

import argparse
import asyncio
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
SEASON_YEAR = 2026
SEASON_START = dt.date(SEASON_YEAR, 6, 1)  # ignore last season's games still listed on a team page
DELAY_SECONDS = 1.5  # between requests to the same site


# ---------------------------------------------------------------- identity

def team_doc_id(sources):
    """Stable id for a school. Must match teamDocId() in frontend/src/hsData.js."""
    mp = (sources or {}).get("maxpreps") or ""
    m = re.search(r"maxpreps\.com/([a-z]{2})/([^/]+)/([^/]+)/", mp)
    if m:
        return f"mp_{m.group(1)}_{m.group(2)}_{m.group(3)}"
    ss = (sources or {}).get("scorestream") or ""
    m = re.search(r"scorestream\.com/team/([^/?#]+)", ss)
    if m:
        return f"ss_{m.group(1)}"
    return ""


_NOISE = {"high", "school", "hs", "the", "of", "academy", "prep", "preparatory"}
_ALIASES = {"st": "saint", "mt": "mount", "ft": "fort"}


def name_tokens(name):
    text = re.sub(r"[^a-z0-9 ]+", " ", (name or "").lower().replace("&", " and "))
    tokens = {_ALIASES.get(t, t) for t in text.split()}
    trimmed = tokens - _NOISE
    return trimmed or tokens


def name_similarity(a, b):
    """0..1; 1.0 only for the same set of words. Subsets ("Lapeer" / "Lapeer East") score lower."""
    ta, tb = name_tokens(a), name_tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / max(len(ta), len(tb))


def same_school(a, b):
    ta, tb = name_tokens(a), name_tokens(b)
    if not ta or not tb:
        return False
    return len(ta & tb) / min(len(ta), len(tb)) >= 0.6


# ---------------------------------------------------- finding a school's pages

STATE_CODES = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
    "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS", "kentucky": "KY",
    "louisiana": "LA", "maine": "ME", "maryland": "MD", "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS", "missouri": "MO",
    "montana": "MT", "nebraska": "NE", "nevada": "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC",
    "north dakota": "ND", "ohio": "OH", "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT", "virginia": "VA", "washington": "WA", "west virginia": "WV",
    "wisconsin": "WI", "wyoming": "WY", "district of columbia": "DC",
}


def state_code(text):
    t = (text or "").strip()
    if len(t) == 2 and t.isalpha():
        return t.upper()
    return STATE_CODES.get(t.lower(), "")


def clean_school_name(name):
    """'Grosse Pointe South HS (MI)' -> 'Grosse Pointe South'."""
    t = re.sub(r"\([^)]*\)", " ", name or "")
    t = re.sub(r"\b(HS|H\.S\.|High School|High)\b", " ", t, flags=re.I)
    t = re.sub(r"\bAcad\b\.?", "Academy", t, flags=re.I)
    return re.sub(r"\s+", " ", t).strip(" -,")


def maxpreps_search(query):
    import urllib.parse

    html = fetch_html("https://www.maxpreps.com/search/?q=" + urllib.parse.quote_plus(query.lower()))
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    if not m:
        return []
    return json.loads(m.group(1))["props"]["pageProps"].get("initialSchoolResults") or []


def _mp_schedule_url(result):
    return result["canonicalUrl"].rstrip("/") + f"/football/{str(SEASON_YEAR)[2:]}-{str(SEASON_YEAR + 1)[2:]}/schedule/"


def find_maxpreps(school, state):
    """The football schedule page for a school, or "" if there isn't one clear match.
    A candidate only counts if its football page really loads with games on it (search also
    returns other sports and look-alike names)."""
    name = clean_school_name(school)
    st = state_code(state)
    if not name:
        return ""
    queries = [name]
    words = name.split()
    if len(words) > 2:
        queries.append(" ".join(words[:-1]))  # drop a trailing word (a mascot, "Central")
    pool = {}
    for q in queries:
        try:
            for r in maxpreps_search(q):
                pool.setdefault(r["canonicalUrl"], r)
        except Exception:
            pass
        time.sleep(0.6)
    scored = [(name_similarity(name, r.get("name")), r) for r in pool.values()]
    want = name_tokens(name)
    in_state = [x for x in scored if st and x[1].get("state") == st]
    same_state = sorted([x for x in in_state if x[0] >= 0.6], key=lambda x: -x[0])
    if not same_state:
        # "Saint Joseph" is "South Bend St. Joseph" on MaxPreps: every word present, a few extra ones.
        same_state = sorted(
            [(1.0 - 0.05 * len(name_tokens(x[1].get("name")) - want), x[1]) for x in in_state if want and want <= name_tokens(x[1].get("name"))],
            key=lambda x: -x[0],
        )
    # A wrong state in the sheet is common: fall back to a single, exact-name school anywhere.
    exact_anywhere = [x for x in scored if x[0] >= 0.99]
    candidates = same_state or (exact_anywhere if len(exact_anywhere) == 1 else [])
    for _, r in candidates[:3]:
        url = _mp_schedule_url(r)
        try:
            if fetch_maxpreps(url):
                return url
        except Exception:
            pass
        time.sleep(0.6)
    return ""


async def find_scorestream_many(schools):
    """{(name, state): team games url or ""} using ScoreStream's own search page."""
    from playwright.async_api import async_playwright

    out = {}
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context(user_agent=UA, locale="en-US")
        for name, state in schools:
            out[(name, state)] = ""
            page = await context.new_page()
            try:
                await page.goto("https://scorestream.com/search?q=" + urllib.parse.quote_plus(name.lower()), wait_until="domcontentloaded", timeout=60000)
                await page.wait_for_selector('a[href^="/team/"]', timeout=20000)
                cards = await page.evaluate(
                    """() => [...document.querySelectorAll('a[href^="/team/"]')].map(a => ({href: a.getAttribute('href'), text: a.innerText.split('\\n').map(t => t.trim()).filter(Boolean)}))"""
                )
                want = name_tokens(name)
                best, best_key = "", (0.0, 0)
                for c in cards:
                    place = next((t for t in reversed(c["text"]) if re.search(r",\s*[A-Z]{2}$", t)), "")
                    if state and not place.endswith(f", {state}"):
                        continue
                    slug = re.sub(r"-\d+$", "", c["href"].rsplit("/", 1)[-1]).replace("-", " ")
                    have = name_tokens(slug)
                    contained = len(want & have) / len(want) if want else 0.0
                    key = (contained, -len(have - want))  # fully contained, fewest extra words
                    if contained >= 0.8 and key > best_key:
                        best, best_key = c["href"], key
                if best:
                    out[(name, state)] = "https://scorestream.com" + best.split("?")[0] + "/games"
            except Exception:
                pass
            finally:
                await page.close()
            await asyncio.sleep(DELAY_SECONDS)
        await browser.close()
    return out


# ---------------------------------------------------------------- MaxPreps

def fetch_html(url):
    for _ in range(4):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
        try:
            with urllib.request.urlopen(req, timeout=40) as resp:
                return resp.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as err:
            if err.code == 308 and err.headers.get("Location"):  # older Pythons don't follow 308 themselves
                url = urllib.parse.urljoin(url, err.headers["Location"])
                continue
            raise
    raise RuntimeError("too many redirects")


def fetch_maxpreps(url):
    """-> list of {date, opponent, homeAway, result, ours, theirs}."""
    html = fetch_html(url)
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    if not m:
        raise RuntimeError("MaxPreps page had no data block")
    contests = json.loads(m.group(1))["props"]["pageProps"].get("contests") or []
    us = re.search(r"maxpreps\.com/[a-z]{2}/[^/]+/([^/]+)/", url).group(1)

    games = []
    for c in contests:
        teams = c[0]
        # Each team is a positional list: [1]=school id, [4]=order (1 = home),
        # [5]=W/L/T, [6]=points, [13]=school url, [14]=school name.
        mine = next((t for t in teams if t[13] and f"/{us}/" in t[13]), None)
        if mine is None:
            continue
        theirs = next((t for t in teams if t is not mine), None)
        date = str(c[11] or "")[:10]
        if not date or date < SEASON_START.isoformat():
            continue
        # Placeholder rows ("game has multi teams or invalid dual teams") have no opponent.
        opponent = (theirs[14] if theirs else None) or ""
        if not opponent:
            continue
        result, ours, opp_pts = mine[5], mine[6], theirs[6]
        game = {"date": date, "opponent": opponent, "homeAway": "H" if mine[4] == 1 else "A"}
        link = c[18] if len(c) > 18 and isinstance(c[18], str) and c[18].startswith("http") else ""
        if link:
            game["links"] = {"maxpreps": link}
        if result in ("W", "L", "T") and ours is not None and opp_pts is not None:
            game.update(result=result, ours=int(ours), theirs=int(opp_pts))
        games.append(game)
    return games


# -------------------------------------------------------------- ScoreStream

_WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def parse_scorestream_date(text, today):
    """'Aug 29 '25', 'Last Friday at 10:00 PM', 'Friday at 7:00 PM', 'Yesterday...' -> date."""
    t = (text or "").strip().lstrip("-").strip()
    m = re.match(r"([A-Za-z]{3})[a-z]* (\d{1,2}) '(\d{2})", t)
    if m:
        try:
            return dt.datetime.strptime(f"{m.group(1)} {m.group(2)} 20{m.group(3)}", "%b %d %Y").date()
        except ValueError:
            return None
    m = re.match(r"([A-Za-z]{3})[a-z]* (\d{1,2})\b", t)  # this year, no year shown
    if m:
        try:
            return dt.datetime.strptime(f"{m.group(1)} {m.group(2)} {today.year}", "%b %d %Y").date()
        except ValueError:
            return None
    low = t.lower()
    if low.startswith("today"):
        return today
    if low.startswith("yesterday"):
        return today - dt.timedelta(days=1)
    if low.startswith("tomorrow"):
        return today + dt.timedelta(days=1)
    m = re.match(r"(last )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)", low)
    if m:
        target = _WEEKDAYS.index(m.group(2))
        back = (today.weekday() - target) % 7
        if m.group(1):
            back = back or 7
            return today - dt.timedelta(days=back)
        return today + dt.timedelta(days=(target - today.weekday()) % 7)
    return None


def parse_scorestream_card(card, today):
    """One rendered game card -> game dict, or None if it isn't a finished varsity football game.
    card = {"teams": [first, second], "lines": the card's text lines}; lines run
    "Team+Mascot", "City, ST", "Team+Mascot", "City, ST", score, score, status, sport, "- date"."""
    teams, lines = card.get("teams") or [], [l.strip() for l in card.get("lines") or [] if l.strip()]
    if len(teams) != 2 or len(lines) < 9 or not (lines[4].isdigit() and lines[5].isdigit()):
        return None
    sport = lines[7]
    if not re.search(r"football", sport, re.I) or re.search(r"junior varsity|freshman|sophomore|\bJV\b|flag", sport, re.I):
        return None
    if not re.match(r"(final|forfeit)", lines[6], re.I):
        return None
    date = parse_scorestream_date(lines[8], today)
    if not date or date < SEASON_START:
        return None
    return {
        "first": teams[0], "second": teams[1], "firstPts": int(lines[4]), "secondPts": int(lines[5]),
        "date": date.isoformat(), "status": lines[6], "href": card.get("href") or "",
    }


async def fetch_scorestream_many(urls):
    """{url: [games]} for every ScoreStream team page, one shared browser."""
    from playwright.async_api import async_playwright

    out = {}
    today = dt.datetime.now(dt.timezone(dt.timedelta(hours=-8))).date()  # Pacific, matches the browser below
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        # Pacific time so a late West Coast kickoff never shows up as the next day.
        context = await browser.new_context(user_agent=UA, timezone_id="America/Los_Angeles", locale="en-US")
        for url in urls:
            page = await context.new_page()
            try:
                for attempt in (1, 2):  # the page occasionally renders empty on the first load
                    await page.goto(url, wait_until="domcontentloaded", timeout=60000)
                    try:
                        await page.wait_for_selector('a[href^="/game/"]', timeout=40000)
                        break
                    except Exception:
                        if attempt == 2:
                            raise
                # The summary boxes at the top render first; wait for the full game list under them.
                await page.wait_for_selector('a[href^="/game/"] span[style*="letter-spacing: -1px"]', timeout=30000)
                await page.wait_for_timeout(1500)
                # The list is virtualised (scrolling swaps cards out), so collect after every step.
                collected = {}
                for step in range(14):
                    batch = await page.evaluate(
                        """() => [...document.querySelectorAll('a[href^="/game/"]')].map(a => ({
                            href: a.getAttribute('href'),
                            teams: [...a.querySelectorAll('span[style*="letter-spacing: -1px"]')].map(s => s.textContent),
                            lines: a.innerText.split('\\n'),
                        }))"""
                    )
                    # The small "recent games" boxes at the top reuse the same links; only the full cards carry team spans.
                    collected.update({c["href"]: c for c in batch if c["teams"]})
                    await page.mouse.wheel(0, 500)
                    await page.wait_for_timeout(450)
                title = await page.title()
                cards = list(collected.values())
                us = re.sub(r" - ScoreStream$", "", title).replace("The ", "", 1)
                games, seen = [], set()
                for raw in cards:
                    card = parse_scorestream_card(raw, today)
                    if not card:
                        continue
                    # Which side is ours: the team page's name (e.g. "Rancho Cucamonga Cougars").
                    first_is_us = same_school(card["first"], us) and not same_school(card["second"], us)
                    second_is_us = same_school(card["second"], us) and not same_school(card["first"], us)
                    if not (first_is_us or second_is_us):
                        continue
                    ours, theirs = (card["firstPts"], card["secondPts"]) if first_is_us else (card["secondPts"], card["firstPts"])
                    opp = card["second"] if first_is_us else card["first"]
                    key = (card["date"], opp)
                    if key in seen:
                        continue
                    seen.add(key)
                    game = {
                        "date": card["date"], "opponent": opp, "ours": ours, "theirs": theirs,
                        "result": "W" if ours > theirs else "L" if ours < theirs else "T",
                    }
                    if card["href"]:
                        game["links"] = {"scorestream": "https://scorestream.com" + card["href"].split("?")[0]}
                    games.append(game)
                out[url] = games
            except Exception as err:  # one bad page must not sink the run
                print(f"  ScoreStream failed for {url}: {err}", file=sys.stderr)
                out[url] = None
            finally:
                await page.close()
            await asyncio.sleep(DELAY_SECONDS)
        await browser.close()
    return out


# ---------------------------------------------------------- cross-reference

def _days_apart(a, b):
    return abs((dt.date.fromisoformat(a) - dt.date.fromisoformat(b)).days)


def cross_reference(mp_games, ss_games):
    """Line the two sources up. Every game comes back once, with:
       source   -- which sources reported a finished score
       conflict -- both reported one and they disagree
    MaxPreps is the primary; ScoreStream fills in games MaxPreps has no score for."""
    mp_games, ss_games = mp_games or [], ss_games or []
    # Best-scoring pairs claim each other first, so "Lapeer" and "Lapeer East" on the same
    # night can't both grab one ScoreStream result.
    pairs = sorted(
        (
            (name_similarity(g["opponent"], s["opponent"]), -_days_apart(g["date"], s["date"]), gi, si)
            for gi, g in enumerate(mp_games)
            for si, s in enumerate(ss_games)
            if _days_apart(g["date"], s["date"]) <= 1 and same_school(g["opponent"], s["opponent"])
        ),
        reverse=True,
    )
    match_of, used = {}, set()
    for _, _, gi, si in pairs:
        if gi not in match_of and si not in used:
            match_of[gi] = si
            used.add(si)

    merged = []
    for gi, g in enumerate(mp_games):
        entry = dict(g)
        entry["source"] = ["maxpreps"] if "result" in g else []
        if gi in match_of:
            s = ss_games[match_of[gi]]
            entry["source"].append("scorestream")
            entry["links"] = {**g.get("links", {}), **s.get("links", {})}
            if "result" not in g:
                entry.update(result=s["result"], ours=s["ours"], theirs=s["theirs"])
            elif (g["ours"], g["theirs"]) != (s["ours"], s["theirs"]):
                entry["conflict"] = {"scorestream": {"ours": s["ours"], "theirs": s["theirs"], "result": s["result"]}}
        merged.append(entry)
    # Games only ScoreStream knows about (not on the MaxPreps schedule).
    for i, s in enumerate(ss_games):
        if i not in used:
            merged.append({**s, "source": ["scorestream"], "homeAway": ""})
    merged.sort(key=lambda g: g["date"])
    return merged


def collapse_games(games, today):
    """Tidy a schedule. MaxPreps keeps stale entries: the same opponent listed twice (or a day
    apart), and old placeholders for a game that was rescheduled or replaced. So:
      - the same opponent within a day is one game (the copy with a score wins);
      - a past game with no score, next to a game that has one, is dropped as a leftover."""
    merged = []
    for g in games:
        for i, o in enumerate(merged):
            if same_school(o["opponent"], g["opponent"]) and _days_apart(o["date"], g["date"]) <= 1:
                keep, other = (g, o) if "result" in g and "result" not in o else (o, g)
                merged[i] = {
                    **other, **keep,
                    "source": sorted(set(o.get("source", [])) | set(g.get("source", []))),
                    "links": {**o.get("links", {}), **g.get("links", {})},
                }
                break
        else:
            merged.append(dict(g))
    return [
        g for g in merged
        if "result" in g or g["date"] >= today
        or not any("result" in o and o is not g and _days_apart(o["date"], g["date"]) <= 1 for o in merged)
    ]


# --------------------------------------------------------------------- run

def scrape(pairs):
    """pairs: {team_doc_id: {"maxpreps": url, "scorestream": url}} -> {team_doc_id: doc}."""
    ss_urls = sorted({p["scorestream"] for p in pairs.values() if p.get("scorestream")})
    ss_results = asyncio.run(fetch_scorestream_many(ss_urls)) if ss_urls else {}

    docs = {}
    for i, (doc_id, src) in enumerate(pairs.items(), 1):
        mp_games = None
        if src.get("maxpreps"):
            try:
                mp_games = fetch_maxpreps(src["maxpreps"])
            except Exception as err:
                print(f"  MaxPreps failed for {src['maxpreps']}: {err}", file=sys.stderr)
            time.sleep(DELAY_SECONDS)
        ss_games = ss_results.get(src.get("scorestream"))
        if mp_games is None and ss_games is None:
            continue  # both failed: keep whatever is already stored
        games = collapse_games(cross_reference(mp_games, ss_games), dt.datetime.now(dt.timezone(dt.timedelta(hours=-8))).date().isoformat())
        docs[doc_id] = {
            "sources": {k: v for k, v in src.items() if v},
            "games": games,
            "fetched": {"maxpreps": mp_games is not None, "scorestream": ss_games is not None},
            "conflicts": sum(1 for g in games if g.get("conflict")),
            "updatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        }
        print(f"[{i}/{len(pairs)}] {doc_id}: {len(games)} games, {docs[doc_id]['conflicts']} conflicts")
    return docs


def firestore_client():
    from google.cloud import firestore
    from google.oauth2 import service_account

    info = json.loads(os.environ["FIREBASE_SERVICE_ACCOUNT"])
    creds = service_account.Credentials.from_service_account_info(info)
    return firestore.Client(project=info["project_id"], credentials=creds)


RETRY_LOOKUP_DAYS = 3  # after a failed search, wait this long before searching for that school again


def load_players(client):
    """[(doc ref, data)] for every player still on the tracker."""
    out = []
    for snap in client.collection("hsPlayers").stream():
        data = snap.to_dict() or {}
        if not data.get("removed"):
            out.append((snap.reference, data))
    return out


def school_key(data):
    return (clean_school_name(data.get("highSchool")).lower(), state_code(data.get("state")))


def _recently_tried(data):
    tried = data.get("sourcesTriedAt")
    if not tried:
        return False
    try:
        when = dt.datetime.fromisoformat(str(tried).replace("Z", "+00:00"))
    except ValueError:
        return False
    return dt.datetime.now(dt.timezone.utc) - when < dt.timedelta(days=RETRY_LOOKUP_DAYS)


def players_needing_links(players):
    return [
        (ref, d) for ref, d in players
        if school_key(d)[0] and not all((d.get("sources") or {}).get(k) for k in ("maxpreps", "scorestream")) and not _recently_tried(d)
    ]


def resolve_sources(client, players, write=True):
    """Give every player a MaxPreps and a ScoreStream link without anyone pasting them in:
    borrow them from another player at the same school, else search both sites. Returns the
    players with their sources filled in (and saves that to the database)."""
    known = {}  # school -> links already on some player
    for _, d in players:
        for kind in ("maxpreps", "scorestream"):
            url = (d.get("sources") or {}).get(kind)
            if url:
                known.setdefault(school_key(d), {}).setdefault(kind, url)

    todo = players_needing_links(players)
    schools = {}
    for _, d in todo:
        schools.setdefault(school_key(d), d)
    if not todo:
        return players

    print(f"looking up links for {len(schools)} schools ({len(todo)} players)")
    found = {}
    need_ss = []
    for key, d in schools.items():
        have = known.get(key, {})
        links = dict(have)
        if not links.get("maxpreps"):
            url = find_maxpreps(d.get("highSchool"), d.get("state"))
            if url:
                links["maxpreps"] = url
        if not links.get("scorestream"):
            need_ss.append((key[0], key[1]))
        found[key] = links
        print(f"  {d.get('highSchool')} ({key[1]}): MaxPreps {'found' if links.get('maxpreps') else 'no'}")
    if need_ss:
        ss = asyncio.run(find_scorestream_many(need_ss))
        for key in found:
            url = ss.get(key)
            if url:
                found[key]["scorestream"] = url

    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    updated = []
    todo_ids = {ref.id for ref, _ in todo}
    batch, n = client.batch(), 0
    for ref, d in players:
        key = school_key(d)
        if ref.id in todo_ids:
            links = found.get(key, {})
            sources = dict(d.get("sources") or {})
            for kind in ("maxpreps", "scorestream"):
                if links.get(kind) and not sources.get(kind):
                    sources[kind] = links[kind]
            d = {**d, "sources": sources, "sourcesTriedAt": now}
            if write:
                batch.update(ref, {"sources": sources, "sourcesTriedAt": now})
                n += 1
                if n % 400 == 0:
                    batch.commit()
                    batch = client.batch()
        updated.append((ref, d))
    if write and n:
        batch.commit()
        print(f"saved links for {n} players")
    return updated


def pairs_from_players(players):
    pairs = {}
    for _, data in players:
        src = data.get("sources") or {}
        doc_id = team_doc_id(src)
        if doc_id:
            merged = pairs.setdefault(doc_id, {})
            for k in ("maxpreps", "scorestream"):
                if src.get(k) and not merged.get(k):
                    merged[k] = src[k]
    return pairs


def existing_team_ids(client):
    return {snap.id for snap in client.collection("hsTeams").select([]).stream()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--urls", help="JSON file: list of {maxpreps, scorestream} objects (skips Firestore input)")
    ap.add_argument("--dump", help="write results to this JSON file")
    ap.add_argument("--limit", type=int, help="only the first N schools (testing)")
    ap.add_argument("--no-write", action="store_true", help="don't write to Firestore")
    ap.add_argument("--new-only", action="store_true", help="only schools that have no results stored yet (quick catch-up for newly added players)")
    ap.add_argument("--plan", action="store_true", help="just report whether --new-only has anything to do (sets the GitHub output 'work')")
    args = ap.parse_args()

    client = None
    if args.urls:
        pairs = {}
        for src in json.load(open(args.urls)):
            if team_doc_id(src):
                pairs.setdefault(team_doc_id(src), {}).update({k: v for k, v in src.items() if v})
    else:
        client = firestore_client()
        players = load_players(client)
        if args.plan:
            new_players = players_needing_links(players)
            have = existing_team_ids(client)
            new_schools = [d for d in pairs_from_players(players) if d not in have]
            work = bool(new_players or new_schools)
            print(f"{len(new_players)} players need links, {len(new_schools)} schools have no results yet -> {'work to do' if work else 'nothing to do'}")
            out = os.environ.get("GITHUB_OUTPUT")
            if out:
                with open(out, "a") as f:
                    f.write(f"work={'true' if work else 'false'}\n")
            return
        players = resolve_sources(client, players, write=not args.no_write)
        pairs = pairs_from_players(players)
        if args.new_only:
            have = existing_team_ids(client)
            pairs = {k: v for k, v in pairs.items() if k not in have}
    if args.limit:
        pairs = dict(list(pairs.items())[: args.limit])
    print(f"{len(pairs)} schools to check")
    if not pairs:
        return

    docs = scrape(pairs)

    if args.dump:
        with open(args.dump, "w") as f:
            json.dump(docs, f, indent=1)
    if not args.no_write and (client or os.environ.get("FIREBASE_SERVICE_ACCOUNT")):
        client = client or firestore_client()
        batch, n = client.batch(), 0
        for doc_id, doc in docs.items():
            batch.set(client.collection("hsTeams").document(doc_id), doc)
            n += 1
            if n % 400 == 0:
                batch.commit()
                batch = client.batch()
        batch.commit()
        print(f"wrote {n} team documents")
    total_conflicts = sum(d["conflicts"] for d in docs.values())
    print(f"done: {len(docs)} schools, {total_conflicts} score disagreements between sources")


if __name__ == "__main__":
    main()
