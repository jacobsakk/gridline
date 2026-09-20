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

## FBS / FCS — ESPN first, NCAA + conference pages as fallbacks

For **FBS and FCS only**, `espn_stats.py` makes ESPN the primary source and the older pipeline the
fallback (D2/D3/NAIA/JUCO are unchanged and still NCAA-API / Playwright based).

1. **ESPN (primary).** The bulk `byathlete` list gives every FBS/FCS player with a game played
   (~6,400); each one's full season line then comes from the core API
   (`.../seasons/2026/types/2/athletes/{id}/statistics/0`, ~6,000 small requests, 8 in parallel, a few
   minutes). This has no "top ~150 per category" cutoff like the NCAA leaderboards.
2. **NCAA API (fallback).** Each NCAA row is matched to an ESPN row (same college, category and
   player). A match keeps ESPN's numbers and only borrows what ESPN lacks: the exact solo/assist
   **sack split** (ESPN gives total sacks only, so it's estimated until an NCAA row supplies it) and a
   more specific position. No match means the row is added as an extra player.
3. **Conference sites (fallback).** Same treatment for `conference_sites.py`'s rows.
4. **Team spellings.** ESPN rows adopt the NCAA spelling of a school ("Penn St.") when one exists, so
   week-over-week snapshot diffs (keyed by category + player + team) keep matching.
5. Every row carries `source` (`espn` / `ncaa` / `conference`).

If ESPN can't be reached at all, `build_fbs_fcs()` falls back to the old NCAA + conference path and
says so in the log, so the weekly job still produces data.

### Duplicate scrub (every weekly run, all divisions)

`scrub_duplicates()` in `espn_stats.py` runs over the finished dataset before it's written. Two rows
are the same player when they share division, week, category and school (compared by normalized
spelling, `naming.team_key`) **and** the names are the same person (`naming.same_person_name`): equal
after normalizing ("Reginald Vick, Jr." / "Jr.,Reginald Vick"), or the same last name with a
compatible first name (Sam / Samuel) at a compatible position. Different generational numerals
(IV vs V) are never merged, and same-name players on different schools are untouched. The row from
the better source wins (ESPN > NCAA > conference), then more games/production; blanks are filled from
the loser. Duplicate row ids are also repaired. The run prints how many were removed, with examples.
`naming.py` mirrors `teamKey()`/`nameKey()` in `frontend/src/collegeData.js` -- keep the alias lists in
step.

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

## Watch list bio / link lookup — Tavily Search API — **done**

`watchlist_enrich.py` fills in the watch list's Height, Weight, Hometown, X, and Film Link fields
automatically for players who don't have them yet, instead of leaving everything purely manual.
Deliberately does **not** cover Eligibility, even though a bio page often shows a "Class: Senior"
line right next to Height/Weight — the field means years of eligibility *remaining*, which "Class"
doesn't reliably map to (redshirts, JUCO transfers, grad transfers, COVID-year extensions all
break a simple Fr/So/Jr/Sr → 4/3/2/1 guess), and a wrong auto-filled guess there is worse than an
empty box since it's the field most likely to actually inform a recruiting decision — left manual
by the owner's own call. Different shape from every other pipeline here in one other way too: it
doesn't touch `real-stats.json` at all, and it reads/writes the live Firestore watch list directly
over its public REST API (no service account needed — `firestore.rules` already allows open
read/write on the `watchlist` collection, so a plain unauthenticated HTTP request works, same
access the front-end itself has).

- **Why Tavily, not Google**: Google's Custom Search JSON API was the original choice, but turned
  out to be a dead end confirmed directly, not assumed — it's no longer available to *new* Google
  Cloud projects at all (`PERMISSION_DENIED` even with the API enabled, billing active, and a
  valid key; Google's own developer forum confirms this is expected, legacy customers only, full
  shutdown January 2027), and its "Search the entire web" Programmable Search Engine setting is
  likewise locked for any engine created after January 20, 2026. Tavily has no such new-customer
  wall and needs no credit card for its free tier (1,000 searches/month).
- **One search covers all five fields** — the same query the front-end's own "Search" button
  already builds (`{player} {team} {position} football`).
  - **X / Film Link**: checked by domain — the first `x.com`/`twitter.com` result becomes `xLink`,
    the first `hudl.com` result becomes `filmLink`, since in practice a real recruit's X or Hudl
    profile shows up near the top far more often than not. (Explicitly *not* scraping a recruit's
    actual X bio text for this, even though many put a Hudl link there — confirmed directly that
    X only server-renders bio content for a handful of huge/cached accounts; 3 real recruit
    accounts tested all came back as an empty JS shell with zero bio text in a plain HTTP fetch.)
  - **Height / Weight / Hometown**: these tend to sit in the same bio block (e.g. "Height 6-3
    Weight 205 Class Senior Hometown Selby, S.D."), so all three are extracted together in one
    pass. Three tiers, in order, stopping as soon as all three are found: (1) any result shaped
    like the player's *own school athletics bio page* — `.../roster/player-name/12345` or
    `.../bios/player_name_id`, a pattern confirmed directly to hold across multiple real
    schools/divisions regardless of the actual domain — gets its actual page fetched right away,
    since that's the most authoritative, current source available; (2) everyone else's Tavily
    content snippet (already fetched, no extra network call — confirmed directly these often
    already contain the bio line verbatim); (3) everyone else's actual page, fetched as a last
    resort since a snippet can be truncated before reaching the bio line. Tier 1 exists because of
    a real, confirmed bug it fixes: without it, a QB's actual current roster page (6'3"/205) lost
    to a stale 2023 high-school recruiting profile (6'2") simply because the recruiting site's
    Tavily snippet happened to mention the number and got checked in tier 2 before the real bio
    page's page content ever got fetched in tier 3. A roster-list URL (ending exactly at
    `/roster`, no player slug) is deliberately excluded from tier 1 — that's dozens of players on
    one page, and our own first-match regex could otherwise grab a different player's numbers.
    Three real false-positive bugs were caught and fixed by testing against the live watch list
    rather than assumed safe: the tier-ordering bug above, a poor search match that once produced
    a bogus "weight: 700" from an unrelated number on an irrelevant page (fixed with sanity
    bounds: weight 140-400, height 4'0"-7'11"), and a fetched page's own inline `<style>` CSS text
    that once matched as "weight: 100" from a literal `font-weight:100` declaration (fixed by
    stripping `<script>`/`<style>` blocks *with* their content, not just the tags, plus a
    word-boundary guard so "font-weight"/"line-height" can't match at all).
  - **A Hudl profile gets special treatment**, checked ahead of the generic tiers above whenever
    one is known (freshly found this run, or already stored in `filmLink` from a previous one).
    Rather than scanning visible text, this parses the page's own embedded page-state JSON
    directly (`extract_hudl_bio()`) — confirmed directly against two real profiles that Hudl
    embeds a clean `overview` object (height, weight, a self-reported Twitter handle) and a
    `teams` array (each with a location + `startYear`) for the specific profile owner, scoped by
    matching their numeric Hudl user id from the URL (the page also embeds other, unrelated
    athletes' summaries in sidebar widgets, so an unscoped search risks grabbing the wrong
    person's data). The *earliest* team's location stands in for hometown — the same signal a
    human would read off the page's own "Team History" list, oldest entry (this was the owner's
    own idea, from noticing a real player's Hudl page listed his high school's town this way).
    Self-reported by the athlete, so treated as a strong but not infallible source — cross-checked
    directly: one player's Hudl-reported Twitter handle matched what an independent web search had
    separately found, giving real confidence rather than assumed reliability.
  - **A second, Hudl-targeted search fires only when the primary one found no Hudl link at all**
    (and none is already on file). Confirmed directly that Tavily's own index doesn't always agree
    with Google's — one real player's Hudl profile was Google's #1 result for a plain name search,
    but didn't appear in Tavily's top 10 for the same query at all, since Tavily crawls and ranks
    independently rather than proxying Google. Appending "hudl" to the query surfaces a profile
    Tavily otherwise misses, but confirmed directly this isn't safe as a permanent change to the
    main query — for a different player whose profile the primary query already found cleanly,
    adding "hudl" buried it under generic Hudl app-store/marketing pages instead. Safe specifically
    as a fallback rather than a general query change: it only ever replaces "nothing found" with
    something, since the retry's result still has to pass the same strict `hudl.com` domain check.
  - Also requests `include_raw_content` from Tavily (free, no extra credit cost) as a second data
    source for the generic (non-Hudl) tiers above — confirmed directly this matters: several
    school athletics bio pages return HTTP 405 to this script's own direct fetch specifically from
    GitHub Actions' runner IPs (the identical URL fetches fine from a normal residential IP), while
    Tavily's own crawler isn't blocked the same way. Tavily's "cleaned" extraction can itself drop
    a bio widget entirely though (confirmed on one real page — full stat tables came through with
    no Height/Weight/Hometown block), so this script's own fetch stays as a fallback rather than
    being replaced outright.
  - Requires the Hudl match to be an individual player page (`/profile/` or `/video/` in the URL
    path), not just any `hudl.com` domain — confirmed directly a plain domain check let a team's
    full roster listing (`fan.hudl.com/.../roster`, no player-specific path at all) through as a
    "film link" once.
  - **FBS/FCS players get PFF Ultimate, not Hudl, in Film Link** — by the time someone's playing at
    that level, any Hudl profile still findable for them is almost always a stale high-school-era
    one (the same dynamic the `extract_hudl_bio()` docs above describe), so a real, current PFF
    grade page is preferred instead, per the project owner's own call. PFF Ultimate itself
    (`ultimate.pff.com`) is still behind PFF's login wall and isn't indexed by search, so this
    never tries to fetch it — instead it searches for the player's numeric PFF id via whichever
    *other* `pff.com` page search does index (`premium.pff.com/ncaa/players/.../{id}/...` and
    `www.pff.com/ncaa/players/.../{id}` both surfaced it in testing), since PFF reuses that same
    id across every subdomain and URL shape — confirmed directly against two real FBS starters.
    The id is then used to construct `ultimate.pff.com/ncaa/players/{id}/snaps_and_grades`, exactly
    the URL a human would land on themselves, for their own logged-in view to open. Deliberately
    **no fallback to Hudl** for these two divisions if PFF doesn't have the player — an empty Film
    Link beats a misleadingly old high-school one, same reasoning as the "never overwrite" rule
    below. Best-effort like everything else here: confirmed working for two real Power-conference
    starters, but PFF's own coverage thins out fast for backups and smaller FCS programs.
- **Never overwrites a manual entry** — only fills a field that's currently empty. A doc's
  `enrichedAt` timestamp marks it as tried (whether or not anything was found) so the same player
  isn't re-queried every single day, burning quota for no reason; it's eligible again after 14
  days in case new info shows up later.
- **Runs every 15 minutes**, not weekly/daily like the other scrapers, so a newly added player
  gets looked up almost immediately instead of waiting for a scheduled refresh — see
  `.github/workflows/watchlist-enrich.yml`. Free to run this often since the repo is public
  (GitHub Actions minutes are unlimited there) and real Tavily usage is driven by how many players
  actually need a lookup (`needs_lookup()`), not by how often the workflow fires — an idle run
  with nothing new just exits in a couple seconds. Capped at 30 lookups/run regardless, to stay
  comfortably under the free 1,000-searches/month Tavily quota even during a large backlog. A
  `concurrency` guard queues rather than overlaps runs, in case one is ever still going when the
  next 15-minute tick fires.
- **Setup** (one-time, by the project owner — this needs an account, so it can't be automated):
  sign up at [tavily.com](https://tavily.com) (no credit card needed), copy the API key from the
  dashboard (starts with `tvly-`), then add it as a repo secret named `TAVILY_API_KEY` under
  Settings → Secrets and variables → Actions. Until that secret exists, the workflow runs and
  exits immediately without doing anything.

## HS Game Update — MaxPreps + ScoreStream cross-reference

`hs_games.py` fills in the high school results behind the HS Game Update tab. For each school it
pulls the football schedule from **MaxPreps** (structured JSON in the page's `__NEXT_DATA__`) and
**ScoreStream** (rendered by headless Chromium via Playwright, since its game list loads with
JavaScript), matches games by date (±1 day) and opponent name, and records a `conflict` on any game
where the two sources report different scores. MaxPreps is shown when they disagree; ScoreStream
fills in games MaxPreps has no score for.

- **Privacy:** the schools to check are read from the app's `hsPlayers` collection and results are
  written to `hsTeams/{school}` in Firestore — never committed. Runs in
  `.github/workflows/hs-games-refresh.yml` using a `FIREBASE_SERVICE_ACCOUNT` secret.
- `python3 hs_games.py --urls urls.json --dump out.json --no-write` runs it locally against a list
  of `{"maxpreps": ..., "scorestream": ...}` pairs without touching the database.
- `team_doc_id()` here and `teamDocId()` in `frontend/src/hsData.js` must produce the same id.
- ScoreStream dates come as `Aug 29 '26` or relative (`Last Friday at 7:00 PM`); the browser runs in
  Pacific time so late West Coast games never slip to the next day.
