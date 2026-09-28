import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { confirmAction } from "./ConfirmDialog.jsx";
import { toTitleCase } from "./OfferTracker.jsx";

const field = {
  background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 6,
  padding: "8px 11px", fontSize: 13, fontFamily: "inherit", width: "100%",
};
const primary = { background: "var(--accent-bg)", border: "1px solid var(--accent)", color: "var(--accent)", borderRadius: 6, padding: "7px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const quiet = { background: "none", border: "1px solid var(--border)", color: "var(--text-muted)", borderRadius: 6, padding: "7px 12px", fontSize: 13, cursor: "pointer" };

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Suggested spelling fixes: the source sheets carry garbles (an E read as L: Dlmond for Demond, T read as L:
// Scolt for Scott). A corrected name keeps its old spelling as an alias, so uploading the same workbook
// again doesn't bring the bad one back. Merging duplicate profiles by hand happens on the sheet itself now
// (check two or more names on the left, then Merge) -- see OfferTracker.jsx.
export default function NameFixModal({ tracker, onClose }) {
  const [done, setDone] = useState(() => new Set());
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const suggestions = useMemo(() => tracker.suggestFixes(), [tracker]);
  const open = suggestions.filter((s) => !done.has(s.from));

  async function guard(key, work) {
    setBusy(key);
    setMessage("");
    try {
      await work();
    } catch (err) {
      setMessage(err.message || "That didn't save. Try again.");
    }
    setBusy("");
  }

  const fixWord = (s) =>
    guard(s.from, async () => {
      const target = (edits[s.from] ?? s.to).trim();
      const r = await tracker.replaceWord(s.from, target, { names: s.names.length > 0, schools: s.schools.length > 0 });
      setMessage(`${toTitleCase(s.from)} → ${toTitleCase(target)}: ${plural(r.rows, "row", "rows")} updated.`);
      setDone((d) => new Set(d).add(s.from));
    });

  async function fixAll() {
    const ok = await confirmAction({
      title: `Fix ${open.length} words?`,
      message: "Each suggestion is applied as shown (edited spellings included) on every team's sheet. Skim the list first if you haven't.",
      confirmLabel: "Fix them all",
    });
    if (!ok) return;
    guard("all", async () => {
      let rows = 0;
      for (const s of open) {
        const r = await tracker.replaceWord(s.from, (edits[s.from] ?? s.to).trim(), { names: s.names.length > 0, schools: s.schools.length > 0 });
        rows += r.rows;
        setDone((d) => new Set(d).add(s.from));
      }
      setMessage(`Fixed ${plural(open.length, "word", "words")} (${plural(rows, "row", "rows")} updated).`);
    });
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 70 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 10, width: 860, maxWidth: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h2 className="oswald" style={{ margin: 0, fontSize: 19 }}>Suggested fixes</h2>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", lineHeight: 0 }}><X size={18} /></button>
        </div>
        {message && <div role="status" style={{ marginBottom: 10, fontSize: 13, color: "var(--success)" }}>{message}</div>}
        <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
          Words where an E looks to have turned into an L (Dlmond for Demond, Jaydln for Jayden, Acadlmy for Academy), in recruit names and high schools, across every team and class year. Edit any spelling that's not quite right before you fix it.
        </p>
        {open.length > 1 && (
          <div style={{ marginBottom: 8 }}>
            <button disabled={busy === "all"} onClick={fixAll} style={primary}>{busy === "all" ? "Fixing…" : `Fix all ${open.length}`}</button>
          </div>
        )}
        <div className="hs-scroll" style={{ overflow: "auto", border: "1px solid var(--border)", borderRadius: 8, minHeight: 0 }}>
          {open.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "var(--text-faint)" }}>No suspicious spellings left.</div>}
          {open.map((s) => (
            <div key={s.from} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 12px", borderBottom: "1px solid var(--border-subtle)" }}>
              <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: "var(--text-primary)" }}>{toTitleCase(s.from)}</div>
                <div style={{ fontSize: 12, color: "var(--text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {[s.names.length ? plural(s.names.length, "name", "names") : "", s.schools.length ? plural(s.schools.length, "school", "schools") : ""].filter(Boolean).join(" · ")}
                  {s.names.length ? ` — ${s.names.slice(0, 2).map(toTitleCase).join(", ")}${s.names.length > 2 ? "…" : ""}` : ""}
                </div>
              </div>
              <span style={{ color: "var(--text-faint)" }}>→</span>
              <input
                aria-label={`Correct spelling for ${toTitleCase(s.from)}`}
                value={edits[s.from] ?? toTitleCase(s.to)}
                onChange={(e) => setEdits((d) => ({ ...d, [s.from]: e.target.value }))}
                style={{ ...field, flex: "0 1 200px", width: "auto" }}
              />
              <button disabled={busy === s.from || busy === "all"} onClick={() => fixWord(s)} style={primary}>{busy === s.from ? "Saving…" : "Fix"}</button>
              <button onClick={() => setDone((d) => new Set(d).add(s.from))} style={quiet}>Skip</button>
            </div>
          ))}
        </div>
        <div style={{ textAlign: "right", marginTop: 12 }}>
          <button onClick={onClose} style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 6, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Done</button>
        </div>
      </div>
    </div>
  );
}
