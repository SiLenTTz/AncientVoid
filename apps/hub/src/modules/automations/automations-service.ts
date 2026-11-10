import { spawn } from "node:child_process";
import { resolve as pathResolve } from "node:path";
import {
  AutomationService,
  BUILTIN_ACTIONS,
  detectedActions,
  isProjectPathAllowed,
  type AutomationLauncher,
  type AutomationPrechecker,
  type PrecheckResult,
  type SessionManager,
} from "@ancientvoid/core";
import { actionArgv, type ActionDefinition, type AutomationDefinition, type AutomationSkipReason } from "@ancientvoid/contracts";

/**
 * EPIC-P41 T41.4: Hub-seitige Adapter für den Automations-Dienst. Der Precheck
 * führt ausschließlich registrierte argv-Aktionen aus (kein freies Shell-String,
 * Argumentarrays everywhere); der Dispatch gehört dem Session-Manager — die
 * Automation besitzt nur Termin und Claim (ADR-0064). Run-Ziele (P40) sind in
 * diesem Build noch nicht dispatchbar und werden bei der Anlage abgewiesen.
 */

export interface HubAutomationDeps {
  dataDir: string;
  hostId: string;
  sessions: SessionManager;
  projectRoots: string[];
  log?: (line: string) => void;
}

/** Fehlertext des Session-Managers → Skip-Grund; Unbekanntes bleibt host_down (Fail loud im Log). */
export function mapLaunchFailure(message: string): AutomationSkipReason {
  if (/bereits eine andere AncientVoid-Session|lease/i.test(message)) return "lease";
  if (/budget|quota|usage|kontingent/i.test(message)) return "quota";
  if (/policy|erlaubt|permission|denied|403/i.test(message)) return "auth";
  return "host_down";
}

export function createHubAutomationService(deps: HubAutomationDeps): AutomationService {
  const launcher: AutomationLauncher = {
    async launch(definition: AutomationDefinition, promptText: string | null, claimKey: string, kind) {
      if (definition.target.kind !== "session") return { ok: false, reason: "host_down" };
      const target = definition.target;
      try {
        const record = await deps.sessions.create(
          {
            adapter: target.harness,
            project: target.project,
            ...(promptText === null ? {} : { prompt: promptText }),
            ...(target.model ? { model: target.model } : {}),
            workspaceMode: target.workdir,
          },
          `automation:${definition.id}`,
        );
        return { ok: true, sessionId: record.id };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        deps.log?.(`dispatch failure ${claimKey} (${kind}): ${message}`);
        return { ok: false, reason: mapLaunchFailure(message) };
      }
    },
  };
  const prechecker: AutomationPrechecker = {
    async run(actionId: string, definition: AutomationDefinition, deadlineMs: number): Promise<PrecheckResult> {
      if (definition.target.kind !== "session") return "precheck";
      const project = definition.target.project;
      if (deps.projectRoots.length > 0 && !(await isProjectPathAllowed(project, deps.projectRoots))) {
        deps.log?.(`precheck ${actionId}: Projekt ${project} außerhalb der Wurzeln — Grund precheck.`);
        return "precheck";
      }
      const registered: ActionDefinition[] = [...BUILTIN_ACTIONS, ...(await detectedActions(project))];
      const action = registered.find((a) => a.id === actionId);
      if (!action) {
        deps.log?.(`precheck ${actionId}: nicht als Aktion registriert — Grund precheck.`);
        return "precheck";
      }
      const code = await runArgv(actionArgv(action, {}), project, deadlineMs, deps.log);
      if (code === "timeout") return "precheck_timeout";
      return code === 0 ? "ok" : "precheck_exit";
    },
  };
  return new AutomationService({
    root: pathResolve(deps.dataDir, "automations"),
    hostId: deps.hostId,
    launcher,
    prechecker,
    ...(deps.log ? { log: deps.log } : {}),
  });
}

async function runArgv(argv: string[], cwd: string, deadlineMs: number, log?: (line: string) => void): Promise<number | "timeout"> {
  return new Promise((resolveDone) => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let done = false;
    const finish = (result: number | "timeout"): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolveDone(result);
    };
    const timer = setTimeout(() => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      finish("timeout");
    }, deadlineMs);
    child.on("error", (err) => {
      log?.(`precheck argv-Aufruf fehlgeschlagen: ${err.message}`);
      finish("timeout"); // kein Exit-Code mehr möglich: wie ein Timeout behandelt (kein stiller Erfolg)
    });
    child.on("exit", (code) => finish(code ?? -1));
  });
}
