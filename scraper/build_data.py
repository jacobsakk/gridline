"""
Fetches real FCS + D2 individual stat leaders and writes them to
frontend/src/data/real-stats.json for the front-end to read directly.

Run manually for now:

    python3 scraper/build_data.py

Later this becomes the payload of the weekly GitHub Actions job -- for
now it just regenerates a static JSON file the front-end imports, which
is enough to replace the mock D2/FCS data with real numbers.
"""

import json
import os
import sys

from ncaa_api import build_division_rows, fetch_fcs_conference_map, d2_conference_for

OUTPUT_PATH = os.path.join(
    os.path.dirname(__file__), "..", "frontend", "src", "data", "real-stats.json"
)


def main():
    print("Fetching FCS conference map...")
    fcs_conferences = fetch_fcs_conference_map()
    print(f"  {len(fcs_conferences)} FCS teams mapped to conferences")

    print("Fetching FCS stat leaders (passing/rushing/receiving/tackling/sacks)...")
    fcs_rows = build_division_rows("fcs", "FCS", lambda team: fcs_conferences.get(team, "Independent"))
    print(f"  {len(fcs_rows)} FCS rows")

    print("Fetching D2 stat leaders...")
    d2_rows = build_division_rows("d2", "D2", d2_conference_for)
    print(f"  {len(d2_rows)} D2 rows")

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
