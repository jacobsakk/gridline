import { useEffect, useState } from "react";

// Headshots and school colours for the Studies page, from data/studies/headshots.json (built by
// scraper/studies/headshots.py). It loads on its own the first time a study opens; until then every face is
// just initials, so the table never waits on it.
let loading = null;
export function useStudyPhotos() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    loading ||= Promise.all([import("./data/studies/headshots.json"), import("./data/studies/previous-teams.json")]).then(([h, p]) => ({ ...h.default, prev: p.default }));
    loading.then((d) => live && setData(d)).catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return data;
}

const letters = (text) => String(text || "").toLowerCase().replace(/[^a-z]/g, "");
const SUFFIX = /(jr|sr|ii|iii|iv|v)$/;

// Every ESPN picture that could be this player, best guess first: by name, with the entries whose team matches
// ahead of the rest. ESPN sometimes has two athlete ids for one person and only one carries a picture, so the
// face tries them in order until one loads.
export function headshotUrls(data, name, team) {
  if (!data) return [];
  const full = letters(name);
  const entries = data.byName[full] || data.byName[full.length > 5 ? full.replace(SUFFIX, "") : full] || [];
  const teamKey = letters(team);
  const ordered = [...entries.filter(([, t]) => t === teamKey), ...entries.filter(([, t]) => t !== teamKey)];
  return ordered.map(([id]) => `https://a.espncdn.com/i/headshots/college-football/players/full/${id}.png`);
}

// The team a player was with before the one this row shows: the latest earlier season he spent on a different team
// (from ESPN's season log -- see scraper/studies/previous_teams.py). Blank for a player with one team on record.
const TEAM_ALIAS = { umass: "massachusetts" };
const teamLetters = (t) => {
  const k = letters(t);
  return TEAM_ALIAS[k] || k;
};
const sameTeam = (a, b) => {
  const x = teamLetters(a);
  const y = teamLetters(b);
  return !!x && !!y && (x === y || x.startsWith(y) || y.startsWith(x));
};

export function previousTeamFor(data, name, team, season) {
  if (!data?.prev) return "";
  const full = letters(name);
  const entries = data.byName[full] || data.byName[full.length > 5 ? full.replace(SUFFIX, "") : full] || [];
  const teamKey = letters(team);
  const ordered = [...entries.filter(([, t]) => t === teamKey), ...entries.filter(([, t]) => t !== teamKey)];
  for (const [id] of ordered) {
    const history = data.prev[id];
    if (!history) continue;
    const before = history.find(([y, t]) => y < Number(season) && !sameTeam(t, team));
    if (before) return before[1];
  }
  return "";
}

export function initialsOf(name) {
  const parts = String(name || "").replace(/\b(jr|sr|ii|iii|iv)\b\.?/gi, "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

// ---- school colours that read in both themes
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const luma = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
const mix = (c, target, t) => c.map((v, i) => v + (target[i] - v) * t);

function toHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const sat = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h * 60) + 360) % 360, sat, l];
}
function fromHsl(h, sat, l) {
  const k = (n) => (n + h / 30) % 12, a = sat * Math.min(l, 1 - l);
  const f = (n) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))));
  return [f(0), f(8), f(4)];
}

// A school's colour for light pages is pulled darker if it's pale, and for dark pages pulled lighter if it's
// deep (navy, maroon), so the name reads on either ground while staying recognisably that school.
// A school whose second colour reads better on a dark page than a lightened first one.
const DARK_OVERRIDE = { centralmichigan: "#ffc82e", centralmich: "#ffc82e", cmichigan: "#ffc82e", cmich: "#ffc82e" };

export function teamTone(data, team) {
  const tone = toneFromHex(data?.colors?.[letters(team)]);
  if (tone && DARK_OVERRIDE[letters(team)]) tone["--tc-d"] = DARK_OVERRIDE[letters(team)];
  return tone;
}

// The same two shades from a bare hex colour ("154734" or "#154734").
export function toneFromHex(hex) {
  if (!hex) return null;
  const base = `#${String(hex).replace("#", "").toLowerCase()}`;
  if (!/^#[0-9a-f]{6}$/.test(base)) return null;
  const c = rgb(base);
  let light = c;
  for (let i = 0; i < 8 && luma(light) > 0.42; i++) light = mix(light, [0, 0, 0], 0.15);
  // For dark pages keep the hue but raise the lightness (and the saturation of a murky colour), so navy reads as
  // a bright blue rather than a washed-out grey.
  let dark = c;
  if (luma(c) < 0.5) {
    const [h, sat, lig] = toHsl(c);
    dark = fromHsl(h, Math.min(Math.max(sat, 0.5), 0.65), Math.max(lig, 0.62));
  }
  return { "--tc-l": toHex(light), "--tc-d": toHex(dark) };
}
