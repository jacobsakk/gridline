"""
Fetches real FCS + D2 individual stat leaders and writes them to
frontend/src/data/real-stats.json for the front-end to read directly.

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
    fetch_fcs_conference_map,
    load_previous_snapshot,
    save_snapshot,
)

OUTPUT_PATH = os.path.join(
    os.path.dirname(__file__), "..", "frontend", "src", "data", "real-stats.json"
)


def build_division(division_slug, division_label, conference_lookup, run_date):
    print(f"Fetching {division_label} stat leaders (passing/rushing/receiving/tackling/sacks)...")
    total_rows = build_division_rows(division_slug, division_label, conference_lookup)
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


def main():
    run_date = datetime.date.today().isoformat()

    print("Fetching FCS conference map...")
    fcs_conferences = fetch_fcs_conference_map()
    print(f"  {len(fcs_conferences)} FCS teams mapped to conferences")

    fcs_rows = build_division(
        "fcs", "FCS", lambda team: fcs_conferences.get(team, "Independent"), run_date
    )
    d2_rows = build_division("d2", "D2", d2_conference_for, run_date)

    unmapped_d2_teams = sorted({r["team"] for r in d2_rows if r["conference"] == "Independent"})
    if unmapped_d2_teams:
        print(
            f"  Note: {len(unmapped_d2_teams)} D2 teams have no known conference yet "
            f"and were tagged 'Independent' (e.g. {', '.join(unmapped_d2_teams[:5])}...)"
        )

    all_rows = fcs_rows + d2_rows
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(all_rows, f, indent=2)

    print(f"\nWrote {len(all_rows)} rows to {os.path.abspath(OUTPUT_PATH)}")


if __name__ == "__main__":
    sys.exit(main())
