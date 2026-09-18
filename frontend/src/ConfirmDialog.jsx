import { useEffect, useRef, useState } from "react";

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
          background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, width: 400, maxWidth: "100%",
          padding: 22, color: "var(--text-primary)", boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
        }}
      >
        <h2 id="confirm-title" className="oswald" style={{ fontSize: 18, margin: 0, fontWeight: 700 }}>{req.title}</h2>
        {req.message && <p style={{ fontSize: 13.5, color: "var(--text-muted)", margin: "10px 0 0", lineHeight: 1.5 }}>{req.message}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
          <button
            ref={cancelRef}
            onClick={() => close(false)}
            style={{
              background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)",
              borderRadius: 5, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => close(true)}
            style={{
              background: "var(--danger)", border: "1px solid var(--danger)", color: "#fff",
              borderRadius: 5, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            {req.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
