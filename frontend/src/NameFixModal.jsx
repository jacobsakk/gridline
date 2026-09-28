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

// Fix misspelled recruit names and school names on every team's sheet. The source sheets carry garbles (an E read as L:
// Dlmond for Demond, T read as L: Scolt for Scott), and the same recruit can be spelled two ways. A corrected name keeps
// its old spelling as an alias, so uploading the same workbook again doesn't bring the bad one back.
export default function NameFixModal({ tracker, classYear, onClose }) {
  const [tab, setTab] = useState("suggested");
  const [done, setDone] = useState(() => new Set());
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  // replace a word
  const [word, setWord] = useState("");
  const [replacement, setReplacement] = useState("");
  const [inNames, setInNames] = useState(true);
  const [inSchools, setInSchools] = useState(true);
  // merge or rename -- check two or more profiles on the left, then pick which of those is the right name
  const [mergeSearch, setMergeSearch] = useState("");
  const [checked, setChecked] = useState(() => new Set());
  const [keepName, setKeepName] = useState("");

  const suggestions = useMemo(() => tracker.suggestFixes(), [tracker]);
  const open = suggestions.filter((s) => !done.has(s.from));
  const names = useMemo(() => tracker.profileNames(classYear), [tracker, classYear]);
  const q = mergeSearch.trim().toLowerCase();
  const filteredNames = q ? names.filter((n) => n.toLowerCase().includes(q)) : names;
  const checkedNames = names.filter((n) => checked.has(n));
  function toggleChecked(n) {
    setChecked((set) => {
      const next = new Set(set);
      next.has(n) ? next.delete(n) : next.add(n);
      if (!next.has(keepName)) setKeepName(next.size ? [...next][0] : "");
      return next;
    });
  }

  const preview = tracker.wordReplacementPreview(word, { names: inNames, schools: inSchools });

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

  const applyReplace = () =>
    guard("replace", async () => {
      const r = await tracker.replaceWord(word, replacement, { names: inNames, schools: inSchools });
      setMessage(`${word.trim().toUpperCase()} → ${replacement.trim().toUpperCase()}: ${plural(r.rows, "row", "rows")} updated.`);
      setWord("");
      setReplacement("");
    });

  const applyMerge = () =>
    guard("merge", async () => {
      const r = await tracker.mergeProfiles(classYear, checkedNames, keepName);
      setMessage(`${toTitleCase(r.canonical)}: ${r.merged ? plural(r.merged, "duplicate row", "duplicate rows") + " combined" : ""}${r.merged && r.renamed ? ", " : ""}${r.renamed ? plural(r.renamed, "row", "rows") + " renamed" : ""}.`);
      setChecked(new Set());
      setKeepName("");
      setMergeSearch("");
    });

  const tabBtn = (id, label) => (
    <button
      onClick={() => setTab(id)}
      style={{ border: "none", borderRadius: 6, padding: "7px 14px", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", background: tab === id ? "var(--accent)" : "transparent", color: tab === id ? "var(--bg-page)" : "var(--text-muted)" }}
    >
      {label}
    </button>
  );

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 70 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 10, width: 860, maxWidth: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h2 className="oswald" style={{ margin: 0, fontSize: 19 }}>Fix names</h2>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", lineHeight: 0 }}><X size={18} /></button>
        </div>
        <div style={{ display: "flex", gap: 4, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 3, alignSelf: "flex-start", marginBottom: 10, flexWrap: "wrap" }}>
          {tabBtn("suggested", `Suggested fixes (${open.length})`)}
          {tabBtn("word", "Replace a word")}
          {tabBtn("merge", "Merge or rename a profile")}
        </div>
        {message && <div role="status" style={{ marginBottom: 10, fontSize: 13, color: "var(--success)" }}>{message}</div>}

        {tab === "suggested" && (
          <>
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
          </>
        )}

        {tab === "word" && (
          <>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
              For anything the suggestions miss, like a T read as an L (Scolt for Scott). Replaces that whole word wherever it appears, on every team's sheet.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
              <label style={{ flex: "1 1 200px", fontSize: 12.5, color: "var(--text-muted)" }}>
                Replace this word
                <input id="fix-word" value={word} onChange={(e) => setWord(e.target.value)} placeholder="e.g. Scolt" style={{ ...field, marginTop: 5 }} />
              </label>
              <label style={{ flex: "1 1 200px", fontSize: 12.5, color: "var(--text-muted)" }}>
                With
                <input id="fix-replacement" value={replacement} onChange={(e) => setReplacement(e.target.value)} placeholder="e.g. Scott" style={{ ...field, marginTop: 5 }} />
              </label>
            </div>
            <div style={{ display: "flex", gap: 18, fontSize: 13, marginBottom: 10 }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}><input type="checkbox" checked={inNames} onChange={(e) => setInNames(e.target.checked)} /> In recruit names</label>
              <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}><input type="checkbox" checked={inSchools} onChange={(e) => setInSchools(e.target.checked)} /> In high schools</label>
            </div>
            {word.trim() && (
              <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.6 }}>
                {preview.rows
                  ? <>Would change <strong style={{ color: "var(--text-primary)" }}>{plural(preview.rows, "row", "rows")}</strong>
                      {preview.names.length ? <> — names: {preview.names.slice(0, 4).map(toTitleCase).join(", ")}{preview.names.length > 4 ? "…" : ""}</> : null}
                      {preview.schools.length ? <> — schools: {preview.schools.slice(0, 3).map(toTitleCase).join(", ")}{preview.schools.length > 3 ? "…" : ""}</> : null}</>
                  : "No rows contain that word."}
              </div>
            )}
            <div>
              <button disabled={!preview.rows || !replacement.trim() || busy === "replace"} onClick={applyReplace} style={{ ...primary, padding: "9px 18px", opacity: !preview.rows || !replacement.trim() ? 0.5 : 1 }}>
                {busy === "replace" ? "Saving…" : "Replace everywhere"}
              </button>
            </div>
          </>
        )}

        {tab === "merge" && (
          <>
            <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
              Check two or more profiles on the left that are really the same recruit, then pick which name is correct. Rows for the same team are combined; every row keeps its old name as an alias, so a re-uploaded sheet still lands on the right profile. Class of {classYear}.
            </p>
            <input
              value={mergeSearch}
              onChange={(e) => setMergeSearch(e.target.value)}
              placeholder="Search names…"
              style={{ ...field, marginBottom: 8 }}
            />
            <div style={{ border: "1px solid var(--border)", borderRadius: 8, maxHeight: 220, overflowY: "auto", marginBottom: 12 }}>
              {filteredNames.length === 0 ? (
                <div style={{ padding: 12, fontSize: 13, color: "var(--text-faint)" }}>No names match.</div>
              ) : (
                filteredNames.map((n) => {
                  const rows = tracker.rowsForPlayer(classYear, n);
                  return (
                    <label key={n} style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 12px", borderBottom: "1px solid var(--border-subtle)", cursor: "pointer", fontSize: 13.5 }}>
                      <input type="checkbox" checked={checked.has(n)} onChange={() => toggleChecked(n)} />
                      <span style={{ flex: 1, color: "var(--text-primary)" }}>{toTitleCase(n)}</span>
                      <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{plural(rows.length, "row", "rows")} · {plural(new Set(rows.map((r) => r.team)).size, "team", "teams")}</span>
                    </label>
                  );
                })
              )}
            </div>
            {checkedNames.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 6 }}>Which name is correct?</div>
                {checkedNames.map((n) => (
                  <label key={n} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 13.5, cursor: "pointer" }}>
                    <input type="radio" name="keep-name" checked={keepName === n} onChange={() => setKeepName(n)} />
                    {toTitleCase(n)}
                  </label>
                ))}
              </div>
            )}
            <div>
              <button disabled={checkedNames.length < 2 || !keepName || busy === "merge"} onClick={applyMerge} style={{ ...primary, padding: "9px 18px", opacity: checkedNames.length < 2 || !keepName ? 0.5 : 1 }}>
                {busy === "merge" ? "Saving…" : `Merge ${checkedNames.length || ""} profiles`.trim()}
              </button>
            </div>
          </>
        )}
        <div style={{ textAlign: "right", marginTop: 12 }}>
          <button onClick={onClose} style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 6, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Done</button>
        </div>
      </div>
    </div>
  );
}
