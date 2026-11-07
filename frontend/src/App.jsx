import { Suspense, lazy } from "react";
import { useRoute } from "./route.js";

// Two separate programs share this page. A study's or board's share link (#/shared/<code>) opens with no sign-in and
// shows only that one thing, so it loads only what it needs; everything else is the signed-in app. Neither is fetched
// until it's wanted, which keeps a shared link quick to open on a phone.
const SharedStudyPage = lazy(() => import("./SharedStudyPage.jsx"));
const MainApp = lazy(() => import("./MainApp.jsx"));

const loading = <div style={{ padding: 40, textAlign: "center", color: "#888", fontSize: 14, fontFamily: "sans-serif" }}>Loading…</div>;

export default function App() {
  const route = useRoute();
  return <Suspense fallback={loading}>{route[0] === "shared" ? <SharedStudyPage token={route[1]} /> : <MainApp />}</Suspense>;
}
