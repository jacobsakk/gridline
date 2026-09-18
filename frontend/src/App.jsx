import { useState } from "react";
import Dashboard from "./Dashboard.jsx";
import Gridline from "./Gridline.jsx";
import SettingsPage from "./SettingsPage.jsx";
import OfferTracker from "./OfferTracker.jsx";
import { ConfirmHost } from "./ConfirmDialog.jsx";
import CardTransition, { getTransitionStyle } from "./CardTransition.jsx";

// The dashboard is the main hub -- everything else (the tracker today,
// more tools later per the plan) is a screen you navigate into and back
// out of, rather than its own separately-hosted page.
export default function App() {
  return (
    <>
      <Screens />
      <ConfirmHost />
    </>
  );
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function Screens() {
  const [view, setView] = useState({ name: "dashboard" });
  const [transition, setTransition] = useState(null);
  const toDashboard = () => setView({ name: "dashboard" });

  // Opening a dashboard card plays the grow-into-the-screen transition
  // from that card's position; anything without a card to grow from (or
  // for users who ask for less motion) just switches.
  function open(next, rect, label) {
    const variant = getTransitionStyle();
    if (!rect || variant === "none" || prefersReducedMotion()) setView(next);
    else setTransition({ rect, next, label, variant });
  }

  let screen;
  if (view.name === "tracker") screen = <Gridline onBack={toDashboard} initialSearch={view.search} />;
  else if (view.name === "offers") screen = <OfferTracker onBack={toDashboard} />;
  else if (view.name === "settings") screen = <SettingsPage onBack={toDashboard} />;
  else {
    screen = (
      <Dashboard
        onOpenCard={(key, rect, label) => open({ name: key }, rect, label)}
        onOpenSettings={() => setView({ name: "settings" })}
      />
    );
  }

  return (
    <>
      <div key={view.name} className="screen-enter">{screen}</div>
      {transition && (
        <CardTransition
          rect={transition.rect}
          variant={transition.variant}
          label={transition.label}
          onCovered={() => setView(transition.next)}
          onDone={() => setTransition(null)}
        />
      )}
    </>
  );
}
