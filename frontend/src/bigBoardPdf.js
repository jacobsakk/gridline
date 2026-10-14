import { nameKey } from "./bigBoardData.js";

// Photos from the ARMs board PDF. That PDF is a "print to PDF" of the web page, so its text is drawn as shapes
// (nothing to copy out) but each recruit's photo is a real picture. The photos are found by position, the
// printed name beside each is read with OCR, and that is matched to the closest card name on the uploaded
// board -- so a wrong guess of the reader is corrected by the names we already know.

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

const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

// Every picture drawn on the page, as a box in canvas pixels.
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
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => viewport.convertToViewportPoint(ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]));
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      boxes.push({ x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y, name: fn === OPS.paintImageXObject ? args[0] : null });
    }
  });
  return boxes;
}

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

// The closest candidate to what the reader saw at the start of the name line; null if nothing is close.
export function matchName(readText, candidates) {
  const lines = String(readText || "").split("\n").map((l) => nameKey(l)).filter((l) => l.length >= 4);
  let best = null;
  for (const line of lines.slice(0, 3)) {
    for (const cand of candidates) {
      const key = nameKey(cand.name);
      if (key.length < 4) continue;
      // The line may run on into the next words of the card, so compare against its same-length start.
      const score = Math.min(...[-1, 0, 1].map((d) => distance(line.slice(0, key.length + d), key) / key.length));
      if (!best || score < best.score) best = { cand, score };
    }
  }
  return best && best.score <= 0.25 ? best : null;
}

function makeCanvas(w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  return canvas;
}

// The photo itself, from the picture stored in the PDF (always upright -- cutting it out of the rendered page
// would come out turned like the sideways board), shrunk square to a size worth storing (about 10-15 KB).
function pictureToPhoto(page, box, fallbackCanvas) {
  const out = makeCanvas(180, 180);
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 180, 180);
  let drawn = false;
  try {
    const obj = box.name ? page.objs.get(box.name) : null;
    if (obj?.bitmap) {
      ctx.drawImage(obj.bitmap, 0, 0, 180, 180);
      drawn = true;
    } else if (obj?.data && obj.width && obj.height) {
      const rgba = new Uint8ClampedArray(obj.width * obj.height * 4);
      const px = obj.width * obj.height;
      const step = obj.data.length / px; // 3 = RGB, 4 = RGBA
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

// The name printed to the right of a photo. The board is printed sideways (its right is the page's up and
// its down is the page's right), so the strip beside the photo is cut out and turned upright to be read.
function cropNameStrip(source, box, turn) {
  const s = Math.max(box.w, box.h);
  const sx = box.x - s * 0.05;
  const sw = s * 1.0;
  const sy = Math.max(0, box.y - s * 4.8);
  const sh = box.y + s * 0.05 - sy;
  if (sh < 4) return null;
  const out = turn === "cw" ? makeCanvas(sh, sw) : makeCanvas(sh, sw);
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  if (turn === "cw") {
    ctx.translate(out.width, 0);
    ctx.rotate(Math.PI / 2);
  } else {
    ctx.translate(0, out.height);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
}

// -> { matches: [{ name, key, photo, read, score }], pictures, pages }
export async function extractPdfPhotos(file, candidates, onProgress = () => {}) {
  const { pdfjs, createWorker } = await loadLibs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  onProgress({ stage: "ocr", page: 0, pages: pdf.numPages, found: 0 });
  const worker = await createWorker("eng");
  await worker.setParameters({ tessedit_pageseg_mode: "6" });
  const SCALE = 4;
  const byKey = new Map();
  let pictures = 0;
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: SCALE });
      const canvas = makeCanvas(viewport.width, viewport.height);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      const boxes = (await pictureBoxes(page, viewport, pdfjs.OPS)).filter((b) => b.w > 14 * SCALE && b.w < 90 * SCALE && b.h > 14 * SCALE && b.h < 90 * SCALE && Math.abs(b.w / b.h - 1) < 0.25);
      let turn = "cw"; // the direction that worked on this page; tried first for the rest
      for (const box of boxes) {
        pictures++;
        let hit = null;
        let read = "";
        for (const t of [turn, turn === "cw" ? "ccw" : "cw"]) {
          const strip = cropNameStrip(canvas, box, t);
          if (!strip) continue;
          read = (await worker.recognize(strip)).data.text;
          hit = matchName(read, candidates);
          if (hit) {
            turn = t;
            break;
          }
        }
        if (hit) {
          const key = nameKey(hit.cand.name);
          const prev = byKey.get(key);
          if (!prev || hit.score < prev.score) byKey.set(key, { name: hit.cand.name, key, photo: pictureToPhoto(page, box, canvas), read: read.split("\n")[0].trim(), score: hit.score });
        }
        onProgress({ stage: "ocr", page: n, pages: pdf.numPages, found: byKey.size });
      }
      canvas.width = 1;
      canvas.height = 1;
    }
  } finally {
    await worker.terminate();
  }
  return { matches: [...byKey.values()], pictures, pages: pdf.numPages };
}
