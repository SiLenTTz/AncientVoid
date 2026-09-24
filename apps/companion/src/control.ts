import { createConnection, createServer, type Server } from "node:net";
import { chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Companion } from "./companion.ts";

/**
 * T11.5 / AC-P11-3: the local emergency stop. A unix socket in the user's
 * runtime dir takes "stop", "resume" and "status" — bind `uacc-companion
 * stop` to a key (Hyprland: `bind = SUPER SHIFT, ESCAPE, exec, uacc-companion stop`).
 */
export function socketPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_RUNTIME_DIR ?? "/tmp", "uacc-companion.sock");
}

export function serveControl(companion: Companion, path = socketPath()): Server {
  rmSync(path, { force: true });
  const server = createServer((sock) => {
    sock.setEncoding("utf8");
    sock.once("data", (line: string) => {
      const cmd = line.trim();
      if (cmd === "stop") companion.stop();
      else if (cmd === "resume") companion.resume();
      sock.end(`${JSON.stringify(companion.status())}\n`);
    });
  });
  server.listen(path, () => chmodSync(path, 0o600));
  return server;
}

export function sendControl(cmd: "stop" | "resume" | "status", path = socketPath()): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(path, () => sock.write(`${cmd}\n`));
    let out = "";
    sock.setEncoding("utf8");
    sock.on("data", (d: string) => (out += d));
    sock.on("end", () => resolve(out.trim()));
    sock.on("error", reject);
  });
}
