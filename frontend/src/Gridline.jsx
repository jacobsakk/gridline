import { useState, useMemo } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown, Crown, BadgeCheck, FlaskConical } from "lucide-react";

// ---------- Mock data generation (seeded, stable across renders) ----------
// Used for divisions/conferences we do NOT yet have a live source for.

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(88);
const ri = (a, b) => Math.floor(rand() * (b - a + 1)) + a;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const DIVISIONS = ["JUCO", "D2", "FCS"];
const WEEKS = [1, 2, 3, 4];
// "total" aggregates weeks 1-4 for sample data. Real data (Big Sky) only
// ever has a "total" row, since the live source reports season-to-date
// totals rather than isolated per-week lines.
const WEEK_OPTIONS = ["total", 1, 2, 3, 4];
const weekLabel = (w) => (w === "total" ? "Total (season)" : `Week ${w}`);

// Teams tagged with a real conference. FCS Big Sky teams are the real
// conference roster; everything else here is placeholder for sample data.
const TEAMS = {
  JUCO: [
    { team: "Butler CC", conference: "KJCCC" },
    { team: "Garden City CC", conference: "KJCCC" },
    { team: "Hutchinson CC", conference: "KJCCC" },
    { team: "Iowa Western CC", conference: "ICCAC" },
    { team: "Ellsworth CC", conference: "ICCAC" },
    { team: "Snow College", conference: "Scenic West" },
    { team: "East Mississippi CC", conference: "MACJC" },
    { team: "Jones College", conference: "MACJC" },
    { team: "College of San Mateo", conference: "CCCAA" },
    { team: "Riverside City College", conference: "CCCAA" },
  ],
  // All 16 current D2 football conferences. GLIAC/RMAC/GSC/PSAC/NSIC carried
  // over from the original prototype; the rest added so every conference is
  // selectable. All D2 rows are sample data — no live source connected yet.
  D2: [
    { team: "Ferris State", conference: "GLIAC" },
    { team: "Grand Valley State", conference: "GLIAC" },
    { team: "Colorado Mines", conference: "RMAC" },
    { team: "CSU Pueblo", conference: "RMAC" },
    { team: "Valdosta State", conference: "GSC" },
    { team: "Delta State", conference: "GSC" },
    { team: "Slippery Rock", conference: "PSAC" },
    { team: "California (PA)", conference: "PSAC" },
    { team: "Minnesota State", conference: "NSIC" },
    { team: "Sioux Falls", conference: "NSIC" },
    { team: "Barton", conference: "Conference Carolinas" },
    { team: "Emory & Henry", conference: "Conference Carolinas" },
    { team: "Virginia Union", conference: "CIAA" },
    { team: "Winston-Salem State", conference: "CIAA" },
    { team: "Harding", conference: "GAC" },
    { team: "Southern Arkansas", conference: "GAC" },
    { team: "Indianapolis", conference: "GLVC" },
    { team: "Lindenwood", conference: "GLVC" },
    { team: "Ohio Dominican", conference: "G-MAC" },
    { team: "Tiffin", conference: "G-MAC" },
    { team: "Angelo State", conference: "LSC" },
    { team: "West Texas A&M", conference: "LSC" },
    { team: "Glenville State", conference: "MEC" },
    { team: "West Liberty", conference: "MEC" },
    { team: "Central Missouri", conference: "MIAA" },
    { team: "Pittsburg State", conference: "MIAA" },
    { team: "Bentley", conference: "NE-10" },
    { team: "American International", conference: "NE-10" },
    { team: "Newberry", conference: "SAC" },
    { team: "Wingate", conference: "SAC" },
    { team: "Miles", conference: "SIAC" },
    { team: "Tuskegee", conference: "SIAC" },
  ],
  // All 13 current FCS football conferences. Big Sky is real, live data;
  // every other conference here is sample data so the filter is complete.
  FCS: [
    // Real Big Sky Conference roster (live data source)
    { team: "Idaho State", conference: "Big Sky" },
    { team: "Montana", conference: "Big Sky" },
    { team: "Montana State", conference: "Big Sky" },
    { team: "Eastern Washington", conference: "Big Sky" },
    { team: "Idaho", conference: "Big Sky" },
    { team: "Cal Poly", conference: "Big Sky" },
    { team: "UC Davis", conference: "Big Sky" },
    { team: "Southern Utah", conference: "Big Sky" },
    { team: "Northern Colorado", conference: "Big Sky" },
    { team: "Weber State", conference: "Big Sky" },
    { team: "Northern Arizona", conference: "Big Sky" },
    { team: "Portland State", conference: "Big Sky" },
    { team: "Utah Tech", conference: "Big Sky" },
    { team: "Sacramento State", conference: "Big Sky" },
    // Sample-only conferences (not yet connected to a live source)
    { team: "South Dakota State", conference: "MVFC" },
    { team: "North Dakota State", conference: "MVFC" },
    { team: "Elon", conference: "CAA" },
    { team: "New Hampshire", conference: "CAA" },
    { team: "Incarnate Word", conference: "Southland" },
    { team: "McNeese", conference: "Southland" },
    { team: "Harvard", conference: "Ivy League" },
    { team: "Yale", conference: "Ivy League" },
    { team: "Norfolk State", conference: "MEAC" },
    { team: "South Carolina State", conference: "MEAC" },
    { team: "Duquesne", conference: "NEC" },
    { team: "LIU", conference: "NEC" },
    { team: "Southeast Missouri", conference: "OVC" },
    { team: "Tennessee State", conference: "OVC" },
    { team: "Lehigh", conference: "Patriot" },
    { team: "Colgate", conference: "Patriot" },
    { team: "Dayton", conference: "Pioneer" },
    { team: "Drake", conference: "Pioneer" },
    { team: "Chattanooga", conference: "SoCon" },
    { team: "Samford", conference: "SoCon" },
    { team: "Jackson State", conference: "SWAC" },
    { team: "Southern", conference: "SWAC" },
    { team: "West Florida", conference: "UAC" },
    { team: "Central Arkansas", conference: "UAC" },
  ],
};

function pickTeam(division) {
  return pick(TEAMS[division]);
}

const FIRST = ["Marcus", "Jalen", "Tyler", "DeShawn", "Cole", "Malik", "Aiden", "Trey", "Isaiah", "Bryce", "Jordan", "Dante", "Wyatt", "Kamari", "Gunnar", "Xavier"];
const LAST = ["Boone", "Whitfield", "Reyes", "Sarver", "McKay", "Osei", "Lindqvist", "Pruitt", "Castellano", "Nakamura", "Duren", "Halstrom", "Iheanacho", "Brogan"];
const name = () => `${pick(FIRST)} ${pick(LAST)}`;

// leaderKey = the stat used to rank "leader" for this category
const CATEGORIES = {
  passing: {
    label: "Passing",
    positions: ["QB"],
    leaderKey: "yards",
    columns: [
      { key: "compAtt", label: "C/ATT", sortKey: "att" },
      { key: "yards", label: "YDS" },
      { key: "td", label: "TD" },
      { key: "int", label: "INT" },
      { key: "rating", label: "RTG" },
    ],
    gen: () => {
      const att = ri(18, 42);
      const comp = ri(Math.floor(att * 0.45), Math.floor(att * 0.75));
      const yards = ri(comp * 6, comp * 13);
      const td = ri(0, 5);
      const int = ri(0, 3);
      return { compAtt: `${comp}/${att}`, att, yards, td, int, rating: (100 + td * 20 - int * 15 + yards / 5).toFixed(1) };
    },
  },
  rushing: {
    label: "Rushing",
    positions: ["RB", "QB"],
    leaderKey: "yards",
    columns: [
      { key: "att", label: "ATT" },
      { key: "yards", label: "YDS" },
      { key: "avg", label: "AVG" },
      { key: "td", label: "TD" },
    ],
    gen: () => {
      const att = ri(8, 28);
      const yards = ri(att * 2, att * 9);
      return { att, yards, avg: (yards / att).toFixed(1), td: ri(0, 4) };
    },
  },
  receiving: {
    label: "Receiving",
    positions: ["WR", "TE", "RB"],
    leaderKey: "yards",
    columns: [
      { key: "rec", label: "REC" },
      { key: "yards", label: "YDS" },
      { key: "avg", label: "AVG" },
      { key: "td", label: "TD" },
    ],
    gen: () => {
      const rec = ri(2, 12);
      const yards = ri(rec * 6, rec * 22);
      return { rec, yards, avg: (yards / rec).toFixed(1), td: ri(0, 3) };
    },
  },
  tackling: {
    label: "Tackling",
    positions: ["LB", "DB", "DL"],
    leaderKey: "total",
    columns: [
      { key: "solo", label: "SOLO" },
      { key: "ast", label: "AST" },
      { key: "total", label: "TOT" },
    ],
    gen: () => {
      const solo = ri(2, 11);
      const ast = ri(0, 6);
      return { solo, ast, total: solo + ast };
    },
  },
  sacksTfl: {
    label: "Sacks",
    positions: ["DL", "LB"],
    leaderKey: "sacks",
    columns: [
      { key: "sacks", label: "SACK" },
      { key: "sackYds", label: "YDS" },
      { key: "ff", label: "FF" },
      { key: "fr", label: "FR" },
    ],
    gen: () => ({
      sacks: (ri(0, 30) / 10).toFixed(1),
      sackYds: ri(0, 22),
      ff: ri(0, 1),
      fr: ri(0, 1),
    }),
  },
};

// ---------- Real data: Big Sky Conference (FCS), through games Sept 12-14, 2026 ----------
// Source: foxsports.com/college-football/big-sky/stats, fetched live.

const realRow = (division, conference, category, position, player, team, stats) => ({
  id: `real-${division}-${conference}-${category}-${player}`,
  division,
  conference,
  week: "total", // real source reports season-to-date, not isolated single-week lines
  category,
  position,
  player,
  team,
  sample: false,
  ...stats,
});

const BIG_SKY_REAL = [
  // Passing
  realRow("FCS", "Big Sky", "passing", "QB", "Jordan Cooke", "Idaho State", { compAtt: "51/88", att: 88, yards: 808, td: 8, int: 4, rating: "162.8" }),
  realRow("FCS", "Big Sky", "passing", "QB", "Keali'i Ah Yat", "Montana", { compAtt: "67/103", att: 103, yards: 793, td: 5, int: 2, rating: "143.8" }),
  realRow("FCS", "Big Sky", "passing", "QB", "Nate Bell", "Eastern Washington", { compAtt: "74/116", att: 116, yards: 781, td: 6, int: 7, rating: "134.0" }),
  realRow("FCS", "Big Sky", "passing", "QB", "Anthony Grigsby Jr.", "Cal Poly", { compAtt: "65/102", att: 102, yards: 772, td: 8, int: 5, rating: "149.3" }),
  realRow("FCS", "Big Sky", "passing", "QB", "Joshua Wood", "Idaho", { compAtt: "47/92", att: 92, yards: 679, td: 2, int: 7, rating: "118.1" }),
  realRow("FCS", "Big Sky", "passing", "QB", "Justin Lamson", "Montana State", { compAtt: "52/73", att: 73, yards: 678, td: 5, int: 5, rating: "171.9" }),
  realRow("FCS", "Big Sky", "passing", "QB", "Treynor Cleeland", "UC Davis", { compAtt: "55/96", att: 96, yards: 664, td: 7, int: 2, rating: "133.2" }),
  realRow("FCS", "Big Sky", "passing", "QB", "Will Burns", "Southern Utah", { compAtt: "46/75", att: 75, yards: 630, td: 5, int: 4, rating: "143.2" }),
  realRow("FCS", "Big Sky", "passing", "QB", "Kenny Lueth", "Northern Colorado", { compAtt: "52/85", att: 85, yards: 629, td: 3, int: 6, rating: "130.3" }),
  realRow("FCS", "Big Sky", "passing", "QB", "Nate Dahle", "Weber State", { compAtt: "47/100", att: 100, yards: 580, td: 5, int: 5, rating: "108.2" }),

  // Rushing
  realRow("FCS", "Big Sky", "rushing", "RB", "Floyd Chalk", "Southern Utah", { att: 66, yards: 427, avg: "6.5", td: 6 }),
  realRow("FCS", "Big Sky", "rushing", "RB", "Eli Gillman", "Montana", { att: 49, yards: 328, avg: "6.7", td: 7 }),
  realRow("FCS", "Big Sky", "rushing", "RB", "Will Burns", "Southern Utah", { att: 36, yards: 276, avg: "7.7", td: 2 }),
  realRow("FCS", "Big Sky", "rushing", "RB", "Quran Gossett", "Northern Arizona", { att: 49, yards: 228, avg: "4.7", td: 2 }),
  realRow("FCS", "Big Sky", "rushing", "RB", "Jaden Green", "Cal Poly", { att: 38, yards: 217, avg: "5.7", td: 0 }),
  realRow("FCS", "Big Sky", "rushing", "RB", "Adam Jones", "Montana State", { att: 49, yards: 198, avg: "4.0", td: 3 }),
  realRow("FCS", "Big Sky", "rushing", "RB", "Delon Thompson", "Portland State", { att: 49, yards: 186, avg: "3.8", td: 0 }),
  realRow("FCS", "Big Sky", "rushing", "RB", "Mathias Price", "Northern Colorado", { att: 32, yards: 168, avg: "5.3", td: 1 }),
  realRow("FCS", "Big Sky", "rushing", "RB", "Spencer Ferguson", "Weber State", { att: 28, yards: 165, avg: "5.9", td: 2 }),
  realRow("FCS", "Big Sky", "rushing", "RB", "Justin Guin", "Northern Colorado", { att: 34, yards: 163, avg: "4.8", td: 1 }),

  // Receiving
  realRow("FCS", "Big Sky", "receiving", "WR", "Noah Kjar", "Weber State", { rec: 22, yards: 385, avg: "17.5", td: 6 }),
  realRow("FCS", "Big Sky", "receiving", "WR", "Brooks Davis", "Montana", { rec: 24, yards: 311, avg: "13.0", td: 1 }),
  realRow("FCS", "Big Sky", "receiving", "WR", "Samuel Gbatu Jr.", "UC Davis", { rec: 22, yards: 296, avg: "13.5", td: 3 }),
  realRow("FCS", "Big Sky", "receiving", "WR", "Zedekiah Anahu-Ambrosio", "Idaho State", { rec: 5, yards: 281, avg: "56.2", td: 3 }),
  realRow("FCS", "Big Sky", "receiving", "WR", "Dane Steel", "Montana State", { rec: 13, yards: 264, avg: "20.3", td: 3 }),
  realRow("FCS", "Big Sky", "receiving", "WR", "Tayvion McCoy", "Cal Poly", { rec: 20, yards: 249, avg: "12.4", td: 1 }),
  realRow("FCS", "Big Sky", "receiving", "WR", "Wesley Garrett", "Eastern Washington", { rec: 18, yards: 235, avg: "13.1", td: 2 }),
  realRow("FCS", "Big Sky", "receiving", "WR", "Tony Harste", "Idaho", { rec: 13, yards: 233, avg: "17.9", td: 2 }),
  realRow("FCS", "Big Sky", "receiving", "WR", "Terence Loville", "Portland State", { rec: 15, yards: 221, avg: "14.7", td: 1 }),
  realRow("FCS", "Big Sky", "receiving", "WR", "Fidel Pitts", "Cal Poly", { rec: 14, yards: 212, avg: "15.1", td: 2 }),

  // Tackling
  realRow("FCS", "Big Sky", "tackling", "LB", "Nathan Reynolds", "Idaho State", { solo: 6, ast: 9, total: 15 }),
  realRow("FCS", "Big Sky", "tackling", "LB", "Jaiden Letua", "Northern Arizona", { solo: 4, ast: 5, total: 9 }),
  realRow("FCS", "Big Sky", "tackling", "LB", "Ryder Bordner", "Idaho", { solo: 2, ast: 7, total: 9 }),
  realRow("FCS", "Big Sky", "tackling", "LB", "Logan Lisherness", "Portland State", { solo: 5, ast: 4, total: 9 }),
  realRow("FCS", "Big Sky", "tackling", "LB", "Shoes Brinkley", "Northern Arizona", { solo: 3, ast: 5, total: 8 }),
  realRow("FCS", "Big Sky", "tackling", "DB", "Jacob Perez", "Idaho State", { solo: 3, ast: 5, total: 8 }),
  realRow("FCS", "Big Sky", "tackling", "DB", "Khaled Rawls", "Idaho", { solo: 6, ast: 2, total: 8 }),
  realRow("FCS", "Big Sky", "tackling", "DB", "Nikko Speer", "Idaho", { solo: 4, ast: 4, total: 8 }),
  realRow("FCS", "Big Sky", "tackling", "LB", "Luca Moore", "Idaho", { solo: 3, ast: 5, total: 8 }),
  realRow("FCS", "Big Sky", "tackling", "DB", "Brevin Czosnyka", "Utah Tech", { solo: 6, ast: 1, total: 7 }),

  // Sacks
  realRow("FCS", "Big Sky", "sacksTfl", "DL", "Myles Amey", "Southern Utah", { sacks: "2.5", sackYds: 16, ff: 1, fr: 0 }),
  realRow("FCS", "Big Sky", "sacksTfl", "DL", "Trehsyn Fesili", "Idaho State", { sacks: "2.5", sackYds: 12, ff: 1, fr: 0 }),
  realRow("FCS", "Big Sky", "sacksTfl", "DL", "Will Alovao", "Utah Tech", { sacks: "2.0", sackYds: 7, ff: 0, fr: 0 }),
  realRow("FCS", "Big Sky", "sacksTfl", "LB", "Tyler King", "Montana", { sacks: "2.0", sackYds: 10, ff: 0, fr: 0 }),
  realRow("FCS", "Big Sky", "sacksTfl", "DL", "Gauge Larsen", "Eastern Washington", { sacks: "2.0", sackYds: 22, ff: 0, fr: 0 }),
  realRow("FCS", "Big Sky", "sacksTfl", "DL", "Jaden Radke", "Eastern Washington", { sacks: "1.5", sackYds: 6, ff: 0, fr: 0 }),
  realRow("FCS", "Big Sky", "sacksTfl", "LB", "Aiden Hall", "Southern Utah", { sacks: "1.5", sackYds: 9, ff: 0, fr: 0 }),
  realRow("FCS", "Big Sky", "sacksTfl", "DL", "Porter Connors", "UC Davis", { sacks: "1.0", sackYds: 2, ff: 0, fr: 0 }),
  realRow("FCS", "Big Sky", "sacksTfl", "LB", "Tanner Huff", "Montana", { sacks: "1.0", sackYds: 7, ff: 0, fr: 0 }),
  realRow("FCS", "Big Sky", "sacksTfl", "LB", "Ezra Ekuban", "Northern Colorado", { sacks: "1.0", sackYds: 9, ff: 1, fr: 0 }),
];

// Aggregates a player's weekly stat lines into a season "total" row.
// Recomputes rate stats (avg, rating) from the summed components rather
// than averaging the per-week rates, same as a real stat site would.
function aggregateCategory(catKey, weeklyStats) {
  const sum = (fn) => weeklyStats.reduce((acc, s) => acc + fn(s), 0);
  if (catKey === "passing") {
    const att = sum((s) => s.att);
    const comp = sum((s) => parseInt(s.compAtt.split("/")[0], 10));
    const yards = sum((s) => s.yards);
    const td = sum((s) => s.td);
    const int = sum((s) => s.int);
    return { compAtt: `${comp}/${att}`, att, yards, td, int, rating: (100 + td * 20 - int * 15 + yards / 5).toFixed(1) };
  }
  if (catKey === "rushing") {
    const att = sum((s) => s.att);
    const yards = sum((s) => s.yards);
    const td = sum((s) => s.td);
    return { att, yards, avg: att ? (yards / att).toFixed(1) : "0.0", td };
  }
  if (catKey === "receiving") {
    const rec = sum((s) => s.rec);
    const yards = sum((s) => s.yards);
    const td = sum((s) => s.td);
    return { rec, yards, avg: rec ? (yards / rec).toFixed(1) : "0.0", td };
  }
  if (catKey === "tackling") {
    const solo = sum((s) => s.solo);
    const ast = sum((s) => s.ast);
    return { solo, ast, total: solo + ast };
  }
  // sacksTfl
  const sacks = sum((s) => parseFloat(s.sacks)).toFixed(1);
  const sackYds = sum((s) => s.sackYds);
  const ff = sum((s) => s.ff);
  const fr = sum((s) => s.fr);
  return { sacks, sackYds, ff, fr };
}

function buildSampleDataset() {
  const rows = [];
  let id = 0;
  DIVISIONS.forEach((division) => {
    Object.entries(CATEGORIES).forEach(([catKey, cat]) => {
      // A fixed roster per division+category so weekly lines belong to the
      // same player and can be summed into a meaningful season total.
      const rosterSize = ri(6, 9);
      const roster = [];
      for (let i = 0; i < rosterSize; i++) {
        let teamPick = pickTeam(division);
        // Avoid mixing sample rows into the real Big Sky conference
        while (division === "FCS" && teamPick.conference === "Big Sky") {
          teamPick = pickTeam(division);
        }
        roster.push({ player: name(), team: teamPick.team, conference: teamPick.conference, position: pick(cat.positions) });
      }

      const weeklyStatsByPlayer = roster.map(() => []);
      WEEKS.forEach((week) => {
        roster.forEach((p, idx) => {
          const stats = cat.gen();
          weeklyStatsByPlayer[idx].push(stats);
          rows.push({
            id: `sample-${id++}`,
            division,
            week,
            category: catKey,
            position: p.position,
            player: p.player,
            team: p.team,
            conference: p.conference,
            sample: true,
            ...stats,
          });
        });
      });

      roster.forEach((p, idx) => {
        rows.push({
          id: `sample-${id++}`,
          division,
          week: "total",
          category: catKey,
          position: p.position,
          player: p.player,
          team: p.team,
          conference: p.conference,
          sample: true,
          ...aggregateCategory(catKey, weeklyStatsByPlayer[idx]),
        });
      });
    });
  });
  return rows;
}

const DATA = [...BIG_SKY_REAL, ...buildSampleDataset()];
const DIVISION_LABEL = { JUCO: "Junior College", D2: "NCAA Division II", FCS: "FCS" };

function conferencesFor(division) {
  return [...new Set(TEAMS[division].map((t) => t.conference))];
}

// The only conference currently backed by a live source.
function isLiveViewFor(division, conference) {
  return division === "FCS" && conference === "Big Sky";
}

// ---------- Component ----------

export default function Gridline() {
  const [division, setDivision] = useState("FCS");
  const [category, setCategory] = useState("passing");
  const [week, setWeek] = useState("total");
  const [position, setPosition] = useState("All");
  const [conference, setConference] = useState("Big Sky");
  const [sortKey, setSortKey] = useState("yards");
  const [sortDir, setSortDir] = useState("desc");

  const cat = CATEGORIES[category];
  const positions = useMemo(() => ["All", ...cat.positions], [category]);
  const conferences = useMemo(() => ["All", ...conferencesFor(division)], [division]);

  const rows = useMemo(() => {
    const effectiveWeek = isLiveViewFor(division, conference) ? "total" : week;
    let filtered = DATA.filter((r) => r.division === division && r.category === category && r.week === effectiveWeek);
    if (position !== "All") filtered = filtered.filter((r) => r.position === position);
    if (conference !== "All") filtered = filtered.filter((r) => r.conference === conference);

    filtered = [...filtered].sort((a, b) => {
      const av = parseFloat(a[sortKey]) || 0;
      const bv = parseFloat(b[sortKey]) || 0;
      return sortDir === "desc" ? bv - av : av - bv;
    });
    return filtered;
  }, [division, category, week, position, conference, sortKey, sortDir]);

  const isLiveView = isLiveViewFor(division, conference);

  // Weekly leaders: top row per category for this division/conference, ignoring position filter
  const weeklyLeaders = useMemo(() => {
    const effectiveWeek = isLiveView ? "total" : week;
    return Object.entries(CATEGORIES).map(([key, c]) => {
      let catRows = DATA.filter((r) => r.division === division && r.category === key && r.week === effectiveWeek);
      if (conference !== "All") catRows = catRows.filter((r) => r.conference === conference);
      const sorted = [...catRows].sort((a, b) => (parseFloat(b[c.leaderKey]) || 0) - (parseFloat(a[c.leaderKey]) || 0));
      return { key, cat: c, leader: sorted[0] };
    });
  }, [division, week, conference, isLiveView]);

  function handleSort(key) {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function handleDivisionChange(d) {
    setDivision(d);
    setConference("All");
  }

  function handleConferenceChange(c) {
    setConference(c);
    if (isLiveViewFor(division, c)) setWeek("total");
  }

  function handleCategoryChange(key) {
    setCategory(key);
    setPosition("All");
    setSortKey(CATEGORIES[key].leaderKey);
    setSortDir("desc");
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#12171A",
        color: "#EDEAE0",
        fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        .oswald { font-family: 'Oswald', sans-serif; }
        .tabular { font-variant-numeric: tabular-nums; }
        ::selection { background: #C89B3C; color: #12171A; }
      `}</style>

      {/* Header */}
      <div style={{ borderBottom: "1px solid #2A333A", padding: "28px 32px 22px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
            <h1 className="oswald" style={{ fontSize: 34, fontWeight: 700, margin: 0, letterSpacing: "0.01em" }}>
              Gridline
            </h1>
            <span style={{ color: "#8B959C", fontSize: 15 }}>weekly stats — JUCO · D2 · FCS</span>
          </div>
          <p style={{ margin: "6px 0 0", color: "#8B959C", fontSize: 14, maxWidth: 620, lineHeight: 1.5 }}>
            FCS · Big Sky is live data, pulled from Fox Sports through this week's games (Sept 12–14, 2026).
            Everything else is still sample data — those data sources are blocked or not yet connected.
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "22px 32px 0" }}>
        {/* Division tabs */}
        <div style={{ display: "flex", gap: 4, borderBottom: "1px solid #2A333A", marginBottom: 20 }}>
          {DIVISIONS.map((d) => (
            <button
              key={d}
              onClick={() => handleDivisionChange(d)}
              className="oswald"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "10px 18px 12px",
                fontSize: 15,
                fontWeight: 600,
                color: division === d ? "#C89B3C" : "#8B959C",
                borderBottom: division === d ? "2px solid #C89B3C" : "2px solid transparent",
                marginBottom: -1,
              }}
              title={DIVISION_LABEL[d]}
            >
              {d}
            </button>
          ))}
        </div>

        {/* Live / sample banner */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 18,
            padding: "8px 12px",
            borderRadius: 5,
            background: isLiveView ? "#1B2A1E" : "#241D16",
            border: isLiveView ? "1px solid #33502F" : "1px solid #4A3A22",
            fontSize: 13,
            color: isLiveView ? "#8FCB86" : "#D9A85C",
          }}
        >
          {isLiveView ? (
            <>
              <BadgeCheck size={15} />
              <span>Live data — Big Sky Conference, season totals through games played Sept 12–14, 2026 (source: Fox Sports)</span>
            </>
          ) : (
            <>
              <FlaskConical size={15} />
              <span>Sample data — this division/conference isn't connected to a live source yet</span>
            </>
          )}
        </div>

        {/* Weekly leaders strip */}
        <div style={{ marginBottom: 24 }}>
          <span style={{ fontSize: 11, color: "#5D666C", letterSpacing: "0.03em", display: "block", marginBottom: 8 }}>
            {weekLabel(isLiveView ? "total" : week)} leaders — {conference === "All" ? DIVISION_LABEL[division] : conference}
          </span>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {weeklyLeaders.map(({ key, cat: c, leader }) => (
              <button
                key={key}
                onClick={() => handleCategoryChange(key)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 2,
                  background: category === key ? "#20281F" : "#1A2126",
                  border: category === key ? "1px solid #C89B3C" : "1px solid #2A333A",
                  borderRadius: 5,
                  padding: "8px 14px",
                  cursor: "pointer",
                  textAlign: "left",
                  minWidth: 148,
                }}
              >
                <span className="oswald" style={{ fontSize: 11, color: "#8B959C", fontWeight: 500 }}>
                  {c.label}
                </span>
                {leader ? (
                  <>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: "#EDEAE0" }}>{leader.player}</span>
                    <span className="tabular" style={{ fontSize: 12.5, color: "#C89B3C" }}>
                      {leader[c.leaderKey]} {c.columns.find((col) => col.key === c.leaderKey)?.label || ""}
                    </span>
                  </>
                ) : (
                  <span style={{ fontSize: 13, color: "#5D666C" }}>No data</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Category / position / conference / week row */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center", marginBottom: 22 }}>
          <FilterGroup label="Stat category">
            <select value={category} onChange={(e) => handleCategoryChange(e.target.value)} style={selectStyle}>
              {Object.entries(CATEGORIES).map(([key, c]) => (
                <option key={key} value={key}>
                  {c.label}
                </option>
              ))}
            </select>
          </FilterGroup>

          <FilterGroup label="Position">
            <select value={position} onChange={(e) => setPosition(e.target.value)} style={selectStyle}>
              {positions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </FilterGroup>

          <FilterGroup label="Conference">
            <select value={conference} onChange={(e) => handleConferenceChange(e.target.value)} style={selectStyle}>
              {conferences.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </FilterGroup>

          <FilterGroup label="Week">
            <select
              value={isLiveView ? "total" : week}
              onChange={(e) => setWeek(e.target.value === "total" ? "total" : Number(e.target.value))}
              style={selectStyle}
              disabled={isLiveView}
              title={isLiveView ? "Live source only reports season totals, not per-week splits" : undefined}
            >
              {WEEK_OPTIONS.map((w) => (
                <option key={w} value={w}>
                  {weekLabel(w)}
                </option>
              ))}
            </select>
          </FilterGroup>

          <span style={{ marginLeft: "auto", color: "#5D666C", fontSize: 13 }}>
            {rows.length} player{rows.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Table */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 32px 60px" }}>
        <div style={{ border: "1px solid #2A333A", borderRadius: 6, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#1A2126" }}>
                <Th label="Player" />
                <Th label="Team" />
                <Th label="Conf" />
                <Th label="Pos" />
                {cat.columns.map((col) => (
                  <Th
                    key={col.key}
                    label={col.label}
                    align="right"
                    sortable
                    active={sortKey === (col.sortKey || col.key)}
                    dir={sortDir}
                    onClick={() => handleSort(col.sortKey || col.key)}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const isLeader = i === 0 && sortDir === "desc";
                return (
                  <tr
                    key={r.id}
                    style={{
                      background: isLeader ? "#20281F" : i % 2 === 0 ? "#151B1F" : "#12171A",
                      borderTop: "1px solid #212A2F",
                      borderLeft: isLeader ? "2px solid #C89B3C" : "2px solid transparent",
                    }}
                  >
                    <td style={{ ...tdStyle, fontWeight: 600, color: "#EDEAE0" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        {isLeader && <Crown size={13} color="#C89B3C" />}
                        {r.player}
                        {r.sample && (
                          <span
                            title="Sample data"
                            style={{
                              fontSize: 9.5,
                              color: "#D9A85C",
                              border: "1px solid #4A3A22",
                              borderRadius: 3,
                              padding: "1px 4px",
                              fontWeight: 600,
                              letterSpacing: "0.02em",
                            }}
                          >
                            SAMPLE
                          </span>
                        )}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, color: "#8B959C" }}>{r.team}</td>
                    <td style={{ ...tdStyle, color: "#8B959C", fontSize: 12.5 }}>{r.conference}</td>
                    <td style={{ ...tdStyle, color: "#A23B3B", fontWeight: 600 }} className="oswald">
                      {r.position}
                    </td>
                    {cat.columns.map((col) => (
                      <td key={col.key} className="tabular" style={{ ...tdStyle, textAlign: "right" }}>
                        {r[col.key]}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4 + cat.columns.length} style={{ ...tdStyle, textAlign: "center", color: "#5D666C", padding: 32 }}>
                    No players match this filter for the selected week.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function FilterGroup({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, color: "#5D666C", letterSpacing: "0.03em" }}>{label}</span>
      {children}
    </div>
  );
}

function Th({ label, align = "left", sortable, active, dir, onClick }) {
  return (
    <th
      onClick={sortable ? onClick : undefined}
      className="oswald"
      style={{
        padding: "12px 16px",
        textAlign: align,
        fontSize: 13,
        fontWeight: 600,
        color: active ? "#C89B3C" : "#8B959C",
        cursor: sortable ? "pointer" : "default",
        userSelect: "none",
        borderBottom: "1px solid #2A333A",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: align === "right" ? "flex-end" : "flex-start" }}>
        {label}
        {sortable &&
          (active ? (
            dir === "desc" ? <ChevronDown size={13} /> : <ChevronUp size={13} />
          ) : (
            <ChevronsUpDown size={12} style={{ opacity: 0.4 }} />
          ))}
      </span>
    </th>
  );
}

const tdStyle = { padding: "11px 16px", fontSize: 14, color: "#C7CDD1" };

const selectStyle = {
  background: "#1A2126",
  color: "#EDEAE0",
  border: "1px solid #2A333A",
  borderRadius: 4,
  padding: "7px 10px",
  fontSize: 14,
  minWidth: 140,
  cursor: "pointer",
};
