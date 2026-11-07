import { spawn } from "node:child_process";
import type { HarnessCatalogEntry, HarnessInventoryEntry } from "@ancientvoid/contracts";

const VERSION_RE = /\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?/;

/**
 * Static matrix (Audit §4, ADR-0012). Versions come from a live probe,
 * never from this table. A present binary does not upgrade the cell.
 */
export const HARNESS_CATALOG: readonly HarnessCatalogEntry[] = [
  {
    id: "claude",
    harness: "cli",
    command: "claude",
    args: ["--version"],
    openArgs: ["--resume", "{id}"],
    discovery: "verified",
    resume: "verified",
    evidence:
      "Read-only ~/.claude/projects/<key>/<id>.jsonl (claude-clip, Linux 2026-09-19). Resume --resume + hub-,Weitermachen' live belegt 2026-11-07 (EPIC-P35 T35.3): Worker mitten im Zug gekillt → interrupted → Weitermachen → Codewort KIESEL-7 aus dem vorabgesetzten Zug erinnert; native Session blieb dieselbe.",
  },
  {
    id: "codex",
    harness: "cli",
    command: "codex",
    args: ["--version"],
    openArgs: ["resume", "{id}"],
    discovery: "verified",
    resume: "implemented-unverified",
    evidence:
      "Rollout-Scanner (EPIC-P34 T34.8): ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl, live 2026-11-07 55 Rollouts mit Titel. Übernahme bleibt unbelegt — der Adapter nimmt keine fremde Thread-ID an (nur beobachtet); `codex exec resume` braucht einen Prompt, deshalb kein hub-,Weitermachen'.",
  },
  {
    id: "opencode",
    harness: "cli",
    command: "opencode",
    args: ["--version"],
    openArgs: ["--session", "{id}"],
    discovery: "verified",
    resume: "verified",
    evidence:
      "SQLite-Store ~/.local/share/opencode/opencode.db (session/message/part, Layout 2026-08-31 verifiziert); Scanner live 2026-11-07: 488 Sessions. Resume via --session verified by hand 2026-09-23 (tetris-reloaded, zai-coding-plan/glm-5.3, session 821b0ec8) plus E2E handoff/recovery; hub-,Weitermachen' live belegt 2026-11-07 (EPIC-P35 T35.3): Worker-Kill mitten im Zug → Weitermachen → Codewort NEBEL-11 erinnert. ACP-Preset ebenso (EPIC-P35): session/load promptlos, Agent-Ende danach macht die Session weckbar (dormant-on-exit) — Kontext zweimal live belegt.",
  },
  {
    id: "pi",
    harness: "cli",
    command: "pi",
    args: ["--version"],
    openArgs: ["--session", "{id}"],
    discovery: "verified",
    resume: "verified",
    evidence: "ADR-0041: external sessions read from ~/.pi/agent/sessions (JSONL, pi 1.4.0, checked on disk 2026-10-28); resume via `pi --session <file>`, copy via `--fork`. hub-,Weitermachen' live belegt 2026-11-07 (EPIC-P35 T35.3): Worker-Kill → Weitermachen → Codewort QUARZ-3 erinnert; pi führt den abgebrochenen Zug zuerst zu Ende (Queue des CLI), der Folgeprompt antwortet aus dem übernommenen Kontext.",
  },
  {
    id: "copilot",
    harness: "cli",
    command: "copilot",
    args: ["--version"],
    openArgs: ["--resume", "{id}"],
    discovery: "verified",
    resume: "verified",
    evidence:
      "SQLite-Store ~/.copilot/session-store.db (sessions/turns, ISO-Zeiten; EPIC-P35 T35.5, live 2026-11-07 mit copilot 1.0.104: 12 Sessions). Übernahme aus der Erkennung live belegt (Adoption ,93ba3d3d… „remember the number 42“ → Antwort „42“); hub-,Weitermachen' live belegt (Worker-Kill → Weitermachen → Codewort LAVA-9).",
  },
  {
    id: "aider",
    harness: "cli",
    command: "aider",
    args: ["--version"],
    discovery: "missing",
    resume: "missing",
    evidence: "Adapter has no native session id to discover or resume.",
  },
  {
    id: "cursor",
    harness: "ide",
    command: "cursor",
    args: ["--version"],
    discovery: "verified",
    resume: "missing",
    evidence: "Read-only composerHeaders in Cursor state.vscdb (cursor-clip, Linux 2026-09-18). No native resume.",
  },
  {
    id: "deepseek",
    harness: "cli",
    command: "dsh",
    args: ["--version"],
    discovery: "missing",
    resume: "implemented-unverified",
    evidence:
      "dsh (DeepSeek Harness) runs through @ancientvoid/adapter-acp (`--profile acp`, ADR-0018): sandboxed read-only, every escalation asks on the phone. Sessions liegen als ~/.dsh/sessions/<projekt>/session-<uuid>/session.v4.jsonl.zstd — ohne zstd-Decoder kein lesender Scan (kein node:zstd, keine nativen Module; geprüft 2026-11-07), bewusst missing.",
  },
  {
    id: "hermes",
    harness: "cli",
    command: "hermes",
    args: ["--version"],
    openArgs: ["--resume", "{id}"],
    discovery: "verified",
    resume: "verified",
    evidence:
      "Hermes Agent 0.21.0: read-only Scanner für ~/.hermes/state.db (sessions/messages, EPIC-P34 T34.8; 1 277 Sitzungen gemessen 2026-11-07, cron/subagent gefiltert). Resume via --resume <sid> live belegt (P13-Handlauf 2026-10-03); hub-,Weitermachen' live belegt 2026-11-07 (EPIC-P35 T35.3): Worker-Kill → Weitermachen → Codewort DELTA-5 erinnert.",
  },
  {
    id: "maki",
    harness: "cli",
    command: "maki",
    args: ["--version"],
    discovery: "verified",
    resume: "verified",
    evidence: "maki (maki.sh) runs through @ancientvoid/adapter-acp (`maki acp`, preset maki). ADR-0041: external sessions read from ~/.local/state/maki/sessions (header/meta lines, maki 0.6.5); live 2026-10-28: found with title, adopted via ACP session/load, history imported, answered from the adopted context. A session open in another maki process is locked by maki itself.",
  },
  {
    id: "omp",
    harness: "cli",
    command: "omp",
    args: ["--version"],
    openArgs: ["--resume", "{id}"],
    discovery: "verified",
    resume: "verified",
    evidence: "oh-my-pi (omp) runs through @ancientvoid/adapter-acp (`omp acp`, preset omp). ADR-0041: external sessions read from ~/.omp/agent/sessions (pi-family JSONL, omp 18.13.3); live 2026-10-28: found, adopted in place via ACP session/load (omp refuses to load from another directory), answered from the adopted context.",
  },
];

export interface ProbeRun {
  code: number | null;
  output: string;
  missing?: boolean;
}

export interface ProbeRunner {
  run(command: string, args: readonly string[]): Promise<ProbeRun>;
}

export function spawnProbeRunner(timeoutMs = 3000): ProbeRunner {
  return {
    run(command, args) {
      return new Promise((resolve) => {
        let settled = false;
        const finish = (result: ProbeRun) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(result);
        };
        const child = spawn(command, [...args], { stdio: ["ignore", "pipe", "pipe"] });
        let output = "";
        const take = (chunk: Buffer) => {
          if (output.length < 512) output += chunk.toString("utf8");
        };
        child.stdout.on("data", take);
        child.stderr.on("data", take);
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          finish({ code: null, output: "" });
        }, timeoutMs);
        child.on("error", (err: NodeJS.ErrnoException) => {
          finish({ code: err.code === "ENOENT" ? 127 : 1, output: "", missing: err.code === "ENOENT" });
        });
        child.on("close", (code) => finish({ code, output }));
      });
    },
  };
}

function versionOf(output: string): string | null {
  return VERSION_RE.exec(output)?.[0] ?? null;
}

function probeNote(run: ProbeRun | undefined): string {
  if (!run) return "Probe: not run.";
  if (run.missing) return "Probe: binary missing.";
  const version = versionOf(run.output);
  if (version) return `Probe: ${version}.`;
  if (run.code === null) return "Probe: timed out.";
  return `Probe: exit ${run.code}, no version token.`;
}

export async function probeHarnesses(
  catalog: readonly HarnessCatalogEntry[],
  runner: ProbeRunner,
): Promise<HarnessInventoryEntry[]> {
  const runs = await Promise.all(
    catalog.map((entry) => (entry.command ? runner.run(entry.command, entry.args) : Promise.resolve(undefined))),
  );
  return catalog.map((entry, i) => {
    const run = runs[i];
    const version = entry.command && run && !run.missing ? versionOf(run.output) : null;
    const note = entry.command ? probeNote(run) : "Probe: no binary for this target.";
    return {
      id: entry.id,
      harness: entry.harness,
      version,
      discovery: entry.discovery,
      resume: entry.resume,
      evidence: `${entry.evidence} ${note}`,
    };
  });
}

function shellQuote(value: string): string {
  return /^[\w./=@%^+:-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * T5.5: the terminal command that opens this same provider session on the
 * PC (verified against the CLIs' own --help, 2026-09-23). Null when the
 * harness has no native open or no native id is known.
 */
export function nativeOpenCommand(adapterId: string, nativeSessionId: string | null, workdir: string): string | null {
  if (!nativeSessionId) return null;
  const entry = HARNESS_CATALOG.find((item) => item.id === adapterId);
  if (!entry?.command || !entry.openArgs) return null;
  const args = entry.openArgs.map((arg) => (arg === "{id}" ? nativeSessionId : arg));
  return `cd ${shellQuote(workdir)} && ${[entry.command, ...args].map(shellQuote).join(" ")}`;
}
