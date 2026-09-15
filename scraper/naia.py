"""
Fetches real NAIA individual stat leaders from naiastats.prestosports.com and
normalizes them into Gridline's row shape -- the same shape ncaa_api.py
produces, so this reuses ncaa_api's snapshot/delta machinery unchanged.

Unlike the NCAA API (a clean JSON wrapper), NAIA's site is protected by a
Cloudflare JS challenge that blocks plain HTTP requests -- confirmed
directly (`curl` gets a "Just a moment..." page, HTTP 403). A real browser
(Playwright) renders through it fine, and once past it, every player's
full stat line for every category (offense AND defense) is already sitting
in the page's DataTables data store as one rich object per player -- no
separate requests needed per category. See the module-level NOTES below
for how that was found and verified.

NOTES on how this was investigated (kept for the next person to touch this):
- naiastats.prestosports.com is the same PrestoSports platform as the JUCO
  conferences, but is one *national* site (not per-conference) with a
  conference filter built in.
- `window.jQuery('#stats-table-...').DataTable().data().toArray()` returns
  every player already loaded client-side (not just the visible page of
  the table), each with a `.stats` object keyed by short codes (pa/pc/pyd
  for passing, dtu/dta/dtt for tackles, etc). These were verified against
  real rendered numbers, not guessed -- e.g. Brayden Hamby (Wayland
  Baptist) rendered as SOLO 15/AST 24/TOTAL 39/TFL 1.5/TFL-YDS 11/SACK
  0.0/SACK-YDS 0/QBH 0, which matched dtu=15, dta=24, dtt=39.0, tfl=1.5,
  tfly=11, dso=0.0, dsyd=0, qbh=0 exactly.
- The `conference` field on a player object is null on the "All
  Conferences" view for most players, so conference tagging comes from
  fetching each of NAIA's 13 conference-filtered pages separately
  (authoritative, no external mapping needed -- their own site does the
  filtering for us).
"""

import re

from ncaa_api import normalize_position as _normalize_position_base

BASE_URL = "https://naiastats.prestosports.com"
SEASON = "2026-27"

# Captured verbatim from the site's own conference dropdown -- case in the
# path (Conf vs conf) is inconsistent across conferences and matters.
CONFERENCE_PATHS = {
    "Appalachian Athletic Conference": f"/sports/fball/{SEASON}/Conf/Appalachian/Players?jsRendering=true",
    "Frontier - East": f"/sports/fball/{SEASON}/Conf/Frontier_-_East/Players?jsRendering=true",
    "Frontier - West": f"/sports/fball/{SEASON}/conf/Frontier_-_West/Players?jsRendering=true",
    "Great Plains Athletic Conference": f"/sports/fball/{SEASON}/conf/Great_Plains/Players?jsRendering=true",
    "Heart of America - North": f"/sports/fball/{SEASON}/conf/Heart_of_America_-_North/Players?jsRendering=true",
    "Heart of America - South": f"/sports/fball/{SEASON}/Conf/Heart_of_America_-_South/Players?jsRendering=true",
    "KCAC - Bissell": f"/sports/fball/{SEASON}/conf/KCAC_-_Bissell/Players?jsRendering=true",
    "KCAC - Kessinger": f"/sports/fball/{SEASON}/conf/KCAC_-_Kessinger/Players?jsRendering=true",
    "Mid-South Conference": f"/sports/fball/{SEASON}/conf/Mid-South/Players?jsRendering=true",
    "Mid-States Mideast": f"/sports/fball/{SEASON}/conf/Mid-States_Mideast/Players?jsRendering=true",
    "Mid-States Midwest": f"/sports/fball/{SEASON}/Conf/Mid-States_Midwest/Players?jsRendering=true",
    "Sooner Athletic Conference": f"/sports/fball/{SEASON}/Conf/Sooner/Players?jsRendering=true",
    "The Sun Conference": f"/sports/fball/{SEASON}/conf/The_Sun/Players?jsRendering=true",
}

# The tables whose DataTables data store we pull from. Each player object
# already carries every stat field regardless of which table it came from,
# so this list just needs enough tables to cover everyone who plays any of
# offense or defense -- unioned by playerId below.
TABLE_IDS = [
    "stats-table-Offense-cat1-overall",  # Passing
    "stats-table-Offense-cat2-overall",  # Rushing
    "stats-table-Offense-cat3-overall",  # Receiving
    "stats-table-Defense-cat11-overall",  # Tackles
    "stats-table-Defense-cat12-overall",  # Pass Defense & Turnovers
]

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


def normalize_position(raw_position):
    """NAIA sometimes gives combo positions like 'QB/TE' or 'K/P', and blank
    strings -- take the first slot and defer to the shared canonical map."""
    first = (raw_position or "").split("/")[0].strip()
    return _normalize_position_base(first)


def _to_int(value, default=0):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def fetch_conference_players(page, conf_path):
    """Navigates to one conference's Players page and returns every player
    object, unioned by playerId across the tables in TABLE_IDS."""
    url = f"{BASE_URL}{conf_path}"

    ready = False
    for attempt in range(4):
        try:
            page.goto(url, timeout=45000, wait_until="domcontentloaded")
            page.wait_for_function(
                "window.jQuery && window.jQuery.fn.DataTable && "
                f"window.jQuery.fn.DataTable.isDataTable('#{TABLE_IDS[0]}')",
                timeout=20000,
            )
            ready = True
            break
        except Exception:
            page.wait_for_timeout(3000 * (attempt + 1))
    if not ready:
        raise RuntimeError(f"NAIA DataTable never became ready for {conf_path}")

    table_ids_js = ", ".join(f"'{t}'" for t in TABLE_IDS)
    players = page.evaluate(f"""
        () => {{
            const tableIds = [{table_ids_js}];
            const byId = {{}};
            for (const id of tableIds) {{
                const el = document.getElementById(id);
                if (!el) continue;
                const $t = window.jQuery(el);
                if (!window.jQuery.fn.DataTable.isDataTable($t)) continue;
                const rows = $t.DataTable().data().toArray();
                for (const r of rows) {{
                    if (!byId[r.playerId]) byId[r.playerId] = r;
                }}
            }}
            return Object.values(byId);
        }}
    """)
    return players


def transform_player(raw, conference, row_id_prefix):
    """Splits one NAIA player object into 0-4 Gridline rows (passing/
    rushing/receiving/tackling), skipping any category the player has no
    real involvement in -- same convention as the NCAA data."""
    s = raw.get("stats") or {}
    position = normalize_position(raw.get("position"))
    games = _to_int(s.get("gp"))
    base = {
        "division": "NAIA",
        "week": "total",
        "position": position,
        "player": raw.get("fullName", ""),
        "team": raw.get("team", ""),
        "conference": conference,
        "games": games,
        "sample": False,
    }

    rows = []

    pa = _to_int(s.get("pa"))
    if pa > 0:
        rows.append({
            **base,
            "id": f"{row_id_prefix}-passing",
            "category": "passing",
            "compAtt": f"{_to_int(s.get('pc'))}/{pa}",
            "att": pa,
            "yards": _to_int(s.get("pyd")),
            "td": _to_int(s.get("ptd")),
            "int": _to_int(s.get("pin")),
            "rating": s.get("peff", "0.0"),
        })

    rat = _to_int(s.get("rat"))
    if rat > 0:
        rows.append({
            **base,
            "id": f"{row_id_prefix}-rushing",
            "category": "rushing",
            "att": rat,
            "yards": _to_int(s.get("ryd")),
            "td": _to_int(s.get("rtd")),
            "avg": s.get("rya", "0.0"),
        })

    wat = _to_int(s.get("wat"))
    if wat > 0:
        rows.append({
            **base,
            "id": f"{row_id_prefix}-receiving",
            "category": "receiving",
            "rec": wat,
            "yards": _to_int(s.get("wyd")),
            "td": _to_int(s.get("wtd")),
            "avg": s.get("wya", "0.0"),
        })

    solo = _to_int(s.get("dtu"))
    ast = _to_int(s.get("dta"))
    tfl = float(s.get("tfl") or 0)
    sacks = float(s.get("dso") or 0)
    ints = _to_int(s.get("di"))
    pbu = _to_int(s.get("dbru"))
    if solo or ast or tfl or sacks or ints or pbu:
        rows.append({
            **base,
            "id": f"{row_id_prefix}-tackling",
            "category": "tackling",
            "solo": solo,
            "ast": ast,
            "total": solo + ast,
            "tfl": s.get("tfl", "0.0"),
            "pbu": pbu,
            "int": ints,
            "soloSacks": _to_int(s.get("dsu")),
            "astSacks": _to_int(s.get("dsa")),
            "sackYds": _to_int(s.get("dsyd")),
            "sacks": s.get("dso", "0.0"),
        })

    return rows


def build_naia_rows(page):
    """Fetches every NAIA conference and returns the full row list."""
    all_rows = []
    for conf_name, conf_path in CONFERENCE_PATHS.items():
        players = fetch_conference_players(page, conf_path)
        for p in players:
            slug = re.sub(r"[^a-z0-9]+", "-", conf_name.lower()).strip("-")
            row_id_prefix = f"real-naia-{slug}-{p.get('playerId', '')}"
            all_rows.extend(transform_player(p, conf_name, row_id_prefix))
    return all_rows
