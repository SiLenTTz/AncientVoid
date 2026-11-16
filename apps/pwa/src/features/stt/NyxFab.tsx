import { useEffect, useRef, useState } from "preact/hooks";
import { NyxSprite } from "../nyx/Nyx.tsx";
import { clampFabPos, fabBreakpoint, loadFabPos, saveFabPos, type FabPos } from "./fab-position.ts";
import { installFocusTracker } from "./paste-target.ts";
import { usePushToTalk } from "./use-push-to-talk.ts";

const DRAG_THRESHOLD = 8;

/**
 * Globaler, verschiebbarer Nyx-FAB: einziger Auslöser für Speech-to-Text in die
 * fokussierte Eingabe (+ Zwischenablage). Position je Breakpoint persistiert.
 */
export function NyxFab() {
  const stt = usePushToTalk();
  const [bp, setBp] = useState(() => fabBreakpoint());
  const [pos, setPos] = useState<FabPos>(() => loadFabPos(fabBreakpoint(), window.innerWidth, window.innerHeight));
  const posRef = useRef(pos);
  posRef.current = pos;
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const suppressClick = useRef(false);

  useEffect(() => installFocusTracker(), []);

  useEffect(() => {
    // Ohne eigene Platzierung folgt der FAB der Dock-Oberkante (BUG-0138): beim Laden, Seitenwechsel,
    // Fenstergröße und wenn der Dock selbst wächst (Steuerzeilen kommen/gehen).
    let observed: Element | null = null;
    const place = () => {
      if (drag.current) return; // Handy: Adressleiste/Tastatur feuern resize mitten im Ziehen
      const next = fabBreakpoint();
      const dock = document.querySelector(".dock-stack");
      if (dock !== observed) {
        if (observed) dockObserver.unobserve(observed);
        if (dock) dockObserver.observe(dock);
        observed = dock;
      }
      const rect = dock?.getBoundingClientRect();
      // Nur ein Dock, der unten über die Breite liegt — die senkrechte Icon-Leiste am Desktop zählt nicht.
      const bottomDock = rect && rect.width >= window.innerWidth / 2 && rect.bottom >= window.innerHeight - 4;
      const target = loadFabPos(next, window.innerWidth, window.innerHeight, bottomDock ? rect.top : undefined);
      setBp(next);
      setPos((prev) => (prev.x === target.x && prev.y === target.y ? prev : target));
    };
    const dockObserver = new ResizeObserver(place);
    let settle: number[] = [];
    const placeSoon = () => {
      place();
      settle.forEach(clearTimeout);
      // Die Seite rendert ihren Dock erst nach Hash-Wechsel bzw. geladenen Daten.
      settle = [300, 1000, 2500].map((ms) => window.setTimeout(place, ms));
    };
    placeSoon();
    window.addEventListener("resize", place);
    window.addEventListener("hashchange", placeSoon);
    return () => {
      settle.forEach(clearTimeout);
      dockObserver.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("hashchange", placeSoon);
    };
  }, []);

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { sx: e.clientX, sy: e.clientY, ox: posRef.current.x, oy: posRef.current.y, moved: false };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) d.moved = true;
    if (d.moved) {
      const next = clampFabPos({ x: d.ox + dx, y: d.oy + dy }, window.innerWidth, window.innerHeight);
      posRef.current = next;
      setPos(next);
    }
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (!d) return;
    if (d.moved) {
      suppressClick.current = true;
      const next = clampFabPos(posRef.current, window.innerWidth, window.innerHeight);
      posRef.current = next;
      setPos(next);
      saveFabPos(bp, next);
    }
  };

  const unavailable = !stt.supported || (stt.listening && !stt.recording);
  const onClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (unavailable) return;
    void stt.toggle();
  };

  const state = stt.recording || stt.listening ? "question" : "quiet";
  const label = stt.listening ? "Spracherkennung läuft…" : stt.recording ? "Aufnahme stoppen" : "Spracheingabe";

  return (
    <>
      <button
        type="button"
        data-nyx-fab
        data-testid="nyx-fab"
        data-bp={bp}
        class={`nyx-fab${dragging ? " dragging" : ""}${stt.recording ? " recording" : ""}${stt.listening ? " busy" : ""}`}
        style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
        aria-label={label}
        aria-busy={stt.listening}
        title={stt.title}
        aria-disabled={unavailable}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onClick}
      >
        <NyxSprite state={state} size={48} />
      </button>
      {(stt.recording || stt.listening || stt.error || stt.info || stt.partial) && (
        <div class="nyx-fab-toast" role="status" aria-live="polite" data-testid="nyx-fab-toast" style={{ left: `${Math.min(pos.x, window.innerWidth - 280)}px`, top: `${Math.max(8, pos.y - 72)}px` }}>
          {stt.recording && <div>🔴 Aufnahme — tippe erneut zum Stoppen</div>}
          {stt.recording && stt.streamNotice && <div class="dim">{stt.streamNotice}</div>}
          {stt.recording && stt.partial && <div>Vorschau (wird nicht ausgeführt): {stt.partial}</div>}
          {stt.listening && !stt.localAvailable && <div>🔴 höre zu… (Spracherkennung läuft meist über einen Cloud-Dienst des Browsers)</div>}
          {stt.info && !stt.error && <div class="dim">{stt.info}</div>}
          {stt.error && <div class="err">{stt.error}</div>}
        </div>
      )}
    </>
  );
}
