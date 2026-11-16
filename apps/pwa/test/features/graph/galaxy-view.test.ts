import { describe, expect, it } from "vitest";
import { SCALE_MAX, SCALE_MIN, detailLevel, fitCircle, flightAt, placeLabels, zoomAt } from "../../../src/features/graph/galaxy-view.ts";

describe("Galaxie-Kamera (EPIC-P52 T52.2)", () => {
  it("passt den Galaxie-Kreis mittig und vollständig ein", () => {
    const cam = fitCircle(0, 0, 1000, 400, 800, 20);
    // Weltursprung liegt in der Bildmitte, der Rand des Kreises innerhalb der schmalen Seite.
    expect(cam.tx).toBe(200);
    expect(cam.ty).toBe(400);
    expect(1000 * cam.scale).toBeLessThanOrEqual(180 + 1e-9);
  });

  it("hält Zoomgrenzen ein, auch bei riesigen oder winzigen Galaxien", () => {
    expect(fitCircle(0, 0, 1e9, 400, 400).scale).toBe(SCALE_MIN);
    expect(fitCircle(0, 0, 0, 400, 400).scale).toBe(SCALE_MAX);
    expect(zoomAt({ scale: 1, tx: 0, ty: 0 }, 0, 0, 1e6).scale).toBe(SCALE_MAX);
  });

  it("zoomt um den Zeiger — der Weltpunkt darunter bleibt stehen", () => {
    const cam = { scale: 0.5, tx: 30, ty: -40 };
    const world = { x: (120 - cam.tx) / cam.scale, y: (90 - cam.ty) / cam.scale };
    const next = zoomAt(cam, 120, 90, 2);
    expect(world.x * next.scale + next.tx).toBeCloseTo(120);
    expect(world.y * next.scale + next.ty).toBeCloseTo(90);
  });

  it("Kameraflug beginnt beim Start, endet exakt am Ziel und zoomt monoton", () => {
    const from = { scale: 0.1, tx: 200, ty: 200 };
    const to = { scale: 2, tx: -500, ty: 80 };
    const start = flightAt(from, to, 0, 400, 400);
    expect(start.scale).toBeCloseTo(0.1);
    expect(start.tx).toBeCloseTo(200);
    expect(start.ty).toBeCloseTo(200);
    const end = flightAt(from, to, 1, 400, 400);
    expect(end.scale).toBeCloseTo(2);
    expect(end.tx).toBeCloseTo(-500);
    expect(end.ty).toBeCloseTo(80);
    let last = 0;
    for (let t = 0; t <= 1; t += 0.1) {
      const s = flightAt(from, to, t, 400, 400).scale;
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
  });

  it("Detailstufen: fern, mittel, nah mit wachsendem Zoom", () => {
    expect(detailLevel(0.1)).toBe("far");
    expect(detailLevel(0.8)).toBe("mid");
    expect(detailLevel(3)).toBe("near");
  });
});

describe("Namensplatzierung (EPIC-P52 T52.2)", () => {
  const measure = (t: string) => t.length * 6;

  it("platziert wichtigere Namen zuerst und lässt überdeckende weg", () => {
    const placed = placeLabels(
      [
        { text: "klein.ts", x: 100, y: 100, priority: 1 },
        { text: "wichtig.ts", x: 104, y: 102, priority: 9 },
        { text: "weit-weg.ts", x: 400, y: 100, priority: 0 },
      ],
      measure,
      12,
    );
    expect(placed.map((p) => p.text)).toEqual(["wichtig.ts", "weit-weg.ts"]);
  });

  it("keine zwei platzierten Namen überdecken sich, auch bei dichtem Gedränge", () => {
    const candidates = Array.from({ length: 600 }, (_, i) => ({ text: `datei-${i}.ts`, x: (i * 37) % 300, y: (i * 53) % 200, priority: i % 17 }));
    const placed = placeLabels(candidates, measure, 12, 1000);
    expect(placed.length).toBeGreaterThan(10);
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i], b = placed[j];
        const apart = a.x + a.width / 2 < b.x - b.width / 2 || b.x + b.width / 2 < a.x - a.width / 2 || a.y < b.y - b.height || b.y < a.y - a.height;
        expect(apart, `${a.text} überdeckt ${b.text}`).toBe(true);
      }
  });

  it("respektiert das Limit", () => {
    const candidates = Array.from({ length: 50 }, (_, i) => ({ text: "x", x: i * 100, y: 0, priority: 0 }));
    expect(placeLabels(candidates, measure, 12, 7)).toHaveLength(7);
  });
});
