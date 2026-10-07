import { useMemo, useRef, useState } from "react";
import { Download, Loader2, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { control, LinkCell, TextCell } from "./EditableCells.jsx";
import { confirmAction } from "./ConfirmDialog.jsx";
import { parseTransferSheet, useTransferOutTracker } from "./transferOutData.js";
import { findTransferStats, formatStatLine } from "./transferStats.js";
import { useRealStatsReady } from "./statsData.js";

const ghostBtn = { ...control, cursor: "pointer", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 7 };

// Best-effort display casing for a player we never found in the Pre-Portal Tracker's own data -- the
// sheet this started from was typed in ALL CAPS, and that's not how a name should read on the page.
function titleCase(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function statLineText(matches) {
  return matches.length ? matches.map(formatStatLine).join("; ") : "";
}

function downloadCsv(players, matchesByPlayer, filename) {
  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["Name", "Position", "College", "Total Stats", "PFF Snaps", "PFF Link"].map(escape).join(",")];
  players.forEach((p) => {
    const matches = matchesByPlayer.get(p.id) || [];
    const name = matches[0]?.row.player || titleCase(p.name);
    lines.push([name, p.position, p.college, statLineText(matches) || "Not found this season", p.pffSnaps, p.pffLink].map(escape).join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// The player's name -- shown in the Pre-Portal Tracker's own casing and, once matched there, linked to
// that same player filtered up in that tracker (same "#/tracker/DIVISION/Name" deep link the Roster page
// already uses) instead of whatever case the sheet this started from was typed in. Editing still changes
// the raw typed name (fixing a typo is how a non-match becomes a match), it just doesn't double as the
// navigation click -- a separate small pencil handles that, same split LinkCell already uses.
function NameCell({ p, matches, editable, onSave }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(p.name || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function commit(next) {
    if (next === (p.name || "")) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(next);
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
          value={value}
          disabled={saving}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Player name"
          style={{ ...control, padding: "4px 7px", fontSize: 12.5, width: 160, opacity: saving ? 0.6 : 1 }}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(value.trim());
            if (e.key === "Escape") {
              setValue(p.name || "");
              setError("");
              setEditing(false);
            }
          }}
          onBlur={() => commit(value.trim())}
        />
        {error && <span style={{ fontSize: 11, color: "var(--danger, #c0392b)", whiteSpace: "nowrap" }}>{error}</span>}
      </div>
    );
  }

  const match = matches?.[0];
  const displayName = match ? match.row.player : titleCase(p.name);
  if (!displayName) {
    return editable ? (
      <button onClick={() => setEditing(true)} style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", fontSize: 12.5, textDecoration: "underline", padding: 0 }}>
        Add
      </button>
    ) : (
      <span style={{ color: "var(--text-faint)" }}>—</span>
    );
  }
  if (match) {
    const href = `#/tracker/${encodeURIComponent(match.row.division)}/${encodeURIComponent(match.row.player)}`;
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <a href={href} title="Open in the Pre-Portal Tracker" style={{ color: "var(--accent)" }}>
          {displayName}
        </a>
        {editable && (
          <button onClick={() => setEditing(true)} title="Fix this name" aria-label={`Change name for ${displayName}`} style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", lineHeight: 0 }}>
            <Pencil size={11} />
          </button>
        )}
      </span>
    );
  }
  return (
    <span onClick={() => editable && setEditing(true)} title={editable ? "Click to change" : undefined} style={{ cursor: editable ? "pointer" : "default" }}>
      {displayName}
    </span>
  );
}

// Read-only: this player's season-total stat line(s) looked up live against the Pre-Portal Tracker's
// own data, by name (see transferStats.js) -- nothing here is ever saved, so it updates on its own every
// time that data refreshes, with no "edit" affordance at all.
function StatsCell({ matches, statsReady }) {
  if (!statsReady) return <Loader2 size={13} className="spin" style={{ color: "var(--text-faint)" }} />;
  if (!matches.length) {
    return <span style={{ color: "var(--text-faint)" }}>Not found this season</span>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {matches.map((m) => (
        <span key={m.category}>{formatStatLine(m)}</span>
      ))}
    </div>
  );
}

export default function TransferOutTracker({ canEdit, meta }) {
  const tracker = useTransferOutTracker();
  const statsReady = useRealStatsReady();
  const fileInput = useRef(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  // Computed once per render of the (short) roster, not per cell -- Name and Total Stats both need the
  // exact same match so the linked name's division always agrees with the stats shown beside it.
  const matchesByPlayer = useMemo(() => {
    const map = new Map();
    if (!statsReady) return map;
    tracker.players.forEach((p) => map.set(p.id, findTransferStats(p.name, p.college, p.position)));
    return map;
  }, [tracker.players, statsReady]);
  const th = { textAlign: "left", padding: "9px 10px", fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.03em", whiteSpace: "nowrap", position: "sticky", top: 0, background: "var(--bg-surface)", zIndex: 1 };
  const td = { padding: "7px 10px", fontSize: 13.5, color: "var(--text-secondary)", borderTop: "1px solid var(--border-subtle)", verticalAlign: "top" };

  async function removePlayer(p) {
    const ok = await confirmAction({ title: `Remove ${p.name || "this player"}?`, message: "This takes them off the Transfer Out Tracker entirely." });
    if (ok) tracker.removePlayer(p.id);
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportError("");
    try {
      const players = await parseTransferSheet(file);
      if (players.length === 0) {
        setImportError("No player rows found in that sheet.");
        return;
      }
      const ok = await confirmAction({
        title: `Import ${players.length} player${players.length === 1 ? "" : "s"}?`,
        message: `This adds ${players.length} new row${players.length === 1 ? "" : "s"} to the tracker (it never matches against players already here, so don't re-import the same sheet twice).`,
        confirmLabel: "Import",
      });
      if (!ok) return;
      setImporting(true);
      await tracker.importFromSheet(players);
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
          {canEdit && (
            <>
              <button onClick={() => tracker.addPlayer()} style={ghostBtn}><Plus size={14} /> Add player</button>
              <button onClick={() => fileInput.current?.click()} disabled={importing} style={{ ...ghostBtn, opacity: importing ? 0.6 : 1 }}>
                <Upload size={14} /> {importing ? "Importing…" : "Import from Excel"}
              </button>
              <input ref={fileInput} type="file" accept=".xlsx,.xls" onChange={handleFile} style={{ display: "none" }} />
            </>
          )}
          <button onClick={() => downloadCsv(tracker.players, matchesByPlayer, "transfer-out-tracker.csv")} style={ghostBtn}><Download size={14} /> Download</button>
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
                <th style={th}>Name</th>
                <th style={th}>Position</th>
                <th style={th}>College</th>
                <th style={th}>Total Stats</th>
                <th style={th}>PFF Snaps</th>
                <th style={th}>PFF Link</th>
                {canEdit && <th style={th}> </th>}
              </tr>
            </thead>
            <tbody>
              {tracker.players.length === 0 && (
                <tr>
                  <td colSpan={6 + (canEdit ? 1 : 0)} style={{ ...td, textAlign: "center", color: "var(--text-faint)", padding: 32 }}>
                    No one added yet.
                  </td>
                </tr>
              )}
              {tracker.players.map((p, i) => {
                const matches = matchesByPlayer.get(p.id) || [];
                return (
                <tr key={p.id} style={{ background: i % 2 === 0 ? "var(--bg-panel)" : "var(--bg-page)" }}>
                  <td style={{ ...td, fontWeight: 700, color: "var(--text-primary)" }}>
                    <NameCell p={p} matches={matches} editable={canEdit} onSave={(v) => tracker.updatePlayer(p.id, { name: v })} />
                  </td>
                  <td style={td}>
                    <TextCell row={p} field="position" placeholder="Pos" editable={canEdit} onSave={(v) => tracker.updatePlayer(p.id, { position: v })} />
                  </td>
                  <td style={td}>
                    <TextCell row={p} field="college" placeholder="College" editable={canEdit} onSave={(v) => tracker.updatePlayer(p.id, { college: v })} />
                  </td>
                  <td style={{ ...td, minWidth: 220 }}>
                    <StatsCell matches={matches} statsReady={statsReady} />
                  </td>
                  <td style={td}>
                    <TextCell row={p} field="pffSnaps" placeholder="Snaps" editable={canEdit} onSave={(v) => tracker.updatePlayer(p.id, { pffSnaps: v })} />
                  </td>
                  <td style={td}>
                    <LinkCell row={p} field="pffLink" label="PFF" placeholder="Paste a PFF link…" editable={canEdit} onSave={(url) => tracker.updatePlayer(p.id, { pffLink: url })} />
                  </td>
                  {canEdit && (
                    <td style={{ ...td, textAlign: "right" }}>
                      <button onClick={() => removePlayer(p)} title={`Remove ${p.name || "this player"}`} aria-label={`Remove ${p.name || "this player"}`} style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", padding: 2, lineHeight: 0 }}>
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
    </div>
  );
}
