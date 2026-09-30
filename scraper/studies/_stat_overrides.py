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
    ("CAIDEN WOULLARD", "2023"): {"total": 41, "tfl": 12},    # Miami (OH): 41 tackles, 9.5 sacks, 12 TFL
    ("JUDGE CULPEPPER", "2023"): {"total": 38, "tfl": 10.5},  # Toledo: 38 tackles, 9.0 sacks, 10.5 TFL
    ("KOBE STEWART", "2024"): {"total": 40, "tfl": 12},       # Buffalo: 40 tackles, 9.5 sacks, 12 TFL
    ("BRADLEY WEAVER", "2024"): {"total": 44, "tfl": 15},     # Ohio: 44 tackles, 8.5 sacks, 15 TFL
    ("NADAME TUCKER", "2025"): {"total": 55},     # Western Mich.: 55 tackles, 14.5 sacks, 21 TFL (tfl already correct pre-fix)
    ("NATHAN VOORHIS", "2025"): {"total": 51},    # Ball St.: 51 tackles, 12 sacks, 17 TFL (tfl already correct pre-fix)
    ("MICHAEL HELDMAN", "2025"): {"total": 48},   # Central Mich.: 48 tackles, 10.5 sacks, 16.5 TFL (tfl already correct pre-fix)
    ("RODNEY MCGRAW", "2025"): {"total": 42, "tfl": 8.5},     # Western Mich.: 42 tackles, 7.0 sacks, 8.5 TFL

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

    # A second, related gap in the same merge: a player who cracked the Sacks board can still be missing
    # from the TFL board specifically -- which is a logical impossibility, not just a coverage gap, since
    # a sack always counts as a TFL (sacks <= tfl always). Caught by checking that constraint directly
    # against every DL/LB row rather than by inspection.
    ("MARSHAWN KNEELAND", "2023"): {"tfl": 7.5},    # Western Mich.: 57 tackles, 4.5 sacks, 7.5 TFL
    ("CJ NUNNALLY", "2024"): {"tfl": 11},           # Akron: 56 tackles, 6.0 sacks, 11 TFL
    ("PEYTON PRICE", "2024"): {"tfl": 10.0},        # Eastern Mich.: 53 tackles, 5.0 sacks, 10 TFL
    ("TY WISE", "2023"): {"tfl": 9.0, "int": 1},    # Miami (OH): 122 tackles, 8.0 sacks, 9.0 TFL, 1 INT
    ("JOSEPH SIPP JR.", "2024"): {"tfl": 10.5},     # Bowling Green: sacks/TFL recap gives 10.5 TFL
    ("RED MURDOCK", "2025"): {"tfl": 13.5},         # Buffalo: 142 tackles, 5.0 sacks, 13.5 TFL
    ("ADAM TRICK", "2025"): {"tfl": 12.5, "pbu": 4, "int": 1},  # Miami (OH): 59 tackles, 8.5 sacks, 12.5 TFL, 4 PBU, 1 INT
    # Riley Tolsma, Ball St., 2024: real TFL is nonzero (he has 5.5 sacks) but no source gave a number
    # that survives a sanity check (one hit claimed 44, implausible for a single season) -- left at 0
    # rather than guess; still wrong, just not fixable from what's findable.

    # Safety -- interceptions (and a few PBU/TFL) undercounted the same way: a safety who didn't crack
    # the national INT leaderboard with 1-2 picks defaults to int=0, which reads as "no interceptions"
    # when the real number is just small.
    ("MAXEN HOOK", "2024"): {"tfl": 1, "pbu": 4, "int": 2},         # Toledo: 107 tackles, 1 TFL, 4 PBU, 2 INT
    ("AARON WOFFORD", "2023"): {"int": 2, "pbu": 5},                # Western Mich.: 71 tackles, 2 INT, 5 PBU
    ("BRYCE SHEPPERT", "2023"): {"int": 1, "pbu": 7},               # Kent St.: 79 tackles, 7 PBU, 1 INT
    ("DARRIAN LEWIS", "2023"): {"tfl": 4, "pbu": 6, "int": 1},      # Akron: 75 tackles, 4 TFL, 6 PBU, 1 INT
    ("TATE HALLOCK", "2023"): {"tfl": 1.5, "pbu": 4, "int": 2},     # Western Mich.: 75 tackles, 1.5 TFL, 4 PBU, 2 INT
    ("SILAS WALTERS", "2024"): {"pbu": 12},                         # Miami (OH): 95 tackles, 12 PBU, 0 INT (confirmed real zero)
    ("RAION STRADER", "2024"): {"int": 2},                          # Miami (OH): 53 tackles, 18 PBU, 2 INT
    ("ELI BLAKEY", "2025"): {"tfl": 4.5, "pbu": 8, "int": 2},       # Miami (OH): 118 tackles, 4.5 TFL, 8 PBU, 2 INT
    ("BRYCE LLEWELLYN", "2025"): {"tfl": 5.0, "int": 2},            # Eastern Mich.: 103 tackles, 5.0 TFL, 2 INT
    ("JALEN THOMESON", "2025"): {"tfl": 7, "int": 1},               # Ohio: 86 tackles, 7 TFL, 1 INT
    ("KAL-EL PASCAL", "2025"): {"tfl": 4, "pbu": 5, "int": 1},      # Bowling Green: 80 tackles, 4 TFL, 5 PBU, 1 INT

    # Quarterback rushing -- same leaderboard-coverage gap again: a QB's rushing line (merged in from the
    # separate rushing-category leaderboard, see build()) defaults to 0 if he didn't crack that board,
    # which is a real value for a true pocket passer but was flat wrong for several of these (e.g. Noah
    # Kim actually ran for 186 yards and 6 TDs in 2025 -- nowhere close to the rushing leaderboard's national
    # cutoff, but far from zero). A sack-yardage-heavy QB can have negative net rushing yards; that's real,
    # not a data error.
    ("KURTIS ROURKE", "2023"): {"rushYards": 219, "rushTd": 4},     # Ohio
    ("COLE SNYDER", "2023"): {"rushYards": 88, "rushTd": 1},        # Buffalo
    ("CONNOR BAZELAK", "2023"): {"rushYards": -82, "rushTd": 2},    # Bowling Green
    ("JASE BAUER", "2023"): {"rushYards": 365, "rushTd": 10},       # Central Mich.
    ("CONNOR BAZELAK", "2024"): {"rushYards": -91, "rushTd": 2},    # Bowling Green
    ("KADIN SEMONZA", "2024"): {"rushYards": -85, "rushTd": 1},     # Ball St.
    ("TUCKER GLEASON", "2024"): {"rushYards": 364, "rushTd": 7},    # Toledo
    ("BRETT GABBERT", "2024"): {"rushYards": 6, "rushTd": 1},       # Miami (OH)
    ("NOAH KIM", "2025"): {"rushYards": 186, "rushTd": 6},          # Eastern Mich.
    ("TUCKER GLEASON", "2025"): {"rushYards": 144, "rushTd": 4},    # Toledo
    ("BEN FINLEY", "2025"): {"rushYards": 130, "rushTd": 2},        # Akron
}
