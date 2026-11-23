import { Suspense, lazy, useEffect, useState } from "react";
import { useRoute } from "./route.js";

// Two separate programs share this page. A study's or board's share link (#/shared/<code>) opens with no sign-in and
// shows only that one thing, so it loads only what it needs; everything else is the signed-in app. Neither is fetched
// until it's wanted, which keeps a shared link quick to open on a phone.
const SharedStudyPage = lazy(() => import("./SharedStudyPage.jsx"));
const MainApp = lazy(() => import("./MainApp.jsx"));

const loading = <div style={{ padding: 40, textAlign: "center", color: "#888", fontSize: 14, fontFamily: "sans-serif" }}>Loading…</div>;

// A tab (or the installed app) that stays open keeps running the version it loaded, so edits made in it after a
// newer version went out use old code. This checks the site's front page for a newer build -- when the tab is
// looked at again and every 10 minutes -- and offers a one-tap refresh.
const runningBuild = () => document.querySelector('script[type="module"][src*="assets/index-"]')?.getAttribute("src") || "";

function UpdateNotice() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (!import.meta.env.PROD) return undefined;
    const mine = runningBuild();
    if (!mine) return undefined;
    let live = true;
    async function check() {
      try {
        const res = await fetch(`./index.html?v=${Date.now()}`, { cache: "no-store" });
        const latest = /src="([^"]*assets\/index-[^"]+\.js)"/.exec(await res.text())?.[1];
        if (live && latest && latest !== mine) setStale(true);
      } catch {
        // offline -- try again later
      }
    }
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(check, 10 * 60 * 1000);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, []);
  if (!stale) return null;
  return (
    <div role="status" style={{ position: "fixed", left: 12, right: 12, bottom: 12, zIndex: 200, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
      <div style={{ pointerEvents: "auto", display: "flex", alignItems: "center", gap: 12, background: "var(--bg-panel, #222)", color: "var(--text-primary, #fff)", border: "1px solid var(--accent, #888)", borderRadius: 8, padding: "10px 14px", fontSize: 13.5, boxShadow: "0 8px 28px rgba(0,0,0,0.4)" }}>
        A new version of the site is ready. Refresh before adding players so your changes save correctly.
        <button onClick={() => window.location.reload()} style={{ background: "var(--accent-bg, #333)", color: "var(--accent, #fff)", border: "1px solid var(--accent, #888)", borderRadius: 5, padding: "6px 12px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
          Refresh
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const route = useRoute();
  return (
    <>
      <Suspense fallback={loading}>{route[0] === "shared" ? <SharedStudyPage token={route[1]} /> : <MainApp />}</Suspense>
      <UpdateNotice />
    </>
  );
}
