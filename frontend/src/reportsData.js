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
    return { canvas, scale, small: img.naturalWidth < 1000 };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// -> the rows found in one screenshot
export async function readEvaluationPicture(file, onStatus = () => {}) {
  const { canvas, scale, small } = await pictureCanvas(file);
  onStatus("Reading the picture…");
  const createWorker = await loadTesseract();
  const worker = await createWorker("eng");
  try {
    const grid = findGrid(canvas, scale);
    if (grid) {
      const rows = await readGrid(worker, canvas, grid, onStatus);
      if (rows.length) {
        rows.small = small;
        return rows;
      }
    }
    // No table lines to follow (a cropped or restyled picture): read the whole page and group the words.
    await worker.setParameters({ tessedit_pageseg_mode: "11", tessedit_char_whitelist: "" });
    const result = await worker.recognize(canvas, {}, { blocks: true });
    const words = [];
    for (const b of result.data.blocks || [])
      for (const p of b.paragraphs || [])
        for (const l of p.lines || [])
          for (const w of l.words || []) words.push({ t: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 });
    return parseEvaluationWords(words, canvas.width).map(({ _box, ...row }) => checkRow({ ...row, uid: newUid() }));
  } finally {
    await worker.terminate();
  }
}

const newUid = () => Math.random().toString(36).slice(2, 10);

// ---------------------------------------------------------------- following the table's own lines
//
// The evaluation list is a grid, and its lines are the most reliable thing in the picture: every row sits between
// two horizontal lines and every column between two vertical ones. Finding those first means each cell (name,
// dates, status, coach) can be cropped, enlarged and read on its own, instead of reading the whole page at once
// and guessing which word belongs where.

function grayOf(canvas) {
  const { width: w, height: h } = canvas;
  const px = canvas.getContext("2d").getImageData(0, 0, w, h).data;
  const g = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (px[j] * 299 + px[j + 1] * 587 + px[j + 2] * 114) / 1000;
  return { g, w, h };
}

// Centres of the runs of positions whose line-share is high.
function peaks(share, min, gap) {
  const out = [];
  let run = [];
  share.forEach((v, i) => {
    if (v >= min) run.push(i);
    else if (run.length && i - run[run.length - 1] > gap) {
      out.push(Math.round(run.reduce((a, b) => a + b, 0) / run.length));
      run = [];
    }
  });
  if (run.length) out.push(Math.round(run.reduce((a, b) => a + b, 0) / run.length));
  return out;
}

function findGrid(canvas, scale) {
  const { g, w, h } = grayOf(canvas);
  const d = Math.max(2, Math.round(1.5 * scale));
  const darker = (i, step) => g[i] < g[i - step] - 5 && g[i] < g[i + step] - 5;
  const x0 = Math.round(w * 0.04);
  const x1 = Math.round(w * 0.96);
  const hShare = new Array(h).fill(0);
  for (let y = d; y < h - d; y++) {
    let n = 0;
    for (let x = x0; x < x1; x++) if (darker(y * w + x, d * w)) n++;
    hShare[y] = n / (x1 - x0);
  }
  const ys = peaks(hShare, 0.5, d * 2);
  if (ys.length < 3) return null;
  const top = ys[0];
  const bottom = ys[ys.length - 1];
  const vShare = new Array(w).fill(0);
  for (let x = d; x < w - d; x++) {
    let n = 0;
    for (let y = top + d; y < bottom - d; y++) if (darker(y * w + x, d)) n++;
    vShare[x] = n / (bottom - top - 2 * d);
  }
  const xs = peaks(vShare, 0.5, d * 2);
  if (xs.length < 4) return null;
  return { ys, xs, w, h };
}

const COLUMN_ORDER = ["check", "prospect", "status", "eval", "assigned", "completed", "coach", "action"];
const KEYWORDS = { prospect: /prospect/i, status: /status/i, eval: /eval/i, assigned: /assign/i, completed: /complet/i, coach: /coach/i, action: /action/i };

// A cell cropped out of the page and enlarged so small print is big enough to read.
function cellCanvas(canvas, x0, x1, y0, y1, { invert = false, minHeight = 150, inset = 3 } = {}) {
  const sx = Math.round(x0 + inset);
  const sy = Math.round(y0 + inset);
  const sw = Math.max(4, Math.round(x1 - x0 - inset * 2));
  const sh = Math.max(4, Math.round(y1 - y0 - inset * 2));
  const k = Math.min(4, Math.max(1, minHeight / sh));
  const out = document.createElement("canvas");
  out.width = Math.round(sw * k) + 16;
  out.height = Math.round(sh * k) + 16;
  const cx = out.getContext("2d");
  cx.fillStyle = "#fff";
  cx.fillRect(0, 0, out.width, out.height);
  cx.imageSmoothingQuality = "high";
  cx.drawImage(canvas, sx, sy, sw, sh, 8, 8, out.width - 16, out.height - 16);
  if (invert) {
    const im = cx.getImageData(0, 0, out.width, out.height);
    for (let i = 0; i < im.data.length; i += 4) {
      im.data[i] = 255 - im.data[i];
      im.data[i + 1] = 255 - im.data[i + 1];
      im.data[i + 2] = 255 - im.data[i + 2];
    }
    cx.putImageData(im, 0, 0);
  }
  return out;
}

// A name is a link, drawn in orange; the school and the class/position line under it are dark. So where the orange
// ends is where the name ends, however many lines a long name wraps onto ("Beveridge," / "Christopher "Chris"").
function nameZone(canvas, x0, x1, y0, y1) {
  const sx = Math.round(x0);
  const sy = Math.round(y0);
  const sw = Math.max(1, Math.round(x1 - x0));
  const sh = Math.max(1, Math.round(y1 - y0));
  const px = canvas.getContext("2d").getImageData(sx, sy, sw, sh).data;
  const orange = [];
  for (let y = 0; y < sh; y++) {
    let n = 0;
    for (let x = 0; x < sw; x++) {
      const i = (y * sw + x) * 4;
      if (px[i] > 140 && px[i] - px[i + 2] > 70 && px[i] - px[i + 1] > 35) n++;
    }
    orange.push(n >= 2);
  }
  const top = orange.indexOf(true);
  if (top < 0) return null;
  const bottom = orange.lastIndexOf(true);
  let end = top;
  while (end + 1 < sh && orange[end + 1]) end++;
  // lines: how many text lines the orange covers, judged against the first line's height
  const lineH = end - top + 1;
  return { bottom: sy + bottom + 1, wraps: bottom - top + 1 > lineH * 1.7 };
}

// Does the cell hold a solid green pill (the "Complete" tag)?
function hasGreenPill(canvas, x0, x1, y0, y1) {
  const sw = Math.max(1, Math.round(x1 - x0));
  const sh = Math.max(1, Math.round(y1 - y0));
  const px = canvas.getContext("2d").getImageData(Math.round(x0), Math.round(y0), sw, sh).data;
  let green = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i + 1] > px[i] + 50 && px[i + 1] > px[i + 2] + 50 && px[i + 1] > 90) green++;
  return green / (px.length / 4) > 0.02;
}

async function readCell(worker, cell, { psm = "6", whitelist = "" } = {}) {
  await worker.setParameters({ tessedit_pageseg_mode: psm, tessedit_char_whitelist: whitelist });
  return ((await worker.recognize(cell)).data.text || "").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

const DATE_CHARS = "0123456789/:APMapm ";
// What a name is made of: letters, and the comma, quote marks, hyphen, apostrophe and full stop around them.
const NAME_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz,.'’\"“”- ";

// The lines of text in a prospect's cell: name first, then the school, then the class/position line.
export async function readProspectCell(worker, canvas, x0, x1, y0, y1) {
  // A name that wraps onto a second line is where its words get mixed into the school's; there the orange of the
  // name tells where it ends. A name on one line reads fine as part of the whole cell.
  const zone = nameZone(canvas, x0, x1, y0 + 2, y1 - 2);
  const cut = zone && zone.wraps ? zone.bottom : null;
  if (cut && cut > y0 + 6 && cut < y1 - 8) {
    const nameLines = await readCell(worker, cellCanvas(canvas, x0, x1, y0, cut + 2, { inset: 1, minHeight: 150 }), { whitelist: NAME_CHARS });
    const restLines = await readCell(worker, cellCanvas(canvas, x0, x1, cut + 1, y1, { inset: 1, minHeight: 150 }));
    if (nameLines.length) return [nameLines.join(" "), ...restLines];
  }
  return readCell(worker, cellCanvas(canvas, x0, x1, y0, y1));
}

async function readGrid(worker, canvas, grid, onStatus) {
  const { ys, xs, w } = grid;
  const edges = [0, ...xs, w];
  const intervals = edges.slice(0, -1).map((e, i) => [e, edges[i + 1]]);
  // Which column is which: from the heading words if the picture includes them (the column holding "Prospect"
  // is where the order starts), else the usual layout with a tick-box column ahead of the prospect.
  let first = 1;
  let bodyStart = 0;
  const avgRow = (ys[ys.length - 1] - ys[0]) / (ys.length - 1);
  if (ys.length > 2 && ys[1] - ys[0] < avgRow * 1.3) {
    const headCell = cellCanvas(canvas, 0, w, ys[0], ys[1], { minHeight: 90 });
    await worker.setParameters({ tessedit_pageseg_mode: "11", tessedit_char_whitelist: "" });
    const result = await worker.recognize(headCell, {}, { blocks: true });
    const heads = [];
    for (const b of result.data.blocks || [])
      for (const p of b.paragraphs || [])
        for (const l of p.lines || [])
          for (const wd of l.words || []) heads.push({ t: wd.text, cx: ((wd.bbox.x0 + wd.bbox.x1) / 2 - 8) * (w / (headCell.width - 16)) });
    if (heads.some((x) => /prospect|status|assigned|completed/i.test(x.t))) {
      bodyStart = 1;
      const p = heads.find((x) => /prospect/i.test(x.t));
      const at = p ? intervals.findIndex(([a0, a1]) => p.cx >= a0 && p.cx < a1) : -1;
      if (at >= 0) first = at;
    }
  }
  const col = {};
  COLUMN_ORDER.slice(1).forEach((k, i) => {
    if (intervals[first + i]) col[k] = intervals[first + i];
  });
  if (!col.prospect || !col.assigned || !col.completed) return [];

  const rows = [];
  const bands = [];
  for (let i = bodyStart; i + 1 < ys.length; i++) bands.push([ys[i], ys[i + 1]]);
  const heights = bands.map((b) => b[1] - b[0]).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] || 1;
  const body = bands.filter((b) => b[1] - b[0] > median * 0.45);
  for (let n = 0; n < body.length; n++) {
    const [y0, y1] = body[n];
    onStatus(`Reading prospect ${n + 1} of ${body.length}…`);
    const prospectLines = await readProspectCell(worker, canvas, col.prospect[0], col.prospect[1], y0, y1);
    if (!prospectLines.length) continue;
    const assignedLines = await readCell(worker, cellCanvas(canvas, col.assigned[0], col.assigned[1], y0, y1), { whitelist: DATE_CHARS });
    const completedLines = await readCell(worker, cellCanvas(canvas, col.completed[0], col.completed[1], y0, y1), { whitelist: DATE_CHARS });
    let statusText = "";
    let pill = false;
    if (col.status) {
      statusText = (await readCell(worker, cellCanvas(canvas, col.status[0], col.status[1], y0, y1))).join(" ");
      statusText += " " + (await readCell(worker, cellCanvas(canvas, col.status[0], col.status[1], y0, y1, { invert: true }))).join(" ");
      pill = hasGreenPill(canvas, col.status[0], col.status[1], y0, y1);
    }
    const coachLines = col.coach ? await readCell(worker, cellCanvas(canvas, col.coach[0], col.coach[1], y0, y1)) : [];

    const row = parseProspect(prospectLines);
    if (!POSITIONS.includes(row.position) || row.position === "C") {
      // The position is the one thing the totals depend on: read just the bottom line of the cell, on its own.
      const strip = cellCanvas(canvas, col.prospect[0], col.prospect[1], y1 - (y1 - y0) * 0.36, y1, { minHeight: 90 });
      const again = await readCell(worker, strip, { psm: "7", whitelist: "0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ/'\".-" });
      const info = INFO_LINE.exec(again.join(" "));
      const retry = info ? positionFrom(fixLetters(info[2])) : "";
      if (POSITIONS.includes(retry) && !(retry === "C" && row.position === "C")) {
        row.position = retry;
        row.classYear = row.classYear || info[1];
        if (row.school && INFO_LINE.test(row.school)) row.school = row.school.replace(INFO_LINE, "").trim();
      }
    }
    const assigned = stamp(assignedLines.join(" "));
    const completed = stamp(completedLines.join(" "));
    const evalType = /(\d)\s*[-–]\s*([A-Za-z ]+?)(?:\s+complete\b|$)/i.exec(statusText);
    const thumb = cellCanvas(canvas, col.prospect[0], col.prospect[1], y0, y1, { minHeight: 90 });
    rows.push(
      checkRow({
        uid: newUid(),
        ...row,
        evalType: evalType ? `${evalType[1]} - ${evalType[2].trim()}` : "",
        assigned,
        completed,
        complete: !!completed || pill || /complet/i.test(statusText),
        coach: (coachLines[0] || "").replace(/\s+/g, " ").trim(),
        thumb: thumb.toDataURL("image/jpeg", 0.7),
      })
    );
  }
  return rows;
}

// Look-alike characters the reader mixes up, put right where only letters make sense.
const LETTERISH = { 0: "O", 1: "I", 5: "S", 8: "B", 6: "G" };
const fixLetters = (t) => String(t).replace(/[0-9]/g, (d) => LETTERISH[d] || d);

// "Clark, lvin" -> "Clark, Ivin"; stray marks around a nickname made straight quotes.
function cleanName(text) {
  return String(text || "")
    .replace(/^[^A-Za-z]+/, "")
    .replace(/[“”„‟″❝❞«»*]|''/g, '"')
    .replace(/(^|[\s,"])l(?=[a-z])/g, "$1I")
    .replace(/\s+/g, " ")
    .trim();
}

// A school line: "lowa Central Community College, 1A" -> "Iowa Central Community College, IA".
function cleanSchool(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/^lowa\b/, "Iowa")
    .replace(/,\s*([A-Z0-9]{2})\s*$/, (m, st) => `, ${fixLetters(st)}`)
    .trim();
}

const INFO_LINE = /^\W*(20\d\d)\s*([A-Za-z0-9/]{1,5})/;

// A prospect's cell: the name, then the school, then the "2027 CB 5' 11" / 190" line.
function parseProspect(lines) {
  let infoIdx = -1;
  for (let i = lines.length - 1; i > 0; i--) {
    if (/^\W*20\d\d/.test(lines[i])) {
      infoIdx = i;
      break;
    }
  }
  const info = infoIdx > 0 ? INFO_LINE.exec(lines[infoIdx]) : null;
  // A long name wraps: "Beveridge," then "Christopher "Chris"", or a nickname on a line of its own. The first
  // line takes a following line while it ends in a comma, and any line that opens with a quote mark.
  let nameEnd = 1;
  if (/,\s*$/.test(lines[0]) && lines[1] && nameEnd < (infoIdx > 0 ? infoIdx : lines.length)) nameEnd = 2;
  while (lines[nameEnd] && /^[“”"*]/.test(lines[nameEnd]) && nameEnd < (infoIdx > 0 ? infoIdx : lines.length) - 1) nameEnd++;
  return {
    name: cleanName(lines.slice(0, nameEnd).join(" ")),
    school: cleanSchool(lines.slice(nameEnd, infoIdx > 0 ? infoIdx : undefined).join(" ")),
    classYear: info ? info[1] : "",
    position: info ? positionFrom(fixLetters(info[2])) : "",
  };
}

// What looks wrong in a row, so the page can point at it: a position that isn't one, a date that isn't a date
// (or that is implausible), a name that doesn't read like "Last, First".
export function checkRow(row) {
  const flags = [];
  const year = new Date().getFullYear();
  const okDate = (iso) => {
    if (!iso) return false;
    const [y, m, d] = iso.split("-").map(Number);
    return y >= year - 2 && y <= year + 1 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
  };
  const name = row.name || "";
  if (!/^[A-Za-z][A-Za-z'’.\- ]*,\s*\S/.test(name) || /[®©™|\[\]{}*_]/.test(name) || (name.match(/"/g) || []).length % 2 === 1) flags.push("name");
  if (!POSITIONS.includes(row.position)) flags.push("position");
  if (!row.school || /,\s*$/.test(row.school)) flags.push("school");
  if (!okDate(row.assigned)) flags.push("assigned");
  if (row.complete && !okDate(row.completed)) flags.push("completed");
  if (okDate(row.assigned) && okDate(row.completed) && row.completed < row.assigned) flags.push("completed");
  return { ...row, flags };
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
export const stamp = (text) => {
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
