"""
Fetches real FBS + FCS + D2 individual stat leaders (plus NAIA/JUCO/CCCAA,
below) and writes them to frontend/src/data/real-stats.json for the
front-end to read directly.

Run manually for now:

    python3 scraper/build_data.py

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
    fetch_conference_map,
    load_previous_snapshot,
    save_snapshot,
)
from conference_sites import fetch_supplemental_rows

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


def build_ncaa_api_divisions(run_date):
    print("Fetching FBS conference map...")
    fbs_conferences = fetch_conference_map("fbs")
    print(f"  {len(fbs_conferences)} FBS teams mapped to conferences")

    print("Fetching FBS stat leaders (passing/rushing/receiving/tackling/sacks)...")
    fbs_rows = build_division(
        "fbs", "FBS", run_date,
        lambda: build_division_rows("fbs", "FBS", lambda team: fbs_conferences.get(team, "Independent")),
    )

    print("Cross-referencing FBS against each conference's own stats page "
          "(the NCAA's national leaderboard misses anyone outside roughly "
          "the national top 150 per category)...")
    fbs_rows += fetch_supplemental_rows("FBS", fbs_rows)

    print("Fetching FCS conference map...")
    fcs_conferences = fetch_conference_map("fcs")
    print(f"  {len(fcs_conferences)} FCS teams mapped to conferences")

    print("Fetching FCS stat leaders (passing/rushing/receiving/tackling/sacks)...")
    fcs_rows = build_division(
        "fcs", "FCS", run_date,
        lambda: build_division_rows("fcs", "FCS", lambda team: fcs_conferences.get(team, "Independent")),
    )

    print("Cross-referencing FCS against each conference's own stats page...")
    fcs_rows += fetch_supplemental_rows("FCS", fcs_rows)

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

    return fbs_rows + fcs_rows + d2_rows


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


def build_juco_division(run_date):
    from juco import CONFERENCES, build_juco_rows
    from cccaa import build_cccaa_rows

    print(f"Fetching JUCO stat leaders across {len(CONFERENCES)} conferences "
          f"(also uses a real browser -- these sites challenge plain HTTP requests "
          f"under load, confirmed directly)...")
    print("Fetching CCCAA (California JUCO) stat leaders...")

    def fetch_total_rows():
        def _fetch(page):
            return build_juco_rows(page) + build_cccaa_rows(page)
        return _run_with_browser(_fetch)

    return build_division("juco", "JUCO", run_date, fetch_total_rows)


def main():
    run_date = datetime.date.today().isoformat()

    all_rows = build_ncaa_api_divisions(run_date)
    all_rows += build_naia_division(run_date)
    all_rows += build_juco_division(run_date)

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(all_rows, f, indent=2)

    print(f"\nWrote {len(all_rows)} rows to {os.path.abspath(OUTPUT_PATH)}")


if __name__ == "__main__":
    sys.exit(main())
