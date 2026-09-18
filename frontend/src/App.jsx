import { useState } from "react";
import Dashboard from "./Dashboard.jsx";
import Gridline from "./Gridline.jsx";
import SettingsPage from "./SettingsPage.jsx";
import OfferTracker from "./OfferTracker.jsx";

// The dashboard is the main hub -- everything else (the tracker today,
// more tools later per the plan) is a screen you navigate into and back
// out of, rather than its own separately-hosted page.
export default function App() {
  const [view, setView] = useState({ name: "dashboard" });

  if (view.name === "tracker") {
    return <Gridline onBack={() => setView({ name: "dashboard" })} initialSearch={view.search} />;
  }
  if (view.name === "offers") {
    return <OfferTracker onBack={() => setView({ name: "dashboard" })} />;
  }
  if (view.name === "settings") {
    return <SettingsPage onBack={() => setView({ name: "dashboard" })} />;
  }
  return (
    <Dashboard
      onOpenTracker={(search) => setView({ name: "tracker", search })}
      onOpenOfferTracker={() => setView({ name: "offers" })}
      onOpenSettings={() => setView({ name: "settings" })}
    />
  );
}
