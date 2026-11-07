/**
 * JSON-RPC 2.0 over newline-delimited stdio — the transport of ACP agents
 * and `codex app-server`. The agent
 * writes responses, notifications and its own requests (permission) to
 * stdout; we write to its stdin. A tmux pane may add `\r`; lines that are
 * not JSON (agent logs on the same pane) are handed to `onNoise`.
 */
export interface RpcHandlers {
  onNotification(method: string, params: unknown): void;
  onRequest(method: string, params: unknown): Promise<unknown>;
  /** A response to a request this connection did not send (e.g. a prompt
   * sent by the hub before a restart). */
  onStrayResult?(result: unknown): void;
  onNoise?(line: string): void;
}

export class RpcError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

/** BUG-0102: JSON-RPC „Internal error" trägt die eigentliche Ursache in
 * `error.data` — ohne sie sieht der Nutzer nur die nackte Hülle. */
function rpcErrorText(err: { message?: string; data?: unknown }): string {
  const base = err.message ?? "ACP-Fehler";
  const d = err.data;
  const detail = typeof d === "string" ? d : d === undefined || d === null ? "" : JSON.stringify(d);
  return detail && !base.includes(detail) ? `${base}: ${detail}` : base;
}

export class JsonRpcConnection {
  private nextId = 1;
  private buffer = "";
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private readonly write: (line: string) => void;
  private readonly handlers: RpcHandlers;

  constructor(write: (line: string) => void, handlers: RpcHandlers) {
    this.write = write;
    this.handlers = handlers;
  }

  request(method: string, params: unknown, timeoutMs = 0): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = timeoutMs > 0 ? setTimeout(() => {
        this.pending.delete(id);
        reject(new RpcError(-32000, `${method}: keine Antwort nach ${Math.round(timeoutMs / 1000)} s`));
      }, timeoutMs) : undefined;
      this.pending.set(id, {
        resolve: (v) => {
          if (timer) clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          if (timer) clearTimeout(timer);
          reject(e);
        },
      });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  /** Every outstanding request fails (the agent process went away). */
  failAll(reason: string): void {
    for (const [id, p] of this.pending) {
      this.pending.delete(id);
      p.reject(new RpcError(-32000, reason));
    }
  }

  feed(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line) this.handleLine(line);
    }
  }

  private send(message: unknown): void {
    this.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    let msg: { id?: unknown; method?: unknown; params?: unknown; result?: unknown; error?: { code?: number; message?: string; data?: unknown } };
    try {
      msg = JSON.parse(line) as typeof msg;
    } catch {
      this.handlers.onNoise?.(line);
      return;
    }
    if (typeof msg.method === "string") {
      if (msg.id === undefined || msg.id === null) {
        this.handlers.onNotification(msg.method, msg.params);
        return;
      }
      const id = msg.id;
      this.handlers.onRequest(msg.method, msg.params).then(
        (result) => this.send({ jsonrpc: "2.0", id, result: result ?? null }),
        (err: unknown) =>
          this.send({
            jsonrpc: "2.0",
            id,
            error: { code: err instanceof RpcError ? err.code : -32603, message: err instanceof Error ? err.message : String(err) },
          }),
      );
      return;
    }
    const waiting = typeof msg.id === "number" ? this.pending.get(msg.id) : undefined;
    if (!waiting) {
      if (msg.result !== undefined) this.handlers.onStrayResult?.(msg.result);
      return;
    }
    this.pending.delete(msg.id as number);
    if (msg.error) waiting.reject(new RpcError(msg.error.code ?? -32603, rpcErrorText(msg.error)));
    else waiting.resolve(msg.result);
  }
}
