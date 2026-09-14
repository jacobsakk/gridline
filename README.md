# Gridline

Weekly individual player stats tracker for JUCO, NCAA Division II, and NCAA FCS football.

See [docs/project-brief.md](docs/project-brief.md) for the full project brief: scope, confirmed
data sources, known technical findings (bot detection, JS-rendered names, etc.), and the
suggested architecture.

## Layout

- `frontend/` — React + Vite front-end (`frontend/src/Gridline.jsx`, ported directly from the
  prototype). Division tabs, weekly leaders strip, stat-category tabs, conference/position
  filters, sortable columns. FCS · Big Sky is real data (pulled from Fox Sports, season totals
  through Sept 12–14, 2026); everything else is still clearly-labeled sample data.
- `scraper/` — data pipelines, not yet built:
  - NCAA API (D2/FCS) — wraps [henrygd/ncaa-api](https://github.com/henrygd/ncaa-api), which
    re-serves ncaa.com's backend as JSON. Covers a whole division per request, no headless
    browser needed. This replaces the Fox Sports/Big Sky approach once wired up.
  - Playwright scraper (JUCO) — five PrestoSports conferences (CCCAA, KJCCC, ICCAC, MACCC,
    NJCAA Region 5) share one URL structure but need bot-evasion and JS rendering; Scenic West
    is a separate, paywalled platform, best-effort only.
- `docs/` — planning docs.

## Status

- [x] Front-end prototype, with real Big Sky (FCS) data via Fox Sports
- [x] D2/FCS data source solved: NCAA API wrapper (`henrygd/ncaa-api`) — no scraping needed
- [ ] Enumerate NCAA API stat category IDs for FCS/D2 football (passing, rushing, receiving,
      tackling, sacks)
- [ ] Pull a full division via the NCAA API and confirm the JSON shape
- [ ] One JUCO conference scraped end-to-end (ICCAC or NJCAA Region 5)
- [ ] Scraper generalized to remaining PrestoSports conferences
- [ ] Database (Supabase) set up
- [ ] Front-end wired to real data (NCAA API + JUCO scraper), replacing Big Sky/Fox Sports and
      remaining sample data
- [ ] Weekly GitHub Actions job

## Running the front-end

```bash
cd frontend
npm install
npm run dev
```

Requires Node.js. If `npm` isn't found, install Node first (e.g. via
[nodejs.org](https://nodejs.org) or Homebrew: `brew install node`).
