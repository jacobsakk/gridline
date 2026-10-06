import * as XLSX from "xlsx";
import { collection, deleteDoc, doc, onSnapshot, setDoc, writeBatch } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "./firebase";

// Reads a workbook shaped like the one the tracker was originally mocked up from: NAME, POSITION,
// COLLEGE, then one column per week ("WEEK 0", "WEEK 1", ...), matched case/spacing-insensitively so a
// re-exported or re-ordered sheet still works. Returns rows ready for importFromSheet below.
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
  const weekCols = [];
  headerRow.forEach((h, i) => {
    const m = norm(h).match(/^WEEK\s*(\d+)$/);
    if (m) weekCols.push({ index: i, week: Number(m[1]) });
  });
  if (nameCol < 0) throw Object.assign(new Error('No "NAME" column found in that sheet.'), { code: "bad-request" });
  const players = rows
    .slice(1)
    .filter((r) => String(r[nameCol] || "").trim())
    .map((r) => {
      const weeks = {};
      weekCols.forEach(({ index, week }) => {
        const text = String(r[index] ?? "").trim();
        if (text) weeks[String(week)] = text;
      });
      return {
        name: String(r[nameCol] || "").trim(),
        position: posCol >= 0 ? String(r[posCol] || "").trim() : "",
        college: collegeCol >= 0 ? String(r[collegeCol] || "").trim() : "",
        weeks,
      };
    });
  const weekCount = weekCols.length ? Math.max(...weekCols.map((w) => w.week)) + 1 : 1;
  return { players, weekCount };
}

// Transfer Out Tracker: a hand-maintained weekly log of former CMU players now playing elsewhere.
// Unlike every other weekly tracker in the app, there's no scraper source for this at all -- no site
// carries "snaps/tackles this week" for a transfer across every destination school -- so every field on
// every row, including which week columns even exist, is typed in and added by an admin.
export function useTransferOutTracker() {
  const [players, setPlayers] = useState({});
  const [weekCount, setWeekCount] = useState(1);
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

  useEffect(() => {
    const off = onSnapshot(
      doc(db, "transferOutMeta", "config"),
      (snap) => setWeekCount(snap.exists() ? snap.data().weekCount ?? 1 : 1),
      () => {}
    );
    return off;
  }, []);

  return {
    ready,
    players: Object.values(players).sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    weekCount,
    async addPlayer() {
      const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      await setDoc(doc(db, "transferOutPlayers", id), { name: "", position: "", college: "", weeks: {}, createdAt: new Date().toISOString() });
      return id;
    },
    async updatePlayer(id, fields) {
      await setDoc(doc(db, "transferOutPlayers", id), fields, { merge: true });
    },
    // Firestore's merge:true does a recursive merge on nested map fields, so this only ever touches
    // this one week's key -- every other week already saved for this player is untouched.
    async setWeekText(id, weekIndex, text) {
      await setDoc(doc(db, "transferOutPlayers", id), { weeks: { [String(weekIndex)]: text } }, { merge: true });
    },
    async removePlayer(id) {
      await deleteDoc(doc(db, "transferOutPlayers", id));
    },
    async addWeek() {
      await setDoc(doc(db, "transferOutMeta", "config"), { weekCount: weekCount + 1 }, { merge: true });
    },
    // One-time (or occasional) bulk load from parseTransferSheet's output -- always ADDS new rows, never
    // matches against existing ones by name, so re-running this on a sheet already imported duplicates
    // it. The tracker's own week columns grow to cover whatever the sheet had, never shrink.
    async importFromSheet({ players, weekCount: sheetWeekCount }) {
      const batch = writeBatch(db);
      players.forEach((p) => {
        const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}${Math.random().toString(36).slice(2, 5)}`;
        batch.set(doc(db, "transferOutPlayers", id), { ...p, createdAt: new Date().toISOString() });
      });
      if (sheetWeekCount > weekCount) {
        batch.set(doc(db, "transferOutMeta", "config"), { weekCount: sheetWeekCount }, { merge: true });
      }
      await batch.commit();
    },
  };
}
