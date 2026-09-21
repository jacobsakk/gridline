import * as XLSX from "xlsx";
import { collection, doc, onSnapshot, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "./firebase";
import { useEffect, useMemo, useState } from "react";

// ---------------------------------------------------------------- constants

export const SEASON_YEAR = 2026;

// The face sheet's key. "auto" isn't a stored status -- an empty status means
// "work it out from the Offer Tracker".
export const STATUS_OPTIONS = [
  { key: "committed", label: "Committed", bg: "#FFC82E", fg: "#510F1D" },
  { key: "offered", label: "Offered", bg: "#B6D7A8", fg: "#1A1206" },
  { key: "offerStatus", label: "Offer Status", bg: "#A4C2F4", fg: "#1A1206" },
  { key: "partial", label: "Partial", bg: "#B4A7D6", fg: "#1A1206" },
  { key: "elsewhere", label: "Committed Elsewhere", bg: "#EA9999", fg: "#1A1206" },
];
export const STATUS_BY_KEY = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.key, s]));

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// ------------------------------------------------------------------- dates

const pad = (n) => String(n).padStart(2, "0");
export const toIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromIso = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

// Season dates carry no year ("Fri, Aug 28"): fall months are this season's
// year, January-May belong to the next calendar year.
function seasonYearFor(monthIndex) {
  return monthIndex >= 5 ? SEASON_YEAR : SEASON_YEAR + 1;
}

export function mondayOf(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const back = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - back);
  return d;
}

export function weekLabel(monday) {
  const end = new Date(monday);
  end.setDate(end.getDate() + 6);
  return `${monday.getMonth() + 1}/${monday.getDate()} - ${end.getMonth() + 1}/${end.getDate()}`;
}

export const weekKey = (date) => toIso(mondayOf(date));

// "Fri, Aug 28" / "Aug 28" / "Fri, 9/18" / "9/18" / "2026-09-18" / a Date -> ISO
function parseDateText(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return toIso(value);
  const text = String(value ?? "").trim();
  if (!text) return "";
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = /(?:[A-Za-z]{3,9},?\s+)?([A-Za-z]{3,9})\.?\s+(\d{1,2})$/.exec(text);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()] != null) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    return `${seasonYearFor(mo)}-${pad(mo + 1)}-${pad(m[2])}`;
  }
  m = /(?:[A-Za-z]{3},?\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(text);
  if (m) {
    const mo = Number(m[1]) - 1;
    let yr = m[3] ? Number(m[3]) : seasonYearFor(mo);
    if (yr < 100) yr += 2000;
    return `${yr}-${pad(mo + 1)}-${pad(m[2])}`;
  }
  return "";
}

// ------------------------------------------------------------------ parsing

const RESULT_RE = /^([WLT])\s*(\d+)\s*[-–]\s*(\d+)$/i;

// One weekly cell from the master sheet, e.g. "W 24-23\nBelleville\nThu, Aug 27"
// or "@Chippewa Valley\nFri, Sep 11" (not played yet).
function parseGameCell(cell) {
  const lines = String(cell ?? "").split(/\r?\n|\s\|\s/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const game = { opponent: "", homeAway: "H", date: "", result: "", ours: null, theirs: null };
  for (const line of lines) {
    const r = RESULT_RE.exec(line);
    if (r) {
      game.result = r[1].toUpperCase();
      game.ours = Number(r[2]);
      game.theirs = Number(r[3]);
      continue;
    }
    const date = parseDateText(line);
    if (date && /^(?:[A-Za-z]{3},?\s+)?[A-Za-z]{3,9}\.?\s+\d{1,2}$/.test(line)) {
      game.date = date;
      continue;
    }
    if (!game.opponent) {
      game.homeAway = line.startsWith("@") ? "A" : "H";
      // "@Lincoln", "vs Lincoln", "vs, Lincoln" -> Lincoln (away only for "@")
      game.opponent = line.replace(/^@\s*/, "").replace(/^vs\.?,?\s+/i, "").trim();
    }
  }
  if (!game.opponent || /^(bye|open|tba)$/i.test(game.opponent)) {
    return game.date ? { ...game, opponent: game.opponent || "TBA", bye: /^bye$/i.test(game.opponent) } : null;
  }
  return game;
}

const clean = (v) => (v == null ? "" : String(v).trim());
const slug = (text) => clean(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export function playerId(classYear, name) {
  return `${classYear || "0000"}__${slug(name)}`;
}

const STATE_ABBR = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH",
  "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
  "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};
const toStateCode = (v) => {
  const t = clean(v);
  return t.length === 2 ? t.toUpperCase() : STATE_ABBR[t.toLowerCase()] || t;
};

function splitSchool(raw, stateHint) {
  const text = clean(raw);
  const m = /^(.*?)\s*\(([A-Za-z]{2})\)\s*$/.exec(text);
  return m ? { highSchool: m[1].trim(), state: toStateCode(stateHint) || m[2].toUpperCase() } : { highSchool: text, state: toStateCode(stateHint) };
}

function rowsOf(sheet) {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "", dateNF: "yyyy-mm-dd" });
}

// The master layout (Excel MASTER sheet or the "season" CSV): one row per player,
// one column per week, each cell that week's game.
function parseMaster(rows) {
  const headerAt = rows.findIndex((r) => r.some((c) => /^name$/i.test(clean(c))) && r.some((c) => /coach/i.test(clean(c))));
  if (headerAt < 0) return [];
  const header = rows[headerAt].map((c) => clean(c).toLowerCase());
  const col = (...names) => header.findIndex((h) => names.includes(h));
  const idx = {
    coach: col("recruiting coach", "area coach"), name: col("name"), position: col("position"), rating: col("rating"), year: col("year"),
    cell: col("cell"), twitter: col("twitter"), state: col("state"), school: col("high school"), record: col("record"),
    src1: col("source"), src2: col("source 2"), src3: col("source 3"), profile: col("player profile"),
  };
  const weekCols = header.map((h, i) => (/^\d{1,2}\/\d{1,2}\s*-\s*\d{1,2}\/\d{1,2}$/.test(h) ? i : -1)).filter((i) => i >= 0);
  const players = [];
  for (const r of rows.slice(headerAt + 1)) {
    const name = clean(r[idx.name]);
    if (!name) continue;
    const year = clean(r[idx.year]).replace(/\.0$/, "");
    const games = weekCols.map((i) => parseGameCell(r[i])).filter(Boolean);
    players.push({
      name, classYear: year, position: clean(r[idx.position]).toUpperCase(), coach: clean(r[idx.coach]),
      ...splitSchool(r[idx.school], idx.state >= 0 ? r[idx.state] : ""),
      rating: idx.rating >= 0 ? clean(r[idx.rating]) : "", cell: idx.cell >= 0 ? clean(r[idx.cell]) : "", twitter: idx.twitter >= 0 ? clean(r[idx.twitter]) : "",
      recordText: idx.record >= 0 ? clean(r[idx.record]) : "",
      sources: { maxpreps: clean(r[idx.src1]), scorestream: clean(r[idx.src2]), other: clean(r[idx.src3]), profile: clean(r[idx.profile]) },
      games,
    });
  }
  return players;
}

// The weekly layout (weekly CSV / WEEKLY SCORES sheet): one row per player, that
// week's result plus the next game.
function parseWeekly(rows) {
  const headerAt = rows.findIndex((r) => r.some((c) => /^opponent$/i.test(clean(c))));
  if (headerAt < 0) return [];
  const header = rows[headerAt].map((c) => clean(c).toLowerCase());
  const col = (...names) => header.findIndex((h) => names.includes(h));
  const idx = {
    coach: col("recruiting coach"), name: col("name"), first: col("first name"), last: col("last name"), year: col("year"), position: col("position"),
    state: col("state"), school: col("high school"), cell: col("cell"), twitter: col("twitter"), rating: col("rating"),
    opp: col("opponent"), ha: col("h/a"), result: col("result"), stats: col("stats", "stats/game summary"), date: col("game date"),
    record: col("record"), nextOpp: col("next opponent", "next week opponent"), nextHa: col("next h/a"), nextDate: col("next date", "next week date"),
    src1: col("source"), src2: col("source 2"), src3: col("source 3"), profile: col("player profile"),
  };
  const players = [];
  for (const r of rows.slice(headerAt + 1)) {
    const name = idx.name >= 0 ? clean(r[idx.name]) : `${clean(r[idx.first])} ${clean(r[idx.last])}`.trim();
    if (!name) continue;
    const games = [];
    const played = RESULT_RE.exec(clean(r[idx.result]));
    if (clean(r[idx.opp])) {
      games.push({
        opponent: clean(r[idx.opp]), homeAway: clean(r[idx.ha]).toUpperCase().startsWith("A") ? "A" : "H", date: parseDateText(r[idx.date]),
        result: played ? played[1].toUpperCase() : "", ours: played ? Number(played[2]) : null, theirs: played ? Number(played[3]) : null,
        summary: idx.stats >= 0 ? clean(r[idx.stats]) : "",
      });
    }
    if (idx.nextOpp >= 0 && clean(r[idx.nextOpp])) {
      games.push({ opponent: clean(r[idx.nextOpp]), homeAway: clean(r[idx.nextHa]).toUpperCase().startsWith("A") ? "A" : "H", date: parseDateText(r[idx.nextDate]), result: "", ours: null, theirs: null });
    }
    players.push({
      name, classYear: clean(r[idx.year]).replace(/\.0$/, ""), position: clean(r[idx.position]).toUpperCase(), coach: idx.coach >= 0 ? clean(r[idx.coach]) : "",
      ...splitSchool(r[idx.school], idx.state >= 0 ? r[idx.state] : ""), rating: idx.rating >= 0 ? clean(r[idx.rating]) : "", cell: idx.cell >= 0 ? clean(r[idx.cell]) : "",
      twitter: idx.twitter >= 0 ? clean(r[idx.twitter]) : "", recordText: idx.record >= 0 ? clean(r[idx.record]) : "",
      sources: { maxpreps: idx.src1 >= 0 ? clean(r[idx.src1]) : "", scorestream: idx.src2 >= 0 ? clean(r[idx.src2]) : "", other: idx.src3 >= 0 ? clean(r[idx.src3]) : "", profile: idx.profile >= 0 ? clean(r[idx.profile]) : "" },
      games: games.filter((g) => g.date),
    });
  }
  return players;
}

// Face-sheet blocks: six rows each -- RECORD / AREA COACH / STATS row, OPPONENT /
// NEXT OPPONENT row, then "Name (POS) (Injured)" with SCORE and NEXT WEEK DATE.
function parseStaffSheet(rows) {
  const out = [];
  for (let i = 0; i < rows.length - 5; i++) {
    if (clean(rows[i][1]).toUpperCase() !== "RECORD" || clean(rows[i + 2][1]).toUpperCase() !== "OPPONENT") continue;
    const nameCell = clean(rows[i + 4][0]);
    const m = /^(.*?)\s*\(([A-Za-z/]+)\)(.*)$/.exec(nameCell);
    if (!m) continue;
    out.push({
      name: m[1].trim(), position: m[2].toUpperCase(), injured: /injur/i.test(m[3]), coach: clean(rows[i + 1][2]), summary: clean(rows[i + 1][3]),
      opponent: clean(rows[i + 3][1]), nextOpponent: clean(rows[i + 3][2]),
    });
  }
  return out;
}

export async function parseHsFile(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { cellDates: true, ...(/\.csv$/i.test(file.name) ? { type: "array", raw: true } : {}) });
  const players = [];
  const staff = [];
  for (const name of workbook.SheetNames) {
    const rows = rowsOf(workbook.Sheets[name]);
    const header = (rows.find((r) => r.some((c) => clean(c))) || []).map((c) => clean(c).toLowerCase());
    if (rows.some((r) => clean(r[1]).toUpperCase() === "RECORD") && rows.some((r) => clean(r[1]).toUpperCase() === "OPPONENT")) {
      staff.push(...parseStaffSheet(rows));
    } else if (rows.slice(0, 5).some((r) => r.map((c) => clean(c).toLowerCase()).includes("opponent") && r.map((c) => clean(c).toLowerCase()).some((c) => /result/.test(c)))) {
      players.push(...parseWeekly(rows));
    } else if (rows.slice(0, 5).some((r) => r.map((c) => clean(c).toLowerCase()).includes("name") && r.map((c) => clean(c).toLowerCase()).some((c) => /coach/.test(c)))) {
      players.push(...parseMaster(rows));
    } else if (!header.length) {
      continue;
    }
  }
  return { players, staff };
}

// -------------------------------------------------------------- record etc.

export function computeRecord(games) {
  let w = 0;
  let l = 0;
  let t = 0;
  (games || []).forEach((g) => {
    if (g.result === "W") w++;
    else if (g.result === "L") l++;
    else if (g.result === "T") t++;
  });
  return { w, l, t, text: `${w}W - ${l}L${t ? ` - ${t}T` : ""}`, played: w + l + t };
}

const gameKey = (g) => g.date || `${g.opponent}`;

// -------------------------------------------------- scraped results overlay

// Stable id for a school's results document. Must match team_doc_id() in
// scraper/hs_games.py -- the scraper writes hsTeams/{id}, the app reads it.
export function teamDocId(sources) {
  const mp = /maxpreps\.com\/([a-z]{2})\/([^/]+)\/([^/]+)\//.exec(sources?.maxpreps || "");
  if (mp) return `mp_${mp[1]}_${mp[2]}_${mp[3]}`;
  const ss = /scorestream\.com\/team\/([^/?#]+)/.exec(sources?.scorestream || "");
  return ss ? `ss_${ss[1]}` : "";
}

const NOISE = new Set(["high", "school", "hs", "the", "of", "academy", "prep", "preparatory"]);
const ALIASES = { st: "saint", mt: "mount", ft: "fort" };
function nameTokens(name) {
  const all = new Set(
    String(name || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean).map((t) => ALIASES[t] || t)
  );
  const trimmed = new Set([...all].filter((t) => !NOISE.has(t)));
  return trimmed.size ? trimmed : all;
}
export function sameSchool(a, b) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.size || !tb.size) return false;
  let shared = 0;
  ta.forEach((t) => tb.has(t) && shared++);
  return shared / Math.min(ta.size, tb.size) >= 0.6;
}

function nameSimilarity(a, b) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  let shared = 0;
  ta.forEach((t) => tb.has(t) && shared++);
  return ta.size && tb.size ? shared / Math.max(ta.size, tb.size) : 0;
}

const daysApart = (a, b) => Math.abs((fromIso(a) - fromIso(b)) / 86400000);

// Once the scraper has run for a school, its schedule is the source of truth:
// every game it found is shown (with its result), and anything typed by hand --
// game summaries -- is carried over from the matching stored game. Stored games
// the scraper doesn't know about are kept if they have a result (a source may
// simply lack it) and dropped if they're just an un-played placeholder, which
// is what a rescheduled game looks like.
export function overlayScraped(games, teamDoc) {
  const teamGames = teamDoc?.games;
  if (!teamGames?.length) return games;
  const findStored = (t, pool) =>
    pool
      .filter((g) => g.date && daysApart(g.date, t.date) <= 1 && sameSchool(g.opponent, t.opponent))
      .sort((a, b) => nameSimilarity(t.opponent, b.opponent) - nameSimilarity(t.opponent, a.opponent))[0];

  const claimed = new Set();
  const merged = teamGames.map((t) => {
    const mine = findStored(t, games.filter((g) => !claimed.has(g)));
    if (mine) claimed.add(mine);
    return {
      ...(mine || {}),
      date: t.date,
      opponent: (mine && mine.opponent) || t.opponent,
      homeAway: t.homeAway || mine?.homeAway || "",
      ...(t.result ? { result: t.result, ours: t.ours, theirs: t.theirs } : {}),
      scraped: true,
      verifiedBy: t.source || [],
      ...(t.conflict ? { conflict: t.conflict } : {}),
    };
  });
  const scheduleIsFresh = teamDoc.fetched?.maxpreps;
  const leftovers = games.filter((g) => !claimed.has(g) && (g.result || !scheduleIsFresh || !g.date));
  return [...merged, ...leftovers].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}

// ------------------------------------------------------------------ photos

// A profile picture is shrunk in the browser (longest side 360px, JPEG) and stored
// on the player document itself, so there's no separate file storage to set up.
// Around 20-40 KB each.
export async function photoFromFile(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error("Choose an image file (JPG or PNG).");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That image couldn't be read."));
      el.src = url;
    });
    const scale = Math.min(1, 360 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; // transparent PNGs become white, like the printed sheet
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const letters = (text) => String(text || "").toLowerCase().replace(/[^a-z]/g, "");

// Matches dropped files to players by file name ("Sam Rouleau.jpg", "sam_rouleau_qb.png").
export function matchPhotoFiles(files, players) {
  const matched = [];
  const unmatched = [];
  files.forEach((file) => {
    const base = letters(file.name.replace(/\.[^.]+$/, ""));
    const hit = players
      .filter((p) => letters(p.name) && base.includes(letters(p.name)))
      .sort((a, b) => letters(b.name).length - letters(a.name).length)[0];
    if (hit) matched.push({ file, player: hit });
    else unmatched.push(file.name);
  });
  return { matched, unmatched };
}

// -------------------------------------------- one game listed twice

// The same game can arrive twice: two files a day apart on the date, or one file with a
// date and one with only the opponent. Those are collapsed to a single game, keeping
// whichever copy has the result.
function sameGame(a, b) {
  if (!sameSchool(a.opponent, b.opponent)) return false;
  if (a.date && b.date) return daysApart(a.date, b.date) <= 1;
  return true;
}

function mergeGames(a, b) {
  const [base, other] = b.result && !a.result ? [b, a] : [a, b];
  const merged = { ...other, ...Object.fromEntries(Object.entries(base).filter(([, v]) => v !== "" && v != null)) };
  merged.date = base.date || other.date || "";
  merged.summary = base.summary || other.summary || "";
  return merged;
}

export function dedupeGames(games) {
  const out = [];
  (games || []).forEach((g) => {
    const at = out.findIndex((o) => sameGame(o, g));
    if (at < 0) out.push({ ...g });
    else out[at] = mergeGames(out[at], g);
  });
  return out.sort((x, y) => (x.date || "").localeCompare(y.date || ""));
}

// A schedule with the leftovers taken out: the same game listed twice is one game, and a past
// game with no score sitting next to a game that has one is a placeholder for something that
// was rescheduled or replaced (sites keep those around), so it's dropped.
export function cleanSchedule(games, today = toIso(new Date())) {
  const merged = dedupeGames(games);
  return merged.filter(
    (g) => g.result || !g.date || g.date >= today || !merged.some((o) => o !== g && o.result && o.date && daysApart(o.date, g.date) <= 1)
  );
}

// ------------------------------------------------------------ Firestore hook

export function useHsTracker() {
  const [docs, setDocs] = useState([]);
  const [teams, setTeams] = useState({});
  const [removedIds, setRemovedIds] = useState(() => new Set());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "hsPlayers"),
      (snap) => {
        const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
        setDocs(all.filter((d) => !d.removed));
        setRemovedIds(new Set(all.filter((d) => d.removed).map((d) => d.id)));
        setReady(true);
      },
      () => setReady(true)
    );
    // Results the weekly scraper stored per school (absent until it has run once).
    const unsubscribeTeams = onSnapshot(
      collection(db, "hsTeams"),
      (snap) => setTeams(Object.fromEntries(snap.docs.map((d) => [d.id, d.data() || {}]))),
      () => {}
    );
    return () => {
      unsubscribe();
      unsubscribeTeams();
    };
  }, []);

  const players = useMemo(
    () =>
      docs
        .map((p) => {
          const stored = dedupeGames(p.games || []);
          const games = cleanSchedule(overlayScraped(stored, teams[teamDocId(p.sources)]));
          const computed = computeRecord(games);
          const m = /(\d+)\s*W\s*-\s*(\d+)\s*L/i.exec(p.recordText || "");
          const record = m && Number(m[1]) + Number(m[2]) > computed.played ? { w: Number(m[1]), l: Number(m[2]), t: 0, text: p.recordText.trim(), played: Number(m[1]) + Number(m[2]) } : computed;
          return { ...p, games, storedGames: stored, record };
        })
        .sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [docs, teams]
  );

  // Merges a parsed upload into what's already stored: roster fields come from
  // the file, but statuses, injuries and hand-written game summaries stay.
  async function importParsed({ players: incoming, staff }, { dryRun = false } = {}) {
    const existingById = new Map(docs.map((d) => [d.id, d]));
    const merged = new Map();
    const summary = { created: 0, updated: 0, games: 0, summaries: 0, skipped: 0, unmatchedStaff: [] };

    incoming.forEach((p) => {
      if (!p.classYear) return;
      const id = playerId(p.classYear, p.name);
      // Someone removed from the tracker stays removed when a file that still lists them is loaded again.
      if (removedIds.has(id)) {
        summary.skipped += 1;
        return;
      }
      const base = merged.get(id) || existingById.get(id) || { id, status: "", injured: false, games: [], createdAt: new Date().toISOString() };
      const next = { ...base };
      ["name", "classYear", "position", "coach", "highSchool", "state", "rating", "cell", "twitter", "recordText"].forEach((k) => {
        if (p[k]) next[k] = p[k];
      });
      next.sources = { ...(base.sources || {}), ...Object.fromEntries(Object.entries(p.sources || {}).filter(([, v]) => v)) };
      const games = new Map((base.games || []).map((g) => [gameKey(g), g]));
      p.games.forEach((g) => {
        const key = gameKey(g);
        const old = games.get(key);
        // A recorded result never gets blanked out by a row that hasn't got one yet.
        games.set(key, { ...(old || {}), ...Object.fromEntries(Object.entries(g).filter(([k, v]) => v !== "" && v != null || k === "summary" && v)), summary: g.summary || old?.summary || "" });
        summary.games += 1;
      });
      next.games = dedupeGames([...games.values()]);
      next.updatedAt = new Date().toISOString();
      merged.set(id, next);
    });

    // Face-sheet summaries attach to the game against that opponent.
    (staff || []).forEach((s) => {
      const target = [...merged.values(), ...docs].find((d) => (d.name || "").toLowerCase() === s.name.toLowerCase() || (d.name || "").toLowerCase().includes(s.name.toLowerCase()) || s.name.toLowerCase().includes((d.name || "").toLowerCase()));
      if (!target) {
        summary.unmatchedStaff.push(s.name);
        return;
      }
      const next = merged.get(target.id) || { ...target };
      const games = [...(next.games || [])];
      const at = games.findIndex((g) => (g.opponent || "").toLowerCase() === s.opponent.toLowerCase());
      if (at >= 0 && s.summary) {
        games[at] = { ...games[at], summary: s.summary };
        summary.summaries += 1;
      }
      next.games = games;
      if (s.injured) next.injured = true;
      if (!next.coach && s.coach) next.coach = s.coach;
      merged.set(next.id, next);
    });

    merged.forEach((d, id) => (existingById.has(id) ? (summary.updated += 1) : (summary.created += 1)));
    if (dryRun) return summary;
    const entries = [...merged.values()];
    for (let i = 0; i < entries.length; i += 400) {
      const batch = writeBatch(db);
      entries.slice(i, i + 400).forEach((d) => {
        const { id, ...data } = d;
        batch.set(doc(db, "hsPlayers", id), data);
      });
      await batch.commit();
    }
    return summary;
  }

  async function importFile(file, options) {
    const parsed = await parseHsFile(file);
    if (!parsed.players.length && !(parsed.staff || []).length) throw new Error("This doesn't look like a game tracker file -- expected a master or weekly sheet with names, opponents and results.");
    return importParsed(parsed, options);
  }

  async function updatePlayer(id, fields) {
    await updateDoc(doc(db, "hsPlayers", id), { ...fields, updatedAt: new Date().toISOString() });
  }

  // Edit one game (matched by its date) -- used for the hand-written summary.
  async function updateGame(player, game, fields) {
    // A player who has no stored schedule is showing the school's scraped one; the first edit saves it.
    const base = player.storedGames?.length ? player.storedGames : player.games || [];
    const games = base.map((g) => (gameKey(g) === gameKey(game) ? { ...g, ...fields } : g));
    await updatePlayer(player.id, { games });
  }

  async function addPlayer({ name, classYear, position, highSchool, state, coach, maxpreps = "", scorestream = "" }) {
    const id = playerId(classYear, name);
    await setDoc(doc(db, "hsPlayers", id), {
      name: name.trim(), classYear: classYear.trim(), position: position.trim().toUpperCase(), highSchool: highSchool.trim(), state: toStateCode(state), coach: coach.trim(),
      status: "", injured: false, games: [], sources: { maxpreps: maxpreps.trim(), scorestream: scorestream.trim() }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
  }

  // Removal is a flag, not a delete: a later upload of a file that still lists
  // the player won't bring them back, and it can be undone.
  async function setRemoved(ids, removed) {
    const now = new Date().toISOString();
    for (let i = 0; i < ids.length; i += 400) {
      const batch = writeBatch(db);
      ids.slice(i, i + 400).forEach((id) => batch.update(doc(db, "hsPlayers", id), removed ? { removed: true, removedAt: now } : { removed: false, updatedAt: now }));
      await batch.commit();
    }
  }
  // Who is on the printed face sheet. Only players marked off are recorded (faceSheet: false);
  // everyone else is on it, so new players show up without any extra step.
  async function setFaceSheet(ids, on) {
    const now = new Date().toISOString();
    for (let i = 0; i < ids.length; i += 400) {
      const batch = writeBatch(db);
      ids.slice(i, i + 400).forEach((id) => batch.update(doc(db, "hsPlayers", id), { faceSheet: on, updatedAt: now }));
      await batch.commit();
    }
  }
  // A hand-arranged face sheet: everyone gets a number in the order given.
  async function setSheetOrder(ids) {
    for (let i = 0; i < ids.length; i += 400) {
      const batch = writeBatch(db);
      ids.slice(i, i + 400).forEach((id, j) => batch.update(doc(db, "hsPlayers", id), { sheetOrder: i + j }));
      await batch.commit();
    }
  }
  const removePlayers = (ids) => setRemoved(ids, true);
  const restorePlayers = (ids) => setRemoved(ids, false);
  const removePlayer = (id) => setRemoved([id], true);

  return { ready, players, teams, importFile, importParsed, updatePlayer, updateGame, addPlayer, removePlayer, removePlayers, restorePlayers, setFaceSheet, setSheetOrder };
}
