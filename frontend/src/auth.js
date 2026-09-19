import { useCallback, useEffect, useRef, useState } from "react";
import {
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { auth, db } from "./firebase";

// Always allowed in (and always an admin), even before any invite exists --
// this is how the very first account gets bootstrapped. Mirrors firestore.rules.
export const OWNER_EMAIL = "sakk1j@cmich.edu";

const EMAIL_KEY = "gridline-signin-email";

// Where the emailed link brings the coach back to: this site's own address.
export const SITE_URL = `${window.location.origin}${window.location.pathname}`;

export const normalizeEmail = (email) => (email || "").trim().toLowerCase();

// "Jacob Sakk" -> "Coach Sakk"
export function coachTitle(name, email) {
  const words = (name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length) {
    const last = words[words.length - 1].replace(/,$/, "");
    return `Coach ${last}`;
  }
  const local = (email || "").split("@")[0].replace(/[^a-zA-Z]/g, " ").trim().split(/\s+/).pop();
  return local ? `Coach ${local.charAt(0).toUpperCase()}${local.slice(1)}` : "Coach";
}

function storedEmail() {
  try {
    return window.localStorage.getItem(EMAIL_KEY) || "";
  } catch {
    return "";
  }
}
function storeEmail(email) {
  try {
    if (email) window.localStorage.setItem(EMAIL_KEY, email);
    else window.localStorage.removeItem(EMAIL_KEY);
  } catch {
    /* storage unavailable -- the coach just re-types their email on another device */
  }
}

async function findInvite(email) {
  if (email === OWNER_EMAIL) return { name: "Jacob Sakk", email, admin: true, owner: true };
  const snap = await getDoc(doc(db, "accounts", email));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Sign-in state for the whole app.
//   status: "loading" | "signedOut" | "needsEmail" | "denied" | "ready"
export function useAuth() {
  const [state, setState] = useState({ status: "loading", profile: null, error: "" });
  const [justSignedIn, setJustSignedIn] = useState(false);
  const linkAttempted = useRef(false);

  // Finish a sign-in when the coach arrives from the emailed link.
  const completeLink = useCallback(async (email) => {
    setJustSignedIn(true); // set first, so the welcome plays as soon as the session appears
    try {
      await signInWithEmailLink(auth, email, window.location.href);
      storeEmail("");
      window.history.replaceState({}, "", SITE_URL);
    } catch (err) {
      setJustSignedIn(false);
      window.history.replaceState({}, "", SITE_URL);
      setState({
        status: "signedOut",
        profile: null,
        error: err.code === "auth/invalid-action-code" || err.code === "auth/expired-action-code"
          ? "That sign-in link has expired or was already used. Request a new one below."
          : "We couldn't finish signing you in. Request a new link below.",
      });
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const email = normalizeEmail(user.email);
        try {
          const profile = await findInvite(email);
          if (!profile) {
            await firebaseSignOut(auth);
            setState({ status: "denied", profile: null, error: "" });
            return;
          }
          if (!profile.owner) updateDoc(doc(db, "accounts", email), { lastLoginAt: new Date().toISOString() }).catch(() => {});
          setState({ status: "ready", profile: { ...profile, email }, error: "" });
        } catch {
          setState({ status: "signedOut", profile: null, error: "We couldn't check your invitation just now. Try again in a moment." });
        }
        return;
      }
      // Signed out: maybe they just clicked a sign-in link.
      if (!linkAttempted.current && isSignInWithEmailLink(auth, window.location.href)) {
        linkAttempted.current = true;
        const email = storedEmail();
        if (email) completeLink(email);
        else setState({ status: "needsEmail", profile: null, error: "" });
        return;
      }
      setState((s) => (s.status === "needsEmail" ? s : { status: "signedOut", profile: null, error: s.error }));
    });
    return unsubscribe;
  }, [completeLink]);

  // Sends the sign-in link. Only invited emails get one (the owner always can).
  const requestLink = useCallback(async (rawEmail) => {
    const email = normalizeEmail(rawEmail);
    if (!/^\S+@\S+\.\S+$/.test(email)) throw Object.assign(new Error("Enter a valid email address."), { code: "bad-email" });
    const invite = await findInvite(email);
    if (!invite) throw Object.assign(new Error("That email hasn't been invited."), { code: "not-invited" });
    await sendSignInLinkToEmail(auth, email, { url: SITE_URL, handleCodeInApp: true });
    storeEmail(email);
    return email;
  }, []);

  const confirmEmail = useCallback(async (rawEmail) => {
    await completeLink(normalizeEmail(rawEmail));
  }, [completeLink]);

  const signOut = useCallback(() => {
    setJustSignedIn(false);
    return firebaseSignOut(auth);
  }, []);

  return { ...state, justSignedIn, requestLink, confirmEmail, signOut };
}

// Used by Settings: send (or re-send) an invitation email to someone already on the roster.
export async function sendInviteEmail(rawEmail) {
  const email = normalizeEmail(rawEmail);
  await sendSignInLinkToEmail(auth, email, { url: SITE_URL, handleCodeInApp: true });
}
