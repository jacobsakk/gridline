import { useEffect, useLayoutEffect, useRef } from "react";
import homeLogo from "./assets/home-logo.png";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Plays when a dashboard card is opened: a gold panel and then a maroon
// one sweep across the screen, the HOME logo shows on the maroon, the next
// screen mounts underneath (onCovered), and the panels sweep off to
// reveal it (onDone when finished).
export default function CardTransition({ heading, label, onCovered, onDone }) {
  const goldRef = useRef(null);
  const maroonRef = useRef(null);
  const logoRef = useRef(null);
  const labelRef = useRef(null);
  const headingRef = useRef(null);

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
    const head = headingRef.current;
    if (head) {
      head.style.fontSize = "100px";
      const w = head.scrollWidth;
      if (w > 0 && target > 0) head.style.fontSize = `${Math.min(46, (100 * target * 0.62) / w)}px`;
    }
  }, [label, heading]);

  useEffect(() => {
    let cancelled = false;
    const running = [];
    const play = (el, keyframes, options) => {
      const a = el.animate(keyframes, options);
      running.push(a);
      return a.finished;
    };
    const ease = "cubic-bezier(0.65, 0, 0.35, 1)"; // eases in and out gently, no sudden start or stop
    const settle = "cubic-bezier(0.22, 1, 0.36, 1)"; // decelerates into place, no bounce
    const inFrames = [{ transform: "translate3d(-125%, 0, 0) skewX(-12deg)" }, { transform: "translate3d(0, 0, 0) skewX(-12deg)" }];
    const outFrames = [{ transform: "translate3d(0, 0, 0) skewX(-12deg)" }, { transform: "translate3d(125%, 0, 0) skewX(-12deg)" }];

    async function run() {
      play(logoRef.current, [{ opacity: 0, transform: "scale(0.9)" }, { opacity: 1, transform: "scale(1)" }], {
        duration: 620, delay: 640, easing: settle, fill: "both",
      });
      if (headingRef.current) {
        play(headingRef.current, [{ opacity: 0, transform: "translateY(-12px)" }, { opacity: 1, transform: "translateY(0)" }], {
          duration: 560, delay: 720, easing: settle, fill: "both",
        });
      }
      play(labelRef.current, [{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "translateY(0)" }], {
        duration: 560, delay: 860, easing: settle, fill: "both",
      });
      play(goldRef.current, inFrames, { duration: 680, easing: ease, fill: "forwards" });
      await play(maroonRef.current, inFrames, { duration: 680, delay: 180, easing: ease, fill: "forwards" });
      if (cancelled) return;
      onCovered();
      await wait(800);
      if (cancelled) return;
      play(logoRef.current, [{ opacity: 1 }, { opacity: 0 }], { duration: 280, easing: "ease-in", fill: "forwards" });
      play(labelRef.current, [{ opacity: 1 }, { opacity: 0 }], { duration: 280, easing: "ease-in", fill: "forwards" });
      if (headingRef.current) play(headingRef.current, [{ opacity: 1 }, { opacity: 0 }], { duration: 280, easing: "ease-in", fill: "forwards" });
      play(maroonRef.current, outFrames, { duration: 680, easing: ease, fill: "forwards" });
      await play(goldRef.current, outFrames, { duration: 680, delay: 180, easing: ease, fill: "forwards" });
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
  const panel = { position: "fixed", top: 0, bottom: 0, left: "-15%", right: "-15%", transform: "translate3d(-125%, 0, 0) skewX(-12deg)", willChange: "transform" };

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
        {heading && (
          <div
            ref={headingRef}
            className="oswald"
            style={{
              opacity: 0, fontSize: 40, fontWeight: 700, letterSpacing: "0.32em", textTransform: "uppercase", whiteSpace: "nowrap",
              color: "#F7EFE4", textAlign: "center", paddingLeft: "0.32em",
            }}
          >
            {heading}
          </div>
        )}
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
