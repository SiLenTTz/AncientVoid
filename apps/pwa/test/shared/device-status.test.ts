import { describe, expect, it } from "vitest";
import { deviceStatusLines, gatherDeviceStatus, manifestCaches } from "../../src/shared/device-status.ts";

/** Der Cache-Stub: eine Fassade mit Caches, die Einträge mit URLs halten. */
function store(entries: Record<string, string[]>) {
  return {
    keys: async () => Object.keys(entries),
    open: async (name: string) => ({ keys: async () => entries[name].map((url) => ({ url })) }),
  };
}

const matchMedia = (opts: { landscape?: boolean; standalone?: boolean } = {}) => (query: string) => ({
  matches:
    query === "(display-mode: standalone)"
      ? (opts.standalone ?? true)
      : query === "(display-mode: browser)"
        ? !(opts.standalone ?? true)
        : query === "(orientation: landscape)"
          ? (opts.landscape ?? false)
          : false,
});

describe("installierter Stand eines Geräts (BUG-0186)", () => {
  it("liest Modus, Ausrichtung, Manifest und Worker-Cache aus den echten Quellen", async () => {
    const status = await gatherDeviceStatus({
      matchMedia: matchMedia({}),
      fetcher: async () => ({ ok: true, json: async () => ({ orientation: "any" }) }),
      caches: store({ "ancientvoid-v5": ["http://h/manifest.webmanifest", "http://h/index.html"], "ancientvoid-v6": ["http://h/index.html"] }),
      orientationType: "portrait-primary",
      askServiceWorker: async () => "ancientvoid-v6",
    });
    expect(status.displayMode).toBe("installiert (eigenes Fenster)");
    expect(status.windowOrientation).toBe("portrait-primary");
    expect(status.landscape).toBe(false);
    expect(status.manifestOrientation).toBe("any");
    // Der v5-Cache haelt ein Manifest-Exemplar — genau der Zustand, der eine
    // installierte App auf Hochformat festnaeht.
    expect(status.manifestCaches).toEqual(["ancientvoid-v5"]);
    expect(status.swCache).toBe("ancientvoid-v6");
  });

  it("ohne Orientierung im Manifest gilt die freie Drehung des Browsers", async () => {
    const status = await gatherDeviceStatus({
      matchMedia: matchMedia({ landscape: true, standalone: false }),
      fetcher: async () => ({ ok: true, json: async () => ({}) }),
      caches: store({ "ancientvoid-v6": ["http://h/index.html"] }),
      askServiceWorker: async () => null,
    });
    expect(status.manifestOrientation).toBe("any (nicht gesetzt)");
    expect(status.displayMode).toBe("Browser-Tab");
    expect(status.landscape).toBe(true);
    expect(status.manifestCaches).toEqual([]);
    expect(status.swCache).toBeNull();
  });

  it("ein kaputter Manifest-Zugriff wird gesagt, nicht erfunden", async () => {
    const status = await gatherDeviceStatus({
      matchMedia: matchMedia(),
      fetcher: async () => {
        throw new Error("offline");
      },
      caches: store({}),
      askServiceWorker: async () => null,
    });
    expect(status.manifestOrientation).toBe("nicht lesbar");
    expect(status.windowOrientation).toBe("unbekannt");
  });

  it("Manifest-Cache wird nur gefunden, wenn er wirklich ein Manifest haelt", async () => {
    const hits = await manifestCaches(store({ a: ["http://h/assets/index-abc.js"], b: ["http://h/manifest.webmanifest"] }) as never);
    expect(hits).toEqual(["b"]);
  });

  it("die Zeilen fuer die Oberflaeche nennen den Fehler beim Namen", async () => {
    const status = await gatherDeviceStatus({
      matchMedia: matchMedia(),
      fetcher: async () => ({ ok: true, json: async () => ({ orientation: "portrait-primary" }) }),
      caches: store({ "ancientvoid-v5": ["http://h/manifest.webmanifest"] }),
      orientationType: "portrait-primary",
      askServiceWorker: async () => "ancientvoid-v5",
    });
    const lines = deviceStatusLines(status);
    expect(lines).toContain("Anzeigemodus: installiert (eigenes Fenster)");
    expect(lines).toContain("Fenster-Ausrichtung: hoch · Systemmeldung: portrait-primary");
    expect(lines).toContain("Manifest-Ausrichtung: portrait-primary");
    expect(lines.some((l) => l.includes("Manifest-Cache: liegt in ancientvoid-v5"))).toBe(true);
    expect(lines).toContain("Service-Worker-Cache: ancientvoid-v5");
  });

  it("zeigt die Systemmeldung, wenn sie zur tatsächlichen Fensterlage nicht passt", async () => {
    const status = await gatherDeviceStatus({
      matchMedia: matchMedia({ landscape: true }),
      fetcher: async () => ({ ok: true, json: async () => ({ orientation: "any" }) }),
      caches: store({}),
      orientationType: "portrait-primary",
      askServiceWorker: async () => null,
    });
    expect(deviceStatusLines(status)).toContain("Fenster-Ausrichtung: quer · Systemmeldung: portrait-primary (passt nicht)");
  });

  it("zeigt den Winkel, damit ein Drehen des Geräts beweisbar wird", async () => {
    const status = await gatherDeviceStatus({
      matchMedia: matchMedia({ landscape: true }),
      fetcher: async () => ({ ok: true, json: async () => ({ orientation: "any" }) }),
      caches: store({}),
      orientationType: "portrait-primary",
      orientationAngle: 90,
      askServiceWorker: async () => null,
    });
    expect(status.windowAngle).toBe(90);
    expect(status.landscape).toBe(true);
    expect(deviceStatusLines(status)).toContain("Fenster-Winkel: 90°");
  });

  it("lässt den Winkel unbekannt, wo es ihn nicht gibt", async () => {
    const status = await gatherDeviceStatus({
      matchMedia: matchMedia({}),
      fetcher: async () => ({ ok: true, json: async () => ({ orientation: "any" }) }),
      caches: store({}),
      askServiceWorker: async () => null,
    });
    expect(status.windowAngle).toBeNull();
    expect(deviceStatusLines(status)).toContain("Fenster-Winkel: unbekannt");
  });

  it("BUG-0186: nennt die Installation als Ursache, wenn das Manifest frei ist und der Winkel trotzdem bei 0 bleibt", async () => {
    const status = await gatherDeviceStatus({
      matchMedia: matchMedia({ standalone: true }),
      fetcher: async () => ({ ok: true, json: async () => ({ orientation: "any" }) }),
      caches: store({}),
      orientationType: "portrait-primary",
      orientationAngle: 0,
      askServiceWorker: async () => "ancientvoid-v6",
    });
    const linien = deviceStatusLines(status);
    expect(linien.some((l) => l.includes("trägt die Ausrichtung aus ihrer Installation"))).toBe(true);
    expect(linien.some((l) => l.includes("neu hinzufügen"))).toBe(true);
  });

  it("gibt den Hinweis nicht, wo die Installation nicht schuld sein kann", async () => {
    const alsTab = await gatherDeviceStatus({
      matchMedia: matchMedia({ standalone: false }),
      fetcher: async () => ({ ok: true, json: async () => ({ orientation: "any" }) }),
      caches: store({}),
      orientationAngle: 0,
      askServiceWorker: async () => null,
    });
    expect(deviceStatusLines(alsTab).some((l) => l.includes("aus ihrer Installation"))).toBe(false);

    const drehtSchon = await gatherDeviceStatus({
      matchMedia: matchMedia({ standalone: true, landscape: true }),
      fetcher: async () => ({ ok: true, json: async () => ({ orientation: "any" }) }),
      caches: store({}),
      orientationAngle: 90,
      askServiceWorker: async () => "ancientvoid-v6",
    });
    expect(deviceStatusLines(drehtSchon).some((l) => l.includes("aus ihrer Installation"))).toBe(false);
  });
});
