import { useEffect, useRef } from "react";
import { Wordmark } from "./Brand";

/** A single, quiet hand-off from attention to value; the text stays readable without motion. */
export function WorkbenchHero() {
  const tagline = useRef<HTMLParagraphElement>(null);
  const attention = useRef<HTMLElement>(null);
  const value = useRef<HTMLElement>(null);
  const dot = useRef<HTMLSpanElement>(null);
  const sweep = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const line = tagline.current;
    const source = attention.current;
    const target = value.current;
    const point = dot.current;
    const underline = sweep.current;
    if (!line || !source || !target || !point || !underline) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false;
    let stopped = false;
    let frame = 0;
    let timer = 0;
    let animations: Animation[] = [];
    let measured: { width: number; height: number } | undefined;
    const stop = () => {
      stopped = true;
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
      animations.forEach((animation) => animation.cancel());
      animations = [];
    };
    const resize = new ResizeObserver(() => {
      if (!measured) return;
      const rect = line.getBoundingClientRect();
      if (Math.abs(rect.width - measured.width) > 1 || Math.abs(rect.height - measured.height) > 1) stop();
    });
    resize.observe(line);
    const onVisibility = () => { if (document.hidden) stop(); };
    const onMotion = () => { if (reduced.matches) stop(); };
    document.addEventListener("visibilitychange", onVisibility);
    reduced.addEventListener("change", onMotion);

    void document.fonts.ready.then(() => {
      if (disposed || stopped || reduced.matches || document.hidden) return;
      frame = window.requestAnimationFrame(() => {
        timer = window.setTimeout(() => {
          if (disposed || stopped || reduced.matches || document.hidden) return;
          const bounds = line.getBoundingClientRect();
          const from = source.getBoundingClientRect();
          const to = target.getBoundingClientRect();
          measured = { width: bounds.width, height: bounds.height };
          const x1 = from.left - bounds.left + from.width / 2;
          const y1 = from.bottom - bounds.top + 3;
          const x2 = to.left - bounds.left + to.width / 2;
          const y2 = to.bottom - bounds.top - 1;
          // Measure both words: on narrow screens the destination may be on the next line.
          const at = (x: number, y: number, scale: number) => `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${scale})`;
          animations = [
            point.animate([
              { transform: at(x1, y1, 0.6), opacity: 0 },
              { transform: at(x1, y1, 1), opacity: 1, offset: 0.13 },
              { transform: at((x1 + x2) / 2, Math.min(y1, y2) - 15, 1), opacity: 1, offset: 0.5 },
              { transform: at(x2, y2, 1.1), opacity: 1, offset: 0.8 },
              { transform: at(x2, y2, 0.4), opacity: 0 },
            ], { duration: 1600, easing: "cubic-bezier(.22,.7,.2,1)" }),
            underline.animate([
              { transform: "scaleX(0)", opacity: 0 },
              { transform: "scaleX(.12)", opacity: 1, offset: 0.2 },
              { transform: "scaleX(1)", opacity: 1, offset: 0.75 },
              { transform: "scaleX(1)", opacity: 0 },
            ], { duration: 1000, delay: 1000, easing: "cubic-bezier(.22,.7,.2,1)" }),
          ];
          // Cancellation on navigation or preference changes is expected, not an error.
          void Promise.allSettled(animations.map((animation) => animation.finished));
        }, 300);
      });
    });

    return () => {
      disposed = true;
      stop();
      resize.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      reduced.removeEventListener("change", onMotion);
    };
  }, []);

  return (
    <div className="hero">
      <Wordmark size="clamp(34px, 11cqw, 72px)" />
      <p ref={tagline} className="tagline-en" lang="en">
        Focus Your <strong ref={attention} className="tagline-attention">Attention</strong> on{" "}
        <strong ref={value} className="tagline-value">Valuable Things.<span ref={sweep} className="tagline-sweep" aria-hidden="true" /></strong>
        <span ref={dot} className="tagline-dot" aria-hidden="true" />
      </p>
    </div>
  );
}
