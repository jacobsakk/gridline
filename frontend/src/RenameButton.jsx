import { useState } from "react";
import { Pencil } from "lucide-react";
import { renamePerson } from "./renamePerson.js";

// A small pencil beside a player's name: change what his name is, in the Offer Tracker and the Game Update
// tracker together (see renamePerson). Hidden when printing.
export default function RenameButton({ name, classYear, onRenamed, size = 13 }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const next = value.trim().replace(/\s+/g, " ");
    if (!next || next === name) return setOpen(false);
    setBusy(true);
    setError("");
    try {
      await renamePerson({ classYear, oldName: name, newName: next });
      setOpen(false);
      onRenamed?.(next);
    } catch (err) {
      setError(err?.code === "permission-denied" ? "No permission to change that." : err?.message || "Couldn't change the name.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        className="hs-no-print"
        onClick={(e) => {
          e.stopPropagation();
          setValue(name);
          setError("");
          setOpen(true);
        }}
        title="Edit this name"
        aria-label={`Edit the name ${name}`}
        style={{ marginLeft: 6, background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", lineHeight: 0, padding: 2, verticalAlign: "middle" }}
      >
        <Pencil size={size} />
      </button>
      {open && (
        <div onClick={(e) => { e.stopPropagation(); setOpen(false); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 90 }}>
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); save(); }}
            style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 10, width: 400, maxWidth: "100%", padding: 20, display: "grid", gap: 10, color: "var(--text-primary)" }}
          >
            <h2 className="oswald" style={{ margin: 0, fontSize: 18 }}>Edit name</h2>
            <input
              autoFocus
              aria-label="Player name"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 6, padding: "9px 10px", fontSize: 14, fontFamily: "inherit" }}
            />
            <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>Changes his name in the Offer Tracker and in Game Update, so the two stay the same person.</div>
            {error && <div style={{ fontSize: 12.5, color: "var(--danger, #c0392b)" }}>{error}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={() => setOpen(false)} style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 6, padding: "8px 14px", cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
              <button type="submit" disabled={busy} style={{ background: "var(--accent-bg)", border: "1px solid var(--accent)", color: "var(--accent)", borderRadius: 6, padding: "8px 16px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: busy ? 0.6 : 1 }}>{busy ? "Saving…" : "Save"}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
