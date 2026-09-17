"""
Fills in Height, Weight, Hometown, X (Twitter), and Film Link for watch
list players who don't have them yet, using the Tavily Search API on the
same query the front-end's own "Search" button already builds (see
playerSearchUrl() in Gridline.jsx: "{player} {team} {position} football"),
just read programmatically instead of clicked by a human.

Deliberately NOT covering Eligibility here, even though a bio page often
shows a "Class: Senior" line right next to Height/Weight -- the watch
list's Eligibility field means years of eligibility REMAINING, which
"Class" doesn't reliably map to (redshirts, JUCO transfers, grad
transfers, and COVID-year extensions all break a simple Fr/So/Jr/Sr ->
4/3/2/1 guess), and a wrong auto-filled guess there is worse than an
empty box since it's the field most likely to actually inform a
recruiting decision. Left purely manual by the owner's own call.

One search per player covers all five fields, so this doesn't burn any
extra quota per field:
  - X / Film Link: checked by domain -- an x.com/twitter.com link becomes
    xLink, a hudl.com link becomes filmLink, since in practice one of
    those is usually near the top of the results for a real recruit.
  - Height / Weight / Hometown: these tend to sit in the same bio block
    (e.g. "Height 6-3 Weight 205 Class Senior Hometown Selby, S.D."), and
    Tavily's response already includes a short content snippet per
    result which very often already contains that whole line -- confirmed
    directly against real players' real bio pages (Sidearm, PrestoSports,
    MaxPreps, 247Sports, etc.), no extra fetch needed. Checks those
    snippets first, in ranked order, and only falls back to fetching a
    result's actual page if a snippet didn't have it (snippets can be
    truncated).

Why Tavily and not Google: Google's Custom Search JSON API is no longer
available to new Google Cloud projects at all (confirmed directly --
PERMISSION_DENIED on a freshly created project, and Google's own
developer forum confirms this is expected: the API is being phased out,
legacy customers only, full shutdown January 2027) and its companion
"Search the entire web" Programmable Search Engine setting is likewise
locked for engines created after January 20, 2026. Tavily has no such
new-customer restriction and needs no credit card for its free tier.

Runs against the live Firestore watch list directly over its public REST
API -- no service account needed, since firestore.rules already allows
open read/write on the watchlist collection (the exact same access the
front-end itself uses, just from Python instead of the Firebase JS SDK).
Never overwrites a field someone already filled in by hand; only fills
genuinely empty ones.

Requires one GitHub Actions secret (see
.github/workflows/watchlist-enrich.yml): TAVILY_API_KEY.

  1. https://tavily.com -- sign up (no credit card needed).
  2. Copy the API key from your dashboard (starts with "tvly-").
  3. Add it as a repo secret: Settings -> Secrets and variables ->
     Actions -> New repository secret, named TAVILY_API_KEY. (Or
     `gh secret set TAVILY_API_KEY` from a terminal -- either way, keep
     the key out of the repo and out of chat.)

Free tier is 1,000 searches/month, no card required. This caps itself at
MAX_PER_RUN and skips anyone already tried in the last RECHECK_AFTER_DAYS
days (whether or not anything was found), so it won't burn quota
re-querying the same player every day.
"""

import datetime
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

PROJECT_ID = "gridline-6afe6"
FIRESTORE_BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents/watchlist"
SEARCH_URL = "https://api.tavily.com/search"

MAX_PER_RUN = 30  # keeps a daily job comfortably under the 1,000/month free Tavily quota
RECHECK_AFTER_DAYS = 14
RESULTS_TO_SCAN = 5
REQUEST_PAUSE_SECONDS = 0.3
PAGE_FETCH_TIMEOUT = 15
MAX_PAGE_BYTES = 300_000  # bio info is always near the top -- no need to read a whole page

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

# Covers "HT/WT: 6-2 / 210" (common Sidearm combined format) as well as
# separate "Height: 6'2\"" / "Weight: 210 lbs" lines (PrestoSports,
# MaxPreps, 247Sports, and most school CMS bio pages).
COMBINED_HW_RE = re.compile(r'H(?:ei)?T\s*/\s*W(?:ei)?T\s*:?\s*(\d[\'\-]\d{1,2}"?)\s*/\s*(\d{2,3})', re.I)
# (?<!-) guards against a compound CSS/JS word like "font-weight" or
# "line-height" matching -- confirmed directly as a real false-positive
# source, not just theoretical (see _page_text's <style>-stripping note).
HEIGHT_RE = re.compile(r'(?<!-)\bHeight\s*:?\s*(\d[\'\-]\d{1,2}"?)', re.I)
WEIGHT_RE = re.compile(r'(?<!-)\bWeight\s*:?\s*(\d{2,3})\s*(?:lbs?|pounds)?', re.I)
HOMETOWN_RE = re.compile(r'Hometown\s*:?\s*([A-Za-z .\'-]+,\s*[A-Za-z.]{2,20})', re.I)


def _get_json(url):
    with urllib.request.urlopen(url, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _firestore_scalar(value):
    """Firestore REST documents wrap every value in a {type: value} envelope
    (e.g. {"stringValue": "..."} or {"booleanValue": true}) -- unwrap it."""
    return next(iter(value.values())) if value else None


def fetch_watchlist():
    data = _get_json(f"{FIRESTORE_BASE}?pageSize=300")
    players = []
    for doc in data.get("documents", []):
        doc_id = doc["name"].rsplit("/", 1)[-1]
        fields = {k: _firestore_scalar(v) for k, v in doc.get("fields", {}).items()}
        fields["id"] = doc_id
        players.append(fields)
    return players


def needs_lookup(p):
    if p.get("removed"):
        return False
    if p.get("xLink") and p.get("filmLink") and p.get("height") and p.get("weight") and p.get("hometown"):
        return False  # already has everything -- nothing left to fill in
    last = p.get("enrichedAt")
    if not last:
        return True
    try:
        last_dt = datetime.datetime.fromisoformat(last.replace("Z", "+00:00"))
    except ValueError:
        return True
    return (datetime.datetime.now(datetime.timezone.utc) - last_dt).days >= RECHECK_AFTER_DAYS


def search_results(query, api_key):
    """Returns Tavily's list of result dicts ({url, content, ...}), or None
    if the request itself failed (e.g. monthly credits exhausted) --
    distinct from a successful search that just found nothing, since only
    the latter should count as "attempted"."""
    # include_raw_content asks Tavily to fetch each page's full text itself
    # (free -- doesn't change credit cost) rather than just a short
    # snippet. Confirmed directly this matters: several school athletics
    # bio pages return HTTP 405 to our own direct fetch from GitHub
    # Actions' runner IPs specifically (still fetch fine from a normal
    # residential IP), while Tavily's own crawler isn't blocked the same
    # way.
    body = json.dumps({"query": query, "max_results": RESULTS_TO_SCAN, "include_raw_content": "text"}).encode("utf-8")
    req = urllib.request.Request(
        SEARCH_URL,
        data=body,
        method="POST",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"    search request failed ({e.code}): {e.reason}")
        return None
    return result.get("results", [])


def find_social_links(results):
    x_link, film_link = None, None
    for r in results:
        url = r.get("url", "")
        domain = urllib.parse.urlparse(url).netloc.lower()
        if x_link is None and ("twitter.com" in domain or domain.endswith("x.com")):
            x_link = url
        if film_link is None and "hudl.com" in domain:
            film_link = url
    return x_link, film_link


def _normalize_height(raw):
    match = re.match(r"(\d)[\'\-](\d{1,2})", raw)
    if not match:
        return None
    feet, inches = int(match.group(1)), int(match.group(2))
    # Sanity bounds -- rejects a coincidental regex hit on an unrelated page
    # (confirmed directly: a poor-match search result for an obscure player
    # once produced a bogus "weight: 700" from an unrelated number on an
    # irrelevant page, so every parsed value is bounds-checked before use).
    if not (4 <= feet <= 7 and 0 <= inches <= 11):
        return None
    return f"{feet}'{inches}\""


def _valid_weight(raw):
    try:
        # 140 lbs is already a light punter/kicker -- nobody on a football
        # roster is realistically below that, so this is a tighter bound
        # than "any 3-digit number" to catch the class of bug where a
        # regex match slips through from unrelated page content.
        return 140 <= int(raw) <= 400
    except (TypeError, ValueError):
        return False


def _extract_hw(text):
    if not text:
        return None, None
    combined = COMBINED_HW_RE.search(text)
    if combined:
        height = _normalize_height(combined.group(1))
        weight = combined.group(2) if _valid_weight(combined.group(2)) else None
        return height, weight
    h = HEIGHT_RE.search(text)
    w = WEIGHT_RE.search(text)
    height = _normalize_height(h.group(1)) if h else None
    weight = w.group(1) if w and _valid_weight(w.group(1)) else None
    return height, weight


def _valid_hometown(raw):
    if not raw:
        return False
    raw = raw.strip()
    # Reject obvious junk rather than trust an odd-shaped match -- a real
    # "City, ST" is short and always has the comma the regex already
    # requires, so this just guards against a stray trailing sentence.
    return 3 <= len(raw) <= 40 and "," in raw


def _extract_hometown(text):
    if not text:
        return None
    m = HOMETOWN_RE.search(text)
    if not m:
        return None
    value = m.group(1).strip().rstrip(",")
    return value if _valid_hometown(value) else None


def _extract_bio(text):
    """One text blob (a search snippet or a fetched page) -> whatever of
    height/weight/hometown it contains, so the same page is only scanned
    once instead of once per field."""
    height, weight = _extract_hw(text)
    hometown = _extract_hometown(text)
    return height, weight, hometown


def _page_text(url):
    """Best-effort plain-text fetch -- returns None on any failure (dead
    link, timeout, non-HTML content, site blocking the request) rather
    than raising, since this is a best-effort scan of pages we don't
    control."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=PAGE_FETCH_TIMEOUT) as resp:
            html = resp.read(MAX_PAGE_BYTES).decode("utf-8", errors="replace")
    except Exception as e:
        # Logged rather than silently swallowed -- local testing kept
        # succeeding on pages that failed from the actual GitHub Actions
        # runner, and there was no way to tell why without this.
        print(f"    page fetch failed for {url}: {type(e).__name__}: {e}")
        return None
    # Strip <script>/<style> blocks *with* their text content first -- a
    # generic tag-strip alone leaves inline CSS/JS text behind (confirmed
    # directly: "font-weight:100" in a <style> block once matched our own
    # weight regex and produced a bogus 100 lb reading for a real player).
    html = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
    return re.sub(r"<[^>]+>", " ", html)


def _looks_like_player_bio_page(url):
    """True for a URL shaped like a school athletics site's own
    player-specific roster/bio subpage -- confirmed directly across
    multiple real schools/divisions this shape holds regardless of the
    actual domain: ".../roster/player-name/12345" or
    ".../bios/player_name_id". Explicitly excludes a URL that IS a full
    team roster listing (path ending exactly at "/roster") rather than
    one player's own page -- that's a page listing dozens of players, and
    scanning it with our own first-match regex risks grabbing a
    completely different player's height/weight off the same page."""
    path = urllib.parse.urlparse(url).path.lower().rstrip("/")
    if path.endswith("/roster"):
        return False
    return "/roster/" in path or "/bios/" in path or "/bio/" in path


def _extract_from_result(r):
    """Best-effort bio extraction for one result: try Tavily's own
    already-fetched raw_content first (free, and confirmed not blocked by
    sites that reject our own direct fetch -- several school athletics
    bio pages return HTTP 405 to a fetch from GitHub Actions' runner IPs
    specifically), then fall back to fetching the page ourselves for
    whatever's still missing, since a site's own "cleaned" content
    extraction can drop a bio widget entirely (confirmed directly on one
    real page, which Tavily returned with full stat tables but without
    its Height/Weight/Hometown block) that our simpler tag-stripped fetch
    still picks up when it isn't blocked."""
    height, weight, hometown = _extract_bio(r.get("raw_content"))
    if height and weight and hometown:
        return height, weight, hometown
    h, w, ht = _extract_bio(_page_text(r.get("url", "")))
    return height or h, weight or w, hometown or ht


def find_bio_fields(results):
    """Height, Weight, and Hometown all tend to sit in the same bio block
    (e.g. "Height 6-3 Weight 205 Class Senior Hometown Selby, S.D.").
    Three tiers, in order, stopping as soon as all three fields are found:

      1. Any result that looks like the player's own school athletics
         bio page -- fetch its actual page right away (not just its
         snippet, which can be an uninformative boilerplate summary)
         since this is the most authoritative, current source available.
         Confirmed directly this matters: a QB's real current roster page
         listed 6'3"/205, but without this tier a stale 2023 high-school
         recruiting profile's snippet (6'2") got checked first purely
         because it happened to have richer boilerplate text, and won.
      2. Everyone else's snippets (already fetched, no extra network
         calls).
      3. Everyone else's actual pages, as a last resort, since a snippet
         can be truncated before reaching the bio line.
    """
    height = weight = hometown = None
    bio_pages = [r for r in results if _looks_like_player_bio_page(r.get("url", ""))]
    other_results = [r for r in results if not _looks_like_player_bio_page(r.get("url", ""))]

    for r in bio_pages:
        if height and weight and hometown:
            return height, weight, hometown
        h, w, ht = _extract_from_result(r)
        height, weight, hometown = height or h, weight or w, hometown or ht

    for r in other_results:
        if height and weight and hometown:
            return height, weight, hometown
        h, w, ht = _extract_bio(r.get("content", ""))
        height, weight, hometown = height or h, weight or w, hometown or ht

    for r in other_results:
        if height and weight and hometown:
            break
        h, w, ht = _extract_from_result(r)
        height, weight, hometown = height or h, weight or w, hometown or ht

    return height, weight, hometown


def patch_player(doc_id, updates):
    mask = "&".join(f"updateMask.fieldPaths={field}" for field in updates)
    url = f"{FIRESTORE_BASE}/{doc_id}?{mask}"
    body = {"fields": {k: {"stringValue": v} for k, v in updates.items()}}
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        method="PATCH",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        resp.read()


def main():
    api_key = os.environ.get("TAVILY_API_KEY")
    if not api_key:
        print("TAVILY_API_KEY not set -- skipping this run.")
        return

    players = fetch_watchlist()
    candidates = [p for p in players if needs_lookup(p)][:MAX_PER_RUN]
    print(f"{len(players)} watch list players total, {len(candidates)} up for a lookup this run.")

    found = {"height": 0, "weight": 0, "hometown": 0, "xLink": 0, "filmLink": 0}
    attempted = 0
    for p in candidates:
        query = " ".join(filter(None, [p.get("player"), p.get("team"), p.get("position"), "football"]))
        results = search_results(query, api_key)
        if results is None:
            print("  stopping early -- search API call failed, likely credits exhausted for the month.")
            break

        attempted += 1
        updates = {"enrichedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}

        x_link, film_link = find_social_links(results)
        if x_link and not p.get("xLink"):
            updates["xLink"] = x_link
            found["xLink"] += 1
        if film_link and not p.get("filmLink"):
            updates["filmLink"] = film_link
            found["filmLink"] += 1

        if not p.get("height") or not p.get("weight") or not p.get("hometown"):
            height, weight, hometown = find_bio_fields(results)
            if height and not p.get("height"):
                updates["height"] = height
                found["height"] += 1
            if weight and not p.get("weight"):
                updates["weight"] = weight
                found["weight"] += 1
            if hometown and not p.get("hometown"):
                updates["hometown"] = hometown
                found["hometown"] += 1

        patch_player(p["id"], updates)
        filled = [k for k in ("height", "weight", "hometown", "xLink", "filmLink") if k in updates]
        print(f"  {p.get('player')} ({p.get('team')}): filled {', '.join(filled) if filled else 'nothing'}")
        time.sleep(REQUEST_PAUSE_SECONDS)

    print(
        f"\nDone: checked {attempted} players -- "
        f"filled in {found['height']} heights, {found['weight']} weights, {found['hometown']} hometowns, "
        f"{found['xLink']} X links, {found['filmLink']} film links."
    )


if __name__ == "__main__":
    sys.exit(main())
