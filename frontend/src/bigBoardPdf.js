import { blankPlayer, nameKey, positionAbbreviation } from "./bigBoardData.js";

// The whole board from the ARMs board PDF. That PDF is a "print to PDF" of the web page: every word is drawn
// as shapes (nothing to copy out), the board is turned sideways, and it's cut into page-sized tiles -- a tile
// per row of position columns (named across the top) followed by plain "overflow" tiles for the columns too
// long to fit. Pages are turned upright and read with OCR; the structure comes from where things sit:
//   - each recruit's photo marks the top of his card, each maroon number badge marks a TIER header;
//   - the card's text gives name, position, school, coach, rating, status, visit, height and weight;
//   - the card's border colour is the status colour of the board (gold committed, green offered, ...);
//   - a column's title is the text above it on a main tile, and an overflow tile's columns are the columns of
//     the tile before it that ran to the bottom, in the same left-to-right order.
// The photos are taken from the pictures stored in the PDF, so they are sharp and upright.

let libs = null;
function loadLibs() {
  libs ||= (async () => {
    const pdfjs = await import("pdfjs-dist/build/pdf.min.mjs");
    const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const tesseract = await import("tesseract.js");
    return { pdfjs, createWorker: tesseract.createWorker || tesseract.default.createWorker };
  })();
  return libs;
}

// How big the pages are drawn for reading: the card text is small, so digits (height, weight) need the room.
const SCALE = 6;
// The columns the board can have, in board order.
const COLUMN_LABELS = ["QB", "RB", "WR", "TE", "OT", "OG/OC", "FLEX BIG", "FLEX SKILL", "DE", "DT", "LB", "CB", "SAF", "LS", "K", "P"];
const COLUMN_SIDES = { off: ["QB", "RB", "WR", "TE", "OT", "OG/OC", "FLEX BIG", "FLEX SKILL"], def: ["DE", "DT", "LB", "CB", "SAF", "FLEX BIG", "FLEX SKILL", "LS", "K", "P"] };
const SIDE_TITLES = { off: "HIGH SCHOOL OFFENSIVE BIG BOARD", def: "HIGH SCHOOL DEFENSIVE/SPEC BIG BOARD" };

const STATE_CODES = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY",
  louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO",
  montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};

function distance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

// Every picture drawn on the page, as a box in the (upright) canvas's pixels.
async function pictureBoxes(page, viewport, OPS) {
  const list = await page.getOperatorList();
  const boxes = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  list.fnArray.forEach((fn, i) => {
    const args = list.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.paintImageXObject) {
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => viewport.convertToViewportPoint(ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]));
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      boxes.push({ x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y, name: args[0] });
    }
  });
  return boxes;
}

const isSquarePicture = (b) => b.w > 16 * SCALE && b.w < 60 * SCALE && Math.abs(b.w / b.h - 1) < 0.2;

function makeCanvas(w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  return canvas;
}

// How maroon (a tier badge) and how colourless (a placeholder silhouette) a picture is.
function sampleStats(canvas, box) {
  const t = makeCanvas(12, 12);
  const ctx = t.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, 12, 12);
  const d = ctx.getImageData(0, 0, 12, 12).data;
  let maroon = 0;
  let sat = 0;
  const n = 144;
  for (let i = 0; i < n; i++) {
    const r = d[i * 4];
    const g = d[i * 4 + 1];
    const b = d[i * 4 + 2];
    if (r > 70 && r < 150 && g < 45 && b > 20 && b < 90) maroon++;
    sat += Math.max(r, g, b) - Math.min(r, g, b);
  }
  return { maroon: maroon / n, sat: sat / n / 255 };
}

// The photo, from the picture stored in the PDF (square, always upright), shrunk to a size worth storing.
function pictureToPhoto(page, box, fallbackCanvas) {
  const out = makeCanvas(180, 180);
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 180, 180);
  let drawn = false;
  try {
    const obj = page.objs.get(box.name);
    if (obj?.bitmap) {
      ctx.drawImage(obj.bitmap, 0, 0, 180, 180);
      drawn = true;
    } else if (obj?.data && obj.width && obj.height) {
      const px = obj.width * obj.height;
      const step = obj.data.length / px;
      const rgba = new Uint8ClampedArray(px * 4);
      for (let i = 0; i < px; i++) {
        rgba[i * 4] = obj.data[i * step];
        rgba[i * 4 + 1] = obj.data[i * step + (step >= 3 ? 1 : 0)];
        rgba[i * 4 + 2] = obj.data[i * step + (step >= 3 ? 2 : 0)];
        rgba[i * 4 + 3] = 255;
      }
      const full = makeCanvas(obj.width, obj.height);
      full.getContext("2d").putImageData(new ImageData(rgba, obj.width, obj.height), 0, 0);
      ctx.drawImage(full, 0, 0, 180, 180);
      drawn = true;
    }
  } catch {
    drawn = false;
  }
  if (!drawn) ctx.drawImage(fallbackCanvas, box.x, box.y, box.w, box.h, 0, 0, 180, 180);
  return out.toDataURL("image/jpeg", 0.82);
}

function crop(source, x, y, w, h) {
  const sx = Math.max(0, Math.round(x));
  const sy = Math.max(0, Math.round(y));
  const sw = Math.min(source.width - sx, Math.round(w - (sx - x)));
  const sh = Math.min(source.height - sy, Math.round(h - (sy - y)));
  if (sw < 6 || sh < 6) return null;
  const out = makeCanvas(sw, sh);
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, sw, sh);
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
}

// The colour of a card's border -- the board's status colour -- from the first strongly coloured pixel left of
// the photo: gold is committed, green offered, blue offer status, red committed elsewhere, purple a partial.
function borderStatus(canvas, box) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const votes = {};
  for (const frac of [0.3, 0.5, 0.7]) {
    const y = Math.round(box.y + box.h * frac);
    const x0 = Math.max(0, Math.round(box.x - box.w * 0.9));
    const width = Math.max(1, Math.round(box.x - x0));
    const strip = ctx.getImageData(x0, y, width, 1).data;
    for (let i = width - 1; i >= 0; i--) {
      const r = strip[i * 4];
      const g = strip[i * 4 + 1];
      const b = strip[i * 4 + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max < 90 || max - min < 55) continue;
      const d = max - min;
      let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
      const status = h < 18 || h > 335 ? "elsewhere" : h < 70 ? "committed" : h < 170 ? "offered" : h < 255 ? "offerStatus" : "recruit";
      votes[status] = (votes[status] || 0) + 1;
      break;
    }
  }
  const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : "recruit";
}

// How far down a column's content runs (the last row with anything on it).
function columnBottom(canvas, x, w) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const sx = Math.max(0, Math.round(x));
  const sw = Math.max(1, Math.round(Math.min(w, canvas.width - sx)));
  const data = ctx.getImageData(sx, 0, sw, canvas.height).data;
  for (let row = canvas.height - 1; row >= 0; row--) {
    for (let col = 0; col < sw; col += 2) {
      const o = (row * sw + col) * 4;
      if (data[o] < 235 || data[o + 1] < 235 || data[o + 2] < 235) return row;
    }
  }
  return 0;
}

function nearestLabel(text) {
  const raw = String(text || "").toUpperCase().replace(/[^A-Z/ ]/g, "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  let best = null;
  COLUMN_LABELS.forEach((label) => {
    const d = distance(raw, label) / Math.max(label.length, 2);
    if (!best || d < best.d) best = { label, d };
  });
  return best && best.d <= 0.34 ? best.label : null;
}

// "6' 2.25\" 187" -> { height: "6'2.25\"", weight: "187" }. The last number is the weight; a number before it
// (after the feet mark) is the inches -- so "6' 199" is six feet flat and 199 pounds, not 6'19".
function parseHeightWeight(text) {
  const t = String(text || "");
  // The feet mark is an apostrophe, but the reader sometimes gives a quote or two (5"9'').
  const feet = /(\d)\s*['’`´"”]{1,2}(?=\s*\d|\s|$)/.exec(t) || /\b([4-7])\s*['’`´"”]+/.exec(t);
  const rest = feet ? t.slice(feet.index + feet[0].length) : t;
  const nums = [...rest.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]);
  const weight = nums.length && /^\d{2,3}$/.test(nums[nums.length - 1]) ? nums[nums.length - 1] : "";
  const inches = feet && nums.length >= (weight ? 2 : 1) ? nums[weight ? nums.length - 2 : nums.length - 1] : "";
  const inchesOk = inches && Number(inches) < 12 ? inches : "";
  return { height: feet ? `${feet[1]}'${inchesOk ? `${inchesOk}"` : ""}` : "", weight };
}

// A card's text -> its fields. The text comes from OCR, so it is read forgivingly: a label is found by its key
// words and a value is whatever follows it on the line (or on the next line, for a long value). The header
// (name, position, school, state) is read from the strip beside the photo and the rest from below it, so the
// photo's edge never bleeds into the name.
export function parseCardText(headerText, bodyText) {
  const headerAll = String(headerText || "").split("\n").map((l) => l.trim()).filter(Boolean);
  // The strip can run into the next row (the year, the coach), which is not part of the header.
  const stop = headerAll.findIndex((l) => /GRAD|COACH|ASSIGN|RATING|PROSPECT|\b20\d\d\b/i.test(l));
  const lines = stop >= 0 ? headerAll.slice(0, stop) : headerAll;
  const posIdx = lines.findIndex((l) => /^[^a-z]{0,3}(quarterback|running back|fullback|wide receiver|tight end|offensive|defensive|linebacker|cornerback|safety|kicker|long snapper|punter|athlete)/i.test(l));
  const barIdx = lines.findIndex((l) => l.includes("|"));
  const firstDetail = posIdx >= 0 ? posIdx : barIdx;
  const nameLines = firstDetail > 0 ? lines.slice(0, firstDetail) : lines.slice(0, 1);
  // Whole words of letters only: stray marks from the photo's edge or a smudged word are dropped.
  const name = nameLines
    .join(" ")
    .split(/\s+/)
    .filter((w) => /^[A-Za-z][A-Za-z.'’-]*$/.test(w) && (w.length > 1 || /^[A-Z]$/.test(w)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const header = (firstDetail >= 0 ? lines.slice(firstDetail) : []).join(" ");
  const parts = header.split("|").map((p) => p.trim()).filter(Boolean);
  // The reader garbles the odd word ("Offensive Ve] Ma"), so the position is the title it most resembles.
  const positionTitle = POSITION_TITLES.find(([re]) => re.test(parts[0] || ""))?.[1] || (parts[0] || "");
  let school = (parts[1] || "").replace(/\s+(high school|high|hs)$/i, "").trim();
  const stateText = (parts[2] || "").replace(/[^A-Za-z ]/g, "").trim().toLowerCase();
  let state = STATE_CODES[stateText] || "";
  if (!state && stateText) {
    const near = Object.entries(STATE_CODES).map(([n, c]) => [distance(stateText, n) / n.length, c]).sort((a, b) => a[0] - b[0])[0];
    if (near && near[0] <= 0.25) state = near[1];
  }
  if (!state) {
    // No "| State" part came through: a state name left at the end of what was read (longest names first,
    // so "West Virginia" isn't taken for "Virginia").
    const tail = header.replace(/[^A-Za-z ]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    const hit = Object.keys(STATE_CODES).sort((a, b) => b.length - a.length).find((n) => tail.endsWith(n));
    if (hit) {
      state = STATE_CODES[hit];
      if (!parts[1]) school = "";
    }
  }
  const bodyAll = String(bodyText || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const gradIdx = bodyAll.findIndex((l) => /GRAD\.?\s*YEAR|GRAD\s*YE|ASSIGNED\s*COACH/i.test(l));
  const body = gradIdx >= 0 ? bodyAll.slice(gradIdx) : bodyAll;
  const labels = /GRAD|ASSIGNED|RATING|PROSPECT|MID\s*YEAR|LAST\s*VISIT|HEIGHT|WEIGHT/i;
  const valueOf = (re) => {
    const i = body.findIndex((l) => re.test(l));
    if (i < 0) return "";
    const same = body[i].replace(re, "").replace(/^[:\s]+/, "").trim();
    if (same) return same;
    const next = body[i + 1] || "";
    return labels.test(next) ? "" : next;
  };
  const gradYear = (/(20\d{2})/.exec(valueOf(/GRAD\.?\s*YEAR/i)) || [])[1] || "";
  const coach = valueOf(/ASSIGNED\s*COACH/i);
  const ratingLabel = valueOf(/^RATING/i);
  const prospectStatus = valueOf(/PROSPECT\s*STATUS/i);
  const midYear = /yes/i.test(valueOf(/MID\s*YEAR\s*ENROLLEE/i));
  const lastVisit = (/(\d{4}-\d{2}-\d{2})/.exec(body.join(" ").replace(/\s+/g, "")) || [])[1] || "";
  const hwIdx = body.findIndex((l) => /HEIGHT/i.test(l) && /WEIGHT/i.test(l));
  const { height, weight } = parseHeightWeight(hwIdx >= 0 ? body.slice(hwIdx + 1).join(" ") : body.slice(-2).join(" "));
  return { name, positionTitle, school, state, gradYear, coach, ratingLabel, prospectStatus, midYear, lastVisit, height, weight };
}

const POSITION_TITLES = [
  [/quarter/i, "Quarterback"], [/running|runni/i, "Running Back"], [/fullback/i, "Fullback"], [/wide|receiv/i, "Wide Receiver"],
  [/tight/i, "Tight End"], [/offensive|offens/i, "Offensive Line"], [/defensive|defens/i, "Defensive Line"], [/linebac/i, "Linebacker"],
  [/cornerb|corner/i, "Cornerback"], [/safety/i, "Safety"], [/kicker|punter/i, "Kicker-Punter"], [/snapper/i, "Long Snapper"], [/athlete/i, "Athlete"],
];

// A cheap look at a tile with no OCR: whether it has column names above its first row, and how many columns.
async function peekTile(pdf, n, pdfjs) {
  const page = await pdf.getPage(n);
  const viewport = page.getViewport({ scale: SCALE, rotation: 90 });
  const pics = (await pictureBoxes(page, viewport, pdfjs.OPS)).filter(isSquarePicture);
  if (!pics.length) return { hasLabels: false, columns: 0 };
  const s = pics.reduce((sum, b) => sum + b.w, 0) / pics.length;
  const xs = [...new Set(pics.map((b) => Math.round(b.x)))].sort((a, b) => a - b);
  let columns = 0;
  let last = -1e9;
  xs.forEach((x) => {
    if (x - last >= s * 2.2) columns++;
    last = x;
  });
  return { hasLabels: Math.min(...pics.map((b) => b.y)) > 18 * SCALE, columns };
}

// -> { cards, photos: [{ name, photo }], pages }
export async function readBoardPdf(file, knownNames = [], onProgress = () => {}) {
  const { pdfjs, createWorker } = await loadLibs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const worker = await createWorker("eng");
  const read = async (canvas, psm) => {
    await worker.setParameters({ tessedit_pageseg_mode: String(psm) });
    return (await worker.recognize(canvas)).data.text;
  };
  const cards = [];
  let overflowQueue = null;
  let lastLabel = "";
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      onProgress({ page: n, pages: pdf.numPages, cards: cards.length });
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: SCALE, rotation: 90 });
      const canvas = makeCanvas(viewport.width, viewport.height);
      await page.render({ canvasContext: canvas.getContext("2d", { willReadFrequently: true }), viewport }).promise;
      const pics = (await pictureBoxes(page, viewport, pdfjs.OPS)).filter(isSquarePicture);
      if (!pics.length) {
        overflowQueue = null;
        continue;
      }
      const s = Math.round(pics.reduce((sum, b) => sum + b.w, 0) / pics.length);
      const items = pics
        .filter((b) => b.w > s * 0.8 && b.w < s * 1.25)
        .map((b) => {
          const st = sampleStats(canvas, b);
          return { ...b, ...st, kind: st.maroon > 0.4 ? "badge" : "photo" };
        });

      // Columns: the picture left edges, grouped left to right (a badge and a photo in one column sit within
      // a couple of photo-widths of each other).
      const lefts = [...new Set(items.map((b) => Math.round(b.x)))].sort((a, b) => a - b);
      const starts = [];
      lefts.forEach((x) => {
        if (!starts.length || x - starts[starts.length - 1] >= s * 2.2) starts.push(x);
      });
      const pitch = s * 5.2;
      const cols = starts.map((x0, i) => {
        const x1 = starts[i + 1] != null ? starts[i + 1] - s * 0.5 : Infinity;
        return { x: x0, items: items.filter((b) => b.x >= x0 - s * 0.3 && b.x < x1).sort((a, b) => a.y - b.y) };
      });

      // A main tile has the column names above its first row of pictures.
      const topOfItems = Math.min(...items.map((b) => b.y));
      let labels = [];
      let isMain = false;
      if (topOfItems > 18 * SCALE) {
        for (const c of cols) {
          const first = c.items[0];
          const strip = crop(canvas, c.x - s * 0.15, first.y - s * 1.5, s * 4.6, s * 1.3);
          labels.push(strip ? nearestLabel(await read(strip, 7)) : null);
        }
        // Room above the first row is a main tile; so is reading most of the titles. A tile that follows a
        // full one with nothing to continue (a lone "P" column) is main even when its title is unreadable.
        isMain = labels.filter(Boolean).length >= Math.max(1, Math.ceil(cols.length / 2)) || !overflowQueue;
      }
      // A title the reader couldn't make out (a lone "P" is easy to lose) is the next one along the board's
      // usual order after the column before it.
      if (isMain) {
        let prev = lastLabel;
        labels = labels.map((label) => {
          const use = label || COLUMN_LABELS[COLUMN_LABELS.indexOf(prev) + 1] || "";
          prev = use;
          return use;
        });
        lastLabel = labels[labels.length - 1] || lastLabel;
      }
      const named = cols.map((c, i) => ({
        c,
        label: isMain ? labels[i] || "" : overflowQueue?.[i]?.label || "",
        tier: isMain ? 1 : overflowQueue?.[i]?.tier || 1,
      }));

      const finished = [];
      for (const col of named) {
        let tier = col.tier;
        const its = col.c.items;
        for (let i = 0; i < its.length; i++) {
          const it = its[i];
          if (it.kind === "badge") {
            const strip = crop(canvas, it.x + it.w * 1.0, it.y, s * 2.4, it.h);
            const t = strip ? await read(strip, 7) : "";
            // "TIER 2": the number after the word (a 1 can read as I, l or |). Not the first digit-like
            // character, which is the I in TIER itself.
            const after = /T\s*[I1l|]\s*E\s*R\s*([1-9Il|])/i.exec(t);
            const digit = after ? (/[Il|]/.test(after[1]) ? 1 : Number(after[1])) : Number((/([1-9])\s*$/.exec(t.trim()) || [])[1]);
            if (digit) tier = digit;
            continue;
          }
          const top = it.y - s * 0.2;
          const bottom = its[i + 1] ? its[i + 1].y - s * 0.1 : Math.min(canvas.height, it.y + s * 6.2);
          // The strip beside the photo holds the name and position line; everything else is below it.
          const headerStrip = crop(canvas, it.x + it.w + s * 0.12, top, s * 3.45, Math.min(bottom - top, s * 2.6));
          const bodyStrip = crop(canvas, it.x - s * 0.25, it.y + it.h * 0.95, s * 4.7, bottom - (it.y + it.h * 0.95));
          const fields = parseCardText(headerStrip ? await read(headerStrip, 6) : "", bodyStrip ? await read(bodyStrip, 6) : "");
          if (fields.name.length < 3) continue;
          cards.push({
            columnLabel: col.label,
            tier,
            status: borderStatus(canvas, it),
            ...fields,
            photo: it.sat < 0.05 ? "" : pictureToPhoto(page, it, canvas),
          });
          onProgress({ page: n, pages: pdf.numPages, cards: cards.length });
        }
        finished.push({ label: col.label, x: col.c.x, tier, bottom: columnBottom(canvas, col.c.x, pitch * 0.95) });
      }

      // The next tile is an overflow tile if it has no column names: it holds this tile's tallest columns, in
      // the same left-to-right order.
      overflowQueue = null;
      if (n < pdf.numPages) {
        const next = await peekTile(pdf, n + 1, pdfjs);
        if (!next.hasLabels && next.columns > 0) {
          overflowQueue = [...finished].sort((a, b) => b.bottom - a.bottom).slice(0, next.columns).sort((a, b) => a.x - b.x);
        }
      }
      canvas.width = 1;
      canvas.height = 1;
    }
  } finally {
    await worker.terminate();
  }

  // Tidy the names against people already known (the OCR can slip a letter).
  const known = knownNames.map((name) => ({ name, key: nameKey(name) }));
  cards.forEach((c) => {
    const key = nameKey(c.name);
    if (!key) return;
    const near = known.map((k) => ({ k, d: distance(key, k.key) / Math.max(key.length, k.key.length) })).sort((a, b) => a.d - b.d)[0];
    if (near && near.d <= 0.25) c.name = near.k.name;
  });
  const photos = new Map();
  cards.forEach((c) => {
    const key = nameKey(c.name);
    if (c.photo && key && !photos.has(key)) photos.set(key, { name: c.name, photo: c.photo });
  });
  return { cards, photos: [...photos.values()], pages: pdf.numPages };
}

// The cards -> the two boards (offense; defense and specialists). The flex columns are shown whole on both.
export function boardsFromCards(cards, classYear) {
  const out = {};
  ["off", "def"].forEach((side) => {
    const columns = COLUMN_SIDES[side].map((label) => ({ key: label.replace(/[^A-Z0-9]+/g, "-"), label, hasRating: !["LS", "K", "P"].includes(label), players: [] }));
    cards.forEach((c) => {
      const isFlex = /^FLEX/.test(c.columnLabel);
      // A flex column is shown whole on both boards (as on the staff sheets); every other column on its own side.
      if (!isFlex && !COLUMN_SIDES[side].includes(c.columnLabel)) return;
      const col = columns.find((x) => x.label === c.columnLabel);
      if (!col) return;
      col.players.push({
        ...blankPlayer(c.tier),
        name: c.name,
        school: c.school,
        state: c.state,
        measurables: [c.height, c.weight].filter(Boolean).join(" "),
        status: c.status,
        gradYear: c.gradYear || "",
        coach: c.coach || "",
        ratingLabel: c.ratingLabel || "",
        prospectStatus: c.prospectStatus || "",
        lastVisit: c.lastVisit || "",
        midYear: !!c.midYear,
        pos: positionAbbreviation(c.positionTitle),
        tier: c.tier,
      });
    });
    out[side] = { title: `${SIDE_TITLES[side]} - ${classYear}`, columns, source: "pdf" };
  });
  return out;
}
