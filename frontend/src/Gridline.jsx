import { useState, useMemo, useEffect, useRef } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown, Crown, BadgeCheck, FlaskConical, Star, X, Plus, ExternalLink } from "lucide-react";
import realStats from "./data/real-stats.json";
import cmuHelmet from "./assets/cmu-helmet.png";

const DIVISIONS = ["NAIA", "JUCO", "D2", "FCS", "FBS"];

// Same canonical 9-value set every scraper normalizes to (see
// POSITION_MAP in scraper/ncaa_api.py) -- the watch list groups by these.
const WATCH_POSITIONS = ["ATH", "QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "SAF"];

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

const DATA = realStats;

// None of the four sources sends completion % directly -- they all report
// a "comp/att" string (compAtt) plus season totals, so it's derived once
// here rather than duplicated across ncaa_api.py/naia.py/juco.py/cccaa.py.
for (const r of DATA) {
  if (r.category === "passing" && r.compAtt) {
    const [comp, att] = r.compAtt.split("/").map(Number);
    r.pct = att > 0 ? `${((comp / att) * 100).toFixed(1)}%` : "0.0%";
  }
}

const DIVISION_LABEL = { NAIA: "NAIA", JUCO: "Junior College", D2: "NCAA Division II", FCS: "FCS", FBS: "FBS" };
const LIVE_DIVISIONS = new Set(["NAIA", "JUCO", "D2", "FCS", "FBS"]); // all five are real data now

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

function useWatchlist() {
  const [db, setDb] = useState(null);
  const [players, setPlayers] = useState([]);
  const [checkedAvailability, setCheckedAvailability] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = null;

    (async () => {
      const canUse = typeof window !== "undefined" && window.claude && typeof window.claude.use === "function";
      const dbNamespace = canUse ? await window.claude.use("db") : null;
      if (cancelled) return;
      setDb(dbNamespace);
      setCheckedAvailability(true);
      if (dbNamespace) {
        unsubscribe = dbNamespace.collection("watchlist").orderBy("player", "asc").onSnapshot(
          (snap) => setPlayers(snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }))),
          () => setPlayers([])
        );
      }
    })();

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, []);

  async function addPlayer({ player, team, division, position }) {
    if (!db || !player.trim()) return;
    await db.collection("watchlist").add({
      player: player.trim(),
      team: (team || "").trim(),
      division: division || "",
      position: position || "",
      pipelined: false,
      notes: "",
      hometown: "",
      eligibility: "",
      snapCount: "",
      addedAt: new Date().toISOString(),
    });
  }

  async function removePlayer(id) {
    if (!db) return;
    await db.doc(`watchlist/${id}`).delete();
  }

  async function updateField(id, field, value) {
    if (!db) return;
    await db.doc(`watchlist/${id}`).update({ [field]: value });
  }

  const watchedKeys = useMemo(() => new Set(players.map((p) => `${p.player}::${p.team}`)), [players]);
  function isWatched(player, team) {
    return watchedKeys.has(`${player}::${team}`);
  }

  return { available: !!db, checkedAvailability, players, addPlayer, removePlayer, updateField, isWatched };
}

const pillStyle = (active) => ({
  background: active ? "#20281F" : "#1A2126",
  border: active ? "1px solid #C89B3C" : "1px solid #2A333A",
  color: active ? "#C89B3C" : "#8B959C",
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
  background: "#12171A",
  border: "1px solid #2A333A",
  borderRadius: 4,
  padding: "6px 8px",
  fontSize: 13,
  color: "#EDEAE0",
  fontFamily: "inherit",
};
// Compact variant for an input sitting inside a table cell (watch list grid).
const cellInputStyle = { ...fieldInputStyle, padding: "4px 6px", fontSize: 12.5, background: "#12171A" };
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

// One editable row of the watch list grid. Each text field keeps local
// state so keystrokes don't round-trip to the db on every character --
// it only commits (onUpdate) on blur, same pattern as the main scraped
// table's cells are read-only render of committed data.
function WatchListRow({ p, onRemove, onUpdate, onSelect, style }) {
  const [notes, setNotes] = useState(p.notes || "");
  const [hometown, setHometown] = useState(p.hometown || "");
  const [snapCount, setSnapCount] = useState(p.snapCount || "");
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

  return (
    <tr style={style}>
      <td style={{ ...tdStyle, fontWeight: 600, color: "#EDEAE0" }}>
        <span className="player-name" onClick={() => onSelect(p)} title="View full stats">
          {p.player}
        </span>
      </td>
      <td style={{ ...tdStyle, color: "#8B959C" }}>{p.team || "—"}</td>
      <td style={{ ...tdStyle, color: "#8B959C", fontSize: 12.5 }}>{p.division || "—"}</td>
      <td style={{ ...tdStyle, color: "#A23B3B", fontWeight: 600 }} className="oswald">
        {p.position || "—"}
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
      <td style={tdStyle}>
        <input
          value={hometown}
          onChange={(e) => setHometown(e.target.value)}
          onBlur={() => onUpdate("hometown", hometown)}
          placeholder="—"
          style={cellInputStyle}
        />
      </td>
      <td style={tdStyle}>
        <input
          value={snapCount}
          onChange={(e) => setSnapCount(e.target.value)}
          onBlur={() => onUpdate("snapCount", snapCount)}
          placeholder="e.g. 512 (PFF)"
          style={cellInputStyle}
        />
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
          style={{ background: "none", border: "none", color: "#5D666C", cursor: "pointer", padding: 2, lineHeight: 0 }}
        >
          <X size={15} />
        </button>
      </td>
    </tr>
  );
}

const WATCHLIST_COLUMNS = ["Player", "Team", "Division", "Pos", "Eligibility", "Pipelined?", "Hometown", "Snap Count", "Notes", ""];

// Full-screen overlay -- same spreadsheet grid language as the main stats
// table (sticky header, gridlines) instead of a narrow sidebar, so editing
// a dozen watched players' notes/hometown/eligibility doesn't feel cramped.
function WatchListPanel({ watchlist, onClose, onSelectPlayer }) {
  const [name, setName] = useState("");
  const [team, setTeam] = useState("");
  const [position, setPosition] = useState(WATCH_POSITIONS[0]);
  const [positionTab, setPositionTab] = useState("All");
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

  const visiblePlayers = positionTab === "All" ? watchlist.players : watchlist.players.filter((p) => p.position === positionTab);
  const countFor = (pos) => (pos === "All" ? watchlist.players.length : watchlist.players.filter((p) => p.position === pos).length);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#12171A",
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          flexShrink: 0,
          padding: "16px 32px",
          borderBottom: "1px solid #2A333A",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <h2 className="oswald" style={{ fontSize: 22, margin: 0, fontWeight: 700, color: "#EDEAE0" }}>
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
                background: "#20281F", border: "1px solid #C89B3C", color: "#C89B3C",
                borderRadius: 4, padding: "7px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}
            >
              <Plus size={14} /> Add
            </button>
          </form>
        )}

        <button onClick={onClose} style={{ background: "none", border: "none", color: "#8B959C", cursor: "pointer", padding: 4, lineHeight: 0 }}>
          <X size={22} />
        </button>
      </div>

      {!watchlist.available ? (
        <div style={{ padding: 20, color: "#8B959C", fontSize: 13, lineHeight: 1.5 }}>
          {watchlist.checkedAvailability
            ? "The watch list only works on the published page, not this local preview."
            : "Loading…"}
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, padding: "16px 32px 32px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", gap: 4, borderBottom: "1px solid #2A333A", marginBottom: 16, flexWrap: "wrap", flexShrink: 0 }}>
            {["All", ...WATCH_POSITIONS].map((pos) => (
              <button
                key={pos}
                onClick={() => setPositionTab(pos)}
                className="oswald"
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  background: "none", border: "none", cursor: "pointer",
                  padding: "8px 14px 10px", fontSize: 14, fontWeight: 600,
                  color: positionTab === pos ? "#C89B3C" : "#8B959C",
                  borderBottom: positionTab === pos ? "2px solid #C89B3C" : "2px solid transparent",
                  marginBottom: -1,
                }}
              >
                {pos}
                <span
                  className="tabular"
                  style={{
                    background: positionTab === pos ? "#20281F" : "#1A2126",
                    color: positionTab === pos ? "#C89B3C" : "#5D666C",
                    borderRadius: 999, padding: "1px 6px", fontSize: 11,
                  }}
                >
                  {countFor(pos)}
                </span>
              </button>
            ))}
          </div>

          {visiblePlayers.length === 0 ? (
            <div style={{ color: "#5D666C", fontSize: 13 }}>
              {watchlist.players.length === 0 ? "No players on the watch list yet." : `No ${positionTab} players on the watch list yet.`}
            </div>
          ) : (
            <div style={{ flex: 1, minHeight: 0, border: "1px solid #2A333A", borderRadius: 6, overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#1A2126" }}>
                    {WATCHLIST_COLUMNS.map((label) => (
                      <Th key={label} label={label} sticky />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visiblePlayers.map((p, i) => (
                    <WatchListRow
                      key={p.id}
                      p={p}
                      style={{ background: i % 2 === 0 ? "#151B1F" : "#12171A", borderTop: "1px solid #212A2F" }}
                      onRemove={() => watchlist.removePlayer(p.id)}
                      onUpdate={(field, value) => watchlist.updateField(p.id, field, value)}
                      onSelect={onSelectPlayer}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Shows every tracked stat line for one player across all categories they
// appear in (a QB who also carries the ball shows both Passing and Rushing,
// for example) -- opened by clicking a player's name in the main grid.
function PlayerDetailModal({ sel, onClose, watchlist }) {
  const rows = useMemo(
    () => DATA.filter((r) => r.player === sel.player && r.team === sel.team && r.division === sel.division),
    [sel.player, sel.team, sel.division]
  );
  const first = rows[0];
  const watched = watchlist.players.find((p) => p.player === sel.player && p.team === sel.team);

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
          background: "#151B1F",
          border: "1px solid #2A333A",
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
            borderBottom: "1px solid #2A333A",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            position: "sticky",
            top: 0,
            background: "#151B1F",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h2 className="oswald" style={{ fontSize: 20, margin: 0, fontWeight: 700 }}>
                {sel.player}
              </h2>
              <button
                className="watch-toggle"
                onClick={() => (watched ? watchlist.removePlayer(watched.id) : watchlist.addPlayer(sel))}
                title={watched ? "Remove from watch list" : "Add to watch list"}
                style={watchToggleButtonStyle}
              >
                {watched ? <X size={18} color="#C89B3C" /> : <Plus size={18} color="#C89B3C" />}
              </button>
            </div>
            <div style={{ fontSize: 13, color: "#8B959C", marginTop: 3 }}>
              {sel.team}
              {first ? ` · ${first.conference} · ${first.position} · ${DIVISION_LABEL[sel.division] || sel.division}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <a
              href={playerSearchUrl(sel.player, sel.team, first?.position || sel.position)}
              target="_blank"
              rel="noopener noreferrer"
              title="Search this player"
              style={{
                display: "flex", alignItems: "center", gap: 7, flexShrink: 0,
                background: "#20281F", border: "1px solid #C89B3C", color: "#C89B3C",
                borderRadius: 5, padding: "10px 16px", fontSize: 14, fontWeight: 700,
                textDecoration: "none", whiteSpace: "nowrap",
              }}
            >
              <ExternalLink size={16} /> Search
            </a>
            <button onClick={onClose} style={{ background: "none", border: "none", color: "#8B959C", cursor: "pointer", padding: 4, lineHeight: 0 }}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 20 }}>
          {rows.length === 0 && <div style={{ color: "#5D666C", fontSize: 13 }}>No tracked stats found for this player.</div>}
          {Object.keys(CATEGORIES).map((key) => {
            const catRows = byCategory[key];
            if (!catRows) return null;
            const cat = CATEGORIES[key];
            return (
              <div key={key}>
                <div
                  className="oswald"
                  style={{ fontSize: 12.5, fontWeight: 600, color: "#C89B3C", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}
                >
                  {cat.label}
                </div>
                <div style={{ border: "1px solid #2A333A", borderRadius: 6, overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "#1A2126" }}>
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
                        <tr key={r.id} style={{ borderTop: "1px solid #212A2F" }}>
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

const detailThStyle = { padding: "8px 12px", fontSize: 11.5, fontWeight: 600, color: "#8B959C", textAlign: "left", whiteSpace: "nowrap" };
const detailTdStyle = { padding: "7px 12px", fontSize: 13, color: "#C7CDD1" };

// ---------- Component ----------

export default function Gridline() {
  const [division, setDivision] = useState("NAIA");
  const [category, setCategory] = useState("passing");
  const [week, setWeek] = useState("total");
  const [position, setPosition] = useState("All");
  const [conference, setConference] = useState("All");
  const [sortKey, setSortKey] = useState("yards");
  const [sortDir, setSortDir] = useState("desc");
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const watchlist = useWatchlist();

  const cat = CATEGORIES[category];
  const isLiveView = LIVE_DIVISIONS.has(division);
  const positions = useMemo(() => ["All", ...positionsFor(division, category)], [division, category]);
  const conferences = useMemo(() => ["All", ...conferencesFor(division)], [division]);
  const weekOptions = useMemo(() => weeksFor(division), [division]);

  const rows = useMemo(() => {
    let filtered = DATA.filter((r) => r.division === division && r.category === category && r.week === week);
    if (position !== "All") filtered = filtered.filter((r) => r.position === position);
    if (conference !== "All") filtered = filtered.filter((r) => r.conference === conference);

    filtered = [...filtered].sort((a, b) => {
      const av = parseFloat(a[sortKey]) || 0;
      const bv = parseFloat(b[sortKey]) || 0;
      return sortDir === "desc" ? bv - av : av - bv;
    });
    return filtered;
  }, [division, category, week, position, conference, sortKey, sortDir]);

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

  function handleSort(key) {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
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

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "#12171A",
        color: "#EDEAE0",
        fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        .oswald { font-family: 'Oswald', sans-serif; }
        .tabular { font-variant-numeric: tabular-nums; }
        ::selection { background: #C89B3C; color: #12171A; }
        tbody tr:hover { background: #1E262B !important; }
        .player-name { cursor: pointer; color: inherit; text-decoration: none; }
        .player-name:hover { color: #C89B3C; text-decoration: underline; }
        .watch-toggle:hover { background: rgba(200,155,60,0.18); }
      `}</style>

      {/* Header */}
      <div style={{ flexShrink: 0, borderBottom: "1px solid #2A333A", padding: "20px 32px 16px" }}>
        <div style={{ maxWidth: "100%", margin: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <img src={cmuHelmet} alt="Central Michigan Chippewas helmet" style={{ height: 34, width: "auto" }} />
              <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
                <h1 className="oswald" style={{ fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: "0.01em" }}>
                  Central Michigan Pre-Portal Tracker
                </h1>
                <span style={{ color: "#8B959C", fontSize: 14 }}>weekly stats — NAIA · JUCO · D2 · FCS · FBS</span>
              </div>
            </div>
            <button
              onClick={() => setWatchlistOpen(true)}
              style={{
                display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
                background: "#1A2126", border: "1px solid #2A333A", color: "#EDEAE0",
                borderRadius: 5, padding: "8px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}
            >
              <Star size={14} color="#C89B3C" fill={watchlist.players.length ? "#C89B3C" : "none"} />
              Watch List
              {watchlist.players.length > 0 && (
                <span
                  className="tabular"
                  style={{ background: "#20281F", color: "#C89B3C", borderRadius: 999, padding: "1px 7px", fontSize: 11.5 }}
                >
                  {watchlist.players.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {watchlistOpen && (
        <WatchListPanel
          watchlist={watchlist}
          onClose={() => setWatchlistOpen(false)}
          onSelectPlayer={(p) => setSelectedPlayer({ player: p.player, team: p.team, division: p.division, position: p.position })}
        />
      )}
      {selectedPlayer && <PlayerDetailModal sel={selectedPlayer} onClose={() => setSelectedPlayer(null)} watchlist={watchlist} />}

      <div style={{ flexShrink: 0, padding: "16px 32px 0" }}>
        {/* Division tabs */}
        <div style={{ display: "flex", gap: 4, borderBottom: "1px solid #2A333A", marginBottom: 14 }}>
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
                color: division === d ? "#C89B3C" : "#8B959C",
                borderBottom: division === d ? "2px solid #C89B3C" : "2px solid transparent",
                marginBottom: -1,
              }}
              title={DIVISION_LABEL[d]}
            >
              {d}
            </button>
          ))}
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
            background: isLiveView ? "#1B2A1E" : "#241D16",
            border: isLiveView ? "1px solid #33502F" : "1px solid #4A3A22",
            fontSize: 13,
            color: isLiveView ? "#8FCB86" : "#D9A85C",
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
          <span style={{ fontSize: 11, color: "#5D666C", letterSpacing: "0.03em", display: "block", marginBottom: 6 }}>
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
                  background: active ? "#20281F" : "#1A2126",
                  border: active ? "1px solid #C89B3C" : "1px solid #2A333A",
                  borderRadius: 5,
                  padding: "6px 14px",
                  cursor: "pointer",
                  textAlign: "left",
                  minWidth: 148,
                }}
              >
                <span className="oswald" style={{ fontSize: 11, color: "#8B959C", fontWeight: 500 }}>
                  {board.label}
                </span>
                {leader ? (
                  <>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: "#EDEAE0" }}>{leader.player}</span>
                    <span className="tabular" style={{ fontSize: 12.5, color: "#C89B3C" }}>
                      {leader[board.sortKey]} {statLabel}
                    </span>
                  </>
                ) : (
                  <span style={{ fontSize: 13, color: "#5D666C" }}>No data</span>
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

          <span style={{ marginLeft: "auto", color: "#5D666C", fontSize: 13 }}>
            {rows.length} player{rows.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Table -- a full-width grid that scrolls in place, spreadsheet-style,
          with the header row pinned via `position: sticky` on each <th>
          (sticky on <thead> itself is unreliable across browsers). */}
      <div style={{ flex: 1, minHeight: 0, padding: "0 32px 16px", display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, minHeight: 0, border: "1px solid #2A333A", borderRadius: 6, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#1A2126" }}>
                <Th label="Player" sticky />
                <Th label="Team" sticky />
                <Th label="Conf" sticky />
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
                      background: isLeader ? "#20281F" : i % 2 === 0 ? "#151B1F" : "#12171A",
                      borderTop: "1px solid #212A2F",
                      borderLeft: isLeader ? "2px solid #C89B3C" : "2px solid transparent",
                    }}
                  >
                    <td style={{ ...tdStyle, fontWeight: 600, color: "#EDEAE0" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        {isLeader && <Crown size={13} color="#C89B3C" />}
                        <button
                          className="watch-toggle"
                          onClick={(e) => {
                            e.stopPropagation();
                            const watched = watchlist.players.find((p) => p.player === r.player && p.team === r.team);
                            if (watched) watchlist.removePlayer(watched.id);
                            else watchlist.addPlayer({ player: r.player, team: r.team, division, position: r.position });
                          }}
                          title={watchlist.isWatched(r.player, r.team) ? "Remove from watch list" : "Add to watch list"}
                          style={watchToggleButtonStyle}
                        >
                          {watchlist.isWatched(r.player, r.team) ? <X size={16} color="#C89B3C" /> : <Plus size={16} color="#C89B3C" />}
                        </button>
                        <span
                          className="player-name"
                          onClick={() => setSelectedPlayer({ player: r.player, team: r.team, division, position: r.position })}
                          title="View full stats"
                        >
                          {r.player}
                        </span>
                        {r.sample && (
                          <span
                            title="Sample data"
                            style={{
                              fontSize: 9.5,
                              color: "#D9A85C",
                              border: "1px solid #4A3A22",
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
                    <td style={{ ...tdStyle, color: "#8B959C" }}>{r.team}</td>
                    <td style={{ ...tdStyle, color: "#8B959C", fontSize: 12.5 }}>{r.conference}</td>
                    <td style={{ ...tdStyle, color: "#A23B3B", fontWeight: 600 }} className="oswald">
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
                  <td colSpan={4 + cat.columns.length} style={{ ...tdStyle, textAlign: "center", color: "#5D666C", padding: 32 }}>
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
      <span style={{ fontSize: 11, color: "#5D666C", letterSpacing: "0.03em" }}>{label}</span>
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
        color: active ? "#C89B3C" : "#8B959C",
        cursor: sortable ? "pointer" : "default",
        userSelect: "none",
        borderBottom: "1px solid #2A333A",
        borderRight: "1px solid #212A2F",
        whiteSpace: "nowrap",
        ...(sticky ? { position: "sticky", top: 0, background: "#1A2126", zIndex: 1 } : null),
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

const tdStyle = { padding: "9px 16px", fontSize: 14, color: "#C7CDD1", borderRight: "1px solid #1C2429" };

const selectStyle = {
  background: "#1A2126",
  color: "#EDEAE0",
  border: "1px solid #2A333A",
  borderRadius: 4,
  padding: "7px 10px",
  fontSize: 14,
  minWidth: 140,
  cursor: "pointer",
};
