import { spawn } from "node:child_process";
import type { HarnessCatalogEntry, HarnessInventoryEntry } from "@uacc/contracts";

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
    resume: "implemented-unverified",
    evidence:
      "Read-only ~/.claude/projects/<key>/<id>.jsonl (claude-clip, Linux 2026-09-19). Adapter uses --resume. PC-phone handoff is not accepted.",
  },
  {
    id: "codex",
    harness: "cli",
    command: "codex",
    args: ["--version"],
    openArgs: ["resume", "{id}"],
    discovery: "missing",
    resume: "implemented-unverified",
    evidence: "No verified on-disk discovery layout. Adapter continues a captured thread via codex exec resume.",
  },
  {
    id: "opencode",
    harness: "cli",
    command: "opencode",
    args: ["--version"],
    openArgs: ["--session", "{id}"],
    discovery: "missing",
    resume: "implemented-unverified",
    evidence: "No verified external session scan. Adapter passes --session on a later prompt.",
  },
  {
    id: "copilot",
    harness: "cli",
    command: "copilot",
    args: ["--version"],
    openArgs: ["--resume", "{id}"],
    discovery: "missing",
    resume: "implemented-unverified",
    evidence: "No verified external session scan. Adapter passes -r with a captured session id.",
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
    command: "",
    args: [],
    discovery: "blocked",
    resume: "blocked",
    evidence: "OpenAI-compatible endpoint is a model, not a coding harness.",
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
