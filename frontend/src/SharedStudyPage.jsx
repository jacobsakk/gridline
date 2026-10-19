import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { Loader2 } from "lucide-react";
import { db } from "./firebase";
import { ThemeSwitcher, useTheme } from "./theme.jsx";
import { ALL_STUDIES, StudyDetail } from "./StudiesPage.jsx";

// What a share link opens (#/shared/<code>): one study, read-only, with no sign-in -- and nothing else from the
// site reachable from it. It reads the saved copy a coach's link points at and follows it live, so a copy that
// is refreshed while this page is open updates in front of the viewer.
export default function SharedStudyPage({ token }) {
  const [theme, setTheme] = useTheme();
  const [share, setShare] = useState(undefined); // undefined = loading, null = no such link
  useEffect(() => {
    if (!token) {
      setShare(null);
      return undefined;
    }
    return onSnapshot(
      doc(db, "studyShares", token),
      (snap) => {
        if (!snap.exists()) return setShare(null);
        const d = snap.data();
        try {
          setShare({ studyId: d.studyId, title: d.title, updatedAt: d.updatedAt, data: JSON.parse(d.payload) });
        } catch {
          setShare(null);
        }
      },
      () => setShare(null)
    );
  }, [token]);

  const meta = share ? ALL_STUDIES.find((s) => s.id === share.studyId) : null;
  return (
    <div className="app-shell hs-shell" data-theme={theme} style={{ display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg-page)", color: "var(--text-primary)", fontFamily: "'Century Gothic', 'Jost', 'Helvetica Neue', Arial, sans-serif" }}>
      <div className="app-header" style={{ flexShrink: 0, position: "relative", padding: "20px var(--gutter) 16px" }}>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 3, background: "linear-gradient(90deg, var(--gold), var(--maroon))" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <h1 className="oswald app-title" style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Central Michigan Recruiting</h1>
            {share && <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Shared view · updated {new Date(share.updatedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>}
          </div>
          <ThemeSwitcher theme={theme} onChange={setTheme} />
        </div>
      </div>
      {share === undefined ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <Loader2 size={16} className="spin" /> Loading…
        </div>
      ) : !share || !meta ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>This link isn't active. Ask whoever sent it for a new one.</div>
      ) : meta.detail ? (
        <meta.detail canEdit={false} meta={meta} snapshot={share.data} />
      ) : (
        <StudyDetail studyId={share.studyId} canEdit={false} snapshot={share.data} shareToken={token} />
      )}
    </div>
  );
}
