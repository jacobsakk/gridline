import { collection, deleteDoc, doc, onSnapshot, setDoc, writeBatch } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { db } from "./firebase";

// A "study" is a one-off, hand-requested data pull (not part of the regular weekly scraper) that lands as
// a static JSON file plus, optionally, a few fields an admin can edit afterward (a Hudl link the study
// couldn't find on its own, say) without needing a code change. New studies just add an entry here and a
// generator script under scraper/studies/.
export const STUDIES = [
  {
    id: "mac-best-by-position",
    title: "MAC's Most Productive, 2023-2026",
    description: "The top 10 at each position in the MAC, kept separately for each season -- who had the best year in the league at that position, that year -- with career film.",
    file: () => import("./data/studies/mac-best-by-position.json"),
    // scoreFormula mirrors GROUPS' score lambdas in scraper/studies/mac_best_by_position.py exactly --
    // each term is one stat's coefficient in that lambda. Keep the two in sync by hand if the formula
    // ever changes; there's no shared source of truth between the Python and this file.
    groups: [
      { key: "QB", label: "Quarterback", stats: [{ key: "games", label: "G" }, { key: "att", label: "Att" }, { key: "yards", label: "Pass Yds" }, { key: "td", label: "Pass TD" }, { key: "int", label: "INT" }, { key: "rushYards", label: "Rush Yds" }, { key: "rushTd", label: "Rush TD" }, { key: "pffGrade", label: "PFF Grade" }], scoreFormula: [{ key: "yards", label: "pass yard", coef: 1 }, { key: "td", label: "pass TD", coef: 25 }, { key: "int", label: "INT thrown", coef: -15 }, { key: "rushYards", label: "rush yard", coef: 1 }, { key: "rushTd", label: "rush TD", coef: 10 }] },
      { key: "RB", label: "Running Back", stats: [{ key: "games", label: "G" }, { key: "att", label: "Att" }, { key: "yards", label: "Rush Yds" }, { key: "td", label: "Rush TD" }, { key: "pffGrade", label: "PFF Grade" }], scoreFormula: [{ key: "yards", label: "rush yard", coef: 1 }, { key: "td", label: "rush TD", coef: 10 }] },
      { key: "WR", label: "Wide Receiver", stats: [{ key: "games", label: "G" }, { key: "rec", label: "Rec" }, { key: "yards", label: "Rec Yds" }, { key: "td", label: "Rec TD" }, { key: "pffGrade", label: "PFF Grade" }], scoreFormula: [{ key: "yards", label: "rec yard", coef: 1 }, { key: "td", label: "rec TD", coef: 10 }] },
      { key: "TE", label: "Tight End", stats: [{ key: "games", label: "G" }, { key: "rec", label: "Rec" }, { key: "yards", label: "Rec Yds" }, { key: "td", label: "Rec TD" }, { key: "pffGrade", label: "PFF Grade" }], scoreFormula: [{ key: "yards", label: "rec yard", coef: 1 }, { key: "td", label: "rec TD", coef: 10 }] },
      // Every group accepts hand-added rows (an admin can add a player the leaderboard missed to any
      // position's top 10 -- see useStudy's manualRows), but OL is the one group with NO computed rows
      // at all: NCAA/ESPN don't carry a stat line for offensive linemen the way they do skill/defensive
      // positions, so every one of its rows is hand-added. It also has no scoreFormula/Score column --
      // there's no formula that makes sense for it -- so it sorts by PFF Grade instead.
      { key: "OL", label: "Offensive Line", manual: true, stats: [{ key: "games", label: "G" }, { key: "snaps", label: "Snaps" }, { key: "pffGrade", label: "PFF Grade" }] },
      { key: "DL", label: "Defensive Line", stats: [{ key: "games", label: "G" }, { key: "total", label: "Tackles" }, { key: "tfl", label: "TFL" }, { key: "sacks", label: "Sacks" }, { key: "pbu", label: "PBU" }, { key: "int", label: "INT" }, { key: "pffGrade", label: "PFF Grade" }], scoreFormula: [{ key: "total", label: "tackle", coef: 1 }, { key: "tfl", label: "TFL", coef: 2 }, { key: "sacks", label: "sack", coef: 6 }] },
      { key: "LB", label: "Linebacker", stats: [{ key: "games", label: "G" }, { key: "total", label: "Tackles" }, { key: "tfl", label: "TFL" }, { key: "sacks", label: "Sacks" }, { key: "pbu", label: "PBU" }, { key: "int", label: "INT" }, { key: "pffGrade", label: "PFF Grade" }], scoreFormula: [{ key: "total", label: "tackle", coef: 1 }, { key: "tfl", label: "TFL", coef: 2 }, { key: "sacks", label: "sack", coef: 6 }, { key: "pbu", label: "PBU", coef: 4 }, { key: "int", label: "INT", coef: 8 }] },
      { key: "CB", label: "Cornerback", stats: [{ key: "games", label: "G" }, { key: "total", label: "Tackles" }, { key: "pbu", label: "PBU" }, { key: "int", label: "INT" }, { key: "pffGrade", label: "PFF Grade" }], scoreFormula: [{ key: "total", label: "tackle", coef: 1 }, { key: "int", label: "INT", coef: 8 }, { key: "pbu", label: "PBU", coef: 4 }] },
      { key: "SAF", label: "Safety", stats: [{ key: "games", label: "G" }, { key: "total", label: "Tackles" }, { key: "tfl", label: "TFL" }, { key: "pbu", label: "PBU" }, { key: "int", label: "INT" }, { key: "pffGrade", label: "PFF Grade" }], scoreFormula: [{ key: "total", label: "tackle", coef: 1 }, { key: "int", label: "INT", coef: 6 }, { key: "pbu", label: "PBU", coef: 3 }, { key: "tfl", label: "TFL", coef: 1.5 }] },
    ],
    note: "Each season's top 10 is ranked separately -- the same player can show up in more than one year. 2026 is the current season in progress -- its numbers are season-to-date, not final, and will keep growing as the season goes on. Data comes from the NCAA's national leaderboards, which only carry a player who cracks roughly the national top 100-150 in a category that season, so a genuinely elite performer is covered but a solid-but-unranked one may be missing -- admins can add that player by hand on any position's tab. Offensive Line has no stat source at all, so that tab is entirely hand-entered. PFF Grade is hand-entered for every position (no source for it at all) -- click a column header to sort by it or by the computed Score. Hudl links are best-effort, found by hand; a blank one just hasn't been found yet -- paste one in directly.",
  },
];

const norm = (t) => String(t ?? "").toUpperCase().trim();

// How PFF spells a MAC team vs. how this study already does (mac_best_by_position.py's own team
// labels) -- only needed for pasted PFF tables, since every other source already uses these labels.
const PFF_TEAM_ALIASES = {
  TOLEDO: "Toledo", BUFFALO: "Buffalo", OHIO: "Ohio", AKRON: "Akron", MASSACHUSETTS: "Massachusetts", UMASS: "Massachusetts",
  "MIAMI OH": "Miami (OH)", "N ILLINOIS": "Northern Illinois", "NORTHERN ILLINOIS": "Northern Illinois",
  "W MICHIGAN": "Western Mich.", "WESTERN MICHIGAN": "Western Mich.", "E MICHIGAN": "Eastern Mich.", "EASTERN MICHIGAN": "Eastern Mich.",
  "BOWL GREEN": "Bowling Green", "BOWLING GREEN": "Bowling Green", "KENT ST": "Kent St.", "KENT STATE": "Kent St.",
  "BALL ST": "Ball St.", "BALL STATE": "Ball St.", "CENT MICHIGAN": "Central Mich.", "C MICHIGAN": "Central Mich.", "CENTRAL MICHIGAN": "Central Mich.", CMU: "Central Mich.",
  "SAC ST": "Sac State", "SAC STATE": "Sac State",
};
function normalizePffTeam(raw) {
  return PFF_TEAM_ALIASES[norm(raw).replace(/\s+/g, " ")] || String(raw || "").trim();
}

// Reads a table copy-pasted straight out of PFF's site -- selecting a table in a browser and pasting
// into a plain textarea comes through tab-separated, same as any spreadsheet copy. Matched by header
// name, not column position, so PFF's extra columns this study doesn't track (Rank, #, Pos, Run, Pass,
// RBLK, PBLK) are simply ignored rather than needing to line up exactly. STATE and HUDL are optional --
// PFF's own table never has them, but a hand-assembled paste (this study's own CSV download, say, or a
// table built from research) can carry them too, so they're picked up when present instead of requiring
// a second pass through every row's cells to add them by hand.
export function parsePffTable(text) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const splitLine = (line) => (line.includes("\t") ? line.split("\t") : line.split(/ {2,}/)).map((c) => c.trim());
  const headerIndex = lines.findIndex((l) => {
    const cells = splitLine(l).map((c) => c.toUpperCase());
    return cells.includes("NAME") && cells.includes("TEAM");
  });
  if (headerIndex < 0) {
    throw Object.assign(new Error("Couldn't find a NAME/TEAM header row -- copy the table's header row along with the data."), { code: "bad-request" });
  }
  const header = splitLine(lines[headerIndex]).map((c) => c.toUpperCase());
  const col = (...names) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const nameCol = col("NAME");
  const teamCol = col("TEAM");
  const snapsCol = col("OFF", "DEF", "SNAPS");
  const gradeCol = col("OFF GRD", "OFF GRADE", "DEF GRD", "DEF GRADE", "GRADE");
  const stateCol = col("STATE", "HOME STATE");
  const hudlCol = col("HUDL", "HUDL LINK");
  const gamesCol = col("G", "GP", "GAMES", "GAMES PLAYED");
  if (nameCol < 0 || teamCol < 0) {
    throw Object.assign(new Error("Couldn't find NAME and TEAM columns in that header row."), { code: "bad-request" });
  }
  return lines
    .slice(headerIndex + 1)
    .map(splitLine)
    .filter((cells) => cells[nameCol])
    .map((cells) => ({
      player: cells[nameCol] || "",
      team: normalizePffTeam(cells[teamCol]),
      snaps: snapsCol >= 0 ? Number(cells[snapsCol]) || 0 : 0,
      pffGrade: gradeCol >= 0 ? Number(cells[gradeCol]) || 0 : 0,
      state: stateCol >= 0 ? (cells[stateCol] || "").toUpperCase() : "",
      hudlLink: hudlCol >= 0 ? cells[hudlCol] || "" : "",
      games: gamesCol >= 0 ? Number(cells[gamesCol]) || 0 : null,
    }));
}

// Loads one study's bundled data, merged with any admin-edited fields (a Hudl link, say) stored in
// Firestore under studyOverrides -- keyed by studyId, so those edits survive the JSON being regenerated,
// as long as a player's name and position group stay the same.
export function useStudy(studyId) {
  const meta = STUDIES.find((s) => s.id === studyId);
  const [data, setData] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [manualRows, setManualRows] = useState({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    setData(null);
    if (!meta) return;
    meta.file().then((m) => live && setData(m.default));
    return () => {
      live = false;
    };
  }, [studyId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const off = onSnapshot(
      collection(db, "studyOverrides"),
      (snap) => {
        const map = {};
        snap.docs.forEach((d) => {
          if (d.id.startsWith(`${studyId}__`)) map[d.id] = d.data();
        });
        setOverrides(map);
        setReady(true);
      },
      () => setReady(true)
    );
    return off;
  }, [studyId]);

  // A "manual" group (see OL above) has no bundled data at all -- its rows live entirely in their own
  // Firestore collection, one doc per player, rather than being a correction layered on top of something
  // scraped. Same studyId-prefixed-id filtering convention as studyOverrides, just a different collection
  // so an admin can add/remove whole rows here without that meaning anything for the correction-only one.
  useEffect(() => {
    const off = onSnapshot(
      collection(db, "studyManualRows"),
      (snap) => {
        const map = {};
        snap.docs.forEach((d) => {
          if (d.id.startsWith(`${studyId}__`)) map[d.id] = { id: d.id, ...d.data() };
        });
        setManualRows(map);
      },
      () => {}
    );
    return off;
  }, [studyId]);

  // Deliberately keyed by group + player only, not season -- the same person's Hudl link is the same link
  // no matter which year's top 5 they show up in, so fixing it once fixes every season's row for them.
  const overrideKey = (group, player) => `${studyId}__${group}__${norm(player)}`;
  // Stat corrections, unlike the above, genuinely differ by season for the same player -- so this key
  // includes the season, and lives in its own doc (the trailing "__stats" keeps it from ever colliding
  // with the season-less key above, even though both live in the same studyOverrides collection).
  const statsOverrideKey = (group, season, player) => `${studyId}__${group}__${season}__${norm(player)}__stats`;

  const groups = useMemo(() => {
    if (!data) return {};
    const out = {};
    Object.entries(data.groups || {}).forEach(([group, bySeason]) => {
      out[group] = {};
      const groupMeta = meta.groups.find((g) => g.key === group);
      Object.entries(bySeason).forEach(([season, players]) => {
        out[group][season] = players
          // A computed row has no doc of its own to delete (it comes straight from the bundled JSON) --
          // "removing" one just means marking it excluded in the same per-season override doc a stat
          // correction already lives in (see excludePlayer below). Unlike a stat fix, this doesn't pull
          // in whoever's 11th -- the JSON only ever carries the already-sliced top 10.
          .filter((p) => !overrides[statsOverrideKey(group, season, p.player)]?.excluded)
          .map((p) => {
            const merged = { ...p, ...overrides[overrideKey(group, p.player)] };
            const statFix = overrides[statsOverrideKey(group, season, p.player)];
            if (statFix?.totals) {
              merged.totals = { ...merged.totals, ...statFix.totals };
              // Re-derive the score from the corrected totals using the same linear formula
              // scraper/studies/mac_best_by_position.py's GROUPS[key].score lambda encodes (see
              // studiesData.js's scoreFormula comment) -- otherwise a corrected stat would leave a stale
              // score (and ranking) sitting next to it.
              if (groupMeta?.scoreFormula) {
                merged.score = Math.round(groupMeta.scoreFormula.reduce((sum, t) => sum + (merged.totals[t.key] ?? 0) * t.coef, 0) * 10) / 10;
              }
            }
            return merged;
          });
      });
    });
    // Hand-added rows merge additively into EVERY group -- a player the leaderboard missed, added
    // alongside the computed top 10 for any position, not just OL. OL is just the extreme case: it has
    // no computed rows at all (no key in data.groups to begin with), so its rows are ENTIRELY these.
    // Wrapped under the same {totals: {...}} shape a real row has (whatever stat keys that group's own
    // `stats` config lists) purely so the page's existing generic column/sort/StatCell code -- all
    // written against r.totals[key] -- needs no manual-vs-real branching of its own; it just works. A
    // row carries its own `id` (a real computed row never does) -- that's what marks it editable/
    // removable on the page, not which group it's in.
    meta.groups.forEach((g) => {
      (data.seasons || []).forEach((season) => {
        const seasonKey = String(season);
        const extra = Object.values(manualRows)
          .filter((r) => r.group === g.key && String(r.season) === seasonKey)
          .map((r) => {
            const totals = {};
            (g.stats || []).forEach((s) => {
              totals[s.key] = r[s.key] ?? 0;
            });
            const row = { id: r.id, player: r.player || "", team: r.team || "", state: r.state || "", hudlLink: r.hudlLink || "", pffLink: r.pffLink || "", totals };
            if (g.scoreFormula) row.score = Math.round(g.scoreFormula.reduce((sum, t) => sum + (totals[t.key] ?? 0) * t.coef, 0) * 10) / 10;
            return row;
          });
        if (!extra.length) return;
        out[g.key] = out[g.key] || {};
        out[g.key][seasonKey] = [...(out[g.key][seasonKey] || []), ...extra];
      });
    });
    return out;
  }, [data, overrides, manualRows]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    meta,
    ready: ready && !!data,
    generatedAt: data?.generatedAt || "",
    seasons: data?.seasons || [],
    groups,
    async saveField(group, player, fields) {
      await setDoc(doc(db, "studyOverrides", overrideKey(group, player)), fields, { merge: true });
    },
    // Fixes one stat on one player's one-season row (a data error from whichever source fed that
    // season -- see mac_best_by_position.py). Merges onto any other stat already fixed for this same
    // player/season/group, rather than replacing the whole totals override outright.
    async saveStat(group, season, player, statKey, value) {
      const key = statsOverrideKey(group, season, player);
      const existingTotals = overrides[key]?.totals || {};
      await setDoc(doc(db, "studyOverrides", key), { totals: { ...existingTotals, [statKey]: value } }, { merge: true });
    },
    // A whole new hand-added player for any group -- blank, filled in afterward one cell at a time (same
    // click-to-edit cells as everywhere else), initialized with exactly that group's own stat fields
    // (games/pffGrade for OL, games/att/yards/td/int/rushYards/rushTd for QB, and so on) so its columns
    // line up with whatever the rest of that group's table already shows. id is studyId-prefixed so the
    // subscription above picks it up; otherwise opaque.
    async addManualRow(group, season) {
      const groupMeta = meta.groups.find((g) => g.key === group);
      const id = `${studyId}__${group}__${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const statDefaults = {};
      (groupMeta?.stats || []).forEach((s) => {
        statDefaults[s.key] = 0;
      });
      await setDoc(doc(db, "studyManualRows", id), {
        group, season: Number(season), player: "", team: "", state: "", hudlLink: "", pffLink: "",
        ...statDefaults,
        createdAt: new Date().toISOString(),
      });
      return id;
    },
    async updateManualRow(id, fields) {
      await setDoc(doc(db, "studyManualRows", id), fields, { merge: true });
    },
    async removeManualRow(id) {
      await deleteDoc(doc(db, "studyManualRows", id));
    },
    // Removing a computed row (one with no manual doc of its own) -- hides it from this one position's
    // one season rather than deleting anything, since there's nothing to delete; see the filter above.
    async excludePlayer(group, season, player) {
      await setDoc(doc(db, "studyOverrides", statsOverrideKey(group, season, player)), { excluded: true }, { merge: true });
    },
    // Bulk-loads a pasted PFF table (see parsePffTable) into ANY group's rows for one season -- meant to
    // be re-run every time PFF's grades refresh, not just once. A pasted name is correlated against
    // whoever's already shown for this group/season first: a real (computed) row gets its grade written
    // through the same per-season override doc saveStat already uses (a correction, not a new row,
    // exactly like fixing any other stat by hand); a hand-added row gets its own doc updated in place.
    // A name that matches neither only becomes a brand new row for a manual group (OL, which has no
    // leaderboard at all so pasting IS how a row gets added) -- every other group just skips an
    // unmatched name, since pasting a grade there is meant to correct who's already on the list, not
    // grow it. Nothing already on the list is ever removed by this.
    async pasteTable(group, season, text) {
      const groupMeta = meta.groups.find((g) => g.key === group);
      const rows = parsePffTable(text);
      const seasonKey = String(season);
      const existingManualByName = new Map();
      Object.values(manualRows).forEach((r) => {
        if (r.group === group && String(r.season) === seasonKey) existingManualByName.set(norm(r.player), r);
      });
      const computedByName = new Map();
      (groups[group]?.[seasonKey] || []).forEach((r) => {
        if (!r.id) computedByName.set(norm(r.player), r);
      });
      const batch = writeBatch(db);
      let created = 0;
      let updated = 0;
      let skipped = 0;
      rows.forEach((row) => {
        if (!row.player) return;
        const key = norm(row.player);
        const manual = existingManualByName.get(key);
        const computed = !manual ? computedByName.get(key) : null;
        if (manual) {
          const fields = { team: row.team, snaps: row.snaps, pffGrade: row.pffGrade };
          // State/Hudl/Games only fill in if this row doesn't already have one -- never overwrite a
          // value someone already corrected by hand just because this particular paste happened to
          // omit it (games is null, not 0, when the pasted table had no G/GP column at all).
          if (!manual.state && row.state) fields.state = row.state;
          if (!manual.hudlLink && row.hudlLink) fields.hudlLink = row.hudlLink;
          if (!manual.games && row.games != null) fields.games = row.games;
          batch.set(doc(db, "studyManualRows", manual.id), fields, { merge: true });
          updated += 1;
        } else if (computed) {
          const statsKey = statsOverrideKey(group, season, computed.player);
          const existingTotals = overrides[statsKey]?.totals || {};
          batch.set(doc(db, "studyOverrides", statsKey), { totals: { ...existingTotals, pffGrade: row.pffGrade } }, { merge: true });
          const fieldFix = {};
          if (!computed.state && row.state) fieldFix.state = row.state;
          if (!computed.hudlLink && row.hudlLink) fieldFix.hudlLink = row.hudlLink;
          if (Object.keys(fieldFix).length) {
            batch.set(doc(db, "studyOverrides", overrideKey(group, computed.player)), fieldFix, { merge: true });
          }
          updated += 1;
        } else if (groupMeta?.manual) {
          const id = `${studyId}__${group}__${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}${Math.random().toString(36).slice(2, 5)}`;
          batch.set(doc(db, "studyManualRows", id), {
            group, season: Number(season), player: row.player, team: row.team, state: row.state || "", hudlLink: row.hudlLink || "", pffLink: "",
            games: row.games ?? 0, snaps: row.snaps, pffGrade: row.pffGrade, createdAt: new Date().toISOString(),
          });
          created += 1;
        } else {
          skipped += 1;
        }
      });
      await batch.commit();
      return { created, updated, skipped, total: rows.length };
    },
  };
}
