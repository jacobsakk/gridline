# Data pipelines

See [../docs/project-brief.md](../docs/project-brief.md) for full background.

## FBS / D2 / FCS — NCAA API — **done**

`ncaa_api.py` + `build_data.py` fetch every individual stat leader (passing/rushing/receiving/
defense) for FBS, D2, and FCS from [henrygd/ncaa-api](https://github.com/henrygd/ncaa-api), which
re-serves ncaa.com's backend as clean JSON, one division at a time (no headless browser, no
per-conference requests). Run with `python3 build_data.py`.

- Public demo instance in use: `https://ncaa-api.henrygd.me` (rate-limited, 5 req/s/IP). Self-host
  via Docker (`docker run --rm -p 3000:3000 henrygd/ncaa-api`) before relying on this in production.
- Defense merges 5 separate leaderboards (tackles/TFL/passes defended/interceptions/sacks) into
  one row per player, keyed by (player, team) — see `build_defense_rows()`.
- D2 conference tagging is a hand-built mapping (`D2_KNOWN_CONFERENCES`) since the API's own D2
  standings endpoint is broken (confirmed, HTTP 500). FBS and FCS conferences both come live from
  the API's standings endpoint via the shared `fetch_conference_map()` — FBS was added later but
  needed zero new scraping technique, just the same call with a different division slug.
- The standings feed labels true independents "FBS Independent"/"FCS Independent"
  (`fetch_conference_map()` collapses both to plain "Independent", matching D2's own fallback
  value) and can lag real-world realignment — `CONFERENCE_CORRECTIONS` overrides known-stale
  entries (currently just Chicago St., who the feed still lists as independent after joining the
  NEC).
- Positions are normalized to a fixed 9-value set (`POSITION_MAP`) — see module docstring.
- Real single-week numbers require two runs (snapshot + diff) — see `scraper/snapshots/`.

## NAIA — Playwright scraper — **done**

`naia.py` + `build_data.py` (`build_naia_division()`) fetch every individual stat leader
(passing/rushing/receiving/defense) from `naiastats.prestosports.com` — the same PrestoSports
platform as the JUCO conferences, but one national site with a conference filter built in.

- Blocked by a Cloudflare JS challenge on a plain HTTP request (confirmed) — Playwright's
  headless Chromium renders through it fine, no stealth plugins needed.
- Once past Cloudflare, every player's full stat line (offense AND defense, every category) is
  already sitting in the page's DataTables client-side data store as one rich object —
  `window.jQuery('#stats-table-...').DataTable().data().toArray()` — no per-category requests
  needed. Field abbreviations (`pa`/`pc`/`pyd` for passing, `dtu`/`dta`/`dtt`/`tfl`/`dso` for
  defense, etc.) were verified against real rendered numbers, not guessed — see the module
  docstring for the exact cross-check.
- Conference tagging: NAIA's site doesn't reliably fill in `conference` on the "All Conferences"
  view, so each of the 13 conferences is fetched separately via its own URL
  (`CONFERENCE_PATHS`) — authoritative, no external mapping needed (simpler than the D2 problem).
- Reuses `ncaa_api.py`'s snapshot/diff machinery unchanged for real week-by-week data, since NAIA
  rows are transformed into the exact same shape.
- Setup: `pip install -r requirements.txt && playwright install chromium` (one-time, downloads a
  browser binary — only needs to happen once per machine).

## JUCO — Playwright scraper — **done for 4 of 6 target conferences**

`juco.py` + `build_data.py` (`build_juco_division()`) cover ICCAC, KJCCC, MACCC, and SWJCFC
(NJCAA Region 5's actual football conference name; njcaaregion5.com is the domain) — all run on
PrestoSports, each its own domain.

- These pages are plain server-rendered HTML (no client-side DataTables store like NAIA), but
  still needs a real browser: a plain HTTP request that worked fine minutes into testing started
  getting an **AWS WAF JS challenge** (HTTP 202, empty body) once enough rapid requests had been
  made — confirmed directly, not assumed. A real browser clears it the same way Playwright clears
  Cloudflare's for NAIA; matches the original brief's own finding that these sites need realistic
  pacing and a real headless browser.
- Full names resolve directly server-side (no separate name-lookup step) — better than the
  original brief found on some of these pages, though abbreviated names ("M. Smith") do still
  show up on some listing views; the per-team `view=lineup` endpoint used here gives full names.
- Defense comes pre-merged per player (tackles/TFL/sacks/PBU/INT all in one table), same as NAIA.
  JUCO only reports one combined sack total (no solo/assisted split) — stored in `soloSacks` with
  `astSacks` pinned to 0 so the shared weekly-delta math still comes out exactly right.
- Conference tagging is trivial here — unlike NAIA/D2, each JUCO conference is its own domain, so
  there's no team → conference mapping problem at all.
- **SWJCFC's own site currently only has 2 of its ~8 member teams set up** (Cisco College, New
  Mexico Military Institute) — confirmed by checking its teams page directly, not a scraping bug.

**Not yet built:**
- **Scenic West** (SIDEARM Sports, paywalled conference network) — deprioritized per the project
  brief; best-effort/partial only, don't sink time into it before other things.

## CCCAA — Playwright scraper — **done**

`cccaa.py` covers California's JUCO conference (3c2asports.org / cccaa.prestosports.com is the
canonical domain). Same PrestoSports platform and data model as NAIA (confirmed identical `stats`
field abbreviations for almost everything), but simpler:

- Its team-stats page isn't server-rendered like the other 4 JUCO conferences (0 server-rendered
  team links, vs. real data on ICCAC/KJCCC/MACCC/SWJCFC's identical page shape) — needed the
  NAIA-style DataTables approach instead of `juco.py`'s HTML parsing.
- `conference` is reliably populated per player on the "all players" view (0 nulls across a
  181-player sample) — unlike NAIA, so no per-conference URL looping needed, just one page load
  covering every category's table at once.
- CCCAA's own site groups players into 11 internal sub-conferences (e.g. "American - Golden
  Coast") — tagged `"CCCAA"` uniformly instead, keeping the Conference filter consistent with the
  other JUCO conferences (each one filter value, not fragmented into sub-groups).
- **One field name genuinely differs from NAIA's convention, caught after the owner noticed
  CCCAA showed zero sacks for everyone**: the total-sacks key is `dst` here, not `dso` like NAIA
  (`dsu`/`dsa`/`dsyd` for solo/assisted/yards match NAIA's naming exactly — confirmed against
  CCCAA's own real sacks leader, David Tauscher, 4.5 sacks). Every other field (passing/rushing/
  receiving/tackles/TFL/INT/PBU) was checked against real player data across every division after
  finding this and came back clean — this was an isolated, single-field bug.

