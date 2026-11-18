import { beforeEach, describe, expect, it } from "vitest";

// Der Testlauftrog ist Knoten — wie in shared/audio.test.ts brauchen wir den
// Browser-Speicher alsATTRappe, damit die Ablage so getestet wird, wie sie laeuft.
const lagern = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => lagern.get(k) ?? null,
  setItem: (k: string, v: string) => void lagern.set(k, v),
  removeItem: (k: string) => void lagern.delete(k),
  clear: () => lagern.clear(),
};

import {
  clearShelf,
  dropShelf,
  pushShelf,
  readShelf,
  SHELF_LEVELS,
  SHELF_MAX,
  SHELF_MAX_CHARS,
  useShelf,
  visibleShelf,
} from "../../src/shared/clipboard-shelf.ts";

/** ADR-0090: die Ablage ist ein Stapel mit Stufen — denkbare Fehler sind hier gemeint. */
describe("mehrstufige Zwischenablage (ADR-0090)", () => {
  beforeEach(() => {
    localStorage.clear();
    clearShelf();
  });

  it("neues liegt obenauf, mit Herkunft", () => {
    pushShelf("zuerst", "diktat");
    pushShelf("danach", "markierung");
    const list = readShelf();
    expect(list.map((e) => e.text)).toEqual(["danach", "zuerst"]);
    expect(list[0]!.origin).toBe("markierung");
    expect(list[1]!.origin).toBe("diktat");
  });

  it("derselbe Text weiter unten steigt auf und zählt als Benutzung", () => {
    pushShelf("A", "text");
    pushShelf("B", "text");
    pushShelf("A", "text");
    const list = readShelf();
    expect(list.map((e) => e.text)).toEqual(["A", "B"]);
    expect(list[0]!.uses).toBe(1);
  });

  it("leere Zeichenfolge legt nichts ab", () => {
    expect(pushShelf("   ", "text")).toBeNull();
    expect(readShelf()).toHaveLength(0);
  });

  it("Geheimes bekommt keine Stufe — Token bleiben draußen", () => {
    expect(pushShelf("avt_geheimer_token", "text", { secret: true })).toBeNull();
    expect(readShelf()).toHaveLength(0);
    // Nichts gespeichert (oder ausdruecklich leer) — beides ist „keine Stufe“.
    const roh = localStorage.getItem("ancientvoid.clipboard-shelf.v1");
    expect(roh === null || roh === "[]").toBe(true);
  });

  it("die Grenze ist gemerkt, sichtbar ist weniger", () => {
    for (let at = 0; at < SHELF_MAX + 6; at += 1) pushShelf(`Stufe ${at}`, "text");
    const list = readShelf();
    expect(list).toHaveLength(SHELF_MAX);
    expect(list[0]!.text).toBe(`Stufe ${SHELF_MAX + 5}`);
    expect(visibleShelf()).toHaveLength(SHELF_LEVELS);
  });

  it("Langtext wird gekürzt und sagt das", () => {
    const long = "x".repeat(SHELF_MAX_CHARS + 900);
    const entry = pushShelf(long, "eintrag");
    expect(entry?.text).toHaveLength(SHELF_MAX_CHARS);
    expect(entry?.cut).toBe(true);
  });

  it("zurückholen holt die Stufe nach oben und zählt", () => {
    pushShelf("oben", "text");
    const unten = pushShelf("unten", "befehl");
    const used = useShelf(unten!.id);
    expect(readShelf().map((e) => e.text)).toEqual(["unten", "oben"]);
    expect(used?.uses).toBe(1);
  });

  it("eine Stufe entfernen und alles löschen wirken sichtbar", () => {
    const a = pushShelf("A", "text");
    pushShelf("B", "text");
    dropShelf(a!.id);
    expect(readShelf().map((e) => e.text)).toEqual(["B"]);
    clearShelf();
    expect(readShelf()).toHaveLength(0);
  });

  it("was gemerkt ist, liegt im Speicher dieses Browsers — nicht irgendwo am Hub", () => {
    pushShelf("bleibt hier", "diktat");
    const roh = localStorage.getItem("ancientvoid.clipboard-shelf.v1");
    expect(roh).toBeTruthy();
    const gelagert = JSON.parse(roh!) as Array<{ text: string; origin: string }>;
    expect(gelagert).toHaveLength(1);
    expect(gelagert[0]!.text).toBe("bleibt hier");
    expect(gelagert[0]!.origin).toBe("diktat");
  });
});
