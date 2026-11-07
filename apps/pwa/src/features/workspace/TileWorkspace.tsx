import { useEffect, useRef, useState } from "preact/hooks";
import { hostApi, type SessionRecord } from "../../shared/api.ts";
import { SessionTail } from "../session/SessionTail.tsx";
import type { Page } from "../../app/Dock.tsx";
import { pointerOutside, type DropPoint } from "../windows/drag.ts";
import type { CodeTarget } from "../../app/route.ts";
import { closeTile, cycleLayout, focusTile, LAYOUT_LABELS, LAYOUTS, resizeTile, setLayout, swapWith, tileCount, tileFractions, visibleTiles, type Layout, type TileRef, type Workspace } from "./tiles.ts";

/** Tiles below this height start with the controls folded (P18 premortem 3). */
const COMPACT_TILE_PX = 800;

/** EPIC-P18 T18.3/T18.4: up to four sessions side by side, Hyprland-style keys. */
export function TileWorkspace({
  ws,
  onChange,
  onNavigate,
  initialCode,
  listCollapsed,
  onToggleList,
  onPopout,
}: {
  /** EPIC-P34 T34.10: die Session der Kachel in ein eigenes Fenster legen. */
  onPopout?: (index: number, drop?: DropPoint) => void;
  listCollapsed: boolean;
  onToggleList: () => void;
  ws: Workspace;
  onChange: (ws: Workspace) => void;
  onNavigate: (page: Page) => void;
  /** T7.6 code anchor from the URL, for the tile showing that session. */
  initialCode?: { sessionId: string; code: CodeTarget };
}) {
  const count = tileCount(ws.layout);
  // BUG-0071: the handler works on the NEWEST state, not the one of its last render — two shortcuts
  // within one tick (fast typing, a loaded machine) must compose instead of the second one
  // starting from the state before the first.
  const latest = useRef(ws);
  latest.current = ws;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const cur = latest.current;
      const n = /^Digit([1-4])$/.exec(e.code)?.[1];
      let next: Workspace | null = null;
      if (n) next = e.shiftKey ? swapWith(cur, Number(n) - 1) : focusTile(cur, Number(n) - 1);
      else if (e.code === "KeyL") next = cycleLayout(cur, e.shiftKey ? -1 : 1);
      else if (e.code === "KeyW" && !e.shiftKey) next = closeTile(cur, cur.focus);
      if (!next) return;
      e.preventDefault();
      latest.current = next;
      onChange(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onChange]);

  // A tile in a stacked layout gets half the height (or less).
  const stacked = ws.layout === "2h" || ws.layout === "2x2" || ws.layout === "1+2";
  const compact = stacked && window.innerHeight / 2 < COMPACT_TILE_PX;

  // QoL 2026-10-29 (K2): Kacheln per Divider-Zug größer/kleiner — der Zug
  // läuft über einen lokalen Override (kein State-Stampede während des
  // Ziehens), commit und Persistenz erst am Ende über onChange.
  const gridRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ axis: "col" | "row"; fraction: number } | null>(null);
  const fractions = tileFractions(ws);
  const col = drag?.axis === "col" ? drag.fraction : fractions.col;
  const row = drag?.axis === "row" ? drag.fraction : fractions.row;
  const startDrag = (axis: "col" | "row") => (e: PointerEvent) => {
    e.preventDefault();
    const grid = gridRef.current;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    const clampTo = (f: number) => Math.min(0.8, Math.max(0.2, f));
    const from = (ev: PointerEvent) => clampTo(axis === "col" ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height);
    const move = (ev: PointerEvent) => setDrag({ axis, fraction: from(ev) });
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      onChange(resizeTile(latest.current, axis, from(ev)));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    setDrag({ axis, fraction: from(e) });
  };
  const template = (() => {
    // Spalten: erste Kachel `col`, Divider-Spur, Rest; Zeilen analog.
    const cols = ws.layout === "2v" || ws.layout === "1+2" || ws.layout === "2x2" ? `${col}fr 10px ${1 - col}fr` : "1fr";
    const rows = ws.layout === "2h" || ws.layout === "1+2" || ws.layout === "2x2" ? `${row}fr 10px ${1 - row}fr` : "1fr";
    return { gridTemplateColumns: cols, gridTemplateRows: rows } as const;
  })();

  return (
    <div class="tile-workspace">
      <div class="tile-bar" role="toolbar" aria-label="Kachel-Layout">
        <button type="button" class="tile-list-toggle" onClick={onToggleList} aria-expanded={!listCollapsed}>
          {listCollapsed ? "☰ Liste ausklappen" : "⟨ Liste einklappen"}
        </button>
        {LAYOUTS.map((layout) => (
          <button
            key={layout}
            type="button"
            class={`tile-layout-btn${layout === ws.layout ? " active" : ""}`}
            aria-pressed={layout === ws.layout}
            aria-label={LAYOUT_LABELS[layout]}
            title={`${LAYOUT_LABELS[layout]} (Alt+L wechselt)`}
            onClick={() => onChange(setLayout(ws, layout))}
          >
            <LayoutGlyph layout={layout} />
          </button>
        ))}
        {/* Dieselben Aktionen wie die Tastenkürzel, damit sie auch per Tipp gehen (Tablet, Touch). */}
        <div class="tile-actions" role="group" aria-label="Kachel-Aktionen">
          <button type="button" class="chip" title="Fokus auf die vorige Kachel (Alt+1–4 wählt direkt)" disabled={count < 2} onClick={() => onChange(focusTile(ws, (ws.focus + count - 1) % count))}>
            ‹ Fokus
          </button>
          <button type="button" class="chip" title="Fokus auf die nächste Kachel (Alt+1–4 wählt direkt)" disabled={count < 2} onClick={() => onChange(focusTile(ws, (ws.focus + 1) % count))}>
            Fokus ›
          </button>
          <button type="button" class="chip" title="Kachel mit der nächsten tauschen (Alt+Shift+1–4)" disabled={count < 2} onClick={() => onChange(swapWith(ws, (ws.focus + 1) % count))}>
            ⇄ Tauschen
          </button>
          <button type="button" class="chip" title="Nächstes Layout (Alt+L)" onClick={() => onChange(cycleLayout(ws, 1))}>
            ⟳ Layout
          </button>
          <button type="button" class="chip" title="Fokussierte Kachel leeren (Alt+W)" onClick={() => onChange(closeTile(ws, ws.focus))}>
            ✕ Leeren
          </button>
          <span class="tile-keys dim">Tastatur: Alt+1–4 · Alt+Shift+1–4 · Alt+L · Alt+W · Strg-Klick: neue Kachel</span>
        </div>
      </div>
      <div ref={gridRef} class={`tile-grid layout-${ws.layout.replace("+", "p")}`} style={template}>
        {visibleTiles(ws).map((ref, i) => (
          <Tile
            key={i}
            index={i}
            tileRef={ref}
            focused={i === ws.focus && count > 1}
            active={i === ws.focus}
            compact={compact && !(ws.layout === "1+2" && i === 0)}
            onFocus={() => i !== ws.focus && onChange(focusTile(ws, i))}
            onClose={() => onChange(closeTile(ws, i))}
            {...(onPopout ? { onPopout: (drop?: DropPoint) => onPopout(i, drop) } : {})}
            onNavigate={onNavigate}
            {...(initialCode && ref?.sessionId === initialCode.sessionId ? { initialCode: initialCode.code } : {})}
          />
        ))}
        {/* Divider nach den Kacheln — <div> neben <section>, damit die
         * nth-of-type-Platzierung der Kacheln unberührt bleibt. */}
        {(ws.layout === "2v" || ws.layout === "1+2" || ws.layout === "2x2") && (
          <div
            class="tile-divider col"
            role="separator"
            aria-orientation="vertical"
            aria-label="Kachelbreite ändern"
            onPointerDown={startDrag("col")}
          />
        )}
        {ws.layout !== "1" && ws.layout !== "2v" && (
          <div
            class={`tile-divider row${ws.layout === "1+2" ? " right-only" : ""}`}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Kachelhöhe ändern"
            onPointerDown={startDrag("row")}
          />
        )}
      </div>
    </div>
  );
}

function LayoutGlyph({ layout }: { layout: Layout }) {
  return (
    <span class={`tile-glyph layout-${layout.replace("+", "p")}`} aria-hidden="true">
      {Array.from({ length: tileCount(layout) }, (_, i) => (
        <span key={i} />
      ))}
    </span>
  );
}

function Tile({
  index,
  tileRef,
  focused,
  active,
  compact,
  onFocus,
  onClose,
  onPopout,
  onNavigate,
  initialCode,
}: {
  onPopout?: (drop?: DropPoint) => void;
  initialCode?: CodeTarget;
  index: number;
  tileRef: TileRef | null;
  focused: boolean;
  active: boolean;
  compact: boolean;
  onFocus: () => void;
  onClose: () => void;
  onNavigate: (page: Page) => void;
}) {
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [missing, setMissing] = useState(false);
  // EPIC-P34 T34.11: am Griff aus dem Fenster ziehen. Der Zeiger bleibt erfasst, auch außerhalb des Fensters.
  const [dragOut, setDragOut] = useState(false);
  const startGrip = (e: PointerEvent) => {
    if (!onPopout || e.button !== 0) return;
    const grip = e.currentTarget as HTMLElement;
    grip.setPointerCapture(e.pointerId);
    const outside = (ev: PointerEvent) => pointerOutside(ev.clientX, ev.clientY, { width: window.innerWidth, height: window.innerHeight });
    const move = (ev: PointerEvent) => setDragOut(outside(ev));
    const end = (ev: PointerEvent, drop: boolean) => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", cancel);
      setDragOut(false);
      if (drop && outside(ev)) onPopout({ left: ev.screenX, top: ev.screenY });
    };
    const up = (ev: PointerEvent) => end(ev, true);
    const cancel = (ev: PointerEvent) => end(ev, false);
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", cancel);
  };
  useEffect(() => {
    setSession(null);
    setMissing(false);
    if (!tileRef) return;
    let alive = true;
    hostApi(tileRef.hostId)
      .session(tileRef.sessionId)
      .then((s) => alive && setSession(s))
      .catch(() => alive && setMissing(true));
    return () => {
      alive = false;
    };
  }, [tileRef?.sessionId, tileRef?.hostId]);

  return (
    <section
      class={`tile${focused ? " focused" : ""}${dragOut ? " drag-out" : ""}`}
      data-tile={index + 1}
      aria-label={`Kachel ${index + 1}`}
      onPointerDownCapture={onFocus}
      onFocusCapture={onFocus}
    >
      {tileRef && (
        <div class="tile-head">
          <span class="tile-no">{index + 1}</span>
          {onPopout && (
            <span class="tile-grip" aria-hidden="true" title="Aus dem Fenster ziehen: eigenes Fenster (Alternative: ⧉)" onPointerDown={startGrip}>
              ⠿ {dragOut ? "Loslassen öffnet ein eigenes Fenster" : ""}
            </span>
          )}
          {onPopout && (
            <button type="button" class="tile-popout" aria-label={`Kachel ${index + 1} in eigenem Fenster öffnen`} title="In eigenem Fenster öffnen" onClick={() => onPopout()}>
              ⧉
            </button>
          )}
          <button type="button" class="tile-close" aria-label={`Kachel ${index + 1} leeren`} title="Kachel leeren (Alt+W)" onClick={onClose}>
            ×
          </button>
        </div>
      )}
      {!tileRef ? (
        <div class="empty tile-empty">
          Kachel {index + 1} ist frei — Session links wählen
          {index > 0 && <div class="dim">Strg-Klick in der Liste öffnet in einer neuen Kachel</div>}
        </div>
      ) : missing ? (
        // P18 premortem 4: a remembered session that is gone says so.
        <div class="empty tile-empty tile-missing">
          Diese Session gibt es nicht mehr oder sie ist nicht erreichbar.
          <button type="button" class="btn" onClick={onClose}>
            Kachel leeren
          </button>
        </div>
      ) : session ? (
        <SessionTail key={session.id} session={session} onNavigate={onNavigate} tile={{ active, compact }} {...(initialCode ? { initialCode } : {})} />
      ) : (
        <div class="empty tile-empty dim">lädt…</div>
      )}
    </section>
  );
}
