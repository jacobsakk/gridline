import * as XLSX from "xlsx";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import { useEffect, useMemo, useState } from "react";

// Sheet name (as it appears in the workbook, case-insensitive) -> which
// conference it belongs to and how to display it. Hand-maintained the
// same way D2_KNOWN_CONFERENCES/CONFERENCE_CORRECTIONS are in the
// scraper -- add a line here when a new team gets its own tab.
export const TEAM_CONFERENCE = {
  CMU: { conference: "MAC", label: "Central Michigan" },
  BGSU: { conference: "MAC", label: "Bowling Green" },
  WMU: { conference: "MAC", label: "Western Michigan" },
  EMU: { conference: "MAC", label: "Eastern Michigan" },
  NIU: { conference: "MAC", label: "Northern Illinois" },
  "BALL STATE": { conference: "MAC", label: "Ball State" },
  AKRON: { conference: "MAC", label: "Akron" },
  OHIO: { conference: "MAC", label: "Ohio" },
  TOLEDO: { conference: "MAC", label: "Toledo" },
  "MIAMI (OH)": { conference: "MAC", label: "Miami (OH)" },
  "KENT STATE": { conference: "MAC", label: "Kent State" },
  UMASS: { conference: "MAC", label: "UMass" },
  BUFFALO: { conference: "MAC", label: "Buffalo" },

  "NORTH DAKOTA STATE": { conference: "MVC", label: "North Dakota State" },
  "SOUTH DAKOTA STATE": { conference: "MVC", label: "South Dakota State" },
  "SOUTH DAKOTA": { conference: "MVC", label: "South Dakota" },
  "NORTH DAKOTA": { conference: "MVC", label: "North Dakota" },
  "ILLINOIS STATE": { conference: "MVC", label: "Illinois State" },
  "SOUTHERN ILLINOIS": { conference: "MVC", label: "Southern Illinois" },
  "INDIANA STATE": { conference: "MVC", label: "Indiana State" },
  "YOUNGSTOWN STATE": { conference: "MVC", label: "Youngstown State" },
  "NORTHERN IOWA": { conference: "MVC", label: "Northern Iowa" },
  "MURRAY STATE": { conference: "MVC", label: "Murray State" },

  COLUMBIA: { conference: "IVY", label: "Columbia" },
  CORNELL: { conference: "IVY", label: "Cornell" },
  YALE: { conference: "IVY", label: "Yale" },
  PRINCETON: { conference: "IVY", label: "Princeton" },
  HARVARD: { conference: "IVY", label: "Harvard" },
  DARTMOUTH: { conference: "IVY", label: "Dartmouth" },
  PENN: { conference: "IVY", label: "Penn" },
  BROWN: { conference: "IVY", label: "Brown" },
};

export const CONFERENCE_ORDER = ["MAC", "MVC", "IVY"];

// Sheets that aren't a team's offer list -- the assignment index, the
// text-message template, stale archives, and the derived breakdown
// tabs (those get recomputed live from the team rows instead of read).
const SKIP_SHEET_PATTERN = /^(ASSIGNMENTS|QUESTIONNAIRE)$/i;
const SKIP_SHEET_SUBSTRING = /BREAKDOWN|OLD /i;

const OFFENSE_POSITIONS = new Set(["QB", "RB", "WR", "TE", "OL"]);
const DEFENSE_POSITIONS = new Set(["DL", "LB", "CB", "SAF"]);

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
      position: (row[4] || "").toString().trim().toUpperCase(),
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
      .map(([team, meta]) => ({ team, label: meta.label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  function rowsForTeam(classYear, team) {
    return docs.filter((d) => d.classYear === classYear && d.team === team);
  }

  // {positions: [...], teams: [{team,label}], counts: {position: {team: n}}, totals: {team: n}, offTotals, defTotals}
  function positionBreakdown(classYear, conference) {
    const teams = teamsForConference(classYear, conference);
    const rows = docs.filter((d) => d.classYear === classYear && d.conference === conference);
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

  return { ready, classYears, teamsForConference, rowsForTeam, positionBreakdown, areaBreakdown, importWorkbook };
}
