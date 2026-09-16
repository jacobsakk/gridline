"""
Fills in X (Twitter) and Film Link for watch list players who don't have
them yet, using Google's Custom Search JSON API -- the same query the
front-end's own "Search" button already builds (see playerSearchUrl() in
Gridline.jsx: "{player} {team} {position} football"), just read
programmatically instead of clicked by a human. Checks the top few
results for an x.com/twitter.com link (-> xLink) and a hudl.com link
(-> filmLink), since in practice one of those is usually near the top
for a real recruit.

Runs against the live Firestore watch list directly over its public REST
API -- no service account needed, since firestore.rules already allows
open read/write on the watchlist collection (the exact same access the
front-end itself uses, just from Python instead of the Firebase JS SDK).
Never overwrites a field someone already filled in by hand; only fills
genuinely empty ones.

Requires two GitHub Actions secrets (see
.github/workflows/watchlist-enrich.yml): GOOGLE_SEARCH_API_KEY and
GOOGLE_SEARCH_CX.

  1. https://console.cloud.google.com/apis/library/customsearch.googleapis.com
     -- enable the "Custom Search API" on a Google Cloud project, then
     create an API key under "Credentials" (that's GOOGLE_SEARCH_API_KEY).
  2. https://programmablesearchengine.google.com/ -- create a new search
     engine, set it to "Search the entire web" (not just specific sites),
     and copy its Search engine ID (that's GOOGLE_SEARCH_CX).
  3. Add both as repo secrets: Settings -> Secrets and variables ->
     Actions -> New repository secret. (Or `gh secret set NAME` from a
     terminal -- either way, keep the key out of the repo and out of
     chat.)

Free tier is 100 queries/day. This caps itself at MAX_PER_RUN and skips
anyone already tried in the last RECHECK_AFTER_DAYS days (whether or not
anything was found), so it won't burn quota re-querying the same player
every day.
"""

import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

PROJECT_ID = "gridline-6afe6"
FIRESTORE_BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents/watchlist"
SEARCH_URL = "https://www.googleapis.com/customsearch/v1"

MAX_PER_RUN = 40  # stays well under the 100/day free Custom Search quota
RECHECK_AFTER_DAYS = 14
RESULTS_TO_SCAN = 5
REQUEST_PAUSE_SECONDS = 0.3


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
    if p.get("xLink") and p.get("filmLink"):
        return False  # already has both -- nothing to fill in
    last = p.get("socialLookupAt")
    if not last:
        return True
    try:
        last_dt = datetime.datetime.fromisoformat(last.replace("Z", "+00:00"))
    except ValueError:
        return True
    return (datetime.datetime.now(datetime.timezone.utc) - last_dt).days >= RECHECK_AFTER_DAYS


def search_top_links(query, api_key, cx):
    """Returns a list of result URLs, or None if the request itself failed
    (e.g. daily quota exhausted) -- distinct from a successful search that
    just found nothing, since only the latter should count as "attempted"."""
    url = f"{SEARCH_URL}?{urllib.parse.urlencode({'key': api_key, 'cx': cx, 'q': query, 'num': RESULTS_TO_SCAN})}"
    try:
        result = _get_json(url)
    except urllib.error.HTTPError as e:
        print(f"    search request failed ({e.code}): {e.reason}")
        return None
    return [item.get("link", "") for item in result.get("items", [])]


def find_links(links):
    x_link, film_link = None, None
    for link in links:
        domain = urllib.parse.urlparse(link).netloc.lower()
        if x_link is None and ("twitter.com" in domain or domain.endswith("x.com")):
            x_link = link
        if film_link is None and "hudl.com" in domain:
            film_link = link
    return x_link, film_link


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
    api_key = os.environ.get("GOOGLE_SEARCH_API_KEY")
    cx = os.environ.get("GOOGLE_SEARCH_CX")
    if not api_key or not cx:
        print("GOOGLE_SEARCH_API_KEY / GOOGLE_SEARCH_CX not set -- skipping this run.")
        return

    players = fetch_watchlist()
    candidates = [p for p in players if needs_lookup(p)][:MAX_PER_RUN]
    print(f"{len(players)} watch list players total, {len(candidates)} up for a lookup this run.")

    found_x = found_film = attempted = 0
    for p in candidates:
        query = " ".join(filter(None, [p.get("player"), p.get("team"), p.get("position"), "football"]))
        links = search_top_links(query, api_key, cx)
        if links is None:
            print("  stopping early -- search API call failed, likely quota exhausted for today.")
            break

        x_link, film_link = find_links(links)
        attempted += 1
        updates = {"socialLookupAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
        if x_link and not p.get("xLink"):
            updates["xLink"] = x_link
            found_x += 1
        if film_link and not p.get("filmLink"):
            updates["filmLink"] = film_link
            found_film += 1

        patch_player(p["id"], updates)
        print(
            f"  {p.get('player')} ({p.get('team')}): "
            f"{'X found' if 'xLink' in updates else 'no X'}, "
            f"{'Hudl found' if 'filmLink' in updates else 'no Hudl'}"
        )
        time.sleep(REQUEST_PAUSE_SECONDS)

    print(f"\nDone: checked {attempted} players, filled in {found_x} X links and {found_film} film links.")


if __name__ == "__main__":
    sys.exit(main())
