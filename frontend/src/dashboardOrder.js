import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "./firebase";

// Each coach's own order for the dashboard cards. Kept under their email so it follows them to any device,
// with a copy in this browser so the dashboard paints in the right order before the database answers.

const idFor = (email) => String(email || "").trim().toLowerCase();
const cacheKey = (email) => `dashboardOrder:${idFor(email)}`;

function readCache(email) {
  try {
    const raw = window.localStorage.getItem(cacheKey(email));
    const list = raw ? JSON.parse(raw) : null;
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeCache(email, order) {
  try {
    window.localStorage.setItem(cacheKey(email), JSON.stringify(order));
  } catch {
    /* private mode / blocked storage: the saved copy in the database still applies */
  }
}

// `cards` in their saved order. A card the saved order doesn't mention (one added later) goes at the end
// in its default place, and a saved key with no card any more is ignored.
export function applyOrder(cards, order) {
  const rank = new Map((order || []).map((key, i) => [key, i]));
  return cards
    .map((card, i) => ({ card, i }))
    .sort((a, b) => (rank.has(a.card.key) ? rank.get(a.card.key) : 1000 + a.i) - (rank.has(b.card.key) ? rank.get(b.card.key) : 1000 + b.i))
    .map(({ card }) => card);
}

export function useDashboardOrder(email) {
  const [order, setOrderState] = useState(() => readCache(email));

  useEffect(() => {
    const id = idFor(email);
    if (!id) return undefined;
    setOrderState(readCache(email));
    return onSnapshot(
      doc(db, "dashboardPrefs", id),
      (snap) => {
        const saved = snap.exists() && Array.isArray(snap.data().order) ? snap.data().order : null;
        if (saved) {
          setOrderState(saved);
          writeCache(email, saved);
        }
      },
      () => {}
    );
  }, [email]);

  async function setOrder(next) {
    setOrderState(next);
    writeCache(email, next);
    const id = idFor(email);
    if (id) await setDoc(doc(db, "dashboardPrefs", id), { order: next, updatedAt: new Date().toISOString() });
  }

  return { order, setOrder };
}
