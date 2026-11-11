import { useEffect, useRef, useState } from "preact/hooks";
import { countStep, motionAllowed } from "./motion.ts";

/**
 * EPIC-P43 T43.2 „Zählen“: eine Zahl, die live ist (Tokens, Kosten, Laufzeit), läuft auf ihren neuen
 * Wert zu, statt zu springen. Ohne Bewegung steht sofort der Zielwert da. Es läuft nur, solange sich
 * der Wert ändert — kein Dauer-Timer (K2).
 */
export function useCounted(target: number): number {
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    if (current.current === target) return;
    if (!motionAllowed() || !Number.isFinite(target)) {
      current.current = target;
      setShown(target);
      return;
    }
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      current.current = countStep(current.current, target, now - last);
      last = now;
      setShown(current.current);
      if (current.current !== target) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return shown;
}
