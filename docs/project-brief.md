# Gridline — Weekly Football Stats Tracker (JUCO / D2 / FCS)

## What this is

A website that tracks weekly individual player stats across three levels of college football — Junior College (JUCO), NCAA Division II, and NCAA FCS — filterable by division, conference, position, and week, updating automatically after each week's games.

A working front-end prototype already exists (`gridline-prototype.jsx`, attached) with mock data. It demonstrates the target UX: division tabs, a "weekly leaders" strip, stat-category tabs (Passing/Rushing/Receiving/Tackling/Sacks & TFL), conference and position filters, and sortable columns. **The remaining work is entirely on the data side**: building scrapers, a database, and a weekly automation job, then wiring the real front-end to that data instead of mock data.

The person commissioning this has little coding experience, so please default to explaining tradeoffs plainly and choosing the simpler option when reasonable.

## Scope

**JUCO — confirmed, prioritized conferences** (owner explicitly wants these; other JUCO conferences are out of scope for now):

| Conference | Region | Site | Platform |
|---|---|---|---|
| CCCAA / 3C2A | California | 3c2asports.org | PrestoSports |
| KJCCC | Kansas | kjccc.org | PrestoSports |
| ICCAC | Iowa | iccac.org | PrestoSports |
| MACCC | Mississippi | macccathletics.com | PrestoSports |
| NJCAA Region 5 (SWJCFC) | Texas (Trinity Valley, Tyler, Navarro, Kilgore, Cisco, Blinn, NE Oklahoma A&M, NMMI) | njcaaregion5.com | PrestoSports |
| Scenic West Athletic Conference | Utah/Idaho/Nevada/Colorado (incl. Snow College) | scenicwestnetwork.com + individual SIDEARM Sports team sites | SIDEARM Sports; conference-wide network appears to require paid access | **Partial/best-effort only** — owner has explicitly accepted incomplete coverage here.

**D2 and FCS — solved, see "The NCAA API" section below.** stats.ncaa.org and ncaa.com are both JS-rendered and unusable via plain HTTP (confirmed), but a free community API wraps ncaa.com's backend into clean JSON and covers every division nationally, not conference-by-conference. This replaces the earlier plan of scraping Fox Sports conference-by-conference for FCS.

A partial prototype already exists using real FCS data: `gridline-prototype.jsx` currently has real, verified Big Sky Conference (FCS) stats pulled from Fox Sports (five categories: passing, rushing, receiving, tackling, sacks), current through games played Sept 12–14, 2026. Every other conference/division in that file is clearly-labeled sample data. **Once the NCAA API is wired up, it should replace the Fox Sports/Big Sky data too** — the NCAA API covers all of FCS and D2 nationally in one source, so there's no need to keep the conference-by-conference Fox Sports approach around.

## Data model (from the prototype)

Each stat row needs: `division` (JUCO/D2/FCS), `conference`, `week`, `category` (passing/rushing/receiving/tackling/sacksTfl), `position`, `player` name, `team`, and the category-specific numeric columns (see `CATEGORIES` object in the prototype file for exact columns per category). Preserve this shape, or migrate the front-end if the real data model needs to differ.

## Key technical findings from manual investigation

These are real, verified findings from fetching the actual sites — not assumptions:

1. **Five of six target JUCO conferences run on the same platform (PrestoSports)**, with near-identical URL structure across all of them:
   - `/sports/fball/{season}/leaders`
   - `/sports/fball/{season}/teams/{team-slug}`
   - `/sports/fball/{season}/players?teamId={id}&view=ext`

   This means **one scraper adapter, parameterized by domain, should cover CCCAA, KJCCC, ICCAC, MACCC, and NJCAA Region 5** — write and test it against one conference first, then generalize.

2. **Bot detection blocks naive HTTP requests on some PrestoSports pages.** A plain fetch to `kjccc.prestosports.com/.../leaders` and to `3c2asports.org/.../leaders?jsRendering=true` both returned bot-detection errors. **A real headless browser (Playwright recommended) is required**, not a simple HTTP client — and it should look like a real browser session (proper headers, realistic pacing between requests, no aggressive concurrency).

3. **Player and team names are often populated by client-side JavaScript, not present in the initial HTML.** Confirmed directly: fetching ICCAC's leaders page without JS execution returned real numeric stats (yards, TDs, tackles) but blank name/team columns. Some pages also use **abbreviated names in the visible table** (e.g. "A. Washington") that resolve to full names only via a separate lookup (seen via a `view=ext` query parameter returning `A. Washington=Andrew Washington` style mappings). The scraper needs to either render full JS execution and wait for the data to populate, or make a second request to resolve full names — confirm which per conference.

4. **NJCAA's own national stats aggregator is currently disabled**: `njcaastats.prestosports.com/sports/fball/2025-26/div1/leaders` and the div1 schedule page both return "Site has been disabled per owner request." Individual team pages under that same domain still appear to resolve, so it may be partially usable, but don't rely on the national leaderboard existing.

5. **NJCAA Region 5 (njcaaregion5.com) has working individual player pages with real, resolved names** (e.g. `/sports/fball/2024-25/players/javionmckayrc83`), which is a better sign than ICCAC's leaders page — worth checking if this conference's data is easier to extract than the others.

6. **Scenic West is a different platform (SIDEARM Sports)** with its own conference-wide stats network that appears to sit behind a "Purchase Access" paywall. Treat this conference as best-effort/manual/partial per the owner's direction — don't sink significant time into it before the other five are working.

7. **Individual school sites sometimes publish supplementary stats only as PDFs** (game notes), not structured HTML tables — expect to need a PDF-parsing fallback for some data, though this hasn't blocked any of the five priority conferences so far.

## The NCAA API (use this for D2 and FCS — do not scrape ncaa.com directly)

`ncaa.com` and `stats.ncaa.org` both confirmed JS-rendered — a plain fetch returns an empty page (no readable text), same failure mode as the worst JUCO sites.

**However**, a free, open-source, actively maintained wrapper solves this cleanly: **[henrygd/ncaa-api](https://github.com/henrygd/ncaa-api)** (MIT licensed). It scrapes ncaa.com's actual backend and re-serves it as clean JSON, with the same URL path as the corresponding ncaa.com page. Verified working directly — fetched `https://ncaa-api.henrygd.me/rankings/football/fbs/associated-press` and got back real, current JSON (AP Top 25 "Through Games Sep. 12, 2026").

Key facts:
- **Public demo instance**: `https://ncaa-api.henrygd.me` — rate-limited to 5 requests/second/IP. Fine for initial development; **self-host via the included Docker image for reliable production use** (`docker run --rm -p 3000:3000 henrygd/ncaa-api`, or the provided `docker-compose.yml`).
- **Usage pattern**: take any ncaa.com URL and request the same path from the API host. Example: website `https://www.ncaa.com/stats/football/fbs/current/individual/750` → API `GET /stats/football/fbs/current/individual/750`.
- **Division-wide, not conference-by-conference**: the path structure uses division slugs (`fbs`, `fcs`, `d2`, `d3`), so one request covers an entire division's stat category nationally — e.g. `/stats/football/d2/current/individual/{statId}` returns all of D2, not one conference at a time. This is a significant improvement over the Fox Sports conference-by-conference approach used for the Big Sky prototype data.
- **Stat category IDs are numeric** (e.g. `750` = FBS rushing TDs in the README's own example) and differ per division/sport — **you'll need to enumerate the actual IDs for FCS and D2 football** by cross-referencing against the real ncaa.com pages (view-source or browser devtools showing the URL when clicking between stat categories on e.g. `https://www.ncaa.com/stats/football/fcs`) — this wasn't fully mapped out yet.
- Also covers scores, rankings, standings, schedules, and game box scores/play-by-play — useful beyond just stat leaderboards if the project ever wants team records, schedules, etc.
- MIT license, 260+ GitHub stars, actively maintained (recent commits), so reasonably trustworthy to depend on — but it's an unofficial community project scraping ncaa.com's backend, so it could break if ncaa.com changes its internal structure. Worth wrapping calls to it in solid error handling and having a fallback plan.

**Recommended approach**: self-host this API (or use the public demo during development), enumerate the stat category IDs needed for FCS and D2 football (individual + team, all the categories the prototype's `CATEGORIES` object needs — passing, rushing, receiving, tackling, sacks), and build the D2/FCS data pipeline around it instead of scraping Fox Sports or ncaa.com directly. This should be noticeably simpler and more reliable than the PrestoSports/Playwright approach needed for JUCO, since it's a real API returning structured JSON rather than a page that needs a headless browser.

## Suggested architecture

1. **Scraper**: Python + Playwright. Build one PrestoSports adapter first (recommend starting with ICCAC or NJCAA Region 5, since both have been directly verified to return data), get it fully working end-to-end for one conference, then generalize to a config-driven adapter (domain + season + conference name as parameters) for the other four PrestoSports conferences. Handle Scenic West separately and expect partial data.
2. **Database**: Supabase (Postgres + auto-generated API, free tier) is a reasonable choice for someone without backend experience — avoids standing up and managing a separate API server by hand.
3. **Scheduler**: A GitHub Actions workflow on a weekly cron schedule (during football season, roughly September–December) triggers the scraper and writes to the database.
4. **Frontend**: Adapt `gridline-prototype.jsx` to read from the Supabase API instead of the mock `DATA` array. Keep the same filter/sort UX; the data-fetching layer is the only major change needed.

## Immediate next steps for Claude Code

1. **Start with D2/FCS via the NCAA API** — it's the more reliable, less time-consuming path, and there's already a working reference point (the AP poll fetch above) to build from.
   - Self-host `henrygd/ncaa-api` (or start against the public demo instance to move fast, then self-host before relying on it long-term).
   - Enumerate the numeric stat category IDs needed for FCS and D2 football (individual leaders: passing, rushing, receiving, tackling, sacks — matching the `CATEGORIES` in the prototype) by cross-referencing ncaa.com's own stat pages.
   - Pull a full division's worth of data in one request per category and confirm the JSON shape (player names, team, stat values) is clean and complete — it should be, based on the README's example response, but verify against real football data specifically.
2. **Then tackle JUCO**, which is the harder, more manual problem:
   - Stand up a minimal Playwright scraper against **one** JUCO conference (suggest ICCAC or NJCAA Region 5, both directly verified to return data) end-to-end: fetch → parse → confirm real player names and stats extracted correctly.
   - Once one conference works cleanly, generalize into a config-driven adapter and repeat for the remaining three PrestoSports conferences.
3. Set up Supabase and define the schema matching the data model above.
4. Wire both pipelines (NCAA API for D2/FCS, Playwright scraper for JUCO) to write into Supabase, then connect the front-end to real data — replacing both the Big Sky/Fox Sports data and all remaining sample data in the current prototype.
5. Set up the GitHub Actions weekly schedule last, once the manual pipeline is proven to work.

## What NOT to do

- Don't scrape ncaa.com or stats.ncaa.org directly — it's JS-rendered and confirmed unusable via plain HTTP. Use the NCAA API wrapper instead.
- Don't keep building out the Fox Sports conference-by-conference approach for FCS once the NCAA API is working — it covers all of FCS (and D2) nationally in one source, making the conference-by-conference approach obsolete.
- Don't try to build a universal scraper that handles all divisions and all platforms in one pass — build and verify one path end-to-end first (NCAA API for D2/FCS, Playwright for JUCO).
- Don't spend significant time on Scenic West's paywalled JUCO network before the other five JUCO conferences work — it was explicitly deprioritized.
