import { useState } from "react";
import Dashboard from "./Dashboard.jsx";
import Gridline from "./Gridline.jsx";
import SettingsPage from "./SettingsPage.jsx";
import OfferTracker from "./OfferTracker.jsx";
import Colleges from "./Colleges.jsx";
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

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function Screens({ session }) {
  const [view, setView] = useState({ name: "dashboard" });
  const [transition, setTransition] = useState(null);
  const toDashboard = () => setView({ name: "dashboard" });

  // Opening a dashboard card plays the wipe; for users who ask for less
  // motion it just switches.
  function open(next, label) {
    if (prefersReducedMotion()) setView(next);
    else setTransition({ next, label });
  }

  let screen;
  if (view.name === "tracker") screen = <Gridline onBack={toDashboard} initialSearch={view.search} />;
  else if (view.name === "offers") screen = <OfferTracker onBack={toDashboard} />;
  else if (view.name === "colleges") screen = <Colleges onBack={toDashboard} />;
  else if (view.name === "settings") screen = <SettingsPage onBack={toDashboard} session={session} />;
  else {
    screen = (
      <Dashboard
        onOpenCard={(key, label) => open({ name: key }, label)}
        onOpenSettings={() => setView({ name: "settings" })}
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
          onCovered={() => setView(transition.next)}
          onDone={() => setTransition(null)}
        />
      )}
    </>
  );
}
