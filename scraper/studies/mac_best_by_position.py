"""
One-off data pull for the Studies dashboard's first study: the most productive MAC players at each
position over 2024-2026 (2024 and 2025 are final seasons; 2026 is in progress). Not part of the regular
weekly refresh -- run by hand whenever this study needs to be regenerated:

    python3 studies/mac_best_by_position.py

2024/2025 come from the NCAA API's national leaderboards (ncaa_api.py, season override) -- which only
carry a player once they crack roughly the national top 100-150 in that category that season, so a
genuinely elite conference performer is covered but a solid-but-not-nationally-ranked one may be missing
for those two years. 2026 comes from the site's own bundled real-stats.json instead, which is far more
complete (ESPN + conference-site fallbacks), since the season is still in progress there.

MAC membership changed for 2026 (Sacramento St. joined, Northern Illinois left for the Mountain West) --
handled here with two separate team lists rather than one, so a team isn't misattributed to a season it
wasn't a MAC member for.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ncaa_api import build_division_rows
from naming import name_key, same_person_name
from studies._hudl_links import HUDL_LINKS

OUT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "frontend", "src", "data", "studies", "mac-best-by-position.json")
REAL_STATS_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "frontend", "src", "data", "real-stats.json")

MAC_2024_2025 = {
    "Akron", "Ball St.", "Bowling Green", "Buffalo", "Central Mich.", "Eastern Mich.", "Kent St.",
    "Massachusetts", "Miami (OH)", "Northern Illinois", "Ohio", "Toledo", "Western Mich.",
}
MAC_2026 = {
    "Akron", "Ball St.", "Bowling Green", "Buffalo", "Central Mich.", "Eastern Mich.", "Kent St.",
    "Massachusetts", "Miami (OH)", "Ohio", "Sacramento St.", "Toledo", "Western Mich.",
}

# Which category+position combo defines each group, and how "most productive" is scored from that
# category's raw stat fields. All are real counting stats already in the pipeline's row shape.
GROUPS = {
    "QB": {"category": "passing", "position": "QB", "score": lambda s: s["yards"] + 25 * s["td"] - 15 * s["int"], "stats": ["games", "att", "yards", "td", "int"]},
    "RB": {"category": "rushing", "position": "RB", "score": lambda s: s["yards"] + 10 * s["td"], "stats": ["games", "att", "yards", "td"]},
    "WR": {"category": "receiving", "position": "WR", "score": lambda s: s["yards"] + 10 * s["td"], "stats": ["games", "rec", "yards", "td"]},
    "TE": {"category": "receiving", "position": "TE", "score": lambda s: s["yards"] + 10 * s["td"], "stats": ["games", "rec", "yards", "td"]},
    "DL": {"category": "tackling", "position": "DL", "score": lambda s: s["total"] + 2 * s["tfl"] + 6 * s["sacks"], "stats": ["games", "total", "tfl", "sacks", "pbu", "int"]},
    "LB": {"category": "tackling", "position": "LB", "score": lambda s: s["total"] + 2 * s["tfl"] + 6 * s["sacks"] + 4 * s["pbu"] + 8 * s["int"], "stats": ["games", "total", "tfl", "sacks", "pbu", "int"]},
    "CB": {"category": "tackling", "position": "CB", "score": lambda s: s["total"] + 8 * s["int"] + 4 * s["pbu"], "stats": ["games", "total", "pbu", "int"]},
    "SAF": {"category": "tackling", "position": "SAF", "score": lambda s: s["total"] + 6 * s["int"] + 3 * s["pbu"] + 1.5 * s["tfl"], "stats": ["games", "total", "tfl", "pbu", "int"]},
}
TOP_N = 5


def num(row, key):
    v = row.get(key, 0)
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def fetch_ncaa_season(season, mac_teams):
    def lookup(team):
        return "MAC" if team in mac_teams else "Independent"

    rows = build_division_rows("fbs", "FBS", lookup, season=season)
    return [r for r in rows if r["conference"] == "MAC"]


def fetch_2026_from_bundle():
    with open(REAL_STATS_PATH) as f:
        data = json.load(f)
    return [r for r in data if r["division"] == "FBS" and r["conference"] == "MAC" and r["team"] in MAC_2026]


def build():
    print("Fetching 2024 MAC stats from the NCAA API...")
    rows_2024 = fetch_ncaa_season("2024", MAC_2024_2025)
    print(f"  {len(rows_2024)} rows")
    print("Fetching 2025 MAC stats from the NCAA API...")
    rows_2025 = fetch_ncaa_season("2025", MAC_2024_2025)
    print(f"  {len(rows_2025)} rows")
    print("Reading 2026 MAC stats from the site's own bundled data...")
    rows_2026 = fetch_2026_from_bundle()
    print(f"  {len(rows_2026)} rows")

    by_season = {2024: rows_2024, 2025: rows_2025, 2026: rows_2026}

    study = {}
    for group_key, cfg in GROUPS.items():
        candidates = []  # one entry per (player, season) row matching this group's category+position
        for season, rows in by_season.items():
            for r in rows:
                if r["category"] != cfg["category"] or r["position"] != cfg["position"]:
                    continue
                candidates.append((season, r))

        # Group rows into one player across seasons by name (same_person_name tolerates a spelling
        # difference or suffix, the same way the rest of the pipeline dedupes players).
        players = []  # [{name, seasons: {year: {team, **stats}}}]
        for season, r in candidates:
            match = next((p for p in players if same_person_name(p["name"], r["player"])), None)
            if not match:
                match = {"name": r["player"], "seasons": {}}
                players.append(match)
            match["seasons"][season] = {"team": r["team"], **{k: num(r, k) for k in cfg["stats"]}}

        ranked = []
        for p in players:
            totals = {k: sum(s.get(k, 0) for s in p["seasons"].values()) for k in cfg["stats"]}
            score = cfg["score"](totals)
            teams = sorted({s["team"] for s in p["seasons"].values()})
            ranked.append({
                "player": p["name"],
                "position": group_key,
                "teams": teams,
                "seasonsPlayed": sorted(p["seasons"].keys()),
                "totals": totals,
                "bySeasson": {str(y): s for y, s in p["seasons"].items()},
                "score": round(score, 1),
                # Best-effort, found by hand via web search -- not exhaustive. Blank means not found yet;
                # fill it in from the Studies page itself (admins can edit this column directly).
                "hudlLink": HUDL_LINKS.get(p["name"].upper(), ""),
            })
        # A player who only shows up for a game or two (missed the leaderboard cutoff most of the time,
        # or a late-2026 cameo) isn't "one of the best" -- just noise padding out a thin group. Real
        # multi-game production is the bar, not a fixed count.
        qualified = [p for p in ranked if p["totals"].get("games", 0) >= 4]
        qualified.sort(key=lambda x: -x["score"])
        study[group_key] = qualified[:TOP_N]
        print(f"  {group_key}: {len(players)} candidates, {len(qualified)} qualified, top {min(TOP_N, len(qualified))} kept")

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump({"generatedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z", "groups": study}, f, indent=2)
    print(f"\nWrote {OUT_PATH}")


if __name__ == "__main__":
    build()
