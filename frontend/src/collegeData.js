import colleges from "./data/colleges.json";
import standings from "./data/standings.json";
import realStats from "./data/real-stats.json";

export const COLLEGES = colleges;
export const COLLEGE_BY_ID = new Map(colleges.map((c) => [c.id, c]));
export const STANDINGS_UPDATED = standings.updated;
export const STANDINGS_SEASON = standings.season;

const standingRowById = new Map();
Object.values(standings.divisions).forEach((conferences) =>
  conferences.forEach((conf) => conf.teams.forEach((t) => standingRowById.set(t.id, t)))
);
const rankById = new Map();
Object.entries(standings.polls).forEach(([division, poll]) => poll.ranks.forEach((r) => rankById.set(`${division}:${r.id}`, r.rank)));

export function standingFor(id) {
  return standingRowById.get(id) || null;
}

export function rankFor(college) {
  return rankById.get(`${college.division}:${college.id}`) || null;
}

// Top 25 (AP for FBS, Coaches for FCS), joined to each team's standings row.
export function topTwentyFive(division) {
  const poll = standings.polls[division];
  if (!poll) return [];
  return poll.ranks
    .map((r) => ({ rank: r.rank, college: COLLEGE_BY_ID.get(r.id), row: standingRowById.get(r.id) }))
    .filter((r) => r.college);
}

export function conferenceStandings(division) {
  return (standings.divisions[division] || []).map((conf) => ({
    name: conf.name,
    teams: conf.teams.map((t) => ({ college: COLLEGE_BY_ID.get(t.id), row: t })).filter((t) => t.college),
  }));
}

export function pollName(division) {
  return standings.polls[division]?.name || "Top 25";
}

// --------------------------------------------------------------- live ESPN data
//
// ESPN's public site API sends `access-control-allow-origin: *`, so the
// browser can call it directly -- team header, stats and per-season
// schedules are fetched on demand rather than baked into the build.

const ESPN = "https://site.web.api.espn.com/apis/site/v2/sports/football/college-football";
const cache = new Map();

function cached(url) {
  if (!cache.has(url)) {
    const request = fetch(url).then((res) => {
      if (!res.ok) throw new Error(`ESPN returned ${res.status}`);
      return res.json();
    });
    request.catch(() => cache.delete(url));
    cache.set(url, request);
  }
  return cache.get(url);
}

function opponentOf(event, teamId) {
  const comp = event.competitions?.[0];
  if (!comp) return null;
  const opp = comp.competitors.find((c) => String(c.team?.id) !== String(teamId));
  const me = comp.competitors.find((c) => String(c.team?.id) === String(teamId));
  if (!opp) return null;
  const logo = opp.team?.logos?.[0]?.href || opp.team?.logo || (opp.team?.id ? `https://a.espncdn.com/i/teamlogos/ncaa/500/${opp.team.id}.png` : "");
  const score = (c) => (c?.score == null ? null : typeof c.score === "object" ? c.score.displayValue : String(c.score));
  return {
    id: String(opp.team?.id || ""),
    name: opp.team?.location || opp.team?.displayName || "TBD",
    displayName: opp.team?.displayName || "",
    logo,
    rank: opp.curatedRank?.current && opp.curatedRank.current <= 25 ? opp.curatedRank.current : null,
    away: me?.homeAway === "away",
    neutral: !!comp.neutralSite,
    myScore: score(me),
    oppScore: score(opp),
    won: me?.winner === true,
    lost: opp.winner === true,
    venue: comp.venue?.fullName || "",
    venueCity: [comp.venue?.address?.city, comp.venue?.address?.state].filter(Boolean).join(", "),
    tv: (comp.broadcasts || []).flatMap((b) => b.names || []).join(", "),
    completed: !!comp.status?.type?.completed || !!event.status?.type?.completed,
    note: comp.notes?.[0]?.headline || event.notes?.[0]?.headline || "",
    timeValid: event.timeValid !== false,
    date: event.date,
    week: event.week?.number ?? null,
  };
}

export async function fetchTeamSummary(id) {
  const data = await cached(`${ESPN}/teams/${id}`);
  const team = data.team;
  const nextEvent = team.nextEvent?.[0];
  return {
    record: team.record?.items?.find((i) => i.type === "total")?.summary || "",
    standingSummary: team.standingSummary || "",
    next: nextEvent ? { ...opponentOf(nextEvent, id), date: nextEvent.date } : null,
  };
}

export async function fetchSchedule(id, season) {
  const data = await cached(`${ESPN}/teams/${id}/schedule?season=${season}`);
  return (data.events || []).map((event) => ({ id: event.id, ...opponentOf(event, id) })).filter((g) => g.date);
}

function statValue(categories, categoryName, statName) {
  const cat = categories.find((c) => c.name === categoryName);
  return cat?.stats.find((s) => s.name === statName)?.value ?? null;
}

// Offense is per game (what a coach compares teams on); defense is season totals.
export async function fetchTeamStats(id) {
  const data = await cached(`${ESPN}/teams/${id}/statistics`);
  const cats = data.results?.stats?.categories || [];
  return {
    games: statValue(cats, "general", "gamesPlayed"),
    offense: {
      TOT: statValue(cats, "passing", "yardsPerGame"),
      RUSH: statValue(cats, "rushing", "rushingYardsPerGame"),
      PASS: statValue(cats, "passing", "netPassingYardsPerGame"),
      PPG: statValue(cats, "passing", "totalPointsPerGame"),
    },
    defense: {
      SACKS: statValue(cats, "defensive", "sacks"),
      TFL: statValue(cats, "defensive", "tacklesForLoss"),
      INT: statValue(cats, "defensiveInterceptions", "interceptions"),
      PBU: statValue(cats, "defensive", "passesDefended"),
    },
  };
}

export function lazyDepthCharts() {
  return import("./data/depth-charts.json").then((m) => m.default);
}

// -------------------------------------------------------------- name matching
//
// The Pre-Portal Tracker (NCAA naming: "Penn St.", "Central Mich."), the
// Offer Tracker's feed ("University of Alabama") and ESPN ("Penn State")
// all spell schools differently, so schools are compared by a normalized key.

const ABBREVIATIONS = [
  [/\bst\b/g, "state"], [/\bmich\b/g, "michigan"], [/\bfla\b/g, "florida"], [/\bga\b/g, "georgia"], [/\bcarolina\b/g, "carolina"],
  [/\bn\b/g, "north"], [/\bs\b/g, "south"], [/\be\b/g, "eastern"], [/\bw\b/g, "western"], [/\bill\b/g, "illinois"],
  [/\bken\b/g, "kentucky"], [/\bmiss\b/g, "mississippi"], [/\btenn\b/g, "tennessee"], [/\bala\b/g, "alabama"],
  [/\bmass\b/g, "massachusetts"], [/\bconn\b/g, "connecticut"], [/\bwash\b/g, "washington"], [/\bark\b/g, "arkansas"],
  [/\bind\b/g, "indiana"], [/\bnev\b/g, "nevada"], [/\bokla\b/g, "oklahoma"], [/\bnw\b/g, "northwestern"],
  [/\bky\b/g, "kentucky"], [/\bmo\b/g, "missouri"], [/\bariz\b/g, "arizona"], [/\bcolo\b/g, "colorado"],
  [/\bconn\b/g, "connecticut"],
];

const ALIASES = {
  "app state": "appalachian state", "uconn": "connecticut", "umass": "massachusetts", "ole miss": "mississippi",
  "fiu": "florida international", "pitt": "pittsburgh", "usf": "south florida", "sac state": "sacramento state",
  "california state university sacramento": "sacramento state", "miami": "miami florida", "miami fl": "miami florida",
  "miami university oh": "miami ohio", "miami oh": "miami ohio", "army west point": "army", "unc": "north carolina",
  "southern miss": "southern mississippi", "san jose st": "san jose state", "louisiana lafayette": "louisiana",
  "ul monroe": "louisiana monroe", "utsa": "texas san antonio", "utep": "texas el paso", "nc state": "north carolina state",
  "north carolina at charlotte": "charlotte", "university at buffalo": "buffalo", "university at albany sunyc": "albany",
  "university at albany suny": "albany", "university of hawaii": "hawaii", "hawai i": "hawaii",
  "southern california": "usc", "wku": "western kentucky", "ulm": "louisiana monroe", "niu": "northern illinois",
  "unt": "north texas", "mtsu": "middle tennessee", "nm state": "new mexico state", "jax state": "jacksonville state",
  "ndsu": "north dakota state", "alcorn": "alcorn state", "uni": "northern iowa", "uiw": "incarnate word",
  "etsu": "east tennessee state", "sfa": "stephen f austin", "liu": "long island", "prairie view": "prairie view a and m",
  "utrgv": "ut rio grande valley", "southeastern la": "se louisiana", "western caro": "western carolina",
  "southern u": "southern", "mississippi val": "mississippi valley state", "charleston so": "charleston southern",
  "central connecticut state": "central connecticut", "state thomas mn": "state thomas", "grambling state": "grambling",
  "hcu": "houston christian",
  "air force academy": "air force", "california polytechnic state": "cal poly", "california state sacramento": "sacramento state",
  "indiana bloomington": "indiana", "middle tennessee state": "middle tennessee", "monmouth nj": "monmouth",
  "nicholls state": "nicholls", "sam houston state": "sam houston", "southern illinois carbondale": "southern illinois",
  "stephen f austin state": "stephen f austin", "north carolina a and t state": "north carolina a and t",
  "california berkeley": "california", "north carolina charlotte": "charlotte", "tennessee chattanooga": "chattanooga",
  "tennessee martin": "ut martin", "virginia military institute": "vmi", "austin peay state": "austin peay",
  "lindenwood missouri": "lindenwood", "robert morris pa": "robert morris", "california davis": "uc davis", "albany suny": "ualbany",
};

export function teamKey(name) {
  let n = (name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  n = n.replace(/\bn\.?c\.?\s/g, "north carolina ").replace(/&/g, " and ").replace(/['’.]/g, " ").replace(/[^a-z ]/g, " ");
  n = n.replace(/\b(the|university|of|at|college)\b/g, " ").replace(/\s+/g, " ").trim();
  ABBREVIATIONS.forEach(([re, full]) => {
    n = n.replace(re, full);
  });
  n = n.replace(/\bstate state\b/g, "state").replace(/\s+/g, " ").trim();
  if (n === "miami" || n === "miami fl") return "miami florida";
  return ALIASES[n] || n;
}

// Pre-Portal Tracker players (FBS and FCS only -- the only levels the
// colleges section lists), grouped under the college they play for.
let playersByCollegeKey = null;
function buildPlayerIndex() {
  playersByCollegeKey = new Map();
  realStats.forEach((r) => {
    if (r.division !== "FBS" && r.division !== "FCS") return;
    const id = `${r.division}|${r.team}|${r.player}`;
    const key = teamKey(r.team);
    if (!playersByCollegeKey.has(key)) playersByCollegeKey.set(key, new Map());
    const players = playersByCollegeKey.get(key);
    if (!players.has(id)) players.set(id, { id, player: r.player, team: r.team, division: r.division, position: r.position, categories: new Set() });
    players.get(id).categories.add(r.category);
  });
}

export function rosterFor(college) {
  if (!playersByCollegeKey) buildPlayerIndex();
  const keys = new Set([teamKey(college.name), teamKey(college.displayName)]);
  const out = [];
  keys.forEach((k) => {
    const players = playersByCollegeKey.get(k);
    if (players) players.forEach((p) => out.push(p));
  });
  return [...new Map(out.map((p) => [p.id, p])).values()].sort((a, b) => a.player.localeCompare(b.player));
}
