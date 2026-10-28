import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Ack, AdapterContext, HealthReport, LoopCapabilities, LoopConnector, LoopControlInput, LoopIo, LoopStartSpec, SessionHandle } from "@uacc/contracts";
import { listFiles, readJson, tailLines, under } from "./files.ts";

const CAPABILITIES: LoopCapabilities = {
  agents: "external",
  intake: ["backlog"],
  modes: [],
  riskyModes: [],
  orchestrators: ["self", "hermes"],
  controls: [],
  gates: ["gates"],
  asks: "none",
  options: [{ key: "epic", label: "Hermes-Epic", kind: "text", placeholder: "nur mit Orchestrator hermes, z. B. epic-12" }],
};

const TRANSCRIPT_SCHEMAS = ["1", "2"];
const MAX_LINES_PER_POLL = 200;
const KEEP_NOTIFIED = 200;
const EPIC_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

interface Cursor {
  offsets: Record<string, number>;
  notified: string[];
}

interface Run {
  root: string;
  orchestrator: "self" | "hermes";
  epic: string | null;
  cursor: Cursor;
  timer: NodeJS.Timeout | null;
  polling: boolean;
  closed: boolean;
  health: HealthReport;
  last: Map<string, string>;
}

interface Supervisor {
  exit: number;
  json: Record<string, unknown> | null;
  error?: string;
}

function runSupervisor(python: string, root: string): Promise<Supervisor> {
  return new Promise((resolve) => {
    execFile(python, [under(root, "scripts", "betrieb.py"), "supervisor-status", "--json"], { cwd: root, timeout: 15_000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      const exit = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : -1) : 0;
      let json: Record<string, unknown> | null = null;
      try {
        const parsed: unknown = JSON.parse(stdout);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) json = parsed as Record<string, unknown>;
      } catch {
        /* Fehlerfall unten */
      }
      resolve({ exit, json, ...(exit === -1 ? { error: (stderr || String(err)).slice(0, 200) } : {}) });
    });
  });
}

const s = (x: unknown, max = 200): string | undefined => (typeof x === "string" ? (x.length > max ? `${x.slice(0, max - 1)}…` : x) : undefined);
const n = (x: unknown): number | undefined => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : undefined);
const obj = (x: unknown): Record<string, unknown> => (typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
const compact = <T extends Record<string, unknown>>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/**
 * ADR-0038: beobachtet EIN securesight-harnez-Projekt (Option `project` = Projektwurzel). Der Hub liest nur:
 * `scripts/betrieb.py supervisor-status --json`, `.harness/notify`, `.harness/transcript`, `.harnez/progress.json`
 * und bei Orchestrator `hermes` den Zustand unter `~/.hermes/ralph`. Er schreibt nichts in das Projekt
 * (der Supervisor darf nur lesen und eskalieren; Fortsetzen bleibt Sache der Person).
 * Konfiguration: `python` (Standard python3), `pollMs` (Standard 15000), `hermesDir`.
 */
export function createLoopConnector(config: Readonly<Record<string, unknown>> = {}): LoopConnector {
  const runs = new Map<string, Run>();
  const python = typeof config.python === "string" && config.python ? config.python : "python3";
  const pollMs = typeof config.pollMs === "number" && config.pollMs >= 20 ? config.pollMs : 15_000;
  const hermesDir = typeof config.hermesDir === "string" && config.hermesDir ? config.hermesDir : join(homedir(), ".hermes", "ralph");

  const note = (ctx: AdapterContext, kind: string, summary: string, payload: Record<string, unknown>) =>
    ctx.emit({ type: "system", summary: summary.slice(0, 200), payload: { loop: "securesight-factory", kind, ...payload } });
  const changed = (run: Run, key: string, value: unknown): boolean => {
    const next = JSON.stringify(value);
    if (run.last.get(key) === next) return false;
    run.last.set(key, next);
    return true;
  };
  const broken = (run: Run, ctx: AdapterContext, key: string, reason: string) => {
    if (changed(run, `broken:${key}`, reason)) note(ctx, "loop.broken", `securesight: ${reason}`, { reason });
  };

  async function pollSupervisor(run: Run, ctx: AdapterContext): Promise<void> {
    const r = await runSupervisor(python, run.root);
    const j = r.json;
    if (!j || ![0, 3, 4].includes(r.exit)) {
      run.health = { state: "broken", detail: r.error ?? `Supervisor-Status unbekannt (Exit ${r.exit})` };
      broken(run, ctx, "supervisor", run.health.detail ?? "Supervisor-Status unbekannt");
      return;
    }
    if (j.schema_version !== "1") {
      run.health = { state: "broken", detail: `Supervisor-Schema ${String(j.schema_version)} statt 1` };
      broken(run, ctx, "supervisor", run.health.detail ?? "");
      return;
    }
    run.last.delete("broken:supervisor");
    const iteration = obj(j.iteration);
    const hold = obj(j.human_hold);
    const gates = obj(j.last_gates);
    const watchdog = obj(j.watchdog);
    const info = compact({ mode: s(j.mode, 40), iteration: s(iteration.id, 60), iterationStatus: s(iteration.status, 40), watchdog: watchdog.running === true ? "läuft" : "steht" });
    if (changed(run, "info", info)) note(ctx, "loop.info", `securesight: ${info.mode ?? "?"} · Iteration ${info.iteration ?? "?"} ${info.iterationStatus ?? ""}`.trim(), { ...info, status: "online" });
    if (gates.result !== undefined && changed(run, "gates", gates)) {
      note(ctx, "loop.progress", `Prüfungen: ${s(gates.result, 40) ?? "?"}`, { gate: compact({ name: "gates", state: s(gates.result, 40), detail: s(gates.at, 40) }) });
    }
    if (r.exit === 4) {
      run.health = { state: "broken", detail: "Watchdog ausgefallen" };
      broken(run, ctx, "watchdog", "Watchdog ausgefallen");
    } else if (r.exit === 3 || hold.active === true) {
      const reason = s(hold.reason, 200) ?? "ohne Angabe";
      run.health = { state: "degraded", detail: `Mensch gefragt: ${reason}` };
      if (changed(run, "hold", reason)) note(ctx, "loop.hold", `securesight wartet auf eine Person: ${reason}`, { reason });
    } else {
      run.health = { state: "healthy" };
      run.last.delete("hold");
      run.last.delete("broken:watchdog");
    }
  }

  async function pollNotify(run: Run, ctx: AdapterContext, io: LoopIo): Promise<void> {
    const names = await listFiles(under(run.root, ".harness", "notify"), /^[\w.-]+\.json$/);
    let touched = false;
    for (const name of names) {
      if (run.cursor.notified.includes(name)) continue;
      const doc = await readJson(under(run.root, ".harness", "notify", name));
      if (!doc.ok) {
        if (doc.reason === "invalid") broken(run, ctx, `notify:${name}`, `Benachrichtigung ${name} ist kein gültiges JSON`);
        continue; // eine halb geschriebene Datei wird beim nächsten Durchlauf erneut versucht
      }
      const v = doc.value;
      if (v.schema_version !== "1") {
        broken(run, ctx, `notify:${name}`, `Benachrichtigung ${name}: Schema ${String(v.schema_version)} statt 1`);
      } else {
        note(ctx, "loop.notify", `Eskalation ${s(v.escalation_level, 20) ?? "?"}: ${s(v.reason_ref, 120) ?? name}`, compact({ level: s(v.escalation_level, 20), reason: s(v.reason_ref, 200), at: s(v.at, 40), run: s(v.run_id, 80) }));
      }
      run.cursor.notified = [...run.cursor.notified, name].slice(-KEEP_NOTIFIED);
      touched = true;
    }
    if (touched) io.saveCursor(run.cursor);
  }

  async function pollTranscript(run: Run, ctx: AdapterContext, io: LoopIo): Promise<void> {
    const dir = under(run.root, ".harness", "transcript");
    let budget = MAX_LINES_PER_POLL;
    let touched = false;
    for (const name of await listFiles(dir, /^[\w.-]+\.ndjson$/)) {
      if (budget <= 0) break;
      const known = run.cursor.offsets[name];
      const tail = await tailLines(under(dir, name), known ?? null, budget);
      const lines = tail.lines;
      const consumed = tail.offset;
      budget -= lines.length;
      for (const line of lines) {
        if (!line.trim()) continue;
        let rec: Record<string, unknown>;
        try {
          rec = obj(JSON.parse(line));
        } catch {
          broken(run, ctx, `transcript:${name}`, `Transcript ${name}: Zeile ist kein JSON`);
          continue;
        }
        if (!TRANSCRIPT_SCHEMAS.includes(String(rec.schema_version))) {
          broken(run, ctx, `transcript:${name}`, `Transcript ${name}: Schema ${String(rec.schema_version)} unbekannt`);
          continue;
        }
        const detail = s(rec.detail, 180) ?? "";
        note(ctx, "loop.transcript", `${s(rec.role, 12) ?? "?"}/${s(rec.kind, 30) ?? "?"}: ${detail}`, compact({ session: s(rec.session, 80), seq: n(rec.seq), at: s(rec.at, 40), role: s(rec.role, 12), kindOf: s(rec.kind, 30), source: s(rec.source, 40), detail }));
      }
      if (known !== consumed) {
        run.cursor.offsets[name] = consumed;
        touched = true;
      }
    }
    if (touched) io.saveCursor(run.cursor);
  }

  async function pollProgress(run: Run, ctx: AdapterContext): Promise<void> {
    const doc = await readJson(under(run.root, ".harnez", "progress.json"));
    if (!doc.ok) {
      if (doc.reason === "invalid") broken(run, ctx, "progress", "progress.json ist kein gültiges JSON");
      return;
    }
    const v = doc.value;
    if (v.schema_version !== "1") return broken(run, ctx, "progress", `progress.json: Schema ${String(v.schema_version)} statt 1`);
    const now = obj(v.now);
    const payload = compact({ done: n(v.done), total: n(v.total), phase: s(now.phase, 40), feature: s(now.story, 100), step: s(now.task, 100) });
    if (changed(run, "progress", payload)) note(ctx, "loop.progress", `${payload.done ?? 0} von ${payload.total ?? 0} Aufgaben${payload.phase ? ` · ${payload.phase}` : ""}`, { source: "harnez", ...payload });
  }

  async function pollHermes(run: Run, ctx: AdapterContext): Promise<void> {
    if (run.orchestrator !== "hermes" || !run.epic) return;
    const doc = await readJson(join(hermesDir, `${run.epic}-state.json`));
    if (!doc.ok) {
      broken(run, ctx, "hermes", doc.reason === "missing" ? `Hermes-Zustand für „${run.epic}“ nicht gefunden` : "Hermes-Zustand ist kein gültiges JSON");
      return;
    }
    run.last.delete("broken:hermes");
    const v = doc.value;
    const payload = compact({ done: n(v.tasks_done), total: n(v.tasks_total), status: s(v.status, 40), step: s(v.current_task, 100), gateFails: n(v.gate_fails) });
    if (changed(run, "hermes", payload)) note(ctx, "loop.progress", `Hermes ${payload.status ?? "?"}: ${payload.done ?? 0} von ${payload.total ?? 0}`, { source: "hermes", epic: run.epic, ...payload });
  }

  async function poll(run: Run, ctx: AdapterContext, io: LoopIo): Promise<void> {
    if (run.polling || run.closed) return;
    run.polling = true;
    try {
      // Jede Quelle für sich: fällt eine aus, zeigen die anderen weiter (Regel 6: der Ausfall wird sichtbar, nicht still).
      for (const [name, step] of [
        ["supervisor", () => pollSupervisor(run, ctx)],
        ["notify", () => pollNotify(run, ctx, io)],
        ["transcript", () => pollTranscript(run, ctx, io)],
        ["progress", () => pollProgress(run, ctx)],
        ["hermes", () => pollHermes(run, ctx)],
      ] as const) {
        try {
          await step();
        } catch (err) {
          broken(run, ctx, `read:${name}`, `${name} nicht lesbar: ${err instanceof Error ? err.message : String(err)}`.slice(0, 180));
        }
      }
    } finally {
      run.polling = false;
    }
  }

  return {
    id: "securesight-factory",
    version: "0.1.0",
    capabilities: () => CAPABILITIES,

    async start(spec: LoopStartSpec, ctx: AdapterContext, io: LoopIo): Promise<SessionHandle> {
      if (!existsSync(under(spec.project, "scripts", "betrieb.py"))) throw new Error(`„${spec.project}“ ist kein securesight-harnez-Projekt (scripts/betrieb.py fehlt)`);
      const orchestrator = spec.orchestrator === "hermes" ? "hermes" : "self";
      const epic = spec.options.epic?.trim() || null;
      if (orchestrator === "hermes" && (!epic || !EPIC_PATTERN.test(epic))) throw new Error("Orchestrator hermes braucht die Option „epic“ (Name des Hermes-Epics)");
      const resumed = io.resume as Partial<Cursor> | null;
      const run: Run = {
        root: spec.project,
        orchestrator,
        epic,
        cursor: { offsets: { ...(resumed?.offsets ?? {}) }, notified: [...(resumed?.notified ?? [])] },
        timer: null,
        polling: false,
        closed: false,
        health: { state: "degraded", detail: "noch nicht gelesen" },
        last: new Map(),
      };
      runs.set(ctx.sessionId, run);
      // Erster Durchlauf gleich im start(): der Hub sieht sofort, ob das Projekt lesbar ist.
      await poll(run, ctx, io);
      run.timer = setInterval(() => void poll(run, ctx, io), pollMs);
      run.timer.unref();
      ctx.signal.addEventListener("abort", () => run.timer && clearInterval(run.timer), { once: true });
      return { sessionId: ctx.sessionId, meta: { project: spec.project, orchestrator, ...(epic ? { epic } : {}) } };
    },

    async control(_handle: SessionHandle, input: LoopControlInput): Promise<Ack> {
      return { ok: false, detail: `Befehl „${input.kind}“ gibt es nicht: securesight-factory wird nur beobachtet (der Supervisor darf nur lesen und eskalieren)` };
    },

    async status(handle: SessionHandle): Promise<HealthReport> {
      const run = runs.get(handle.sessionId);
      return !run || run.closed ? { state: "down", detail: "getrennt" } : run.health;
    },

    async stop(handle: SessionHandle): Promise<void> {
      const run = runs.get(handle.sessionId);
      if (!run || run.closed) return;
      run.closed = true;
      if (run.timer) clearInterval(run.timer);
    },
  };
}
