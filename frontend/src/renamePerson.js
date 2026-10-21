import { collection, doc, getDocs, query, where, writeBatch } from "firebase/firestore";
import { db } from "./firebase";
import { normalizePlayerKey } from "./offerData.js";

// One player is one record in two places: his offers (one row per school, in the Offer Tracker) and his line in
// the Game Update tracker, and the two are matched by his name. So changing a name has to change both at once,
// or the Game Update line and the Offer Tracker profile stop being the same person.
export async function renamePerson({ classYear, oldName, newName }) {
  const next = String(newName || "").trim().replace(/\s+/g, " ");
  if (!next) throw new Error("Type the name first.");
  const key = normalizePlayerKey(oldName);
  const batch = writeBatch(db);
  const updatedAt = new Date().toISOString();
  let changed = 0;

  const offers = await getDocs(query(collection(db, "offers"), where("classYear", "==", classYear)));
  offers.docs.forEach((d) => {
    if (normalizePlayerKey(d.data().player) === key) {
      batch.update(d.ref, { player: next, updatedAt });
      changed += 1;
    }
  });

  const hs = await getDocs(collection(db, "hsPlayers"));
  hs.docs.forEach((d) => {
    const p = d.data();
    if (String(p.classYear) === String(classYear) && normalizePlayerKey(p.name) === key) {
      batch.update(d.ref, { name: next });
      changed += 1;
    }
  });

  if (!changed) throw new Error("Couldn't find that player to rename.");
  await batch.commit();
  return changed;
}
