import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { LOOP_NEW } from "@uacc/contracts";
import type { Ack, AdapterContext, HealthReport, LoopCapabilities, LoopConnector, LoopControlInput, LoopIo, LoopOnboardResult, LoopStartSpec, SessionHandle } from "@uacc/contracts";
import { listFiles, readJson, tailLines, under } from "./files.ts";

/** Standard-Modellauswahl je Provider (factory-Policy 2026-10); via
 * `loops[].config.models` in hub.config.json ersetzbar. Der Wert „provider/model“
 * wird beim Anbinden in den Projekt-Override `policies/modell-routing.json`
 * geschrieben — der factory-eigene, dokumentierte Mechanismus (routing.py),
 * kein Eingriff in die Factory-Installation. */
const DEFAULT_MODELS: Record<"anthropic" | "zai", string[]> = {
  anthropic: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
  zai: ["glm-5.3", "glm-5.3-flash"],
};
const PROVIDER_LABEL: Record<"anthropic" | "zai", string> = { anthropic: "Anthropic", zai: "Z.ai" };

const capabilitiesFor = (models: Record<"anthropic" | "zai", string[]>): LoopCapabilities => ({
  agents: "external",
  intake: ["backlog"],
  modes: [],
  riskyModes: [],
  orchestrators: ["self", "hermes"],
  controls: [],
  gates: ["gates"],
  asks: "none",
  options: [
    { key: "epic", label: "Hermes-Epic", kind: "text", placeholder: "nur mit Orchestrator hermes, z. B. epic-12" },
    { key: "anbindung", label: "Anbindung", kind: "select", choices: [{ value: "bestehend", label: "bestehendes Factory-Projekt beobachten" }, { value: LOOP_NEW, label: "Factory-Projekt anlegen/rekonfigurieren (factory init)" }] },
  ],
  onboarding: {
    optionKey: "anbindung",
    label: "Factory-Projekt einrichten (factory init)",
    fields: [
      { key: "root", label: "Projektpfad (absolut)", kind: "text", required: true, placeholder: "/pfad/zum/projekt", prefill: "project" },
      { key: "prd", label: "PRD (Datei/Ordner, optional)", kind: "text", placeholder: "/pfad/zur/prd.md" },
      { key: "modus", label: "Betriebsmodus", kind: "select", required: true, choices: [{ value: "a", label: "a — merged automatisch (Außenwirkung)" }, { value: "b", label: "b" }] },
      { key: "provider", label: "Provider", kind: "select", required: true, choices: [{ value: "anthropic", label: "Anthropic" }, { value: "zai", label: "Z.ai" }] },
      // Nutzerwunsch 2026-10-30: Modell out of the box im Hub wählbar — ohne
      // Änderung an der factory-CLI. Wahl überschreibt ggf. den Provider.
      {
        key: "modell",
        label: "Modell",
        kind: "select",
        choices: [{ value: "", label: "Standard-Routing der Factory" }, ...(Object.keys(models) as ("anthropic" | "zai")[]).flatMap((p) => models[p].map((m) => ({ value: `${p}/${m}`, label: `${m} (${PROVIDER_LABEL[p]})` })))],
      },
    ],
    // AC-P26-9: Harness-Wahl (claude|maki) bleibt ausgeblendet, bis die installierte factory-CLI
    // Fähigkeiten meldet (factory capabilities --json, Schnittstellenwunsch 1) — kein Rateversuch aus der Version.
    notes: ["Harness-Wahl (claude/maki): ausgeblendet — die installierte factory-CLI meldet keine Fähigkeiten („factory capabilities“ fehlt noch)."],
  },
});

/** Pfad zur Standard-Policy der installierten Factory: der Shim der nicht
 * editierbaren Installation trägt FACTORY_HOME in Zeile 3; daneben fallback
 * die editable Installation (policies/ neben der Binärdatei). */
function factoryPolicySource(factoryBin: string): string | null {
  const quote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  let bin = factoryBin;
  try {
    bin = execFileSync("sh", ["-c", `command -v -- ${quote(factoryBin)} 2>/dev/null || printf %s ${quote(factoryBin)}`], { encoding: "utf8" }).trim().split("\n")[0] || factoryBin;
  } catch {
    /* Pfad bleibt wie konfiguriert */
  }
  try {
    const home = readFileSync(bin, "utf8").match(/^FACTORY_HOME='([^']+)'/m);
    if (home) return join(home[1]!, "policies", "modell-routing.json");
  } catch {
    /* keine lesbare Binärdatei — editable Layout versuchen */
  }
  for (const candidate of [join(dirname(bin), "..", "policies", "modell-routing.json"), join(dirname(bin), "policies", "modell-routing.json")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const FAST_MS = 2000;
const KEEP_KEYS = 40;
const TRANSCRIPT_SCHEMAS = ["1", "2"];
const MAX_LINES_PER_POLL = 200;
const KEEP_NOTIFIED = 200;
const EPIC_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

interface Cursor {
  offsets: Record<string, number>;
  notified: string[];
  /** K7: schon Gemeldetes (Dedupe-Schlüssel) überlebt einen Hub-Neustart, damit nichts doppelt kommt. */
  last: Record<string, string>;
}

interface Run {
  root: string;
  mode: "repo" | "project";
  orchestrator: "self" | "hermes";
  epic: string | null;
  cursor: Pick<Cursor, "offsets" | "notified">;
  timers: NodeJS.Timeout[];
  closeWatch: (() => void) | null;
  busy: { slow: boolean; fast: boolean };
  /** Erster Durchlauf ohne gespeicherte Position: vorhandene Transcripts nur ab jetzt, spätere Dateien von vorn. */
  seeding: boolean;
  closed: boolean;
  /** Projektmodus: `factory progress show` war im letzten Takt lesbar — nur dann darf eine andere Quelle `healthy` setzen. */
  progressOk: boolean;
  health: HealthReport;
  last: Map<string, string>;
  io: LoopIo;
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

/** Vertrag v1 (docs/factory-schnittstelle.md): stdout ist genau eine JSON-Zeile; stderr ist Menschencheckliste. */
function runFactory(bin: string, root: string, args: string[]): Promise<Supervisor> {
  return new Promise((resolve) => {
    execFile(bin, args, { cwd: root, timeout: 15_000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      const exit = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : -1) : 0;
      let json: Record<string, unknown> | null = null;
      try {
        const parsed: unknown = JSON.parse(stdout);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) json = parsed as Record<string, unknown>;
      } catch {
        /* Fehlerfall unten */
      }
      resolve({ exit, json, ...(exit !== 0 ? { error: (stderr || String(err)).slice(0, 200) } : {}) });
    });
  });
}

const s = (x: unknown, max = 200): string | undefined => (typeof x === "string" ? (x.length > max ? `${x.slice(0, max - 1)}…` : x) : undefined);
const n = (x: unknown): number | undefined => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : undefined);
const obj = (x: unknown): Record<string, unknown> => (typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
const compact = <T extends Record<string, unknown>>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/**
 * ADR-0038: beobachtet EIN securesight-harnez-Projekt (Option `project` = Projektwurzel). Der Hub liest nur:
 * `scripts/betrieb.py supervisor-status --json`, `.harness/notify`, `.harness/transcript`, `.factory/progress.json` (früher `.harnez/`)
 * und bei Orchestrator `hermes` den Zustand unter `~/.hermes/ralph`. Er schreibt nichts in das Projekt
 * (der Supervisor darf nur lesen und eskalieren; Fortsetzen bleibt Sache der Person).
 * Konfiguration: `python` (Standard python3), `pollMs` (Supervisor, Standard 15000), `hermesDir`.
 */
export function createLoopConnector(config: Readonly<Record<string, unknown>> = {}): LoopConnector {
  const runs = new Map<string, Run>();
  const python = typeof config.python === "string" && config.python ? config.python : "python3";
  const factoryBin = typeof config.factory === "string" && config.factory ? config.factory : "factory";
  // Modellauswahl des Anbindungs-Formulars (Nutzerwunsch 2026-10-30):
  // `loops[].config.models` überschreibt die Standardliste je Provider.
  const models: Record<"anthropic" | "zai", string[]> = {
    anthropic: [...DEFAULT_MODELS.anthropic],
    zai: [...DEFAULT_MODELS.zai],
  };
  if (config.models !== null && typeof config.models === "object" && !Array.isArray(config.models)) {
    for (const p of ["anthropic", "zai"] as const) {
      const list = (config.models as Record<string, unknown>)[p];
      if (Array.isArray(list) && list.length > 0 && list.every((m) => typeof m === "string" && m.trim())) models[p] = list.map((m) => (m as string).trim());
    }
  }
  const CAPABILITIES = capabilitiesFor(models);
  // Obergrenze 30 s: AC-P19-4 verlangt `loop.broken` bei Watchdog-Ausfall in unter 60 s.
  const pollMs = typeof config.pollMs === "number" && config.pollMs >= 20 ? Math.min(config.pollMs, 30_000) : 15_000;
  // Projektmodus (REQ-2903 Dead-Man-Signal): älterer Heartbeat ohne Phase-Wechsel ⇒ „wartet ohne Fortschritt“, nie „läuft“.
  const staleAfterS = typeof config.staleAfterS === "number" && config.staleAfterS >= 10 ? config.staleAfterS : 300;
  const hermesDir = typeof config.hermesDir === "string" && config.hermesDir ? config.hermesDir : join(homedir(), ".hermes", "ralph");

  const note = (ctx: AdapterContext, kind: string, summary: string, payload: Record<string, unknown>) =>
    ctx.emit({ type: "system", summary: summary.slice(0, 200), payload: { loop: "securesight-factory", kind, ...payload } });
  const save = (run: Run) => run.io.saveCursor({ offsets: run.cursor.offsets, notified: run.cursor.notified, last: Object.fromEntries([...run.last].slice(-KEEP_KEYS)) });
  const changed = (run: Run, key: string, value: unknown): boolean => {
    const next = JSON.stringify(value);
    if (run.last.get(key) === next) return false;
    run.last.delete(key);
    run.last.set(key, next);
    save(run);
    return true;
  };
  const broken = (run: Run, ctx: AdapterContext, key: string, reason: string) => {
    if (changed(run, `broken:${key}`, reason)) note(ctx, "loop.broken", `securesight: ${reason}`, { reason });
  };

  /** Eine Störung, die eben noch gemeldet war, ist weg: die Oberfläche nimmt die Warnung zurück. */
  const recovered = (run: Run, ctx: AdapterContext, key: string) => {
    const reason = run.last.get(`broken:${key}`);
    if (reason === undefined) return;
    run.last.delete(`broken:${key}`);
    save(run);
    note(ctx, "loop.recovered", `securesight: ${key} wieder in Ordnung`, { reason: JSON.parse(reason) as string });
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
    recovered(run, ctx, "supervisor");
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
      if (run.last.delete("hold")) {
        save(run);
        note(ctx, "loop.recovered", "securesight: keine Person mehr gefragt", { what: "hold" });
      }
      recovered(run, ctx, "watchdog");
    }
  }

  async function pollNotify(run: Run, ctx: AdapterContext): Promise<void> {
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
    if (touched) save(run);
  }

  async function pollTranscript(run: Run, ctx: AdapterContext): Promise<void> {
    const dir = under(run.root, ".harness", "transcript");
    let budget = MAX_LINES_PER_POLL;
    let touched = false;
    for (const name of await listFiles(dir, /^[\w.-]+\.ndjson$/)) {
      if (budget <= 0) break;
      const known = run.cursor.offsets[name];
      const tail = await tailLines(under(dir, name), known ?? (run.seeding ? null : 0), budget);
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
    if (touched) save(run);
  }

  async function pollProgress(run: Run, ctx: AdapterContext): Promise<void> {
    // Seit der Umbenennung (Iteration 0055) liegt der Fahrplan unter .factory/, ältere Projekte haben noch .harnez/.
    let doc = await readJson(under(run.root, ".factory", "progress.json"));
    if (!doc.ok && doc.reason === "missing") doc = await readJson(under(run.root, ".harnez", "progress.json"));
    if (!doc.ok) {
      if (doc.reason === "invalid") broken(run, ctx, "progress", "progress.json ist kein gültiges JSON");
      return;
    }
    recovered(run, ctx, "progress");
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
    recovered(run, ctx, "hermes");
    const v = doc.value;
    // Freigaben des Orchestrators: Hermes schreibt `user_gates` (früher `user-gates`) als { push: false, note: "…" }.
    const gates = obj(v.user_gates ?? v["user-gates"]);
    const userGates = Object.fromEntries(Object.entries(gates).flatMap(([k, val]) => (typeof val === "boolean" ? [[k.slice(0, 40), val]] : [])).slice(0, 8));
    const payload = compact({ done: n(v.tasks_done), total: n(v.tasks_total), status: s(v.status, 40), step: s(v.current_task, 100), gateFails: n(v.gate_fails), userGates: Object.keys(userGates).length > 0 ? userGates : undefined, gateNote: s(gates.note, 200) });
    if (changed(run, "hermes", payload)) note(ctx, "loop.progress", `Hermes ${payload.status ?? "?"}: ${payload.done ?? 0} von ${payload.total ?? 0}`, { source: "hermes", epic: run.epic, ...payload });
  }

  async function pollProgressShow(run: Run, ctx: AdapterContext): Promise<void> {
    const r = await runFactory(factoryBin, run.root, ["progress", "show"]);
    if (r.exit !== 0 || !r.json) {
      run.progressOk = false;
      run.health = { state: "broken", detail: r.error ?? `factory progress show unlesbar (Exit ${r.exit})` };
      broken(run, ctx, "progress-show", run.health.detail ?? "factory progress show unlesbar");
      return;
    }
    const v = r.json;
    if (v.schema_version !== "1") {
      run.progressOk = false;
      run.health = { state: "broken", detail: `factory progress show: Schema ${String(v.schema_version)} statt 1` };
      broken(run, ctx, "progress-show", run.health.detail ?? "");
      return;
    }
    recovered(run, ctx, "progress-show");
    run.progressOk = true;
    const now = obj(v.now);
    const payload = compact({ done: n(v.done), total: n(v.total), phase: s(now.phase, 40), feature: s(now.story, 100), step: s(now.task, 100) });
    if (changed(run, "progress", payload)) note(ctx, "loop.progress", `${payload.done ?? 0} von ${payload.total ?? 0} Aufgaben${payload.phase ? ` · ${payload.phase}` : ""}`, { source: "factory", ...payload });
  }

  async function pollLaufStatus(run: Run, ctx: AdapterContext): Promise<void> {
    const doc = await readJson(under(run.root, ".factory", "lauf-status.json"));
    if (!doc.ok) {
      if (doc.reason === "missing") {
        if (run.progressOk) run.health = { state: "healthy" }; // lesbares Projekt, noch kein Lauf
        return;
      }
      return broken(run, ctx, "lauf-status", "lauf-status.json ist kein gültiges JSON");
    }
    recovered(run, ctx, "lauf-status");
    const v = doc.value;
    if (v.schema_version !== "1") return broken(run, ctx, "lauf-status", `lauf-status.json: Schema ${String(v.schema_version)} statt 1`);
    const hb = n(v.heartbeat_at);
    const payload = compact({ task: s(v.task, 100), phase: s(v.phase, 40) });
    if (changed(run, "lauf", payload)) note(ctx, "loop.info", `Lauf ${payload.task ?? "?"} · Phase ${payload.phase ?? "?"}`, { source: "lauf-status", ...payload });
    if (hb !== undefined) {
      const age = Math.max(0, Math.floor(Date.now() / 1000 - hb));
      if (age > staleAfterS) {
        const reason = `wartet ohne Fortschritt (Heartbeat ${age} s alt, Phase ${payload.phase ?? "?"})`;
        if (run.progressOk) run.health = { state: "degraded", detail: reason }; // broken (progress show) wird nie maskiert
        if (changed(run, "stale", reason)) note(ctx, "loop.hold", `securesight: ${reason}`, { reason });
        return;
      }
      if (run.last.delete("stale")) {
        save(run);
        note(ctx, "loop.recovered", "securesight: Heartbeat wieder frisch", { what: "stale" });
      }
    }
    if (run.progressOk) run.health = { state: "healthy" };
  }

  async function pollEvidence(run: Run, ctx: AdapterContext): Promise<void> {
    const dir = under(run.root, ".factory", "evidence");
    let touched = false;
    for (const name of await listFiles(dir, /^(bootstrap|lauf-ende)-fehler\.json$/)) {
      if (run.cursor.notified.includes(name)) continue;
      const doc = await readJson(under(dir, name));
      if (!doc.ok) {
        if (doc.reason === "invalid") broken(run, ctx, `evidence:${name}`, `Fehlerbeleg ${name} ist kein gültiges JSON`);
        continue;
      }
      const v = doc.value;
      if (v.schema_version !== "1") {
        broken(run, ctx, `evidence:${name}`, `Fehlerbeleg ${name}: Schema ${String(v.schema_version)} statt 1`);
      } else {
        const art = name === "bootstrap-fehler.json" ? "Bootstrap" : "Lauf-Ende";
        note(ctx, "loop.notify", `Fehlerbeleg ${art}: ${s(v.grund, 120) ?? "?"}`, compact({ level: "factory", reason: s(v.grund, 200), at: s(v.zeit, 40), fundstelle: s(v.fundstelle, 120) }));
      }
      run.cursor.notified = [...run.cursor.notified, name].slice(-KEEP_NOTIFIED);
      touched = true;
    }
    if (touched) save(run);
  }

  async function pollIntake(run: Run, ctx: AdapterContext): Promise<void> {
    const doc = await readJson(under(run.root, ".factory", "intake", "state.json"));
    if (!doc.ok) {
      if (doc.reason === "invalid") broken(run, ctx, "intake", "intake/state.json ist kein gültiges JSON");
      return;
    }
    recovered(run, ctx, "intake");
    const v = doc.value;
    if (v.schema_version !== "1") return broken(run, ctx, "intake", `intake/state.json: Schema ${String(v.schema_version)} statt 1`);
    const payload = compact({ status: s(v.status, 40), ready: v.execution_ready === true, next: s(v.next_action, 120) });
    if (changed(run, "intake", payload)) note(ctx, "loop.info", `Intake: ${payload.status ?? "?"}${payload.ready ? " · ausführungsbereit" : ""}`, { source: "intake", ...payload });
  }

  /**
   * Zwei Takte: Dateien sind billig und müssen live wirken — sie werden beim Ändern
   * (fs.watch) und sonst alle 2 s gelesen. Prozesse (Supervisor im Modus repo, factory-CLI
   * im Modus project) laufen im `pollMs`-Takt.
   */
  async function sweep(run: Run, ctx: AdapterContext, group: "slow" | "fast"): Promise<void> {
    if (run.busy[group] || run.closed) return;
    run.busy[group] = true;
    try {
      // Jede Quelle für sich: fällt eine aus, zeigen die anderen weiter (Regel 6: der Ausfall wird sichtbar, nicht still).
      const steps: [string, () => Promise<void>][] =
        run.mode === "repo"
          ? group === "slow"
            ? [["supervisor", () => pollSupervisor(run, ctx)], ["hermes", () => pollHermes(run, ctx)]]
            : [["notify", () => pollNotify(run, ctx)], ["transcript", () => pollTranscript(run, ctx)], ["progress", () => pollProgress(run, ctx)]]
          : group === "slow"
            ? [["progress-show", () => pollProgressShow(run, ctx)], ["lauf-status", () => pollLaufStatus(run, ctx)]]
            : [["evidence", () => pollEvidence(run, ctx)], ["intake", () => pollIntake(run, ctx)]];
      for (const [name, step] of steps) {
        try {
          await step();
        } catch (err) {
          broken(run, ctx, `read:${name}`, `${name} nicht lesbar: ${err instanceof Error ? err.message : String(err)}`.slice(0, 180));
        }
      }
    } finally {
      run.busy[group] = false;
    }
  }

  /** Beobachtet die Verzeichnisse; fehlt eines noch, greift der 2-s-Takt. Gibt eine Funktion zum Schließen zurück. */
  function watchFiles(run: Run, ctx: AdapterContext): () => void {
    let debounce: NodeJS.Timeout | null = null;
    const kick = () => {
      if (debounce) return;
      debounce = setTimeout(() => {
        debounce = null;
        void sweep(run, ctx, "fast");
      }, 40);
    };
    const watchers: FSWatcher[] = [];
    const dirs: string[][] =
      run.mode === "repo" ? [[".harness", "notify"], [".harness", "transcript"], [".factory"], [".harnez"]] : [[".factory"], [".factory", "evidence"]];
    for (const dir of dirs) {
      try {
        watchers.push(watch(under(run.root, ...dir), kick));
      } catch {
        /* Verzeichnis gibt es (noch) nicht */
      }
    }
    return () => {
      if (debounce) clearTimeout(debounce);
      for (const w of watchers) w.close();
    };
  }

  const closeRun = (run: Run) => {
    run.closed = true;
    for (const t of run.timers) clearInterval(t);
    run.closeWatch?.();
  };

  return {
    id: "securesight-factory",
    version: "0.1.0",
    capabilities: () => CAPABILITIES,

    /** T26.4 (ADR-0043 §5): factory init über die CLI (Vertrag v1) — der Hub setzt kein Trust und keine Berechtigungen selbst. */
    async onboard(input: { options: Record<string, string>; secret?: string }, signal: AbortSignal): Promise<LoopOnboardResult> {
      const root = (input.options.root ?? "").trim();
      const prd = (input.options.prd ?? "").trim();
      const modus = (input.options.modus ?? "").trim();
      let provider = (input.options.provider ?? "").trim();
      // Modellwahl „provider/model“: ein gültiges Modell bestimmt auch den Provider
      // für factory init (explizite Wahl schlägt das Provider-Feld, im Detail begründet).
      const modellRaw = (input.options.modell ?? "").trim();
      let modellProvider: "anthropic" | "zai" | null = null;
      let modellName = "";
      if (modellRaw) {
        const slash = modellRaw.indexOf("/");
        const candidate = slash > 0 ? (modellRaw.slice(0, slash) as "anthropic" | "zai") : null;
        modellName = slash > 0 ? modellRaw.slice(slash + 1) : "";
        if (candidate !== "anthropic" && candidate !== "zai") return { ok: false, detail: "Modell: „anbieter/modell“ erwartet (anbieter anthropic oder zai)" };
        if (!modellName || !models[candidate].includes(modellName)) return { ok: false, detail: `Modell „${modellName || "?"}“ gehört nicht zur Auswahl von ${candidate}` };
        modellProvider = candidate;
        provider = candidate;
      }
      if (!root.startsWith("/") || root.includes("\0")) return { ok: false, detail: "Projektpfad fehlt oder ist nicht absolut" };
      if (prd && (!prd.startsWith("/") || prd.includes("\0"))) return { ok: false, detail: "PRD-Pfad muss absolut sein (oder leer)" };
      if (modus !== "a" && modus !== "b") return { ok: false, detail: "Betriebsmodus „a“ oder „b“ fehlt" };
      if (provider !== "anthropic" && provider !== "zai") return { ok: false, detail: "Provider „anthropic“ oder „zai“ fehlt" };
      // Projekt-Override der Modell-Routing-Policy: die installierte Standard-Policy
      // kopieren und nur die Modelle patchen — die Factory lädt den Projekt-Override
      // als Ganzes (routing.py mischt nie), deshalb keine Teilüberschreibung.
      const modellOverride = (): { ok: true } | { ok: false; detail: string } => {
        if (!modellProvider || !modellName) return { ok: true };
        const source = factoryPolicySource(factoryBin);
        if (!source) return { ok: false, detail: "Modell gewählt, aber die Standard-Policy der Factory (FACTORY_HOME/policies/modell-routing.json) wurde nicht gefunden" };
        let doc: Record<string, unknown>;
        try {
          doc = JSON.parse(readFileSync(source, "utf8")) as Record<string, unknown>;
        } catch (err) {
          return { ok: false, detail: `Standard-Policy unlesbar: ${err instanceof Error ? err.message : String(err)}` };
        }
        const tiers = doc.tiers as Record<string, { model?: string } | undefined> | undefined;
        if (!tiers || !["planung", "mittel", "einfach"].every((t) => tiers[t])) return { ok: false, detail: "Standard-Policy ohne die Stufen planung/mittel/einfach — Override nicht geschrieben" };
        if (modellProvider === "anthropic") {
          for (const tier of ["planung", "mittel", "einfach"]) tiers[tier]!.model = modellName;
        }
        if (modellProvider === "zai") {
          const providers = (doc.providers ?? {}) as Record<string, Record<string, unknown>>;
          providers.zai = {
            // Standard-Z.ai-Profil der Factory-Policy (api.z.ai, Coding-Plan-Key) — nur
            // gesetzt, wenn die Vorlage selbst keinen Z.ai-Block mitbringt.
            base_url: "https://api.z.ai/api/anthropic",
            key_path: "~/.local/share/opencode/auth.json",
            key_field: "zai-coding-plan.key",
            ...providers.zai,
            tier_models: { planung: modellName, mittel: modellName, einfach: modellName },
          };
          doc.providers = providers;
        }
        doc.default_provider = modellProvider;
        try {
          mkdirSync(join(root, "policies"), { recursive: true });
          writeFileSync(join(root, "policies", "modell-routing.json"), `${JSON.stringify(doc, null, 2)}\n`);
        } catch (err) {
          return { ok: false, detail: `policies/modell-routing.json nicht schreibbar: ${err instanceof Error ? err.message : String(err)}` };
        }
        return { ok: true };
      };
      return await new Promise((resolve) => {
        execFile(factoryBin, ["init", "--root", root, "--modus", modus, "--provider", provider, ...(prd ? ["--from-prd", prd] : [])], { timeout: 120_000, maxBuffer: 1024 * 1024, signal }, (err, stdout, stderr) => {
          if (signal.aborted) return resolve({ ok: false, detail: "abgebrochen" });
          const exit = err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : -1) : 0;
          if (exit !== 0) return resolve({ ok: false, detail: (stderr || (err instanceof Error ? err.message : "") || stdout || `Exit ${exit}`).trim().slice(0, 300) });
          let doc: Record<string, unknown> | null = null;
          try {
            const parsed: unknown = JSON.parse(stdout);
            doc = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
          } catch {
            /* Fehlerfall unten */
          }
          if (!doc) return resolve({ ok: false, detail: "factory init: stdout ist kein JSON (Vertrag v1 verletzt)" });
          const override = modellOverride();
          if (!override.ok) return resolve({ ok: false, detail: override.detail });
          const lines = Array.isArray(doc.checkliste) ? doc.checkliste.filter((l): l is string => typeof l === "string") : [];
          const ready = lines.some((l) => l.startsWith("ready:"));
          const modellDetail = modellProvider && modellName ? ` · modell: ${modellName} (${modellProvider}) für alle Stufen — policies/modell-routing.json` : "";
          resolve({ ok: true, options: { anbindung: "bestehend" }, detail: `${lines.join(" · ").slice(0, 400)}${ready ? "" : " · noch nicht bereit"}${modellDetail}` });
        });
      });
    },

    async start(spec: LoopStartSpec, ctx: AdapterContext, io: LoopIo): Promise<SessionHandle> {
      // Schnittstelle v1: repo = scripts/betrieb.py (Factory-Repo selbst), project = .factory/config.json ohne betrieb.py.
      const hasBetrieb = existsSync(under(spec.project, "scripts", "betrieb.py"));
      const hasFactory = existsSync(under(spec.project, ".factory", "config.json"));
      if (!hasBetrieb && !hasFactory) throw new Error(`„${spec.project}“ ist kein securesight-factory-Projekt (weder scripts/betrieb.py noch .factory/config.json vorhanden)`);
      const mode: "repo" | "project" = hasBetrieb ? "repo" : "project";
      const orchestrator = mode === "repo" && spec.orchestrator === "hermes" ? "hermes" : "self";
      const epic = spec.options.epic?.trim() || null;
      if (orchestrator === "hermes" && (!epic || !EPIC_PATTERN.test(epic))) throw new Error("Orchestrator hermes braucht die Option „epic“ (Name des Hermes-Epics)");
      const resumed = io.resume as Partial<Cursor> | null;
      const run: Run = {
        root: spec.project,
        mode,
        orchestrator,
        epic,
        cursor: { offsets: { ...(resumed?.offsets ?? {}) }, notified: [...(resumed?.notified ?? [])] },
        io,
        timers: [],
        closeWatch: null,
        busy: { slow: false, fast: false },
        seeding: resumed === null || resumed === undefined,
        closed: false,
        progressOk: false,
        health: { state: "degraded", detail: "noch nicht gelesen" },
        last: new Map(Object.entries(resumed?.last ?? {})),
      };
      runs.set(ctx.sessionId, run);
      // Erster Durchlauf gleich im start(): der Hub sieht sofort, ob das Projekt lesbar ist.
      await sweep(run, ctx, "slow");
      await sweep(run, ctx, "fast");
      run.seeding = false;
      run.timers = [setInterval(() => void sweep(run, ctx, "slow"), pollMs), setInterval(() => void sweep(run, ctx, "fast"), FAST_MS)];
      for (const t of run.timers) t.unref();
      run.closeWatch = watchFiles(run, ctx);
      ctx.signal.addEventListener("abort", () => closeRun(run), { once: true });
      return { sessionId: ctx.sessionId, meta: { project: spec.project, mode, orchestrator, ...(epic ? { epic } : {}) } };
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
      closeRun(run);
    },
  };
}
