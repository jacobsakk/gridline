import { useEffect, useState } from "react";

// The Pre-Portal stats are about 17 MB of data. They load the first time a screen that needs them opens, instead
// of with the app, so the login and dashboard stay quick on a phone. REAL_STATS is filled in place once loaded.
export const REAL_STATS = [];

let loading = null;
export function loadRealStats() {
  loading ||= import("./data/real-stats.json").then((m) => {
    if (!REAL_STATS.length) REAL_STATS.push(...m.default);
    return REAL_STATS;
  });
  return loading;
}

// true once the stats are loaded (starts the load if nothing has yet)
export function useRealStatsReady() {
  const [ready, setReady] = useState(REAL_STATS.length > 0);
  useEffect(() => {
    let live = true;
    loadRealStats()
      .then(() => live && setReady(true))
      .catch((err) => console.error("Couldn't load the stats data", err));
    return () => {
      live = false;
    };
  }, []);
  return ready;
}
