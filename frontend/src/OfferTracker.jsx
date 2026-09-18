import { useMemo, useState } from "react";
import { ArrowLeft, Sun, Moon, Upload, X, Loader2, ChevronUp, ChevronDown, ChevronsUpDown, TrendingUp, MapPin } from "lucide-react";
import cmuHelmet from "./assets/cmu-helmet.png";
import { CONFERENCE_ORDER, useOfferTracker } from "./offerData.js";

const CONFERENCE_LABEL = { MAC: "MAC", MVC: "MVC / MVFC", IVY: "Ivy League" };

const FIELDS = [
  { key: "player", label: "Player", width: 160 },
  { key: "highSchool", label: "High School", width: 160 },
  { key: "state", label: "State", width: 70, upper: true },
  { key: "position", label: "Pos", width: 64, upper: true },
  { key: "dateOffered", label: "Date Offered", width: 110 },
  { key: "status", label: "Status", width: 220 },
  { key: "pipelineStatus", label: "Pipeline", width: 150 },
  { key: "notes", label: "Notes", width: 180 },
];

function statusStyle(status) {
  const s = (status || "").toUpperCase();
  if (s.includes("CENTRAL MICHIGAN")) {
    return { background: "var(--accent-bg)", color: "var(--accent)", border: "1px solid var(--accent)" };
  }
  if (s.startsWith("COMMIT")) {
    return { background: "var(--danger-bg, #241414)", color: "var(--danger)", border: "1px solid var(--danger)", textDecoration: "line-through" };
  }
  if (s === "OFFERED") {
    return { background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success-border)" };
  }
  return { background: "transparent", color: "var(--text-secondary)", border: "1px solid transparent" };
}

// Perceived brightness of a hex color, used to pick readable text
// (white or near-black) on top of an arbitrary school color.
function contrastOn(hex) {
  const h = (hex || "#000000").replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 150 ? "#141414" : "#F5F3EE";
}

function EditableCell({ value, onCommit, width, upper, style }) {
  const [text, setText] = useState(value || "");
  const [dirty, setDirty] = useState(false);

  if (!dirty && (value || "") !== text) setText(value || "");

  function commit() {
    const next = upper ? text.trim().toUpperCase() : text.trim();
    setDirty(false);
    if (next !== (value || "")) onCommit(next);
  }

  return (
    <input
      value={text}
      onChange={(e) => {
        setDirty(true);
        setText(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.target.blur();
      }}
      className="offer-cell-input"
      style={{ width, ...style }}
    />
  );
}

function UploadModal({ classYears, onClose, onImport }) {
  const [classYear, setClassYear] = useState(classYears[classYears.length - 1] || new Date().getFullYear().toString());
  const [file, setFile] = useState(null);
  const [state, setState] = useState("idle"); // idle | working | done | error
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file || !classYear.trim()) return;
    setState("working");
    try {
      const result = await onImport(file, classYear.trim());
      setSummary(result);
      setState("done");
    } catch (err) {
      console.error("Offer import failed", err);
      setError(err.message || "Something went wrong reading that file.");
      setState("error");
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex",
        alignItems: "center", justifyContent: "center", padding: 20, zIndex: 60,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8,
          width: 480, maxWidth: "100%", padding: 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <h2 className="oswald" style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
            Upload Offers
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 4, lineHeight: 0 }}>
            <X size={18} />
          </button>
        </div>

        {state === "done" ? (
          <div>
            <p style={{ fontSize: 14, color: "var(--success)", marginTop: 0 }}>
              Imported {summary.teamsImported} team{summary.teamsImported === 1 ? "" : "s"}, {summary.rowsImported} offer rows.
            </p>
            {summary.skippedSheets.length > 0 && (
              <p style={{ fontSize: 12.5, color: "var(--text-faint)" }}>
                Skipped sheets not recognized as a team: {summary.skippedSheets.join(", ")}
              </p>
            )}
            <button
              onClick={onClose}
              style={{ background: "var(--accent-bg)", border: "1px solid var(--accent)", color: "var(--accent)", borderRadius: 5, padding: "8px 16px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label style={{ display: "block", fontSize: 11, color: "var(--text-faint)", marginBottom: 5 }}>Class Year</label>
            <input
              value={classYear}
              onChange={(e) => setClassYear(e.target.value)}
              placeholder="e.g. 2027"
              style={{
                width: "100%", background: "var(--bg-page)", border: "1px solid var(--border)", color: "var(--text-primary)",
                borderRadius: 5, padding: "8px 10px", fontSize: 14, marginBottom: 16, fontFamily: "inherit",
              }}
            />
            <label style={{ display: "block", fontSize: 11, color: "var(--text-faint)", marginBottom: 5 }}>Workbook (.xlsx)</label>
            <input
              type="file"
              accept=".xlsx"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              style={{ width: "100%", fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}
            />
            <p style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 0 }}>
              Each recognized team tab replaces that team's rows for this class year -- a player dropped from the
              export won't linger. Sheets like Assignments, Questionnaire, or the breakdown tabs are skipped
              automatically.
            </p>
            {error && <p style={{ fontSize: 13, color: "var(--danger)" }}>{error}</p>}
            <button
              type="submit"
              disabled={!file || state === "working"}
              style={{
                display: "flex", alignItems: "center", gap: 7,
                background: "var(--accent-bg)", border: "1px solid var(--accent)", color: "var(--accent)",
                borderRadius: 5, padding: "9px 16px", fontSize: 13.5, fontWeight: 700, cursor: file ? "pointer" : "not-allowed",
                opacity: file ? 1 : 0.5,
              }}
            >
              {state === "working" ? <Loader2 size={15} className="spin" /> : <Upload size={15} />}
              {state === "working" ? "Importing…" : "Import"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function HeatCell({ value, max, align, bold, isTop }) {
  const ratio = max > 0 ? value / max : 0;
  return (
    <td
      className="tabular"
      style={{
        textAlign: align || "right",
        padding: "7px 10px",
        fontSize: 13,
        color: isTop ? "var(--accent)" : "var(--text-secondary)",
        fontWeight: bold || isTop ? 700 : 400,
        background: value > 0 ? `color-mix(in srgb, var(--accent) ${Math.round(ratio * 55)}%, transparent)` : "transparent",
      }}
    >
      {value || 0}
    </td>
  );
}

function TrendCard({ icon: Icon, label, value, sub }) {
  return (
    <div
      style={{
        display: "flex", flexDirection: "column", gap: 4, background: "var(--accent-bg)",
        border: "1px solid var(--accent)", borderRadius: 8, padding: "14px 18px", minWidth: 170,
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--accent)", letterSpacing: "0.03em", textTransform: "uppercase" }}>
        <Icon size={13} /> {label}
      </span>
      <span className="oswald" style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)" }}>{sub}</span>
      <span className="tabular" style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{value}</span>
    </div>
  );
}

function BreakdownTables({ classYear, conference, tracker }) {
  const posData = useMemo(() => tracker.positionBreakdown(classYear, conference), [classYear, conference, tracker]);
  const areaData = useMemo(() => tracker.areaBreakdown(classYear, conference), [classYear, conference, tracker]);

  const topTeamPos = useMemo(() => {
    let best = { team: null, label: "", n: -1 };
    posData.teams.forEach(({ team, label }) => {
      const n = posData.totals[team] || 0;
      if (n > best.n) best = { team, label, n };
    });
    return best;
  }, [posData]);

  const topState = areaData.states[0];
  const topPosition = useMemo(() => {
    let best = { pos: null, n: -1 };
    posData.positions.forEach((pos) => {
      const n = Object.values(posData.counts[pos] || {}).reduce((a, b) => a + b, 0);
      if (n > best.n) best = { pos, n };
    });
    return best;
  }, [posData]);

  const thStyle = { textAlign: "right", padding: "7px 10px", fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase", whiteSpace: "nowrap" };
  const rowLabelStyle = { textAlign: "left", padding: "7px 10px", fontSize: 13, fontWeight: 700, color: "var(--text-primary)" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <TrendCard icon={TrendingUp} label="Most Active" value={`${topTeamPos.n} offers`} sub={topTeamPos.label || "—"} />
        <TrendCard icon={MapPin} label="Top State" value={`${areaData.stateTotals[topState] || 0} offers`} sub={topState || "—"} />
        <TrendCard icon={TrendingUp} label="Top Position" value={`${topPosition.n} offers`} sub={topPosition.pos || "—"} />
      </div>

      <div>
        <h3 className="oswald" style={{ fontSize: 17, fontWeight: 700, margin: "0 0 12px", color: "var(--accent)" }}>Position Breakdown</h3>
        <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 6 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--bg-surface)" }}>
                <th style={{ ...thStyle, textAlign: "left" }}>Position</th>
                {posData.teams.map(({ team, label }) => (
                  <th key={team} style={thStyle}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {posData.positions.map((pos) => {
                const rowMax = Math.max(...posData.teams.map(({ team }) => posData.counts[pos]?.[team] || 0), 1);
                return (
                  <tr key={pos} style={{ borderTop: "1px solid var(--border-subtle)" }}>
                    <td style={rowLabelStyle}>{pos}</td>
                    {posData.teams.map(({ team }) => {
                      const v = posData.counts[pos]?.[team] || 0;
                      return <HeatCell key={team} value={v} max={rowMax} isTop={v === rowMax && v > 0} />;
                    })}
                  </tr>
                );
              })}
              <tr style={{ borderTop: "2px solid var(--border)", background: "var(--bg-surface)" }}>
                <td style={rowLabelStyle}>Totals</td>
                {posData.teams.map(({ team }) => (
                  <td key={team} style={{ textAlign: "right", padding: "8px 10px", fontSize: 13.5, fontWeight: 700, color: "var(--accent)" }} className="tabular">
                    {posData.totals[team] || 0}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="oswald" style={{ fontSize: 17, fontWeight: 700, margin: "0 0 12px", color: "var(--accent)" }}>Offer Area Breakdown</h3>
        <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 6, maxHeight: 420, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--bg-surface)" }}>
                <th style={{ ...thStyle, textAlign: "left" }}>State</th>
                {areaData.teams.map(({ team, label }) => (
                  <th key={team} style={thStyle}>{label}</th>
                ))}
                <th style={thStyle}>Total</th>
              </tr>
            </thead>
            <tbody>
              {areaData.states.map((state) => {
                const rowMax = Math.max(...areaData.teams.map(({ team }) => areaData.counts[state]?.[team] || 0), 1);
                return (
                  <tr key={state} style={{ borderTop: "1px solid var(--border-subtle)" }}>
                    <td style={rowLabelStyle}>{state}</td>
                    {areaData.teams.map(({ team }) => {
                      const v = areaData.counts[state]?.[team] || 0;
                      return <HeatCell key={team} value={v} max={rowMax} isTop={v === rowMax && v > 0} />;
                    })}
                    <td style={{ textAlign: "right", padding: "8px 10px", fontSize: 13.5, fontWeight: 700, color: "var(--accent)" }} className="tabular">
                      {areaData.stateTotals[state]}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SortIcon({ active, dir }) {
  if (!active) return <ChevronsUpDown size={12} style={{ opacity: 0.4 }} />;
  return dir === "desc" ? <ChevronDown size={13} /> : <ChevronUp size={13} />;
}

function TeamOffersTable({ rows, onEdit, sortKey, sortDir, onSort, teamColor }) {
  const tdStyle = { padding: "4px 10px", fontSize: 13.5, color: "var(--text-secondary)", borderRight: "1px solid var(--border-faint)" };
  const thStyle = {
    textAlign: "left", padding: "9px 10px", fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase",
    whiteSpace: "nowrap", cursor: "pointer", userSelect: "none",
  };

  if (rows.length === 0) {
    return <div style={{ fontSize: 13, color: "var(--text-faint)", padding: "20px 0" }}>No offers on file for this team yet.</div>;
  }

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 6, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr
            style={{
              background: teamColor ? `color-mix(in srgb, ${teamColor} 22%, var(--bg-surface))` : "var(--bg-surface)",
              transition: "background 0.2s ease",
            }}
          >
            {FIELDS.map(({ key, label }) => (
              <th key={key} style={thStyle} onClick={() => onSort(key)}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  {label}
                  <SortIcon active={sortKey === key} dir={sortDir} />
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderTop: "1px solid var(--border-subtle)" }}>
              {FIELDS.map(({ key, width, upper }) => {
                if (key === "status") {
                  const style = statusStyle(r.status);
                  return (
                    <td key={key} style={tdStyle}>
                      <EditableCell
                        value={r.status}
                        upper={upper}
                        width={width}
                        onCommit={(v) => onEdit(r, key, v)}
                        style={{ ...style, borderRadius: 4, fontWeight: 600, fontSize: 12 }}
                      />
                    </td>
                  );
                }
                return (
                  <td
                    key={key}
                    style={{
                      ...tdStyle,
                      ...(key === "player" ? { fontWeight: 600, color: "var(--text-primary)" } : null),
                      ...(key === "position" ? { color: teamColor || "var(--accent)", fontWeight: 700 } : null),
                    }}
                    className={key === "dateOffered" ? "tabular" : undefined}
                  >
                    <EditableCell value={r[key]} upper={upper} width={width} onCommit={(v) => onEdit(r, key, v)} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STRING_SORT_KEYS = new Set(["player", "highSchool", "state", "position", "status", "pipelineStatus", "notes"]);

// Dates come in as free text (M/D/YY, sometimes M/D/YYYY) rather than
// real Date values, so a plain string sort gets it wrong -- "2/2/26"
// sorts after "2/10/26" alphabetically even though Feb 2 is earlier.
// Parsed to a timestamp for sorting only; the display value is
// untouched.
function parseOfferDate(value) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec((value || "").trim());
  if (!m) return null;
  let [, mo, da, yr] = m;
  if (yr.length === 2) yr = (Number(yr) < 50 ? "20" : "19") + yr;
  const t = new Date(Number(yr), Number(mo) - 1, Number(da)).getTime();
  return Number.isNaN(t) ? null : t;
}

export default function OfferTracker({ onBack }) {
  const [theme, setTheme] = useState(() => {
    const saved = typeof window !== "undefined" && window.localStorage.getItem("gridline-theme");
    return saved === "light" || saved === "dark" ? saved : "dark";
  });
  const [uploadOpen, setUploadOpen] = useState(false);
  const [classYear, setClassYear] = useState(null);
  const [conference, setConference] = useState("MAC");
  const [subView, setSubView] = useState("teams"); // "teams" | "trends"
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [sortKey, setSortKey] = useState("player");
  const [sortDir, setSortDir] = useState("asc");

  const tracker = useOfferTracker();
  const activeClassYear = classYear || tracker.classYears[tracker.classYears.length - 1] || null;

  const teams = useMemo(
    () => (activeClassYear ? tracker.teamsForConference(activeClassYear, conference) : []),
    [activeClassYear, conference, tracker]
  );
  const activeTeam = selectedTeam && teams.some((t) => t.team === selectedTeam) ? selectedTeam : teams[0]?.team;
  const activeTeamMeta = teams.find((t) => t.team === activeTeam);

  const teamRows = useMemo(() => {
    const rows = activeClassYear && activeTeam ? tracker.rowsForTeam(activeClassYear, activeTeam) : [];
    return [...rows].sort((a, b) => {
      if (sortKey === "dateOffered") {
        const at = parseOfferDate(a.dateOffered);
        const bt = parseOfferDate(b.dateOffered);
        if (at == null && bt == null) return 0;
        if (at == null) return 1;
        if (bt == null) return -1;
        return sortDir === "desc" ? bt - at : at - bt;
      }
      const av = (a[sortKey] || "").toString();
      const bv = (b[sortKey] || "").toString();
      const cmp = STRING_SORT_KEYS.has(sortKey) ? av.localeCompare(bv) : (parseFloat(av) || 0) - (parseFloat(bv) || 0);
      return sortDir === "desc" ? -cmp : cmp;
    });
  }, [activeClassYear, activeTeam, tracker, sortKey, sortDir]);

  function handleSort(key) {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function toggleTheme() {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      window.localStorage.setItem("gridline-theme", next);
      return next;
    });
  }

  const teamAccent = activeTeamMeta?.color;

  return (
    <div
      className="app-shell"
      data-theme={theme}
      style={{
        display: "flex", flexDirection: "column", overflow: "hidden",
        background: "var(--bg-page)", color: "var(--text-primary)",
        fontFamily: "'Century Gothic', 'Jost', 'Helvetica Neue', Arial, sans-serif",
      }}
    >
      <div style={{ flexShrink: 0, position: "relative", padding: "20px var(--gutter) 16px" }}>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 3, background: "linear-gradient(90deg, var(--gold), var(--maroon))" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
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
            <img src={cmuHelmet} alt="Central Michigan Chippewas helmet" style={{ height: 34, width: "auto", flexShrink: 0 }} />
            <h1 className="oswald app-title" style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "0.01em" }}>
              Offer Tracker
            </h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <button
              onClick={() => setUploadOpen(true)}
              style={{
                display: "flex", alignItems: "center", gap: 7, flexShrink: 0,
                background: "var(--accent-bg)", border: "1px solid var(--accent)", color: "var(--accent)",
                borderRadius: 5, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer",
              }}
            >
              <Upload size={15} /> Upload
            </button>
            <button
              onClick={toggleTheme}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)",
                borderRadius: 5, width: 34, height: 34, cursor: "pointer",
              }}
            >
              {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>
        </div>
      </div>

      {!activeClassYear ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 15, color: "var(--text-muted)" }}>No offer data yet.</div>
          <button
            onClick={() => setUploadOpen(true)}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              background: "var(--accent-bg)", border: "1px solid var(--accent)", color: "var(--accent)",
              borderRadius: 5, padding: "10px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer",
            }}
          >
            <Upload size={16} /> Upload a workbook
          </button>
        </div>
      ) : (
        <>
          <div style={{ flexShrink: 0, padding: "16px var(--gutter) 0", display: "flex", gap: 4, borderBottom: "1px solid var(--border)" }}>
            {tracker.classYears.map((y) => (
              <button
                key={y}
                onClick={() => setClassYear(y)}
                className="oswald"
                style={{
                  background: "none", border: "none", cursor: "pointer", padding: "10px 18px 12px", fontSize: 15, fontWeight: 600,
                  color: y === activeClassYear ? "var(--accent)" : "var(--text-muted)",
                  borderBottom: y === activeClassYear ? "2px solid var(--accent)" : "2px solid transparent",
                  marginBottom: -1,
                }}
              >
                Class of {y}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "16px var(--gutter) var(--gutter)" }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", gap: 6 }}>
                {CONFERENCE_ORDER.map((c) => (
                  <button
                    key={c}
                    onClick={() => { setConference(c); setSelectedTeam(null); }}
                    style={{
                      background: c === conference ? "var(--accent-bg)" : "var(--bg-surface)",
                      border: c === conference ? "1px solid var(--accent)" : "1px solid var(--border)",
                      color: c === conference ? "var(--accent)" : "var(--text-muted)",
                      borderRadius: 5, padding: "7px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer",
                    }}
                  >
                    {CONFERENCE_LABEL[c]}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {["teams", "trends"].map((v) => (
                  <button
                    key={v}
                    onClick={() => setSubView(v)}
                    style={{
                      background: v === subView ? "var(--bg-surface)" : "none",
                      border: "1px solid var(--border)",
                      color: v === subView ? "var(--text-primary)" : "var(--text-faint)",
                      borderRadius: 5, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", textTransform: "capitalize",
                    }}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {subView === "teams" ? (
              <>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
                  {teams.map(({ team, label, color }) => {
                    const active = team === activeTeam;
                    return (
                      <button
                        key={team}
                        onClick={() => setSelectedTeam(team)}
                        style={{
                          background: active ? color || "var(--accent)" : "var(--bg-surface)",
                          border: `1px solid ${active ? color || "var(--accent)" : "var(--border)"}`,
                          color: active ? contrastOn(color) : "var(--text-secondary)",
                          borderRadius: 999, padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                          transition: "background 0.15s ease, color 0.15s ease, border-color 0.15s ease",
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <TeamOffersTable
                  rows={teamRows}
                  onEdit={(row, field, value) => tracker.updateOfferField(row, field, value)}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                  teamColor={teamAccent}
                />
              </>
            ) : (
              <BreakdownTables classYear={activeClassYear} conference={conference} tracker={tracker} />
            )}
          </div>
        </>
      )}

      {uploadOpen && (
        <UploadModal
          classYears={tracker.classYears}
          onClose={() => setUploadOpen(false)}
          onImport={async (file, cy) => {
            const result = await tracker.importWorkbook(file, cy);
            setClassYear(cy);
            return result;
          }}
        />
      )}
    </div>
  );
}
