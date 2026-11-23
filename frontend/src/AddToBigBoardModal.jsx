import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { STATUSES, STATUS_BY_KEY, blankBoard, blankPlayer, boardSpotFor, handChange, nameKey, upsertPlayer, useBigBoards } from "./bigBoardData.js";
import { canonicalSchool } from "./schoolNames.js";

// Puts a watch-list player on a Big Board (the Transfer board by default). The card is filled in from what the watch
// list already knows -- school, home state, height/weight, eligibility, film link, photo -- and the coach picks the
// board, side, column, tier and card colour. Lazy-loaded from the watch list so the board code only loads when used.

const field = { background: "var(--bg-page)", border: "1px solid var(--border)", borderRadius: 4, padding: "6px 8px", fontSize: 13, color: "var(--text-primary)", fontFamily: "inherit", width: "100%" };
const label = { display: "block", fontSize: 10.5, color: "var(--text-faint)", letterSpacing: "0.03em", margin: "0 0 4px" };
const SIDES = [["off", "Offense"], ["def", "Defense / Specialists"]];

export default function AddToBigBoardModal({ player, onClose }) {
  const [year, setYear] = useState("TRANSFER");
  const bb = useBigBoards(year);
  const [startSide, startCol] = boardSpotFor(player.position);
  const [side, setSide] = useState(startSide);
  const [colLabel, setColLabel] = useState(startCol);
  const [tier, setTier] = useState(1);
  const [status, setStatus] = useState(STATUS_BY_KEY[player.rating] ? player.rating : "recruit"); // starts on the watch-list rating
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const existing = bb.board(year, side);
  const board = existing || blankBoard(side);
  // The column the coach picked, or the closest one this board has (a flex column is on both sides).
  const column = board.columns.find((c) => c.label === colLabel) || board.columns[0];
  const key = nameKey(player.player);
  const already = useMemo(
    () => (existing?.columns || []).filter((c) => c.players.some((p) => nameKey(p.name) === key)).map((c) => c.label),
    [existing, key]
  );
  const yearLabel = (y) => (y === "TRANSFER" ? "Transfer" : y);

  function changeSide(next) {
    setSide(next);
    // Keep the column if the other side has it (the flex columns), otherwise start from the position's own spot.
    const labels = (bb.board(year, next) || blankBoard(next)).columns.map((c) => c.label);
    setColLabel(labels.includes(colLabel) ? colLabel : next === startSide ? startCol : labels[0]);
  }

  async function add() {
    setSaving(true);
    setError("");
    try {
      const card = {
        ...blankPlayer(tier),
        name: player.player.trim(),
        school: canonicalSchool(player.team) || player.team || "",
        state: player.homeState || "",
        measurables: [player.height, player.weight].filter(Boolean).join(" "),
        hudl: player.filmLink || "",
        eligibility: player.eligibility ? String(player.eligibility) : "",
        status,
        pos: player.position || "",
      };
      const next = upsertPlayer(board, column.key, card);
      await bb.saveBoard(year, side, next);
      if (player.photo) await bb.savePhoto(year, card.name, player.photo);
      const change = handChange("added", side, card, column.label);
      if (change) await bb.logActivity(year, [change], "from watch list");
      setDone(`${card.name} is on the ${yearLabel(year)} ${side === "off" ? "offense" : "defense"} board in ${column.label}, tier ${tier}.`);
    } catch (err) {
      setError(err?.code === "permission-denied" ? "No permission to save." : "Couldn't save -- try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(8,10,12,0.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 80 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, width: 480, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 className="oswald" style={{ fontSize: 19, margin: 0, fontWeight: 700 }}>Add to Big Board</h2>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 4, lineHeight: 0 }}><X size={18} /></button>
        </div>

        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div className="oswald" style={{ fontSize: 18, fontWeight: 700 }}>{player.player}</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {[canonicalSchool(player.team) || player.team, player.position, player.homeState, [player.height, player.weight].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}
            </div>
          </div>

          {done ? (
            <div style={{ border: "1px solid var(--success)", borderRadius: 6, padding: "10px 12px", fontSize: 13.5, color: "var(--success)" }}>{done}</div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label htmlFor="abb-year" style={label}>Board</label>
                  <select id="abb-year" value={year} onChange={(e) => setYear(e.target.value)} style={{ ...field, cursor: "pointer" }}>
                    {bb.classYears.map((y) => <option key={y} value={y}>{yearLabel(y)}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="abb-side" style={label}>Side</label>
                  <select id="abb-side" value={side} onChange={(e) => changeSide(e.target.value)} style={{ ...field, cursor: "pointer" }}>
                    {SIDES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="abb-col" style={label}>Position column</label>
                  <select id="abb-col" value={column.label} onChange={(e) => setColLabel(e.target.value)} style={{ ...field, cursor: "pointer" }}>
                    {board.columns.map((c) => <option key={c.key} value={c.label}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="abb-tier" style={label}>Tier</label>
                  <select id="abb-tier" value={tier} onChange={(e) => setTier(Number(e.target.value))} style={{ ...field, cursor: "pointer" }}>
                    {[1, 2, 3, 4].map((t) => <option key={t} value={t}>Tier {t}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="abb-status" style={label}>Card colour</label>
                <select id="abb-status" value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...field, cursor: "pointer", background: STATUS_BY_KEY[status]?.color, color: "#111", fontWeight: 700 }}>
                  {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              {!bb.ready && <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>Loading boards…</div>}
              {bb.ready && !existing && (
                <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                  There's no {yearLabel(year)} {side === "off" ? "offense" : "defense"} board yet. Adding this player will start a blank one with the standard columns.
                </div>
              )}
              {already.length > 0 && (
                <div style={{ fontSize: 12.5, color: "var(--warning, #d69e2e)" }}>
                  {player.player} is already on this board ({already.join(", ")}). Adding again puts a second card in {column.label}.
                </div>
              )}
              {error && <div style={{ color: "var(--danger, #c0392b)", fontSize: 13 }}>{error}</div>}
            </>
          )}
        </div>

        <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={{ background: "none", border: "1px solid var(--border)", color: "var(--text-muted)", borderRadius: 4, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{done ? "Close" : "Cancel"}</button>
          {!done && (
            <button onClick={add} disabled={saving || !bb.ready} style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--accent-bg)", border: "1px solid var(--accent)", color: "var(--accent)", borderRadius: 4, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: saving ? "default" : "pointer", opacity: saving || !bb.ready ? 0.6 : 1 }}>
              <Plus size={14} /> {saving ? "Adding…" : "Add to board"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
