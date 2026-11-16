import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { URL } from "node:url";

// BUG-0111: lokal teilt sich die Suite die Maschine mit dem Desktop des
// Nutzers; die Parallelität ist begrenzt, damit Gate und Browser gleichzeitig
// überleben (CI-Anker: workers 1, lokal: workers 2).
const config = readFileSync(new URL("../playwright.config.ts", import.meta.url), "utf8");

describe("playwright.config Parallelität (BUG-0111)", () => {
  it("begrenzt die lokalen Worker auf max. 2", () => {
    const m = config.match(/workers:\s*process\.env\.CI\s*\?\s*(\d+)\s*:\s*(\d+)/);
    expect(m, "workers-Zeile mit CI-Trennung nicht gefunden").toBeTruthy();
    expect(Number(m[2])).toBeLessThanOrEqual(2);
    expect(Number(m[1])).toBeLessThanOrEqual(2);
  });
});
