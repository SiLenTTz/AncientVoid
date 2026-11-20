import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sweepTestTemp } from "./sweep-test-temp.mjs";

/** BUG-0227: verwaiste Test-Temp-Verzeichnisse dürfen /tmp nicht zufüllen —
 * der Sweeper entfernt nur Repo-eigene Präfixe und nur, was alt genug ist. */
describe("sweepTestTemp (BUG-0227)", () => {
  let base;
  afterEach(async () => {
    if (base) await import("node:fs/promises").then((fs) => fs.rm(base, { recursive: true, force: true }));
  });

  it("entfernt eigene Präfixe jenseits des Alters, lässt jüngere und fremde stehen", async () => {
    base = await mkdtemp(join(tmpdir(), "av-sweep-test-"));
    const now = Date.now();
    const OLD = 25 * 60 * 60 * 1000;
    const stale = [join(base, "av-p48abc"), join(base, "ancientvoid-stt-xyz")];
    const fresh = [join(base, "av-laufend"), join(base, "ancientvoid-automations-test1")];
    const fremd = [join(base, "systemd-private-9"), join(base, "anderes-tool")];
    for (const dir of [...stale, ...fresh, ...fremd]) {
      await mkdir(dir);
      await writeFile(join(dir, "marker"), "x");
    }
    // Alter herbeiführen: die mtime der Verzeichnisse selbst stempeln — genau
    // die bewertet der Sweeper (utimes will Dates; nackte Zahlen wären Sekunden).
    for (const dir of stale) await utimes(dir, new Date(now - OLD), new Date(now - OLD));

    const removed = await sweepTestTemp(base, { now: now + 60_000, maxAgeMs: 24 * 60 * 60 * 1000 });

    const exists = async (p) => {
      const fs = await import("node:fs/promises");
      try {
        await fs.access(p);
        return true;
      } catch {
        return false;
      }
    };
    expect(removed).toBe(2);
    for (const dir of stale) await expect(exists(dir)).resolves.toBe(false);
    for (const dir of [...fresh, ...fremd]) await expect(exists(dir)).resolves.toBe(true);
  });

  it("trägt ein fehlendes Basisverzeichnis still — ein Sweep darf den Lauf nicht sprengen", async () => {
    await expect(sweepTestTemp(join(tmpdir(), "av-sweep-test-does-not-exist"))).resolves.toBe(0);
  });
});
