import { useEffect, useRef } from "react";
import cmuHelmet from "./assets/cmu-helmet.png";

export const TRANSITION_OPTIONS = [
  { key: "expand", label: "Expand" },
  { key: "circle", label: "Circle burst" },
  { key: "wipe", label: "Gold & maroon wipe" },
  { key: "zoom", label: "Zoom through" },
  { key: "slide", label: "Slide" },
  { key: "none", label: "None" },
];

const STORAGE_KEY = "gridline-transition";

export function getTransitionStyle() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return TRANSITION_OPTIONS.some((o) => o.key === saved) ? saved : "expand";
  } catch {
    return "expand";
  }
}

export function saveTransitionStyle(key) {
  try {
    window.localStorage.setItem(STORAGE_KEY, key);
  } catch {
    /* storage unavailable -- the choice just won't persist */
  }
}

const GOLD = "linear-gradient(135deg, var(--gold), #C9860E)";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

// Plays when a dashboard card is opened. Every style follows the same
// beats: cover or move the dashboard away, call onCovered() so the next
// screen mounts, then reveal it and call onDone().
export default function CardTransition({ variant, rect, label, onCovered, onDone }) {
  const goldRef = useRef(null);
  const maroonRef = useRef(null);
  const helmetRef = useRef(null);
  const labelRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const running = [];
    const play = (el, keyframes, options) => {
      const a = el.animate(keyframes, options);
      running.push(a);
      return a.finished;
    };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const ease = "cubic-bezier(0.7, 0, 0.2, 1)";
    const popHelmet = (delay) => {
      play(helmetRef.current, [{ opacity: 0, transform: "scale(0.5)" }, { opacity: 1, transform: "scale(1)" }], {
        duration: 340, delay, easing: "cubic-bezier(0.2, 0.9, 0.3, 1.3)", fill: "both",
      });
      if (labelRef.current) {
        play(labelRef.current, [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "translateY(0)" }], {
          duration: 300, delay: delay + 120, easing: "ease-out", fill: "both",
        });
      }
    };

    async function run() {
      const shell = document.querySelector(".screen-enter");

      if (variant === "expand") {
        const gold = goldRef.current;
        popHelmet(200);
        await play(gold, [
          { top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${rect.height}px`, borderRadius: "10px" },
          { top: "0px", left: "0px", width: `${vw}px`, height: `${vh}px`, borderRadius: "0px" },
        ], { duration: 460, easing: ease, fill: "forwards" });
        if (cancelled) return;
        onCovered();
        await wait(220);
        if (cancelled) return;
        await play(gold, [{ opacity: 1 }, { opacity: 0 }], { duration: 380, easing: "ease-out", fill: "forwards" });
      } else if (variant === "circle") {
        const gold = goldRef.current;
        const radius = Math.hypot(Math.max(cx, vw - cx), Math.max(cy, vh - cy));
        popHelmet(260);
        await play(gold, [
          { clipPath: `circle(0px at ${cx}px ${cy}px)` },
          { clipPath: `circle(${radius}px at ${cx}px ${cy}px)` },
        ], { duration: 560, easing: "cubic-bezier(0.5, 0, 0.2, 1)", fill: "forwards" });
        if (cancelled) return;
        onCovered();
        await wait(220);
        if (cancelled) return;
        await play(gold, [{ opacity: 1 }, { opacity: 0 }], { duration: 400, easing: "ease-out", fill: "forwards" });
      } else if (variant === "wipe") {
        const gold = goldRef.current;
        const maroon = maroonRef.current;
        const inFrames = [{ transform: "translateX(-125%) skewX(-12deg)" }, { transform: "translateX(0) skewX(-12deg)" }];
        const outFrames = [{ transform: "translateX(0) skewX(-12deg)" }, { transform: "translateX(125%) skewX(-12deg)" }];
        popHelmet(380);
        play(maroon, inFrames, { duration: 420, easing: ease, fill: "forwards" });
        await play(gold, inFrames, { duration: 420, delay: 110, easing: ease, fill: "forwards" });
        if (cancelled) return;
        onCovered();
        await wait(320);
        if (cancelled) return;
        play(helmetRef.current, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" });
        if (labelRef.current) play(labelRef.current, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" });
        play(gold, outFrames, { duration: 440, easing: ease, fill: "forwards" });
        await play(maroon, outFrames, { duration: 440, delay: 110, easing: ease, fill: "forwards" });
      } else if (variant === "zoom") {
        shell.style.transformOrigin = `${cx}px ${cy}px`;
        await play(shell, [
          { transform: "scale(1)", opacity: 1 },
          { transform: "scale(1.9)", opacity: 0 },
        ], { duration: 380, easing: "cubic-bezier(0.5, 0, 0.9, 0.4)", fill: "forwards" });
        if (cancelled) return;
        onCovered();
        await nextFrame();
        const incoming = document.querySelector(".screen-enter");
        if (incoming && !cancelled) {
          await play(incoming, [
            { transform: "scale(0.92)", opacity: 0 },
            { transform: "scale(1)", opacity: 1 },
          ], { duration: 460, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
        }
      } else if (variant === "slide") {
        await play(shell, [
          { transform: "translateX(0)", opacity: 1 },
          { transform: "translateX(-7%)", opacity: 0 },
        ], { duration: 300, easing: "cubic-bezier(0.5, 0, 0.9, 0.4)", fill: "forwards" });
        if (cancelled) return;
        onCovered();
        await nextFrame();
        const incoming = document.querySelector(".screen-enter");
        if (incoming && !cancelled) {
          await play(incoming, [
            { transform: "translateX(7%)", opacity: 0 },
            { transform: "translateX(0)", opacity: 1 },
          ], { duration: 420, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
        }
      }
      if (!cancelled) onDone();
    }

    run().catch(() => {});
    return () => {
      cancelled = true;
      running.forEach((a) => a.cancel());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fullScreen = { position: "fixed", inset: 0 };
  const showsPanel = variant === "expand" || variant === "circle" || variant === "wipe";

  return (
    <>
      {/* Swallows clicks while the transition plays. */}
      <div style={{ ...fullScreen, zIndex: 199 }} />
      {showsPanel && variant === "wipe" && (
        <div ref={maroonRef} style={{ ...fullScreen, zIndex: 200, left: "-15%", right: "-15%", background: "var(--maroon)", transform: "translateX(-125%) skewX(-12deg)" }} />
      )}
      {showsPanel && (
        <div
          ref={goldRef}
          style={
            variant === "expand"
              ? { position: "fixed", zIndex: 201, top: rect.top, left: rect.left, width: rect.width, height: rect.height, borderRadius: 10, background: GOLD }
              : variant === "circle"
                ? { ...fullScreen, zIndex: 201, background: GOLD, clipPath: `circle(0px at ${rect.left + rect.width / 2}px ${rect.top + rect.height / 2}px)` }
                : { ...fullScreen, zIndex: 201, left: "-15%", right: "-15%", background: GOLD, transform: "translateX(-125%) skewX(-12deg)" }
          }
        />
      )}
      {showsPanel && (
        <div
          style={{
            ...fullScreen, zIndex: 202, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: 14, pointerEvents: "none",
          }}
        >
          <img ref={helmetRef} src={cmuHelmet} alt="" style={{ height: 110, width: "auto", opacity: 0 }} />
          <div
            ref={labelRef}
            className="oswald"
            style={{ opacity: 0, fontSize: 20, fontWeight: 700, letterSpacing: "0.08em", color: "#1A1206", textTransform: "uppercase" }}
          >
            {label}
          </div>
        </div>
      )}
    </>
  );
}
