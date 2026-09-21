import { useRef, useState } from "react";
import { Loader2, Trash2, Upload, X } from "lucide-react";
import { UPLOAD_CATEGORIES, UPLOAD_DIVISIONS, parseStatsFile, removeUpload, saveUpload } from "./statsUpload.js";
import { confirmAction } from "./ConfirmDialog.jsx";

const field = { background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 6, padding: "8px 11px", fontSize: 13, fontFamily: "inherit", width: "100%" };
const primary = { background: "var(--accent-bg)", border: "1px solid var(--accent)", color: "var(--accent)", borderRadius: 6, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7 };

const label = (key) => UPLOAD_CATEGORIES.find((c) => c.key === key)?.label || key;
const when = (iso) => (iso ? new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" }) : "");

// Load stats the scrapers can't reach. Download the stats table from the site in your own browser (each
// stat category is its own table), then upload it here; it replaces that division's numbers for that category.
export default function StatsUploadModal({ uploads, user, onChanged, onClose }) {
  const [division, setDivision] = useState("NAIA");
  const [category, setCategory] = useState("passing");
  const [team, setTeam] = useState("");
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [saved, setSaved] = useState("");
  const input = useRef(null);

  async function read(nextFile, next = {}) {
    const f = nextFile === undefined ? file : nextFile;
    setFile(f);
    setSaved("");
    setError("");
    setParsed(null);
    if (!f) return;
    setBusy("read");
    try {
      setParsed(await parseStatsFile(f, { division: next.division || division, category: next.category || category, team: (next.team ?? team).trim() }));
    } catch (err) {
      setError(err.message || "That file couldn't be read.");
    }
    setBusy("");
  }

  async function save() {
    setBusy("save");
    setError("");
    try {
      await saveUpload({ division, category, rows: parsed.rows, fileName: file?.name, by: user });
      setSaved(`${parsed.rows.length.toLocaleString()} ${label(category).toLowerCase()} rows saved for ${division}.`);
      setFile(null);
      setParsed(null);
      if (input.current) input.current.value = "";
      await onChanged();
    } catch (err) {
      setError(err.message || "That didn't save. Try again.");
    }
    setBusy("");
  }

  async function remove(u) {
    const ok = await confirmAction({ title: `Remove the ${u.division} ${label(u.category).toLowerCase()} upload?`, message: "The tracker goes back to the scraped numbers for that category, if there are any.", confirmLabel: "Remove" });
    if (!ok) return;
    setBusy(`rm-${u.division}-${u.category}`);
    await removeUpload(u.division, u.category);
    await onChanged();
    setBusy("");
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 70 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 10, width: 600, maxWidth: "100%", maxHeight: "90vh", overflow: "auto", padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h2 className="oswald" style={{ margin: 0, fontSize: 19 }}>Upload stats</h2>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", lineHeight: 0 }}><X size={18} /></button>
        </div>
        <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
          For divisions the automatic refresh can't reach (NAIA, California JUCO). Download a stats table from the site in your own browser, as CSV or Excel, and upload it here. Each stat category (passing, rushing, receiving, defense) is its own file, and an upload replaces that division's numbers for that category.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <label style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
            Division
            <select id="up-division" value={division} onChange={(e) => { setDivision(e.target.value); read(undefined, { division: e.target.value }); }} style={{ ...field, marginTop: 5, cursor: "pointer" }}>
              {UPLOAD_DIVISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
            Stat category
            <select id="up-category" value={category} onChange={(e) => { setCategory(e.target.value); read(undefined, { category: e.target.value }); }} style={{ ...field, marginTop: 5, cursor: "pointer" }}>
              {UPLOAD_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
        </div>
        <label style={{ display: "block", fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10 }}>
          Team name (only if the file has no Team / School column)
          <input id="up-team" value={team} onChange={(e) => setTeam(e.target.value)} onBlur={() => file && read(undefined, { team })} placeholder="e.g. Benedictine (KS)" style={{ ...field, marginTop: 5 }} />
        </label>

        <input ref={input} type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }} onChange={(e) => read(e.target.files[0] || null)} />
        <button onClick={() => input.current?.click()} style={{ ...field, cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 8 }}>
          {busy === "read" ? <Loader2 size={15} className="spin" /> : <Upload size={15} />} {file ? file.name : "Choose a CSV or Excel file…"}
        </button>

        {error && <div role="alert" style={{ marginTop: 12, fontSize: 13, color: "var(--danger-text)", lineHeight: 1.5 }}>{error}</div>}
        {saved && <div role="status" style={{ marginTop: 12, fontSize: 13, color: "var(--success)" }}>{saved} Reopen the tracker if you don't see it yet.</div>}

        {parsed && (
          <div style={{ marginTop: 14, border: "1px solid var(--border)", borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-primary)" }}>
              {parsed.rows.length.toLocaleString()} {label(category).toLowerCase()} rows from {new Set(parsed.rows.map((r) => r.team)).size} {new Set(parsed.rows.map((r) => r.team)).size === 1 ? "team" : "teams"}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-faint)", margin: "4px 0 8px" }}>Columns matched: {parsed.columns.join(", ")}</div>
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
              {parsed.rows.slice(0, 3).map((r) => (
                <div key={r.id}>{r.player} · {r.team} · {r.position}{r.yards !== undefined ? ` · ${r.yards} yds` : r.total !== undefined ? ` · ${r.total} tkl` : ""}</div>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <button onClick={save} disabled={busy === "save"} style={primary}>{busy === "save" ? <Loader2 size={15} className="spin" /> : <Upload size={15} />} {busy === "save" ? "Saving…" : `Replace ${division} ${label(category).toLowerCase()}`}</button>
            </div>
          </div>
        )}

        {uploads.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: 6 }}>Uploaded so far</div>
            {uploads.map((u) => (
              <div key={`${u.division}${u.category}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: "1px solid var(--border-subtle)", fontSize: 13 }}>
                <strong style={{ width: 60 }}>{u.division}</strong>
                <span style={{ flex: 1, color: "var(--text-secondary)" }}>{label(u.category)} · {u.rowCount?.toLocaleString?.() ?? u.rows.length} rows · {when(u.uploadedAt)}{u.fileName ? ` · ${u.fileName}` : ""}</span>
                <button onClick={() => remove(u)} disabled={busy.startsWith("rm-")} aria-label={`Remove ${u.division} ${label(u.category)} upload`} style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", lineHeight: 0 }}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
        <div style={{ textAlign: "right", marginTop: 16 }}>
          <button onClick={onClose} style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 6, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Done</button>
        </div>
      </div>
    </div>
  );
}
