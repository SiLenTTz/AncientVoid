import { describe, expect, it } from "vitest";
import { parsePrometheus } from "../../src/modules/aimetrics/prometheus.ts";

/** EPIC-P59 (ADR-0078): eigener Parser für das Prometheus-Textformat (kein Import, ADR-0010). */
describe("prometheus parser (EPIC-P59)", () => {
  it("liest Counter und Guuges im Realformat inklusive Typ-Kommentaren", () => {
    const text = [
      "# HELP llamacpp:prompt_tokens_total Number of prompt tokens processed.",
      "# TYPE llamacpp:prompt_tokens_total counter",
      "llamacpp:prompt_tokens_total 1240",
      "# HELP llamacpp:prompt_seconds_total Prompt process time in seconds.",
      "# TYPE llamacpp:prompt_seconds_total counter",
      "llamacpp:prompt_seconds_total 3.5",
      "# TYPE llamacpp:predicted_tokens_seconds gauge",
      "llamacpp:predicted_tokens_seconds 41.7",
      "",
    ].join("\n");
    const samples = parsePrometheus(text);
    expect(samples.get("llamacpp:prompt_tokens_total")).toEqual([1240]);
    expect(samples.get("llamacpp:prompt_seconds_total")).toEqual([3.5]);
    expect(samples.get("llamacpp:predicted_tokens_seconds")).toEqual([41.7]);
  });

  it("summiert label-getrennte Samples einer Familie (spec_decode position=\"N\")", () => {
    const text = [
      '# TYPE llamacpp:spec_decode_num_accepted_tokens_per_pos_total counter',
      'llamacpp:spec_decode_num_accepted_tokens_per_pos_total{position="0"} 10',
      'llamacpp:spec_decode_num_accepted_tokens_per_pos_total{position="1"} 4',
    ].join("\n");
    expect(parsePrometheus(text).get("llamacpp:spec_decode_num_accepted_tokens_per_pos_total")).toEqual([10, 4]);
  });

  it("ignoriert Zeilen ohne Zahl (Kommentare, Müll)", () => {
    expect(parsePrometheus("garbage line\n# comment\n")).toEqual(new Map());
  });
});
