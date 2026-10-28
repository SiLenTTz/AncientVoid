import { readFileSync } from "node:fs";
import mqtt, { type MqttClient } from "mqtt";
import type { Ack, AdapterContext, HealthReport, LoopCapabilities, LoopConnector, LoopControlInput, LoopIo, LoopStartSpec, SessionHandle } from "@uacc/contracts";
import { answerQuestions, classify, decode, infoPayload, int, LEGACY_COMMANDS, LINE_PATTERN, MODES, progressPayload, readQuestions, statePayload, statsPayload, str, topics, type Answer } from "./protocol.ts";

const REPORT_INLINE_BYTES = 2000;
const KEEP_ANSWERED = 50;

const CAPABILITIES: LoopCapabilities = {
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
  /** Letzter Vertragsbruch der Linie; löscht sich, sobald sie wieder sauber meldet. */
  broken: string | null;
  info: Record<string, unknown> | null;
  answered: string[];
  pending: Set<string>;
  last: Map<string, string>;
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

  const note = (ctx: AdapterContext, kind: string, summary: string, payload: Record<string, unknown>) =>
    ctx.emit({ type: "system", summary: summary.slice(0, 200), payload: { kind, ...payload } });

  /** Nur bei Änderung melden: retained Nachrichten kommen nach jedem Wiederverbinden erneut. */
  const changed = (run: Run, key: string, value: unknown): boolean => {
    const next = JSON.stringify(value);
    if (run.last.get(key) === next) return false;
    run.last.set(key, next);
    return true;
  };

  const breakLoop = (run: Run, ctx: AdapterContext, reason: string) => {
    if (run.broken === reason) return;
    run.broken = reason;
    note(ctx, "loop.broken", `aSPARK ${run.line}: ${reason}`, { loop: "aspark-factory", line: run.line, reason });
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
      breakLoop(run, ctx, "Der Hub kann keine Rückfragen stellen");
      return;
    }
    const questions = kind === "question" ? readQuestions(msg) : null;
    if (kind === "question" && !questions) {
      breakLoop(run, ctx, `Frage ${id} hat kein gültiges questions[]`);
      return;
    }
    if (kind !== "question" && kind !== "permission") {
      breakLoop(run, ctx, `Frage ${id} mit unbekannter Art „${String(kind)}“`);
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
      io.saveCursor({ answered: run.answered });
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
      breakLoop(run, ctx, `${topic}: ${decoded.reason}`);
      return;
    }
    run.broken = null;
    const m = decoded.value;
    switch (where.kind) {
      case "info": {
        run.info = m;
        if (m.status === "offline") {
          breakLoop(run, ctx, "Linie offline (Last Will)");
          return;
        }
        const payload = infoPayload(m);
        if (changed(run, "info", payload)) note(ctx, "loop.info", `aSPARK ${run.line}: ${payload.mode ?? "?"} · ${payload.activity ?? payload.status ?? "?"}`, payload);
        return;
      }
      case "state": {
        const payload = statePayload(where.session, m);
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
    capabilities: () => CAPABILITIES,

    async start(spec: LoopStartSpec, ctx: AdapterContext, io: LoopIo): Promise<SessionHandle> {
      const line = spec.options.line?.trim() ?? "";
      if (!LINE_PATTERN.test(line)) throw new Error("Option „line“ fehlt oder ist kein Linienname (a–z, 0–9, -)");
      const password = passwordFile ? readFileSync(passwordFile, "utf8").trim() : undefined;
      const client = await mqtt.connectAsync(url, {
        clientId: `uacc-${ctx.sessionId}`,
        ...(username ? { username } : {}),
        ...(password ? { password } : {}),
        connectTimeout: 5000,
        reconnectPeriod: 2000,
      });
      const resume = (io.resume as { answered?: unknown } | null)?.answered;
      const run: Run = { client, line, closed: false, broken: null, info: null, answered: Array.isArray(resume) ? resume.filter((x): x is string => typeof x === "string") : [], pending: new Set(), last: new Map() };
      runs.set(ctx.sessionId, run);
      client.on("message", (topic, payload) => {
        onMessage(run, ctx, io, topic, payload).catch((err) => ctx.log("error", "aSPARK: Nachricht nicht verarbeitet", { topic, error: err instanceof Error ? err.message : String(err) }));
      });
      client.on("close", () => {
        if (!run.closed) breakLoop(run, ctx, "Verbindung zum Broker verloren");
      });
      client.on("connect", () => {
        if (run.broken === "Verbindung zum Broker verloren") run.broken = null;
      });
      ctx.signal.addEventListener("abort", () => void client.endAsync(true).catch(() => undefined), { once: true });
      await client.subscribeAsync(topics.subscriptions(line), { qos: 1 });
      return { sessionId: ctx.sessionId, meta: { line, url } };
    },

    async control(handle: SessionHandle, input: LoopControlInput, ctx: AdapterContext): Promise<Ack> {
      const run = runs.get(handle.sessionId);
      if (!run || run.closed) return { ok: false, detail: "nicht verbunden" };
      if (!CAPABILITIES.controls.includes(input.kind)) return { ok: false, detail: `Befehl „${input.kind}“ wird nicht angeboten` };
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
      if (run.broken?.startsWith("Linie offline")) return { state: "down", detail: run.broken };
      if (run.broken) return { state: "broken", detail: run.broken };
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
