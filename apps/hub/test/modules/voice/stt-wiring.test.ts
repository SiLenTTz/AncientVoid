import { describe, expect, it } from "vitest";
import type { HubConfig } from "@ancientvoid/core";
import { sttModuleConfig } from "../../../src/modules/voice/stt-wiring.ts";

/**
 * BUG-0216: Die Konfig-Datei darf nicht an der Stelle vorbeilaufen, an der das
 * Sprachmodul bestueckt wird. `stt.routes.ts` und `stt-stream.ts` lesen
 * `stt.streaming.engine` beide richtig — verloren ging der Schluessel dazwischen,
 * im Handanlegen des Objekts in `main.ts`. Diese Unit haelt deshalb die
 * *Weitergabe* fest, nicht das Lesen.
 */
const kernKonfig = {
  url: "http://127.0.0.1:8094/inference",
  engine: "whisper.cpp large-v3 q5_0 (Vulkan, Radeon R9700)",
  language: "de",
  vocabulary: "Hub, Messlauf",
  timeoutMs: 30_000,
  streaming: {
    url: "ws://127.0.0.1:8095/",
    endpointingMs: 800,
    engine: "whisper.cpp large-v3 q5_0 (Vulkan, Radeon R9700)",
    apiKeyFile: "~/.config/ancientvoid/stt.key",
  },
} satisfies NonNullable<HubConfig["stt"]>;

describe("sttModuleConfig — die Konfig-Datei kommt vollstaendig beim Sprachmodul an", () => {
  it("gibt jeden Schluessel weiter, auch den Namen der Streaming-Erkennung", () => {
    const modul = sttModuleConfig(kernKonfig);
    expect(modul).toBeDefined();
    expect(modul?.url).toBe("http://127.0.0.1:8094/inference");
    expect(modul?.engine).toBe("whisper.cpp large-v3 q5_0 (Vulkan, Radeon R9700)");
    expect(modul?.timeoutMs).toBe(30_000);
    expect(modul?.streaming?.url).toBe("ws://127.0.0.1:8095/");
    expect(modul?.streaming?.endpointingMs).toBe(800);
    expect(modul?.streaming?.engine).toBe("whisper.cpp large-v3 q5_0 (Vulkan, Radeon R9700)");
  });

  it("laesst den Default-Namen in Ruhe, wenn die Konfig keinen nennt", () => {
    const ohne = sttModuleConfig({
      ...kernKonfig,
      streaming: { url: "ws://127.0.0.1:8095/", endpointingMs: 800 },
    });
    expect(ohne?.streaming?.engine).toBeUndefined();
  });

  it("macht aus „~“ im Schluesseldatei-Pfad das Zuhause — wie vor der Ausgliederung", () => {
    const modul = sttModuleConfig(kernKonfig);
    expect(modul?.streaming?.apiKeyFile).toMatch(/[\\/]ancientvoid[\\/]stt\.key$/);
    expect((modul?.streaming?.apiKeyFile ?? "").replace(/\\/g, "/")).toContain("/.config/ancientvoid/stt.key");
    expect(modul?.streaming?.apiKeyFile).not.toMatch(/^~/);
  });

  it("hat ohne Konfig auch kein Sprachmodul", () => {
    expect(sttModuleConfig(undefined)).toBeUndefined();
  });
});
