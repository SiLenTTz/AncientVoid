import { spawn } from "node:child_process";
import { resolve as pathResolve } from "node:path";
import {
  AutomationService, BUILTIN_ACTIONS, detectedActions, isProjectPathAllowed,
  type AutomationLauncher, type AutomationPrechecker, type PrecheckResult, type SessionManager,
} from "@ancientvoid/core";
import { actionArgv, OrchestrationRunStart, AUTOMATION_LIMITS, type ActionDefinition } from "@ancientvoid/contracts";
import type { AutomationSkipReason } from "@ancientvoid/contracts";
import type { HubOrchestration } from "../orchestration/index.ts";

export interface HubAutomationDeps {
  dataDir: string; hostId: string; sessions: SessionManager; projectRoots: string[];
  orchestration?: HubOrchestration;
  actions?: ActionDefinition[];
  log?: (line: string) => void;
}

export function mapLaunchFailure(message: string): AutomationSkipReason {
  if (/bereits eine andere AncientVoid-Session|lease/i.test(message)) return "lease";
  if (/budget|quota|usage|kontingent/i.test(message)) return "quota";
  if (/policy|erlaubt|permission|denied|403|401|login|anmeld|auth/i.test(message)) return "auth";
  return "host_down";
}

export function createHubAutomationService(deps: HubAutomationDeps): AutomationService {
  const signal = new AbortController();
  const launcher: AutomationLauncher = {
    async template(id) {
      await deps.orchestration?.ready;
      const source = deps.orchestration?.store.get(id);
      if (!source || source.tasks.length === 0) return null;
      return OrchestrationRunStart.parse({ title: source.title, goal: source.goal, project: source.project, frame: source.frame,
        plan: { tasks: source.tasks.map(t => ({ id: t.id, title: t.title, prompt: t.prompt, adapter: t.adapter, model: t.model, dependsOn: t.dependsOn })) } });
    },
    async launch(definition, text, claimKey, kind) {
      try {
        if (definition.target.kind === "run") {
          if (!deps.orchestration || !text) return { ok: false, reason: "host_down" };
          await deps.orchestration.ready;
          const spec = OrchestrationRunStart.parse(JSON.parse(text));
          if (deps.projectRoots.length && !(await isProjectPathAllowed(spec.project, deps.projectRoots))) return { ok: false, reason: "auth", detail: "Projekt außerhalb der freigegebenen Wurzeln" };
          if (spec.frame.adapters.some(a => a.startsWith("loop:"))) return { ok: false, reason: "auth" };
          const run = await deps.orchestration.orchestrator.start(spec, `automation:${claimKey}`);
          return { ok: true, runId: run.id };
        }
        if (text === null) return { ok: false, reason: "precheck", detail: "Prompt-Blob fehlt" };
        const target = definition.target;
        if (deps.projectRoots.length && !(await isProjectPathAllowed(target.project, deps.projectRoots))) return { ok: false, reason: "auth", detail: "Projekt außerhalb der freigegebenen Wurzeln" };
        const record = await deps.sessions.create({ adapter: target.harness, project: target.project, prompt: text,
          ...(target.model ? { model: target.model } : {}), workspaceMode: target.workdir }, `automation:${claimKey}`);
        return { ok: true, sessionId: record.id };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        deps.log?.(`dispatch failure ${claimKey} (${kind}): ${message}`);
        const reason = mapLaunchFailure(message);
        return { ok: false, reason, uncertain: reason === "host_down" && !/braucht ein Git-Projekt|nicht lesbar|ENOENT|unknown adapter/i.test(message), detail: message.slice(0, 500) };
      }
    },
    async inspect(claim) {
      if (claim.runId) {
        await deps.orchestration?.ready;
        const run = deps.orchestration?.store.get(claim.runId);
        if (!run) return { state: "unknown", detail: "Referenzierter Run nicht verfügbar" };
        if (run.status === "done") return { state: "settled", outcome: "succeeded" };
        if (run.status === "failed") return { state: "settled", outcome: "failed" };
        if (run.status === "cancelled") return { state: "settled", outcome: "cancelled" };
        return { state: "running" };
      }
      const session = claim.sessionId ? deps.sessions.get(claim.sessionId) : undefined;
      if (!session) return { state: "unknown", detail: "Referenzierte Session nicht verfügbar" };
      const tail = await deps.sessions.tail(session.id, Math.max(0, session.lastSeq - 256), 256);
      const end = tail.findLast(e => e.type === "system" && e.payload.kind === "session.turn_end");
      if (end) {
        const reason = end.payload.reason;
        if (reason === "timeout") return { state: "settled", outcome: "timeout" };
        if (reason === "cancelled" || reason === "stopped") return { state: "settled", outcome: "cancelled" };
        return { state: "settled", outcome: reason === "error" || reason === "interrupted" || (typeof end.payload.code === "number" && end.payload.code !== 0) ? "failed" : "succeeded" };
      }
      if (session.status === "error" || session.status === "interrupted") return { state: "settled", outcome: "failed" };
      if (session.status === "stopped") return { state: "settled", outcome: "cancelled" };
      return { state: "running" };
    },
  };
  let activePrechecks = 0;
  const prechecker: AutomationPrechecker = {
    stop() { signal.abort(); },
    async run(actionId, definition, deadlineMs, templateText): Promise<PrecheckResult> {
      const project = definition.target.kind === "session" ? definition.target.project
        : templateText ? OrchestrationRunStart.parse(JSON.parse(templateText)).project : null;
      if (!project) return "precheck";
      if (deps.projectRoots.length > 0 && !(await isProjectPathAllowed(project, deps.projectRoots))) return "auth";
      const actions = [...(deps.actions ?? []), ...BUILTIN_ACTIONS, ...(await detectedActions(project))];
      const action = actions.find(a => a.id === actionId);
      if (!action) return "precheck";
      if (activePrechecks >= AUTOMATION_LIMITS.prechecks) return "quota";
      activePrechecks++;
      let code: number | "timeout" | "spawn_error";
      try { code = await runArgv(actionArgv(action, {}), project, Math.min(deadlineMs, action.timeoutMs), signal.signal); }
      finally { activePrechecks--; }
      if (code === "timeout") return "precheck_timeout";
      if (code === "spawn_error") return "precheck";
      return code === 0 ? "ok" : "precheck_exit";
    },
  };
  return new AutomationService({ root: pathResolve(deps.dataDir, "automations"), hostId: deps.hostId, launcher, prechecker, ...(deps.log ? { log: deps.log } : {}) });
}

function runArgv(argv: string[], cwd: string, deadline: number, signal: AbortSignal): Promise<number | "timeout" | "spawn_error"> {
  return new Promise(resolve => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd, detached: true, stdio: "ignore", signal });
    let done = false;
    const kill = () => { try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } };
    const finish = (code: number | "timeout" | "spawn_error") => {
      if (done) return;
      done = true; clearTimeout(timer); signal.removeEventListener("abort", kill); resolve(code);
    };
    const timer = setTimeout(() => { kill(); finish("timeout"); }, deadline);
    signal.addEventListener("abort", kill, { once: true });
    child.once("error", () => finish("spawn_error"));
    child.once("close", code => finish(code ?? -1));
  });
}
