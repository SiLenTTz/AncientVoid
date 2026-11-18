import { describe, expect, it } from "vitest";

import { makeSttProbe, sttHealthUrl } from "../src/modules/voice/stt.routes.ts";

/** BUG-0214: „verfügbar“ darf keine Behauptung aus der Konfiguration sein. */
describe("Erreichbarkeit der eigenen Spracherkennung (BUG-0214)", () => {
  it("leitet aus der inference-URL den Gesundheitspfad desselben Dienstes ab", () => {
    expect(sttHealthUrl("http://127.0.0.1:8094/inference")).toBe("http://127.0.0.1:8094/health");
    expect(sttHealthUrl("http://100.64.0.10:8094/inference?x=1")).toBe("http://100.64.0.10:8094/health");
    expect(sttHealthUrl("https://asr.example/v1/audio")).toBe("https://asr.example/health");
    expect(sttHealthUrl("keine url")).toBe("");
  });

  it("gilt als nicht erreichbar, wenn der Dienst nicht antwortet", async () => {
    const probe = makeSttProbe({
      url: "http://127.0.0.1:9/inference",
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    });
    const first = await probe();
    expect(first.ok).toBe(false);
    expect(first.ageMs).toBe(0);
  });

  it("gilt als erreichbar, wenn irgendwas antwortet — auch 404 ohne /health-Pfad", async () => {
    const probe = makeSttProbe({
      url: "http://127.0.0.1:8094/inference",
      fetch: (async () => new Response("not found", { status: 404 })) as unknown as typeof fetch,
    });
    expect((await probe()).ok).toBe(true);
  });

  it("merkt sich das Ergebnis kurz, damit ein toter Dienst nicht jedes Druecken bremst", async () => {
    let anrufe = 0;
    const probe = makeSttProbe({
      url: "http://127.0.0.1:9/inference",
      fetch: (async () => {
        anrufe += 1;
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    }, 60_000);
    await probe();
    const zweite = await probe();
    expect(anrufe).toBe(1);
    expect(zweite.ok).toBe(false);
    expect(zweite.ageMs).toBeGreaterThanOrEqual(0);
  });
});
