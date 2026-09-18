import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { COLLEGES, fetchSchedule } from "./collegeData.js";

const SEASON = 2026;
const CMU = COLLEGES.find((c) => c.name === "Central Michigan");
// A game that kicked off within this window still counts as "today's game"
// rather than as finished.
const GAME_WINDOW_MS = 4 * 60 * 60 * 1000;

function useNow(intervalMs) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function splitDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

const two = (n) => String(n).padStart(2, "0");

// The dark-background version of a logo on dark, falling back to the standard
// one if ESPN doesn't publish a dark variant for that school.
function Logo({ game, size, theme }) {
  const dark = theme !== "light" && game.id ? `https://a.espncdn.com/i/teamlogos/ncaa/500-dark/${game.id}.png` : null;
  return (
    <img
      key={dark || game.logo}
      src={dark || game.logo}
      alt=""
      style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }}
      onError={(e) => {
        if (dark && e.currentTarget.src !== game.logo) e.currentTarget.src = game.logo;
        else e.currentTarget.style.visibility = "hidden";
      }}
    />
  );
}

function Countdown({ game }) {
  const now = useNow(1000);
  const kickoff = new Date(game.date).getTime();
  const left = kickoff - now;
  const live = left <= 0 && now < kickoff + GAME_WINDOW_MS;
  const parts = splitDuration(left);

  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--text-faint)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>Next game in</div>
      {live ? (
        <div className="oswald" style={{ fontSize: 34, fontWeight: 700, color: "var(--accent)" }}>Game time</div>
      ) : (
        <div style={{ display: "flex", gap: 10 }} aria-live="off">
          {[["days", "Days"], ["hours", "Hrs"], ["minutes", "Min"], ["seconds", "Sec"]].map(([key, label]) => (
            <div key={key} style={{ textAlign: "center", minWidth: 54 }}>
              <div
                className="oswald tabular"
                style={{
                  fontSize: 34, fontWeight: 700, lineHeight: 1, padding: "8px 6px", borderRadius: 8,
                  background: "var(--bg-panel)", border: "1px solid var(--border)", color: "var(--text-primary)",
                }}
              >
                {key === "days" ? parts[key] : two(parts[key])}
              </div>
              <div style={{ fontSize: 10.5, color: "var(--text-faint)", letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 5 }}>{label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GameCard({ game, isNext, past, cardRef, theme }) {
  const d = new Date(game.date);
  const result =
    game.completed && game.myScore != null ? (
      <span className="tabular" style={{ fontWeight: 700, color: game.won ? "var(--success)" : game.lost ? "var(--danger-text)" : "var(--text-muted)" }}>
        {game.won ? "W" : game.lost ? "L" : "T"} {game.myScore}-{game.oppScore}
      </span>
    ) : (
      <span className="tabular" style={{ color: "var(--text-muted)" }}>
        {game.timeValid ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Time TBD"}
      </span>
    );
  return (
    <div
      ref={cardRef}
      style={{
        flex: "0 0 auto", width: 158, scrollSnapAlign: "start", borderRadius: 10, padding: "12px 14px",
        background: isNext ? "var(--accent-bg)" : "var(--bg-panel)", border: `1px solid ${isNext ? "var(--accent)" : "var(--border)"}`,
        opacity: past ? 0.72 : 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, textAlign: "center",
        position: "relative",
      }}
    >
      {isNext && (
        <span style={{ position: "absolute", top: -9, background: "var(--gold)", color: "#1A1206", fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", padding: "2px 8px", borderRadius: 999 }}>
          NEXT
        </span>
      )}
      <div className="tabular" style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>
        {d.toLocaleDateString([], { month: "short", day: "numeric" })}
      </div>
      <Logo game={game} size={44} theme={theme} />
      <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.2, minHeight: 32, display: "flex", alignItems: "center" }}>
        {game.rank && <span style={{ color: "var(--accent)", marginRight: 4 }}>#{game.rank}</span>}
        {game.name}
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-faint)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
        {game.away ? "Away" : game.neutral ? "Neutral" : "Home"}
      </div>
      <div style={{ fontSize: 12.5 }}>{result}</div>
    </div>
  );
}

export default function HubSchedule({ theme }) {
  const [games, setGames] = useState(null);
  const [failed, setFailed] = useState(false);
  const scroller = useRef(null);
  const nextRef = useRef(null);
  const now = useNow(60 * 1000);

  useEffect(() => {
    if (!CMU) return;
    let live = true;
    fetchSchedule(CMU.id, SEASON)
      .then((g) => live && setGames([...g].sort((a, b) => new Date(a.date) - new Date(b.date))))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const next = useMemo(
    () => (games || []).find((g) => !g.completed && new Date(g.date).getTime() + GAME_WINDOW_MS > now) || null,
    [games, now]
  );

  // Start the strip scrolled so the next game is the first card in view.
  useEffect(() => {
    if (!next || !scroller.current || !nextRef.current) return;
    scroller.current.scrollLeft = Math.max(0, nextRef.current.offsetLeft - scroller.current.offsetLeft - 8);
  }, [next?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!CMU || failed || (games && games.length === 0)) return null;

  const scrollBy = (dir) => scroller.current?.scrollBy({ left: dir * 340, behavior: "smooth" });
  const arrow = {
    display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: 6, cursor: "pointer",
    background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)",
  };

  return (
    <section style={{ paddingTop: 40 }} aria-label="Central Michigan 2026 schedule">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12 }}>
        <h2 className="oswald" style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "0.02em" }}>Central Michigan · {SEASON} Schedule</h2>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => scrollBy(-1)} aria-label="Scroll schedule left" style={arrow}><ChevronLeft size={16} /></button>
          <button onClick={() => scrollBy(1)} aria-label="Scroll schedule right" style={arrow}><ChevronRight size={16} /></button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 28, alignItems: "stretch", flexWrap: "wrap" }}>
        {next && (
          <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", gap: 16, justifyContent: "center" }}>
            <Countdown game={next} />
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Logo game={next} size={56} theme={theme} />
              <div>
                <div style={{ fontSize: 11, color: "var(--text-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{next.away ? "At" : next.neutral ? "Neutral site vs" : "Home vs"}</div>
                <div className="oswald" style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>
                  {next.rank && <span style={{ color: "var(--accent)" }}>#{next.rank} </span>}
                  {next.name}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 3 }}>
                  {new Date(next.date).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
                  {next.timeValid && ` · ${new Date(next.date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
                  {next.tv && ` · ${next.tv}`}
                </div>
                {next.venue && <div style={{ fontSize: 12, color: "var(--text-faint)" }}>{next.venue}</div>}
              </div>
            </div>
          </div>
        )}
        {games && !next && (
          <div style={{ alignSelf: "center", fontSize: 14, color: "var(--text-muted)" }}>The {SEASON} regular season is complete.</div>
        )}

        <div
          ref={scroller}
          style={{
            flex: "1 1 320px", minWidth: 0, display: "flex", gap: 12, overflowX: "auto", scrollSnapType: "x proximity", padding: "12px 4px 12px",
            scrollbarWidth: "thin",
          }}
        >
          {!games && <div style={{ color: "var(--text-faint)", fontSize: 13, alignSelf: "center" }}>Loading schedule…</div>}
          {(games || []).map((g) => (
            <GameCard key={g.id} game={g} isNext={next?.id === g.id} past={g.completed} theme={theme} cardRef={next?.id === g.id ? nextRef : undefined} />
          ))}
        </div>
      </div>
    </section>
  );
}
