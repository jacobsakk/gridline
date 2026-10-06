import { CATEGORIES, DATA } from "./Gridline.jsx";

const norm = (t) => String(t ?? "").toLowerCase().replace(/[^a-z]/g, "");

// A transfer's position is typed free-text, not constrained to the stat source's own position lists,
// so an unrecognized one just searches every category rather than finding nothing.
function categoriesForPosition(position) {
  const pos = String(position || "").toUpperCase().trim();
  const keys = Object.entries(CATEGORIES)
    .filter(([, c]) => c.positions.includes(pos))
    .map(([key]) => key);
  return keys.length ? keys : Object.keys(CATEGORIES);
}

// Best-effort only: a hand-typed college ("Eastern Kentucky") rarely matches the stat source's own team
// string exactly ("Eastern Ky."), so this never rules a name match out -- it only breaks a tie when more
// than one player nationally shares the same name.
function teamLooksRelated(college, team) {
  if (!college || !team) return false;
  const a = norm(college);
  const b = norm(team);
  return a.includes(b) || b.includes(a);
}

// This season's real, scraped "total" stats for a transfer, by exact normalized name -- one result per
// category the player has a row in (a dual-threat back matches both rushing and receiving). No source
// covers every player nationally (see the MAC study's own note on this), so a missing result just means
// not found, not an error.
export function findTransferStats(name, college, position) {
  if (!name) return [];
  const targetName = norm(name);
  return categoriesForPosition(position)
    .map((category) => {
      const hits = DATA.filter((r) => r.week === "total" && r.category === category && norm(r.player) === targetName);
      if (hits.length === 0) return null;
      const row = hits.length === 1 ? hits[0] : hits.find((r) => teamLooksRelated(college, r.team)) || hits[0];
      return { category, row };
    })
    .filter(Boolean);
}

export function formatStatLine({ category, row }) {
  const meta = CATEGORIES[category];
  return `${meta.label}: ${meta.columns.map((c) => `${c.label} ${row[c.key] ?? 0}`).join(" · ")}`;
}
