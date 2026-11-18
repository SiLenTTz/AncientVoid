import { beforeEach, describe, expect, it, vi } from "vitest";

const { sttMock } = vi.hoisted(() => ({ sttMock: vi.fn() }));
vi.mock("../src/shared/api.ts", () => ({ hubApi: { stt: sttMock } }));

/** BUG-0214: nach einem Ausfall der eigenen Erkennung muss die App ihre Auskunft erneuern
 *  können — sonst hält sie für den Rest der Sitzung an einem toten Weg fest. */
describe("Auskunft über die eigene Erkennung erneuern (BUG-0214)", () => {
  beforeEach(() => {
    sttMock.mockReset();
  });

  it("holt die Auskunft erneut und entscheidet danach neu", async () => {
    const { sttStatus, refreshSttStatus } = await import("../src/shared/local-stt.ts");
    sttMock.mockResolvedValue({ available: true, engine: "whisper.cpp", streaming: true });
    expect((await sttStatus()).available).toBe(true);
    expect((await sttStatus()).available).toBe(true);
    expect(sttMock).toHaveBeenCalledTimes(1); // gemerkt — nicht jeder Aufruf fragte den Hub

    sttMock.mockResolvedValue({ available: false, streaming: false, reason: "eigene Spracherkennung nicht erreichbar" });
    const frisch = await refreshSttStatus();
    expect(frisch.available).toBe(false);
    expect(sttMock).toHaveBeenCalledTimes(2);
    expect((await sttStatus()).available).toBe(false);
  });

  it("eine nicht erreichbare Hub-Auskunft zählt als nicht verfügbar, nicht als Fehler", async () => {
    sttMock.mockRejectedValue(new TypeError("fetch failed"));
    const { refreshSttStatus } = await import("../src/shared/local-stt.ts");
    expect((await refreshSttStatus()).available).toBe(false);
  });
});
