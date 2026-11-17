import { describe, expect, it } from "vitest";
import { BUILD_SHA, BUILD_SHA_SHORT } from "../../src/shared/build-id.ts";

/** Der Build-Stempel ist die einzige Antwort auf „welches Bündel läuft auf diesem Gerät?“ —
 * der Server kann nur sagen, was er ausliefert. Ohne Bauzeit-Ersetzung muss der Stand
 * ehrlich „unbekannt“ heissen, geraten wird hier nichts. */
describe("Build-Stempel des Bündels", () => {
  it("ist immer ein begrenzter String, auch ohne Bauzeit-Ersetzung", () => {
    expect(typeof BUILD_SHA).toBe("string");
    expect(BUILD_SHA.length).toBeGreaterThan(0);
    expect(BUILD_SHA.length).toBeLessThanOrEqual(40);
  });

  it("zeigt die Kurzform als Anfang der vollen Revision", () => {
    expect(BUILD_SHA_SHORT).toBe(BUILD_SHA.slice(0, 8));
    expect(BUILD_SHA_SHORT.length).toBeLessThanOrEqual(8);
  });
});
