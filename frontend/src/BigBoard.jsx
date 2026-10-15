import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Camera, ChevronDown, ChevronUp, ExternalLink, Image as ImageIcon, Plus, Printer, Trash2, Upload, X } from "lucide-react";
import { BackButton, HomeButton } from "./HomeButton.jsx";
import { ThemeSwitcher, useTheme } from "./theme.jsx";
import { confirmAction } from "./ConfirmDialog.jsx";
import { initialSubRoute, setSubRoute, useBack } from "./route.js";
import { matchPhotoFiles, mondayOf, photoFromFile, toIso } from "./hsData.js";
import {
  FLAGS, STATUSES, STATUS_BY_KEY, VISITS, blankPlayer, boardTitle, buildCreditList, classYearFromTitle,
  commitCounts, creditKey, diffBoards, handChange, nameKey, parseBoardSheet, parseCreditSheet, readWorkbook, useBigBoards,
} from "./bigBoardData.js";

const VIEWS = [
  { key: "off", label: "Offense" },
  { key: "def", label: "Defense / Specialists" },
  { key: "credit", label: "Credit Evaluation" },
  { key: "activity", label: "Activity" },
];
const SIDE_TITLE = { off: "HIGH SCHOOL OFFENSIVE BIG BOARD", def: "HIGH SCHOOL DEFENSIVE/SPEC BIG BOARD" };

const ctl = {
  background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 6,
  padding: "7px 9px", fontSize: 13, fontFamily: "inherit", minWidth: 0,
};
const ghostBtn = { ...ctl, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 600 };
const primaryBtn = { ...ghostBtn, background: "var(--accent-bg)", border: "1px solid var(--accent)", color: "var(--accent)", fontWeight: 700 };


// ------------------------------------------------------------------ board edits (pure)

const withColumn = (board, colKey, fn) => ({ ...board, columns: board.columns.map((c) => (c.key === colKey ? fn(c) : c)) });

// Saves a card into a column and tier. A card keeps its place when only its details changed; if it was moved
// (another column or tier) it lands at the end of its new tier.
function upsertPlayer(board, colKey, player) {
  let stays = false;
  const cleared = {
    ...board,
    columns: board.columns.map((c) => {
      const hit = c.players.find((p) => p.id === player.id);
      if (!hit) return c;
      if (c.key === colKey && hit.tier === player.tier) {
        stays = true;
        return { ...c, players: c.players.map((p) => (p.id === player.id ? player : p)) };
      }
      return { ...c, players: c.players.filter((p) => p.id !== player.id) };
    }),
  };
  if (stays) return cleared;
  return withColumn(cleared, colKey, (c) => {
    const lastSame = c.players.map((p) => p.tier).lastIndexOf(player.tier);
    const at = lastSame >= 0 ? lastSame + 1 : c.players.findLastIndex((p) => p.tier < player.tier) + 1;
    return { ...c, players: [...c.players.slice(0, at), player, ...c.players.slice(at)] };
  });
}

const removePlayer = (board, id) => ({ ...board, columns: board.columns.map((c) => ({ ...c, players: c.players.filter((p) => p.id !== id) })) });

// Swap a card with the neighbour above or below it in the same tier.
function nudge(board, id, dir) {
  return {
    ...board,
    columns: board.columns.map((c) => {
      const me = c.players.find((p) => p.id === id);
      if (!me) return c;
      const sameTier = c.players.filter((p) => p.tier === me.tier);
      const i = sameTier.findIndex((p) => p.id === id);
      const other = sameTier[i + dir];
      if (!other) return c;
      return { ...c, players: c.players.map((p) => (p.id === id ? other : p.id === other.id ? me : p)) };
    }),
  };
}

// ------------------------------------------------------------------ the sheet

const markersFor = (p) => [p.flags?.snap ? "($)" : "", p.flags?.punt ? "(#)" : "", p.flags?.noMidYear ? "🚫" : "", p.flags?.injured ? "⛑️" : ""].filter(Boolean).join(" ");

// A card shows no rating (neither ARMs' "2 - ALL MAC PLAYER" nor the A/P/C/R trend marks), and the JUCO board
// shows no area coach either. The data stays on the card; it's just not displayed.
function PlayerCard({ p, showCoach, photo, onOpen }) {
  const status = STATUS_BY_KEY[p.status] || STATUS_BY_KEY.recruit;
  const marks = markersFor(p);
  return (
    <div className="bb-card" style={{ background: status.color }} onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpen()} title="Click to edit">
      {photo && <img className="bb-photo" src={photo} alt="" />}
      <div className="bb-card-text">
        <div className="bb-name">{p.name || "New player"}{marks && <span style={{ fontWeight: 500 }}> {marks}</span>}</div>
        {(p.school || p.state) && <div>{p.school}{p.state ? ` (${p.state})` : ""}</div>}
        {p.measurables && <div>{p.measurables}</div>}
        {(p.gpa || p.visits) && <div>{p.gpa ? `${p.gpaLabel || "cGPA"}: ${p.gpa}` : ""} {p.visits}</div>}
        {showCoach && p.coach && <div className="bb-extra">{p.coach}</div>}
      </div>
    </div>
  );
}

export function BoardSheet({ board, side, classYear, photos, onOpen, onAdd }) {
  const counts = commitCounts(board);
  const maxTier = Math.max(3, ...board.columns.flatMap((c) => c.players.map((p) => p.tier)));
  const tiers = Array.from({ length: maxTier }, (_, i) => i + 1);
  const title = board.title && /\d{4}/.test(board.title) ? board.title : `${SIDE_TITLE[side]} - ${classYear}`;
  return (
    <div className="bb-sheet bb-board">
      <div className="bb-title">{title}</div>
      <div className="bb-cols" style={{ gridTemplateColumns: `repeat(${board.columns.length}, minmax(0, 1fr))` }}>
        {board.columns.map((col) => {
          const committed = col.players.filter((p) => p.status === "committed").length;
          return (
            <div key={col.key} className="bb-col">
              <div className="bb-colhead">
                <span>{col.label}</span>
                <span style={{ color: "#B3261E" }}>({committed})</span>
              </div>
              {tiers.map((tier) => {
                const inTier = col.players.filter((p) => p.tier === tier);
                return (
                  <Fragment key={tier}>
                    <div className="bb-tier">
                      <span>TIER {tier}</span>
                      <button className="bb-add hs-no-print" onClick={() => onAdd(col.key, tier)} title={`Add a player to ${col.label} tier ${tier}`} aria-label={`Add a player to ${col.label} tier ${tier}`}>
                        <Plus size={11} />
                      </button>
                    </div>
                    {inTier.map((p) => (
                      <PlayerCard key={p.id} p={p} showCoach={classYear !== "JUCO"} photo={photos[nameKey(p.name)]} onOpen={() => onOpen(col.key, p)} />
                    ))}
                  </Fragment>
                );
              })}
            </div>
          );
        })}
      </div>
      <BoardFooter counts={counts} side={side} />
    </div>
  );
}

function BoardFooter({ counts, side }) {
  return (
    <div className="bb-footer">
      <div className="bb-key">
        <div className="bb-footh">KEY</div>
        {STATUSES.map((s) => (
          <div key={s.key} style={{ background: s.color }}>{s.label.toUpperCase()}</div>
        ))}
      </div>
      <div className="bb-emojis">
        <div className="bb-footh">EMOJIS</div>
        <div className="bb-emoji-grid">
          {FLAGS.map((f) => (
            <div key={f.key}><span>{f.marker === "$" ? "($)" : f.marker === "#" ? "(#)" : f.marker}</span> {f.label}</div>
          ))}
          {VISITS.map((v) => (
            <div key={v.marker}><span>{v.marker}</span> {v.label}</div>
          ))}
        </div>
      </div>
      <div className="bb-counts">
        <div className="bb-footh">TOTAL {side === "def" ? "DEFENSIVE" : "OFFENSIVE"} COMMITS</div>
        {counts.rows.map((r) => (
          <div key={r.label} style={{ display: "flex", justifyContent: "space-between" }}><span>{r.label}</span><b>{r.count}</b></div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #111", marginTop: 3, paddingTop: 3, fontWeight: 800 }}>
          <span>TOTAL</span><span style={{ fontSize: 16 }}>{counts.total}</span>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ editing a card

export function PlayerModal({ board, classYear, colKey, player, isNew, photo, onSave, onDelete, onNudge, onPhoto, onClose }) {
  const [draft, setDraft] = useState(player);
  const [col, setCol] = useState(colKey);
  const fileInput = useRef(null);
  const [photoError, setPhotoError] = useState("");
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const label = { fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4, display: "block" };
  const addVisit = (marker) => set({ visits: `${draft.visits || ""}${marker}` });

  async function choosePhoto(file) {
    setPhotoError("");
    try {
      await onPhoto(draft.name, await photoFromFile(file));
    } catch (err) {
      setPhotoError(err.message || "Couldn't use that photo.");
    }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 80 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 10, width: 560, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h2 className="oswald" style={{ margin: 0, fontSize: 19 }}>{isNew ? "Add a player" : draft.name || "Edit player"}</h2>
            {!isNew && draft.name.trim() && (
              <a
                href={`#/hs/face-sheet/${toIso(mondayOf(new Date()))}/${encodeURIComponent(draft.name.trim())}`}
                title="Open this player's face sheet in Game Update"
                style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 700, color: "var(--accent)", textDecoration: "none", border: "1px solid var(--accent)", borderRadius: 6, padding: "4px 9px" }}
              >
                <ExternalLink size={13} /> Game Update sheet
              </a>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", lineHeight: 0 }}><X size={18} /></button>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ width: 54, height: 54, borderRadius: "50%", background: "var(--bg-surface)", border: "1px solid var(--border)", overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {photo ? <img src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Camera size={18} color="var(--text-faint)" />}
            </div>
            <input ref={fileInput} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => e.target.files[0] && choosePhoto(e.target.files[0])} />
            <button onClick={() => fileInput.current?.click()} disabled={!draft.name.trim()} title={draft.name.trim() ? "" : "Enter a name first"} style={{ ...ghostBtn, opacity: draft.name.trim() ? 1 : 0.5 }}>{photo ? "Replace photo" : "Add photo"}</button>
            {photo && <button onClick={() => onPhoto(draft.name, "")} style={ghostBtn}>Remove</button>}
            {photoError && <span role="alert" style={{ fontSize: 12, color: "var(--danger-text)" }}>{photoError}</span>}
          </div>

          <div>
            <label style={label} htmlFor="bb-name">Name</label>
            <input id="bb-name" value={draft.name} onChange={(e) => set({ name: e.target.value })} style={{ ...ctl, width: "100%" }} autoFocus={isNew} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 80px", gap: 10 }}>
            <div>
              <label style={label} htmlFor="bb-school">High school</label>
              <input id="bb-school" value={draft.school} onChange={(e) => set({ school: e.target.value })} style={{ ...ctl, width: "100%" }} />
            </div>
            <div>
              <label style={label} htmlFor="bb-state">State</label>
              <input id="bb-state" value={draft.state} onChange={(e) => set({ state: e.target.value.toUpperCase().slice(0, 2) })} style={{ ...ctl, width: "100%" }} />
            </div>
          </div>
          <div>
            <label style={label} htmlFor="bb-meas">Measurables (as shown on the card)</label>
            <input id="bb-meas" value={draft.measurables} onChange={(e) => set({ measurables: e.target.value })} placeholder={`6'2" ✅ 187 ✅ 6'3" ✅`} style={{ ...ctl, width: "100%" }} />
          </div>
          {classYear !== "JUCO" && (
            <div>
              <label style={label} htmlFor="bb-coach">Assigned coach</label>
              <input id="bb-coach" value={draft.coach || ""} onChange={(e) => set({ coach: e.target.value })} style={{ ...ctl, width: "100%" }} />
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "110px 100px 1fr", gap: 10, alignItems: "end" }}>
            <div>
              <label style={label} htmlFor="bb-gl">GPA</label>
              <select id="bb-gl" value={draft.gpaLabel} onChange={(e) => set({ gpaLabel: e.target.value })} style={{ ...ctl, width: "100%" }}>
                <option value="cGPA">cGPA (core)</option>
                <option value="GPA">GPA</option>
              </select>
            </div>
            <input aria-label="GPA value" value={draft.gpa} onChange={(e) => set({ gpa: e.target.value })} style={ctl} />
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input aria-label="Visits" value={draft.visits} onChange={(e) => set({ visits: e.target.value })} placeholder="Visits" style={{ ...ctl, flex: 1 }} />
              {VISITS.map((v) => (
                <button key={v.marker} onClick={() => addVisit(v.marker)} title={`Add: ${v.label}`} style={{ ...ghostBtn, padding: "6px 8px" }}>{v.marker}</button>
              ))}
              <button onClick={() => set({ visits: "" })} title="Clear visits" style={{ ...ghostBtn, padding: "6px 8px" }}><X size={13} /></button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={label} htmlFor="bb-status">Status (card colour)</label>
              <select id="bb-status" value={draft.status} onChange={(e) => set({ status: e.target.value })} style={{ ...ctl, width: "100%", background: STATUS_BY_KEY[draft.status]?.color, color: "#111", fontWeight: 700 }}>
                {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>Marks after the name</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
                {FLAGS.map((f) => (
                  <label key={f.key} title={f.label} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, cursor: "pointer" }}>
                    <input type="checkbox" checked={!!draft.flags?.[f.key]} onChange={(e) => set({ flags: { ...draft.flags, [f.key]: e.target.checked } })} />
                    {f.marker === "$" ? "($)" : f.marker === "#" ? "(#)" : f.marker}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 10 }}>
            <div>
              <label style={label} htmlFor="bb-col">Position column</label>
              <select id="bb-col" value={col} onChange={(e) => setCol(e.target.value)} style={{ ...ctl, width: "100%" }}>
                {board.columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label style={label} htmlFor="bb-tier">Tier</label>
              <select id="bb-tier" value={draft.tier} onChange={(e) => set({ tier: Number(e.target.value) })} style={{ ...ctl, width: "100%" }}>
                {[1, 2, 3, 4].map((t) => <option key={t} value={t}>Tier {t}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18, gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 6 }}>
            {!isNew && (
              <>
                <button onClick={() => onNudge(draft.id, -1)} title="Move up within this tier" aria-label="Move up" style={{ ...ghostBtn, padding: "7px 9px" }}><ChevronUp size={15} /></button>
                <button onClick={() => onNudge(draft.id, 1)} title="Move down within this tier" aria-label="Move down" style={{ ...ghostBtn, padding: "7px 9px" }}><ChevronDown size={15} /></button>
                <button onClick={() => onDelete(draft)} style={{ ...ghostBtn, color: "var(--danger-text)", borderColor: "var(--danger-text)" }}><Trash2 size={14} /> Remove</button>
              </>
            )}
          </div>
          <button onClick={() => onSave(col, draft)} disabled={!draft.name.trim()} style={{ ...primaryBtn, padding: "8px 18px", opacity: draft.name.trim() ? 1 : 0.5 }}>{isNew ? "Add player" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ credit evaluation

const QUALIFIERS = ["Early Qualifier", "Submitted Transcript", "Compliance Confirmed", "Not Qualified"];
const CREDIT_COLS = [
  { key: "first", label: "First name", w: 92 },
  { key: "last", label: "Last name", w: 100 },
  { key: "pos", label: "Pos", w: 52 },
  { key: "school", label: "High school", w: 150 },
  { key: "state", label: "State", w: 52 },
  { key: "coach", label: "Area coach", w: 110 },
  { key: "transcript", label: "Updated transcript", w: 86 },
  { key: "qualifier", label: "NCAA qualifier", w: 160, select: true },
  { key: "gpa", label: "Core GPA", w: 70 },
  { key: "credits", label: "Credits /16", w: 70 },
];

// The credit table lists itself from the board: everyone committed (gold) or offered (green), name, position,
// school and coach filled in. Only what the board can't know is typed here -- and saved with the person.
const EDITABLE_CREDIT = new Set(["coach", "transcript", "qualifier", "gpa", "credits"]);

export function CreditSheet({ list, onEdit, classYear }) {
  const groups = [
    { key: "committed", title: "Committed", color: STATUS_BY_KEY.committed.color, rows: list.committed },
    { key: "offered", title: "Offered", color: STATUS_BY_KEY.offered.color, rows: list.offered },
  ];
  const total = list.committed.length + list.offered.length;
  // The JUCO board has no area coach, so its credit table has no coach column either.
  const cols = classYear === "JUCO" ? CREDIT_COLS.filter((c) => c.key !== "coach") : CREDIT_COLS;
  const cell = { padding: 0, border: "1px solid rgba(0,0,0,0.12)" };
  const input = { width: "100%", border: "none", background: "transparent", color: "#111", fontFamily: "inherit", fontSize: 12.5, padding: "5px 6px", textAlign: "center" };
  return (
    <div className="bb-sheet bb-credit">
      <div className="bb-title">HS BOARD CREDIT EVALUATION{classYear ? ` - ${classYear}` : ""}</div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} style={{ background: "#BFBFBF", color: "#111", fontSize: 11, padding: "5px 6px", border: "1px solid rgba(0,0,0,0.12)", minWidth: c.w }}>{c.label.toUpperCase()}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {total === 0 && (
            <tr><td colSpan={cols.length} style={{ padding: 24, textAlign: "center", fontSize: 13, color: "#555" }}>No one is committed or offered on this class's boards yet. This list fills itself in from the board.</td></tr>
          )}
          {groups.map((g) => (
            <Fragment key={g.key}>
              {g.key === "offered" && g.rows.length > 0 && list.committed.length > 0 && (
                <tr><td colSpan={cols.length} style={{ background: "#111", height: 8, padding: 0 }} /></tr>
              )}
              {g.rows.map((r) => (
                <tr key={r.key} style={{ background: g.color }}>
                  {cols.map((c) => (
                    <td key={c.key} style={cell}>
                      {c.select ? (
                        <select value={r.qualifier} onChange={(e) => onEdit(r, { qualifier: e.target.value })} style={{ ...input, appearance: "none", cursor: "pointer" }}>
                          {r.qualifier && !QUALIFIERS.includes(r.qualifier) && <option value={r.qualifier}>{r.qualifier}</option>}
                          <option value="" />
                          {QUALIFIERS.map((q) => <option key={q} value={q}>{q}</option>)}
                        </select>
                      ) : EDITABLE_CREDIT.has(c.key) ? (
                        <input
                          key={r[c.key]}
                          defaultValue={r[c.key]}
                          aria-label={`${c.label} for ${r.first} ${r.last}`}
                          onBlur={(e) => e.target.value.trim() !== r[c.key] && onEdit(r, { [c.key]: c.key === "coach" ? e.target.value.trim().toUpperCase() : e.target.value.trim() })}
                          style={input}
                        />
                      ) : (
                        <div style={{ ...input, padding: "5px 6px" }}>{r[c.key]}</div>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
      <div className="hs-no-print" style={{ padding: "8px 12px", fontSize: 12, color: "#555", background: "#f4f4f4", borderTop: "1px solid #ddd" }}>
        Built from the board: committed (gold) and offered (green) only. Name, position, school and state come from the card; the coach, transcript date, NCAA qualifier, GPA and credits are typed here and kept with the person.
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ activity

const shortDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1].slice(2)}` : "";
};

// Who has been added to and taken off the board, newest first, with the date -- written by every upload (the
// new board compared with the one it replaces) and by cards added or removed by hand.
export function ActivitySheet({ rows, classYear }) {
  const [filter, setFilter] = useState("all");
  const shown = rows.filter((r) => filter === "all" || r.type === filter);
  const added = rows.filter((r) => r.type === "added").length;
  const removed = rows.length - added;
  const groups = [];
  shown.forEach((r) => {
    const last = groups[groups.length - 1];
    if (last && last.date === r.date) last.rows.push(r);
    else groups.push({ date: r.date, rows: [r] });
  });
  const th = { background: "#BFBFBF", color: "#111", fontSize: 11, padding: "5px 8px", border: "1px solid rgba(0,0,0,0.12)", textAlign: "left" };
  const td = { padding: "5px 8px", fontSize: 12.5, border: "1px solid rgba(0,0,0,0.12)", color: "#111" };
  const chip = (key, label, n) => (
    <button key={key} onClick={() => setFilter(key)} style={{ ...ghostBtn, padding: "5px 12px", fontSize: 12.5, background: filter === key ? "var(--accent-bg)" : "var(--bg-surface)", borderColor: filter === key ? "var(--accent)" : "var(--border)", color: filter === key ? "var(--accent)" : "var(--text-secondary)" }}>{label} ({n})</button>
  );
  return (
    <div>
      <div className="hs-no-print" style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {chip("all", "All", rows.length)}
        {chip("added", "Added", added)}
        {chip("removed", "Removed", removed)}
      </div>
      <div className="bb-sheet bb-credit" style={{ minWidth: 0 }}>
        <div className="bb-title">BIG BOARD ACTIVITY - {classYear}</div>
        {groups.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "#555" }}>
            {rows.length === 0 ? "Nothing yet. Each time you upload a board, the people added to it and taken off it are listed here with the date. The first upload for a class has nothing to compare against." : "Nothing to show for this filter."}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>{["Date", "Change", "Player", "Position", "High school", "Status", "From"].map((h) => <th key={h} style={th}>{h.toUpperCase()}</th>)}</tr>
            </thead>
            <tbody>
              {groups.map((g) =>
                g.rows.map((r, i) => (
                  <tr key={r.id} style={{ background: r.type === "added" ? "#B6D7A8" : "#EA9999" }}>
                    <td style={{ ...td, fontWeight: 700, whiteSpace: "nowrap" }}>{i === 0 ? shortDate(g.date) : ""}</td>
                    <td style={{ ...td, fontWeight: 800 }}>{r.type === "added" ? "Added" : "Removed"}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{r.name}</td>
                    <td style={td}>{r.positions}{r.side ? <span style={{ color: "#555" }}> · {r.side === "def" ? "Defense" : "Offense"}</span> : null}</td>
                    <td style={td}>{r.school}{r.state ? ` (${r.state})` : ""}</td>
                    <td style={td}>{STATUS_BY_KEY[r.status]?.label || ""}</td>
                    <td style={{ ...td, color: "#555" }} title={r.source}>{/\.xls/i.test(r.source || "") ? "Upload" : "By hand"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ upload

export function UploadModal({ classYears, defaultYear, onClose, onImport }) {
  const [wb, setWb] = useState(null);
  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState({ off: "", def: "", credit: "" });
  const [year, setYear] = useState(defaultYear);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState(null);

  async function choose(file) {
    setError("");
    setSummary(null);
    try {
      const w = await readWorkbook(file);
      const names = w.SheetNames;
      const find = (re) => names.find((n) => re.test(n.trim())) || "";
      const picked = { off: find(/^off(ense)?$/i), def: find(/^def(ense)?$/i), credit: find(/credit/i) };
      setWb(w);
      setFileName(file.name);
      setSheets(picked);
      const fromTitle = classYearFromTitle(boardTitle(w.Sheets[picked.off] || w.Sheets[picked.def]));
      if (fromTitle) setYear(fromTitle);
    } catch {
      setWb(null);
      setError("That file couldn't be read. Use the .xlsx workbook.");
    }
  }

  async function run() {
    setBusy(true);
    setError("");
    try {
      const result = { off: null, def: null, credit: null };
      if (sheets.off) result.off = parseBoardSheet(wb.Sheets[sheets.off]);
      if (sheets.def) result.def = parseBoardSheet(wb.Sheets[sheets.def]);
      if (sheets.credit) result.credit = parseCreditSheet(wb.Sheets[sheets.credit]);
      if (!result.off && !result.def && !result.credit) throw new Error("Pick at least one sheet to import.");
      const changes = await onImport(year.trim(), result, fileName);
      const count = (b) => (b ? b.columns.reduce((n, c) => n + c.players.length, 0) : 0);
      setSummary({ off: count(result.off), def: count(result.def), credit: result.credit ? result.credit.rows.length : 0, changes });
    } catch (err) {
      setError(err.message || "Something went wrong reading that workbook.");
    } finally {
      setBusy(false);
    }
  }

  const sheetSelect = (key, label) => (
    <div>
      <label style={{ fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: 4 }}>{label}</label>
      <select value={sheets[key]} onChange={(e) => setSheets({ ...sheets, [key]: e.target.value })} style={{ ...ctl, width: "100%" }}>
        <option value="">Skip</option>
        {wb.SheetNames.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </div>
  );

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 80 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 10, width: 480, maxWidth: "100%", padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 className="oswald" style={{ margin: 0, fontSize: 19 }}>Upload a big board</h2>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", lineHeight: 0 }}><X size={18} /></button>
        </div>
        {summary ? (
          <div>
            <p style={{ fontSize: 13.5, lineHeight: 1.6 }}>
              Loaded into <b>{year}</b>: {summary.off ? `${summary.off} offensive cards` : ""}{summary.off && summary.def ? ", " : ""}{summary.def ? `${summary.def} defensive cards` : ""}
              {summary.credit ? `${summary.off || summary.def ? ", " : ""}${summary.credit} credit evaluations` : ""}.
            </p>
            <p style={{ fontSize: 13.5, lineHeight: 1.6, margin: "0 0 12px" }}>
              {summary.changes?.compared
                ? `Compared with the board it replaced: ${summary.changes.added} added, ${summary.changes.removed} removed (see the Activity tab).`
                : "This is the first board for that class, so there's nothing to compare it with yet."}
            </p>
            <div style={{ textAlign: "right" }}><button onClick={onClose} style={primaryBtn}>Done</button></div>
          </div>
        ) : (
          <>
            <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--text-faint)", lineHeight: 1.55 }}>
              Choose the staff's big board workbook (.xlsx). It reads each board sheet's position columns, tiers, card colours and ratings, and the credit evaluation sheet. Uploading again replaces that class's boards you pick (photos are kept).
            </p>
            <input type="file" accept=".xlsx,.xlsm" onChange={(e) => e.target.files[0] && choose(e.target.files[0])} style={{ fontSize: 13, marginBottom: 14, width: "100%" }} />
            {wb && (
              <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
                <div>
                  <label style={{ fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: 4 }}>Class</label>
                  <input list="bb-class-years" value={year} onChange={(e) => setYear(e.target.value)} placeholder="2027 or JUCO" style={{ ...ctl, width: "100%" }} />
                  <datalist id="bb-class-years">{classYears.map((y) => <option key={y} value={y} />)}</datalist>
                </div>
                {sheetSelect("off", "Offense sheet")}
                {sheetSelect("def", "Defense / specialists sheet")}
                {sheetSelect("credit", "Credit evaluation sheet")}
              </div>
            )}
            {error && <div role="alert" style={{ color: "var(--danger-text)", fontSize: 13, marginBottom: 10 }}>{error}</div>}
            <div style={{ textAlign: "right" }}>
              <button onClick={run} disabled={!wb || !year.trim() || busy} style={{ ...primaryBtn, opacity: wb && year.trim() && !busy ? 1 : 0.5 }}>{busy ? "Importing…" : "Import"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ photos from the ARMs PDF

// Choosing the ARMs board PDF is the whole job: the board, its tiers and colours, every card's details and the
// photos are read from it (see bigBoardPdf.js) and the board for the class is replaced -- with what was added
// and taken off logged on the Activity tab. Nothing to confirm along the way.
export function UploadPdfModal({ defaultYear, onImport, onClose }) {
  const [phase, setPhase] = useState("pick"); // pick | reading | done
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [year, setYear] = useState(defaultYear);

  // The class comes from the file name ("1. 2027 BIG BOARD.pdf", "JUCO BIG BOARD.pdf") when it says one.
  const yearFor = (file) => (/juco/i.test(file.name) ? "JUCO" : (/\b(20\d{2})\b/.exec(file.name) || [])[1] || year);

  async function run(file) {
    setError("");
    setPhase("reading");
    setProgress(null);
    try {
      const chosenYear = yearFor(file);
      setYear(chosenYear);
      setResult({ year: chosenYear, ...(await onImport(chosenYear, file, setProgress)) });
      setPhase("done");
    } catch (err) {
      setError(/fetch|network|import|load/i.test(String(err?.message)) ? "The reader couldn't load (it needs internet the first time). Check your connection and try again." : err?.message || "That PDF couldn't be read. Use the PDF exported from the board.");
      setPhase("pick");
    }
  }

  return (
    <div onClick={phase === "reading" ? undefined : onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 80 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 10, width: 520, maxWidth: "100%", padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 className="oswald" style={{ margin: 0, fontSize: 19 }}>Upload the board PDF</h2>
          {phase !== "reading" && <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", lineHeight: 0 }}><X size={18} /></button>}
        </div>

        {phase === "pick" && (
          <>
            <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--text-faint)", lineHeight: 1.55 }}>
              Choose the board PDF exported from ARMs. The class comes from the file name (a file with no year goes to the tab you're on, currently <b>{year}</b>). The board is rebuilt from it, photos included, and the people added and removed since the last upload are logged on the Activity tab. Your own additions to a card (GPA, ratings, visits) are kept.
            </p>
            <input type="file" accept="application/pdf,.pdf" onChange={(e) => e.target.files[0] && run(e.target.files[0])} style={{ fontSize: 13, width: "100%" }} />
            {error && <div role="alert" style={{ color: "var(--danger-text)", fontSize: 13, marginTop: 10 }}>{error}</div>}
          </>
        )}

        {phase === "reading" && (
          <p style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.6 }}>
            {progress?.stage === "save"
              ? "Saving the board and photos…"
              : progress?.page
                ? `Reading page ${progress.page} of ${progress.pages}… ${progress.cards} cards so far.`
                : "Getting the reader ready (the first time can take a few seconds)…"}
          </p>
        )}

        {phase === "done" && result && (
          <div style={{ fontSize: 13.5, lineHeight: 1.65 }}>
            <p style={{ margin: "0 0 8px" }}>
              Loaded <b>{result.cards}</b> cards into the <b>{result.year}</b> board ({result.off} offense, {result.def} defense/specialists) with <b>{result.photos}</b> photos.
            </p>
            <p style={{ margin: "0 0 12px", color: "var(--text-secondary)" }}>
              {result.compared
                ? `Compared with the board it replaced: ${result.added} added, ${result.removed} removed (see the Activity tab).`
                : "This is the first board for that class, so there's nothing to compare it with yet."}
            </p>
            <div style={{ textAlign: "right" }}><button onClick={onClose} style={primaryBtn}>Done</button></div>
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ page

export default function BigBoard({ onBack: toDashboard }) {
  const [theme, setTheme] = useTheme();
  const back = useBack(toDashboard);
  const [initial] = useState(initialSubRoute);
  const [classYear, setClassYear] = useState(initial[0] || "2027");
  const [view, setView] = useState(VIEWS.some((v) => v.key === initial[1]) ? initial[1] : "off");
  const bb = useBigBoards(classYear);
  const [editing, setEditing] = useState(null); // { colKey, player, isNew }
  const [uploading, setUploading] = useState(false);
  const [pdfUpload, setPdfUpload] = useState(false);
  const [note, setNote] = useState("");
  const photoInput = useRef(null);

  // Printing: a board plus its key and counts is shrunk to fit one landscape letter page. The size the page will
  // have is measured just before printing (at the width the paper allows), so the key always prints with the
  // prospects instead of spilling onto a second sheet.
  useEffect(() => {
    const PAGE_W = 990; // 10.4in of printable width, in CSS pixels, with a little to spare
    const PAGE_H = 735; // 7.9in of printable height
    const fit = () => {
      document.querySelectorAll(".bb-board").forEach((el) => {
        el.style.zoom = "";
        // The biggest scale at which the whole sheet fits the page: at scale z the sheet is laid out PAGE_W / z
        // wide (a smaller scale gives it more room, so less wrapping) and prints z times its height.
        const printedHeight = (z) => {
          el.style.width = `${PAGE_W / z}px`;
          return el.scrollHeight * z;
        };
        let lo = 0.3;
        let hi = 1;
        if (printedHeight(hi) <= PAGE_H) lo = hi;
        else for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) / 2;
          if (printedHeight(mid) <= PAGE_H) lo = mid;
          else hi = mid;
        }
        el.style.width = `${PAGE_W / lo}px`;
        el.style.zoom = String(lo);
      });
    };
    const reset = () => {
      document.querySelectorAll(".bb-board").forEach((el) => {
        el.style.zoom = "";
        el.style.width = "";
      });
    };
    window.addEventListener("beforeprint", fit);
    window.addEventListener("afterprint", reset);
    return () => {
      window.removeEventListener("beforeprint", fit);
      window.removeEventListener("afterprint", reset);
    };
  }, []);

  const board = view === "credit" || view === "activity" ? null : bb.board(classYear, view);
  const credit = bb.credit(classYear);

  function go(nextYear, nextView) {
    setClassYear(nextYear);
    setView(nextView);
    setSubRoute("bigboard", [nextYear, nextView]);
  }

  async function persist(next) {
    await bb.saveBoard(classYear, view, next);
  }

  // The credit list builds itself from the committed and offered players on the boards; what's typed into it is
  // saved per person (by name), so it survives the board being re-uploaded every week.
  const offBoard = bb.board(classYear, "off");
  const defBoard = bb.board(classYear, "def");
  const creditList = useMemo(() => buildCreditList([offBoard, defBoard], credit?.rows || []), [offBoard, defBoard, credit]);

  async function editCredit(row, patch) {
    const saved = credit?.rows || [];
    const at = saved.findIndex((r) => (r.key || creditKey(r.first, r.last)) === row.key);
    const base = at >= 0 ? saved[at] : { first: row.first, last: row.last };
    const merged = { ...base, key: row.key, ...patch };
    await bb.saveCredit(classYear, at >= 0 ? saved.map((r, i) => (i === at ? merged : r)) : [...saved, merged]);
  }

  async function savePlayer(colKey, draft) {
    const player = { ...draft, name: draft.name.trim() };
    const next = upsertPlayer(board, colKey, player);
    await persist(next);
    if (editing?.isNew) {
      const label = board.columns.find((c) => c.key === colKey)?.label || colKey;
      const change = handChange("added", view, player, label);
      if (change) await bb.logActivity(classYear, [change], "by hand");
    }
    setEditing(null);
  }

  async function deletePlayer(p) {
    const ok = await confirmAction({ title: `Remove ${p.name || "this player"}?`, message: "This takes the card off this board (their photo is kept). It's logged on the Activity tab." });
    if (!ok) return;
    const label = board.columns.filter((c) => c.players.some((x) => x.id === p.id)).map((c) => c.label).join(", ");
    const change = handChange("removed", view, p, label);
    await persist(removePlayer(board, p.id));
    if (change) await bb.logActivity(classYear, [change], "by hand");
    setEditing(null);
  }

  // Loads the sheets and logs what changed against the board each one replaces: people new to it and people
  // gone from it (one side at a time, so uploading only offense never reads as defense being emptied).
  async function importWorkbook(year, parsed, fileName) {
    const entries = [];
    let compared = false;
    for (const side of ["off", "def"]) {
      if (!parsed[side]) continue;
      const previous = bb.board(year, side);
      if (previous) {
        compared = true;
        entries.push(...diffBoards(previous, parsed[side], side));
      }
      await bb.saveBoard(year, side, { ...parsed[side], sourceFile: fileName });
    }
    if (parsed.credit) await bb.saveCredit(year, parsed.credit.rows);
    await bb.logActivity(year, entries, fileName);
    go(year, parsed.off ? "off" : parsed.def ? "def" : "credit");
    return { compared, added: entries.filter((e) => e.type === "added").length, removed: entries.filter((e) => e.type === "removed").length };
  }

  // The whole board from the ARMs PDF. Each side replaces the class's board for it, but anything added to a card
  // here that the PDF doesn't carry (GPA, ratings, visits, marks) stays with that person.
  async function importBoardPdf(year, file, onProgress) {
    const { readBoardPdf, boardsFromCards } = await import("./bigBoardPdf.js");
    const known = [];
    ["off", "def"].forEach((side) => (bb.board(year, side)?.columns || []).forEach((c) => c.players.forEach((p) => known.push(p.name))));
    const read = await readBoardPdf(file, known, onProgress);
    if (!read.cards.length) throw new Error("No player cards were found in that PDF. Use the board PDF exported from ARMs.");
    onProgress({ stage: "save" });
    const built = boardsFromCards(read.cards, year);
    const entries = [];
    let compared = false;
    for (const side of ["off", "def"]) {
      const previous = bb.board(year, side);
      const merged = carryOver(built[side], previous);
      if (previous) {
        compared = true;
        entries.push(...diffBoards(previous, merged, side));
      }
      await bb.saveBoard(year, side, { ...merged, sourceFile: file.name });
    }
    for (const p of read.photos) await bb.savePhoto(year, p.name, p.photo);
    await bb.logActivity(year, entries, file.name);
    go(year, view === "credit" || view === "activity" ? "off" : view);
    const count = (b) => new Set(b.columns.flatMap((c) => c.players.map((p) => nameKey(p.name)))).size;
    return { cards: new Set(read.cards.map((c) => nameKey(c.name))).size, off: count(built.off), def: count(built.def), photos: read.photos.length, compared, added: entries.filter((e) => e.type === "added").length, removed: entries.filter((e) => e.type === "removed").length };
  }

  async function addPhotos(files) {
    setNote("");
    const everyone = [];
    ["off", "def"].forEach((side) => (bb.board(classYear, side)?.columns || []).forEach((c) => c.players.forEach((p) => everyone.push({ name: p.name }))));
    const unique = [...new Map(everyone.map((p) => [nameKey(p.name), p])).values()];
    const { matched, unmatched } = matchPhotoFiles([...files], unique);
    let saved = 0;
    for (const { file, player } of matched) {
      try {
        await bb.savePhoto(classYear, player.name, await photoFromFile(file));
        saved++;
      } catch {
        unmatched.push(file.name);
      }
    }
    setNote(`${saved} photo${saved === 1 ? "" : "s"} added${unmatched.length ? `; no match for ${unmatched.slice(0, 4).join(", ")}${unmatched.length > 4 ? "…" : ""} (name the file after the player)` : ""}.`);
  }

  return (
    <div className="app-shell hs-shell bb-shell" data-theme={theme} style={{ display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg-page)", color: "var(--text-primary)", fontFamily: "'Century Gothic', 'Jost', 'Helvetica Neue', Arial, sans-serif" }}>
      <div className="app-header hs-no-print" style={{ flexShrink: 0, position: "relative", padding: "20px var(--gutter) 16px" }}>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 3, background: "linear-gradient(90deg, var(--gold), var(--maroon))" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {back.fromTrail && <BackButton label={back.label} onClick={back.go} />}
            <HomeButton onHome={toDashboard} />
            <h1 className="oswald app-title" style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Big Board</h1>
          </div>
          <ThemeSwitcher theme={theme} onChange={setTheme} />
        </div>
      </div>

      <div className="hs-scroll" style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "16px var(--gutter) var(--gutter)", display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="hs-no-print" style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 4, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 3 }}>
            {bb.classYears.map((y) => (
              <button key={y} onClick={() => go(y, view)} className="tabular" style={{ border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", background: y === classYear ? "var(--accent)" : "transparent", color: y === classYear ? "var(--bg-page)" : "var(--text-muted)" }}>{y}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input ref={photoInput} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }} />
            <button onClick={() => setPdfUpload(true)} style={primaryBtn} title="Upload the board PDF exported from ARMs -- the whole board, photos included, is built from it"><Upload size={14} /> Upload board PDF</button>
            {view !== "credit" && view !== "activity" && <button onClick={() => photoInput.current?.click()} style={ghostBtn} title="Add or replace photos by hand (name each file after the player, e.g. Sam Rouleau.jpg)"><ImageIcon size={14} /> Add photos</button>}
            <button onClick={() => setUploading(true)} style={ghostBtn} title="Upload the staff workbook -- for the credit evaluation sheet"><Upload size={14} /> Upload workbook</button>
            <button onClick={() => window.print()} style={ghostBtn}><Printer size={14} /> Print / PDF</button>
          </div>
        </div>

        <div className="hs-no-print" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {VIEWS.map((v) => (
            <button key={v.key} onClick={() => go(classYear, v.key)} style={{ display: "flex", alignItems: "center", borderRadius: 999, padding: "7px 14px", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", background: v.key === view ? "var(--accent-bg)" : "var(--bg-surface)", border: `1px solid ${v.key === view ? "var(--accent)" : "var(--border)"}`, color: v.key === view ? "var(--accent)" : "var(--text-secondary)" }}>{v.label}</button>
          ))}
          {note && <span style={{ alignSelf: "center", fontSize: 12.5, color: "var(--text-muted)" }}>{note}</span>}
        </div>

        {!bb.ready ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Loading…</div>
        ) : view === "credit" ? (
          <CreditSheet list={creditList} classYear={classYear} onEdit={editCredit} />
        ) : view === "activity" ? (
          <ActivitySheet rows={bb.activity} classYear={classYear} />
        ) : board ? (
          <BoardSheet
            board={board}
            side={view}
            classYear={classYear}
            photos={bb.photos}
            onOpen={(colKey, player) => setEditing({ colKey, player, isNew: false })}
            onAdd={(colKey, tier) => setEditing({ colKey, player: blankPlayer(tier), isNew: true })}
          />
        ) : (
          <Empty what={view === "off" ? "offensive board" : "defensive board"} year={classYear} onUpload={() => setPdfUpload(true)} uploadLabel="Upload board PDF" />
        )}
      </div>

      {editing && board && (
        <PlayerModal
          key={editing.player.id}
          board={board}
          classYear={classYear}
          colKey={editing.colKey}
          player={editing.player}
          isNew={editing.isNew}
          photo={bb.photos[nameKey(editing.player.name)]}
          onSave={savePlayer}
          onDelete={deletePlayer}
          onNudge={(id, dir) => persist(nudge(board, id, dir))}
          onPhoto={(name, data) => (data ? bb.savePhoto(classYear, name, data) : bb.removePhoto(classYear, name))}
          onClose={() => setEditing(null)}
        />
      )}
      {pdfUpload && <UploadPdfModal defaultYear={classYear} onImport={importBoardPdf} onClose={() => setPdfUpload(false)} />}
      {uploading && <UploadModal classYears={bb.classYears} defaultYear={classYear} onClose={() => setUploading(false)} onImport={importWorkbook} />}
    </div>
  );
}

// What a card has that the PDF doesn't carry: the GPA, the A/P/C/R trend ratings, the visit icons and the marks
// after a name. A fresh read of the PDF replaces the board, so those are carried over by person.
function carryOver(next, previous) {
  const before = new Map();
  (previous?.columns || []).forEach((c) => c.players.forEach((p) => before.has(nameKey(p.name)) || before.set(nameKey(p.name), p)));
  return {
    ...next,
    columns: next.columns.map((c) => ({
      ...c,
      players: c.players.map((p) => {
        const old = before.get(nameKey(p.name));
        return old ? { ...p, gpa: old.gpa ?? p.gpa, gpaLabel: old.gpaLabel ?? p.gpaLabel, visits: old.visits ?? p.visits, flags: old.flags ?? p.flags, rating: old.rating ?? p.rating } : p;
      }),
    })),
  };
}

function Empty({ what, year, onUpload, onStart, uploadLabel = "Upload workbook" }) {
  return (
    <div style={{ border: "1px dashed var(--border)", borderRadius: 10, padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
      <p style={{ margin: "0 0 14px", fontSize: 14 }}>No {what} for {year} yet.</p>
      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        <button onClick={onUpload} style={primaryBtn}><Upload size={14} /> {uploadLabel}</button>
        {onStart && <button onClick={onStart} style={ghostBtn}>Start blank</button>}
      </div>
    </div>
  );
}
