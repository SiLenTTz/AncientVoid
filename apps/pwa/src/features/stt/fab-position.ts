/** Persistierte FAB-Position je Breakpoint (Handy / Tablet / PC). */

export type FabBreakpoint = "phone" | "tablet" | "pc";

export interface FabPos {
  x: number;
  y: number;
}

const KEY = "ancientvoid.nyx-fab.v1";

/** Muss zu `.nyx-fab` in 43-nyx-fab.css passen. */
export const FAB_SIZE = 64;

export function fabBreakpoint(width = typeof window !== "undefined" ? window.innerWidth : 390): FabBreakpoint {
  if (width >= 1280) return "pc";
  if (width >= 700) return "tablet";
  return "phone";
}

/** Default: Handy/Tablet rechts unten über dem Dock; PC mittig im Viewport. */
export function defaultFabPos(bp: FabBreakpoint, vw: number, vh: number): FabPos {
  const size = FAB_SIZE;
  if (bp === "pc") {
    return { x: Math.round((vw - size) / 2), y: Math.round((vh - size) / 2) };
  }
  // Dock ~78px + Safe-Area; FAB sitzt darüber, rechts.
  const dock = 88;
  return {
    x: Math.max(8, vw - size - 16),
    y: Math.max(8, vh - size - dock - 12),
  };
}

export function loadFabPos(bp: FabBreakpoint, vw: number, vh: number): FabPos {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Record<FabBreakpoint, FabPos>>;
    const stored = raw[bp];
    if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) {
      return clampFabPos(stored, vw, vh);
    }
  } catch {
    // ignore
  }
  return defaultFabPos(bp, vw, vh);
}

export function saveFabPos(bp: FabBreakpoint, pos: FabPos): void {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Record<FabBreakpoint, FabPos>>;
    raw[bp] = pos;
    localStorage.setItem(KEY, JSON.stringify(raw));
  } catch {
    // ignore
  }
}

export function clampFabPos(pos: FabPos, vw: number, vh: number, size = FAB_SIZE): FabPos {
  return {
    x: Math.min(Math.max(0, pos.x), Math.max(0, vw - size)),
    y: Math.min(Math.max(0, pos.y), Math.max(0, vh - size)),
  };
}
