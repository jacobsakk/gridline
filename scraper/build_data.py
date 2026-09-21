"""
Fetches real FBS + FCS + D2 individual stat leaders (plus NAIA/JUCO/CCCAA,
below) and writes them to frontend/src/data/real-stats.json for the
front-end to read directly.

Run manually for now:

    python3 scraper/build_data.py            # everything
    python3 scraper/build_data.py --fbs-fcs  # just FBS + FCS (ESPN first), a few minutes

Also saves a dated snapshot of each division's season-to-date totals
under scraper/snapshots/. From the *second* time this runs onward, it
diffs the new snapshot against the most recent previous one to produce
real single-week rows (the NCAA's API only ever reports season-to-date
totals, so a real "just this week" number only exists once we have two
checkpoints to subtract). The very first run for a division has nothing
to diff against yet, so it only produces season-total rows.

Later this becomes the payload of the weekly GitHub Actions job.
"""

import datetime
import json
import os
import sys

from ncaa_api import (
    build_division_rows,
    build_weekly_delta_rows,
    d2_conference_for,
    d3_conference_for,
    fetch_conference_map,
    load_previous_snapshot,
    save_snapshot,
)
from conference_sites import fetch_supplemental_rows
from espn_stats import build_espn_rows, fetch_athlete_lines, fetch_espn_athletes, fetch_roster_athletes, load_colleges, merge_division, scrub_duplicates

OUTPUT_PATH = os.path.join(
    os.path.dirname(__file__), "..", "frontend", "src", "data", "real-stats.json"
)


def build_division(division_slug, division_label, run_date, fetch_total_rows):
    """fetch_total_rows() -> list of season-total rows for this division.
    Handles the snapshot-save + diff-against-previous-snapshot dance that's
    the same regardless of where the rows came from (NCAA API or NAIA's
    Playwright scrape), since both produce rows in the same shape."""
    total_rows = fetch_total_rows()
    print(f"  {len(total_rows)} {division_label} rows (season totals)")

    previous_date, previous_rows = load_previous_snapshot(division_slug, run_date)
    save_snapshot(division_slug, run_date, total_rows)

    if previous_rows is None:
        print(f"  No earlier {division_label} snapshot to diff against yet -- "
              f"real per-week rows for {division_label} start next time this runs.")
        weekly_rows = []
    else:
        weekly_rows = build_weekly_delta_rows(total_rows, previous_rows, week_label=run_date)
        print(f"  {len(weekly_rows)} {division_label} rows for the week since {previous_date}")

    return total_rows + weekly_rows


def build_fbs_fcs_legacy(run_date):
    """The pre-ESPN FBS/FCS path (NCAA API + conference pages). Only used if
    ESPN can't be reached, so the weekly job still produces data."""
    print("Fetching FBS conference map...")
    fbs_conferences = fetch_conference_map("fbs")
    fbs_rows = build_division(
        "fbs", "FBS", run_date,
        lambda: build_division_rows("fbs", "FBS", lambda team: fbs_conferences.get(team, "Independent")),
    )
    fbs_rows += fetch_supplemental_rows("FBS", fbs_rows)

    print("Fetching FCS conference map...")
    fcs_conferences = fetch_conference_map("fcs")
    fcs_rows = build_division(
        "fcs", "FCS", run_date,
        lambda: build_division_rows("fcs", "FCS", lambda team: fcs_conferences.get(team, "Independent")),
    )
    fcs_rows += fetch_supplemental_rows("FCS", fcs_rows)
    return fbs_rows, fcs_rows


def build_fbs_fcs(run_date):
    """FBS + FCS: ESPN is the primary source; the NCAA API and each
    conference's own stats page fill in whatever ESPN lacks (see espn_stats.py
    for exactly how the three are combined)."""
    print("Fetching FBS + FCS player stats from ESPN (primary source)...")
    try:
        colleges = load_colleges()
        athletes = fetch_espn_athletes()
        print(f"  {len(athletes)} athletes in ESPN's bulk list (covers FBS well, FCS barely)")
        roster_athletes, failed_teams = fetch_roster_athletes(colleges, "FCS", skip_ids={a["athlete"]["id"] for a in athletes})
        print(f"  +{len(roster_athletes)} FCS roster players" + (f" (rosters unavailable: {', '.join(failed_teams)})" if failed_teams else ""))
        athletes += roster_athletes
        print("  fetching each player's season line...")
        lines, failures = fetch_athlete_lines(athletes, colleges)
    except Exception as err:  # noqa: BLE001 -- any ESPN failure means fall back, loudly
        print(f"  !! ESPN unavailable ({err}) -- falling back to the NCAA API + conference pages only")
        return build_fbs_fcs_legacy(run_date)
    print(f"  {len(lines)} player lines fetched, {len(failures)} failed")
    if lines and len(failures) > 0.05 * (len(lines) + len(failures)):
        print("  !! more than 5% of ESPN player lookups failed -- ESPN may be throttling; NCAA/conference fallbacks will cover the gaps")

    results = {}
    for slug, label in (("fbs", "FBS"), ("fcs", "FCS")):
        espn_rows = build_espn_rows(label, colleges, athletes, lines)
        print(f"  {len(espn_rows)} {label} rows from ESPN")

        fallback_sets = []
        try:
            conferences = fetch_conference_map(slug)
            print(f"  Fetching {label} NCAA leaderboards (fallback)...")
            ncaa_rows = build_division_rows(slug, label, lambda team, c=conferences: c.get(team, "Independent"))
            for r in ncaa_rows:
                r["source"] = "ncaa"
            fallback_sets.append(("ncaa", ncaa_rows))
        except Exception as err:  # noqa: BLE001
            print(f"  NCAA API fallback unavailable for {label}: {err}")
            ncaa_rows = []

        print(f"  Fetching {label} conference-site stats (fallback)...")
        conf_rows = fetch_supplemental_rows(label, ncaa_rows)
        for r in conf_rows:
            r["source"] = "conference"
        fallback_sets.append(("conference", conf_rows))

        merged, stats = merge_division(label, espn_rows, fallback_sets, colleges)
        for source, counts in stats.items():
            print(f"    {source}: {counts['matched_into_espn']} matched an ESPN row, {counts['added']} added as extra players")
        results[label] = build_division(slug, label, run_date, lambda m=merged: m)
    return results["FBS"], results["FCS"]


def build_ncaa_api_divisions(run_date):
    fbs_rows, fcs_rows = build_fbs_fcs(run_date)

    print("Fetching D2 stat leaders (passing/rushing/receiving/tackling/sacks)...")
    d2_rows = build_division(
        "d2", "D2", run_date,
        lambda: build_division_rows("d2", "D2", d2_conference_for),
    )

    print("Cross-referencing D2 against each conference's own stats page...")
    d2_rows += fetch_supplemental_rows("D2", d2_rows)

    unmapped_d2_teams = sorted({r["team"] for r in d2_rows if r["conference"] == "Independent"})
    if unmapped_d2_teams:
        print(
            f"  Note: {len(unmapped_d2_teams)} D2 teams have no known conference yet "
            f"and were tagged 'Independent' (e.g. {', '.join(unmapped_d2_teams[:5])}...)"
        )

    print("Fetching D3 stat leaders (passing/rushing/receiving/tackling/sacks)...")
    d3_rows = build_division(
        "d3", "D3", run_date,
        lambda: build_division_rows("d3", "D3", d3_conference_for),
    )
    # No conference cross-referencing yet for D3 -- conference_sites.py
    # doesn't have D3 conference site domains mapped yet (that's the
    # planned follow-up, same as D3_KNOWN_CONFERENCES in ncaa_api.py).

    unmapped_d3_teams = sorted({r["team"] for r in d3_rows if r["conference"] == "Independent"})
    if unmapped_d3_teams:
        print(
            f"  Note: {len(unmapped_d3_teams)} D3 teams have no known conference yet "
            f"and were tagged 'Independent' -- expected for now, D3_KNOWN_CONFERENCES "
            f"in ncaa_api.py starts empty (e.g. {', '.join(unmapped_d3_teams[:5])}...)"
        )

    return fbs_rows + fcs_rows + d2_rows + d3_rows


def _run_with_browser(build_fn):
    """build_fn(page) -> rows, run inside one shared headless browser page."""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(user_agent=(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ))
        try:
            return build_fn(page)
        finally:
            browser.close()


def build_naia_division(run_date):
    from naia import CONFERENCE_PATHS, build_naia_rows

    print(f"Fetching NAIA stat leaders across {len(CONFERENCE_PATHS)} conferences "
          f"(this uses a real browser, so it's slower than the NCAA API calls)...")

    return build_division("naia", "NAIA", run_date, lambda: _run_with_browser(build_naia_rows))


def _team_key(name):
    """'Butler', 'Butler Community College' -> 'butler' (same team across sources)."""
    import re

    text = (name or "").lower().strip()
    # NJCAA tags some names with a state: "Butler Community College-KS", "Highland Community College-Kansas".
    text = re.sub(r"(college|university)-[a-z]+$", r"\1", text)
    for word in ("community college", "junior college", "college", "university"):
        text = text.replace(word, "")
    return re.sub(r"[^a-z]", "", text)


def build_juco_division(run_date):
    """JUCO = NJCAA programs from njcaa.org's public API (plain HTTPS, no browser) plus whatever the conference
    sites and CCCAA (California) give. Those PrestoSports sites now sit behind a bot check, so when they can't be
    reached the last saved rows for those teams are kept instead."""
    import njcaa
    from juco import CONFERENCES, build_juco_rows
    from cccaa import build_cccaa_rows

    def fetch_total_rows():
        print("Fetching NJCAA football stats from njcaa.org's public API...")
        try:
            fresh = njcaa.build_njcaa_rows()
            print(f"  {len(fresh)} NJCAA rows from {len({r['team'] for r in fresh})} teams")
        except Exception as err:  # noqa: BLE001
            print(f"::warning::NJCAA API unavailable ({err})")
            fresh = []
        # Keep each team's name and conference label as already saved, so weekly comparisons still line up.
        try:
            with open(OUTPUT_PATH) as f:
                saved_juco = [r for r in json.load(f) if r["division"] == "JUCO" and r["week"] == "total"]
        except (OSError, ValueError):
            saved_juco = []
        saved_names = {_team_key(r["team"]): (r["team"], r["conference"]) for r in saved_juco}
        for r in fresh:
            known = saved_names.get(_team_key(r["team"]))
            if known:
                r["team"] = known[0]
                # A saved conference from the team's own conference site wins; the old region labels don't.
                if known[1] and not known[1].startswith("Region") and known[1] != "NJCAA":
                    r["conference"] = known[1]
        covered = {_team_key(r["team"]) for r in fresh}

        print(f"Fetching JUCO conference sites ({len(CONFERENCES)}) and CCCAA (California) -- these use a real browser...")
        try:
            def _legacy(page):
                return build_juco_rows(page) + build_cccaa_rows(page)

            other = [r for r in _run_with_browser(_legacy) if _team_key(r["team"]) not in covered]
            print(f"  {len(other)} rows from the conference / CCCAA sites (teams NJCAA doesn't cover)")
        except Exception as err:  # noqa: BLE001
            print(f"::warning::JUCO conference / CCCAA sites unreachable ({err}); keeping their last saved rows")
            other = [r for r in saved_juco if _team_key(r["team"]) not in covered]
            if not fresh:
                raise
        return fresh + other

    return build_division("juco", "JUCO", run_date, fetch_total_rows)


def main():
    run_date = datetime.date.today().isoformat()

    if "--fbs-fcs" in sys.argv:
        # Quick refresh of just FBS + FCS (a few minutes): keeps every other
        # division's rows exactly as they are in the existing output.
        with open(OUTPUT_PATH) as f:
            existing = json.load(f)
        all_rows = [r for r in existing if r["division"] not in ("FBS", "FCS")]
        fbs_rows, fcs_rows = build_fbs_fcs(run_date)
        all_rows += fbs_rows + fcs_rows
    else:
        # One source being down must not take the others with it: a division that fails keeps the rows
        # it had last time (and shows up as a warning), while the rest refresh normally.
        try:
            with open(OUTPUT_PATH) as f:
                existing = json.load(f)
        except (OSError, ValueError):
            existing = []
        failed = []

        def guarded(label, divisions, build):
            try:
                return build(run_date)
            except Exception as err:  # noqa: BLE001 -- any failure in one source is contained here
                failed.append(label)
                print(f"::warning::{label} refresh failed ({err}); keeping the last saved {label} rows")
                return [r for r in existing if r["division"] in divisions]

        all_rows = guarded("FBS/FCS/D2/D3 (NCAA + ESPN)", {"FBS", "FCS", "D2", "D3"}, build_ncaa_api_divisions)
        all_rows += guarded("NAIA", {"NAIA"}, build_naia_division)
        all_rows += guarded("JUCO", {"JUCO"}, build_juco_division)
        if len(failed) == 3:
            raise RuntimeError("Every division failed to refresh -- nothing new to save.")
        if failed:
            print(f"\nRefreshed everything except: {', '.join(failed)} (those keep their previous data).")

    print("\nScrubbing duplicates across every division...")
    all_rows, report = scrub_duplicates(all_rows)
    print(f"  removed {report['removed']} duplicate rows, repaired {report['ids_repaired']} duplicate ids")
    for example in report["examples"]:
        print(f"    {example}")

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(all_rows, f, indent=2)

    print(f"\nWrote {len(all_rows)} rows to {os.path.abspath(OUTPUT_PATH)}")


if __name__ == "__main__":
    sys.exit(main())
