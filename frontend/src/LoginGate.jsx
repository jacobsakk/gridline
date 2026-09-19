import { useEffect, useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { coachTitle, useAuth } from "./auth.js";
import CardTransition from "./CardTransition.jsx";
import actionCDark from "./assets/cmu-action-c-dark.png";

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

// Dev-only shortcut for previewing the app and the welcome animation without
// a real email round trip: /?devLogin=welcome (or =quiet, or =password for the create-password step). Compiled out of production builds.
function useDevAuth() {
  const dev = import.meta.env.DEV ? new URLSearchParams(window.location.search).get("devLogin") : null;
  if (dev === "password") {
    return { status: "needsPassword", profile: { name: "Jacob Sakk", email: "dev@example.com" }, createPassword: () => new Promise(() => {}), signOut: () => {} };
  }
  return dev
    ? {
        status: "ready",
        profile: { name: "Jacob Sakk", email: "dev@example.com", admin: true },
        justSignedIn: dev === "welcome",
        signOut: () => {},
      }
    : null;
}

const fieldStyle = {
  width: "100%", background: "#0F0F0F", border: "1px solid #3A2A2E", color: "#F7EFE4", borderRadius: 8,
  padding: "13px 14px", fontSize: 15, fontFamily: "inherit",
};
const buttonStyle = {
  width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 9, background: "var(--maroon)", color: "var(--gold)",
  border: "1px solid var(--gold)", borderRadius: 8, padding: "13px 16px", fontSize: 15, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
};
const linkButton = { background: "none", border: "none", color: "var(--gold)", cursor: "pointer", fontFamily: "inherit", fontSize: 13.5, padding: 0, textDecoration: "underline" };

function Shell({ children }) {
  return (
    <div
      className="app-shell"
      data-theme="dark"
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20, overflow: "auto", color: "#F7EFE4",
        background: "radial-gradient(120% 90% at 50% 0%, #5a1424 0%, #2a0a12 45%, #000 100%)",
        fontFamily: "'Century Gothic', 'Jost', 'Helvetica Neue', Arial, sans-serif",
      }}
    >
      <div style={{ width: 560, maxWidth: "100%", textAlign: "center" }}>
        <img src={actionCDark} alt="Central Michigan Action C" style={{ height: 78, width: "auto", marginBottom: 18 }} />
        <h1 className="oswald" style={{ fontSize: "clamp(18px, 5.6vw, 30px)", fontWeight: 700, margin: "0 0 6px", letterSpacing: "0.01em", whiteSpace: "nowrap" }}>Central Michigan Recruiting Hub</h1>
        <div style={{ height: 3, width: 120, margin: "0 auto 26px", background: "linear-gradient(90deg, var(--gold), var(--maroon))", borderRadius: 2 }} />
        <div style={{ background: "rgba(0,0,0,0.55)", border: "1px solid #4A1F2B", borderRadius: 12, padding: 24, textAlign: "left", backdropFilter: "blur(4px)", maxWidth: 400, margin: "0 auto" }}>
          {children}
        </div>
        <div style={{ marginTop: 18, fontSize: 12.5, color: "#A78389" }}>Invitation only</div>
      </div>
    </div>
  );
}

function authErrorMessage(err) {
  const code = err?.code || "";
  if (code === "not-invited") return "That email hasn't been invited yet. Ask Coach Sakk to send you an invite.";
  if (code === "bad-email") return err.message;
  if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-login-credentials"].includes(code))
    return "That email and password don't match. If this is your first time, use the sign-in link below.";
  if (code === "auth/operation-not-allowed") return "Email sign-in isn't switched on for this site yet (it needs one setting turned on in Firebase).";
  if (code === "auth/too-many-requests") return "Too many attempts. Wait a few minutes and try again.";
  if (code === "auth/network-request-failed") return "No connection. Check your internet and try again.";
  return "Something went wrong. Try again in a moment.";
}

function SignInForm({ auth }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phase, setPhase] = useState("form"); // form | working | sent
  const [sent, setSent] = useState({ kind: "link", to: "" });
  const [error, setError] = useState(auth.error || "");

  async function run(action, kind) {
    setError("");
    setPhase("working");
    try {
      const result = await action();
      if (kind) {
        setSent({ kind, to: result });
        setPhase("sent");
      }
    } catch (err) {
      setPhase("form");
      setError(authErrorMessage(err));
    }
  }

  function signIn(e) {
    e.preventDefault();
    if (!password) return setError("Enter your password.");
    run(() => auth.signInWithPassword(email, password), null);
  }

  if (phase === "sent") {
    const reset = sent.kind === "reset";
    return (
      <div style={{ textAlign: "center" }}>
        <Mail size={30} color="var(--gold)" style={{ marginBottom: 10 }} />
        <h2 className="oswald" style={{ margin: "0 0 8px", fontSize: 20 }}>Check your email</h2>
        <p style={{ margin: "0 0 16px", fontSize: 14, color: "#CDAEAC", lineHeight: 1.55 }}>
          {reset ? "We sent a link to reset your password to " : "We sent a sign-in link to "}
          <strong style={{ color: "#F7EFE4" }}>{sent.to}</strong>.{" "}
          {reset ? "Choose a new password there, then come back and sign in." : "Open it on this device, then you'll create your password."} It can take a minute, and it may land in spam.
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: 18 }}>
          <button onClick={() => run(() => (reset ? auth.forgotPassword(email) : auth.requestLink(email)), sent.kind)} style={linkButton}>Resend</button>
          <button onClick={() => setPhase("form")} style={linkButton}>Back to sign in</button>
        </div>
      </div>
    );
  }

  const working = phase === "working";
  const label = { display: "block", fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "#A78389", marginBottom: 8 };
  return (
    <form onSubmit={signIn}>
      <label htmlFor="login-email" style={label}>Coach email</label>
      <input id="login-email" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@school.edu" style={fieldStyle} />
      <label htmlFor="login-password" style={{ ...label, marginTop: 14 }}>Password</label>
      <input id="login-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" style={fieldStyle} />
      {error && <div role="alert" style={{ marginTop: 12, fontSize: 13.5, color: "#FF9E9E", lineHeight: 1.45 }}>{error}</div>}
      <button type="submit" disabled={working || !email.trim()} style={{ ...buttonStyle, marginTop: 16, opacity: working || !email.trim() ? 0.6 : 1 }}>
        {working ? <Loader2 size={16} className="spin" /> : null}
        {working ? "Working…" : "Sign in"}
      </button>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, gap: 10, flexWrap: "wrap" }}>
        <button type="button" disabled={working} onClick={() => run(() => auth.forgotPassword(email), "reset")} style={linkButton}>Forgot password?</button>
      </div>
      <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid #3A2A2E", textAlign: "center" }}>
        <div style={{ fontSize: 12.5, color: "#A78389", marginBottom: 10 }}>First time here?</div>
        <button
          type="button"
          disabled={working || !email.trim()}
          onClick={() => run(() => auth.requestLink(email), "link")}
          style={{ ...buttonStyle, background: "transparent", opacity: working || !email.trim() ? 0.6 : 1 }}
        >
          <Mail size={16} /> Email me a sign-in link
        </button>
        <p style={{ margin: "10px 0 0", fontSize: 12, color: "#A78389", lineHeight: 1.5 }}>Type your email above first. You'll create your own password after clicking the link.</p>
      </div>
    </form>
  );
}

function CreatePassword({ auth }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const title = coachTitle(auth.profile?.name, auth.profile?.email);

  async function save(e) {
    e.preventDefault();
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirm) return setError("The two passwords don't match.");
    setError("");
    setSaving(true);
    try {
      await auth.createPassword(password);
    } catch (err) {
      setSaving(false);
      setError(
        err.code === "auth/weak-password"
          ? "That password is too weak. Try a longer one."
          : err.code === "auth/requires-recent-login"
            ? "For security, please use your sign-in link again, then set your password."
            : "We couldn't save your password. Try again."
      );
    }
  }

  return (
    <form onSubmit={save}>
      <h2 className="oswald" style={{ margin: "0 0 6px", fontSize: 20 }}>Welcome, {title}</h2>
      <p style={{ margin: "0 0 16px", fontSize: 14, color: "#CDAEAC", lineHeight: 1.5 }}>One last step: create your own password. You'll use it with your email to sign in from now on.</p>
      <label htmlFor="new-password" style={{ display: "block", fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "#A78389", marginBottom: 8 }}>New password</label>
      <input id="new-password" type="password" autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" style={fieldStyle} />
      <label htmlFor="confirm-password" style={{ display: "block", fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "#A78389", margin: "14px 0 8px" }}>Confirm password</label>
      <input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Type it again" style={fieldStyle} />
      {error && <div role="alert" style={{ marginTop: 12, fontSize: 13.5, color: "#FF9E9E", lineHeight: 1.45 }}>{error}</div>}
      <button type="submit" disabled={saving || !password} style={{ ...buttonStyle, marginTop: 16, opacity: saving || !password ? 0.6 : 1 }}>
        {saving ? <Loader2 size={16} className="spin" /> : null}
        {saving ? "Saving…" : "Save password and continue"}
      </button>
    </form>
  );
}

function ConfirmEmail({ auth }) {
  const [email, setEmail] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        auth.confirmEmail(email);
      }}
    >
      <h2 className="oswald" style={{ margin: "0 0 8px", fontSize: 20 }}>Confirm your email</h2>
      <p style={{ margin: "0 0 14px", fontSize: 14, color: "#CDAEAC", lineHeight: 1.5 }}>
        You opened the link on a different device or browser. Type the email the invite was sent to and you're in.
      </p>
      <input id="confirm-email" type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@school.edu" style={fieldStyle} />
      <button type="submit" disabled={!email.trim()} style={{ ...buttonStyle, marginTop: 16, opacity: email.trim() ? 1 : 0.6 }}>Finish signing in</button>
    </form>
  );
}

// Nothing behind this gate renders until a coach on the invite list is signed in.
// children({ profile, signOut }) is the app.
export default function LoginGate({ children }) {
  const realAuth = useAuth();
  const devAuth = useDevAuth();
  const auth = devAuth || realAuth;

  const [showApp, setShowApp] = useState(false);
  const [welcome, setWelcome] = useState(false);

  useEffect(() => {
    if (auth.status === "ready") {
      if (auth.justSignedIn && !prefersReducedMotion()) setWelcome(true);
      else setShowApp(true);
    } else {
      setShowApp(false);
      setWelcome(false);
    }
  }, [auth.status, auth.justSignedIn]);

  let screen;
  if (showApp && auth.status === "ready") {
    screen = children({ profile: auth.profile, signOut: auth.signOut });
  } else if (auth.status === "loading" || auth.status === "ready") {
    screen = (
      <Shell>
        <div style={{ display: "flex", justifyContent: "center", padding: "18px 0", color: "#CDAEAC" }}>
          <Loader2 size={22} className="spin" />
        </div>
      </Shell>
    );
  } else if (auth.status === "needsEmail") {
    screen = <Shell><ConfirmEmail auth={auth} /></Shell>;
  } else if (auth.status === "needsPassword") {
    screen = <Shell><CreatePassword auth={auth} /></Shell>;
  } else {
    screen = (
      <Shell>
        {auth.status === "denied" && (
          <div role="alert" style={{ marginBottom: 16, fontSize: 13.5, color: "#FF9E9E", lineHeight: 1.45 }}>
            That email isn't on the invite list. Ask Coach Sakk to add you.
          </div>
        )}
        <SignInForm auth={auth} />
      </Shell>
    );
  }

  return (
    <>
      {screen}
      {welcome && auth.profile && (
        <CardTransition
          heading="Welcome"
          label={coachTitle(auth.profile.name, auth.profile.email)}
          onCovered={() => setShowApp(true)}
          onDone={() => setWelcome(false)}
        />
      )}
    </>
  );
}
