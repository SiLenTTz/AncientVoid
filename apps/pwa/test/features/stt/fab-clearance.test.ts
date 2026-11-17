import { describe, expect, it } from "vitest";

import { placeFabAvoiding, type FabRect } from "../../../src/features/stt/fab-clearance.ts";

/** BUG-0199: der FAB darf auf langen Seiten kein Bedienelement verdecken. */
describe("FAB weicht verdeckten Controls aus", () => {
  const SIZE = 64;

  /** Belegt ist die Stelle, wenn ein Control-Rechtwinkel sie schneidet. */
  const blocker = (controls: FabRect[]) => (r: FabRect): boolean =>
    controls.some((c) => r.x < c.x + c.w && r.x + r.w > c.x && r.y < c.y + c.h && r.y + r.h > c.y);

  it("bleibt unveraendert, wenn nichts im Weg ist", () => {
    const got = placeFabAvoiding({ x: 310, y: 711 }, blocker([]), 390, 844, SIZE);
    expect(got).toEqual({ pos: { x: 310, y: 711 }, moved: false });
  });

  it("rueckt eine Kantenlaenge hoch, wenn darunter ein Schalter liegt", () => {
    // Gemessener Fall BUG-0199: Pinch-Zoom-Schalter mitten in der FAB-Flaeche.
    const control: FabRect = { x: 300, y: 730, w: 60, h: 32 };
    const got = placeFabAvoiding({ x: 310, y: 711 }, blocker([control]), 390, 844, SIZE);
    expect(got.moved).toBe(true);
    expect(got.pos).not.toBeNull();
    expect(got.pos!.y).toBeLessThan(711);
    const frei = blocker([control])({ x: got.pos!.x, y: got.pos!.y, w: SIZE, h: SIZE });
    expect(frei).toBe(false);
  });

  it("weicht nach unten aus, wenn nach oben kein Platz ist", () => {
    const control: FabRect = { x: 300, y: 20, w: 60, h: 32 };
    const got = placeFabAvoiding({ x: 310, y: 40 }, blocker([control]), 390, 844, SIZE);
    expect(got.pos).not.toBeNull();
    expect(got.pos!.y).toBeGreaterThan(40);
  });

  it("meldet null, wenn weit und breit nichts frei ist", () => {
    // Wand an Wand Controls: jeder Kandidat ist belegt.
    const kacheln: FabRect[] = [];
    for (let y = 0; y < 844; y += 40) kacheln.push({ x: 0, y, w: 390, h: 40 });
    const got = placeFabAvoiding({ x: 310, y: 711 }, blocker(kacheln), 390, 844, SIZE);
    expect(got.pos).toBeNull();
  });

  it("verlaesst den Viewport nicht fuer einen Ausweg", () => {
    const control: FabRect = { x: 300, y: 790, w: 60, h: 32 };
    const got = placeFabAvoiding({ x: 310, y: 780 }, blocker([control]), 390, 844, SIZE);
    if (got.pos) {
      expect(got.pos.y + SIZE).toBeLessThanOrEqual(844 - 8);
      expect(got.pos.y).toBeGreaterThanOrEqual(8);
    } else {
      expect(got.pos).toBeNull();
    }
  });
});
