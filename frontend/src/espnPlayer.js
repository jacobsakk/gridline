import { COLLEGES, teamKey } from "./collegeData.js";

// ESPN pages and pictures for a player. A stat row that came from ESPN carries the athlete's id at the end of its
// own id ("real-fbs-tackling-espn-4685575"); rows from other sources (NCAA, NAIA, conference sites) have none.
export const espnIdFromRow = (row) => /-espn-(\d+)$/.exec(row?.id || "")?.[1] || "";
export const espnHeadshotUrl = (id) => (id ? `https://a.espncdn.com/i/headshots/college-football/players/full/${id}.png` : "");
export const espnProfileUrl = (id) => `https://www.espn.com/college-football/player/_/id/${id}`;
export const espnSearchUrl = (name) => `https://www.espn.com/search/_/q/${encodeURIComponent(`${name} football`)}`;

let colorByTeam = null;
// A school's ESPN colour (hex, no #) from the college list, whichever way the stats spell its name.
export function colorForTeam(team) {
  if (!colorByTeam) {
    colorByTeam = new Map();
    COLLEGES.forEach((c) => {
      if (!c.color) return;
      [c.name, c.displayName].forEach((n) => colorByTeam.set(teamKey(n), c.color));
    });
  }
  return colorByTeam.get(teamKey(team)) || "";
}
