import { useEffect, useState } from "react";

// The site lives on GitHub Pages, which only serves real files, so screens are
// addressed with the part after "#": /gridline/#/offers/2027/MAC. Refreshing,
// bookmarking, or pressing the browser's back button all land on the same
// screen without any server support.

export function parseHash(hash = typeof window === "undefined" ? "" : window.location.hash) {
  return hash
    .replace(/^#\/?/, "")
    .split("?")[0]
    .split("/")
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
}

const toHash = (segments) => `#/${segments.filter((s) => s !== null && s !== undefined && s !== "").map((s) => encodeURIComponent(s)).join("/")}`;

// Moves to another screen (adds a history entry, so the back button returns).
export function navigate(segments) {
  const next = toHash(segments);
  if (window.location.hash !== next) window.location.hash = next;
}

// Records where you are inside a screen -- the open tab, class year, team --
// without adding history entries.
export function setSubRoute(section, parts) {
  const next = toHash([section, ...parts]);
  if (window.location.hash !== next) window.history.replaceState(null, "", next);
}

// What follows the section in the address, read once when a screen opens.
export const initialSubRoute = () => parseHash().slice(1);

export function useRoute() {
  const [segments, setSegments] = useState(() => parseHash());
  useEffect(() => {
    const onChange = () => setSegments(parseHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return segments;
}

// ------------------------------------------------------------ return trail
//
// Moving from one screen to another (Roster Management -> a player's stats, Offer Tracker -> a college...) leaves
// a trail, so the back button on the screen you land on says where you came from and returns to the exact
// spot: same season, same open player, same scroll position. Going back to a screen already on the trail
// pops it; landing on the dashboard clears it.

const SECTION_LABELS = { tracker: "Pre-Portal Tracker", offers: "Offer Tracker", colleges: "Colleges", hs: "HS Game Update", roster: "Roster Management", settings: "Settings" };
const trail = [];
let pendingScroll = null;

const hashOf = (url) => (String(url).includes("#") ? `#${String(url).split("#").slice(1).join("#")}` : "");

// The main scrolling area of whatever screen is showing: the biggest element that overflows.
function scroller() {
  let best = null;
  let bestArea = 0;
  document.querySelectorAll("div, main, section").forEach((el) => {
    if (el.scrollHeight <= el.clientHeight + 4) return;
    if (el.closest("[style*='position: fixed']")) return; // a pop-up scrolling on its own, not the page behind it
    const overflow = getComputedStyle(el).overflowY;
    if (overflow !== "auto" && overflow !== "scroll") return;
    const area = el.clientWidth * el.clientHeight;
    if (area > bestArea) {
      best = el;
      bestArea = area;
    }
  });
  return best;
}
const currentScroll = () => (scroller()?.scrollTop ?? window.scrollY) || 0;

if (typeof window !== "undefined") {
  // registered when this file loads, so it runs before any screen re-renders for the new address
  window.addEventListener("hashchange", (e) => {
    const from = parseHash(hashOf(e.oldURL))[0];
    const to = parseHash()[0];
    if (!to) {
      trail.length = 0;
      return;
    }
    if (from === to || !SECTION_LABELS[from]) return;
    const at = trail.map((t) => t.section).lastIndexOf(to);
    if (at >= 0) {
      pendingScroll = trail[at].scroll;
      trail.length = at;
      return;
    }
    trail.push({ section: from, hash: hashOf(e.oldURL), scroll: currentScroll() });
  });
}

// The back button for a screen: where you came from if you followed a link here, else the dashboard.
export function useBack(toDashboard) {
  useRoute();
  const top = trail[trail.length - 1];
  if (!top || top.section === parseHash()[0]) return { label: "Dashboard", go: toDashboard, fromTrail: false };
  return { label: SECTION_LABELS[top.section], go: () => { window.location.hash = top.hash; }, fromTrail: true };
}

// After going back, put the page where it was (waits for the screen's data to load, up to a few seconds).
export function restorePendingScroll() {
  if (pendingScroll == null) return;
  const y = pendingScroll;
  pendingScroll = null;
  if (!y) return;
  let tries = 0;
  const timer = setInterval(() => {
    const el = scroller();
    tries += 1;
    if (el && el.scrollHeight - el.clientHeight >= y - 4) {
      el.scrollTop = y;
      clearInterval(timer);
    } else if (tries > 40) clearInterval(timer);
  }, 100);
}
