import React from "react";
import ReactDOM from "react-dom/client";
import "./theme.css";
import App from "./App.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Installed-app support: cache the app's files so it opens fast, and opens offline. Production builds only.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => console.warn("Offline support unavailable", err));
  });
}
