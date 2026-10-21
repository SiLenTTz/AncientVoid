import { describe, expect, it } from "vitest";
import { chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { catalogFromConfigOptions, probeModelCatalog } from "../src/catalog.ts";

const agent = fileURLToPath(new URL("../../../../e2e/support/bin/acp-agent", import.meta.url));
chmodSync(agent, 0o755);

describe("model catalog of an ACP agent without listing command (dsh ≥ 0.2)", () => {
  it("reads provider/model pairs from the real dsh 0.2.1 session/new shape", () => {
    const real = [
      {
        id: "model",
        category: "model",
        options: [
          { group: "deepseek-official", name: "DeepSeek", options: [{ value: '["deepseek-official","deepseek-v4-flash"]', name: "deepseek-v4-flash" }] },
          { group: "zai", name: "Z.AI", options: [{ value: '["zai","glm-5.3"]', name: "GLM-5.3" }, { value: '["zai","glm-5.3-flash"]', name: "GLM-5.3-Flash" }] },
        ],
      },
      { id: "reasoning_effort", category: "thought_level", options: [{ value: "high", name: "High" }] },
    ];
    expect(catalogFromConfigOptions(real)).toEqual([
      { id: "deepseek-official/deepseek-v4-flash", label: "DeepSeek: deepseek-v4-flash" },
      { id: "zai/glm-5.3", label: "Z.AI: GLM-5.3" },
      { id: "zai/glm-5.3-flash", label: "Z.AI: GLM-5.3-Flash" },
    ]);
  });

  it("takes flat plain ids as they are, and nothing without a model option", () => {
    expect(catalogFromConfigOptions([{ id: "model", options: [{ value: "a/b", name: "A B" }] }])).toEqual([{ id: "a/b", label: "A B" }]);
    expect(catalogFromConfigOptions([{ id: "mode", options: [{ value: "x" }] }])).toEqual([]);
    expect(catalogFromConfigOptions(undefined)).toEqual([]);
  });

  it("probes a real agent process and waits for the full list that follows session/new", async () => {
    // The fake agent answers session/new with the first provider only and sends the rest 100 ms later, like dsh.
    const models = await probeModelCatalog([agent], {}, { settleMs: 600 });
    expect(models.map((m) => m.id).sort()).toEqual(["cloud/gross", "lokal/glm-5.3", "lokal/klein"]);
  });

  it("fails loudly when the agent is not there", async () => {
    await expect(probeModelCatalog(["/nonexistent/agent-binary"], {}, { timeoutMs: 3000 })).rejects.toThrow();
  });
});
