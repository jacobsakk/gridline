import { addDoc, collection, deleteDoc, doc, onSnapshot, setDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "./firebase";

// Reports: a screenshot of the recruiting software's evaluation list (prospect, status, assigned and completed
// dates, coach) is read into rows -- one per prospect -- and totalled by position: how many were assigned, how
// many are done. The picture is read in the browser (nothing is uploaded anywhere); each row can be fixed by hand
// afterwards, since reading small print off a screenshot is never perfect.

// ---------------------------------------------------------------- reading the picture

let tesseractLib = null;
const loadTesseract = () => (tesseractLib ||= import("tesseract.js").then((m) => m.createWorker || m.default.createWorker));

// A picture is drawn at least this wide before it's read -- small screenshot text needs the room.
const TARGET_WIDTH = 2400;

async function pictureCanvas(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error("Choose a picture (PNG or JPG screenshot).");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That picture couldn't be opened."));
      el.src = url;
    });
    const scale = Math.max(1, Math.min(3, TARGET_WIDTH / img.naturalWidth));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// -> the rows found in one screenshot
export async function readEvaluationPicture(file, onStatus = () => {}) {
  const canvas = await pictureCanvas(file);
  onStatus("Reading the picture…");
  const createWorker = await loadTesseract();
  const worker = await createWorker("eng");
  try {
    await worker.setParameters({ tessedit_pageseg_mode: "11" });
    const result = await worker.recognize(canvas, {}, { blocks: true });
    const words = [];
    for (const b of result.data.blocks || [])
      for (const p of b.paragraphs || [])
        for (const l of p.lines || [])
          for (const w of l.words || []) words.push({ t: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 });
    const rows = parseEvaluationWords(words, canvas.width);
    // Second look at each prospect's own cell, cropped and enlarged: the small print under a name (school, class
    // year, position) reads far more reliably on its own than as part of the whole page.
    await worker.setParameters({ tessedit_pageseg_mode: "6" });
    for (let n = 0; n < rows.length; n++) {
      onStatus(`Checking prospect ${n + 1} of ${rows.length}…`);
      try {
        const b = rows[n]._box;
        const crop = document.createElement("canvas");
        const k = 2;
        crop.width = Math.round((b.x1 - b.x0) * k);
        crop.height = Math.round((b.y1 - b.y0) * k);
        const cx = crop.getContext("2d");
        cx.fillStyle = "#fff";
        cx.fillRect(0, 0, crop.width, crop.height);
        cx.imageSmoothingQuality = "high";
        cx.drawImage(canvas, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, 0, 0, crop.width, crop.height);
        const text = (await worker.recognize(crop)).data.text;
        rows[n] = mergeCell(rows[n], text);
      } catch {
        /* keep what the page-wide read found */
      }
    }
    return rows.map(({ _box, ...row }) => row);
  } finally {
    await worker.terminate();
  }
}

// ---------------------------------------------------------------- turning words into rows

export const POSITIONS = ["QB", "RB", "FB", "WR", "TE", "OL", "OT", "OG", "OC", "C", "DL", "DE", "DT", "NT", "EDGE", "LB", "OLB", "ILB", "CB", "S", "SS", "FS", "DB", "ATH", "K", "P", "LS"];
// Longest known position that starts the letters ("CBS" -> CB), since a quote mark after it often reads as a letter.
function positionFrom(token) {
  const letters = String(token || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (!letters) return "";
  if (POSITIONS.includes(letters)) return letters;
  const prefix = [...POSITIONS].sort((a, b) => b.length - a.length).find((p) => letters.startsWith(p));
  return prefix || letters.slice(0, 3);
}

const DATE = /(\d{1,2})\/(\d{1,2})\/(\d{4})/;
// A date read off the picture, kept as day only (2026-10-20); the time of day isn't wanted.
const stamp = (text) => {
  const d = DATE.exec(text);
  return d ? `${d[3]}-${d[1].padStart(2, "0")}-${d[2].padStart(2, "0")}` : "";
};
// Any date as it may be stored (2026-10-20, or an older "10/20/2026 8:11AM") -> 2026-10-20, for the date picker.
export const isoDate = (text) => (/^\d{4}-\d{2}-\d{2}$/.test(text || "") ? text : stamp(text || ""));
// 2026-10-20 -> 10/20/2026, for reading and printing.
export const shortDate = (text) => {
  const iso = isoDate(text);
  return iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}/${iso.slice(0, 4)}` : "";
};

// Column edges from the header words (Prospect, Status, Eval, Assigned, Completed, Coach); a picture cropped
// below its header falls back to where this screen puts them, as a share of the width.
const DEFAULT_EDGES = { prospect: 0.088, status: 0.215, eval: 0.34, assigned: 0.495, completed: 0.65, coach: 0.825, action: 0.935 };
function columnEdges(words, width) {
  const header = words.filter((w) => /^(prospect|status|eval|assigned|completed|coach|action)$/i.test(w.t));
  const top = header.length ? Math.min(...header.map((w) => w.y0)) : null;
  const inHeader = top == null ? [] : header.filter((w) => Math.abs(w.y0 - top) < 40);
  const at = (name) => inHeader.find((w) => w.t.toLowerCase() === name)?.x0;
  const names = ["prospect", "status", "eval", "assigned", "completed", "coach", "action"];
  const found = names.filter((n) => at(n) != null).length;
  const x = {};
  names.forEach((n) => {
    x[n] = found >= 5 && at(n) != null ? at(n) - width * 0.01 : DEFAULT_EDGES[n] * width;
  });
  return { x, headerBottom: inHeader.length ? Math.max(...inHeader.map((w) => w.y1)) : 0 };
}

const rowLines = (words) => {
  const sorted = [...words].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  const lines = [];
  sorted.forEach((w) => {
    const cy = (w.y0 + w.y1) / 2;
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.cy - cy) < (w.y1 - w.y0) * 0.6) last.words.push(w);
    else lines.push({ cy, words: [w] });
  });
  return lines.map((l) => ({ cy: l.cy, text: l.words.sort((a, b) => a.x0 - b.x0).map((w) => w.t).join(" ") }));
};

export function parseEvaluationWords(allWords, width) {
  const { x, headerBottom } = columnEdges(allWords, width);
  const words = allWords.filter((w) => w.y0 > headerBottom);
  const inColumn = (w, from, to) => w.x0 >= from - 4 && w.x0 < to - 4;
  const assignedWords = words.filter((w) => inColumn(w, x.assigned, x.completed));
  // A row starts on the line of its assigned date.
  const anchors = rowLines(assignedWords).filter((l) => DATE.test(l.text));
  const rows = [];
  anchors.forEach((a, i) => {
    const lineH = Math.max(12, ...words.filter((w) => Math.abs((w.y0 + w.y1) / 2 - a.cy) < 6).map((w) => w.y1 - w.y0));
    const from = a.cy - lineH * 0.9;
    const to = i + 1 < anchors.length ? anchors[i + 1].cy - lineH * 0.9 : Infinity;
    const band = words.filter((w) => (w.y0 + w.y1) / 2 >= from && (w.y0 + w.y1) / 2 < to);
    const col = (from_, to_) => rowLines(band.filter((w) => inColumn(w, from_, to_)));
    const prospect = col(x.prospect, x.status);
    if (!prospect.length) return;
    const name = prospect[0].text.replace(/\s+/g, " ").trim();
    const infoIdx = prospect.findIndex((l, k) => k > 0 && /^\W*20\d\d\b/.test(l.text));
    const info = infoIdx > 0 ? prospect[infoIdx].text : "";
    const school = prospect.slice(1, infoIdx > 0 ? infoIdx : undefined).map((l) => l.text).join(" ").replace(/\s+/g, " ").trim();
    const infoMatch = /^\W*(20\d\d)\s*([A-Za-z/]+)/.exec(info);
    const statusText = col(x.status, x.eval).map((l) => l.text).join(" ");
    const completedText = col(x.completed, x.coach).map((l) => l.text).join(" ");
    const assignedText = col(x.assigned, x.completed).map((l) => l.text).join(" ");
    const coachLines = col(x.coach, x.action);
    const evalType = /(\d)\s*[-–]\s*([A-Za-z ]+)/.exec(statusText);
    const bandWords = band.filter((w) => inColumn(w, x.prospect, x.status));
    const lowest = Math.max(...bandWords.map((w) => w.y1), a.cy + lineH);
    rows.push({
      _box: { x0: Math.max(0, x.prospect - 6), x1: x.status - 6, y0: Math.max(0, from), y1: Math.min(to, lowest + lineH * 0.6) },
      name,
      school,
      classYear: infoMatch ? infoMatch[1] : "",
      position: infoMatch ? positionFrom(infoMatch[2]) : "",
      evalType: evalType ? `${evalType[1]} - ${evalType[2].trim()}` : "",
      assigned: stamp(assignedText),
      completed: stamp(completedText),
      complete: !!stamp(completedText) || /complet/i.test(statusText),
      coach: coachLines[0]?.text.replace(/\s+/g, " ").trim() || "",
    });
  });
  return rows;
}

// What the cropped second read of a prospect's cell says -- name, school, then the "2027 CB 5' 11" / 190" line --
// replaces the page-wide read of the same cell wherever it found the class-and-position line.
function mergeCell(row, text) {
  const lines = String(text || "").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const infoIdx = lines.findIndex((l, k) => k > 0 && /^\W*20\d\d\b/.test(l));
  if (infoIdx < 1) return row;
  const info = /^\W*(20\d\d)\s*([A-Za-z/]+)/.exec(lines[infoIdx]);
  if (!info) return row;
  const position = positionFrom(info[2]);
  return {
    ...row,
    classYear: info[1],
    position: position || row.position,
    school: lines.slice(1, infoIdx).join(" ").trim() || row.school,
  };
}

// ---------------------------------------------------------------- totals

const ORDER = ["QB", "RB", "FB", "WR", "TE", "OL", "OT", "OG", "OC", "C", "DL", "DE", "DT", "NT", "EDGE", "LB", "OLB", "ILB", "CB", "S", "SS", "FS", "DB", "ATH", "K", "P", "LS"];
const rank = (p) => (ORDER.includes(p) ? ORDER.indexOf(p) : 100);

// -> [{ position, assigned, completed, outstanding, pct }], by position, with the grand total last.
export function summarize(rows) {
  const by = new Map();
  rows.forEach((r) => {
    const key = (r.position || "?").toUpperCase();
    const cur = by.get(key) || { position: key, assigned: 0, completed: 0 };
    cur.assigned += 1;
    if (r.complete) cur.completed += 1;
    by.set(key, cur);
  });
  const list = [...by.values()].sort((a, b) => rank(a.position) - rank(b.position) || a.position.localeCompare(b.position));
  const total = list.reduce((t, p) => ({ position: "Total", assigned: t.assigned + p.assigned, completed: t.completed + p.completed }), { position: "Total", assigned: 0, completed: 0 });
  return [...list, total].map((p) => ({ ...p, outstanding: p.assigned - p.completed, pct: p.assigned ? Math.round((p.completed / p.assigned) * 100) : 0 }));
}

// Same prospect picked up twice (two screenshots that overlap): same name and assigned time.
export const rowKey = (r) => `${String(r.name).toLowerCase().replace(/[^a-z]/g, "")}|${r.assigned}`;

// ---------------------------------------------------------------- saved reports

export function useReports() {
  const [reports, setReports] = useState([]);
  const [ready, setReady] = useState(false);
  useEffect(
    () =>
      onSnapshot(
        collection(db, "reports"),
        (snap) => {
          setReports(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))));
          setReady(true);
        },
        () => setReady(true)
      ),
    []
  );
  return {
    reports,
    ready,
    async create(title, rows, by) {
      const now = new Date().toISOString();
      const ref = await addDoc(collection(db, "reports"), { title, rows, createdAt: now, updatedAt: now, by: by || "" });
      return ref.id;
    },
    save: (id, fields) => setDoc(doc(db, "reports", id), { ...fields, updatedAt: new Date().toISOString() }, { merge: true }),
    remove: (id) => deleteDoc(doc(db, "reports", id)),
  };
}
