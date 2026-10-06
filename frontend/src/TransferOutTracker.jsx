import { useRef, useState } from "react";
import { Download, Plus, Trash2, Upload } from "lucide-react";
import { control, TextCell } from "./EditableCells.jsx";
import { confirmAction } from "./ConfirmDialog.jsx";
import { parseTransferSheet, useTransferOutTracker } from "./transferOutData.js";

const ghostBtn = { ...control, cursor: "pointer", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 7 };

function downloadCsv(players, weekCount, filename) {
  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const weekCols = Array.from({ length: weekCount }, (_, i) => `Week ${i}`);
  const lines = [["Name", "Position", "College", ...weekCols].map(escape).join(",")];
  players.forEach((p) => {
    lines.push([p.name, p.position, p.college, ...Array.from({ length: weekCount }, (_, i) => p.weeks?.[String(i)] || "")].map(escape).join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Free-text, multi-line version of the shared click-to-edit cells -- a week's entry ("45 SNAPS, 3 TOT,
// 1 TFL") runs longer than the single-line inputs Name/College/Position use, so this wraps instead of
// truncating and edits in a textarea instead of an <input>.
function WeekCell({ value, placeholder, editable, onSave }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function commit(next) {
    const trimmed = next.trim();
    if (trimmed === (value || "")) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(trimmed);
      setEditing(false);
    } catch (err) {
      setError(err?.code === "permission-denied" ? "No permission to save." : "Couldn't save -- try again.");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <textarea
          autoFocus
          value={text}
          disabled={saving}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          rows={3}
          style={{ ...control, padding: "6px 8px", fontSize: 12.5, width: 190, resize: "vertical", opacity: saving ? 0.6 : 1, fontFamily: "inherit" }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setText(value || "");
              setError("");
              setEditing(false);
            }
          }}
          onBlur={() => commit(text)}
        />
        {error && <span style={{ fontSize: 11, color: "var(--danger, #c0392b)" }}>{error}</span>}
      </div>
    );
  }
  if (value) {
    return (
      <span onClick={() => editable && setEditing(true)} title={editable ? "Click to change" : undefined} style={{ cursor: editable ? "pointer" : "default", whiteSpace: "normal", display: "block", maxWidth: 190 }}>
        {value}
      </span>
    );
  }
  return editable ? (
    <button onClick={() => setEditing(true)} style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", fontSize: 12.5, textDecoration: "underline", padding: 0 }}>
      Add
    </button>
  ) : (
    <span style={{ color: "var(--text-faint)" }}>—</span>
  );
}

export default function TransferOutTracker({ admin, meta, onBack: closeStudy }) {
  const tracker = useTransferOutTracker();
  const fileInput = useRef(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const th = { textAlign: "left", padding: "9px 10px", fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.03em", whiteSpace: "nowrap", position: "sticky", top: 0, background: "var(--bg-surface)", zIndex: 1 };
  const td = { padding: "7px 10px", fontSize: 13.5, color: "var(--text-secondary)", borderTop: "1px solid var(--border-subtle)", verticalAlign: "top" };

  async function removePlayer(p) {
    const ok = await confirmAction({ title: `Remove ${p.name || "this player"}?`, message: "This takes them off the Transfer Out Tracker entirely, including every week already logged for them." });
    if (ok) tracker.removePlayer(p.id);
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportError("");
    try {
      const parsed = await parseTransferSheet(file);
      if (parsed.players.length === 0) {
        setImportError("No player rows found in that sheet.");
        return;
      }
      const ok = await confirmAction({
        title: `Import ${parsed.players.length} player${parsed.players.length === 1 ? "" : "s"}?`,
        message: `This adds ${parsed.players.length} new row${parsed.players.length === 1 ? "" : "s"} to the tracker (it never matches against players already here, so don't re-import the same sheet twice).`,
        confirmLabel: "Import",
      });
      if (!ok) return;
      setImporting(true);
      await tracker.importFromSheet(parsed);
    } catch (err) {
      setImportError(err?.message || "Couldn't read that file.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "16px var(--gutter) var(--gutter)", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="oswald" style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{meta.title}</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-muted)", maxWidth: 720, lineHeight: 1.5 }}>{meta.description}</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {admin && (
            <>
              <button onClick={() => tracker.addPlayer()} style={ghostBtn}><Plus size={14} /> Add player</button>
              <button onClick={() => tracker.addWeek()} style={ghostBtn}><Plus size={14} /> Add week</button>
              <button onClick={() => fileInput.current?.click()} disabled={importing} style={{ ...ghostBtn, opacity: importing ? 0.6 : 1 }}>
                <Upload size={14} /> {importing ? "Importing…" : "Import from Excel"}
              </button>
              <input ref={fileInput} type="file" accept=".xlsx,.xls" onChange={handleFile} style={{ display: "none" }} />
            </>
          )}
          <button onClick={() => downloadCsv(tracker.players, tracker.weekCount, "transfer-out-tracker.csv")} style={ghostBtn}><Download size={14} /> Download</button>
        </div>
      </div>
      {importError && <span style={{ fontSize: 12, color: "var(--danger, #c0392b)" }}>{importError}</span>}

      {!tracker.ready ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Loading…</div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...th, position: "sticky", left: 0, zIndex: 2 }}>Name</th>
                <th style={th}>Position</th>
                <th style={th}>College</th>
                {Array.from({ length: tracker.weekCount }, (_, i) => (
                  <th key={i} style={th}>Week {i}</th>
                ))}
                {admin && <th style={th}> </th>}
              </tr>
            </thead>
            <tbody>
              {tracker.players.length === 0 && (
                <tr>
                  <td colSpan={3 + tracker.weekCount + (admin ? 1 : 0)} style={{ ...td, textAlign: "center", color: "var(--text-faint)", padding: 32 }}>
                    No one added yet.
                  </td>
                </tr>
              )}
              {tracker.players.map((p, i) => (
                <tr key={p.id} style={{ background: i % 2 === 0 ? "var(--bg-panel)" : "var(--bg-page)" }}>
                  <td style={{ ...td, fontWeight: 700, color: "var(--text-primary)", position: "sticky", left: 0, background: i % 2 === 0 ? "var(--bg-panel)" : "var(--bg-page)" }}>
                    <TextCell row={p} field="name" placeholder="Player name" editable={admin} onSave={(v) => tracker.updatePlayer(p.id, { name: v })} />
                  </td>
                  <td style={td}>
                    <TextCell row={p} field="position" placeholder="Pos" editable={admin} onSave={(v) => tracker.updatePlayer(p.id, { position: v })} />
                  </td>
                  <td style={td}>
                    <TextCell row={p} field="college" placeholder="College" editable={admin} onSave={(v) => tracker.updatePlayer(p.id, { college: v })} />
                  </td>
                  {Array.from({ length: tracker.weekCount }, (_, w) => (
                    <td key={w} style={td}>
                      <WeekCell value={p.weeks?.[String(w)]} placeholder="e.g. 24 snaps, 3 tot tackles" editable={admin} onSave={(text) => tracker.setWeekText(p.id, w, text)} />
                    </td>
                  ))}
                  {admin && (
                    <td style={{ ...td, textAlign: "right" }}>
                      <button onClick={() => removePlayer(p)} title={`Remove ${p.name || "this player"}`} aria-label={`Remove ${p.name || "this player"}`} style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", padding: 2, lineHeight: 0 }}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
