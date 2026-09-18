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
  OL: "OL", LS: "OL", OT: "OL", OG: "OL", OC: "OL",
  DL: "DL", DE: "DL", DT: "DL", EDGE: "DL",
  LB: "LB", ILB: "LB", OLB: "LB", MLB: "LB",
  CB: "CB",
  S: "SAF", SAF: "SAF", DB: "SAF", FS: "SAF", SS: "SAF",
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
function normalizePlayerKey(player) {
  return (player || "")
    .toUpperCase()
    .replace(/[^A-Z ]/g, "")
    .replace(/E/g, "L")
    .replace(/\s+/g, " ")
    .trim();
}

// "COMMITTED TO X" (the source also has "COMMITED"). A commitment is a
// fact about the recruit, not about whose board you're looking at.
function isCommitment(status) {
  return /^COMMI?TT?ED TO /i.test((status || "").trim());
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
    if (SKIP_SHEET_PATTERN.test(teamKey) || SKIP_SHEET_SUBSTRING.test(teamKey) || RETIRED_SHEETS.has(teamKey)) continue;
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

// The feed names schools the way a recruiting site does.
const FEED_COLLEGE_TO_TEAM = {
  "MIAMI (OH)": "MIAMI (OH)", "KENT STATE": "KENT STATE", TOLEDO: "TOLEDO", "BOWLING GREEN": "BGSU",
  "SAC STATE": "SAC STATE", "EASTERN MICHIGAN": "EMU", AKRON: "AKRON", "WESTERN MICHIGAN": "WMU",
  BUFFALO: "BUFFALO", OHIO: "OHIO", MASSACHUSETTS: "UMASS", UMASS: "UMASS", "BALL STATE": "BALL STATE",
  "CENTRAL MICHIGAN": "CMU",
};

// "2026-09-18T00:00:00+00:00" -> "9/18/2026", the same M/D/YYYY text the
// boards already use (the date part is taken as written, so no timezone
// shift can move it a day).
function feedDateToText(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : "";
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

  const summary = { created: 0, updated: 0, commitmentsApplied: 0, years: [], skippedColleges: [] };
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
      commitmentByPlayer.set(k, away ? "" : `COMMITTED TO ${target.toUpperCase()}`);
    } else if (target) {
      commitmentByPlayer.set(k, `COMMITTED TO ${target.toUpperCase()}`);
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
    (existingByPlayer.get(pk) || []).forEach((d) => {
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

  return { ready, classYears, teamsForConference, rowsForTeam, rowsForPlayer, positionBreakdown, areaBreakdown, importWorkbook, importActivityFeed, updateOfferField };
}
