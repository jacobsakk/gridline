import { useEffect, useMemo, useState } from "react";
import { ChevronRight, ClipboardPaste, Download, Loader2, Paperclip, Plus, Trash2, X } from "lucide-react";
import { BackButton, HomeButton } from "./HomeButton.jsx";
import { ThemeSwitcher, useTheme } from "./theme.jsx";
import { useBack, initialSubRoute, setSubRoute } from "./route.js";
import { STUDIES, useStudy } from "./studiesData.js";
import { confirmAction } from "./ConfirmDialog.jsx";
import { control, LinkCell, StateCell, TextCell } from "./EditableCells.jsx";
import TransferOutTracker from "./TransferOutTracker.jsx";
import { submitStudyRequest, useStudyRequests } from "./studyRequests.js";

const ghostBtn = { ...control, cursor: "pointer", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 7 };

// Studies that don't fit the generic position-group/season/stat shape StudyDetail renders (MAC's
// Most Productive) -- each one of these gets its own detail component instead, picked by id below.
// Still listed as an ordinary card on the landing page, same as STUDIES.
const CUSTOM_STUDIES = [
  {
    id: "transfer-out-tracker",
    title: "Transfer Out Tracker",
    description: "Former Chippewas now playing elsewhere -- season stats pull live from the Pre-Portal Tracker's own data, same as everywhere else in the site; add a player by hand and a PFF link/snap count once graded.",
    detail: TransferOutTracker,
  },
];

// A modal for "Request a study" on the landing page -- any coach can describe what they want (and
// optionally attach an example file, a mocked-up sheet or a screenshot) instead of only asking in chat.
// It lands in studyRequests for an admin to see and build, same spirit as "Request access" on sign-in.
function RequestStudyModal({ by, onClose }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setSaving(true);
    setError("");
    try {
      await submitStudyRequest({ title, description, file, by });
      onClose(true);
    } catch (err) {
      setError(err?.message || "Couldn't send that -- try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div onClick={() => onClose(false)} style={{ position: "fixed", inset: 0, height: "auto", zIndex: 100, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{ position: "relative", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 10, width: 440, maxWidth: "100%", padding: "22px 24px", color: "var(--text-primary)", boxShadow: "0 18px 48px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", gap: 12 }}
      >
        <button onClick={() => onClose(false)} aria-label="Close" style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", lineHeight: 0 }}>
          <X size={16} />
        </button>
        <h2 className="oswald" style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Request a study</h2>
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
          Say what you want, point-blank -- the data you want pulled, how it should be grouped, whatever's in your head. Attach an example sheet or screenshot if that's easier than describing it.
        </p>
        <label style={{ fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.03em" }}>Title</label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Transfer Out Tracker"
          style={{ ...control, padding: "8px 11px", fontSize: 13.5 }}
        />
        <label style={{ fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.03em" }}>What do you want it to show?</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          placeholder="Describe the data, columns, grouping -- whatever you'd tell Claude directly."
          style={{ ...control, padding: "8px 11px", fontSize: 13.5, resize: "vertical", fontFamily: "inherit" }}
        />
        <label style={{ ...ghostBtn, justifyContent: "center" }}>
          <Paperclip size={14} /> {file ? file.name : "Attach an example file (optional)"}
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ display: "none" }} />
        </label>
        {error && <span style={{ fontSize: 12, color: "var(--danger, #c0392b)" }}>{error}</span>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <button onClick={() => onClose(false)} style={ghostBtn}>Cancel</button>
          <button onClick={submit} disabled={saving || !title.trim()} style={{ ...ghostBtn, background: "var(--accent)", color: "var(--bg-page)", border: "none", opacity: saving || !title.trim() ? 0.6 : 1 }}>
            {saving ? "Sending…" : "Send request"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Admin-only queue of pending "request a study" asks -- shown right on the landing page so they don't
// need to go dig through Firestore or wait for someone to mention it in chat.
function RequestQueue({ admin }) {
  const { pending, markDone, remove } = useStudyRequests(admin);
  if (!admin || pending.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
      <h2 className="oswald" style={{ fontSize: 13, fontWeight: 700, margin: 0, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.03em" }}>
        Requested studies ({pending.length})
      </h2>
      {pending.map((r) => (
        <div key={r.id} style={{ display: "flex", gap: 12, alignItems: "flex-start", justifyContent: "space-between", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>{r.title}</div>
            {r.description && <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2, whiteSpace: "pre-wrap" }}>{r.description}</div>}
            <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 4 }}>
              {r.by} · {new Date(r.createdAt).toLocaleDateString()}
              {r.fileUrl && (
                <>
                  {" · "}
                  <a href={r.fileUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>{r.fileName || "attachment"}</a>
                </>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button onClick={() => markDone(r.id)} style={{ ...ghostBtn, padding: "5px 10px", fontSize: 12 }}>Mark done</button>
            <button onClick={() => remove(r.id)} title="Dismiss" aria-label="Dismiss" style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", padding: 4, lineHeight: 0 }}>
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function downloadCsv(rows, columns, filename) {
  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [columns.map((c) => escape(c.label)).join(",")];
  rows.forEach((r) => lines.push(columns.map((c) => escape(c.get(r))).join(",")));
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Shows exactly how a row's score was computed -- the same formula as GROUPS' score lambdas in
// scraper/studies/mac_best_by_position.py, walked term by term against this player's actual stats,
// so "why is this score X" never requires reading the Python.
function ScoreExplainer({ row, group, onClose }) {
  const terms = group.scoreFormula.map((t) => {
    const value = row.totals[t.key] ?? 0;
    return { ...t, value, contribution: Math.round(value * t.coef * 10) / 10 };
  });
  const sign = (n) => (n < 0 ? "−" : "+");
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, height: "auto", zIndex: 100, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{ position: "relative", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 10, width: 380, maxWidth: "100%", padding: "20px 22px", color: "var(--text-primary)", boxShadow: "0 18px 48px rgba(0,0,0,0.5)" }}
      >
        <button onClick={onClose} aria-label="Close" style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", lineHeight: 0 }}>
          <X size={16} />
        </button>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{row.player}</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>{row.team} · {row.season} · {group.label}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13.5 }}>
          {terms.map((t, i) => (
            <div key={t.key} style={{ display: "flex", justifyContent: "space-between", gap: 10 }} className="tabular">
              <span style={{ color: "var(--text-secondary)" }}>
                {i > 0 && <span style={{ color: "var(--text-faint)", marginRight: 6 }}>{sign(t.coef)}</span>}
                {t.value} {t.label}{Math.abs(t.value) === 1 ? "" : "s"} {t.coef !== 1 && t.coef !== -1 ? `× ${Math.abs(t.coef)}` : ""}
              </span>
              <span style={{ color: "var(--text-primary)" }}>{sign(i === 0 ? 1 : t.coef) === "−" ? "−" : ""}{Math.abs(t.contribution)}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, borderTop: "1px solid var(--border-subtle)", paddingTop: 8, marginTop: 4, fontWeight: 700 }} className="tabular">
            <span>Score</span>
            <span style={{ color: "var(--accent)" }}>{row.score}</span>
          </div>
        </div>
        <p style={{ margin: "14px 0 0", fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.5 }}>
          "Most productive" for this position is a stat-weighted formula, not a stat the NCAA reports directly -- it's meant to roughly rank production, not to be an official rating.
        </p>
      </div>
    </div>
  );
}

// One raw stat value (games, tackles, yards...), editable by any invited coach for exactly the reason
// this study keeps needing it: a source (the NCAA leaderboard for 2023-2025, ESPN's roster API for
// 2026) is occasionally wrong for one player -- rather than waiting on a code fix, it's corrected here.
// Same click-to-edit shape as StateCell, but numeric and always has *some* value to show (0, not a dash).
function StatCell({ value, canEdit, onSave, accent }) {
  const [editing, setEditing] = useState(false);
  // An ungraded PFF cell's 0 is a placeholder, not a real value (see the "Add grade" prompt below) --
  // starting the input blank instead of on "0" means typing the actual grade straight away.
  const [text, setText] = useState(accent && !value ? "" : String(value));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function commit(next) {
    const parsed = parseFloat(next);
    const nextValue = Number.isFinite(parsed) ? parsed : 0;
    if (nextValue === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(nextValue);
      setEditing(false);
    } catch (err) {
      setError(err?.code === "permission-denied" ? "No permission to save." : "Failed");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <input
          autoFocus
          inputMode="decimal"
          value={text}
          disabled={saving}
          onChange={(e) => setText(e.target.value)}
          className="tabular"
          style={{ ...control, padding: "4px 7px", fontSize: 12.5, width: 60, opacity: saving ? 0.6 : 1 }}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(text);
            if (e.key === "Escape") {
              setText(String(value));
              setError("");
              setEditing(false);
            }
          }}
          onBlur={() => commit(text)}
        />
        {error && <span style={{ fontSize: 11, color: "var(--danger, #c0392b)", whiteSpace: "nowrap" }}>{error}</span>}
      </div>
    );
  }
  // A PFF grade has no "real zero" the way a tackle/yard count does -- 0 just means nobody's graded
  // this player yet, so it reads as an "Add grade" prompt instead of a misleading 0, same as the
  // Add/Add link prompts the other empty cells on this page already use.
  if (accent && !value) {
    return canEdit ? (
      <button onClick={() => setEditing(true)} style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", fontSize: 12.5, textDecoration: "underline", padding: 0 }}>
        Add grade
      </button>
    ) : (
      <span style={{ color: "var(--text-faint)" }}>—</span>
    );
  }
  return (
    <span
      onClick={() => canEdit && setEditing(true)}
      title={canEdit ? "Click to correct" : undefined}
      style={{ cursor: canEdit ? "pointer" : "default", color: accent ? "var(--accent)" : undefined, fontWeight: accent ? 700 : undefined }}
    >
      {value}
    </span>
  );
}

// Bulk-loads a manual group's rows from a table copy-pasted straight out of PFF's site (select the
// rows, Ctrl/Cmd+C, paste here -- a browser table copy comes through tab-separated, same as any
// spreadsheet). Meant to be reused every week PFF's grades refresh, not just once: see study.pasteTable.
function PasteTableModal({ allowNewRows, onClose, onSubmit }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  async function submit() {
    setSaving(true);
    setError("");
    try {
      const r = await onSubmit(text);
      setResult(r);
    } catch (err) {
      setError(err?.message || "Couldn't read that table -- try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, height: "auto", zIndex: 100, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{ position: "relative", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 10, width: 560, maxWidth: "100%", padding: "22px 24px", color: "var(--text-primary)", boxShadow: "0 18px 48px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", gap: 12 }}
      >
        <button onClick={onClose} aria-label="Close" style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", lineHeight: 0 }}>
          <X size={16} />
        </button>
        <h2 className="oswald" style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Paste a table</h2>
        {result ? (
          <>
            <p style={{ margin: 0, fontSize: 13.5, color: "var(--success)" }}>
              {result.updated} updated{result.created ? `, ${result.created} added` : ""}{result.skipped ? `, ${result.skipped} skipped (not already on this list)` : ""} ({result.total} row{result.total === 1 ? "" : "s"} read).
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button onClick={onClose} style={{ ...ghostBtn, background: "var(--accent)", color: "var(--bg-page)", border: "none" }}>Done</button>
            </div>
          </>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
              Select a table on PFF's site (including the header row), copy it, and paste it below. Matched by Name -- a player already shown here (whether on the real leaderboard or hand-added) gets their PFF grade corrected in place.{" "}
              {allowNewRows
                ? "A name that matches no one gets added as a new row (this group has no other way to add one)."
                : "A name that matches no one already on this list is skipped, not added."}{" "}
              Add your own State, Hudl and G (games) columns too (any order, anywhere in the row) and those fill in as well, without overwriting one already set. Nothing already here is ever removed by this.
            </p>
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              placeholder="Paste the copied table here…"
              style={{ ...control, padding: "8px 11px", fontSize: 12.5, fontFamily: "monospace", resize: "vertical" }}
            />
            {error && <span style={{ fontSize: 12, color: "var(--danger, #c0392b)" }}>{error}</span>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={onClose} style={ghostBtn}>Cancel</button>
              <button onClick={submit} disabled={saving || !text.trim()} style={{ ...ghostBtn, background: "var(--accent)", color: "var(--bg-page)", border: "none", opacity: saving || !text.trim() ? 0.6 : 1 }}>
                {saving ? "Reading…" : "Import"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StudyDetail({ studyId, canEdit, onBack }) {
  const study = useStudy(studyId);
  const [initial] = useState(initialSubRoute);
  const [group, setGroup] = useState(() => study.meta.groups.some((g) => g.key === initial[1]) ? initial[1] : study.meta.groups[0].key);
  const [season, setSeason] = useState(() => (/^\d{4}$/.test(initial[2]) ? Number(initial[2]) : null));
  const [sort, setSort] = useState({ key: "score", dir: "desc" });
  const [explainRow, setExplainRow] = useState(null);
  const [pasting, setPasting] = useState(false);

  const activeGroup = study.meta.groups.find((g) => g.key === group);
  const seasons = study.seasons;
  const activeSeason = seasons.includes(season) ? season : seasons[seasons.length - 1];
  const rows = study.groups[group]?.[String(activeSeason)] || [];
  useEffect(() => {
    if (activeSeason != null) setSubRoute("studies", [studyId, group, activeSeason]);
  }, [studyId, group, activeSeason]);
  const sorted = useMemo(() => {
    const get = (r) => (sort.key === "player" || sort.key === "team" || sort.key === "state" ? String(r[sort.key] ?? "") : sort.key === "score" ? r.score : r.totals[sort.key] ?? 0);
    return [...rows].sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      const cmp = typeof av === "string" ? av.localeCompare(bv) : av - bv;
      return sort.dir === "desc" ? -cmp : cmp;
    });
  }, [rows, sort]);

  const columns = useMemo(
    () => [
      { key: "player", label: "Player", get: (r) => r.player },
      { key: "team", label: "Team", get: (r) => r.team },
      { key: "state", label: "State", get: (r) => r.state || "" },
      ...activeGroup.stats.map((s) => ({ key: s.key, label: s.label, get: (r) => r.totals[s.key] ?? 0 })),
      // No Score column for a manual group (OL) -- there's no formula that makes sense for it; sorting
      // by PFF Grade (or anything else) directly via the column header already works without one.
      ...(activeGroup.scoreFormula ? [{ key: "score", label: "Score", get: (r) => r.score }] : []),
      { key: "hudlLink", label: "Hudl", get: (r) => r.hudlLink || "" },
      { key: "pffLink", label: "PFF", get: (r) => r.pffLink || "" },
    ],
    [activeGroup]
  );

  function sortBy(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "asc" }));
  }
  function openGroup(g) {
    setGroup(g.key);
    // A manual group has no score to default-sort by -- its second stat is PFF Grade, a much more useful
    // default than falling back to score (which would just be undefined for every row).
    setSort(g.scoreFormula ? { key: "score", dir: "desc" } : { key: g.stats[g.stats.length - 1]?.key || "player", dir: "desc" });
  }
  async function addPlayer() {
    await study.addManualRow(group, activeSeason);
  }
  async function removePlayer(r) {
    const isManualRow = !!r.id;
    const ok = await confirmAction({ title: `Remove ${r.player || "this player"}?`, message: `This takes them off ${activeGroup.label}'s list for ${activeSeason}.` });
    if (!ok) return;
    if (isManualRow) study.removeManualRow(r.id);
    else study.excludePlayer(group, activeSeason, r.player);
  }
  const arrow = (key) => (sort.key === key ? (sort.dir === "desc" ? " ▼" : " ▲") : "");
  const th = { textAlign: "left", padding: "9px 10px", fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.03em", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap", position: "sticky", top: 0, background: "var(--bg-surface)", zIndex: 1 };
  const td = { padding: "7px 10px", fontSize: 13.5, color: "var(--text-secondary)", borderTop: "1px solid var(--border-subtle)", whiteSpace: "nowrap" };

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "16px var(--gutter) var(--gutter)", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="oswald" style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{study.meta.title}</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-muted)", maxWidth: 720, lineHeight: 1.5 }}>{study.meta.description}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {canEdit && (
            <button onClick={addPlayer} style={ghostBtn}><Plus size={14} /> Add player</button>
          )}
          {canEdit && (
            <button onClick={() => setPasting(true)} style={ghostBtn}><ClipboardPaste size={14} /> Paste table</button>
          )}
          <button onClick={() => downloadCsv(sorted, columns, `${study.meta.id}-${group}-${activeSeason}.csv`)} style={ghostBtn}><Download size={14} /> Download</button>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {study.meta.groups.map((g) => {
            const isActive = g.key === group;
            const count = study.groups[g.key]?.[String(activeSeason)]?.length ?? 0;
            return (
              <button
                key={g.key}
                onClick={() => openGroup(g)}
                style={{
                  display: "flex", alignItems: "center", gap: 7, borderRadius: 999, padding: "7px 14px", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
                  background: isActive ? "var(--accent-bg)" : "var(--bg-surface)", border: `1px solid ${isActive ? "var(--accent)" : "var(--border)"}`,
                  color: isActive ? "var(--accent)" : "var(--text-secondary)",
                }}
              >
                {g.label}
                {study.ready && <span className="tabular" style={{ fontSize: 11.5, opacity: 0.8 }}>{count}</span>}
              </button>
            );
          })}
        </div>
        {seasons.length > 0 && (
          <div style={{ display: "flex", gap: 4, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 3 }}>
            {seasons.map((y) => (
              <button
                key={y}
                onClick={() => setSeason(y)}
                style={{
                  border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
                  background: y === activeSeason ? "var(--accent)" : "transparent", color: y === activeSeason ? "var(--bg-page)" : "var(--text-muted)",
                }}
                className="tabular"
              >
                {y}
              </button>
            ))}
          </div>
        )}
      </div>

      {!study.ready ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <Loader2 size={16} className="spin" /> Loading…
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} style={th} onClick={() => sortBy(c.key === "hudlLink" || c.key === "pffLink" ? "player" : c.key)}>
                    {c.label}{c.key !== "hudlLink" && c.key !== "pffLink" ? arrow(c.key) : ""}
                  </th>
                ))}
                {canEdit && <th style={th}> </th>}
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={columns.length + (canEdit ? 1 : 0)} style={{ ...td, textAlign: "center", color: "var(--text-faint)", padding: 32 }}>
                    {activeGroup.manual ? "No one added yet." : `Nobody qualified for this position in ${activeSeason}.`}
                  </td>
                </tr>
              )}
              {sorted.map((r, i) => {
                // A hand-added row (any group, not just OL) carries its own id; a computed one never
                // does -- that's what marks it editable-as-a-whole-row/removable here, not which group
                // it's in. An OL row is always one of these since that group has no computed rows at all.
                const isManualRow = !!r.id;
                return (
                <tr key={r.id || r.player} style={{ background: i % 2 === 0 ? "var(--bg-panel)" : "var(--bg-page)" }}>
                  <td style={{ ...td, fontWeight: 700, color: "var(--text-primary)" }}>
                    {isManualRow ? <TextCell row={r} field="player" placeholder="Player name" editable={canEdit} onSave={(v) => study.updateManualRow(r.id, { player: v })} /> : r.player}
                  </td>
                  <td style={td}>
                    {isManualRow ? <TextCell row={r} field="team" placeholder="Team" editable={canEdit} onSave={(v) => study.updateManualRow(r.id, { team: v })} /> : r.team}
                  </td>
                  <td style={td}>
                    <StateCell row={r} editable={canEdit} onSave={(state) => (isManualRow ? study.updateManualRow(r.id, { state }) : study.saveField(group, r.player, { state }))} />
                  </td>
                  {activeGroup.stats.map((s) => (
                    <td key={s.key} style={td} className="tabular">
                      <StatCell
                        value={r.totals[s.key] ?? 0}
                        canEdit={canEdit}
                        accent={s.key === "pffGrade"}
                        onSave={(value) => (isManualRow ? study.updateManualRow(r.id, { [s.key]: value }) : study.saveStat(group, activeSeason, r.player, s.key, value))}
                      />
                    </td>
                  ))}
                  {activeGroup.scoreFormula && (
                    <td style={{ ...td, fontWeight: 700, color: "var(--accent)" }} className="tabular">
                      <button
                        onClick={() => setExplainRow(r)}
                        title="Why this score?"
                        aria-label={`Why does ${r.player} have a score of ${r.score}?`}
                        style={{ background: "none", border: "none", padding: 0, font: "inherit", fontWeight: 700, color: "var(--accent)", cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 3 }}
                      >
                        {r.score}
                      </button>
                    </td>
                  )}
                  <td style={td}>
                    <LinkCell row={r} field="hudlLink" label="Film" placeholder="Paste a Hudl link…" editable={canEdit} onSave={(url) => (isManualRow ? study.updateManualRow(r.id, { hudlLink: url }) : study.saveField(group, r.player, { hudlLink: url }))} />
                  </td>
                  <td style={td}>
                    <LinkCell row={r} field="pffLink" label="PFF" placeholder="Paste a PFF link…" editable={canEdit} onSave={(url) => (isManualRow ? study.updateManualRow(r.id, { pffLink: url }) : study.saveField(group, r.player, { pffLink: url }))} />
                  </td>
                  {canEdit && (
                    <td style={{ ...td, textAlign: "right" }}>
                      <button onClick={() => removePlayer(r)} title={`Remove ${r.player || "this player"}`} aria-label={`Remove ${r.player || "this player"}`} style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", padding: 2, lineHeight: 0 }}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  )}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {study.meta.note && <p style={{ margin: 0, fontSize: 12, color: "var(--text-faint)", lineHeight: 1.5 }}>{study.meta.note}</p>}
      {explainRow && <ScoreExplainer row={explainRow} group={activeGroup} onClose={() => setExplainRow(null)} />}
      {pasting && <PasteTableModal allowNewRows={!!activeGroup.manual} onClose={() => setPasting(false)} onSubmit={(text) => study.pasteTable(group, activeSeason, text)} />}
    </div>
  );
}

const ALL_STUDIES = [...STUDIES, ...CUSTOM_STUDIES];

export default function StudiesPage({ onBack: toDashboard, session }) {
  const [theme, setTheme] = useTheme();
  const back = useBack(toDashboard);
  const admin = !!session?.profile?.admin; // still used for the "request a study" queue, below
  // Studies are a shared workspace, not an admin-only one -- anyone who reaches this page is already
  // an invited coach (see LoginGate in App.jsx), so every coach can add/fix a row.
  const canEdit = true;
  const myEmail = session?.profile?.email || "";
  const [initial] = useState(initialSubRoute);
  const [openId, setOpenId] = useState(() => (ALL_STUDIES.some((s) => s.id === initial[0]) ? initial[0] : null));
  const [requesting, setRequesting] = useState(false);

  function openStudy(id) {
    setOpenId(id);
    setSubRoute("studies", [id]);
  }
  function closeStudy() {
    setOpenId(null);
    setSubRoute("studies", []);
  }

  const openMeta = ALL_STUDIES.find((s) => s.id === openId);

  return (
    <div className="app-shell hs-shell" data-theme={theme} style={{ display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg-page)", color: "var(--text-primary)", fontFamily: "'Century Gothic', 'Jost', 'Helvetica Neue', Arial, sans-serif" }}>
      <div className="app-header" style={{ flexShrink: 0, position: "relative", padding: "20px var(--gutter) 16px" }}>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 3, background: "linear-gradient(90deg, var(--gold), var(--maroon))" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {openId ? <BackButton label="Studies" onClick={closeStudy} /> : back.fromTrail && <BackButton label={back.label} onClick={back.go} />}
            <HomeButton onHome={toDashboard} />
            <h1 className="oswald app-title" style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Studies</h1>
          </div>
          <ThemeSwitcher theme={theme} onChange={setTheme} />
        </div>
      </div>

      {openMeta?.detail ? (
        <openMeta.detail canEdit={canEdit} meta={openMeta} onBack={closeStudy} />
      ) : openId ? (
        <StudyDetail studyId={openId} canEdit={canEdit} onBack={closeStudy} />
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "24px var(--gutter) var(--gutter)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, flexWrap: "wrap", marginBottom: 18 }}>
            <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-muted)", maxWidth: 560, lineHeight: 1.6 }}>
              Ask for a study on any data already in the site, and it shows up here as its own spreadsheet.
            </p>
            <button onClick={() => setRequesting(true)} style={ghostBtn}><Plus size={14} /> Request a study</button>
          </div>
          <RequestQueue admin={admin} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
            {ALL_STUDIES.map((s) => (
              <button
                key={s.id}
                onClick={() => openStudy(s.id)}
                style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8, textAlign: "left", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 10, padding: 18, cursor: "pointer" }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                  <span className="oswald" style={{ fontSize: 15, fontWeight: 700, letterSpacing: "0.01em" }}>{s.title}</span>
                  <ChevronRight size={16} color="var(--text-faint)" />
                </div>
                <span style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>{s.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {requesting && <RequestStudyModal by={myEmail} onClose={() => setRequesting(false)} />}
    </div>
  );
}
