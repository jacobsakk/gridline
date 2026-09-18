import * as XLSX from "xlsx";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
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
  NIU: { conference: "MAC", label: "Northern Illinois", color: "#C8102E", colorSecondary: "#000000" },
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
  OL: "OL", LS: "OL",
  DL: "DL", DE: "DL", DT: "DL",
  LB: "LB",
  CB: "CB",
  S: "SAF", SAF: "SAF", DB: "SAF",
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

function normalizePlayerKey(player) {
  return (player || "").trim().toUpperCase();
}

function normalizeTeamKey(sheetName) {
  return sheetName.trim().toUpperCase();
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
      dateOffered: excelDateToIso(row[5]),
      status: (row[6] || "").toString().trim(),
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

  for (const sheetName of workbook.SheetNames) {
    const teamKey = normalizeTeamKey(sheetName);
    if (SKIP_SHEET_PATTERN.test(teamKey) || SKIP_SHEET_SUBSTRING.test(teamKey)) continue;
    const meta = TEAM_CONFERENCE[teamKey];
    if (!meta) {
      summary.skippedSheets.push(sheetName);
      continue;
    }

    const records = parseTeamSheet(workbook.Sheets[sheetName], teamKey);

    const existingQuery = query(collection(db, "offers"), where("classYear", "==", classYear), where("team", "==", teamKey));
    const existingSnap = await getDocs(existingQuery);
    const staleIds = new Set(existingSnap.docs.map((d) => d.id));

    for (const record of records) {
      const id = offerDocId(classYear, teamKey, record.player);
      staleIds.delete(id);
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

export function useOfferTracker() {
  const [docs, setDocs] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "offers"),
      (snap) => {
        setDocs(snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })));
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
  const effectiveDocs = useMemo(() => {
    const byPlayer = new Map();
    docs.forEach((d) => {
      const p = (d.pipelineStatus || "").trim();
      const key = `${d.classYear}|${normalizePlayerKey(d.player)}`;
      if (p && !byPlayer.has(key)) byPlayer.set(key, p);
    });
    return docs.map((d) =>
      (d.pipelineStatus || "").trim() ? d : { ...d, pipelineStatus: byPlayer.get(`${d.classYear}|${normalizePlayerKey(d.player)}`) || "" }
    );
  }, [docs]);

  function rowsForTeam(classYear, team) {
    return effectiveDocs.filter((d) => d.classYear === classYear && d.team === team);
  }

  // Every team's row for one recruit -- the whole point of tracking
  // competing schools' boards is seeing who else is after the same
  // player, so this spans every conference, not just the one currently
  // open.
  function rowsForPlayer(classYear, player) {
    const key = normalizePlayerKey(player);
    return effectiveDocs.filter((d) => d.classYear === classYear && normalizePlayerKey(d.player) === key);
  }

  // Edits one field on one row. For a synced field (see SYNCED_FIELDS
  // above), also applies it to every other row in the same class year
  // whose player name matches -- found from the already-loaded `docs`
  // rather than a fresh query, since the whole collection is already
  // held here via the snapshot listener.
  async function updateOfferField(row, field, value) {
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

  return { ready, classYears, teamsForConference, rowsForTeam, rowsForPlayer, positionBreakdown, areaBreakdown, importWorkbook, updateOfferField };
}
