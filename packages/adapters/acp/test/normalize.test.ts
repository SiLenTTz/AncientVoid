import { describe, expect, it } from "vitest";
import { UpdateMapper } from "../src/normalize.ts";

describe("ACP-Textreihenfolge", () => {
  it("erhält assistant → thinking → assistant statt die Texte umzusortieren", () => {
    const mapper = new UpdateMapper("test");
    const events = [
      ...mapper.map({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Ich prüfe." } }),
      ...mapper.map({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Erst lesen." } }),
      ...mapper.map({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Ergebnis." } }),
      ...mapper.flush(),
    ];
    expect(events.map((e) => [e.type, e.payload.text])).toEqual([
      ["assistant", "Ich prüfe."], ["thinking", "Erst lesen."], ["assistant", "Ergebnis."],
    ]);
  });
});
