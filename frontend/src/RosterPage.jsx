import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { ArrowLeft, Download, ExternalLink, Loader2, Pencil, Plus, Search, Trash2, Upload, X } from "lucide-react";
import cmuHelmet from "./assets/cmu-helmet.png";
import { ThemeSwitcher, useTheme } from "./theme.jsx";
import { confirmAction } from "./ConfirmDialog.jsx";
import { initialSubRoute, setSubRoute } from "./route.js";
import { REAL_STATS, loadRealStats } from "./statsData.js";
import {
  BOARD, GROUPS, UNIT_LABEL, UNIT_OF_GROUP, YL_STYLE, classLabelFor, depthFor, groupOfPosition, idFor, parseRosterFile, playersInSeason,
  snapshotFor, styleForYearsLeft, useRoster, yearsLeftIn,
} from "./rosterData.js";

const CMU_ID = "2117";
const control = {
  background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 6,
  padding: "8px 11px", fontSize: 13, fontFamily: "inherit",
};
const primaryBtn = { background: "var(--accent)", border: "1px solid var(--accent)", color: "var(--bg-page)", borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7 };
const ghostBtn = { ...control, cursor: "pointer", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 7 };
const norm = (t) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const money = (n) => (n == null ? "" : `$${Number(n).toLocaleString()}`);
const SCHOLARSHIP_LABEL = { full: "Scholarship", split: "Split", "walk-on": "Walk-on", "": "—" };

// -------------------------------------------------------------------- pieces

function Chip({ player, yl, onClick, draggable, onDragStart, onDragOver, onDrop, dim }) {
  const st = styleForYearsLeft(yl);
  return (
    <button
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onClick}
      title={`${player.name} · ${player.position || "—"} · ${yl} YL${player.scholarship ? ` · ${SCHOLARSHIP_LABEL[player.scholarship]}` : ""}${player.injured ? " · Injured" : ""}`}
      style={{
        display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left", background: st.bg, color: st.fg, border: `1px solid ${st.border}`,
        borderRadius: 5, padding: "3px 8px", fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: draggable ? "grab" : "pointer", opacity: dim ? 0.35 : 1,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0,
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{player.jersey ? `#${player.jersey} ` : ""}{player.name}</span>
      {player.injured && <span style={{ marginLeft: "auto", background: "#D9483B", color: "#fff", borderRadius: 3, fontSize: 9, padding: "0 4px" }}>INJ</span>}
    </button>
  );
}

function YlKey() {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", fontSize: 11, color: "var(--text-faint)" }}>
      <span style={{ letterSpacing: "0.08em" }}>YEARS LEFT</span>
      {[5, 4, 3, 2, 1].map((n) => (
        <span key={n} style={{ background: YL_STYLE[n].bg, color: YL_STYLE[n].fg, border: `1px solid ${YL_STYLE[n].border}`, borderRadius: 4, padding: "1px 8px", fontWeight: 800 }}>{n} YL</span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- the board

function Board({ unit, depth, byId, yl, edit, onOpen, onMove, filter }) {
  const [drag, setDrag] = useState(null);
  const section = BOARD.find((b) => b.unit === unit);
  const match = (p) => !filter || [p.name, p.position, p.hometown].some((v) => (v || "").toLowerCase().includes(filter));
  return (
    <section style={{ marginBottom: 30 }}>
      <h2 className="oswald" style={{ textAlign: "center", fontSize: 30, letterSpacing: "0.08em", margin: "0 0 14px" }}>{UNIT_LABEL[unit].toUpperCase()}</h2>
      {section.rows.map((row, i) => (
        <div key={i} style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px", marginBottom: 12, overflowX: "auto" }}>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", minWidth: "max-content" }}>
            {row.map((slot) => (
              <div
                key={slot.key}
                onDragOver={(e) => edit && e.preventDefault()}
                onDrop={() => {
                  if (edit && drag) onMove(drag, slot.key, depth[slot.key].length);
                  setDrag(null);
                }}
                style={{ width: 158, minHeight: 60 }}
              >
                <div style={{ textAlign: "center", fontSize: 11.5, letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: 8 }}>{slot.label}</div>
                <div style={{ display: "grid", gap: 6, minHeight: 34 }}>
                  {(depth[slot.key] || []).map((id, index) => {
                    const p = byId.get(id);
                    if (!p) return null;
                    return (
                      <Chip
                        key={id}
                        player={p}
                        yl={yl(p)}
                        dim={!match(p)}
                        draggable={edit}
                        onClick={() => onOpen(p)}
                        onDragStart={() => setDrag(id)}
                        onDragOver={(e) => edit && e.preventDefault()}
                        onDrop={(e) => {
                          e.stopPropagation();
                          if (edit && drag) onMove(drag, slot.key, index);
                          setDrag(null);
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

// ------------------------------------------------------------- the snapshot

function SnapshotPanel({ snap, season, label, goals, admin, showFinance, setShowFinance, financeTotal, onClose, scholarshipLimit }) {
  const th = { fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em", padding: "8px 8px", textAlign: "center", fontWeight: 600 };
  const td = { padding: "8px 8px", textAlign: "center", fontSize: 13.5, borderTop: "1px solid var(--border-subtle)" };
  const pill = (d, goal) => goal ? (
    <span style={{ display: "inline-block", minWidth: 74, borderRadius: 999, padding: "2px 10px", fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.03em", border: `1px solid ${d === 0 ? "var(--success)" : d > 0 ? "#FAF34D" : "#D9483B"}`, color: d === 0 ? "var(--success)" : d > 0 ? "#FAF34D" : "#D9483B", background: "transparent" }}>
      {d === 0 ? "On goal" : d > 0 ? `+${d} over` : `${d} under`}
    </span>
  ) : <span style={{ color: "var(--text-faint)" }} title="No goal set. Use Edit snapshot.">—</span>;
  const block = (title, unitKey) => {
    const rows = snap[unitKey].filter((r) => r.current > 0 || r.goal > 0);
    const tot = rows.reduce((a, r) => ({ current: a.current + r.current, goal: a.goal + r.goal }), { current: 0, goal: 0 });
    return (
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 8px" }}>
          <h3 className="oswald" style={{ margin: 0, fontSize: 16, letterSpacing: "0.06em" }}>{title}</h3>
          <span style={{ flex: 1, height: 2, background: "var(--gold)", opacity: 0.8 }} />
        </div>
        <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={{ ...th, textAlign: "left" }}>Pos</th><th style={th}>Current</th><th style={th}>Goal</th><th style={th}>Diff</th></tr></thead>
            <tbody>
              {[...rows].sort((a, b) => b.current - a.current).map((r) => (
                <tr key={r.group}><td style={{ ...td, textAlign: "left" }}>{r.group}</td><td style={td} className="tabular">{r.current}</td><td style={td} className="tabular">{r.goal}</td><td style={td}>{pill(r.diff, r.goal)}</td></tr>
              ))}
              <tr><td style={{ ...td, textAlign: "left", fontWeight: 800 }}>TOTALS</td><td style={{ ...td, fontWeight: 800 }} className="tabular">{tot.current}</td><td style={{ ...td, fontWeight: 800 }} className="tabular">{tot.goal}</td><td style={td}>{pill(tot.current - tot.goal, tot.goal)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  };
  return (
    <aside className="hs-no-print" style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 430, maxWidth: "100%", background: "var(--bg-page)", borderLeft: "1px solid var(--border)", zIndex: 60, overflowY: "auto", padding: "20px 18px 40px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <div>
          <h2 className="oswald" style={{ margin: 0, fontSize: 24, lineHeight: 1.1 }}>{label}<br />Roster Snapshot</h2>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <button onClick={onClose} aria-label="Close snapshot" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", lineHeight: 0 }}><X size={20} /></button>
          {admin && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)", cursor: "pointer" }}>
              Finances <input type="checkbox" checked={showFinance} onChange={(e) => setShowFinance(e.target.checked)} />
            </label>
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
        <div style={{ border: "1px solid var(--border)", borderRadius: 999, padding: "6px 16px", textAlign: "center" }}>
          <div className="tabular" style={{ fontWeight: 800, fontSize: 16 }}>{snap.scholarships % 1 ? snap.scholarships.toFixed(1) : snap.scholarships}{scholarshipLimit ? ` / ${scholarshipLimit}` : ""}</div>
          <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text-faint)" }}>SCHOLARSHIPS</div>
        </div>
        <div style={{ border: "1px solid var(--border)", borderRadius: 999, padding: "6px 16px", textAlign: "center" }}>
          <div className="tabular" style={{ fontWeight: 800, fontSize: 16 }}>{snap.total}</div>
          <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text-faint)" }}>ROSTER</div>
        </div>
        {admin && showFinance && (
          <div style={{ border: "1px solid var(--accent)", borderRadius: 999, padding: "6px 16px", textAlign: "center" }}>
            <div className="tabular" style={{ fontWeight: 800, fontSize: 16 }}>{money(financeTotal)}</div>
            <div style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text-faint)" }}>REV SHARE {season}</div>
          </div>
        )}
      </div>
      {block("OFFENSE", "offense")}
      {block("DEFENSE", "defense")}
      {block("SPECIALISTS", "specialists")}
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 8px" }}>
        <h3 className="oswald" style={{ margin: 0, fontSize: 16, letterSpacing: "0.06em" }}>BY YEARS LEFT</h3>
        <span style={{ flex: 1, height: 2, background: "var(--gold)", opacity: 0.8 }} />
      </div>
      <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={{ ...th, textAlign: "left" }}>Class</th><th style={th}>Off</th><th style={th}>Spec</th><th style={th}>Def</th><th style={th}>Total</th><th style={th}>% Roster</th></tr></thead>
          <tbody>
            {snap.byYl.map((r) => (
              <tr key={r.yl}>
                <td style={{ ...td, textAlign: "left" }}><span style={{ background: YL_STYLE[r.yl].bg, color: YL_STYLE[r.yl].fg, border: `1px solid ${YL_STYLE[r.yl].border}`, borderRadius: 999, padding: "2px 12px", fontSize: 12, fontWeight: 800 }}>{r.yl} YL</span></td>
                <td style={td} className="tabular">{r.off}</td><td style={td} className="tabular">{r.spec}</td><td style={td} className="tabular">{r.def}</td>
                <td style={{ ...td, fontWeight: 800 }} className="tabular">{r.total}</td><td style={td} className="tabular">{r.pct.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </aside>
  );
}

// -------------------------------------------------------------- spreadsheet

const SHEET_COLUMNS = [
  { key: "jersey", label: "#", get: (p) => Number(p.jersey) || "", w: 52 },
  { key: "name", label: "Name", get: (p) => p.name, w: 170 },
  { key: "position", label: "Pos", get: (p) => p.position, w: 60 },
  { key: "unit", label: "Unit", get: (p) => UNIT_LABEL[UNIT_OF_GROUP[groupOfPosition(p.position)]] || "", w: 96 },
  { key: "cls", label: "Class", get: (p) => p._class, w: 60 },
  { key: "yl", label: "Yrs left", get: (p) => p._yl, w: 74 },
  { key: "eligEnd", label: "Elig. ends", get: (p) => p._end, w: 84 },
  { key: "scholarship", label: "Scholarship", get: (p) => SCHOLARSHIP_LABEL[p.scholarship || ""], w: 100 },
  { key: "height", label: "Ht", get: (p) => p.height, w: 60 },
  { key: "weight", label: "Wt", get: (p) => p.weight, w: 56 },
  { key: "hometown", label: "Hometown", get: (p) => p.hometown, w: 150 },
  { key: "highSchool", label: "High school", get: (p) => p.highSchool, w: 190 },
  { key: "previousSchool", label: "Previous school", get: (p) => p.previousSchool, w: 150 },
  { key: "redshirt", label: "RS", get: (p) => (p.redshirt ? "Yes" : ""), w: 46 },
  { key: "injured", label: "Injured", get: (p) => (p.injured ? "Yes" : ""), w: 66 },
  { key: "instagram", label: "Instagram", get: (p) => p.instagram, w: 130 },
  { key: "twitter", label: "Twitter / X", get: (p) => p.twitter, w: 130 },
  { key: "notes", label: "Notes", get: (p) => p.notes, w: 200 },
];
const PRIVATE_COLUMNS = [
  { key: "dob", label: "DOB", get: (p) => p._private?.dob || "", w: 100 },
  { key: "email", label: "Email", get: (p) => p._private?.email || "", w: 190 },
  { key: "cell", label: "Cell", get: (p) => p._private?.cell || "", w: 120 },
  { key: "revenue", label: "Rev share", get: (p) => p._revenue ?? "", w: 90 },
];

function Spreadsheet({ rows, admin, onOpen, statsHas }) {
  const [sort, setSort] = useState({ key: "jersey", dir: "asc" });
  const columns = admin ? [...SHEET_COLUMNS, ...PRIVATE_COLUMNS] : SHEET_COLUMNS;
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key) || columns[0];
    const dir = sort.dir === "desc" ? -1 : 1;
    return [...rows].sort((a, b) => {
      const va = col.get(a);
      const vb = col.get(b);
      const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va ?? "").localeCompare(String(vb ?? ""), undefined, { numeric: true });
      return (c || (a.name || "").localeCompare(b.name || "")) * dir;
    });
  }, [rows, sort, admin]); // eslint-disable-line react-hooks/exhaustive-deps
  const th = { position: "sticky", top: 0, background: "var(--bg-surface)", zIndex: 2, textAlign: "left", padding: "9px 10px", fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap", cursor: "pointer", borderBottom: "1px solid var(--border)", userSelect: "none" };
  const td = { padding: "7px 10px", fontSize: 13, color: "var(--text-secondary)", borderBottom: "1px solid var(--border-subtle)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 260 };
  return (
    <div className="hs-scroll" style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-panel)", overflow: "auto", maxHeight: "calc(100vh - 250px)" }}>
      <table style={{ borderCollapse: "separate", borderSpacing: 0, minWidth: "100%" }}>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={c.key} onClick={() => setSort((s) => (s.key === c.key ? { key: c.key, dir: s.dir === "asc" ? "desc" : "asc" } : { key: c.key, dir: "asc" }))} style={{ ...th, minWidth: c.w, ...(i === 1 ? { left: 0, zIndex: 3 } : {}), position: "sticky" }}>
                {c.label}{sort.key === c.key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
              </th>
            ))}
            <th style={{ ...th, cursor: "default" }}>Links</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => {
            const st = styleForYearsLeft(p._yl);
            return (
              <tr key={p.id} onClick={() => onOpen(p)} style={{ cursor: "pointer" }}>
                {columns.map((c, i) => {
                  const v = c.get(p);
                  return (
                    <td key={c.key} style={{ ...td, ...(i === 1 ? { position: "sticky", left: 0, background: "var(--bg-panel)", color: "var(--text-primary)", fontWeight: 700 } : {}), ...(c.key === "yl" ? { fontWeight: 800 } : {}) }} className={c.key === "jersey" || c.key === "yl" ? "tabular" : undefined}>
                      {c.key === "yl" ? <span style={{ background: st.bg, color: st.fg, border: `1px solid ${st.border}`, borderRadius: 999, padding: "1px 10px", fontSize: 12 }}>{v}</span> : c.key === "revenue" && v !== "" ? money(v) : v}
                    </td>
                  );
                })}
                <td style={{ ...td, display: "flex", gap: 10 }} onClick={(e) => e.stopPropagation()}>
                  {statsHas(p) ? <a href={`#/tracker/FBS/${encodeURIComponent(p.name)}`} style={{ color: "var(--accent)" }}>Stats</a> : <span style={{ color: "var(--text-faint)" }}>No stats</span>}
                  <a href={`#/colleges/${CMU_ID}/roster`} style={{ color: "var(--accent)" }}>Roster</a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function downloadSheet(rows, admin, label) {
  const columns = admin ? [...SHEET_COLUMNS, ...PRIVATE_COLUMNS] : SHEET_COLUMNS;
  const data = rows.map((p) => Object.fromEntries(columns.map((c) => [c.label, c.get(p)])));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Roster");
  XLSX.writeFile(wb, `CMU roster ${label}.xlsx`);
}

// -------------------------------------------------------------- player pop-up

function Modal({ children, onClose, width = 760 }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 80 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 12, width, maxWidth: "100%", maxHeight: "92vh", overflow: "auto" }}>{children}</div>
    </div>
  );
}

function PlayerModal({ player, season, label, admin, roster, depthSlot, statsLinked, onClose }) {
  const [f, setF] = useState(() => ({
    name: player.name || "", jersey: player.jersey || "", position: player.position || "", yearsLeftNow: String(player._yl), height: player.height || "", weight: player.weight || "",
    hometown: player.hometown || "", highSchool: player.highSchool || "", previousSchool: player.previousSchool || "", scholarship: player.scholarship || "",
    redshirt: !!player.redshirt, injured: !!player.injured, notes: player.notes || "", instagram: player.instagram || "", twitter: player.twitter || "", lastSeason: player.lastSeason || "",
    dob: player._private?.dob || "", email: player._private?.email || "", cell: player._private?.cell || "", revenue: player._revenue ?? "",
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const st = styleForYearsLeft(player._yl);
  const field = { ...control, width: "100%" };
  const ro = !admin;

  async function save() {
    setBusy(true);
    setError("");
    try {
      const yl = parseInt(f.yearsLeftNow, 10);
      await roster.savePlayer(player.id, {
        name: f.name.trim(), jersey: String(f.jersey).replace(/\D/g, ""), position: f.position.trim().toUpperCase(), height: f.height, weight: f.weight, hometown: f.hometown,
        highSchool: f.highSchool, previousSchool: f.previousSchool, scholarship: f.scholarship, redshirt: f.redshirt, injured: f.injured, notes: f.notes,
        instagram: f.instagram, twitter: f.twitter, lastSeason: f.lastSeason ? Number(f.lastSeason) : null,
        ...(Number.isFinite(yl) && yl !== player._yl ? { yearsLeft: yl, asOfSeason: season } : {}),
      });
      await roster.savePrivate(player.id, { dob: f.dob, email: f.email, cell: f.cell });
      const rev = parseFloat(String(f.revenue).replace(/[$,]/g, ""));
      if (Number.isFinite(rev) && rev !== player._revenue) await roster.saveFinance(player.id, season, rev);
      onClose();
    } catch (err) {
      setError(err.message || "That didn't save. Try again.");
    }
    setBusy(false);
  }
  async function remove() {
    const ok = await confirmAction({ title: `Remove ${player.name}?`, message: "They come off the roster in every year. Uploading a file that lists them again brings them back.", confirmLabel: "Remove" });
    if (!ok) return;
    await roster.removePlayer(player.id);
    onClose();
  }
  const label2 = { fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 };
  return (
    <Modal onClose={onClose} width={860}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", padding: "20px 24px", borderBottom: "1px solid var(--border)", borderTop: "3px solid var(--maroon)" }}>
        <div style={{ width: 64, height: 64, borderRadius: 10, background: "var(--bg-surface)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: "var(--text-muted)" }}>{(player.name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("")}</div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2 className="oswald" style={{ margin: 0, fontSize: 28, letterSpacing: "0.03em", textTransform: "uppercase" }}>{player.name}</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
            <span style={{ background: "var(--maroon)", color: "#fff", borderRadius: 999, padding: "2px 12px", fontSize: 11.5, fontWeight: 800 }}>CENTRAL MICHIGAN</span>
            <span style={{ border: "1px solid var(--border)", borderRadius: 999, padding: "2px 12px", fontSize: 11.5, fontWeight: 700 }}>{player.position || "—"}</span>
            <span style={{ background: st.bg, color: st.fg, border: `1px solid ${st.border}`, borderRadius: 999, padding: "2px 12px", fontSize: 11.5, fontWeight: 800 }}>{player._yl} {player._yl === 1 ? "YEAR" : "YEARS"} LEFT</span>
            {player.scholarship && <span style={{ border: "1px solid var(--border)", borderRadius: 999, padding: "2px 12px", fontSize: 11.5, fontWeight: 700 }}>{SCHOLARSHIP_LABEL[player.scholarship].toUpperCase()}</span>}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6 }}>{[player.hometown, player.height, player.weight && `${player.weight} lbs`].filter(Boolean).join(" · ")}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {statsLinked ? <a href={`#/tracker/FBS/${encodeURIComponent(player.name)}`} style={{ ...ghostBtn, textDecoration: "none" }}>Stats in Pre-Portal <ExternalLink size={13} /></a> : <span style={{ ...ghostBtn, cursor: "default", color: "var(--text-faint)" }}>No stats yet</span>}
          <a href={`#/colleges/${CMU_ID}/roster`} style={{ ...ghostBtn, textDecoration: "none" }}>Colleges roster <ExternalLink size={13} /></a>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", lineHeight: 0 }}><X size={20} /></button>
        </div>
      </div>
      <div style={{ padding: 24, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "14px 20px" }}>
        <label><span style={label2}>Name</span><input value={f.name} onChange={set("name")} readOnly={ro} style={field} /></label>
        <label><span style={label2}>Jersey #</span><input value={f.jersey} onChange={set("jersey")} readOnly={ro} style={field} /></label>
        <label><span style={label2}>Position</span><input value={f.position} onChange={set("position")} readOnly={ro} style={field} /></label>
        <label><span style={label2}>Years left in {label}</span><input value={f.yearsLeftNow} onChange={set("yearsLeftNow")} readOnly={ro} inputMode="numeric" style={field} /></label>
        <label><span style={label2}>Scholarship</span>
          <select value={f.scholarship} onChange={set("scholarship")} disabled={ro} style={field}>
            <option value="">Not set</option><option value="full">Scholarship</option><option value="split">Split scholarship</option><option value="walk-on">Walk-on</option>
          </select>
        </label>
        <label><span style={label2}>Not on the roster after</span>
          <select value={f.lastSeason} onChange={set("lastSeason")} disabled={ro} style={field}>
            <option value="">Stays through eligibility</option>{[0, 1, 2, 3, 4].map((n) => <option key={n} value={roster.base + n}>{roster.base + n}</option>)}
          </select>
        </label>
        <label><span style={label2}>Height</span><input value={f.height} onChange={set("height")} readOnly={ro} style={field} /></label>
        <label><span style={label2}>Weight</span><input value={f.weight} onChange={set("weight")} readOnly={ro} style={field} /></label>
        <label><span style={label2}>Hometown</span><input value={f.hometown} onChange={set("hometown")} readOnly={ro} style={field} /></label>
        <label><span style={label2}>High school</span><input value={f.highSchool} onChange={set("highSchool")} readOnly={ro} style={field} /></label>
        <label><span style={label2}>Previous school</span><input value={f.previousSchool} onChange={set("previousSchool")} readOnly={ro} style={field} /></label>
        <label><span style={label2}>Instagram</span><input value={f.instagram} onChange={set("instagram")} readOnly={ro} style={field} /></label>
        <label><span style={label2}>Twitter / X</span><input value={f.twitter} onChange={set("twitter")} readOnly={ro} style={field} /></label>
        <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap", paddingTop: 18 }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={f.redshirt} onChange={set("redshirt")} disabled={ro} /> Redshirt</label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={f.injured} onChange={set("injured")} disabled={ro} /> Injured</label>
        </div>
        <label style={{ gridColumn: "1 / -1" }}><span style={label2}>Notes</span><textarea value={f.notes} onChange={set("notes")} readOnly={ro} rows={2} style={{ ...field, resize: "vertical" }} /></label>
        {admin && (
          <div style={{ gridColumn: "1 / -1", borderTop: "1px solid var(--border)", paddingTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "14px 20px" }}>
            <div style={{ gridColumn: "1 / -1", fontSize: 11, letterSpacing: "0.08em", color: "var(--text-faint)" }}>ADMINS ONLY — private details and dollars</div>
            <label><span style={label2}>Date of birth</span><input value={f.dob} onChange={set("dob")} style={field} /></label>
            <label><span style={label2}>Email</span><input value={f.email} onChange={set("email")} style={field} /></label>
            <label><span style={label2}>Cell</span><input value={f.cell} onChange={set("cell")} style={field} /></label>
            <label><span style={label2}>Revenue share {season} ($)</span><input value={f.revenue} onChange={set("revenue")} inputMode="decimal" style={field} /></label>
          </div>
        )}
        <div style={{ gridColumn: "1 / -1", fontSize: 12.5, color: "var(--text-faint)" }}>{depthSlot ? `Depth chart: ${depthSlot}` : "Not placed on the depth chart"}{player.startSeason > roster.base ? ` · arrives ${player.startSeason}` : ""}</div>
      </div>
      {error && <div role="alert" style={{ padding: "0 24px 12px", color: "var(--danger-text)", fontSize: 13 }}>{error}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", padding: "0 24px 22px", gap: 10 }}>
        {admin ? <button onClick={remove} style={{ ...ghostBtn, color: "var(--danger-text)", borderColor: "var(--danger-text)" }}><Trash2 size={14} /> Remove player</button> : <span />}
        <span style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={ghostBtn}>{admin ? "Cancel" : "Close"}</button>
          {admin && <button onClick={save} disabled={busy} style={primaryBtn}>{busy ? <Loader2 size={14} className="spin" /> : null} Save roster details</button>}
        </span>
      </div>
    </Modal>
  );
}

// ----------------------------------------------------------------- add player

function AddPlayerModal({ season, base, eligibilityYears, onAdd, onClose }) {
  const [f, setF] = useState({ name: "", jersey: "", position: "", eligEnd: "", cls: "FR", height: "", weight: "", hometown: "", highSchool: "" });
  const [error, setError] = useState("");
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const field = { ...control, width: "100%" };
  async function submit(e) {
    e.preventDefault();
    if (!f.name.trim()) return setError("A name is required.");
    // Someone added to a projection year arrives that year; years left are counted from then.
    const end = parseInt(f.eligEnd, 10);
    const yearsLeft = Number.isFinite(end) ? Math.max(1, end - season + 1) : eligibilityYears;
    try {
      await onAdd({
        id: idFor(f.name, f.jersey), name: f.name.trim(), jersey: f.jersey.replace(/\D/g, ""), position: f.position.trim().toUpperCase(), yearsLeft, asOfSeason: season, startSeason: season,
        eligEnd: Number.isFinite(end) ? end : null, height: f.height, weight: f.weight, hometown: f.hometown, highSchool: f.highSchool, scholarship: "", injured: false, redshirt: false, incoming: season > base,
      });
      onClose();
    } catch {
      setError("Couldn't add that player. Try again.");
    }
  }
  return (
    <Modal onClose={onClose} width={520}>
      <form onSubmit={submit} style={{ padding: 22, display: "grid", gap: 10 }}>
        <h2 className="oswald" style={{ margin: 0, fontSize: 20 }}>Add player to {season}{season > base ? " (arrives that year)" : ""}</h2>
        <input placeholder="Name *" value={f.name} onChange={set("name")} style={field} autoFocus />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <input placeholder="Jersey #" value={f.jersey} onChange={set("jersey")} style={field} />
          <input placeholder="Position" value={f.position} onChange={set("position")} style={field} />
          <input placeholder={`Eligibility ends (${season + eligibilityYears - 1})`} value={f.eligEnd} onChange={set("eligEnd")} style={field} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <input placeholder="Height" value={f.height} onChange={set("height")} style={field} />
          <input placeholder="Weight" value={f.weight} onChange={set("weight")} style={field} />
        </div>
        <input placeholder="Hometown" value={f.hometown} onChange={set("hometown")} style={field} />
        <input placeholder="High school" value={f.highSchool} onChange={set("highSchool")} style={field} />
        {error && <div role="alert" style={{ color: "var(--danger-text)", fontSize: 13 }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onClose} style={ghostBtn}>Cancel</button>
          <button type="submit" style={primaryBtn}>Add player</button>
        </div>
      </form>
    </Modal>
  );
}

// --------------------------------------------------------------- upload

function UploadModal({ roster, defaultSeason, onClose }) {
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [season, setSeason] = useState(defaultSeason);
  const [clock, setClock] = useState(roster.eligibilityYears);
  const [mode, setMode] = useState(roster.players.length ? "replace" : "merge");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const input = useRef(null);

  async function read(f, s = season, c = clock) {
    setFile(f);
    setParsed(null);
    setError("");
    setDone("");
    if (!f) return;
    setBusy("read");
    try {
      setParsed(await parseRosterFile(f, { season: s, eligibilityYears: c }));
    } catch (err) {
      setError(err.message || "That file couldn't be read.");
    }
    setBusy("");
  }
  async function run() {
    setBusy("save");
    setError("");
    try {
      const r = await roster.importRoster(parsed, { season, mode, eligibilityYears: clock });
      setDone(`${r.added} added, ${r.updated} updated.`);
      setParsed(null);
      setFile(null);
    } catch (err) {
      setError(err.message || "That didn't save. Try again.");
    }
    setBusy("");
  }
  const dist = parsed ? [5, 4, 3, 2, 1].map((n) => [n, parsed.players.filter((e) => e.player.yearsLeft === n).length]) : [];
  const label = { fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 };
  return (
    <Modal onClose={onClose} width={640}>
      <div style={{ padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h2 className="oswald" style={{ margin: 0, fontSize: 20 }}>Upload roster</h2>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", lineHeight: 0 }}><X size={18} /></button>
        </div>
        <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
          Your staff scholarship workbook works as is: it picks the roster-details sheet, then adds the incoming class, scholarship status and revenue share from the other sheets if they're there. A plain CSV or Excel list with Name, Pos, # and an eligibility or class column works too.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <label><span style={label}>Season this roster is for</span><input value={season} onChange={(e) => setSeason(Number(e.target.value.replace(/\D/g, "")) || defaultSeason)} onBlur={() => file && read(file)} style={{ ...control, width: "100%" }} /></label>
          <label><span style={label}>Eligibility clock for a new freshman</span>
            <select value={clock} onChange={(e) => { setClock(Number(e.target.value)); file && read(file, season, Number(e.target.value)); }} style={{ ...control, width: "100%" }}>
              <option value={5}>5 years</option><option value={4}>4 years</option>
            </select>
          </label>
        </div>
        <input ref={input} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={(e) => read(e.target.files[0] || null)} />
        <button onClick={() => input.current?.click()} style={{ ...control, width: "100%", cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 8 }}>
          {busy === "read" ? <Loader2 size={15} className="spin" /> : <Upload size={15} />} {file ? file.name : "Choose an Excel or CSV file…"}
        </button>
        {error && <div role="alert" style={{ marginTop: 12, fontSize: 13, color: "var(--danger-text)", lineHeight: 1.5 }}>{error}</div>}
        {done && <div role="status" style={{ marginTop: 12, fontSize: 13, color: "var(--success)" }}>{done}</div>}
        {parsed && (
          <div style={{ marginTop: 14, border: "1px solid var(--border)", borderRadius: 8, padding: 14 }}>
            <div style={{ fontWeight: 800, fontSize: 15 }}>{parsed.players.length} players</div>
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.7, marginTop: 4 }}>
              Roster sheet: <strong>{parsed.found.roster}</strong>
              {parsed.found.incoming && <><br />Incoming: {parsed.found.incoming}</>}
              {parsed.found.status && <><br />Scholarship status: {parsed.found.status}</>}
              {parsed.found.revenue && <><br />Revenue share: {parsed.found.revenue} (visible to admins only)</>}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0" }}>
              {dist.map(([n, c]) => <span key={n} style={{ background: YL_STYLE[n].bg, color: YL_STYLE[n].fg, border: `1px solid ${YL_STYLE[n].border}`, borderRadius: 999, padding: "2px 10px", fontSize: 12, fontWeight: 800 }}>{n} YL · {c}</span>)}
            </div>
            {parsed.problems.length > 0 && (
              <details style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
                <summary style={{ cursor: "pointer" }}>{parsed.problems.length} thing{parsed.problems.length === 1 ? "" : "s"} to check</summary>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{parsed.problems.slice(0, 20).map((p, i) => <li key={i}>{p}</li>)}</ul>
              </details>
            )}
            <div style={{ display: "flex", gap: 16, fontSize: 13, marginTop: 6, flexWrap: "wrap" }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}><input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} /> Replace the {season} roster (players not in the file come off)</label>
              <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}><input type="radio" checked={mode === "merge"} onChange={() => setMode("merge")} /> Add and update only</label>
            </div>
            <div style={{ marginTop: 14 }}><button onClick={run} disabled={busy === "save"} style={primaryBtn}>{busy === "save" ? <Loader2 size={15} className="spin" /> : <Upload size={15} />} {busy === "save" ? "Saving…" : "Load this roster"}</button></div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------- goals

function GoalsModal({ label, goals, onSave, onClose }) {
  const all = Object.values(GROUPS).flat();
  const [g, setG] = useState(() => Object.fromEntries([...all, "_scholarships"].map((k) => [k, goals[k] ?? ""])));
  return (
    <Modal onClose={onClose} width={520}>
      <div style={{ padding: 22 }}>
        <h2 className="oswald" style={{ margin: "0 0 4px", fontSize: 20 }}>{label} goals</h2>
        <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--text-muted)" }}>How many players you want at each position. The snapshot shows how far over or under you are.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {all.map((k) => (
            <label key={k} style={{ fontSize: 12, color: "var(--text-muted)" }}>{k}<input value={g[k]} inputMode="numeric" onChange={(e) => setG((s) => ({ ...s, [k]: e.target.value.replace(/\D/g, "") }))} style={{ ...control, width: "100%", marginTop: 4 }} /></label>
          ))}
        </div>
        <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginTop: 14 }}>Scholarship limit<input value={g._scholarships} inputMode="numeric" onChange={(e) => setG((s) => ({ ...s, _scholarships: e.target.value.replace(/\D/g, "") }))} style={{ ...control, width: 140, marginTop: 4, display: "block" }} /></label>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
          <button onClick={() => onSave(Object.fromEntries(Object.entries(g).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v)])))} style={primaryBtn}>Save goals</button>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------- page

export default function RosterPage({ onBack, session }) {
  const [theme, setTheme] = useTheme();
  const admin = !!session?.profile?.admin;
  const real = useRoster({ isAdmin: admin });
  const roster = real;
  const [initial] = useState(initialSubRoute);
  const [season, setSeason] = useState(null);
  const [view, setView] = useState(initial[1] === "sheet" ? "sheet" : "board");
  const [unit, setUnit] = useState("all");
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState(false);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [showFinance, setShowFinance] = useState(false);
  const [modal, setModal] = useState(null); // {type, player?}
  const [statsNames, setStatsNames] = useState(new Set());

  const base = roster.base;
  const seasonList = useMemo(() => [...new Set([base, ...Object.keys(roster.seasons).map(Number)])].sort((a, b) => a - b), [base, roster.seasons]);
  const current = season ?? (Number(initial[0]) && seasonList.includes(Number(initial[0])) ? Number(initial[0]) : base);
  const isProjection = current > base;
  const label = isProjection ? `${current} Projection` : String(current);
  useEffect(() => {
    setSubRoute("roster", [current, view]);
  }, [current, view]);

  // Which players have Central Michigan stat lines in the Pre-Portal Tracker (loads on demand).
  useEffect(() => {
    let live = true;
    loadRealStats()
      .then(() => {
        if (!live) return;
        const names = new Set();
        REAL_STATS.forEach((r) => (r.division === "FBS" && /^central mich/i.test(r.team) ? names.add(norm(r.player)) : null));
        setStatsNames(names);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const inSeason = useMemo(() => playersInSeason(roster.players, current, base), [roster.players, current, base]);
  const rows = useMemo(
    () =>
      inSeason.map((p) => {
        const yl = yearsLeftIn(p, current, base);
        return { ...p, _yl: Math.max(1, yl), _class: classLabelFor(Math.max(1, yl), roster.eligibilityYears), _end: p.eligEnd ?? current + Math.max(1, yl) - 1, _private: roster.privateInfo[p.id], _revenue: roster.finance[p.id]?.[current] };
      }),
    [inSeason, current, base, roster.eligibilityYears, roster.privateInfo, roster.finance]
  );
  const byId = useMemo(() => new Map(rows.map((p) => [p.id, p])), [rows]);
  const depth = useMemo(() => depthFor(current, roster.seasons, roster.players, base), [current, roster.seasons, roster.players, base]);
  const slotOf = (id) => {
    const hit = Object.entries(depth).find(([, list]) => list.includes(id));
    return hit ? hit[0] : "";
  };
  const shown = rows.filter((p) => {
    const u = UNIT_OF_GROUP[groupOfPosition(p.position)];
    if (unit !== "all" && u !== unit) return false;
    const q = search.trim().toLowerCase();
    return !q || [p.name, p.position, p.hometown, p.highSchool, p.jersey].some((v) => String(v || "").toLowerCase().includes(q));
  });
  const goals = roster.seasons[current]?.goals || {};
  const snap = useMemo(() => snapshotFor(rows, current, base, goals), [rows, current, base, goals]);
  const financeTotal = rows.reduce((a, p) => a + (Number(p._revenue) || 0), 0);
  const statsHas = (p) => statsNames.has(norm(p.name));
  const updated = roster.meta?.updatedAt ? new Date(roster.meta.updatedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

  async function move(id, toSlot, index) {
    const next = Object.fromEntries(Object.entries(depth).map(([k, list]) => [k, list.filter((x) => x !== id)]));
    next[toSlot].splice(Math.min(index, next[toSlot].length), 0, id);
    await roster.saveDepth(current, next);
  }
  async function addYear() {
    const next = Math.max(...seasonList) + 1;
    await roster.addSeason(next);
    setSeason(next);
  }
  async function dropYear() {
    const ok = await confirmAction({ title: `Delete the ${label}?`, message: "This removes its depth chart and goals. Players stay on the roster.", confirmLabel: "Delete" });
    if (!ok) return;
    await roster.deleteSeason(current);
    setSeason(base);
  }

  const units = unit === "all" ? ["offense", "defense", "specialists"] : [unit];
  return (
    <div className="app-shell hs-shell" data-theme={theme} style={{ display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg-page)", color: "var(--text-primary)", fontFamily: "'Century Gothic', 'Jost', 'Helvetica Neue', Arial, sans-serif" }}>
      <div className="app-header hs-no-print" style={{ flexShrink: 0, position: "relative", padding: "20px var(--gutter) 16px" }}>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 3, background: "linear-gradient(90deg, var(--gold), var(--maroon))" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 7, background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 5, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}><ArrowLeft size={15} /> Dashboard</button>
            <img src={cmuHelmet} alt="Central Michigan Chippewas helmet" style={{ height: 34, width: "auto", flexShrink: 0 }} />
            <h1 className="oswald app-title" style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Roster Management</h1>
          </div>
          <ThemeSwitcher theme={theme} onChange={setTheme} />
        </div>
      </div>

      <div className="hs-scroll" style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "16px var(--gutter) 40px", paddingRight: snapshotOpen ? "calc(var(--gutter) + 430px)" : undefined }}>
        <div className="hs-no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
          <select id="roster-season" value={current} onChange={(e) => setSeason(Number(e.target.value))} style={{ ...control, cursor: "pointer", fontWeight: 700 }} aria-label="Season">
            {seasonList.map((s) => <option key={s} value={s}>{s > base ? `${s} Projection` : s}</option>)}
          </select>
          {admin && seasonList.length < 7 && <button onClick={addYear} title="Add the next year's projection" aria-label="Add next year" style={{ ...ghostBtn, padding: "8px 10px" }}><Plus size={14} /></button>}
          {admin && isProjection && <button onClick={dropYear} title="Delete this projection year" aria-label="Delete this projection year" style={{ ...ghostBtn, padding: "8px 10px" }}><X size={14} /></button>}
          <div style={{ display: "flex", gap: 4, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 3 }}>
            {[["board", "Depth chart"], ["sheet", "Spreadsheet"]].map(([k, l]) => (
              <button key={k} onClick={() => setView(k)} style={{ border: "none", borderRadius: 6, padding: "7px 14px", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", background: view === k ? "var(--accent)" : "transparent", color: view === k ? "var(--bg-page)" : "var(--text-muted)" }}>{l}</button>
            ))}
          </div>
          <select id="roster-unit" value={unit} onChange={(e) => setUnit(e.target.value)} style={{ ...control, cursor: "pointer" }} aria-label="Unit">
            <option value="all">Full roster</option><option value="offense">Offense</option><option value="defense">Defense</option><option value="specialists">Specialists</option>
          </select>
          <div style={{ position: "relative", flex: "1 1 180px", minWidth: 160, maxWidth: 300 }}>
            <Search size={14} color="var(--text-faint)" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
            <input id="roster-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, position, hometown…" style={{ ...control, width: "100%", paddingLeft: 30 }} />
          </div>
          <span style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {updated && <span style={{ ...control, color: "var(--text-faint)", fontSize: 12 }}>Last updated: {updated}</span>}
            <button onClick={() => setSnapshotOpen((v) => !v)} style={ghostBtn}>{snapshotOpen ? "Hide snapshot" : "Show snapshot"}</button>
            <button onClick={() => downloadSheet(shown, admin, label)} style={ghostBtn}><Download size={14} /> Download</button>
            {admin && <button onClick={() => setModal({ type: "goals" })} style={ghostBtn}>Edit snapshot</button>}
            {admin && <button onClick={() => setModal({ type: "add" })} style={primaryBtn}><Plus size={14} /> Add player</button>}
            {admin && <button onClick={() => setModal({ type: "upload" })} style={ghostBtn}><Upload size={14} /> Upload roster</button>}
            {admin && view === "board" && <button onClick={() => setEdit((v) => !v)} style={{ ...ghostBtn, ...(edit ? { borderColor: "var(--accent)", color: "var(--accent)" } : {}) }}><Pencil size={14} /> {edit ? "Done editing" : "Edit roster"}</button>}
          </span>
        </div>

        {!roster.ready ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Loading…</div>
        ) : roster.players.length === 0 ? (
          <div style={{ padding: "60px 20px", textAlign: "center", color: "var(--text-muted)", lineHeight: 1.6 }}>
            <div className="oswald" style={{ fontSize: 22, color: "var(--text-primary)", marginBottom: 8 }}>No roster yet</div>
            {admin ? "Upload your scholarship workbook (or any roster list) to get started." : "An admin needs to upload the roster first."}
            {admin && <div style={{ marginTop: 16 }}><button onClick={() => setModal({ type: "upload" })} style={primaryBtn}><Upload size={16} /> Upload roster</button></div>}
          </div>
        ) : view === "board" ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
              <YlKey />
              <span style={{ fontSize: 12.5, color: "var(--text-faint)" }}>{shown.length} of {rows.length} players{isProjection ? " · players leave when their eligibility runs out" : ""}{edit ? " · drag a player to move him" : ""}</span>
            </div>
            {units.map((u) => (
              <Board key={u} unit={u} depth={depth} byId={byId} yl={(p) => p._yl} edit={edit && admin} filter={search.trim().toLowerCase()} onOpen={(p) => setModal({ type: "player", player: p })} onMove={move} />
            ))}
          </>
        ) : (
          <Spreadsheet rows={shown} admin={admin} statsHas={statsHas} onOpen={(p) => setModal({ type: "player", player: p })} />
        )}
      </div>

      {snapshotOpen && (
        <SnapshotPanel snap={snap} season={current} label={label} goals={goals} admin={admin} showFinance={showFinance} setShowFinance={setShowFinance} financeTotal={financeTotal} scholarshipLimit={goals._scholarships} onClose={() => setSnapshotOpen(false)} />
      )}
      {modal?.type === "player" && (
        <PlayerModal key={modal.player.id + current} player={byId.get(modal.player.id) || modal.player} season={current} label={label} admin={admin} roster={roster} depthSlot={slotOf(modal.player.id)} statsLinked={statsHas(modal.player)} onClose={() => setModal(null)} />
      )}
      {modal?.type === "add" && <AddPlayerModal season={current} base={base} eligibilityYears={roster.eligibilityYears} onAdd={roster.addPlayer} onClose={() => setModal(null)} />}
      {modal?.type === "upload" && <UploadModal roster={roster} defaultSeason={base} onClose={() => setModal(null)} />}
      {modal?.type === "goals" && <GoalsModal label={label} goals={goals} onSave={async (g) => { await roster.saveGoals(current, g); setModal(null); }} onClose={() => setModal(null)} />}
    </div>
  );
}
