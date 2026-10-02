import { useState } from "react";
import { ExternalLink, Link2 } from "lucide-react";

// Shared click-to-edit cells -- originally built for the Studies page, reused anywhere else in the app
// that needs the same "plain value, click to replace it" affordance instead of an always-open input
// sitting in the cell (the Pre-Portal Tracker's watch list used to do the latter for its link/hometown
// fields; this is what it was simplified to).
export const control = { background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 6, padding: "8px 11px", fontSize: 13, fontFamily: "inherit" };

// `field` is which key on `row` this cell reads/writes (e.g. "hudlLink", "xLink", "filmLink").
// `editable` gates whether clicking does anything -- false just renders the link (or a dash) plainly.
// `onSave` returns the write's promise -- awaited here so a rejected write shows a visible error
// instead of silently reverting to "Add link" with nothing saved.
export function LinkCell({ row, field, label, placeholder, editable, onSave }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(row[field] || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function commit(next) {
    if (next === (row[field] || "")) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(next);
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
        <div style={{ display: "flex", gap: 5 }}>
          <input
            autoFocus
            value={value}
            disabled={saving}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            style={{ ...control, padding: "4px 7px", fontSize: 12.5, width: 190, opacity: saving ? 0.6 : 1 }}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit(value.trim());
              if (e.key === "Escape") {
                setValue(row[field] || "");
                setError("");
                setEditing(false);
              }
            }}
            onBlur={() => commit(value.trim())}
          />
        </div>
        {error && <span style={{ fontSize: 11, color: "var(--danger, #c0392b)" }}>{error}</span>}
      </div>
    );
  }
  if (row[field]) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <a href={row[field]} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 4 }}>
          {label} <ExternalLink size={12} />
        </a>
        {editable && (
          <button onClick={() => setEditing(true)} title={`Change this ${label} link`} aria-label={`Change ${label} link for ${row.player}`} style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", lineHeight: 0 }}>
            <Link2 size={12} />
          </button>
        )}
      </span>
    );
  }
  return editable ? (
    <button onClick={() => setEditing(true)} style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", fontSize: 12.5, textDecoration: "underline", padding: 0 }}>
      Add link
    </button>
  ) : (
    <span style={{ color: "var(--text-faint)" }}>—</span>
  );
}

// Plain text, not a link -- click to edit, blank shows a faint dash for a non-editable view or an "Add"
// prompt otherwise. `field` defaults to "state" (the Studies page's own field name) but can be
// overridden -- the watch list uses "homeState" on its own docs.
export function StateCell({ row, field = "state", editable, onSave }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(row[field] || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function commit(next) {
    if (next === (row[field] || "")) {
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
          onChange={(e) => setValue(e.target.value.toUpperCase().slice(0, 20))}
          placeholder="e.g. OH"
          style={{ ...control, padding: "4px 7px", fontSize: 12.5, width: 60, opacity: saving ? 0.6 : 1 }}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(value.trim());
            if (e.key === "Escape") {
              setValue(row[field] || "");
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
  if (row[field]) {
    return (
      <span onClick={() => editable && setEditing(true)} title={editable ? "Click to change" : undefined} style={{ cursor: editable ? "pointer" : "default" }}>
        {row[field]}
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
