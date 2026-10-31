import mqtt, { type MqttClient } from "mqtt";
import { readFileSync } from "node:fs";
import { LOOP_NEW } from "@ancientvoid/contracts";
import type { Ack, AdapterContext, HealthReport, LoopCapabilities, LoopConnector, LoopControlInput, LoopIo, LoopStartSpec, SessionHandle } from "@ancientvoid/contracts";
import { expandHome, knownLines, onboardLine, ONBOARDING, readEnvValue } from "./factory.ts";
import { answerQuestions, classify, decode, infoPayload, int, LEGACY_COMMANDS, LINE_PATTERN, MODES, progressPayload, readQuestions, statePayload, statsPayload, str, topics, type Answer } from "./protocol.ts";

const REPORT_INLINE_BYTES = 2000;
const KEEP_ANSWERED = 50;
/** Wie viele Dedupe-Schlüssel der Cursor behält (Info, Statistik, Bericht, je Session Zustand/Fortschritt). */
const KEEP_KEYS = 40;

const BASE_CAPABILITIES: LoopCapabilities = {
  agents: "external",
  intake: ["issues"],
  modes: MODES,
  riskyModes: ["autonomous", "dark"],
  orchestrators: [],
  controls: ["pause", "resume", "setMode", "workNext"],
  gates: ["policy", "review", "ci", "merge"],
  asks: "permission+question",
  options: [{ key: "line", label: "Linie", kind: "text", required: true, placeholder: "Name der Linie, z. B. securesight" }],
};

interface Run {
  client: MqttClient;
  line: string;
  closed: boolean;
  /** Offene Störungen je Quelle (Topic, "connection", "ask:<session>"); jede löst sich, sobald ihre Quelle wieder sauber meldet. */
  broken: Map<string, string>;
  info: Record<string, unknown> | null;
  answered: string[];
  pending: Set<string>;
  last: Map<string, string>;
  io: LoopIo;
}

/** Verbindet oder scheitert laut: ohne Antwort in 8 s (oder mit Fehler beim ersten Versuch) gibt es eine Meldung statt eines endlosen Wiederverbindens. */
function connect(url: string, opts: mqtt.IClientOptions): Promise<MqttClient> {
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(url, { ...opts, connectTimeout: 5000, reconnectPeriod: 2000 });
    const fail = (err: Error) => {
      clearTimeout(timer);
      void client.endAsync(true).catch(() => undefined);
      reject(new Error(`MQTT-Broker ${url} nicht erreichbar: ${err.message || "keine Antwort"}`));
    };
    const timer = setTimeout(() => fail(new Error("keine Antwort in 8 s")), 8000);
    client.once("error", fail);
    client.once("connect", () => {
      clearTimeout(timer);
      client.off("error", fail);
      resolve(client);
    });
  });
}

/**
 * ADR-0038: verbindet den Hub mit EINER Linie der aSPARK-Factory über deren MQTT-Leitstand (AsyncAPI 0.9.0).
 * Der Hub ist ein Leitstand-Client wie die eigene Oberfläche der Factory: er liest Info, Zustand, Fortschritt,
 * Statistik und Bericht, beantwortet Fragen und sendet Befehle. Die Linie läuft ohne den Hub weiter.
 * Konfiguration: `url`, `username`, `passwordFile` (nie das Passwort selbst).
 */
export function createLoopConnector(config: Readonly<Record<string, unknown>> = {}): LoopConnector {
  const runs = new Map<string, Run>();
  const url = typeof config.url === "string" && config.url ? config.url : "mqtt://127.0.0.1:1883";
  const username = typeof config.username === "string" && config.username ? config.username : undefined;
  const passwordFile = typeof config.passwordFile === "string" && config.passwordFile ? config.passwordFile : undefined;
  // Das Leitstand-Passwort steht bei factoryctl in factory.env: dieselbe Datei, ein Schlüssel, nie in der Hub-Config.
  const passwordEnvFile = typeof config.passwordEnvFile === "string" && config.passwordEnvFile ? config.passwordEnvFile : undefined;
  const passwordKey = typeof config.passwordKey === "string" && config.passwordKey ? config.passwordKey : "MQTT_LEITSTAND_PASSWORD";
  const factoryctl = typeof config.factoryctl === "string" && config.factoryctl ? config.factoryctl : undefined;
  const factoryHome = typeof config.factoryHome === "string" && config.factoryHome ? config.factoryHome : "~/.aspark-factory";
  const python = typeof config.python === "string" && config.python ? config.python : "python3";

  /** Mit factoryctl: die Linien der Factory zur Auswahl plus „Neues Repo anbinden“; ohne: Linienname als Text. */
  const capabilities = (): LoopCapabilities => {
    if (!factoryctl) return BASE_CAPABILITIES;
    const choices = [...knownLines(factoryHome).map((l) => ({ value: l.name, label: `${l.name} — ${l.repo} (${l.mode})` })), { value: LOOP_NEW, label: "Neues Repo anbinden …" }];
    return { ...BASE_CAPABILITIES, options: [{ key: "line", label: "Linie", kind: "select", required: true, choices }], onboarding: ONBOARDING };
  };

  const note = (ctx: AdapterContext, kind: string, summary: string, payload: Record<string, unknown>) =>
    ctx.emit({ type: "system", summary: summary.slice(0, 200), payload: { kind, ...payload } });

  /** Nur bei Änderung melden: retained Nachrichten kommen nach jedem Wiederverbinden erneut. */
  /** K7: beantwortete Fragen, schon Gemeldetes und der Störungszustand überleben einen Hub-Neustart, damit nichts doppelt kommt. */
  const persist = (run: Run) => run.io.saveCursor({ answered: run.answered, last: Object.fromEntries([...run.last].slice(-KEEP_KEYS)), broken: Object.fromEntries(run.broken) });

  const changed = (run: Run, key: string, value: unknown): boolean => {
    const next = JSON.stringify(value);
    if (run.last.get(key) === next) return false;
    run.last.delete(key); // neu einsortieren: die ältesten Schlüssel fallen zuerst heraus
    run.last.set(key, next);
    persist(run);
    return true;
  };

  const breakLoop = (run: Run, ctx: AdapterContext, key: string, reason: string) => {
    if (run.broken.get(key) === reason) return;
    run.broken.set(key, reason);
    persist(run);
    note(ctx, "loop.broken", `aSPARK ${run.line}: ${reason}`, { loop: "aspark-factory", line: run.line, reason });
  };

  const recover = (run: Run, ctx: AdapterContext, key: string) => {
    const reason = run.broken.get(key);
    if (reason === undefined) return;
    run.broken.delete(key);
    persist(run);
    note(ctx, "loop.recovered", `aSPARK ${run.line}: wieder in Ordnung`, { loop: "aspark-factory", line: run.line, reason });
  };

  async function answer(run: Run, session: string, body: Answer): Promise<void> {
    await run.client.publishAsync(topics.answer(run.line, session), JSON.stringify(body), { qos: 1 });
  }

  async function onAsk(run: Run, ctx: AdapterContext, io: LoopIo, session: string, msg: Record<string, unknown>): Promise<void> {
    const id = str(msg.id, 200);
    if (!id || run.answered.includes(id) || run.pending.has(id)) return;
    const kind = msg.kind;
    const expires = typeof msg.expiresAt === "string" ? Date.parse(msg.expiresAt) : NaN;
    if (Number.isFinite(expires) && expires < Date.now()) {
      note(ctx, "loop.ask.expired", `Frage ${id} war schon abgelaufen`, { id, session });
      return;
    }
    if (!ctx.requestToolPermission) {
      breakLoop(run, ctx, `ask:${session}`, "Der Hub kann keine Rückfragen stellen");
      return;
    }
    const questions = kind === "question" ? readQuestions(msg) : null;
    if (kind === "question" && !questions) {
      breakLoop(run, ctx, `ask:${session}`, `Frage ${id} hat kein gültiges questions[]`);
      return;
    }
    if (kind !== "question" && kind !== "permission") {
      breakLoop(run, ctx, `ask:${session}`, `Frage ${id} mit unbekannter Art „${String(kind)}“`);
      return;
    }
    run.pending.add(id);
    note(ctx, "loop.ask", `Frage der Linie ${run.line}: ${str(msg.title, 120) ?? str(msg.toolName, 80) ?? "Rückfrage"}`, { id, session, ask: kind });
    try {
      const req =
        kind === "question"
          ? { toolName: "AskUserQuestion", toolUseId: id, input: { questions } }
          : { toolName: str(msg.toolName, 200) ?? "tool", toolUseId: id, input: { ...(typeof msg.input === "object" && msg.input !== null ? (msg.input as Record<string, unknown>) : {}), title: str(msg.title, 200) } };
      const result = await ctx.requestToolPermission(req);
      if (run.closed) return;
      if (kind === "permission") {
        await answer(run, session, result.behavior === "allow" ? { id, decision: "allow" } : { id, decision: "deny", message: result.message });
      } else if (result.behavior === "allow") {
        await answer(run, session, answerQuestions(id, questions ?? [], (result.updatedInput.answers ?? {}) as Record<string, unknown>));
      } else {
        // Das Protokoll kennt kein „Nein“ auf eine Frage: die Linie fällt auf ihr timeoutAction zurück.
        note(ctx, "loop.ask.declined", `Frage ${id} nicht beantwortet, die Linie handelt nach timeoutAction`, { id, session, timeoutAction: str(msg.timeoutAction, 20) });
      }
      run.answered = [...run.answered, id].slice(-KEEP_ANSWERED);
      persist(run);
    } catch (err) {
      ctx.log("warn", "aSPARK: Antwort auf Frage fehlgeschlagen", { id, error: err instanceof Error ? err.message : String(err) });
      note(ctx, "loop.ask.failed", `Antwort auf Frage ${id} fehlgeschlagen`, { id, session });
    } finally {
      run.pending.delete(id);
    }
  }

  async function onMessage(run: Run, ctx: AdapterContext, io: LoopIo, topic: string, raw: Uint8Array): Promise<void> {
    const where = classify(run.line, topic);
    if (!where) return;
    if (raw.byteLength === 0) return; // leere retained Nachricht = Frage/Zustand geräumt
    const decoded = decode(raw);
    if (!decoded.ok) {
      breakLoop(run, ctx, topic, `${topic}: ${decoded.reason}`);
      return;
    }
    const m = decoded.value;
    // Eine Störung hebt nur eine saubere Nachricht derselben Quelle auf (Offline: eine Info mit status online).
    if (!(where.kind === "info" && m.status === "offline")) recover(run, ctx, topic);
    switch (where.kind) {
      case "info": {
        run.info = m;
        if (m.status === "offline") {
          breakLoop(run, ctx, topic, "Linie offline (Last Will)");
          return;
        }
        const payload = infoPayload(m);
        if (changed(run, "info", payload)) note(ctx, "loop.info", `aSPARK ${run.line}: ${payload.mode ?? "?"} · ${payload.activity ?? payload.status ?? "?"}`, payload);
        return;
      }
      case "state": {
        const payload = statePayload(where.session, m);
        // Retained Zustände abgeschlossener Sessions kommen bei jedem Start in Massen: ein erstes „fertig/Fehler/leer“ bleibt still.
        const firstSeen = !run.last.has(`state:${where.session}`);
        if (firstSeen && ["done", "error", "idle"].includes(String(payload.state))) {
          run.last.set(`state:${where.session}`, JSON.stringify(payload));
          return;
        }
        if (changed(run, `state:${where.session}`, payload)) note(ctx, "loop.state", `Session ${where.session}: ${payload.state ?? "?"}`, { loop: "aspark-factory", ...payload });
        return;
      }
      case "progress": {
        const payload = progressPayload(m);
        if (changed(run, `progress:${where.session}`, payload)) {
          const g = payload.gate;
          note(ctx, "loop.progress", `${payload.done ?? 0} von ${payload.total ?? 0} Aufgaben${g?.name ? ` · ${g.name} ${g.state ?? ""}` : ""}`.trim(), { session: where.session, ...payload });
        }
        return;
      }
      case "stats": {
        const payload = statsPayload(m);
        if (changed(run, "stats", payload)) note(ctx, "loop.stats", `${payload.completed} Features fertig, ${payload.inProgress} in Arbeit`, payload);
        return;
      }
      case "report": {
        const text = typeof m.text === "string" ? m.text : "";
        const key = str(m.ts, 40) ?? text.slice(0, 40);
        if (!changed(run, "report", key)) return;
        const counts = typeof m.counts === "object" && m.counts !== null ? (m.counts as Record<string, unknown>) : {};
        const base = { counts: Object.fromEntries(Object.entries(counts).flatMap(([k, v]) => (int(v) !== undefined ? [[k, v]] : []))), url: str(m.url, 300) ?? null };
        if (Buffer.byteLength(text) > REPORT_INLINE_BYTES) {
          const ref = await ctx.blob(text); // K5: Berichte sind groß, der Verlauf bekommt nur den Verweis
          note(ctx, "loop.report", "Tagesbericht der Linie", { ...base, blob: ref.hash });
        } else {
          note(ctx, "loop.report", "Tagesbericht der Linie", { ...base, text });
        }
        return;
      }
      case "ask":
        await onAsk(run, ctx, io, where.session, m);
    }
  }

  const commands = (run: Run): readonly string[] => {
    const c = run.info?.commands;
    return Array.isArray(c) ? c.filter((x): x is string => typeof x === "string") : LEGACY_COMMANDS;
  };

  return {
    id: "aspark-factory",
    version: "0.1.0",
    capabilities,

    ...(factoryctl ? { onboard: (input: { options: Record<string, string>; secret: string }, signal: AbortSignal) => onboardLine({ factoryctl, home: factoryHome, python }, input, signal) } : {}),

    async start(spec: LoopStartSpec, ctx: AdapterContext, io: LoopIo): Promise<SessionHandle> {
      const line = spec.options.line?.trim() ?? "";
      if (line === LOOP_NEW) throw new Error("Das neue Repo muss erst angebunden werden");
      if (!LINE_PATTERN.test(line)) throw new Error("Option „line“ fehlt oder ist kein Linienname (a–z, 0–9, -)");
      const password = passwordFile ? readFileSync(expandHome(passwordFile), "utf8").trim() : passwordEnvFile ? readEnvValue(passwordEnvFile, passwordKey) : undefined;
      const client = await connect(url, { clientId: `ancientvoid-${ctx.sessionId}`, ...(username ? { username } : {}), ...(password ? { password } : {}) });
      const saved = (io.resume ?? {}) as { answered?: unknown; last?: unknown; broken?: unknown };
      const last = typeof saved.last === "object" && saved.last !== null ? Object.entries(saved.last).filter((e): e is [string, string] => typeof e[1] === "string") : [];
      const run: Run = {
        client,
        line,
        closed: false,
        broken: new Map(typeof saved.broken === "object" && saved.broken !== null ? Object.entries(saved.broken).filter((e): e is [string, string] => typeof e[1] === "string") : []),
        info: null,
        answered: Array.isArray(saved.answered) ? saved.answered.filter((x): x is string => typeof x === "string") : [],
        pending: new Set(),
        last: new Map(last),
        io,
      };
      runs.set(ctx.sessionId, run);
      client.on("message", (topic, payload) => {
        onMessage(run, ctx, io, topic, payload).catch((err) => ctx.log("error", "aSPARK: Nachricht nicht verarbeitet", { topic, error: err instanceof Error ? err.message : String(err) }));
      });
      client.on("close", () => {
        if (!run.closed) breakLoop(run, ctx, "connection", "Verbindung zum Broker verloren");
      });
      client.on("connect", () => {
        recover(run, ctx, "connection");
      });
      ctx.signal.addEventListener("abort", () => void client.endAsync(true).catch(() => undefined), { once: true });
      await client.subscribeAsync(topics.subscriptions(line), { qos: 1 });
      return { sessionId: ctx.sessionId, meta: { line, url } };
    },

    async control(handle: SessionHandle, input: LoopControlInput, ctx: AdapterContext): Promise<Ack> {
      const run = runs.get(handle.sessionId);
      if (!run || run.closed) return { ok: false, detail: "nicht verbunden" };
      if (!capabilities().controls.includes(input.kind)) return { ok: false, detail: `Befehl „${input.kind}“ wird nicht angeboten` };
      if (!run.info) return { ok: false, detail: `Linie „${run.line}“ hat sich noch nicht gemeldet` };
      let body: Record<string, unknown>;
      if (input.kind === "setMode") {
        if (!(MODES as readonly string[]).includes(input.mode)) return { ok: false, detail: `Betriebsart „${input.mode}“ unbekannt` };
        body = { command: "set-mode", mode: input.mode };
      } else if (input.kind === "workNext") {
        const text = input.text?.trim().replace(/^#/, "");
        if (text && !/^\d+$/.test(text)) return { ok: false, detail: "„work“ nimmt nur eine Issue-Nummer; ohne Nummer das älteste bereite Issue" };
        body = { command: "work", ...(text ? { issue: Number(text) } : {}) };
      } else {
        body = { command: input.kind };
      }
      if (!commands(run).includes(body.command as string)) return { ok: false, detail: `Runner kennt „${String(body.command)}“ nicht — veraltetes Runner-Image` };
      try {
        await run.client.publishAsync(topics.command(run.line), JSON.stringify(body), { qos: 1 });
      } catch (err) {
        return { ok: false, detail: `Senden fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}` };
      }
      note(ctx, "loop.command", `Befehl ${String(body.command)} an ${run.line}`, { command: body.command, ...(body.mode ? { mode: body.mode } : {}), ...(body.issue ? { issue: body.issue } : {}) });
      return { ok: true };
    },

    async status(handle: SessionHandle): Promise<HealthReport> {
      const run = runs.get(handle.sessionId);
      if (!run || run.closed) return { state: "down", detail: "getrennt" };
      if (!run.client.connected) return { state: "down", detail: "Broker nicht erreichbar" };
      const reasons = [...run.broken.values()];
      const breach = reasons.find((r) => !r.startsWith("Linie offline"));
      if (breach) return { state: "broken", detail: breach };
      if (reasons.length > 0) return { state: "down", detail: reasons[0] ?? "Linie offline" };
      return run.info ? { state: "healthy" } : { state: "degraded", detail: "Linie hat sich noch nicht gemeldet" };
    },

    async stop(handle: SessionHandle): Promise<void> {
      const run = runs.get(handle.sessionId);
      if (!run || run.closed) return;
      run.closed = true;
      await run.client.endAsync(true).catch(() => undefined);
    },
  };
}
