import { describe, expect, it } from "vitest";
import { parseHalogenHealth } from "../../src/modules/aimetrics/halogen-health.ts";
import { parseHalogenLogChunk } from "../../src/modules/aimetrics/halogen-log.ts";
import { createAiMetricsSampler, type AiMetricsSamplerDeps } from "../../src/modules/aimetrics/index.ts";

/** EPIC-P59 / ADR-0078 Nachtrag: Halogen /health + Log-Raten. */

const HEALTH = JSON.stringify({
  status: "ok",
  model: "halogen-qwen3.8-flash-next-uncensored-iq4xs",
  queued: 2,
  in_flight: 1,
  busy: true,
  busy_for_s: 12.5,
  slots: 2,
  context: 216064,
  kv_pool_positions: 216064,
  version: { api: "0.18.2" },
});

describe("halogen health parse", () => {
  it("liest Queue/Busy/Slots aus /health", () => {
    const { raw, recognized } = parseHalogenHealth(HEALTH);
    expect(recognized).toBe(true);
    expect(raw["halogen:queued"]).toBe(2);
    expect(raw["halogen:in_flight"]).toBe(1);
    expect(raw["halogen:busy"]).toBe(1);
    expect(raw["halogen:slots"]).toBe(2);
  });

  it("erkennt Nicht-Halogen-JSON nicht als Treffer", () => {
    expect(parseHalogenHealth('{"hello":1}').recognized).toBe(false);
  });
});

describe("halogen log parse", () => {
  it("nimmt Decode- und Prefill-Rate aus serve_api-Zeilen", () => {
    const line =
      "serve_api: decode 400 tok in 8.0s = 50.0 t/s | prompt 3000 (1000 cached), prefill 4.0s";
    const rates = parseHalogenLogChunk(line);
    expect(rates.decodeTokensPerS).toBe(50);
    expect(rates.prefillTokensPerS).toBe(500); // (3000-1000)/4
  });

  it("nimmt Proxy-Raten als Decode-Fallback", () => {
    const rates = parseHalogenLogChunk("12:00:01 [#3] n_gen ~120  41.5 t/s  Phase Antwort");
    expect(rates.decodeTokensPerS).toBe(41.5);
  });
});

describe("aimetrics sampler halogen fallback", () => {
  it("fällt bei /metrics 404 auf /health zurück und bleibt ok", async () => {
    const logs: string[] = [];
    const deps: AiMetricsSamplerDeps = {
      fetch: async (url) => {
        if (url.endsWith("/metrics")) return { status: 404, ok: false, text: async () => "not found" };
        if (url.endsWith("/health")) return { status: 200, ok: true, text: async () => HEALTH };
        return { status: 500, ok: false, text: async () => "" };
      },
      readFile: async () => null,
      readdir: async () => [],
      os: { loadavg: () => [0, 0, 0], cpus: () => [], totalmem: () => 1, freemem: () => 1 },
      now: () => new Date("2026-11-17T12:00:00.000Z"),
      logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) },
    };
    const s = createAiMetricsSampler({
      intervalSec: 10,
      windowSec: 900,
      retentionSamples: 100,
      hostProbe: false,
      servers: [{ url: "http://evox2:8100/v1", label: "halogen" }],
      selfLabel: "test",
      deps,
    });
    await s.tickNow();
    const src = s.report().sources[0]!;
    expect(src.status.ok).toBe(true);
    expect(src.fields.find((f) => f.key === "halogen:queued")?.value).toBe(2);
    expect(src.fields.find((f) => f.key === "halogen:busy")?.value).toBe(1);
  });

  it("liest Prefill/Decode aus halogenLog", async () => {
    const log =
      "serve_api: decode 100 tok in 2.0s = 50.0 t/s | prompt 2500 (500 cached), prefill 5.0s\n";
    const deps: AiMetricsSamplerDeps = {
      fetch: async (url) => {
        if (url.endsWith("/metrics")) return { status: 404, ok: false, text: async () => "not found" };
        return { status: 200, ok: true, text: async () => HEALTH };
      },
      readFile: async (path) => (path === "/tmp/halogen.log" ? log : null),
      readdir: async () => [],
      os: { loadavg: () => [0, 0, 0], cpus: () => [], totalmem: () => 1, freemem: () => 1 },
      now: () => new Date("2026-11-17T12:00:00.000Z"),
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    };
    const s = createAiMetricsSampler({
      intervalSec: 10,
      windowSec: 900,
      retentionSamples: 100,
      hostProbe: false,
      servers: [{ url: "http://evox2:8100/v1", label: "halogen", halogenLog: "/tmp/halogen.log" }],
      selfLabel: "test",
      deps,
    });
    await s.tickNow();
    const fields = s.report().sources[0]!.fields;
    expect(fields.find((f) => f.key === "halogen:decode_tokens_per_s")?.value).toBe(50);
    expect(fields.find((f) => f.key === "halogen:prefill_tokens_per_s")?.value).toBe(400);
  });
});
