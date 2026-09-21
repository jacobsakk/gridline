import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, Camera, GripVertical, ArrowLeft, ArrowUp, ChevronLeft, ChevronRight, Eye, EyeOff, FileText, Loader2, Plus, Printer, Search, Trash2, Upload, X } from "lucide-react";
import cmuHelmet from "./assets/cmu-helmet.png";
import { ThemeSwitcher, useTheme } from "./theme.jsx";
import { confirmAction } from "./ConfirmDialog.jsx";
import { firstNameKey, lastNameKey, normalizePlayerKey, normalizePosition, useOfferTracker } from "./offerData.js";
import { initialSubRoute, setSubRoute } from "./route.js";
import { PlayerProfileModal, ThemeContext, toTitleCase } from "./OfferTracker.jsx";
import { fetchSchedule, teamKey } from "./collegeData.js";
import {
  SEASON_YEAR,
  sameSchool,
  STATUS_BY_KEY,
  STATUS_OPTIONS,
  fromIso,
  matchPhotoFiles,
  mondayOf,
  photoFromFile,
  toIso,
  useHsTracker,
  weekKey,
  weekLabel,
} from "./hsData.js";

const TABS = ["Master Tracker", "Weekly Tracker", "Staff Face Sheet"];
const TAB_SLUGS = { "Master Tracker": "master", "Weekly Tracker": "weekly", "Staff Face Sheet": "face-sheet" };

// Positions follow the Offer Tracker's set (see normalizePosition there): OG/OT become OL,
// S/DB become SAF, and anything unrecognized is ATH. The order is how a roster is read.
const POSITION_GROUPS = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "SAF", "ATH"].map((key) => ({ key, label: key }));
const groupOf = (position) => normalizePosition(position);

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
  const alt = game.conflict?.scorestream;
  const verified = (game.verifiedBy || []).length > 1 && !alt;
  const title = alt
    ? `Sources disagree: MaxPreps ${game.ours}-${game.theirs}, ScoreStream ${alt.ours}-${alt.theirs}. Showing MaxPreps.`
    : verified
      ? "Confirmed by MaxPreps and ScoreStream"
      : game.scraped
        ? `From ${(game.verifiedBy || ["a source"]).map((v) => (v === "maxpreps" ? "MaxPreps" : "ScoreStream")).join(" and ")} only`
        : undefined;
  return (
    <span
      className="tabular"
      title={title}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5, borderRadius: 999, padding: big ? "5px 13px" : "2px 8px", fontSize: big ? 13.5 : 11.5, fontWeight: 800, whiteSpace: "nowrap",
        background: win ? "#3CB371" : loss ? "#D9483B" : "var(--bg-surface)", color: win || loss ? "#fff" : "var(--text-primary)",
        outline: alt ? "2px solid #FFC82E" : "none",
      }}
    >
      {game.result} {game.ours}-{game.theirs}
      {alt && <AlertTriangle size={big ? 14 : 12} strokeWidth={2.6} aria-label="Sources disagree" />}
    </span>
  );
}

// A player's name. If they're on the Offer Tracker it opens their profile there.
function PlayerLink({ player, linked, onProfile, style, children }) {
  return linked ? (
    <span
      className="player-name"
      role="link"
      tabIndex={0}
      title="Open Offer Tracker profile"
      onClick={() => onProfile(player)}
      onKeyDown={(e) => e.key === "Enter" && onProfile(player)}
      style={{ cursor: "pointer", ...style }}
    >
      {children}
    </span>
  ) : (
    <span
      title="Not on the Offer Tracker yet"
      onClick={() => onProfile(player)}
      style={{ cursor: "pointer", ...style }}
    >
      {children}
    </span>
  );
}

function StatusName({ player, status, why, children, style }) {
  const s = STATUS_BY_KEY[status];
  return (
    <span
      style={{
        display: "inline-block", borderRadius: 4, padding: s ? "1px 8px" : 0, fontWeight: 700, background: s?.bg, color: s?.fg || "var(--text-primary)", ...style,
      }}
      title={why ? `${s ? s.label : "No status"} — ${why}` : s ? s.label : undefined}
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
  // Coaches whose players stay out of the tracker; remembered on this computer.
  const [skip, setSkip] = useState(() => {
    try {
      return window.localStorage.getItem("hsSkipCoaches") ?? "GB";
    } catch {
      return "GB";
    }
  });

  async function run() {
    setBusy(true);
    setError("");
    try {
      window.localStorage.setItem("hsSkipCoaches", skip);
    } catch {
      /* not remembered -- fine */
    }
    const done = [];
    try {
      for (const file of files) {
        const summary = await onImport(file, { skipCoaches: skip.split(",") });
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
        <label style={{ display: "block", marginTop: 14, fontSize: 12.5, color: "var(--text-muted)" }}>
          Leave out players whose area coach is (separate several with commas)
          <input id="hs-skip-coaches" value={skip} onChange={(e) => setSkip(e.target.value)} placeholder="e.g. GB" style={{ ...controlStyle, width: "100%", marginTop: 5 }} />
        </label>
        {error && <div role="alert" style={{ marginTop: 12, fontSize: 13, color: "var(--danger-text)" }}>{error}</div>}
        {results.map((r) => (
          <div key={r.name} style={{ marginTop: 12, fontSize: 13, color: "var(--success)", lineHeight: 1.5 }}>
            <strong>{r.name}</strong>: {r.summary.created} new, {r.summary.updated} updated, {r.summary.games} games read
            {r.summary.summaries ? `, ${r.summary.summaries} game summaries` : ""}
            {r.summary.skipped ? `, ${r.summary.skipped} skipped (removed earlier)` : ""}
            {r.summary.excluded ? `, ${r.summary.excluded} left out (coach ${skip.trim()})` : ""}
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
  const [f, setF] = useState({ name: "", classYear: "2027", position: "", highSchool: "", state: "", coach: "", maxpreps: "", scorestream: "" });
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
        <input id="hs-maxpreps" placeholder="MaxPreps schedule link (fills in results automatically)" value={f.maxpreps} onChange={set("maxpreps")} style={field} />
        <input id="hs-scorestream" placeholder="ScoreStream team link" value={f.scorestream} onChange={set("scorestream")} style={field} />
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

// Position, editable in place. "Auto" follows the Offer Tracker profile (or the HS sheet if there isn't one);
// picking a position here overrides it for this sheet only -- the Offer Tracker is left alone.
function PositionSelect({ player, updatePlayer, style }) {
  return (
    <select
      className="offer-cell-input"
      aria-label={`Position for ${player.name}`}
      value={player.positionOverride || ""}
      onChange={(e) => updatePlayer(player.id, { positionOverride: e.target.value })}
      title={player.positionOverride ? `Set by hand (Auto would be ${player.autoPosition})` : player.positionFromOffers ? "Auto: from the Offer Tracker" : "Auto: from the HS sheet (not on the Offer Tracker)"}
      style={{ cursor: "pointer", fontWeight: 700, color: "var(--accent)", fontSize: 13, ...style }}
    >
      <option value="">{player.autoPosition} (auto)</option>
      {POSITION_GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
    </select>
  );
}

// Area coach, editable in place. Type a new name or pick one already in use; Enter saves, Escape undoes.
function CoachCell({ player, coaches, updatePlayer }) {
  return (
    <input
      key={player.coach || ""}
      className="offer-cell-input"
      list="hs-coach-list"
      defaultValue={player.coach || ""}
      placeholder="—"
      aria-label={`Area coach for ${player.name}`}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = player.coach || "";
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => {
        const next = e.target.value.trim();
        if (next !== (player.coach || "")) updatePlayer(player.id, { coach: next });
      }}
      style={{ width: 110, fontSize: 13, color: "var(--text-secondary)" }}
    />
  );
}

const STATUS_ORDER = Object.fromEntries(STATUS_OPTIONS.map((o, i) => [o.key, i + 1]));
// W > T > L > scheduled-but-unplayed > nothing that week
const resultRank = (g) => (!g ? 0 : g.result === "W" ? 4 : g.result === "T" ? 3 : g.result === "L" ? 2 : 1);

function sortPlayers(players, sort, statusOf) {
  if (!sort.key) return players;
  const dir = sort.dir === "desc" ? -1 : 1;
  const text = (v) => (v || "").toString().toLowerCase();
  const valueOf = (p) => {
    if (sort.key.startsWith("week:")) return resultRank(p.games.find((x) => x.date && weekKey(fromIso(x.date)) === sort.key.slice(5)));
    switch (sort.key) {
      case "name": return text(p.name);
      case "coach": return text(p.coach);
      case "pos": return text(p.position);
      case "year": return text(p.classYear);
      case "school": return text(p.highSchool);
      case "status": return STATUS_ORDER[statusOf(p)] || 99;
      case "record": return p.record.played ? p.record.w / p.record.played + p.record.played / 1000 : -1;
      default: return "";
    }
  };
  // Ties fall back to name so the order is stable.
  return [...players].sort((a, b) => {
    const va = valueOf(a);
    const vb = valueOf(b);
    const c = typeof va === "number" ? va - vb : va.localeCompare(vb);
    return c ? c * dir : text(a.name).localeCompare(text(b.name));
  });
}

function MasterTab({ players, weeks, currentWeek, cmuByWeek, statusOf, statusWhy, onOpenPlayer, onProfile, hasProfile, selected, setSelected, sort, setSort, coaches, updatePlayer }) {
  const thBase = {
    position: "sticky", top: 0, zIndex: 2, background: "var(--bg-surface)", padding: "9px 10px", fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase",
    textAlign: "left", whiteSpace: "nowrap", borderBottom: "1px solid var(--border)", letterSpacing: "0.04em",
  };
  const td = { padding: "8px 10px", fontSize: 13, color: "var(--text-secondary)", borderBottom: "1px solid var(--border-subtle)", verticalAlign: "top" };
  const allSelected = players.length > 0 && players.every((p) => selected.has(p.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(players.map((p) => p.id)));
  const toggleOne = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const clickSort = (key) => setSort((s) => (s.key === key ? (s.dir === "asc" ? { key, dir: "desc" } : { key: "", dir: "asc" }) : { key, dir: "asc" }));
  const SortHead = ({ k, children, style }) => {
    const on = sort.key === k;
    return (
      <th
        style={{ ...thBase, ...style, cursor: "pointer", userSelect: "none", color: on ? "var(--accent)" : style?.color || thBase.color }}
        onClick={() => clickSort(k)}
        aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
        title="Click to sort"
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          {children}
          {on && (sort.dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
        </span>
      </th>
    );
  };
  const checkCol = { width: 38, minWidth: 38, padding: "8px 0 8px 12px" };
  return (
    <div className="hs-scroll" style={{ flex: 1, minHeight: 0, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-panel)" }}>
      <datalist id="hs-coach-list">{coaches.map((c) => <option key={c} value={c} />)}</datalist>
      <table style={{ borderCollapse: "separate", borderSpacing: 0, minWidth: "100%" }}>
        <thead>
          <tr>
            <th className="hs-no-print" style={{ ...thBase, ...checkCol, position: "sticky", left: 0, zIndex: 3 }}>
              <input id="hs-select-all" type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all shown" style={{ cursor: "pointer" }} />
            </th>
            <SortHead k="name" style={{ position: "sticky", left: 38, zIndex: 3 }}>Name</SortHead>
            <SortHead k="coach">Coach</SortHead>
            <SortHead k="pos">Pos</SortHead>
            <SortHead k="year">Yr</SortHead>
            <SortHead k="school">High School</SortHead>
            <SortHead k="record">Record</SortHead>
            {weeks.map((w) => (
              <SortHead key={w} k={`week:${w}`} style={{ minWidth: 150, background: w === currentWeek ? "var(--accent-bg)" : thBase.background, color: w === currentWeek ? "var(--accent)" : thBase.color }}>
                <span>
                  <div>{weekLabel(fromIso(w))}</div>
                  {cmuByWeek[w] && <div style={{ textTransform: "none", letterSpacing: 0, color: "var(--text-muted)", marginTop: 2, fontWeight: 500 }}>CMU {cmuByWeek[w]}</div>}
                </span>
              </SortHead>
            ))}
          </tr>
        </thead>
        <tbody>
          {players.map((p) => {
            const on = selected.has(p.id);
            const rowBg = on ? "color-mix(in srgb, var(--accent) 10%, var(--bg-panel))" : "var(--bg-panel)";
            return (
              <tr key={p.id}>
                <td className="hs-no-print" style={{ ...td, ...checkCol, position: "sticky", left: 0, zIndex: 1, background: rowBg }}>
                  <input type="checkbox" checked={on} onChange={() => toggleOne(p.id)} aria-label={`Select ${p.name}`} style={{ cursor: "pointer" }} />
                </td>
                <td style={{ ...td, position: "sticky", left: 38, background: rowBg, zIndex: 1, whiteSpace: "nowrap" }}>
                  <PlayerLink player={p} linked={hasProfile(p)} onProfile={onProfile}>
                    <StatusName player={p} status={statusOf(p)} why={statusWhy(p)}>{p.name}</StatusName>
                  </PlayerLink>
                  {p.injured && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--danger-text)" }}>Injured</span>}
                  <button className="hs-no-print" onClick={() => onOpenPlayer(p.id)} title="Open face sheet" aria-label={`Face sheet for ${p.name}`} style={{ marginLeft: 6, background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", lineHeight: 0, verticalAlign: "middle" }}>
                    <FileText size={13} />
                  </button>
                </td>
                <td style={{ ...td, padding: "4px 6px", whiteSpace: "nowrap", background: on ? rowBg : undefined }}>
                  <CoachCell player={p} coaches={coaches} updatePlayer={updatePlayer} />
                </td>
                <td style={{ ...td, padding: "4px 6px", background: on ? rowBg : undefined }}>
                  <PositionSelect player={p} updatePlayer={updatePlayer} />
                </td>
                <td style={{ ...td, background: on ? rowBg : undefined }} className="tabular">{p.classYear}</td>
                <td style={{ ...td, whiteSpace: "nowrap", background: on ? rowBg : undefined }}>{p.highSchool}{p.state ? ` (${p.state})` : ""}</td>
                <td style={{ ...td, whiteSpace: "nowrap", fontWeight: 700, color: "var(--text-primary)", background: on ? rowBg : undefined }} className="tabular">{p.record.played ? p.record.text : "—"}</td>
                {weeks.map((w) => {
                  const inWeek = p.games.filter((x) => x.date && weekKey(fromIso(x.date)) === w);
                  return (
                    <td key={w} style={{ ...td, background: on ? rowBg : w === currentWeek ? "color-mix(in srgb, var(--accent) 6%, transparent)" : undefined }}>
                      {inWeek.map((g) => (
                        <div key={g.date + g.opponent} style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: inWeek.length > 1 ? 6 : 0 }}>
                          {g.result ? <ResultChip game={g} /> : null}
                          <span style={{ color: "var(--text-primary)", fontSize: 12.5 }}>{g.homeAway === "A" ? "@" : ""}{g.opponent}</span>
                          <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{mmdd(g.date)}{!g.result && g.date < toIso(new Date()) ? " · no score reported" : ""}</span>
                        </div>
                      ))}
                    </td>
                  );
                })}
              </tr>
            );
          })}
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

function WeeklyTab({ players, week, statusOf, updateGame, onOpenPlayer, onProfile, hasProfile }) {
  const groups = useMemo(() => {
    const map = new Map(POSITION_GROUPS.map((g) => [g.key, []]));
    map.set("OTHER", []);
    players.forEach((p) => map.get(groupOf(p.position)).push(p));
    // Within a position, the order of the key: committed, offered, offer status, partial,
    // committed elsewhere, then anyone with no status; alphabetical inside each.
    const rank = new Map(players.map((p) => [p.id, STATUS_ORDER[statusOf(p)] || 99]));
    map.forEach((list) => list.sort((a, b) => rank.get(a.id) - rank.get(b.id) || (a.name || "").localeCompare(b.name || "")));
    return [...map.entries()].filter(([, list]) => list.length);
  }, [players, statusOf]); // eslint-disable-line react-hooks/exhaustive-deps
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
                      <div style={{ fontWeight: 700, color: "var(--text-primary)" }}>
                        <PlayerLink player={p} linked={hasProfile(p)} onProfile={onProfile}>{p.name}</PlayerLink>
                        {p.injured && <span style={{ marginLeft: 6, fontSize: 10.5, color: "var(--danger-text)" }}>INJURED</span>}
                        <button className="hs-no-print" onClick={() => onOpenPlayer(p.id)} title="Open face sheet" aria-label={`Face sheet for ${p.name}`} style={{ marginLeft: 6, background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", lineHeight: 0, verticalAlign: "middle" }}>
                          <FileText size={13} />
                        </button>
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

// Laid out like the printed staff sheet: a title bar and key, then for each
// player a photo, name and school, record, area coach, opponent, score, next
// opponent, next-week date and a summary box -- eight to a page. Colours are
// fixed rather than themed so the screen matches the paper.
const SHEET = { maroon: "#5B1B2B", grey: "#D9D9D9", ink: "#111" };
const PER_PAGE = 8;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const sheetDate = (iso) => {
  const d = fromIso(iso);
  return d ? `${WEEKDAYS[d.getDay()]}, ${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}` : "—";
};

const valueCell = { background: "#fff", color: SHEET.ink, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", fontSize: "var(--hs-font)", lineHeight: 1.05, padding: "0 6px", overflow: "hidden", minWidth: 0 };
const headCell = { ...valueCell, background: SHEET.maroon, color: "#fff", fontWeight: 800, letterSpacing: "0.02em" };
// Long names shrink to stay on one line instead of wrapping and clipping.
const fit = (text) => {
  const n = (text || "").length;
  const scale = n <= 19 ? 1 : n <= 24 ? 0.86 : n <= 30 ? 0.74 : 0.64;
  return { fontSize: `calc(var(--hs-font) * ${scale})`, whiteSpace: "nowrap" };
};

function FaceBlock({ player, week, status, why, updatePlayer, updateGame, removePlayer, onProfile, hasProfile }) {
  const { game, next } = pickWeekGames(player, week);
  const s = STATUS_BY_KEY[status];
  const [photoError, setPhotoError] = useState("");
  const fileInput = useRef(null);

  async function choosePhoto(file) {
    setPhotoError("");
    try {
      await updatePlayer(player.id, { photo: await photoFromFile(file) });
    } catch (err) {
      setPhotoError(err.message || "Couldn't save that photo.");
    }
  }

  const summaryText = game?.summary || "";
  return (
    <article
      className="hs-block"
      style={{
        position: "relative", display: "grid", gridTemplateColumns: "22% 20% 17.5% 1fr", gridTemplateRows: "repeat(6, var(--hs-row))",
        gap: 1, background: SHEET.ink, border: `1px solid ${SHEET.ink}`, breakInside: "avoid",
      }}
    >
      <div style={{ ...valueCell, gridColumn: 1, gridRow: "1 / 5", padding: 0, position: "relative" }}>
        {player.photo ? (
          <img src={player.photo} alt={`${player.name}`} style={{ height: "100%", width: "auto", maxWidth: "100%", objectFit: "contain", display: "block" }} />
        ) : (
          <span className="hs-no-print" style={{ color: "#8a8a8a", fontSize: 11.5, padding: 6 }}>No photo</span>
        )}
        <div className="hs-no-print hs-tools" style={{ position: "absolute", left: 4, bottom: 4, display: "flex", gap: 4 }}>
          <input ref={fileInput} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => e.target.files[0] && choosePhoto(e.target.files[0])} />
          <button onClick={() => fileInput.current?.click()} title={player.photo ? "Replace photo" : "Add photo"} aria-label={`${player.photo ? "Replace" : "Add"} photo for ${player.name}`} style={toolButton}>
            <Camera size={13} />
          </button>
          {player.photo && (
            <button onClick={() => updatePlayer(player.id, { photo: "" })} title="Remove photo" aria-label={`Remove photo for ${player.name}`} style={toolButton}>
              <X size={13} />
            </button>
          )}
        </div>
        {photoError && <div role="alert" className="hs-no-print" style={{ position: "absolute", inset: "auto 4px 30px 4px", background: "#fff", color: "#B3261E", fontSize: 11, padding: 3, border: "1px solid #B3261E" }}>{photoError}</div>}
      </div>
      <div title={why ? `${s ? s.label : "No status"} — ${why}` : undefined} style={{ ...valueCell, gridColumn: 1, gridRow: 5, background: s?.bg || SHEET.grey, color: s?.fg || SHEET.ink, fontWeight: 800, ...fit(`${player.name} (${player.position || "—"})${player.injured ? " (Injured)" : ""}`) }}>
        <PlayerLink player={player} linked={hasProfile(player)} onProfile={onProfile}>
          {player.name} ({player.position || "—"}){player.injured && " (Injured)"}
        </PlayerLink>
      </div>
      <div style={{ ...valueCell, gridColumn: 1, gridRow: 6, background: SHEET.grey, fontWeight: 700, ...fit(player.highSchool) }}>
        {player.highSchool}{player.state && !/\(\w{2}\)\s*$/.test(player.highSchool || "") ? ` (${player.state})` : ""}
      </div>

      <div style={{ ...headCell, gridColumn: 2, gridRow: 1 }}>RECORD</div>
      <div style={{ ...valueCell, gridColumn: 2, gridRow: 2 }} className="tabular">{player.record.played ? player.record.text : "—"}</div>
      <div style={{ ...headCell, gridColumn: 2, gridRow: 3 }}>OPPONENT</div>
      <div style={{ ...valueCell, gridColumn: 2, gridRow: 4, ...fit(game?.opponent) }}>{game?.opponent || "—"}</div>
      <div style={{ ...headCell, gridColumn: 2, gridRow: 5 }}>SCORE</div>
      <div style={{ ...valueCell, gridColumn: 2, gridRow: 6 }} className="tabular">
        {game?.result ? (
          <span title={game.conflict ? `Sources disagree: MaxPreps ${game.ours}-${game.theirs}, ScoreStream ${game.conflict.scorestream?.ours}-${game.conflict.scorestream?.theirs}` : undefined}>
            {game.result} {game.ours}-{game.theirs}{game.conflict && <span className="hs-no-print" style={{ color: "#B3261E", fontWeight: 800 }}> ⚠</span>}
          </span>
        ) : "—"}
      </div>

      <div style={{ ...headCell, gridColumn: 3, gridRow: 1 }}>AREA COACH</div>
      <div style={{ ...valueCell, gridColumn: 3, gridRow: 2, padding: 0 }}>
        <input
          key={player.coach || ""}
          defaultValue={player.coach || ""}
          onBlur={(e) => e.target.value.trim() !== (player.coach || "") && updatePlayer(player.id, { coach: e.target.value.trim() })}
          aria-label={`Area coach for ${player.name}`}
          placeholder="—"
          style={{ width: "100%", height: "100%", border: "none", background: "transparent", textAlign: "center", fontWeight: 800, fontStyle: "italic", textTransform: "uppercase", color: SHEET.ink, fontFamily: "inherit", fontSize: "var(--hs-font)", padding: "0 4px", minWidth: 0 }}
        />
      </div>
      <div style={{ ...headCell, gridColumn: 3, gridRow: 3 }}>NEXT OPPONENT</div>
      <div style={{ ...valueCell, gridColumn: 3, gridRow: 4, ...fit(next?.opponent) }}>{next?.opponent || "—"}</div>
      <div style={{ ...headCell, gridColumn: 3, gridRow: 5 }}>NEXT WEEK DATE</div>
      <div style={{ ...valueCell, gridColumn: 3, gridRow: 6 }} className="tabular">{next ? sheetDate(next.date) : "—"}</div>

      <div style={{ ...headCell, gridColumn: 4, gridRow: 1 }}>STATS/GAME SUMMARY</div>
      <div style={{ ...valueCell, gridColumn: 4, gridRow: "2 / 7", padding: 0, alignItems: "stretch" }}>
        {game ? (
          <>
            <textarea
              className="hs-no-print"
              key={summaryText}
              defaultValue={summaryText}
              placeholder="Add stats or a game summary…"
              aria-label={`Game summary for ${player.name}`}
              onBlur={(e) => e.target.value.trim() !== summaryText && updateGame(player, game, { summary: e.target.value.trim() })}
              style={{ width: "100%", border: "none", background: "transparent", resize: "none", textAlign: "center", color: SHEET.ink, fontFamily: "inherit", fontSize: "var(--hs-font)", lineHeight: 1.3, padding: "6px 10px" }}
            />
            <div className="hs-print-only" style={{ alignItems: "center", justifyContent: "center", textAlign: "center", padding: "0 10px", lineHeight: 1.25, width: "100%" }}>{summaryText}</div>
          </>
        ) : null}
      </div>

      <div className="hs-no-print hs-tools" style={{ position: "absolute", top: 3, right: 3, display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.92)", border: `1px solid ${SHEET.ink}`, borderRadius: 4, padding: "2px 6px", fontSize: 11.5, color: SHEET.ink, zIndex: 2 }}>
        <select aria-label={`Position for ${player.name}`} value={player.positionOverride || ""} onChange={(e) => updatePlayer(player.id, { positionOverride: e.target.value })} style={{ fontSize: 11.5, background: "#fff", color: SHEET.ink, border: "1px solid #999", borderRadius: 3 }}>
          <option value="">{player.autoPosition} (auto)</option>
          {POSITION_GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
        </select>
        <select aria-label={`Status for ${player.name}`} value={player.status || ""} onChange={(e) => updatePlayer(player.id, { status: e.target.value })} style={{ fontSize: 11.5, background: "#fff", color: SHEET.ink, border: "1px solid #999", borderRadius: 3 }}>
          <option value="">Auto{status && !player.status ? ` (${STATUS_BY_KEY[status]?.label})` : ""}</option>
          {STATUS_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 3, cursor: "pointer" }}>
          <input type="checkbox" checked={!!player.injured} onChange={(e) => updatePlayer(player.id, { injured: e.target.checked })} /> Injured
        </label>
        <button onClick={() => updatePlayer(player.id, { faceSheet: false })} title="Take off the face sheet (stays in the tracker)" aria-label={`Take ${player.name} off the face sheet`} style={{ background: "none", border: "none", cursor: "pointer", lineHeight: 0, color: "#555" }}><EyeOff size={14} /></button>
      </div>
    </article>
  );
}

const toolButton = { background: "rgba(255,255,255,0.92)", border: "1px solid #444", borderRadius: 4, padding: 3, cursor: "pointer", lineHeight: 0, color: "#111" };

const SHEET_SORTS = [
  { key: "custom", label: "My order" },
  { key: "position", label: "Position" },
  { key: "status", label: "Status" },
  { key: "name", label: "Name" },
  { key: "coach", label: "Area coach" },
  { key: "school", label: "High school" },
];

// Position runs QB, RB, WR, TE, OL, DL, LB, DB; status runs committed, offered, ... none.
// Whatever is sorted on, ties fall back to position group and then name.
function sortForSheet(list, key, statusOf) {
  const group = (p) => {
    const i = POSITION_GROUPS.findIndex((g) => g.key === groupOf(p.position));
    return i < 0 ? 99 : i;
  };
  const text = (v) => (v || "").toString().toLowerCase();
  const primary = (p) => {
    switch (key) {
      case "custom": return typeof p.sheetOrder === "number" ? p.sheetOrder : 1e9;
      case "status": return STATUS_ORDER[statusOf(p)] || 99;
      case "name": return text(p.name);
      case "coach": return text(p.coach) || "\uffff";
      case "school": return text(p.highSchool);
      default: return group(p);
    }
  };
  return [...list].sort((a, b) => {
    const pa = primary(a);
    const pb = primary(b);
    const c = typeof pa === "number" ? pa - pb : pa.localeCompare(pb);
    return c || group(a) - group(b) || text(a.position).localeCompare(text(b.position)) || text(a.name).localeCompare(text(b.name));
  });
}

// Choose who is on the face sheet, and in what order. Drag a row (or use the arrows) and the
// sheet follows. Being off the sheet doesn't touch the tracker.
function FaceSheetPicker({ players, statusOf, sortBy, setSortBy, setFaceSheet, setSheetOrder, onClose }) {
  const [q, setQ] = useState("");
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const ordered = useMemo(() => sortForSheet(players, sortBy, statusOf), [players, sortBy]); // eslint-disable-line react-hooks/exhaustive-deps
  const term = q.trim().toLowerCase();
  const visible = ordered.filter((p) => !term || [p.name, p.highSchool, p.position, p.coach].some((v) => (v || "").toLowerCase().includes(term)));
  const on = (p) => p.faceSheet !== false;
  const total = players.filter(on).length;
  const shownIds = visible.map((p) => p.id);
  const canMove = !term; // moving within a filtered list would be ambiguous

  // Saves the new arrangement and switches the sheet to it.
  function arrange(ids) {
    setSortBy("custom");
    setSheetOrder(ids);
  }
  function move(id, delta) {
    const ids = ordered.map((p) => p.id);
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    arrange(ids);
  }
  function drop(targetId) {
    if (!dragId || dragId === targetId) return;
    const ids = ordered.map((p) => p.id).filter((id) => id !== dragId);
    ids.splice(ids.indexOf(targetId), 0, dragId);
    arrange(ids);
  }
  const arrow = { background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", lineHeight: 0, padding: 2 };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 70 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 10, width: 660, maxWidth: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h2 className="oswald" style={{ margin: 0, fontSize: 19 }}>Who is on the face sheet</h2>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", lineHeight: 0 }}><X size={18} /></button>
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
          <strong className="tabular" style={{ color: "var(--text-primary)" }}>{total} of {players.length}</strong> are on it. Untick to take someone off (they stay in the Master and Weekly trackers). Drag a row by its handle, or use the arrows, to set the order; the sheet and its printout follow it.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <input id="hs-picker-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, school, position…" style={{ ...controlStyle, flex: "1 1 180px", minWidth: 0 }} />
          <button onClick={() => setFaceSheet(shownIds, true)} style={{ ...controlStyle, cursor: "pointer" }}>Put all shown on</button>
          <button onClick={() => setFaceSheet(shownIds, false)} style={{ ...controlStyle, cursor: "pointer" }}>Take all shown off</button>
        </div>
        {!canMove && <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 8 }}>Clear the search to reorder.</div>}
        <div className="hs-scroll" style={{ overflow: "auto", border: "1px solid var(--border)", borderRadius: 8, minHeight: 0 }}>
          {visible.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "var(--text-faint)" }}>No players match.</div>}
          {visible.map((p) => {
            const st = STATUS_BY_KEY[statusOf(p)];
            const index = ordered.indexOf(p);
            return (
              <div
                key={p.id}
                draggable={canMove}
                onDragStart={() => setDragId(p.id)}
                onDragOver={(e) => { if (canMove) { e.preventDefault(); setOverId(p.id); } }}
                onDrop={() => { drop(p.id); setDragId(null); setOverId(null); }}
                onDragEnd={() => { setDragId(null); setOverId(null); }}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderBottom: "1px solid var(--border-subtle)", opacity: on(p) ? 1 : 0.55,
                  background: overId === p.id && dragId && dragId !== p.id ? "var(--accent-bg)" : "transparent", outline: dragId === p.id ? "1px dashed var(--accent)" : "none",
                }}
              >
                <span title={canMove ? "Drag to move" : undefined} aria-hidden="true" style={{ cursor: canMove ? "grab" : "default", color: "var(--text-faint)", lineHeight: 0, opacity: canMove ? 1 : 0.3 }}><GripVertical size={16} /></span>
                <input type="checkbox" checked={on(p)} onChange={(e) => setFaceSheet([p.id], e.target.checked)} aria-label={`${p.name} on the face sheet`} />
                <span style={{ fontWeight: 700, color: "var(--text-primary)", flex: "1 1 auto", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                <span style={{ color: "var(--accent)", fontWeight: 700, fontSize: 12.5, width: 34 }}>{p.position || "—"}</span>
                <span style={{ fontSize: 12.5, color: "var(--text-muted)", width: 170, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.highSchool}</span>
                <span style={{ fontSize: 10.5, fontWeight: 800, width: 80, textAlign: "center", borderRadius: 4, padding: "2px 0", background: st?.bg || "transparent", color: st?.fg || "var(--text-faint)", textTransform: "uppercase" }}>{st ? st.label : "—"}</span>
                <span style={{ display: "flex", flexDirection: "column", opacity: canMove ? 1 : 0.3 }}>
                  <button disabled={!canMove || index === 0} onClick={() => move(p.id, -1)} aria-label={`Move ${p.name} up`} style={arrow}><ArrowUp size={13} /></button>
                  <button disabled={!canMove || index === ordered.length - 1} onClick={() => move(p.id, 1)} aria-label={`Move ${p.name} down`} style={arrow}><ArrowDown size={13} /></button>
                </span>
              </div>
            );
          })}
        </div>
        <div style={{ textAlign: "right", marginTop: 12 }}>
          <button onClick={onClose} style={{ background: "var(--accent-bg)", border: "1px solid var(--accent)", color: "var(--accent)", borderRadius: 6, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Done</button>
        </div>
      </div>
    </div>
  );
}

function FaceSheetTab(props) {
  const { players, allPlayers, week, statusOf, focusId, clearFocus, updatePlayer, setFaceSheet, setSheetOrder } = props;
  // Until a sort is picked, the sheet follows a hand-made order if there is one, else position.
  const [chosenSort, setSortBy] = useState(null);
  const sortBy = chosenSort || (allPlayers.some((p) => typeof p.sheetOrder === "number") ? "custom" : "position");
  const [picking, setPicking] = useState(false);
  const onSheet = useMemo(() => sortForSheet(players.filter((p) => p.faceSheet !== false), sortBy, statusOf), [players, sortBy]); // eslint-disable-line react-hooks/exhaustive-deps
  const hiddenCount = players.length - players.filter((p) => p.faceSheet !== false).length;
  const shown = focusId ? players.filter((p) => p.id === focusId) : onSheet;
  const pages = [];
  for (let i = 0; i < shown.length; i += PER_PAGE) pages.push(shown.slice(i, i + PER_PAGE));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const photoInput = useRef(null);

  // Drop in a folder of pictures named after the players ("Sam Rouleau.jpg").
  async function addPhotos(fileList) {
    const { matched, unmatched } = matchPhotoFiles([...fileList], allPlayers);
    setBusy(true);
    let saved = 0;
    const failed = [];
    for (const { file, player } of matched) {
      try {
        await updatePlayer(player.id, { photo: await photoFromFile(file) });
        saved += 1;
      } catch {
        failed.push(file.name);
      }
    }
    setBusy(false);
    setNote(
      `${saved} photo${saved === 1 ? "" : "s"} added.` +
        (unmatched.length ? ` No player matched: ${unmatched.slice(0, 4).join(", ")}${unmatched.length > 4 ? "…" : ""} (name each file after the player).` : "") +
        (failed.length ? ` Couldn't read: ${failed.join(", ")}.` : "")
    );
  }

  return (
    <div className="hs-scroll" style={{ flex: 1, minHeight: 0, overflow: "auto", paddingBottom: 30 }}>
      <div className="hs-no-print" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14, maxWidth: 940, marginInline: "auto" }}>
        {focusId && <button onClick={clearFocus} style={{ ...controlStyle, cursor: "pointer" }}>← Show everyone</button>}
        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: "var(--text-muted)" }}>
          Sort by
          <select id="hs-sheet-sort" value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ ...controlStyle, cursor: "pointer" }}>
            {SHEET_SORTS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
        <button onClick={() => setPicking(true)} style={{ ...controlStyle, cursor: "pointer", display: "flex", alignItems: "center", gap: 7, fontWeight: 700 }}>
          <Eye size={14} /> Choose players{hiddenCount ? ` (${hiddenCount} off)` : ""}
        </button>
        <input ref={photoInput} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { if (e.target.files.length) addPhotos(e.target.files); e.target.value = ""; }} />
        <button onClick={() => photoInput.current?.click()} disabled={busy} style={{ ...controlStyle, cursor: "pointer", display: "flex", alignItems: "center", gap: 7, fontWeight: 700 }}>
          {busy ? <Loader2 size={14} className="spin" /> : <Camera size={14} />} Add photos
        </button>
        <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
          {note || "Name each picture after the player (Sam Rouleau.jpg) to add many at once, or hover a card to add one."}
        </span>
      </div>
      {shown.length === 0 && (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>
          {players.length ? "Everyone is off the face sheet. Use Choose players to put people back on." : "No players match."}
        </div>
      )}
      {picking && <FaceSheetPicker players={allPlayers} statusOf={statusOf} sortBy={sortBy} setSortBy={setSortBy} setFaceSheet={setFaceSheet} setSheetOrder={setSheetOrder} onClose={() => setPicking(false)} />}
      <div className="hs-sheet">
        {pages.map((page, i) => (
          <section key={i} className="hs-page" style={{ maxWidth: 940, marginInline: "auto", marginBottom: 30 }}>
            <div style={{ background: SHEET.maroon, color: "#fff", textAlign: "center", fontWeight: 800, letterSpacing: "0.03em", fontSize: "calc(var(--hs-font) * 1.25)", padding: "5px 8px", border: `1px solid ${SHEET.ink}` }} className="oswald">
              {shown[0]?.classYear || ""} HIGH SCHOOL GAME TRACKER · WEEK OF {weekLabel(fromIso(week))}
            </div>
            <div style={{ display: "flex", border: `1px solid ${SHEET.ink}`, borderTop: "none", background: SHEET.ink, gap: 1 }}>
              <div style={{ ...valueCell, background: SHEET.grey, fontWeight: 800, flex: "0 0 22%", minHeight: "calc(var(--hs-row) * 0.85)" }}>KEY:</div>
              {STATUS_OPTIONS.map((o) => (
                <div key={o.key} style={{ ...valueCell, background: o.bg, color: o.fg, fontWeight: 800, flex: "1 1 0", textTransform: "uppercase", fontSize: "calc(var(--hs-font) * 0.85)" }}>{o.label}</div>
              ))}
            </div>
            {page.map((p) => (
              <FaceBlock key={p.id} player={p} week={week} status={statusOf(p)} why={props.statusWhy(p)} updatePlayer={updatePlayer} updateGame={props.updateGame} removePlayer={props.removePlayer} onProfile={props.onProfile} hasProfile={props.hasProfile} />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

// Games in the past that neither site (nor an uploaded file) has a score for. Type the result in.
function MissingScoresModal({ rows, updateGame, onClose }) {
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState("");
  const key = (r) => `${r.player.id}|${r.game.date}|${r.game.opponent}`;
  const set = (r, patch) => setDraft((d) => ({ ...d, [key(r)]: { result: "W", ours: "", theirs: "", ...d[key(r)], ...patch } }));
  async function save(r) {
    const d = { result: "W", ours: "", theirs: "", ...draft[key(r)] };
    if (d.ours === "" || d.theirs === "") return;
    setSaving(key(r));
    await updateGame(r.player, r.game, { result: d.result, ours: Number(d.ours), theirs: Number(d.theirs) });
    setSaving("");
  }
  const num = { ...controlStyle, width: 58, padding: "6px 8px", textAlign: "center" };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 70 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 10, width: 760, maxWidth: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h2 className="oswald" style={{ margin: 0, fontSize: 19 }}>Missing scores</h2>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", lineHeight: 0 }}><X size={18} /></button>
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
          <strong className="tabular" style={{ color: "var(--text-primary)" }}>{rows.length}</strong> past games have no score from MaxPreps, ScoreStream or your files. Some were scrimmages or games that were never played. Enter a score to fill one in (put our team's score first); a score the scraper finds later will replace it.
        </p>
        <div className="hs-scroll" style={{ overflow: "auto", border: "1px solid var(--border)", borderRadius: 8, minHeight: 0 }}>
          {rows.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "var(--text-faint)" }}>Every past game has a score.</div>}
          {rows.map((r) => {
            const d = { result: "W", ours: "", theirs: "", ...draft[key(r)] };
            return (
              <div key={key(r)} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 12px", borderBottom: "1px solid var(--border-subtle)" }}>
                <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: "var(--text-primary)" }}>{r.player.name} <span style={{ color: "var(--text-faint)", fontWeight: 400, fontSize: 12.5 }}>{r.player.highSchool}</span></div>
                  <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                    {mmdd(r.game.date)} · {r.game.homeAway === "A" ? "@ " : ""}{r.game.opponent}
                    {r.player.sources?.maxpreps && <> · <a href={r.player.sources.maxpreps} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>MaxPreps</a></>}
                    {r.player.sources?.scorestream && <> · <a href={r.player.sources.scorestream} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>ScoreStream</a></>}
                  </div>
                </div>
                <select aria-label="Result" value={d.result} onChange={(e) => set(r, { result: e.target.value })} style={{ ...controlStyle, padding: "6px 8px" }}>
                  <option value="W">W</option><option value="L">L</option><option value="T">T</option>
                </select>
                <input aria-label="Our score" inputMode="numeric" placeholder="Us" value={d.ours} onChange={(e) => set(r, { ours: e.target.value.replace(/\D/g, "") })} style={num} />
                <span style={{ color: "var(--text-faint)" }}>-</span>
                <input aria-label="Their score" inputMode="numeric" placeholder="Them" value={d.theirs} onChange={(e) => set(r, { theirs: e.target.value.replace(/\D/g, "") })} style={num} />
                <button onClick={() => save(r)} disabled={d.ours === "" || d.theirs === "" || saving === key(r)} style={{ background: "var(--accent-bg)", border: "1px solid var(--accent)", color: "var(--accent)", borderRadius: 6, padding: "6px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: d.ours === "" || d.theirs === "" ? 0.5 : 1 }}>
                  {saving === key(r) ? "Saving…" : "Save"}
                </button>
              </div>
            );
          })}
        </div>
        <div style={{ textAlign: "right", marginTop: 12 }}>
          <button onClick={onClose} style={{ background: "var(--accent-bg)", border: "1px solid var(--accent)", color: "var(--accent)", borderRadius: 6, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Done</button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- page

export default function HsGameUpdate({ onBack }) {
  const [theme, setTheme] = useTheme();
  const hs = useHsTracker();
  const offers = useOfferTracker();

  // The player's rows on the Offer Tracker. An exact name match first; otherwise the same class
  // year and last name with a compatible first name (Max/Maxim) at the same school, provided
  // that points at exactly one recruit.
  const matchRows = useCallback(
    (p) => {
      const exact = offers.rowsForPlayer(p.classYear, p.name);
      if (exact.length) return exact;
      const candidates = offers.rowsByLast?.get(`${p.classYear}|${lastNameKey(p.name)}`) || [];
      if (!candidates.length) return [];
      const first = firstNameKey(p.name);
      const found = new Map();
      candidates.forEach((r) => {
        const other = firstNameKey(r.player);
        const bothSchools = p.highSchool && r.highSchool;
        const schoolOk = !bothSchools || sameSchool(p.highSchool, r.highSchool);
        const closeFirst = other === first || (first.length >= 3 && other.length >= 3 && (other.startsWith(first) || first.startsWith(other)));
        if (schoolOk && (closeFirst || (bothSchools && other[0] === first[0]))) found.set(normalizePlayerKey(r.player), r.player);
      });
      return found.size === 1 ? offers.rowsForPlayer(p.classYear, [...found.values()][0]) : [];
    },
    [offers.rowsByPlayer, offers.rowsByLast] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Position, like everywhere else on the site, is the Offer Tracker's: taken from the player's
  // profile there when they have one (the CMU row first, else the most common), and read through
  // the same position rules. The HS sheet's own value is only the fallback.
  const players = useMemo(
    () =>
      hs.players.map((p) => {
        const rows = matchRows(p);
        const positions = rows.map((r) => (r.position || "").trim()).filter(Boolean).map(normalizePosition);
        let auto;
        let fromOffers = false;
        if (positions.length) {
          const cmu = rows.find((r) => r.team === "CMU" && (r.position || "").trim());
          const counts = {};
          positions.forEach((x) => (counts[x] = (counts[x] || 0) + 1));
          auto = cmu ? normalizePosition(cmu.position) : Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
          fromOffers = true;
        } else {
          auto = normalizePosition(p.position);
        }
        // A position typed in on this sheet (positionOverride) beats both.
        const override = POSITION_GROUPS.some((g) => g.key === p.positionOverride) ? p.positionOverride : "";
        // The name reads the way the Offer Tracker spells it (BJ Adams, not Brandon Adams Jr.): the CMU
        // sheet's spelling first, else the most common one.
        let name = p.name;
        if (rows.length) {
          const cmuRow = rows.find((r) => r.team === "CMU");
          const spellings = {};
          rows.forEach((r) => (spellings[r.player] = (spellings[r.player] || 0) + 1));
          const common = Object.keys(spellings).sort((a, b) => spellings[b] - spellings[a])[0];
          name = toTitleCase((cmuRow || {}).player || common);
        }
        return { ...p, name, hsName: p.name, position: override || auto, autoPosition: auto, positionOverride: override, hsPosition: p.position, positionFromOffers: !override && fromOffers };
      }),
    [hs.players, matchRows] // eslint-disable-line react-hooks/exhaustive-deps
  );
  // The open tab and week are kept in the address (#/hs/weekly/2026-09-14) so a refresh returns here.
  const [initial] = useState(initialSubRoute);
  const [tab, setTab] = useState(TABS.find((t) => TAB_SLUGS[t] === initial[0]) || TABS[0]);
  const [week, setWeek] = useState(/^\d{4}-\d{2}-\d{2}$/.test(initial[1] || "") ? initial[1] : weekKey(new Date()));
  useEffect(() => {
    setSubRoute("hs", tab === "Master Tracker" ? [TAB_SLUGS[tab]] : [TAB_SLUGS[tab], week]);
  }, [tab, week]);
  const [search, setSearch] = useState("");
  const [coach, setCoach] = useState("");
  const [status, setStatus] = useState("");
  const [focusId, setFocusId] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [profile, setProfile] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [sort, setSort] = useState({ key: "", dir: "asc" });
  const [undo, setUndo] = useState(null);
  const [missingOpen, setMissingOpen] = useState(false);
  const [cmuByWeek, setCmuByWeek] = useState({});

  // Status comes from the Offer Tracker unless someone set it by hand. `why` says which,
  // so a surprising color can be traced to its source (shown when hovering the name).
  function statusInfo(p) {
    if (p.status) return { key: p.status, why: `Set by hand on this tracker (${STATUS_BY_KEY[p.status]?.label || p.status}). Choose "Auto" to follow the Offer Tracker instead.` };
    const rows = matchRows(p);
    if (!rows.length) return { key: "", why: "Not on the Offer Tracker." };
    const spelled = rows[0].player && rows[0].player.toLowerCase() !== (p.name || "").toLowerCase() ? ` (listed there as ${rows[0].player})` : "";
    const committed = rows.find((r) => /^COMMITTED TO /i.test((r.status || "").trim()));
    if (committed) {
      const to = committed.status.replace(/^COMMITTED TO /i, "");
      const ours = teamKey(to) === teamKey("Central Michigan");
      return { key: ours ? "committed" : "elsewhere", why: `Offer Tracker${spelled}: ${committed.status} (on the ${committed.team} sheet).` };
    }
    const cmu = rows.find((r) => r.team === "CMU");
    if (!cmu) return { key: "", why: `On the Offer Tracker${spelled}, but no CMU offer.` };
    return { key: /partial/i.test(cmu.pipelineStatus || "") ? "partial" : "offered", why: `Offer Tracker${spelled}: CMU offer${cmu.pipelineStatus ? `, ${cmu.pipelineStatus}` : ""}.` };
  }
  const statusOf = (p) => statusInfo(p).key;
  const statusWhy = (p) => statusInfo(p).why;

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

  const coaches = useMemo(() => [...new Set(players.map((p) => p.coach).filter(Boolean))].sort(), [players]);
  // Every week of the season, not just weeks that have a game: the run of Mondays
  // from mid-August to Thanksgiving week, stretched to cover any game outside it.
  const weeks = useMemo(() => {
    const dates = players.flatMap((p) => p.games.filter((g) => g.date).map((g) => fromIso(g.date)));
    const start = mondayOf(new Date(SEASON_YEAR, 7, 10));
    const end = mondayOf(new Date(SEASON_YEAR, 10, 30));
    let first = dates.length ? new Date(Math.min(start, ...dates.map(mondayOf))) : start;
    const last = dates.length ? new Date(Math.max(end, ...dates.map(mondayOf))) : end;
    const out = [];
    for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 7)) out.push(toIso(d));
    return out;
  }, [players]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return players
      .filter((p) => (!coach || p.coach === coach) && (!status || (status === "none" ? !statusOf(p) : statusOf(p) === status)))
      .filter((p) => !q || [p.name, p.hsName, p.highSchool, p.state, p.position, p.coach].some((v) => (v || "").toLowerCase().includes(q)));
  }, [players, search, coach, status, offers]); // eslint-disable-line react-hooks/exhaustive-deps

  const sortedForMaster = useMemo(() => sortPlayers(filtered, sort, statusOf), [filtered, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  async function removePlayer(p) {
    const ok = await confirmAction({ title: `Remove ${p.name}?`, message: "This takes them out of the game tracker." });
    if (ok) {
      hs.removePlayer(p.id);
      setUndo({ ids: [p.id], label: p.name });
    }
  }

  // Bulk removal for whatever is ticked on the master list.
  async function removeSelected() {
    const ids = [...selected].filter((id) => players.some((p) => p.id === id));
    if (!ids.length) return;
    const names = ids.map((id) => players.find((p) => p.id === id)?.name).filter(Boolean);
    const ok = await confirmAction({
      title: `Remove ${ids.length} player${ids.length === 1 ? "" : "s"}?`,
      message: `${names.slice(0, 6).join(", ")}${names.length > 6 ? ` and ${names.length - 6} more` : ""} will come off the tracker. You can undo this right after.`,
      confirmLabel: "Remove",
    });
    if (!ok) return;
    await hs.removePlayers(ids);
    setSelected(new Set());
    setUndo({ ids, label: `${ids.length} player${ids.length === 1 ? "" : "s"}` });
  }

  useEffect(() => {
    if (!undo) return;
    const id = setTimeout(() => setUndo(null), 12000);
    return () => clearTimeout(id);
  }, [undo]);

  const stepWeek = (n) => {
    const at = weeks.indexOf(week) + n;
    if (at >= 0 && at < weeks.length) setWeek(weeks[at]);
  };

  // Past games (this season, not byes) with no score anywhere, oldest first.
  const missingScores = useMemo(() => {
    const today = toIso(new Date());
    const out = [];
    players.forEach((p) =>
      p.games.forEach((g) => {
        if (g.date && !g.bye && !g.result && g.date < today && g.date >= `${SEASON_YEAR}-08-01`) out.push({ player: p, game: g });
      })
    );
    return out.sort((a, b) => a.game.date.localeCompare(b.game.date) || a.player.name.localeCompare(b.player.name));
  }, [players]);

  const hasProfile = (p) => matchRows(p).length > 0;

  const openPlayer = (id) => {
    setFocusId(id);
    setTab("Staff Face Sheet");
  };

  return (
    <div
      className={`app-shell hs-shell${tab === "Staff Face Sheet" ? " hs-face-print" : ""}`}
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
            <span className="tabular" style={{ fontSize: 12.5, color: "var(--text-faint)" }}>{filtered.length} of {players.length}</span>
            {missingScores.length > 0 && (
              <button onClick={() => setMissingOpen(true)} title="Past games no source has a score for" style={{ ...controlStyle, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 700, borderColor: "var(--danger-text)", color: "var(--danger-text)" }}>
                <AlertTriangle size={14} /> Missing scores ({missingScores.length})
              </button>
            )}
            <button onClick={() => setAddOpen(true)} style={{ ...controlStyle, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 700 }}><Plus size={14} /> Add player</button>
            <button onClick={() => window.print()} style={{ ...controlStyle, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 700 }}><Printer size={14} /> Print</button>
          </span>
        </div>

        {tab === "Weekly Tracker" && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, margin: "0 0 14px", flexShrink: 0 }}>
            <button className="hs-no-print" onClick={() => stepWeek(-1)} disabled={weeks.indexOf(week) <= 0} aria-label="Previous week" style={{ ...controlStyle, padding: "6px 8px", lineHeight: 0, cursor: "pointer" }}><ChevronLeft size={18} /></button>
            <div className="oswald" style={{ textAlign: "center", fontSize: 26, fontWeight: 700, letterSpacing: "0.04em" }}>WEEK OF {weekLabel(fromIso(week))}</div>
            <button className="hs-no-print" onClick={() => stepWeek(1)} disabled={weeks.indexOf(week) >= weeks.length - 1} aria-label="Next week" style={{ ...controlStyle, padding: "6px 8px", lineHeight: 0, cursor: "pointer" }}><ChevronRight size={18} /></button>
          </div>
        )}
        {tab !== "Staff Face Sheet" && <div className="hs-no-print" style={{ marginBottom: 12, flexShrink: 0 }}><Legend /></div>}

        {tab === "Master Tracker" && selected.size > 0 && (
          <div className="hs-no-print" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", background: "var(--accent-bg)", border: "1px solid var(--accent)", borderRadius: 8, padding: "8px 14px", marginBottom: 12, flexShrink: 0 }}>
            <strong className="tabular" style={{ fontSize: 13.5 }}>{selected.size} selected</strong>
            <button onClick={removeSelected} style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "1px solid var(--danger-text)", color: "var(--danger-text)", borderRadius: 6, padding: "6px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              <Trash2 size={14} /> Remove selected
            </button>
            <button onClick={() => hs.setFaceSheet([...selected], true)} style={{ ...controlStyle, padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}><Eye size={14} /> Put on face sheet</button>
            <button onClick={() => hs.setFaceSheet([...selected], false)} style={{ ...controlStyle, padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}><EyeOff size={14} /> Take off face sheet</button>
            <button onClick={() => setSelected(new Set())} style={{ ...controlStyle, padding: "6px 12px", cursor: "pointer" }}>Clear</button>
          </div>
        )}
        {undo && (
          <div role="status" className="hs-no-print" style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 14px", marginBottom: 12, flexShrink: 0, fontSize: 13.5 }}>
            <span>Removed {undo.label}.</span>
            <button onClick={() => { hs.restorePlayers(undo.ids); setUndo(null); }} style={{ background: "none", border: "none", color: "var(--accent)", fontWeight: 700, cursor: "pointer", fontSize: 13.5, padding: 0 }}>Undo</button>
          </div>
        )}
        {!hs.ready ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Loading…</div>
        ) : players.length === 0 ? (
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
          <MasterTab players={sortedForMaster} weeks={weeks} currentWeek={weekKey(new Date())} cmuByWeek={cmuByWeek} statusOf={statusOf} statusWhy={statusWhy} onOpenPlayer={openPlayer} onProfile={setProfile} hasProfile={hasProfile} selected={selected} setSelected={setSelected} sort={sort} setSort={setSort} coaches={coaches} updatePlayer={hs.updatePlayer} />
        ) : tab === "Weekly Tracker" ? (
          <WeeklyTab players={filtered} week={week} statusOf={statusOf} updateGame={hs.updateGame} onOpenPlayer={openPlayer} onProfile={setProfile} hasProfile={hasProfile} />
        ) : (
          <FaceSheetTab
            players={filtered}
            allPlayers={players}
            week={week}
            statusOf={statusOf}
            statusWhy={statusWhy}
            focusId={focusId}
            clearFocus={() => setFocusId(null)}
            updatePlayer={hs.updatePlayer}
            updateGame={hs.updateGame}
            setFaceSheet={hs.setFaceSheet}
            setSheetOrder={hs.setSheetOrder}
            removePlayer={removePlayer}
            onProfile={setProfile}
            hasProfile={hasProfile}
          />
        )}
      </div>

      {profile && (hasProfile(profile) ? (
        <ThemeContext.Provider value={theme}>
          <PlayerProfileModal player={matchRows(profile)[0].player} classYear={profile.classYear} tracker={offers} onClose={() => setProfile(null)} />
        </ThemeContext.Provider>
      ) : (
        <div onClick={() => setProfile(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 70 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 10, width: 400, maxWidth: "100%", padding: 22 }}>
            <h2 className="oswald" style={{ margin: "0 0 8px", fontSize: 19 }}>{profile.name}</h2>
            <p style={{ margin: "0 0 16px", fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
              Not on the Offer Tracker yet for the class of {profile.classYear}. Once they show up on a team's board, their name here links straight to their profile.
            </p>
            <div style={{ textAlign: "right" }}><button onClick={() => setProfile(null)} style={{ ...controlStyle, cursor: "pointer" }}>Close</button></div>
          </div>
        </div>
      ))}
      {missingOpen && <MissingScoresModal rows={missingScores} updateGame={hs.updateGame} onClose={() => setMissingOpen(false)} />}
      {uploadOpen && <UploadModal onClose={() => setUploadOpen(false)} onImport={(file, options) => hs.importFile(file, options)} />}
      {addOpen && <AddPlayerModal onClose={() => setAddOpen(false)} onAdd={hs.addPlayer} coaches={coaches} />}
    </div>
  );
}
