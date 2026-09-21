import * as XLSX from "xlsx";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import { canonicalSchool } from "./schoolNames.js";
import { useEffect, useMemo, useState } from "react";

// Sheet name (as it appears in the workbook, case-insensitive) -> which
// conference it belongs to, how to display it, and its school colors
// (hand-picked approximations, not official brand assets -- close
// enough to theme the page when that team's selected). Hand-maintained
// the same way D2_KNOWN_CONFERENCES/CONFERENCE_CORRECTIONS are in the
// scraper -- add a line here when a new team gets its own tab.
export const TEAM_CONFERENCE = {
  CMU: { conference: "MAC", label: "Central Michigan", color: "#6A0032", colorSecondary: "#FFC72C" },
  BGSU: { conference: "MAC", label: "Bowling Green", color: "#4F2C1D", colorSecondary: "#FE5000" },
  WMU: { conference: "MAC", label: "Western Michigan", color: "#532E1F", colorSecondary: "#FFC629" },
  EMU: { conference: "MAC", label: "Eastern Michigan", color: "#006633", colorSecondary: "#046A38" },
  "SAC STATE": { conference: "MAC", label: "Sac State", color: "#043927", colorSecondary: "#C4B581" },
  "BALL STATE": { conference: "MAC", label: "Ball State", color: "#BA0C2F", colorSecondary: "#1C1C1C" },
  AKRON: { conference: "MAC", label: "Akron", color: "#00285E", colorSecondary: "#A89968" },
  OHIO: { conference: "MAC", label: "Ohio", color: "#00694E", colorSecondary: "#707372" },
  TOLEDO: { conference: "MAC", label: "Toledo", color: "#003663", colorSecondary: "#FFCD00" },
  "MIAMI (OH)": { conference: "MAC", label: "Miami (OH)", color: "#C41230", colorSecondary: "#1C1C1C" },
  "KENT STATE": { conference: "MAC", label: "Kent State", color: "#002D65", colorSecondary: "#EAAB00" },
  UMASS: { conference: "MAC", label: "UMass", color: "#881C1C", colorSecondary: "#1C1C1C" },
  BUFFALO: { conference: "MAC", label: "Buffalo", color: "#005BBB", colorSecondary: "#000000" },

  "NORTH DAKOTA STATE": { conference: "MVC", label: "North Dakota State", color: "#076A31", colorSecondary: "#FFC82E" },
  "SOUTH DAKOTA STATE": { conference: "MVC", label: "South Dakota State", color: "#0033A0", colorSecondary: "#FFD100" },
  "SOUTH DAKOTA": { conference: "MVC", label: "South Dakota", color: "#CC0000", colorSecondary: "#1C1C1C" },
  "NORTH DAKOTA": { conference: "MVC", label: "North Dakota", color: "#009A44", colorSecondary: "#000000" },
  "ILLINOIS STATE": { conference: "MVC", label: "Illinois State", color: "#CE1126", colorSecondary: "#000000" },
  "SOUTHERN ILLINOIS": { conference: "MVC", label: "Southern Illinois", color: "#720C20", colorSecondary: "#1C1C1C" },
  "INDIANA STATE": { conference: "MVC", label: "Indiana State", color: "#041E42", colorSecondary: "#CE1126" },
  "YOUNGSTOWN STATE": { conference: "MVC", label: "Youngstown State", color: "#B01E24", colorSecondary: "#1C1C1C" },
  "NORTHERN IOWA": { conference: "MVC", label: "Northern Iowa", color: "#4B116F", colorSecondary: "#FFDD00" },
  "MURRAY STATE": { conference: "MVC", label: "Murray State", color: "#002144", colorSecondary: "#FDB827" },

  COLUMBIA: { conference: "IVY", label: "Columbia", color: "#71A9DE", colorSecondary: "#000000" },
  CORNELL: { conference: "IVY", label: "Cornell", color: "#B31B1B", colorSecondary: "#1C1C1C" },
  YALE: { conference: "IVY", label: "Yale", color: "#00356B", colorSecondary: "#A7A9AC" },
  PRINCETON: { conference: "IVY", label: "Princeton", color: "#FF8F1C", colorSecondary: "#000000" },
  HARVARD: { conference: "IVY", label: "Harvard", color: "#A51C30", colorSecondary: "#1C1C1C" },
  DARTMOUTH: { conference: "IVY", label: "Dartmouth", color: "#00693E", colorSecondary: "#1C1C1C" },
  PENN: { conference: "IVY", label: "Penn", color: "#990000", colorSecondary: "#011F5B" },
  BROWN: { conference: "IVY", label: "Brown", color: "#4E3629", colorSecondary: "#B7302E" },
};

export const CONFERENCE_ORDER = ["MAC", "MVC", "IVY"];

// Sheets that aren't a team's offer list -- the assignment index, the
// text-message template, stale archives, and the derived breakdown
// tabs (those get recomputed live from the team rows instead of read).
const SKIP_SHEET_PATTERN = /^(ASSIGNMENTS|QUESTIONNAIRE)$/i;
const SKIP_SHEET_SUBSTRING = /BREAKDOWN|OLD /i;
// Teams that used to be tracked and are deliberately gone (Northern
// Illinois left the MAC) -- skipped quietly instead of showing up in
// every upload's "not recognized" list.
const RETIRED_SHEETS = new Set(["NIU"]);

const OFFENSE_POSITIONS = new Set(["QB", "RB", "WR", "TE", "OL"]);
const DEFENSE_POSITIONS = new Set(["DL", "LB", "CB", "SAF"]);

// Same canonical set and mapping as POSITION_MAP in scraper/ncaa_api.py
// (the Pre-Portal Tracker's own normalization), so the two trackers
// agree on what a position means. Anything unrecognized -- including a
// stray state code that leaked into the position column from a
// data-entry mistake upstream -- buckets into ATH rather than showing
// up as its own spurious row in the breakdown.
const POSITION_MAP = {
  QB: "QB",
  RB: "RB", FB: "RB",
  WR: "WR",
  TE: "TE",
  OL: "OL", OT: "OL", OG: "OL", OC: "OL",
  DL: "DL", DE: "DL", DT: "DL", EDGE: "DL",
  LB: "LB", ILB: "LB", OLB: "LB", MLB: "LB",
  CB: "CB",
  S: "SAF", SAF: "SAF", DB: "SAF", FS: "SAF", SS: "SAF",
  LS: "LS", // long snapper
  K: "K", PK: "K", KICKER: "K",
  P: "P", PT: "P", PUNTER: "P",
  ATH: "ATH",
};

export function normalizePosition(rawPosition) {
  return POSITION_MAP[(rawPosition || "").trim().toUpperCase()] || "ATH";
}

// A recruit who's shown up on more than one competing school's board is
// the same real person -- editing these fields on one team's row keeps
// them in sync everywhere that player appears (same class year),
// instead of every team's tab drifting into its own version of the
// truth. Pipeline is synced too -- it's our own read on the recruit, not
// that school's, so it shouldn't differ by whose board you're looking
// at. dateOffered/notes stay per-team on purpose: each school offers
// on its own date and has its own outreach notes.
const SYNCED_FIELDS = new Set(["player", "highSchool", "state", "position", "status", "pipelineStatus"]);

// The source workbook has a corrupted-letter problem (an E often comes
// through as an L: "ANDLRSON"), and a feed spells the same name
// correctly -- so E and L are treated as the same letter when deciding
// whether two rows are the same recruit. Suffixes (Jr./III) are kept:
// "Andrew Davis" and "Andrew Davis Jr." are different players.
// Boys are entered as "Will" on one sheet and "William" on another; the same recruit
// must land in one profile (and share one commitment), so a first name that's a common
// short form is read as its full name. Only unambiguous short forms are listed.
const FIRST_NAME_FORMS = {
  WILL: "WILLIAM", WILLY: "WILLIAM", BILL: "WILLIAM", BILLY: "WILLIAM", MIKE: "MICHAEL", MATT: "MATTHEW", NICK: "NICHOLAS",
  CHRIS: "CHRISTOPHER", BEN: "BENJAMIN", JAKE: "JACOB", JOSH: "JOSHUA", JOE: "JOSEPH", JIM: "JAMES", JIMMY: "JAMES", TONY: "ANTHONY",
  DAN: "DANIEL", DANNY: "DANIEL", DAVE: "DAVID", TOM: "THOMAS", TOMMY: "THOMAS", ZACH: "ZACHARY", ZACK: "ZACHARY", SAM: "SAMUEL",
  ANDY: "ANDREW", ROB: "ROBERT", BOB: "ROBERT", BOBBY: "ROBERT", RICK: "RICHARD", RICKY: "RICHARD", EDDIE: "EDWARD", JEFF: "JEFFREY",
  GREG: "GREGORY", STEVE: "STEVEN", PAT: "PATRICK", CHARLIE: "CHARLES", KENNY: "KENNETH", NATE: "NATHAN", TIM: "TIMOTHY", JON: "JONATHAN",
  ALEX: "ALEXANDER",
};

const NAME_SUFFIXES = new Set(["JR", "SR", "II", "III", "IV"]);
const nameWords = (name) => (name || "").toUpperCase().replace(/[^A-Z ]/g, " ").split(/\s+/).filter(Boolean);

// Last name without Jr./III, and first name with short forms read as the full name -- used to
// find a recruit whose name is spelled a little differently on another sheet.
export function lastNameKey(name) {
  const words = nameWords(name).filter((w) => !NAME_SUFFIXES.has(w));
  return words.length > 1 ? words[words.length - 1] : words[0] || "";
}
export function firstNameKey(name) {
  const first = nameWords(name)[0] || "";
  return FIRST_NAME_FORMS[first] || first;
}

export function normalizePlayerKey(player) {
  const words = (player || "")
    .toUpperCase()
    .replace(/[^A-Z ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ");
  words[0] = FIRST_NAME_FORMS[words[0]] || words[0];
  return words.join(" ").replace(/E/g, "L");
}

// The source spells "committed" many ways (COMITTED, COMMITED, COMTTED,
// COMMMITTED...), sometimes drops the "TO", and a misspelled one never
// gets the red commitment styling. Anything that reads as a commitment
// is rewritten to the canonical "COMMITTED TO SCHOOL"; every other
// status is left alone.
const COMMITTED_WORD = /^\s*C+O+M{1,3}I{0,2}T{1,3}E{0,2}D{1,2}\b\s*(?:TOO?\b\s*)?(.*)$/i;

export function normalizeStatus(status) {
  const text = (status || "").trim();
  const m = COMMITTED_WORD.exec(text);
  if (!m || !m[1].trim()) {
    // A bare school name as the status ("Miami (OH)", "Massachusetts") gets the same one spelling.
    const bare = canonicalSchool(text);
    return bare !== text ? bare.toUpperCase() : text;
  }
  const school = m[1].trim().replace(/\s+/g, " ");
  return `COMMITTED TO ${canonicalSchool(school).toUpperCase()}`;
}

// A commitment is a fact about the recruit, not about whose board you're
// looking at.
export function isCommitment(status) {
  return /^COMMITTED TO /.test(normalizeStatus(status));
}

function normalizeTeamKey(sheetName) {
  return sheetName.trim().toUpperCase();
}

// Every "date offered" is stored one way -- M/D/YY, e.g. 6/26/25 -- whether
// it was typed or imported as 6/26/2025, 06/26/25, 2025-06-26, 6-26-2026...
// Anything that isn't recognizably a date is left exactly as written.
export function normalizeOfferDate(value) {
  const text = (value == null ? "" : String(value)).trim();
  if (!text) return "";
  let month, day, year;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(text); // 2025-06-26
  if (m) [, year, month, day] = m;
  else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(text))) [, month, day, year] = m; // 6/26/25, 6/26/2025
  else return text;
  const mo = Number(month);
  const da = Number(day);
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return text;
  return `${mo}/${da}/${String(year).slice(-2)}`;
}

function excelDateToIso(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" && value.trim()) return value.trim();
  return "";
}

function sanitizeForId(text) {
  return (text || "").toString().trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function offerDocId(classYear, teamKey, player) {
  return `${classYear}__${sanitizeForId(teamKey)}__${sanitizeForId(player)}`;
}

// Finds the "OFFER | NAME | HIGH SCHOOL | STATE | POS | DATE OFFERED |
// STATUS | PIPELINE STATUS | NOTES" header row -- its position and
// exact header text vary sheet to sheet (some have one summary row
// above it, some two, header labels are typo'd inconsistently), but
// the columns are always in this fixed order once you find it.
function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i] || [];
    const a = (row[0] || "").toString().trim().toUpperCase();
    const b = (row[1] || "").toString().trim().toUpperCase();
    if (a === "OFFER" && b === "NAME") return i;
  }
  return -1;
}

function parseTeamSheet(sheet, teamKey) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: "yyyy-mm-dd", defval: "" });
  const headerRow = findHeaderRow(rows);
  if (headerRow === -1) return [];

  const records = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const player = (row[1] || "").toString().trim();
    if (!player) continue;
    records.push({
      player,
      highSchool: (row[2] || "").toString().trim(),
      state: (row[3] || "").toString().trim().toUpperCase(),
      position: normalizePosition((row[4] || "").toString()),
      dateOffered: normalizeOfferDate(excelDateToIso(row[5])),
      status: normalizeStatus((row[6] || "").toString()),
      pipelineStatus: (row[7] || "").toString().trim(),
      notes: (row[8] || "").toString().trim(),
    });
  }
  return records;
}

// Reads every recognized team sheet out of an uploaded workbook and
// writes it to Firestore under the given class year -- replacing
// (not just adding to) each team's previous rows, so a player dropped
// from this week's export doesn't linger forever as a stale row.
// ---- fixing and merging recruit names ---------------------------------------
// The source sheets carry typing/scan garbles (DLMOND SCOLT for DEMOND SCOTT: E and T read as L), and the
// same recruit can be spelled two ways. Fixing one keeps the old spelling on the profile (alsoKnownAs), so
// uploading the same sheet again maps it back to the right name instead of recreating the bad one.
export function buildAliasMap(docs) {
  const map = new Map();
  docs.forEach((d) => (d.alsoKnownAs || []).forEach((alias) => map.set(`${d.classYear}|${normalizePlayerKey(alias)}`, d.player)));
  return map;
}

const nameTokens = (name) => (name || "").toUpperCase().trim().split(/\s+/).filter(Boolean);

// Garbled words in the source sheets follow a pattern: an E read as an L right after a D and before another
// consonant (DLMOND for DEMOND, JAYDLN, ALEXANDLR, ACADLMY) or in a run of Ls (WENDLLL for WENDELL). D-L before a
// vowel is left alone -- that's a real spelling (Bradley, Hadley). A T read as an L (SCOLT for SCOTT) can't be
// told from a real word by pattern, so it's only suggested when the right spelling is used elsewhere on the
// tracker. Suggestions only -- nothing changes until someone accepts one.
const patternFix = (word) => word.replace(/DLLL/g, "DELL").replace(/DL(?=[BCDFGHJKMNPQRSTVWXZ'’])/g, "DE");

const wordsOf = (text) => (text || "").toUpperCase().split(/[^A-Z'’-]+/).filter((w) => w.length >= 3);

export function suggestWordFixes(rows) {
  const inNames = new Map(); // word -> distinct names using it
  const inSchools = new Map(); // word -> distinct schools using it
  const add = (map, word, whole) => {
    if (!map.has(word)) map.set(word, new Set());
    map.get(word).add(whole);
  };
  rows.forEach((d) => {
    const name = (d.player || "").trim().toUpperCase();
    const school = (d.highSchool || "").trim().toUpperCase();
    wordsOf(name).forEach((w) => add(inNames, w, name));
    wordsOf(school).forEach((w) => add(inSchools, w, school));
  });
  const use = (w) => (inNames.get(w)?.size || 0) + (inSchools.get(w)?.size || 0);

  const out = [];
  new Set([...inNames.keys(), ...inSchools.keys()]).forEach((word) => {
    if (!word.includes("L")) return;
    let to = patternFix(word);
    // Another spelling (E/T for L) already used more often on the tracker beats the pattern.
    const spots = [...word].map((c, i) => (c === "L" ? i : -1)).filter((i) => i >= 0).slice(0, 4);
    let best = { text: "", count: 0 };
    for (let n = 1; n < 3 ** spots.length; n++) {
      const v = word.split("");
      let rest = n;
      spots.forEach((at) => {
        const pick = rest % 3;
        rest = Math.floor(rest / 3);
        if (pick) v[at] = pick === 1 ? "E" : "T";
      });
      const text = v.join("");
      const count = use(text);
      if (count > best.count) best = { text, count };
    }
    if (best.count >= 2 && best.count >= 3 * (use(word) + 1)) to = best.text;
    if (to === word || to.length !== word.length) return;
    out.push({ from: word, to, names: [...(inNames.get(word) || [])], schools: [...(inSchools.get(word) || [])] });
  });
  return out.sort((a, b) => b.names.length + b.schools.length - (a.names.length + a.schools.length) || a.from.localeCompare(b.from));
}

const wholeWord = (word) => new RegExp(`(^|[^A-Z'’-])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^A-Z'’-])`, "gi");

export async function importWorkbook(file, classYear) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { cellDates: true });

  const summary = { teamsImported: 0, rowsImported: 0, skippedSheets: [] };
  // Collected across every team sheet, then committed in batches --
  // a full conference workbook is 1,000+ rows, and writing those one
  // setDoc/deleteDoc at a time (each its own network round trip) took
  // minutes. Firestore batched writes cap at 500 ops each; a handful
  // of batches committed in parallel takes seconds instead.
  const operations = [];

  // Names already fixed or merged on the tracker: a spelling that was corrected maps back to the right one.
  const aliasSnap = await getDocs(query(collection(db, "offers"), where("classYear", "==", classYear)));
  const aliasMap = buildAliasMap(aliasSnap.docs.map((d) => d.data()));

  for (const sheetName of workbook.SheetNames) {
    const teamKey = normalizeTeamKey(sheetName);
    if (SKIP_SHEET_PATTERN.test(teamKey) || SKIP_SHEET_SUBSTRING.test(teamKey) || RETIRED_SHEETS.has(teamKey)) continue;
    const meta = TEAM_CONFERENCE[teamKey];
    if (!meta) {
      summary.skippedSheets.push(sheetName);
      continue;
    }

    const records = parseTeamSheet(workbook.Sheets[sheetName], teamKey);
    records.forEach((r) => {
      const fixed = aliasMap.get(`${classYear}|${normalizePlayerKey(r.player)}`);
      if (fixed) r.player = fixed;
    });

    const existingQuery = query(collection(db, "offers"), where("classYear", "==", classYear), where("team", "==", teamKey));
    const existingSnap = await getDocs(existingQuery);
    const staleIds = new Set(existingSnap.docs.map((d) => d.id));
    // An offer someone removed as inaccurate stays removed: it isn't
    // deleted (so we still know to skip it) and isn't re-imported.
    const removedIds = new Set(existingSnap.docs.filter((d) => d.data().removed).map((d) => d.id));
    removedIds.forEach((id) => staleIds.delete(id));

    for (const record of records) {
      const id = offerDocId(classYear, teamKey, record.player);
      staleIds.delete(id);
      if (removedIds.has(id)) continue;
      operations.push({
        type: "set",
        id,
        data: {
          ...record,
          classYear,
          team: teamKey,
          teamLabel: meta.label,
          conference: meta.conference,
          updatedAt: new Date().toISOString(),
        },
      });
    }
    for (const id of staleIds) {
      operations.push({ type: "delete", id });
    }

    summary.teamsImported += 1;
    summary.rowsImported += records.length;
  }

  const BATCH_SIZE = 450;
  const commits = [];
  for (let i = 0; i < operations.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    for (const op of operations.slice(i, i + BATCH_SIZE)) {
      const ref = doc(db, "offers", op.id);
      if (op.type === "set") batch.set(ref, op.data);
      else batch.delete(ref);
    }
    commits.push(batch.commit());
  }
  await Promise.all(commits);

  return summary;
}

// The feed names schools the way a recruiting site does.
const FEED_COLLEGE_TO_TEAM = {
  "MIAMI (OH)": "MIAMI (OH)", "KENT STATE": "KENT STATE", TOLEDO: "TOLEDO", "BOWLING GREEN": "BGSU",
  "SAC STATE": "SAC STATE", "EASTERN MICHIGAN": "EMU", AKRON: "AKRON", "WESTERN MICHIGAN": "WMU",
  BUFFALO: "BUFFALO", OHIO: "OHIO", MASSACHUSETTS: "UMASS", UMASS: "UMASS", "BALL STATE": "BALL STATE",
  "CENTRAL MICHIGAN": "CMU",
};

// How the feed's "All Offer Schools" column spells every school we already
// track (MAC, MVC, Ivy). Matched exactly, not fuzzily -- "Toledo (Spain)"
// is a different school from Toledo. Anything not listed is an "other
// offer": a school outside the conferences we track.
const TRACKED_SCHOOL_NAMES = new Set([
  "Central Michigan University", "Bowling Green", "Western Michigan University", "Eastern Michigan University",
  "California State University - Sacramento", "Ball State University", "University of Akron", "Ohio", "Toledo",
  "Miami University (OH)", "Kent State University", "University of Massachusetts", "University at Buffalo",
  "North Dakota State University", "South Dakota State University", "University of South Dakota",
  "University of North Dakota", "Illinois State University", "Southern Illinois University Carbondale",
  "Indiana State University", "Youngstown State University", "University of Northern Iowa", "Murray State University",
  "Columbia University", "Cornell University", "Yale University", "Princeton University", "Harvard University",
  "Dartmouth College", "University of Pennsylvania", "Brown University",
].map((n) => n.toUpperCase()));

function otherOffersFromFeed(allOfferSchools) {
  const seen = new Set();
  return (allOfferSchools || "")
    .split(",")
    .map((n) => n.trim())
    .filter((n) => n && !TRACKED_SCHOOL_NAMES.has(n.toUpperCase()) && !seen.has(n.toUpperCase()) && seen.add(n.toUpperCase()))
    .sort((a, b) => a.localeCompare(b));
}

// "2026-09-18T00:00:00+00:00" -> "9/18/2026", the same M/D/YYYY text the
// boards already use (the date part is taken as written, so no timezone
// shift can move it a day).
function feedDateToText(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? normalizeOfferDate(`${m[2]}/${m[3]}/${m[1]}`) : "";
}

// Merges a weekly activity feed (one row per player + school, each an
// offer / commit / de-commit event, with a Grad Year column, so 2027 and
// 2028 come in together) into the boards. Unlike a workbook upload this
// never replaces anything: existing rows keep their pipeline, notes and
// dates, and are only filled in where blank; new offers become new rows;
// and a commitment (or a de-commit) applies to that recruit on every
// sheet, since it's a fact about the player.
export async function importActivityFeed(file, { dryRun = false } = {}) {
  const text = await file.text();
  const workbook = XLSX.read(text, { type: "string", raw: true });
  const feedRows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "", raw: true }).map((r) => {
    const o = {};
    Object.keys(r).forEach((k) => (o[k.trim()] = String(r[k]).trim()));
    return o;
  });
  if (feedRows.length && !("Recruiting College" in feedRows[0] && "Grad Year" in feedRows[0] && "Name" in feedRows[0])) {
    throw new Error("This doesn't look like an activity feed -- expected Name, Grad Year and Recruiting College columns.");
  }

  const summary = { created: 0, updated: 0, commitmentsApplied: 0, otherOffersUpdated: 0, years: [], skippedColleges: [] };
  const skipped = new Set();

  const events = [];
  feedRows.forEach((r) => {
    const team = FEED_COLLEGE_TO_TEAM[r["Recruiting College"].toUpperCase()];
    if (!team) {
      if (r["Recruiting College"]) skipped.add(r["Recruiting College"]);
      return;
    }
    if (!r["Name"] || !r["Grad Year"]) return;
    events.push({ ...r, team, classYear: r["Grad Year"], day: r["Date"].slice(0, 10) });
  });
  summary.skippedColleges = [...skipped];

  // Each row's "All Offer Schools" is that recruit's full offer list as of
  // the row's date, so the most recent row per player has the freshest one.
  const otherOffersByPlayer = new Map(); // key -> { day, list }
  feedRows.forEach((r) => {
    if (!r["Name"] || !r["Grad Year"] || !r["All Offer Schools"]) return;
    const k = `${r["Grad Year"]}|${normalizePlayerKey(r["Name"])}`;
    const day = r["Date"].slice(0, 10);
    const cur = otherOffersByPlayer.get(k);
    if (!cur || day >= cur.day) otherOffersByPlayer.set(k, { day, list: otherOffersFromFeed(r["All Offer Schools"]) });
  });

  const years = [...new Set(events.map((e) => e.classYear))].sort();
  summary.years = years;
  if (!events.length) return summary;

  const existing = [];
  for (const year of years) {
    const snap = await getDocs(query(collection(db, "offers"), where("classYear", "==", year)));
    snap.docs.forEach((d) => existing.push({ id: d.id, ...d.data() }));
  }
  const existingByTeamPlayer = new Map(existing.map((d) => [`${d.classYear}|${d.team}|${normalizePlayerKey(d.player)}`, d]));
  const existingByPlayer = new Map();
  existing.forEach((d) => {
    const k = `${d.classYear}|${normalizePlayerKey(d.player)}`;
    if (!existingByPlayer.has(k)) existingByPlayer.set(k, []);
    existingByPlayer.get(k).push(d);
  });

  // Each recruit's current commitment comes from their most recent
  // event. On a de-commit row, "Committed" equal to that row's school
  // means they left it (now uncommitted); a different school is where
  // they've gone.
  const eventsByPlayer = new Map();
  events.forEach((e) => {
    const k = `${e.classYear}|${normalizePlayerKey(e.Name)}`;
    if (!eventsByPlayer.has(k)) eventsByPlayer.set(k, []);
    eventsByPlayer.get(k).push(e);
  });
  const commitmentByPlayer = new Map(); // key -> "COMMITTED TO X" | "" (cleared)
  eventsByPlayer.forEach((list, k) => {
    const latest = [...list].sort((a, b) => (a.day === b.day ? (a.Type === "offer" ? -1 : 1) : a.day < b.day ? -1 : 1)).pop();
    const target = latest["Committed"];
    const decommit = latest["Type"] === "de-commit";
    if (decommit) {
      const away = !target || target.toUpperCase() === latest["Recruiting College"].toUpperCase();
      commitmentByPlayer.set(k, away ? "" : normalizeStatus(`COMMITTED TO ${target}`));
    } else if (target) {
      commitmentByPlayer.set(k, normalizeStatus(`COMMITTED TO ${target}`));
    }
  });

  const patches = new Map(); // doc id -> fields to update
  const newDocs = new Map(); // doc id -> full doc
  const patch = (id, fields) => patches.set(id, { ...(patches.get(id) || {}), ...fields });
  const now = new Date().toISOString();

  // One board row per player + school: the earliest offer date wins.
  const teamRows = new Map();
  events.forEach((e) => {
    const k = `${e.classYear}|${e.team}|${normalizePlayerKey(e.Name)}`;
    const cur = teamRows.get(k);
    const offerDay = e["Type"] === "offer" ? e.day : "";
    if (!cur) teamRows.set(k, { ...e, offerDay: offerDay || "" });
    else if (offerDay && (!cur.offerDay || offerDay < cur.offerDay)) cur.offerDay = offerDay;
  });

  teamRows.forEach((e, k) => {
    const cleanSchool = e["Current School"].replace(/\s*\([A-Za-z]{2}\)\s*$/, "").trim();
    const position = normalizePosition(e["Position"]);
    const dateText = feedDateToText(e.offerDay || e.day);
    const found = existingByTeamPlayer.get(k);
    if (found && found.removed) return;
    if (found) {
      const fill = {};
      if (!found.highSchool && cleanSchool) fill.highSchool = cleanSchool.toUpperCase();
      if (!found.state && e["School State"]) fill.state = e["School State"].toUpperCase();
      if (!found.position && position) fill.position = position;
      if (!found.dateOffered && dateText) fill.dateOffered = dateText;
      // The feed spells the name correctly; the boards often don't.
      if (found.player !== e["Name"].toUpperCase()) fill.player = e["Name"].toUpperCase();
      if (Object.keys(fill).length) {
        patch(found.id, { ...fill, updatedAt: now });
        summary.updated += 1;
      }
    } else {
      const id = offerDocId(e.classYear, e.team, e["Name"]);
      const meta = TEAM_CONFERENCE[e.team];
      newDocs.set(id, {
        player: e["Name"].toUpperCase(),
        highSchool: cleanSchool.toUpperCase(),
        state: (e["School State"] || "").toUpperCase(),
        position,
        dateOffered: dateText,
        status: "",
        pipelineStatus: "",
        notes: "",
        classYear: e.classYear,
        team: e.team,
        teamLabel: meta.label,
        conference: meta.conference,
        updatedAt: now,
      });
      summary.created += 1;
    }
  });

  // Commitments apply to the recruit everywhere: every existing row of
  // theirs (any team, including ones this feed doesn't cover) and
  // every row created above.
  commitmentByPlayer.forEach((status, pk) => {
    (existingByPlayer.get(pk) || []).filter((d) => !d.removed).forEach((d) => {
      const current = (d.status || "").trim().toUpperCase();
      if (current !== status && (status || isCommitment(current))) {
        patch(d.id, { status, updatedAt: now });
        summary.commitmentsApplied += 1;
      }
    });
    newDocs.forEach((doc0) => {
      if (`${doc0.classYear}|${normalizePlayerKey(doc0.player)}` === pk) doc0.status = status;
    });
  });

  // Other offers are a fact about the recruit too: every row of theirs
  // (existing or just created) carries the same list.
  const sameList = (a, b) => (a || []).join("|") === (b || []).join("|");
  otherOffersByPlayer.forEach(({ list }, pk) => {
    (existingByPlayer.get(pk) || []).filter((d) => !d.removed).forEach((d) => {
      if (!sameList(d.otherOffers, list)) {
        patch(d.id, { otherOffers: list, updatedAt: now });
        summary.otherOffersUpdated += 1;
      }
    });
    newDocs.forEach((doc0) => {
      if (`${doc0.classYear}|${normalizePlayerKey(doc0.player)}` === pk) doc0.otherOffers = list;
    });
  });

  const operations = [
    ...[...newDocs].map(([id, data]) => ({ type: "set", id, data })),
    ...[...patches].map(([id, data]) => ({ type: "update", id, data })),
  ];
  if (dryRun) return summary;
  const commits = [];
  for (let i = 0; i < operations.length; i += 450) {
    const batch = writeBatch(db);
    for (const op of operations.slice(i, i + 450)) {
      const ref = doc(db, "offers", op.id);
      if (op.type === "set") batch.set(ref, op.data);
      else batch.update(ref, op.data);
    }
    commits.push(batch.commit());
  }
  await Promise.all(commits);
  return summary;
}

export function useOfferTracker() {
  const [docs, setDocs] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "offers"),
      (snap) => {
        setDocs(
          snap.docs
            .map((d) => {
              const data = d.data() || {};
              return { id: d.id, ...data, status: normalizeStatus(data.status), dateOffered: normalizeOfferDate(data.dateOffered) };
            })
            .filter((d) => !d.removed)
        );
        // Misspelled commitments already in the database get rewritten
        // once (shown corrected either way; this keeps the stored value
        // clean too). Idempotent: nothing is left to fix afterwards.
        // (Dates get the same treatment: stored as M/D/YY.)
        const untidy = snap.docs.filter((d) => {
          const data = d.data();
          const status = (data.status || "").trim();
          const date = data.dateOffered == null ? "" : String(data.dateOffered);
          return (status && normalizeStatus(status) !== status) || (date && normalizeOfferDate(date) !== date);
        });
        for (let i = 0; i < untidy.length; i += 450) {
          const batch = writeBatch(db);
          untidy.slice(i, i + 450).forEach((d) => {
            const data = d.data();
            batch.update(d.ref, { status: normalizeStatus(data.status), dateOffered: normalizeOfferDate(data.dateOffered) });
          });
          batch.commit().catch(() => {});
        }
        setReady(true);
      },
      () => setReady(true)
    );
    return unsubscribe;
  }, []);

  const classYears = useMemo(() => {
    return [...new Set(docs.map((d) => d.classYear))].sort();
  }, [docs]);

  function teamsForConference(classYear, conference) {
    return Object.entries(TEAM_CONFERENCE)
      .filter(([, meta]) => meta.conference === conference)
      .map(([team, meta]) => ({ team, label: meta.label, color: meta.color, colorSecondary: meta.colorSecondary }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  // A row with no pipeline of its own takes the one set on the same
  // recruit's row on another team's sheet, so existing data (where it
  // was only ever filled in on one sheet) reads consistently without a
  // migration. A row's own value always wins; editing writes it to
  // every sheet (see updateOfferField), which removes any conflict.
  //
  // Same idea for a commitment: if the recruit is "committed to X" on
  // any sheet, every sheet shows it -- it overrides a blank or a plain
  // "Offered", but never replaces a commitment a row already has.
  const effectiveDocs = useMemo(() => {
    const pipelineByPlayer = new Map();
    const commitByPlayer = new Map();
    docs.forEach((d) => {
      const key = `${d.classYear}|${normalizePlayerKey(d.player)}`;
      const p = (d.pipelineStatus || "").trim();
      if (p && !pipelineByPlayer.has(key)) pipelineByPlayer.set(key, p);
      if (isCommitment(d.status) && !commitByPlayer.has(key)) commitByPlayer.set(key, d.status.trim());
    });
    return docs.map((d) => {
      const key = `${d.classYear}|${normalizePlayerKey(d.player)}`;
      const pipelineStatus = (d.pipelineStatus || "").trim() ? d.pipelineStatus : pipelineByPlayer.get(key) || "";
      const status = isCommitment(d.status) ? d.status : commitByPlayer.get(key) || d.status;
      return pipelineStatus === d.pipelineStatus && status === d.status ? d : { ...d, pipelineStatus, status };
    });
  }, [docs]);

  function rowsForClassYear(classYear) {
    return effectiveDocs.filter((d) => d.classYear === classYear);
  }

  function rowsForTeam(classYear, team) {
    return effectiveDocs.filter((d) => d.classYear === classYear && d.team === team);
  }

  // Every team's row for one recruit -- the whole point of tracking
  // competing schools' boards is seeing who else is after the same
  // player, so this spans every conference, not just the one currently
  // open.
  // Indexed once per data change, so asking for one recruit's rows doesn't rescan every offer.
  const rowsByPlayer = useMemo(() => {
    const index = new Map();
    effectiveDocs.forEach((d) => {
      const k = `${d.classYear}|${normalizePlayerKey(d.player)}`;
      if (!index.has(k)) index.set(k, []);
      index.get(k).push(d);
    });
    return index;
  }, [effectiveDocs]);

  // Same rows grouped by class year and last name, for spelling-tolerant lookups.
  const rowsByLast = useMemo(() => {
    const index = new Map();
    effectiveDocs.forEach((d) => {
      const k = `${d.classYear}|${lastNameKey(d.player)}`;
      if (!index.has(k)) index.set(k, []);
      index.get(k).push(d);
    });
    return index;
  }, [effectiveDocs]);

  function rowsForPlayer(classYear, player) {
    return rowsByPlayer.get(`${classYear}|${normalizePlayerKey(player)}`) || [];
  }

  // Hides one team's offer for a recruit -- for when that school's
  // offer turns out to be inaccurate. Kept in the database, flagged
  // removed, rather than deleted: otherwise the next upload would just
  // bring it back, and this way both uploads know to skip it.
  // Every distinct spelling on file for a class year (for pickers).
  function profileNames(classYear) {
    return [...new Set(effectiveDocs.filter((d) => d.classYear === classYear).map((d) => d.player))].sort();
  }

  function suggestFixes() {
    return suggestWordFixes(docs.filter((d) => !d.removed));
  }

  // How many rows a word replacement would touch (for the preview).
  function wordReplacementPreview(from, { names = true, schools = true } = {}) {
    if (!from.trim()) return { names: [], schools: [], rows: 0 };
    const re = wholeWord(from.trim());
    const test = (text) => ((re.lastIndex = 0), re.test(text || ""));
    const live = docs.filter((d) => !d.removed);
    const nameHits = names ? [...new Set(live.filter((d) => test(d.player)).map((d) => d.player))] : [];
    const schoolHits = schools ? [...new Set(live.filter((d) => test(d.highSchool)).map((d) => d.highSchool))] : [];
    const rows = live.filter((d) => (names && test(d.player)) || (schools && test(d.highSchool))).length;
    return { names: nameHits, schools: schoolHits, rows };
  }

  // Replaces a whole word in recruits' names and/or high schools on every team's sheet. A changed name keeps
  // its old spelling as an alias, so uploading the same sheet again maps back to the corrected name.
  async function replaceWord(from, to, { names = true, schools = true } = {}) {
    const source = from.trim();
    const target = to.trim().toUpperCase();
    if (!source || !target) throw new Error("Enter the word to replace and what it should be.");
    const re = wholeWord(source);
    const swap = (text) => (text || "").replace(re, (m, lead) => `${lead}${target}`);
    const changes = [];
    docs
      .filter((d) => !d.removed)
      .forEach((d) => {
        const patch = {};
        if (names && swap(d.player) !== d.player) {
          patch.player = swap(d.player);
          patch.alsoKnownAs = [...new Set([...(d.alsoKnownAs || []), d.player])];
        }
        if (schools && swap(d.highSchool) !== d.highSchool) patch.highSchool = swap(d.highSchool);
        if (Object.keys(patch).length) changes.push({ id: d.id, patch: { ...patch, updatedAt: new Date().toISOString() } });
      });
    for (let i = 0; i < changes.length; i += 400) {
      const batch = writeBatch(db);
      changes.slice(i, i + 400).forEach((c) => batch.update(doc(db, "offers", c.id), c.patch));
      await batch.commit();
    }
    return { rows: changes.length };
  }

  // Makes `fromName` and `toName` one profile under `toName`'s spelling (the correct one). If `toName` isn't on
  // file it's a plain rename. Where both profiles have a row for the same team the rows are combined and the
  // duplicate is removed; every row keeps the old spelling as an alias so re-uploads land on the right name.
  async function mergeProfile(classYear, fromName, toName) {
    const target = (toName || "").trim().toUpperCase();
    if (!target) throw new Error("Enter the correct name.");
    const inYear = docs.filter((d) => d.classYear === classYear && !d.removed);
    const fromKey = normalizePlayerKey(fromName);
    const fromRows = inYear.filter((d) => normalizePlayerKey(d.player) === fromKey);
    const toRows = inYear.filter((d) => normalizePlayerKey(d.player) === normalizePlayerKey(target) && !fromRows.includes(d));
    if (!fromRows.length) throw new Error("That profile wasn't found.");
    const canonical = toRows[0]?.player || target;
    const aliases = new Set([
      ...fromRows.map((d) => d.player),
      ...fromRows.flatMap((d) => d.alsoKnownAs || []),
      ...toRows.flatMap((d) => d.alsoKnownAs || []),
    ]);
    aliases.delete(canonical);
    const alsoKnownAs = [...aliases];
    const now = new Date().toISOString();
    const FILL = ["dateOffered", "status", "pipelineStatus", "notes", "highSchool", "state", "position"];
    const blank = (v) => v === undefined || v === null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length);

    const batch = writeBatch(db);
    let merged = 0;
    let renamed = 0;
    const sharedInfo = {};
    toRows.forEach((t) => FILL.forEach((k) => blank(sharedInfo[k]) && !blank(t[k]) && (sharedInfo[k] = t[k])));
    fromRows.forEach((f) => {
      const t = toRows.find((x) => x.team === f.team);
      if (t) {
        const patch = { alsoKnownAs, updatedAt: now };
        [...FILL, "otherOffers"].forEach((k) => blank(t[k]) && !blank(f[k]) && (patch[k] = f[k]));
        batch.update(doc(db, "offers", t.id), patch);
        batch.update(doc(db, "offers", f.id), { removed: true, removedAt: now, mergedInto: canonical });
        merged += 1;
      } else {
        const patch = { player: canonical, alsoKnownAs, updatedAt: now };
        FILL.forEach((k) => blank(f[k]) && !blank(sharedInfo[k]) && (patch[k] = sharedInfo[k]));
        batch.update(doc(db, "offers", f.id), patch);
        renamed += 1;
      }
    });
    toRows.forEach((t) => !fromRows.some((f) => f.team === t.team) && batch.update(doc(db, "offers", t.id), { alsoKnownAs, updatedAt: now }));
    await batch.commit();
    return { canonical, merged, renamed };
  }

  async function removeOffer(row) {
    await updateDoc(doc(db, "offers", row.id), { removed: true, removedAt: new Date().toISOString() });
  }

  // Adds an offer by hand. If the recruit is already on another team's
  // board, their school/state/position are reused so the two can't
  // disagree. Adding back an offer that was removed brings it back.
  async function addOffer(classYear, team, fields) {
    const meta = TEAM_CONFERENCE[team];
    const player = (fields.player || "").trim();
    if (!meta || !player) throw new Error("A name is required.");
    const id = offerDocId(classYear, team, player);
    if (docs.some((d) => d.id === id || (d.classYear === classYear && d.team === team && normalizePlayerKey(d.player) === normalizePlayerKey(player)))) {
      throw new Error(`${player} is already on ${meta.label}'s board.`);
    }
    const sibling = docs.find((d) => d.classYear === classYear && normalizePlayerKey(d.player) === normalizePlayerKey(player));
    await setDoc(doc(db, "offers", id), {
      player: player.toUpperCase(),
      highSchool: (fields.highSchool || sibling?.highSchool || "").trim().toUpperCase(),
      state: (fields.state || sibling?.state || "").trim().toUpperCase(),
      position: normalizePosition(fields.position || sibling?.position || ""),
      dateOffered: normalizeOfferDate(fields.dateOffered),
      status: "",
      pipelineStatus: "",
      notes: (fields.notes || "").trim(),
      ...(sibling?.otherOffers ? { otherOffers: sibling.otherOffers } : {}),
      classYear,
      team,
      teamLabel: meta.label,
      conference: meta.conference,
      updatedAt: new Date().toISOString(),
    });
  }

  // Edits one field on one row. For a synced field (see SYNCED_FIELDS
  // above), also applies it to every other row in the same class year
  // whose player name matches -- found from the already-loaded `docs`
  // rather than a fresh query, since the whole collection is already
  // held here via the snapshot listener.
  async function updateOfferField(row, field, rawValue) {
    const value = field === "status" ? normalizeStatus(rawValue) : field === "dateOffered" ? normalizeOfferDate(rawValue) : rawValue;
    const updatedAt = new Date().toISOString();
    if (!SYNCED_FIELDS.has(field)) {
      await updateDoc(doc(db, "offers", row.id), { [field]: value, updatedAt });
      return;
    }
    const key = normalizePlayerKey(row.player);
    const siblings = docs.filter((d) => d.classYear === row.classYear && normalizePlayerKey(d.player) === key);
    const batch = writeBatch(db);
    siblings.forEach((d) => batch.update(doc(db, "offers", d.id), { [field]: value, updatedAt }));
    await batch.commit();
  }

  // {positions: [...], teams: [{team,label}], counts: {position: {team: n}}, totals: {team: n}, offTotals, defTotals}
  function positionBreakdown(classYear, conference) {
    const teams = teamsForConference(classYear, conference);
    // Re-normalized here too (not just at import) as a safety net for
    // rows imported before this normalization existed -- without a
    // re-upload, a stray value like a state code sitting in the
    // position column would otherwise show up as its own row instead
    // of folding into ATH.
    const rows = docs
      .filter((d) => d.classYear === classYear && d.conference === conference)
      .map((d) => ({ ...d, position: normalizePosition(d.position) }));
    const positions = [...new Set(rows.map((r) => r.position).filter(Boolean))].sort();
    const counts = {};
    const totals = {};
    const offTotals = {};
    const defTotals = {};
    positions.forEach((pos) => (counts[pos] = {}));
    teams.forEach(({ team }) => {
      totals[team] = 0;
      offTotals[team] = 0;
      defTotals[team] = 0;
    });
    rows.forEach((r) => {
      if (!r.position) return;
      counts[r.position][r.team] = (counts[r.position][r.team] || 0) + 1;
      totals[r.team] = (totals[r.team] || 0) + 1;
      if (OFFENSE_POSITIONS.has(r.position)) offTotals[r.team] = (offTotals[r.team] || 0) + 1;
      if (DEFENSE_POSITIONS.has(r.position)) defTotals[r.team] = (defTotals[r.team] || 0) + 1;
    });
    return { teams, positions, counts, totals, offTotals, defTotals };
  }

  // {states: [...], teams, counts: {state: {team: n}}, totals: {state: n}}
  function areaBreakdown(classYear, conference) {
    const teams = teamsForConference(classYear, conference);
    const rows = docs.filter((d) => d.classYear === classYear && d.conference === conference);
    const counts = {};
    const stateTotals = {};
    rows.forEach((r) => {
      if (!r.state) return;
      counts[r.state] ||= {};
      counts[r.state][r.team] = (counts[r.state][r.team] || 0) + 1;
      stateTotals[r.state] = (stateTotals[r.state] || 0) + 1;
    });
    const states = Object.keys(counts).sort((a, b) => stateTotals[b] - stateTotals[a]);
    return { teams, states, counts, stateTotals };
  }

  return { ready, classYears, teamsForConference, rowsForClassYear, rowsForTeam, rowsForPlayer, rowsByPlayer, rowsByLast, profileNames, suggestFixes, wordReplacementPreview, replaceWord, mergeProfile, positionBreakdown, areaBreakdown, importWorkbook, importActivityFeed, updateOfferField, removeOffer, addOffer };
}
