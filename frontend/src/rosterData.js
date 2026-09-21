import * as XLSX from "xlsx";
import { collection, deleteDoc, deleteField, doc, onSnapshot, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { db } from "./firebase";

// ------------------------------------------------------------------ positions

// Position groups, by unit. Anything unrecognized is left unassigned rather than guessed.
const GROUP_OF = {
  QB: "QB", RB: "RB", FB: "RB", HB: "RB", WR: "WR", X: "WR", Z: "WR", H: "WR", SLOT: "WR", TE: "TE",
  OL: "OL", OT: "OL", OG: "OL", C: "OL", LT: "OL", LG: "OL", RT: "OL", RG: "OL", IOL: "OL",
  DE: "DE", EDGE: "DE", DL: "DL", DT: "DT", NT: "DT",
  LB: "LB", ILB: "LB", OLB: "LB", MLB: "LB", MIKE: "LB", WILL: "LB", SAM: "LB",
  CB: "CB", NB: "CB", NICKEL: "CB", S: "S", SS: "S", FS: "S", SAF: "S", DB: "S",
  K: "K", PK: "K", P: "P", PT: "P", LS: "LS",
};
export const GROUPS = {
  offense: ["QB", "RB", "WR", "TE", "OL"],
  defense: ["DL", "DE", "DT", "LB", "CB", "S"],
  specialists: ["K", "P", "LS"],
};
export const UNIT_OF_GROUP = Object.fromEntries(Object.entries(GROUPS).flatMap(([unit, gs]) => gs.map((g) => [g, unit])));
export const UNIT_LABEL = { offense: "Offense", defense: "Defense", specialists: "Specialists" };

export function groupOfPosition(position) {
  const key = String(position || "").toUpperCase().replace(/[^A-Z]/g, "");
  return GROUP_OF[key] || "";
}

// The depth chart board: each slot is a column of players in depth order.
export const BOARD = [
  {
    unit: "offense",
    rows: [
      [
        { key: "QB", label: "QB", groups: ["QB"] }, { key: "RB", label: "RB", groups: ["RB"] }, { key: "TE", label: "TE", groups: ["TE"] },
        { key: "H", label: "H", groups: ["WR"] }, { key: "X", label: "X", groups: ["WR"] }, { key: "Z", label: "Z", groups: ["WR"] },
      ],
      [
        { key: "LT", label: "LT", groups: ["OL"] }, { key: "LG", label: "LG", groups: ["OL"] }, { key: "C", label: "C", groups: ["OL"] },
        { key: "RG", label: "RG", groups: ["OL"] }, { key: "RT", label: "RT", groups: ["OL"] },
      ],
    ],
  },
  {
    unit: "defense",
    rows: [
      [
        { key: "DE1", label: "DE", groups: ["DE", "DL"] }, { key: "DT1", label: "DT", groups: ["DT", "DL"] },
        { key: "DT2", label: "DT", groups: ["DT", "DL"] }, { key: "DE2", label: "DE", groups: ["DE", "DL"] },
      ],
      [
        { key: "CB1", label: "CB", groups: ["CB"] }, { key: "CB2", label: "CB", groups: ["CB"] }, { key: "LB1", label: "LB", groups: ["LB"] },
        { key: "LB2", label: "LB", groups: ["LB"] }, { key: "LB3", label: "LB", groups: ["LB"] }, { key: "NICKEL", label: "NICKEL", groups: ["CB"] },
        { key: "SAF1", label: "SAF", groups: ["S"] }, { key: "SAF2", label: "SAF", groups: ["S"] },
      ],
    ],
  },
  { unit: "specialists", rows: [[{ key: "K", label: "K", groups: ["K"] }, { key: "P", label: "P", groups: ["P"] }, { key: "LS", label: "LS", groups: ["LS"] }]] },
];
export const ALL_SLOTS = BOARD.flatMap((b) => b.rows.flat());

// Which slots a group's players are spread across, in the order they're dealt out.
const SLOTS_FOR_GROUP = {
  QB: ["QB"], RB: ["RB"], TE: ["TE"], WR: ["X", "Z", "H"], OL: ["LT", "LG", "C", "RG", "RT"], DL: ["DE1", "DT1", "DT2", "DE2"], DE: ["DE1", "DE2"], DT: ["DT1", "DT2"],
  LB: ["LB1", "LB2", "LB3"], CB: ["CB1", "CB2", "NICKEL"], S: ["SAF1", "SAF2"], K: ["K"], P: ["P"], LS: ["LS"],
};
const SLOT_HINT = { LT: "LT", LG: "LG", C: "C", RG: "RG", RT: "RT", NB: "NICKEL", NICKEL: "NICKEL", X: "X", Z: "Z", H: "H" };

// ------------------------------------------------------------------ eligibility

// Years left = seasons on the eligibility clock, this one included. `eligibilityYears` is the clock length for a
// brand-new freshman (5 under the current rules; some programs still track 4).
export const YL_STYLE = {
  5: { label: "5 YL", bg: "#FFFFFF", fg: "#111111", border: "#FFFFFF" },
  4: { label: "4 YL", bg: "#FAF34D", fg: "#111111", border: "#FAF34D" },
  3: { label: "3 YL", bg: "#7DDCF7", fg: "#111111", border: "#7DDCF7" },
  2: { label: "2 YL", bg: "#A98CF5", fg: "#111111", border: "#A98CF5" },
  1: { label: "1 YL", bg: "#000000", fg: "#FFFFFF", border: "#FFFFFF" },
};
export const styleForYearsLeft = (yl) => YL_STYLE[Math.min(5, Math.max(1, yl))] || YL_STYLE[1];

const CLASS_INDEX = { FR: 0, SO: 1, JR: 2, SR: 3, GR: 4, "5TH": 4, "5YR": 4 };
// "R-SO", "RS FR", "Redshirt Junior", "Sophomore" ... -> {index, redshirt}
export function parseClass(text) {
  const raw = String(text ?? "").toUpperCase().trim();
  if (!raw) return null;
  const redshirt = /^(R|RS|RED)[\s-]*/.test(raw) || raw.includes("REDSHIRT");
  const word = raw.replace(/^(R|RS|RED)[\s-]*/, "").replace(/REDSHIRT|RED-SHIRT/g, "").trim();
  const table = { FRESHMAN: "FR", SOPHOMORE: "SO", JUNIOR: "JR", SENIOR: "SR", GRADUATE: "GR", "GRAD": "GR", "FIFTH": "5TH", "5": "5TH" };
  const key = table[word] || word.slice(0, 3);
  const short = CLASS_INDEX[key] !== undefined ? key : CLASS_INDEX[word.slice(0, 2)] !== undefined ? word.slice(0, 2) : "";
  if (!short) return null;
  // A redshirt freshman is in his second year on campus, and so on.
  return { index: CLASS_INDEX[short] + (redshirt && short !== "GR" && short !== "5TH" ? 1 : 0), redshirt };
}

export function yearsLeftFromClass(index, eligibilityYears = 5) {
  return Math.max(1, eligibilityYears - index);
}

export const classLabelFor = (yl, eligibilityYears = 5) => {
  const index = Math.min(4, Math.max(0, eligibilityYears - yl));
  return ["FR", "SO", "JR", "SR", "GR"][index];
};

// A player's years left in `season` (asOfSeason is the season the stored value describes).
export const yearsLeftIn = (p, season, fallbackBase) => (p.yearsLeft ?? 1) - (season - (p.asOfSeason ?? fallbackBase));

// Everyone who's on the roster in `season`: already joined, eligibility remaining, and not flagged as gone.
export function playersInSeason(players, season, base) {
  return players.filter((p) => {
    if (p.removed) return false;
    const start = p.startSeason ?? p.asOfSeason ?? base;
    if (start > season) return false;
    if (p.lastSeason && season > p.lastSeason) return false;
    return yearsLeftIn(p, season, base) >= 1;
  });
}

// ------------------------------------------------------------------ depth chart

const byJersey = (a, b) => (Number(a.jersey) || 999) - (Number(b.jersey) || 999) || (a.name || "").localeCompare(b.name || "");

// Spreads players across the board by position; used until someone arranges a season by hand.
export function autoDepth(roster) {
  const depth = Object.fromEntries(ALL_SLOTS.map((s) => [s.key, []]));
  const dealt = {};
  [...roster].sort((a, b) => (b.yearsLeftNow ?? 0) - (a.yearsLeftNow ?? 0) || byJersey(a, b)).forEach((p) => {
    const group = groupOfPosition(p.position);
    const slots = SLOTS_FOR_GROUP[group];
    if (!slots) return;
    const hint = SLOT_HINT[String(p.position || "").toUpperCase()];
    let slot = hint && slots.includes(hint) ? hint : null;
    if (!slot) {
      dealt[group] = (dealt[group] ?? -1) + 1;
      // A group with two starters' slots (DE, DT) alternates; the rest fill the first slot deepest.
      slot = ["OL", "WR", "DL", "DE", "DT", "S", "LB", "CB"].includes(group) ? slots[dealt[group] % slots.length] : slots[0];
    }
    depth[slot].push(p.id);
  });
  return depth;
}

// The depth chart for `season`: the one saved for it, else last season's (minus anyone gone) plus new arrivals.
export function depthFor(season, seasons, players, base, cache = {}, seed = null) {
  if (cache[season]) return cache[season];
  const roster = playersInSeason(players, season, base).map((p) => ({ ...p, yearsLeftNow: yearsLeftIn(p, season, base) }));
  const ids = new Set(roster.map((p) => p.id));
  const saved = seasons[season]?.depth;
  let depth;
  if (saved) {
    depth = Object.fromEntries(ALL_SLOTS.map((s) => [s.key, (saved[s.key] || []).filter((id) => ids.has(id))]));
    const placed = new Set(Object.values(depth).flat());
    const stray = roster.filter((p) => !placed.has(p.id));
    if (stray.length) Object.entries(autoDepth(stray)).forEach(([slot, list]) => depth[slot].push(...list));
  } else if (season > base && seasons[season - 1] !== undefined || season > base) {
    const before = depthFor(season - 1, seasons, players, base, cache, seed);
    depth = Object.fromEntries(ALL_SLOTS.map((s) => [s.key, (before[s.key] || []).filter((id) => ids.has(id))]));
    const placed = new Set(Object.values(depth).flat());
    const arrivals = roster.filter((p) => !placed.has(p.id));
    if (arrivals.length) Object.entries(autoDepth(arrivals)).forEach(([slot, list]) => depth[slot].push(...list));
  } else if (seed) {
    // the current season, not arranged by hand: follow the Colleges depth chart, then place anyone it didn't list
    depth = Object.fromEntries(ALL_SLOTS.map((s) => [s.key, (seed[s.key] || []).filter((id) => ids.has(id))]));
    const placed = new Set(Object.values(depth).flat());
    const stray = roster.filter((p) => !placed.has(p.id));
    if (stray.length) Object.entries(autoDepth(stray)).forEach(([slot, list]) => depth[slot].push(...list));
  } else {
    depth = autoDepth(roster);
  }
  cache[season] = depth;
  return depth;
}

// The Colleges depth chart (from Ourlads) names positions its own way; this maps them onto the board's slots.
const OURLADS_SLOT = {
  "WR-X": "X", X: "X", "WR-Z": "Z", Z: "Z", "WR-H": "H", "WR-Y": "H", H: "H", Y: "H", SL: "H", SLOT: "H",
  LT: "LT", LG: "LG", C: "C", RG: "RG", RT: "RT", TE: "TE", "TE-Y": "TE", QB: "QB", RB: "RB", HB: "RB", FB: "RB",
  LDE: "DE1", DE: "DE1", RDE: "DE2", LDT: "DT1", NT: "DT1", DT: "DT1", RDT: "DT2", UT: "DT2",
  WLB: "LB1", MLB: "LB2", SLB: "LB3", LB: "LB1", ILB: "LB2", OLB: "LB1",
  LCB: "CB1", CB: "CB1", RCB: "CB2", NB: "NICKEL", SS: "SAF1", S: "SAF1", FS: "SAF2",
  PT: "P", P: "P", PK: "K", K: "K", KO: "K", LS: "LS",
};
const stripSuffix = (name) => String(name ?? "").replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/gi, "");

// Places roster players on the board the way the Colleges depth chart lists them. Players are matched by
// jersey number with the same last name, then by full name, then by last name plus first initial when that
// leaves one person. Returns the depth, how many were placed, and the depth chart names it couldn't find.
export function depthFromOurlads(team, players) {
  const depth = Object.fromEntries(ALL_SLOTS.map((s) => [s.key, []]));
  const lastOf = (n) => {
    const w = stripSuffix(n).trim().split(/\s+/).filter(Boolean);
    return norm(w[w.length - 1] || "");
  };
  const firstOf = (n) => norm((stripSuffix(n).trim().split(/\s+/)[0] || "")[0] || "");
  const byFull = new Map(players.map((p) => [norm(stripSuffix(p.name)), p]));
  const find = (pl, slot) => {
    const last = lastOf(pl.name);
    const number = Number(pl.no);
    if (String(pl.no ?? "") !== "" && Number.isFinite(number)) {
      const hit = players.find((p) => String(p.jersey ?? "") !== "" && Number(p.jersey) === number && lastOf(p.name) === last);
      if (hit) return hit;
    }
    const full = byFull.get(norm(stripSuffix(pl.name)));
    if (full) return full;
    const same = players.filter((p) => lastOf(p.name) === last && firstOf(p.name) === firstOf(pl.name));
    if (same.length === 1) return same[0];
    // a different first name is a nickname or a typo often enough: accept a unique last name at the same position
    const groups = ALL_SLOTS.find((x) => x.key === slot)?.groups || [];
    const sameLast = players.filter((p) => lastOf(p.name) === last && groups.includes(groupOfPosition(p.position)));
    return sameLast.length === 1 ? sameLast[0] : null;
  };
  const placed = new Set();
  const missing = [];
  (team?.sections || []).forEach((section) => {
    if (/reserve/i.test(section.title)) return;
    section.positions.forEach((pos) => {
      const slot = OURLADS_SLOT[String(pos.pos).toUpperCase()];
      if (!slot) return;
      pos.players.forEach((pl) => {
        const p = find(pl, slot);
        if (!p) {
          if (!missing.includes(pl.name)) missing.push(pl.name);
          return;
        }
        if (placed.has(p.id)) return;
        placed.add(p.id);
        depth[slot].push(p.id);
      });
    });
  });
  return { depth, placed: placed.size, missing };
}

// ------------------------------------------------------------------ upload

// Header names as they appear in staff workbooks (compared with punctuation and case stripped). '#' is handled
// separately since stripping it would leave nothing.
const norm = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const headerKey = (h) => (String(h ?? "").trim() === "#" ? "jerseyno" : norm(h));
const ALIASES = {
  name: ["name", "player", "playername", "fullname", "athlete"],
  first: ["first", "firstname"],
  last: ["last", "lastname"],
  middle: ["middle", "middlename"],
  jersey: ["jerseyno", "no", "num", "number", "jersey", "jerseynumber", "uniform", "rosno", "ros"],
  position: ["pos", "position"],
  cls: ["class", "cl", "yr", "year", "classification", "academicyear"],
  clock: ["clock", "clockstart", "enrolled", "startterm"],
  eligEnd: ["eligbilityend", "eligibilityend", "eligend", "eligibilityendyear", "lastseason", "eligibleuntil"],
  yearsLeft: ["yl", "yearsleft", "eligleft", "eligibilityleft", "remainingeligibility", "yearsremaining"],
  model: ["model", "eligibilitymodel"],
  gradDate: ["graddate", "graduation", "expectedgraduation"],
  height: ["ht", "height"],
  weight: ["wt", "weight"],
  hometown: ["hometown", "home", "hometownstate", "cityst"],
  highSchool: ["highschool", "hs", "prepschool"],
  previousSchool: ["previousschool", "prevschool", "transferfrom", "lastschool", "previouscollege", "priorschool"],
  scholarship: ["scholarship", "scholly", "aid", "scholarshiptype", "scholarshipstatus", "status"],
  redshirt: ["rs", "redshirt", "redshirted"],
  injured: ["injured", "injury"],
  notes: ["notes", "note", "comments"],
  instagram: ["instagram", "ig"],
  twitter: ["twitter", "x", "twitterx"],
  dob: ["dob", "birthdate", "dateofbirth", "birthday"],
  email: ["email", "emailaddress"],
  cell: ["cellphone", "cell", "phone", "mobile"],
  revenue: ["revenueshare", "revenue", "rev", "dollars", "amount", "fall"],
};

function mapColumns(headers) {
  const used = new Set();
  const map = {};
  Object.entries(ALIASES).forEach(([field, names]) => {
    // Aliases are in priority order: a "#" column beats a plain "No" (which is often just a row counter).
    let at = -1;
    for (const n of names) {
      at = headers.findIndex((h, i) => !used.has(i) && h !== "" && headerKey(h) === n);
      if (at >= 0) break;
    }
    if (at >= 0) {
      map[field] = at;
      used.add(at);
    }
  });
  return map;
}

const yes = (v) => /^(y|yes|true|x|1|rs|r|✓)$/i.test(String(v ?? "").trim());
function scholarshipFrom(v) {
  const t = String(v ?? "").toLowerCase().trim();
  if (!t) return "";
  if (/^(wo|w\/o)$|walk|pwo|non/.test(t)) return "walk-on";
  if (/split|partial|half|part/.test(t)) return "split";
  if (/^(s|y|yes|true|x|1)$/.test(t) || /full|schol|grant|aid|ath/.test(t)) return "full";
  return "";
}
const cleanText = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const nameKey = (first, last) => norm(`${first} ${last}`);
export const idFor = (name, jersey) => `${norm(name)}${jersey ? `-${jersey}` : ""}`.slice(0, 80) || `p${Math.random().toString(36).slice(2, 9)}`;

// "Fall 2027" -> 2027, "Spring 2026" -> 2026 (a spring enrollee plays that fall).
const seasonFromClock = (clock) => {
  const m = /(20\d\d)/.exec(String(clock || ""));
  return m ? Number(m[1]) : null;
};

// Turns a sheet into rows, using the first row that has a name (or First/Last) column and a position column.
function sheetRows(sheet) {
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
  const isHeader = (r) => r.some((c) => [...ALIASES.name, ...ALIASES.first].includes(headerKey(c))) && r.some((c) => ALIASES.position.includes(headerKey(c)));
  const headerAt = grid.findIndex(isHeader);
  if (headerAt < 0) return null;
  const headers = grid[headerAt].map((h) => String(h ?? ""));
  return { headers, col: mapColumns(headers), rows: grid.slice(headerAt + 1), headerAt };
}

function parsePlayers(sheetInfo, { season, eligibilityYears, incoming }) {
  const { col, rows } = sheetInfo;
  const get = (cells, f) => (col[f] === undefined ? "" : cleanText(cells[col[f]]));
  const problems = [];
  const out = [];
  rows.forEach((cells, i) => {
    let first = get(cells, "first");
    let last = get(cells, "last");
    let name = get(cells, "name");
    if (!name) name = cleanText(`${first} ${last}`);
    if (!name) return;
    // "Last, First" -> "First Last"
    if (get(cells, "name") && /^[^,]+,\s*[^,]+$/.test(name) && !/\b(jr|sr|ii|iii|iv)\.?$/i.test(name)) name = name.split(",").map((s) => s.trim()).reverse().join(" ");
    if (!first && !last) [first, last] = [name.split(" ")[0], name.split(" ").slice(1).join(" ")];
    const jersey = get(cells, "jersey").replace(/\.0+$/, "").replace(/[^0-9]/g, "");
    const position = get(cells, "position").toUpperCase();
    const cls = parseClass(get(cells, "cls"));
    const clock = get(cells, "clock");
    let start = seasonFromClock(clock);
    if (incoming && (start === null || start < season)) start = season;
    if (start === null) start = season;

    // Years left in `season`: the eligibility end year is exact; otherwise the stated years left; otherwise the class.
    let yearsLeft = NaN;
    const end = parseInt(get(cells, "eligEnd"), 10);
    if (Number.isFinite(end) && end >= 2000) yearsLeft = end - season + 1;
    if (!Number.isFinite(yearsLeft)) yearsLeft = parseInt(get(cells, "yearsLeft"), 10);
    if (!Number.isFinite(yearsLeft) && cls) yearsLeft = yearsLeftFromClass(cls.index, eligibilityYears);
    let asOf = season;
    // A player who arrives in a later season has his years-left stated for that season.
    if (start > season && Number.isFinite(end) && end >= 2000) {
      yearsLeft = end - start + 1;
      asOf = start;
    } else if (start > season && Number.isFinite(yearsLeft)) {
      asOf = start; // stated for his first season, not for this one
    }
    if (!Number.isFinite(yearsLeft)) {
      problems.push(`${name}: no eligibility end, years left or class, so they're set to 1 year left`);
      yearsLeft = 1;
    }
    if (position && !groupOfPosition(position)) problems.push(`${name}: position "${position}" isn't one the board places`);
    const note = get(cells, "notes");
    out.push({
      key: nameKey(first, last) || norm(name),
      player: {
        id: idFor(name, jersey), name, jersey, position, yearsLeft: Math.min(5, Math.max(0, yearsLeft)), asOfSeason: asOf, startSeason: start,
        classLabel: get(cells, "cls"), clock, gradDate: get(cells, "gradDate"), eligEnd: Number.isFinite(end) && end >= 2000 ? end : null, model: get(cells, "model"),
        redshirt: !!(cls?.redshirt || yes(get(cells, "redshirt")) || /^rs\b|redshirt/i.test(note)), height: get(cells, "height"), weight: get(cells, "weight"),
        hometown: get(cells, "hometown"), highSchool: get(cells, "highSchool"), previousSchool: get(cells, "previousSchool"),
        scholarship: scholarshipFrom(get(cells, "scholarship")), injured: /^(y|yes|true|x|inj|out|injured)/i.test(get(cells, "injured")), notes: note,
        instagram: get(cells, "instagram"), twitter: get(cells, "twitter"), incoming: !!incoming, row: i,
      },
      // Contact details go to an area only admins can read.
      private: { dob: get(cells, "dob"), email: get(cells, "email"), cell: get(cells, "cell").replace(/\.0+$/, "") },
      revenue: (() => {
        const v = parseFloat(get(cells, "revenue").replace(/[$,]/g, ""));
        return Number.isFinite(v) && col.revenue !== undefined ? v : null;
      })(),
    });
  });
  return { out, problems };
}

// Which sheet holds the roster: a "roster details" sheet, not a spring / copy / incoming one.
function pickRosterSheet(workbook) {
  const names = workbook.SheetNames;
  const score = (n) => {
    const u = n.toUpperCase();
    if (!/ROSTER/.test(u) && names.length > 1) return -1;
    if (u === "ROSTER DETAILS") return 100;
    if (/DETAIL/.test(u) && !/SPRING|COPY|INCOMING/.test(u)) return 80;
    if (/DETAIL/.test(u) && /FALL/.test(u)) return 60;
    if (/DETAIL/.test(u)) return 30;
    return 10;
  };
  const ranked = names.map((n) => ({ n, s: score(n) })).filter((x) => x.s >= 0 && sheetRows(workbook.Sheets[x.n])).sort((a, b) => b.s - a.s);
  return ranked[0]?.n || names.find((n) => sheetRows(workbook.Sheets[n])) || null;
}

// A staff scholarship workbook: the roster sheet, plus the incoming class, revenue share and scholarship status
// if the workbook has them. `season` is the season the class / eligibility values describe.
export async function parseRosterFile(file, { season, eligibilityYears = 5, sheet }) {
  const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: false });
  const rosterName = sheet || pickRosterSheet(workbook);
  if (!rosterName) throw new Error("Couldn't find the column headings. The roster sheet needs a Name (or First and Last) column and a Pos column.");
  const info = sheetRows(workbook.Sheets[rosterName]);
  const main = parsePlayers(info, { season, eligibilityYears, incoming: false });
  const problems = [...main.problems];
  const found = { roster: rosterName, incoming: null, revenue: null, status: null };
  let entries = main.out;

  // Incoming class (signed players who arrive this fall or later)
  const incomingName = workbook.SheetNames.find((n) => /INCOMING/i.test(n) && n !== rosterName);
  if (incomingName && sheetRows(workbook.Sheets[incomingName])) {
    const inc = parsePlayers(sheetRows(workbook.Sheets[incomingName]), { season, eligibilityYears, incoming: true });
    const have = new Set(entries.map((e) => e.key));
    const fresh = inc.out.filter((e) => !have.has(e.key));
    entries = entries.concat(fresh);
    problems.push(...inc.problems);
    found.incoming = `${incomingName} (${fresh.length} added)`;
  }

  // Revenue share: Last / First / a dollar column
  const revName = workbook.SheetNames.find((n) => /^REV SHARE$/i.test(n));
  if (revName) {
    const grid = XLSX.utils.sheet_to_json(workbook.Sheets[revName], { header: 1, raw: false, defval: "" });
    const at = grid.findIndex((r) => r.some((c) => headerKey(c) === "last") && r.some((c) => headerKey(c) === "first"));
    if (at >= 0) {
      const h = grid[at].map(String);
      const [li, fi] = [h.findIndex((c) => headerKey(c) === "last"), h.findIndex((c) => headerKey(c) === "first")];
      const di = h.findIndex((c, i) => i !== li && i !== fi && ["fall", "amount", "revenue", "revenueshare", "dollars"].includes(headerKey(c)));
      const money = new Map();
      grid.slice(at + 1).forEach((r) => {
        const v = parseFloat(String(r[di] ?? "").replace(/[$,]/g, ""));
        if (di >= 0 && Number.isFinite(v)) money.set(nameKey(r[fi], r[li]), v);
      });
      let matched = 0;
      entries.forEach((e) => {
        if (money.has(e.key)) {
          e.revenue = money.get(e.key);
          matched += 1;
        }
      });
      found.revenue = `${revName} (${matched} matched)`;
    }
  }

  // Scholarship status (S / WO) from a by-position roster sheet: Pos, Player, Year, Status repeated across
  const posName = workbook.SheetNames.find((n) => /BY POS/i.test(n));
  if (posName) {
    const grid = XLSX.utils.sheet_to_json(workbook.Sheets[posName], { header: 1, raw: false, defval: "" });
    const status = new Map();
    grid.forEach((r) => {
      r.forEach((c, i) => {
        if (headerKey(c) === "status" || !r[i - 1] || !r[i - 2]) return;
        const st = String(c).trim().toUpperCase();
        if ((st === "S" || st === "WO") && groupOfPosition(r[i - 3])) status.set(norm(r[i - 2]), st === "S" ? "full" : "walk-on");
      });
    });
    let matched = 0;
    entries.forEach((e) => {
      const s = status.get(norm(e.player.name));
      if (s && !e.player.scholarship) {
        e.player.scholarship = s;
        matched += 1;
      }
    });
    found.status = `${posName} (${matched} matched)`;
  }

  // Unique ids (a shared name + jersey would otherwise collide)
  const seen = new Set();
  entries.forEach((e) => {
    if (seen.has(e.player.id)) e.player.id = `${e.player.id}-${e.player.row}`;
    seen.add(e.player.id);
    delete e.player.row;
  });
  if (!entries.length) throw new Error("No players found under the headings.");
  return { players: entries, columns: Object.keys(info.col), problems, found, sheets: workbook.SheetNames };
}

// ------------------------------------------------------------------ database

// Everyone signed in can read; only admins write (see firestore.rules). Dollar amounts live in their own
// collection that only admins can read at all.
export function useRoster({ isAdmin }) {
  const [players, setPlayers] = useState([]);
  const [seasons, setSeasons] = useState({});
  const [meta, setMeta] = useState(null);
  const [finance, setFinance] = useState({});
  const [privateInfo, setPrivateInfo] = useState({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const off = [];
    let pending = 3;
    const done = () => --pending <= 0 && setReady(true);
    off.push(onSnapshot(collection(db, "rosterPlayers"), (s) => { setPlayers(s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => !p.removed)); done(); }, () => done()));
    off.push(onSnapshot(collection(db, "rosterSeasons"), (s) => { setSeasons(Object.fromEntries(s.docs.map((d) => [Number(d.id), d.data()]))); done(); }, () => done()));
    off.push(onSnapshot(doc(db, "rosterMeta", "main"), (s) => { setMeta(s.exists() ? s.data() : null); done(); }, () => done()));
    if (isAdmin) {
      off.push(onSnapshot(collection(db, "rosterFinance"), (s) => setFinance(Object.fromEntries(s.docs.map((d) => [d.id, d.data()]))), () => {}));
      off.push(onSnapshot(collection(db, "rosterPrivate"), (s) => setPrivateInfo(Object.fromEntries(s.docs.map((d) => [d.id, d.data()]))), () => {}));
    }
    return () => off.forEach((f) => f());
  }, [isAdmin]);

  const base = meta?.baseSeason ?? new Date().getFullYear();
  const eligibilityYears = meta?.eligibilityYears ?? 5;
  const now = () => new Date().toISOString();
  const touch = () => setDoc(doc(db, "rosterMeta", "main"), { updatedAt: now() }, { merge: true });

  // Loads an uploaded roster into `season`. "replace" retires anyone from that season who isn't in the file;
  // "merge" only adds and updates. Hand-entered details the file doesn't have are kept.
  async function importRoster(parsed, { season, mode, eligibilityYears: eligibility }) {
    const incoming = new Map(parsed.players.map((e) => [e.player.id, e.player]));
    const ops = [];
    if (mode === "replace") players.filter((p) => !incoming.has(p.id) && (p.asOfSeason ?? base) <= season && (p.startSeason ?? base) <= season).forEach((p) => ops.push({ type: "remove", id: p.id }));
    parsed.players.forEach((e) => {
      const existing = players.find((p) => p.id === e.player.id);
      const { incoming: isIncoming, ...data } = e.player;
      ops.push({ type: "set", id: e.player.id, data: { ...(existing || {}), ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== "" && v != null)), removed: false, updatedAt: now() } });
      if (isAdmin) {
        const priv = Object.fromEntries(Object.entries(e.private).filter(([, v]) => v));
        if (Object.keys(priv).length) ops.push({ type: "private", id: e.player.id, data: priv });
        if (e.revenue != null) ops.push({ type: "finance", id: e.player.id, data: { [season]: e.revenue } });
      }
    });
    for (let i = 0; i < ops.length; i += 400) {
      const batch = writeBatch(db);
      ops.slice(i, i + 400).forEach((op) => {
        if (op.type === "set") batch.set(doc(db, "rosterPlayers", op.id), op.data);
        else if (op.type === "remove") batch.update(doc(db, "rosterPlayers", op.id), { removed: true, removedAt: now() });
        else if (op.type === "private") batch.set(doc(db, "rosterPrivate", op.id), op.data, { merge: true });
        else batch.set(doc(db, "rosterFinance", op.id), op.data, { merge: true });
      });
      await batch.commit();
    }
    await setDoc(doc(db, "rosterMeta", "main"), { baseSeason: season, eligibilityYears: eligibility ?? eligibilityYears, updatedAt: now() }, { merge: true });
    await setDoc(doc(db, "rosterSeasons", String(season)), { season, projection: false, goals: seasons[season]?.goals || {}, updatedAt: now() }, { merge: true });
    const existingIds = new Set(players.map((p) => p.id));
    return { added: parsed.players.filter((e) => !existingIds.has(e.player.id)).length, updated: parsed.players.filter((e) => existingIds.has(e.player.id)).length };
  }

  return {
    ready, players, seasons, meta, finance, privateInfo, base, eligibilityYears,
    importRoster,
    async savePlayer(id, fields) {
      await setDoc(doc(db, "rosterPlayers", id), { ...fields, updatedAt: now() }, { merge: true });
      await touch();
    },
    async addPlayer(player) {
      await setDoc(doc(db, "rosterPlayers", player.id), { ...player, updatedAt: now() });
      await touch();
    },
    async removePlayer(id) {
      await updateDoc(doc(db, "rosterPlayers", id), { removed: true, removedAt: now() });
      await touch();
    },
    async saveDepth(season, depth) {
      await setDoc(doc(db, "rosterSeasons", String(season)), { season, projection: season > base, depth, updatedAt: now() }, { merge: true });
      await touch();
    },
    // Back to following the Colleges depth chart
    async clearDepth(season) {
      await setDoc(doc(db, "rosterSeasons", String(season)), { depth: deleteField(), updatedAt: now() }, { merge: true });
    },
    async saveGoals(season, goals) {
      await setDoc(doc(db, "rosterSeasons", String(season)), { season, projection: season > base, goals, updatedAt: now() }, { merge: true });
    },
    async addSeason(season) {
      await setDoc(doc(db, "rosterSeasons", String(season)), { season, projection: season > base, goals: seasons[season - 1]?.goals || {}, updatedAt: now() }, { merge: true });
    },
    async deleteSeason(season) {
      await deleteDoc(doc(db, "rosterSeasons", String(season)));
    },
    async saveFinance(id, season, amount) {
      await setDoc(doc(db, "rosterFinance", id), { [season]: amount }, { merge: true });
    },
    async savePrivate(id, fields) {
      await setDoc(doc(db, "rosterPrivate", id), fields, { merge: true });
    },
  };
}

// Roster stats for the snapshot panel: counts by position group, scholarships by years left.
export function snapshotFor(roster, season, base, goals = {}) {
  const groupCounts = Object.fromEntries(Object.values(GROUPS).flat().map((g) => [g, 0]));
  roster.forEach((p) => {
    const g = groupOfPosition(p.position);
    if (g) groupCounts[g] += 1;
  });
  const unit = (list) => list.map((g) => ({ group: g, current: groupCounts[g], goal: goals[g] ?? 0, diff: groupCounts[g] - (goals[g] ?? 0) }));
  const byYl = [5, 4, 3, 2, 1].map((yl) => {
    const rows = roster.filter((p) => Math.min(5, Math.max(1, yearsLeftIn(p, season, base))) === yl);
    const count = (u) => rows.filter((p) => UNIT_OF_GROUP[groupOfPosition(p.position)] === u).length;
    return { yl, off: count("offense"), spec: count("specialists"), def: count("defense"), total: rows.length, pct: roster.length ? (rows.length / roster.length) * 100 : 0 };
  });
  return {
    offense: unit(GROUPS.offense), defense: unit(GROUPS.defense), specialists: unit(GROUPS.specialists), byYl,
    total: roster.length, scholarships: roster.filter((p) => p.scholarship === "full").length + roster.filter((p) => p.scholarship === "split").length * 0.5,
  };
}
