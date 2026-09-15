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

