"""Hand-verified corrections for a specific gap in the NCAA leaderboard merge (see build_defense_rows in
ncaa_api.py): "total tackles" only gets filled in for a player who cracks the *Total Tackles* leaderboard
specifically. A pass rusher who only cracked the Sacks board, or a corner who only cracked the PBU/INT
board, silently defaults to total=0 -- which is never actually true for a rostered starter (a guy with
9.5 sacks obviously has far more than zero tackles; sacks count toward it). Confirmed as wrong by inspection:
DL and CB are the two groups where "signature stat" and "raw tackle count" diverge enough that a real
starter can miss the tackles board entirely while topping another one.

Keyed by (PLAYER NAME upper-cased, season string) -> the real totals to overwrite, sourced by hand via web
search (team box scores / season recaps), same verification bar as the Hudl links: only added when a
specific season's number was directly stated, not estimated. Only overwrites the field(s) given -- a field
not listed here keeps whatever the leaderboard merge produced (which is real data for that field, just
zero/missing for the field(s) this maps)."""

STAT_OVERRIDES = {
    # Defensive line -- all missing "total" because their signature stat is sacks, not raw tackles.
    ("CAIDEN WOULLARD", "2023"): {"total": 41},   # Miami (OH): 41 tackles, 9.5 sacks, 12 TFL
    ("JUDGE CULPEPPER", "2023"): {"total": 38},   # Toledo: 38 tackles, 9.0 sacks, 10.5 TFL
    ("KOBE STEWART", "2024"): {"total": 40},      # Buffalo: 40 tackles, 9.5 sacks, 12 TFL
    ("BRADLEY WEAVER", "2024"): {"total": 44},    # Ohio: 44 tackles, 8.5 sacks, 15 TFL
    ("NADAME TUCKER", "2025"): {"total": 55},     # Western Mich.: 55 tackles, 14.5 sacks, 21 TFL
    ("NATHAN VOORHIS", "2025"): {"total": 51},    # Ball St.: 51 tackles, 12 sacks, 17 TFL
    ("MICHAEL HELDMAN", "2025"): {"total": 48},   # Central Mich.: 48 tackles, 10.5 sacks, 16.5 TFL
    ("RODNEY MCGRAW", "2025"): {"total": 42},     # Western Mich.: 42 tackles, 7.0 sacks, 8.5 TFL

    # Cornerback -- all missing "total" because they cracked the PBU/INT boards, not the tackles one.
    # A couple also had a real PBU count higher than what made the (much shorter) PBU leaderboard.
    ("QUINYON MITCHELL", "2023"): {"total": 41, "int": 1},        # Toledo: 41 tackles, 18 PBU, 1 INT
    ("JORDAN OLADOKUN", "2023"): {"total": 30, "pbu": 5},         # Bowling Green: 30 tackles, 4 INT, 5 PBU
    ("JALEN HUSKEY", "2023"): {"total": 52, "pbu": 6},            # Bowling Green: 52 tackles, 4 INT, 6 PBU
    ("CHARLES MCCARTHERENS", "2023"): {"total": 34, "pbu": 3},    # Buffalo: 34 tackles, 3 INT, 3 PBU
    ("JORDAN OLADOKUN", "2024"): {"total": 27, "pbu": 8},         # Bowling Green: 27 tackles, 5 INT, 8 PBU
    ("TANK PEARSON", "2024"): {"total": 51, "pbu": 6},            # Ohio: 51 tackles, 4 INT, 6 PBU
    ("TANK PEARSON", "2025"): {"total": 53, "int": 2},            # Ohio: 53 tackles, 2 INT, 11 PBU
    ("JOJO JOHNSON", "2025"): {"total": 22, "int": 1},            # Bowling Green: 22 tackles, 1 INT
}
