import { describe, expect, it } from "vitest";
import { AiMetricsReport, isFleetRoutable } from "@ancientvoid/contracts";

/** EPIC-P59 (ADR-0078): Report-Format und Fleet-Route. */
describe("aimetrics contract (EPIC-P59)", () => {
  it("parses a full report with source and age on every field", () => {
    const report = {
      generatedAt: "2026-11-14T12:00:00.000Z",
      intervalSec: 10,
      windowSec: 900,
      self: { hostLabel: "evox2" },
      sources: [
        {
          id: "srv-1",
          kind: "model-server",
          label: "qwen",
          url: "http://100.65.133.28:8081/metrics",
          status: { ok: true },
          lastSampleAt: "2026-11-14T12:00:00.000Z",
          fields: [
            {
              key: "predicted_tokens_seconds",
              label: "Decode tokens/s",
              unit: "count",
              source: "gemeldet",
              value: 41.7,
              ts: "2026-11-14T12:00:00.000Z",
              window: { windowSec: 900, samples: 3, p50: 40.1, p95: 44.0 },
              history: [{ ts: "2026-11-14T11:59:50.000Z", value: 39.2 }],
            },
          ],
        },
      ],
    };
    expect(AiMetricsReport.parse(report)).toBeTruthy();
  });

  it("keeps „nicht gemeldet“ distinct from 0 (ADR-0023)", () => {
    const field = AiMetricsReport.parse({
      generatedAt: "2026-11-14T12:00:00.000Z",
      intervalSec: 10,
      windowSec: 900,
      self: { hostLabel: "hub" },
      sources: [
        {
          id: "host",
          kind: "hub-host",
          label: "Hub-Host",
          url: null,
          status: { ok: false, error: "sysfs power1_average nicht lesbar" },
          lastSampleAt: null,
          fields: [{ key: "power", label: "GPU-Leistung", unit: "W", source: "sysfs", value: null, ts: null, window: null, history: [] }],
        },
      ],
    }).sources[0]?.fields[0];
    expect(field?.value).toBeNull();
  });

  it("routes /api/aimetrics through the fleet GET proxy (ADR-0078 to FLEET_ROUTABLE)", () => {
    expect(isFleetRoutable("/api/aimetrics")).toBe(true);
  });
});
