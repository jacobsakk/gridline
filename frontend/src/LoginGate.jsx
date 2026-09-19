import { useEffect, useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { coachTitle, useAuth } from "./auth.js";
import CardTransition from "./CardTransition.jsx";
import actionCDark from "./assets/cmu-action-c-dark.png";

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

// Dev-only shortcut for previewing the app and the welcome animation without
// a real email round trip: /?devLogin=welcome (or =quiet). Compiled out of production builds.
function useDevAuth() {
  const dev = import.meta.env.DEV ? new URLSearchParams(window.location.search).get("devLogin") : null;
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
      <div style={{ width: 400, maxWidth: "100%", textAlign: "center" }}>
        <img src={actionCDark} alt="Central Michigan Action C" style={{ height: 78, width: "auto", marginBottom: 18 }} />
        <h1 className="oswald" style={{ fontSize: 30, fontWeight: 700, margin: "0 0 6px", letterSpacing: "0.01em" }}>Central Michigan Recruiting Hub</h1>
        <div style={{ height: 3, width: 120, margin: "0 auto 26px", background: "linear-gradient(90deg, var(--gold), var(--maroon))", borderRadius: 2 }} />
        <div style={{ background: "rgba(0,0,0,0.55)", border: "1px solid #4A1F2B", borderRadius: 12, padding: 24, textAlign: "left", backdropFilter: "blur(4px)" }}>
          {children}
        </div>
        <div style={{ marginTop: 18, fontSize: 12.5, color: "#A78389" }}>Invitation only</div>
      </div>
    </div>
  );
}

function SignInForm({ auth }) {
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState("form"); // form | sending | sent
  const [error, setError] = useState(auth.error || "");
  const [sentTo, setSentTo] = useState("");

  async function send(e) {
    e?.preventDefault();
    setError("");
    setPhase("sending");
    try {
      const address = await auth.requestLink(email);
      setSentTo(address);
      setPhase("sent");
    } catch (err) {
      setPhase("form");
      setError(
        err.code === "not-invited"
          ? "That email hasn't been invited yet. Ask Jacob to send you an invite."
          : err.code === "bad-email"
            ? err.message
            : err.code === "auth/operation-not-allowed"
              ? "Email sign-in isn't switched on for this site yet (it needs one setting turned on in Firebase)."
              : err.code === "auth/too-many-requests"
                ? "Too many attempts. Wait a few minutes and try again."
                : "We couldn't send the link right now. Try again in a moment."
      );
    }
  }

  if (phase === "sent") {
    return (
      <div style={{ textAlign: "center" }}>
        <Mail size={30} color="var(--gold)" style={{ marginBottom: 10 }} />
        <h2 className="oswald" style={{ margin: "0 0 8px", fontSize: 20 }}>Check your email</h2>
        <p style={{ margin: "0 0 16px", fontSize: 14, color: "#CDAEAC", lineHeight: 1.55 }}>
          We sent a sign-in link to <strong style={{ color: "#F7EFE4" }}>{sentTo}</strong>. Open it on this device to come in. It can take a minute, and it may land in spam.
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: 18 }}>
          <button onClick={send} style={linkButton}>Resend link</button>
          <button onClick={() => setPhase("form")} style={linkButton}>Use a different email</button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={send}>
      <label htmlFor="login-email" style={{ display: "block", fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "#A78389", marginBottom: 8 }}>Coach email</label>
      <input
        id="login-email"
        type="email"
        autoComplete="email"
        autoFocus
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@school.edu"
        style={fieldStyle}
      />
      {error && <div role="alert" style={{ marginTop: 12, fontSize: 13.5, color: "#FF9E9E", lineHeight: 1.45 }}>{error}</div>}
      <button type="submit" disabled={phase === "sending" || !email.trim()} style={{ ...buttonStyle, marginTop: 16, opacity: phase === "sending" || !email.trim() ? 0.6 : 1 }}>
        {phase === "sending" ? <Loader2 size={16} className="spin" /> : <Mail size={16} />}
        {phase === "sending" ? "Sending…" : "Email me a sign-in link"}
      </button>
      <p style={{ margin: "14px 0 0", fontSize: 12.5, color: "#A78389", lineHeight: 1.5 }}>
        No password needed. We'll email you a one-time link, and you'll stay signed in on this device.
      </p>
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
  } else {
    screen = (
      <Shell>
        {auth.status === "denied" && (
          <div role="alert" style={{ marginBottom: 16, fontSize: 13.5, color: "#FF9E9E", lineHeight: 1.45 }}>
            That email isn't on the invite list. Ask Jacob to add you.
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
