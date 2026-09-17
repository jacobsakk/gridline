import { useState, useEffect, useMemo } from "react";
import { collection, addDoc, deleteDoc, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "./firebase";
import { ArrowLeft, UserPlus, Trash2, Sun, Moon } from "lucide-react";
import cmuHelmet from "./assets/cmu-helmet.png";

const ROLES = ["Head Coach", "Assistant Coach", "Director of Player Personnel", "Recruiting Coordinator", "Analyst"];

// Same shape as the watch list / portal status hooks elsewhere in the
// app -- a small Firestore collection, open rules, no auth. This is a
// staff roster (who's on the team and what they do), not a login
// system: there's no password or session here, same as the rest of the
// site.
function useAccounts() {
  const [accounts, setAccounts] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const q = query(collection(db, "accounts"), orderBy("createdAt", "asc"));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setAccounts(snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })));
        setReady(true);
      },
      () => setReady(true)
    );
    return unsubscribe;
  }, []);

  async function addAccount({ name, email, role }) {
    await addDoc(collection(db, "accounts"), {
      name: name.trim(),
      email: email.trim(),
      role,
      createdAt: new Date().toISOString(),
    });
  }

  async function removeAccount(id) {
    await deleteDoc(doc(db, "accounts", id));
  }

  return { accounts, ready, addAccount, removeAccount };
}

export default function SettingsPage({ onBack }) {
  const [theme, setTheme] = useState(() => {
    const saved = typeof window !== "undefined" && window.localStorage.getItem("gridline-theme");
    return saved === "light" || saved === "dark" ? saved : "dark";
  });
  const { accounts, addAccount, removeAccount } = useAccounts();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(ROLES[0]);

  function toggleTheme() {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      window.localStorage.setItem("gridline-theme", next);
      return next;
    });
  }

  function handleAdd(e) {
    e.preventDefault();
    if (!name.trim()) return;
    addAccount({ name, email, role });
    setName("");
    setEmail("");
    setRole(ROLES[0]);
  }

  const inputStyle = useMemo(
    () => ({
      background: "var(--bg-page)",
      border: "1px solid var(--border)",
      borderRadius: 5,
      padding: "8px 10px",
      fontSize: 13.5,
      color: "var(--text-primary)",
      fontFamily: "inherit",
    }),
    []
  );

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
            <button
              onClick={onBack}
              title="Back to dashboard"
              style={{
                display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
                background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-secondary)",
                borderRadius: 5, padding: "8px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}
            >
              <ArrowLeft size={15} /> Dashboard
            </button>
            <img src={cmuHelmet} alt="Central Michigan Chippewas helmet" style={{ height: 34, width: "auto", flexShrink: 0 }} />
            <h1 className="oswald app-title" style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "0.01em" }}>
              Settings
            </h1>
          </div>
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

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "16px var(--gutter) var(--gutter)" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div style={{ marginBottom: 10, fontSize: 11, color: "var(--text-faint)", letterSpacing: "0.03em", textTransform: "uppercase" }}>
            Staff & Access
          </div>
          <div style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, padding: 20 }}>
            <h2 className="oswald" style={{ fontSize: 18, fontWeight: 700, margin: "0 0 14px" }}>
              Account Management
            </h2>

            <form onSubmit={handleAdd} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 18 }}>
              <div>
                <label style={{ display: "block", fontSize: 10.5, color: "var(--text-faint)", marginBottom: 4 }}>Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Smith" style={{ ...inputStyle, width: 180 }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 10.5, color: "var(--text-faint)", marginBottom: 4 }}>Email</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@cmich.edu" style={{ ...inputStyle, width: 220 }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 10.5, color: "var(--text-faint)", marginBottom: 4 }}>Role</label>
                <select value={role} onChange={(e) => setRole(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  background: "var(--accent-bg)", border: "1px solid var(--accent)", color: "var(--accent)",
                  borderRadius: 5, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer",
                }}
              >
                <UserPlus size={15} /> Add Account
              </button>
            </form>

            {accounts.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-faint)", padding: "10px 0" }}>
                No accounts added yet.
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase" }}>Name</th>
                    <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase" }}>Email</th>
                    <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase" }}>Role</th>
                    <th style={{ padding: "6px 8px" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                      <td style={{ padding: "9px 8px", fontSize: 13.5, fontWeight: 600 }}>{a.name}</td>
                      <td style={{ padding: "9px 8px", fontSize: 13, color: "var(--text-muted)" }}>{a.email || "—"}</td>
                      <td style={{ padding: "9px 8px", fontSize: 13, color: "var(--text-secondary)" }}>{a.role || "—"}</td>
                      <td style={{ padding: "9px 8px", textAlign: "right" }}>
                        <button
                          onClick={() => removeAccount(a.id)}
                          title="Remove account"
                          style={{ background: "none", border: "none", color: "var(--danger)", cursor: "pointer", padding: 4, lineHeight: 0 }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
