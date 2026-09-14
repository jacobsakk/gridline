# Data pipelines (not yet built)

Two separate pipelines, per the project brief — see
[../docs/project-brief.md](../docs/project-brief.md) for full details.

## D2 / FCS — NCAA API (build this first)

Do **not** scrape ncaa.com or stats.ncaa.org directly — both are JS-rendered and confirmed
unusable via plain HTTP. Instead, use the free wrapper
[henrygd/ncaa-api](https://github.com/henrygd/ncaa-api), which re-serves ncaa.com's backend as
clean JSON, one division at a time (no per-conference requests needed).

- Public demo instance for development: `https://ncaa-api.henrygd.me` (rate-limited, 5 req/s/IP).
  Self-host via Docker (`docker run --rm -p 3000:3000 henrygd/ncaa-api`) before relying on this
  in production.
- URL pattern mirrors ncaa.com's own paths, e.g.
  `GET /stats/football/d2/current/individual/{statId}`.
- **Not yet done: enumerate the numeric stat category IDs** for FCS and D2 football (passing,
  rushing, receiving, tackling, sacks) by cross-referencing ncaa.com's stat pages.
- Once wired up, this replaces the Fox Sports/Big Sky data currently hardcoded in the prototype.

## JUCO — Playwright scraper (build this second)

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
