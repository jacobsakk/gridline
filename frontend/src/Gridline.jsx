import { useState, useMemo } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown, Crown, BadgeCheck, FlaskConical } from "lucide-react";
import realStats from "./data/real-stats.json";
import cmuHelmet from "./assets/cmu-helmet.png";

const DIVISIONS = ["NAIA", "JUCO", "D2", "FCS"];

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

// leaderKey = the stat used to rank "leader" for this category
const CATEGORIES = {
  passing: {
    label: "Passing",
    positions: ["QB"],
    leaderKey: "yards",
    columns: [
      { key: "games", label: "G" },
      { key: "compAtt", label: "C/ATT", sortKey: "att" },
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
    positions: ["WR", "RB"],
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
const DIVISION_LABEL = { NAIA: "NAIA", JUCO: "Junior College", D2: "NCAA Division II", FCS: "FCS" };
const LIVE_DIVISIONS = new Set(["NAIA", "JUCO", "D2", "FCS"]); // all four are real data now

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

// ---------- Component ----------

export default function Gridline() {
  const [division, setDivision] = useState("NAIA");
  const [category, setCategory] = useState("passing");
  const [week, setWeek] = useState("total");
  const [position, setPosition] = useState("All");
  const [conference, setConference] = useState("All");
  const [sortKey, setSortKey] = useState("yards");
  const [sortDir, setSortDir] = useState("desc");

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
        minHeight: "100vh",
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
      `}</style>

      {/* Header */}
      <div style={{ borderBottom: "1px solid #2A333A", padding: "28px 32px 22px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <img src={cmuHelmet} alt="Central Michigan Chippewas helmet" style={{ height: 44, width: "auto" }} />
            <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
              <h1 className="oswald" style={{ fontSize: 34, fontWeight: 700, margin: 0, letterSpacing: "0.01em" }}>
                Central Michigan Stat Tracker
              </h1>
              <span style={{ color: "#8B959C", fontSize: 15 }}>weekly stats — NAIA · JUCO · D2 · FCS</span>
            </div>
          </div>
          <p style={{ margin: "6px 0 0", color: "#8B959C", fontSize: 14, maxWidth: 620, lineHeight: 1.5 }}>
            NAIA, JUCO, D2, and FCS are all live data (season totals to date), pulled directly
            from each division's own stats feed.
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "22px 32px 0" }}>
        {/* Division tabs */}
        <div style={{ display: "flex", gap: 4, borderBottom: "1px solid #2A333A", marginBottom: 20 }}>
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
            marginBottom: 18,
            padding: "8px 12px",
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
        <div style={{ marginBottom: 24 }}>
          <span style={{ fontSize: 11, color: "#5D666C", letterSpacing: "0.03em", display: "block", marginBottom: 8 }}>
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
                  padding: "8px 14px",
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
        <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center", marginBottom: 22 }}>
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

      {/* Table */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 32px 60px" }}>
        <div style={{ border: "1px solid #2A333A", borderRadius: 6, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#1A2126" }}>
                <Th label="Player" />
                <Th label="Team" />
                <Th label="Conf" />
                <Th label="Pos" />
                {cat.columns.map((col) => (
                  <Th
                    key={col.key}
                    label={col.label}
                    align="right"
                    sortable
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
                        {r.player}
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

function Th({ label, align = "left", sortable, active, dir, onClick }) {
  return (
    <th
      onClick={sortable ? onClick : undefined}
      className="oswald"
      style={{
        padding: "12px 16px",
        textAlign: align,
        fontSize: 13,
        fontWeight: 600,
        color: active ? "#C89B3C" : "#8B959C",
        cursor: sortable ? "pointer" : "default",
        userSelect: "none",
        borderBottom: "1px solid #2A333A",
        whiteSpace: "nowrap",
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

const tdStyle = { padding: "11px 16px", fontSize: 14, color: "#C7CDD1" };

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
