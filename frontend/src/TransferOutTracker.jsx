import { useRef, useState } from "react";
import { Download, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { control, LinkCell, TextCell } from "./EditableCells.jsx";
import { confirmAction } from "./ConfirmDialog.jsx";
import { parseTransferSheet, useTransferOutTracker } from "./transferOutData.js";
import { findTransferStats, formatStatLine } from "./transferStats.js";
import { useRealStatsReady } from "./statsData.js";

const ghostBtn = { ...control, cursor: "pointer", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 7 };

function statsText(p) {
  const matches = findTransferStats(p.name, p.college, p.position);
  return matches.length ? matches.map(formatStatLine).join("; ") : "";
}

function downloadCsv(players, filename) {
  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["Name", "Position", "College", "Total Stats", "PFF Snaps", "PFF Link"].map(escape).join(",")];
  players.forEach((p) => {
    lines.push([p.name, p.position, p.college, statsText(p) || "Not found this season", p.pffSnaps, p.pffLink].map(escape).join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Read-only: this player's season-total stat line(s) looked up live against the Pre-Portal Tracker's
// own data, by name (see transferStats.js) -- nothing here is ever saved, so it updates on its own every
// time that data refreshes, with no "edit" affordance at all.
function StatsCell({ p, statsReady }) {
  if (!statsReady) return <Loader2 size={13} className="spin" style={{ color: "var(--text-faint)" }} />;
  const matches = findTransferStats(p.name, p.college, p.position);
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

export default function TransferOutTracker({ admin, meta }) {
  const tracker = useTransferOutTracker();
  const statsReady = useRealStatsReady();
  const fileInput = useRef(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
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
          {admin && (
            <>
              <button onClick={() => tracker.addPlayer()} style={ghostBtn}><Plus size={14} /> Add player</button>
              <button onClick={() => fileInput.current?.click()} disabled={importing} style={{ ...ghostBtn, opacity: importing ? 0.6 : 1 }}>
                <Upload size={14} /> {importing ? "Importing…" : "Import from Excel"}
              </button>
              <input ref={fileInput} type="file" accept=".xlsx,.xls" onChange={handleFile} style={{ display: "none" }} />
            </>
          )}
          <button onClick={() => downloadCsv(tracker.players, "transfer-out-tracker.csv")} style={ghostBtn}><Download size={14} /> Download</button>
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
                {admin && <th style={th}> </th>}
              </tr>
            </thead>
            <tbody>
              {tracker.players.length === 0 && (
                <tr>
                  <td colSpan={6 + (admin ? 1 : 0)} style={{ ...td, textAlign: "center", color: "var(--text-faint)", padding: 32 }}>
                    No one added yet.
                  </td>
                </tr>
              )}
              {tracker.players.map((p, i) => (
                <tr key={p.id} style={{ background: i % 2 === 0 ? "var(--bg-panel)" : "var(--bg-page)" }}>
                  <td style={{ ...td, fontWeight: 700, color: "var(--text-primary)" }}>
                    <TextCell row={p} field="name" placeholder="Player name" editable={admin} onSave={(v) => tracker.updatePlayer(p.id, { name: v })} />
                  </td>
                  <td style={td}>
                    <TextCell row={p} field="position" placeholder="Pos" editable={admin} onSave={(v) => tracker.updatePlayer(p.id, { position: v })} />
                  </td>
                  <td style={td}>
                    <TextCell row={p} field="college" placeholder="College" editable={admin} onSave={(v) => tracker.updatePlayer(p.id, { college: v })} />
                  </td>
                  <td style={{ ...td, minWidth: 220 }}>
                    <StatsCell p={p} statsReady={statsReady} />
                  </td>
                  <td style={td}>
                    <TextCell row={p} field="pffSnaps" placeholder="Snaps" editable={admin} onSave={(v) => tracker.updatePlayer(p.id, { pffSnaps: v })} />
                  </td>
                  <td style={td}>
                    <LinkCell row={p} field="pffLink" label="PFF" placeholder="Paste a PFF link…" editable={admin} onSave={(url) => tracker.updatePlayer(p.id, { pffLink: url })} />
                  </td>
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
