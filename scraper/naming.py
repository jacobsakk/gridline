"""
Name normalization shared by the scrapers -- a Python port of teamKey() /
nameKey() in frontend/src/collegeData.js, so the scraper and the site agree
on which team spellings ("Penn St.", "Penn State", "Penn State University")
and player spellings ("Reginald Vick, Jr." / "Jr.,Reginald Vick") are the
same thing. Keep the two in step when adding an alias.
"""

import re
import unicodedata

ABBREVIATIONS = [
    ("st", "state"),
    ("mich", "michigan"),
    ("fla", "florida"),
    ("ga", "georgia"),
    ("carolina", "carolina"),
    ("n", "north"),
    ("s", "south"),
    ("e", "eastern"),
    ("w", "western"),
    ("ill", "illinois"),
    ("ken", "kentucky"),
    ("miss", "mississippi"),
    ("tenn", "tennessee"),
    ("ala", "alabama"),
    ("mass", "massachusetts"),
    ("conn", "connecticut"),
    ("wash", "washington"),
    ("ark", "arkansas"),
    ("ind", "indiana"),
    ("nev", "nevada"),
    ("okla", "oklahoma"),
    ("nw", "northwestern"),
    ("ky", "kentucky"),
    ("mo", "missouri"),
    ("ariz", "arizona"),
    ("colo", "colorado"),
    ("conn", "connecticut"),
]

ALIASES = {
    "app state": "appalachian state",
    "uconn": "connecticut",
    "umass": "massachusetts",
    "ole miss": "mississippi",
    "fiu": "florida international",
    "pitt": "pittsburgh",
    "usf": "south florida",
    "sac state": "sacramento state",
    "california state university sacramento": "sacramento state",
    "miami": "miami florida",
    "miami fl": "miami florida",
    "miami university oh": "miami ohio",
    "miami oh": "miami ohio",
    "army west point": "army",
    "unc": "north carolina",
    "southern miss": "southern mississippi",
    "san jose st": "san jose state",
    "louisiana lafayette": "louisiana",
    "ul monroe": "louisiana monroe",
    "utsa": "texas san antonio",
    "utep": "texas el paso",
    "nc state": "north carolina state",
    "north carolina at charlotte": "charlotte",
    "university at buffalo": "buffalo",
    "university at albany sunyc": "albany",
    "university at albany suny": "albany",
    "university of hawaii": "hawaii",
    "hawai i": "hawaii",
    "southern california": "usc",
    "wku": "western kentucky",
    "ulm": "louisiana monroe",
    "niu": "northern illinois",
    "unt": "north texas",
    "mtsu": "middle tennessee",
    "nm state": "new mexico state",
    "jax state": "jacksonville state",
    "ndsu": "north dakota state",
    "alcorn": "alcorn state",
    "uni": "northern iowa",
    "uiw": "incarnate word",
    "etsu": "east tennessee state",
    "sfa": "stephen f austin",
    "liu": "long island",
    "prairie view": "prairie view a and m",
    "utrgv": "ut rio grande valley",
    "southeastern la": "se louisiana",
    "western caro": "western carolina",
    "southern u": "southern",
    "mississippi val": "mississippi valley state",
    "charleston so": "charleston southern",
    "central connecticut state": "central connecticut",
    "state thomas mn": "state thomas",
    "grambling state": "grambling",
    "hcu": "houston christian",
    "air force academy": "air force",
    "california polytechnic state": "cal poly",
    "california state sacramento": "sacramento state",
    "indiana bloomington": "indiana",
    "middle tennessee state": "middle tennessee",
    "monmouth nj": "monmouth",
    "nicholls state": "nicholls",
    "sam houston state": "sam houston",
    "southern illinois carbondale": "southern illinois",
    "stephen f austin state": "stephen f austin",
    "north carolina a and t state": "north carolina a and t",
    "california berkeley": "california",
    "north carolina charlotte": "charlotte",
    "tennessee chattanooga": "chattanooga",
    "tennessee martin": "ut martin",
    "virginia military institute": "vmi",
    "austin peay state": "austin peay",
    "lindenwood missouri": "lindenwood",
    "robert morris pa": "robert morris",
    "california davis": "uc davis",
    "albany suny": "ualbany",
    "penn": "pennsylvania",
}



def _strip_accents(text):
    return "".join(c for c in unicodedata.normalize("NFD", text or "") if not unicodedata.combining(c))


def team_key(name):
    n = _strip_accents(name).lower()
    n = re.sub(r"\bn\.?c\.?\s", "north carolina ", n)
    n = n.replace("&", " and ")
    n = re.sub(r"['\u2019.]", " ", n)
    n = re.sub(r"[^a-z ]", " ", n)
    n = re.sub(r"\b(the|university|of|at|college)\b", " ", n)
    n = re.sub(r"\s+", " ", n).strip()
    for abbreviation, full in ABBREVIATIONS:
        n = re.sub(rf"\b{abbreviation}\b", full, n)
    n = re.sub(r"\bstate state\b", "state", n)
    n = re.sub(r"\s+", " ", n).strip()
    if n in ("miami", "miami fl"):
        return "miami florida"
    return ALIASES.get(n, n)


def name_key(name):
    """Bare lowercase words: nicknames in quotes/parentheses dropped, commas
    treated as breaks, periods/apostrophes/hyphens removed, suffixes removed."""
    n = _strip_accents(name).lower()
    n = re.sub(r'["\u201c\u201d][^"\u201c\u201d]*["\u201c\u201d]', " ", n)
    n = re.sub(r"\([^)]*\)", " ", n)
    n = n.replace(",", " ")
    n = re.sub(r"[.'\u2019\u2018`-]", "", n)
    n = re.sub(r"[^a-z ]", " ", n)
    n = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", " ", n)
    return re.sub(r"\s+", " ", n).strip()


def compact_name(name):
    return name_key(name).replace(" ", "")


NICKNAMES = {"ike": "isaac", "bo": "beau", "jon": "jonathan", "zach": "zachary"}


def first_names_match(a, b):
    """Same person's first name: identical, a prefix of the other (Sam/Samuel),
    a tail of it (Quan/Jiquan), or a known nickname pair."""
    if a == b:
        return True
    short, long = (a, b) if len(a) <= len(b) else (b, a)
    if len(short) >= 3 and long.startswith(short):
        return True
    if len(short) >= 4 and long.endswith(short):
        return True
    return NICKNAMES.get(short) == long


def _numeral(name):
    """The generational numeral in a name ("II", "III", "IV", "V"), if any."""
    m = re.search(r"\b(ii|iii|iv|v)\b", _strip_accents(name).lower())
    return m.group(1) if m else None


def same_person_name(a, b):
    """Names that could be one player: same compact key, or same last name with
    compatible first names."""
    na, nb = _numeral(a), _numeral(b)
    if na and nb and na != nb:
        return False  # Frank Williams IV and Frank Williams V are different people
    ka, kb = name_key(a), name_key(b)
    if ka.replace(" ", "") == kb.replace(" ", ""):
        return True
    wa, wb = ka.split(), kb.split()
    if not wa or not wb:
        return False
    return wa[-1] == wb[-1] and first_names_match(wa[0], wb[0])
