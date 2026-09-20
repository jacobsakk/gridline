import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Loader2, Plus, Printer, Search, Trash2, Upload, X } from "lucide-react";
import cmuHelmet from "./assets/cmu-helmet.png";
import { ThemeSwitcher, useTheme } from "./theme.jsx";
import { confirmAction } from "./ConfirmDialog.jsx";
import { useOfferTracker } from "./offerData.js";
import { fetchSchedule, teamKey } from "./collegeData.js";
import {
  STATUS_BY_KEY,
  STATUS_OPTIONS,
  fromIso,
  mondayOf,
  toIso,
  useHsTracker,
  weekKey,
  weekLabel,
} from "./hsData.js";

const TABS = ["Master Tracker", "Weekly Tracker", "Staff Face Sheet"];

// Position groups for the weekly view, in the order coaches read a roster.
const POSITION_GROUPS = [
  { key: "QB", label: "QB", match: /^QB$/ },
  { key: "RB", label: "RB", match: /^(RB|FB|HB)$/ },
  { key: "WR", label: "WR", match: /^(WR|SLOT)$/ },
  { key: "TE", label: "TE", match: /^TE$/ },
  { key: "OL", label: "OL", match: /^(OL|OT|OG|OC|C|IOL|LS)$/ },
  { key: "DL", label: "DL", match: /^(DL|DE|DT|EDGE|NT)$/ },
  { key: "LB", label: "LB", match: /^(LB|ILB|OLB|MLB)$/ },
  { key: "DB", label: "DB", match: /^(DB|CB|S|SS|FS|SAF|NB)$/ },
];
const groupOf = (position) => POSITION_GROUPS.find((g) => g.match.test((position || "").toUpperCase()))?.key || "OTHER";

const controlStyle = {
  background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 6,
  padding: "8px 11px", fontSize: 13, fontFamily: "inherit",
};

// ----------------------------------------------------------- shared helpers

const DAY = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const dayName = (iso) => {
  const d = fromIso(iso);
  return d ? DAY[d.getDay()] : "";
};
const shortDate = (iso) => {
  const d = fromIso(iso);
  return d ? `${d.getMonth() + 1}/${d.getDate()}` : "";
};
const mmdd = (iso) => {
  const d = fromIso(iso);
  return d ? d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "";
};

function ResultChip({ game, big }) {
  if (!game?.result) return null;
  const win = game.result === "W";
  const loss = game.result === "L";
  return (
    <span
      className="tabular"
      style={{
        display: "inline-block", borderRadius: 999, padding: big ? "5px 13px" : "2px 8px", fontSize: big ? 13.5 : 11.5, fontWeight: 800, whiteSpace: "nowrap",
        background: win ? "#3CB371" : loss ? "#D9483B" : "var(--bg-surface)", color: win || loss ? "#fff" : "var(--text-primary)",
      }}
    >
      {game.result} {game.ours}-{game.theirs}
    </span>
  );
}

function StatusName({ player, status, children, style }) {
  const s = STATUS_BY_KEY[status];
  return (
    <span
      style={{
        display: "inline-block", borderRadius: 4, padding: s ? "1px 8px" : 0, fontWeight: 700, background: s?.bg, color: s?.fg || "var(--text-primary)", ...style,
      }}
      title={s ? s.label : undefined}
    >
      {children}
    </span>
  );
}

function Legend() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 11, color: "var(--text-faint)" }}>
      <span style={{ letterSpacing: "0.08em" }}>KEY</span>
      {STATUS_OPTIONS.map((s) => (
        <span key={s.key} style={{ background: s.bg, color: s.fg, borderRadius: 4, padding: "2px 8px", fontWeight: 700, letterSpacing: "0.03em", textTransform: "uppercase" }}>
          {s.label}
        </span>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------- upload

function UploadModal({ onClose, onImport }) {
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");
  const input = useRef(null);

  async function run() {
    setBusy(true);
    setError("");
    const done = [];
    try {
      for (const file of files) {
        const summary = await onImport(file);
        done.push({ name: file.name, summary });
      }
      setResults(done);
      setFiles([]);
    } catch (err) {
      setError(err.message || "Something went wrong reading that file.");
      setResults(done);
    }
    setBusy(false);
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 70 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 10, width: 520, maxWidth: "100%", padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h2 className="oswald" style={{ margin: 0, fontSize: 19 }}>Load game tracker files</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", lineHeight: 0 }}><X size={18} /></button>
        </div>
        <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
          Add the master sheet, weekly scores or your staff face-sheet workbook (Excel or CSV, several at once is fine). Players are added or updated, results are filled in, and anything you've edited here (statuses, injuries, game summaries) is kept.
        </p>
        <input ref={input} type="file" accept=".csv,.xlsx,.xls" multiple onChange={(e) => setFiles([...e.target.files])} style={{ display: "none" }} />
        <button onClick={() => input.current?.click()} style={{ ...controlStyle, width: "100%", cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 8 }}>
          <Upload size={15} /> {files.length ? files.map((f) => f.name).join(", ") : "Choose files…"}
        </button>
        {error && <div role="alert" style={{ marginTop: 12, fontSize: 13, color: "var(--danger-text)" }}>{error}</div>}
        {results.map((r) => (
          <div key={r.name} style={{ marginTop: 12, fontSize: 13, color: "var(--success)", lineHeight: 1.5 }}>
            <strong>{r.name}</strong>: {r.summary.created} new, {r.summary.updated} updated, {r.summary.games} games read
            {r.summary.summaries ? `, ${r.summary.summaries} game summaries` : ""}
            {r.summary.unmatchedStaff?.length ? ` · not matched: ${[...new Set(r.summary.unmatchedStaff)].slice(0, 4).join(", ")}${r.summary.unmatchedStaff.length > 4 ? "…" : ""}` : ""}
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button onClick={onClose} style={{ ...controlStyle, cursor: "pointer" }}>{results.length ? "Done" : "Cancel"}</button>
          <button
            onClick={run}
            disabled={!files.length || busy}
            style={{ background: "var(--accent-bg)", border: "1px solid var(--accent)", color: "var(--accent)", borderRadius: 6, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: files.length && !busy ? "pointer" : "default", opacity: files.length && !busy ? 1 : 0.5, display: "flex", alignItems: "center", gap: 7 }}
          >
            {busy ? <Loader2 size={15} className="spin" /> : <Upload size={15} />} {busy ? "Loading…" : "Load"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddPlayerModal({ onClose, onAdd, coaches }) {
  const [f, setF] = useState({ name: "", classYear: "2027", position: "", highSchool: "", state: "", coach: "" });
  const [error, setError] = useState("");
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  async function submit(e) {
    e.preventDefault();
    if (!f.name.trim() || !f.classYear.trim()) return setError("A name and class year are required.");
    try {
      await onAdd(f);
      onClose();
    } catch {
      setError("Couldn't add that player. Try again.");
    }
  }
  const field = { ...controlStyle, width: "100%" };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 70 }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 10, width: 440, maxWidth: "100%", padding: 22, display: "grid", gap: 10 }}>
        <h2 className="oswald" style={{ margin: 0, fontSize: 19 }}>Add player</h2>
        <input id="hs-name" placeholder="Player name *" value={f.name} onChange={set("name")} style={field} autoFocus />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <input id="hs-year" placeholder="Class year *" value={f.classYear} onChange={set("classYear")} style={field} />
          <input id="hs-pos" placeholder="Position" value={f.position} onChange={set("position")} style={field} />
        </div>
        <input id="hs-school" placeholder="High school" value={f.highSchool} onChange={set("highSchool")} style={field} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <input id="hs-state" placeholder="State" value={f.state} onChange={set("state")} style={field} />
          <input id="hs-coach" list="hs-coaches" placeholder="Area coach" value={f.coach} onChange={set("coach")} style={field} />
          <datalist id="hs-coaches">{coaches.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        {error && <div role="alert" style={{ fontSize: 13, color: "var(--danger-text)" }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onClose} style={{ ...controlStyle, cursor: "pointer" }}>Cancel</button>
          <button type="submit" style={{ background: "var(--accent-bg)", border: "1px solid var(--accent)", color: "var(--accent)", borderRadius: 6, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Add player</button>
        </div>
      </form>
    </div>
  );
}

// -------------------------------------------------------------- master tab

function MasterTab({ players, weeks, currentWeek, cmuByWeek, statusOf, onOpenPlayer }) {
  const thBase = {
    position: "sticky", top: 0, zIndex: 2, background: "var(--bg-surface)", padding: "9px 10px", fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase",
    textAlign: "left", whiteSpace: "nowrap", borderBottom: "1px solid var(--border)", letterSpacing: "0.04em",
  };
  const td = { padding: "8px 10px", fontSize: 13, color: "var(--text-secondary)", borderBottom: "1px solid var(--border-subtle)", verticalAlign: "top" };
  return (
    <div className="hs-scroll" style={{ flex: 1, minHeight: 0, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-panel)" }}>
      <table style={{ borderCollapse: "separate", borderSpacing: 0, minWidth: "100%" }}>
        <thead>
          <tr>
            <th style={thBase}>Coach</th>
            <th style={{ ...thBase, position: "sticky", left: 0, zIndex: 3 }}>Name</th>
            <th style={thBase}>Pos</th>
            <th style={thBase}>Yr</th>
            <th style={thBase}>High School</th>
            <th style={thBase}>Record</th>
            {weeks.map((w) => (
              <th key={w} style={{ ...thBase, minWidth: 150, background: w === currentWeek ? "var(--accent-bg)" : thBase.background, color: w === currentWeek ? "var(--accent)" : thBase.color }}>
                <div>{weekLabel(fromIso(w))}</div>
                {cmuByWeek[w] && <div style={{ textTransform: "none", letterSpacing: 0, color: "var(--text-muted)", marginTop: 2, fontWeight: 500 }}>CMU {cmuByWeek[w]}</div>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr key={p.id}>
              <td style={td}>{p.coach || "—"}</td>
              <td style={{ ...td, position: "sticky", left: 0, background: "var(--bg-panel)", zIndex: 1, whiteSpace: "nowrap" }}>
                <span className="player-name" onClick={() => onOpenPlayer(p.id)} style={{ cursor: "pointer" }}>
                  <StatusName player={p} status={statusOf(p)}>{p.name}</StatusName>
                </span>
                {p.injured && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--danger-text)" }}>Injured</span>}
              </td>
              <td style={{ ...td, color: "var(--accent)", fontWeight: 700 }}>{p.position || "—"}</td>
              <td style={td} className="tabular">{p.classYear}</td>
              <td style={{ ...td, whiteSpace: "nowrap" }}>{p.highSchool}{p.state ? ` (${p.state})` : ""}</td>
              <td style={{ ...td, whiteSpace: "nowrap", fontWeight: 700, color: "var(--text-primary)" }} className="tabular">{p.record.played ? p.record.text : "—"}</td>
              {weeks.map((w) => {
                const g = p.games.find((x) => x.date && weekKey(fromIso(x.date)) === w);
                return (
                  <td key={w} style={{ ...td, background: w === currentWeek ? "color-mix(in srgb, var(--accent) 6%, transparent)" : undefined }}>
                    {g ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        {g.result ? <ResultChip game={g} /> : null}
                        <span style={{ color: "var(--text-primary)", fontSize: 12.5 }}>{g.homeAway === "A" ? "@" : ""}{g.opponent}</span>
                        <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{mmdd(g.date)}</span>
                      </div>
                    ) : null}
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

// ------------------------------------------------------------- weekly tab

function pickWeekGames(player, week) {
  const start = fromIso(week);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const inWeek = player.games.filter((g) => g.date && weekKey(fromIso(g.date)) === week);
  const nextWeekStart = new Date(start);
  nextWeekStart.setDate(nextWeekStart.getDate() + 7);
  const next = player.games.find((g) => g.date && fromIso(g.date) >= nextWeekStart);
  return { game: inWeek[0] || null, next: next || null };
}

function EditableSummary({ value, onSave, placeholder = "No stats yet", rows = 2, style }) {
  const [text, setText] = useState(value || "");
  const [dirty, setDirty] = useState(false);
  if (!dirty && (value || "") !== text) setText(value || "");
  return (
    <textarea
      value={text}
      rows={rows}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        setDirty(true);
      }}
      onBlur={() => {
        if (dirty) onSave(text.trim());
        setDirty(false);
      }}
      style={{
        width: "100%", background: "transparent", border: "1px solid transparent", borderRadius: 5, color: "var(--text-secondary)", fontFamily: "inherit",
        fontSize: 12.5, lineHeight: 1.45, padding: "4px 6px", resize: "vertical", ...style,
      }}
      className="offer-cell-input"
    />
  );
}

function WeeklyTab({ players, week, statusOf, updateGame, onOpenPlayer }) {
  const groups = useMemo(() => {
    const map = new Map(POSITION_GROUPS.map((g) => [g.key, []]));
    map.set("OTHER", []);
    players.forEach((p) => map.get(groupOf(p.position)).push(p));
    return [...map.entries()].filter(([, list]) => list.length);
  }, [players]);
  const head = { fontSize: 10.5, letterSpacing: "0.1em", color: "var(--text-faint)", textTransform: "uppercase" };

  return (
    <div className="hs-scroll" style={{ flex: 1, minHeight: 0, overflow: "auto", paddingBottom: 30 }}>
      {groups.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>No players match.</div>}
      {groups.map(([key, list]) => (
        <section key={key} style={{ marginBottom: 26 }}>
          <div className="oswald" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 20, fontWeight: 700, letterSpacing: "0.08em", margin: "0 0 10px" }}>
            <span style={{ width: 4, height: 20, background: "var(--gold)", borderRadius: 2 }} />
            {key === "OTHER" ? "OTHER POSITIONS" : key} <span style={{ fontSize: 13, color: "var(--text-faint)", fontWeight: 400 }}>{list.length}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(200px,1.3fr) minmax(220px,1.5fr) minmax(150px,1fr) minmax(200px,1.2fr)", gap: 12, padding: "0 16px 6px" }}>
            <span style={head}>Player</span><span style={head}>This week</span><span style={head}>Stats</span><span style={head}>Next week</span>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {list.map((p) => {
              const { game, next } = pickWeekGames(p, week);
              const status = statusOf(p);
              return (
                <div
                  key={p.id}
                  style={{
                    display: "grid", gridTemplateColumns: "minmax(200px,1.3fr) minmax(220px,1.5fr) minmax(150px,1fr) minmax(200px,1.2fr)", gap: 12, alignItems: "center",
                    background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 16px", breakInside: "avoid",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <span style={{ width: 38, height: 38, borderRadius: 8, background: STATUS_BY_KEY[status]?.bg || "var(--bg-surface)", color: STATUS_BY_KEY[status]?.fg || "var(--text-primary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, flexShrink: 0 }}>
                      {p.position || "—"}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div className="player-name" onClick={() => onOpenPlayer(p.id)} style={{ fontWeight: 700, color: "var(--text-primary)", cursor: "pointer" }}>
                        {p.name}{p.injured && <span style={{ marginLeft: 6, fontSize: 10.5, color: "var(--danger-text)" }}>INJURED</span>}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {p.highSchool}{p.state ? ` · ${p.state}` : ""} · <span className="tabular">{p.record.played ? p.record.text : "0W - 0L"}</span>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    {game ? (
                      <>
                        <span style={{ color: "var(--text-muted)", fontWeight: 700 }}>{game.homeAway === "A" ? "@" : "vs"}</span>
                        <span className="oswald" style={{ fontSize: 17, fontWeight: 700 }}>{game.opponent}</span>
                        <span style={{ background: "#fff", color: "#111", borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 800 }}>{dayName(game.date)}</span>
                        <ResultChip game={game} big />
                      </>
                    ) : (
                      <span style={{ color: "var(--text-faint)", fontSize: 13 }}>No game this week</span>
                    )}
                  </div>
                  <div>
                    {game ? <EditableSummary value={game.summary} onSave={(text) => updateGame(p, game, { summary: text })} /> : <span style={{ color: "var(--text-faint)", fontSize: 12.5 }}>—</span>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {next ? (
                      <>
                        <span style={{ color: "var(--text-muted)", fontWeight: 700 }}>{next.homeAway === "A" ? "@" : "vs"}</span>
                        <span style={{ fontWeight: 600 }}>{next.opponent}</span>
                        <span style={{ background: "#fff", color: "#111", borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 800 }}>{dayName(next.date)}</span>
                      </>
                    ) : (
                      <span style={{ color: "var(--text-faint)", fontSize: 13 }}>—</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

// ------------------------------------------------------- staff face sheet

function FaceCard({ player, week, status, updatePlayer, updateGame, removePlayer }) {
  const { game, next } = pickWeekGames(player, week);
  const s = STATUS_BY_KEY[status];
  const label = { fontSize: 10, letterSpacing: "0.1em", color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 3 };
  const value = { fontSize: 14, fontWeight: 600, color: "var(--text-primary)", minHeight: 20 };
  return (
    <article style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-panel)", overflow: "hidden", breakInside: "avoid" }} className="hs-card">
      <div style={{ background: s?.bg || "var(--bg-surface)", color: s?.fg || "var(--text-primary)", padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div className="oswald" style={{ fontSize: 18, fontWeight: 700 }}>
            {player.name} ({player.position || "—"}){player.injured && " (Injured)"}
          </div>
          <div style={{ fontSize: 12.5, opacity: 0.85 }}>{player.highSchool}{player.state ? ` (${player.state})` : ""} · Class of {player.classYear}</div>
        </div>
        <div className="hs-no-print" style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <select
            aria-label="Status"
            value={player.status || ""}
            onChange={(e) => updatePlayer(player.id, { status: e.target.value })}
            style={{ ...controlStyle, padding: "4px 6px", fontSize: 11.5, background: "rgba(255,255,255,0.7)", color: "#1A1206" }}
          >
            <option value="">Auto{status && !player.status ? ` (${STATUS_BY_KEY[status]?.label})` : ""}</option>
            {STATUS_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <label style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
            <input type="checkbox" checked={!!player.injured} onChange={(e) => updatePlayer(player.id, { injured: e.target.checked })} /> Injured
          </label>
        </div>
      </div>
      <div style={{ padding: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 16px" }}>
        <div><div style={label}>Record</div><div style={value} className="tabular">{player.record.played ? player.record.text : "—"}</div></div>
        <div>
          <div style={label}>Area coach</div>
          <input
            defaultValue={player.coach || ""}
            onBlur={(e) => e.target.value !== (player.coach || "") && updatePlayer(player.id, { coach: e.target.value.trim() })}
            className="offer-cell-input"
            style={{ ...value, width: "100%", padding: "0 4px" }}
            aria-label="Area coach"
          />
        </div>
        <div><div style={label}>Opponent</div><div style={value}>{game ? `${game.homeAway === "A" ? "@ " : ""}${game.opponent}` : "—"}</div></div>
        <div><div style={label}>Next opponent</div><div style={value}>{next ? `${next.homeAway === "A" ? "@ " : ""}${next.opponent}` : "—"}</div></div>
        <div><div style={label}>Score</div><div style={value}>{game?.result ? <ResultChip game={game} big /> : "—"}</div></div>
        <div><div style={label}>Next week date</div><div style={value} className="tabular">{next ? mmdd(next.date) : "—"}</div></div>
        <div style={{ gridColumn: "1 / -1" }}>
          <div style={label}>Stats / game summary</div>
          {game ? (
            <EditableSummary value={game.summary} onSave={(text) => updateGame(player, game, { summary: text })} rows={3} placeholder="Add stats or a game summary…" style={{ border: "1px solid var(--border-subtle)" }} />
          ) : (
            <div style={{ ...value, color: "var(--text-faint)", fontWeight: 400 }}>No game this week.</div>
          )}
        </div>
      </div>
      <div className="hs-no-print" style={{ padding: "0 14px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
        <span style={{ display: "flex", gap: 12 }}>
          {player.sources?.maxpreps && <a href={player.sources.maxpreps} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>MaxPreps</a>}
          {player.sources?.scorestream && <a href={player.sources.scorestream} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>ScoreStream</a>}
          {player.sources?.profile && <a href={player.sources.profile} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>Profile</a>}
        </span>
        <button
          onClick={() => removePlayer(player)}
          title="Remove this player from the tracker"
          style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", lineHeight: 0 }}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </article>
  );
}

function FaceSheetTab(props) {
  const { players, week, statusOf, focusId, clearFocus } = props;
  const shown = focusId ? players.filter((p) => p.id === focusId) : players;
  return (
    <div className="hs-scroll" style={{ flex: 1, minHeight: 0, overflow: "auto", paddingBottom: 30 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <div className="oswald" style={{ fontSize: 20, fontWeight: 700, letterSpacing: "0.03em" }}>{players[0]?.classYear || ""} HIGH SCHOOL GAME TRACKER · WEEK OF {weekLabel(fromIso(week))}</div>
        <Legend />
      </div>
      {focusId && (
        <button onClick={clearFocus} className="hs-no-print" style={{ ...controlStyle, cursor: "pointer", marginBottom: 12 }}>← Show everyone</button>
      )}
      {shown.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>No players match.</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 14 }}>
        {shown.map((p) => (
          <FaceCard key={p.id} player={p} week={week} status={statusOf(p)} updatePlayer={props.updatePlayer} updateGame={props.updateGame} removePlayer={props.removePlayer} />
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- page

export default function HsGameUpdate({ onBack }) {
  const [theme, setTheme] = useTheme();
  const hs = useHsTracker();
  const offers = useOfferTracker();
  const [tab, setTab] = useState(TABS[0]);
  const [week, setWeek] = useState(weekKey(new Date()));
  const [search, setSearch] = useState("");
  const [coach, setCoach] = useState("");
  const [status, setStatus] = useState("");
  const [focusId, setFocusId] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [cmuByWeek, setCmuByWeek] = useState({});

  // Status comes from the Offer Tracker unless someone set it by hand.
  function derivedStatus(p) {
    const rows = offers.rowsForPlayer(p.classYear, p.name);
    if (!rows.length) return "";
    const committed = rows.find((r) => /^COMMITTED TO /i.test((r.status || "").trim()));
    if (committed) return teamKey(committed.status.replace(/^COMMITTED TO /i, "")) === teamKey("Central Michigan") ? "committed" : "elsewhere";
    const cmu = rows.find((r) => r.team === "CMU");
    if (!cmu) return "";
    return /partial/i.test(cmu.pipelineStatus || "") ? "partial" : "offered";
  }
  const statusOf = (p) => p.status || derivedStatus(p);

  // Our own schedule across the top of the master sheet, like the workbook's first row.
  useEffect(() => {
    fetchSchedule("2117", 2026)
      .then((games) => {
        const map = {};
        games.forEach((g) => {
          const d = new Date(g.date);
          map[weekKey(d)] = `${g.away ? "@" : "vs"} ${g.name}`;
        });
        setCmuByWeek(map);
      })
      .catch(() => {});
  }, []);

  const coaches = useMemo(() => [...new Set(hs.players.map((p) => p.coach).filter(Boolean))].sort(), [hs.players]);
  const weeks = useMemo(() => {
    const set = new Set(hs.players.flatMap((p) => p.games.filter((g) => g.date).map((g) => weekKey(fromIso(g.date)))));
    set.add(weekKey(new Date()));
    return [...set].sort();
  }, [hs.players]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return hs.players
      .filter((p) => (!coach || p.coach === coach) && (!status || (status === "none" ? !statusOf(p) : statusOf(p) === status)))
      .filter((p) => !q || [p.name, p.highSchool, p.state, p.position, p.coach].some((v) => (v || "").toLowerCase().includes(q)));
  }, [hs.players, search, coach, status, offers]); // eslint-disable-line react-hooks/exhaustive-deps

  async function removePlayer(p) {
    const ok = await confirmAction({ title: `Remove ${p.name}?`, message: "This takes them out of the game tracker." });
    if (ok) hs.removePlayer(p.id);
  }

  const openPlayer = (id) => {
    setFocusId(id);
    setTab("Staff Face Sheet");
  };

  return (
    <div
      className="app-shell hs-shell"
      data-theme={theme}
      style={{
        display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg-page)", color: "var(--text-primary)",
        fontFamily: "'Century Gothic', 'Jost', 'Helvetica Neue', Arial, sans-serif",
      }}
    >
      <div className="app-header hs-no-print" style={{ flexShrink: 0, position: "relative", padding: "20px var(--gutter) 16px" }}>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 3, background: "linear-gradient(90deg, var(--gold), var(--maroon))" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button
              onClick={onBack}
              style={{ display: "flex", alignItems: "center", gap: 7, background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 5, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >
              <ArrowLeft size={15} /> Dashboard
            </button>
            <img src={cmuHelmet} alt="Central Michigan Chippewas helmet" style={{ height: 34, width: "auto", flexShrink: 0 }} />
            <h1 className="oswald app-title" style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "0.01em" }}>HS Game Update</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => setUploadOpen(true)} style={{ display: "flex", alignItems: "center", gap: 7, background: "var(--accent-bg)", border: "1px solid var(--accent)", color: "var(--accent)", borderRadius: 5, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              <Upload size={15} /> Upload
            </button>
            <ThemeSwitcher theme={theme} onChange={setTheme} />
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "16px var(--gutter) 0" }}>
        <div className="hs-no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14, flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 4, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 3 }}>
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{ border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", background: t === tab ? "var(--accent)" : "transparent", color: t === tab ? "var(--bg-page)" : "var(--text-muted)" }}
              >
                {t}
              </button>
            ))}
          </div>
          {tab !== "Master Tracker" && (
            <select id="hs-week" value={week} onChange={(e) => setWeek(e.target.value)} style={{ ...controlStyle, cursor: "pointer" }} aria-label="Week">
              {weeks.map((w) => <option key={w} value={w}>{weekLabel(fromIso(w))}{w === weekKey(new Date()) ? " *" : ""}</option>)}
            </select>
          )}
          <div style={{ position: "relative", flex: "1 1 200px", minWidth: 180, maxWidth: 320 }}>
            <Search size={14} color="var(--text-faint)" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
            <input id="hs-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search player, school, state…" style={{ ...controlStyle, width: "100%", paddingLeft: 30 }} />
          </div>
          <select id="hs-coach-filter" value={coach} onChange={(e) => setCoach(e.target.value)} style={{ ...controlStyle, cursor: "pointer" }} aria-label="Area coach">
            <option value="">All coaches</option>
            {coaches.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select id="hs-status-filter" value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...controlStyle, cursor: "pointer" }} aria-label="Status">
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            <option value="none">No status</option>
          </select>
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <span className="tabular" style={{ fontSize: 12.5, color: "var(--text-faint)" }}>{filtered.length} of {hs.players.length}</span>
            <button onClick={() => setAddOpen(true)} style={{ ...controlStyle, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 700 }}><Plus size={14} /> Add player</button>
            <button onClick={() => window.print()} style={{ ...controlStyle, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 700 }}><Printer size={14} /> Print</button>
          </span>
        </div>

        {tab === "Weekly Tracker" && (
          <div className="oswald" style={{ textAlign: "center", fontSize: 26, fontWeight: 700, letterSpacing: "0.04em", margin: "0 0 14px", flexShrink: 0 }}>
            WEEK OF {weekLabel(fromIso(week))}
          </div>
        )}
        {tab !== "Staff Face Sheet" && <div className="hs-no-print" style={{ marginBottom: 12, flexShrink: 0 }}><Legend /></div>}

        {!hs.ready ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Loading…</div>
        ) : hs.players.length === 0 ? (
          <div style={{ padding: "60px 20px", textAlign: "center", color: "var(--text-muted)", lineHeight: 1.6 }}>
            <div className="oswald" style={{ fontSize: 22, color: "var(--text-primary)", marginBottom: 8 }}>No players yet</div>
            Upload your master sheet, weekly scores or the staff workbook to get started.
            <div style={{ marginTop: 16 }}>
              <button onClick={() => setUploadOpen(true)} style={{ background: "var(--accent-bg)", border: "1px solid var(--accent)", color: "var(--accent)", borderRadius: 6, padding: "10px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Upload size={16} /> Upload files
              </button>
            </div>
          </div>
        ) : tab === "Master Tracker" ? (
          <MasterTab players={filtered} weeks={weeks} currentWeek={weekKey(new Date())} cmuByWeek={cmuByWeek} statusOf={statusOf} onOpenPlayer={openPlayer} />
        ) : tab === "Weekly Tracker" ? (
          <WeeklyTab players={filtered} week={week} statusOf={statusOf} updateGame={hs.updateGame} onOpenPlayer={openPlayer} />
        ) : (
          <FaceSheetTab
            players={filtered}
            week={week}
            statusOf={statusOf}
            focusId={focusId}
            clearFocus={() => setFocusId(null)}
            updatePlayer={hs.updatePlayer}
            updateGame={hs.updateGame}
            removePlayer={removePlayer}
          />
        )}
      </div>

      {uploadOpen && <UploadModal onClose={() => setUploadOpen(false)} onImport={(file) => hs.importFile(file)} />}
      {addOpen && <AddPlayerModal onClose={() => setAddOpen(false)} onAdd={hs.addPlayer} coaches={coaches} />}
    </div>
  );
}
