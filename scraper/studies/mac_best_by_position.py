"""
One-off data pull for the Studies dashboard's first study: the top 5 most productive MAC players at each
position, for each of the 2023, 2024 and 2025 seasons -- kept as three separate rankings (not combined
across years), so the study answers "who had the best year in the league at this position, in this
specific season" rather than a multi-year aggregate. Not part of the regular weekly refresh -- run by hand
whenever this study needs to be regenerated:

    python3 studies/mac_best_by_position.py

All three seasons come from the NCAA API's national leaderboards (ncaa_api.py, season override), which
only carry a player once they crack roughly the national top 100-150 in that category that season -- a
genuinely elite conference performer is covered, but a solid-but-not-nationally-ranked one may be missing.

MAC membership was stable across 2023-2025 (Massachusetts already in since 2022; Northern Illinois left
for the Mountain West and Sacramento St. joined only for 2026, after this study's window).
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ncaa_api import build_division_rows
from studies._hudl_links import HUDL_LINKS, PFF_LINKS, TE_SUPPLEMENT
from studies._stat_overrides import STAT_OVERRIDES
from studies._home_states import HOME_STATES

OUT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "frontend", "src", "data", "studies", "mac-best-by-position.json")

SEASONS = ["2023", "2024", "2025"]
MAC_TEAMS = {
    "Akron", "Ball St.", "Bowling Green", "Buffalo", "Central Mich.", "Eastern Mich.", "Kent St.",
    "Massachusetts", "Miami (OH)", "Northern Illinois", "Ohio", "Toledo", "Western Mich.",
}

# Which category+position combo defines each group, and how "most productive" is scored from that
# category's raw stat fields for one season. All are real counting stats already in the pipeline's row shape.
GROUPS = {
    # rushYards/rushTd are merged in separately from the rushing leaderboard (see build() -- a passing-
    # category row has no rushing columns of its own), so a dual-threat QB's legs count toward the score
    # too, not just his arm.
    "QB": {"category": "passing", "position": "QB", "score": lambda s: s["yards"] + 25 * s["td"] - 15 * s["int"] + s["rushYards"] + 10 * s["rushTd"], "stats": ["games", "att", "yards", "td", "int", "rushYards", "rushTd"]},
    "RB": {"category": "rushing", "position": "RB", "score": lambda s: s["yards"] + 10 * s["td"], "stats": ["games", "att", "yards", "td"]},
    "WR": {"category": "receiving", "position": "WR", "score": lambda s: s["yards"] + 10 * s["td"], "stats": ["games", "rec", "yards", "td"]},
    "TE": {"category": "receiving", "position": "TE", "score": lambda s: s["yards"] + 10 * s["td"], "stats": ["games", "rec", "yards", "td"]},
    "DL": {"category": "tackling", "position": "DL", "score": lambda s: s["total"] + 2 * s["tfl"] + 6 * s["sacks"], "stats": ["games", "total", "tfl", "sacks", "pbu", "int"]},
    "LB": {"category": "tackling", "position": "LB", "score": lambda s: s["total"] + 2 * s["tfl"] + 6 * s["sacks"] + 4 * s["pbu"] + 8 * s["int"], "stats": ["games", "total", "tfl", "sacks", "pbu", "int"]},
    "CB": {"category": "tackling", "position": "CB", "score": lambda s: s["total"] + 8 * s["int"] + 4 * s["pbu"], "stats": ["games", "total", "pbu", "int"]},
    "SAF": {"category": "tackling", "position": "SAF", "score": lambda s: s["total"] + 6 * s["int"] + 3 * s["pbu"] + 1.5 * s["tfl"], "stats": ["games", "total", "tfl", "pbu", "int"]},
}
TOP_N = 5
MIN_GAMES = 4  # a game or two (missed the leaderboard cutoff most of the time) isn't "one of the best"


def num(row, key):
    try:
        return float(row.get(key, 0))
    except (TypeError, ValueError):
        return 0.0


def fetch_season(season):
    def lookup(team):
        return "MAC" if team in MAC_TEAMS else "Independent"

    rows = build_division_rows("fbs", "FBS", lookup, season=season)
    return [r for r in rows if r["conference"] == "MAC"]


def build():
    by_season = {}
    for season in SEASONS:
        print(f"Fetching {season} MAC stats from the NCAA API...")
        rows = fetch_season(season)
        by_season[season] = rows
        print(f"  {len(rows)} rows")

    study = {}
    for group_key, cfg in GROUPS.items():
        study[group_key] = {}
        for season in SEASONS:
            rows = [r for r in by_season[season] if r["category"] == cfg["category"] and r["position"] == cfg["position"]]
            # A QB's rushing line lives on a separate "rushing"-category row (same player/team) -- the
            # passing leaderboard has no rushing columns at all -- so look it up by (player, team) rather
            # than expecting it on the passing row itself.
            rushing_by_key = {}
            if group_key == "QB":
                for rr in by_season[season]:
                    if rr["category"] == "rushing":
                        rushing_by_key[(rr["player"], rr["team"])] = rr
            ranked = []
            for r in rows:
                totals = {k: num(r, k) for k in cfg["stats"]}
                if totals.get("games", 0) < MIN_GAMES:
                    continue
                if group_key == "QB":
                    rush = rushing_by_key.get((r["player"], r["team"]))
                    # A pure pocket passer legitimately has ~0 rushing yards -- unlike the DL/CB tackle gap,
                    # a QB missing from the rushing leaderboard entirely usually just means he doesn't run
                    # the ball much, so 0 here is a real value, not a leaderboard-coverage artifact.
                    totals["rushYards"] = num(rush, "yards") if rush else 0.0
                    totals["rushTd"] = num(rush, "td") if rush else 0.0
                # See _stat_overrides.py -- corrects a real gap in the leaderboard merge (a player who
                # cracked one defensive leaderboard but not "Total Tackles" specifically defaults to 0
                # there, which is never actually true for a rostered starter).
                totals.update(STAT_OVERRIDES.get((r["player"].upper(), season), {}))
                ranked.append({
                    "player": r["player"],
                    "team": r["team"],
                    "position": group_key,
                    "season": int(season),
                    "totals": totals,
                    "score": round(cfg["score"](totals), 1),
                    # Best-effort, found by hand via web search -- not exhaustive. Blank means not found
                    # yet; an admin can paste one in directly from the Studies page.
                    "hudlLink": HUDL_LINKS.get(r["player"].upper(), ""),
                    "pffLink": PFF_LINKS.get(r["player"].upper(), ""),
                    # Home state (high school, not college) -- see _home_states.py. Best-effort, same as
                    # the Hudl links; blank means not found yet.
                    "state": HOME_STATES.get(r["player"].upper(), ""),
                })
            if group_key == "TE":
                # The leaderboard pull above still runs (kept, in case a future season has more nationally-
                # ranked MAC tight ends) but the hand-researched list is what's actually used for TE.
                ranked = [
                    {"player": e["player"], "team": e["team"], "position": "TE", "season": int(season), "totals": e["totals"],
                     "score": round(cfg["score"](e["totals"]), 1), "hudlLink": HUDL_LINKS.get(e["player"].upper(), ""),
                     "pffLink": PFF_LINKS.get(e["player"].upper(), ""), "state": HOME_STATES.get(e["player"].upper(), "")}
                    for e in TE_SUPPLEMENT.get(season, [])
                ]
            ranked.sort(key=lambda x: -x["score"])
            study[group_key][season] = ranked[:TOP_N]
            print(f"  {group_key} {season}: {len(rows)} leaderboard candidates, {len(ranked)} in the final list")

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump({"generatedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z", "seasons": [int(s) for s in SEASONS], "groups": study}, f, indent=2)
    print(f"\nWrote {OUT_PATH}")


if __name__ == "__main__":
    build()
