import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertContractGreen, makeRecordingContext, runLoopContractTests, waitFor } from "@uacc/adapter-testkit";
import type { SessionHandle } from "@uacc/contracts";
import { createLoopConnector } from "../src/index.ts";

const FIXTURES = fileURLToPath(new URL("./fixtures/project", import.meta.url));
const hasPython = spawnSync("python3", ["--version"], { stdio: "ignore" }).error === undefined;

/** Stand-in für die factory-CLI: gibt den Inhalt von progress-out.json als eine JSON-Zeile aus (Vertrag v1: stdout). */
const fakeFactoryBin = (root: string) => {
  const bin = join(root, "fake-factory.sh");
  writeFileSync(bin, `#!/bin/sh\ncat "${join(root, "progress-out.json")}"\n`, { mode: 0o755 });
  return bin;
};

describe("securesight-Connector im Modus project (T26.3, EPIC-P26)", () => {
  let root: string;
  let bin: string;
  const setProgress = (doc: unknown) => writeFileSync(join(root, "progress-out.json"), typeof doc === "string" ? doc : JSON.stringify(doc));
  const of = (ctx: { events: { payload?: unknown }[] }, k: string) => ctx.events.filter((e) => (e.payload as { kind?: string }).kind === k).map((e) => e.payload as Record<string, unknown>);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "uacc-factory-project-"));
    cpSync(FIXTURES, root, { recursive: true });
    bin = fakeFactoryBin(root);
    setProgress({ schema_version: "1", total: 0, done: 0, stories: [], now: null, updated_at: null, events: [] });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const connect = async (config: Record<string, unknown> = {}, resume: unknown = null) => {
    const connector = createLoopConnector({ pollMs: 40, factory: bin, ...config });
    const ctx = makeRecordingContext();
    const saved: unknown[] = [];
    const handle = await connector.start({ project: root, options: {} }, ctx, { resume, saveCursor: (c) => saved.push(JSON.parse(JSON.stringify(c))) });
    return { connector, ctx, handle, saved };
  };

  /** status() ist asynchron — deshalb ein eigener Takt statt waitFor (das nur synchrone Prädikate nimmt). */
  const waitStatus = async (connector: { status: (h: SessionHandle) => Promise<{ state: string }> }, handle: SessionHandle, state: string) => {
    const t0 = Date.now();
    for (;;) {
      const health = await connector.status(handle);
      if (health.state === state) return;
      if (Date.now() - t0 > 3000) throw new Error(`waitStatus: timeout (${health.state} statt ${state})`);
      await new Promise((r) => setTimeout(r, 25));
    }
  };

  it("besteht die Loop-Contract-Suite auch im Projektmodus", async () => {
    const results = await runLoopContractTests(createLoopConnector, { config: { pollMs: 40, factory: bin }, spec: { project: root, options: {} } });
    assertContractGreen(results);
  });

  it("Fortschritt kommt aus `factory progress show` (Schema 1), Änderungen werden gemeldet", async () => {
    rmSync(join(root, ".factory", "lauf-status.json")); // Fixture hat einen alten Heartbeat; ohne Lauf ist healthy korrekt
    const { ctx, connector, handle } = await connect();
    await waitFor(() => of(ctx, "loop.info").length + of(ctx, "loop.progress").length > 0);
    setProgress({ schema_version: "1", total: 5, done: 2, now: { phase: "bauen", story: "S-1", task: "T-3" }, stories: [], updated_at: "2026-10-30T12:00:00Z", events: [] });
    await waitFor(() => of(ctx, "loop.progress").some((p) => p.source === "factory" && p.done === 2 && p.total === 5 && p.phase === "bauen"));
    expect(of(ctx, "loop.progress").at(-1)).toMatchObject({ feature: "S-1", step: "T-3" });
    await waitStatus(connector, handle, "healthy");
    await connector.stop(handle, ctx);
  });

  it("Lauf-Status (REQ-2903): Phase wird gemeldet, alter Heartbeat ⇒ „wartet ohne Fortschritt“ (degraded), frischer ⇒ wieder healthy", async () => {
    const { ctx, connector, handle } = await connect({ staleAfterS: 10 });
    const lauf = (doc: Record<string, unknown>) => writeFileSync(join(root, ".factory", "lauf-status.json"), JSON.stringify(doc));
    lauf({ schema_version: "1", task: "T1-Anmeldung", phase: "pre_task", heartbeat_at: Math.floor(Date.now() / 1000) - 600 });
    await waitFor(() => of(ctx, "loop.hold").some((p) => typeof p.reason === "string" && p.reason.includes("wartet ohne Fortschritt")));
    await waitStatus(connector, handle, "degraded");
    lauf({ schema_version: "1", task: "T1-Anmeldung", phase: "implementation", heartbeat_at: Math.floor(Date.now() / 1000) });
    await waitFor(() => of(ctx, "loop.info").some((p) => p.source === "lauf-status" && p.task === "T1-Anmeldung" && p.phase === "implementation"));
    await waitStatus(connector, handle, "healthy");
    await connector.stop(handle, ctx);
  });

  it("Fehlerbelege (Bootstrap/Lauf-Ende) werden einmal gemeldet — auch nach Wiederanlauf nicht doppelt (K7)", async () => {
    const { ctx, connector, handle, saved } = await connect();
    await waitFor(() => of(ctx, "loop.notify").length === 2);
    expect(of(ctx, "loop.notify")).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: "factory", reason: expect.stringContaining("provider nicht konfiguriert") }),
      expect.objectContaining({ reason: expect.stringContaining("permission_denials") }),
    ]));
    const cursor = saved.at(-1);
    await connector.stop(handle, ctx);
    const second = await connect({}, cursor);
    await new Promise((r) => setTimeout(r, 150));
    expect(of(second.ctx, "loop.notify")).toHaveLength(0); // Cursor weiß: schon gemeldet
    await second.connector.stop(second.handle, second.ctx);
  });

  it("fail loud (K9): kaputtes JSON, unbekanntes Schema und fehlendes Binary ⇒ loop.broken mit Grund; Intake läuft weiter", async () => {
    setProgress("{kein json");
    const { ctx, connector, handle } = await connect();
    await waitFor(() => of(ctx, "loop.broken").length > 0);
    expect(of(ctx, "loop.broken")[0]).toMatchObject({ reason: expect.stringContaining("progress show") });
    await waitFor(() => of(ctx, "loop.info").some((p) => p.source === "intake" && p.status === "intake"));
    await connector.stop(handle, ctx);

    setProgress({ schema_version: "9", total: 1, done: 0, stories: [], now: null, updated_at: null, events: [] });
    const schemaCtx = makeRecordingContext();
    const schemaConnector = createLoopConnector({ pollMs: 40, factory: bin });
    const schemaHandle = await schemaConnector.start({ project: root, options: {} }, schemaCtx, { resume: null, saveCursor: () => {} });
    await waitFor(() => of(schemaCtx, "loop.broken").some((p) => typeof p.reason === "string" && p.reason.includes("Schema 9")));
    await schemaConnector.stop(schemaHandle, schemaCtx);

    const missingCtx = makeRecordingContext();
    const missingConnector = createLoopConnector({ pollMs: 40, factory: "/existiert/nicht/factory" });
    const missingHandle = await missingConnector.start({ project: root, options: {} }, missingCtx, { resume: null, saveCursor: () => {} });
    await waitFor(() => of(missingCtx, "loop.broken").length > 0);
    expect(await missingConnector.status(missingHandle)).toMatchObject({ state: "broken" });
    await missingConnector.stop(missingHandle, missingCtx);
  });

  it("Erkennung: Verzeichnis ohne betrieb.py und ohne .factory/config.json wird abgelehnt", async () => {
    const empty = mkdtempSync(join(tmpdir(), "uacc-factory-leer-"));
    try {
      const connector = createLoopConnector({ pollMs: 40 });
      await expect(connector.start({ project: empty, options: {} }, makeRecordingContext(), { resume: null, saveCursor: () => {} })).rejects.toThrow(/kein securesight-factory-Projekt/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it.skipIf(!hasPython)("Modus repo bleibt repo: betrieb.py gewinnt gegen .factory/config.json (Regressionsschutz)", async () => {
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(join(root, "scripts", "betrieb.py"), "# kein gültiges Python: supervisor fällt aus; entscheidend ist, dass der repo-Pfad benutzt wird\n");
    const { connector, ctx, handle } = await connect();
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string }).kind === "loop.broken"));
    expect(of(ctx, "loop.progress").every((p) => p.source !== "factory")).toBe(true);
    await connector.stop(handle, ctx);
  });

  it("schreibt nichts in das Projekt (Verzeichnis vorher = nachher, P19-Muster)", async () => {
    const before = readdirSync(root).sort().join(",");
    const { connector, ctx, handle } = await connect();
    await new Promise((r) => setTimeout(r, 200));
    expect(readdirSync(root).sort().join(",")).toBe(before);
    await connector.stop(handle, ctx);
  });
});

describe("securesight-Onboarding über factory init (T26.4, EPIC-P26)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "uacc-factory-onboard-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** Fake-CLI: `init` gibt die Datei aus (oder stderr+Exit 1), alles andere den
   * Fortschritt. Mit `factoryHome` trägt der Shim wie die echte Installation
   * eine FACTORY_HOME-Zeile. */
  const makeBin = (initFile: string | null, initErr?: string, factoryHome?: string) => {
    const bin = join(dir, "factory.sh");
    const init = initErr !== undefined ? `printf '%s' '${initErr}' >&2; exit 1` : `cat '${initFile}'`;
    writeFileSync(bin, `#!/bin/sh\n${factoryHome ? `FACTORY_HOME='${factoryHome}'\n` : ""}if [ "$1" = "init" ]; then printf '%s\\n' "$@" > '${join(dir, "init-args.txt")}'; ${init}; exit 0; fi\ncat '${join(dir, "progress-out.json")}'\n`, { mode: 0o755 });
    return bin;
  };
  const writeInit = (doc: unknown) => {
    const file = join(dir, "init-out.json");
    writeFileSync(file, typeof doc === "string" ? doc : JSON.stringify(doc));
    return file;
  };
  const onboard = (bin: string, options: Record<string, string>) => createLoopConnector({ factory: bin, pollMs: 40 }).onboard?.({ options }, new AbortController().signal);

  it("factory init ohne Geheimnis: Checkliste als detail, Anbindung schaltet auf „bestehend“", async () => {
    const bin = makeBin(writeInit({ root: "/x", checkliste: ["git: ok", "ready: alle wirkungs-pruefungen gruen — lauf kann starten"] }));
    const res = await onboard(bin, { root: "/tmp/proj", modus: "a", provider: "zai" });
    expect(res).toMatchObject({ ok: true, options: { anbindung: "bestehend" } });
    expect(res?.ok && res.detail).toContain("ready:");
    expect(res?.ok && res.detail).not.toContain("noch nicht bereit");
  });

  it("ohne gemeldetes ready bleibt der Hinweis „noch nicht bereit“ (REQ-3001)", async () => {
    const bin = makeBin(writeInit({ root: "/x", checkliste: ["git: ok", "intake: intake"] }));
    const res = await onboard(bin, { root: "/tmp/proj", modus: "b", provider: "anthropic" });
    expect(res?.ok && res.detail).toContain("noch nicht bereit");
  });

  it("PRD-Pfad wird durchgereicht; Validierung schlägt laut fehl, bevor die CLI läuft", async () => {
    const bin = makeBin(writeInit({ checkliste: [] }));
    for (const [options, grund] of [
      [{ modus: "a", provider: "zai" }, "Projektpfad"],
      [{ root: "relativ/pfad", modus: "a", provider: "zai" }, "Projektpfad"],
      [{ root: "/tmp/p", modus: "x", provider: "zai" }, "Betriebsmodus"],
      [{ root: "/tmp/p", modus: "a", provider: "openai" }, "Provider"],
      [{ root: "/tmp/p", prd: "rel.md", modus: "a", provider: "zai" }, "PRD-Pfad"],
    ] as [Record<string, string>, string][]) {
      const res = await onboard(bin, options);
      expect(res).toMatchObject({ ok: false });
      expect(res && !res.ok && res.detail).toContain(grund);
    }
  });

  it("factory init scheitert: stderr als Grund, stdout ohne JSON und fehlendes Binary laut abgelehnt", async () => {
    const fail = await onboard(makeBin(null, "git nicht gefunden"), { root: "/tmp/p", modus: "a", provider: "zai" });
    expect(fail).toMatchObject({ ok: false, detail: expect.stringContaining("git nicht gefunden") });

    const noJson = await onboard(makeBin(writeInit("nicht json")), { root: "/tmp/p", modus: "a", provider: "zai" });
    expect(noJson).toMatchObject({ ok: false, detail: expect.stringContaining("kein JSON") });

    const missing = await createLoopConnector({ factory: "/existiert/nicht/factory", pollMs: 40 }).onboard?.({ options: { root: "/tmp/p", modus: "a", provider: "zai" } }, new AbortController().signal);
    expect(missing).toMatchObject({ ok: false, detail: expect.any(String) });
  });
});

describe("Harness-Wahl ausgeblendet mit Grund (T26.7, AC-P26-9)", () => {
  it("Capabilities nennen keinen Harness, aber einen Grund in onboarding.notes", () => {
    const caps = createLoopConnector().capabilities();
    expect(caps.options.some((o) => o.key === "harness")).toBe(false);
    expect(caps.onboarding?.notes?.some((n) => n.includes("Harness-Wahl") && n.includes("ausgeblendet"))).toBe(true);
  });
});

describe("Modellwahl beim Anbinden: Projekt-Override policies/modell-routing.json (Nutzerwunsch 2026-10-30)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "uacc-factory-modell-"));
    writeFileSync(join(dir, "init-out.json"), JSON.stringify({ checkliste: ["ready: alle gruen"] }));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const onboard = (bin: string, options: Record<string, string>) => createLoopConnector({ factory: bin, pollMs: 40 }).onboard?.({ options }, new AbortController().signal);
  const initOut = () => join(dir, "init-out.json");

  it("Capabilities: Modell-Auswahl steht im Anbindungs-Formular, Standard zuerst", () => {
    const caps = createLoopConnector().capabilities();
    const modell = caps.onboarding?.fields.find((f) => f.key === "modell");
    expect(modell?.kind).toBe("select");
    expect(modell?.choices?.[0]).toMatchObject({ value: "", label: expect.stringContaining("Standard-Routing") });
    expect(modell?.choices?.map((c) => c.value)).toContain("zai/glm-5.3");
    expect(modell?.choices?.map((c) => c.value)).toContain("anthropic/claude-opus-5-5");
  });

  it("zai-Modell bestimmt den Provider für factory init und schreibt den Override für alle Stufen", async () => {
    const home = makeFactoryHome();
    const bin = join(dir, "factory.sh");
    writeFileSync(bin, `#!/bin/sh\nFACTORY_HOME='${home}'\nif [ "$1" = "init" ]; then printf '%s\\n' "$@" > '${join(dir, "args.txt")}'; cat '${initOut()}'; exit 0; fi\n`, { mode: 0o755 });
    const project = join(dir, "proj");
    const res = await onboard(bin, { root: project, modus: "a", provider: "anthropic", modell: "zai/glm-5.3" });
    expect(res).toMatchObject({ ok: true });
    expect(res?.ok && res.detail).toContain("modell: glm-5.3 (zai)");
    // Modell schlägt das Provider-Feld: init läuft mit zai.
    expect(readFileSync(join(dir, "args.txt"), "utf8").split("\n").join(" ")).toContain("--provider zai");
    const policy = JSON.parse(readFileSync(join(project, "policies", "modell-routing.json"), "utf8"));
    expect(policy.default_provider).toBe("zai");
    expect(policy.providers.zai.tier_models).toEqual({ planung: "glm-5.3", mittel: "glm-5.3", einfach: "glm-5.3" });
    // tiers bleiben beim Anthropic-Standard — der zai-Pfad läuft über tier_models.
    expect(policy.tiers.mittel.model).toBe("claude-sonnet-5-5");
  });

  it("anthropic-Modell patcht die Stufen, ohne zai-Profil anzufassen", async () => {
    const home = makeFactoryHome();
    const bin = join(dir, "factory.sh");
    writeFileSync(bin, `#!/bin/sh\nFACTORY_HOME='${home}'\nif [ "$1" = "init" ]; then cat '${initOut()}'; exit 0; fi\n`, { mode: 0o755 });
    const project = join(dir, "proj");
    const res = await onboard(bin, { root: project, modus: "a", provider: "anthropic", modell: "anthropic/claude-opus-5-5" });
    expect(res).toMatchObject({ ok: true });
    const policy = JSON.parse(readFileSync(join(project, "policies", "modell-routing.json"), "utf8"));
    for (const tier of ["planung", "mittel", "einfach"]) expect(policy.tiers[tier].model).toBe("claude-opus-5-5");
    expect(policy.default_provider).toBe("anthropic");
    expect(policy.providers.zai.tier_models.einfach).toBe("glm-5.3-flash");
  });

  it("ohne Modellwahl wird kein Override geschrieben", async () => {
    const home = makeFactoryHome();
    const bin = join(dir, "factory.sh");
    writeFileSync(bin, `#!/bin/sh\nFACTORY_HOME='${home}'\nif [ "$1" = "init" ]; then cat '${initOut()}'; exit 0; fi\n`, { mode: 0o755 });
    const project = join(dir, "proj");
    const res = await onboard(bin, { root: project, modus: "a", provider: "anthropic", modell: "" });
    expect(res).toMatchObject({ ok: true });
    expect(existsSync(join(project, "policies"))).toBe(false);
  });

  it("ungültiges Modell oder unauffindbare Standard-Policy scheitern laut", async () => {
    const home = makeFactoryHome();
    const binOk = join(dir, "factory-ok.sh");
    writeFileSync(binOk, `#!/bin/sh\nFACTORY_HOME='${home}'\nif [ "$1" = "init" ]; then cat '${initOut()}'; exit 0; fi\n`, { mode: 0o755 });
    expect(await onboard(binOk, { root: "/tmp/p", modus: "a", provider: "zai", modell: "openai/x" })).toMatchObject({ ok: false });
    expect(await onboard(binOk, { root: "/tmp/p", modus: "a", provider: "zai", modell: "zai/glm-4" })).toMatchObject({ ok: false });

    const binOhneHome = join(dir, "factory-ohne.sh");
    writeFileSync(binOhneHome, `#!/bin/sh\nif [ "$1" = "init" ]; then cat '${initOut()}'; exit 0; fi\n`, { mode: 0o755 });
    const res = await onboard(binOhneHome, { root: "/tmp/p", modus: "a", provider: "zai", modell: "zai/glm-5.3" });
    expect(res).toMatchObject({ ok: false });
    expect(res && !res.ok && res.detail).toContain("Standard-Policy");
  });

  function makeFactoryHome(): string {
    const home = join(dir, "factory-home");
    mkdirSync(join(home, "policies"), { recursive: true });
    writeFileSync(
      join(home, "policies", "modell-routing.json"),
      JSON.stringify({
        schema_version: "1",
        default_provider: "anthropic",
        tiers: {
          planung: { model: "claude-opus-5-5", effort: "high" },
          mittel: { model: "claude-sonnet-5-5", effort: "medium" },
          einfach: { model: "claude-haiku-5-5", effort: "low" },
        },
        providers: { zai: { base_url: "https://api.z.ai/api/anthropic", key_path: "~/.k", key_field: "zai-coding-plan.key", tier_models: { planung: "glm-5.3", mittel: "glm-5.3", einfach: "glm-5.3-flash" } } },
      }),
    );
    return home;
  }
});
