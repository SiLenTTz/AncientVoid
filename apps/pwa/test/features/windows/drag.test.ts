import { describe, expect, it } from "vitest";
import { dropFeatures, pointerOutside } from "../../../src/features/windows/drag.ts";

describe("Ziehgeste aus dem Fenster (EPIC-P34 T34.11)", () => {
  const view = { width: 1440, height: 900 };

  it("außerhalb heißt: über eine Kante hinaus; auf der Kante und im Fenster nicht", () => {
    expect(pointerOutside(-1, 300, view)).toBe(true);
    expect(pointerOutside(1441, 300, view)).toBe(true);
    expect(pointerOutside(300, -1, view)).toBe(true);
    expect(pointerOutside(300, 901, view)).toBe(true);
    expect(pointerOutside(0, 0, view)).toBe(false);
    expect(pointerOutside(1440, 900, view)).toBe(false);
    expect(pointerOutside(700, 450, view)).toBe(false);
  });

  it("die Abwurfstelle wird zur Fensterposition (Bildschirmkoordinaten, ganzzahlig, nie negativ geraten)", () => {
    expect(dropFeatures({ left: 1500.6, top: 120.2 })).toBe("popup,noopener,noreferrer,left=1501,top=120,width=960,height=720");
    expect(dropFeatures({ left: -300, top: 50 })).toBe("popup,noopener,noreferrer,left=-300,top=50,width=960,height=720");
    expect(dropFeatures(undefined)).toBe("popup,noopener,noreferrer");
    expect(dropFeatures({ left: Number.NaN, top: 5 })).toBe("popup,noopener,noreferrer");
  });
});
