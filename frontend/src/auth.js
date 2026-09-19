import { useCallback, useEffect, useRef, useState } from "react";
import {
  EmailAuthProvider,
  isSignInWithEmailLink,
  linkWithCredential,
  onAuthStateChanged,
  sendPasswordResetEmail,
  sendSignInLinkToEmail,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
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
  const snap = await getDoc(doc(db, "accounts", email));
  const data = snap.exists() ? { id: snap.id, ...snap.data() } : null;
  if (email === OWNER_EMAIL) return { name: "Jacob Sakk", role: "Owner", ...(data || {}), email, admin: true, owner: true, missingDoc: !data };
  return data;
}

// Sign-in state for the whole app.
//   status: "loading" | "signedOut" | "needsEmail" | "needsPassword" | "denied" | "ready"
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
          // First sign-in is by emailed link; before anything else they choose a password.
          const hasPassword = user.providerData.some((p) => p.providerId === "password");
          if (!hasPassword) {
            setState({ status: "needsPassword", profile: { ...profile, email }, error: "" });
            return;
          }
          const stamp = { lastLoginAt: new Date().toISOString() };
          if (profile.owner && profile.missingDoc) {
            // The owner isn't invited by anyone, so their account is created here -- it then shows in Settings.
            setDoc(doc(db, "accounts", email), { name: profile.name, email, role: profile.role, admin: true, createdAt: new Date().toISOString(), invitedBy: "", passwordSet: true, ...stamp }, { merge: true }).catch(() => {});
          } else {
            updateDoc(doc(db, "accounts", email), { ...stamp, passwordSet: true }).catch(() => {});
          }
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

  // First-time password: attach it to the account that the emailed link just signed in.
  const createPassword = useCallback(async (password) => {
    const user = auth.currentUser;
    if (!user) throw Object.assign(new Error("Not signed in."), { code: "auth/requires-recent-login" });
    const email = normalizeEmail(user.email);
    try {
      await linkWithCredential(user, EmailAuthProvider.credential(email, password));
    } catch (err) {
      if (err.code !== "auth/provider-already-linked") throw err;
    }
    const stamp = { lastLoginAt: new Date().toISOString(), passwordSet: true };
    if (email === OWNER_EMAIL) {
      await setDoc(doc(db, "accounts", email), { name: "Jacob Sakk", email, role: "Owner", admin: true, createdAt: new Date().toISOString(), invitedBy: "", ...stamp }, { merge: true });
    } else {
      await updateDoc(doc(db, "accounts", email), stamp);
    }
    // Reload the profile (now with a password) so the app opens.
    const profile = await findInvite(email);
    setState({ status: "ready", profile: { ...profile, email }, error: "" });
  }, []);

  const signInWithPassword = useCallback(async (rawEmail, password) => {
    const email = normalizeEmail(rawEmail);
    if (!/^\S+@\S+\.\S+$/.test(email)) throw Object.assign(new Error("Enter a valid email address."), { code: "bad-email" });
    setJustSignedIn(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setJustSignedIn(false);
      throw err;
    }
  }, []);

  const forgotPassword = useCallback(async (rawEmail) => {
    const email = normalizeEmail(rawEmail);
    if (!/^\S+@\S+\.\S+$/.test(email)) throw Object.assign(new Error("Enter your email above first."), { code: "bad-email" });
    const invite = await findInvite(email);
    if (!invite) throw Object.assign(new Error("That email hasn't been invited."), { code: "not-invited" });
    await sendPasswordResetEmail(auth, email, { url: SITE_URL });
    return email;
  }, []);

  const confirmEmail = useCallback(async (rawEmail) => {
    await completeLink(normalizeEmail(rawEmail));
  }, [completeLink]);

  const signOut = useCallback(() => {
    setJustSignedIn(false);
    return firebaseSignOut(auth);
  }, []);

  return { ...state, justSignedIn, requestLink, confirmEmail, createPassword, signInWithPassword, forgotPassword, signOut };
}

// Used by Settings: send (or re-send) an invitation email to someone already on the roster.
export async function sendInviteEmail(rawEmail) {
  const email = normalizeEmail(rawEmail);
  await sendSignInLinkToEmail(auth, email, { url: SITE_URL, handleCodeInApp: true });
}
