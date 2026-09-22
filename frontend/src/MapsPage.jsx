import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Loader2, Pencil, Plus, Printer, RotateCcw, Search, Trash2 } from "lucide-react";
import { BackButton, HomeButton } from "./HomeButton.jsx";
import { ThemeSwitcher, useTheme } from "./theme.jsx";
import { confirmAction } from "./ConfirmDialog.jsx";
import { useAreaCoachMap } from "./areaCoachData.js";
import { useBack } from "./route.js";
import { STATE_LIST, loadCountyMap } from "./mapData.js";

const UNASSIGNED_FILL = "#8a8f87";
const PALETTE = ["#E0447B", "#7B2FE0", "#2FB6B0", "#3FA34D", "#3E6FE0", "#2E1A6B", "#E08A2E", "#7A5230", "#E0521E", "#E0D02E", "#1E9E8A", "#B33F8C"];

const control = { background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 6, padding: "8px 11px", fontSize: 13, fontFamily: "inherit" };
const ghostBtn = { ...control, cursor: "pointer", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 7 };
const norm = (t) => String(t ?? "").toLowerCase();

// The lower 48's bounds -- the map opens here; Alaska, Hawaii and the rest are still on the map (at their
// real position and distance), just a pan/zoom away, via the state picker or the search box.
const CONTINENTAL_BOUNDS = [[24.4, -125.2], [49.5, -66.5]];

function nextColor(coaches) {
  const used = new Set(coaches.map((c) => c.color));
  return PALETTE.find((c) => !used.has(c)) || PALETTE[coaches.length % PALETTE.length];
}

// --------------------------------------------------------------------- legend

function CoachRow({ coach, active, admin, onActivate, onSave, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(coach.name);
  const [color, setColor] = useState(coach.color);
  if (editing) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 4px" }}>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 22, height: 22, padding: 0, border: "none", background: "none", cursor: "pointer", flexShrink: 0 }} />
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus style={{ ...control, flex: 1, padding: "4px 7px", fontSize: 13 }} onKeyDown={(e) => e.key === "Escape" && setEditing(false)} />
        <button
          onClick={() => {
            if (name.trim()) onSave({ name: name.trim(), color });
            setEditing(false);
          }}
          aria-label="Save coach"
          style={{ background: "none", border: "none", color: "var(--success)", cursor: "pointer", lineHeight: 0 }}
        >
          <Pencil size={13} />
        </button>
      </div>
    );
  }
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", borderRadius: 5, cursor: "pointer",
        background: active ? "var(--accent-hover-tint)" : "transparent", border: active ? "1px solid var(--accent)" : "1px solid transparent",
      }}
      onClick={onActivate}
      title={`Make ${coach.name} the active coach for painting`}
    >
      <span style={{ width: 14, height: 14, borderRadius: 3, background: coach.color, flexShrink: 0, border: "1px solid rgba(0,0,0,0.25)" }} />
      <span style={{ flex: 1, fontSize: 13.5, fontWeight: active ? 700 : 500, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{coach.name}</span>
      {admin && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
            aria-label={`Edit ${coach.name}`}
            style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", lineHeight: 0, flexShrink: 0 }}
          >
            <Pencil size={12} />
          </button>
          <button
            onClick={async (e) => {
              e.stopPropagation();
              const ok = await confirmAction({ title: `Remove ${coach.name}?`, message: "Any county already assigned to them shows as unassigned afterward.", confirmLabel: "Remove" });
              if (ok) onRemove();
            }}
            aria-label={`Remove ${coach.name}`}
            style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", lineHeight: 0, flexShrink: 0 }}
          >
            <Trash2 size={12} />
          </button>
        </>
      )}
    </div>
  );
}

function Legend({ coaches, activeId, setActiveId, admin, onAdd, onSave, onRemove }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  return (
    <div className="hs-no-print" style={{ position: "absolute", top: 12, left: 12, zIndex: 5, background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 10px 8px", width: 220, maxHeight: "calc(100% - 24px)", overflowY: "auto", boxShadow: "0 4px 14px rgba(0,0,0,0.25)" }}>
      <div className="oswald" style={{ fontSize: 14, letterSpacing: "0.04em", marginBottom: 6, color: "var(--text-primary)" }}>COACHES</div>
      <div
        onClick={() => setActiveId((v) => (v === "" ? null : ""))}
        title="Make the eraser active -- click counties or Select a state to clear them"
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", borderRadius: 5, cursor: "pointer", marginBottom: 2, background: activeId === "" ? "var(--accent-hover-tint)" : "transparent", border: activeId === "" ? "1px solid var(--accent)" : "1px solid transparent" }}
      >
        <span style={{ width: 14, height: 14, borderRadius: 3, background: "transparent", border: "1px dashed var(--text-faint)", flexShrink: 0 }} />
        <span style={{ fontSize: 13.5, fontWeight: activeId === "" ? 700 : 500, color: "var(--text-muted)" }}>Unassigned (eraser)</span>
      </div>
      {coaches.map((c) => (
        <CoachRow key={c.id} coach={c} active={activeId === c.id} admin={admin} onActivate={() => setActiveId((v) => (v === c.id ? null : c.id))} onSave={(fields) => onSave(c.id, fields)} onRemove={() => onRemove(c.id)} />
      ))}
      {admin && (
        adding ? (
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Coach name"
              autoFocus
              style={{ ...control, flex: 1, padding: "5px 7px", fontSize: 13 }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) {
                  onAdd(name.trim());
                  setName("");
                  setAdding(false);
                } else if (e.key === "Escape") setAdding(false);
              }}
            />
            <button
              onClick={() => {
                if (name.trim()) onAdd(name.trim());
                setName("");
                setAdding(false);
              }}
              aria-label="Add coach"
              style={{ ...ghostBtn, padding: "5px 9px" }}
            >
              Add
            </button>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} style={{ ...ghostBtn, width: "100%", justifyContent: "center", marginTop: 6, padding: "6px 8px", fontSize: 12.5 }}>
            <Plus size={13} /> Add coach
          </button>
        )
      )}
      {!admin && <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 6, lineHeight: 1.4 }}>Only admins can repaint the map.</div>}
      {admin && <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 6, lineHeight: 1.4 }}>Click a coach above, then click counties on the map or Select a whole state.</div>}
    </div>
  );
}

// -------------------------------------------------------------------- sidebar

function StateRow({ state, counties, assignments, coachById, active, expanded, onToggle, onSelect, admin, activeId, highlightCounty }) {
  const assignedHere = counties.filter((c) => assignments[c.id]).length;
  return (
    <div style={{ borderBottom: "1px solid var(--border-subtle)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 4px" }}>
        {counties.length > 1 ? (
          <button onClick={onToggle} aria-label={expanded ? `Collapse ${state.name}` : `Expand ${state.name}`} style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", padding: 0, lineHeight: 0, width: 14 }}>
            {expanded ? "⌄" : "›"}
          </button>
        ) : (
          <span style={{ width: 14 }} />
        )}
        <span style={{ flex: 1, fontStyle: "italic", fontSize: 13.5, color: active ? "var(--accent)" : "var(--text-primary)", fontWeight: active ? 700 : 400 }}>
          {state.name} <span style={{ fontStyle: "normal", color: "var(--text-faint)", fontSize: 11.5 }}>({assignedHere}/{counties.length})</span>
        </span>
        {admin && (
          <button onClick={onSelect} disabled={activeId === null} title={activeId === null ? "Click a coach (or the eraser) first" : `Assign every county in ${state.name} to the active coach`} style={{ ...ghostBtn, padding: "4px 10px", fontSize: 12, opacity: activeId === null ? 0.45 : 1, cursor: activeId === null ? "default" : "pointer" }}>
            Select
          </button>
        )}
      </div>
      {expanded && (
        <div style={{ paddingLeft: 22, paddingBottom: 6, display: "flex", flexDirection: "column", gap: 2 }}>
          {counties.map((c) => {
            const coach = coachById.get(assignments[c.id]);
            return (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, padding: "1px 0", background: highlightCounty === c.id ? "var(--accent-hover-tint)" : "transparent" }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: coach?.color || UNASSIGNED_FILL, flexShrink: 0, opacity: coach ? 1 : 0.4 }} />
                <span style={{ color: "var(--text-secondary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.properties.name}</span>
                <span style={{ color: "var(--text-faint)", fontSize: 11 }}>{coach?.name || "—"}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------- page

export default function MapsPage({ onBack: toDashboard, session }) {
  const [theme, setTheme] = useTheme();
  const back = useBack(toDashboard);
  const admin = !!session?.profile?.admin;
  const area = useAreaCoachMap({ isAdmin: admin });
  const coachById = useMemo(() => new Map(area.coaches.map((c) => [c.id, c])), [area.coaches]);

  const [geo, setGeo] = useState(null);
  useEffect(() => {
    let live = true;
    loadCountyMap().then((d) => live && setGeo(d));
    return () => {
      live = false;
    };
  }, []);

  const [activeId, setActiveId] = useState(null); // null = none active, "" = eraser, else a coach id
  const [filterState, setFilterState] = useState("");
  const [filterCoach, setFilterCoach] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(() => new Set());
  const [flash, setFlash] = useState("");

  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const countyLayerRef = useRef(null);
  const stateLayerRef = useRef(null);
  const live = useRef({});
  live.current = { admin, activeId, assignments: area.assignments, coachById, paintCounties: area.paintCounties, filterState, filterCoach };

  const styleFor = (feature) => {
    const { assignments, coachById: byId, filterState: fs, filterCoach: fc } = live.current;
    const coach = byId.get(assignments[feature.id]);
    const dimmed = (fs && feature.properties.stateFips !== fs) || (fc && assignments[feature.id] !== fc);
    return {
      fillColor: coach ? coach.color : UNASSIGNED_FILL,
      fillOpacity: dimmed ? 0.12 : 0.85,
      color: "#fff",
      weight: 0.6,
      opacity: dimmed ? 0.3 : 1,
    };
  };

  // Built once the boundary data has loaded; painted in place afterward (setStyle on ~3,200 features, not a
  // full teardown/rebuild) whenever coaches, assignments or the filters change.
  useEffect(() => {
    if (!geo || !mapDivRef.current || mapRef.current) return;
    const map = L.map(mapDivRef.current, { attributionControl: false, zoomControl: false, minZoom: 2, maxZoom: 10 }).fitBounds(CONTINENTAL_BOUNDS);
    L.control.zoom({ position: "topright" }).addTo(map);
    mapRef.current = map;

    const countyLayer = L.geoJSON(geo.counties, {
      style: styleFor,
      onEachFeature: (feature, layer) => {
        layer.bindTooltip(`${feature.properties.name}, ${feature.properties.stateAbbr}`, { sticky: true });
        layer.on({
          mouseover: () => layer.setStyle({ weight: 2, color: "#1a1206" }),
          mouseout: () => layer.setStyle(styleFor(feature)),
          click: () => {
            const { admin: isAdmin, activeId: id, paintCounties: paint } = live.current;
            if (!isAdmin || id === null) return;
            paint([feature.id], id || "");
          },
        });
      },
    }).addTo(map);
    countyLayerRef.current = countyLayer;

    stateLayerRef.current = L.geoJSON(geo.states, { style: { fill: false, color: "#1a1206", weight: 1.4, opacity: 0.6, interactive: false } }).addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [geo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Repaint (never rebuild) when what a county should look like changes.
  useEffect(() => {
    countyLayerRef.current?.eachLayer((layer) => layer.setStyle(styleFor(layer.feature)));
  }, [area.assignments, area.coaches, filterState, filterCoach]); // eslint-disable-line react-hooks/exhaustive-deps

  function resetView() {
    mapRef.current?.fitBounds(CONTINENTAL_BOUNDS);
  }
  function flyToState(fips) {
    if (!geo) return;
    const layer = countyLayerRef.current?.getLayers().filter((l) => l.feature.properties.stateFips === fips);
    if (layer?.length) mapRef.current?.fitBounds(L.geoJSON({ type: "FeatureCollection", features: layer.map((l) => l.feature) }).getBounds(), { maxZoom: 8 });
  }
  function flyToCounty(id) {
    const layer = countyLayerRef.current?.getLayers().find((l) => l.feature.id === id);
    if (layer) mapRef.current?.fitBounds(layer.getBounds().pad(0.6), { maxZoom: 9 });
  }

  const searchResults = useMemo(() => {
    const q = norm(search.trim());
    if (!q || !geo) return [];
    const out = [];
    STATE_LIST.forEach((s) => {
      if (norm(s.name).includes(q)) out.push({ kind: "state", key: s.fips, label: s.name, fips: s.fips });
    });
    geo.counties.forEach((c) => {
      if (out.length >= 25) return;
      if (norm(c.properties.name).includes(q)) out.push({ kind: "county", key: c.id, label: `${c.properties.name}, ${c.properties.stateAbbr}`, fips: c.properties.stateFips, id: c.id });
    });
    return out.slice(0, 25);
  }, [search, geo]);

  async function selectState(fips, countyList) {
    if (activeId === null) return;
    await area.paintCounties(countyList.map((c) => c.id), activeId || "");
    setFlash(`Assigned all ${countyList.length} counties in ${STATE_LIST.find((s) => s.fips === fips)?.name}.`);
    setTimeout(() => setFlash(""), 3000);
  }

  const notReady = !geo || !area.ready;

  return (
    <div className="app-shell hs-shell" data-theme={theme} style={{ display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg-page)", color: "var(--text-primary)", fontFamily: "'Century Gothic', 'Jost', 'Helvetica Neue', Arial, sans-serif" }}>
      <div className="app-header hs-no-print" style={{ flexShrink: 0, position: "relative", padding: "20px var(--gutter) 16px" }}>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 3, background: "linear-gradient(90deg, var(--gold), var(--maroon))" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {back?.fromTrail && <BackButton label={back.label} onClick={back.go} />}
            <HomeButton onHome={toDashboard} />
            <h1 className="oswald app-title" style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Maps</h1>
          </div>
          <ThemeSwitcher theme={theme} onChange={setTheme} />
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "14px var(--gutter) var(--gutter)", gap: 12 }}>
        <div className="hs-no-print oswald" style={{ fontSize: 18, letterSpacing: "0.04em" }}>AREA COACH MAP</div>
        <div className="hs-no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={filterState} onChange={(e) => { setFilterState(e.target.value); if (e.target.value) flyToState(e.target.value); }} style={{ ...control, cursor: "pointer" }} aria-label="Filter by state">
            <option value="">All States</option>
            {STATE_LIST.map((s) => <option key={s.fips} value={s.fips}>{s.name}</option>)}
          </select>
          <select value={filterCoach} onChange={(e) => setFilterCoach(e.target.value)} style={{ ...control, cursor: "pointer" }} aria-label="Filter by coach">
            <option value="">All Coaches</option>
            {area.coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {flash && <span style={{ fontSize: 12.5, color: "var(--success)" }}>{flash}</span>}
          <button onClick={() => window.print()} style={{ ...ghostBtn, marginLeft: "auto" }}><Printer size={14} /> Print</button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 12 }}>
          <div style={{ flex: 1, minHeight: 0, position: "relative", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", background: "#1b1f1a" }}>
            <div ref={mapDivRef} style={{ position: "absolute", inset: 0 }} />
            {notReady && (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-page)", color: "var(--text-faint)", gap: 8 }}>
                <Loader2 size={16} className="spin" /> Loading the map…
              </div>
            )}
            {!notReady && <Legend coaches={area.coaches} activeId={activeId} setActiveId={setActiveId} admin={admin} onAdd={(name) => area.addCoach(name, nextColor(area.coaches))} onSave={(id, fields) => area.updateCoach(id, fields)} onRemove={(id) => area.removeCoach(id)} />}
            <button
              className="hs-no-print"
              onClick={resetView}
              title="Reset view"
              aria-label="Reset view"
              style={{ position: "absolute", top: 92, right: 10, zIndex: 5, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", background: "#fff", border: "2px solid rgba(0,0,0,0.2)", borderRadius: 4, cursor: "pointer", color: "#333" }}
            >
              <RotateCcw size={15} />
            </button>
          </div>

          <div className="hs-no-print" style={{ width: 300, flexShrink: 0, display: "flex", flexDirection: "column", border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-panel)", overflow: "hidden" }}>
            <div style={{ position: "relative", padding: 10, borderBottom: "1px solid var(--border)" }}>
              <Search size={14} color="var(--text-faint)" style={{ position: "absolute", left: 20, top: "50%", transform: "translateY(-50%)" }} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search counties or states…" style={{ ...control, width: "100%", paddingLeft: 30 }} />
              {searchResults.length > 0 && (
                <div style={{ position: "absolute", left: 10, right: 10, top: "100%", zIndex: 6, background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, marginTop: 4, maxHeight: 260, overflowY: "auto", boxShadow: "0 8px 20px rgba(0,0,0,0.3)" }}>
                  {searchResults.map((r) => (
                    <button
                      key={`${r.kind}-${r.key}`}
                      onClick={() => {
                        if (r.kind === "state") flyToState(r.fips);
                        else {
                          flyToCounty(r.id);
                          setExpanded((s) => new Set(s).add(r.fips));
                        }
                        setSearch("");
                      }}
                      style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderBottom: "1px solid var(--border-subtle)", padding: "7px 10px", fontSize: 13, cursor: "pointer", color: "var(--text-primary)" }}
                    >
                      {r.label} {r.kind === "state" && <span style={{ color: "var(--text-faint)", fontSize: 11 }}>(state)</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "0 10px" }}>
              {notReady ? (
                <div style={{ padding: 16, color: "var(--text-faint)", fontSize: 13 }}>Loading…</div>
              ) : (
                STATE_LIST.map((s) => (
                  <StateRow
                    key={s.fips}
                    state={s}
                    counties={geo.byState[s.fips] || []}
                    assignments={area.assignments}
                    coachById={coachById}
                    admin={admin}
                    activeId={activeId}
                    active={filterState === s.fips}
                    expanded={expanded.has(s.fips)}
                    onToggle={() =>
                      setExpanded((set) => {
                        const next = new Set(set);
                        if (next.has(s.fips)) next.delete(s.fips);
                        else next.add(s.fips);
                        return next;
                      })
                    }
                    onSelect={() => selectState(s.fips, geo.byState[s.fips] || [])}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
