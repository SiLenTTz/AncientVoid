import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Der Service Worker liegt als fertige Datei in `public/` und läuft ohne Build — deshalb
 * prüft diese Datei die zwei Zusagen, die BUG-0185 dauerhaft zubinden sind.
 */
const sw = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

describe("Service Worker: Manifest bleibt draußen (BUG-0185)", () => {
  it("das Vorlade-Set enthält kein Manifest", () => {
    const shell = sw.match(/const SHELL = \[([^\]]*)\]/);
    expect(shell, "SHELL-Eintrag in sw.js gefunden").not.toBeNull();
    expect(shell![1]).not.toContain("manifest.webmanifest");
  });

  it("beim Aktivieren wird jedes Manifest-Exemplar aus jedem Cache geworfen", () => {
    expect(sw).toMatch(/async function dropCachedManifest/);
    expect(sw).toMatch(/\.then\(dropCachedManifest\)/);
  });

  it("die Cache-Version folgt dem Schema und ist mindestens auf der jetzigen Stufe", () => {
    // v6 ist der Schnitt: alle früheren Stufen hatten das Manifest vorgeladen und
    // installierten ohne Byte-Änderung nie einen neuen Worker.
    const version = sw.match(/const CACHE_VERSION = "ancientvoid-v(\d+)"/);
    expect(version, "CACHE_VERSION in sw.js").not.toBeNull();
    expect(Number(version![1])).toBeGreaterThanOrEqual(6);
  });

  it("der Worker beantwortet die Stand-Anfrage der Oberfläche", () => {
    expect(sw).toMatch(/addEventListener\("message"/);
    expect(sw).toMatch(/"ancientvoid:sw-info"/);
  });

  it("der Fetch-Handler lagert das Manifest nie ein (live auf dem Gerät gemessen)", () => {
    // Ohne diese Sonderbehandlung schreibt networkFirstShell jede Antwort in den Cache —
    // und das Manifest wäre nach dem ersten Laden wieder eingebaut, trotzactivate-Raeumung.
    expect(sw).toMatch(/endsWith\("\/manifest\.webmanifest"\)/);
    expect(sw).toMatch(/event\.respondWith\(fetch\(req\)\)/);
  });
});
