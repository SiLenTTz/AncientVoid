import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EmittedEvent } from "@uacc/contracts";
import { loadFixtureLines, assertFixtureEventsValid, checkFixture } from "../src/index.ts";

/**
 * adapter-testkit itself had zero tests before T1.4 — exactly the pattern
 * that let BUG-0004 (spawnWorker never simulated) and BUG-0005 (hubctl's
 * broken WS URL) ship unnoticed elsewhere. Covering the fixture helpers
 * here so a third instance doesn't repeat it.
 */

describe("fixture helpers", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "uacc-testkit-fixture-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loadFixtureLines parses one JSON value per non-blank line", async () => {
    const path = join(dir, "sample.jsonl");
    await writeFile(path, '{"a":1}\n\n{"b":2}\n  \n{"c":3}\n', "utf8");
    expect(loadFixtureLines(path)).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it("assertFixtureEventsValid passes schema-valid events", () => {
    const events: EmittedEvent[] = [{ type: "system", summary: "ok", payload: {} }];
    expect(() => assertFixtureEventsValid(events)).not.toThrow();
  });

  it("assertFixtureEventsValid throws on an invalid event type", () => {
    const events = [{ type: "not-a-real-type", summary: "x", payload: {} }] as unknown as EmittedEvent[];
    expect(() => assertFixtureEventsValid(events)).toThrow();
  });

  it("assertFixtureEventsValid throws on an oversized summary", () => {
    const events: EmittedEvent[] = [{ type: "system", summary: "x".repeat(201), payload: {} }];
    expect(() => assertFixtureEventsValid(events)).toThrow(/at most 200 character/);
  });

  it("checkFixture loads, normalizes and validates in one call", async () => {
    const path = join(dir, "normalize-me.jsonl");
    await writeFile(path, '{"text":"hello"}\n{"text":"world"}\n', "utf8");
    const normalize = (line: unknown): EmittedEvent[] => [
      { type: "assistant", summary: (line as { text: string }).text, payload: {} },
    ];
    const events = checkFixture(path, normalize);
    expect(events.map((e) => e.summary)).toEqual(["hello", "world"]);
  });

  it("checkFixture surfaces a normalizer's schema violations, not just silence", () => {
    const path = join(dir, "normalize-me.jsonl"); // reuse — same two lines
    const badNormalize = (): EmittedEvent[] => [{ type: "assistant", summary: "x".repeat(300), payload: {} }];
    expect(() => checkFixture(path, badNormalize)).toThrow(/at most 200 character/);
  });
});
