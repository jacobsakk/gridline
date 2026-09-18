import { useState } from "react";
import { Settings, Sun, Moon, ClipboardList, ChevronRight } from "lucide-react";
import cmuHelmet from "./assets/cmu-helmet.png";

// The main hub -- everything else (the Pre-Portal Tracker today, more
// tools later) is a card here rather than its own standalone page, so
// there's one consistent place to land and navigate from.
const CARDS = [
  {
    key: "tracker",
    label: "Pre-Portal Tracker",
    description: "Weekly stats across NAIA, JUCO, D3, D2, FCS and FBS",
    icon: ClipboardList,
  },
];

export default function Dashboard({ onOpenTracker, onOpenSettings }) {
  const [theme, setTheme] = useState(() => {
    const saved = typeof window !== "undefined" && window.localStorage.getItem("gridline-theme");
    return saved === "light" || saved === "dark" ? saved : "dark";
  });
  function toggleTheme() {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      window.localStorage.setItem("gridline-theme", next);
      return next;
    });
  }

  return (
    <div
      className="app-shell"
      data-theme={theme}
      style={{
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--bg-page)",
        color: "var(--text-primary)",
        fontFamily: "'Century Gothic', 'Jost', 'Helvetica Neue', Arial, sans-serif",
      }}
    >
      <div style={{ flexShrink: 0, position: "relative", padding: "20px var(--gutter) 16px" }}>
        <div
          style={{
            position: "absolute", left: 0, right: 0, bottom: 0, height: 3,
            background: "linear-gradient(90deg, var(--gold), var(--maroon))",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <img src={cmuHelmet} alt="Central Michigan Chippewas helmet" style={{ height: 34, width: "auto", flexShrink: 0 }} />
            <h1 className="oswald app-title" style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "0.01em" }}>
              Central Michigan Coach Hub
            </h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <button
              onClick={onOpenSettings}
              style={{
                display: "flex", alignItems: "center", gap: 7, flexShrink: 0,
                background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)",
                borderRadius: 5, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}
            >
              <Settings size={15} /> Settings
            </button>
            <button
              onClick={toggleTheme}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)",
                borderRadius: 5, width: 34, height: 34, cursor: "pointer",
              }}
            >
              {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "24px var(--gutter) var(--gutter)" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <h2 className="oswald" style={{ fontSize: 26, fontWeight: 700, margin: "0 0 20px", letterSpacing: "0.01em" }}>
            Dashboard
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
            {CARDS.map(({ key, label, description, icon: Icon }) => (
              <button
                key={key}
                className="dashboard-card"
                onClick={() => onOpenTracker()}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10,
                  background: "linear-gradient(135deg, var(--gold), #C9860E)",
                  border: "none", borderRadius: 10, padding: 20, cursor: "pointer", textAlign: "left",
                  color: "#1A1206", minHeight: 130,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                  <Icon className="dashboard-card-icon" size={22} />
                  <ChevronRight className="dashboard-card-arrow" size={18} />
                </div>
                <div>
                  <div className="oswald" style={{ fontSize: 16, fontWeight: 700, letterSpacing: "0.02em" }}>{label.toUpperCase()}</div>
                  <div style={{ fontSize: 12.5, opacity: 0.8, marginTop: 4 }}>{description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
