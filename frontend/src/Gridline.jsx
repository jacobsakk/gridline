import { confirmAction } from "./ConfirmDialog.jsx";
import { useState, useMemo, useEffect, useRef, useCallback, Fragment } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown, Crown, BadgeCheck, FlaskConical, Star, X, Plus, ExternalLink, Search, Download, Columns3, TrendingUp, GripVertical, CheckCircle2, AlertTriangle, ArrowLeft, Upload } from "lucide-react";
import { collection, doc, addDoc, updateDoc, onSnapshot, query, orderBy } from "firebase/firestore";
import { db } from "./firebase";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { REAL_STATS, loadRealStats } from "./statsData.js";
import { ThemeSwitcher, useTheme } from "./theme.jsx";
import StatsUploadModal from "./StatsUploadModal.jsx";
import { loadUploads } from "./statsUpload.js";
import cmuHelmet from "./assets/cmu-helmet.png";
import { canonicalSchool } from "./schoolNames.js";

const DIVISIONS = ["NAIA", "JUCO", "D3", "D2", "FCS", "FBS"];

// Same canonical set every scraper normalizes to (see POSITION_MAP in
// scraper/ncaa_api.py) -- the watch list groups by these.
const WATCH_POSITIONS = ["ATH", "QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "SAF", "K", "P", "LS"];

// "total" = season-to-date. Single-week rows (if any exist yet) are keyed
// by the ISO date the snapshot was taken -- see scraper/build_data.py. A
// real single week only appears once a division's scraper has run at
// least twice, so the dropdown may just show "Total (season)" for a
// while; that's expected, not a bug.
function weekLabel(w) {
  if (w === "total") return "Total (season)";
  const d = new Date(`${w}T00:00:00`);
  return Number.isNaN(d.getTime()) ? String(w) : `Week of ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

// A generic web search works for every division (D2/FCS have no player
// bio pages to link to at all -- confirmed, the NCAA API returns no id or
// link field), unlike a scraped profile URL which only NAIA/JUCO/CCCAA have.
function playerSearchUrl(player, team, position) {
  const q = [player, team, position, "football"].filter(Boolean).join(" ");
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

// Sort keys that need alphabetical (not numeric) comparison, and default
// to ascending on first click rather than the stat columns' descending.
const STRING_SORT_KEYS = new Set(["team", "conference"]);

// leaderKey = the stat used to rank "leader" for this category
const CATEGORIES = {
  passing: {
    label: "Passing",
    positions: ["QB"],
    leaderKey: "yards",
    columns: [
      { key: "games", label: "G" },
      { key: "compAtt", label: "C/ATT", sortKey: "att" },
      { key: "pct", label: "PCT" },
      { key: "yards", label: "YDS" },
      { key: "td", label: "TD" },
      { key: "int", label: "INT" },
      { key: "rating", label: "RTG" },
    ],
  },
  rushing: {
    label: "Rushing",
    positions: ["RB", "QB"],
    leaderKey: "yards",
    columns: [
      { key: "games", label: "G" },
      { key: "att", label: "ATT" },
      { key: "yards", label: "YDS" },
      { key: "avg", label: "AVG" },
      { key: "td", label: "TD" },
    ],
  },
  receiving: {
    label: "Receiving",
    positions: ["WR", "TE", "RB"],
    leaderKey: "yards",
    columns: [
      { key: "games", label: "G" },
      { key: "rec", label: "REC" },
      { key: "yards", label: "YDS" },
      { key: "avg", label: "AVG" },
      { key: "td", label: "TD" },
    ],
  },
  // "Defense" merges five separate real leaderboards (total tackles, TFL,
  // passes defended, interceptions, sacks) into one row per player -- see
  // build_defense_rows() in scraper/ncaa_api.py. A player who's on one
  // leaderboard but not another shows 0 for that stat rather than an
  // unknown/blank value -- a best-effort tradeoff, not a guess.
  tackling: {
    label: "Defense",
    positions: ["LB", "CB", "SAF", "DL"],
    leaderKey: "total",
    columns: [
      { key: "games", label: "G" },
      { key: "solo", label: "SOLO" },
      { key: "ast", label: "AST" },
      { key: "total", label: "TOT" },
      { key: "tfl", label: "TFL" },
      { key: "pbu", label: "PBU" },
      { key: "int", label: "INT" },
      { key: "sacks", label: "SACK" },
      { key: "sackYds", label: "SACK YDS" },
    ],
  },
};

// Extra "leader of the season" callouts shown at the top, beyond the one
// per stat category above -- each points at a category but ranks by a
// different column (e.g. Sacks and Interceptions both live inside the
// Defense table, but are common enough to deserve their own spotlight).
const LEADER_BOARDS = [
  { key: "passing", categoryKey: "passing", label: "Passing", sortKey: "yards" },
  { key: "rushing", categoryKey: "rushing", label: "Rushing", sortKey: "yards" },
  { key: "receiving", categoryKey: "receiving", label: "Receiving", sortKey: "yards" },
  { key: "tackling", categoryKey: "tackling", label: "Defense", sortKey: "total" },
  { key: "sacks", categoryKey: "tackling", label: "Sacks", sortKey: "sacks" },
  { key: "interceptions", categoryKey: "tackling", label: "Interceptions", sortKey: "int" },
];

export const DATA = REAL_STATS; // filled in when the stats load (see loadRealStats)

// Rows someone uploaded by hand (see statsUpload.js) replace the scraped season totals for that division and stat
// category. DATA is rebuilt from the untouched bundle each time, so removing an upload restores the scraped rows.
const BUNDLED = [];
let bundledReady = false;
// Run once, right after the stats load. None of the sources sends completion % directly -- they all report a
// "comp/att" string (compAtt) plus season totals -- so it's derived here rather than in every scraper.
function prepareBundled() {
  if (bundledReady) return;
  for (const r of DATA) {
    if (r.category === "passing" && r.compAtt) {
      const [comp, att] = r.compAtt.split("/").map(Number);
      r.pct = att > 0 ? `${((comp / att) * 100).toFixed(1)}%` : "0.0%";
    }
  }
  BUNDLED.push(...DATA);
  bundledReady = true;
}
export function applyUploads(uploads) {
  DATA.length = 0;
  DATA.push(...BUNDLED);
  uploads.forEach((u) => {
    for (let i = DATA.length - 1; i >= 0; i--) {
      const r = DATA[i];
      if (r.division === u.division && r.category === u.category && r.week === "total") DATA.splice(i, 1);
    }
    u.rows.forEach((r) => {
      if (r.category === "passing" && r.compAtt) {
        const [comp, att] = r.compAtt.split("/").map(Number);
        r.pct = att > 0 ? `${((comp / att) * 100).toFixed(1)}%` : "0.0%";
      }
      DATA.push(r);
    });
  });
}

const DIVISION_LABEL = { NAIA: "NAIA", JUCO: "Junior College", D2: "NCAA Division II", D3: "NCAA Division III", FCS: "FCS", FBS: "FBS" };
const LIVE_DIVISIONS = new Set(["NAIA", "JUCO", "D2", "D3", "FCS", "FBS"]); // all six are real data now

// A cheap fingerprint of everything real-stats.json currently says about
// one player -- not a hash, just a stable string that changes whenever
// their numbers do. Used to flag "this watch-listed player's stats
// changed since you last opened their card" without storing a full copy
// of their stats anywhere.
function playerStatsSignature(player, team) {
  const rows = DATA.filter((r) => r.player === player && r.team === team);
  return rows
    .map((r) => `${r.id}:${r.yards ?? ""}:${r.td ?? ""}:${r.att ?? ""}:${r.rec ?? ""}:${r.total ?? ""}:${r.sacks ?? ""}:${r.int ?? ""}`)
    .sort()
    .join("|");
}

function conferencesFor(division) {
  return [...new Set(DATA.filter((r) => r.division === division).map((r) => r.conference))].sort();
}

function positionsFor(division, category) {
  return [...new Set(DATA.filter((r) => r.division === division && r.category === category).map((r) => r.position))].sort();
}

// Which weeks actually have data for this division. JUCO's sample data
// always has weeks 1-4; D2/FCS only gain a real single-week entry once the
// scraper has run at least twice (see scraper/build_data.py) -- until then
// this returns just ["total"], which is expected, not a bug.
function weeksFor(division) {
  const real = [...new Set(DATA.filter((r) => r.division === division && r.week !== "total").map((r) => r.week))];
  real.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return ["total", ...real];
}

// ---------- Watch list ----------
// Shared, persistent list backed by the Claude Artifact "db" capability --
// every viewer with access reads and writes the same "watchlist"
// collection, live. Unavailable outside the published artifact (e.g. local
// dev, or a plain saved copy of the page) -- window.claude.use simply
// isn't present there, so this degrades to "feature hidden" rather than
// erroring.

export function useWatchlist() {
  // Every doc ever added, including ones the owner has since "removed" --
  // those just get removed:true rather than actually deleted, so their
  // notes/hometown/eligibility/filmLink survive and come back automatically
  // if the same player (by name+team) is ever added again.
  const [allDocs, setAllDocs] = useState([]);
  // Firestore's onSnapshot fires once immediately (from cache or server)
  // even on a fresh page, so "we've heard back at least once" is a clean
  // proxy for "ready" -- no separate availability probe needed the way
  // window.claude.use() required one.
  const [ready, setReady] = useState(false);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "watchlist"), orderBy("player", "asc"));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setAllDocs(snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })));
        setReady(true);
      },
      () => {
        // Rules/network problem -- surface as unavailable rather than an
        // infinite loading state.
        setAvailable(false);
        setReady(true);
      }
    );
    return unsubscribe;
  }, []);

  const players = useMemo(() => allDocs.filter((p) => !p.removed), [allDocs]);

  async function addPlayer({ player, team, division, position }) {
    const trimmedPlayer = player.trim();
    if (!trimmedPlayer) return;
    const trimmedTeam = (team || "").trim();

    // If this exact player was removed before, bring their doc back
    // instead of creating a fresh blank one -- their old notes etc. are
    // still sitting on it untouched.
    const archived = allDocs.find((p) => p.removed && p.player === trimmedPlayer && p.team === trimmedTeam);
    if (archived) {
      await updateDoc(doc(db, "watchlist", archived.id), {
        removed: false,
        division: division || archived.division || "",
        position: position || archived.position || "",
      });
      return;
    }

    await addDoc(collection(db, "watchlist"), {
      player: trimmedPlayer,
      team: trimmedTeam,
      division: division || "",
      position: position || "",
      pipelined: false,
      notes: "",
      hometown: "",
      height: "",
      weight: "",
      eligibility: "",
      xLink: "",
      filmLink: "",
      lastSeenSnapshot: "",
      sortOrder: Date.now(),
      removed: false,
      addedAt: new Date().toISOString(),
    });
  }

  async function removePlayer(id) {
    await updateDoc(doc(db, "watchlist", id), { removed: true, removedAt: new Date().toISOString() });
  }

  async function updateField(id, field, value) {
    await updateDoc(doc(db, "watchlist", id), { [field]: value });
  }

  const watchedKeys = useMemo(() => new Set(players.map((p) => `${p.player}::${p.team}`)), [players]);
  function isWatched(player, team) {
    return watchedKeys.has(`${player}::${team}`);
  }

  async function markSeen(id, player, team) {
    await updateDoc(doc(db, "watchlist", id), { lastSeenSnapshot: playerStatsSignature(player, team) });
  }

  return { available, checkedAvailability: ready, players, addPlayer, removePlayer, updateField, markSeen, isWatched };
}

// Separate from the watch list on purpose -- "entered the portal" is
// something worth flagging for any player in the whole dataset, not
// just the handful someone has explicitly added to their watch list, so
// it's its own tiny collection keyed by player+team rather than a field
// on a watchlist doc.
export function usePortalStatus() {
  const [docs, setDocs] = useState([]);
  // The switch flips immediately on click rather than waiting on a round
  // trip to Firestore -- otherwise a slow connection (or a write that
  // fails, e.g. security rules not yet covering this collection) makes
  // the switch look completely unresponsive. Cleared once the snapshot
  // listener confirms the real value, or on failure so it snaps back to
  // whatever's actually saved instead of lying about it forever.
  const [optimistic, setOptimistic] = useState(() => new Map());
  // Which player+team keys just failed to save -- surfaced in the UI so
  // a failed write (e.g. Firestore rules not deployed for this
  // collection yet) doesn't just look like the switch silently ignoring
  // the click.
  const [errorKeys, setErrorKeys] = useState(() => new Set());

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "portalStatus"), (snap) => {
      setDocs(snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })));
    });
    return unsubscribe;
  }, []);

  const byKey = useMemo(() => {
    const m = new Map();
    docs.forEach((d) => m.set(`${d.player}::${d.team}`, d));
    return m;
  }, [docs]);

  function isInPortal(player, team) {
    const key = `${player}::${team}`;
    if (optimistic.has(key)) return optimistic.get(key);
    return byKey.get(key)?.inPortal === true;
  }

  function saveFailed(player, team) {
    return errorKeys.has(`${player}::${team}`);
  }

  async function setInPortal(player, team, value) {
    const key = `${player}::${team}`;
    setOptimistic((prev) => new Map(prev).set(key, value));
    setErrorKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    try {
      const existing = byKey.get(key);
      if (existing) {
        await updateDoc(doc(db, "portalStatus", existing.id), { inPortal: value });
      } else {
        await addDoc(collection(db, "portalStatus"), { player, team, inPortal: value });
      }
    } catch (err) {
      console.error("Failed to save portal status -- check Firestore rules cover the portalStatus collection", err);
      setErrorKeys((prev) => new Set(prev).add(key));
    } finally {
      setOptimistic((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    }
  }

  return { isInPortal, setInPortal, saveFailed };
}

// Manual on/off switch -- used for "entered the portal", which is
// something the user flips themselves rather than data that comes from
// a scraper, so it reads as a deliberate action rather than a filled-in
// field like the other watch list inputs.
function ToggleSwitch({ checked, onChange, title }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      onClick={() => onChange(!checked)}
      style={{
        position: "relative",
        width: 40,
        height: 22,
        borderRadius: 999,
        border: `1px solid ${checked ? "var(--accent)" : "var(--border)"}`,
        background: checked ? "var(--accent)" : "var(--bg-surface)",
        cursor: "pointer",
        padding: 0,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 1,
          left: checked ? 19 : 1,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: checked ? "var(--bg-page)" : "var(--text-faint)",
          transition: "left 0.15s ease",
        }}
      />
    </button>
  );
}

const pillStyle = (active) => ({
  background: active ? "var(--accent-bg)" : "var(--bg-surface)",
  border: active ? "1px solid var(--accent)" : "1px solid var(--border)",
  color: active ? "var(--accent)" : "var(--text-muted)",
  borderRadius: 4,
  padding: "3px 10px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
});

// The negative margin cancels the extra padding visually (so it doesn't
// throw off spacing next to the player name) while still giving the
// button a bigger real hit target than the icon's own tiny bounding box --
// paired with the .watch-toggle:hover rule in the global <style> block.
const watchToggleButtonStyle = {
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: 5,
  margin: -5,
  lineHeight: 0,
  display: "inline-flex",
  borderRadius: 999,
};

const fieldInputStyle = {
  width: "100%",
  background: "var(--bg-page)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  padding: "6px 8px",
  fontSize: 13,
  color: "var(--text-primary)",
  fontFamily: "inherit",
};
const fieldLabelStyle = { display: "block", fontSize: 10.5, color: "var(--text-faint)", letterSpacing: "0.03em", margin: "0 0 4px" };
// Compact variant for an input sitting inside a table cell (watch list grid).
const cellInputStyle = { ...fieldInputStyle, padding: "4px 6px", fontSize: 12.5, background: "var(--bg-page)" };
// Grows with content (see autoResizeNotes) so the whole note is always
// fully visible -- no clipping, no internal scrolling. The row just gets
// as tall as it needs to be, same as any other cell with a lot in it.
const notesInputStyle = {
  ...cellInputStyle,
  display: "block",
  resize: "none",
  overflow: "hidden",
  lineHeight: 1.4,
  minHeight: 26,
};

const hometownDropdownStyle = {
  position: "absolute",
  zIndex: 30,
  top: "calc(100% + 4px)",
  left: 0,
  width: 260,
  background: "var(--bg-surface)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  overflow: "hidden",
  boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
};
const hometownSuggestionStyle = {
  padding: "8px 10px",
  fontSize: 12.5,
  color: "var(--text-secondary)",
  cursor: "pointer",
  borderBottom: "1px solid var(--border-subtle)",
};

// Type-ahead hometown search against OpenStreetMap's free Nominatim API --
// no API key or account needed anywhere. Debounced well past their 1
// req/sec usage-policy limit, and aborts a stale in-flight request rather
// than letting an old response overwrite a newer one.
function HometownPicker({ value, onCommit }) {
  const [text, setText] = useState(value || "");
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null); // {lat, lon}
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const abortRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => setText(value || ""), [value]);

  useEffect(() => {
    if (!open) return undefined;
    clearTimeout(debounceRef.current);
    if (!text.trim()) {
      setSuggestions([]);
      return undefined;
    }
    debounceRef.current = setTimeout(() => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&q=${encodeURIComponent(text)}`;
      fetch(url, { signal: controller.signal })
        .then((r) => r.json())
        .then((data) => setSuggestions(Array.isArray(data) ? data : []))
        .catch(() => {});
    }, 600);
    return () => clearTimeout(debounceRef.current);
  }, [text, open]);

  // Preview the top result automatically so the map isn't blank until the
  // user happens to hover one, then follow whichever they hover instead.
  useEffect(() => {
    if (suggestions.length) setPreview({ lat: parseFloat(suggestions[0].lat), lon: parseFloat(suggestions[0].lon) });
  }, [suggestions]);

  useEffect(() => {
    if (!preview || !mapContainerRef.current) return;
    if (!mapRef.current) {
      mapRef.current = L.map(mapContainerRef.current, { zoomControl: false, attributionControl: false }).setView(
        [preview.lat, preview.lon],
        9
      );
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 12 }).addTo(mapRef.current);
      markerRef.current = L.circleMarker([preview.lat, preview.lon], {
        radius: 6,
        color: "var(--accent)",
        weight: 2,
        fillColor: "var(--accent)",
        fillOpacity: 1,
      }).addTo(mapRef.current);
    } else {
      mapRef.current.setView([preview.lat, preview.lon], 9);
      markerRef.current.setLatLng([preview.lat, preview.lon]);
    }
  }, [preview]);

  useEffect(() => {
    return () => {
      if (mapRef.current) mapRef.current.remove();
    };
  }, []);

  function placeLabel(s) {
    const a = s.address || {};
    const city = a.city || a.town || a.village || a.hamlet || a.county;
    return city && a.state ? `${city}, ${a.state}` : s.display_name;
  }

  function commit(s) {
    const val = placeLabel(s);
    setText(val);
    onCommit(val);
    setOpen(false);
    setSuggestions([]);
  }

  return (
    <div style={{ position: "relative" }}>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Let a suggestion's onClick land before the list unmounts.
          setTimeout(() => setOpen(false), 150);
          if (text !== (value || "")) onCommit(text);
        }}
        placeholder="Search a city…"
        style={cellInputStyle}
      />
      {open && suggestions.length > 0 && (
        <div style={hometownDropdownStyle}>
          {suggestions.map((s) => (
            <div
              key={s.place_id}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setPreview({ lat: parseFloat(s.lat), lon: parseFloat(s.lon) })}
              onClick={() => commit(s)}
              style={hometownSuggestionStyle}
            >
              {placeLabel(s)}
            </div>
          ))}
          <div ref={mapContainerRef} style={{ height: 110 }} />
        </div>
      )}
    </div>
  );
}

async function confirmRemoveFromWatchlist(watchlist, id, name) {
  const ok = await confirmAction({
    title: `Remove ${name}?`,
    message: "This takes them off your watch list.",
  });
  if (ok) watchlist.removePlayer(id);
}

// One editable row of the watch list grid. Each text field keeps local
// state so keystrokes don't round-trip to the db on every character --
// it only commits (onUpdate) on blur, same pattern as the main scraped
// table's cells are read-only render of committed data.
function WatchListRow({
  p,
  onRemove,
  onUpdate,
  onSelect,
  compareSelected,
  onToggleCompare,
  style,
  draggable,
  isDragging,
  dropIndicator,
  onDragHandlePointerDown,
  rowRef,
  portalStatus,
}) {
  const [notes, setNotes] = useState(p.notes || "");
  const [height, setHeight] = useState(p.height || "");
  const [weight, setWeight] = useState(p.weight || "");
  const [xLink, setXLink] = useState(p.xLink || "");
  const [filmLink, setFilmLink] = useState(p.filmLink || "");
  const notesRef = useRef(null);

  // Grows the textarea to fit its content (capped by CSS max-height, which
  // switches to a scrollbar past that) instead of clipping a long note --
  // runs on mount too, so a saved long note is already expanded on load.
  const autoResizeNotes = () => {
    const el = notesRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(autoResizeNotes, []);

  const currentSignature = useMemo(() => playerStatsSignature(p.player, p.team), [p.player, p.team]);
  const hasUpdate = p.lastSeenSnapshot && currentSignature && p.lastSeenSnapshot !== currentSignature;

  const dropLineStyle =
    dropIndicator === "before"
      ? { boxShadow: "inset 0 2px 0 0 var(--accent)" }
      : dropIndicator === "after"
      ? { boxShadow: "inset 0 -2px 0 0 var(--accent)" }
      : null;

  return (
    <tr ref={rowRef} style={{ ...style, ...dropLineStyle, opacity: isDragging ? 0.4 : 1 }}>
      <td style={{ ...tdStyle, textAlign: "center" }}>
        {draggable && (
          <span
            onPointerDown={onDragHandlePointerDown}
            title="Drag to reorder"
            style={{ display: "inline-flex", color: "var(--text-faint)", cursor: "grab", lineHeight: 0, touchAction: "none" }}
          >
            <GripVertical size={15} />
          </span>
        )}
      </td>
      <td style={{ ...tdStyle, textAlign: "center" }}>
        <input
          type="checkbox"
          checked={compareSelected}
          onChange={onToggleCompare}
          title="Select to compare"
          style={{ cursor: "pointer" }}
        />
      </td>
      <td style={{ ...tdStyle, fontWeight: 600, color: "var(--text-primary)" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span className="player-name" onClick={() => onSelect(p)} title="View full stats">
            {p.player}
          </span>
          {portalStatus.isInPortal(p.player, p.team) && (
            <span title="Entered the transfer portal" style={{ display: "inline-flex", color: "var(--success)", lineHeight: 0 }}>
              <CheckCircle2 size={18} />
            </span>
          )}
          {hasUpdate && (
            <span
              title="This player's stats have changed since you last viewed them"
              className="tabular"
              style={{ background: "var(--accent-bg)", color: "var(--accent)", borderRadius: 999, padding: "1px 6px", fontSize: 10, fontWeight: 700 }}
            >
              UPDATED
            </span>
          )}
        </span>
      </td>
      <td style={{ ...tdStyle, color: "var(--text-muted)" }}>{canonicalSchool(p.team) || "—"}</td>
      <td style={{ ...tdStyle, color: "var(--text-muted)", fontSize: 12.5 }}>{p.division || "—"}</td>
      <td style={{ ...tdStyle, color: "var(--accent)", fontWeight: 600 }} className="oswald">
        {p.position || "—"}
      </td>
      <td style={tdStyle}>
        <input
          value={height}
          onChange={(e) => setHeight(e.target.value)}
          onBlur={() => onUpdate("height", height)}
          placeholder={`e.g. 6'2"`}
          style={{ ...cellInputStyle, width: 64 }}
        />
      </td>
      <td style={tdStyle}>
        <input
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          onBlur={() => onUpdate("weight", weight)}
          placeholder="e.g. 210"
          style={{ ...cellInputStyle, width: 64 }}
        />
      </td>
      <td style={tdStyle}>
        <select
          value={p.eligibility || ""}
          onChange={(e) => onUpdate("eligibility", e.target.value)}
          style={{ ...cellInputStyle, cursor: "pointer" }}
        >
          <option value="">—</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? "year" : "years"}
            </option>
          ))}
        </select>
      </td>
      <td style={tdStyle}>
        <div style={{ display: "flex", gap: 6 }}>
          <button style={pillStyle(p.pipelined === true)} onClick={() => onUpdate("pipelined", true)}>
            Yes
          </button>
          <button style={pillStyle(p.pipelined === false)} onClick={() => onUpdate("pipelined", false)}>
            No
          </button>
        </div>
      </td>
      <td style={{ ...tdStyle, position: "relative" }}>
        <HometownPicker value={p.hometown} onCommit={(val) => onUpdate("hometown", val)} />
      </td>
      <td style={tdStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            value={xLink}
            onChange={(e) => setXLink(e.target.value)}
            onBlur={() => onUpdate("xLink", xLink)}
            placeholder="X profile (URL)"
            style={cellInputStyle}
          />
          {xLink && (
            <a href={xLink} target="_blank" rel="noopener noreferrer" title="Open X profile" style={{ color: "var(--accent)", display: "flex", lineHeight: 0, flexShrink: 0 }}>
              <ExternalLink size={14} />
            </a>
          )}
        </div>
      </td>
      <td style={tdStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            value={filmLink}
            onChange={(e) => setFilmLink(e.target.value)}
            onBlur={() => onUpdate("filmLink", filmLink)}
            placeholder="Film link (URL)"
            style={cellInputStyle}
          />
          {filmLink && (
            <a href={filmLink} target="_blank" rel="noopener noreferrer" title="Open film link" style={{ color: "var(--accent)", display: "flex", lineHeight: 0, flexShrink: 0 }}>
              <ExternalLink size={14} />
            </a>
          )}
        </div>
      </td>
      <td style={{ ...tdStyle, verticalAlign: "top" }}>
        <textarea
          ref={notesRef}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            autoResizeNotes();
          }}
          onBlur={() => onUpdate("notes", notes)}
          placeholder="Notes…"
          rows={1}
          style={notesInputStyle}
        />
      </td>
      <td style={{ ...tdStyle, textAlign: "center" }}>
        <button
          onClick={onRemove}
          title="Remove from watch list"
          style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", padding: 2, lineHeight: 0 }}
        >
          <X size={15} />
        </button>
      </td>
    </tr>
  );
}

const WATCHLIST_COLUMNS = ["", "", "Player", "Team", "Division", "Pos", "Ht", "Wt", "Eligibility", "Pipelined?", "Hometown", "X", "Film Link", "Notes", ""];
// Which of the columns above can be clicked to sort the watch list --
// keyed by the doc field each one reads. Only active on the "All"
// position tab (see positionTab check in WatchListPanel) -- sorting by
// Position, for instance, is meaningless once already filtered to one.
const WATCHLIST_SORTABLE = {
  Team: "team",
  Division: "division",
  Pos: "position",
  Ht: "height",
  Wt: "weight",
  Eligibility: "eligibility",
  "Pipelined?": "pipelined",
};
// Alphabetical (not numeric) comparison, defaulting to ascending on
// first click rather than the numeric fields' descending.
const WATCHLIST_STRING_SORT_KEYS = new Set(["team", "division", "position"]);

function heightToInches(height) {
  const m = /^(\d)'(\d{1,2})/.exec(height || "");
  return m ? parseInt(m[1], 10) * 12 + parseInt(m[2], 10) : 0;
}

// Full-screen overlay -- same spreadsheet grid language as the main stats
// table (sticky header, gridlines) instead of a narrow sidebar, so editing
// a dozen watched players' notes/hometown/eligibility doesn't feel cramped.
function exportWatchListCsv(players) {
  const headers = ["Player", "Team", "Division", "Position", "Height", "Weight", "Eligibility", "Pipelined", "Hometown", "X", "Film Link", "Notes"];
  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.map(escape).join(",")];
  for (const p of players) {
    lines.push(
      [
        p.player,
        p.team,
        p.division,
        p.position,
        p.height,
        p.weight,
        p.eligibility ? `${p.eligibility} year${p.eligibility === "1" ? "" : "s"}` : "",
        p.pipelined === true ? "Yes" : p.pipelined === false ? "No" : "",
        p.hometown,
        p.xLink,
        p.filmLink,
        p.notes,
      ]
        .map(escape)
        .join(",")
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `watch-list-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function WatchListPanel({ watchlist, onClose, onSelectPlayer, portalStatus }) {
  const [name, setName] = useState("");
  const [team, setTeam] = useState("");
  const [position, setPosition] = useState(WATCH_POSITIONS[0]);
  const [positionTab, setPositionTab] = useState("All");
  const [wlSortKey, setWlSortKey] = useState(null);
  const [wlSortDir, setWlSortDir] = useState("desc");
  const [compareIds, setCompareIds] = useState(() => new Set());
  const [showCompare, setShowCompare] = useState(false);
  const nameInputRef = useRef(null);

  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  function handleAdd(e) {
    e.preventDefault();
    if (!name.trim()) return;
    watchlist.addPlayer({ player: name, team, division: "", position });
    setName("");
    setTeam("");
  }

  const byPosition = positionTab === "All" ? watchlist.players : watchlist.players.filter((p) => p.position === positionTab);
  const countFor = (pos) => (pos === "All" ? watchlist.players.length : watchlist.players.filter((p) => p.position === pos).length);

  // Falls back to when they were added for any doc from before sortOrder
  // existed, rather than an undefined value that'd sort unpredictably.
  function orderValue(p) {
    return p.sortOrder ?? (p.addedAt ? new Date(p.addedAt).getTime() : 0);
  }

  // Sorting only applies on the "All" tab -- once already filtered to one
  // position, Position/Team/Division sorting either does nothing or is
  // ambiguous, so a filtered tab always falls back to manual board order
  // (this also re-enables drag reordering there, see draggable below).
  const wlSortActive = positionTab === "All" ? wlSortKey : null;

  const visiblePlayers = useMemo(() => {
    if (!wlSortActive) return [...byPosition].sort((a, b) => orderValue(a) - orderValue(b));
    const sorted = [...byPosition].sort((a, b) => {
      if (WATCHLIST_STRING_SORT_KEYS.has(wlSortActive)) {
        const av = (a[wlSortActive] || "").toString();
        const bv = (b[wlSortActive] || "").toString();
        return wlSortDir === "desc" ? bv.localeCompare(av) : av.localeCompare(bv);
      }
      let av, bv;
      if (wlSortActive === "height") {
        av = heightToInches(a.height);
        bv = heightToInches(b.height);
      } else if (wlSortActive === "pipelined") {
        av = a.pipelined === true ? 1 : a.pipelined === false ? -1 : 0;
        bv = b.pipelined === true ? 1 : b.pipelined === false ? -1 : 0;
      } else {
        av = parseFloat(a[wlSortActive]) || 0;
        bv = parseFloat(b[wlSortActive]) || 0;
      }
      return wlSortDir === "desc" ? bv - av : av - bv;
    });
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byPosition, wlSortActive, wlSortDir]);

  function handleWlSort(field) {
    if (wlSortKey === field) {
      setWlSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setWlSortKey(field);
      setWlSortDir(WATCHLIST_STRING_SORT_KEYS.has(field) ? "asc" : "desc");
    }
  }

  // Drag-and-drop reordering, scoped to whatever's currently visible (so
  // dragging within the QB tab only reorders relative to other QBs) --
  // only makes sense with no column sort active, which is why the drag
  // handle is hidden otherwise rather than fighting that sort. Dropping a
  // row assigns it a sortOrder exactly between its new neighbors (rather
  // than renumbering the whole list), so this is a single write per drop.
  //
  // Built on pointer events rather than native HTML5 drag-and-drop: native
  // DnD doesn't fire on touch devices at all, and needs a real user
  // gesture to engage (synthetic mouse events used by test tooling don't
  // reliably trigger it either) -- confirmed directly while testing this.
  const [dragId, setDragId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // { id, position: "before" | "after" }
  const rowNodes = useRef(new Map()); // id -> <tr> DOM node, for hit-testing during drag
  const dropTargetRef = useRef(null);
  const visiblePlayersRef = useRef(visiblePlayers);
  useEffect(() => {
    visiblePlayersRef.current = visiblePlayers;
  }, [visiblePlayers]);

  function setRowNode(id) {
    return (node) => {
      if (node) rowNodes.current.set(id, node);
      else rowNodes.current.delete(id);
    };
  }

  function handleDragHandlePointerDown(e, id) {
    e.preventDefault();
    setDragId(id);
  }

  useEffect(() => {
    if (!dragId) return;

    function handlePointerMove(e) {
      let found = null;
      for (const [id, node] of rowNodes.current) {
        if (id === dragId) continue;
        const rect = node.getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
          found = { id, position: e.clientY - rect.top < rect.height / 2 ? "before" : "after" };
          break;
        }
      }
      dropTargetRef.current = found;
      setDropTarget(found);
    }

    async function handlePointerUp() {
      const from = dragId;
      const target = dropTargetRef.current;
      setDragId(null);
      setDropTarget(null);
      dropTargetRef.current = null;
      if (!from || !target || from === target.id) return;

      const withoutDragged = visiblePlayersRef.current.filter((p) => p.id !== from);
      const targetIdx = withoutDragged.findIndex((p) => p.id === target.id);
      if (targetIdx === -1) return;
      const insertAt = target.position === "after" ? targetIdx + 1 : targetIdx;
      const prev = withoutDragged[insertAt - 1];
      const next = withoutDragged[insertAt];
      const prevVal = prev ? orderValue(prev) : null;
      const nextVal = next ? orderValue(next) : null;
      const newVal = prevVal == null ? (nextVal == null ? Date.now() : nextVal - 1) : nextVal == null ? prevVal + 1 : (prevVal + nextVal) / 2;
      await watchlist.updateField(from, "sortOrder", newVal);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragId]);

  function toggleCompare(id) {
    setCompareIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 3) next.add(id);
      return next;
    });
  }

  const compareList = watchlist.players.filter((p) => compareIds.has(p.id));

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--bg-page)",
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          flexShrink: 0,
          padding: "16px var(--gutter)",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <h2 className="oswald" style={{ fontSize: 22, margin: 0, fontWeight: 700, color: "var(--text-primary)" }}>
          Watch List
        </h2>

        {watchlist.available && (
          <form onSubmit={handleAdd} style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, maxWidth: 520 }}>
            <input
              ref={nameInputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Player name"
              style={{ ...fieldInputStyle, width: "auto", flex: 2 }}
            />
            <input
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              placeholder="Team (optional)"
              style={{ ...fieldInputStyle, width: "auto", flex: 1 }}
            />
            <select value={position} onChange={(e) => setPosition(e.target.value)} style={{ ...selectStyle, minWidth: 0, flexShrink: 0 }}>
              {WATCH_POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <button
              type="submit"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flexShrink: 0,
                background: "var(--accent-bg)", border: "1px solid var(--accent)", color: "var(--accent)",
                borderRadius: 4, padding: "7px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}
            >
              <Plus size={14} /> Add
            </button>
          </form>
        )}

        {watchlist.available && watchlist.players.length > 0 && (
          <button
            onClick={() => exportWatchListCsv(visiblePlayers)}
            title="Export the currently visible rows as a CSV file"
            style={{
              display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
              background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)",
              borderRadius: 5, padding: "8px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >
            <Download size={14} /> Export CSV
          </button>
        )}

        {compareIds.size >= 2 && (
          <button
            onClick={() => setShowCompare(true)}
            style={{
              display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
              background: "var(--accent-bg)", border: "1px solid var(--accent)", color: "var(--accent)",
              borderRadius: 5, padding: "8px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer",
            }}
          >
            <Columns3 size={14} /> Compare ({compareIds.size})
          </button>
        )}

        <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 4, lineHeight: 0 }}>
          <X size={22} />
        </button>
      </div>

      {!watchlist.available ? (
        <div style={{ padding: 20, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5 }}>
          {watchlist.checkedAvailability
            ? "Couldn't reach the watch list database. Check your connection and reload."
            : "Loading…"}
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, padding: "16px var(--gutter) var(--gutter)", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 16, flexWrap: "wrap", flexShrink: 0 }}>
            {["All", ...WATCH_POSITIONS].map((pos) => (
              <button
                key={pos}
                onClick={() => setPositionTab(pos)}
                className="oswald"
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  background: "none", border: "none", cursor: "pointer",
                  padding: "8px 14px 10px", fontSize: 14, fontWeight: 600,
                  color: positionTab === pos ? "var(--accent)" : "var(--text-muted)",
                  borderBottom: positionTab === pos ? "2px solid var(--accent)" : "2px solid transparent",
                  marginBottom: -1,
                }}
              >
                {pos}
                <span
                  className="tabular"
                  style={{
                    background: positionTab === pos ? "var(--accent-bg)" : "var(--bg-surface)",
                    color: positionTab === pos ? "var(--accent)" : "var(--text-faint)",
                    borderRadius: 999, padding: "1px 6px", fontSize: 11,
                  }}
                >
                  {countFor(pos)}
                </span>
              </button>
            ))}
          </div>

          {visiblePlayers.length === 0 ? (
            <div style={{ color: "var(--text-faint)", fontSize: 13 }}>
              {watchlist.players.length === 0
                ? "No players on the watch list yet."
                : `No ${positionTab} players on the watch list yet.`}
            </div>
          ) : (
            <div style={{ flex: 1, minHeight: 0, border: "1px solid var(--border)", borderRadius: 6, overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--bg-surface)" }}>
                    {WATCHLIST_COLUMNS.map((label, i) => {
                      const sortField = positionTab === "All" ? WATCHLIST_SORTABLE[label] : null;
                      return (
                        <Th
                          key={i}
                          label={label}
                          sticky
                          sortable={!!sortField}
                          active={wlSortActive === sortField}
                          dir={wlSortDir}
                          onClick={sortField ? () => handleWlSort(sortField) : undefined}
                        />
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {visiblePlayers.map((p, i) => (
                    <WatchListRow
                      key={p.id}
                      p={p}
                      style={{ background: i % 2 === 0 ? "var(--bg-panel)" : "var(--bg-page)", borderTop: "1px solid var(--border-subtle)" }}
                      onRemove={() => confirmRemoveFromWatchlist(watchlist, p.id, p.player)}
                      onUpdate={(field, value) => watchlist.updateField(p.id, field, value)}
                      onSelect={onSelectPlayer}
                      compareSelected={compareIds.has(p.id)}
                      onToggleCompare={() => toggleCompare(p.id)}
                      portalStatus={portalStatus}
                      draggable={!wlSortActive}
                      isDragging={dragId === p.id}
                      dropIndicator={dropTarget && dropTarget.id === p.id ? dropTarget.position : null}
                      onDragHandlePointerDown={(e) => handleDragHandlePointerDown(e, p.id)}
                      rowRef={setRowNode(p.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {showCompare && <CompareModal players={compareList} onClose={() => setShowCompare(false)} />}
    </div>
  );
}

// Shows every tracked stat line for one player across all categories they
// appear in (a QB who also carries the ball shows both Passing and Rushing,
// for example) -- opened by clicking a player's name in the main grid.
export function PlayerDetailModal({ sel, onClose, watchlist, portalStatus }) {
  const rows = useMemo(
    () =>
      sel.variants
        ? DATA.filter((r) => r.division === sel.division && sel.variants.some((v) => v.player === r.player && v.team === r.team))
        : DATA.filter((r) => r.player === sel.player && r.team === sel.team && r.division === sel.division),
    [sel.player, sel.team, sel.division, sel.variants]
  );
  const first = rows[0];
  const watched = watchlist.players.find((p) => p.player === sel.player && p.team === sel.team);

  // Local echo of the free-text fields, same as WatchListRow -- commit
  // on blur instead of round-tripping to the db on every keystroke.
  const [wlNotes, setWlNotes] = useState(watched?.notes || "");
  const [wlHeight, setWlHeight] = useState(watched?.height || "");
  const [wlWeight, setWlWeight] = useState(watched?.weight || "");
  const [wlXLink, setWlXLink] = useState(watched?.xLink || "");
  const [wlFilmLink, setWlFilmLink] = useState(watched?.filmLink || "");
  const wlNotesRef = useRef(null);
  const autoResizeWlNotes = () => {
    const el = wlNotesRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(autoResizeWlNotes, []);

  const byCategory = useMemo(() => {
    const grouped = {};
    rows.forEach((r) => {
      (grouped[r.category] ||= []).push(r);
    });
    return grouped;
  }, [rows]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(8,10,12,0.65)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        zIndex: 60,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          width: 640,
          maxWidth: "100%",
          maxHeight: "85vh",
          overflowY: "auto",
          boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
        }}
      >
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            position: "sticky",
            top: 0,
            background: "var(--bg-panel)",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h2 className="oswald" style={{ fontSize: 20, margin: 0, fontWeight: 700 }}>
                {sel.player}
              </h2>
              {portalStatus.isInPortal(sel.player, sel.team) && (
                <span title="Entered the transfer portal" style={{ display: "inline-flex", color: "var(--success)", lineHeight: 0 }}>
                  <CheckCircle2 size={24} />
                </span>
              )}
              <button
                className="watch-toggle"
                onClick={() => (watched ? confirmRemoveFromWatchlist(watchlist, watched.id, sel.player) : watchlist.addPlayer(sel))}
                title={watched ? "Remove from watch list" : "Add to watch list"}
                style={watchToggleButtonStyle}
              >
                {watched ? <X size={18} color="var(--accent)" /> : <Plus size={18} color="var(--accent)" />}
              </button>
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 3 }}>
              {canonicalSchool(sel.team)}
              {first ? ` · ${first.conference} · ${first.position} · ${DIVISION_LABEL[sel.division] || sel.division}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ fontSize: 12.5, color: "var(--text-muted)", whiteSpace: "nowrap" }}>Entered Portal?</span>
              <ToggleSwitch
                checked={portalStatus.isInPortal(sel.player, sel.team)}
                onChange={(val) => portalStatus.setInPortal(sel.player, sel.team, val)}
                title="Mark this player as having entered the transfer portal"
              />
              {portalStatus.saveFailed(sel.player, sel.team) && (
                <span title="Couldn't save -- the site's database isn't set up to store this yet" style={{ display: "inline-flex", color: "var(--danger)", lineHeight: 0 }}>
                  <AlertTriangle size={15} />
                </span>
              )}
            </div>
            <a
              href={playerSearchUrl(sel.player, sel.team, first?.position || sel.position)}
              target="_blank"
              rel="noopener noreferrer"
              title="Search this player"
              style={{
                display: "flex", alignItems: "center", gap: 7, flexShrink: 0,
                background: "var(--accent-bg)", border: "1px solid var(--accent)", color: "var(--accent)",
                borderRadius: 5, padding: "10px 16px", fontSize: 14, fontWeight: 700,
                textDecoration: "none", whiteSpace: "nowrap",
              }}
            >
              <ExternalLink size={16} /> Search
            </a>
            <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 4, lineHeight: 0 }}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 20 }}>
          {watched && (
            <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6, padding: 14 }}>
              <div
                className="oswald"
                style={{ fontSize: 12.5, fontWeight: 600, color: "var(--success)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.04em" }}
              >
                Your Watch List Info
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={fieldLabelStyle}>Height</label>
                  <input
                    value={wlHeight}
                    onChange={(e) => setWlHeight(e.target.value)}
                    onBlur={() => watchlist.updateField(watched.id, "height", wlHeight)}
                    placeholder={`e.g. 6'2"`}
                    style={fieldInputStyle}
                  />
                </div>
                <div>
                  <label style={fieldLabelStyle}>Weight</label>
                  <input
                    value={wlWeight}
                    onChange={(e) => setWlWeight(e.target.value)}
                    onBlur={() => watchlist.updateField(watched.id, "weight", wlWeight)}
                    placeholder="e.g. 210"
                    style={fieldInputStyle}
                  />
                </div>
                <div>
                  <label style={fieldLabelStyle}>Eligibility</label>
                  <select
                    value={watched.eligibility || ""}
                    onChange={(e) => watchlist.updateField(watched.id, "eligibility", e.target.value)}
                    style={{ ...fieldInputStyle, cursor: "pointer" }}
                  >
                    <option value="">—</option>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n} {n === 1 ? "year" : "years"}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={fieldLabelStyle}>Pipelined?</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button style={pillStyle(watched.pipelined === true)} onClick={() => watchlist.updateField(watched.id, "pipelined", true)}>
                      Yes
                    </button>
                    <button style={pillStyle(watched.pipelined === false)} onClick={() => watchlist.updateField(watched.id, "pipelined", false)}>
                      No
                    </button>
                  </div>
                </div>
                <div>
                  <label style={fieldLabelStyle}>X</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input
                      value={wlXLink}
                      onChange={(e) => setWlXLink(e.target.value)}
                      onBlur={() => watchlist.updateField(watched.id, "xLink", wlXLink)}
                      placeholder="X profile (URL)"
                      style={fieldInputStyle}
                    />
                    {wlXLink && (
                      <a href={wlXLink} target="_blank" rel="noopener noreferrer" title="Open X profile" style={{ color: "var(--accent)", display: "flex", lineHeight: 0, flexShrink: 0 }}>
                        <ExternalLink size={15} />
                      </a>
                    )}
                  </div>
                </div>
                <div>
                  <label style={fieldLabelStyle}>Film Link</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input
                      value={wlFilmLink}
                      onChange={(e) => setWlFilmLink(e.target.value)}
                      onBlur={() => watchlist.updateField(watched.id, "filmLink", wlFilmLink)}
                      placeholder="Film link (URL)"
                      style={fieldInputStyle}
                    />
                    {wlFilmLink && (
                      <a href={wlFilmLink} target="_blank" rel="noopener noreferrer" title="Open film link" style={{ color: "var(--accent)", display: "flex", lineHeight: 0, flexShrink: 0 }}>
                        <ExternalLink size={15} />
                      </a>
                    )}
                  </div>
                </div>
                <div style={{ position: "relative" }}>
                  <label style={fieldLabelStyle}>Hometown</label>
                  <HometownPicker value={watched.hometown} onCommit={(val) => watchlist.updateField(watched.id, "hometown", val)} />
                </div>
              </div>
              <label style={fieldLabelStyle}>Notes</label>
              <textarea
                ref={wlNotesRef}
                value={wlNotes}
                onChange={(e) => {
                  setWlNotes(e.target.value);
                  autoResizeWlNotes();
                }}
                onBlur={() => watchlist.updateField(watched.id, "notes", wlNotes)}
                placeholder="Notes…"
                rows={1}
                style={{ ...notesInputStyle, padding: "6px 8px" }}
              />
            </div>
          )}

          {rows.length === 0 && <div style={{ color: "var(--text-faint)", fontSize: 13 }}>No tracked stats found for this player.</div>}
          {Object.keys(CATEGORIES).map((key) => {
            const catRows = byCategory[key];
            if (!catRows) return null;
            const cat = CATEGORIES[key];
            return (
              <div key={key}>
                <div
                  className="oswald"
                  style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}
                >
                  {cat.label}
                </div>
                <div style={{ border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "var(--bg-surface)" }}>
                        <th style={detailThStyle}>Week</th>
                        {cat.columns.map((col) => (
                          <th key={col.key} style={{ ...detailThStyle, textAlign: "right" }}>
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {catRows.map((r) => (
                        <tr key={r.id} style={{ borderTop: "1px solid var(--border-subtle)" }}>
                          <td style={detailTdStyle}>{weekLabel(r.week)}</td>
                          {cat.columns.map((col) => (
                            <td key={col.key} className="tabular" style={{ ...detailTdStyle, textAlign: "right" }}>
                              {r[col.key]}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const detailThStyle = { padding: "8px 12px", fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)", textAlign: "left", whiteSpace: "nowrap" };
const detailTdStyle = { padding: "7px 12px", fontSize: 13, color: "var(--text-secondary)" };

// Puts 2-3 watch-listed players' full stat lines side by side instead of
// opening each one's detail modal separately. Only categories at least
// one of them actually has data in are shown (a QB-vs-WR comparison
// doesn't render an empty Passing section for the receiver).
function CompareModal({ players, onClose }) {
  const playerRows = players.map((p) => ({ p, rows: DATA.filter((r) => r.player === p.player && r.team === p.team) }));
  const categories = Object.keys(CATEGORIES).filter((key) => playerRows.some(({ rows }) => rows.some((r) => r.category === key)));

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(8,10,12,0.75)", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, width: 900, maxWidth: "100%",
          maxHeight: "85vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
        }}
      >
        <div
          style={{
            padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center",
            justifyContent: "space-between", position: "sticky", top: 0, background: "var(--bg-panel)",
          }}
        >
          <h2 className="oswald" style={{ fontSize: 20, margin: 0, fontWeight: 700 }}>
            Compare Players
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 4, lineHeight: 0 }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 20, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 200 + players.length * 180 }}>
            <thead>
              <tr>
                <th style={{ ...detailThStyle, position: "sticky", left: 0, background: "var(--bg-panel)" }}> </th>
                {playerRows.map(({ p }) => (
                  <th key={p.id} style={{ ...detailThStyle, minWidth: 180 }}>
                    <div className="oswald" style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
                      {p.player}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--text-muted)", fontWeight: 400 }}>
                      {canonicalSchool(p.team) || "—"} · {p.position || "—"}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.length === 0 && (
                <tr>
                  <td colSpan={players.length + 1} style={{ ...detailTdStyle, textAlign: "center", color: "var(--text-faint)", padding: 24 }}>
                    No tracked stats found for these players.
                  </td>
                </tr>
              )}
              {categories.map((catKey) => {
                const cat = CATEGORIES[catKey];
                return (
                  <Fragment key={catKey}>
                    <tr>
                      <td
                        colSpan={players.length + 1}
                        className="oswald"
                        style={{ padding: "10px 12px 4px", fontSize: 12, fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.04em" }}
                      >
                        {cat.label}
                      </td>
                    </tr>
                    {cat.columns.map((col) => (
                      <tr key={col.key} style={{ borderTop: "1px solid var(--border-subtle)" }}>
                        <td style={{ ...detailTdStyle, position: "sticky", left: 0, background: "var(--bg-panel)", color: "var(--text-muted)" }}>{col.label}</td>
                        {playerRows.map(({ p, rows }) => {
                          const row = rows.find((r) => r.category === catKey && r.week === "total");
                          return (
                            <td key={p.id} className="tabular" style={detailTdStyle}>
                              {row ? row[col.key] : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------- Component ----------

function GridlineMain({ onBack, initialSearch, onUploadStats }) {
  const [division, setDivision] = useState("NAIA");
  const [category, setCategory] = useState("passing");
  const [week, setWeek] = useState("total");
  const [position, setPosition] = useState("All");
  const [conference, setConference] = useState("All");
  const [search, setSearch] = useState(initialSearch || "");
  const [sortKey, setSortKey] = useState("yards");
  const [sortDir, setSortDir] = useState("desc");
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [theme, setTheme] = useTheme();
  const watchlist = useWatchlist();
  const portalStatus = usePortalStatus();

  const cat = CATEGORIES[category];
  const isLiveView = LIVE_DIVISIONS.has(division);
  const positions = useMemo(() => ["All", ...positionsFor(division, category)], [division, category]);
  const conferences = useMemo(() => ["All", ...conferencesFor(division)], [division]);
  const weekOptions = useMemo(() => weeksFor(division), [division]);

  const rows = useMemo(() => {
    let filtered = DATA.filter((r) => r.division === division && r.category === category && r.week === week);
    if (position !== "All") filtered = filtered.filter((r) => r.position === position);
    if (conference !== "All") filtered = filtered.filter((r) => r.conference === conference);
    const q = search.trim().toLowerCase();
    if (q) filtered = filtered.filter((r) => r.player.toLowerCase().includes(q) || (r.team.toLowerCase().includes(q) || canonicalSchool(r.team).toLowerCase().includes(q)));

    filtered = [...filtered].sort((a, b) => {
      if (STRING_SORT_KEYS.has(sortKey)) {
        const av = (a[sortKey] || "").toString();
        const bv = (b[sortKey] || "").toString();
        return sortDir === "desc" ? bv.localeCompare(av) : av.localeCompare(bv);
      }
      const av = parseFloat(a[sortKey]) || 0;
      const bv = parseFloat(b[sortKey]) || 0;
      return sortDir === "desc" ? bv - av : av - bv;
    });
    return filtered;
  }, [division, category, week, position, conference, search, sortKey, sortDir]);

  // A search shouldn't be scoped to whatever tab happens to be open -- if
  // there's no match in the current division/category, jump to wherever a
  // real match actually lives (any division, any category) instead of
  // just showing an empty table. Debounced so fast typing doesn't cause a
  // tab-flicker on every partial keystroke; only fires once per distinct
  // search value, not on every manual tab click afterward (deps: [search]
  // only, on purpose).
  useEffect(() => {
    const q = search.trim().toLowerCase();
    if (!q) return undefined;
    const timer = setTimeout(() => {
      const matchesCurrent = DATA.some(
        (r) =>
          r.division === division && r.category === category && r.week === week &&
          (r.player.toLowerCase().includes(q) || (r.team.toLowerCase().includes(q) || canonicalSchool(r.team).toLowerCase().includes(q)))
      );
      if (matchesCurrent) return;
      const hit = DATA.find((r) => r.week === "total" && (r.player.toLowerCase().includes(q) || (r.team.toLowerCase().includes(q) || canonicalSchool(r.team).toLowerCase().includes(q))));
      if (hit) {
        setDivision(hit.division);
        setCategory(hit.category);
        setWeek("total");
        setPosition("All");
        setConference("All");
        setSortKey(CATEGORIES[hit.category].leaderKey);
        setSortDir("desc");
      }
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally search-only, see comment above
  }, [search]);

  // Leader callouts at the top: one per LEADER_BOARDS entry, ranked by that
  // board's own sortKey (several boards share the Defense category but
  // rank by a different column -- Sacks, Interceptions, etc.)
  const weeklyLeaders = useMemo(() => {
    return LEADER_BOARDS.map((board) => {
      let catRows = DATA.filter((r) => r.division === division && r.category === board.categoryKey && r.week === week);
      if (conference !== "All") catRows = catRows.filter((r) => r.conference === conference);
      const sorted = [...catRows].sort((a, b) => (parseFloat(b[board.sortKey]) || 0) - (parseFloat(a[board.sortKey]) || 0));
      const col = CATEGORIES[board.categoryKey].columns.find((c) => c.key === board.sortKey);
      return { board, leader: sorted[0], statLabel: col?.label || "" };
    });
  }, [division, week, conference]);

  // Scans the currently open division for whoever actually had the best
  // single-week production most recently. Real single-week rows only exist
  // once a division's scraper has run more than once (see
  // scraper/build_data.py), so this naturally fills in as the season goes
  // on rather than needing any special-casing here.
  const breakoutPerformers = useMemo(() => {
    const weeklyRows = DATA.filter((r) => r.week !== "total" && r.division === division);
    if (weeklyRows.length === 0) return { week: null, entries: [] };
    const latestWeek = weeklyRows.reduce((max, r) => (r.week > max ? r.week : max), weeklyRows[0].week);
    const thisWeek = weeklyRows.filter((r) => r.week === latestWeek);
    const entries = LEADER_BOARDS.map((board) => {
      const catRows = thisWeek.filter((r) => r.category === board.categoryKey);
      const sorted = [...catRows].sort((a, b) => (parseFloat(b[board.sortKey]) || 0) - (parseFloat(a[board.sortKey]) || 0));
      const col = CATEGORIES[board.categoryKey].columns.find((c) => c.key === board.sortKey);
      return { board, leader: sorted[0], statLabel: col?.label || "" };
    }).filter((e) => e.leader);
    return { week: latestWeek, entries };
  }, [division]);

  function handleSort(key) {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir(STRING_SORT_KEYS.has(key) ? "asc" : "desc");
    }
  }

  function handleDivisionChange(d) {
    setDivision(d);
    setConference("All");
    setWeek("total"); // each division has its own set of real weeks, if any
  }

  function handleCategoryChange(key) {
    setCategory(key);
    setPosition("All");
    setSortKey(CATEGORIES[key].leaderKey);
    setSortDir("desc");
  }

  function handleLeaderBoardClick(board) {
    setCategory(board.categoryKey);
    setPosition("All");
    setSortKey(board.sortKey);
    setSortDir("desc");
  }

  function handleBreakoutClick(entry) {
    setConference("All");
    setWeek(entry.leader.week);
    setCategory(entry.board.categoryKey);
    setPosition("All");
    setSortKey(entry.board.sortKey);
    setSortDir("desc");
  }

  return (
    <div
      className="app-shell"
      data-theme={theme}
      style={{
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--bg-page)",
        color: "var(--text-primary)",
        fontFamily: "'Century Gothic', 'Jost', 'Helvetica Neue', Arial, sans-serif",
      }}
    >
      {/* Header -- the gold-to-maroon stripe underneath is the school's
          own colors, kept literal (not the theme-adaptive --accent) so it
          reads the same in both light and dark mode. */}
      <div className="app-header" style={{ flexShrink: 0, position: "relative", padding: "20px var(--gutter) 16px" }}>
        <div
          style={{
            position: "absolute", left: 0, right: 0, bottom: 0, height: 3,
            background: "linear-gradient(90deg, var(--gold), var(--maroon))",
          }}
        />
        <div style={{ maxWidth: "100%", margin: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              {onBack && (
                <button
                  onClick={onBack}
                  title="Back to dashboard"
                  style={{
                    display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
                    background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-secondary)",
                    borderRadius: 5, padding: "8px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  <ArrowLeft size={15} /> Dashboard
                </button>
              )}
              <img src={cmuHelmet} alt="Central Michigan Chippewas helmet" style={{ height: 34, width: "auto", flexShrink: 0 }} />
              <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
                <h1 className="oswald app-title" style={{ fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: "0.01em" }}>
                  Pre-Portal Tracker
                </h1>
                <span className="tracker-subtitle" style={{ color: "var(--text-muted)", fontSize: 14 }}>weekly stats — NAIA · JUCO · D3 · D2 · FCS · FBS</span>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              {onUploadStats && (
                <button
                  onClick={onUploadStats}
                  title="Load NAIA / JUCO stats by hand when the automatic refresh can't reach them"
                  style={{
                    display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
                    background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)",
                    borderRadius: 5, padding: "8px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  <Upload size={14} /> Upload stats
                </button>
              )}
              <button
                onClick={() => setWatchlistOpen(true)}
                style={{
                  display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
                  background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)",
                  borderRadius: 5, padding: "8px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                }}
              >
                <Star size={14} color="var(--accent)" fill={watchlist.players.length ? "var(--accent)" : "none"} />
                Watch List
                {watchlist.players.length > 0 && (
                  <span
                    className="tabular"
                    style={{ background: "var(--accent-bg)", color: "var(--accent)", borderRadius: 999, padding: "1px 7px", fontSize: 11.5 }}
                  >
                    {watchlist.players.length}
                  </span>
                )}
              </button>
              <ThemeSwitcher theme={theme} onChange={setTheme} />
            </div>
          </div>

        </div>
      </div>

      {watchlistOpen && (
        <WatchListPanel
          watchlist={watchlist}
          portalStatus={portalStatus}
          onClose={() => setWatchlistOpen(false)}
          onSelectPlayer={(p) => {
            watchlist.markSeen(p.id, p.player, p.team);
            setSelectedPlayer({ player: p.player, team: p.team, division: p.division, position: p.position });
          }}
        />
      )}
      {selectedPlayer && (
        <PlayerDetailModal sel={selectedPlayer} onClose={() => setSelectedPlayer(null)} watchlist={watchlist} portalStatus={portalStatus} />
      )}

      {/* Division tabs -- frozen along with the header above; everything
          below (breakout strip, live banner, filters, table) scrolls as
          one region beneath this. */}
      <div style={{ flexShrink: 0, padding: "16px var(--gutter) 0" }}>
        <div className="division-tabs" style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)" }}>
          {DIVISIONS.map((d) => (
            <button
              key={d}
              onClick={() => handleDivisionChange(d)}
              className="oswald"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "10px 18px 12px",
                fontSize: 15,
                fontWeight: 600,
                color: division === d ? "var(--accent)" : "var(--text-muted)",
                borderBottom: division === d ? "2px solid var(--accent)" : "2px solid transparent",
                marginBottom: -1,
              }}
              title={DIVISION_LABEL[d]}
            >
              {d}
            </button>
          ))}
        </div>
        <div style={{ position: "relative", marginTop: 14, maxWidth: 640 }}>
          <Search size={18} color="var(--text-faint)" style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search player or school…"
            style={{
              width: "100%", background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)",
              borderRadius: 8, padding: "13px 42px", fontSize: 15.5, fontFamily: "inherit",
            }}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              title="Clear search"
              style={{
                position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", padding: 4, lineHeight: 0,
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Everything from here down (breakout strip, live banner, weekly
          leaders, filters, and the table itself) scrolls together as one
          region, so the table's own sticky header (see Th's sticky prop)
          takes over freezing the column headers once scrolled past the
          rest of this chrome. */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "0 var(--gutter) var(--gutter)" }}>
        {/* Breakout performers -- scoped to the currently open division tab,
            scanning for whoever actually had the best week most recently.
            The top spacing lives here (not as padding-top on the scroll
            container above) because a sticky element's top:0 resolves
            against the container's padding edge -- padding-top there would
            leave a gap the size of that padding once scrolled past it,
            since that padding-top has already scrolled out of view. */}
        <div style={{ marginBottom: 14, paddingTop: 16 }}>
          <span style={{ fontSize: 11, color: "var(--text-faint)", letterSpacing: "0.03em", display: "flex", alignItems: "center", gap: 5, marginBottom: 6 }}>
            <TrendingUp size={12} color="var(--accent)" />
            {DIVISION_LABEL[division]} breakout this week{breakoutPerformers.week ? ` — ${weekLabel(breakoutPerformers.week)}` : ""}
          </span>
          {breakoutPerformers.entries.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--text-faint)", padding: "8px 0" }}>
              No real single-week numbers yet for {DIVISION_LABEL[division]} — these show up once this division's weekly scrape has run more than once this season.
            </div>
          ) : (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {breakoutPerformers.entries.map(({ board, leader, statLabel }) => (
                <button
                  key={board.key}
                  onClick={() => handleBreakoutClick({ board, leader })}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2,
                    background: "var(--bg-surface)", border: "1px solid var(--success-border)", borderRadius: 5,
                    padding: "8px 14px", cursor: "pointer", textAlign: "left", minWidth: 148,
                  }}
                >
                  <span className="oswald" style={{ fontSize: 11, color: "var(--success)", fontWeight: 500 }}>
                    {board.label}
                  </span>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)" }}>{leader.player}</span>
                  <span className="tabular" style={{ fontSize: 12.5, color: "var(--accent)" }}>
                    {leader[board.sortKey]} {statLabel} this week
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Live / sample banner */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
            padding: "7px 12px",
            borderRadius: 5,
            background: isLiveView ? "var(--success-bg)" : "var(--warning-bg)",
            border: isLiveView ? "1px solid var(--success-border)" : "1px solid var(--warning-border)",
            fontSize: 13,
            color: isLiveView ? "var(--success)" : "var(--warning)",
          }}
        >
          {isLiveView ? (
            <>
              <BadgeCheck size={15} />
              <span>Live data — {DIVISION_LABEL[division]}, season totals to date (source: {{ NAIA: "NAIA", JUCO: "conference sites" }[division] || "NCAA"})</span>
            </>
          ) : (
            <>
              <FlaskConical size={15} />
              <span>Sample data — this division isn't connected to a live source yet</span>
            </>
          )}
        </div>

        {/* Weekly leaders strip */}
        <div style={{ marginBottom: 14 }}>
          <span style={{ fontSize: 11, color: "var(--text-faint)", letterSpacing: "0.03em", display: "block", marginBottom: 6 }}>
            {weekLabel(week)} leaders — {conference === "All" ? DIVISION_LABEL[division] : conference}
          </span>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {weeklyLeaders.map(({ board, leader, statLabel }) => {
              const active = category === board.categoryKey && sortKey === board.sortKey;
              return (
              <button
                key={board.key}
                onClick={() => handleLeaderBoardClick(board)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 2,
                  background: active ? "var(--accent-bg)" : "var(--bg-surface)",
                  border: active ? "1px solid var(--accent)" : "1px solid var(--border)",
                  borderRadius: 5,
                  padding: "6px 14px",
                  cursor: "pointer",
                  textAlign: "left",
                  minWidth: 148,
                }}
              >
                <span className="oswald" style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>
                  {board.label}
                </span>
                {leader ? (
                  <>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)" }}>{leader.player}</span>
                    <span className="tabular" style={{ fontSize: 12.5, color: "var(--accent)" }}>
                      {leader[board.sortKey]} {statLabel}
                    </span>
                  </>
                ) : (
                  <span style={{ fontSize: 13, color: "var(--text-faint)" }}>No data</span>
                )}
              </button>
              );
            })}
          </div>
        </div>

        {/* Category / position / conference / week row */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center", marginBottom: 12 }}>
          <FilterGroup label="Stat category">
            <select value={category} onChange={(e) => handleCategoryChange(e.target.value)} style={selectStyle}>
              {Object.entries(CATEGORIES).map(([key, c]) => (
                <option key={key} value={key}>
                  {c.label}
                </option>
              ))}
            </select>
          </FilterGroup>

          <FilterGroup label="Position">
            <select value={position} onChange={(e) => setPosition(e.target.value)} style={selectStyle}>
              {positions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </FilterGroup>

          <FilterGroup label="Conference">
            <select value={conference} onChange={(e) => setConference(e.target.value)} style={selectStyle}>
              {conferences.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </FilterGroup>

          <FilterGroup label="Week">
            <select
              value={week}
              onChange={(e) => setWeek(weekOptions.find((w) => String(w) === e.target.value) ?? "total")}
              style={selectStyle}
              title={weekOptions.length === 1 ? "No single-week data yet for this division -- check back after the next weekly update" : undefined}
            >
              {weekOptions.map((w) => (
                <option key={w} value={w}>
                  {weekLabel(w)}
                </option>
              ))}
            </select>
          </FilterGroup>

          <span style={{ marginLeft: "auto", color: "var(--text-faint)", fontSize: 13 }}>
            {rows.length} player{rows.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Table -- a full-width grid, spreadsheet-style, with the header
            row pinned via `position: sticky` on each <th>. Its scrolling
            ancestor is the outer region above (no overflow set on this
            div itself), so the header freezes there once scrolled past
            the breakout strip/banner/filters, not at this div's own
            bounds. */}
        <div style={{ border: "1px solid var(--border)", borderRadius: 6 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--bg-surface)" }}>
                <Th label="Player" sticky />
                <Th label="Team" sticky sortable active={sortKey === "team"} dir={sortDir} onClick={() => handleSort("team")} />
                <Th label="Conf" sticky sortable active={sortKey === "conference"} dir={sortDir} onClick={() => handleSort("conference")} />
                <Th label="Pos" sticky />
                {cat.columns.map((col) => (
                  <Th
                    key={col.key}
                    label={col.label}
                    align="right"
                    sortable
                    sticky
                    active={sortKey === (col.sortKey || col.key)}
                    dir={sortDir}
                    onClick={() => handleSort(col.sortKey || col.key)}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const isLeader = i === 0 && sortDir === "desc";
                return (
                  <tr
                    key={r.id}
                    style={{
                      background: isLeader ? "var(--accent-bg)" : i % 2 === 0 ? "var(--bg-panel)" : "var(--bg-page)",
                      borderTop: "1px solid var(--border-subtle)",
                      borderLeft: isLeader ? "2px solid var(--accent)" : "2px solid transparent",
                    }}
                  >
                    <td style={{ ...tdStyle, fontWeight: 600, color: "var(--text-primary)" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        {isLeader && <Crown size={13} color="var(--accent)" />}
                        <button
                          className="watch-toggle"
                          onClick={(e) => {
                            e.stopPropagation();
                            const watched = watchlist.players.find((p) => p.player === r.player && p.team === r.team);
                            if (watched) confirmRemoveFromWatchlist(watchlist, watched.id, r.player);
                            else watchlist.addPlayer({ player: r.player, team: r.team, division, position: r.position });
                          }}
                          title={watchlist.isWatched(r.player, r.team) ? "Remove from watch list" : "Add to watch list"}
                          style={watchToggleButtonStyle}
                        >
                          {watchlist.isWatched(r.player, r.team) ? <X size={16} color="var(--accent)" /> : <Plus size={16} color="var(--accent)" />}
                        </button>
                        <span
                          className="player-name"
                          onClick={() => setSelectedPlayer({ player: r.player, team: r.team, division, position: r.position })}
                          title="View full stats"
                        >
                          {r.player}
                        </span>
                        {portalStatus.isInPortal(r.player, r.team) && (
                          <span title="Entered the transfer portal" style={{ display: "inline-flex", color: "var(--success)", lineHeight: 0 }}>
                            <CheckCircle2 size={16} />
                          </span>
                        )}
                        {r.sample && (
                          <span
                            title="Sample data"
                            style={{
                              fontSize: 9.5,
                              color: "var(--warning)",
                              border: "1px solid var(--warning-border)",
                              borderRadius: 3,
                              padding: "1px 4px",
                              fontWeight: 600,
                              letterSpacing: "0.02em",
                            }}
                          >
                            SAMPLE
                          </span>
                        )}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, color: "var(--text-muted)" }}>{canonicalSchool(r.team)}</td>
                    <td style={{ ...tdStyle, color: "var(--text-muted)", fontSize: 12.5 }}>{r.conference}</td>
                    <td style={{ ...tdStyle, color: "var(--accent)", fontWeight: 600 }} className="oswald">
                      {r.position}
                    </td>
                    {cat.columns.map((col) => (
                      <td key={col.key} className="tabular" style={{ ...tdStyle, textAlign: "right" }}>
                        {r[col.key]}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4 + cat.columns.length} style={{ ...tdStyle, textAlign: "center", color: "var(--text-faint)", padding: 32 }}>
                    No players match this filter for the selected week.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function FilterGroup({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, color: "var(--text-faint)", letterSpacing: "0.03em" }}>{label}</span>
      {children}
    </div>
  );
}

function Th({ label, align = "left", sortable, active, dir, onClick, sticky }) {
  return (
    <th
      onClick={sortable ? onClick : undefined}
      className="oswald"
      style={{
        padding: "10px 16px",
        textAlign: align,
        fontSize: 13,
        fontWeight: 600,
        color: active ? "var(--accent)" : "var(--text-muted)",
        cursor: sortable ? "pointer" : "default",
        userSelect: "none",
        borderBottom: "1px solid var(--border)",
        borderRight: "1px solid var(--border-subtle)",
        whiteSpace: "nowrap",
        ...(sticky ? { position: "sticky", top: 0, background: "var(--bg-surface)", zIndex: 1 } : null),
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: align === "right" ? "flex-end" : "flex-start" }}>
        {label}
        {sortable &&
          (active ? (
            dir === "desc" ? <ChevronDown size={13} /> : <ChevronUp size={13} />
          ) : (
            <ChevronsUpDown size={12} style={{ opacity: 0.4 }} />
          ))}
      </span>
    </th>
  );
}

const tdStyle = { padding: "9px 16px", fontSize: 14, color: "var(--text-secondary)", borderRight: "1px solid var(--border-faint)" };

const selectStyle = {
  background: "var(--bg-surface)",
  color: "var(--text-primary)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  padding: "7px 10px",
  fontSize: 14,
  minWidth: 140,
  cursor: "pointer",
};

// Loads any hand-uploaded stats before the tracker draws (so its filters see them), and re-draws it after an upload.
export default function Gridline(props) {
  const [theme] = useTheme();
  const [ready, setReady] = useState(false);
  const [uploads, setUploads] = useState([]);
  const [version, setVersion] = useState(0);
  const [modal, setModal] = useState(false);

  const reload = useCallback(async () => {
    try {
      await loadRealStats();
      prepareBundled();
    } catch (err) {
      console.error("Couldn't load the stats data", err);
    }
    try {
      const found = await loadUploads();
      applyUploads(found);
      setUploads(found);
      setVersion((v) => v + 1);
    } catch (err) {
      console.error("Couldn't load uploaded stats", err); // the tracker still works from the bundled data
    }
    setReady(true);
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  if (!ready) {
    return (
      <div className="app-shell" data-theme={theme} style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-page)", color: "var(--text-faint)" }}>
        Loading…
      </div>
    );
  }
  return (
    <>
      <GridlineMain key={version} {...props} onUploadStats={() => setModal(true)} />
      {modal && (
        <div className="app-shell" data-theme={theme} style={{ display: "contents" }}>
          <StatsUploadModal uploads={uploads} onChanged={reload} onClose={() => setModal(false)} />
        </div>
      )}
    </>
  );
}
