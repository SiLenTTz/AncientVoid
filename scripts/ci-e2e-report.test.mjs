import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildReport, main, parseJUnit } from "./ci-e2e-report.mjs";

const green = `<?xml version="1.0"?>
<testsuite name="e2e" tests="3" failures="0" errors="0" skipped="0">
  <testcase classname="e2e/specs/a.spec.ts" name="läuft"/>
  <testcase classname="e2e/specs/a.spec.ts" name="läuft auch"><system-out>ok</system-out></testcase>
  <testcase classname="e2e/specs/b.spec.ts" name="drittens"/>
</testsuite>`;

const withSkipsAndFailure = `<?xml version="1.0"?>
<testsuite name="e2e" tests="4" failures="1" errors="0" skipped="1">
  <testcase classname="e2e/specs/a.spec.ts" name="ok"/>
  <testcase classname="e2e/specs/m.spec.ts" name="Handoff am Handy"><skipped><![CDATA[nur Desktop]]></skipped></testcase>
  <testcase classname="e2e/specs/c.spec.ts" name="kaputt"><failure message="Timeout">…</failure></testcase>
  <testcase classname="e2e/specs/c.spec.ts" name="ok2"/>
</testsuite>`;

describe("ci-e2e-report (EPIC-P28 T28.4)", () => {
  it("zählt Tests, Failures und benannte Skips korrekt", () => {
    expect(parseJUnit(green)).toEqual({ tests: 3, failures: 0, errors: 0, skipped: [] });
    const data = parseJUnit(withSkipsAndFailure);
    expect(data.tests).toBe(4);
    expect(data.failures).toBe(1);
    expect(data.skipped).toEqual(["e2e/specs/m.spec.ts › Handoff am Handy"]);
  });

  it("zählt Failures selbst nach, wenn das Summary-Attribut fehlt", () => {
    const noSummary = withSkipsAndFailure.replace('tests="4" failures="1" errors="0" skipped="1"', 'tests="4"');
    expect(parseJUnit(noSummary).failures).toBe(1);
  });

  it("Benennt Null-Tests und macht Skips im Bericht sichtbar", () => {
    expect(parseJUnit('<testsuite name="e2e" tests="0">').tests).toBe(0);
    const md = buildReport({ tests: 4, failures: 1, errors: 0, skipped: ["s › k"] }, { sha: "abc", runner: "r", pipeline: "p", image: "node:26", node: "v26", playwright: "^1.64" });
    expect(md).toContain("4 Tests · 1 Failures · 0 Errors · 1 Skips");
    expect(md).toContain("- s › k");
    expect(md).toContain("**Rot**");
    expect(buildReport({ tests: 3, failures: 0, errors: 0, skipped: [] }, { sha: "abc", runner: "r", pipeline: "p", image: "node:26", node: "v26", playwright: "^1" })).toContain("**Grün**");
  });

  it("schlägt fehl, wenn die JUnit-Datei fehlt (fail loud)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ancientvoid-ci-report-"));
    const heard = [];
    const errors = console.error;
    console.error = (m) => heard.push(m);
    try {
      main({ junitPath: join(dir, "fehlt.xml"), reportPath: join(dir, "r.md") });
    } finally {
      console.error = errors;
    }
    expect(heard.join("\n")).toContain("fehlt");
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it("schreibt den Bericht und bleibt bei grünem Lauf Exit-null", () => {
    const dir = mkdtempSync(join(tmpdir(), "ancientvoid-ci-report-"));
    writeFileSync(join(dir, "e2e-junit.xml"), green);
    main({ junitPath: join(dir, "e2e-junit.xml"), reportPath: join(dir, "e2e-report.md") });
    expect(readFileSync(join(dir, "e2e-report.md"), "utf-8")).toContain("**Grün**");
    expect(process.exitCode).toBeUndefined();
  });
});
