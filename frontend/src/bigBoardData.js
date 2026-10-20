import * as XLSX from "xlsx";
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, where, writeBatch } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { db } from "./firebase";

// The Big Board: one board per class year (and a JUCO board), offense and defense/specialists, plus the
// credit evaluation table. Read from the staff's own workbook (OFF / DEF / HS CREDIT EVAL sheets) so the
// board can be laid out for print and edited afterward instead of living only in the spreadsheet.

// A card's colour is the recruit's status on the sheet's key (the cell's fill colour in the workbook).
export const STATUSES = [
  { key: "committed", label: "Committed", color: "#FBAB18", rgb: [0xfb, 0xab, 0x18] },
  { key: "offered", label: "Offered", color: "#B6D7A8", rgb: [0xb6, 0xd7, 0xa8] },
  { key: "offerStatus", label: "Offer status", color: "#A4C2F4", rgb: [0xa4, 0xc2, 0xf4] },
  { key: "recruit", label: "Recruit status", color: "#CCCCCC", rgb: [0xcc, 0xcc, 0xcc] },
  { key: "elsewhere", label: "Committed elsewhere", color: "#EA9999", rgb: [0xea, 0x99, 0x99] },
];
export const STATUS_BY_KEY = Object.fromEntries(STATUSES.map((s) => [s.key, s]));

// The A / P / C / R trend emojis on each card (Academics, Production, Character, Recruitability on the sheet).
export const TRENDS = [
  { key: "fire", emoji: "🔥", label: "Fire: this is our type of guy" },
  { key: "heating", emoji: "🌤️", label: "Heating up: trending upward" },
  { key: "cooling", emoji: "🌨️", label: "Cooling down: trending downward" },
  { key: "ice", emoji: "🧊", label: "Ice: not our type of guy" },
];
const TREND_BY_EMOJI = { "🔥": "fire", "🌤": "heating", "🌨": "cooling", "🧊": "ice" };
export const RATING_KEYS = ["A", "P", "C", "R"];

// Markers after a name on the sheet.
export const FLAGS = [
  { key: "snap", marker: "$", label: "Long snap or short snap" },
  { key: "punt", marker: "#", label: "Punt return" },
  { key: "noMidYear", marker: "🚫", label: "Cannot mid-year" },
  { key: "injured", marker: "⛑️", label: "Injured / injury history" },
];
export const VISITS = [
  { marker: "✈️", label: "Coming on official visit" },
  { marker: "🚗", label: "Has been on unofficial visit" },
  { marker: "🏠", label: "Home visit" },
];

export const nameKey = (name) => String(name || "").toLowerCase().replace(/[^a-z]/g, "");
const newId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const stripVs = (s) => String(s || "").replace(/️/g, "");

const addr = (r, c) => XLSX.utils.encode_cell({ r, c });
const cellText = (ws, r, c, formatted = false) => {
  const cell = ws[addr(r, c)];
  if (!cell || cell.v == null) return "";
  return formatted && cell.w != null ? String(cell.w) : String(cell.v);
};
const cellFill = (ws, r, c) => ws[addr(r, c)]?.s?.fgColor?.rgb || "";

// Nearest of the five key colours (a player cell is always one of them; the nearest match tolerates a
// slightly different shade). Anything with no fill reads as "recruit status".
function statusFromFill(rgb) {
  const m = /^[0-9a-f]{6}$/i.exec(rgb || "");
  if (!m) return "recruit";
  const v = [0, 2, 4].map((i) => parseInt(rgb.slice(i, i + 2), 16));
  let best = STATUSES[3];
  let bestD = Infinity;
  STATUSES.forEach((s) => {
    const d = s.rgb.reduce((sum, x, i) => sum + (x - v[i]) ** 2, 0);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  });
  return best.key;
}

function parseRating(text) {
  const out = { A: "", P: "", C: "", R: "" };
  String(text || "")
    .split("\n")
    .forEach((line) => {
      const m = /^\s*([APCR])\s*:\s*(.*)$/i.exec(line);
      if (!m) return;
      const emoji = stripVs(m[2]).trim().slice(0, 2);
      const hit = Object.keys(TREND_BY_EMOJI).find((e) => emoji.startsWith(e));
      if (hit) out[m[1].toUpperCase()] = TREND_BY_EMOJI[hit];
    });
  return out;
}

// "Brandon Pratt (#)⛑️\nSaint Johns Jesuit (OH)\n5' 10.5"✅ 176✅6'2.75"✅\ncGPA: 3.068🚗✈️"
export function parsePlayerCell(raw, fillRgb, ratingText, tier) {
  const lines = String(raw || "").split("\n").map((l) => l.trim());
  let nameLine = lines[0] || "";
  const flags = { snap: false, punt: false, noMidYear: false, injured: false };
  if (/\(\s*\$\s*\)/.test(nameLine)) flags.snap = true;
  if (/\(\s*#\s*\)/.test(nameLine)) flags.punt = true;
  if (/🚫/.test(nameLine)) flags.noMidYear = true;
  if (/⛑/.test(nameLine)) flags.injured = true;
  nameLine = nameLine.replace(/\(\s*[$#]\s*\)/g, "").replace(/🚫|⛑️?/g, "").trim();

  let school = lines[1] || "";
  let state = "";
  const sm = /^(.*?)\s*\(([A-Za-z]{2})\)\s*$/.exec(school);
  if (sm) {
    school = sm[1].trim();
    state = sm[2].toUpperCase();
  }
  const measurables = lines[2] || "";
  let gpaLabel = "cGPA";
  let gpa = "";
  let visits = "";
  const gm = /^(c?GPA)\s*:?\s*([\d.]+)\s*(.*)$/i.exec(lines[3] || "");
  if (gm) {
    gpaLabel = /^c/i.test(gm[1]) ? "cGPA" : "GPA";
    gpa = gm[2];
    visits = stripVs(gm[3]).replace(/\s+/g, "").replace(/✈/g, "✈\uFE0F");
  }
  return {
    id: newId(),
    name: nameLine,
    flags,
    school,
    state,
    measurables,
    gpaLabel,
    gpa,
    visits,
    status: statusFromFill(fillRgb),
    rating: parseRating(ratingText),
    tier: Number(tier) || 1,
  };
}

// One board sheet (OFF or DEF): a title bar, a header row of "QB (2)" / "Rating" pairs, then TIER bands
// and player cells down each column until the KEY block starts.
export function parseBoardSheet(ws) {
  if (!ws || !ws["!ref"]) throw new Error("That sheet is empty.");
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const title = cellText(ws, 1, 1).replace(/\s+/g, " ").trim();
  const headerPattern = /^(.*?)\s*\(\s*\d+\s*\)\s*$/;
  let headerRow = -1;
  for (let r = 0; r <= Math.min(range.e.r, 12) && headerRow < 0; r++) {
    let hits = 0;
    for (let c = 0; c <= range.e.c; c++) if (headerPattern.test(cellText(ws, r, c).trim())) hits++;
    if (hits >= 3) headerRow = r;
  }
  if (headerRow < 0) throw new Error("Couldn't find the position headers (like \"QB (2)\") on that sheet.");
  let endRow = range.e.r + 1;
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    if ([0, 1, 2, 3].some((c) => cellText(ws, r, c).trim().toUpperCase() === "KEY")) {
      endRow = r;
      break;
    }
  }
  const columns = [];
  for (let c = 0; c <= range.e.c; c++) {
    const m = headerPattern.exec(cellText(ws, headerRow, c).trim());
    if (!m) continue;
    const hasRating = cellText(ws, headerRow, c + 1).trim().toLowerCase() === "rating";
    const players = [];
    let tier = 1;
    for (let r = headerRow + 1; r < endRow; r++) {
      const t = cellText(ws, r, c).trim();
      if (!t) continue;
      const tm = /^TIER\s*(\d+)\s*$/i.exec(t);
      if (tm) {
        tier = Number(tm[1]);
        continue;
      }
      players.push(parsePlayerCell(t, cellFill(ws, r, c), hasRating ? cellText(ws, r, c + 1) : "", tier));
    }
    columns.push({ key: m[1].trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-"), label: m[1].trim(), hasRating, players });
  }
  return { title, columns };
}

function fixQualifier(text) {
  return String(text || "").replace(/qualifer/i, (m) => (m[0] === "Q" ? "Qualifier" : "qualifier"));
}

// The credit evaluation table: a header row (FIRST NAME ...), then recruits grouped by fill colour -- green
// rows are the commits, a black bar separates them, red rows are committed elsewhere.
export function parseCreditSheet(ws) {
  if (!ws || !ws["!ref"]) throw new Error("That sheet is empty.");
  const range = XLSX.utils.decode_range(ws["!ref"]);
  let headerRow = -1;
  for (let r = 0; r <= Math.min(range.e.r, 10); r++) {
    if (/^first\s*name$/i.test(cellText(ws, r, 0).trim())) {
      headerRow = r;
      break;
    }
  }
  if (headerRow < 0) throw new Error("Couldn't find the FIRST NAME header on that sheet.");
  const rows = [];
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    // Formatted text ("7/21"), not the cell's raw value, so a date reads as typed rather than as a serial number.
    const v = (c) => cellText(ws, r, c, true).trim();
    if (!v(0) && !v(1)) continue;
    const fill = cellFill(ws, r, 0);
    rows.push({
      id: newId(),
      first: v(0),
      last: v(1),
      pos: v(2).toUpperCase(),
      school: v(3),
      state: v(4).toUpperCase(),
      coach: v(5).toUpperCase(),
      transcript: v(6),
      qualifier: fixQualifier(v(7)),
      gpa: v(8),
      credits: v(9),
      group: statusFromFill(fill) === "elsewhere" ? "elsewhere" : "commit",
    });
  }
  return { rows };
}

export async function readWorkbook(file) {
  const buffer = await file.arrayBuffer();
  return XLSX.read(buffer, { type: "array", cellStyles: true });
}

export function boardTitle(ws) {
  return ws ? cellText(ws, 1, 1).replace(/\s+/g, " ").trim() : "";
}

export function classYearFromTitle(title) {
  const m = /\b(20\d{2})\b/.exec(title || "");
  return m ? m[1] : "";
}

// Committed players per (non-flex) column and the total -- the sheet's "TOTAL COMMITS" block. A flex
// column repeats players already counted in their own position, so it isn't added in.
export function commitCounts(board) {
  const rows = (board?.columns || [])
    .filter((c) => !/^flex/i.test(c.label))
    .map((c) => ({ label: c.label, count: c.players.filter((p) => p.status === "committed").length }));
  return { rows, total: rows.reduce((sum, r) => sum + r.count, 0) };
}

// Who is on a board, by person: a player on several columns (a flex spot as well as his position) is one person.
function peopleOn(board) {
  const map = new Map();
  (board?.columns || []).forEach((c) =>
    c.players.forEach((p) => {
      const key = nameKey(p.name);
      if (!key) return;
      const have = map.get(key);
      if (have) have.positions.push(c.label);
      else map.set(key, { name: p.name, school: p.school, state: p.state, status: p.status, tier: p.tier, positions: [c.label] });
    })
  );
  return map;
}

// What changed between the board that was there and the one just uploaded: people who are new and people
// who are gone. Compared one side (offense or defense) at a time, so uploading only one sheet never reads as
// the other side's whole board being removed.
export function diffBoards(oldBoard, newBoard, side) {
  const before = peopleOn(oldBoard);
  const after = peopleOn(newBoard);
  const entry = (type, p) => ({ type, side, name: p.name, school: p.school || "", state: p.state || "", status: p.status || "", tier: p.tier || 1, positions: [...new Set(p.positions)].join(", ") });
  return [
    ...[...after].filter(([k]) => !before.has(k)).map(([, p]) => entry("added", p)),
    ...[...before].filter(([k]) => !after.has(k)).map(([, p]) => entry("removed", p)),
  ];
}

// The same, for one card added or taken off by hand -- logged for every card, with its column, even when that
// person is still on the board in another one (taking Dawson Kahl off RB still reads as a removal from RB).
export function handChange(type, side, player, positions) {
  if (!nameKey(player.name)) return null;
  return { type, side, name: player.name, school: player.school || "", state: player.state || "", status: player.status || "", tier: player.tier || 1, positions };
}

// ---------------------------------------------------------------- credit evaluation

// The credit table is not typed in: it lists the committed and offered players on the class's boards, and only
// what the board can't know (transcript date, NCAA qualifier, credits, a changed GPA or coach) is saved, per
// person, in bigBoardCredit. Those saved bits are kept even while someone is off the list, so they come back
// if he is committed or offered again.
const CREDIT_POS_ORDER = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "SAF", "LS", "K", "P", "ATH"];
const POS_FROM_COLUMN = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", OT: "OL", "OG/OC": "OL", DE: "DL", DT: "DL", LB: "LB", CB: "CB", SAF: "SAF", LS: "LS", K: "K", P: "P" };
const POS_FROM_TITLE = [[/quarter/i, "QB"], [/running|fullback/i, "RB"], [/receiv/i, "WR"], [/tight/i, "TE"], [/offensive/i, "OL"], [/defensive/i, "DL"], [/linebac/i, "LB"], [/corner/i, "CB"], [/safety/i, "SAF"], [/snapper/i, "LS"], [/kicker|punter/i, "K"]];

export function positionAbbreviation(title) {
  return POS_FROM_TITLE.find(([re]) => re.test(title || ""))?.[1] || "";
}

// "Christian Dukes" -> "DUKES"; "Recruiting Staff" -> "RECRUITING" (as the staff sheet writes them).
const coachShort = (name) => (/recruiting/i.test(name || "") ? "RECRUITING" : String(name || "").trim().split(/\s+/).slice(-1)[0].toUpperCase());

export function creditKey(first, last) {
  return nameKey(`${first || ""}${last || ""}`);
}

export function buildCreditList(boards, saved = []) {
  const byKey = new Map();
  saved.forEach((r) => {
    const key = r.key || creditKey(r.first, r.last);
    if (key) byKey.set(key, r);
  });
  const seen = new Map();
  // Position columns before the flex columns, so a person is described by his real position.
  const ordered = [];
  boards.filter(Boolean).forEach((b) => b.columns.forEach((c) => ordered.push({ c, flex: /^flex/i.test(c.label) })));
  ordered.sort((a, b) => Number(a.flex) - Number(b.flex));
  ordered.forEach(({ c }) =>
    c.players.forEach((p) => {
      const key = nameKey(p.name);
      if (!key || seen.has(key) || (p.status !== "committed" && p.status !== "offered")) return;
      const parts = p.name.trim().split(/\s+/);
      const own = byKey.get(key) || {};
      seen.set(key, {
        key,
        status: p.status,
        first: parts[0] || "",
        last: parts.slice(1).join(" "),
        pos: p.pos || POS_FROM_COLUMN[c.label] || positionAbbreviation(p.positionTitle) || "ATH",
        school: p.school || "",
        state: p.state || "",
        coach: own.coach || coachShort(p.coach),
        transcript: own.transcript || "",
        qualifier: own.qualifier || "",
        gpa: own.gpa || p.gpa || "",
        credits: own.credits || "",
      });
    })
  );
  const rank = (r) => (CREDIT_POS_ORDER.indexOf(r.pos) < 0 ? 99 : CREDIT_POS_ORDER.indexOf(r.pos));
  const list = [...seen.values()].sort((a, b) => rank(a) - rank(b) || a.last.localeCompare(b.last));
  return { committed: list.filter((r) => r.status === "committed"), offered: list.filter((r) => r.status === "offered") };
}

// The JUCO credit evaluation: everyone on the board (not only the committed and offered), grouped by card colour.
// Measurables, GPA and the transcript tick live on the player's own card, so this table and the card's edit
// window are two views of the same thing -- a change in either shows in the other.
export function buildJucoCreditList(boards) {
  const seen = new Map();
  const ordered = [];
  boards.filter(Boolean).forEach((b) => b.columns.forEach((c) => ordered.push({ c, flex: /^flex/i.test(c.label) })));
  ordered.sort((a, b) => Number(a.flex) - Number(b.flex));
  ordered.forEach(({ c }) =>
    c.players.forEach((p) => {
      const key = nameKey(p.name);
      if (!key || seen.has(key)) return;
      const parts = p.name.trim().split(/\s+/);
      seen.set(key, {
        key,
        status: p.status || "recruit",
        first: parts[0] || "",
        last: parts.slice(1).join(" "),
        pos: p.pos || POS_FROM_COLUMN[c.label] || positionAbbreviation(p.positionTitle) || "ATH",
        school: p.school || "",
        measurables: p.measurables || "",
        gpa: p.gpa || "",
        gpaLabel: p.gpaLabel || "",
        transcriptEval: !!p.transcriptEval,
      });
    })
  );
  const rank = (r) => (CREDIT_POS_ORDER.indexOf(r.pos) < 0 ? 99 : CREDIT_POS_ORDER.indexOf(r.pos));
  const all = [...seen.values()].sort((a, b) => rank(a) - rank(b) || a.last.localeCompare(b.last));
  const groups = STATUSES.map((s) => ({ key: s.key, title: s.label, color: s.color, rows: all.filter((r) => r.status === s.key) })).filter((g) => g.rows.length);
  return { groups, total: all.length };
}

export const blankPlayer = (tier = 1) => ({
  id: newId(),
  name: "",
  flags: { snap: false, punt: false, noMidYear: false, injured: false },
  school: "",
  state: "",
  measurables: "",
  gpaLabel: "cGPA",
  gpa: "",
  visits: "",
  status: "recruit",
  rating: { A: "", P: "", C: "", R: "" },
  tier,
  // Carried by the ARMs board PDF (not the workbook).
  coach: "",
  ratingLabel: "",
  prospectStatus: "",
  lastVisit: "",
  midYear: false,
  gradYear: "",
  pos: "",
});

export const blankCreditRow = (group = "commit") => ({
  id: newId(), first: "", last: "", pos: "", school: "", state: "", coach: "", transcript: "", qualifier: "", gpa: "", credits: "", group,
});

export function useBigBoards(classYear) {
  const [boards, setBoards] = useState({});
  const [credits, setCredits] = useState({});
  const [photos, setPhotos] = useState({});
  const [activity, setActivity] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "bigBoards"),
      (snap) => {
        const map = {};
        snap.docs.forEach((d) => (map[d.id] = d.data()));
        setBoards(map);
        setReady(true);
      },
      () => setReady(true)
    );
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "bigBoardCredit"),
      (snap) => {
        const map = {};
        snap.docs.forEach((d) => (map[d.id] = d.data()));
        setCredits(map);
      },
      () => {}
    );
    return unsubscribe;
  }, []);

  // Photos belong to a recruit (by name), so a player on several columns, or on both the board and the
  // credit table, shares one. Kept apart from the board document so the board stays small.
  useEffect(() => {
    if (!classYear) return undefined;
    const unsubscribe = onSnapshot(
      query(collection(db, "bigBoardPhotos"), where("classYear", "==", classYear)),
      (snap) => {
        const map = {};
        snap.docs.forEach((d) => (map[d.data().key] = d.data().photo));
        setPhotos(map);
      },
      () => {}
    );
    return unsubscribe;
  }, [classYear]);

  // The log of who was added to and removed from the board, newest first.
  useEffect(() => {
    if (!classYear) return undefined;
    const unsubscribe = onSnapshot(
      query(collection(db, "bigBoardActivity"), where("classYear", "==", classYear)),
      (snap) => setActivity(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.at || "").localeCompare(a.at || "") || a.name.localeCompare(b.name))),
      () => {}
    );
    return unsubscribe;
  }, [classYear]);

  const classYears = useMemo(() => {
    const years = new Set(["2027", "2028", "JUCO"]);
    Object.values(boards).forEach((b) => b.classYear && years.add(b.classYear));
    Object.values(credits).forEach((c) => c.classYear && years.add(c.classYear));
    return [...years].sort();
  }, [boards, credits]);

  return {
    ready,
    classYears,
    photos,
    activity,
    board: (year, side) => boards[`${year}__${side}`] || null,
    credit: (year) => credits[year] || null,
    async saveBoard(year, side, board) {
      await setDoc(doc(db, "bigBoards", `${year}__${side}`), { ...board, classYear: year, side, updatedAt: new Date().toISOString() });
    },
    async saveCredit(year, rows) {
      await setDoc(doc(db, "bigBoardCredit", year), { classYear: year, rows, updatedAt: new Date().toISOString() });
    },
    async logActivity(year, entries, source) {
      if (!entries.length) return;
      const now = new Date();
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      for (let i = 0; i < entries.length; i += 400) {
        const batch = writeBatch(db);
        entries.slice(i, i + 400).forEach((e) => {
          const id = `${year}__${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
          batch.set(doc(db, "bigBoardActivity", id), { ...e, classYear: year, source, date, at: now.toISOString() });
        });
        await batch.commit();
      }
    },
    async savePhoto(year, name, photo) {
      const key = nameKey(name);
      if (key) await setDoc(doc(db, "bigBoardPhotos", `${year}__${key}`), { classYear: year, key, name, photo });
    },
    async removePhoto(year, name) {
      const key = nameKey(name);
      if (key) await deleteDoc(doc(db, "bigBoardPhotos", `${year}__${key}`));
    },
  };
}
