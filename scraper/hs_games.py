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


# ---------------------------------------------------------------- MaxPreps

def fetch_html(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
    with urllib.request.urlopen(req, timeout=40) as resp:
        return resp.read().decode("utf-8", "replace")


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
        "date": date.isoformat(), "status": lines[6],
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
                    games.append({
                        "date": card["date"], "opponent": opp, "ours": ours, "theirs": theirs,
                        "result": "W" if ours > theirs else "L" if ours < theirs else "T",
                    })
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
        games = cross_reference(mp_games, ss_games)
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


def pairs_from_firestore(client):
    pairs = {}
    for snap in client.collection("hsPlayers").stream():
        data = snap.to_dict() or {}
        if data.get("removed"):
            continue
        src = data.get("sources") or {}
        doc_id = team_doc_id(src)
        if doc_id:
            merged = pairs.setdefault(doc_id, {})
            for k in ("maxpreps", "scorestream"):
                if src.get(k) and not merged.get(k):
                    merged[k] = src[k]
    return pairs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--urls", help="JSON file: list of {maxpreps, scorestream} objects (skips Firestore input)")
    ap.add_argument("--dump", help="write results to this JSON file")
    ap.add_argument("--limit", type=int, help="only the first N schools (testing)")
    ap.add_argument("--no-write", action="store_true", help="don't write to Firestore")
    args = ap.parse_args()

    client = None
    if args.urls:
        pairs = {}
        for src in json.load(open(args.urls)):
            if team_doc_id(src):
                pairs.setdefault(team_doc_id(src), {}).update({k: v for k, v in src.items() if v})
    else:
        client = firestore_client()
        pairs = pairs_from_firestore(client)
    if args.limit:
        pairs = dict(list(pairs.items())[: args.limit])
    print(f"{len(pairs)} schools to check")

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
