import { describe, expect, it } from "vitest";
import { engineLabel, newArtifactDraft, renameDraft, skippedNote } from "../../../src/features/composer/engine-label.ts";

describe("engine label (EPIC-P68 T68.6)", () => {
  it("names the local model or the adapter", () => {
    expect(engineLabel({ kind: "local", id: "local", model: "qwen3-coder" })).toBe("lokal (qwen3-coder)");
    expect(engineLabel({ kind: "adapter", id: "claude" })).toBe("über claude");
    expect(engineLabel(undefined)).toBe("");
  });

  it("shows why a stage was skipped, but not the normal 'no local model' state", () => {
    expect(skippedNote([{ engine: "Lokales Modell", reason: "nicht konfiguriert" }])).toBe("");
    expect(
      skippedNote([
        { engine: "Lokales Modell (qwen3-coder)", reason: "ausgelastet (alle Slots belegt)" },
        { engine: "pi", reason: "kein eigener One-Shot" },
      ]),
    ).toBe("Lokales Modell (qwen3-coder): ausgelastet (alle Slots belegt) · pi: kein eigener One-Shot");
  });

  it("a new draft carries the name in its frontmatter and follows a rename", () => {
    const draft = newArtifactDraft("skill", "changelog-2", 'Einträge "kurz"', "Ziel: X");
    expect(draft).toContain('name: changelog-2\ndescription: "Einträge \\"kurz\\""');
    expect(renameDraft(draft, "release-notes")).toContain("---\nname: release-notes\n");
  });
});
