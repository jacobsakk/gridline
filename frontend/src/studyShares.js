import { useEffect, useState } from "react";
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { db } from "./firebase";

// A study's share link shows a saved copy of that one study to anyone holding the link, no sign-in. The copy is
// a document in `studyShares` (its id is the random code in the link), holding the study's rows as JSON text.
// Nothing else is reachable from it. While any signed-in coach has the study open the copy keeps itself in step
// (see useShareSync), and anyone viewing the link sees it change live.

export const MAX_PAYLOAD = 900_000; // a Firestore document tops out near 1 MB

// 22 random URL-safe characters: not guessable, and the only way in (the list of codes is for coaches only).
export function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const shareUrl = (token) => `${window.location.origin}${window.location.pathname}#/shared/${token}`;

// A short fingerprint of the saved text, so "has anything changed?" is a comparison, not a re-upload.
export function hashOf(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(16)}-${text.length}`;
}

// Every link made for one study (coaches only -- the rules refuse this listing to anyone else).
export function useStudyShares(studyId) {
  const [shares, setShares] = useState([]);
  useEffect(() => {
    const off = onSnapshot(
      query(collection(db, "studyShares"), where("studyId", "==", studyId)),
      (snap) =>
        setShares(
          snap.docs
            .map((d) => ({ token: d.id, hash: d.data().hash || "", updatedAt: d.data().updatedAt || "", createdAt: d.data().createdAt || "" }))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        ),
      () => setShares([])
    );
    return off;
  }, [studyId]);
  return shares;
}

export async function createShare({ studyId, title, data, by }) {
  const payload = JSON.stringify(data);
  if (payload.length > MAX_PAYLOAD) throw new Error("This study is too large to share as a link.");
  const token = newToken();
  const now = new Date().toISOString();
  await setDoc(doc(db, "studyShares", token), { studyId, title, payload, hash: hashOf(payload), createdAt: now, updatedAt: now, by: by || "" });
  return token;
}

export const removeShare = (token) => deleteDoc(doc(db, "studyShares", token));

// While a coach has the study open: whenever the study's rows differ from what a link holds, bring the link's
// copy up to date a moment later. Covers an edit made right now and a refresh that arrived with a new deploy.
export function useShareSync(shares, data) {
  useEffect(() => {
    if (!data || !shares.length) return undefined;
    const payload = JSON.stringify(data);
    if (payload.length > MAX_PAYLOAD) return undefined;
    const hash = hashOf(payload);
    const stale = shares.filter((s) => s.hash !== hash);
    if (!stale.length) return undefined;
    const timer = setTimeout(() => {
      stale.forEach((s) =>
        setDoc(doc(db, "studyShares", s.token), { payload, hash, updatedAt: new Date().toISOString() }, { merge: true }).catch(() => {})
      );
    }, 2500);
    return () => clearTimeout(timer);
  }, [shares, data]);
}
