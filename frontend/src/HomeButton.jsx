import { ArrowLeft } from "lucide-react";
import cmuHelmet from "./assets/cmu-helmet.png";

// The helmet in every screen's header is the way back to the home dashboard. It pops out on hover, the way the
// dashboard's cards and icons do.
export function HomeButton({ onHome }) {
  const helmet = <img src={cmuHelmet} alt="Central Michigan Chippewas helmet" style={{ height: 34, width: "auto", flexShrink: 0, display: "block" }} />;
  if (!onHome) return helmet;
  return (
    <button className="home-helmet" onClick={onHome} title="Home dashboard" aria-label="Home dashboard" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", lineHeight: 0, flexShrink: 0 }}>
      {helmet}
    </button>
  );
}

// Only shown when there is somewhere to go back to (a screen you followed a link from, or a team inside Colleges).
export function BackButton({ label, onClick }) {
  return (
    <button
      onClick={onClick}
      title={`Back to ${label}`}
      style={{
        display: "flex", alignItems: "center", gap: 6, flexShrink: 0, background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)",
        borderRadius: 5, padding: "8px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
      }}
    >
      <ArrowLeft size={15} /> {label}
    </button>
  );
}
