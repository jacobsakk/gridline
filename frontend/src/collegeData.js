import colleges from "./data/colleges.json";
import standings from "./data/standings.json";
import realStats from "./data/real-stats.json";
import { canonicalSchool } from "./schoolNames.js";

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
    name: canonicalSchool(opp.team?.location || opp.team?.displayName || "TBD"),
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

// ---------------------------------------------------- on-demand Ourlads refresh
//
// Ourlads can't be read from the browser (no CORS), so "refresh" asks GitHub
// to run the scraper (the same workflow that runs every morning), waits for it
// to finish, then reads the freshly committed file straight from the repo --
// no redeploy needed to see it.

const REPO = "jacobsakk/gridline";
const WORKFLOW = "colleges-refresh.yml";
const TOKEN_KEY = "gridline-github-token";
const RAW_DEPTH = `https://raw.githubusercontent.com/${REPO}/main/frontend/src/data/depth-charts.json`;

export const GITHUB_TOKEN_URL = "https://github.com/settings/personal-access-tokens/new";

export function getGithubToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}
export function saveGithubToken(token) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token.trim());
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable -- the token just won't be remembered */
  }
}

export async function fetchLatestDepthCharts() {
  const res = await fetch(`${RAW_DEPTH}?t=${Date.now()}`);
  if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
  return res.json();
}

function githubHeaders(token) {
  return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
}

// Starts the depth-chart scrape and resolves once it finishes (or throws).
// Error.code === "auth" means the saved token was rejected.
export async function refreshDepthCharts(token, onStatus = () => {}) {
  const startedAt = Date.now();
  const dispatch = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    headers: { ...githubHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ ref: "main", inputs: { only: "depth" } }),
  });
  if (dispatch.status === 401 || dispatch.status === 403 || dispatch.status === 404) {
    const err = new Error("GitHub rejected that token.");
    err.code = "auth";
    throw err;
  }
  if (!dispatch.ok) throw new Error(`GitHub returned ${dispatch.status}`);

  onStatus("Scraping Ourlads…");
  const deadline = Date.now() + 8 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 8000));
    const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=5`, {
      headers: githubHeaders(token),
    });
    if (!res.ok) continue;
    const { workflow_runs: runs } = await res.json();
    const run = runs.find((r) => new Date(r.created_at).getTime() >= startedAt - 20000);
    if (!run) continue;
    if (run.status === "completed") {
      if (run.conclusion !== "success") throw new Error("The refresh failed on GitHub.");
      return fetchLatestDepthCharts();
    }
  }
  throw new Error("The refresh is taking longer than usual. Try again in a few minutes.");
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
  "lindenwood missouri": "lindenwood", "robert morris pa": "robert morris", "california davis": "uc davis", "albany suny": "ualbany", "penn": "pennsylvania",
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
// Player names arrive in many shapes: "Reginald Vick, Jr.", "Jr.,Terrance
// Shelton", 'Jayden "Duke" Scott', "Trae'shawn", "J.J. Hill". Boil them down
// to bare lowercase words: nicknames in quotes/parentheses dropped, commas
// treated as breaks, periods/apostrophes/hyphens removed, suffixes removed.
export function nameKey(name) {
  return (name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/["\u201c\u201d][^"\u201c\u201d]*["\u201c\u201d]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/,/g, " ")
    .replace(/[.'\u2019\u2018`-]/g, "")
    .replace(/[^a-z ]/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const compact = (name) => nameKey(name).replace(/ /g, "");

// First names that are the same person: identical, a prefix of the other
// (Sam/Samuel, Dom/Dominique, Matt/Matthew), a tail of it (Quan/Jiquan), or a
// known nickname pair that isn't a prefix (Ike/Isaac).
const NICKNAMES = { ike: "isaac", bo: "beau", jon: "jonathan", zach: "zachary", tj: "", dj: "" };
function firstNamesMatch(a, b) {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 3 && long.startsWith(short)) return true;
  if (short.length >= 4 && long.endsWith(short)) return true;
  return NICKNAMES[short] === long;
}

// Ourlads position labels (WR-X, LCB, SS...) against the tracker's nine
// positions -- used only to break ties between two same-name candidates.
function positionGroup(label) {
  const p = (label || "").toUpperCase();
  if (/^QB/.test(p)) return "QB";
  if (/^(RB|FB|HB)/.test(p)) return "RB";
  if (/^(WR|SL)/.test(p)) return "WR";
  if (/^TE|^H$|^Y$/.test(p)) return "TE";
  if (/^(LT|LG|RG|RT|OL|OT|OG|C)$/.test(p)) return "OL";
  if (/^(DE|DT|NT|DL|EDGE|WOLF|BUCK|LEO|JACK|RUSH)/.test(p)) return "DL";
  if (/^(MLB|WLB|SLB|OLB|ILB|LB|MIKE|WILL|SAM|STING)/.test(p)) return "LB";
  if (/^(CB|LCB|RCB|NB|NICKEL|HUSKY)/.test(p)) return "CB";
  if (/^(S|SS|FS|SAF|DB|ROV)/.test(p)) return "SAF";
  return null;
}

// Matches every player on a team's depth chart to that team's players in the
// Pre-Portal Tracker. Exact names (after normalizing) are linked first; the
// rest are matched by last name plus a compatible first name, and only when
// that leaves exactly one candidate (position breaks a tie) -- a wrong link
// is worse than a missing one. Returns Map(compact depth name -> tracker player).
export function linkDepthChart(team, roster) {
  const depthPlayers = new Map();
  team.sections.forEach((section) =>
    section.positions.forEach((pos) =>
      pos.players.forEach((pl) => {
        const k = compact(pl.name);
        if (!depthPlayers.has(k)) depthPlayers.set(k, { name: pl.name, pos: pos.pos });
      })
    )
  );
  const links = new Map();
  const used = new Set();
  const rosterByKey = new Map(roster.map((p) => [compact(p.player), p]));

  depthPlayers.forEach((dp, k) => {
    const hit = rosterByKey.get(k);
    if (hit) {
      links.set(k, hit);
      used.add(hit.id);
    }
  });

  depthPlayers.forEach((dp, k) => {
    if (links.has(k)) return;
    const words = nameKey(dp.name).split(" ");
    const last = words[words.length - 1];
    const first = words[0];
    let candidates = roster.filter((p) => {
      if (used.has(p.id)) return false;
      const w = nameKey(p.player).split(" ");
      return w[w.length - 1] === last && firstNamesMatch(first, w[0]);
    });
    if (candidates.length > 1) {
      const group = positionGroup(dp.pos);
      const byPosition = candidates.filter((p) => !group || !p.position || p.position === group || p.position === "ATH");
      if (byPosition.length) candidates = byPosition;
    }
    if (candidates.length === 1) {
      links.set(k, candidates[0]);
      used.add(candidates[0].id);
    }
  });
  return links;
}

export const depthKey = compact;

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

// One row per real player. The tracker can list the same person under two
// spellings of the school ("Arkansas St." / "Arkansas State") or of their name
// ("Reginald Vick, Jr." / "Jr.,Reginald Vick"), so those are merged: the row
// keeps every original (player, team) pair in `variants`, so opening it shows
// all of that player's stats.
export function rosterFor(college) {
  if (!playersByCollegeKey) buildPlayerIndex();
  const keys = new Set([teamKey(college.name), teamKey(college.displayName)]);
  const merged = new Map();
  keys.forEach((k) => {
    const players = playersByCollegeKey.get(k);
    if (!players) return;
    players.forEach((p) => {
      const mergeKey = `${p.division}|${compact(p.player)}`;
      const existing = merged.get(mergeKey);
      if (!existing) {
        merged.set(mergeKey, { ...p, id: mergeKey, categories: new Set(p.categories), variants: [{ player: p.player, team: p.team }] });
        return;
      }
      p.categories.forEach((c) => existing.categories.add(c));
      if (!existing.variants.some((v) => v.player === p.player && v.team === p.team)) existing.variants.push({ player: p.player, team: p.team });
      if (!existing.position && p.position) existing.position = p.position;
      // Prefer the cleanly formatted spelling for display.
      if (/,/.test(existing.player) && !/,/.test(p.player)) {
        existing.player = p.player;
        existing.team = p.team;
      }
    });
  });
  // Same person under a short and a full first name (Sam / Samuel Pickett):
  // same team, same last name, compatible first names, same position.
  const people = [];
  [...merged.values()]
    .sort((a, b) => a.player.localeCompare(b.player))
    .forEach((p) => {
      const w = nameKey(p.player).split(" ");
      const twin = people.find((q) => {
        const x = nameKey(q.player).split(" ");
        return q.division === p.division && x[x.length - 1] === w[w.length - 1] && firstNamesMatch(x[0], w[0]) && (!q.position || !p.position || q.position === p.position);
      });
      if (!twin) {
        people.push(p);
        return;
      }
      p.categories.forEach((c) => twin.categories.add(c));
      p.variants.forEach((v) => twin.variants.push(v));
      if (nameKey(p.player).length > nameKey(twin.player).length) {
        twin.player = p.player;
        twin.team = p.team;
      }
    });
  return people.sort((a, b) => a.player.localeCompare(b.player));
}

// The college behind an Offer Tracker team (matched by school name), so the
// tracker can show its logo. ESPN publishes a light-background and a
// dark-background version of each logo.
let collegeByKey = null;
export function collegeForLabel(label) {
  if (!collegeByKey) {
    collegeByKey = new Map();
    colleges.forEach((c) => {
      collegeByKey.set(teamKey(c.name), c);
      collegeByKey.set(teamKey(c.displayName), c);
    });
  }
  return collegeByKey.get(teamKey(label)) || null;
}

export function logoFor(college, theme) {
  return theme !== "light" ? `https://a.espncdn.com/i/teamlogos/ncaa/500-dark/${college.id}.png` : college.logo;
}

// ------------------------------------------------------------ team stat lines

let statsByTeamKey = null;
function buildStatIndex() {
  statsByTeamKey = new Map();
  const keyOfTeam = new Map();
  realStats.forEach((r) => {
    if ((r.division !== "FBS" && r.division !== "FCS") || r.week !== "total") return;
    if (!keyOfTeam.has(r.team)) keyOfTeam.set(r.team, teamKey(r.team));
    const k = keyOfTeam.get(r.team);
    if (!statsByTeamKey.has(k)) statsByTeamKey.set(k, []);
    statsByTeamKey.get(k).push(r);
  });
}

const STAT_CATEGORIES = ["passing", "rushing", "receiving", "tackling"];

// Season-total stat lines for one college's players from the Pre-Portal
// Tracker data, by category. A player listed twice in a category (two
// spellings of the school or the name) is collapsed to their fuller line.
export function statLinesFor(college) {
  if (!statsByTeamKey) buildStatIndex();
  const keys = new Set([teamKey(college.name), teamKey(college.displayName)]);
  const out = Object.fromEntries(STAT_CATEGORIES.map((c) => [c, new Map()]));
  keys.forEach((k) => {
    (statsByTeamKey.get(k) || []).forEach((r) => {
      const bucket = out[r.category];
      if (!bucket) return;
      const id = compact(r.player);
      const existing = bucket.get(id);
      if (!existing || (r.games || 0) > (existing.games || 0)) bucket.set(id, { ...r, variants: [{ player: r.player, team: r.team }] });
      else if (!existing.variants.some((v) => v.player === r.player && v.team === r.team)) existing.variants.push({ player: r.player, team: r.team });
    });
  });
  return Object.fromEntries(STAT_CATEGORIES.map((c) => [c, [...out[c].values()]]));
}
