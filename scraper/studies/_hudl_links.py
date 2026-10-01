"""Best-effort Hudl links found via web search for the MAC study. Not exhaustive or independently
verified against each player's hometown/HS in every case -- confirmed with reasonable confidence where
noted; treat these as a starting point, not gospel. Hand-fill the rest in the Studies page itself."""
HUDL_LINKS = {
    "TUCKER GLEASON": "https://m.hudl.com/profile/7196933/Tucker-Gleason",
    "PARKER NAVARRO": "https://www.hudl.com/profile/7815205/Parker-Navarros/about",
    "AL-JAY HENDERSON": "https://www.hudl.com/profile/9822949",
    "SIEH BANGURA": "https://www.hudl.com/profile/6174794/Sieh-Bangura",
    "NADAME TUCKER": "https://www.hudl.com/v/2G4MYE",
}

# The NCAA leaderboard barely covers tight ends (they rarely crack the national top ~100-150 in receiving
# yards the way a featured WR does), so 2023-2025's TE top 5 is filled out by hand from All-MAC honors
# (getsomemaction.com's official team announcements) plus each team's own reporting on its leading TE that
# season -- not reproducible by re-running the NCAA API pull the rest of this study uses. Confirmed
# per-player, not guessed.
TE_SUPPLEMENT = {
    "2023": [
        {"player": "Harold Fannin Jr.", "team": "Bowling Green", "totals": {"games": 11, "rec": 44, "yards": 623, "td": 6}},
        {"player": "Anthony Torres", "team": "Toledo", "totals": {"games": 12, "rec": 26, "yards": 464, "td": 3}},
        {"player": "Tanner Koziol", "team": "Ball St.", "totals": {"games": 12, "rec": 34, "yards": 295, "td": 3}},
        {"player": "TJ Banks", "team": "Akron", "totals": {"games": 12, "rec": 21, "yards": 175, "td": 0}},
        {"player": "Mitchel Collier", "team": "Central Mich.", "totals": {"games": 12, "rec": 10, "yards": 88, "td": 3}},
    ],
    "2024": [
        {"player": "Harold Fannin Jr.", "team": "Bowling Green", "totals": {"games": 13, "rec": 117, "yards": 1555, "td": 10}},
        {"player": "Tanner Koziol", "team": "Ball St.", "totals": {"games": 12, "rec": 94, "yards": 839, "td": 8}},
        {"player": "Anthony Torres", "team": "Toledo", "totals": {"games": 13, "rec": 31, "yards": 404, "td": 9}},
        {"player": "Blake Bosma", "team": "Western Mich.", "totals": {"games": 12, "rec": 37, "yards": 403, "td": 6}},
        {"player": "Jacob Orlando", "team": "Buffalo", "totals": {"games": 12, "rec": 11, "yards": 101, "td": 2}},
    ],
    "2025": [
        {"player": "Jyrin Johnson", "team": "Bowling Green", "totals": {"games": 12, "rec": 37, "yards": 466, "td": 2}},
        {"player": "Joshua Long", "team": "Eastern Mich.", "totals": {"games": 12, "rec": 37, "yards": 357, "td": 3}},
        {"player": "Mason Williams", "team": "Ohio", "totals": {"games": 13, "rec": 26, "yards": 276, "td": 3}},
        {"player": "DeCorion Temple", "team": "Central Mich.", "totals": {"games": 12, "rec": 15, "yards": 131, "td": 2}},
        {"player": "Brian Shane", "team": "Miami (OH)", "totals": {"games": 14, "rec": 13, "yards": 116, "td": 2}},
    ],
    # No 2026 entry on purpose -- 2026 now pulls straight from real-stats.json (full MAC rosters, not a
    # national leaderboard), which already has every tight end with real production. See
    # mac_best_by_position.py's module docstring and fetch_season_from_real_stats.
}
# Same leaderboard-coverage gap as TE above, but narrower: CB 2023's *entire* raw candidate pool (from
# merging all five NCAA defensive leaderboards) is just 4 players -- nobody else tagged CB on a MAC team
# cracked any of them that season. Unlike TE, the other two CB seasons (2024: 6 candidates, 2025: 5) don't
# need this, so this only adds to 2023 rather than replacing the whole group the way TE_SUPPLEMENT does.
# Sourced from the MAC's own 2023 All-MAC team announcement (getsomemaction.com) plus the player's team
# reporting on his specific stat line that season.
CB_SUPPLEMENT = {
    "2023": [
        {"player": "Chris McDonald", "team": "Toledo", "totals": {"games": 12, "total": 34, "pbu": 8, "int": 2}},
    ],
    # No 2026 entry on purpose, same reason as TE_SUPPLEMENT above -- real-stats.json's MAC CB pool is a
    # full roster (dozens of corners), not the 2 the NCAA leaderboard carried.
}
HUDL_LINKS.update({
    "KURTIS ROURKE": "https://www.hudl.com/profile/5350951",
    "COLE SNYDER": "https://www.hudl.com/profile/9846654/Cole-Snyder",
    "JASE BAUER": "https://www.hudl.com/profile/8901906",
    "KADIN SEMONZA": "https://www.hudl.com/profile/11412934",
    "BRETT GABBERT": "https://www.hudl.com/profile/5629221",
    "DEQUAN FINN": "https://www.hudl.com/profile/5432884",
    "PENY BOONE": "https://www.hudl.com/profile/8007756/Peny-Boone",
})
HUDL_LINKS.update({
    "JALEN BUCKLEY": "https://www.hudl.com/profile/11214131/Jalen-Buckley",
    "ANTHONY TYUS III": "https://www.hudl.com/profile/9706872/Anthony-Tyus-III",
    "JORDAN GANT": "https://www.hudl.com/profile/11416944",
    "MARQUEZ COOPER": "https://www.hudl.com/profile/8152806",
    "TERION STEWART": "https://www.hudl.com/profile/8033536",
    "KAL-EL PASCAL": "https://www.hudl.com/profile/15335920/KalEl-Pascal",
})
HUDL_LINKS.update({
    "CHARLES MCCARTHERENS": "https://www.hudl.com/profile/12953144",
    "JERJUAN NEWTON": "https://www.hudl.com/profile/7594187",
    "JUNIOR VANDEROSS III": "https://www.hudl.com/profile/11292601",
    "CHASE HENDRICKS": "https://www.hudl.com/profile/13059623",
    "COLEMAN OWEN": "https://www.hudl.com/profile/5390873",
})
HUDL_LINKS.update({
    "MICHAEL HELDMAN": "https://www.hudl.com/profile/9702111",
    "SHAUN DOLAC": "https://www.hudl.com/profile/6316923/Shaun-Dolac/about",
    "RED MURDOCK": "https://www.hudl.com/video/3/9349397/606b230f420771195cea645e",
    "QUINYON MITCHELL": "https://www.hudl.com/video/3/7624493/5c40ce3c4797ed1060561168",
    "ELI BLAKEY": "https://www.hudl.com/profile/9739430/eli-blakey",
    "TATE HALLOCK": "https://www.hudl.com/profile/5409851",
    "SILAS WALTERS": "https://www.hudl.com/profile/8856518",
    "MARSHAWN KNEELAND": "https://www.hudl.com/profile/5587621",
})
HUDL_LINKS.update({
    "GAGE LARVADAIN": "https://www.hudl.com/profile/9382708/Gage-Larvadain/about",
    "REGGIE VIRGIL": "https://www.hudl.com/profile/10206377/Reginald-Virgil/highlights",
})
HUDL_LINKS.update({
    "BRADEN AWLS": "https://www.hudl.com/profile/14213226/Braden-Awls",
    "CJ NUNNALLY": "https://www.hudl.com/profile/10872962",
    "RILEY TOLSMA": "https://www.hudl.com/profile/9891992",
})
HUDL_LINKS.update({
    # Tight ends (TE_SUPPLEMENT roster, hand-verified against hometown/HS)
    "HAROLD FANNIN JR.": "https://www.hudl.com/profile/11087814",
    "ANTHONY TORRES": "http://www.hudl.com/profile/5006033",
    "MITCHEL COLLIER": "https://www.hudl.com/profile/7626285",
    "BLAKE BOSMA": "https://www.hudl.com/profile/15667208",
    "JYRIN JOHNSON": "https://www.hudl.com/profile/8257929/Jyrin-Johnson/highlights",
    "BRIAN SHANE": "https://www.hudl.com/profile/10529446",
    "JACOB ORLANDO": "https://www.hudl.com/profile/5636709",
    "TJ BANKS": "http://www.hudl.com/athlete/4121354/tj-banks",
})
HUDL_LINKS.update({
    "CAIDEN WOULLARD": "https://www.hudl.com/profile/9691288/Caiden-Woullard/about",
    "JUDGE CULPEPPER": "https://www.hudl.com/profile/4137781",
    "BRYCE SHEPPERT": "https://www.hudl.com/profile/5124830/Bryce-Sheppert/about",
    "NIK MCMILLAN": "https://www.hudl.com/profile/10811486",
})
HUDL_LINKS.update({
    "NATHAN VOORHIS": "https://www.hudl.com/profile/11220839/Nathan-Voorhis",
    "SIDNEY HOUSTON": "https://www.hudl.com/profile/8281342",
    "TY WISE": "https://www.hudl.com/profile/7673970",
})
HUDL_LINKS.update({
    "JORDAN OLADOKUN": "https://www.hudl.com/profile/11269460",
    "JARVARIUS SIMS": "https://www.hudl.com/profile/11281944",
    "JALEN MCCLENDON": "https://www.hudl.com/profile/10964406",
    "JOJO JOHNSON": "https://www.hudl.com/profile/9454727",
})
HUDL_LINKS.update({
    "KEYON MOZEE": "https://www.hudl.com/profile/7893734/Keyon-Mozee",
    "JADEN NIXON": "https://www.hudl.com/profile/10011114",
})
HUDL_LINKS.update({
    "CHASE KLINE": "https://www.hudl.com/profile/4712759/Chase-Kline/about",
    "KENNETH WOMACK": "https://www.hudl.com/profile/8356629",
    "ADRIAN NORTON": "https://www.hudl.com/profile/15134018",
})
HUDL_LINKS.update({
    "BILHAL KONE": "https://www.hudl.com/profile/8203660",
    "AVERY SMITH": "https://www.hudl.com/profile/13236427",
    "JORDAN KWIATKOWSKI": "https://www.hudl.com/profile/11394344/Jordan-Kwiatkowski/about",
    "MAXEN HOOK": "https://www.hudl.com/profile/4193936/Maxen-Hook/about",
    "NOAH KIM": "https://www.hudl.com/profile/8588249",
    "CHIP TRAYANUM": "https://www.hudl.com/profile/7855094",
})
HUDL_LINKS.update({
    "DECORION TEMPLE": "https://www.hudl.com/profile/13103203",
    "JOSHUA LONG": "https://www.hudl.com/profile/10307977",
    "TANNER KOZIOL": "https://www.hudl.com/profile/12822689/tanner-koziol",
    "VICTOR SNOW": "https://www.hudl.com/profile/11563026",
    "PEYTON PRICE": "https://www.hudl.com/profile/9298091",
})
HUDL_LINKS.update({
    "JALEN HUSKEY": "https://www.hudl.com/profile/11389555",
    "KAY'RON LYNCH-ADAMS": "https://www.hudl.com/profile/8748432",
    "DONTAE MCMILLAN": "https://www.hudl.com/profile/9847731",
    "RAION STRADER": "https://www.hudl.com/profile/15490539",
})
HUDL_LINKS.update({
    "BRYCE LLEWELLYN": "https://www.hudl.com/profile/17498941/bryce-llewellyn",
    "JACKSON KUWATCH": "https://www.hudl.com/profile/13109292/Jackson-Kuwatch",
    "JOSEPH SIPP JR.": "https://hudl.com/v/2FsWDU",
    "DONOVAN GREEN": "https://www.hudl.com/profile/15240510/donovan-green",
    "BRYCE HOUSTON": "https://www.hudl.com/profile/4012020/Bryce-Houston",
})
HUDL_LINKS.update({
    "AARON WOFFORD": "https://www.hudl.com/profile/19482468/aaron-wofford",
    "DARRIAN LEWIS": "https://www.hudl.com/profile/11011761",
    "BRYAN MCCOY": "https://www.hudl.com/profile/11229287",
})
HUDL_LINKS.update({
    "JOE SPARACIO": "https://www.hudl.com:443/profile/6265342/joseph-sparacio",
})

# PFF (Pro Football Focus) grade/report links, same idea as HUDL_LINKS above -- starts empty. PFF's
# college pages sit behind a login for most content, so these are meant to be hand-pasted from the
# Studies page (admins only) rather than bulk web-searched the way the Hudl links were.
PFF_LINKS = {}
HUDL_LINKS.update({
    "ANTHONY SIMPSON": "https://www.hudl.com/profile/8230503",
    "BROC LOWRY": "https://www.hudl.com/profile/12907414/Broc-Lowry/about",
    "GIDEON LAMPRON": "https://www.hudl.com/profile/11293236",
})
HUDL_LINKS.update({
    "MATT SALOPEK": "https://www.hudl.com/profile/6036828/Matt-Salopek",
    "PAUL LEWIS III": "https://www.hudl.com/video/3/6079625/5721d65764e96b63802202c3",
})
HUDL_LINKS.update({
    "RODNEY MCGRAW": "https://www.hudl.com/profile/11173598/Rodney-McGraw/videos",
})
HUDL_LINKS.update({
    "ADAM TRICK": "https://www.hudl.com/profile/11351013",
    "MASON WILLIAMS": "https://www.hudl.com/profile/12957817",
    "MJ CANNON": "https://www.hudl.com/profile/13071182",
})
HUDL_LINKS.update({
    "WILLIAM WATSON III": "https://www.hudl.com/profile/1161621",
    "MARQUES WHITE": "https://www.hudl.com/profile/7474318/Marques-White",
    "KOBE STEWART": "https://www.hudl.com/profile/11007547",
    "SAVEON BROWN": "https://www.hudl.com/profile/11179653/Saveon-Brown",
    "JUSTIN TAYLOR": "https://www.hudl.com/profile/696595",
})
HUDL_LINKS.update({
    # 2026 TE/CB research (see TE_SUPPLEMENT/CB_SUPPLEMENT above). Jordan Williams, Elijah Alexander,
    # Isaiah Reed and Cam Jones searched multiple times with no reliable match (common names, or a
    # transfer history across too many schools to confirm) -- left blank, same as the earlier stalled list.
    "ELI JACON-DUFFY": "https://www.hudl.com/profile/14831453",
    "JEREMIAH SCOBY": "https://www.hudl.com/profile/16657982/jeremiah-scoby",
    "DIONTE THORNTON": "https://www.hudl.com/profile/4436431/dionte-thornton",
    "KOBI BLACKWELL": "https://www.hudl.com/profile/1476743/Kobi-Blackwell/about",
    "KENDALL BANNISTER": "https://www.hudl.com/profile/15729844",
    "CAIDEN NEWSOME": "https://www.hudl.com/profile/20427970/caiden-newsome",
})
