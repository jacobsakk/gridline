import { Suspense, lazy, useEffect, useState } from "react";
import { navigate, restorePendingScroll, useRoute } from "./route.js";
import Dashboard from "./Dashboard.jsx";
const Gridline = lazy(() => import("./Gridline.jsx"));
const SettingsPage = lazy(() => import("./SettingsPage.jsx"));
const OfferTracker = lazy(() => import("./OfferTracker.jsx"));
const Colleges = lazy(() => import("./Colleges.jsx"));
const HsGameUpdate = lazy(() => import("./HsGameUpdate.jsx"));
const RosterPage = lazy(() => import("./RosterPage.jsx"));
const StudiesPage = lazy(() => import("./StudiesPage.jsx"));
const BigBoard = lazy(() => import("./BigBoard.jsx"));
const ReportsPage = lazy(() => import("./ReportsPage.jsx"));
import { ConfirmHost } from "./ConfirmDialog.jsx";
import CardTransition from "./CardTransition.jsx";
import LoginGate from "./LoginGate.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";

// The dashboard is the main hub -- everything else (the tracker today,
// more tools later per the plan) is a screen you navigate into and back
// out of, rather than its own separately-hosted page.
export default function MainApp() {
  return (
    <>
      <LoginGate>{(session) => <Screens session={session} />}</LoginGate>
      <ConfirmHost />
    </>
  );
}

// Each screen is fetched when it's first opened, so the first page (and a shared link) loads only what it needs.
function Loading() {
  return <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)", fontSize: 14 }}>Loading…</div>;
}

const SCREENS = new Set(["tracker", "offers", "colleges", "hs", "roster", "studies", "bigboard", "reports", "settings"]);

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function Screens({ session }) {
  // Which screen you're on lives in the address (#/offers ...), so a refresh stays put.
  const route = useRoute();
  // coming back to a screen from a link: put the page where it was
  useEffect(() => {
    restorePendingScroll();
  }, [route[0]]); // eslint-disable-line react-hooks/exhaustive-deps
  const view = { name: SCREENS.has(route[0]) ? route[0] : "dashboard" };
  const [transition, setTransition] = useState(null);
  const toDashboard = () => navigate([]);
  const goTo = (name) => navigate([name]);

  // Opening a dashboard card plays the wipe; for users who ask for less
  // motion it just switches.
  function open(next, label) {
    if (prefersReducedMotion()) goTo(next.name);
    else setTransition({ next, label });
  }

  let screen;
  if (view.name === "tracker") screen = <Gridline onBack={toDashboard} />;
  else if (view.name === "offers") screen = <OfferTracker onBack={toDashboard} />;
  else if (view.name === "colleges") screen = <Colleges onBack={toDashboard} />;
  else if (view.name === "hs") screen = <HsGameUpdate onBack={toDashboard} />;
  else if (view.name === "roster") screen = <RosterPage onBack={toDashboard} session={session} />;
  else if (view.name === "studies") screen = <StudiesPage onBack={toDashboard} session={session} />;
  else if (view.name === "bigboard") screen = <BigBoard onBack={toDashboard} session={session} />;
  else if (view.name === "reports") screen = <ReportsPage onBack={toDashboard} session={session} />;
  else if (view.name === "settings") screen = <SettingsPage onBack={toDashboard} session={session} />;
  else {
    screen = (
      <Dashboard
        onOpenCard={(key, label) => open({ name: key }, label)}
        onOpenSettings={() => goTo("settings")}
        session={session}
      />
    );
  }

  return (
    <>
      <div key={view.name} className="screen-enter"><ErrorBoundary key={view.name}><Suspense fallback={<Loading />}>{screen}</Suspense></ErrorBoundary></div>
      {transition && (
        <CardTransition
          label={transition.label}
          onCovered={() => goTo(transition.next.name)}
          onDone={() => setTransition(null)}
        />
      )}
    </>
  );
}
