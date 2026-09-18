import { useCallback, useState } from "react";
import { Moon, Sun } from "lucide-react";

export const THEMES = [
  { key: "dark", label: "Dark" },
  { key: "light", label: "Light" },
];

const STORAGE_KEY = "gridline-theme";

export function readTheme() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return THEMES.some((t) => t.key === saved) ? saved : "dark";
  } catch {
    return "dark";
  }
}

// One shared choice for every screen (each screen mounts on its own, so the
// saved value is what carries the theme from one to the next).
export function useTheme() {
  const [theme, setThemeState] = useState(readTheme);
  const setTheme = useCallback((next) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable -- the choice just won't persist */
    }
  }, []);
  return [theme, setTheme];
}

export function ThemeSwitcher({ theme, onChange }) {
  const icon = (key) => (key === "dark" ? <Moon size={15} /> : <Sun size={15} />);
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      style={{ display: "flex", gap: 2, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6, padding: 2, flexShrink: 0 }}
    >
      {THEMES.map((t) => {
        const active = t.key === theme;
        return (
          <button
            key={t.key}
            role="radio"
            aria-checked={active}
            aria-label={`${t.label} theme`}
            title={`${t.label} theme`}
            onClick={() => onChange(t.key)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 4, cursor: "pointer",
              border: active ? "1px solid var(--accent)" : "1px solid transparent",
              background: active ? "var(--accent-bg)" : "transparent",
              color: active ? "var(--accent)" : "var(--text-muted)",
            }}
          >
            {icon(t.key)}
          </button>
        );
      })}
    </div>
  );
}
