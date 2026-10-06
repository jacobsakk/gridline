import * as XLSX from "xlsx";
import { collection, deleteDoc, doc, onSnapshot, setDoc, writeBatch } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "./firebase";

// Reads a workbook shaped like the tracker's columns: NAME, POSITION, COLLEGE, matched case/spacing-
// insensitively so a re-exported or re-ordered sheet still works. Stats aren't part of this -- they're
// pulled live from the Pre-Portal Tracker's own data (see transferStats.js) -- so this is purely a bulk
// way to add a roster of names/positions/colleges at once instead of one at a time.
export async function parseTransferSheet(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const headerRow = rows[0] || [];
  const norm = (t) => String(t ?? "").toUpperCase().replace(/\s+/g, " ").trim();
  const nameCol = headerRow.findIndex((h) => norm(h) === "NAME");
  const posCol = headerRow.findIndex((h) => norm(h) === "POSITION");
  const collegeCol = headerRow.findIndex((h) => norm(h) === "COLLEGE");
  if (nameCol < 0) throw Object.assign(new Error('No "NAME" column found in that sheet.'), { code: "bad-request" });
  return rows
    .slice(1)
    .filter((r) => String(r[nameCol] || "").trim())
    .map((r) => ({
      name: String(r[nameCol] || "").trim(),
      position: posCol >= 0 ? String(r[posCol] || "").trim() : "",
      college: collegeCol >= 0 ? String(r[collegeCol] || "").trim() : "",
    }));
}

// Transfer Out Tracker: former CMU players now playing elsewhere. Name/position/college/PFF fields are
// hand-entered (admin-added/edited); each player's season stat line is never stored here at all -- it's
// looked up live, every time this renders, against the same data the Pre-Portal Tracker shows (see
// transferStats.js), so it updates automatically whenever that refreshes, with nothing to keep in sync.
export function useTransferOutTracker() {
  const [players, setPlayers] = useState({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const off = onSnapshot(
      collection(db, "transferOutPlayers"),
      (snap) => {
        const map = {};
        snap.docs.forEach((d) => {
          map[d.id] = { id: d.id, ...d.data() };
        });
        setPlayers(map);
        setReady(true);
      },
      () => setReady(true)
    );
    return off;
  }, []);

  return {
    ready,
    players: Object.values(players).sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    async addPlayer() {
      const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      await setDoc(doc(db, "transferOutPlayers", id), { name: "", position: "", college: "", pffSnaps: "", pffLink: "", createdAt: new Date().toISOString() });
      return id;
    },
    async updatePlayer(id, fields) {
      await setDoc(doc(db, "transferOutPlayers", id), fields, { merge: true });
    },
    async removePlayer(id) {
      await deleteDoc(doc(db, "transferOutPlayers", id));
    },
    // Bulk add from parseTransferSheet's output -- always ADDS new rows, never matches against players
    // already here, so don't re-import the same sheet twice.
    async importFromSheet(players) {
      const batch = writeBatch(db);
      players.forEach((p) => {
        const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}${Math.random().toString(36).slice(2, 5)}`;
        batch.set(doc(db, "transferOutPlayers", id), { ...p, pffSnaps: "", pffLink: "", createdAt: new Date().toISOString() });
      });
      await batch.commit();
    },
  };
}
