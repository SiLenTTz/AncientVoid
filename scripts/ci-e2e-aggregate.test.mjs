import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decide } from "./ci-e2e-aggregate.mjs";

const green = `<?xml version="1.0"?>
<testsuite name="e2e" tests="2" failures="0" errors="0" skipped="0">
  <testcase classname="e2e/specs/a.spec.ts" name="läuft"/>
  <testcase classname="e2e/specs/a.spec.ts" name="läuft auch"/>
</testsuite>`;

const withSkip = `<?xml version="1.0"?>
<testsuite name="e2e" tests="1" failures="0" errors="0" skipped="1">
  <testcase classname="e2e/specs/m.spec.ts" name="Handoff am Handy"><skipped><![CDATA[nur Device]]></skipped></skipped></testcase>
</testsuite>`;

const withFailure = `<?xml version="1.0"?>
<testsuite name="e2e" tests="1" failures="1" errors="0" skipped="0">
  <testcase classname="e2e/specs/c.spec.ts" name="kaputt"><failure message="Timeout">…</failure></testcase>
</testsuite>`;

function fixture(shards) {
  const root = mkdtempSync(join(tmpdir(), "e2e-aggregate-"));
  shards.forEach((bodies, i) => {
    if (bodies === null) return; // Shard ohne JUnit-Datei (Crash vor dem Bericht)
    const dir = join(root, `shard-${i + 1}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "e2e-junit.xml"), bodies);
  });
  return root;
}

describe("ci-e2e-aggregate (Laufzeit 2026-11-16)", () => {
  it("addiert grüne Shards und fasst Skips zusammen", () => {
    const d = decide({ dir: fixture([green, withSkip]), expectedShards: 2 });
    expect(d.ok).toBe(true);
    expect(d.tests).toBe(3);
    expect(d.failures).toBe(0);
    expect(d.skipped).toEqual(["e2e/specs/m.spec.ts › Handoff am Handy"]);
  });

  it("macht einen Shard-Fehlschlag am Aggregat sichtbar", () => {
    const d = decide({ dir: fixture([green, withFailure]), expectedShards: 2 });
    expect(d.ok).toBe(false);
    expect(d.failures).toBe(1);
  });

  it("fehlender Shard-Bericht ist nie grün (EPIC-P28 T28.4)", () => {
    const d = decide({ dir: fixture([green, null]), expectedShards: 2 });
    expect(d.ok).toBe(false);
    expect(d.missing).toBe(1);
  });

  it("null Tests über alle Shards bleibt rot", () => {
    const d = decide({ dir: fixture([`<testsuite name="e2e" tests="0"></testsuite>`, `<testsuite name="e2e" tests="0"></testsuite>`]), expectedShards: 2 });
    expect(d.ok).toBe(false);
    expect(d.tests).toBe(0);
  });
});
