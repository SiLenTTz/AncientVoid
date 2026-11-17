import { spawn } from "node:child_process";
import { spawnArgv } from "@ancientvoid/contracts";
import { isIP } from "node:net";

/**
 * EPIC-P10.5: external programs (yt-dlp, ffmpeg, ffprobe, tesseract) with
 * cancel, timeout and line-wise progress. Nothing goes through a shell.
 */
interface ToolRun {
  stdout: string;
  stderr: string;
}

export interface ToolOptions {
  signal?: AbortSignal | undefined;
  timeoutMs?: number;
  /** Every stdout/stderr line as it comes (progress). */
  onLine?: (line: string) => void;
  /** Collect stdout as bytes (e.g. raw pixels). */
  binary?: boolean;
  cwd?: string;
}

export type ToolRunner = (cmd: string, args: readonly string[], opts?: ToolOptions) => Promise<ToolRun & { bytes?: Buffer }>;

const MAX_CAPTURE = 64 * 1024 * 1024;

export const runTool: ToolRunner = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new Error("abgebrochen"));
    const start = spawnArgv(cmd, args);
    const child = spawn(start.file, start.args, { stdio: ["ignore", "pipe", "pipe"], ...(opts.cwd ? { cwd: opts.cwd } : {}), ...(start.shell ? { shell: true } : {}) });
    const out: Buffer[] = [];
    let outLen = 0;
    let err = "";
    let partial = "";
    const lines = (chunk: string) => {
      if (!opts.onLine) return;
      const text = partial + chunk;
      const parts = text.split(/\r|\n/);
      partial = parts.pop() ?? "";
      for (const p of parts) if (p.trim()) opts.onLine(p);
    };
    child.stdout.on("data", (b: Buffer) => {
      if (outLen < MAX_CAPTURE) {
        out.push(b);
        outLen += b.length;
      }
      if (!opts.binary) lines(b.toString("utf8"));
    });
    child.stderr.on("data", (b: Buffer) => {
      const s = b.toString("utf8");
      if (err.length < 1_000_000) err += s;
      lines(s);
    });
    const kill = () => child.kill("SIGTERM");
    opts.signal?.addEventListener("abort", kill, { once: true });
    const timer = opts.timeoutMs ? setTimeout(kill, opts.timeoutMs) : null;
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      reject((e as NodeJS.ErrnoException).code === "ENOENT" ? new Error(`${cmd} ist nicht installiert`) : e);
    });
    child.on("close", (code, sig) => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", kill);
      const bytes = Buffer.concat(out);
      if (opts.signal?.aborted) return reject(new Error("abgebrochen"));
      if (code !== 0) {
        const tail = err.trim().split("\n").filter((l) => /error|fehler|unable|not |denied|private|unavailable/i.test(l)).slice(-2).join(" · ") || err.trim().split("\n").slice(-1)[0] || "";
        return reject(new Error(`${cmd} ${sig ? `beendet (${sig})` : `Exit ${code}`}${tail ? `: ${tail.slice(0, 300)}` : ""}`));
      }
      resolve({ stdout: opts.binary ? "" : bytes.toString("utf8"), stderr: err, ...(opts.binary ? { bytes } : {}) });
    });
  });

function privateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/**
 * A link a person may hand to the downloader: http(s), no credentials in
 * the URL, no local or tailnet address (the hub must not become a proxy
 * into the own network). Names resolving to private addresses are not
 * caught here — yt-dlp only speaks to sites it has an extractor for, and
 * the generic one follows only media links.
 */
export function checkMediaUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "Kein gültiger Link.";
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return "Nur http(s)-Links.";
  if (u.username || u.password) return "Links mit Zugangsdaten werden nicht geholt.";
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".ts.net")) return "Lokale Adressen werden nicht geholt.";
  const kind = isIP(host);
  if (kind === 4 && privateV4(host)) return "Lokale Adressen werden nicht geholt.";
  if (kind === 6 && (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80") || host.startsWith("::ffff:"))) return "Lokale Adressen werden nicht geholt.";
  return null;
}
