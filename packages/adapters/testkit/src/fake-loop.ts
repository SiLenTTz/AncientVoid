import { LOOP_NEW } from "@uacc/contracts";
import type { Ack, AdapterContext, HealthReport, LoopCapabilities, LoopConnector, LoopControlInput, LoopIo, LoopStartSpec, SessionHandle } from "@uacc/contracts";

/**
 * Ein deterministischer Loop für Tests und die E2E-Läufe (kein Fremdsystem). Er meldet Info, Zustand und Fortschritt,
 * stellt eine Rückfrage über `requestToolPermission` und kennt Betriebsarten `ruhig` und `scharf` (riskant).
 * Optionen: `line` (Pflicht). Das Ziel „FEHLER“ lässt ihn `loop.broken` melden, „FRAGE“ stellt die Rückfrage.
 */
export function createLoopConnector(_config?: Readonly<Record<string, unknown>>): LoopConnector {
  const state = new Map<string, { mode: string; paused: boolean; closed: boolean; step: number }>();
  /** „Eingerichtete Linien“ des Fake-Loops; `onboard` fügt eine hinzu (Token „geheim“). */
  const lines = new Set(["alpha"]);
  const capabilities = (): LoopCapabilities => ({
    agents: "external",
    intake: ["issues"],
    modes: ["ruhig", "scharf"],
    riskyModes: ["scharf"],
    orchestrators: [],
    controls: ["pause", "resume", "setMode", "workNext"],
    gates: ["policy", "ci"],
    asks: "permission+question",
    options: [{ key: "line", label: "Line", kind: "select", required: true, choices: [...[...lines].map((l) => ({ value: l, label: l })), { value: LOOP_NEW, label: "Neues Repo anbinden …" }] }],
    onboarding: { optionKey: "line", label: "Neues Repo anbinden", fields: [{ key: "name", label: "Name der Linie", kind: "text", required: true, placeholder: "z. B. beta" }], secret: { label: "Repo-Token" } },
  });
  const note = (ctx: AdapterContext, kind: string, summary: string, payload: Record<string, unknown>) =>
    ctx.emit({ type: "system", summary, payload: { kind, ...payload } });

  return {
    id: "fake-loop",
    version: "0.1.0",
    capabilities,

    async onboard(input) {
      const name = input.options.name?.trim() ?? "";
      if (!/^[a-z][a-z0-9-]{0,19}$/.test(name)) return { ok: false, detail: "Name der Linie: a–z, 0–9, - " };
      if (input.secret !== "geheim") return { ok: false, detail: "Der Token wurde abgelehnt" };
      lines.add(name);
      return { ok: true, options: { line: name } };
    },

    async start(spec: LoopStartSpec, ctx: AdapterContext, io: LoopIo): Promise<SessionHandle> {
      const resumed = (io.resume as { step?: number } | null)?.step ?? 0;
      const s = { mode: spec.mode ?? "ruhig", paused: false, closed: false, step: resumed };
      state.set(ctx.sessionId, s);
      note(ctx, "loop.info", `Fake-Loop „${spec.options.line}“ online`, { loop: "fake-loop", line: spec.options.line, mode: s.mode, status: "online", resumed: resumed > 0 });
      s.step += 1;
      io.saveCursor({ step: s.step });
      note(ctx, "loop.progress", "1 von 3 Aufgaben", { done: 1, total: 3, phase: "bauen", gate: { name: "policy", state: "passed" } });
      if (spec.goal?.includes("FEHLER")) note(ctx, "loop.broken", "Fake-Loop: Last Will offline", { reason: "offline" });
      if (spec.goal?.includes("FRAGE") && ctx.requestToolPermission) {
        void ctx
          .requestToolPermission({
            toolName: "AskUserQuestion",
            toolUseId: `fake-${ctx.sessionId}`,
            input: { questions: [{ header: "Vorschlag", question: "Soll der Merge laufen?", multiSelect: false, options: [{ label: "Ja" }, { label: "Nein" }] }] },
          })
          .then((answer) => note(ctx, "loop.answered", `Antwort: ${answer.behavior}`, { behavior: answer.behavior }));
      }
      return { sessionId: ctx.sessionId, meta: { line: spec.options.line } };
    },

    async control(handle: SessionHandle, input: LoopControlInput, ctx: AdapterContext): Promise<Ack> {
      const s = state.get(handle.sessionId);
      if (!s) return { ok: false, detail: "unbekanntes Handle" };
      if (!capabilities().controls.includes(input.kind)) return { ok: false, detail: `Befehl „${input.kind}“ wird nicht angeboten` };
      if (input.kind === "pause") s.paused = true;
      if (input.kind === "resume") s.paused = false;
      if (input.kind === "setMode") {
        if (!capabilities().modes.includes(input.mode)) return { ok: false, detail: `Betriebsart „${input.mode}“ unbekannt` };
        s.mode = input.mode;
      }
      note(ctx, "loop.command", `Befehl ${input.kind}`, { command: input.kind, mode: s.mode, paused: s.paused, ...(input.kind === "workNext" && input.text ? { text: input.text } : {}) });
      return { ok: true };
    },

    async status(handle: SessionHandle): Promise<HealthReport> {
      const s = state.get(handle.sessionId);
      return s && !s.closed ? { state: "healthy" } : { state: "down", detail: "getrennt" };
    },

    async stop(handle: SessionHandle): Promise<void> {
      const s = state.get(handle.sessionId);
      if (s) s.closed = true;
    },
  };
}
