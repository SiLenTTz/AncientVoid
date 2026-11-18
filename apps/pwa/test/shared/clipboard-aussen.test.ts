import { beforeEach, describe, expect, it } from "vitest";

// Der Testlauftrog ist Knoten ohne Browser-Speicher — wie in clipboard-shelf.test.ts
// braucht die Ablage eine Attrappe, damit sie so getestet wird, wie sie laeuft.
const lagern = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => lagern.get(k) ?? null,
  setItem: (k: string, v: string) => void lagern.set(k, v),
  removeItem: (k: string) => void lagern.delete(k),
  clear: () => lagern.clear(),
};

import {
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  dropImage,
  getImage,
  listImages,
  saveImage,
} from "../../src/shared/clipboard-images.ts";
import {
  clearShelf,
  imageCaption,
  pushShelfImage,
  readShelf,
} from "../../src/shared/clipboard-shelf.ts";
import { einordnung, ingestEnabled, readOnce, setIngestEnabled } from "../../src/shared/clipboard-ingest.ts";

/** Ein Clipboard-Stueck, wie der Browser es liefert — ohne echtes Clipboard. */
const stueck = (typen: string[], inhalte: Record<string, Blob>) => ({
  types: typen,
  getType: async (typ: string) => inhalte[typ] ?? new Blob(),
});
const png = (groesse = 64) => new Blob(["x".repeat(groesse)], { type: "image/png" });

describe("extern Kopiertes einordnen (ADR-0093)", () => {
  it("nimmt das Bild, wenn Bild und Text zusammen im Clipboard liegen", () => {
    expect(einordnung({ types: ["text/plain", "image/png"] })).toEqual({ art: "bild", typ: "image/png" });
    expect(einordnung({ types: ["image/jpeg"] })).toEqual({ art: "bild", typ: "image/jpeg" });
  });

  it("nimmt Text, wenn kein Bild dabei ist", () => {
    expect(einordnung({ types: ["text/plain"] })).toEqual({ art: "text" });
  });

  it("laesst Typen draussen, zu denen die Ablage nichts Echtes zeigen koennte", () => {
    expect(einordnung({ types: ["text/html"] })).toBeNull();
    expect(einordnung({ types: [] })).toBeNull();
  });
});

describe("Bildvorrat in IndexedDB-Ableger (ADR-0093)", () => {
  it("laesst ein einzelnes Riesenbild gar nicht erst hinein", async () => {
    const riesig = new Blob([new Uint8Array(MAX_IMAGE_BYTES + 1)], { type: "image/png" });
    const ergebnis = await saveImage({ blob: riesig, mime: "image/png", width: 4000, height: 4000 });
    expect(ergebnis.ignored).toBe(true);
    expect(await getImage(ergebnis.id)).toBeUndefined();
  });

  it("haelt Menge und Deckel ein — das aelteste Bild fliegt zuerst", async () => {
    const ids: string[] = [];
    for (let stueck_nr = 1; stueck_nr <= MAX_IMAGES + 2; stueck_nr += 1) {
      const { id } = await saveImage({ blob: png(32), mime: "image/png", width: 100, height: 80, keep: 3 });
      ids.push(id);
      await new Promise((r) => setTimeout(r, 5));
    }
    const lagern = await listImages();
    expect(lagern.length).toBe(3);
    expect(lagern.map((b) => b.id)).toEqual([ids[ids.length - 1]!, ids[ids.length - 2]!, ids[ids.length - 3]!]);
  });

  it("ein entferntes Bild ist wirklich weg — auch die Stufe zeigt danach ins Leere", async () => {
    const { id } = await saveImage({ blob: png(48), mime: "image/png", width: 10, height: 10 });
    await dropImage(id);
    expect(await getImage(id)).toBeUndefined();
    expect((await listImages()).some((b) => b.id === id)).toBe(false);
  });
});

describe("Ablage nimmt extern Kopiertes auf (ADR-0093)", () => {
  beforeEach(() => {
    localStorage.clear();
    clearShelf();
    setIngestEnabled(true);
  });

  it("ist standardmaessig an — wer die App oeffnet, will genau das", () => {
    expect(ingestEnabled()).toBe(true);
    setIngestEnabled(false);
    expect(ingestEnabled()).toBe(false);
  });

  it("holt Text als Stufe mit der Herkunft „andere-app“ herein", async () => {
    const ergebnis = await readOnce(async () => [stueck(["text/plain"], { "text/plain": new Blob(["GRUSS AUS DER MAIL-APP"], { type: "text/plain" }) })]);
    expect(ergebnis.texte).toBe(1);
    const stufe = readShelf()[0]!;
    expect(stufe.text).toBe("GRUSS AUS DER MAIL-APP");
    expect(stufe.origin).toBe("andere-app");
    expect(stufe.kind).toBeUndefined();
  });

  it("holt einen Screenshot als Bild-Stufe mit echten Massen und Groesse", async () => {
    const ergebnis = await readOnce(async () => [stueck(["image/png"], { "image/png": png(500) })]);
    expect(ergebnis.bilder).toBe(1);
    const stufe = readShelf()[0]!;
    expect(stufe.kind).toBe("bild");
    expect(stufe.asset).toBeTruthy();
    expect(stufe.width).toBe(0); // ohne Bild-Decoder im Knoten-Lauftrog ehrlich 0 — die Groesse stimmt trotzdem
    expect(imageCaption(stufe)).toContain("KB");
    const pixel = await getImage(stufe.asset!);
    expect(pixel?.mime).toBe("image/png");
    expect(pixel?.bytes).toBeGreaterThan(0);
  });

  it("laesst denselben Screenshot nicht mehrfach steigen — die Stufe zaehlt hoch", async () => {
    const asset = await saveImage({ blob: png(70), mime: "image/png", width: 20, height: 20 });
    pushShelfImage({ asset: asset.id, mime: "image/png", bytes: 70, width: 20, height: 20 });
    pushShelfImage({ asset: asset.id, mime: "image/png", bytes: 70, width: 20, height: 20 });
    const stufen = readShelf().filter((e) => e.kind === "bild");
    expect(stufen.length).toBe(1);
    expect(stufen[0]!.uses).toBe(1);
  });

  it("ueberspringt ein Bild ueber dem Einzel-Deckel und sagt es", async () => {
    const riesig = new Blob([new Uint8Array(MAX_IMAGE_BYTES + 1)], { type: "image/png" });
    const ergebnis = await readOnce(async () => [stueck(["image/png"], { "image/png": riesig })]);
    expect(ergebnis.bilder).toBe(0);
    expect(ergebnis.uebersprungen).toBe(1);
    expect(readShelf().length).toBe(0);
  });

  it("liest nicht, wenn der Schalter aus ist", async () => {
    setIngestEnabled(false);
    const ergebnis = await readOnce(async () => [stueck(["text/plain"], { "text/plain": new Blob(["SOLL NICHT REINKOMMEN"]) })]);
    expect(ergebnis.texte).toBe(0);
    expect(readShelf().length).toBe(0);
  });
});
