import { useEffect, useMemo, useRef, useState } from "react";
import { FilePlus2, ImagePlus, Loader2, Plus, Printer, Trash2 } from "lucide-react";
import { BackButton, HomeButton } from "./HomeButton.jsx";
import { ThemeSwitcher, useTheme } from "./theme.jsx";
import { confirmAction } from "./ConfirmDialog.jsx";
import { initialSubRoute, setSubRoute, useBack } from "./route.js";
import { control } from "./EditableCells.jsx";
import { isoDate, readEvaluationPicture, rowKey, shortDate, summarize, useReports } from "./reportsData.js";

const ghostBtn = { ...control, cursor: "pointer", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" };
const primaryBtn = { ...ghostBtn, background: "var(--accent-bg)", border: "1px solid var(--accent)", color: "var(--accent)", fontWeight: 700 };

// A cell the reader wasn't sure of: outlined until it has been edited.
const FLAGGED = { border: "1.5px solid #e0a030", background: "rgba(224,160,48,0.14)" };

const todayTitle = () => `Evaluations — ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;

// A cell you type into; it saves when you click away.
function Cell({ value, onSave, width, align, upper, flag }) {
  const [text, setText] = useState(value ?? "");
  useEffect(() => setText(value ?? ""), [value]);
  return (
    <>
    <span className="rp-print-only">{value}</span>
    <input
      className="rp-input"
      value={text}
      onChange={(e) => setText(upper ? e.target.value.toUpperCase() : e.target.value)}
      onBlur={() => text !== (value ?? "") && onSave(text.trim())}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      style={{ ...control, width: width || "100%", minWidth: 0, padding: "6px 8px", fontSize: 13.5, textAlign: align, ...(flag ? FLAGGED : null) }}
    />
    </>
  );
}

// A date you pick from a calendar box; on paper it reads as plain M/D/YYYY.
function DateCell({ value, onSave, flag }) {
  return (
    <>
      <span className="rp-print-only">{shortDate(value)}</span>
      <input
        className="rp-input"
        type="date"
        value={isoDate(value)}
        onChange={(e) => onSave(e.target.value)}
        style={{ ...control, width: "100%", minWidth: 136, padding: "6px 8px", fontSize: 13.5, ...(flag ? FLAGGED : null) }}
      />
    </>
  );
}

export default function ReportsPage({ onBack: toDashboard, session }) {
  const [theme, setTheme] = useTheme();
  const back = useBack(toDashboard);
  const store = useReports();
  const [openId, setOpenId] = useState(() => initialSubRoute()[0] || "");
  const [coach, setCoach] = useState("All");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [thumbs, setThumbs] = useState({}); // what each flagged prospect looked like in the picture (this visit only)
  const [onlyCheck, setOnlyCheck] = useState(false);
  const [sort, setSort] = useState(null); // { key, dir } -- null is the usual order (by position, then name)
  const [smallPicture, setSmallPicture] = useState(false);
  const [printList, setPrintList] = useState(false); // the prospect list only goes on paper when this is ticked
  const fileInput = useRef(null);
  const target = useRef(""); // the report the next picture goes to
  const by = session?.profile?.email || "";

  const report = store.reports.find((r) => r.id === openId) || (store.ready ? store.reports[0] : null);
  useEffect(() => {
    if (report) setSubRoute("reports", [report.id]);
  }, [report?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => report?.rows || [], [report]);
  const coaches = useMemo(() => ["All", ...new Set(rows.map((r) => r.coach).filter(Boolean))], [rows]);
  const shown = useMemo(() => rows.map((r, i) => ({ ...r, i })).filter((r) => coach === "All" || r.coach === coach), [rows, coach]);
  const totals = useMemo(() => summarize(shown), [shown]);
  const toCheck = useMemo(() => shown.filter((r) => r.flags?.length).length, [shown]);
  const detail = useMemo(() => {
    const list = [...shown].filter((r) => !onlyCheck || r.flags?.length);
    const usual = (x, y) => (x.position || "").localeCompare(y.position || "") || x.name.localeCompare(y.name);
    if (!sort) return list.sort(usual);
    const value = (r) =>
      sort.key === "assigned" || sort.key === "completed" ? isoDate(r[sort.key]) : sort.key === "complete" ? (r.complete ? 1 : 0) : String(r[sort.key] ?? "").toLowerCase();
    const dir = sort.dir === "asc" ? 1 : -1;
    return list.sort((x, y) => {
      const a = value(x);
      const b = value(y);
      // Rows with no date sort last whichever way the dates run.
      if ((a === "" || a == null) !== (b === "" || b == null)) return a === "" || a == null ? 1 : -1;
      return (a < b ? -1 : a > b ? 1 : 0) * dir || usual(x, y);
    });
  }, [shown, onlyCheck, sort]);

  function pickPicture(forId) {
    target.current = forId;
    setError("");
    fileInput.current?.click();
  }

  async function newReport() {
    setError("");
    try {
      const id = await store.create(todayTitle(), [], by);
      setOpenId(id);
      pickPicture(id);
    } catch (err) {
      setError(err?.code === "permission-denied" ? "Reports aren't switched on yet -- the new Firestore rule needs publishing." : err?.message || "Couldn't start a report.");
    }
  }

  async function handleFiles(e) {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    if (!files.length || !target.current) return;
    const id = target.current;
    setBusy(true);
    setError("");
    try {
      let merged = (store.reports.find((r) => r.id === id)?.rows || []).slice();
      let added = 0;
      let found = 0;
      setSmallPicture(false);
      for (let n = 0; n < files.length; n++) {
        setStatus(`Reading picture ${n + 1} of ${files.length}… (the first time takes a little longer)`);
        const read = await readEvaluationPicture(files[n], (s) => setStatus(s));
        if (read.small) setSmallPicture(true);
        found += read.length;
        const have = new Set(merged.map(rowKey));
        const pics = {};
        read.forEach(({ thumb, ...r }) => {
          if (!have.has(rowKey(r))) {
            merged.push(r);
            have.add(rowKey(r));
            if (thumb) pics[r.uid] = thumb;
            added += 1;
          }
        });
        setThumbs((t) => ({ ...t, ...pics }));
      }
      await store.save(id, { rows: merged });
      setOpenId(id);
      setStatus(found ? `Found ${found} prospect${found === 1 ? "" : "s"}; ${added} added${found - added ? ` (${found - added} already in the report)` : ""}. Check the list below -- small print can be misread.` : "");
      if (!found) setError("No prospects were found in that picture. Use a screenshot of the evaluation list with its column headings.");
    } catch (err) {
      setError(err?.message || "Couldn't read that picture.");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  const saveRows = (next) => store.save(report.id, { rows: next });
  const editRow = (i, patch) =>
    saveRows(rows.map((r, k) => (k === i ? { ...r, ...patch, flags: (r.flags || []).filter((f) => !(f in patch) && !(f === "completed" && "complete" in patch)) } : r)));
  const removeRow = (i) => saveRows(rows.filter((_, k) => k !== i));
  const addRow = () => saveRows([...rows, { name: "New prospect", school: "", classYear: "", position: "", evalType: "", assigned: "", completed: "", complete: false, coach: coach === "All" ? "" : coach }]);

  async function deleteReport() {
    const ok = await confirmAction({ title: `Delete "${report.title}"?`, message: "This removes the whole report and every row in it." });
    if (!ok) return;
    await store.remove(report.id);
    setOpenId("");
  }

  const th = { textAlign: "left", padding: "8px 8px", fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.03em", whiteSpace: "nowrap", background: "var(--bg-surface)" };
  const td = { padding: "5px 6px", borderTop: "1px solid var(--border-subtle)", fontSize: 13, verticalAlign: "middle" };

  return (
    <div className="app-shell hs-shell rp-print" data-theme={theme} style={{ display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg-page)", color: "var(--text-primary)", fontFamily: "'Century Gothic', 'Jost', 'Helvetica Neue', Arial, sans-serif" }}>
      <div className="app-header compact-header hs-no-print" style={{ flexShrink: 0, position: "relative", padding: "20px var(--gutter) 16px" }}>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 3, background: "linear-gradient(90deg, var(--gold), var(--maroon))" }} />
        <div className="compact-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {back.fromTrail && <BackButton label={back.label} onClick={back.go} />}
            <HomeButton onHome={toDashboard} />
            <h1 className="oswald app-title" style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Reports</h1>
          </div>
          <ThemeSwitcher theme={theme} onChange={setTheme} />
        </div>
      </div>

      <div className="hs-scroll" style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "20px var(--gutter) 40px" }}>
        <input ref={fileInput} type="file" accept="image/*" multiple onChange={handleFiles} style={{ display: "none" }} />

        <div className="hs-no-print" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          {store.reports.length > 0 && (
            <select aria-label="Report" value={report?.id || ""} onChange={(e) => { setOpenId(e.target.value); setCoach("All"); }} style={{ ...control, minWidth: 220 }}>
              {store.reports.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
          )}
          <button onClick={newReport} disabled={busy} style={primaryBtn}><FilePlus2 size={15} /> New report from a picture</button>
          {report && <button onClick={() => pickPicture(report.id)} disabled={busy} style={ghostBtn}><ImagePlus size={15} /> Add another picture</button>}
          {report && <button onClick={() => window.print()} style={ghostBtn}><Printer size={15} /> Print</button>}
          {report && (
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-muted)", cursor: "pointer" }}>
              <input type="checkbox" checked={printList} onChange={(e) => setPrintList(e.target.checked)} /> Include the prospect list when printing
            </label>
          )}
          {report && <button onClick={deleteReport} style={{ ...ghostBtn, color: "var(--danger, #c0392b)" }}><Trash2 size={15} /> Delete</button>}
        </div>
        {busy && <div className="hs-no-print" style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 13, marginBottom: 12 }}><Loader2 size={15} className="spin" /> {status}</div>}
        {!busy && status && <div className="hs-no-print" style={{ color: "var(--success)", fontSize: 13, marginBottom: 12 }}>{status}</div>}
        {smallPicture && <div className="hs-no-print" style={{ color: "#e0a030", fontSize: 13, marginBottom: 12 }}>That picture is small, so print may be misread. A larger screenshot (zoom the page in, or capture the full-size window) reads much better.</div>}
        {error && <div className="hs-no-print" style={{ color: "var(--danger, #c0392b)", fontSize: 13, marginBottom: 12 }}>{error}</div>}

        {!store.ready ? (
          <div style={{ color: "var(--text-faint)", padding: 30 }}>Loading…</div>
        ) : !report ? (
          <div style={{ border: "1px dashed var(--border)", borderRadius: 12, padding: "40px 24px", textAlign: "center", color: "var(--text-muted)", maxWidth: 640 }}>
            <div className="oswald" style={{ fontSize: 18, color: "var(--text-primary)", marginBottom: 8 }}>No reports yet</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
              Upload a screenshot of the evaluation list (the one with Prospect, Status, Assigned and Completed). It's read into a list of prospects and totalled by position: how many were assigned, how many are done. Add more pictures to the same report if the list is longer than one screen.
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 22, maxWidth: 1180 }}>
            <div>
              <div className="hs-no-print" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                <Cell value={report.title} onSave={(v) => v && store.save(report.id, { title: v })} width={340} />
                {coaches.length > 2 && (
                  <select aria-label="Coach" value={coach} onChange={(e) => setCoach(e.target.value)} style={control}>
                    {coaches.map((c) => <option key={c} value={c}>{c === "All" ? "All coaches" : c}</option>)}
                  </select>
                )}
              </div>
              <h2 className="oswald rp-print-title" style={{ margin: "0 0 2px", fontSize: 22 }}>{report.title}{coach !== "All" ? ` — ${coach}` : ""}</h2>
              <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>Evaluations assigned and completed, by position</div>
            </div>

            <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>{["Position", "Assigned", "Completed", "Outstanding", "% complete"].map((h, k) => <th key={h} style={{ ...th, textAlign: k ? "right" : "left", padding: "9px 12px" }}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {totals.length === 1 && <tr><td colSpan={5} style={{ ...td, textAlign: "center", color: "var(--text-faint)", padding: 24 }}>No prospects in this report yet.</td></tr>}
                  {totals.map((t) => {
                    const isTotal = t.position === "Total";
                    return (
                      <tr key={t.position} style={isTotal ? { background: "var(--bg-surface)", fontWeight: 800 } : undefined}>
                        <td style={{ ...td, padding: "9px 12px", fontWeight: 700, color: isTotal ? "var(--text-primary)" : "var(--accent)" }} className="oswald">{t.position}</td>
                        <td className="tabular" style={{ ...td, padding: "9px 12px", textAlign: "right", fontSize: 15, color: "var(--text-primary)" }}>{t.assigned}</td>
                        <td className="tabular" style={{ ...td, padding: "9px 12px", textAlign: "right", fontSize: 15, color: "var(--success)" }}>{t.completed}</td>
                        <td className="tabular" style={{ ...td, padding: "9px 12px", textAlign: "right", fontSize: 15, color: t.outstanding ? "var(--danger, #c0392b)" : "var(--text-faint)" }}>{t.outstanding}</td>
                        <td style={{ ...td, padding: "9px 12px", textAlign: "right", minWidth: 150 }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                            <span className="rp-bar" style={{ width: 70, height: 8, borderRadius: 4, background: "var(--bg-surface)", border: "1px solid var(--border)", overflow: "hidden", display: "inline-block" }}>
                              <span style={{ display: "block", width: `${t.pct}%`, height: "100%", background: "var(--success)" }} />
                            </span>
                            <span className="tabular" style={{ width: 38, textAlign: "right", color: "var(--text-primary)" }}>{t.pct}%</span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className={printList ? undefined : "hs-no-print"}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div className="oswald" style={{ fontSize: 16, fontWeight: 700 }}>The prospects ({shown.length})</div>
                {toCheck > 0 && (
                  <button className="hs-no-print" onClick={() => setOnlyCheck((v) => !v)} style={{ ...ghostBtn, borderColor: "#e0a030", color: "#e0a030" }}>
                    {toCheck} to check · {onlyCheck ? "show everyone" : "show only these"}
                  </button>
                )}
                <button className="hs-no-print" onClick={addRow} style={ghostBtn}><Plus size={14} /> Add a prospect</button>
              </div>
              <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "auto" }}>
                <table style={{ width: "100%", minWidth: 940, borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {[["Prospect", "name"], ["School", "school"], ["Class", "classYear"], ["Pos", "position"], ["Assigned", "assigned"], ["Completed", "completed"], ["Done", "complete"], ["", null]].map(([h, key], k) => (
                        <th
                          key={k}
                          className={k === 7 ? "hs-no-print" : undefined}
                          aria-sort={key && sort?.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                          onClick={key ? () => setSort((cur) => (cur?.key === key ? (cur.dir === "asc" ? { key, dir: "desc" } : null) : { key, dir: key === "assigned" || key === "completed" ? "desc" : "asc" })) : undefined}
                          title={key ? "Click to sort, again to reverse, a third time for the usual order" : undefined}
                          style={{ ...th, cursor: key ? "pointer" : undefined, userSelect: "none" }}
                        >
                          {h}{key && sort?.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detail.map((r) => (
                      <tr key={`${r.i}-${r.name}`}>
                        <td style={{ ...td, minWidth: 230 }}>
                          <Cell value={r.name} flag={r.flags?.includes("name")} onSave={(v) => editRow(r.i, { name: v })} />
                          {r.flags?.length > 0 && thumbs[r.uid] && (
                            <img className="hs-no-print" src={thumbs[r.uid]} alt="How this prospect looked in the picture" title="As it looked in the picture" style={{ display: "block", marginTop: 6, maxWidth: 230, borderRadius: 4, border: "1px solid var(--border)", background: "#fff" }} />
                          )}
                        </td>
                        <td style={{ ...td, minWidth: 250 }}><Cell value={r.school} flag={r.flags?.includes("school")} onSave={(v) => editRow(r.i, { school: v })} /></td>
                        <td style={{ ...td, width: 76 }}><Cell value={r.classYear} onSave={(v) => editRow(r.i, { classYear: v })} /></td>
                        <td style={{ ...td, width: 76 }}><Cell value={r.position} upper flag={r.flags?.includes("position")} onSave={(v) => editRow(r.i, { position: v })} /></td>
                        <td style={{ ...td, minWidth: 150 }}><DateCell value={r.assigned} flag={r.flags?.includes("assigned")} onSave={(v) => editRow(r.i, { assigned: v })} /></td>
                        <td style={{ ...td, minWidth: 150 }}><DateCell value={r.completed} flag={r.flags?.includes("completed")} onSave={(v) => editRow(r.i, { completed: v, complete: !!v })} /></td>
                        <td style={{ ...td, textAlign: "center" }}>
                          <input className="rp-done-box" type="checkbox" checked={!!r.complete} onChange={(e) => editRow(r.i, { complete: e.target.checked })} aria-label={`${r.name} completed`} style={{ cursor: "pointer" }} />
                          <span className="rp-print-only">{r.complete ? "✓" : ""}</span>
                        </td>
                        <td className="hs-no-print" style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                          {r.flags?.length > 0 && (
                            <button onClick={() => editRow(r.i, Object.fromEntries(r.flags.map((f) => [f, r[f]])))} title="It's right as it is -- stop highlighting this one" style={{ background: "none", border: "1px solid #e0a030", color: "#e0a030", borderRadius: 4, fontSize: 11.5, padding: "2px 7px", marginRight: 6, cursor: "pointer", fontFamily: "inherit" }}>
                              Looks right
                            </button>
                          )}
                          <button onClick={() => removeRow(r.i)} aria-label={`Remove ${r.name}`} style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", lineHeight: 0 }}><Trash2 size={14} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
