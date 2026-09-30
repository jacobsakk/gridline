import { collection, doc, onSnapshot, setDoc } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { db } from "./firebase";

// A "study" is a one-off, hand-requested data pull (not part of the regular weekly scraper) that lands as
// a static JSON file plus, optionally, a few fields an admin can edit afterward (a Hudl link the study
// couldn't find on its own, say) without needing a code change. New studies just add an entry here and a
// generator script under scraper/studies/.
export const STUDIES = [
  {
    id: "mac-best-by-position",
    title: "MAC's Most Productive, 2023-2025",
    description: "The top 5 at each position in the MAC, kept separately for each season -- who had the best year in the league at that position, that year -- with career film.",
    file: () => import("./data/studies/mac-best-by-position.json"),
    // scoreFormula mirrors GROUPS' score lambdas in scraper/studies/mac_best_by_position.py exactly --
    // each term is one stat's coefficient in that lambda. Keep the two in sync by hand if the formula
    // ever changes; there's no shared source of truth between the Python and this file.
    groups: [
      { key: "QB", label: "Quarterback", stats: [{ key: "games", label: "G" }, { key: "att", label: "Att" }, { key: "yards", label: "Pass Yds" }, { key: "td", label: "Pass TD" }, { key: "int", label: "INT" }], scoreFormula: [{ key: "yards", label: "pass yard", coef: 1 }, { key: "td", label: "pass TD", coef: 25 }, { key: "int", label: "INT thrown", coef: -15 }] },
      { key: "RB", label: "Running Back", stats: [{ key: "games", label: "G" }, { key: "att", label: "Att" }, { key: "yards", label: "Rush Yds" }, { key: "td", label: "Rush TD" }], scoreFormula: [{ key: "yards", label: "rush yard", coef: 1 }, { key: "td", label: "rush TD", coef: 10 }] },
      { key: "WR", label: "Wide Receiver", stats: [{ key: "games", label: "G" }, { key: "rec", label: "Rec" }, { key: "yards", label: "Rec Yds" }, { key: "td", label: "Rec TD" }], scoreFormula: [{ key: "yards", label: "rec yard", coef: 1 }, { key: "td", label: "rec TD", coef: 10 }] },
      { key: "TE", label: "Tight End", stats: [{ key: "games", label: "G" }, { key: "rec", label: "Rec" }, { key: "yards", label: "Rec Yds" }, { key: "td", label: "Rec TD" }], scoreFormula: [{ key: "yards", label: "rec yard", coef: 1 }, { key: "td", label: "rec TD", coef: 10 }] },
      { key: "DL", label: "Defensive Line", stats: [{ key: "games", label: "G" }, { key: "total", label: "Tackles" }, { key: "tfl", label: "TFL" }, { key: "sacks", label: "Sacks" }, { key: "pbu", label: "PBU" }, { key: "int", label: "INT" }], scoreFormula: [{ key: "total", label: "tackle", coef: 1 }, { key: "tfl", label: "TFL", coef: 2 }, { key: "sacks", label: "sack", coef: 6 }] },
      { key: "LB", label: "Linebacker", stats: [{ key: "games", label: "G" }, { key: "total", label: "Tackles" }, { key: "tfl", label: "TFL" }, { key: "sacks", label: "Sacks" }, { key: "pbu", label: "PBU" }, { key: "int", label: "INT" }], scoreFormula: [{ key: "total", label: "tackle", coef: 1 }, { key: "tfl", label: "TFL", coef: 2 }, { key: "sacks", label: "sack", coef: 6 }, { key: "pbu", label: "PBU", coef: 4 }, { key: "int", label: "INT", coef: 8 }] },
      { key: "CB", label: "Cornerback", stats: [{ key: "games", label: "G" }, { key: "total", label: "Tackles" }, { key: "pbu", label: "PBU" }, { key: "int", label: "INT" }], scoreFormula: [{ key: "total", label: "tackle", coef: 1 }, { key: "int", label: "INT", coef: 8 }, { key: "pbu", label: "PBU", coef: 4 }] },
      { key: "SAF", label: "Safety", stats: [{ key: "games", label: "G" }, { key: "total", label: "Tackles" }, { key: "tfl", label: "TFL" }, { key: "pbu", label: "PBU" }, { key: "int", label: "INT" }], scoreFormula: [{ key: "total", label: "tackle", coef: 1 }, { key: "int", label: "INT", coef: 6 }, { key: "pbu", label: "PBU", coef: 3 }, { key: "tfl", label: "TFL", coef: 1.5 }] },
    ],
    note: "Each season's top 5 is ranked separately -- the same player can show up in more than one year. Data comes from the NCAA's national leaderboards, which only carry a player who cracks roughly the national top 100-150 in a category that season, so a genuinely elite performer is covered but a solid-but-unranked one may be missing. Hudl links are best-effort, found by hand; a blank one just hasn't been found yet -- paste one in directly.",
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

  // Deliberately keyed by group + player only, not season -- the same person's Hudl link is the same link
  // no matter which year's top 5 they show up in, so fixing it once fixes every season's row for them.
  const overrideKey = (group, player) => `${studyId}__${group}__${norm(player)}`;

  const groups = useMemo(() => {
    if (!data) return {};
    const out = {};
    Object.entries(data.groups || {}).forEach(([group, bySeason]) => {
      out[group] = {};
      Object.entries(bySeason).forEach(([season, players]) => {
        out[group][season] = players.map((p) => ({ ...p, ...overrides[overrideKey(group, p.player)] }));
      });
    });
    return out;
  }, [data, overrides]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    meta,
    ready: ready && !!data,
    generatedAt: data?.generatedAt || "",
    seasons: data?.seasons || [],
    groups,
    async saveField(group, player, fields) {
      await setDoc(doc(db, "studyOverrides", overrideKey(group, player)), fields, { merge: true });
    },
  };
}
