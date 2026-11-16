/**
 * EPIC-P18 T18.2: the tile workspace as plain data — which layout, which
 * session in which tile, which tile has focus. Rendering and keys live in
 * TileWorkspace.tsx; everything here is pure and unit-tested.
 *
 * There are always four slots; the layout decides how many are visible.
 * A slot hidden by a smaller layout keeps its session, so switching back
 * brings it back instead of silently dropping it.
 */

export const LAYOUTS = ["1", "2v", "3v", "2h", "1+2", "2x2"] as const;
export type Layout = (typeof LAYOUTS)[number];

export interface TileRef {
  sessionId: string;
  hostId?: string;
}

export interface Workspace {
  layout: Layout;
  slots: (TileRef | null)[];
  focus: number;
  /** QoL 2026-10-29: gezogene Kachelgrößen — Anteil der ersten Spalte
   * (zweispaltige Layouts) bzw. ersten Zeile (zweizeilige) als Bruchteil,
   * je auf 0.2–0.8 geklemmt. Ohne Angabe gilt der Layout-Default. */
  sizes?: { col?: number; row?: number; col2?: number };
  /** EPIC-P34 T34.10: Sessions, die in einem eigenen Fenster laufen. Fehlt in alten Ständen. */
  detached?: TileRef[];
}

const COUNT: Record<Layout, number> = { "1": 1, "2v": 2, "3v": 3, "2h": 2, "1+2": 3, "2x2": 4 };
/** "Open in a new tile" grows along this path. */
const GROW: Record<number, Layout> = { 1: "2v", 2: "1+2", 3: "2x2" };

export const LAYOUT_LABELS: Record<Layout, string> = {
  "1": "Eine Kachel",
  "2v": "Zwei nebeneinander",
  "3v": "Drei nebeneinander",
  "2h": "Zwei übereinander",
  "1+2": "Eine groß, zwei daneben",
  "2x2": "Vier als Raster",
};

export function tileCount(layout: Layout): number {
  return COUNT[layout];
}

export function emptyWorkspace(): Workspace {
  return { layout: "1", slots: [null, null, null, null], focus: 0 };
}

export function visibleTiles(ws: Workspace): (TileRef | null)[] {
  return ws.slots.slice(0, COUNT[ws.layout]);
}

function same(x: TileRef | null, y: TileRef): boolean {
  return x !== null && x.sessionId === y.sessionId && (x.hostId ?? null) === (y.hostId ?? null);
}

function put(ws: Workspace, index: number, ref: TileRef | null): Workspace {
  const slots = [...ws.slots];
  slots[index] = ref;
  return { ...ws, slots, focus: index };
}

/** Clicking a session: focus it where it already shows; else the focused
 * tile if empty, else the first empty tile, else replace the focused one. */
export function openSession(ws: Workspace, ref: TileRef): Workspace {
  const shown = visibleTiles(ws);
  const at = shown.findIndex((t) => same(t, ref));
  if (at >= 0) return { ...ws, focus: at };
  if (shown[ws.focus] === null) return put(ws, ws.focus, ref);
  const empty = shown.indexOf(null);
  return put(ws, empty >= 0 ? empty : ws.focus, ref);
}

/** Ctrl/⌘-click: one more tile for this session, up to four. */
export function openInNewTile(ws: Workspace, ref: TileRef): Workspace {
  const shown = visibleTiles(ws);
  const at = shown.findIndex((t) => same(t, ref));
  if (at >= 0) return { ...ws, focus: at };
  const empty = shown.indexOf(null);
  if (empty >= 0) return put(ws, empty, ref);
  const grown = GROW[shown.length];
  if (!grown) return put(ws, ws.focus, ref);
  return put({ ...ws, layout: grown }, shown.length, ref);
}

export function setLayout(ws: Workspace, layout: Layout): Workspace {
  return { ...ws, layout, focus: Math.min(ws.focus, COUNT[layout] - 1) };
}

export function cycleLayout(ws: Workspace, dir: 1 | -1): Workspace {
  const i = LAYOUTS.indexOf(ws.layout);
  return setLayout(ws, LAYOUTS[(i + dir + LAYOUTS.length) % LAYOUTS.length]!);
}

export function focusTile(ws: Workspace, index: number): Workspace {
  return index >= 0 && index < COUNT[ws.layout] ? { ...ws, focus: index } : ws;
}

/** Hyprland's swap: the focused session trades places with tile n. */
export function swapWith(ws: Workspace, index: number): Workspace {
  if (index < 0 || index >= COUNT[ws.layout] || index === ws.focus) return ws;
  const slots = [...ws.slots];
  [slots[ws.focus], slots[index]] = [slots[index]!, slots[ws.focus]!];
  return { ...ws, slots, focus: index };
}

export function closeTile(ws: Workspace, index: number): Workspace {
  return put(ws, index, null);
}

const MIN_TILE_SHARE = 0.2;
const MAX_TILE_SHARE = 0.8;

/** Wirksame Anteile inklusive Layout-Default („1+2“ startet 1.35:1, „3v“ drittelgleich).
 * col2 ist die zweite Spaltengrenze des Dreispalters und bleibt immer ein Stück rechts von col. */
export function tileFractions(ws: Workspace): { col: number; row: number; col2: number } {
  const clamp = (v: number | undefined, d: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(MAX_TILE_SHARE, Math.max(MIN_TILE_SHARE, v)) : d;
  const col = clamp(ws.sizes?.col, ws.layout === "1+2" ? 0.575 : ws.layout === "3v" ? 1 / 3 : 0.5);
  return { col, row: clamp(ws.sizes?.row, 0.5), col2: Math.max(clamp(ws.sizes?.col2, 2 / 3), col + 0.1) };
}

/** Ein beendeter Divider-Zug: Anteil speichern (geklemmt auf 0.2–0.8). */
export function resizeTile(ws: Workspace, axis: "col" | "row" | "col2", fraction: number): Workspace {
  const f = Math.min(MAX_TILE_SHARE, Math.max(MIN_TILE_SHARE, fraction));
  return { ...ws, sizes: { ...ws.sizes, [axis]: f } };
}

export function isDetached(ws: Workspace, ref: TileRef): boolean {
  return (ws.detached ?? []).some((d) => same(d, ref));
}

/** Die Kachel wandert in ein eigenes Fenster: Platz frei, Session wird vermerkt. */
export function detachTile(ws: Workspace, index: number): Workspace {
  const ref = ws.slots[index];
  if (!ref) return ws;
  const detached = isDetached(ws, ref) ? (ws.detached ?? []) : [...(ws.detached ?? []), ref];
  return { ...put(ws, index, null), focus: ws.focus, detached };
}

/** „In die App zurück“: aus der Liste der Fenster nehmen und wieder in eine Kachel öffnen. */
export function reattach(ws: Workspace, ref: TileRef): Workspace {
  const rest = (ws.detached ?? []).filter((d) => !same(d, ref));
  const { detached: _old, ...base } = ws;
  return openSession(rest.length > 0 ? { ...base, detached: rest } : base, ref);
}

/** Ein Fenster, das nicht mehr antwortet, ist keine Ablage mehr: nur aus der Liste nehmen. */
export function forgetDetached(ws: Workspace, ref: TileRef): Workspace {
  const rest = (ws.detached ?? []).filter((d) => !same(d, ref));
  const { detached: _old, ...base } = ws;
  return rest.length > 0 ? { ...base, detached: rest } : base;
}

export function serializeWorkspace(ws: Workspace): string {
  return JSON.stringify(ws);
}

function tileRef(raw: unknown): TileRef | null {
  if (!raw || typeof raw !== "object") return null;
  const { sessionId, hostId } = raw as { sessionId?: unknown; hostId?: unknown };
  if (typeof sessionId !== "string" || !sessionId) return null;
  return typeof hostId === "string" && hostId ? { sessionId, hostId } : { sessionId };
}

/** Whatever localStorage holds: a valid workspace or an empty one. */
export function parseWorkspace(raw: string | null): Workspace {
  if (!raw) return emptyWorkspace();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return emptyWorkspace();
  }
  const { layout, slots, focus, sizes, detached } = (data ?? {}) as { layout?: unknown; slots?: unknown; focus?: unknown; sizes?: unknown; detached?: unknown };
  if (!LAYOUTS.includes(layout as Layout) || !Array.isArray(slots)) return emptyWorkspace();
  const ws: Workspace = { layout: layout as Layout, slots: [0, 1, 2, 3].map((i) => tileRef(slots[i])), focus: 0 };
  const sized =
    sizes && typeof sizes === "object"
      ? {
          ...(typeof (sizes as { col?: unknown }).col === "number" ? { col: (sizes as { col: number }).col } : {}),
          ...(typeof (sizes as { row?: unknown }).row === "number" ? { row: (sizes as { row: number }).row } : {}),
          ...(typeof (sizes as { col2?: unknown }).col2 === "number" ? { col2: (sizes as { col2: number }).col2 } : {}),
        }
      : undefined;
  const away = Array.isArray(detached) ? detached.map(tileRef).filter((r): r is TileRef => r !== null) : [];
  return focusTile({ ...ws, ...(sized && (sized.col !== undefined || sized.row !== undefined || sized.col2 !== undefined) ? { sizes: sized } : {}), ...(away.length > 0 ? { detached: away } : {}) }, typeof focus === "number" ? focus : 0);
}
