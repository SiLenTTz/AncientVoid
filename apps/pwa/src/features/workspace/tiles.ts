/**
 * EPIC-P18 T18.2: the tile workspace as plain data — which layout, which
 * session in which tile, which tile has focus. Rendering and keys live in
 * TileWorkspace.tsx; everything here is pure and unit-tested.
 *
 * There are always four slots; the layout decides how many are visible.
 * A slot hidden by a smaller layout keeps its session, so switching back
 * brings it back instead of silently dropping it.
 */

export const LAYOUTS = ["1", "2v", "2h", "1+2", "2x2"] as const;
export type Layout = (typeof LAYOUTS)[number];

export interface TileRef {
  sessionId: string;
  hostId?: string;
}

export interface Workspace {
  layout: Layout;
  slots: (TileRef | null)[];
  focus: number;
}

const COUNT: Record<Layout, number> = { "1": 1, "2v": 2, "2h": 2, "1+2": 3, "2x2": 4 };
/** "Open in a new tile" grows along this path. */
const GROW: Record<number, Layout> = { 1: "2v", 2: "1+2", 3: "2x2" };

export const LAYOUT_LABELS: Record<Layout, string> = {
  "1": "Eine Kachel",
  "2v": "Zwei nebeneinander",
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
  const { layout, slots, focus } = (data ?? {}) as { layout?: unknown; slots?: unknown; focus?: unknown };
  if (!LAYOUTS.includes(layout as Layout) || !Array.isArray(slots)) return emptyWorkspace();
  const ws: Workspace = { layout: layout as Layout, slots: [0, 1, 2, 3].map((i) => tileRef(slots[i])), focus: 0 };
  return focusTile(ws, typeof focus === "number" ? focus : 0);
}
