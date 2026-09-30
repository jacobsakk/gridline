import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Download, ExternalLink, Link2, Loader2, X } from "lucide-react";
import { BackButton, HomeButton } from "./HomeButton.jsx";
import { ThemeSwitcher, useTheme } from "./theme.jsx";
import { useBack, initialSubRoute, setSubRoute } from "./route.js";
import { STUDIES, useStudy } from "./studiesData.js";

const control = { background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 6, padding: "8px 11px", fontSize: 13, fontFamily: "inherit" };
const ghostBtn = { ...control, cursor: "pointer", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 7 };

function downloadCsv(rows, columns, filename) {
  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [columns.map((c) => escape(c.label)).join(",")];
  rows.forEach((r) => lines.push(columns.map((c) => escape(c.get(r))).join(",")));
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Shared editable-link cell -- used for both the Hudl column (film) and the PFF column (grades/reports).
// `field` is which key on the row this cell reads/writes ("hudlLink" or "pffLink").
function LinkCell({ row, field, label, placeholder, admin, onSave }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(row[field] || "");
  if (editing) {
    return (
      <div style={{ display: "flex", gap: 5 }}>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          style={{ ...control, padding: "4px 7px", fontSize: 12.5, width: 190 }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onSave(value.trim());
              setEditing(false);
            }
            if (e.key === "Escape") {
              setValue(row[field] || "");
              setEditing(false);
            }
          }}
          onBlur={() => {
            if (value.trim() !== (row[field] || "")) onSave(value.trim());
            setEditing(false);
          }}
        />
      </div>
    );
  }
  if (row[field]) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <a href={row[field]} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 4 }}>
          {label} <ExternalLink size={12} />
        </a>
        {admin && (
          <button onClick={() => setEditing(true)} title={`Change this ${label} link`} aria-label={`Change ${label} link for ${row.player}`} style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", lineHeight: 0 }}>
            <Link2 size={12} />
          </button>
        )}
      </span>
    );
  }
  return admin ? (
    <button onClick={() => setEditing(true)} style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", fontSize: 12.5, textDecoration: "underline", padding: 0 }}>
      Add link
    </button>
  ) : (
    <span style={{ color: "var(--text-faint)" }}>—</span>
  );
}

// Shows exactly how a row's score was computed -- the same formula as GROUPS' score lambdas in
// scraper/studies/mac_best_by_position.py, walked term by term against this player's actual stats,
// so "why is this score X" never requires reading the Python.
function ScoreExplainer({ row, group, onClose }) {
  const terms = group.scoreFormula.map((t) => {
    const value = row.totals[t.key] ?? 0;
    return { ...t, value, contribution: Math.round(value * t.coef * 10) / 10 };
  });
  const sign = (n) => (n < 0 ? "−" : "+");
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, height: "auto", zIndex: 100, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{ position: "relative", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 10, width: 380, maxWidth: "100%", padding: "20px 22px", color: "var(--text-primary)", boxShadow: "0 18px 48px rgba(0,0,0,0.5)" }}
      >
        <button onClick={onClose} aria-label="Close" style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", lineHeight: 0 }}>
          <X size={16} />
        </button>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{row.player}</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>{row.team} · {row.season} · {group.label}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13.5 }}>
          {terms.map((t, i) => (
            <div key={t.key} style={{ display: "flex", justifyContent: "space-between", gap: 10 }} className="tabular">
              <span style={{ color: "var(--text-secondary)" }}>
                {i > 0 && <span style={{ color: "var(--text-faint)", marginRight: 6 }}>{sign(t.coef)}</span>}
                {t.value} {t.label}{Math.abs(t.value) === 1 ? "" : "s"} {t.coef !== 1 && t.coef !== -1 ? `× ${Math.abs(t.coef)}` : ""}
              </span>
              <span style={{ color: "var(--text-primary)" }}>{sign(i === 0 ? 1 : t.coef) === "−" ? "−" : ""}{Math.abs(t.contribution)}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, borderTop: "1px solid var(--border-subtle)", paddingTop: 8, marginTop: 4, fontWeight: 700 }} className="tabular">
            <span>Score</span>
            <span style={{ color: "var(--accent)" }}>{row.score}</span>
          </div>
        </div>
        <p style={{ margin: "14px 0 0", fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.5 }}>
          "Most productive" for this position is a stat-weighted formula, not a stat the NCAA reports directly -- it's meant to roughly rank production, not to be an official rating.
        </p>
      </div>
    </div>
  );
}

// Home state (high school, not college) -- plain text, not a link, so simpler than LinkCell: click to
// edit, blank shows a faint dash for a non-admin or an "Add" prompt for an admin.
function StateCell({ row, admin, onSave }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(row.state || "");
  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value.toUpperCase().slice(0, 20))}
        placeholder="e.g. OH"
        style={{ ...control, padding: "4px 7px", fontSize: 12.5, width: 60 }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            onSave(value.trim());
            setEditing(false);
          }
          if (e.key === "Escape") {
            setValue(row.state || "");
            setEditing(false);
          }
        }}
        onBlur={() => {
          if (value.trim() !== (row.state || "")) onSave(value.trim());
          setEditing(false);
        }}
      />
    );
  }
  if (row.state) {
    return (
      <span
        onClick={() => admin && setEditing(true)}
        title={admin ? "Click to change" : undefined}
        style={{ cursor: admin ? "pointer" : "default" }}
      >
        {row.state}
      </span>
    );
  }
  return admin ? (
    <button onClick={() => setEditing(true)} style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", fontSize: 12.5, textDecoration: "underline", padding: 0 }}>
      Add
    </button>
  ) : (
    <span style={{ color: "var(--text-faint)" }}>—</span>
  );
}

function StudyDetail({ studyId, admin, onBack }) {
  const study = useStudy(studyId);
  const [initial] = useState(initialSubRoute);
  const [group, setGroup] = useState(() => study.meta.groups.some((g) => g.key === initial[1]) ? initial[1] : study.meta.groups[0].key);
  const [season, setSeason] = useState(() => (/^\d{4}$/.test(initial[2]) ? Number(initial[2]) : null));
  const [sort, setSort] = useState({ key: "score", dir: "desc" });
  const [explainRow, setExplainRow] = useState(null);

  const activeGroup = study.meta.groups.find((g) => g.key === group);
  const seasons = study.seasons;
  const activeSeason = seasons.includes(season) ? season : seasons[seasons.length - 1];
  const rows = study.groups[group]?.[String(activeSeason)] || [];
  useEffect(() => {
    if (activeSeason != null) setSubRoute("studies", [studyId, group, activeSeason]);
  }, [studyId, group, activeSeason]);
  const sorted = useMemo(() => {
    const get = (r) => (sort.key === "player" || sort.key === "team" || sort.key === "state" ? String(r[sort.key] ?? "") : sort.key === "score" ? r.score : r.totals[sort.key] ?? 0);
    return [...rows].sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      const cmp = typeof av === "string" ? av.localeCompare(bv) : av - bv;
      return sort.dir === "desc" ? -cmp : cmp;
    });
  }, [rows, sort]);

  const columns = useMemo(
    () => [
      { key: "player", label: "Player", get: (r) => r.player },
      { key: "team", label: "Team", get: (r) => r.team },
      { key: "state", label: "State", get: (r) => r.state || "" },
      ...activeGroup.stats.map((s) => ({ key: s.key, label: s.label, get: (r) => r.totals[s.key] ?? 0 })),
      { key: "score", label: "Score", get: (r) => r.score },
      { key: "hudlLink", label: "Hudl", get: (r) => r.hudlLink || "" },
      { key: "pffLink", label: "PFF", get: (r) => r.pffLink || "" },
    ],
    [activeGroup]
  );

  function sortBy(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "asc" }));
  }
  const arrow = (key) => (sort.key === key ? (sort.dir === "desc" ? " ▼" : " ▲") : "");
  const th = { textAlign: "left", padding: "9px 10px", fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.03em", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap", position: "sticky", top: 0, background: "var(--bg-surface)", zIndex: 1 };
  const td = { padding: "7px 10px", fontSize: 13.5, color: "var(--text-secondary)", borderTop: "1px solid var(--border-subtle)", whiteSpace: "nowrap" };

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "16px var(--gutter) var(--gutter)", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="oswald" style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{study.meta.title}</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-muted)", maxWidth: 720, lineHeight: 1.5 }}>{study.meta.description}</p>
        </div>
        <button onClick={() => downloadCsv(sorted, columns, `${study.meta.id}-${group}-${activeSeason}.csv`)} style={ghostBtn}><Download size={14} /> Download</button>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {study.meta.groups.map((g) => {
            const isActive = g.key === group;
            const count = study.groups[g.key]?.[String(activeSeason)]?.length ?? 0;
            return (
              <button
                key={g.key}
                onClick={() => setGroup(g.key)}
                style={{
                  display: "flex", alignItems: "center", gap: 7, borderRadius: 999, padding: "7px 14px", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
                  background: isActive ? "var(--accent-bg)" : "var(--bg-surface)", border: `1px solid ${isActive ? "var(--accent)" : "var(--border)"}`,
                  color: isActive ? "var(--accent)" : "var(--text-secondary)",
                }}
              >
                {g.label}
                {study.ready && <span className="tabular" style={{ fontSize: 11.5, opacity: 0.8 }}>{count}</span>}
              </button>
            );
          })}
        </div>
        {seasons.length > 0 && (
          <div style={{ display: "flex", gap: 4, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 3 }}>
            {seasons.map((y) => (
              <button
                key={y}
                onClick={() => setSeason(y)}
                style={{
                  border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
                  background: y === activeSeason ? "var(--accent)" : "transparent", color: y === activeSeason ? "var(--bg-page)" : "var(--text-muted)",
                }}
                className="tabular"
              >
                {y}
              </button>
            ))}
          </div>
        )}
      </div>

      {!study.ready ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <Loader2 size={16} className="spin" /> Loading…
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} style={th} onClick={() => sortBy(c.key === "hudlLink" || c.key === "pffLink" ? "player" : c.key)}>
                    {c.label}{c.key !== "hudlLink" && c.key !== "pffLink" ? arrow(c.key) : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={columns.length} style={{ ...td, textAlign: "center", color: "var(--text-faint)", padding: 32 }}>Nobody qualified for this position in {activeSeason}.</td>
                </tr>
              )}
              {sorted.map((r, i) => (
                <tr key={r.player} style={{ background: i % 2 === 0 ? "var(--bg-panel)" : "var(--bg-page)" }}>
                  <td style={{ ...td, fontWeight: 700, color: "var(--text-primary)" }}>{r.player}</td>
                  <td style={td}>{r.team}</td>
                  <td style={td}><StateCell row={r} admin={admin} onSave={(state) => study.saveField(group, r.player, { state })} /></td>
                  {activeGroup.stats.map((s) => (
                    <td key={s.key} style={td} className="tabular">{r.totals[s.key] ?? 0}</td>
                  ))}
                  <td style={{ ...td, fontWeight: 700, color: "var(--accent)" }} className="tabular">
                    <button
                      onClick={() => setExplainRow(r)}
                      title="Why this score?"
                      aria-label={`Why does ${r.player} have a score of ${r.score}?`}
                      style={{ background: "none", border: "none", padding: 0, font: "inherit", fontWeight: 700, color: "var(--accent)", cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 3 }}
                    >
                      {r.score}
                    </button>
                  </td>
                  <td style={td}><LinkCell row={r} field="hudlLink" label="Film" placeholder="Paste a Hudl link…" admin={admin} onSave={(url) => study.saveField(group, r.player, { hudlLink: url })} /></td>
                  <td style={td}><LinkCell row={r} field="pffLink" label="PFF" placeholder="Paste a PFF link…" admin={admin} onSave={(url) => study.saveField(group, r.player, { pffLink: url })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {study.meta.note && <p style={{ margin: 0, fontSize: 12, color: "var(--text-faint)", lineHeight: 1.5 }}>{study.meta.note}</p>}
      {explainRow && <ScoreExplainer row={explainRow} group={activeGroup} onClose={() => setExplainRow(null)} />}
    </div>
  );
}

export default function StudiesPage({ onBack: toDashboard, session }) {
  const [theme, setTheme] = useTheme();
  const back = useBack(toDashboard);
  const admin = !!session?.profile?.admin;
  const [initial] = useState(initialSubRoute);
  const [openId, setOpenId] = useState(() => (STUDIES.some((s) => s.id === initial[0]) ? initial[0] : null));

  function openStudy(id) {
    setOpenId(id);
    setSubRoute("studies", [id]);
  }
  function closeStudy() {
    setOpenId(null);
    setSubRoute("studies", []);
  }

  return (
    <div className="app-shell hs-shell" data-theme={theme} style={{ display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg-page)", color: "var(--text-primary)", fontFamily: "'Century Gothic', 'Jost', 'Helvetica Neue', Arial, sans-serif" }}>
      <div className="app-header" style={{ flexShrink: 0, position: "relative", padding: "20px var(--gutter) 16px" }}>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 3, background: "linear-gradient(90deg, var(--gold), var(--maroon))" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {openId ? <BackButton label="Studies" onClick={closeStudy} /> : back.fromTrail && <BackButton label={back.label} onClick={back.go} />}
            <HomeButton onHome={toDashboard} />
            <h1 className="oswald app-title" style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Studies</h1>
          </div>
          <ThemeSwitcher theme={theme} onChange={setTheme} />
        </div>
      </div>

      {openId ? (
        <StudyDetail studyId={openId} admin={admin} onBack={closeStudy} />
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "24px var(--gutter) var(--gutter)" }}>
          <p style={{ margin: "0 0 18px", fontSize: 13.5, color: "var(--text-muted)", maxWidth: 640, lineHeight: 1.6 }}>
            Ask for a study on any data already in the site, and it shows up here as its own spreadsheet.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
            {STUDIES.map((s) => (
              <button
                key={s.id}
                onClick={() => openStudy(s.id)}
                style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8, textAlign: "left", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 10, padding: 18, cursor: "pointer" }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                  <span className="oswald" style={{ fontSize: 15, fontWeight: 700, letterSpacing: "0.01em" }}>{s.title}</span>
                  <ChevronRight size={16} color="var(--text-faint)" />
                </div>
                <span style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>{s.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
