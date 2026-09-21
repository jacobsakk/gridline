import { useState } from "react";
import { navigate, useRoute } from "./route.js";
import Dashboard from "./Dashboard.jsx";
import Gridline from "./Gridline.jsx";
import SettingsPage from "./SettingsPage.jsx";
import OfferTracker from "./OfferTracker.jsx";
import Colleges from "./Colleges.jsx";
import HsGameUpdate from "./HsGameUpdate.jsx";
import { ConfirmHost } from "./ConfirmDialog.jsx";
import CardTransition from "./CardTransition.jsx";
import LoginGate from "./LoginGate.jsx";

// The dashboard is the main hub -- everything else (the tracker today,
// more tools later per the plan) is a screen you navigate into and back
// out of, rather than its own separately-hosted page.
export default function App() {
  return (
    <>
      <LoginGate>{(session) => <Screens session={session} />}</LoginGate>
      <ConfirmHost />
    </>
  );
}

const SCREENS = new Set(["tracker", "offers", "colleges", "hs", "settings"]);

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function Screens({ session }) {
  // Which screen you're on lives in the address (#/offers ...), so a refresh stays put.
  const route = useRoute();
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
      <div key={view.name} className="screen-enter">{screen}</div>
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
