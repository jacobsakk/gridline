import { Fragment, useEffect } from "react";
import { Plus, X } from "lucide-react";
import { FLAGS, RATING_KEYS, STATUSES, STATUS_BY_KEY, TRENDS, VISIT_READY, VISITS, commitCounts, nameKey } from "./bigBoardConstants.js";

// Drawing a board (the cards, columns, key and counts) and fitting it to a printed page. Used by the Big Board
// page and, on its own, by a shared link -- so this file stays free of the spreadsheet and database code.

const SIDE_TITLE = { off: "HIGH SCHOOL OFFENSIVE BIG BOARD", def: "HIGH SCHOOL DEFENSIVE/SPEC BIG BOARD" };
const JUCO_SIDE_TITLE = { off: "JUCO OFFENSIVE BIG BOARD", def: "JUCO DEFENSIVE/SPEC BIG BOARD" };
const hudlHref = (url) => (/^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`);
const trendEmoji = (key) => TRENDS.find((t) => t.key === key)?.emoji || "";

// ------------------------------------------------------------------ the sheet

const markersFor = (p) => [p.flags?.snap ? "($)" : "", p.flags?.punt ? "(#)" : "", p.flags?.noMidYear ? "🚫" : "", p.flags?.injured ? "⛑️" : "", p.flags?.visitReady ? "✅" : ""].filter(Boolean).join(" ");

// A card shows the A / P / C / R trend marks (🔥 🌤️ 🌨️ 🧊) but not ARMs' rating line ("2 - ALL MAC PLAYER"), and
// the JUCO board shows no area coach. The rating text stays on the card's data; it's just not displayed.
function PlayerCard({ p, showCoach, hasRating, photo, onOpen, juco, readOnly }) {
  const status = STATUS_BY_KEY[p.status] || STATUS_BY_KEY.recruit;
  const marks = markersFor(p);
  return (
    <div className={`bb-card${juco && p.eligibility ? " bb-has-elig" : ""}`} style={readOnly ? { background: status.color, cursor: "default" } : { background: status.color }} onClick={readOnly ? undefined : onOpen} role={readOnly ? undefined : "button"} tabIndex={readOnly ? undefined : 0} onKeyDown={readOnly ? undefined : (e) => e.key === "Enter" && onOpen()} title={readOnly ? undefined : "Click to edit"}>
      {photo && <img className="bb-photo" src={photo} alt="" />}
      {juco && p.eligibility && <span className="bb-elig" title={`Year ${p.eligibility} of eligibility`}>YEAR {p.eligibility}</span>}
      <div className="bb-card-text">
        <div className="bb-name">
          {p.hudl ? (
            <span
              className="bb-name-link"
              title="Open Hudl"
              onClick={(e) => {
                e.stopPropagation();
                window.open(hudlHref(p.hudl), "_blank", "noopener,noreferrer");
              }}
            >
              {p.name || "New player"}
            </span>
          ) : (
            p.name || "New player"
          )}
          {marks && <span style={{ fontWeight: 500 }}> {marks}</span>}
        </div>
        {(p.school || p.state) && <div>{p.school}{p.state ? ` (${p.state})` : ""}</div>}
        {p.measurables && <div>{p.measurables}</div>}
        {(p.gpa || p.visits) && (
          <div>
            {p.gpa ? `${juco ? (p.transcriptEval ? "cGPA" : "GPA") : p.gpaLabel || "cGPA"}: ${p.gpa}` : ""}
            {juco && p.gpa && p.transcriptEval && <span className="bb-cgpa-check" title="Transcript evaluated: this is the core GPA"> ✓</span>}
            {" "}{p.visits}
          </div>
        )}
        {showCoach && p.coach && <div className="bb-extra">{p.coach}</div>}
      </div>
      {hasRating && RATING_KEYS.some((k) => p.rating?.[k]) && (
        <div className="bb-rating">
          {RATING_KEYS.map((k) => (
            <div key={k}>{k}:{trendEmoji(p.rating?.[k]) || "–"}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export function BoardSheet({ board, side, classYear, photos, onOpen, onAdd, onRemoveColumn, readOnly = false, counts: countsOverride }) {
  const counts = countsOverride || commitCounts(board);
  const title = board.title && /\d{4}/.test(board.title) ? board.title : classYear === "JUCO" ? JUCO_SIDE_TITLE[side] : `${SIDE_TITLE[side]} - ${classYear}`;
  return (
    <div className="bb-sheet bb-board">
      <div className="bb-title">{title}</div>
      {/* The defense board has ten columns, so its busy ones would be squeezed; a column nobody is in yet is kept
          slim until a player is added, which gives the others the width the offense board's columns have. */}
      <div className="bb-cols" style={{ gridTemplateColumns: side === "def" ? board.columns.map((c) => (c.players.length ? "minmax(0, 1fr)" : "minmax(80px, 0.5fr)")).join(" ") : `repeat(${board.columns.length}, minmax(0, 1fr))` }}>
        {board.columns.map((col) => {
          const committed = col.players.filter((p) => p.status === "committed").length;
          return (
            <div key={col.key} className={col.players.length || side !== "def" ? "bb-col" : "bb-col bb-empty"}>
              <div className="bb-colhead">
                <span>{col.label}</span>
                <span style={{ color: "#B3261E" }}>
                  ({committed})
                  {onRemoveColumn && !readOnly && col.players.length === 0 && (
                    <button className="bb-add hs-no-print" onClick={() => onRemoveColumn(col.key)} title={`Remove the empty ${col.label} category`} aria-label={`Remove the empty ${col.label} category`} style={{ marginLeft: 6, color: "#555", borderColor: "#999" }}>
                      <X size={11} />
                    </button>
                  )}
                </span>
              </div>
              {/* Tier 1 is always there (it carries the + to add a player; the card's form picks any tier); tiers 2 and
                  up only appear in a column while someone is in them. */}
              {[1, ...[...new Set(col.players.map((p) => p.tier))].filter((t) => t > 1).sort((a, b) => a - b)].map((tier) => {
                const inTier = col.players.filter((p) => p.tier === tier);
                return (
                  <Fragment key={tier}>
                    <div className="bb-tier">
                      <span>TIER {tier}</span>
                      {!readOnly && <button className="bb-add hs-no-print" onClick={() => onAdd(col.key, tier)} title={`Add a player to ${col.label} tier ${tier}`} aria-label={`Add a player to ${col.label} tier ${tier}`}>
                        <Plus size={11} />
                      </button>}
                    </div>
                    {inTier.map((p) => (
                      <PlayerCard key={p.id} p={p} juco={classYear === "JUCO"} showCoach={classYear !== "JUCO"} hasRating={col.hasRating} photo={photos[nameKey(p.name)]} onOpen={() => onOpen(col.key, p)} readOnly={readOnly} />
                    ))}
                  </Fragment>
                );
              })}
            </div>
          );
        })}
      </div>
      <BoardFooter counts={counts} side={side} classYear={classYear} board={board} />
    </div>
  );
}

// Only the emojis this board actually uses are listed in its key.
function usedEmojis(board, classYear) {
  const players = board.columns.flatMap((c) => c.players);
  const juco = classYear === "JUCO";
  const plain = (s) => String(s || "").replace(/\uFE0F/g, "");
  return {
    trends: TRENDS.filter((t) => players.some((p) => RATING_KEYS.some((k) => p.rating?.[k] === t.key))),
    flags: [...FLAGS, ...(juco ? [VISIT_READY] : [])].filter((f) => players.some((p) => p.flags?.[f.key])),
    visits: VISITS.filter((v) => players.some((p) => plain(p.visits).includes(plain(v.marker)))),
    cgpa: juco && players.some((p) => p.gpa && p.transcriptEval),
  };
}

function BoardFooter({ counts, side, classYear, board }) {
  const used = usedEmojis(board, classYear);
  const anyEmoji = used.trends.length + used.flags.length + used.visits.length > 0 || used.cgpa;
  return (
    <div className="bb-footer">
      <div className="bb-key">
        <div className="bb-footh">KEY</div>
        {STATUSES.map((s) => (
          <div key={s.key} style={{ background: s.color }}>{s.label.toUpperCase()}</div>
        ))}
      </div>
      {anyEmoji ? (
        <div className="bb-emojis">
          <div className="bb-footh">EMOJIS</div>
          <div className="bb-emoji-grid">
            {used.trends.map((t) => (
              <div key={t.key}><span>{t.emoji}</span> {t.label}</div>
            ))}
            {used.flags.map((f) => (
              <div key={f.key}><span>{f.marker === "$" ? "($)" : f.marker === "#" ? "(#)" : f.marker}</span> {f.label}</div>
            ))}
            {used.visits.map((v) => (
              <div key={v.marker}><span>{v.marker}</span> {classYear === "JUCO" && v.marker === "🏠" ? "Home visit/School visit" : v.label}</div>
            ))}
            {used.cgpa && <div><span className="bb-cgpa-check">✓</span> cGPA (transcript evaluated)</div>}
          </div>
        </div>
      ) : (
        <div className="bb-emojis" />
      )}
      <div className="bb-counts">
        <div className="bb-footh">TOTAL {side === "def" ? "DEFENSIVE" : "OFFENSIVE"} COMMITS</div>
        {counts.rows.map((r) => (
          <div key={r.label} style={{ display: "flex", justifyContent: "space-between" }}><span>{r.label}</span><b>{r.count}</b></div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #111", marginTop: 3, paddingTop: 3, fontWeight: 800 }}>
          <span>TOTAL</span><span style={{ fontSize: 16 }}>{counts.total}</span>
        </div>
      </div>
    </div>
  );
}


export function useBoardPrintFit() {
  // Printing: a board plus its key and counts is shrunk to fit one landscape letter page. Nothing is allowed to wrap
  // onto a second line (a school, a measurables line, a column heading): each column is made as wide as its longest
  // line needs, every column with players the same width and every empty one the same narrower width, and then the
  // whole board is scaled to the page. The size is measured just before printing, so the key always prints with the
  // prospects instead of spilling onto a second sheet.
  useEffect(() => {
    const PAGE_W = 990; // 10.4in of printable width, in CSS pixels, with a little to spare
    const PAGE_H = 735; // 7.9in of printable height
    const fit = () => {
      // The board kept out of sight on screen has to be measured too, so it is shown for the moment.
      document.querySelectorAll(".bb-print-only").forEach((w) => (w.style.display = "block"));
      document.querySelectorAll(".bb-board").forEach((el) => {
        const cols = el.querySelector(".bb-cols");
        const columns = [...el.querySelectorAll(".bb-col")];
        el.style.zoom = "";
        el.style.minHeight = "0px";
        if (!cols || !columns.length) return;
        cols.dataset.screenTemplate = cols.style.gridTemplateColumns;
        el.classList.add("bb-nowrap");
        // Lays the board out with its cards scaled by `s` and returns the page zoom that then fits it.
        const measure = (scale) => {
          el.style.setProperty("--bb-s", String(scale));
          el.style.removeProperty("--bb-v");
          el.style.zoom = "";
          el.style.minHeight = "0px";
          // Each column's natural width with nothing wrapping.
          el.style.width = "max-content";
          cols.style.gridTemplateColumns = columns.map(() => "max-content").join(" ");
          const natural = columns.map((c) => c.offsetWidth);
          const full = columns.map((c) => !!c.querySelector(".bb-card"));
          const wFull = Math.max(0, ...natural.filter((_, i) => full[i]));
          const wEmpty = Math.max(0, ...natural.filter((_, i) => !full[i]));
          const total = natural.reduce((sum, _, i) => sum + (full[i] ? wFull : wEmpty), 0) + 2;
          // Any extra width the page allows is shared out in proportion, so equal columns stay equal.
          const ratio = wFull ? wEmpty / wFull : 1;
          cols.style.gridTemplateColumns = columns.map((_, i) => (full[i] ? `minmax(${wFull}px, 1fr)` : `minmax(${wEmpty}px, ${ratio}fr)`)).join(" ");
          el.style.width = `${total}px`;
          let z = Math.min(1.6, PAGE_W / total, PAGE_H / el.scrollHeight);
          for (let i = 0; i < 4; i++) {
            el.style.width = `${PAGE_W / z}px`;
            z = Math.min(z, PAGE_H / el.scrollHeight);
          }
          return Math.max(0.3, z);
        };
        // A board with few players leaves the page mostly empty at normal card size, so the cards (type, photo,
        // spacing) are made bigger until the board fills the sheet; the size that prints largest wins. A full board
        // gains nothing from it and stays at normal size.
        // The headings and the key shrink with the page, so the page zoom may only give up a little for it.
        const baseZoom = measure(1);
        let bestScale = 1;
        let bestPrint = baseZoom;
        for (let scale = 1.1; scale <= 2.6; scale += 0.1) {
          const zoom = measure(scale);
          if (zoom < baseZoom * 0.88) break;
          if (scale * zoom > bestPrint * 1.01) {
            bestPrint = scale * zoom;
            bestScale = scale;
          }
        }
        const z = measure(bestScale);
        el.style.width = `${PAGE_W / z}px`;
        el.style.zoom = String(z);
        // Cards can't get wider (the page width is used up), so what height is left over goes into taller boxes:
        // more room around the text, as far as the board still fits the sheet.
        let bestSpread = 1;
        for (let spread = 1.1; spread <= 6; spread += 0.1) {
          el.style.setProperty("--bb-v", String(spread));
          if (el.scrollHeight * z > PAGE_H) break;
          bestSpread = spread;
        }
        el.style.setProperty("--bb-v", String(bestSpread));
        // The board is stretched to the full page, its key at the bottom, instead of ending halfway down the sheet.
        el.style.minHeight = `${PAGE_H / z - 2}px`;
      });
    };
    const reset = () => {
      document.querySelectorAll(".bb-print-only").forEach((w) => (w.style.display = ""));
      document.querySelectorAll(".bb-board").forEach((el) => {
        const cols = el.querySelector(".bb-cols");
        if (cols && cols.dataset.screenTemplate !== undefined) cols.style.gridTemplateColumns = cols.dataset.screenTemplate;
        el.classList.remove("bb-nowrap");
        el.style.removeProperty("--bb-s");
        el.style.removeProperty("--bb-v");
        el.style.zoom = "";
        el.style.width = "";
        el.style.minHeight = "";
      });
    };
    window.addEventListener("beforeprint", fit);
    window.addEventListener("afterprint", reset);
    return () => {
      window.removeEventListener("beforeprint", fit);
      window.removeEventListener("afterprint", reset);
    };
  }, []);
}

