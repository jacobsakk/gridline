// The Big Board's colours, marks and small helpers -- kept apart from bigBoardData.js (which carries the spreadsheet
// reader and the database) so a page that only has to draw a board, like a shared link, stays light.

// A card's colour is the recruit's status on the sheet's key (the cell's fill colour in the workbook).
export const STATUSES = [
  { key: "committed", label: "Committed", color: "#FBAB18", rgb: [0xfb, 0xab, 0x18] },
  { key: "offered", label: "Offered", color: "#B6D7A8", rgb: [0xb6, 0xd7, 0xa8] },
  { key: "offerStatus", label: "Offer status", color: "#A4C2F4", rgb: [0xa4, 0xc2, 0xf4] },
  { key: "recruit", label: "Recruit status", color: "#CCCCCC", rgb: [0xcc, 0xcc, 0xcc] },
  { key: "elsewhere", label: "Committed elsewhere", color: "#EA9999", rgb: [0xea, 0x99, 0x99] },
  { key: "partial", label: "Partial", color: "#B4A7D6", rgb: [0xb4, 0xa7, 0xd6] },
];
export const STATUS_BY_KEY = Object.fromEntries(STATUSES.map((s) => [s.key, s]));

// The A / P / C / R trend emojis on each card (Academics, Production, Character, Recruitability on the sheet).
export const TRENDS = [
  { key: "fire", emoji: "🔥", label: "Fire: this is our type of guy" },
  { key: "heating", emoji: "🌤️", label: "Heating up: trending upward" },
  { key: "cooling", emoji: "🌨️", label: "Cooling down: trending downward" },
  { key: "ice", emoji: "🧊", label: "Ice: not our type of guy" },
];
const TREND_BY_EMOJI = { "🔥": "fire", "🌤": "heating", "🌨": "cooling", "🧊": "ice" };
export const RATING_KEYS = ["A", "P", "C", "R"];

// Markers after a name on the sheet.
export const FLAGS = [
  { key: "snap", marker: "$", label: "Long snap or short snap" },
  { key: "punt", marker: "#", label: "Punt return" },
  { key: "noMidYear", marker: "🚫", label: "Cannot mid-year" },
  { key: "injured", marker: "⛑️", label: "Injured / injury history" },
];
// JUCO board only: a prospect cleared to be brought in on a visit.
export const VISIT_READY = { key: "visitReady", marker: "✅", label: "Points of Contact" };
export const VISITS = [
  { marker: "✈️", label: "Coming on official visit" },
  { marker: "🚗", label: "Has been on unofficial visit" },
  { marker: "🏠", label: "Home visit" },
];

export const nameKey = (name) => String(name || "").toLowerCase().replace(/[^a-z]/g, "");

// Committed players per (non-flex) column and the total -- the sheet's "TOTAL COMMITS" block. A flex
// column repeats players already counted in their own position, so it isn't added in.
export function commitCounts(board) {
  const rows = (board?.columns || [])
    .filter((c) => !/^flex/i.test(c.label))
    .map((c) => ({ label: c.label, count: c.players.filter((p) => p.status === "committed").length }));
  return { rows, total: rows.reduce((sum, r) => sum + r.count, 0) };
}

