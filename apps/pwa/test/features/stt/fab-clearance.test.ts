import { describe, expect, it } from "vitest";

import { placeFabAvoiding, type FabRect } from "../../../src/features/stt/fab-clearance.ts";

/** BUG-0199: der FAB darf auf langen Seiten kein Bedienelement verdecken. */
describe("FAB weicht verdeckten Controls aus", () => {
  const SIZE = 64;

  /**
   * Belegt ist ein Kandidat, wenn der Mittelpunkt eines Controls in seiner Flaeche liegt —
   * dieselbe Regel, die der FAB im Baustein anwendet (der FAB liegt als festes Element
   * obenauf, also deckt er das Control zu).
   */
  const blocker = (controls: FabRect[]) => (r: FabRect): boolean =>
    controls.some((c) => {
      const cx = c.x + c.w / 2;
      const cy = c.y + c.h / 2;
      return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
    });

  it("bleibt unveraendert, wenn nichts im Weg ist", () => {
    const got = placeFabAvoiding({ x: 310, y: 711 }, blocker([]), 390, 844, SIZE);
    expect(got).toEqual({ pos: { x: 310, y: 711 }, moved: false });
  });

  it("rueckt eine Kantenlaenge hoch, wenn darunter ein Schalter liegt", () => {
    // Gemessener Fall BUG-0199: Pinch-Zoom-Schalter mitten in der FAB-Flaeche (y 3200 px).
    const control: FabRect = { x: 300, y: 730, w: 60, h: 32 };
    const got = placeFabAvoiding({ x: 310, y: 711 }, blocker([control]), 390, 844, SIZE);
    expect(got.moved).toBe(true);
    expect(got.pos).not.toBeNull();
    expect(got.pos!.y).toBeLessThan(711);
    expect(blocker([control])({ x: got.pos!.x, y: got.pos!.y, w: SIZE, h: SIZE })).toBe(false);
  });

  it("weicht nach unten aus, wenn nach oben kein Platz ist", () => {
    const control: FabRect = { x: 300, y: 60, w: 60, h: 32 };
    const got = placeFabAvoiding({ x: 310, y: 40 }, blocker([control]), 390, 844, SIZE);
    expect(got.pos).not.toBeNull();
    expect(got.pos!.y).toBeGreaterThan(40);
  });

  it("weicht seitwaerts aus, wenn senkrecht nichts frei ist", () => {
    // Dichte Control-Wand in der rechten Spalte (Mittelpunkte x 335), links davon frei.
    const wand: FabRect[] = [];
    for (let y = 400; y < 800; y += 30) wand.push({ x: 280, y, w: 110, h: 26 });
    const got = placeFabAvoiding({ x: 310, y: 700 }, blocker(wand), 390, 844, SIZE);
    expect(got.pos).not.toBeNull();
    expect(got.pos!.x).toBeLessThan(310);
    expect(got.pos!.x + SIZE).toBeLessThanOrEqual(390 - 8);
  });

  it("meldet null, wenn weit und breit nichts frei ist", () => {
    // Zwei controlgefyllte Spalten (Mittelpunkte x 340 und x 260) ueber die ganze Hoehe:
    // jeder Kandidat — senkrecht, seitwaerts, diagonal — enthaelt einen Mittelpunkt.
    const kacheln: FabRect[] = [];
    for (let y = 0; y < 844; y += 26) {
      kacheln.push({ x: 300, y, w: 80, h: 20 });
      kacheln.push({ x: 230, y, w: 60, h: 20 });
    }
    const got = placeFabAvoiding({ x: 310, y: 711 }, blocker(kacheln), 390, 844, SIZE);
    expect(got.pos).toBeNull();
  });

  it("verlaesst den Viewport nicht fuer einen Ausweg", () => {
    const control: FabRect = { x: 300, y: 790, w: 60, h: 32 };
    const got = placeFabAvoiding({ x: 310, y: 780 }, blocker([control]), 390, 844, SIZE);
    expect(got.pos).not.toBeNull();
    expect(got.pos!.y).toBeGreaterThanOrEqual(8);
    expect(got.pos!.y + SIZE).toBeLessThanOrEqual(844 - 8);
    expect(got.pos!.x + SIZE).toBeLessThanOrEqual(390 - 8);
  });
});
