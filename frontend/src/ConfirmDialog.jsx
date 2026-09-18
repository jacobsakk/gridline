import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";

// A single app-wide "are you sure?" box. Any screen calls
// confirmAction({...}) and awaits true/false; <ConfirmHost /> (mounted
// once in App) draws it. Kept out of window.confirm because that's a
// browser-styled popup that some browsers suppress and that ignores the
// site's theme.
let openDialog = null;

export function confirmAction({ title, message, confirmLabel = "Remove" }) {
  if (!openDialog) return Promise.resolve(window.confirm(message || title));
  return new Promise((resolve) => openDialog({ title, message, confirmLabel, resolve }));
}

function savedTheme() {
  try {
    return window.localStorage.getItem("gridline-theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function ConfirmHost() {
  const [req, setReq] = useState(null);
  const cancelRef = useRef(null);

  useEffect(() => {
    openDialog = (r) => setReq(r);
    return () => {
      openDialog = null;
    };
  }, []);

  useEffect(() => {
    if (req) cancelRef.current?.focus();
  }, [req]);

  if (!req) return null;

  function close(answer) {
    req.resolve(answer);
    setReq(null);
  }

  return (
    // The dialog sits outside every screen's themed wrapper, so it carries
    // its own (the saved theme) or the light palette wouldn't apply.
    <div
      className="app-shell"
      data-theme={savedTheme()}
      onClick={() => close(false)}
      onKeyDown={(e) => e.key === "Escape" && close(false)}
      style={{
        position: "fixed", inset: 0, height: "auto", zIndex: 100, background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
        fontFamily: "'Century Gothic', 'Jost', 'Helvetica Neue', Arial, sans-serif",
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative", overflow: "hidden", background: "var(--bg-panel)", border: "1px solid var(--border)",
          borderRadius: 10, width: 420, maxWidth: "100%", padding: "28px 24px 22px", color: "var(--text-primary)",
          boxShadow: "0 18px 48px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 4, background: "linear-gradient(90deg, var(--gold), var(--maroon))" }} />
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
          <div
            style={{
              flexShrink: 0, width: 44, height: 44, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center",
              background: "var(--accent-bg)", border: "1px solid var(--accent)", color: "var(--accent)",
            }}
          >
            <Trash2 size={19} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h2 id="confirm-title" className="oswald" style={{ fontSize: 19, margin: 0, fontWeight: 700 }}>{req.title}</h2>
            {req.message && <p style={{ fontSize: 13.5, color: "var(--text-muted)", margin: "8px 0 0", lineHeight: 1.55 }}>{req.message}</p>}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, marginTop: 24 }}>
          <button
            ref={cancelRef}
            onClick={() => close(false)}
            style={{
              background: "transparent", border: "1px solid var(--border)", color: "var(--text-primary)",
              borderRadius: 6, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            Keep
          </button>
          <button
            onClick={() => close(true)}
            style={{
              background: "var(--maroon)", border: "1px solid var(--gold)", color: "var(--gold)",
              borderRadius: 6, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            {req.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
