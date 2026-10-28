import { EmittedEvent, LOOP_CONTROLS, LOOP_NEW, type LoopConnector, type LoopStartSpec } from "@uacc/contracts";
import { makeRecordingContext, waitFor, type ContractTestResult, type RecordingContext } from "./helpers.ts";

export interface LoopContractOptions {
  config?: Record<string, unknown>;
  /** Startvorgabe, die der Connector annimmt (Pflichtoptionen gesetzt). */
  spec?: Partial<LoopStartSpec>;
  firstEventTimeoutMs?: number;
  /** Was der Connector aus seiner Umgebung liest — der Test sorgt dafür, dass es dort etwas gibt. */
  prepare?: (ctx: RecordingContext) => Promise<void> | void;
}

/**
 * ADR-0038: der Loop-Contract, ausführbar. Grün = der Connector ist hub-integrierbar.
 * Gleiche Form wie `runContractTests` für Adapter.
 */
export async function runLoopContractTests(
  factory: (config?: Record<string, unknown>) => LoopConnector,
  opts: LoopContractOptions = {},
): Promise<ContractTestResult[]> {
  const results: ContractTestResult[] = [];
  const check = async (name: string, fn: () => void | Promise<void>) => {
    try {
      await fn();
      results.push({ name, ok: true });
    } catch (err) {
      results.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) });
    }
  };
  const connector = factory(opts.config);

  await check("identity: Loop-Id im eigenen Namensraum + semver", () => {
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(connector.id)) throw new Error("id muss [a-z][a-z0-9-]* sein");
    if (!/^\d+\.\d+\.\d+/.test(connector.version)) throw new Error("version must be semver");
  });

  await check("capabilities(): vollständig und in sich stimmig", () => {
    const c = connector.capabilities();
    if (c.agents !== "external" && c.agents !== "hub") throw new Error("agents");
    for (const key of ["intake", "modes", "riskyModes", "orchestrators", "controls", "gates", "options"] as const) {
      if (!Array.isArray(c[key])) throw new Error(`capabilities.${key} must be an array`);
    }
    for (const m of c.riskyModes) if (!c.modes.includes(m)) throw new Error(`riskyMode „${m}“ steht nicht in modes`);
    for (const k of c.controls) if (!LOOP_CONTROLS.includes(k)) throw new Error(`unbekannter control „${k}“`);
    if (c.controls.includes("setMode") && c.modes.length === 0) throw new Error("setMode ohne modes");
    if (!["none", "permission", "permission+question"].includes(c.asks)) throw new Error("asks");
    for (const o of c.options) {
      if (!o.key || !o.label) throw new Error("option braucht key und label");
      if (o.kind === "select" && !o.choices?.length) throw new Error(`select-Option „${o.key}“ ohne choices`);
    }
  });

  await check("onboarding: Felder stimmig, onboard() vorhanden und lehnt ein leeres Geheimnis laut ab", async () => {
    const ob = connector.capabilities().onboarding;
    if (!ob) return;
    if (!connector.capabilities().options.some((o) => o.key === ob.optionKey && o.kind === "select" && o.choices?.some((c) => c.value === LOOP_NEW))) {
      throw new Error("onboarding.optionKey muss eine select-Option mit der Auswahl LOOP_NEW sein");
    }
    if (!ob.fields.length || !ob.secret.label) throw new Error("onboarding braucht fields und secret.label");
    if (!connector.onboard) throw new Error("onboarding angeboten, aber onboard() fehlt");
    const res = await connector.onboard({ options: {}, secret: "" }, new AbortController().signal);
    if (res.ok) throw new Error("onboard() ohne Angaben und Geheimnis darf nicht gelingen");
    if (!res.detail) throw new Error("Ablehnung ohne Grund (fail loud)");
  });

  const ctx = makeRecordingContext();
  await opts.prepare?.(ctx);
  const spec: LoopStartSpec = { project: process.cwd(), options: {}, ...opts.spec };
  let handle: Awaited<ReturnType<LoopConnector["start"]>> | null = null;
  let cursor: unknown = null;

  await check("start(): Handle mit der Session-Id des Hubs", async () => {
    handle = await connector.start(spec, ctx, { resume: null, saveCursor: (c) => (cursor = c) });
    if (handle.sessionId !== ctx.sessionId) throw new Error("handle.sessionId ≠ ctx.sessionId");
  });

  await check("meldet sich mit Loop-Ereignissen (system, payload.kind = loop.*)", async () => {
    await waitFor(() => ctx.events.some((e) => (e.payload as { kind?: string } | undefined)?.kind?.startsWith("loop.")), opts.firstEventTimeoutMs ?? 5000);
  });

  await check("alle Ereignisse schemagültig, K5 (Payload ≤ 4 KB), Summary ≤ 200", () => {
    for (const ev of ctx.events) {
      const parsed = EmittedEvent.safeParse(ev);
      if (!parsed.success) throw new Error(`invalid event: ${parsed.error.issues[0]?.message}`);
      if (ev.summary.length > 200) throw new Error("summary > 200 chars");
      if (JSON.stringify(ev.payload ?? {}).length > 4096) throw new Error("payload > 4 KB — gehört in ctx.blob()");
    }
  });

  await check("status(): gültiger Gesundheitszustand", async () => {
    if (!handle) throw new Error("no handle");
    const rep = await connector.status(handle);
    if (!["healthy", "degraded", "down", "broken"].includes(rep.state)) throw new Error(`invalid state ${rep.state}`);
  });

  await check("control(): ein nicht angebotener Befehl wird laut abgelehnt, nie geworfen", async () => {
    if (!handle) throw new Error("no handle");
    const caps = connector.capabilities();
    const missing = LOOP_CONTROLS.find((k) => !caps.controls.includes(k));
    if (!missing) return;
    const input = missing === "setMode" ? ({ kind: "setMode", mode: "x" } as const) : ({ kind: missing } as const);
    const ack = await connector.control(handle, input, ctx);
    if (ack.ok) throw new Error(`„${missing}“ nicht angeboten, aber ok`);
    if (!ack.detail) throw new Error("Ablehnung ohne Grund (fail loud)");
  });

  await check("Wiederanlauf: start() mit gespeicherter Position wirft nicht und liefert Handle", async () => {
    const ctx2 = makeRecordingContext({ sessionId: "loop-recovered" });
    await opts.prepare?.(ctx2);
    const h = await connector.start(spec, ctx2, { resume: cursor, saveCursor: () => undefined });
    if (h.sessionId !== "loop-recovered") throw new Error("handle.sessionId");
    await connector.stop(h, ctx2);
  });

  await check("stop(): trennt sauber und ist wiederholbar", async () => {
    if (!handle) throw new Error("no handle");
    await connector.stop(handle, ctx);
    await connector.stop(handle, ctx);
    const rep = await connector.status(handle);
    if (rep.state === "healthy") throw new Error("noch healthy nach stop");
  });

  return results;
}
