import { useEffect, useRef, useState } from "preact/hooks";
import { hostApi, type SessionRecord } from "../../shared/api.ts";
import { SessionTail } from "../session/SessionTail.tsx";
import type { Page } from "../../app/Dock.tsx";
import { pointerOutside, type DropPoint } from "../windows/drag.ts";
import type { CodeTarget } from "../../app/route.ts";
import { closeTile, cycleLayout, focusTile, LAYOUT_LABELS, LAYOUTS, resizeTile, setLayout, swapWith, tileCount, tileFractions, visibleTiles, type Layout, type TileRef, type Workspace } from "./tiles.ts";
import { ariaCombo, comboLabel, registerShortcut } from "../../shared/shortcuts/registry.ts";
import { Button, Chip, EmptyState } from "../../shared/ui/index.ts";

/** Tiles below this height start with the controls folded (P18 premortem 3). */
const COMPACT_TILE_PX = 800;

/** EPIC-P18 T18.3/T18.4: up to four sessions side by side, Hyprland-style keys. */
export function TileWorkspace({
  ws,
  onChange,
  onNavigate,
  initialCode,
  initialTabView,
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
  /** EPIC-P48: Graph-/Datei-Tab aus der URL, für die Kachel dieser Session. */
  initialTabView?: { sessionId: string; tab: "graph" | "git" | "datei"; file?: string };
}) {
  const count = tileCount(ws.layout);
  // BUG-0071: the handler works on the NEWEST state, not the one of its last render — two shortcuts
  // within one tick (fast typing, a loaded machine) must compose instead of the second one
  // starting from the state before the first. EPIC-P51 T51.5: Registrierung
  // über die Shortcut-Registry statt eigenem window-Listener.
  const latest = useRef(ws);
  latest.current = ws;
  useEffect(() => {
    const apply = (next: Workspace | null) => {
      if (!next) return;
      latest.current = next;
      onChange(next);
    };
    const tile = (n: number, e: KeyboardEvent) => {
      e.preventDefault();
      const cur = latest.current;
      apply(e.shiftKey ? swapWith(cur, n - 1) : focusTile(cur, n - 1));
    };
    const offs = [
      registerShortcut("workspace.tile-1", (e) => tile(1, e)),
      registerShortcut("workspace.tile-2", (e) => tile(2, e)),
      registerShortcut("workspace.tile-3", (e) => tile(3, e)),
      registerShortcut("workspace.tile-4", (e) => tile(4, e)),
      registerShortcut("workspace.tile-swap-1", (e) => tile(1, e)),
      registerShortcut("workspace.tile-swap-2", (e) => tile(2, e)),
      registerShortcut("workspace.tile-swap-3", (e) => tile(3, e)),
      registerShortcut("workspace.tile-swap-4", (e) => tile(4, e)),
      registerShortcut("workspace.layout", (e) => {
        e.preventDefault();
        apply(cycleLayout(latest.current, e.shiftKey ? -1 : 1));
      }),
      registerShortcut("workspace.tile-close", (e) => {
        e.preventDefault();
        apply(closeTile(latest.current, latest.current.focus));
      }),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [onChange]);

  // A tile in a stacked layout gets half the height (or less).
  const stacked = ws.layout === "2h" || ws.layout === "2x2" || ws.layout === "1+2";
  const compact = stacked && window.innerHeight / 2 < COMPACT_TILE_PX;

  // QoL 2026-10-29 (K2): Kacheln per Divider-Zug größer/kleiner — der Zug
  // läuft über einen lokalen Override (kein State-Stampede während des
  // Ziehens), commit und Persistenz erst am Ende über onChange.
  const gridRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ axis: "col" | "row" | "col2"; fraction: number } | null>(null);
  const fractions = tileFractions(ws);
  const col = drag?.axis === "col" ? drag.fraction : fractions.col;
  const row = drag?.axis === "row" ? drag.fraction : fractions.row;
  const col2 = drag?.axis === "col2" ? drag.fraction : fractions.col2;
  const startDrag = (axis: "col" | "row" | "col2") => (e: PointerEvent) => {
    e.preventDefault();
    const grid = gridRef.current;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    const clampTo = (f: number) => Math.min(0.8, Math.max(0.2, f));
    const from = (ev: PointerEvent) => clampTo(axis === "row" ? (ev.clientY - rect.top) / rect.height : (ev.clientX - rect.left) / rect.width);
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
    // Spalten: erste Kachel `col`, Divider-Spur, Rest; Zeilen analog. Beim Dreispalter
    // gilt col2 als zweite Grenze; die Grenze darf col nie einholen (0.1 Mindest-Staffel).
    const threeCol = (() => {
      const c1 = Math.min(col, col2 - 0.1);
      const c2 = Math.max(col2, c1 + 0.1);
      return `${c1}fr 10px ${c2 - c1}fr 10px ${1 - c2}fr`;
    })();
    const cols = ws.layout === "3v" ? threeCol : ws.layout === "2v" || ws.layout === "1+2" || ws.layout === "2x2" ? `${col}fr 10px ${1 - col}fr` : "1fr";
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
          <Button
            key={layout}
            
            aria-pressed={layout === ws.layout}
            aria-label={LAYOUT_LABELS[layout]}
            aria-keyshortcuts={ariaCombo("workspace.layout")}
            title={`${LAYOUT_LABELS[layout]} (${comboLabel("workspace.layout")} wechselt)`}
            onClick={() => onChange(setLayout(ws, layout))}
           class={`tile-layout-btn${layout === ws.layout ? " active" : ""}`}>
            <LayoutGlyph layout={layout} />
          </Button>
        ))}
        {/* Dieselben Aktionen wie die Tastenkürzel, damit sie auch per Tipp gehen (Tablet, Touch). */}
        <div class="tile-actions" role="group" aria-label="Kachel-Aktionen">
          <Chip title={`Fokus auf die vorige Kachel (${comboLabel("workspace.tile-1")}–4 wählt direkt)`} data-shortcut="workspace.tile-1" disabled={count < 2} onClick={() => onChange(focusTile(ws, (ws.focus + count - 1) % count))}>
            ‹ Fokus
          </Chip>
          <Chip title={`Fokus auf die nächste Kachel (${comboLabel("workspace.tile-1")}–4 wählt direkt)`} data-shortcut="workspace.tile-1" disabled={count < 2} onClick={() => onChange(focusTile(ws, (ws.focus + 1) % count))}>
            Fokus ›
          </Chip>
          <Chip title={`Kachel mit der nächsten tauschen (${comboLabel("workspace.tile-swap-1")}–4)`} data-shortcut="workspace.tile-swap-1" disabled={count < 2} onClick={() => onChange(swapWith(ws, (ws.focus + 1) % count))}>
            ⇄ Tauschen
          </Chip>
          <Chip title={`Nächstes Layout (${comboLabel("workspace.layout")})`} data-shortcut="workspace.layout" onClick={() => onChange(cycleLayout(ws, 1))}>
            ⟳ Layout
          </Chip>
          <Chip title={`Fokussierte Kachel leeren (${comboLabel("workspace.tile-close")})`} data-shortcut="workspace.tile-close" onClick={() => onChange(closeTile(ws, ws.focus))}>
            ✕ Leeren
          </Chip>
          {/* EPIC-P51 T51.7: detaillierte Kürzelzeile durch ?-Übersicht ersetzt (aus T43.6 hierher gezogen). */}
          <span class="tile-keys dim">Tastatur: ? zeigt alle Kürzel · Strg-Klick: neue Kachel</span>
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
            {...(initialTabView && ref?.sessionId === initialTabView.sessionId ? { initialTabView } : {})}
          />
        ))}
        {/* Divider nach den Kacheln — <div> neben <section>, damit die
         * nth-of-type-Platzierung der Kacheln unberührt bleibt. */}
        {(ws.layout === "2v" || ws.layout === "1+2" || ws.layout === "2x2" || ws.layout === "3v") && (
          <div
            class="tile-divider col"
            role="separator"
            aria-orientation="vertical"
            aria-label="Kachelbreite ändern"
            onPointerDown={startDrag("col")}
          />
        )}
        {ws.layout === "3v" && (
          <div
            class="tile-divider col second"
            role="separator"
            aria-orientation="vertical"
            aria-label="Kachelbreite ändern"
            onPointerDown={startDrag("col2")}
          />
        )}
        {ws.layout !== "1" && ws.layout !== "2v" && ws.layout !== "3v" && (
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
  initialTabView,
}: {
  onPopout?: (drop?: DropPoint) => void;
  initialCode?: CodeTarget;
  initialTabView?: { sessionId: string; tab: "graph" | "git" | "datei"; file?: string };
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

  // EPIC-P43 T43.6: ein Kopf je Kachel — mit Session trägt ihn SessionTail (Titel, Zustand, Reiter dazwischen).
  const headStart = (
    <>
      <span class="tile-no">{index + 1}</span>
      {onPopout && (
        <span class={`tile-grip${dragOut ? " dragging" : ""}`} aria-hidden="true" title="Aus dem Fenster ziehen: eigenes Fenster (Alternative: ⧉)" onPointerDown={startGrip}>
          ⠿{dragOut ? " Loslassen öffnet ein eigenes Fenster" : ""}
        </span>
      )}
    </>
  );
  const headEnd = (
    <>
      {onPopout && (
        <button type="button" class="tile-popout" aria-label={`Kachel ${index + 1} in eigenem Fenster öffnen`} title="In eigenem Fenster öffnen" onClick={() => onPopout()}>
          ⧉
        </button>
      )}
      <button type="button" class="tile-close" aria-label={`Kachel ${index + 1} leeren`} title="Kachel leeren (Alt+W)" onClick={onClose}>
        ×
      </button>
    </>
  );
  return (
    <section
      class={`tile${focused ? " focused" : ""}${dragOut ? " drag-out" : ""}`}
      data-tile={index + 1}
      aria-label={`Kachel ${index + 1}`}
      onPointerDownCapture={onFocus}
      onFocusCapture={onFocus}
    >
      {tileRef && !session && (
        <div class="tile-head">
          {headStart}
          {headEnd}
        </div>
      )}
      {!tileRef ? (
        <div class="ui-empty tile-empty">
          Kachel {index + 1} ist frei — Session links wählen
          {index > 0 && <div class="dim">Strg-Klick in der Liste öffnet in einer neuen Kachel</div>}
        </div>
      ) : missing ? (
        // P18 premortem 4: a remembered session that is gone says so.
        <div class="ui-empty tile-empty" data-testid="tile-missing">
          Diese Session gibt es nicht mehr oder sie ist nicht erreichbar.
          <Button onClick={onClose}>
            Kachel leeren
          </Button>
        </div>
      ) : session ? (
        <SessionTail key={session.id} session={session} onNavigate={onNavigate} tile={{ active, compact, head: { start: headStart, end: headEnd } }} {...(initialCode ? { initialCode } : {})} {...(initialTabView ? { initialTab: initialTabView.tab, ...(initialTabView.file ? { initialFile: initialTabView.file } : {}) } : {})} />
      ) : (
        <EmptyState class="tile-empty dim" text="lädt…" />
      )}
    </section>
  );
}
