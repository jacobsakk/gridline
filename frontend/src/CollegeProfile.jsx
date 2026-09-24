import { useRealStatsReady } from "./statsData.js";
import { initialSubRoute, setSubRoute } from "./route.js";
import { useContext, useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw, Trophy } from "lucide-react";
import { PlayerDetailModal, useWatchlist, usePortalStatus } from "./Gridline.jsx";
import { PlayerProfileModal, ThemeContext, statusStyle, toTitleCase } from "./OfferTracker.jsx";
import { TEAM_CONFERENCE, isCommitment, normalizePlayerKey, useOfferTracker } from "./offerData.js";
import {
  COLLEGE_BY_ID,
  GITHUB_TOKEN_URL,
  fetchLatestDepthCharts,
  fetchSchedule,
  fetchTeamStats,
  fetchTeamSummary,
  getGithubToken,
  depthKey,
  depthKey as compactKey,
  lazyDepthCharts,
  linkDepthChart,
  logoFor,
  rankFor,
  refreshDepthCharts,
  statLinesFor,
  saveGithubToken,
  rosterFor,
  standingFor,
  teamKey,
} from "./collegeData.js";

const SEASONS = [2026, 2025, 2024, 2023, 2022];

function useAsync(loader, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    let live = true;
    setState({ loading: true, data: null, error: null });
    loader()
      .then((data) => live && setState({ loading: false, data, error: null }))
      .catch((error) => live && setState({ loading: false, data: null, error }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

const sectionLabel = { fontSize: 11, color: "var(--text-faint)", letterSpacing: "0.06em", textTransform: "uppercase" };
const mutedNote = { padding: "36px 16px", textAlign: "center", color: "var(--text-faint)", fontSize: 13.5 };

function Logo({ src, size }) {
  return (
    <img
      src={src}
      alt=""
      style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }}
      onError={(e) => {
        e.currentTarget.style.visibility = "hidden";
      }}
    />
  );
}

// ------------------------------------------------------------------ header

// Rough national benchmarks, only used to size the little bars.
const OFFENSE_SCALE = { TOT: 600, RUSH: 300, PASS: 400, PPG: 50 };
const DEFENSE_PER_GAME_SCALE = { SACKS: 4, TFL: 8, INT: 1.5, PBU: 8 };

function StatBox({ title, values, scale, perGame }) {
  return (
    <div style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", width: 168 }}>
      <div style={{ ...sectionLabel, textAlign: "center", marginBottom: 8 }}>{title}</div>
      {Object.entries(values).map(([label, value]) => {
        const max = perGame ? scale[label] * (perGame || 1) : scale[label];
        const ratio = value == null ? 0 : Math.max(0, Math.min(1, value / max));
        const color = ratio >= 0.66 ? "var(--success)" : ratio >= 0.35 ? "var(--accent)" : "var(--danger-text)";
        return (
          <div key={label} style={{ marginBottom: 7 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--text-muted)" }}>
              <span>{label}</span>
              <span className="tabular" style={{ color: "var(--text-primary)", fontWeight: 700 }}>{value == null ? "—" : Number.isInteger(value) ? value : value.toFixed(1)}</span>
            </div>
            <div style={{ height: 3, background: "var(--border)", borderRadius: 2, marginTop: 3 }}>
              <div style={{ height: 3, width: `${ratio * 100}%`, background: color, borderRadius: 2 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatKickoff(game) {
  const d = new Date(game.date);
  const day = d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  return game.timeValid ? `${day} · ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : day;
}

function ProfileHeader({ college, onOpenTeam }) {
  const summary = useAsync(() => fetchTeamSummary(college.id), [college.id]);
  const stats = useAsync(() => fetchTeamStats(college.id), [college.id]);
  const theme = useContext(ThemeContext);
  const rank = rankFor(college);
  const record = summary.data?.record || standingFor(college.id)?.overall || "";
  const next = summary.data?.next;
  const nextCollege = next && COLLEGE_BY_ID.get(next.id);
  const games = stats.data?.games || 0;

  return (
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "22px 32px", padding: "8px 0 22px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18, flex: "1 1 320px", minWidth: 0 }}>
        <Logo src={logoFor(college, theme)} size={76} />
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h2 className="oswald" style={{ margin: 0, fontSize: 34, fontWeight: 700, letterSpacing: "0.01em" }}>{college.name}</h2>
            {rank && (
              <span style={{ background: "var(--gold)", color: "#1A1206", borderRadius: 5, padding: "2px 8px", fontSize: 13, fontWeight: 800 }} title={`${college.division === "FBS" ? "AP" : "Coaches"} poll`}>
                #{rank}
              </span>
            )}
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 14.5, marginTop: 3 }}>{college.nickname}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <span style={{ border: "1px dashed var(--border)", borderRadius: 6, padding: "4px 12px", fontSize: 12.5, color: "var(--text-secondary)" }}>{college.conference}</span>
            <span style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "4px 12px", fontSize: 12.5, color: "var(--text-muted)" }}>
              {college.division}{college.city ? ` · ${college.city}, ${college.state}` : ""}
            </span>
            {summary.data?.standingSummary && (
              <span style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "4px 12px", fontSize: 12.5, color: "var(--text-muted)" }}>{summary.data.standingSummary}</span>
            )}
          </div>
        </div>
      </div>

      {stats.data && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <StatBox title="Offense" values={stats.data.offense} scale={OFFENSE_SCALE} />
          <StatBox title="Defense" values={stats.data.defense} scale={DEFENSE_PER_GAME_SCALE} perGame={games || 1} />
        </div>
      )}

      <div style={{ display: "flex", gap: 32, alignItems: "center" }}>
        <div>
          <div style={sectionLabel}>Record</div>
          <div className="oswald tabular" style={{ fontSize: 34, fontWeight: 700 }}>{record || "—"}</div>
        </div>
        <div>
          <div style={sectionLabel}>Next game</div>
          {next ? (
            <button
              onClick={() => nextCollege && onOpenTeam(nextCollege.id)}
              disabled={!nextCollege}
              title={formatKickoff(next)}
              style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", padding: 0, color: "var(--text-primary)", cursor: nextCollege ? "pointer" : "default", fontFamily: "inherit", textAlign: "left" }}
            >
              <span style={{ color: "var(--text-muted)", fontWeight: 700 }}>{next.away ? "@" : "vs"}</span>
              <Logo src={next.logo} size={34} />
              <span>
                <span className="oswald" style={{ fontSize: 19, fontWeight: 700, display: "block", lineHeight: 1.1 }}>
                  {next.rank && <span style={{ color: "var(--accent)" }}>#{next.rank} </span>}
                  {next.name}
                </span>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{formatKickoff(next)}</span>
              </span>
            </button>
          ) : (
            <div style={{ fontSize: 15, color: "var(--text-faint)", marginTop: 6 }}>{summary.loading ? "…" : "No game scheduled"}</div>
          )}
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- tabs

function Tabs({ tabs, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 6, borderBottom: "1px solid var(--border)", overflowX: "auto", scrollbarWidth: "none" }}>
      {tabs.map((t) => {
        const active = t === value;
        return (
          <button
            key={t}
            onClick={() => onChange(t)}
            style={{
              background: "none", border: "none", borderBottom: `2px solid ${active ? "var(--accent)" : "transparent"}`, marginBottom: -1,
              padding: "12px 16px", fontSize: 14, fontWeight: active ? 700 : 500, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap",
              color: active ? "var(--text-primary)" : "var(--text-muted)",
            }}
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}

const thStyle = {
  textAlign: "left", padding: "10px 14px", fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.05em",
  fontWeight: 600, whiteSpace: "nowrap", background: "var(--bg-surface)", borderBottom: "1px solid var(--border)",
};
const tdStyle = { padding: "11px 14px", fontSize: 13.5, color: "var(--text-secondary)", borderBottom: "1px solid var(--border-subtle)" };

function TableShell({ children }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "auto", background: "var(--bg-panel)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>{children}</table>
    </div>
  );
}

// ---------------------------------------------------------------- recruiting

// The Offer Tracker's boards are keyed by short names ("BGSU", "SAC STATE"),
// so its teams are matched to ESPN's colleges by their normalized display name.
function offerTeamKeyFor(college) {
  const keys = new Set([teamKey(college.name), teamKey(college.displayName)]);
  const found = Object.entries(TEAM_CONFERENCE).find(([, meta]) => keys.has(teamKey(meta.label)));
  return found ? found[0] : null;
}

function committedTo(status) {
  const m = /^COMMITTED TO (.+)$/i.exec((status || "").trim());
  return m ? m[1] : null;
}

function RecruitingTab({ college }) {
  const tracker = useOfferTracker();
  const [sub, setSub] = useState("Commits");
  const [profile, setProfile] = useState(null);
  const collegeKeys = useMemo(() => new Set([teamKey(college.name), teamKey(college.displayName)]), [college]);
  const offerTeam = offerTeamKeyFor(college);

  const { commits, offers } = useMemo(() => {
    const all = tracker.classYears.flatMap((y) => tracker.rowsForClassYear(y));
    const dedupe = (rows) => [...new Map(rows.map((r) => [`${r.classYear}|${normalizePlayerKey(r.player)}`, r])).values()];
    const commits = dedupe(all.filter((r) => isCommitment(r.status) && collegeKeys.has(teamKey(committedTo(r.status)))));
    const offers = offerTeam
      ? all.filter((r) => r.team === offerTeam)
      : dedupe(all.filter((r) => (r.otherOffers || []).some((s) => collegeKeys.has(teamKey(s)))));
    const byName = (a, b) => b.classYear.localeCompare(a.classYear) || a.player.localeCompare(b.player);
    return { commits: commits.sort(byName), offers: offers.sort(byName) };
  }, [tracker, collegeKeys, offerTeam]);

  const rows = sub === "Commits" ? commits : offers;

  return (
    <div style={{ paddingTop: 20 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
        {[["Commits", commits.length], ["Offers", offers.length]].map(([name, n]) => {
          const active = sub === name;
          return (
            <button
              key={name}
              onClick={() => setSub(name)}
              style={{
                display: "flex", alignItems: "center", gap: 8, border: "none", borderRadius: 7, padding: "8px 14px", fontSize: 13.5, fontWeight: 600,
                fontFamily: "inherit", cursor: "pointer", background: active ? "var(--bg-surface)" : "transparent", color: active ? "var(--text-primary)" : "var(--text-muted)",
              }}
            >
              {name}
              <span className="tabular" style={{ background: "var(--bg-page)", border: "1px solid var(--border)", borderRadius: 4, padding: "0 6px", fontSize: 11.5 }}>{n}</span>
            </button>
          );
        })}
        <span style={{ fontSize: 12, color: "var(--text-faint)", marginLeft: "auto" }}>
          {offerTeam ? "From this school's Offer Tracker board." : "Recruits whose offer lists include this school (from the activity feed)."}
        </span>
      </div>

      {rows.length === 0 ? (
        <div style={mutedNote}>
          {sub === "Commits" ? "No commits found in your database for this school." : "No offers found in your database for this school."}
        </div>
      ) : (
        <TableShell>
          <thead>
            <tr>
              {["Class", "Player", "High School", "State", "Pos", ...(sub === "Offers" && offerTeam ? ["Date Offered"] : []), "Status"].map((h) => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={tdStyle} className="tabular">{r.classYear}</td>
                <td style={{ ...tdStyle, fontWeight: 600, color: "var(--text-primary)" }}>
                  <span className="player-name" onClick={() => setProfile({ player: r.player, classYear: r.classYear })}>{toTitleCase(r.player)}</span>
                </td>
                <td style={tdStyle}>{toTitleCase(r.highSchool) || "—"}</td>
                <td style={tdStyle}>{r.state || "—"}</td>
                <td style={{ ...tdStyle, color: "var(--accent)", fontWeight: 700 }}>{r.position || "—"}</td>
                {sub === "Offers" && offerTeam && <td style={tdStyle} className="tabular">{r.dateOffered || "—"}</td>}
                <td style={tdStyle}>
                  {r.status ? (
                    <span style={{ ...statusStyle(r.status), borderRadius: 4, padding: "2px 8px", fontSize: 12, fontWeight: 600, display: "inline-block" }}>{toTitleCase(r.status)}</span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
      {profile && <PlayerProfileModal player={profile.player} classYear={profile.classYear} tracker={tracker} onClose={() => setProfile(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------ schedule

function resultCell(game) {
  if (!game.completed || game.myScore == null) return <span style={{ color: "var(--text-faint)" }}>—</span>;
  const label = game.won ? "W" : game.lost ? "L" : "T";
  const color = game.won ? "var(--success)" : game.lost ? "var(--danger-text)" : "var(--text-muted)";
  return <span className="tabular" style={{ color, fontWeight: 700 }}>{label} {game.myScore}-{game.oppScore}</span>;
}

function ScheduleTab({ college, onOpenTeam }) {
  const [season, setSeason] = useState(SEASONS[0]);
  const schedule = useAsync(() => fetchSchedule(college.id, season), [college.id, season]);
  const games = schedule.data || [];

  return (
    <div style={{ paddingTop: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 10 }}>
        <div className="oswald" style={{ fontSize: 17, fontWeight: 700 }}>
          {season} Season{schedule.data ? ` — ${games.length} game${games.length === 1 ? "" : "s"}` : ""}
        </div>
        <select
          id="schedule-season"
          value={season}
          onChange={(e) => setSeason(Number(e.target.value))}
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 6, padding: "8px 12px", fontSize: 13.5, fontFamily: "inherit" }}
        >
          {SEASONS.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {schedule.loading && <div style={mutedNote}>Loading schedule…</div>}
      {schedule.error && <div style={mutedNote}>Couldn't load the schedule right now. Try again in a minute.</div>}
      {schedule.data && games.length === 0 && <div style={mutedNote}>No games found for {season}.</div>}
      {games.length > 0 && (
        <TableShell>
          <thead>
            <tr>{["Date", "Opponent", "Location", "Time / TV", "Result"].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {games.map((g) => {
              const oppCollege = COLLEGE_BY_ID.get(g.id);
              return (
                <tr key={g.id}>
                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }} className="tabular">
                    {new Date(g.date).toLocaleDateString([], { month: "short", day: "numeric" })}
                  </td>
                  <td style={tdStyle}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ width: 18, color: "var(--text-muted)", fontWeight: 700 }}>{g.away ? "@" : g.neutral ? "vs" : ""}</span>
                      <Logo src={g.logo} size={30} />
                      <span
                        className={oppCollege ? "player-name" : undefined}
                        onClick={() => oppCollege && onOpenTeam(oppCollege.id)}
                        style={{ fontWeight: 600, color: "var(--text-primary)" }}
                      >
                        {g.rank && <span style={{ color: "var(--accent)" }}>#{g.rank} </span>}
                        {g.name}
                      </span>
                      {g.note && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                          <Trophy size={13} /> {g.note}
                        </span>
                      )}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <div style={{ color: "var(--text-primary)" }}>{g.venue || "TBD"}</div>
                    {g.venueCity && <div style={{ fontSize: 12, color: "var(--text-faint)" }}>{g.venueCity}</div>}
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }} className="tabular">
                    {g.timeValid ? new Date(g.date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "TBD"}
                    {g.tv && <span style={{ marginLeft: 8, fontSize: 12, color: "var(--text-faint)" }}>{g.tv}</span>}
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{resultCell(g)}</td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      )}
    </div>
  );
}

// -------------------------------------------------------------------- roster

// One table per stat category; columns mirror the Pre-Portal Tracker's.
const STAT_TABLES = {
  passing: {
    label: "Passing", defaultSort: "yards",
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
    label: "Rushing", defaultSort: "yards",
    columns: [{ key: "games", label: "G" }, { key: "att", label: "ATT" }, { key: "yards", label: "YDS" }, { key: "avg", label: "AVG" }, { key: "td", label: "TD" }],
  },
  receiving: {
    label: "Receiving", defaultSort: "yards",
    columns: [{ key: "games", label: "G" }, { key: "rec", label: "REC" }, { key: "yards", label: "YDS" }, { key: "avg", label: "AVG" }, { key: "td", label: "TD" }],
  },
  tackling: {
    label: "Defense", defaultSort: "total",
    columns: [
      { key: "games", label: "G" }, { key: "solo", label: "SOLO" }, { key: "ast", label: "AST" }, { key: "total", label: "TOT" },
      { key: "tfl", label: "TFL" }, { key: "pbu", label: "PBU" }, { key: "int", label: "INT" }, { key: "sacks", label: "SACK" }, { key: "sackYds", label: "SACK YDS" },
    ],
  },
};

function statValue(row, key) {
  if (key === "pct") {
    const [comp, att] = (row.compAtt || "0/0").split("/").map(Number);
    return att > 0 ? (comp / att) * 100 : 0;
  }
  const v = row[key];
  return typeof v === "number" ? v : parseFloat(v) || 0;
}

function statDisplay(row, key) {
  if (key === "pct") {
    const v = statValue(row, "pct");
    return v ? `${v.toFixed(1)}%` : "—";
  }
  const v = row[key];
  return v == null || v === "" ? "—" : v;
}

function RosterTab({ college }) {
  const lines = useMemo(() => statLinesFor(college), [college]);
  const populated = Object.keys(STAT_TABLES).filter((c) => lines[c].length > 0);
  const [category, setCategory] = useState(null);
  const active = category && lines[category]?.length ? category : populated.includes("passing") ? "passing" : populated[0] || "passing";
  const table = STAT_TABLES[active];
  const [sort, setSort] = useState({ key: null, dir: "desc" });
  const sortKey = sort.key || table.defaultSort;
  const [homeState, setHomeState] = useState("All");
  const [selected, setSelected] = useState(null);
  const watchlist = useWatchlist();
  const portalStatus = usePortalStatus();

  const homeStates = useMemo(() => ["All", ...new Set(lines[active].filter((r) => r.homeState).map((r) => r.homeState))].sort(), [lines, active]);

  const rows = useMemo(() => {
    const dir = sort.key ? sort.dir : "desc"; // untouched headers use the category default, highest first
    const column = table.columns.find((c) => c.key === sortKey);
    const valueKey = sortKey === "player" || sortKey === "position" || sortKey === "homeState" ? sortKey : column?.sortKey || sortKey;
    const filtered = homeState === "All" ? lines[active] : lines[active].filter((r) => r.homeState === homeState);
    return [...filtered].sort((a, b) => {
      let cmp;
      if (valueKey === "player" || valueKey === "position" || valueKey === "homeState") cmp = String(a[valueKey] || "").localeCompare(String(b[valueKey] || ""));
      else cmp = statValue(a, valueKey) - statValue(b, valueKey);
      if (cmp === 0) cmp = String(a.player).localeCompare(String(b.player));
      return dir === "desc" ? -cmp : cmp;
    });
  }, [lines, active, sortKey, sort, homeState]);

  function sortBy(key) {
    const alpha = key === "player" || key === "position" || key === "homeState";
    if (sortKey === key) setSort({ key, dir: sort.dir === "desc" ? "asc" : "desc" });
    else setSort({ key, dir: alpha ? "asc" : "desc" });
  }

  const total = new Set(Object.values(lines).flatMap((list) => list.map((r) => compactKey(r.player)))).size;
  const arrow = (key) => (sortKey === key ? (sort.dir === "desc" ? "▼" : "▲") : "");
  const th = { ...thStyle, cursor: "pointer", userSelect: "none", fontWeight: 700 };

  return (
    <div style={{ paddingTop: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div className="oswald" style={{ fontSize: 17, fontWeight: 700 }}>
          {total} player{total === 1 ? "" : "s"} with stats
          <span style={{ fontSize: 12.5, fontWeight: 400, color: "var(--text-faint)", marginLeft: 10, fontFamily: "inherit" }}>
            click a column to sort · click a player for their full card
          </span>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <select
            value={homeState}
            onChange={(e) => setHomeState(e.target.value)}
            aria-label="Filter by home state"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 6, padding: "7px 10px", fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}
          >
            {homeStates.map((s2) => (
              <option key={s2} value={s2}>{s2 === "All" ? "All home states" : s2}</option>
            ))}
          </select>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {Object.entries(STAT_TABLES).map(([key, t]) => {
            const isActive = key === active;
            return (
              <button
                key={key}
                onClick={() => {
                  setCategory(key);
                  setSort({ key: null, dir: "desc" });
                }}
                style={{
                  display: "flex", alignItems: "center", gap: 7, borderRadius: 999, padding: "7px 14px", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
                  background: isActive ? "var(--accent-bg)" : "var(--bg-surface)", border: `1px solid ${isActive ? "var(--accent)" : "var(--border)"}`,
                  color: isActive ? "var(--accent)" : "var(--text-secondary)",
                }}
              >
                {t.label}
                <span className="tabular" style={{ fontSize: 11.5, opacity: 0.8 }}>{lines[key].length}</span>
              </button>
            );
          })}
          </div>
        </div>
      </div>

      {populated.length === 0 ? (
        <div style={mutedNote}>No stats for {college.name} players are in the Pre-Portal Tracker yet. They show up here once they appear in its stat leaders.</div>
      ) : (
        <TableShell>
          <thead>
            <tr>
              <th style={th} onClick={() => sortBy("player")}>Player {arrow("player")}</th>
              <th style={th} onClick={() => sortBy("position")}>Pos {arrow("position")}</th>
              <th style={th} onClick={() => sortBy("homeState")}>Home State {arrow("homeState")}</th>
              {table.columns.map((c) => (
                <th key={c.key} style={{ ...th, textAlign: "right" }} onClick={() => sortBy(c.key)}>
                  {c.label} {arrow(c.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ ...tdStyle, fontWeight: 600, color: "var(--text-primary)" }}>
                  <span
                    className="player-name"
                    onClick={() => setSelected({ player: r.player, team: r.team, division: r.division, position: r.position, variants: r.variants })}
                  >
                    {r.player}
                  </span>
                </td>
                <td style={{ ...tdStyle, color: "var(--accent)", fontWeight: 700 }}>{r.position || "—"}</td>
                <td style={{ ...tdStyle, color: "var(--text-muted)" }}>{r.homeState || "—"}</td>
                {table.columns.map((c) => (
                  <td
                    key={c.key}
                    className="tabular"
                    style={{ ...tdStyle, textAlign: "right", color: c.key === sortKey || (c.sortKey && c.sortKey === sortKey) ? "var(--text-primary)" : undefined, fontWeight: c.key === sortKey ? 700 : 400 }}
                  >
                    {statDisplay(r, c.key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
      {selected && <PlayerDetailModal sel={selected} onClose={() => setSelected(null)} watchlist={watchlist} portalStatus={portalStatus} />}
    </div>
  );
}

// --------------------------------------------------------------- depth chart

const OFFENSE_LINE = /^(LT|LG|C|RG|RT|OL|OT|OG)$/;
const DEFENSE_LINE = /^(DE|DT|NT|DL|EDGE|WOLF|BUCK|LEO|JACK|RUSH|BANDIT|ROVER)/;
const LINEBACKER = /^(MLB|WLB|SLB|OLB|ILB|LB|MIKE|WILL|SAM|STING|MONEY|STAR)/;

function skillRank(pos) {
  if (/^QB/.test(pos)) return 0;
  if (/^(RB|FB|HB)/.test(pos)) return 1;
  if (/^(WR|SL|SLOT)/.test(pos)) return 2;
  if (/^(TE|H$|Y$)/.test(pos)) return 3;
  return 4;
}

// Ourlads lists positions in its own order; the chart reads better grouped
// into the usual rows (skill / line, then D-line / linebackers / secondary).
function groupPositions(section) {
  const p = section.positions;
  if (/^offense/i.test(section.title)) {
    const line = p.filter((x) => OFFENSE_LINE.test(x.pos));
    const skill = p.filter((x) => !OFFENSE_LINE.test(x.pos)).sort((a, b) => skillRank(a.pos) - skillRank(b.pos));
    return [skill, line];
  }
  if (/^defense/i.test(section.title)) {
    const dl = p.filter((x) => DEFENSE_LINE.test(x.pos));
    const lb = p.filter((x) => !DEFENSE_LINE.test(x.pos) && LINEBACKER.test(x.pos));
    const db = p.filter((x) => !DEFENSE_LINE.test(x.pos) && !LINEBACKER.test(x.pos));
    return [dl, lb, db];
  }
  return [p];
}

function DepthChip({ player, linked, onOpen }) {
  const bg = player.tag === "transfer" ? "#FFE94D" : player.tag === "freshman" ? "#8FE3FF" : "#FFFFFF";
  const detail = [player.year, player.rs ? "redshirt" : "", player.tag].filter(Boolean).join(" · ");
  return (
    <div
      onClick={linked ? onOpen : undefined}
      title={linked ? `${detail} — click for their Pre-Portal Tracker stats` : `${detail}${detail ? " · " : ""}not in the Pre-Portal Tracker`}
      style={{
        background: bg, color: "#111", borderRadius: 4, padding: "4px 9px", fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap",
        border: "1px solid rgba(0,0,0,0.25)", cursor: linked ? "pointer" : "default",
        boxShadow: linked ? "0 0 0 2px var(--accent)" : "none", transition: "transform 0.12s ease",
      }}
      onMouseEnter={(e) => linked && (e.currentTarget.style.transform = "translateY(-1px)")}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "none")}
    >
      #{player.no} {player.name}
      {player.rs && <span style={{ color: "#D62828", marginLeft: 3 }}>*</span>}
    </div>
  );
}

function TokenPrompt({ onSave, onClose }) {
  const [value, setValue] = useState("");
  const step = { margin: "0 0 6px", fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 };
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 80 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 10, width: 480, maxWidth: "100%", padding: 22, position: "relative", overflow: "hidden" }}
      >
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 4, background: "linear-gradient(90deg, var(--gold), var(--maroon))" }} />
        <h3 className="oswald" style={{ margin: "6px 0 8px", fontSize: 19 }}>One-time setup for Refresh</h3>
        <p style={{ ...step, color: "var(--text-muted)", marginBottom: 12 }}>
          Ourlads can't be read straight from the browser, so Refresh asks GitHub to run the scraper. GitHub needs your permission to do that. The token is saved only in this browser.
        </p>
        <ol style={{ margin: "0 0 14px", paddingLeft: 20 }}>
          <li style={step}>
            Open <a href={GITHUB_TOKEN_URL} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>GitHub's new token page</a> and give it any name.
          </li>
          <li style={step}>Repository access: <strong>Only select repositories</strong> → <strong>gridline</strong>.</li>
          <li style={step}>Permissions → Repository permissions → <strong>Actions: Read and write</strong>.</li>
          <li style={step}>Generate the token and paste it here.</li>
        </ol>
        <input
          id="github-token"
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="github_pat_…"
          autoComplete="off"
          style={{ width: "100%", background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 6, padding: "9px 12px", fontSize: 13.5, fontFamily: "inherit" }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 6, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            Cancel
          </button>
          <button
            disabled={!value.trim()}
            onClick={() => onSave(value.trim())}
            style={{ background: "var(--maroon)", border: "1px solid var(--gold)", color: "var(--gold)", borderRadius: 6, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: value.trim() ? "pointer" : "default", opacity: value.trim() ? 1 : 0.5, fontFamily: "inherit" }}
          >
            Save and refresh
          </button>
        </div>
      </div>
    </div>
  );
}

function DepthChartTab({ college }) {
  const charts = useAsync(lazyDepthCharts, []);
  const [live, setLive] = useState(null); // fresher data than the deployed copy
  const [refresh, setRefresh] = useState({ running: false, message: "", error: "" });
  const [askToken, setAskToken] = useState(false);
  const [selected, setSelected] = useState(null);
  const watchlist = useWatchlist();
  const portalStatus = usePortalStatus();
  const roster = useMemo(() => rosterFor(college), [college]);

  // The daily scrape commits to the repo before the site is redeployed, so
  // quietly check whether GitHub already has something newer.
  useEffect(() => {
    if (!charts.data) return;
    let active = true;
    fetchLatestDepthCharts()
      .then((latest) => active && new Date(latest.updated) > new Date(charts.data.updated) && setLive(latest))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [charts.data]);

  const data = live || charts.data;
  const team = data?.teams?.[college.id];
  const links = useMemo(() => (team ? linkDepthChart(team, roster) : new Map()), [team, roster]);

  async function runRefresh(token) {
    setRefresh({ running: true, message: "Starting…", error: "" });
    try {
      const latest = await refreshDepthCharts(token, (message) => setRefresh((r) => ({ ...r, message })));
      setLive(latest);
      setRefresh({ running: false, message: "", error: "" });
    } catch (err) {
      if (err.code === "auth") {
        saveGithubToken("");
        setRefresh({ running: false, message: "", error: "GitHub rejected the saved token. Add a new one to continue." });
        setAskToken(true);
      } else {
        setRefresh({ running: false, message: "", error: err.message || "Couldn't refresh right now." });
      }
    }
  }

  function onRefreshClick() {
    const token = getGithubToken();
    if (!token) setAskToken(true);
    else runRefresh(token);
  }

  if (charts.loading) return <div style={mutedNote}>Loading depth chart…</div>;
  if (college.division !== "FBS") {
    return <div style={mutedNote}>Depth charts come from Ourlads, which only covers FBS teams.</div>;
  }
  if (!team) return <div style={mutedNote}>No depth chart is available for {college.name} yet.</div>;

  const updated = new Date(data.updated).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const buttonStyle = {
    display: "inline-flex", alignItems: "center", gap: 7, background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)",
    borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 600, textDecoration: "none", fontFamily: "inherit",
  };

  return (
    <div style={{ paddingTop: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
        <div style={{ fontSize: 12.5, color: "var(--text-faint)", lineHeight: 1.8 }}>
          Last updated {updated} · also refreshed every morning
          <br />
          <Swatch color="#FFE94D" /> transfer <Swatch color="#8FE3FF" /> true freshman <span style={{ color: "#D62828", fontWeight: 700 }}>*</span> redshirt
          <span style={{ marginLeft: 10 }}>
            <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "#fff", boxShadow: "0 0 0 2px var(--accent)", marginRight: 6, verticalAlign: "-1px" }} />
            outlined = in the Pre-Portal Tracker (click for stats)
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={onRefreshClick} disabled={refresh.running} style={{ ...buttonStyle, cursor: refresh.running ? "default" : "pointer", opacity: refresh.running ? 0.75 : 1 }}>
            <RefreshCw size={14} className={refresh.running ? "spin" : undefined} />
            {refresh.running ? refresh.message || "Refreshing…" : "Refresh from Ourlads"}
          </button>
          <a href={team.ourladsUrl} target="_blank" rel="noreferrer" style={buttonStyle}>
            View on Ourlads <ExternalLink size={13} />
          </a>
        </div>
      </div>
      <div style={{ minHeight: 20, marginBottom: 12, textAlign: "right", fontSize: 12.5 }}>
        {refresh.running && <span style={{ color: "var(--text-muted)" }}>This scrapes every FBS team, so it takes 2–3 minutes. You can keep browsing.</span>}
        {refresh.error && <span style={{ color: "var(--danger-text)" }}>{refresh.error}</span>}
      </div>

      {team.sections.map((section) => (
        <div key={section.title} style={{ marginBottom: 26 }}>
          <div style={{ textAlign: "center", marginBottom: 12 }}>
            <div className="oswald" style={{ fontSize: 22, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>{section.title}</div>
            {section.scheme && <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>{section.scheme}</div>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {groupPositions(section).filter((g) => g.length).map((group, i) => (
              <div
                key={i}
                style={{
                  background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 10, padding: "16px 18px",
                  display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "16px 20px",
                }}
              >
                {group.map((pos) => (
                  <div key={pos.pos} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 100 }}>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.04em" }}>{pos.pos}</div>
                    {pos.players.length === 0 ? (
                      <div style={{ color: "var(--text-faint)", fontSize: 12 }}>—</div>
                    ) : (
                      pos.players.map((pl, j) => {
                        const match = links.get(depthKey(pl.name));
                        return (
                          <DepthChip
                            key={j}
                            player={pl}
                            linked={!!match}
                            onOpen={() => setSelected({ player: match.player, team: match.team, division: match.division, position: match.position, variants: match.variants })}
                          />
                        );
                      })
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}

      {askToken && (
        <TokenPrompt
          onClose={() => setAskToken(false)}
          onSave={(token) => {
            saveGithubToken(token);
            setAskToken(false);
            runRefresh(token);
          }}
        />
      )}
      {selected && <PlayerDetailModal sel={selected} onClose={() => setSelected(null)} watchlist={watchlist} portalStatus={portalStatus} />}
    </div>
  );
}

function Swatch({ color }) {
  return <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: color, marginRight: 4, verticalAlign: "-1px", border: "1px solid rgba(0,0,0,0.3)" }} />;
}

// ------------------------------------------------------------------- profile

const TABS = ["Recruiting", "Schedule", "Roster", "Depth Chart"];

function CollegeProfileInner({ college, onOpenTeam }) {
  // The open tab is kept in the address too (#/colleges/2117/roster), so other screens can link straight to it.
  const [tab, setTab] = useState(() => {
    const [id, want] = initialSubRoute();
    return id === college.id ? TABS.find((t) => t.toLowerCase().replace(/\s/g, "") === String(want || "").toLowerCase()) || "Recruiting" : "Recruiting";
  });
  useEffect(() => {
    setSubRoute("colleges", [college.id, tab.toLowerCase().replace(/\s/g, "")]);
  }, [college.id, tab]);
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "22px var(--gutter) var(--gutter)" }}>
      <div style={{ maxWidth: 1240, margin: "0 auto" }}>
        <ProfileHeader college={college} onOpenTeam={onOpenTeam} />
        <Tabs tabs={TABS} value={tab} onChange={setTab} />
        {tab === "Recruiting" && <RecruitingTab college={college} />}
        {tab === "Schedule" && <ScheduleTab college={college} onOpenTeam={onOpenTeam} />}
        {tab === "Roster" && <RosterTab college={college} />}
        {tab === "Depth Chart" && <DepthChartTab college={college} />}
      </div>
    </div>
  );
}

// The player and stat lookups need the Pre-Portal stats, which load on demand.
export default function CollegeProfile(props) {
  const ready = useRealStatsReady();
  if (!ready) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Loading…</div>;
  return <CollegeProfileInner {...props} />;
}
