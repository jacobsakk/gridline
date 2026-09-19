import { useEffect, useLayoutEffect, useRef } from "react";
import homeLogo from "./assets/home-logo.png";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Plays when a dashboard card is opened: a gold panel and then a maroon
// one sweep across the screen, the HOME logo shows on the maroon, the next
// screen mounts underneath (onCovered), and the panels sweep off to
// reveal it (onDone when finished).
export default function CardTransition({ label, onCovered, onDone }) {
  const goldRef = useRef(null);
  const maroonRef = useRef(null);
  const logoRef = useRef(null);
  const labelRef = useRef(null);

  // Size the name so it spans the same width as the logo above it, whatever
  // its length ("OFFER TRACKER" gets bigger type than "PRE-PORTAL TRACKER").
  useLayoutEffect(() => {
    const label = labelRef.current;
    const logo = logoRef.current;
    if (!label || !logo) return;
    label.style.fontSize = "100px";
    const natural = label.scrollWidth;
    const target = logo.offsetWidth;
    if (natural > 0 && target > 0) label.style.fontSize = `${Math.min(84, (100 * target) / natural)}px`;
  }, [label]);

  useEffect(() => {
    let cancelled = false;
    const running = [];
    const play = (el, keyframes, options) => {
      const a = el.animate(keyframes, options);
      running.push(a);
      return a.finished;
    };
    const ease = "cubic-bezier(0.7, 0, 0.2, 1)";
    const inFrames = [{ transform: "translateX(-125%) skewX(-12deg)" }, { transform: "translateX(0) skewX(-12deg)" }];
    const outFrames = [{ transform: "translateX(0) skewX(-12deg)" }, { transform: "translateX(125%) skewX(-12deg)" }];

    async function run() {
      play(logoRef.current, [{ opacity: 0, transform: "scale(0.86)" }, { opacity: 1, transform: "scale(1)" }], {
        duration: 420, delay: 520, easing: "cubic-bezier(0.2, 0.9, 0.3, 1.15)", fill: "both",
      });
      play(labelRef.current, [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "translateY(0)" }], {
        duration: 380, delay: 700, easing: "ease-out", fill: "both",
      });
      play(goldRef.current, inFrames, { duration: 520, easing: ease, fill: "forwards" });
      await play(maroonRef.current, inFrames, { duration: 520, delay: 150, easing: ease, fill: "forwards" });
      if (cancelled) return;
      onCovered();
      await wait(650);
      if (cancelled) return;
      play(logoRef.current, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: "forwards" });
      play(labelRef.current, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: "forwards" });
      play(maroonRef.current, outFrames, { duration: 540, easing: ease, fill: "forwards" });
      await play(goldRef.current, outFrames, { duration: 540, delay: 150, easing: ease, fill: "forwards" });
      if (!cancelled) onDone();
    }

    run().catch(() => {});
    return () => {
      cancelled = true;
      running.forEach((a) => a.cancel());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Panels are wider than the screen so the skewed edges never leave a gap.
  const panel = { position: "fixed", top: 0, bottom: 0, left: "-15%", right: "-15%", transform: "translateX(-125%) skewX(-12deg)" };

  return (
    <>
      {/* Swallows clicks while the transition plays. */}
      <div style={{ position: "fixed", inset: 0, zIndex: 199 }} />
      <div ref={goldRef} style={{ ...panel, zIndex: 200, background: "linear-gradient(135deg, var(--gold), #C9860E)" }} />
      <div ref={maroonRef} style={{ ...panel, zIndex: 201, background: "var(--maroon)" }} />
      <div
        style={{
          position: "fixed", inset: 0, zIndex: 202, display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", gap: 18, pointerEvents: "none",
        }}
      >
        <img ref={logoRef} src={homeLogo} alt="" style={{ width: "min(460px, 70vw)", height: "auto", opacity: 0 }} />
        <div
          ref={labelRef}
          className="oswald"
          style={{
            opacity: 0, fontSize: 22, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", whiteSpace: "nowrap",
            color: "var(--gold)", textAlign: "center",
          }}
        >
          {label}
        </div>
      </div>
    </>
  );
}
