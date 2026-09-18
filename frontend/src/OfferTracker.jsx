import { useMemo, useState } from "react";
import { ArrowLeft, Sun, Moon, Upload, X, Loader2 } from "lucide-react";
import cmuHelmet from "./assets/cmu-helmet.png";
import { CONFERENCE_ORDER, useOfferTracker } from "./offerData.js";

const CONFERENCE_LABEL = { MAC: "MAC", MVC: "MVC / MVFC", IVY: "Ivy League" };

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
  return null;
}

function StatusBadge({ status }) {
  if (!status) return <span style={{ color: "var(--text-faint)" }}>—</span>;
  const style = statusStyle(status);
  if (!style) return <span style={{ fontSize: 12.5 }}>{status}</span>;
  return (
    <span style={{ ...style, borderRadius: 4, padding: "2px 8px", fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap" }}>
      {status}
    </span>
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

function BreakdownTables({ classYear, conference, tracker }) {
  const posData = useMemo(() => tracker.positionBreakdown(classYear, conference), [classYear, conference, tracker]);
  const areaData = useMemo(() => tracker.areaBreakdown(classYear, conference), [classYear, conference, tracker]);

  const thStyle = { textAlign: "right", padding: "6px 10px", fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase", whiteSpace: "nowrap" };
  const tdStyle = { textAlign: "right", padding: "6px 10px", fontSize: 13, color: "var(--text-secondary)" };
  const rowLabelStyle = { textAlign: "left", padding: "6px 10px", fontSize: 13, fontWeight: 600, color: "var(--text-primary)" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h3 className="oswald" style={{ fontSize: 15, fontWeight: 700, margin: "0 0 10px" }}>Position Breakdown</h3>
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
              {posData.positions.map((pos) => (
                <tr key={pos} style={{ borderTop: "1px solid var(--border-subtle)" }}>
                  <td style={rowLabelStyle}>{pos}</td>
                  {posData.teams.map(({ team }) => (
                    <td key={team} style={tdStyle} className="tabular">{posData.counts[pos]?.[team] || 0}</td>
                  ))}
                </tr>
              ))}
              <tr style={{ borderTop: "2px solid var(--border)", background: "var(--bg-surface)" }}>
                <td style={rowLabelStyle}>Totals</td>
                {posData.teams.map(({ team }) => (
                  <td key={team} style={{ ...tdStyle, fontWeight: 700 }} className="tabular">{posData.totals[team] || 0}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="oswald" style={{ fontSize: 15, fontWeight: 700, margin: "0 0 10px" }}>Offer Area Breakdown</h3>
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
              {areaData.states.map((state) => (
                <tr key={state} style={{ borderTop: "1px solid var(--border-subtle)" }}>
                  <td style={rowLabelStyle}>{state}</td>
                  {areaData.teams.map(({ team }) => (
                    <td key={team} style={tdStyle} className="tabular">{areaData.counts[state]?.[team] || 0}</td>
                  ))}
                  <td style={{ ...tdStyle, fontWeight: 700 }} className="tabular">{areaData.stateTotals[state]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TeamOffersTable({ rows }) {
  const tdStyle = { padding: "9px 12px", fontSize: 13.5, color: "var(--text-secondary)", borderRight: "1px solid var(--border-faint)" };

  if (rows.length === 0) {
    return <div style={{ fontSize: 13, color: "var(--text-faint)", padding: "20px 0" }}>No offers on file for this team yet.</div>;
  }

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 6, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "var(--bg-surface)" }}>
            {["Player", "High School", "State", "Pos", "Date Offered", "Status", "Pipeline", "Notes"].map((h) => (
              <th key={h} style={{ textAlign: "left", padding: "9px 12px", fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderTop: "1px solid var(--border-subtle)" }}>
              <td style={{ ...tdStyle, fontWeight: 600, color: "var(--text-primary)" }}>{r.player}</td>
              <td style={tdStyle}>{r.highSchool || "—"}</td>
              <td style={tdStyle}>{r.state || "—"}</td>
              <td style={{ ...tdStyle, color: "var(--accent)", fontWeight: 600 }} className="oswald">{r.position || "—"}</td>
              <td style={tdStyle} className="tabular">{r.dateOffered || "—"}</td>
              <td style={tdStyle}><StatusBadge status={r.status} /></td>
              <td style={tdStyle}>{r.pipelineStatus || "—"}</td>
              <td style={{ ...tdStyle, borderRight: "none" }}>{r.notes || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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

  const tracker = useOfferTracker();
  const activeClassYear = classYear || tracker.classYears[tracker.classYears.length - 1] || null;

  const teams = useMemo(
    () => (activeClassYear ? tracker.teamsForConference(activeClassYear, conference) : []),
    [activeClassYear, conference, tracker]
  );
  const activeTeam = selectedTeam && teams.some((t) => t.team === selectedTeam) ? selectedTeam : teams[0]?.team;
  const teamRows = useMemo(
    () => (activeClassYear && activeTeam ? tracker.rowsForTeam(activeClassYear, activeTeam) : []),
    [activeClassYear, activeTeam, tracker]
  );

  function toggleTheme() {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      window.localStorage.setItem("gridline-theme", next);
      return next;
    });
  }

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
                  {teams.map(({ team, label }) => (
                    <button
                      key={team}
                      onClick={() => setSelectedTeam(team)}
                      style={{
                        background: team === activeTeam ? "var(--accent)" : "var(--bg-surface)",
                        border: team === activeTeam ? "1px solid var(--accent)" : "1px solid var(--border)",
                        color: team === activeTeam ? "var(--bg-page)" : "var(--text-secondary)",
                        borderRadius: 999, padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <TeamOffersTable rows={teamRows} />
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
