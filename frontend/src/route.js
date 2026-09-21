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
