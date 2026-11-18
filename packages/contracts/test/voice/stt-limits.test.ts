import { describe, expect, it } from "vitest";

import { STT_STREAM_MAX_AUDIO_BYTES, STT_STREAM_MAX_AUDIO_SECONDS } from "../../src/voice/stt.ts";

/**
 * BUG-0215: die Grenze fuer ein Diktat wird an EINER Stelle gefuehlt — in Sekunden.
 * Beide Bremse im Hub (Byte-Bremse und Dauer-Rueckfall) leiten sich aus genau dieser Zahl ab;
 * waere die Umrechnung kaputt, endeten Live-Woerter wieder mitten im Satz.
 */
describe("Streaming-Grenze pro Diktat (BUG-0215)", () => {
  it("gilt in Sekunden — und die Byte-Grenze rechnet daraus konsistent", () => {
    expect(STT_STREAM_MAX_AUDIO_SECONDS).toBe(180);
    expect(STT_STREAM_MAX_AUDIO_BYTES).toBe(16_000 * 2 * STT_STREAM_MAX_AUDIO_SECONDS);
    // 16 kHz mono PCM16: 32 000 Byte pro Sekunde — der Hub-Umrechnungsfaktor.
    expect(STT_STREAM_MAX_AUDIO_BYTES / 32_000).toBe(STT_STREAM_MAX_AUDIO_SECONDS);
  });

  it("traegt ein Mehr-Satz-Diktat (eine knappe Minute war zu knapp)", () => {
    expect(STT_STREAM_MAX_AUDIO_SECONDS).toBeGreaterThanOrEqual(120);
  });
});
