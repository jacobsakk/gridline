import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { initialSubRoute, setSubRoute } from "./route.js";
import NameFixModal from "./NameFixModal.jsx";
import { ArrowLeft, Upload, X, Loader2, ChevronUp, ChevronDown, ChevronsUpDown, TrendingUp, MapPin, Search, Plus, ExternalLink, Pencil } from "lucide-react";
import { confirmAction } from "./ConfirmDialog.jsx";
import { collegeForLabel, logoFor, teamKey } from "./collegeData.js";
import { canonicalSchool, fixBrandCase } from "./schoolNames.js";
import { ThemeSwitcher, useTheme } from "./theme.jsx";
import cmuHelmet from "./assets/cmu-helmet.png";
import { CONFERENCE_ORDER, TEAM_CONFERENCE, normalizePosition, useOfferTracker } from "./offerData.js";

const CONFERENCE_LABEL = { MAC: "MAC", MVC: "MVC / MVFC", IVY: "Ivy League" };

const FIELDS = [
  { key: "player", label: "Player", width: 160, titleCase: true },
  { key: "highSchool", label: "High School", width: 160, titleCase: true },
  { key: "state", label: "State", width: 70, upper: true },
  { key: "position", label: "Pos", width: 64, upper: true },
  { key: "dateOffered", label: "Date Offered", width: 110 },
  { key: "status", label: "Status", width: 220, titleCase: true },
  { key: "pipelineStatus", label: "Pipeline", width: 160 },
  { key: "notes", label: "Notes", width: 180, titleCase: true },
];

// CSS text-transform:capitalize only uppercases the first letter of
// each word -- it can't lowercase the rest, so it does nothing on data
// that's already ALL CAPS (which is how the source spreadsheet was
// entered). Actually reformatting the string is the only way to get a
// normal-looking "Aaron Pegues" instead of "AARON PEGUES", matching
// how names read in the Pre-Portal Tracker.
// Initials stay capitalized ("BJ Adams", not "Bj Adams"): two letters with no vowel (BJ, CJ, TJ, DJ)
// or AJ/EJ/OJ. Jr, Sr and the like are left as ordinary words.
const NOT_INITIALS = new Set(["jr", "sr", "mr", "ms", "dr", "st", "mt"]);
const isInitials = (word) => !NOT_INITIALS.has(word.toLowerCase()) && (/^[bcdfghjklmnpqrstvwxz]{2}$/i.test(word) || /^(aj|ej|oj)$/i.test(word));

export function toTitleCase(text) {
  return fixBrandCase(
    (text || "")
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .replace(/\b[A-Za-z]{2}\b/g, (w) => (isInitials(w) ? w.toUpperCase() : w))
  );
}

const PIPELINE_OPTIONS = ["Reject", "Recruit", "0 - Partial", "1 - Solid Starter", "2 - All Mac Player"];

const filterSelectStyle = {
  background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)",
  borderRadius: 5, padding: "7px 10px", fontSize: 13, fontFamily: "inherit", cursor: "pointer",
};

export function statusStyle(status) {
  const s = (status || "").toUpperCase();
  if (s.includes("CENTRAL MICHIGAN")) {
    return { background: "var(--accent-bg)", color: "var(--accent)", border: "1px solid var(--accent)" };
  }
  if (s.startsWith("COMMIT")) {
    return { background: "var(--danger-bg)", color: "var(--danger-text)", border: "1px solid var(--danger)" };
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

function hexToRgb(hex) {
  const h = (hex || "#000000").replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16) || 0, g: parseInt(h.slice(2, 4), 16) || 0, b: parseInt(h.slice(4, 6), 16) || 0 };
}
function rgbLuminance({ r, g, b }) {
  return (r * 299 + g * 587 + b * 114) / 1000;
}
function rgbToHex({ r, g, b }) {
  const c = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

// Some school colors (navy and royal blue especially) are close to
// invisible as text on the site's near-black surfaces. Blends toward
// white only as far as needed to clear a readable brightness, so a dark
// navy becomes a lighter navy-blue instead of jumping to some unrelated
// color.
function lightenForDark(hex, minLum = 135) {
  const rgb = hexToRgb(hex);
  const lum = rgbLuminance(rgb);
  if (lum >= minLum) return hex;
  const t = Math.min(1, (minLum - lum) / (255 - lum || 1));
  return rgbToHex({ r: rgb.r + (255 - rgb.r) * t, g: rgb.g + (255 - rgb.g) * t, b: rgb.b + (255 - rgb.b) * t });
}

// The team color to use as *text* (Position column, Trends labels):
// whichever of the school's two colors is brighter -- e.g. Kent State's
// gold over its navy -- lightened further if it's still too dark
// (Buffalo's blue, whose other color is black). Backgrounds and borders
// keep the real primary color; only text needs to be readable.
// On the light theme the problem flips: pale school colors (gold, tan,
// light blue) wash out on white, so the team's own primary is used and
// darkened only if it's too light to read.
export const ThemeContext = createContext("dark");

function darkenForLight(hex, maxLum = 140) {
  const rgb = hexToRgb(hex);
  const lum = rgbLuminance(rgb);
  if (lum <= maxLum) return hex;
  const t = (lum - maxLum) / (lum || 1);
  return rgbToHex({ r: rgb.r * (1 - t), g: rgb.g * (1 - t), b: rgb.b * (1 - t) });
}

function textAccentFor(meta, theme = "dark") {
  if (!meta || !meta.color) return null;
  if (theme === "light") return darkenForLight(meta.color);
  const primary = rgbLuminance(hexToRgb(meta.color));
  const secondary = rgbLuminance(hexToRgb(meta.colorSecondary));
  return lightenForDark(secondary > primary ? meta.colorSecondary : meta.color);
}

function EditableCell({ value, onCommit, width, upper, titleCase, normalize, style, autoFocus, onDone }) {
  const display = (v) => (titleCase ? toTitleCase(v) : v || "");
  const [text, setText] = useState(display(value));
  const [dirty, setDirty] = useState(false);

  if (!dirty && display(value) !== text) setText(display(value));

  function commit() {
    // Only a real edit (an actual keystroke set `dirty`) should write
    // anything -- otherwise a display-only reformat like title-casing
    // would look like a change on every blur and fire a write (and,
    // for a synced field, a cross-team write) with nothing to say.
    if (onDone) onDone();
    if (!dirty) return;
    setDirty(false);
    let next = text.trim();
    if (upper) next = next.toUpperCase();
    if (normalize) next = normalize(next);
    if (next !== (value || "")) onCommit(next);
  }

  return (
    <input
      autoFocus={autoFocus}
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

// A click opens the recruit's cross-team profile (same as clicking a
// name in the Pre-Portal Tracker); double-click swaps in a text box to
// fix a typo, and it drops back to the link when you click away.
function PlayerNameCell({ player, width, onOpenProfile, onCommit }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <EditableCell
        value={player}
        titleCase
        width={width}
        autoFocus
        onCommit={onCommit}
        onDone={() => setEditing(false)}
      />
    );
  }
  return (
    <span
      className="player-name"
      onClick={onOpenProfile}
      onDoubleClick={() => setEditing(true)}
      title="Click to view this recruit across every team -- double-click to edit the name"
      style={{ display: "inline-block", width, padding: "5px 7px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
    >
      {toTitleCase(player)}
    </span>
  );
}

function PipelineSelect({ value, onCommit, width }) {
  const raw = (value || "").trim();
  // Imported data is all caps ("1 - SOLID STARTER") and a <select> only
  // matches an option's exact text, so point it at the canonical option.
  const canonical = PIPELINE_OPTIONS.find((o) => o.toLowerCase() === raw.toLowerCase());
  const current = canonical || raw;
  const isKnown = !raw || !!canonical;

  return (
    <select
      value={current}
      onChange={(e) => onCommit(e.target.value)}
      className="offer-cell-input"
      style={{ width, cursor: "pointer" }}
    >
      <option value="">—</option>
      {!isKnown && <option value={current}>{current}</option>}
      {PIPELINE_OPTIONS.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}

function UploadModal({ classYears, onClose, onImport }) {
  const [classYear, setClassYear] = useState(classYears[classYears.length - 1] || new Date().getFullYear().toString());
  const [file, setFile] = useState(null);
  const [state, setState] = useState("idle"); // idle | working | done | error
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  const isFeed = !!file && /\.csv$/i.test(file.name);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file || (!isFeed && !classYear.trim())) return;
    setState("working");
    setError(null);
    try {
      const result = await onImport(file, classYear.trim(), isFeed);
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
            {summary.years ? (
              <>
                <p style={{ fontSize: 14, color: "var(--success)", marginTop: 0 }}>
                  Added {summary.created} new offer row{summary.created === 1 ? "" : "s"} and updated {summary.updated} existing
                  {summary.commitmentsApplied ? `, and applied ${summary.commitmentsApplied} commitment change${summary.commitmentsApplied === 1 ? "" : "s"} across sheets` : ""}
                  {" "}(class{summary.years.length === 1 ? "" : "es"} of {summary.years.join(" and ")}).
                </p>
                {summary.skippedColleges.length > 0 && (
                  <p style={{ fontSize: 12.5, color: "var(--text-faint)" }}>
                    Skipped schools not tracked here: {summary.skippedColleges.join(", ")}
                  </p>
                )}
              </>
            ) : (
              <>
                <p style={{ fontSize: 14, color: "var(--success)", marginTop: 0 }}>
                  Imported {summary.teamsImported} team{summary.teamsImported === 1 ? "" : "s"}, {summary.rowsImported} offer rows.
                </p>
                {summary.skippedSheets.length > 0 && (
                  <p style={{ fontSize: 12.5, color: "var(--text-faint)" }}>
                    Skipped sheets not recognized as a team: {summary.skippedSheets.join(", ")}
                  </p>
                )}
              </>
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
            <label style={{ display: "block", fontSize: 11, color: "var(--text-faint)", marginBottom: 5 }}>File (.xlsx workbook or .csv activity feed)</label>
            <input
              type="file"
              accept=".xlsx,.csv"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              style={{ width: "100%", fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}
            />
            {!isFeed && (
              <>
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
              </>
            )}
            <p style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 0 }}>
              {isFeed
                ? "Activity feed: every class year in the file is handled together (it has a Grad Year column). Nothing is replaced -- new offers are added, blanks are filled in, and commitments update that recruit on every sheet. Pipeline and notes are left alone."
                : "Workbook: each recognized team tab replaces that team's rows for this class year, so a player dropped from the export won't linger. Assignments, Questionnaire and breakdown tabs are skipped."}
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

// The whole point of tracking competing schools' boards is seeing who
// else is after the same recruit -- this shows every team (any
// conference, not just the one currently open) with a row for this
// player in this class year.
// One team's offer turned out to be wrong. Confirms first, since it
// hides the row everywhere (and keeps it out of future uploads).
function RemoveOfferButton({ row, onRemove }) {
  const label = TEAM_CONFERENCE[row.team]?.label || row.team;
  return (
    <button
      onClick={async () => {
        const ok = await confirmAction({
          title: `Remove ${toTitleCase(row.player)}?`,
          message: `This takes them off ${label}'s board. Use it when the offer is inaccurate -- it won't come back on future uploads.`,
        });
        if (ok) onRemove(row);
      }}
      title={`Remove this offer from ${label}'s board (inaccurate)`}
      style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", padding: 4, lineHeight: 0 }}
    >
      <X size={15} />
    </button>
  );
}

function AddOfferForm({ teamLabel, onAdd, onClose }) {
  const [f, setF] = useState({ player: "", highSchool: "", state: "", position: "", dateOffered: "", notes: "" });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF((prev) => ({ ...prev, [k]: e.target.value }));
  const inputStyle = {
    background: "var(--bg-page)", border: "1px solid var(--border)", color: "var(--text-primary)",
    borderRadius: 5, padding: "6px 8px", fontSize: 13, fontFamily: "inherit",
  };

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onAdd(f);
      onClose();
    } catch (err) {
      setError(err.message || "Couldn't add that offer.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ flexShrink: 0, marginBottom: 12, padding: 12, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <input autoFocus placeholder="Player name *" value={f.player} onChange={set("player")} style={{ ...inputStyle, width: 170 }} />
        <input placeholder="High school" value={f.highSchool} onChange={set("highSchool")} style={{ ...inputStyle, width: 170 }} />
        <input placeholder="State" value={f.state} onChange={set("state")} maxLength={2} style={{ ...inputStyle, width: 60 }} />
        <input placeholder="Pos" value={f.position} onChange={set("position")} style={{ ...inputStyle, width: 60 }} />
        <input placeholder="Date offered" value={f.dateOffered} onChange={set("dateOffered")} style={{ ...inputStyle, width: 120 }} />
        <input placeholder="Notes" value={f.notes} onChange={set("notes")} style={{ ...inputStyle, flex: "1 1 140px" }} />
        <button
          type="submit"
          disabled={!f.player.trim() || saving}
          style={{
            background: "var(--accent-bg)", border: "1px solid var(--accent)", color: "var(--accent)", borderRadius: 5,
            padding: "7px 14px", fontSize: 13, fontWeight: 700, cursor: f.player.trim() ? "pointer" : "not-allowed", opacity: f.player.trim() ? 1 : 0.5,
          }}
        >
          Add to {teamLabel}
        </button>
        <button type="button" onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 13 }}>
          Cancel
        </button>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 8 }}>
        If this recruit is already on another team's board, their school, state and position are filled in for you.
      </div>
      {error && <div style={{ fontSize: 12.5, color: "var(--danger)", marginTop: 6 }}>{error}</div>}
    </form>
  );
}

// "COMMITTED TO CENTRAL MICHIGAN" on the Central Michigan board -- the
// school is compared by normalized name, so "BGSU"/"Bowling Green" and
// "Sac State"/"Sacramento State" still line up.
function isCommittedTo(status, teamLabel) {
  const m = /^COMMITTED TO (.+)$/i.exec((status || "").trim());
  return !!m && teamKey(m[1]) === teamKey(teamLabel);
}

// A web search for a recruit: name plus high school, state, position and
// class narrow it to the right kid (a name alone matches half the country).
function recruitSearchUrl(player, highSchool, state, position, classYear) {
  // "SAINT XAVIER HS (OH)" -> "SAINT XAVIER HS": the state is already in the query.
  const school = (highSchool || "").replace(/\s*\([^)]*\)\s*$/, "");
  const q = [toTitleCase(player), school, state, position, classYear ? `class of ${classYear}` : "", "football recruit"].filter(Boolean).join(" ");
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

export function PlayerProfileModal({ player, classYear, tracker, onClose }) {
  const theme = useContext(ThemeContext);
  const rows = useMemo(() => tracker.rowsForPlayer(classYear, player), [tracker, classYear, player]);
  const first = rows[0];
  if (!first) return null;

  const tdStyle = { padding: "9px 12px", fontSize: 13.5, color: "var(--text-secondary)", borderRight: "1px solid var(--border-faint)" };
  const sectionLabel = { fontSize: 11, color: "var(--text-faint)", letterSpacing: "0.03em", textTransform: "uppercase", marginBottom: 8 };

  // Status and pipeline are the same recruit-wide (they sync across
  // teams), so they're shown once. Notes are per team, so identical
  // ones collapse to one line and differing ones list which team wrote them.
  const status = (rows.find((r) => /^COMMI?TT?ED TO /i.test((r.status || "").trim())) || rows.find((r) => (r.status || "").trim()) || {}).status || "";
  const pipeline = ((rows.find((r) => (r.pipelineStatus || "").trim()) || {}).pipelineStatus || "").trim();
  const noteGroups = new Map();
  rows.forEach((r) => {
    const text = (r.notes || "").trim();
    if (!text) return;
    const k = text.toLowerCase();
    if (!noteGroups.has(k)) noteGroups.set(k, { text, teams: [] });
    noteGroups.get(k).teams.push(TEAM_CONFERENCE[r.team]?.label || r.team);
  });
  const notes = [...noteGroups.values()].map((n) => ({ text: n.text, teams: noteGroups.size > 1 && rows.length > 1 ? n.teams.join(", ") : "" }));
  const otherOffers = (rows.find((r) => r.otherOffers?.length) || {}).otherOffers || [];

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
          width: 720, maxWidth: "100%", maxHeight: "85vh", overflowY: "auto",
        }}
      >
        <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <h2 className="oswald" style={{ fontSize: 20, margin: 0, fontWeight: 700 }}>{toTitleCase(first.player)}</h2>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
              {toTitleCase(first.highSchool) || "—"} · {first.state || "—"} · <span style={{ color: "var(--accent)", fontWeight: 700 }}>{first.position}</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
            <a
              href={recruitSearchUrl(first.player, first.highSchool, first.state, first.position, classYear)}
              target="_blank"
              rel="noopener noreferrer"
              title="Search this recruit"
              style={{
                display: "flex", alignItems: "center", gap: 7, background: "var(--accent-bg)", border: "1px solid var(--accent)", color: "var(--accent)",
                borderRadius: 5, padding: "9px 15px", fontSize: 14, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap",
              }}
            >
              <ExternalLink size={16} /> Search
            </a>
            <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 4, lineHeight: 0 }}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 20 }}>
          <div>
            <div style={sectionLabel}>
              Offers from tracked teams ({rows.length})
            </div>
            <div style={{ border: "1px solid var(--border)", borderRadius: 6, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--bg-surface)" }}>
                    {["Team", "Date Offered", ""].map((h, i) => (
                      <th key={i} style={{ textAlign: "left", padding: "9px 12px", fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const meta = TEAM_CONFERENCE[r.team];
                    return (
                      <tr key={r.id} style={{ borderTop: "1px solid var(--border-subtle)" }}>
                        <td style={{ ...tdStyle, fontWeight: 700, color: meta ? textAccentFor(meta, theme) : "var(--text-primary)" }}>{meta?.label || r.team}</td>
                        <td style={tdStyle} className="tabular">{r.dateOffered || "—"}</td>
                        <td style={{ ...tdStyle, borderRight: "none", textAlign: "center", width: 40 }}>
                          <RemoveOfferButton row={r} onRemove={(row) => tracker.removeOffer(row)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
            <div>
              <div style={sectionLabel}>Status</div>
              {status ? (
                <span style={{ ...statusStyle(status), borderRadius: 4, padding: "3px 9px", fontSize: 12, fontWeight: 600, display: "inline-block" }}>
                  {toTitleCase(status)}
                </span>
              ) : (
                <span style={{ color: "var(--text-faint)" }}>—</span>
              )}
            </div>
            <div>
              <div style={sectionLabel}>Pipeline</div>
              <span style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>
                {PIPELINE_OPTIONS.find((o) => o.toLowerCase() === pipeline.toLowerCase()) || pipeline || "—"}
              </span>
            </div>
          </div>

          <div>
            <div style={sectionLabel}>Notes</div>
            {notes.length === 0 ? (
              <span style={{ color: "var(--text-faint)" }}>—</span>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13.5, color: "var(--text-secondary)" }}>
                {notes.map((n) => (
                  <div key={n.text}>
                    {toTitleCase(n.text)}
                    {n.teams && <span style={{ color: "var(--text-faint)" }}> ({n.teams})</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div style={sectionLabel}>
              Other offers{otherOffers.length ? ` (${otherOffers.length})` : ""}
              <span style={{ textTransform: "none", letterSpacing: 0 }}> — schools outside the conferences we track</span>
            </div>
            {otherOffers.length === 0 ? (
              <span style={{ color: "var(--text-faint)" }}>Not in any activity feed uploaded so far. This list comes from the feed's All Offer Schools column.</span>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {otherOffers.map((school) => (
                  <span
                    key={school}
                    style={{
                      fontSize: 12, padding: "3px 9px", borderRadius: 999, color: "var(--text-secondary)",
                      background: "var(--bg-surface)", border: "1px solid var(--border)",
                    }}
                  >
                    {school}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const MEDALS = ["🥇", "🥈", "🥉"];

// Ranks one TEAM's own values down every row (their own top 3
// positions, or their own top 3 states) and returns a row-key ->
// medal-index (0/1/2) lookup -- this is per column, not per row: two
// teams can each have their own gold position, and a team's #1
// position has nothing to do with what any other team offers most.
// Ties share a medal rather than one row winning it by row order.
function medalsForColumn(rows, team) {
  const valueByRowKey = new Map(rows.map((r) => [r.key, r.counts[team] || 0]));
  const tierValues = [...new Set([...valueByRowKey.values()].filter((v) => v > 0))]
    .sort((a, b) => b - a)
    .slice(0, 3);
  const medalByValue = new Map(tierValues.map((v, i) => [v, i]));
  return (rowKey) => {
    const v = valueByRowKey.get(rowKey) || 0;
    return v > 0 && medalByValue.has(v) ? medalByValue.get(v) : null;
  };
}

// Shaded (and, for the column's leader, colored) in that TEAM's own
// school color rather than one flat accent wash for every column --
// makes each team's column scannable at a glance instead of every cell
// blending into the same tint regardless of whose column it's in.
function HeatCell({ value, max, color, medal }) {
  const ratio = max > 0 ? value / max : 0;
  const isTop = value > 0 && value === max;
  const c = color || "var(--accent)";
  return (
    <td
      className="tabular"
      style={{
        textAlign: "right",
        padding: "7px 10px",
        fontSize: 13,
        color: isTop ? contrastOn(color) : "var(--text-secondary)",
        fontWeight: isTop ? 700 : 400,
        background: value > 0 ? `color-mix(in srgb, ${c} ${Math.round(18 + ratio * 65)}%, var(--bg-panel))` : "transparent",
        transition: "background 0.2s ease",
      }}
    >
      {medal != null && <span style={{ marginRight: 4 }}>{MEDALS[medal]}</span>}
      {value || 0}
    </td>
  );
}

function TrendCard({ icon: Icon, label, value, sub, color }) {
  const accent = color || "var(--accent)";
  return (
    <div
      style={{
        display: "flex", flexDirection: "column", gap: 4,
        background: color ? `color-mix(in srgb, ${accent} 16%, var(--bg-panel))` : "var(--accent-bg)",
        border: `1px solid ${accent}`, borderRadius: 8, padding: "14px 18px", minWidth: 170,
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: accent, letterSpacing: "0.03em", textTransform: "uppercase" }}>
        <Icon size={13} /> {label}
      </span>
      <span className="oswald" style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)" }}>{sub}</span>
      <span className="tabular" style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{value}</span>
    </div>
  );
}

// One row per position (or state), sortable by clicking its own label
// column, any team's column, or Total -- same click-to-sort, click-
// again-to-flip pattern as the Teams table.
function SortableBreakdownTable({ title, rowLabel, rows, teams, maxHeight, defaultSortKey = "total", defaultSortDir = "desc" }) {
  const theme = useContext(ThemeContext);
  const [sortKey, setSortKey] = useState(defaultSortKey);
  const [sortDir, setSortDir] = useState(defaultSortDir);

  function handleSort(key) {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir(key === "label" ? "asc" : "desc");
    }
  }

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = sortKey === "label" ? a.label : sortKey === "total" ? a.total : a.counts[sortKey] || 0;
      const bv = sortKey === "label" ? b.label : sortKey === "total" ? b.total : b.counts[sortKey] || 0;
      const cmp = sortKey === "label" ? av.localeCompare(bv) : av - bv;
      return sortDir === "desc" ? -cmp : cmp;
    });
  }, [rows, sortKey, sortDir]);

  const thStyle = {
    textAlign: "right", padding: "7px 10px", fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase",
    whiteSpace: "nowrap", cursor: "pointer", userSelect: "none",
  };
  const rowLabelStyle = { textAlign: "left", padding: "7px 10px", fontSize: 13, fontWeight: 700, color: "var(--text-primary)" };
  const teamKeys = teams.map((t) => t.team);

  // One medal lookup per team, each ranking that team's OWN values
  // across every row -- computed from the full row set, not whatever
  // order sorting currently shows, so a team's top 3 don't shuffle
  // depending on how the table happens to be sorted.
  const medalByTeam = useMemo(() => {
    const m = {};
    teamKeys.forEach((team) => {
      m[team] = medalsForColumn(rows, team);
    });
    return m;
  }, [rows, teamKeys.join("|")]);

  return (
    <div>
      <h3 className="oswald" style={{ fontSize: 17, fontWeight: 700, margin: "0 0 12px", color: "var(--accent)" }}>{title}</h3>
      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 6, maxHeight, overflowY: maxHeight ? "auto" : undefined }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--bg-surface)" }}>
              <th style={{ ...thStyle, textAlign: "left" }} onClick={() => handleSort("label")}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  {rowLabel} <SortIcon active={sortKey === "label"} dir={sortDir} />
                </span>
              </th>
              {teams.map((t) => (
                <th key={t.team} style={{ ...thStyle, color: textAccentFor(t, theme) || undefined, borderBottom: `2px solid ${t.color || "var(--border)"}` }} onClick={() => handleSort(t.team)}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {t.label} <SortIcon active={sortKey === t.team} dir={sortDir} />
                  </span>
                </th>
              ))}
              <th style={thStyle} onClick={() => handleSort("total")}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  Total <SortIcon active={sortKey === "total"} dir={sortDir} />
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => {
              const rowMax = Math.max(...teamKeys.map((t) => row.counts[t] || 0), 1);
              return (
                <tr key={row.key} style={{ borderTop: "1px solid var(--border-subtle)" }}>
                  <td style={rowLabelStyle}>{row.label}</td>
                  {teams.map(({ team, color }) => (
                    <HeatCell key={team} value={row.counts[team] || 0} max={rowMax} color={color} medal={medalByTeam[team](row.key)} />
                  ))}
                  <td style={{ textAlign: "right", padding: "8px 10px", fontSize: 13.5, fontWeight: 700, color: "var(--accent)" }} className="tabular">
                    {row.total}
                  </td>
                </tr>
              );
            })}
            <tr style={{ borderTop: "2px solid var(--border)", background: "var(--bg-surface)" }}>
              <td style={rowLabelStyle}>Totals</td>
              {teams.map((t) => (
                <td key={t.team} style={{ textAlign: "right", padding: "8px 10px", fontSize: 13.5, fontWeight: 700, color: textAccentFor(t, theme) || "var(--accent)" }} className="tabular">
                  {rows.reduce((sum, row) => sum + (row.counts[t.team] || 0), 0)}
                </td>
              ))}
              <td style={{ textAlign: "right", padding: "8px 10px", fontSize: 13.5, fontWeight: 700, color: "var(--accent)" }} className="tabular">
                {rows.reduce((sum, row) => sum + row.total, 0)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BreakdownTables({ classYear, conference, tracker }) {
  const theme = useContext(ThemeContext);
  const posData = useMemo(() => tracker.positionBreakdown(classYear, conference), [classYear, conference, tracker]);
  const areaData = useMemo(() => tracker.areaBreakdown(classYear, conference), [classYear, conference, tracker]);

  const topTeamPos = useMemo(() => {
    let best = { team: null, label: "", color: null, n: -1 };
    posData.teams.forEach((t) => {
      const n = posData.totals[t.team] || 0;
      if (n > best.n) best = { team: t.team, label: t.label, color: textAccentFor(t, theme), n };
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

  const positionRows = useMemo(
    () =>
      posData.positions.map((pos) => ({
        key: pos,
        label: pos,
        counts: posData.counts[pos] || {},
        total: Object.values(posData.counts[pos] || {}).reduce((a, b) => a + b, 0),
      })),
    [posData]
  );
  const areaRows = useMemo(
    () =>
      areaData.states.map((state) => ({
        key: state,
        label: state,
        counts: areaData.counts[state] || {},
        total: areaData.stateTotals[state] || 0,
      })),
    [areaData]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <TrendCard icon={TrendingUp} label="Most Active" value={`${topTeamPos.n} offers`} sub={topTeamPos.label || "—"} color={topTeamPos.color} />
        <TrendCard icon={MapPin} label="Top State" value={`${areaData.stateTotals[topState] || 0} offers`} sub={topState || "—"} />
        <TrendCard icon={TrendingUp} label="Top Position" value={`${topPosition.n} offers`} sub={topPosition.pos || "—"} />
      </div>

      <SortableBreakdownTable
        title="Position Breakdown"
        rowLabel="Position"
        rows={positionRows}
        teams={posData.teams}
        defaultSortKey="label"
        defaultSortDir="asc"
      />

      <SortableBreakdownTable
        title="Offer Area Breakdown"
        rowLabel="State"
        rows={areaRows}
        teams={areaData.teams}
        maxHeight={420}
        defaultSortKey="total"
        defaultSortDir="desc"
      />
    </div>
  );
}

function SortIcon({ active, dir }) {
  if (!active) return <ChevronsUpDown size={12} style={{ opacity: 0.4 }} />;
  return dir === "desc" ? <ChevronDown size={13} /> : <ChevronUp size={13} />;
}

function TeamOffersTable({ rows, onEdit, onOpenProfile, onRemove, sortKey, sortDir, onSort, teamColor, teamTextColor, showTeam, commitTeam }) {
  const theme = useContext(ThemeContext);
  const tdStyle = { padding: "4px 10px", fontSize: 13.5, color: "var(--text-secondary)", borderRight: "1px solid var(--border-faint)" };
  const headerBackground = teamColor ? `color-mix(in srgb, ${teamColor} 22%, var(--bg-surface))` : "var(--bg-surface)";
  // Sticky against the nearest scrolling ancestor -- the caller wraps
  // this table in the one div that actually scrolls, with no overflow
  // (or padding-top -- see Gridline.jsx's own header/table split) on
  // anything between here and there, so this resolves cleanly.
  const thStyle = {
    textAlign: "left", padding: "9px 10px", fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase",
    whiteSpace: "nowrap", cursor: "pointer", userSelect: "none",
    position: "sticky", top: 0, background: headerBackground, zIndex: 1,
  };

  if (rows.length === 0) {
    return <div style={{ fontSize: 13, color: "var(--text-faint)", padding: "20px 0" }}>No offers match.</div>;
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          {showTeam && (
            <th style={thStyle} onClick={() => onSort("teamLabel")}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                Team
                <SortIcon active={sortKey === "teamLabel"} dir={sortDir} />
              </span>
            </th>
          )}
          {FIELDS.map(({ key, label }) => (
            <th key={key} style={thStyle} onClick={() => onSort(key)}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                {label}
                <SortIcon active={sortKey === key} dir={sortDir} />
              </span>
            </th>
          ))}
          <th style={{ ...thStyle, cursor: "default" }} />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} style={{ borderTop: "1px solid var(--border-subtle)", background: "var(--bg-panel)" }}>
            {showTeam && (
              <td style={{ ...tdStyle, fontWeight: 700, whiteSpace: "nowrap", color: textAccentFor(TEAM_CONFERENCE[r.team], theme) || "var(--text-primary)" }}>
                {TEAM_CONFERENCE[r.team]?.label || r.team}
              </td>
            )}
            {FIELDS.map(({ key, width, upper, titleCase }) => {
              if (key === "status") {
                // With the commits switch on, the team's own commits wear its colors.
                const style =
                  commitTeam && isCommittedTo(r.status, commitTeam.label)
                    ? { background: commitTeam.color, color: contrastOn(commitTeam.color), border: `1px solid ${textAccentFor(commitTeam, theme) || commitTeam.color}` }
                    : statusStyle(r.status);
                return (
                  <td key={key} style={tdStyle}>
                    <EditableCell
                      value={r.status}
                      upper={upper}
                      titleCase={titleCase}
                      width={width}
                      onCommit={(v) => onEdit(r, key, v)}
                      style={{ ...style, borderRadius: 4, fontWeight: 600, fontSize: 12 }}
                    />
                  </td>
                );
              }
              if (key === "pipelineStatus") {
                return (
                  <td key={key} style={tdStyle}>
                    <PipelineSelect value={r.pipelineStatus} width={width} onCommit={(v) => onEdit(r, key, v)} />
                  </td>
                );
              }
              if (key === "player") {
                return (
                  <td key={key} style={{ ...tdStyle, fontWeight: 600, color: "var(--text-primary)" }}>
                    <PlayerNameCell
                      player={r.player}
                      width={width}
                      onOpenProfile={() => onOpenProfile(r.player)}
                      onCommit={(v) => onEdit(r, key, v)}
                    />
                  </td>
                );
              }
              return (
                <td
                  key={key}
                  style={{
                    ...tdStyle,
                    ...(key === "position"
                      ? { color: (showTeam && textAccentFor(TEAM_CONFERENCE[r.team], theme)) || teamTextColor || "var(--accent)", fontWeight: 700 }
                      : null),
                  }}
                  className={key === "dateOffered" ? "tabular" : undefined}
                >
                  <EditableCell
                    value={key === "position" ? normalizePosition(r[key]) : r[key]}
                    upper={upper}
                    titleCase={titleCase}
                    normalize={key === "position" ? normalizePosition : null}
                    width={width}
                    onCommit={(v) => onEdit(r, key, v)}
                  />
                </td>
              );
            })}
            <td style={{ ...tdStyle, borderRight: "none", textAlign: "center" }}>
              <RemoveOfferButton row={r} onRemove={onRemove} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const STRING_SORT_KEYS = new Set(["teamLabel", "player", "highSchool", "state", "position", "status", "pipelineStatus", "notes"]);

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
  const [theme, setTheme] = useTheme();
  const [uploadOpen, setUploadOpen] = useState(false);
  // Where you are (#/offers/2027/MAC/teams/CMU) is kept in the address so a refresh returns here.
  const [initial] = useState(initialSubRoute);
  const [classYear, setClassYear] = useState(/^\d{4}$/.test(initial[0] || "") ? initial[0] : null);
  const [conference, setConference] = useState(CONFERENCE_ORDER.includes(initial[1]) ? initial[1] : "MAC");
  const [subView, setSubView] = useState(initial[2] === "trends" ? "trends" : "teams"); // "teams" | "trends"
  const [selectedTeam, setSelectedTeam] = useState(initial[3] && TEAM_CONFERENCE[initial[3]] ? initial[3] : null);
  const [sortKey, setSortKey] = useState("player");
  const [sortDir, setSortDir] = useState("asc");
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [positionFilter, setPositionFilter] = useState("");
  const [commitsOnly, setCommitsOnly] = useState(false);
  const [profilePlayer, setProfilePlayer] = useState(null);
  const [adding, setAdding] = useState(false);
  const [fixingNames, setFixingNames] = useState(false);

  const tracker = useOfferTracker();
  // Opens on the earliest class year (2027).
  const activeClassYear = classYear || tracker.classYears[0] || null;

  const teams = useMemo(
    () => (activeClassYear ? tracker.teamsForConference(activeClassYear, conference) : []),
    [activeClassYear, conference, tracker]
  );
  const activeTeam = selectedTeam && teams.some((t) => t.team === selectedTeam) ? selectedTeam : teams[0]?.team;
  const activeTeamMeta = teams.find((t) => t.team === activeTeam);
  useEffect(() => {
    if (activeClassYear) setSubRoute("offers", [activeClassYear, conference, subView, selectedTeam]);
  }, [activeClassYear, conference, subView, selectedTeam]);
  const activeCollege = useMemo(() => (activeTeamMeta ? collegeForLabel(activeTeamMeta.label) : null), [activeTeamMeta]);

  // Typing in the search box searches every team in every conference
  // for the class year; with it empty you browse the selected team.
  const searching = search.trim() !== "";
  const allTeamRows = useMemo(() => {
    if (!activeClassYear) return [];
    if (searching) return tracker.rowsForClassYear(activeClassYear);
    return activeTeam ? tracker.rowsForTeam(activeClassYear, activeTeam) : [];
  }, [activeClassYear, activeTeam, tracker, searching]);

  const stateOptions = useMemo(
    () => [...new Set(allTeamRows.map((r) => r.state).filter(Boolean))].sort(),
    [allTeamRows]
  );

  const positionOptions = useMemo(() => {
    const present = new Set(allTeamRows.map((r) => normalizePosition(r.position)));
    return ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "SAF", "K", "P", "LS", "ATH"].filter((p) => present.has(p));
  }, [allTeamRows]);

  const commitCount = useMemo(
    () => (activeTeamMeta && !searching ? allTeamRows.filter((r) => isCommittedTo(r.status, activeTeamMeta.label)).length : 0),
    [allTeamRows, activeTeamMeta, searching]
  );

  const teamRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = allTeamRows;
    if (commitsOnly && !searching && activeTeamMeta) {
      rows = rows.filter((r) => isCommittedTo(r.status, activeTeamMeta.label));
    }
    if (q) {
      const alt = canonicalSchool(q).toLowerCase(); // "massachusetts" also finds "UMass"
      // Status is searched too, so typing a school ("ohio state")
      // finds everyone committed there -- that's the "committed to X"
      // text -- without a separate dropdown.
      rows = rows.filter(
        (r) =>
          (r.player || "").toLowerCase().includes(q) ||
          (r.highSchool || "").toLowerCase().includes(q) ||
          (r.status || "").toLowerCase().includes(q) ||
          (r.status || "").toLowerCase().includes(alt)
      );
    }
    if (stateFilter) {
      rows = rows.filter((r) => r.state === stateFilter);
    }
    if (positionFilter) {
      rows = rows.filter((r) => normalizePosition(r.position) === positionFilter);
    }
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
  }, [allTeamRows, search, stateFilter, positionFilter, commitsOnly, activeTeamMeta, searching, sortKey, sortDir]);

  function handleSort(key) {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const teamAccent = searching ? undefined : activeTeamMeta?.color;
  const teamTextAccent = searching ? null : textAccentFor(activeTeamMeta, theme);

  return (
    <ThemeContext.Provider value={theme}>
    <div
      className="app-shell"
      data-theme={theme}
      style={{
        display: "flex", flexDirection: "column", overflow: "hidden",
        background: "var(--bg-page)", color: "var(--text-primary)",
        fontFamily: "'Century Gothic', 'Jost', 'Helvetica Neue', Arial, sans-serif",
      }}
    >
      <div className="app-header" style={{ flexShrink: 0, position: "relative", padding: "20px var(--gutter) 16px" }}>
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
            {activeClassYear && (
              <button
                onClick={() => setFixingNames(true)}
                title="Fix a misspelled name or merge two spellings of one recruit"
                style={{
                  display: "flex", alignItems: "center", gap: 7, flexShrink: 0,
                  background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)",
                  borderRadius: 5, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer",
                }}
              >
                <Pencil size={15} /> Fix names
              </button>
            )}
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
            <ThemeSwitcher theme={theme} onChange={setTheme} />
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

          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "16px var(--gutter) 0" }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
              <div style={{ display: "flex", gap: 6 }}>
                {CONFERENCE_ORDER.map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      setConference(c);
                      setSelectedTeam(null);
                      setStateFilter("");
                      setPositionFilter("");
                    }}
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
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12, flexShrink: 0 }}>
                  {teams.map(({ team, label, color }) => {
                    const active = !searching && team === activeTeam;
                    return (
                      <button
                        key={team}
                        onClick={() => {
                          setSelectedTeam(team);
                          setSearch("");
                          setStateFilter("");
                      setPositionFilter("");
                        }}
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

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12, flexShrink: 0 }}>
                  {!searching && activeCollege && (
                    <img
                      key={`${activeCollege.id}-${theme}`}
                      src={logoFor(activeCollege, theme)}
                      alt={`${activeTeamMeta.label} logo`}
                      title={activeTeamMeta.label}
                      style={{ width: 42, height: 42, objectFit: "contain", flexShrink: 0, marginRight: 4 }}
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  )}
                  <div style={{ position: "relative", flex: "1 1 240px", minWidth: 200 }}>
                    <Search size={14} color="var(--text-faint)" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search every team — name, high school or school committed to…"
                      style={{
                        width: "100%", background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)",
                        borderRadius: 5, padding: "7px 10px 7px 30px", fontSize: 13, fontFamily: "inherit",
                      }}
                    />
                  </div>
                  <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} style={filterSelectStyle}>
                    <option value="">All States</option>
                    {stateOptions.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <select value={positionFilter} onChange={(e) => setPositionFilter(e.target.value)} style={filterSelectStyle}>
                    <option value="">All Positions</option>
                    {positionOptions.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                  {!searching && activeTeamMeta && (
                    <label
                      style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", userSelect: "none", fontSize: 13, fontWeight: 600, color: commitsOnly ? teamTextAccent || "var(--accent)" : "var(--text-secondary)", marginLeft: "auto" }}
                      title={`Only show players committed to ${activeTeamMeta.label}`}
                    >
                      <span
                        role="switch"
                        aria-checked={commitsOnly}
                        tabIndex={0}
                        onClick={() => setCommitsOnly((v) => !v)}
                        onKeyDown={(e) => (e.key === " " || e.key === "Enter") && (e.preventDefault(), setCommitsOnly((v) => !v))}
                        style={{
                          position: "relative", width: 38, height: 22, borderRadius: 999, flexShrink: 0, transition: "background 0.15s ease, border-color 0.15s ease",
                          background: commitsOnly ? activeTeamMeta.color : "var(--bg-surface)",
                          border: `1px solid ${commitsOnly ? teamTextAccent || activeTeamMeta.color : "var(--border)"}`,
                        }}
                      >
                        <span
                          style={{
                            position: "absolute", top: 2, left: commitsOnly ? 18 : 2, width: 16, height: 16, borderRadius: 999, transition: "left 0.15s ease",
                            background: commitsOnly ? contrastOn(activeTeamMeta.color) : "var(--text-muted)",
                          }}
                        />
                      </span>
                      <span onClick={() => setCommitsOnly((v) => !v)}>
                        {activeTeamMeta.label} Commits <span className="tabular" style={{ color: "var(--text-faint)", fontWeight: 500 }}>({commitCount})</span>
                      </span>
                    </label>
                  )}
                  <span style={{ fontSize: 12.5, color: "var(--text-faint)", marginLeft: searching || !activeTeamMeta ? "auto" : 0 }}>
                    {teamRows.length} of {allTeamRows.length}{searching ? " across all teams" : ""}
                  </span>
                  {!searching && (
                  <button
                    onClick={() => setAdding((a) => !a)}
                    style={{
                      display: "flex", alignItems: "center", gap: 6, background: "var(--accent-bg)", border: "1px solid var(--accent)",
                      color: "var(--accent)", borderRadius: 5, padding: "7px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer",
                    }}
                  >
                    <Plus size={14} /> Add offer
                  </button>
                  )}
                </div>

                {adding && !searching && (
                  <AddOfferForm
                    teamLabel={activeTeamMeta?.label || ""}
                    onAdd={(fields) => tracker.addOffer(activeClassYear, activeTeam, fields)}
                    onClose={() => setAdding(false)}
                  />
                )}

                <div style={{ flex: 1, minHeight: 0, overflow: "auto", border: "1px solid var(--border)", borderRadius: 6, marginBottom: "var(--gutter)" }}>
                  <TeamOffersTable
                    rows={teamRows}
                    showTeam={searching}
                    onEdit={(row, field, value) => tracker.updateOfferField(row, field, value)}
                    onOpenProfile={(player) => setProfilePlayer(player)}
                    onRemove={(row) => tracker.removeOffer(row)}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    teamColor={teamAccent}
                    teamTextColor={teamTextAccent}
                    commitTeam={commitsOnly && !searching ? activeTeamMeta : null}
                  />
                </div>
              </>
            ) : (
              <div style={{ flex: 1, minHeight: 0, overflow: "auto", paddingBottom: "var(--gutter)" }}>
                <BreakdownTables classYear={activeClassYear} conference={conference} tracker={tracker} />
              </div>
            )}
          </div>
        </>
      )}

      {profilePlayer && (
        <PlayerProfileModal
          player={profilePlayer}
          classYear={activeClassYear}
          tracker={tracker}
          onClose={() => setProfilePlayer(null)}
        />
      )}

      {fixingNames && activeClassYear && <NameFixModal tracker={tracker} classYear={activeClassYear} onClose={() => setFixingNames(false)} />}

      {uploadOpen && (
        <UploadModal
          classYears={tracker.classYears}
          onClose={() => setUploadOpen(false)}
          onImport={async (file, cy, isFeed) => {
            if (isFeed) {
              const result = await tracker.importActivityFeed(file);
              if (result.years.length) setClassYear(result.years[0]);
              return result;
            }
            const result = await tracker.importWorkbook(file, cy);
            setClassYear(cy);
            return result;
          }}
        />
      )}
    </div>
    </ThemeContext.Provider>
  );
}
