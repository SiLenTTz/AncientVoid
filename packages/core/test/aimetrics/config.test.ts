import { describe, expect, it } from "vitest";
import { HubConfig } from "../../src/platform/config.ts";

/** EPIC-P59 (ADR-0078): aiMetrics-Abschnitt — ohne Abschnitt kein Sampler. */
describe("config aiMetrics (EPIC-P59)", () => {
  it("ohne Abschnitt: kein Sampler, aber ein leerer Report (ADR-0078)", () => {
    expect(HubConfig.parse({}).aiMetrics).toBeUndefined();
  });

  it("Defaults: 10 s Intervall, 15 min Fenster, Host-Probe an", () => {
    const cfg = HubConfig.parse({ aiMetrics: {} });
    expect(cfg.aiMetrics).toMatchObject({ intervalSec: 10, windowSec: 900, retentionSamples: 5400, hostProbe: true, probeKnown: true, servers: [] });
  });

  it("Server nur mit URL oder apiKeyFile (ADR-0011: kein Key-Wert)", () => {
    const cfg = HubConfig.parse({ aiMetrics: { servers: [{ url: "http://127.0.0.1:8081/v1", label: "gpubox", apiKeyFile: "secrets/gpubox.key" }] } });
    expect(cfg.aiMetrics?.servers[0]).toEqual({ url: "http://127.0.0.1:8081/v1", label: "gpubox", apiKeyFile: "secrets/gpubox.key" });
  });
});
