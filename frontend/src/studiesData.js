import { collection, deleteDoc, doc, onSnapshot, setDoc } from "firebase/firestore";
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
        out[group][season] = players.map((p) => {
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
  };
}
