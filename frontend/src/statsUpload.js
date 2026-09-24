import * as XLSX from "xlsx";
import { collection, deleteDoc, doc, getDocs, query, setDoc, where } from "firebase/firestore";
import { db } from "./firebase";
import { normalizePosition } from "./offerData.js";

// Stats the scrapers can't reach (NAIA, California JUCO: their sites now put a bot check in front of automated
// visitors) can be loaded by hand: someone downloads the stats table in their own browser and uploads it here.
// The rows are stored in the database (statsUploads) and merged into the Pre-Portal Tracker when it opens.

export const UPLOAD_DIVISIONS = ["NAIA", "JUCO", "D2", "D3", "FCS", "FBS"];
export const UPLOAD_CATEGORIES = [
  { key: "passing", label: "Passing" },
  { key: "rushing", label: "Rushing" },
  { key: "receiving", label: "Receiving" },
  { key: "tackling", label: "Defense (tackles, sacks, INT)" },
];

const norm = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const slug = (text) => norm(text) || "x";
const CHUNK_ROWS = 1000; // keeps every stored document well under the database's size limit

// Column names as they show up in exports, by the field they fill (all compared with punctuation stripped).
const ALIASES = {
  player: ["name", "player", "playername", "fullname", "athlete"],
  team: ["team", "school", "college", "institution", "teamname"],
  conference: ["conference", "conf"],
  position: ["pos", "position"],
  homeState: ["state", "homestate", "st"],
  hometown: ["hometown", "home", "hometowncity"],
  games: ["gp", "games", "gamesplayed", "g"],
  comp: ["comp", "cmp", "completions", "pc", "cmpl"],
  compatt: ["compatt", "cmpatt", "ca", "cmpatts"],
  att: ["att", "attempts", "pa", "passatt", "car", "carries", "rush", "rushatt", "rushes"],
  yards: ["yds", "yards", "passyds", "rushyds", "recyds", "pyds", "ryds"],
  td: ["td", "tds", "passtd", "rushtd", "rectd", "touchdowns"],
  int: ["int", "ints", "interceptions", "passint"],
  rating: ["rating", "effic", "efficiency", "qbrating", "passeff", "passerrating", "eff"],
  avg: ["avg", "average", "ypc", "ypr", "yardspercarry", "yardsperreception"],
  rec: ["rec", "receptions", "no", "catches"],
  solo: ["solo", "unast", "unassisted", "tklsolo", "tackua", "soloTackles".toLowerCase()],
  ast: ["ast", "asst", "assist", "assisted", "tackassist", "tacka"],
  total: ["total", "tot", "tkl", "tackles", "totaltackles", "tacklestotal"],
  tfl: ["tfl", "tacklesforloss", "tackleforloss", "tflyds"],
  sacks: ["sacks", "sck", "sack"],
  sackYds: ["sackyds", "sckyds", "sackyards"],
  pbu: ["pbu", "brup", "pd", "passbreakups", "passesdefended", "pbup"],
};

// Finds which column holds each field, in header order, each column used once.
function mapColumns(headers) {
  const used = new Set();
  const map = {};
  Object.entries(ALIASES).forEach(([field, names]) => {
    const at = headers.findIndex((h, i) => !used.has(i) && names.includes(norm(h)));
    if (at >= 0) {
      map[field] = at;
      used.add(at);
    }
  });
  return map;
}

// US state full names -> the two-letter abbreviation, for a "Hometown" column that spells it out
// ("Houston, Texas") rather than abbreviating it ("Houston, TX") -- real exports do both.
const STATE_ABBR = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT",
  delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA",
  michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};
const VALID_STATE_ABBRS = new Set(Object.values(STATE_ABBR));

// A player's home state from either a plain "State" column, or a "Hometown" column ("City, ST"/"City, State").
function homeStateOf(get) {
  const direct = String(get("homeState") || "").trim();
  if (direct) return VALID_STATE_ABBRS.has(direct.toUpperCase()) ? direct.toUpperCase() : STATE_ABBR[direct.toLowerCase()] || "";
  const hometown = String(get("hometown") || "").trim();
  if (!hometown.includes(",")) return "";
  const tail = hometown.split(",").pop().trim();
  return VALID_STATE_ABBRS.has(tail.toUpperCase()) ? tail.toUpperCase() : STATE_ABBR[tail.toLowerCase()] || "";
}

const num = (v) => {
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const int = (v) => Math.round(num(v));
const one = (v) => num(v).toFixed(1);

function buildRow(category, division, cells, col, teamOverride) {
  const get = (field) => (col[field] === undefined ? "" : cells[col[field]]);
  const player = String(get("player") || "").trim();
  const team = String(teamOverride || get("team") || "").trim();
  if (!player || !team) return null;
  const base = {
    division,
    week: "total",
    position: normalizePosition(String(get("position") || "").toUpperCase().split(/[\/,\s]/)[0]),
    player,
    team,
    conference: String(get("conference") || "").trim() || "Uploaded",
    games: int(get("games")),
    sample: false,
    profileUrl: "",
    homeState: homeStateOf(get),
    hometown: String(get("hometown") || "").trim(),
    id: `upload-${division.toLowerCase()}-${slug(team)}-${slug(player)}-${category}`,
    category,
  };
  if (category === "passing") {
    let comp = int(get("comp"));
    let att = int(get("att"));
    const combined = String(get("compatt") || "");
    if (!att && /[-\/]/.test(combined)) [comp, att] = combined.split(/[-\/]/).map(int);
    if (!att) return null;
    return { ...base, compAtt: `${comp}/${att}`, att, yards: int(get("yards")), td: int(get("td")), int: int(get("int")), rating: one(get("rating")) };
  }
  if (category === "rushing") {
    const att = int(get("att"));
    if (!att) return null;
    const yards = int(get("yards"));
    return { ...base, att, yards, td: int(get("td")), avg: get("avg") !== "" ? one(get("avg")) : one(yards / att) };
  }
  if (category === "receiving") {
    const rec = int(get("rec") || get("att"));
    if (!rec) return null;
    const yards = int(get("yards"));
    return { ...base, rec, yards, td: int(get("td")), avg: get("avg") !== "" ? one(get("avg")) : one(yards / rec) };
  }
  // tackling
  let solo = int(get("solo"));
  const ast = int(get("ast"));
  if (!solo && !ast) solo = int(get("total"));
  if (!solo && !ast && !num(get("sacks")) && !int(get("int"))) return null;
  const sacks = num(get("sacks"));
  return {
    ...base, solo, ast, total: solo + ast, tfl: one(get("tfl")), pbu: int(get("pbu")), int: int(get("int")),
    soloSacks: sacks, astSacks: 0, sackYds: int(get("sackYds")), sacks: sacks.toFixed(1),
  };
}

// Reads a CSV or Excel export and returns rows in the tracker's shape, plus what it found (for the preview).
export async function parseStatsFile(file, { division, category, team }) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
  // The header is the first row that has a player column.
  const headerAt = grid.findIndex((r) => r.some((c) => ALIASES.player.includes(norm(c))));
  if (headerAt < 0) throw new Error("Couldn't find a Name / Player column. The first row should be the column headings.");
  const headers = grid[headerAt].map((h) => String(h));
  const col = mapColumns(headers);
  if (col.team === undefined && !team) throw new Error("There's no Team / School column. Enter the team name for this file below.");
  const rows = [];
  const seen = new Set();
  for (const cells of grid.slice(headerAt + 1)) {
    const row = buildRow(category, division, cells, col, team);
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
  }
  if (!rows.length) throw new Error(`No ${category} rows found. Check that the stat columns for this category are in the file (${Object.keys(col).join(", ")}).`);
  return { rows, columns: Object.keys(col), headers };
}

// -------- storage --------

const uploadsRef = () => collection(db, "statsUploads");

export async function saveUpload({ division, category, rows, fileName, by }) {
  await removeUpload(division, category);
  const uploadedAt = new Date().toISOString();
  const chunks = Math.ceil(rows.length / CHUNK_ROWS);
  for (let i = 0; i < chunks; i++) {
    await setDoc(doc(db, "statsUploads", `${division}__${category}__${i}`), {
      division, category, chunk: i, chunks, rowCount: rows.length, fileName: fileName || "", uploadedAt, uploadedBy: by || "",
      rows: rows.slice(i * CHUNK_ROWS, (i + 1) * CHUNK_ROWS),
    });
  }
}

export async function removeUpload(division, category) {
  const snap = await getDocs(query(uploadsRef(), where("division", "==", division), where("category", "==", category)));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
}

// Every upload, grouped: [{division, category, rows, uploadedAt, fileName, rowCount}]
export async function loadUploads() {
  const snap = await getDocs(uploadsRef());
  const groups = new Map();
  snap.docs.forEach((d) => {
    const x = d.data();
    const key = `${x.division}|${x.category}`;
    const g = groups.get(key) || { division: x.division, category: x.category, rows: [], uploadedAt: x.uploadedAt, fileName: x.fileName, rowCount: x.rowCount, by: x.uploadedBy, chunks: x.chunks, seen: 0 };
    g.rows.push(...(x.rows || []));
    g.seen += 1;
    groups.set(key, g);
  });
  return [...groups.values()].filter((g) => g.seen === g.chunks); // a half-saved upload is ignored
}
