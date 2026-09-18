import { useState } from "react";
import { Settings, ClipboardList, ChevronRight, FileSpreadsheet, GraduationCap } from "lucide-react";
import { ThemeSwitcher, useTheme } from "./theme.jsx";
import actionCDark from "./assets/cmu-action-c-dark.png";
import anniversaryLogo from "./assets/anniversary-125.png";

// The main hub -- everything else (the Pre-Portal Tracker and Offer
// Tracker today, more tools later) is a card here rather than its own
// standalone page, so there's one consistent place to land and
// navigate from.
const CARDS = [
  {
    key: "tracker",
    label: "Pre-Portal Tracker",
    description: "Weekly stats across NAIA, JUCO, D3, D2, FCS and FBS",
    icon: ClipboardList,
  },
  {
    key: "offers",
    label: "Offer Tracker",
    description: "Offers by class year, conference and team, with position/area trends",
    icon: FileSpreadsheet,
  },
  {
    key: "colleges",
    label: "Colleges",
    description: "Every FBS and FCS team: standings, schedules, recruiting, rosters and depth charts",
    icon: GraduationCap,
  },
];

export default function Dashboard({ onOpenCard, onOpenSettings }) {
  const [theme, setTheme] = useTheme();
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
      <div className="app-header" style={{ flexShrink: 0, position: "relative", padding: "20px var(--gutter) 16px" }}>
        <div
          style={{
            position: "absolute", left: 0, right: 0, bottom: 0, height: 3,
            background: "linear-gradient(90deg, var(--gold), var(--maroon))",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <img src={actionCDark} alt="Central Michigan Action C" style={{ height: 36, width: "auto", flexShrink: 0 }} />
            <h1 className="oswald app-title" style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "0.01em" }}>
              Central Michigan Coach Hub
            </h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <img src={anniversaryLogo} alt="Central Michigan football 125th anniversary" style={{ height: 46, width: "auto", flexShrink: 0 }} />
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
            <ThemeSwitcher theme={theme} onChange={setTheme} />
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "24px var(--gutter) var(--gutter)" }}>
        <div style={{ maxWidth: 1100, width: "100%", margin: "0 auto" }}>
          <h2 className="oswald" style={{ fontSize: 26, fontWeight: 700, margin: "0 0 20px", letterSpacing: "0.01em" }}>
            Dashboard
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
            {CARDS.map(({ key, label, description, icon: Icon }, i) => (
              <button
                key={key}
                className="dashboard-card"
                onClick={() => onOpenCard(key, label)}
                style={{
                  animation: `card-rise 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) ${120 + i * 80}ms backwards`,
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
