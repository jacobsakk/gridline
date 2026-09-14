# Data pipelines

See [../docs/project-brief.md](../docs/project-brief.md) for full background.

## D2 / FCS — NCAA API — **done**

`ncaa_api.py` + `build_data.py` fetch every individual stat leader (passing/rushing/receiving/
defense) for D2 and FCS from [henrygd/ncaa-api](https://github.com/henrygd/ncaa-api), which
re-serves ncaa.com's backend as clean JSON, one division at a time (no headless browser, no
per-conference requests). Run with `python3 build_data.py`.

- Public demo instance in use: `https://ncaa-api.henrygd.me` (rate-limited, 5 req/s/IP). Self-host
  via Docker (`docker run --rm -p 3000:3000 henrygd/ncaa-api`) before relying on this in production.
- Defense merges 5 separate leaderboards (tackles/TFL/passes defended/interceptions/sacks) into
  one row per player, keyed by (player, team) — see `build_defense_rows()`.
- D2 conference tagging is a hand-built mapping (`D2_KNOWN_CONFERENCES`) since the API's own D2
  standings endpoint is broken (confirmed, HTTP 500). FCS conferences come live from the API.
- Positions are normalized to a fixed 9-value set (`POSITION_MAP`) — see module docstring.
- Real single-week numbers require two runs (snapshot + diff) — see `scraper/snapshots/`.

## JUCO — Playwright scraper — not yet built

Five of six target conferences (CCCAA, KJCCC, ICCAC, MACCC, NJCAA Region 5) run on PrestoSports
with a near-identical URL structure — one adapter, parameterized by domain, should cover all
five. Known blockers: bot detection on some pages (need a real headless browser, realistic
pacing, no aggressive concurrency), and player/team names populated by client-side JS or requiring
a second lookup request to resolve abbreviated names to full ones.

Build and fully verify **one** conference end-to-end before generalizing — recommended starting
point is ICCAC or NJCAA Region 5 (both confirmed to return real data during manual
investigation).

Scenic West (SIDEARM Sports, paywalled conference network) is out of scope beyond
best-effort/partial — don't sink time into it before the other five work.

## NAIA — investigated, not yet built (owner wants this added, positioned first)

Confirmed feasible, same class of problem as JUCO:

- Stats live at `naiastats.prestosports.com` — **the same PrestoSports platform as the JUCO
  conferences**, so an adapter built for one should transfer real logic to the other.
- **One national site**, not per-conference (unlike JUCO) — all conferences' stats in one place,
  filterable by conference or "All Conferences" via the site's own dropdown.
- **Blocked by a Cloudflare JS challenge** on a plain HTTP request — confirmed directly (`curl`
  gets a "Just a moment..." challenge page, HTTP 403). A real headless browser (Playwright)
  renders through it fine — confirmed by loading it in our own browser tool and seeing real data.
- Full player names resolve directly on the full players-list page (`/sports/fball/{season}/
  players?sort={statKey}&jsRendering=true`) — no separate name-lookup request needed, simpler
  than some JUCO conferences.
- Their own "Tackles" defense table already comes pre-merged: solo/ast/total/TFL/TFL-yds/sacks/
  sack-yds/QB-hurries all in one row per player — no 5-way merge needed like we had to build for
  D2/FCS.
- No conference column in the player list itself, but querying per-conference (14 total, via the
  site's own conference filter) gets it "for free" — much simpler than the D2 conference-mapping
  problem, no external mapping needed.

**Bottom line:** doable, and arguably an *easier* first Playwright target than JUCO (one site
instead of five, defense already merged) — but it's still the first Playwright-based scraper in
this project (none exist yet), so it's a real chunk of new infrastructure, not a quick addition.
Owner has asked for this to be added and shown first among the division tabs — worth doing before
or alongside the JUCO scraper, since they now share the same underlying approach.
