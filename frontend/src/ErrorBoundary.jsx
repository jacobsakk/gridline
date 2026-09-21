import { Component } from "react";

// A crash in one screen shows a message and a way out instead of a blank page.
// Keyed by the screen in App, so moving to another screen clears it.
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Screen crashed:", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="app-shell" data-theme={document.documentElement.dataset.theme || "dark"} style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "var(--bg-page)", color: "var(--text-primary)" }}>
        <div style={{ maxWidth: 440, textAlign: "center", lineHeight: 1.5 }}>
          <h1 className="oswald" style={{ fontSize: 24, margin: "0 0 8px" }}>Something went wrong on this page</h1>
          <p style={{ margin: "0 0 16px", color: "var(--text-muted)", fontSize: 14 }}>{String(this.state.error?.message || this.state.error)}</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button onClick={() => window.location.reload()} style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 6, padding: "9px 16px", fontSize: 14, cursor: "pointer" }}>Reload</button>
            <button onClick={() => { window.location.hash = "#/"; this.setState({ error: null }); }} style={{ background: "var(--accent-bg)", border: "1px solid var(--accent)", color: "var(--accent)", borderRadius: 6, padding: "9px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Back to dashboard</button>
          </div>
        </div>
      </div>
    );
  }
}
