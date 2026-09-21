import { useState, useEffect, useMemo } from "react";
import { collection, deleteDoc, doc, onSnapshot, orderBy, query, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import { ArrowLeft, Mail, Send, Trash2 } from "lucide-react";
import { useBack } from "./route.js";
import { normalizeEmail, sendInviteEmail } from "./auth.js";
import { ThemeSwitcher, useTheme } from "./theme.jsx";
import cmuHelmet from "./assets/cmu-helmet.png";

const ROLES = ["Head Coach", "Assistant Coach", "Director of Player Personnel", "Recruiting Coordinator", "Analyst"];

// The roster doubles as the invite list: a coach can sign in only if there is
// an account here whose document id is their (lowercased) email -- the
// Firestore rules check exactly that. Adding someone emails them a sign-in link.
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

  async function inviteAccount({ name, email, role, admin, invitedBy, legacyId }) {
    const key = normalizeEmail(email);
    await setDoc(doc(db, "accounts", key), {
      name: name.trim(),
      email: key,
      role,
      admin: !!admin,
      createdAt: new Date().toISOString(),
      invitedBy: invitedBy || "",
    });
    // An account made before logins existed had a random id -- replace it.
    if (legacyId && legacyId !== key) await deleteDoc(doc(db, "accounts", legacyId));
    await sendInviteEmail(key);
  }

  async function removeAccount(id) {
    await deleteDoc(doc(db, "accounts", id));
  }

  return { accounts, ready, inviteAccount, removeAccount };
}

function inviteError(err) {
  return err?.code === "auth/operation-not-allowed"
    ? "Email sign-in isn't switched on in Firebase yet, so the invite email couldn't be sent. (The account was saved -- use Resend once it's on.)"
    : err?.code === "permission-denied"
      ? "You don't have permission to manage accounts."
      : err?.code === "auth/too-many-requests"
        ? "Too many emails sent in a short time. Wait a few minutes and try again."
        : "Something went wrong. Try again.";
}

export default function SettingsPage({ onBack: toDashboard, session }) {
  const back = useBack(toDashboard);
  const onBack = back.go;
  const [theme, setTheme] = useTheme();
  const { accounts, inviteAccount, removeAccount } = useAccounts();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(ROLES[0]);
  const [admin, setAdmin] = useState(false);
  const [notice, setNotice] = useState({ kind: "", text: "" });
  const [busy, setBusy] = useState(false);
  const isAdmin = !!session?.profile?.admin;

  async function handleAdd(e) {
    e.preventDefault();
    if (!name.trim() || !/^\S+@\S+\.\S+$/.test(email.trim())) {
      setNotice({ kind: "error", text: "Enter a name and a valid email address." });
      return;
    }
    setBusy(true);
    setNotice({ kind: "", text: "" });
    try {
      await inviteAccount({ name, email, role, admin, invitedBy: session?.profile?.email });
      setNotice({ kind: "ok", text: `Invite sent to ${normalizeEmail(email)}. They'll get an email with a sign-in link.` });
      setName("");
      setEmail("");
      setRole(ROLES[0]);
      setAdmin(false);
    } catch (err) {
      setNotice({ kind: "error", text: inviteError(err) });
    }
    setBusy(false);
  }

  async function resend(a) {
    setNotice({ kind: "", text: "" });
    try {
      if (a.id !== normalizeEmail(a.email)) {
        await inviteAccount({ name: a.name, email: a.email, role: a.role, admin: a.admin, invitedBy: session?.profile?.email, legacyId: a.id });
      } else {
        await sendInviteEmail(a.email);
      }
      setNotice({ kind: "ok", text: `Invite sent to ${a.email}.` });
    } catch (err) {
      setNotice({ kind: "error", text: inviteError(err) });
    }
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
      <div className="app-header" style={{ flexShrink: 0, position: "relative", padding: "20px var(--gutter) 16px" }}>
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
              title={`Back to ${back.label}`}
              style={{
                display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
                background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-secondary)",
                borderRadius: 5, padding: "8px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}
            >
              <ArrowLeft size={15} /> {back.label}
            </button>
            <img src={cmuHelmet} alt="Central Michigan Chippewas helmet" style={{ height: 34, width: "auto", flexShrink: 0 }} />
            <h1 className="oswald app-title" style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "0.01em" }}>
              Settings
            </h1>
          </div>
          <ThemeSwitcher theme={theme} onChange={setTheme} />
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "16px var(--gutter) var(--gutter)" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div style={{ marginBottom: 10, fontSize: 11, color: "var(--text-faint)", letterSpacing: "0.03em", textTransform: "uppercase" }}>
            Staff & Access
          </div>
          {!isAdmin ? (
            <div style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, padding: 20, fontSize: 14, color: "var(--text-muted)" }}>
              Only admins can invite coaches. Ask Coach Sakk if you need someone added.
            </div>
          ) : (
          <div style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, padding: 20 }}>
            <h2 className="oswald" style={{ fontSize: 18, fontWeight: 700, margin: "0 0 6px" }}>Accounts &amp; Invites</h2>
            <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
              Only people on this list can sign in. An invite emails them a one-time link; they then create their own password. Every account appears below as soon as it's created.
            </p>

            <form onSubmit={handleAdd} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
              <div>
                <label htmlFor="invite-name" style={{ display: "block", fontSize: 10.5, color: "var(--text-faint)", marginBottom: 4 }}>Name</label>
                <input id="invite-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Smith" style={{ ...inputStyle, width: 180 }} />
              </div>
              <div>
                <label htmlFor="invite-email" style={{ display: "block", fontSize: 10.5, color: "var(--text-faint)", marginBottom: 4 }}>Email</label>
                <input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@cmich.edu" style={{ ...inputStyle, width: 230 }} />
              </div>
              <div>
                <label htmlFor="invite-role" style={{ display: "block", fontSize: 10.5, color: "var(--text-faint)", marginBottom: 4 }}>Role</label>
                <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: "var(--text-secondary)", paddingBottom: 9, cursor: "pointer" }}>
                <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} /> Can invite others
              </label>
              <button
                type="submit"
                disabled={busy}
                style={{
                  display: "flex", alignItems: "center", gap: 6, opacity: busy ? 0.6 : 1,
                  background: "var(--accent-bg)", border: "1px solid var(--accent)", color: "var(--accent)",
                  borderRadius: 5, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer",
                }}
              >
                <Send size={15} /> {busy ? "Sending…" : "Send Invite"}
              </button>
            </form>

            {notice.text && (
              <div role="status" style={{ marginBottom: 14, fontSize: 13, lineHeight: 1.45, color: notice.kind === "ok" ? "var(--success)" : "var(--danger-text)" }}>
                {notice.text}
              </div>
            )}

            {accounts.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-faint)", padding: "10px 0" }}>
                No accounts yet. Your own account appears here after you sign in.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["Name", "Email", "Role", "Access", "Created", "Status", ""].map((h) => (
                      <th key={h} style={{ textAlign: "left", padding: "6px 8px", fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => {
                    const legacy = !a.email || a.id !== normalizeEmail(a.email);
                    return (
                      <tr key={a.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                        <td style={{ padding: "9px 8px", fontSize: 13.5, fontWeight: 600 }}>{a.name}</td>
                        <td style={{ padding: "9px 8px", fontSize: 13, color: "var(--text-muted)" }}>{a.email || "—"}</td>
                        <td style={{ padding: "9px 8px", fontSize: 13, color: "var(--text-secondary)" }}>{a.role || "—"}</td>
                        <td style={{ padding: "9px 8px", fontSize: 13, color: "var(--text-secondary)" }}>{a.admin ? "Admin" : "Coach"}</td>
                        <td className="tabular" style={{ padding: "9px 8px", fontSize: 12.5, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                          {a.createdAt ? new Date(a.createdAt).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "—"}
                        </td>
                        <td style={{ padding: "9px 8px", fontSize: 12.5, color: legacy ? "var(--danger-text)" : a.passwordSet ? "var(--success)" : "var(--text-muted)" }}>
                          {legacy
                            ? "Needs a new invite"
                            : a.passwordSet
                              ? `Active${a.lastLoginAt ? ` · last in ${new Date(a.lastLoginAt).toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}`
                              : "Invited — hasn't created a password yet"}
                        </td>
                        <td style={{ padding: "9px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
                          {a.email && (
                            <button
                              onClick={() => resend(a)}
                              title={legacy ? "Send an invite" : "Resend the invite email"}
                              style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 4, lineHeight: 0, marginRight: 4 }}
                            >
                              <Mail size={15} />
                            </button>
                          )}
                          <button
                            onClick={() => removeAccount(a.id)}
                            title="Remove — they can no longer sign in"
                            style={{ background: "none", border: "none", color: "var(--danger)", cursor: "pointer", padding: 4, lineHeight: 0 }}
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            )}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
