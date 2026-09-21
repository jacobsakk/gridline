import { useEffect, useMemo, useState } from "react";
import { initialSubRoute, setSubRoute, useBack } from "./route.js";
import { ArrowLeft, Search, ChevronUp, ChevronDown, ChevronsUpDown, Trophy } from "lucide-react";
import { ThemeSwitcher, useTheme } from "./theme.jsx";
import cmuHelmet from "./assets/cmu-helmet.png";
import { ThemeContext } from "./OfferTracker.jsx";
import CollegeProfile from "./CollegeProfile.jsx";
import {
  COLLEGES,
  COLLEGE_BY_ID,
  conferenceStandings,
  rankFor,
  topTwentyFive,
} from "./collegeData.js";

const PAGE_SIZE = 50;

function TeamLogo({ college, size = 28 }) {
  return (
    <img
      src={college.logo}
      alt=""
      loading="lazy"
      style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }}
      onError={(e) => {
        e.currentTarget.style.visibility = "hidden";
      }}
    />
  );
}

function ConferencePill({ children }) {
  return (
    <span
      style={{
        display: "inline-block", border: "1px solid var(--border)", background: "var(--bg-surface)", color: "var(--text-secondary)",
        borderRadius: 999, padding: "3px 10px", fontSize: 12, whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

const panelStyle = {
  background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 10, display: "flex", flexDirection: "column",
  minHeight: 0, overflow: "hidden",
};
const controlStyle = {
  background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 6,
  padding: "9px 12px", fontSize: 13.5, fontFamily: "inherit",
};
const labelStyle = { fontSize: 11, color: "var(--text-faint)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 };

function SortIcon({ active, dir }) {
  if (!active) return <ChevronsUpDown size={12} style={{ opacity: 0.4 }} />;
  return dir === "desc" ? <ChevronDown size={12} /> : <ChevronUp size={12} />;
}

const COLUMNS = [
  { key: "name", label: "School" },
  { key: "nickname", label: "Nickname" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "conference", label: "Conference" },
];

function CollegeListPanel({ onOpen }) {
  const [search, setSearch] = useState("");
  const [state, setState] = useState("");
  const [conference, setConference] = useState("");
  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [page, setPage] = useState(0);

  const states = useMemo(() => [...new Set(COLLEGES.map((c) => c.state).filter(Boolean))].sort(), []);
  const conferences = useMemo(() => [...new Set(COLLEGES.map((c) => c.conference))].sort(), []);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = COLLEGES.filter(
      (c) =>
        (!state || c.state === state) &&
        (!conference || c.conference === conference) &&
        (!q || [c.name, c.displayName, c.nickname, c.city, c.conference, c.abbreviation].some((v) => (v || "").toLowerCase().includes(q)))
    );
    return [...filtered].sort((a, b) => {
      const cmp = (a[sortKey] || "").localeCompare(b[sortKey] || "");
      return sortDir === "desc" ? -cmp : cmp;
    });
  }, [search, state, conference, sortKey, sortDir]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const visible = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  function sortBy(key) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(0);
  }

  const pagerButton = (disabled) => ({
    ...controlStyle, padding: "7px 14px", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.45 : 1,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0, minWidth: 0 }}>
      <div style={{ ...panelStyle, padding: 16, overflow: "visible", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: "2 1 220px", minWidth: 0 }}>
            <div style={labelStyle}>Search colleges</div>
            <div style={{ position: "relative" }}>
              <Search size={15} color="var(--text-faint)" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
              <input
                id="college-search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                placeholder="School, nickname, city, conference"
                style={{ ...controlStyle, width: "100%", paddingLeft: 34 }}
              />
            </div>
          </div>
          <div style={{ flex: "1 1 120px" }}>
            <div style={labelStyle}>State</div>
            <select
              id="college-state"
              value={state}
              onChange={(e) => {
                setState(e.target.value);
                setPage(0);
              }}
              style={{ ...controlStyle, width: "100%" }}
            >
              <option value="">All states</option>
              {states.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: "1 1 150px" }}>
            <div style={labelStyle}>Conference</div>
            <select
              id="college-conference"
              value={conference}
              onChange={(e) => {
                setConference(e.target.value);
                setPage(0);
              }}
              style={{ ...controlStyle, width: "100%" }}
            >
              <option value="">All conferences</option>
              {conferences.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div style={{ ...panelStyle, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "14px 16px", flexShrink: 0, flexWrap: "wrap" }}>
          <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>
            <strong className="tabular" style={{ color: "var(--text-primary)", fontSize: 16 }}>{rows.length}</strong> college{rows.length === 1 ? "" : "s"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button disabled={safePage === 0} onClick={() => setPage(safePage - 1)} style={pagerButton(safePage === 0)}>Previous</button>
            <span className="tabular" style={{ fontSize: 12.5, color: "var(--text-muted)", whiteSpace: "nowrap" }}>Page {safePage + 1} of {pages}</span>
            <button disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)} style={pagerButton(safePage >= pages - 1)}>Next</button>
          </div>
        </div>
        <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, minWidth: 560 }}>
            <thead>
              <tr>
                {COLUMNS.map(({ key, label }) => (
                  <th
                    key={key}
                    onClick={() => sortBy(key)}
                    style={{
                      position: "sticky", top: 0, zIndex: 1, background: "var(--bg-surface)", textAlign: "left", padding: "10px 14px", fontSize: 12.5,
                      color: "var(--text-muted)", fontWeight: 600, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
                      borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                      {label}
                      <SortIcon active={sortKey === key} dir={sortDir} />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => onOpen(c.id)}
                  style={{ cursor: "pointer", borderBottom: "1px solid var(--border-subtle)" }}
                >
                  <td style={{ padding: "10px 14px", fontWeight: 600, color: "var(--text-primary)" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
                      <TeamLogo college={c} size={30} />
                      {c.name}
                    </span>
                  </td>
                  <td style={{ padding: "10px 14px", color: "var(--text-secondary)", fontSize: 13.5 }}>{c.nickname}</td>
                  <td style={{ padding: "10px 14px", color: "var(--text-secondary)", fontSize: 13.5 }}>{c.city}</td>
                  <td style={{ padding: "10px 14px", color: "var(--text-secondary)", fontSize: 13.5 }}>{c.state}</td>
                  <td style={{ padding: "10px 14px" }}><ConferencePill>{c.conference}</ConferencePill></td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} style={{ padding: 28, textAlign: "center", color: "var(--text-faint)", fontSize: 13.5 }}>
                    No colleges match.
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

function SegmentedToggle({ options, value, onChange, dark }) {
  return (
    <div style={{ display: "flex", background: "var(--bg-page)", border: "1px solid var(--border)", borderRadius: 8, padding: 3, gap: 3 }}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            style={{
              flex: 1, border: "none", borderRadius: 6, padding: "8px 10px", fontSize: 12.5, fontWeight: 700, letterSpacing: "0.03em",
              cursor: "pointer", fontFamily: "inherit",
              background: active ? (dark ? "var(--bg-surface)" : "var(--accent)") : "transparent",
              color: active ? (dark ? "var(--text-primary)" : "var(--bg-page)") : "var(--text-muted)",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function StandingsPanel({ onOpen }) {
  const [division, setDivision] = useState("FBS");
  const [view, setView] = useState("top");

  const top = useMemo(() => topTwentyFive(division), [division]);
  const conferences = useMemo(() => conferenceStandings(division), [division]);

  const th = {
    position: "sticky", top: 0, zIndex: 1, background: "var(--bg-panel)", textAlign: "right", padding: "10px 8px", fontSize: 11,
    color: "var(--text-faint)", letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: 600, borderBottom: "1px solid var(--border)",
  };
  const td = { padding: "11px 8px", textAlign: "right", fontSize: 13, color: "var(--text-secondary)", whiteSpace: "nowrap" };

  function TeamRow({ college, row, rank, index }) {
    return (
      <tr onClick={() => onOpen(college.id)} style={{ cursor: "pointer", borderBottom: "1px solid var(--border-subtle)" }}>
        <td style={{ ...td, textAlign: "left", width: 28, color: "var(--text-faint)", fontSize: 11.5, paddingLeft: 14 }} className="tabular">{index}</td>
        <td style={{ ...td, textAlign: "left", color: "var(--text-primary)", fontWeight: 600 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <TeamLogo college={college} size={26} />
            <span>
              {rank && <span style={{ color: "var(--accent)", marginRight: 5 }}>#{rank}</span>}
              {college.name}
            </span>
          </span>
        </td>
        <td style={td} className="tabular">{row?.overall || "—"}</td>
        <td style={td} className="tabular">{row?.conf || "—"}</td>
        <td style={td} className="tabular">{row?.pf || "—"}</td>
        <td style={td} className="tabular">{row?.pa || "—"}</td>
        <td style={td} className="tabular">{row?.pd || "—"}</td>
        <td style={{ ...td, paddingRight: 14, color: (row?.streak || "").startsWith("W") ? "var(--success)" : (row?.streak || "").startsWith("L") ? "var(--danger-text)" : "var(--text-faint)" }} className="tabular">
          {row?.streak || "—"}
        </td>
      </tr>
    );
  }

  return (
    <div style={{ ...panelStyle, minWidth: 0 }}>
      <div style={{ padding: "16px 16px 12px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <div
            style={{
              width: 42, height: 42, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center",
              background: "var(--accent-bg)", border: "1px solid var(--accent)", color: "var(--accent)",
            }}
          >
            <Trophy size={19} />
          </div>
          <div>
            <h2 className="oswald" style={{ margin: 0, fontSize: 21, fontWeight: 700, letterSpacing: "0.02em", textTransform: "uppercase" }}>Standings</h2>
            <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>2026 season</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SegmentedToggle options={[{ key: "FBS", label: "FBS" }, { key: "FCS", label: "FCS" }]} value={division} onChange={setDivision} />
          <SegmentedToggle
            dark
            options={[{ key: "top", label: "TOP 25" }, { key: "conf", label: "CONFERENCE" }]}
            value={view}
            onChange={setView}
          />
        </div>
      </div>

      <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, minWidth: 420 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left", paddingLeft: 14 }} colSpan={2}>Team</th>
              {["OVR", "CONF", "PF", "PA", "PD"].map((h) => <th key={h} style={th}>{h}</th>)}
              <th style={{ ...th, paddingRight: 14 }}>STRK</th>
            </tr>
          </thead>
          <tbody>
            {view === "top" &&
              top.map((t) => <TeamRow key={t.college.id} college={t.college} row={t.row} rank={t.rank} index={t.rank} />)}
            {view === "conf" &&
              conferences.map((conf) => (
                <FragmentGroup key={conf.name} name={conf.name}>
                  {conf.teams.map((t, i) => (
                    <TeamRow key={t.college.id} college={t.college} row={t.row} rank={rankFor(t.college)} index={i + 1} />
                  ))}
                </FragmentGroup>
              ))}
            {view === "top" && top.length === 0 && (
              <tr><td colSpan={8} style={{ padding: 28, textAlign: "center", color: "var(--text-faint)", fontSize: 13.5 }}>No poll yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FragmentGroup({ name, children }) {
  return (
    <>
      <tr>
        <td
          colSpan={8}
          className="oswald"
          style={{
            padding: "10px 14px", background: "var(--bg-surface)", color: "var(--accent)", fontSize: 12.5, fontWeight: 700,
            letterSpacing: "0.06em", textTransform: "uppercase", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)",
          }}
        >
          {name}
        </td>
      </tr>
      {children}
    </>
  );
}

export default function Colleges({ onBack: toDashboard }) {
  const back = useBack(toDashboard);
  const onBack = back.go;
  const [theme, setTheme] = useTheme();
  // The open team is kept in the address (#/colleges/2117) so a refresh returns to it.
  const [selectedId, setSelectedId] = useState(() => {
    const id = initialSubRoute()[0];
    return id && COLLEGE_BY_ID.has(id) ? id : null;
  });
  useEffect(() => {
    // keep a tab already in the address (#/colleges/2117/roster) when the same team stays open
    if (selectedId && initialSubRoute()[0] === selectedId) return;
    setSubRoute("colleges", selectedId ? [selectedId] : []);
  }, [selectedId]);
  // A stack so "Back" from a team you reached by clicking an opponent
  // returns to the team you came from.
  const [history, setHistory] = useState([]);
  const college = selectedId ? COLLEGE_BY_ID.get(selectedId) : null;

  function openTeam(id) {
    if (!COLLEGE_BY_ID.has(id)) return;
    setHistory((h) => (selectedId ? [...h, selectedId] : h));
    setSelectedId(id);
  }

  function goBack() {
    if (history.length) {
      setSelectedId(history[history.length - 1]);
      setHistory(history.slice(0, -1));
    } else if (selectedId && !back.fromTrail) {
      setSelectedId(null);
    } else {
      onBack();
    }
  }

  const backLabel = history.length ? "Back" : selectedId && !back.fromTrail ? "Colleges" : back.label;

  return (
    <ThemeContext.Provider value={theme}>
      <div
        className="app-shell"
        data-theme={theme}
        style={{
          display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg-page)", color: "var(--text-primary)",
          fontFamily: "'Century Gothic', 'Jost', 'Helvetica Neue', Arial, sans-serif",
        }}
      >
        <div className="app-header" style={{ flexShrink: 0, position: "relative", padding: "20px var(--gutter) 16px" }}>
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 3, background: "linear-gradient(90deg, var(--gold), var(--maroon))" }} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <button
                onClick={goBack}
                style={{
                  display: "flex", alignItems: "center", gap: 7, background: "var(--bg-surface)", border: "1px solid var(--border)",
                  color: "var(--text-primary)", borderRadius: 5, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                }}
              >
                <ArrowLeft size={15} /> {backLabel}
              </button>
              <img src={cmuHelmet} alt="Central Michigan Chippewas helmet" style={{ height: 34, width: "auto", flexShrink: 0 }} />
              <h1 className="oswald app-title" style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "0.01em" }}>Colleges</h1>
            </div>
            <ThemeSwitcher theme={theme} onChange={setTheme} />
          </div>
        </div>

        {college ? (
          <CollegeProfile key={college.id} college={college} onOpenTeam={openTeam} />
        ) : (
          <div className="colleges-grid" style={{ flex: 1, minHeight: 0, padding: "20px var(--gutter) var(--gutter)" }}>
            <CollegeListPanel onOpen={openTeam} />
            <StandingsPanel onOpen={openTeam} />
          </div>
        )}
      </div>
    </ThemeContext.Provider>
  );
}
