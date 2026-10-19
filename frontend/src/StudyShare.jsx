import { useState } from "react";
import { Check, Copy, Link2, Trash2, X } from "lucide-react";
import { confirmAction } from "./ConfirmDialog.jsx";
import { control } from "./EditableCells.jsx";
import { createShare, removeShare, shareUrl, useShareSync, useStudyShares } from "./studyShares.js";

const ghostBtn = { ...control, cursor: "pointer", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 7 };

const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

// The "Share link" button in a study's header, with the window that makes, copies and turns off its links.
// `data` is the study as it stands right now (null while it's still loading); it is also what keeps every
// link's saved copy current while this study is open.
export function ShareLinkButton({ studyId, title, data, by }) {
  const shares = useStudyShares(studyId);
  useShareSync(shares, data);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  async function make() {
    setBusy(true);
    setError("");
    try {
      const token = await createShare({ studyId, title, data, by });
      await copy(token);
    } catch (err) {
      setError(err?.code === "permission-denied" ? "Sharing isn't switched on yet -- the new Firestore rule needs publishing." : err?.message || "Couldn't make the link.");
    } finally {
      setBusy(false);
    }
  }
  async function copy(token) {
    try {
      await navigator.clipboard.writeText(shareUrl(token));
      setCopied(token);
      setTimeout(() => setCopied((c) => (c === token ? "" : c)), 2000);
    } catch {
      /* the link is shown in the box either way */
    }
  }
  async function turnOff(token) {
    const ok = await confirmAction({ title: "Turn off this link?", message: "Anyone using it will see \"link not active\" straight away. This can't be undone -- a new link would have a new address." });
    if (ok) removeShare(token).catch(() => setError("Couldn't turn that off -- try again."));
  }

  return (
    <>
      <button onClick={() => setOpen(true)} style={ghostBtn} title="A link anyone can open without signing in, for this study only">
        <Link2 size={14} /> Share link{shares.length ? ` (${shares.length})` : ""}
      </button>
      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 70 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 10, width: 560, maxWidth: "100%", maxHeight: "90vh", overflow: "auto", padding: 22, display: "grid", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h2 className="oswald" style={{ margin: 0, fontSize: 19 }}>Share this study</h2>
              <button onClick={() => setOpen(false)} aria-label="Close" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", lineHeight: 0 }}><X size={20} /></button>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.55 }}>
              Anyone with a link can read <b>{title}</b> without signing in, and nothing else on the site. It's read-only, and it follows your edits: the shared copy refreshes a few seconds after you change something here, and whenever a coach opens the study after new stats arrive.
            </p>
            {shares.length === 0 && <div style={{ fontSize: 13, color: "var(--text-faint)" }}>No links yet.</div>}
            {shares.map((s) => (
              <div key={s.token} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10, display: "grid", gap: 8 }}>
                <input readOnly value={shareUrl(s.token)} onFocus={(e) => e.target.select()} aria-label="Share link" style={{ ...control, width: "100%", fontSize: 12.5 }} />
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={() => copy(s.token)} style={ghostBtn}>{copied === s.token ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy link</>}</button>
                  <button onClick={() => turnOff(s.token)} style={{ ...ghostBtn, color: "var(--danger, #c0392b)" }}><Trash2 size={14} /> Turn off</button>
                  <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-faint)" }}>Updated {when(s.updatedAt)}</span>
                </div>
              </div>
            ))}
            {error && <div style={{ fontSize: 12.5, color: "var(--danger, #c0392b)" }}>{error}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button onClick={make} disabled={busy || !data} style={{ ...ghostBtn, background: "var(--accent-bg)", borderColor: "var(--accent)", color: "var(--accent)", opacity: busy || !data ? 0.5 : 1 }}>
                <Link2 size={14} /> {busy ? "Making…" : data ? "Make a new link" : "Loading…"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
