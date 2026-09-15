"""
Fetches real CCCAA (3C2A -- California JUCO) individual stat leaders from
cccaa.prestosports.com and normalizes them into Gridline's row shape.
Same platform and same underlying data model as naia.py (confirmed
directly: identical `stats` object field abbreviations -- pa/pc/pyd for
passing, dtu/dta/dtt/tfl/dso/di/dbru for defense, etc.), with two
differences that make this simpler than NAIA:

1. `conference` is reliably populated per player on this site's "all
   players" view (confirmed: 0 nulls across a 181-player sample) --
   unlike NAIA, where it was null for most players. So there's no need
   to loop over each conference's own URL; one fetch per stat category
   covers everyone, already correctly tagged.
2. All 4 categories' tables (`stats-table-Season-{qb,rb,wr,d}-overall`)
   live on the SAME page regardless of which one you load, exactly like
   NAIA -- so this is really just one page load total.

Still needs Playwright: confirmed directly that a plain HTTP request to
this domain gets HTTP 403 (same PrestoSports Cloudflare protection as
NAIA); a real browser clears it fine.

3c2asports.org is the public-facing alias; cccaa.prestosports.com is the
canonical PrestoSports domain (confirmed via the site's own canonical
link tag) and is used directly here.
"""

from ncaa_api import normalize_position as _normalize_position_base

BASE_URL = "https://cccaa.prestosports.com"
SEASON = "2026-27"
PLAYERS_URL = f"{BASE_URL}/sports/fball/{SEASON}/players?sort=pyd&pos=qb"

TABLE_IDS = [
    "stats-table-Season-qb-overall",
    "stats-table-Season-rb-overall",
    "stats-table-Season-wr-overall",
    "stats-table-Season-d-overall",
]

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


def normalize_position(raw_position):
    first = (raw_position or "").split("/")[0].strip()
    return _normalize_position_base(first)


def _to_int(value, default=0):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def fetch_all_players(page):
    """Loads the one page that has every category's DataTable already
    populated client-side, and unions all 4 tables' rows by playerId."""
    ready = False
    for attempt in range(4):
        try:
            page.goto(PLAYERS_URL, timeout=45000, wait_until="domcontentloaded")
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
        raise RuntimeError("CCCAA DataTable never became ready")

    table_ids_js = ", ".join(f"'{t}'" for t in TABLE_IDS)
    return page.evaluate(f"""
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


def transform_player(raw, row_id_prefix):
    """Splits one CCCAA player object into 0-4 Gridline rows (passing/
    rushing/receiving/tackling) -- same convention as naia.py."""
    s = raw.get("stats") or {}
    position = normalize_position(raw.get("position"))
    games = _to_int(s.get("gp"))
    base = {
        "division": "JUCO",
        "week": "total",
        "position": position,
        "player": raw.get("fullName", ""),
        "team": raw.get("team", ""),
        # CCCAA has its own internal sub-conferences (e.g. "American - Golden
        # Coast", "National - Valley") but the other 3 JUCO conferences each
        # show as one filter value -- tagging everyone "CCCAA" keeps the
        # Conference filter consistent across JUCO instead of suddenly
        # fragmenting into 11 sub-options for just this one conference.
        "conference": "CCCAA",
        "games": games,
        "sample": False,
        # pageName is the exact relative path this PrestoSports site's own
        # UI links to for this player's profile -- same field, confirmed
        # directly the same way as naia.py (Zennon Alo-Rosa).
        "profileUrl": f"{BASE_URL}{raw.get('pageName')}" if raw.get("pageName") else "",
    }

    rows = []

    pa = _to_int(s.get("pa"))
    if pa > 0:
        rows.append({
            **base, "id": f"{row_id_prefix}-passing", "category": "passing",
            "compAtt": f"{_to_int(s.get('pc'))}/{pa}", "att": pa,
            "yards": _to_int(s.get("pyd")), "td": _to_int(s.get("ptd")),
            "int": _to_int(s.get("pin")), "rating": s.get("peff", "0.0"),
        })

    rat = _to_int(s.get("rat"))
    if rat > 0:
        rows.append({
            **base, "id": f"{row_id_prefix}-rushing", "category": "rushing",
            "att": rat, "yards": _to_int(s.get("ryd")),
            "td": _to_int(s.get("rtd")), "avg": s.get("rya", "0.0"),
        })

    wat = _to_int(s.get("wat"))
    if wat > 0:
        rows.append({
            **base, "id": f"{row_id_prefix}-receiving", "category": "receiving",
            "rec": wat, "yards": _to_int(s.get("wyd")),
            "td": _to_int(s.get("wtd")), "avg": s.get("wya", "0.0"),
        })

    solo = _to_int(s.get("dtu"))
    ast = _to_int(s.get("dta"))
    tfl = float(s.get("tfl") or 0)
    # Confirmed directly: CCCAA's total-sacks key is "dst", not "dso" like
    # NAIA -- same platform, different key name for this one field (dsu/
    # dsa/dsyd for solo/assisted/yards match NAIA's convention exactly).
    sacks = float(s.get("dst") or 0)
    ints = _to_int(s.get("di"))
    pbu = _to_int(s.get("dbru"))
    if solo or ast or tfl or sacks or ints or pbu:
        rows.append({
            **base, "id": f"{row_id_prefix}-tackling", "category": "tackling",
            "solo": solo, "ast": ast, "total": solo + ast,
            "tfl": s.get("tfl", "0.0"), "pbu": pbu, "int": ints,
            "soloSacks": _to_int(s.get("dsu")), "astSacks": _to_int(s.get("dsa")),
            "sackYds": _to_int(s.get("dsyd")), "sacks": s.get("dst", "0.0"),
        })

    return rows


def build_cccaa_rows(page):
    players = fetch_all_players(page)
    all_rows = []
    for p in players:
        row_id_prefix = f"real-cccaa-{p.get('playerId', '')}"
        all_rows.extend(transform_player(p, row_id_prefix))
    return all_rows
