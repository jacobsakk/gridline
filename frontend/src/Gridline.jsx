import { useState, useMemo } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown, Crown, BadgeCheck, FlaskConical } from "lucide-react";
import realStats from "./data/real-stats.json";

// ---------- Mock data generation (seeded, stable across renders) ----------
// Used only for JUCO, which doesn't have a live source connected yet.

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(88);
const ri = (a, b) => Math.floor(rand() * (b - a + 1)) + a;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const DIVISIONS = ["JUCO", "D2", "FCS"];
const WEEKS = [1, 2, 3, 4];
// "total" is a season-to-date aggregate. Real data (D2/FCS, from the NCAA's
// own stats feed) only ever has a "total" row -- the source reports
// season-to-date, not isolated per-week lines, same as any stats site would.
const WEEK_OPTIONS = ["total", 1, 2, 3, 4];
const weekLabel = (w) => (w === "total" ? "Total (season)" : `Week ${w}`);

// Sample-only roster, JUCO only -- D2 and FCS now come from real-stats.json.
const TEAMS = {
  JUCO: [
    { team: "Butler CC", conference: "KJCCC" },
    { team: "Garden City CC", conference: "KJCCC" },
    { team: "Hutchinson CC", conference: "KJCCC" },
    { team: "Iowa Western CC", conference: "ICCAC" },
    { team: "Ellsworth CC", conference: "ICCAC" },
    { team: "Snow College", conference: "Scenic West" },
    { team: "East Mississippi CC", conference: "MACJC" },
    { team: "Jones College", conference: "MACJC" },
    { team: "College of San Mateo", conference: "CCCAA" },
    { team: "Riverside City College", conference: "CCCAA" },
  ],
};

function pickTeam(division) {
  return pick(TEAMS[division]);
}

const FIRST = ["Marcus", "Jalen", "Tyler", "DeShawn", "Cole", "Malik", "Aiden", "Trey", "Isaiah", "Bryce", "Jordan", "Dante", "Wyatt", "Kamari", "Gunnar", "Xavier"];
const LAST = ["Boone", "Whitfield", "Reyes", "Sarver", "McKay", "Osei", "Lindqvist", "Pruitt", "Castellano", "Nakamura", "Duren", "Halstrom", "Iheanacho", "Brogan"];
const name = () => `${pick(FIRST)} ${pick(LAST)}`;

// leaderKey = the stat used to rank "leader" for this category
const CATEGORIES = {
  passing: {
    label: "Passing",
    positions: ["QB"],
    leaderKey: "yards",
    columns: [
      { key: "compAtt", label: "C/ATT", sortKey: "att" },
      { key: "yards", label: "YDS" },
      { key: "td", label: "TD" },
      { key: "int", label: "INT" },
      { key: "rating", label: "RTG" },
    ],
    gen: () => {
      const att = ri(18, 42);
      const comp = ri(Math.floor(att * 0.45), Math.floor(att * 0.75));
      const yards = ri(comp * 6, comp * 13);
      const td = ri(0, 5);
      const int = ri(0, 3);
      return { compAtt: `${comp}/${att}`, att, yards, td, int, rating: (100 + td * 20 - int * 15 + yards / 5).toFixed(1) };
    },
  },
  rushing: {
    label: "Rushing",
    positions: ["RB", "QB"],
    leaderKey: "yards",
    columns: [
      { key: "att", label: "ATT" },
      { key: "yards", label: "YDS" },
      { key: "avg", label: "AVG" },
      { key: "td", label: "TD" },
    ],
    gen: () => {
      const att = ri(8, 28);
      const yards = ri(att * 2, att * 9);
      return { att, yards, avg: (yards / att).toFixed(1), td: ri(0, 4) };
    },
  },
  receiving: {
    label: "Receiving",
    positions: ["WR", "TE", "RB"],
    leaderKey: "yards",
    columns: [
      { key: "rec", label: "REC" },
      { key: "yards", label: "YDS" },
      { key: "avg", label: "AVG" },
      { key: "td", label: "TD" },
    ],
    gen: () => {
      const rec = ri(2, 12);
      const yards = ri(rec * 6, rec * 22);
      return { rec, yards, avg: (yards / rec).toFixed(1), td: ri(0, 3) };
    },
  },
  tackling: {
    label: "Tackling",
    positions: ["LB", "DB", "DL"],
    leaderKey: "total",
    columns: [
      { key: "solo", label: "SOLO" },
      { key: "ast", label: "AST" },
      { key: "total", label: "TOT" },
    ],
    gen: () => {
      const solo = ri(2, 11);
      const ast = ri(0, 6);
      return { solo, ast, total: solo + ast };
    },
  },
  // Columns here match what the real "Sacks" leaderboard actually reports
  // per player. Forced fumbles/recoveries live on separate NCAA leaderboards
  // covering a different set of players, so they're not included here --
  // merging them in would mean guessing 0 for anyone not also on those
  // other lists, which would look precise but not be trustworthy.
  sacksTfl: {
    label: "Sacks",
    positions: ["DL", "LB"],
    leaderKey: "sacks",
    columns: [
      { key: "soloSacks", label: "SOLO" },
      { key: "astSacks", label: "AST" },
      { key: "sackYds", label: "YDS" },
      { key: "sacks", label: "SACK" },
    ],
    gen: () => {
      const soloSacks = ri(0, 6);
      const astSacks = ri(0, 3);
      return { soloSacks, astSacks, sackYds: ri(0, 22), sacks: ((soloSacks + astSacks * 0.5)).toFixed(1) };
    },
  },
};

// Aggregates a player's weekly sample stat lines into a season "total" row.
// Recomputes rate stats (avg, rating) from the summed components rather
// than averaging the per-week rates, same as a real stat site would.
// (Only needed for JUCO's generated sample data -- real D2/FCS rows already
// come from the NCAA API as season-to-date totals.)
function aggregateCategory(catKey, weeklyStats) {
  const sum = (fn) => weeklyStats.reduce((acc, s) => acc + fn(s), 0);
  if (catKey === "passing") {
    const att = sum((s) => s.att);
    const comp = sum((s) => parseInt(s.compAtt.split("/")[0], 10));
    const yards = sum((s) => s.yards);
    const td = sum((s) => s.td);
    const int = sum((s) => s.int);
    return { compAtt: `${comp}/${att}`, att, yards, td, int, rating: (100 + td * 20 - int * 15 + yards / 5).toFixed(1) };
  }
  if (catKey === "rushing") {
    const att = sum((s) => s.att);
    const yards = sum((s) => s.yards);
    const td = sum((s) => s.td);
    return { att, yards, avg: att ? (yards / att).toFixed(1) : "0.0", td };
  }
  if (catKey === "receiving") {
    const rec = sum((s) => s.rec);
    const yards = sum((s) => s.yards);
    const td = sum((s) => s.td);
    return { rec, yards, avg: rec ? (yards / rec).toFixed(1) : "0.0", td };
  }
  if (catKey === "tackling") {
    const solo = sum((s) => s.solo);
    const ast = sum((s) => s.ast);
    return { solo, ast, total: solo + ast };
  }
  // sacksTfl
  const soloSacks = sum((s) => s.soloSacks);
  const astSacks = sum((s) => s.astSacks);
  const sackYds = sum((s) => s.sackYds);
  const sacks = (soloSacks + astSacks * 0.5).toFixed(1);
  return { soloSacks, astSacks, sackYds, sacks };
}

// Sample data for JUCO only -- D2 and FCS come from real-stats.json.
function buildSampleDataset() {
  const rows = [];
  let id = 0;
  Object.entries(CATEGORIES).forEach(([catKey, cat]) => {
    // A fixed roster per category so weekly lines belong to the same
    // player and can be summed into a meaningful season total.
    const rosterSize = ri(6, 9);
    const roster = [];
    for (let i = 0; i < rosterSize; i++) {
      const { team, conference } = pickTeam("JUCO");
      roster.push({ player: name(), team, conference, position: pick(cat.positions) });
    }

    const weeklyStatsByPlayer = roster.map(() => []);
    WEEKS.forEach((week) => {
      roster.forEach((p, idx) => {
        const stats = cat.gen();
        weeklyStatsByPlayer[idx].push(stats);
        rows.push({
          id: `sample-${id++}`,
          division: "JUCO",
          week,
          category: catKey,
          position: p.position,
          player: p.player,
          team: p.team,
          conference: p.conference,
          sample: true,
          ...stats,
        });
      });
    });

    roster.forEach((p, idx) => {
      rows.push({
        id: `sample-${id++}`,
        division: "JUCO",
        week: "total",
        category: catKey,
        position: p.position,
        player: p.player,
        team: p.team,
        conference: p.conference,
        sample: true,
        ...aggregateCategory(catKey, weeklyStatsByPlayer[idx]),
      });
    });
  });
  return rows;
}

const DATA = [...realStats, ...buildSampleDataset()];
const DIVISION_LABEL = { JUCO: "Junior College", D2: "NCAA Division II", FCS: "FCS" };
const LIVE_DIVISIONS = new Set(["D2", "FCS"]); // whole division, real NCAA API data

function conferencesFor(division) {
  return [...new Set(DATA.filter((r) => r.division === division).map((r) => r.conference))].sort();
}

function positionsFor(division, category) {
  return [...new Set(DATA.filter((r) => r.division === division && r.category === category).map((r) => r.position))].sort();
}

// ---------- Component ----------

export default function Gridline() {
  const [division, setDivision] = useState("FCS");
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

  const rows = useMemo(() => {
    const effectiveWeek = isLiveView ? "total" : week;
    let filtered = DATA.filter((r) => r.division === division && r.category === category && r.week === effectiveWeek);
    if (position !== "All") filtered = filtered.filter((r) => r.position === position);
    if (conference !== "All") filtered = filtered.filter((r) => r.conference === conference);

    filtered = [...filtered].sort((a, b) => {
      const av = parseFloat(a[sortKey]) || 0;
      const bv = parseFloat(b[sortKey]) || 0;
      return sortDir === "desc" ? bv - av : av - bv;
    });
    return filtered;
  }, [division, category, week, position, conference, sortKey, sortDir, isLiveView]);

  // Weekly leaders: top row per category for this division/conference, ignoring position filter
  const weeklyLeaders = useMemo(() => {
    const effectiveWeek = isLiveView ? "total" : week;
    return Object.entries(CATEGORIES).map(([key, c]) => {
      let catRows = DATA.filter((r) => r.division === division && r.category === key && r.week === effectiveWeek);
      if (conference !== "All") catRows = catRows.filter((r) => r.conference === conference);
      const sorted = [...catRows].sort((a, b) => (parseFloat(b[c.leaderKey]) || 0) - (parseFloat(a[c.leaderKey]) || 0));
      return { key, cat: c, leader: sorted[0] };
    });
  }, [division, week, conference, isLiveView]);

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
    if (LIVE_DIVISIONS.has(d)) setWeek("total");
  }

  function handleCategoryChange(key) {
    setCategory(key);
    setPosition("All");
    setSortKey(CATEGORIES[key].leaderKey);
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
          <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
            <h1 className="oswald" style={{ fontSize: 34, fontWeight: 700, margin: 0, letterSpacing: "0.01em" }}>
              Gridline
            </h1>
            <span style={{ color: "#8B959C", fontSize: 15 }}>weekly stats — JUCO · D2 · FCS</span>
          </div>
          <p style={{ margin: "6px 0 0", color: "#8B959C", fontSize: 14, maxWidth: 620, lineHeight: 1.5 }}>
            D2 and FCS are live data, pulled directly from the NCAA's own stats feed (season
            totals to date). JUCO is still sample data — those sources are harder to scrape and
            aren't connected yet.
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
              <span>Live data — {DIVISION_LABEL[division]}, season totals to date (source: NCAA)</span>
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
            {weekLabel(isLiveView ? "total" : week)} leaders — {conference === "All" ? DIVISION_LABEL[division] : conference}
          </span>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {weeklyLeaders.map(({ key, cat: c, leader }) => (
              <button
                key={key}
                onClick={() => handleCategoryChange(key)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 2,
                  background: category === key ? "#20281F" : "#1A2126",
                  border: category === key ? "1px solid #C89B3C" : "1px solid #2A333A",
                  borderRadius: 5,
                  padding: "8px 14px",
                  cursor: "pointer",
                  textAlign: "left",
                  minWidth: 148,
                }}
              >
                <span className="oswald" style={{ fontSize: 11, color: "#8B959C", fontWeight: 500 }}>
                  {c.label}
                </span>
                {leader ? (
                  <>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: "#EDEAE0" }}>{leader.player}</span>
                    <span className="tabular" style={{ fontSize: 12.5, color: "#C89B3C" }}>
                      {leader[c.leaderKey]} {c.columns.find((col) => col.key === c.leaderKey)?.label || ""}
                    </span>
                  </>
                ) : (
                  <span style={{ fontSize: 13, color: "#5D666C" }}>No data</span>
                )}
              </button>
            ))}
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
              value={isLiveView ? "total" : week}
              onChange={(e) => setWeek(e.target.value === "total" ? "total" : Number(e.target.value))}
              style={selectStyle}
              disabled={isLiveView}
              title={isLiveView ? "Live source only reports season totals, not per-week splits" : undefined}
            >
              {WEEK_OPTIONS.map((w) => (
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
