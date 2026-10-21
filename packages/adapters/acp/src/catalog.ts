import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import type { ModelOption } from "@uacc/contracts";

type Option = { value: string; name?: string };
type Group = { group?: string; name?: string; options?: Option[] };
export interface ModelConfigOption {
  id: string;
  category?: string | null;
  options?: (Option | Group)[];
}

/** One `provider/model` per entry. dsh offers values as a JSON pair
 * (`["zai","glm-5.3"]`); other agents offer plain ids. */
export function catalogFromConfigOptions(configOptions: readonly ModelConfigOption[] | undefined): ModelOption[] {
  const option = configOptions?.find((o) => o.category === "model" || o.id === "model");
  const seen = new Map<string, ModelOption>();
  for (const entry of option?.options ?? []) {
    const group = "value" in entry ? undefined : (entry.name ?? entry.group);
    const items = "value" in entry ? [entry] : (entry.options ?? []);
    for (const item of items) {
      let id = item.value;
      try {
        const pair = JSON.parse(item.value) as unknown;
        if (Array.isArray(pair) && pair.length === 2) id = `${pair[0]}/${pair[1]}`;
      } catch {
        // a plain id
      }
      const name = item.name ?? id;
      seen.set(id, { id, label: group ? `${group}: ${name}` : name });
    }
  }
  return [...seen.values()];
}

/**
 * The model catalog of an ACP agent that has no listing command (dsh ≥ 0.2:
 * the old `--profile models` is gone). Starts the agent, asks for a session
 * and reads its model option; the full list may follow `session/new` as a
 * `config_option_update`, so updates are collected for a short while. The
 * probe session is closed and the agent stopped either way.
 */
export async function probeModelCatalog(
  command: readonly string[],
  env: Readonly<Record<string, string>>,
  opts: { settleMs?: number; timeoutMs?: number; cwd?: string } = {},
): Promise<ModelOption[]> {
  const { settleMs = 1500, timeoutMs = 20_000, cwd = tmpdir() } = opts;
  const child = spawn(command[0]!, command.slice(1), { cwd, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "ignore"] });
  const send = (msg: Record<string, unknown>) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);
  let best: ModelOption[] = [];
  let sessionId: string | null = null;
  const take = (options: ModelConfigOption[] | undefined) => {
    const list = catalogFromConfigOptions(options);
    if (list.length >= best.length) best = list;
  };
  try {
    return await new Promise<ModelOption[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Modellkatalog: keine Antwort von ${command[0]} in ${timeoutMs} ms`)), timeoutMs);
      child.once("error", (err) => reject(err));
      child.once("exit", () => reject(new Error("Modellkatalog: der Agent hat sich vorzeitig beendet")));
      let buffer = "";
      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith("{")) continue;
          let msg: { id?: number; result?: { sessionId?: string; configOptions?: ModelConfigOption[] }; error?: { message?: string }; method?: string; params?: { update?: { sessionUpdate?: string; configOptions?: ModelConfigOption[] } } };
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (msg.id === 1 && msg.error) return reject(new Error(`Modellkatalog: ${msg.error.message ?? "initialize fehlgeschlagen"}`));
          if (msg.id === 1) send({ id: 2, method: "session/new", params: { cwd, mcpServers: [] } });
          if (msg.id === 2 && msg.error) return reject(new Error(`Modellkatalog: ${msg.error.message ?? "session/new fehlgeschlagen"}`));
          if (msg.id === 2) {
            sessionId = msg.result?.sessionId ?? null;
            take(msg.result?.configOptions);
            setTimeout(() => {
              clearTimeout(timer);
              resolve(best);
            }, settleMs);
          }
          if (msg.method === "session/update" && msg.params?.update?.sessionUpdate === "config_option_update") take(msg.params.update.configOptions);
        }
      });
      send({ id: 1, method: "initialize", params: { protocolVersion: 1, clientCapabilities: {} } });
    });
  } finally {
    if (sessionId) send({ id: 3, method: "session/close", params: { sessionId } });
    child.removeAllListeners("exit");
    setTimeout(() => child.kill(), 200).unref();
  }
}
