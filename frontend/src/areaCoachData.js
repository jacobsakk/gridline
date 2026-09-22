import { collection, deleteField, doc, onSnapshot, orderBy, query, setDoc, updateDoc, deleteDoc, addDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "./firebase";

// The Area Coach Map: a fixed color legend of coaches (their own small list, kept here rather than pulled
// from the free-text "coach" field on HS Game Update players -- not every area coach types their own name
// into every player, and this list needs a color and a stable order) plus one county -> coach assignment
// per county, all in a single document so painting a whole state is one write instead of hundreds.
//
// Everyone invited can read; only admins can add/edit coaches or repaint counties (see firestore.rules).
export function useAreaCoachMap({ isAdmin }) {
  const [coaches, setCoaches] = useState([]);
  const [assignments, setAssignments] = useState({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let pending = 2;
    const done = () => --pending <= 0 && setReady(true);
    const offCoaches = onSnapshot(
      query(collection(db, "areaCoaches"), orderBy("order", "asc")),
      (snap) => {
        setCoaches(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        done();
      },
      () => done()
    );
    const offMap = onSnapshot(
      doc(db, "areaAssignments", "main"),
      (snap) => {
        setAssignments(snap.exists() ? snap.data().counties || {} : {});
        done();
      },
      () => done()
    );
    return () => {
      offCoaches();
      offMap();
    };
  }, []);

  const now = () => new Date().toISOString();

  return {
    ready,
    coaches,
    assignments,
    async addCoach(name, color) {
      const trimmed = name.trim();
      if (!trimmed) return;
      await addDoc(collection(db, "areaCoaches"), { name: trimmed, color, order: Date.now(), createdAt: now() });
    },
    async updateCoach(id, fields) {
      await updateDoc(doc(db, "areaCoaches", id), fields);
    },
    // Deletes the coach from the legend. Any county already assigned to them is left as-is in storage but
    // shows up unassigned (gray) on the map, since nothing resolves that id to a color anymore.
    async removeCoach(id) {
      await deleteDoc(doc(db, "areaCoaches", id));
    },
    // Assigns every county in `fipsList` to `coachId` (or clears them if `coachId` is falsy) in one write --
    // used for a single county click and for a whole-state "Select" alike.
    async paintCounties(fipsList, coachId) {
      if (!fipsList.length) return;
      const fields = Object.fromEntries(fipsList.map((fips) => [`counties.${fips}`, coachId || deleteField()]));
      await setDoc(doc(db, "areaAssignments", "main"), { ...fields, updatedAt: now() }, { merge: true });
    },
  };
}
