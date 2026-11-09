import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PiProviderInput } from "@ancientvoid/contracts";
import { HubDatabase, SettingsStore, CustomModelStore, writePiProvider } from "../../../src/index.ts";

const provider = (over: Record<string, unknown> = {}) =>
  PiProviderInput.parse({ name: "evo-evox2", baseUrl: "http://100.65.133.28:8100/v1", apiKey: "$EVOX2_KEY", models: [{ id: "halogen-qwen", name: "Halogen Qwen", contextWindow: 131072, reasoning: true }], ...over });

describe("Register eigener Modelle (ADR-0060)", () => {
  const store = () => new CustomModelStore(new SettingsStore(new HubDatabase(":memory:")));

  it("ergänzt den Katalog, ohne einen Eintrag des Adapters zu überdecken", () => {
    const s = store();
    s.add({ id: "anthropic/claude-opus-5-5", label: "Opus 5.5", adapters: [] });
    s.add({ id: "evo/halogen", adapters: ["pi"] });
    expect(s.merge("pi", [{ id: "zai/glm-5.3" }])).toEqual({
      models: [{ id: "zai/glm-5.3" }, { id: "anthropic/claude-opus-5-5", label: "Opus 5.5" }, { id: "evo/halogen" }],
      customIds: ["anthropic/claude-opus-5-5", "evo/halogen"],
    });
    expect(s.merge("maki", null).customIds).toEqual(["anthropic/claude-opus-5-5"]);
    expect(s.merge("pi", [{ id: "evo/halogen", label: "vom Harness" }]).customIds).toEqual(["anthropic/claude-opus-5-5"]);
  });

  it("gleiche Id ersetzt statt zu duplizieren; Entfernen meldet Unbekanntes", () => {
    const s = store();
    s.add({ id: "a/b", adapters: [] });
    s.add({ id: "a/b", label: "neu", adapters: ["pi"] });
    expect(s.list()).toEqual([{ id: "a/b", label: "neu", adapters: ["pi"] }]);
    expect(s.remove("a/b")).toBe(true);
    expect(s.remove("a/b")).toBe(false);
  });
});

describe("Provider in pi's models.json (ADR-0060)", () => {
  it("legt die Datei an, privat (0600), mit Schema und Provider", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "av-pi-")), "agent", "models.json");
    expect(await writePiProvider(file, provider())).toMatchObject({ ok: true, created: true, backup: null });
    const doc = JSON.parse(await readFile(file, "utf8"));
    expect(doc.providers["evo-evox2"]).toMatchObject({ baseUrl: "http://100.65.133.28:8100/v1", api: "openai-completions", apiKey: "$EVOX2_KEY" });
    expect(doc.providers["evo-evox2"].models[0]).toMatchObject({ id: "halogen-qwen", contextWindow: 131072, reasoning: true });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("lässt bestehende Provider unberührt, sichert vorher und verweigert stilles Überschreiben", async () => {
    const dir = await mkdtemp(join(tmpdir(), "av-pi-"));
    const file = join(dir, "models.json");
    const original = { providers: { alt: { baseUrl: "http://x/v1", models: [{ id: "m" }] } }, extra: 1 };
    await writeFile(file, JSON.stringify(original));
    const first = await writePiProvider(file, provider());
    expect(first).toMatchObject({ ok: true, created: true });
    const doc = JSON.parse(await readFile(file, "utf8"));
    expect(doc.providers.alt).toEqual(original.providers.alt);
    expect(doc.extra).toBe(1);
    expect((await readdir(dir)).some((f) => f.startsWith("models.json.bak-"))).toBe(true);

    expect(await writePiProvider(file, provider({ baseUrl: "http://other/v1" }))).toMatchObject({ ok: false, status: 409 });
    expect(JSON.parse(await readFile(file, "utf8")).providers["evo-evox2"].baseUrl).toBe("http://100.65.133.28:8100/v1");
    expect(await writePiProvider(file, provider({ baseUrl: "http://other/v1" }), { replace: true })).toMatchObject({ ok: true, created: false });
  });

  it("schreibt nicht in eine kaputte Datei", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "av-pi-")), "models.json");
    await writeFile(file, "{ kaputt");
    expect(await writePiProvider(file, provider())).toMatchObject({ ok: false, status: 422 });
    expect(await readFile(file, "utf8")).toBe("{ kaputt");
  });

  it("prüft Eingaben: nur http(s), saubere Namen", () => {
    expect(PiProviderInput.safeParse({ name: "x", baseUrl: "file:///etc/passwd", models: [{ id: "m" }] }).success).toBe(false);
    expect(PiProviderInput.safeParse({ name: "../x", baseUrl: "http://h/v1", models: [{ id: "m" }] }).success).toBe(false);
    expect(PiProviderInput.safeParse({ name: "x", baseUrl: "http://h/v1", models: [] }).success).toBe(false);
  });
});
